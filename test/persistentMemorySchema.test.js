import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultPersistentMemory,
  getProfileCategories,
  mergePersistentProfileUpdate,
  normalizePersistentProfile
} from "../src/shared/persistentMemorySchema.js";

test("buildDefaultPersistentMemory returns the categorized v2 shape", () => {
  const persistentMemory = buildDefaultPersistentMemory({ preferredLanguage: "es" });

  assert.equal(persistentMemory.version, 2);
  assert.equal(persistentMemory.profile.preferredLanguage, "es");
  assert.deepEqual(persistentMemory.profile.categories, {
    activeProjects: [],
    pendingIssues: [],
    decisionsMade: []
  });
});

test("normalizePersistentProfile migrates legacy flat memory fields into categorized memory", () => {
  const normalizedProfile = normalizePersistentProfile({
    preferredLanguage: "en",
    activeProjects: ["Clicky"],
    workPatterns: ["pairing", "short answers"],
    accumulatedContext: "The user prefers pragmatic implementation notes."
  });

  assert.deepEqual(normalizedProfile.categories.activeProjects, ["Clicky"]);
  assert.deepEqual(normalizedProfile.categories.pendingIssues, []);
  assert.deepEqual(normalizedProfile.categories.decisionsMade, [
    "Legacy work pattern: pairing",
    "Legacy work pattern: short answers",
    "Legacy context: The user prefers pragmatic implementation notes."
  ]);
});

test("getProfileCategories works with either a profile object or a persistent memory wrapper", () => {
  const categoriesFromProfile = getProfileCategories({
    categories: {
      activeProjects: ["Clicky"],
      pendingIssues: ["Review agent tool scope"],
      decisionsMade: ["Store memory by category"]
    }
  });
  const categoriesFromPersistentMemory = getProfileCategories({
    profile: {
      categories: {
        activeProjects: ["Clicky"],
        pendingIssues: ["Review agent tool scope"],
        decisionsMade: ["Store memory by category"]
      }
    }
  });

  assert.deepEqual(categoriesFromProfile, categoriesFromPersistentMemory);
});

test("mergePersistentProfileUpdate only replaces the categories provided in the patch", () => {
  const mergedProfile = mergePersistentProfileUpdate(
    {
      preferredLanguage: "en",
      categories: {
        activeProjects: ["Clicky"],
        pendingIssues: ["Wire npm approval flow"],
        decisionsMade: ["Use D:\\Developer as the root"]
      }
    },
    {
      preferredLanguage: "es",
      pendingIssues: ["Verify passive watcher timing"]
    }
  );

  assert.equal(mergedProfile.preferredLanguage, "es");
  assert.deepEqual(mergedProfile.categories.activeProjects, ["Clicky"]);
  assert.deepEqual(mergedProfile.categories.pendingIssues, ["Verify passive watcher timing"]);
  assert.deepEqual(mergedProfile.categories.decisionsMade, ["Use D:\\Developer as the root"]);
});
