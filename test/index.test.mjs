import assert from "node:assert/strict";
import test from "node:test";

const { default: worker } = await import("../src/index.ts");

const baseEnv = {
  ANTHROPIC_API_KEY: "anthropic-test-key",
  ELEVENLABS_API_KEY: "elevenlabs-test-key",
  ELEVENLABS_VOICE_ID: "voice-test-id",
  ASSEMBLYAI_API_KEY: "assemblyai-test-key",
  WORKER_ENVIRONMENT: "test",
  WORKER_VERSION: "1.2.3-test",
  RATE_LIMIT_WINDOW_SECONDS: "60",
  RATE_LIMIT_MAX_REQUESTS: "10",
};

function createEnv(overrides = {}) {
  return {
    ...baseEnv,
    ...overrides,
  };
}

function createHealthRequest({
  requestId,
  correlationId,
  cfRay,
  clientIp = "203.0.113.10",
} = {}) {
  const headers = new Headers({
    "cf-connecting-ip": clientIp,
  });

  if (requestId) {
    headers.set("x-request-id", requestId);
  }

  if (correlationId) {
    headers.set("x-correlation-id", correlationId);
  }

  if (cfRay) {
    headers.set("cf-ray", cfRay);
  }

  return new Request("https://example.com/health", {
    method: "GET",
    headers,
  });
}

function createJsonRequest(pathname, { headers = {}, body } = {}) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }
  if (!requestHeaders.has("cf-connecting-ip")) {
    requestHeaders.set("cf-connecting-ip", "203.0.113.50");
  }

  return new Request(`https://example.com${pathname}`, {
    method: "POST",
    headers: requestHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

async function withMockedFetch(mockFetch, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withMutedConsole(callback) {
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = () => {};
  console.error = () => {};

  try {
    return await callback();
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
}

test("GET /health returns observability headers and preserves a valid request id", async () => {
  const requestId = "request-12345678";
  const response = await worker.fetch(
    createHealthRequest({
      requestId,
      clientIp: "203.0.113.11",
    }),
    createEnv({
      CLICKY_APP_KEY: "shared-app-key",
    })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), requestId);
  assert.equal(response.headers.get("x-correlation-id"), requestId);
  assert.equal(response.headers.get("x-clicky-route"), "/health");
  assert.equal(response.headers.get("x-clicky-service"), "clicky-proxy-worker");
  assert.equal(response.headers.get("x-clicky-auth-required"), "true");
  assert.equal(response.headers.get("x-clicky-auth-status"), "bypassed");
  assert.equal(response.headers.get("x-clicky-worker-environment"), "test");
  assert.equal(response.headers.get("x-clicky-worker-version"), "1.2.3-test");
  assert.match(response.headers.get("server-timing") ?? "", /^app;dur=\d+$/);
  assert.equal(response.headers.get("ratelimit-limit"), "10");
  assert.equal(response.headers.get("ratelimit-remaining"), "9");
  assert.equal(response.headers.get("ratelimit-policy"), "10;w=60");

  const body = await readJson(response);
  assert.equal(body.ok, true);
  assert.equal(body.requestId, requestId);
  assert.equal(body.auth.required, true);
  assert.equal(body.environment.name, "test");
  assert.equal(body.environment.version, "1.2.3-test");
  assert.ok(body.observability.responseHeaders.includes("x-request-id"));
  assert.ok(body.observability.responseHeaders.includes("ratelimit-policy"));
});

test("request id falls back from an invalid x-request-id to x-correlation-id", async () => {
  const correlationId = "correlation-12345678";
  const response = await worker.fetch(
    createHealthRequest({
      requestId: "short",
      correlationId,
      clientIp: "203.0.113.12",
    }),
    createEnv()
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), correlationId);
  assert.equal(response.headers.get("x-correlation-id"), correlationId);

  const body = await readJson(response);
  assert.equal(body.requestId, correlationId);
});

test("protected routes reject missing app keys and expose auth metadata", async () => {
  const response = await withMutedConsole(() =>
    worker.fetch(
      createJsonRequest("/chat", {
        headers: {
          "cf-connecting-ip": "203.0.113.13",
          "x-request-id": "auth-test-12345678",
        },
        body: {
          model: "claude-3-7-sonnet",
          messages: [{ role: "user", content: "hola" }],
        },
      }),
      createEnv({
        CLICKY_APP_KEY: "shared-app-key",
      })
    )
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-clicky-auth-required"), "true");
  assert.equal(response.headers.get("x-clicky-auth-status"), "missing");
  assert.equal(response.headers.get("x-request-id"), "auth-test-12345678");

  const body = await readJson(response);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.equal(body.error.details.authHeader, "x-clicky-app-key");
  assert.equal(body.error.details.reason, "missing_header");
});

test("rate limiting returns standard headers and a retry-after when exhausted", async () => {
  const env = createEnv({
    RATE_LIMIT_MAX_REQUESTS: "1",
    RATE_LIMIT_WINDOW_SECONDS: "60",
  });
  const clientIp = "203.0.113.14";

  const firstResponse = await worker.fetch(createHealthRequest({ clientIp }), env);
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers.get("ratelimit-limit"), "1");
  assert.equal(firstResponse.headers.get("ratelimit-remaining"), "0");
  assert.equal(firstResponse.headers.get("ratelimit-policy"), "1;w=60");

  const secondResponse = await withMutedConsole(() => worker.fetch(createHealthRequest({ clientIp }), env));
  assert.equal(secondResponse.status, 429);
  assert.equal(secondResponse.headers.get("ratelimit-limit"), "1");
  assert.equal(secondResponse.headers.get("ratelimit-remaining"), "0");
  assert.equal(secondResponse.headers.get("ratelimit-policy"), "1;w=60");
  assert.match(secondResponse.headers.get("retry-after") ?? "", /^\d+$/);

  const body = await readJson(secondResponse);
  assert.equal(body.error.code, "RATE_LIMITED");
  assert.equal(body.error.details.route, "/health");
  assert.equal(body.error.details.rateLimit.limit, 1);
  assert.equal(body.error.details.rateLimit.strategy, "per-route-per-client-ip");
});

test("parsing errors distinguish unsupported media types from malformed JSON", async (t) => {
  await t.test("rejects non-JSON content types", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/chat", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          "cf-connecting-ip": "203.0.113.15",
        },
        body: "plain-text-body",
      }),
      createEnv()
    );

    assert.equal(response.status, 415);
    const body = await readJson(response);
    assert.equal(body.error.code, "UNSUPPORTED_MEDIA_TYPE");
    assert.equal(body.error.details.expected, "application/json");
    assert.equal(body.error.details.received, "text/plain");
  });

  await t.test("rejects malformed JSON bodies", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.16",
        },
        body: "{\"model\": ",
      }),
      createEnv()
    );

    assert.equal(response.status, 400);
    const body = await readJson(response);
    assert.equal(body.error.code, "INVALID_JSON");
    assert.equal(body.error.message, "Malformed JSON body");
  });
});

test("upstream failures preserve tracing headers and redact sensitive diagnostics", async () => {
  await withMutedConsole(() =>
    withMockedFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "rate limited upstream",
              authorization: "Bearer secret-upstream-token",
              nested: {
                apiKey: "plain-secret-key",
              },
            },
            token: "x".repeat(80),
            details: [
              {
                cookie: "session-id=123",
              },
            ],
          }),
          {
            status: 429,
            statusText: "Too Many Requests",
            headers: {
              "content-type": "application/json",
              "x-request-id": "upstream-12345678",
              "retry-after": "120",
            },
          }
        ),
      async () => {
        const response = await worker.fetch(
          createJsonRequest("/chat", {
            headers: {
              "cf-connecting-ip": "203.0.113.17",
              "x-clicky-app-key": "shared-app-key",
            },
            body: {
              model: "claude-3-7-sonnet",
              messages: [{ role: "user", content: "hola" }],
            },
          }),
          createEnv({
            CLICKY_APP_KEY: "shared-app-key",
          })
        );

        assert.equal(response.status, 503);
        assert.equal(response.headers.get("x-clicky-upstream-provider"), "anthropic");
        assert.equal(response.headers.get("x-clicky-upstream-request-id"), "upstream-12345678");
        assert.equal(response.headers.get("x-clicky-upstream-retry-after"), "120");
        assert.equal(response.headers.get("retry-after"), "120");

        const body = await readJson(response);
        assert.equal(body.error.code, "UPSTREAM_RATE_LIMITED");
        assert.equal(body.error.details.provider, "Anthropic");
        assert.equal(body.error.details.upstreamStatus, 429);
        assert.equal(body.error.details.upstreamRequestId, "upstream-12345678");
        assert.equal(body.error.details.upstreamRetryAfterSeconds, 120);
        assert.equal(body.error.details.upstreamBody.error.authorization, "[REDACTED]");
        assert.equal(body.error.details.upstreamBody.error.nested.apiKey, "[REDACTED]");
        assert.equal(body.error.details.upstreamBody.token, "[REDACTED]");
        assert.equal(body.error.details.upstreamBody.details[0].cookie, "[REDACTED]");
      }
    )
  );
});
