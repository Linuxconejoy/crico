import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAppContextSummary,
  buildContextAwareInstruction,
  buildPersistentMemorySummary,
  buildRecentVisualHistorySummary,
  buildVisualMomentSummary
} from "../src/panel/contextSummaries.js";

test("buildAppContextSummary returns a stable unavailable fallback", () => {
  assert.equal(buildAppContextSummary(null), "Focused app: unavailable.");
});

test("buildAppContextSummary includes defaults and project hints in a readable order", () => {
  assert.equal(
    buildAppContextSummary({
      processName: "Code.exe",
      detectedMode: "coding",
      windowTitle: "clicky-main",
      runtimeEnvironment: "windows-native",
      behaviorHint: "Focus on implementation details.",
      projectHint: "Clicky P1"
    }),
    [
      "Focused app: Code.exe",
      "Detected mode: coding",
      "Window title: clicky-main",
      "Runtime environment: windows-native",
      "Behavior hint: Focus on implementation details.",
      "Project hint: Clicky P1"
    ].join("\n")
  );
});

test("buildPersistentMemorySummary returns a safe empty-state message", () => {
  assert.equal(buildPersistentMemorySummary(undefined), "No stored memory yet.");
});

test("buildPersistentMemorySummary rolls profile data and only the latest four contexts into the summary", () => {
  const summary = buildPersistentMemorySummary({
    profile: {
      preferredLanguage: "es",
      categories: {
        activeProjects: ["Clicky", "Worker hardening"],
        pendingIssues: ["Fix tray race condition", "Review npm command approvals"],
        decisionsMade: ["Agent commands now require approval", "Use D:\\Developer as the shared workspace root"]
      }
    },
    recentAppContexts: [
      { detectedMode: "coding", processName: "Code.exe", projectHint: "Clicky" },
      { detectedMode: "debugging", processName: "WindowsTerminal.exe", projectHint: "" },
      { detectedMode: "research", processName: "Chrome.exe", projectHint: "Docs" },
      { detectedMode: "writing", processName: "Notion.exe", projectHint: "Spec" },
      { detectedMode: "planning", processName: "Miro.exe", projectHint: "Should be omitted" }
    ]
  });

  assert.match(summary, /Preferred language: es/);
  assert.match(summary, /Active projects: Clicky, Worker hardening/);
  assert.match(summary, /Pending issues: Fix tray race condition, Review npm command approvals/);
  assert.match(summary, /Decisions made: Agent commands now require approval \| Use D:\\Developer as the shared workspace root/);
  assert.match(
    summary,
    /Recent app contexts: coding in Code\.exe \(Clicky\) \| debugging in WindowsTerminal\.exe \| research in Chrome\.exe \(Docs\) \| writing in Notion\.exe \(Spec\)/
  );
  assert.doesNotMatch(summary, /Should be omitted/);
});

test("buildRecentVisualHistorySummary uses a deterministic recent fallback and respects limits", () => {
  const summary = buildRecentVisualHistorySummary(
    {
      visualHistory: [
        {
          appContext: { processName: "Code.exe" },
          summary: "Reviewed the agent loop"
        },
        {
          appContext: { detectedMode: "research" },
          userPrompt: "look at these docs"
        },
        {
          appContext: {},
          summary: ""
        }
      ]
    },
    2
  );

  assert.equal(
    summary,
    [
      "recent - Code.exe - Reviewed the agent loop",
      "recent - research - look at these docs"
    ].join("\n")
  );
});

test("buildRecentVisualHistorySummary returns a friendly empty-state string", () => {
  assert.equal(buildRecentVisualHistorySummary({}, 3), "No visual history saved yet.");
});

test("buildVisualMomentSummary labels the source and truncates long prompt and response text", () => {
  const longPrompt = "a".repeat(130);
  const longResponse = "b".repeat(150);

  const summary = buildVisualMomentSummary({
    userPrompt: longPrompt,
    assistantResponse: longResponse,
    appContext: {
      processName: "Code.exe",
      projectHint: "Clicky"
    },
    source: "auto-trigger"
  });

  assert.match(summary, /^Proactive intervention \| in Code\.exe \| for Clicky \| prompt: a{120}\.\.\. \| result: b{140}\.\.\.$/);
  assert.doesNotMatch(summary, /a{121}/);
  assert.doesNotMatch(summary, /b{141}/);
});

test("buildContextAwareInstruction is empty when disabled or when there is no behavior hint", () => {
  assert.equal(buildContextAwareInstruction({ behaviorHint: "Focus." }, false), "");
  assert.equal(buildContextAwareInstruction({ processName: "Code.exe" }, true), "");
});

test("buildContextAwareInstruction embeds the focused app summary when enabled", () => {
  const instruction = buildContextAwareInstruction(
    {
      processName: "Code.exe",
      detectedMode: "coding",
      windowTitle: "clicky-main",
      behaviorHint: "Focus on implementation details."
    },
    true
  );

  assert.match(instruction, /^current working context:/);
  assert.match(instruction, /Focused app: Code\.exe/);
  assert.match(instruction, /Detected mode: coding/);
  assert.match(instruction, /Behavior hint: Focus on implementation details\./);
  assert.match(instruction, /adapt your tone, advice, and priorities to this detected mode automatically\./);
});
