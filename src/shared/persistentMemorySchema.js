const persistentMemoryVersion = 2;

export function buildDefaultPersistentMemory({ preferredLanguage = "en" } = {}) {
  return {
    version: persistentMemoryVersion,
    profile: buildDefaultPersistentProfile({ preferredLanguage }),
    session: {
      sessionId: "",
      startedAt: "",
      launchCount: 0
    },
    recentAppContexts: [],
    visualHistory: []
  };
}

export function buildDefaultPersistentProfile({ preferredLanguage = "en" } = {}) {
  return {
    preferredLanguage: normalizePreferredLanguage(preferredLanguage),
    categories: buildDefaultMemoryCategories()
  };
}

export function buildDefaultMemoryCategories() {
  return {
    activeProjects: [],
    pendingIssues: [],
    decisionsMade: []
  };
}

export function getPreferredLanguage(profileOrPersistentMemory, fallback = "en") {
  const rawProfile = extractProfile(profileOrPersistentMemory);
  return normalizePreferredLanguage(rawProfile.preferredLanguage || fallback);
}

export function getProfileCategories(profileOrPersistentMemory) {
  return normalizeProfileCategories(extractProfile(profileOrPersistentMemory));
}

export function normalizePersistentProfile(profileOrPersistentMemory, fallbackLanguage = "en") {
  const rawProfile = extractProfile(profileOrPersistentMemory);

  return {
    preferredLanguage: getPreferredLanguage(rawProfile, fallbackLanguage),
    categories: getProfileCategories(rawProfile)
  };
}

export function mergePersistentProfileUpdate(currentProfileOrPersistentMemory, partialProfile = {}) {
  const currentProfile = normalizePersistentProfile(currentProfileOrPersistentMemory);
  const rawCategoryPatch = isPlainObject(partialProfile.categories) ? partialProfile.categories : {};
  const nextCategories = {
    ...currentProfile.categories
  };

  if (rawCategoryPatch.activeProjects !== undefined || partialProfile.activeProjects !== undefined) {
    nextCategories.activeProjects = normalizeStringArray(
      rawCategoryPatch.activeProjects ?? partialProfile.activeProjects
    );
  }

  if (rawCategoryPatch.pendingIssues !== undefined || partialProfile.pendingIssues !== undefined) {
    nextCategories.pendingIssues = normalizeStringArray(
      rawCategoryPatch.pendingIssues ?? partialProfile.pendingIssues
    );
  }

  if (rawCategoryPatch.decisionsMade !== undefined || partialProfile.decisionsMade !== undefined) {
    nextCategories.decisionsMade = normalizeStringArray(
      rawCategoryPatch.decisionsMade ?? partialProfile.decisionsMade
    );
  }

  return {
    preferredLanguage: partialProfile.preferredLanguage !== undefined
      ? normalizePreferredLanguage(partialProfile.preferredLanguage) || currentProfile.preferredLanguage
      : currentProfile.preferredLanguage,
    categories: nextCategories
  };
}

export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return dedupeStrings(value);
  }

  if (typeof value === "string") {
    return dedupeStrings(
      value
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    );
  }

  return [];
}

export function dedupeStrings(values) {
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

function extractProfile(profileOrPersistentMemory) {
  if (isPlainObject(profileOrPersistentMemory?.profile)) {
    return profileOrPersistentMemory.profile;
  }

  return isPlainObject(profileOrPersistentMemory) ? profileOrPersistentMemory : {};
}

function normalizeProfileCategories(rawProfile) {
  const rawCategories = isPlainObject(rawProfile?.categories) ? rawProfile.categories : {};
  const decisionsMade = dedupeStrings([
    ...normalizeStringArray(rawCategories.decisionsMade ?? rawProfile?.decisionsMade),
    ...normalizeStringArray(rawProfile?.workPatterns).map((workPattern) => `Legacy work pattern: ${workPattern}`),
    ...buildLegacyDecisionNotes(rawProfile?.accumulatedContext)
  ]);

  return {
    activeProjects: normalizeStringArray(rawCategories.activeProjects ?? rawProfile?.activeProjects),
    pendingIssues: normalizeStringArray(rawCategories.pendingIssues ?? rawProfile?.pendingIssues),
    decisionsMade
  };
}

function buildLegacyDecisionNotes(accumulatedContext) {
  const normalizedContext = String(accumulatedContext || "").trim();
  if (!normalizedContext) {
    return [];
  }

  return [`Legacy context: ${normalizedContext}`];
}

function normalizePreferredLanguage(value) {
  return String(value || "").trim() || "en";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
