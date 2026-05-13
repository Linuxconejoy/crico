import test from "node:test";
import assert from "node:assert/strict";

import {
  formatChatCompletionFailure,
  parseChatCompletionFailure,
  shouldRetryChatCompletion
} from "../src/shared/chatCompletionErrors.js";

test("parseChatCompletionFailure extracts upstream rate-limit metadata from worker json", () => {
  const failure = parseChatCompletionFailure({
    status: 503,
    retryAfterHeader: "14",
    responseText: JSON.stringify({
      ok: false,
      error: {
        code: "UPSTREAM_RATE_LIMITED",
        message: "Anthropic request failed",
        details: {
          provider: "Anthropic",
          upstreamRetryAfterSeconds: 14
        }
      }
    })
  });

  assert.equal(failure.status, 503);
  assert.equal(failure.code, "UPSTREAM_RATE_LIMITED");
  assert.equal(failure.provider, "Anthropic");
  assert.equal(failure.retryAfterSeconds, 14);
});

test("shouldRetryChatCompletion only retries short upstream rate limits", () => {
  assert.equal(shouldRetryChatCompletion({
    code: "UPSTREAM_RATE_LIMITED",
    retryAfterSeconds: 14
  }, 0), true);
  assert.equal(shouldRetryChatCompletion({
    code: "UPSTREAM_RATE_LIMITED",
    retryAfterSeconds: 25
  }, 0), false);
  assert.equal(shouldRetryChatCompletion({
    code: "UPSTREAM_ERROR",
    retryAfterSeconds: 14
  }, 0), false);
});

test("formatChatCompletionFailure returns a compact actionable rate-limit message", () => {
  const message = formatChatCompletionFailure({
    status: 503,
    code: "UPSTREAM_RATE_LIMITED",
    provider: "Anthropic",
    retryAfterSeconds: 14
  });

  assert.match(message, /Anthropic rate limited this request/);
  assert.match(message, /Retry after 14s/);
});
