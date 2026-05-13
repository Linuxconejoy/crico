import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  buildDefaultPersistentMemory,
  getProfileCategories,
  mergePersistentProfileUpdate,
  normalizePersistentProfile
} from "../shared/persistentMemorySchema.js";

const maxStoredVisualMoments = 40;
const maxStoredAppContexts = 30;
const dayInMilliseconds = 24 * 60 * 60 * 1000;

function getMemoryFilePath() {
  return path.join(app.getPath("userData"), "clicky-windows-memory.json");
}

function getVisualHistoryDirectoryPath() {
  return path.join(app.getPath("userData"), "visual-history");
}

export function loadPersistentMemory() {
  const memoryFilePath = getMemoryFilePath();
  const defaultPersistentMemory = createDefaultPersistentMemory();

  try {
    if (!fs.existsSync(memoryFilePath)) {
      return defaultPersistentMemory;
    }

    const rawMemory = fs.readFileSync(memoryFilePath, "utf8");
    const parsedMemory = JSON.parse(rawMemory);
    return sanitizePersistentMemory({
      ...defaultPersistentMemory,
      ...parsedMemory,
      profile: {
        ...defaultPersistentMemory.profile,
        ...(parsedMemory?.profile || {}),
        categories: {
          ...defaultPersistentMemory.profile.categories,
          ...(parsedMemory?.profile?.categories || {})
        }
      },
      session: {
        ...defaultPersistentMemory.session,
        ...(parsedMemory?.session || {})
      }
    });
  } catch (error) {
    console.warn("Failed to load Clicky Windows persistent memory:", error);
    return defaultPersistentMemory;
  }
}

export function markSessionStarted() {
  return updatePersistentMemory((persistentMemory) => {
    const nextLaunchCount = Number(persistentMemory.session.launchCount || 0) + 1;
    persistentMemory.session = {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      launchCount: nextLaunchCount
    };
    return persistentMemory;
  });
}

export function prunePersistentMemory({ visualHistoryRetentionDays } = {}) {
  const retentionDays = Number.parseInt(visualHistoryRetentionDays, 10);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return loadPersistentMemory();
  }

  return updatePersistentMemory((persistentMemory) => {
    const cutoffTimestamp = Date.now() - (retentionDays * dayInMilliseconds);
    const keptVisualHistory = [];
    const removedVisualHistory = [];

    for (const visualMoment of persistentMemory.visualHistory) {
      const recordedTimestamp = Date.parse(visualMoment?.recordedAt || "");
      const shouldKeep = !Number.isFinite(recordedTimestamp) || recordedTimestamp >= cutoffTimestamp;

      if (shouldKeep) {
        keptVisualHistory.push(visualMoment);
      } else {
        removedVisualHistory.push(visualMoment);
      }
    }

    persistentMemory.visualHistory = keptVisualHistory;
    for (const removedVisualMoment of removedVisualHistory) {
      deleteFilesIfPresent(removedVisualMoment.screenshotPaths || []);
    }

    return persistentMemory;
  });
}

export function patchPersistentProfile(partialProfile) {
  return updatePersistentMemory((persistentMemory) => {
    persistentMemory.profile = mergePersistentProfileUpdate(persistentMemory.profile, partialProfile);
    return persistentMemory;
  });
}

export function recordAppContextSnapshot(appContext) {
  if (!appContext?.processName && !appContext?.windowTitle) {
    return loadPersistentMemory();
  }

  return updatePersistentMemory((persistentMemory) => {
    const normalizedSnapshot = {
      capturedAt: new Date().toISOString(),
      detectedMode: appContext.detectedMode || "general",
      processName: appContext.processName || "",
      windowTitle: appContext.windowTitle || "",
      projectHint: appContext.projectHint || ""
    };

    const latestSnapshot = persistentMemory.recentAppContexts[0];
    if (
      latestSnapshot &&
      latestSnapshot.detectedMode === normalizedSnapshot.detectedMode &&
      latestSnapshot.processName === normalizedSnapshot.processName &&
      latestSnapshot.windowTitle === normalizedSnapshot.windowTitle
    ) {
      return persistentMemory;
    }

    persistentMemory.recentAppContexts = [
      normalizedSnapshot,
      ...persistentMemory.recentAppContexts
    ].slice(0, maxStoredAppContexts);

    if (normalizedSnapshot.projectHint) {
      const currentCategories = getProfileCategories(persistentMemory.profile);
      persistentMemory.profile = {
        ...normalizePersistentProfile(persistentMemory.profile),
        categories: {
          ...currentCategories,
          activeProjects: dedupeStrings([
            normalizedSnapshot.projectHint,
            ...currentCategories.activeProjects
          ])
        }
      };
    }

    return persistentMemory;
  });
}

export function recordVisualMoment({
  summary,
  userPrompt,
  assistantResponse,
  appContext,
  source,
  screenCaptures
}) {
  return updatePersistentMemory((persistentMemory) => {
    const visualMomentId = crypto.randomUUID();
    const screenshotPaths = saveVisualMomentScreenshots(visualMomentId, screenCaptures || []);
    const nextVisualMoment = {
      id: visualMomentId,
      recordedAt: new Date().toISOString(),
      summary: (summary || "").trim(),
      userPrompt: (userPrompt || "").trim(),
      assistantResponse: (assistantResponse || "").trim(),
      source: source || "manual-session",
      appContext: {
        detectedMode: appContext?.detectedMode || "general",
        processName: appContext?.processName || "",
        windowTitle: appContext?.windowTitle || "",
        projectHint: appContext?.projectHint || ""
      },
      screenshotPaths
    };

    const removedEntries = persistentMemory.visualHistory.slice(maxStoredVisualMoments - 1);
    persistentMemory.visualHistory = [
      nextVisualMoment,
      ...persistentMemory.visualHistory
    ].slice(0, maxStoredVisualMoments);

    for (const removedEntry of removedEntries) {
      deleteFilesIfPresent(removedEntry.screenshotPaths || []);
    }

    return persistentMemory;
  });
}

export function resetPersistentProfile() {
  return updatePersistentMemory((persistentMemory) => {
    persistentMemory.profile = createDefaultPersistentMemory().profile;
    return persistentMemory;
  });
}

export function clearRecentAppContexts() {
  return updatePersistentMemory((persistentMemory) => {
    persistentMemory.recentAppContexts = [];
    return persistentMemory;
  });
}

export function clearVisualHistory() {
  return updatePersistentMemory((persistentMemory) => {
    const removedVisualHistory = [...persistentMemory.visualHistory];
    persistentMemory.visualHistory = [];

    for (const removedVisualMoment of removedVisualHistory) {
      deleteFilesIfPresent(removedVisualMoment.screenshotPaths || []);
    }

    return persistentMemory;
  });
}

export function deleteVisualMomentById(visualMomentId) {
  const normalizedVisualMomentId = String(visualMomentId || "").trim();
  if (!normalizedVisualMomentId) {
    return loadPersistentMemory();
  }

  return updatePersistentMemory((persistentMemory) => {
    const removedVisualMoments = [];
    persistentMemory.visualHistory = persistentMemory.visualHistory.filter((visualMoment) => {
      const shouldKeep = visualMoment?.id !== normalizedVisualMomentId;
      if (!shouldKeep) {
        removedVisualMoments.push(visualMoment);
      }
      return shouldKeep;
    });

    for (const removedVisualMoment of removedVisualMoments) {
      deleteFilesIfPresent(removedVisualMoment.screenshotPaths || []);
    }

    return persistentMemory;
  });
}

export function clearAllPersistentMemory() {
  return updatePersistentMemory((persistentMemory) => {
    const removedVisualHistory = [...persistentMemory.visualHistory];
    const defaultPersistentMemory = createDefaultPersistentMemory();

    persistentMemory.profile = defaultPersistentMemory.profile;
    persistentMemory.recentAppContexts = [];
    persistentMemory.visualHistory = [];

    for (const removedVisualMoment of removedVisualHistory) {
      deleteFilesIfPresent(removedVisualMoment.screenshotPaths || []);
    }

    return persistentMemory;
  });
}

export function updatePersistentMemory(mutator) {
  const currentPersistentMemory = loadPersistentMemory();
  const workingCopy = cloneData(currentPersistentMemory);
  const mutatedMemory = mutator(workingCopy) || workingCopy;
  const nextPersistentMemory = sanitizePersistentMemory(mutatedMemory);
  writePersistentMemoryToDisk(nextPersistentMemory);
  return cloneData(nextPersistentMemory);
}

function writePersistentMemoryToDisk(persistentMemory) {
  const memoryFilePath = getMemoryFilePath();
  fs.mkdirSync(path.dirname(memoryFilePath), { recursive: true });
  fs.writeFileSync(memoryFilePath, JSON.stringify(persistentMemory, null, 2), "utf8");
}

function sanitizePersistentMemory(persistentMemory) {
  const defaultPersistentMemory = createDefaultPersistentMemory();

  return {
    version: Math.max(
      defaultPersistentMemory.version,
      Number(persistentMemory?.version || 0) || 0
    ),
    profile: normalizePersistentProfile(
      persistentMemory?.profile,
      defaultPersistentMemory.profile.preferredLanguage
    ),
    session: {
      sessionId: String(persistentMemory?.session?.sessionId || ""),
      startedAt: String(persistentMemory?.session?.startedAt || ""),
      launchCount: Number(persistentMemory?.session?.launchCount || 0)
    },
    recentAppContexts: Array.isArray(persistentMemory?.recentAppContexts)
      ? persistentMemory.recentAppContexts
        .map((appContextSnapshot) => ({
          capturedAt: String(appContextSnapshot?.capturedAt || ""),
          detectedMode: String(appContextSnapshot?.detectedMode || "general"),
          processName: String(appContextSnapshot?.processName || ""),
          windowTitle: String(appContextSnapshot?.windowTitle || ""),
          projectHint: String(appContextSnapshot?.projectHint || "")
        }))
        .slice(0, maxStoredAppContexts)
      : [],
    visualHistory: Array.isArray(persistentMemory?.visualHistory)
      ? persistentMemory.visualHistory
        .map((visualMoment) => ({
          id: String(visualMoment?.id || crypto.randomUUID()),
          recordedAt: String(visualMoment?.recordedAt || ""),
          summary: String(visualMoment?.summary || "").trim(),
          userPrompt: String(visualMoment?.userPrompt || "").trim(),
          assistantResponse: String(visualMoment?.assistantResponse || "").trim(),
          source: String(visualMoment?.source || "manual-session"),
          appContext: {
            detectedMode: String(visualMoment?.appContext?.detectedMode || "general"),
            processName: String(visualMoment?.appContext?.processName || ""),
            windowTitle: String(visualMoment?.appContext?.windowTitle || ""),
            projectHint: String(visualMoment?.appContext?.projectHint || "")
          },
          screenshotPaths: Array.isArray(visualMoment?.screenshotPaths)
            ? visualMoment.screenshotPaths.filter((screenshotPath) => typeof screenshotPath === "string")
            : []
        }))
        .slice(0, maxStoredVisualMoments)
      : []
  };
}

function saveVisualMomentScreenshots(visualMomentId, screenCaptures) {
  if (!Array.isArray(screenCaptures) || screenCaptures.length === 0) {
    return [];
  }

  const screenshotDirectoryPath = path.join(getVisualHistoryDirectoryPath(), visualMomentId);
  fs.mkdirSync(screenshotDirectoryPath, { recursive: true });

  return screenCaptures.map((screenCapture, index) => {
    const screenshotPath = path.join(
      screenshotDirectoryPath,
      `screen-${String(index + 1).padStart(2, "0")}.jpg`
    );
    fs.writeFileSync(screenshotPath, Buffer.from(screenCapture.imageBase64, "base64"));
    return screenshotPath;
  });
}

function deleteFilesIfPresent(filePaths) {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn(`Failed to delete visual history file: ${filePath}`, error);
    }
  }

  for (const filePath of filePaths) {
    const directoryPath = path.dirname(filePath);
    try {
      if (fs.existsSync(directoryPath) && fs.readdirSync(directoryPath).length === 0) {
        fs.rmdirSync(directoryPath);
      }
    } catch (error) {
      console.warn(`Failed to clean up visual history directory: ${directoryPath}`, error);
    }
  }
}

function dedupeStrings(values) {
  const seenValues = new Set();
  const dedupedValues = [];

  for (const rawValue of values) {
    const normalizedValue = String(rawValue || "").trim();
    if (!normalizedValue) {
      continue;
    }

    const dedupeKey = normalizedValue.toLowerCase();
    if (seenValues.has(dedupeKey)) {
      continue;
    }

    seenValues.add(dedupeKey);
    dedupedValues.push(normalizedValue);
  }

  return dedupedValues;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultPersistentMemory() {
  return buildDefaultPersistentMemory({
    preferredLanguage: app.getLocale().split("-")[0] || "en"
  });
}
