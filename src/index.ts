/**
 * Clicky Proxy Worker
 *
 * Proxies requests to Claude, ElevenLabs and AssemblyAI so the desktop apps
 * never ship raw provider API keys. The worker can optionally enforce a shared
 * application key via the `CLICKY_APP_KEY` secret that clients send in the
 * `x-clicky-app-key` header.
 */

interface Env {
  ANTHROPIC_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  ASSEMBLYAI_API_KEY: string;
  CLICKY_APP_KEY?: string;
  CHAT_MAX_BODY_BYTES?: string;
  TTS_MAX_BODY_BYTES?: string;
  TRANSCRIBE_TOKEN_MAX_BODY_BYTES?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  WORKER_ENVIRONMENT?: string;
  WORKER_VERSION?: string;
}

type JsonObject = Record<string, unknown>;
type RoutePath = "/chat" | "/tts" | "/transcribe-token" | "/health";
type AuthStatus = "pending" | "validated" | "not-required" | "bypassed";
type ClientIdentifierSource = "cf-connecting-ip" | "x-forwarded-for" | "unavailable";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RouteDefinition {
  path: RoutePath;
  methods: readonly string[];
}

interface ClientIdentifier {
  value: string;
  source: ClientIdentifierSource;
}

interface RateLimitState {
  limit: number;
  remaining: number;
  resetAt: number;
  windowSeconds: number;
  policy: string;
  clientIdSource: ClientIdentifierSource;
}

interface RequestContext {
  requestId: string;
  routePath: string;
  startedAt: number;
  authRequired: boolean;
  authStatus: AuthStatus;
  workerEnvironment: string;
  workerVersion: string;
  rateLimit: RateLimitState | null;
}

const SERVICE_NAME = "clicky-proxy-worker";
const COMPATIBILITY_DATE = "2024-01-01";
const APP_KEY_HEADER = "x-clicky-app-key";
const REQUEST_ID_HEADER = "x-request-id";
const CORRELATION_ID_HEADER = "x-correlation-id";
const ROUTE_HEADER = "x-clicky-route";
const SERVICE_HEADER = "x-clicky-service";
const AUTH_REQUIRED_HEADER = "x-clicky-auth-required";
const AUTH_STATUS_HEADER = "x-clicky-auth-status";
const WORKER_ENV_HEADER = "x-clicky-worker-environment";
const WORKER_VERSION_HEADER = "x-clicky-worker-version";
const UPSTREAM_PROVIDER_HEADER = "x-clicky-upstream-provider";
const UPSTREAM_REQUEST_ID_HEADER = "x-clicky-upstream-request-id";
const UPSTREAM_RETRY_AFTER_HEADER = "x-clicky-upstream-retry-after";
const RATE_LIMIT_LIMIT_HEADER = "ratelimit-limit";
const RATE_LIMIT_REMAINING_HEADER = "ratelimit-remaining";
const RATE_LIMIT_RESET_HEADER = "ratelimit-reset";
const RATE_LIMIT_POLICY_HEADER = "ratelimit-policy";
const JSON_CONTENT_TYPE = "application/json";
const DEFAULT_CHAT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_TTS_MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_TRANSCRIBE_TOKEN_MAX_BODY_BYTES = 1024;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_MAX_BUCKETS = 5000;
const DIAGNOSTIC_MAX_STRING_LENGTH = 1000;
const DIAGNOSTIC_MAX_OBJECT_KEYS = 40;
const DIAGNOSTIC_MAX_ARRAY_ITEMS = 20;
const SENSITIVE_FIELD_PATTERN = /(api[-_]?key|authorization|secret|token|password|cookie)/i;
const workerStartedAt = Date.now();
const encoder = new TextEncoder();

// Best-effort only: Cloudflare isolates are ephemeral and limits do not sync cross-instance.
const rateLimitBuckets = new Map<string, RateLimitBucket>();

class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  headers?: HeadersInit;

  constructor(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const context = createRequestContext(request, env, url.pathname);

    try {
      const route = getRoute(url.pathname);
      context.routePath = route.path;

      ensureMethod(request, route.methods);
      context.rateLimit = enforceRateLimit(request, env, route.path);

      if (route.path === "/health") {
        context.authStatus = "bypassed";
        return handleHealth(request, env, context);
      }

      context.authStatus = enforceAppKeyAuth(request, env);

      if (route.path === "/chat") {
        const payload = await readJsonBody(request, getChatMaxBodyBytes(env));
        validateChatPayload(payload);
        return await handleChat(payload, env, context);
      }

      if (route.path === "/tts") {
        const payload = await readJsonBody(request, getTtsMaxBodyBytes(env));
        validateTtsPayload(payload);
        return await handleTts(payload, env, context);
      }

      await ensureOptionalBodyWithinLimit(request, getTranscribeTokenMaxBodyBytes(env));
      return await handleTranscribeToken(env, context);
    } catch (error) {
      return handleError(error, context);
    }
  },
};

function createRequestContext(request: Request, env: Env, pathname: string): RequestContext {
  const authRequired = Boolean(env.CLICKY_APP_KEY?.trim());
  return {
    requestId: resolveRequestId(request.headers),
    routePath: pathname || "/",
    startedAt: Date.now(),
    authRequired,
    authStatus: authRequired ? "pending" : "not-required",
    workerEnvironment: readEnvValue(env, "WORKER_ENVIRONMENT") ?? "unspecified",
    workerVersion: readEnvValue(env, "WORKER_VERSION") ?? "unspecified",
    rateLimit: null,
  };
}

function resolveRequestId(headers: Headers): string {
  const candidates = [
    headers.get(REQUEST_ID_HEADER),
    headers.get(CORRELATION_ID_HEADER),
    headers.get("cf-ray"),
  ];

  for (const candidate of candidates) {
    const sanitized = sanitizeRequestId(candidate);
    if (sanitized) {
      return sanitized;
    }
  }

  return crypto.randomUUID();
}

function sanitizeRequestId(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 128) {
    return null;
  }

  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

function getRoute(pathname: string): RouteDefinition {
  if (pathname === "/chat" || pathname === "/tts" || pathname === "/transcribe-token") {
    return { path: pathname, methods: ["POST"] };
  }

  if (pathname === "/health") {
    return { path: pathname, methods: ["GET"] };
  }

  throw new HttpError(404, "NOT_FOUND", `Unknown route: ${pathname}`, {
    route: pathname,
    knownRoutes: ["/chat", "/tts", "/transcribe-token", "/health"],
  });
}

function ensureMethod(request: Request, allowedMethods: readonly string[]): void {
  if (!allowedMethods.includes(request.method)) {
    throw new HttpError(
      405,
      "METHOD_NOT_ALLOWED",
      `Allowed methods: ${allowedMethods.join(", ")}`,
      {
        allowedMethods,
        receivedMethod: request.method,
      },
      { allow: allowedMethods.join(", ") }
    );
  }
}

function enforceAppKeyAuth(request: Request, env: Env): AuthStatus {
  const expectedKey = env.CLICKY_APP_KEY?.trim();
  if (!expectedKey) {
    return "not-required";
  }

  const providedKey = request.headers.get(APP_KEY_HEADER)?.trim();
  if (!providedKey) {
    throw new HttpError(
      401,
      "UNAUTHORIZED",
      `Missing ${APP_KEY_HEADER} header`,
      {
        authRequired: true,
        authHeader: APP_KEY_HEADER,
        reason: "missing_header",
      },
      { [AUTH_STATUS_HEADER]: "missing" }
    );
  }

  if (!timingSafeEqual(providedKey, expectedKey)) {
    throw new HttpError(
      401,
      "UNAUTHORIZED",
      "Invalid application key",
      {
        authRequired: true,
        authHeader: APP_KEY_HEADER,
        reason: "invalid_app_key",
      },
      { [AUTH_STATUS_HEADER]: "invalid" }
    );
  }

  return "validated";
}

function enforceRateLimit(request: Request, env: Env, routePath: string): RateLimitState | null {
  const clientId = getClientIdentifier(request);
  if (!clientId) {
    return null;
  }

  const maxRequests = parsePositiveInt(env.RATE_LIMIT_MAX_REQUESTS, DEFAULT_RATE_LIMIT_MAX_REQUESTS);
  const windowSeconds = parsePositiveInt(env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_LIMIT_WINDOW_SECONDS);
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const bucketKey = `${routePath}:${clientId.value}`;
  const policy = `${maxRequests};w=${windowSeconds}`;

  cleanupRateLimitBuckets(now);

  const bucket = rateLimitBuckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    rateLimitBuckets.set(bucketKey, {
      count: 1,
      resetAt,
    });
    return {
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - 1),
      resetAt,
      windowSeconds,
      policy,
      clientIdSource: clientId.source,
    };
  }

  if (bucket.count >= maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    const rateLimitState: RateLimitState = {
      limit: maxRequests,
      remaining: 0,
      resetAt: bucket.resetAt,
      windowSeconds,
      policy,
      clientIdSource: clientId.source,
    };
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "Too many requests",
      {
        route: routePath,
        retryAfterSeconds,
        rateLimit: buildRateLimitDiagnostic(rateLimitState),
      },
      createRateLimitHeaders(rateLimitState, retryAfterSeconds)
    );
  }

  bucket.count += 1;
  return {
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - bucket.count),
    resetAt: bucket.resetAt,
    windowSeconds,
    policy,
    clientIdSource: clientId.source,
  };
}

function cleanupRateLimitBuckets(now: number): void {
  if (rateLimitBuckets.size <= RATE_LIMIT_MAX_BUCKETS) {
    for (const [key, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) {
        rateLimitBuckets.delete(key);
      }
    }
    return;
  }

  const buckets = Array.from(rateLimitBuckets.entries()).sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [key] of buckets) {
    if (rateLimitBuckets.size <= RATE_LIMIT_MAX_BUCKETS) {
      break;
    }
    rateLimitBuckets.delete(key);
  }
}

function getClientIdentifier(request: Request): ClientIdentifier | null {
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) {
    return { value: cfConnectingIp, source: "cf-connecting-ip" };
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return { value: firstIp, source: "x-forwarded-for" };
    }
  }

  return null;
}

async function readJsonBody(request: Request, maxBytes: number): Promise<JsonObject> {
  ensureJsonContentType(request);

  const rawBody = await readTextBodyWithinLimit(request, maxBytes);
  if (!rawBody.trim()) {
    throw new HttpError(400, "INVALID_JSON", "Request body is required", {
      maxBytes,
    });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Malformed JSON body", {
      maxBytes,
    });
  }

  if (!isJsonObject(parsedBody)) {
    throw new HttpError(400, "INVALID_JSON", "JSON body must be an object", {
      receivedType: describeValueType(parsedBody),
    });
  }

  return parsedBody;
}

function ensureJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== JSON_CONTENT_TYPE) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", `Expected ${JSON_CONTENT_TYPE} request body`, {
      expected: JSON_CONTENT_TYPE,
      received: mediaType ?? null,
    });
  }
}

async function readTextBodyWithinLimit(request: Request, maxBytes: number): Promise<string> {
  ensureContentLengthWithinLimit(request.headers.get("content-length"), maxBytes);

  if (!request.body) {
    throw new HttpError(400, "INVALID_REQUEST", "Missing request body", {
      maxBytes,
    });
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel("payload too large");
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBytes} bytes`, {
        maxBytes,
      });
    }

    body += decoder.decode(value, { stream: true });
  }

  body += decoder.decode();
  return body;
}

async function ensureOptionalBodyWithinLimit(request: Request, maxBytes: number): Promise<void> {
  ensureContentLengthWithinLimit(request.headers.get("content-length"), maxBytes);

  if (!request.body) {
    return;
  }

  const reader = request.body.getReader();
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel("payload too large");
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBytes} bytes`, {
        maxBytes,
      });
    }
  }
}

function ensureContentLengthWithinLimit(contentLengthHeader: string | null, maxBytes: number): void {
  if (!contentLengthHeader) {
    return;
  }

  const contentLength = Number.parseInt(contentLengthHeader, 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBytes} bytes`, {
      maxBytes,
      contentLength,
    });
  }
}

function validateChatPayload(payload: JsonObject): void {
  if (typeof payload.model !== "string" || payload.model.trim() === "") {
    throw new HttpError(400, "INVALID_CHAT_PAYLOAD", "Chat payload must include a non-empty model", {
      field: "model",
    });
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw new HttpError(400, "INVALID_CHAT_PAYLOAD", "Chat payload must include a non-empty messages array", {
      field: "messages",
    });
  }
}

function validateTtsPayload(payload: JsonObject): void {
  if (typeof payload.text !== "string" || payload.text.trim() === "") {
    throw new HttpError(400, "INVALID_TTS_PAYLOAD", "TTS payload must include non-empty text", {
      field: "text",
    });
  }

  if (payload.model_id !== undefined && typeof payload.model_id !== "string") {
    throw new HttpError(400, "INVALID_TTS_PAYLOAD", "TTS payload model_id must be a string when provided", {
      field: "model_id",
    });
  }
}

async function handleChat(payload: JsonObject, env: Env, context: RequestContext): Promise<Response> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": JSON_CONTENT_TYPE,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return await createUpstreamErrorResponse("/chat", "Anthropic", response, context);
  }

  return new Response(response.body, {
    status: response.status,
    headers: buildResponseHeaders(context, buildUpstreamHeaders("Anthropic", response), {
      "content-type": response.headers.get("content-type") || "text/event-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    }),
  });
}

async function handleTranscribeToken(env: Env, context: RequestContext): Promise<Response> {
  const response = await fetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=480", {
    method: "GET",
    headers: {
      authorization: env.ASSEMBLYAI_API_KEY,
    },
  });

  if (!response.ok) {
    return await createUpstreamErrorResponse("/transcribe-token", "AssemblyAI", response, context);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new HttpError(502, "UPSTREAM_ERROR", "AssemblyAI returned invalid JSON", {
      provider: "AssemblyAI",
    });
  }

  return jsonResponse(data, 200, context, buildUpstreamHeaders("AssemblyAI", response));
}

function handleHealth(request: Request, env: Env, context: RequestContext): Response {
  const requiredEnvVars: (keyof Env)[] = [
    "ANTHROPIC_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "ASSEMBLYAI_API_KEY",
  ];

  const missingEnvVars = requiredEnvVars.filter((name) => !readEnvValue(env, name));
  const edgeMetadata = getEdgeMetadata(request);

  return jsonResponse(
    {
      ok: missingEnvVars.length === 0,
      status: missingEnvVars.length === 0 ? "ok" : "degraded",
      service: SERVICE_NAME,
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
      uptimeMs: Math.max(0, Date.now() - workerStartedAt),
      environment: {
        name: context.workerEnvironment,
        version: context.workerVersion,
        compatibilityDate: COMPATIBILITY_DATE,
      },
      auth: {
        header: APP_KEY_HEADER,
        secretName: "CLICKY_APP_KEY",
        required: Boolean(env.CLICKY_APP_KEY?.trim()),
        protectedRoutes: ["/chat", "/tts", "/transcribe-token"],
      },
      limits: {
        chatMaxBodyBytes: getChatMaxBodyBytes(env),
        ttsMaxBodyBytes: getTtsMaxBodyBytes(env),
        transcribeTokenMaxBodyBytes: getTranscribeTokenMaxBodyBytes(env),
        rateLimitWindowSeconds: parsePositiveInt(env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_LIMIT_WINDOW_SECONDS),
        rateLimitMaxRequests: parsePositiveInt(env.RATE_LIMIT_MAX_REQUESTS, DEFAULT_RATE_LIMIT_MAX_REQUESTS),
      },
      observability: {
        requestIdHeader: REQUEST_ID_HEADER,
        correlationIdHeader: CORRELATION_ID_HEADER,
        diagnosticsMode: "safe",
        responseHeaders: [
          REQUEST_ID_HEADER,
          CORRELATION_ID_HEADER,
          ROUTE_HEADER,
          SERVICE_HEADER,
          AUTH_REQUIRED_HEADER,
          AUTH_STATUS_HEADER,
          WORKER_ENV_HEADER,
          WORKER_VERSION_HEADER,
          RATE_LIMIT_LIMIT_HEADER,
          RATE_LIMIT_REMAINING_HEADER,
          RATE_LIMIT_RESET_HEADER,
          RATE_LIMIT_POLICY_HEADER,
          "server-timing",
        ],
        rateLimitStore: {
          strategy: "isolate-local-memory",
          activeBuckets: rateLimitBuckets.size,
          maxBuckets: RATE_LIMIT_MAX_BUCKETS,
        },
      },
      providers: {
        anthropicConfigured: Boolean(readEnvValue(env, "ANTHROPIC_API_KEY")),
        elevenLabsConfigured: Boolean(readEnvValue(env, "ELEVENLABS_API_KEY")),
        elevenLabsVoiceConfigured: Boolean(readEnvValue(env, "ELEVENLABS_VOICE_ID")),
        assemblyAiConfigured: Boolean(readEnvValue(env, "ASSEMBLYAI_API_KEY")),
      },
      routes: {
        chat: "/chat",
        tts: "/tts",
        transcribeToken: "/transcribe-token",
        health: "/health",
      },
      ...(edgeMetadata ? { edge: edgeMetadata } : {}),
      ...(missingEnvVars.length === 0 ? {} : { missingEnvVars }),
    },
    missingEnvVars.length === 0 ? 200 : 503,
    context
  );
}

async function handleTts(payload: JsonObject, env: Env, context: RequestContext): Promise<Response> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "content-type": JSON_CONTENT_TYPE,
      accept: "audio/mpeg",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return await createUpstreamErrorResponse("/tts", "ElevenLabs", response, context);
  }

  return new Response(response.body, {
    status: response.status,
    headers: buildResponseHeaders(context, buildUpstreamHeaders("ElevenLabs", response), {
      "content-type": response.headers.get("content-type") || "audio/mpeg",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    }),
  });
}

async function createUpstreamErrorResponse(
  routePath: string,
  provider: string,
  response: Response,
  context: RequestContext
): Promise<Response> {
  const upstreamBodyText = await response.text();
  const upstreamContentType = response.headers.get("content-type");
  const upstreamRequestId = getUpstreamRequestId(response);
  const upstreamRetryAfter = response.headers.get("retry-after");

  let upstreamBody: unknown = upstreamBodyText;
  try {
    upstreamBody = JSON.parse(upstreamBodyText);
  } catch {
    // Keep the raw body when the upstream payload is not JSON.
  }

  const sanitizedUpstreamBody = sanitizeDiagnosticValue(upstreamBody);
  console.error(
    `[${context.requestId}] [${routePath}] ${provider} error ${response.status}` +
      (upstreamRequestId ? ` upstream=${upstreamRequestId}` : "") +
      `: ${formatDiagnosticForLog(sanitizedUpstreamBody)}`
  );

  const status = response.status === 429 ? 503 : response.status === 401 || response.status === 403 ? 502 : response.status;
  const code = response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_ERROR";
  const details: JsonObject = {
    provider,
    upstreamStatus: response.status,
    upstreamStatusText: response.statusText || undefined,
    upstreamContentType: upstreamContentType ?? undefined,
    upstreamRequestId: upstreamRequestId ?? undefined,
    upstreamBody: sanitizedUpstreamBody,
  };

  const retryAfterSeconds = parseRetryAfterSeconds(upstreamRetryAfter);
  if (retryAfterSeconds !== undefined) {
    details.upstreamRetryAfterSeconds = retryAfterSeconds;
  }

  return jsonError(
    status,
    code,
    `${provider} request failed`,
    withErrorContextDetails(details, context),
    context,
    buildUpstreamHeaders(provider, response)
  );
}

function handleError(error: unknown, context: RequestContext): Response {
  if (error instanceof HttpError) {
    if (shouldLogHttpError(error)) {
      console.warn(
        `[${context.requestId}] [${context.routePath}] ${error.code} ${error.status}: ${formatDiagnosticForLog(error.details ?? error.message)}`
      );
    }
    return jsonError(
      error.status,
      error.code,
      error.message,
      withErrorContextDetails(error.details, context),
      context,
      error.headers
    );
  }

  console.error(`[${context.requestId}] [${context.routePath}] Unhandled error:`, error);
  return jsonError(
    500,
    "INTERNAL_ERROR",
    "Unexpected worker error",
    withErrorContextDetails(undefined, context),
    context
  );
}

function shouldLogHttpError(error: HttpError): boolean {
  return error.status >= 500 || error.status === 429 || error.status === 401;
}

function withErrorContextDetails(details: unknown, context: RequestContext): JsonObject {
  const contextualDetails: JsonObject = {
    requestId: context.requestId,
    route: context.routePath,
    durationMs: Math.max(0, Date.now() - context.startedAt),
  };

  if (details === undefined) {
    return contextualDetails;
  }

  const sanitizedDetails = sanitizeDiagnosticValue(details);
  if (isJsonObject(sanitizedDetails)) {
    return {
      ...sanitizedDetails,
      ...contextualDetails,
    };
  }

  return {
    ...contextualDetails,
    info: sanitizedDetails,
  };
}

function jsonResponse(data: unknown, status: number, context: RequestContext, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: buildResponseHeaders(context, extraHeaders, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    }),
  });
}

function jsonError(
  status: number,
  code: string,
  message: string,
  details: unknown,
  context: RequestContext,
  extraHeaders?: HeadersInit
): Response {
  return jsonResponse(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    status,
    context,
    extraHeaders
  );
}

function buildResponseHeaders(context: RequestContext, extraHeaders?: HeadersInit, baseHeaders?: HeadersInit): Headers {
  const headers = new Headers(baseHeaders);

  headers.set(REQUEST_ID_HEADER, context.requestId);
  headers.set(CORRELATION_ID_HEADER, context.requestId);
  headers.set(ROUTE_HEADER, context.routePath);
  headers.set(SERVICE_HEADER, SERVICE_NAME);
  headers.set(AUTH_REQUIRED_HEADER, String(context.authRequired));
  headers.set(AUTH_STATUS_HEADER, context.authStatus);
  headers.set(WORKER_ENV_HEADER, context.workerEnvironment);
  headers.set(WORKER_VERSION_HEADER, context.workerVersion);
  headers.set("server-timing", `app;dur=${Math.max(0, Date.now() - context.startedAt)}`);

  if (context.rateLimit) {
    const rateLimitHeaders = createRateLimitHeaders(context.rateLimit);
    rateLimitHeaders.forEach((value, key) => headers.set(key, value));
  }

  if (extraHeaders) {
    const additionalHeaders = new Headers(extraHeaders);
    additionalHeaders.forEach((value, key) => headers.set(key, value));
  }

  return headers;
}

function createRateLimitHeaders(rateLimitState: RateLimitState, retryAfterSeconds?: number): Headers {
  const headers = new Headers();
  headers.set(RATE_LIMIT_LIMIT_HEADER, String(rateLimitState.limit));
  headers.set(RATE_LIMIT_REMAINING_HEADER, String(rateLimitState.remaining));
  headers.set(RATE_LIMIT_RESET_HEADER, String(getRateLimitResetSeconds(rateLimitState)));
  headers.set(RATE_LIMIT_POLICY_HEADER, rateLimitState.policy);

  if (retryAfterSeconds !== undefined) {
    headers.set("retry-after", String(retryAfterSeconds));
  }

  return headers;
}

function getRateLimitResetSeconds(rateLimitState: RateLimitState): number {
  return Math.max(0, Math.ceil((rateLimitState.resetAt - Date.now()) / 1000));
}

function buildRateLimitDiagnostic(rateLimitState: RateLimitState): JsonObject {
  return {
    limit: rateLimitState.limit,
    remaining: rateLimitState.remaining,
    resetInSeconds: getRateLimitResetSeconds(rateLimitState),
    windowSeconds: rateLimitState.windowSeconds,
    policy: rateLimitState.policy,
    clientIdSource: rateLimitState.clientIdSource,
    strategy: "per-route-per-client-ip",
  };
}

function buildUpstreamHeaders(provider: string, response: Response): Headers {
  const headers = new Headers();
  headers.set(UPSTREAM_PROVIDER_HEADER, provider.toLowerCase());

  const upstreamRequestId = getUpstreamRequestId(response);
  if (upstreamRequestId) {
    headers.set(UPSTREAM_REQUEST_ID_HEADER, upstreamRequestId);
  }

  const upstreamRetryAfter = response.headers.get("retry-after");
  if (upstreamRetryAfter) {
    headers.set(UPSTREAM_RETRY_AFTER_HEADER, upstreamRetryAfter);
    headers.set("retry-after", upstreamRetryAfter);
  }

  return headers;
}

function getUpstreamRequestId(response: Response): string | null {
  const headerNames = [
    "request-id",
    "x-request-id",
    "anthropic-request-id",
    "cf-ray",
    "x-amzn-trace-id",
  ];

  for (const headerName of headerNames) {
    const headerValue = sanitizeRequestId(response.headers.get(headerName));
    if (headerValue) {
      return headerValue;
    }
  }

  return null;
}

function getEdgeMetadata(request: Request): JsonObject | undefined {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  if (!cf || typeof cf !== "object") {
    return undefined;
  }

  const edgeMetadata: JsonObject = {};
  const keys = ["colo", "country", "regionCode", "city"];

  for (const key of keys) {
    const value = cf[key];
    if (typeof value === "string" && value.trim() !== "") {
      edgeMetadata[key] = value;
    }
  }

  return Object.keys(edgeMetadata).length > 0 ? edgeMetadata : undefined;
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeDiagnosticString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (depth >= 4) {
    return "[TRUNCATED]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, DIAGNOSTIC_MAX_ARRAY_ITEMS).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }

  if (isJsonObject(value)) {
    const entries = Object.entries(value).slice(0, DIAGNOSTIC_MAX_OBJECT_KEYS);
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [
        key,
        SENSITIVE_FIELD_PATTERN.test(key) ? "[REDACTED]" : sanitizeDiagnosticValue(entryValue, depth + 1),
      ])
    );
  }

  return String(value);
}

function sanitizeDiagnosticString(value: string): string {
  const trimmed = value.trim();
  if (/^Bearer\s+/i.test(trimmed)) {
    return "[REDACTED]";
  }

  if (trimmed.length > 64 && /^[A-Za-z0-9_\-./+=:]+$/.test(trimmed)) {
    return "[REDACTED]";
  }

  return truncate(value, DIAGNOSTIC_MAX_STRING_LENGTH);
}

function formatDiagnosticForLog(value: unknown): string {
  if (typeof value === "string") {
    return truncate(value, DIAGNOSTIC_MAX_STRING_LENGTH);
  }

  try {
    return truncate(JSON.stringify(value), DIAGNOSTIC_MAX_STRING_LENGTH);
  } catch {
    return "[UNSERIALIZABLE_DIAGNOSTIC]";
  }
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const numericValue = Number.parseInt(value, 10);
  if (Number.isFinite(numericValue) && numericValue >= 0) {
    return numericValue;
  }

  const dateValue = Date.parse(value);
  if (!Number.isNaN(dateValue)) {
    return Math.max(0, Math.ceil((dateValue - Date.now()) / 1000));
  }

  return undefined;
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function getChatMaxBodyBytes(env: Env): number {
  return parsePositiveInt(env.CHAT_MAX_BODY_BYTES, DEFAULT_CHAT_MAX_BODY_BYTES);
}

function getTtsMaxBodyBytes(env: Env): number {
  return parsePositiveInt(env.TTS_MAX_BODY_BYTES, DEFAULT_TTS_MAX_BODY_BYTES);
}

function getTranscribeTokenMaxBodyBytes(env: Env): number {
  return parsePositiveInt(env.TRANSCRIBE_TOKEN_MAX_BODY_BYTES, DEFAULT_TRANSCRIBE_TOKEN_MAX_BODY_BYTES);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEnvValue(env: Env, key: keyof Env): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function describeValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}
