# Cloudflare Proxy — Deployment

This worker sits between the React app and the AI provider APIs.
It verifies each user with a Supabase JWT and rate-limits per user.

## Why it exists

- **Stops API key abuse** — without this, anyone could call your proxy from any origin
- **Per-user rate limiting** — protects against runaway usage
- **CORS lockdown** — only your app's origin can call the proxy
- **Streams responses** — no buffering, no extra latency

## Setup

### 1. Create the worker (or update the existing `claude-proxy`)

Paste the contents of `worker.js` into your Cloudflare Worker editor.

### 2. Bindings & variables

In **Worker → Settings → Variables and Secrets**:

| Name | Type | Value |
|------|------|-------|
| `SUPABASE_URL` | Text | `https://your-project.supabase.co` |
| `SUPABASE_ANON_KEY` | **Secret** | Your project's anon key |
| `ALLOWED_ORIGINS` | Text | `https://app.example.com,https://example.com` |

In **Worker → Settings → Variables and Secrets → KV Namespace Bindings** (optional but recommended):

| Variable | KV Namespace |
|----------|--------------|
| `RATE_LIMIT_KV` | Create a new namespace `rate-limits` |

If `RATE_LIMIT_KV` is not bound, rate limiting is skipped.

### 3. Point the frontend at it

In your hosting provider (Cloudflare Pages / Vercel / etc.) set:

```
VITE_PROXY_URL=https://your-proxy.your-account.workers.dev
```

## What it routes

| Path | Provider |
|------|----------|
| `POST /claude` | Anthropic Messages API |
| `POST /gpt` | OpenAI Chat Completions (streaming) |
| `POST /gemini` | Google Gemini (streaming SSE) |
| `POST /grok` | xAI Chat Completions (streaming) |
| `POST /dalle` | OpenAI Images (DALL-E 3) |

## Auth flow

The React client sends two things on every call:

1. `x-supabase-auth: Bearer <supabase-jwt>` — proves the user is signed in
2. `x-api-key` or `Authorization: Bearer ...` — the user's own provider key

The worker verifies the Supabase JWT against `${SUPABASE_URL}/auth/v1/user`.
Provider keys are forwarded but never stored.

## Rate limiting

60 requests per user per minute by default. Edit `PER_MINUTE_LIMIT` at the top
of `worker.js` to change it. Per-user counters live in `RATE_LIMIT_KV` and
expire after 2 minutes.

## Local dev with wrangler (optional)

```bash
cd infrastructure/cloudflare-proxy
npm install -g wrangler
wrangler login
wrangler deploy
```

You'll need a `wrangler.toml` — see Cloudflare's docs for the latest syntax.
