# Clicky Worker

This Worker is the backend proxy for Clicky. It keeps provider API keys out of the desktop apps and exposes a small, fixed surface area for chat, text-to-speech, realtime transcription token minting, and health checks.

## What it does

- Proxies `POST /chat` to Anthropic Messages API
- Proxies `POST /tts` to ElevenLabs text-to-speech
- Proxies `POST /transcribe-token` to AssemblyAI streaming token minting
- Exposes `GET /health` for readiness and operational diagnostics

The Worker now includes:

- optional shared app-key auth via `x-clicky-app-key`
- request and correlation IDs
- payload size validation
- best-effort per-route rate limiting
- safer, sanitized error payloads
- observability headers on success and error responses

## Required secrets

Set these with Wrangler secrets:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ASSEMBLYAI_API_KEY
npx wrangler secret put ELEVENLABS_API_KEY
```

Optional but recommended for desktop builds:

```bash
npx wrangler secret put CLICKY_APP_KEY
```

If `CLICKY_APP_KEY` is configured, protected routes require this exact request header:

```text
x-clicky-app-key: <your-shared-key>
```

## Non-secret configuration

Set non-secret values in [wrangler.toml](wrangler.toml):

```toml
[vars]
ELEVENLABS_VOICE_ID = "your-voice-id"
CHAT_MAX_BODY_BYTES = "10485760"
TTS_MAX_BODY_BYTES = "131072"
TRANSCRIBE_TOKEN_MAX_BODY_BYTES = "1024"
RATE_LIMIT_WINDOW_SECONDS = "60"
RATE_LIMIT_MAX_REQUESTS = "60"
WORKER_ENVIRONMENT = "local"
WORKER_VERSION = "dev"
```

What each value controls:

- `ELEVENLABS_VOICE_ID`: target ElevenLabs voice for `/tts`
- `CHAT_MAX_BODY_BYTES`: max request size accepted by `/chat`
- `TTS_MAX_BODY_BYTES`: max request size accepted by `/tts`
- `TRANSCRIBE_TOKEN_MAX_BODY_BYTES`: max request size accepted by `/transcribe-token`
- `RATE_LIMIT_WINDOW_SECONDS`: rate-limit window size
- `RATE_LIMIT_MAX_REQUESTS`: requests allowed per route and client IP in each window
- `WORKER_ENVIRONMENT`: non-secret label returned in `/health` and response headers
- `WORKER_VERSION`: non-secret release/build label returned in `/health` and response headers

Do not put secrets in `WORKER_ENVIRONMENT` or `WORKER_VERSION`. They are intentionally visible to clients.

## Local development

Install dependencies:

```bash
cd worker
npm install
```

Create `worker/.dev.vars` with local secrets:

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
ASSEMBLYAI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
CLICKY_APP_KEY=optional-shared-key
```

Start the Worker locally:

```bash
npx wrangler dev
```

Default local URL:

```text
http://127.0.0.1:8787
```

## Deploy

Deploy to Cloudflare:

```bash
cd worker
npx wrangler deploy
```

After deploy, save the resulting `https://<name>.<subdomain>.workers.dev` base URL into the desktop clients:

- macOS: `ClickyWorkerBaseURL` and optional `ClickyWorkerAppKey` in `leanring-buddy/Info.plist`
- Windows: Worker base URL in settings, and `x-clicky-app-key` if auth is enabled

## Routes

### `GET /health`

Purpose:

- validates that required provider configuration exists
- reports auth mode, route limits, environment/version, and edge metadata
- gives a safe diagnostics payload for setup and monitoring

Status codes:

- `200` when required provider config is present
- `503` when required provider config is missing

Example:

```bash
curl http://127.0.0.1:8787/health
```

### `POST /chat`

Requirements:

- `Content-Type: application/json`
- JSON object with at least `model` and non-empty `messages`
- `x-clicky-app-key` when auth is enabled

Minimal smoke test:

```bash
curl -X POST http://127.0.0.1:8787/chat \
  -H "content-type: application/json" \
  -H "x-clicky-app-key: optional-shared-key" \
  -d "{\"model\":\"claude-3-7-sonnet-latest\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one short sentence.\"}]}"
```

### `POST /tts`

Requirements:

- `Content-Type: application/json`
- JSON object with non-empty `text`
- optional `model_id` string
- `x-clicky-app-key` when auth is enabled

Minimal smoke test:

```bash
curl -X POST http://127.0.0.1:8787/tts \
  -H "content-type: application/json" \
  -H "x-clicky-app-key: optional-shared-key" \
  -o sample.mp3 \
  -d "{\"text\":\"Hello from Clicky.\"}"
```

### `POST /transcribe-token`

Requirements:

- `x-clicky-app-key` when auth is enabled
- request body is optional, but the route still enforces a small payload cap

Minimal smoke test:

```bash
curl -X POST http://127.0.0.1:8787/transcribe-token \
  -H "x-clicky-app-key: optional-shared-key"
```

## Response headers and observability

Every route now returns operational headers that are useful in app logs, curl output, and incident debugging.

Core headers:

- `x-request-id`: stable request ID for this Worker request
- `x-correlation-id`: same value as `x-request-id`
- `x-clicky-route`: resolved Worker route
- `x-clicky-service`: service label, currently `clicky-proxy-worker`
- `x-clicky-auth-required`: `true` or `false`
- `x-clicky-auth-status`: `pending`, `validated`, `not-required`, `bypassed`, or an error-specific value on failures
- `x-clicky-worker-environment`: value from `WORKER_ENVIRONMENT`
- `x-clicky-worker-version`: value from `WORKER_VERSION`
- `server-timing`: total Worker handling duration

Rate-limit headers:

- `ratelimit-limit`
- `ratelimit-remaining`
- `ratelimit-reset`
- `ratelimit-policy`
- `retry-after` when a request is rejected

Upstream headers when relevant:

- `x-clicky-upstream-provider`
- `x-clicky-upstream-request-id`
- `x-clicky-upstream-retry-after`

If you already have your own request ID in the client, send one of these request headers:

- `x-request-id`
- `x-correlation-id`

The Worker will reuse it when valid instead of generating a new one.

## Error behavior

Common Worker-side errors:

- `401 UNAUTHORIZED`: missing or invalid `x-clicky-app-key`
- `404 NOT_FOUND`: unknown route
- `405 METHOD_NOT_ALLOWED`: wrong HTTP verb
- `413 PAYLOAD_TOO_LARGE`: request body exceeded configured limit
- `415 UNSUPPORTED_MEDIA_TYPE`: expected JSON body where required
- `429 RATE_LIMITED`: local Worker rate limit exceeded

Upstream provider failures are normalized into safe JSON error payloads. Important details such as `requestId`, `route`, `durationMs`, upstream status, upstream request ID, and retry hints are preserved, but sensitive tokens and secret-like fields are redacted.

Notes:

- upstream `429` is surfaced as Worker `503` with retry metadata
- upstream `401` and `403` are surfaced as Worker `502`
- `/health` is intentionally public unless you put another layer in front of it

## Rate-limit model

The current rate limiter is deliberately simple:

- key: `route + client IP`
- store: in-memory per Cloudflare isolate
- scope: best-effort only

That means it is useful for basic protection and diagnostics, but it is not globally consistent across all isolates or regions.

## Recommended smoke-test checklist

Run these in order after any config change or deploy:

1. `GET /health` and confirm `status: "ok"`
2. Confirm `auth.required` is what you expect
3. Confirm `providers.*Configured` are all `true`
4. Confirm `environment.name` and `environment.version` match the release you meant to deploy
5. `POST /transcribe-token`
6. `POST /tts`
7. `POST /chat`
8. Capture `x-request-id` from any failing request before debugging deeper

## Operational notes

- Keep `CLICKY_APP_KEY` aligned across both desktop apps and the Worker.
- Prefer changing `WORKER_VERSION` on every meaningful deploy so `/health` can prove what is live.
- If you need stronger abuse control, replace the current in-memory rate limit with a distributed store such as Durable Objects, KV-backed coordination, or another edge-safe strategy.
- There is currently no automated Worker test script in `package.json`; for now, use the smoke tests above plus deployed `/health` validation.
