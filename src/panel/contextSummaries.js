import { getProfileCategories, getPreferredLanguage } from "../shared/persistentMemorySchema.js";

export function buildAppContextSummary(appContext) {
  if (!appContext) {
    return "Focused app: unavailable.";
  }

  const summaryLines = [
    `Focused app: ${appContext.processName || "unknown"}`,
    `Detected mode: ${appContext.detectedMode || "general"}`,
    `Window title: ${appContext.windowTitle || "unknown"}`,
    `Behavior hint: ${appContext.behaviorHint || "Adapt to the current app."}`
  ];

  if (appContext.runtimeEnvironment) {
    summaryLines.splice(3, 0, `Runtime environment: ${appContext.runtimeEnvironment}`);
  }

  if (appContext.projectHint) {
    summaryLines.push(`Project hint: ${appContext.projectHint}`);
  }

  return summaryLines.join("\n");
}

export function buildPersistentMemorySummary(persistentMemory) {
  if (!persistentMemory) {
    return "No stored memory yet.";
  }

  const profileCategories = getProfileCategories(persistentMemory);
  const summaryLines = [
    `Preferred language: ${getPreferredLanguage(persistentMemory, "unknown")}`
  ];

  if (profileCategories.activeProjects.length) {
    summaryLines.push(`Active projects: ${profileCategories.activeProjects.join(", ")}`);
  }

  if (profileCategories.pendingIssues.length) {
    summaryLines.push(`Pending issues: ${profileCategories.pendingIssues.join(", ")}`);
  }

  if (profileCategories.decisionsMade.length) {
    summaryLines.push(`Decisions made: ${profileCategories.decisionsMade.join(" | ")}`);
  }

  if (persistentMemory.recentAppContexts?.length) {
    const recentContexts = persistentMemory.recentAppContexts
      .slice(0, 4)
      .map((appContext) => `${appContext.detectedMode} in ${appContext.processName}${appContext.projectHint ? ` (${appContext.projectHint})` : ""}`);
    summaryLines.push(`Recent app contexts: ${recentContexts.join(" | ")}`);
  }

  return summaryLines.join("\n");
}

export function buildRecentVisualHistorySummary(persistentMemory, limit = 5) {
  const visualHistoryEntries = persistentMemory?.visualHistory?.slice(0, limit) || [];
  if (visualHistoryEntries.length === 0) {
    return "No visual history saved yet.";
  }

  return visualHistoryEntries
    .map((visualMoment) => {
      const recordedDate = formatVisualMomentDate(visualMoment.recordedAt);
      const appLabel = visualMoment.appContext?.processName || visualMoment.appContext?.detectedMode || "app";
      return `${recordedDate} - ${appLabel} - ${visualMoment.summary || visualMoment.userPrompt || "session moment"}`;
    })
    .join("\n");
}

export function buildVisualMomentSummary({
  userPrompt,
  assistantResponse,
  appContext,
  source
}) {
  const summaryParts = [];

  if (source === "auto-trigger") {
    summaryParts.push("Proactive intervention");
  } else if (source === "voice-session") {
    summaryParts.push("Voice session");
  } else {
    summaryParts.push("Manual session");
  }

  if (appContext?.processName) {
    summaryParts.push(`in ${appContext.processName}`);
  }

  if (appContext?.projectHint) {
    summaryParts.push(`for ${appContext.projectHint}`);
  }

  if (userPrompt) {
    summaryParts.push(`prompt: ${truncateForSummary(userPrompt, 120)}`);
  }

  if (assistantResponse) {
    summaryParts.push(`result: ${truncateForSummary(assistantResponse, 140)}`);
  }

  return summaryParts.join(" | ");
}

export function buildContextAwareInstruction(appContext, isContextAwareModeEnabled) {
  if (!isContextAwareModeEnabled || !appContext?.behaviorHint) {
    return "";
  }

  return `
current working context:
${buildAppContextSummary(appContext)}

adapt your tone, advice, and priorities to this detected mode automatically.
  `.trim();
}

function formatVisualMomentDate(isoString) {
  if (!isoString) {
    return "recent";
  }

  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

function truncateForSummary(text, maxLength) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
  if (normalizedText.length <= maxLength) {
    return normalizedText;
  }

  return `${normalizedText.slice(0, maxLength)}...`;
}
