import test from "node:test";
import assert from "node:assert/strict";

import { AssemblyAIStreamingSession } from "../src/panel/assemblyAiStreamingSession.js";

test("handleWebSocketMessage preserves the last non-empty transcript when a blank end-of-turn arrives", async () => {
  const transcriptUpdates = [];
  const transcriptionSession = new AssemblyAIStreamingSession({
    workerBaseUrl: "https://example.com",
    onTranscriptUpdate: (transcript) => {
      transcriptUpdates.push(transcript);
    }
  });

  const finalTranscriptPromise = new Promise((resolve) => {
    transcriptionSession.pendingFinalTranscriptResolver = resolve;
  });
  transcriptionSession.pendingFinalTranscriptTimeout = globalThis.setTimeout(() => {}, 1000);

  transcriptionSession.handleWebSocketMessage(
    JSON.stringify({
      type: "Turn",
      transcript: "can you hear me"
    })
  );
  transcriptionSession.handleWebSocketMessage(
    JSON.stringify({
      type: "Turn",
      transcript: "",
      end_of_turn: true
    })
  );

  const finalTranscript = await finalTranscriptPromise;

  assert.equal(finalTranscript, "can you hear me");
  assert.deepEqual(transcriptUpdates, ["can you hear me"]);
  assert.equal(transcriptionSession.getResolvedTranscriptText(), "can you hear me");
});

test("getResolvedTranscriptText falls back to the latest trimmed transcript when needed", () => {
  const transcriptionSession = new AssemblyAIStreamingSession({
    workerBaseUrl: "https://example.com",
    onTranscriptUpdate: () => {}
  });

  transcriptionSession.latestTranscriptText = "final answer";
  transcriptionSession.latestNonEmptyTranscriptText = "";

  assert.equal(transcriptionSession.getResolvedTranscriptText(), "final answer");
});
