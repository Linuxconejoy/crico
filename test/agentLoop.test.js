import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAgentMessages,
  buildRetryContextInstruction,
  buildObservationUpdateContentBlocks,
  buildScreenCaptureContentBlocks,
  getAgentConversationHistory,
  shouldRefreshObservationAfterTool
} from "../src/panel/agentLoop.js";

const sampleCapture = {
  label: "screen 1",
  mediaType: "image/jpeg",
  imageBase64: "ZmFrZQ==",
  screenshotWidthInPixels: 1920,
  screenshotHeightInPixels: 1080,
  displayBounds: {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080
  }
};

test("buildScreenCaptureContentBlocks emits an image block and a geometry label for each capture", () => {
  const contentBlocks = buildScreenCaptureContentBlocks([sampleCapture]);

  assert.equal(contentBlocks.length, 2);
  assert.equal(contentBlocks[0].type, "image");
  assert.equal(contentBlocks[1].type, "text");
  assert.match(contentBlocks[1].text, /screen 1/);
  assert.match(contentBlocks[1].text, /1920x1080/);
  assert.match(contentBlocks[1].text, /display bounds: x=0, y=0, width=1920, height=1080/);
});

test("buildObservationUpdateContentBlocks prepends the refreshed app summary", () => {
  const contentBlocks = buildObservationUpdateContentBlocks({
    screenCaptures: [sampleCapture],
    appContext: {
      processName: "Photoshop.exe",
      windowTitle: "Shadow Study.psd",
      detectedMode: "design"
    },
    heading: "updated observation after control_mouse:"
  });

  assert.equal(contentBlocks[0].type, "text");
  assert.match(contentBlocks[0].text, /updated observation after control_mouse/i);
  assert.match(contentBlocks[0].text, /photoshop\.exe/i);
  assert.equal(contentBlocks[1].type, "image");
});

test("shouldRefreshObservationAfterTool only refreshes after successful state-changing tools", () => {
  assert.equal(shouldRefreshObservationAfterTool("control_mouse", { ok: true }), true);
  assert.equal(shouldRefreshObservationAfterTool("run_command", { ok: true }), true);
  assert.equal(shouldRefreshObservationAfterTool("read_file", { ok: true }), false);
  assert.equal(shouldRefreshObservationAfterTool("control_mouse", { ok: false }), false);
});

test("getAgentConversationHistory drops the most recent turn on explicit retry prompts", () => {
  const conversationHistory = [
    { userTranscript: "open burp", assistantResponse: "okay" },
    { userTranscript: "try repeater", assistantResponse: "enable rest api on port 1337" }
  ];

  const trimmedHistory = getAgentConversationHistory(conversationHistory, {
    isContinuationRequest: true
  });

  assert.equal(trimmedHistory.length, 1);
  assert.equal(trimmedHistory[0].userTranscript, "open burp");
});

test("buildRetryContextInstruction tells the agent to distrust unverified burp api assumptions", () => {
  const instruction = buildRetryContextInstruction({
    userPrompt: "try again",
    previousUserPrompt: "help me fix burp repeater and do it yourself",
    systemControlPolicy: {
      isContinuationRequest: true
    }
  });

  assert.match(instruction, /try again/i);
  assert.match(instruction, /burp rest api/i);
  assert.match(instruction, /re-verified right now/i);
});

test("buildAgentMessages injects retry context into the current observation block", () => {
  const messages = buildAgentMessages({
    userPrompt: "try again",
    previousUserPrompt: "help me fix burp repeater and do it yourself",
    screenCaptures: [sampleCapture],
    conversationHistory: [
      { userTranscript: "help me fix burp repeater and do it yourself", assistantResponse: "enable rest api" }
    ],
    persistentMemory: {
      profile: {
        preferredLanguage: "en"
      }
    },
    appContext: {
      processName: "BurpSuite",
      windowTitle: "Repeater",
      detectedMode: "security"
    },
    systemControlPolicy: {
      isContinuationRequest: true
    }
  });

  const latestUserMessage = messages[messages.length - 1];
  const latestTextBlock = latestUserMessage.content
    .filter((contentBlock) => contentBlock.type === "text")
    .at(-1);

  assert.match(latestTextBlock.text, /retry context:/i);
  assert.match(latestTextBlock.text, /do not invent hidden prerequisites/i);
});
