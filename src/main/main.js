import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  screen
} from "electron";
import { executeAgentToolCall } from "./agentTools.js";
import { loadConfig, saveConfig } from "./configStore.js";
import { getForegroundAppContext, hasMeaningfullyChangedAppContext } from "./foregroundApp.js";
import { GlobalPushToTalkMonitor } from "./globalPushToTalk.js";
import {
  clearAllPersistentMemory,
  clearRecentAppContexts,
  clearVisualHistory,
  deleteVisualMomentById,
  loadPersistentMemory,
  markSessionStarted,
  patchPersistentProfile,
  prunePersistentMemory,
  recordAppContextSnapshot,
  recordVisualMoment,
  resetPersistentProfile
} from "./memoryStore.js";
import { captureScreensAsJpeg } from "./screenCapture.js";
import {
  buildAgentApprovalRequest,
  buildDeniedAgentToolResult,
  shouldRequestAgentApproval
} from "../panel/agentApproval.js";
import {
  formatChatCompletionFailure,
  parseChatCompletionFailure,
  shouldRetryChatCompletion
} from "../shared/chatCompletionErrors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const panelHtmlPath = path.join(__dirname, "../panel/panel.html");
const overlayHtmlPath = path.join(__dirname, "../overlay/overlay.html");
const preloadPath = path.join(__dirname, "preload.cjs");
const foregroundContextRefreshIntervalMilliseconds = 5000;
const workerPlaceholderPattern = /your-worker-name|your-subdomain/i;

let clickyTray = null;
let panelWindow = null;
let overlayWindow = null;
let currentConfig = null;
let currentPersistentMemory = null;
let latestAppContext = null;
let globalPushToTalkMonitor = null;
let cursorBroadcastInterval = null;
let foregroundContextInterval = null;
let isQuittingApp = false;
let fallbackPushToTalkActive = false;
let pendingAgentApprovalRequests = new Map();
const agentApprovalTimeoutMilliseconds = 120000;
let ipcHandlersRegistered = false;
let shortcutPresentation = {
  label: "Ctrl + Alt",
  mode: "native",
  note: "Hold to talk globally."
};
let latestOverlayState = {
  visible: true,
  mode: "idle",
  message: "",
  statusText: "ready",
  showClickyWhenIdle: true
};

const activeChatRequests = new Map();

if (process.platform !== "win32") {
  app.disableHardwareAcceleration();
}

app.whenReady().then(async () => {
  currentConfig = loadConfig();
  currentPersistentMemory = prunePersistentMemory({
    visualHistoryRetentionDays: currentConfig.visualHistoryRetentionDays
  });
  currentPersistentMemory = markSessionStarted();
  latestAppContext = await getForegroundAppContext();
  currentPersistentMemory = recordAppContextSnapshot(latestAppContext);

  setupIpcHandlers();
  createPanelWindow();
  createOverlayWindow();
  createTray();
  await createGlobalPushToTalkMonitor();
  startCursorBroadcastLoop();
  startForegroundContextLoop();
  applyCurrentIdleOverlayState();
  app.setAppUserModelId("so.clicky.windows");
  screen.on("display-added", recreateOverlayWindow);
  screen.on("display-removed", recreateOverlayWindow);
  screen.on("display-metrics-changed", recreateOverlayWindow);
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  isQuittingApp = true;
  globalPushToTalkMonitor?.stop();
  globalShortcut.unregisterAll();
  stopCursorBroadcastLoop();
  stopForegroundContextLoop();
  flushPendingAgentApprovals({
    approved: false,
    reason: "Clicky is shutting down before the approval was resolved."
  });
});

app.on("activate", () => {
  panelWindow?.show();
});

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 430,
    height: 900,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: "#09121b",
    title: "Clicky",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  panelWindow.loadFile(panelHtmlPath);
  positionPanelWindow();
  panelWindow.webContents.on("did-finish-load", () => {
    panelWindow?.webContents.send("ptt:shortcut-mode", shortcutPresentation);
    panelWindow?.webContents.send("context:changed", latestAppContext);
  });

  panelWindow.on("blur", () => {
    if (!isQuittingApp && pendingAgentApprovalRequests.size === 0) {
      panelWindow.hide();
    }
  });

  panelWindow.on("close", (event) => {
    if (!isQuittingApp) {
      event.preventDefault();
      if (pendingAgentApprovalRequests.size === 0) {
        panelWindow.hide();
      }
    }
  });
}

function createOverlayWindow() {
  const virtualBounds = getVirtualDesktopBounds();

  overlayWindow = new BrowserWindow({
    x: virtualBounds.x,
    y: virtualBounds.y,
    width: virtualBounds.width,
    height: virtualBounds.height,
    show: true,
    frame: false,
    transparent: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.loadFile(overlayHtmlPath);
  overlayWindow.webContents.on("did-finish-load", () => {
    overlayWindow?.webContents.send("overlay:state", { type: "state", ...latestOverlayState });
  });
}

function recreateOverlayWindow() {
  if (!app.isReady()) {
    return;
  }

  const existingOverlayWindow = overlayWindow;
  createOverlayWindow();

  if (existingOverlayWindow && !existingOverlayWindow.isDestroyed()) {
    existingOverlayWindow.destroy();
  }
}

function createTray() {
  const trayImage = nativeImage.createFromDataURL(createTrayIconDataUrl());
  clickyTray = new Tray(trayImage.resize({ width: 18, height: 18 }));
  clickyTray.setToolTip("Clicky");
  clickyTray.on("click", togglePanelWindow);
  clickyTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Clicky", click: () => showPanelWindow() },
      { label: "Hide Clicky", click: () => panelWindow?.hide() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuittingApp = true;
          app.quit();
        }
      }
    ])
  );
}

async function createGlobalPushToTalkMonitor() {
  globalPushToTalkMonitor = new GlobalPushToTalkMonitor({
    onStart: () => {
      panelWindow?.webContents.send("ptt:start", { source: "global-shortcut" });
    },
    onStop: () => {
      panelWindow?.webContents.send("ptt:stop", { source: "global-shortcut" });
    },
    onError: (error) => {
      console.error("Global push-to-talk monitor error:", error);
    }
  });

  try {
    const startResult = await globalPushToTalkMonitor.start();
    shortcutPresentation =
      startResult?.mode === "native-embedded"
        ? {
            label: "Ctrl + Alt",
            mode: "native-embedded",
            note: "Hold to talk globally with Clicky's built-in Windows listener."
          }
        : {
            label: "Ctrl + Alt",
            mode: "native",
            note: "Hold to talk globally."
          };
  } catch (error) {
    console.warn(
      "Native global push-to-talk failed, falling back to toggle shortcut:",
      error instanceof Error ? error.message : String(error)
    );

    const fallbackRegistrationSucceeded = globalShortcut.register("Control+Alt+Space", () => {
      fallbackPushToTalkActive = !fallbackPushToTalkActive;
      panelWindow?.webContents.send(fallbackPushToTalkActive ? "ptt:start" : "ptt:stop", {
        source: "fallback-shortcut"
      });
    });

    shortcutPresentation = fallbackRegistrationSucceeded
      ? {
          label: "Ctrl + Alt + Space",
          mode: "fallback",
          note: "Toggle fallback mode because the native listener could not start on this machine."
        }
      : {
          label: "manual prompt",
          mode: "manual-only",
          note: "The native listener could not start, so use the manual prompt box in the panel."
        };
  }

  sendShortcutPresentationToPanel();
}

function startCursorBroadcastLoop() {
  stopCursorBroadcastLoop();
  cursorBroadcastInterval = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return;
    }

    overlayWindow.webContents.send("overlay:cursor", screen.getCursorScreenPoint());
  }, 32);
}

function stopCursorBroadcastLoop() {
  if (cursorBroadcastInterval) {
    clearInterval(cursorBroadcastInterval);
    cursorBroadcastInterval = null;
  }
}

function startForegroundContextLoop() {
  stopForegroundContextLoop();
  foregroundContextInterval = setInterval(() => {
    refreshForegroundContext().catch((error) => {
      console.warn("Failed to refresh Clicky foreground context:", error);
    });
  }, foregroundContextRefreshIntervalMilliseconds);
}

function stopForegroundContextLoop() {
  if (foregroundContextInterval) {
    clearInterval(foregroundContextInterval);
    foregroundContextInterval = null;
  }
}

async function refreshForegroundContext() {
  const nextAppContext = await getForegroundAppContext();
  if (!hasMeaningfullyChangedAppContext(latestAppContext, nextAppContext)) {
    return;
  }

  latestAppContext = nextAppContext;
  currentPersistentMemory = recordAppContextSnapshot(nextAppContext);
  panelWindow?.webContents.send("context:changed", nextAppContext);
}

function setupIpcHandlers() {
  if (ipcHandlersRegistered) {
    return;
  }

  ipcHandlersRegistered = true;
  ipcMain.handle("config:get", () => currentConfig);
  ipcMain.handle("config:save", (_event, partialConfig) => {
    currentConfig = saveConfig(partialConfig);
    currentPersistentMemory = prunePersistentMemory({
      visualHistoryRetentionDays: currentConfig.visualHistoryRetentionDays
    });
    applyCurrentIdleOverlayState();
    return currentConfig;
  });

  ipcMain.handle("memory:get", () => currentPersistentMemory || loadPersistentMemory());
  ipcMain.handle("memory:save-profile", (_event, partialProfile) => {
    currentPersistentMemory = patchPersistentProfile(partialProfile);
    return currentPersistentMemory;
  });
  ipcMain.handle("memory:reset-profile", () => {
    currentPersistentMemory = resetPersistentProfile();
    return currentPersistentMemory;
  });
  ipcMain.handle("memory:clear-app-contexts", () => {
    currentPersistentMemory = clearRecentAppContexts();
    return currentPersistentMemory;
  });
  ipcMain.handle("memory:record-visual-moment", (_event, payload) => {
    currentPersistentMemory = recordVisualMoment(payload);
    return currentPersistentMemory;
  });
  ipcMain.handle("memory:clear-visual-history", () => {
    currentPersistentMemory = clearVisualHistory();
    return currentPersistentMemory;
  });
  ipcMain.handle("memory:delete-visual-moment", (_event, visualMomentId) => {
    currentPersistentMemory = deleteVisualMomentById(visualMomentId);
    return currentPersistentMemory;
  });
  ipcMain.handle("memory:clear-all", () => {
    currentPersistentMemory = clearAllPersistentMemory();
    return currentPersistentMemory;
  });

  ipcMain.handle("context:get-current", () => latestAppContext);

  ipcMain.handle("agent:run-tool", async (_event, payload) => {
    const requestContext = {
      ...(payload.requestContext || {}),
      permissiveDevModeEnabled: Boolean(currentConfig?.permissiveDevModeEnabled)
    };

    if (shouldRequestAgentApproval(payload.name, requestContext)) {
      const approvalRequest = buildAgentApprovalRequest({
        name: payload.name,
        input: payload.input || {}
      });
      const approvalResult = await requestAgentApproval(approvalRequest);

      if (!approvalResult?.approved) {
        return buildDeniedAgentToolResult(
          {
            name: payload.name
          },
          approvalResult?.reason || "User denied approval for this agent action."
        );
      }
    }

    return executeAgentToolCall({
      name: payload.name,
      input: payload.input || {},
      latestAppContext,
      requestContext
    });
  });
  ipcMain.handle("agent:approval-response", (_event, payload) => {
    const requestId = String(payload?.requestId || "").trim();
    if (!requestId) {
      return {
        ok: false,
        error: "Missing approval request id."
      };
    }

    const pendingRequest = pendingAgentApprovalRequests.get(requestId);
    if (!pendingRequest) {
      return {
        ok: false,
        error: `Unknown or expired approval request id: ${requestId}`
      };
    }

    pendingAgentApprovalRequests.delete(requestId);
    clearTimeout(pendingRequest.timeoutId);
    pendingRequest.resolve({
      approved: Boolean(payload?.approved),
      reason: String(payload?.reason || "").trim()
    });

    return {
      ok: true
    };
  });

  ipcMain.handle("notifications:show-balloon", (_event, payload) => {
    if (!clickyTray || typeof clickyTray.displayBalloon !== "function") {
      return { ok: false, error: "Tray notifications are unavailable." };
    }

    clickyTray.displayBalloon({
      title: payload.title || "Clicky",
      content: payload.content || "",
      iconType: payload.iconType || "info",
      largeIcon: false,
      respectQuietTime: true
    });

    return { ok: true };
  });

  ipcMain.handle("screens:capture", async (_event, captureOptions = {}) => {
    return captureScreensAsJpeg({
      mode: captureOptions?.mode || currentConfig.screenCaptureMode
    });
  });

  ipcMain.handle("app:get-version", () => app.getVersion());

  ipcMain.handle("network:get-transcribe-token", async (_event, workerBaseUrl) => {
    const response = await fetch(`${resolveWorkerBaseUrl(workerBaseUrl)}/transcribe-token`, {
      method: "POST",
      headers: buildWorkerRequestHeaders()
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Token request failed (${response.status}): ${responseText}`);
    }

    return JSON.parse(responseText);
  });

  ipcMain.handle("network:tts", async (_event, payload) => {
    const response = await fetch(`${resolveWorkerBaseUrl(payload.workerBaseUrl)}/tts`, {
      method: "POST",
      headers: buildWorkerRequestHeaders({
        "content-type": "application/json",
        accept: "audio/mpeg"
      }),
      body: JSON.stringify({
        text: payload.text,
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      throw new Error(`TTS request failed (${response.status}): ${audioBuffer.toString("utf8")}`);
    }

    return {
      mimeType: response.headers.get("content-type") || "audio/mpeg",
      audioBase64: audioBuffer.toString("base64")
    };
  });

  ipcMain.handle("network:chat-complete", async (_event, payload) => {
    return performChatCompletion({
      workerBaseUrl: payload.workerBaseUrl,
      requestBody: payload.requestBody
    });
  });

  ipcMain.on("network:chat-start", async (event, payload) => {
    const sender = event.sender;
    const abortController = new AbortController();
    activeChatRequests.set(payload.requestId, abortController);

    try {
      const response = await fetch(`${resolveWorkerBaseUrl(payload.workerBaseUrl)}/chat`, {
        method: "POST",
        headers: buildWorkerRequestHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify(payload.requestBody),
        signal: abortController.signal
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        const failure = parseChatCompletionFailure({
          status: response.status,
          responseText: errorText,
          retryAfterHeader: response.headers.get("retry-after")
        });
        sender.send("network:chat-event", {
          requestId: payload.requestId,
          type: "error",
          message: formatChatCompletionFailure(failure)
        });
        return;
      }

      const textDecoder = new TextDecoder();
      const reader = response.body.getReader();
      let bufferedText = "";
      let accumulatedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        bufferedText += textDecoder.decode(value, { stream: true });
        const lines = bufferedText.split(/\r?\n/);
        bufferedText = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) {
            continue;
          }

          const jsonString = line.slice(6);
          if (jsonString === "[DONE]") {
            continue;
          }

          let eventPayload;
          try {
            eventPayload = JSON.parse(jsonString);
          } catch {
            continue;
          }

          if (
            eventPayload.type === "content_block_delta" &&
            eventPayload.delta?.type === "text_delta" &&
            typeof eventPayload.delta.text === "string"
          ) {
            accumulatedText += eventPayload.delta.text;
            sender.send("network:chat-event", {
              requestId: payload.requestId,
              type: "delta",
              accumulatedText
            });
          }
        }
      }

      sender.send("network:chat-event", {
        requestId: payload.requestId,
        type: "done",
        accumulatedText
      });
    } catch (error) {
      if (error.name === "AbortError") {
        sender.send("network:chat-event", {
          requestId: payload.requestId,
          type: "aborted"
        });
      } else {
        sender.send("network:chat-event", {
          requestId: payload.requestId,
          type: "error",
          message: error.message
        });
      }
    } finally {
      activeChatRequests.delete(payload.requestId);
    }
  });

  ipcMain.on("network:chat-abort", (_event, requestId) => {
    activeChatRequests.get(requestId)?.abort();
  });

  ipcMain.handle("overlay:set-state", (_event, payload) => {
    latestOverlayState = {
      ...latestOverlayState,
      ...payload
    };
    overlayWindow?.webContents.send("overlay:state", { type: "state", ...latestOverlayState });
  });

  ipcMain.handle("overlay:show-point", (_event, payload) => {
    overlayWindow?.webContents.send("overlay:state", { type: "point", ...payload });
  });

  ipcMain.handle("overlay:clear-point", () => {
    overlayWindow?.webContents.send("overlay:state", { type: "clear-point" });
  });

  ipcMain.handle("overlay:hide", () => {
    overlayWindow?.webContents.send("overlay:state", { type: "hide" });
  });
}

function applyCurrentIdleOverlayState() {
  latestOverlayState = {
    visible: currentConfig.showClickyWhenIdle,
    mode: "idle",
    message: "",
    statusText: "ready",
    showClickyWhenIdle: currentConfig.showClickyWhenIdle
  };

  overlayWindow?.webContents.send("overlay:state", { type: "state", ...latestOverlayState });
}

function sendShortcutPresentationToPanel() {
  panelWindow?.webContents.send("ptt:shortcut-mode", shortcutPresentation);
}

async function requestAgentApproval(approvalRequest) {
  if (!panelWindow || panelWindow.isDestroyed()) {
    return {
      approved: false,
      reason: "Clicky panel is unavailable, so the approval could not be shown."
    };
  }

  const requestId = `agent-approval-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  showPanelWindow();

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      const pendingRequest = pendingAgentApprovalRequests.get(requestId);
      if (!pendingRequest) {
        return;
      }

      pendingAgentApprovalRequests.delete(requestId);
      pendingRequest.resolve({
        approved: false,
        reason: "Clicky timed out waiting for panel approval."
      });
    }, agentApprovalTimeoutMilliseconds);

    pendingAgentApprovalRequests.set(requestId, {
      resolve,
      timeoutId
    });
    panelWindow?.webContents.send("agent:approval-requested", {
      requestId,
      ...approvalRequest
    });
  });
}

function flushPendingAgentApprovals(result) {
  for (const [, pendingRequest] of pendingAgentApprovalRequests) {
    clearTimeout(pendingRequest.timeoutId);
    pendingRequest.resolve(result);
  }

  pendingAgentApprovalRequests = new Map();
}

function togglePanelWindow() {
  if (!panelWindow) {
    return;
  }

  if (panelWindow.isVisible()) {
    panelWindow.hide();
  } else {
    showPanelWindow();
  }
}

function showPanelWindow() {
  positionPanelWindow();
  panelWindow?.show();
  panelWindow?.focus();
}

function positionPanelWindow() {
  if (!panelWindow) {
    return;
  }

  const currentBounds = panelWindow.getBounds();
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const x = Math.round(primaryWorkArea.x + primaryWorkArea.width - currentBounds.width - 24);
  const y = Math.round(primaryWorkArea.y + primaryWorkArea.height - currentBounds.height - 24);
  panelWindow.setPosition(x, y, false);
}

function getVirtualDesktopBounds() {
  const displays = screen.getAllDisplays();
  const minX = Math.min(...displays.map((display) => display.bounds.x));
  const minY = Math.min(...displays.map((display) => display.bounds.y));
  const maxX = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const maxY = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function resolveWorkerBaseUrl(workerBaseUrl) {
  const normalizedWorkerBaseUrl = String(workerBaseUrl || "").trim().replace(/\/+$/, "");

  if (!normalizedWorkerBaseUrl) {
    throw new Error("Configure your Worker URL in Settings before using Clicky.");
  }

  if (workerPlaceholderPattern.test(normalizedWorkerBaseUrl)) {
    throw new Error("Replace the default placeholder Worker URL in Settings before using Clicky.");
  }

  let parsedWorkerBaseUrl;
  try {
    parsedWorkerBaseUrl = new URL(normalizedWorkerBaseUrl);
  } catch {
    throw new Error("Worker URL must be a valid http or https URL.");
  }

  if (!["http:", "https:"].includes(parsedWorkerBaseUrl.protocol)) {
    throw new Error("Worker URL must start with http:// or https://.");
  }

  return normalizedWorkerBaseUrl;
}

async function performChatCompletion({ workerBaseUrl, requestBody }) {
  for (let attemptCount = 0; attemptCount <= 1; attemptCount += 1) {
    const response = await fetch(`${resolveWorkerBaseUrl(workerBaseUrl)}/chat`, {
      method: "POST",
      headers: buildWorkerRequestHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        ...requestBody,
        stream: false
      })
    });

    const responseText = await response.text();
    if (response.ok) {
      return JSON.parse(responseText);
    }

    const failure = parseChatCompletionFailure({
      status: response.status,
      responseText,
      retryAfterHeader: response.headers.get("retry-after")
    });

    if (shouldRetryChatCompletion(failure, attemptCount)) {
      await waitForMilliseconds((failure.retryAfterSeconds + 1) * 1000);
      continue;
    }

    throw new Error(formatChatCompletionFailure(failure));
  }

  throw new Error("Chat completion failed after retrying.");
}

function waitForMilliseconds(delayMilliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMilliseconds);
  });
}

function buildWorkerRequestHeaders(baseHeaders = {}) {
  const headers = new Headers(baseHeaders);
  const authHeaderName = String(currentConfig?.workerAuthHeaderName || "").trim();
  const authHeaderValue = String(currentConfig?.workerAuthHeaderValue || "").trim();

  if (authHeaderName && authHeaderValue) {
    try {
      headers.set(authHeaderName, authHeaderValue);
    } catch {
      throw new Error("Saved Worker auth header is invalid. Update Settings and save again.");
    }
  }

  return headers;
}

function createTrayIconDataUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#86f7ff" />
          <stop offset="100%" stop-color="#2ca4ff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="#07101a" />
      <path d="M30 10 L14 48 L33 39 L41 54 L50 49 L42 34 L58 26 Z" fill="url(#gradient)" />
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
