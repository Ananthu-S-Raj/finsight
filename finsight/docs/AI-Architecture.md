# FinSight — AI Features (Architecture)

## 1. What exists today

FinSight has **two** "insights" surfaces with very different privacy models:

| Surface | Where it runs | Data that leaves the device/server |
|---|---|---|
| **On-device insights** (`/insights`) | 100% in the browser | None — rule-based observations over the local transaction list |
| **FinSight AI** (`/insights`, new) | Server-side (Next.js API route) | Aggregated month summary → configured LLM provider |
| **Admin AI status** (`/admin` dashboard) | Server-side (admin API) | Never sends data; only health-checks the configured provider |

The on-device insights are the always-available baseline. If the AI provider
is down, unconfigured, or disabled, the app simply keeps working and the AI
card shows a friendly fallback instead of an error.

## 2. Data flow (user-facing AI insights)

```
Browser  ──Bearer JWT──▶  POST /api/v1/ai/insights        (Next.js route)
                             │
                             ├─ verifySession(JWT)          → 401 if invalid
                             ├─ rate limit (12/user/hr, 30/IP/hr) → 429
                             ├─ read profiles.monthly_budget (RLS-scoped)
                             ├─ read own transactions for the month (RLS-scoped)
                             ▼
                          aggregateInsights()   ← only aggregates survive
                             │  totals, top categories (names sanitized),
                             │  budget %, savings rate — NO notes, subcategories,
                             │  ids, emails, or transaction rows
                             ▼
                          provider.complete(system, user)
                             │  OpenAI  → {baseUrl}/chat/completions
                             │  Ollama  → {baseUrl}/api/chat
                             ▼
                          { available: true, insights, provider, model }
```

Everything runs through a Supabase client scoped to the caller's JWT
(`createUserClient`), so **RLS** is the enforcement boundary: a user can only
ever aggregate their own rows. The service role is never used.

## 3. Configuration (environment variables only)

All AI configuration is read from the environment (`src/lib/ai/config.ts`).
Nothing is stored in the DB, nothing is exposed to clients, and API keys are
never logged or returned by any endpoint.

| Variable | Default | Purpose |
|---|---|---|
| `AI_ENABLED` | `true` | Master switch. `false` disables the endpoint entirely (it returns `available: false`). |
| `AI_PROVIDER` | `openai` | `openai` or `ollama`. |
| `OPENAI_API_KEY` | — | Required for OpenAI. Blank → AI falls back gracefully. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model id sent to the provider. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL (Azure/self-hosted gateways). |
| `OPENAI_TIMEOUT_MS` | `15000` | Request timeout. |
| `OLLAMA_ENABLED` | `false` | Must be `true` to use a local Ollama server. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server. |
| `OLLAMA_MODEL` | `llama3.2` | Model served by Ollama. |
| `OLLAMA_TIMEOUT_MS` | `30000` | Request timeout. |

Copy `.env.local.example` → `.env.local` and fill in the values you want.

## 4. Provider abstraction

`src/lib/ai/provider.ts` defines a minimal `AIProvider` interface:

```ts
interface AIProvider {
  readonly name: "openai" | "ollama";
  readonly model: string;
  readonly timeoutMs: number;
  isConfigured(): boolean;      // key/enabled present?
  complete(system, user): Promise<AICompletion>;
  ping(): Promise<AIPing>;      // reachability only, for the admin console
}
```

`getProvider(config)` returns the right implementation or `null` when the
configured provider is not usable. Adding another provider = implement the
interface + wire it in the factory. OpenAI and Ollama requests are plain
`fetch` calls with an `AbortController` timeout; there is no SDK dependency.

## 5. Error handling & fallbacks

- Provider failures are mapped to a typed `AIError` (`src/lib/ai/errors.ts`):
  `auth`, `rate_limited`, `server_error`, `timeout`, `network`, `empty`.
- The **raw provider body is never returned to the client**. Only a fixed,
  friendly `userMessage` per error kind is surfaced.
- On any failure the endpoint returns HTTP 200 with
  `{ available: false, message, code }` so the UI can degrade gracefully.
- Successful results are cached in memory for 10 minutes (keyed by provider +
  model + month + summary fingerprint) to cut LLM spend on repeated views.

## 6. Prompt construction & injection resistance

`src/lib/ai/prompts.ts`:

- The system prompt explicitly instructs the model to treat all provided data
  as **data, not instructions**, and never to reveal its system prompt.
- The user prompt contains only numbers and sanitized category names.
- `sanitizeCategory()` strips control characters, collapses whitespace, caps
  length at 40 chars — category names are the only free-form user-controlled
  strings that reach the model, so they are the main injection surface.
- Transaction `note`/`subcategory` fields are never selected server-side.

## 7. Rate limiting

- 12 requests / hour per user, 30 / hour per IP (in-memory sliding window,
  `src/lib/rateLimit.ts`). Keeps a leaked token or a misbehaving client from
  running up a hosted-LLM bill.
- 429s are returned with a retry-after message the UI shows as-is.

## 8. Admin console

`GET /api/admin/ai/status` (permission `AI_SETTINGS`):

- Merges the DB `app_settings.ai` feature flags with the **environment**
  configuration (provider, model, whether credentials are present).
- For Ollama, pings `/api/tags` for a live reachability check. For hosted
  OpenAI it does **not** spend quota on a probe — it reports "configured".
- **Never returns API keys.** The dashboard card renders provider/model,
  configured, endpoint reachability, and the enabled switch.

## 9. Security decisions (why it is safe)

1. **RLS is the auth boundary** — the API never fetches other users' rows, and
   cannot, because the query is scoped to the caller's JWT.
2. **Minimal data egress** — the provider only ever sees aggregates; notes,
   subcategories, IDs, emails and transaction rows are structurally excluded.
3. **Secrets server-side only** — keys live in env vars, are never persisted,
   never logged, and never serialized into API responses.
4. **Graceful degradation** — AI is optional; every failure mode returns a
   readable fallback, so a broken provider can never break the app.
5. **No prompt-injection channel for instructions** — the model is told the
   data is data, and category names are sanitized before prompting.

## 10. Test coverage

`tests/ai.test.ts` (24 tests): config defaults/overrides, aggregation math,
OpenAI + Ollama provider success/401/429/5xx/timeout/network/empty, disabled
and unconfigured fallbacks, endpoint auth/rate-limit, and a privacy test that
asserts the exact prompt sent to the provider contains no notes, IDs, emails,
or subcategories.

## 11. Repository layout (AI)

```
src/lib/ai/config.ts        env-only configuration
src/lib/ai/errors.ts        typed AI errors + friendly user messages
src/lib/ai/provider.ts      AIProvider interface, OpenAI + Ollama, factory
src/lib/ai/prompts.ts       system prompt + sanitized monthly summary prompt
src/lib/ai/service.ts       aggregation, generateInsights, cache, fallback
src/app/api/v1/ai/insights/route.ts   user-facing endpoint
src/components/AIInsights.tsx         AI card on the /insights page
src/lib/admin/handlers/ai.ts          admin status endpoint
tests/ai.test.ts            unit + endpoint tests
```
