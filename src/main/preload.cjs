const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const wrappedListener = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrappedListener);
  return () => ipcRenderer.removeListener(channel, wrappedListener);
}

contextBridge.exposeInMainWorld("clicky", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (partialConfig) => ipcRenderer.invoke("config:save", partialConfig),
  getPersistentMemory: () => ipcRenderer.invoke("memory:get"),
  savePersistentProfile: (partialProfile) => ipcRenderer.invoke("memory:save-profile", partialProfile),
  recordVisualMoment: (payload) => ipcRenderer.invoke("memory:record-visual-moment", payload),
  resetPersistentProfile: () => ipcRenderer.invoke("memory:reset-profile"),
  clearRecentAppContexts: () => ipcRenderer.invoke("memory:clear-app-contexts"),
  clearVisualHistory: () => ipcRenderer.invoke("memory:clear-visual-history"),
  deleteVisualMomentById: (visualMomentId) => ipcRenderer.invoke("memory:delete-visual-moment", visualMomentId),
  clearAllPersistentMemory: () => ipcRenderer.invoke("memory:clear-all"),
  getCurrentAppContext: () => ipcRenderer.invoke("context:get-current"),
  runAgentTool: (payload) => ipcRenderer.invoke("agent:run-tool", payload),
  submitAgentApprovalDecision: (payload) => ipcRenderer.invoke("agent:approval-response", payload),
  onAgentApprovalRequested: (listener) => subscribe("agent:approval-requested", listener),
  showBalloonNotification: (payload) => ipcRenderer.invoke("notifications:show-balloon", payload),
  captureScreens: (options) => ipcRenderer.invoke("screens:capture", options),
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  getTranscribeToken: (workerBaseUrl) => ipcRenderer.invoke("network:get-transcribe-token", workerBaseUrl),
  fetchTTSAudio: (payload) => ipcRenderer.invoke("network:tts", payload),
  completeChat: (payload) => ipcRenderer.invoke("network:chat-complete", payload),
  startChatStream: (payload) => ipcRenderer.send("network:chat-start", payload),
  abortChatStream: (requestId) => ipcRenderer.send("network:chat-abort", requestId),
  onChatEvent: (listener) => subscribe("network:chat-event", listener),
  setOverlayState: (payload) => ipcRenderer.invoke("overlay:set-state", payload),
  showOverlayPoint: (payload) => ipcRenderer.invoke("overlay:show-point", payload),
  clearOverlayPoint: () => ipcRenderer.invoke("overlay:clear-point"),
  hideOverlay: () => ipcRenderer.invoke("overlay:hide"),
  onPushToTalkStart: (listener) => subscribe("ptt:start", listener),
  onPushToTalkStop: (listener) => subscribe("ptt:stop", listener),
  onShortcutMode: (listener) => subscribe("ptt:shortcut-mode", listener),
  onAppContextChanged: (listener) => subscribe("context:changed", listener),
  onOverlayCursor: (listener) => subscribe("overlay:cursor", listener),
  onOverlayState: (listener) => subscribe("overlay:state", listener)
});
