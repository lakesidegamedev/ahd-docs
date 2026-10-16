# AHD Desktop Client Integration Guide

This document covers everything a desktop client (Electron/Tauri) needs to integrate with the A House Divided web API.

Deployment is on **Railway** (development → staging → main), not Vercel.

---

## Authentication

AHD uses **HTTP-only JWT cookies** for player authentication. The cookie name is deployment-specific: `auth-token-<service-tag>`, derived from `RAILWAY_SERVICE_NAME` or `RAILWAY_ENVIRONMENT_NAME`, and falls back to `auth-token-local`. Clients must store the cookie from `Set-Cookie` rather than hardcoding its name.

**For the desktop client:**

- Use a persistent cookie jar (e.g., Electron's `session.cookies` or a custom `tough-cookie` jar with `axios`)
- Log in via `POST /api/auth/login`, the cookie is set automatically in the response
- All authenticated requests must include the cookie; there is no Bearer token alternative for player routes
- The read-only public v1 API separately accepts `X-API-Key` or `X-Bot-Token`; those headers are not a general replacement for the player cookie on authenticated game routes

**Login request:**

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "email-or-username", "password": "..." }
```

**Response:**

```json
{
  "message": "Login successful",
  "user": {
    "id": "...",
    "email": "...",
    "username": "...",
    "displayName": "...",
    "role": "player",
    "hasCompletedSetup": true,
    "isAdmin": false
  }
}
```

The response's `Set-Cookie` header sets the deployment-specific auth cookie. Preserve cookie attributes and send it back only where the cookie jar's domain and path rules allow.

---

## Core Navigation Endpoint

`GET /api/client-nav`, no auth required (returns guest manifest if unauthenticated)

This is the primary polling endpoint for the client. Poll it every 30-60 seconds to keep the UI in sync.

### Response Shape

```ts
interface ClientNavResponse {
  user: { username: string; isAdmin: boolean } | null;
  hasCharacter: boolean;
  characterCountryId: string | null; // use the returned CountryId; do not hardcode a list
  unreadCount: number; // unread notifications
  unreadMailCount: number; // unread player mail
  homeState: { id: string; name: string } | null;
  currentParty: { id: string; name: string } | null;
  activeElection: {
    id: string;
    seatId?: string;
    label: string; // e.g. "U.S. Senate, CA"
  } | null;
  activePresidentElectionId: string | null;
  activePresidentElectionSeatId: string | null;
  missingDemographics: boolean;
}
```

This is a minimum integration view, not an exhaustive schema. The route also carries feature-gated navigation and role fields such as corporation, union, cabinet, governor, imperial-character, wiki, conflict, and season-recap state. Clients must ignore unknown additive fields.

`client-nav` does **not** carry funds, actions, cash-on-hand, or projected income, those are served by `GET /api/client-status`, the status-bar endpoint.

### `projectedIncome` (on `GET /api/client-status`)

```
projectedIncome = (50000 + donorBaseLevel * 2000) * (1 + politicalInfluence / 100)
```

`projectedIncome` is `calculateFundraisingAmount(donorBaseLevel,
character.politicalInfluence)`. The helper's second parameter is named
`stateInfluence`, but this status-bar call site passes Political Influence:
1.0x at 0 and 2.0x at 100. This is the per-use Fundraise action yield.

---

## Theme Settings

`PATCH /api/settings/theme`, requires auth cookie

### Request

```http
PATCH /api/settings/theme
Content-Type: application/json

{ "theme": "oled" }
```

### Response

```json
{ "success": true }
```

### Internal event emit (not client-facing)

After a successful PATCH, the server calls `emit({ type: "theme_changed", ... })` on an in-process event bus (`src/lib/events.ts`). **This emitter has no HTTP consumer**, there is no route that streams it to a client. It exists as internal plumbing only.

**Do not build an SSE/EventSource integration for theme sync.** Poll instead: re-fetch `/api/client-nav` after any theme change action, or on a short interval.

---

## No SSE Event Stream

**`GET /api/events` is not an SSE endpoint.** It is a REST resource for the in-game "events" (crisis/random-event) system, `GET /api/events/active` and `POST /api/events/[id]/resolve`, unrelated to real-time client sync. There is no `text/event-stream` endpoint anywhere in the public API surface, and no `EventSource`-based integration is possible today.

For turn updates, election results, and any other near-real-time state, **poll the relevant REST endpoint** (see Polling Recommendations below) rather than expecting a push channel.

---

## Error Codes

`GET /api/error-codes`, no auth required

Returns a static versioned catalog. Cache it at startup; re-fetch if `version` changes.

### Response

```json
{
  "version": "1",
  "errors": [
    {
      "code": "BAD_REQUEST",
      "httpStatus": 400,
      "category": "validation",
      "message": "Invalid request data"
    },
    {
      "code": "UNAUTHORIZED",
      "httpStatus": 401,
      "category": "auth",
      "message": "Authentication required"
    },
    {
      "code": "FORBIDDEN",
      "httpStatus": 403,
      "category": "auth",
      "message": "Forbidden"
    },
    {
      "code": "NOT_FOUND",
      "httpStatus": 404,
      "category": "not_found",
      "message": "Resource not found"
    },
    {
      "code": "INTERNAL_ERROR",
      "httpStatus": 500,
      "category": "system",
      "message": "Internal server error"
    }
  ]
}
```

### Error response shape (all error responses)

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE" }
```

Always check `code` for programmatic handling; `error` is for display.

---

## Rate Limits

Limits are route-family specific and can change as abuse controls evolve. Respect `429`, `Retry-After`, and any `X-RateLimit-*` response headers instead of encoding one global limit. Authentication routes use the strict auth bucket, while player writes and public reads use their own buckets.

Rate-limited responses return `429` with a `Retry-After` header (seconds).

---

## Polling Recommendations

There is no push channel for the desktop client, poll for all near-real-time state:

| Data                                | Recommended approach                                  |
| ----------------------------------- | ----------------------------------------------------- |
| Nav state (unread, party, election) | Poll `/api/client-nav` every 60s                      |
| Funds, actions, projected income    | Poll `/api/client-status` every 60s                   |
| Theme sync                          | Re-fetch `/api/client-nav` after PATCH                |
| Turn updates / election results     | Poll the relevant status endpoint on a short interval |
