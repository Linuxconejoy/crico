export function parseChatCompletionFailure({ status, responseText, retryAfterHeader }) {
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(String(responseText || ""));
  } catch {
    parsedBody = null;
  }

  const errorPayload = isJsonObject(parsedBody) && isJsonObject(parsedBody.error)
    ? parsedBody.error
    : null;
  const details = errorPayload && isJsonObject(errorPayload.details)
    ? errorPayload.details
    : null;
  const retryAfterSeconds = normalizeRetryAfterSeconds(
    details?.upstreamRetryAfterSeconds,
    retryAfterHeader
  );

  return {
    status: Number(status) || 0,
    code: typeof errorPayload?.code === "string" ? errorPayload.code : "",
    message: typeof errorPayload?.message === "string" ? errorPayload.message : "",
    provider: typeof details?.provider === "string" ? details.provider : "",
    retryAfterSeconds,
    rawResponseText: String(responseText || "").trim()
  };
}

export function shouldRetryChatCompletion(failure, attemptCount, maxRetries = 1) {
  return failure?.code === "UPSTREAM_RATE_LIMITED" &&
    attemptCount < maxRetries &&
    Number.isInteger(failure?.retryAfterSeconds) &&
    failure.retryAfterSeconds > 0 &&
    failure.retryAfterSeconds <= 20;
}

export function formatChatCompletionFailure(failure) {
  if (failure?.code === "UPSTREAM_RATE_LIMITED") {
    const providerLabel = failure.provider || "Upstream model";
    const retryAfterSuffix = Number.isInteger(failure.retryAfterSeconds)
      ? ` Retry after ${failure.retryAfterSeconds}s.`
      : "";
    return `${providerLabel} rate limited this request.${retryAfterSuffix} Reduce screenshots or prompt history, or wait and try again.`;
  }

  if (failure?.message) {
    return `Chat completion failed (${failure.status}): ${failure.message}`;
  }

  return `Chat completion failed (${failure?.status || 0}): ${failure?.rawResponseText || "Unknown error."}`;
}

function normalizeRetryAfterSeconds(...values) {
  for (const value of values) {
    const parsedValue = Number.parseInt(String(value ?? "").trim(), 10);
    if (Number.isInteger(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }
  }

  return null;
}

function isJsonObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
