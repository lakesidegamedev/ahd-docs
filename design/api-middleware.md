# API Middleware Layer

## Summary

The API middleware layer provides the shared building blocks for safe, consistent API routes: authentication, authorization, rate limiting, request validation and structured errors. It lives in `src/lib/api/`. It is infrastructure with no player-facing page, so there is no player guide to link; its effects reach players only as 401, 403, 409, 413 and 429 responses and the shared error shape.

**Key files** in `src/lib/api/`:

- `requireAuth.ts`: authentication helpers
- `requireAdmin.ts`: admin authorization
- `requireCron.ts`: cron job verification
- `rateLimit.ts`: in-memory rate limiting and the preset limits
- `rateLimit.mongo.ts`: Mongo-backed durable limiter (`durableRateLimit`) for high-value buckets
- `validate.ts`: Zod schema validation and query parsing
- `errors.ts`: structured error handling
- `schemas/`: shared Zod schemas per feature

The directory also holds many more role and request gates (for example `requireAdminOrApiKey.ts`, `requireBotToken.ts`, `requireModerator.ts`, `rejectDuringTurn.ts`, `assertSameOrigin.ts`, `withAdminAuth.ts`, `withNoStore.ts`); list `src/lib/api/` for the full set.

## Rules

### Authentication helpers (`src/lib/api/requireAuth.ts`)

Every helper returns `{ ok: true, user }` or `{ ok: false, response }`. A route returns `response` when `ok` is false.

| Helper | Returns | Failure | Use for |
| --- | --- | --- | --- |
| `requireAuth()` | `AuthUserWithCharacter` (character optional) | 401 | Most player routes |
| `requireBasicAuth()` | `AuthUser`, no character lookup | 401 | Fast auth-only checks |
| `requireAuthWithCharacter()` | user with `hasCharacter: true` and `character` | 401 | Routes that need a character |
| `requireHumanSession(request)` | `AuthUser` | 403 | Action endpoints that must reject automation |
| `requireHumanSessionWithCharacter(request)` | user with character | 403 | Same, with a character |

```typescript
const auth = await requireAuth();
if (!auth.ok) return auth.response;
// auth.user has userId, username, character (if exists)
```

Behaviour shared by the helpers:

- A failed lookup returns the `unauthorized()` envelope with status 401 and clears the auth cookie (`clearAuthCookie`). `requireAuthWithCharacter` clears the cookie only when there is no user at all, not when the user merely lacks a character.
- On success they tag the observability scope with the user (`setUserContext`) and stamp a per-request audit context (`stampAuditRequestContext`, a random UUID `traceId` plus the actor). `requireAuth` and `requireAuthWithCharacter` also tag the current turn and the character's office (`applyGameContext`). Both observability steps swallow their own failures so they never break auth.
- `requireHumanSession*` rejects any request carrying an `X-Bot-Token` header, runs `assertSameOrigin`, then authenticates. A request that claims an automated playtest run through the `X-Synthetic-Run` header (`SYNTHETIC_RUN_HEADER`) is refused with 403 unless its character is marked `isSynthetic`. Accepted calls are logged with `logApiAccess` as `session` or `synthetic`.

### Authorization helpers

- `requireAdmin()` (`requireAdmin.ts`) returns `{ ok: true, admin }` or a 403 `forbidden()` envelope. It calls `getAuthAdmin()` in `src/lib/auth.ts`, which resolves the account from the database; `isAdmin` is `user.isAdmin === true || user.role === "admin"` on the current account record, never a token claim. Never write `if (!user?.isAdmin)` against `getAuthUser()` output in a route; always use `requireAdmin()`.
- `requireModerator()` accepts moderators and admins (403 otherwise).
- `requireAdminOrApiKey(request)` accepts an `x-api-key` header equal to `INTERNAL_API_KEY` (constant-time compare; 500 if the variable is unset, 401 on a wrong key) or falls back to an admin session.
- `withAdminAuth(handler)` and `withAdminRoute(handler)` wrap a handler so it only runs for an admin; `withAdminRoute` also adds the standard error boundary.
- `requireCron(request)` returns a `boolean`: true only when `CRON_SECRET` is set and the `Authorization` header equals `Bearer ${CRON_SECRET}`. The compare uses `crypto.timingSafeEqual` after a length check. An unset or empty secret rejects everything.
- `requireBotToken(request, allowPublicKey = true)` checks `X-Bot-Token` against `DISCORD_BOT_API_KEY`, and also `PUBLIC_BOT_API_KEY` unless `allowPublicKey` is false, using `timingSafeCompare` (`timingSafeCompare.ts`).
- `assertSameOrigin(request)` returns a 403 response or `null`. A request with no `Origin` and no `Referer` is allowed (the `sameSite: lax` cookie is the backstop). Otherwise the origin host must equal the request `Host`, or appear in the allowlist built from `NEXT_PUBLIC_BASE_URL` plus the comma-separated `ALLOWED_ORIGINS`.
- `rejectDuringTurn(db)` returns a 409 while a live turn lock is held, or while `processingKind` is `stockTaxMigration` or `economyReset`. A stale lock does not block play (`isTurnProcessingNow` in `src/lib/turn/processingLock.ts`).

### Rate limiting

`checkRateLimit(identifier, maxRequests = 100, windowMs = 60_000)` in `rateLimit.ts` is a per-process fixed window. Defaults: `DEFAULT_MAX_REQUESTS = 100`, `DEFAULT_WINDOW_MS = 60_000`.

```typescript
const rateLimit = checkRateLimit(clientIp, 100, 60000);
if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
```

Algorithm:

```text
id        = identifier, or "__unknown_ip__" when empty or "unknown"
entry     = store[id]; if missing or entry.resetAt < now: entry = { count: 0, resetAt: now + windowMs }
entry.count += 1
remaining = max(0, maxRequests - entry.count)
if entry.count > maxRequests: { ok: false, limit, remaining: 0, resetAt, retryAfter: ceil((resetAt - now) / 1000) }
else:                         { ok: true, limit, remaining, resetAt }
```

The map is pruned of expired entries whenever it holds more than 10,000 identifiers. The result type `RateLimitResult` carries `ok`, `limit`, `remaining`, `resetAt` (epoch ms) and, when blocked, `retryAfter` in seconds. `rateLimitHeaders(meta)` builds `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (epoch seconds, `ceil(resetAt / 1000)`).

`durableRateLimit(identifier, maxRequests, windowMs)` in `rateLimit.mongo.ts` is the hybrid limiter. It runs `checkRateLimit` first as a free fast-reject, then, if that passes, increments a Mongo counter. If Mongo throws, it returns the local result (fails open). The Mongo window is wall-clock aligned: `windowStart = floor(now / windowMs) * windowMs`, `resetAt = windowStart + windowMs`, and the document id is `` `${id}:${windowStart}` ``. Auth routes (register, reset-password, confirm-email, change-email) and user API key creation use it.

#### Preset limits (`src/lib/api/rateLimit.ts`)

| Constant | Max requests | Window | Purpose |
| --- | --- | --- | --- |
| `AUTH_LIMITS` | 10 | 60 s | Login and register brute force |
| `FEEDBACK_LIMITS` | 5 | 60 s | Bug and suggestion spam |
| `WIKI_REPORT_LIMITS` | 5 | 60 s | Wiki page issue reports |
| `SUGGESTION_SUBMIT_LIMITS` | 1 | 30 min | Player suggestions |
| `CONGRESS_LIMITS` | 30 | 60 s | Propose, vote, cosponsor, uncosponsor, withdraw, presidential action |
| `ELECTION_LIMITS` | 20 | 60 s | Enter, withdraw, vote |
| `CAMPAIGN_ACTION_LIMITS` | 60 | 60 s | Travel, state attacks, surges |
| `NPP_MANAGEMENT_LIMITS` | 120 | 60 s | Party NPP management panels (shared counter) |
| `SAVINGS_WALLET_LIMITS` | 30 | 60 s | Savings wallet open, deposit, withdraw |
| `BOT_READ_LIMITS` | 60 | 60 s | Discord bot reads, global per endpoint |
| `BOT_FINANCIAL_LIMITS` | 30 | 60 s | Discord bot financial reads |
| `BOT_CASINO_LIMITS` | 30 per player, `globalMaxRequests` 600 | 60 s | Discord casino |
| `ANALYTICS_PAGE_VIEW_LIMITS` | 200 | 60 s | Page-view ingest, per IP |
| `PLAYER_AD_VIEW_LIMITS` | 60 | 60 s | Ad views per viewer |

`PLAYER_AD_IMPRESSION_WINDOW_MS = 60 * 60 * 1000` is the idempotency window for ad impressions (one counted view per ad per viewer per hour). Read the file for any preset added after this page was checked.

`rateLimitResponse(retryAfter?, message?, meta?)` builds the 429. Body (the shared envelope plus a hint):

```json
{ "error": "You’re sending requests too quickly. Please wait a moment and try again.", "code": "rate_limited", "retryAfterSeconds": 60, "ref": "<request ref>" }
```

Headers: `Retry-After: <seconds>` (60 when no value is passed), plus the three `X-RateLimit-*` headers when `meta` is passed. The caller can override the message. Note the code string is lowercase `rate_limited` here, while the catalog code for status 429 is `RATE_LIMITED`.

### Request validation (`src/lib/api/validate.ts`)

`parseJsonBody(request, schema, options?)` returns `{ success: true, data }` or `{ success: false, error, status }`.

- `DEFAULT_MAX_BODY_BYTES = 256 * 1024` (262,144). A declared `Content-Length` over the cap is rejected with status 413 before reading; an undeclared body is checked after buffering the text and before `JSON.parse`. Override with `options.maxBytes`.
- Unparseable JSON returns status 400, "Invalid JSON body".
- A failed schema returns status 400 with the first issue as `path: message` (`body` when the path is empty).
- `parseFormData(request)` wraps `request.formData()` and converts a malformed upload to a 400 "Invalid or malformed form data".
- `parseBoundedIntParam(searchParams, key, defaultValue, min, max)` is `clamp(parseInt(raw ?? default), min, max)`; a non-finite value falls back to `defaultValue` before clamping.

```typescript
const parsed = await parseJsonBody(request, schema);
if (!parsed.success) {
  return NextResponse.json({ error: parsed.error }, { status: parsed.status });
}
```

Shared schemas (`schemas` in `validate.ts`): `objectId` (hex ObjectId, `HEX_OBJECT_ID_REGEX`), `nppObjectId` (same pattern, different message), `email`, `password` (`min(1)`), and `username` (3 to 20 characters, `^[a-zA-Z0-9_]+$`). Feature schemas live under `src/lib/api/schemas/`.

### Error handling (`src/lib/api/errors.ts`)

`ApiError(status, message, code?, details?)` has `toJson(ref)` returning the shared body `{ error, code, ref, details? }`. When no code is given, `errorCodeForStatus(status)` picks one from `src/lib/errors/catalog.ts`.

| Factory | Status | Code |
| --- | --- | --- |
| `badRequest(message, details?)` | 400 | `BAD_REQUEST` |
| `unauthorized(message = "Authentication required")` | 401 | `UNAUTHORIZED` |
| `forbidden(message = "Forbidden")` | 403 | `FORBIDDEN` |
| `notFound(message = "Not found")` | 404 | `NOT_FOUND` |
| `conflict(message, details?)` | 409 | `CONFLICT` |
| `internalError(message = "Internal server error", cause?)` | 500 | `INTERNAL_ERROR` |

`internalError` only logs to the console; it does not call Sentry. Other helpers: `errorResponse(status, message, options)` builds a response in the shared envelope, `statusResponse(status, body)` adds the envelope to error statuses while preserving the command layer's fields, `isDuplicateKeyError` detects Mongo E11000, and `isUnexpectedError` is true for `TypeError`, `RangeError`, `ReferenceError` and errors with a numeric `code` (Mongo and system errors), so command-layer catches can route faults to `handleRouteError` instead of masking them as 400s.

`handleRouteError(error, context?)` is the catch-all:

1. `PartyTerritoryError` returns 409.
2. `ApiError` returns its envelope and status. These are expected business errors and are not sent to Sentry.
3. Anything else is tagged (`component: "api"`, `http.method`, `http.route`, `error.code`, and `db.duplicateKey` when it applies), logged, captured with `Sentry.captureException`, forwarded to `alertOps` (`src/lib/observability/alertOps.ts`), and answered with status 500. The message is "Internal server error", except in development where it is the real message. The `ref` is the Sentry event id when there is one, else `newRequestRef()`; `eventId` is added when captured.

### Standard route pattern

```typescript
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse, CONGRESS_LIMITS } from "@/lib/api/rateLimit";
import { z } from "zod";

const schema = z.object({
  // ... fields
});

export async function POST(request: Request) {
  try {
    // 1. Authenticate
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    // 2. Rate limit
    const rateLimit = checkRateLimit(
      auth.user.userId,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    // 3. Validate
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    // 4. Business logic
    const db = await getDb();
    // ... do work ...

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
```

Dynamic route params are a promise in Next.js 16 and must always be awaited:

```typescript
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
}
```

Security rules for route authors:

1. Always use the `require*` helpers; never hand-check `isAdmin`.
2. Rate limit user-facing actions, especially auth, feedback, congress and election endpoints.
3. Validate every input with `parseJsonBody()` and a Zod schema.
4. Return structured errors through the `ApiError` factories or `errorResponse`, not raw errors.
5. Admin routes use `requireAdmin()` (a database-authoritative check).

## Data

The layer holds almost no game state of its own. None of this is shown to players, except the error body and rate-limit headers a client receives.

| Collection | Fields | Access |
| --- | --- | --- |
| `rateLimitBuckets` | `_id` (`<identifier>:<windowStart>`), `count`, `expiresAt` (TTL index `rlb_expiresAt_ttl`) | Written by `mongoRateLimit` only. Classed "preserved" in the seed manifest (`src/lib/admin/seed/seedManifestPreserved.ts`) |
| `gameState` (`_id: "current"`) | `isProcessing`, `processingKind`, `processingHeartbeatAt`, `processingStartedAt`, `updatedAt` | Read by `rejectDuringTurn`; `currentTurn` read by `applyGameContext` |
| users and characters | account role, `isAdmin`, `isBanned`, token revocation fields, active character | Read by `getAuthUser*` in `src/lib/auth.ts` |

The in-memory limiter keeps a `Map` of `{ count, resetAt }` per identifier inside one server process; nothing is persisted.

## Configuration

There is no `gameConfig`, era, country or scenario setting. Behaviour is controlled by environment variables and code constants.

| Setting | Default | Effect | Where |
| --- | --- | --- | --- |
| `CRON_SECRET` | unset (all cron calls rejected) | Bearer secret for cron routes | `requireCron.ts` |
| `INTERNAL_API_KEY` | unset (API-key path returns 500) | `x-api-key` for admin-or-key routes | `requireAdminOrApiKey.ts` |
| `DISCORD_BOT_API_KEY`, `PUBLIC_BOT_API_KEY` | unset | Bot tokens; the public key is accepted unless `allowPublicKey` is false | `requireBotToken.ts` |
| `NEXT_PUBLIC_BASE_URL`, `ALLOWED_ORIGINS` | unset | Origin allowlist | `assertSameOrigin.ts` |
| `CF_ORIGIN_SECRET` | unset (CDN client-IP header trusted unconditionally) | Whether `cf-connecting-ip` is trusted for the rate-limit identifier | `src/lib/utils/network.ts` |
| `NODE_ENV` | n/a | `development` exposes the real 500 message | `errors.ts` |
| `DEFAULT_MAX_BODY_BYTES` | 262,144 | JSON body cap, per-call override `maxBytes` | `validate.ts` |
| Rate limit presets | see Rules | Per-route limits | `rateLimit.ts` |

## Timing

The layer runs inside each API request, before game logic. It does not run in the turn processor, with one touchpoint: `rejectDuringTurn` reads the turn lock so player writes stop while a turn is mid-flight.

```text
request
  1. assertSameOrigin / bot-token / cron / session checks   (require* helpers)
  2. rate limit (checkRateLimit, or durableRateLimit for auth)
  3. parseJsonBody (size cap, JSON, schema)
  4. rejectDuringTurn, for routes that clash with turn writes
  5. business logic
  catch: handleRouteError
```

Order is a convention, not enforced by the framework: each route composes the steps. Rate limiting after authentication lets it key on the user id; unauthenticated routes key on the client IP from `getClientIp()` or `clientIpFromRequest()`.

## Worked trace

A client hits an `AUTH_LIMITS` route (10 requests per 60,000 ms) behind the durable limiter. The first request arrives at `t = 1,000,000 ms` in a fresh process.

1. Local entry created: `count = 0`, `resetAt = 1,000,000 + 60,000 = 1,060,000`. After increment `count = 1`, `remaining = 10 - 1 = 9`.
2. Mongo: `windowStart = floor(1,000,000 / 60,000) * 60,000 = 16 * 60,000 = 960,000`, so `resetAt = 1,020,000` and the bucket id is `<ip>:960000`. Count becomes 1, `remaining = 9`. The Mongo window ends sooner than the local one, so the two counters drift apart.
3. The 10th request in the window passes with `remaining = 0`.
4. The 11th request at `t = 1,019,000`: local `count = 11 > 10`, so it fails fast with `retryAfter = ceil((1,060,000 - 1,019,000) / 1000) = ceil(41) = 41`. Mongo is not consulted.
5. The route returns `rateLimitResponse(41)`: status 429, `Retry-After: 41`, body code `rate_limited`, `retryAfterSeconds: 41`.

A body-size example: a `POST` declaring `Content-Length: 300000` exceeds 262,144, so `parseJsonBody` returns `{ success: false, error: "Request body too large", status: 413 }` before reading the body.

## Edge cases and limits

- Unknown client IPs (`""` or `"unknown"`) share one bucket, `__unknown_ip__`, in both limiters. A single unidentifiable caller can therefore exhaust the limit for all unidentifiable callers. This replaced an earlier behaviour that skipped limiting entirely.
- The in-memory counters reset on every process restart or deploy and are not shared between instances. Only `durableRateLimit` survives a restart.
- `durableRateLimit` counts each allowed request in both the local map and Mongo, so the stricter of the two windows wins in practice.
- Mongo failure in `durableRateLimit` fails open to the local result.
- `requireCron` rejects every request when `CRON_SECRET` is unset or empty, so a missing secret fails closed.
- `requireAdminOrApiKey` returns `admin: null` on the API-key path, so callers must not dereference `admin` when `via === "apiKey"`.
- `assertSameOrigin` allows header-less requests, so it is defense in depth and an anti-automation signal, not a complete CSRF barrier.
- `parseJsonBody` measures undeclared bodies in UTF-16 code units, which under-counts bytes, so it never rejects a body actually under the cap.
- `withNoStore` stamps `Cache-Control: no-store` only when the handler set no `Cache-Control` of its own, and compresses JSON at the origin unless `compress: false`.
- Expected 4xx `ApiError`s are deliberately not reported to Sentry.

## Invariants

- Admin and moderator status always reflects the current account record, never token claims: enforced by `getAuthAdmin` and `getAuthUserFromToken` in `src/lib/auth.ts`, and by `requireAdmin.test.ts`.
- Secret comparisons are constant time and length-checked first: enforced in code (`requireCron.ts`, `timingSafeCompare.ts`, `requireAdminOrApiKey.ts`); behaviour covered by `requireCron.test.ts` and `requireAdminOrApiKey.test.ts`. There is no test for `timingSafeCompare.ts` or `requireBotToken.ts` directly.
- Every error response carries a catalog `code` and a `ref`: by construction through `ApiError.toJson` and `errorResponse`; tested in `errors.test.ts`. Routes that bypass them with a hand-rolled `NextResponse.json({ error })` are not caught by any check.
- Rate limiting never blocks on a storage fault: fail-open, covered by `rateLimit.mongo.test.ts`.
- Observability steps (user tagging, audit stamping, game context) never break a request: swallowed by `try/catch` in `requireAuth.ts`. Not directly tested.
- A route using the layers in the documented order is a convention. Nothing enforces that a route authenticates or rate limits.

## Failure and recovery

- **Rate limiter too strict or too loose after a deploy.** In-memory counters reset on restart, which clears a stuck block but also lets an attacker restart their window. Durable buckets expire by TTL once the window ends, so a bad bucket clears itself within one window.
- **Shared unknown-IP bucket exhausted.** Symptom: unrelated clients get 429s with no visible IP. Cause is usually a proxy header misconfiguration (`CF_ORIGIN_SECRET` set but the header missing). Fix the header configuration; the bucket clears when the window ends.
- **Cron or API-key routes returning 401 or 500 after an environment change.** A missing `CRON_SECRET` rejects all cron calls and a missing `INTERNAL_API_KEY` returns 500 on the key path. Restore the variable and redeploy; no data is affected.
- **Player writes returning 409 "The game is processing this turn".** Expected during a turn. If it persists, the turn lock is held by a crashed turn; the stale-lock and crash-recovery logic in `src/lib/turn/processingLock.ts` releases or resumes it, otherwise an operator clears the lock.
- **Unexpected 500s.** They appear in the error tracker tagged with route and method, and in the ops alert channel. The `ref` shown to the player is the tracker event id, which maps a report straight to the event.

## Connections

**Driven by**

- Account and session state: `src/lib/auth.ts` (JWT via `jose`), the users and characters collections.
- Turn lock: `gameState` processing fields via `src/lib/turn/processingLock.ts`.
- Environment secrets listed under Configuration.

**Affects**

- Every API route under `src/app/api/` (468 route files call `checkRateLimit`), including the congress and bill routes: [Congress Leadership](./congress-leadership.md), [Bills and Legislation](./bills-legislation.md).
- Client error screens, which parse the shared envelope (`parseErrorBody` in `src/lib/errors/catalog.ts`).
- Error tracking and ops alerts: `handleRouteError` calls Sentry and `alertOps` (`src/lib/observability/alertOps.ts`).
- MongoDB: `src/lib/mongodb.ts` supplies `getDb()` for the durable limiter and turn-lock reads.

## Tests

Test files in `src/lib/api/`:

- `rateLimit.test.ts`, `rateLimit.extended.test.ts`, `rateLimit.mongo.test.ts`, `influenceRateLimit.test.ts`
- `requireAuth.test.ts`, `requireAdmin.test.ts`, `requireCron.test.ts`, `requireAdminOrApiKey.test.ts`, `botApiAuth.test.ts`, `userApiAuth.test.ts`, `syntheticSession.test.ts`
- `validate.test.ts`, `validate.extended.test.ts`
- `errors.test.ts`, `assertSameOrigin.test.ts`, `rejectDuringTurn.test.ts`
- `withAdminAuth.test.ts`, `withAdminRoute.test.ts`, `withNoStore.test.ts`

Gaps: no direct tests for `requireBotToken.ts`, `requireModerator.ts` or `timingSafeCompare.ts`, and nothing asserts that routes use the helpers in order.

## Known issues and history

- Open: the 429 body code is the lowercase string `rate_limited` while the shared catalog uses `RATE_LIMITED` for status 429 (`rateLimit.ts` against `src/lib/errors/catalog.ts`). Clients that match on code should accept both.
- Open: because the in-memory and Mongo windows start at different times, a client can see the local window and Mongo window disagree about remaining quota.
- Changed (unknown IPs): the limiter used to skip identification-less requests; they now share `__unknown_ip__` (source comment in `rateLimit.ts` explains the bypass this closes).

Last checked: 2026-10-29, version 1.18.0
