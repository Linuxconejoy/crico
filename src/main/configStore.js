import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { DEFAULT_MODEL, DEFAULT_WORKER_BASE_URL } from "../shared/systemPrompt.js";

const allowedScreenCaptureModes = new Set(["cursor-display", "all-displays"]);

const defaultConfig = {
  workerBaseUrl: DEFAULT_WORKER_BASE_URL,
  workerAuthHeaderName: "",
  workerAuthHeaderValue: "",
  selectedModel: DEFAULT_MODEL,
  screenCaptureMode: "cursor-display",
  visualHistoryRetentionDays: 14,
  showClickyWhenIdle: true,
  autoPlaySpeech: true,
  agentModeEnabled: false,
  permissiveDevModeEnabled: false,
  guidedWalkthroughEnabled: false,
  contextAwareModeEnabled: true,
  passiveVisualContextEnabled: false,
  visualHistoryEnabled: false,
  autoTriggersEnabled: false
};

function getConfigFilePath() {
  return path.join(app.getPath("userData"), "clicky-windows-config.json");
}

export function loadConfig() {
  const configFilePath = getConfigFilePath();

  try {
    if (!fs.existsSync(configFilePath)) {
      return { ...defaultConfig };
    }

    const rawConfig = fs.readFileSync(configFilePath, "utf8");
    const parsedConfig = JSON.parse(rawConfig);
    return sanitizeConfig({
      ...defaultConfig,
      ...parsedConfig
    });
  } catch (error) {
    console.warn("Failed to load Clicky Windows config:", error);
    return { ...defaultConfig };
  }
}

export function saveConfig(partialConfig) {
  const nextConfig = sanitizeConfig({
    ...loadConfig(),
    ...partialConfig
  });

  const configFilePath = getConfigFilePath();
  fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
  fs.writeFileSync(configFilePath, JSON.stringify(nextConfig, null, 2), "utf8");
  return nextConfig;
}

function sanitizeConfig(rawConfig) {
  const screenCaptureMode = allowedScreenCaptureModes.has(rawConfig?.screenCaptureMode)
    ? rawConfig.screenCaptureMode
    : defaultConfig.screenCaptureMode;
  const visualHistoryRetentionDays = clampPositiveInteger(
    rawConfig?.visualHistoryRetentionDays,
    defaultConfig.visualHistoryRetentionDays,
    1,
    90
  );

  return {
    workerBaseUrl: String(rawConfig?.workerBaseUrl || defaultConfig.workerBaseUrl).trim() || defaultConfig.workerBaseUrl,
    workerAuthHeaderName: String(rawConfig?.workerAuthHeaderName || "").trim(),
    workerAuthHeaderValue: String(rawConfig?.workerAuthHeaderValue || "").trim(),
    selectedModel: String(rawConfig?.selectedModel || defaultConfig.selectedModel).trim() || defaultConfig.selectedModel,
    screenCaptureMode,
    visualHistoryRetentionDays,
    showClickyWhenIdle: coerceBoolean(rawConfig?.showClickyWhenIdle, defaultConfig.showClickyWhenIdle),
    autoPlaySpeech: coerceBoolean(rawConfig?.autoPlaySpeech, defaultConfig.autoPlaySpeech),
    agentModeEnabled: coerceBoolean(rawConfig?.agentModeEnabled, defaultConfig.agentModeEnabled),
    permissiveDevModeEnabled: coerceBoolean(
      rawConfig?.permissiveDevModeEnabled,
      defaultConfig.permissiveDevModeEnabled
    ),
    guidedWalkthroughEnabled: coerceBoolean(
      rawConfig?.guidedWalkthroughEnabled,
      defaultConfig.guidedWalkthroughEnabled
    ),
    contextAwareModeEnabled: coerceBoolean(
      rawConfig?.contextAwareModeEnabled,
      defaultConfig.contextAwareModeEnabled
    ),
    passiveVisualContextEnabled: coerceBoolean(
      rawConfig?.passiveVisualContextEnabled,
      defaultConfig.passiveVisualContextEnabled
    ),
    visualHistoryEnabled: coerceBoolean(rawConfig?.visualHistoryEnabled, defaultConfig.visualHistoryEnabled),
    autoTriggersEnabled: coerceBoolean(rawConfig?.autoTriggersEnabled, defaultConfig.autoTriggersEnabled)
  };
}

function clampPositiveInteger(value, fallback, min, max) {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsedValue));
}

function coerceBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
