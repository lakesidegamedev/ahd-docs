# API Middleware Layer

## Overview

The API Middleware Layer provides infrastructure for building safe, consistent, and secure API routes. Located in `src/lib/api/`, it handles authentication, authorization, rate limiting, validation, and error handling.

**Location:** `src/lib/api/`

**Key files:**

- `requireAuth.ts` - Authentication helpers
- `requireAdmin.ts` - Admin authorization
- `requireCron.ts` - Cron job verification
- `rateLimit.ts` - In-memory rate limiting
- `rateLimit.mongo.ts` - Mongo-backed durable limiter (`durableRateLimit`) for high-value buckets
- `validate.ts` - Zod schema validation
- `errors.ts` - Structured error handling
- `schemas/` - Shared Zod schemas

The directory also holds many more role and request gates (for example `requireAdminOrApiKey.ts`, `requireBotToken.ts`, `requireModerator.ts`, `rejectDuringTurn.ts`, `assertSameOrigin.ts`); list `src/lib/api/` for the full set.

## Authentication Helpers

### `requireAuth()`

**Purpose:** Require authenticated user with optional character data.

**Returns:**

```typescript
type AuthResult = { ok: true; user: AuthUserWithCharacter } | { ok: false; response: NextResponse };
```

**Usage:**

```typescript
const auth = await requireAuth();
if (!auth.ok) return auth.response;
// auth.user has userId, username, character (if exists)
```

**Implementation:**

```typescript
export async function requireAuth(): Promise<AuthResult> {
  const user = await getAuthUserWithCharacter();
  if (!user) {
    return { ok: false, response: NextResponse.json(unauthorized().toJson(), { status: 401 }) };
  }
  return { ok: true, user };
}
```

### `requireBasicAuth()`

**Purpose:** Fast authentication without character lookup. Use when character data is not needed.

**Returns:**

```typescript
type BasicAuthResult = { ok: true; user: AuthUser } | { ok: false; response: NextResponse };
```

**Usage:**

```typescript
const auth = await requireBasicAuth();
if (!auth.ok) return auth.response;
// auth.user has userId, username, email, role, isAdmin
```

### `requireAuthWithCharacter()`

**Purpose:** Require authenticated user with guaranteed character data.

**Returns:**

```typescript
type AuthWithCharacterResult =
  | { ok: true; user: AuthUserWithCharacter & { hasCharacter: true; character: Character } }
  | { ok: false; response: NextResponse };
```

**Usage:**

```typescript
const auth = await requireAuthWithCharacter();
if (!auth.ok) return auth.response;
// auth.user.character is guaranteed
```

## Authorization Helpers

### `requireAdmin()`

**Purpose:** Require admin-level authorization for `/api/admin/*` routes.

**Returns:**

```typescript
type AdminAuthResult =
  | { ok: true; admin: AuthUserWithCharacter }
  | { ok: false; response: NextResponse };
```

**Usage:**

```typescript
const admin = await requireAdmin();
if (!admin.ok) return admin.response;
// admin.admin.isAdmin is true
```

**Critical:** Never use `getAuthUser()` with `if (!user?.isAdmin)` for admin checks. Always use `requireAdmin()` for DB-authoritative checks.

### `requireCron()`

**Purpose:** Verify cron job authorization via `CRON_SECRET`.

**Returns:** `boolean`

**Usage:**

```typescript
if (!requireCron(request)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

**Header format:** `Authorization: Bearer ${CRON_SECRET}`

## Rate Limiting

### `checkRateLimit()`

**Purpose:** In-memory rate limiting per identifier (usually IP).

**Parameters:**

- `identifier` - Usually client IP address
- `maxRequests` - Max requests per window (default: 100)
- `windowMs` - Window duration in ms (default: 60,000 = 1 minute)

**Returns:**

```typescript
{ ok: true } | { ok: false; retryAfter: number }
```

**Usage:**

```typescript
const rateLimit = checkRateLimit(clientIp, 100, 60000);
if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
```

**Implementation:**

```typescript
export function checkRateLimit(
  identifier: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS
): { ok: boolean; retryAfter?: number } {
  if (!identifier || identifier === "unknown") return { ok: true };

  const now = Date.now();
  if (store.size > 10_000) prune();

  let entry = store.get(identifier);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(identifier, entry);
  }

  entry.count++;
  if (entry.count > maxRequests) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { ok: true };
}
```

### Predefined Rate Limits

```typescript
// Auth endpoints (brute force mitigation)
AUTH_LIMITS = { maxRequests: 10, windowMs: 60_000 };

// Feedback (spam prevention)
FEEDBACK_LIMITS = { maxRequests: 5, windowMs: 60_000 };

// Congress actions (propose, vote, cosponsor, withdraw)
CONGRESS_LIMITS = { maxRequests: 30, windowMs: 60_000 };

// Election actions (enter, withdraw, vote)
ELECTION_LIMITS = { maxRequests: 20, windowMs: 60_000 };

// Discord bot read endpoints
BOT_READ_LIMITS = { maxRequests: 60, windowMs: 60_000 };

// Discord bot financial endpoints
BOT_FINANCIAL_LIMITS = { maxRequests: 30, windowMs: 60_000 };

// Discord bot casino endpoints (per user, plus a global cap)
BOT_CASINO_LIMITS = { maxRequests: 30, globalMaxRequests: 600, windowMs: 60_000 };
```

### `rateLimitResponse()`

**Purpose:** Build standard 429 response.

**Usage:**

```typescript
if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
```

**Response format:**

```json
{ "error": "Too many requests. Try again later." }
```

Headers: `Retry-After: <seconds>`

## Request Validation

### `parseJsonBody()`

**Purpose:** Parse and validate JSON request body with Zod.

**Parameters:**

- `request` - Incoming Request
- `schema` - Zod schema

**Returns:**

```typescript
| { success: true; data: T }
| { success: false; error: string; status: 400 }
```

**Usage:**

```typescript
const schema = z.object({
  name: z.string().min(1),
  amount: z.number().positive(),
});

const parsed = await parseJsonBody(request, schema);
if (!parsed.success) {
  return NextResponse.json({ error: parsed.error }, { status: 400 });
}
// parsed.data is typed
```

### `parseBoundedIntParam()`

**Purpose:** Parse positive integer from URLSearchParams with clamping.

**Parameters:**

- `searchParams` - URLSearchParams
- `key` - Parameter name
- `defaultValue` - Default if missing/invalid
- `min`, `max` - Clamping bounds

**Usage:**

```typescript
const page = parseBoundedIntParam(searchParams, "page", 1, 1, 100);
const limit = parseBoundedIntParam(searchParams, "limit", 20, 1, 50);
```

### Shared Schemas

```typescript
export const schemas = {
  objectId: z.string().regex(HEX_OBJECT_ID_REGEX, "Invalid ID format"),
  nppObjectId: z.string().regex(HEX_OBJECT_ID_REGEX, "Invalid NPP ID format"),
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password required"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
};
```

## Error Handling

### `ApiError` Class

**Purpose:** Structured error with status code, message, and optional details.

**Properties:**

- `status` - HTTP status code
- `message` - Error message
- `code` - Error code string
- `details` - Optional additional details

**Methods:**

- `toJson()` - Convert to JSON response body

### Error Factories

```typescript
badRequest(message: string, details?: unknown): ApiError
// Status: 400, Code: BAD_REQUEST

unauthorized(message?: string): ApiError
// Status: 401, Code: UNAUTHORIZED

forbidden(message?: string): ApiError
// Status: 403, Code: FORBIDDEN

notFound(message?: string): ApiError
// Status: 404, Code: NOT_FOUND

internalError(message?: string, cause?: unknown): ApiError
// Status: 500, Code: INTERNAL_ERROR
// Logs to Sentry
```

### `handleRouteError()`

**Purpose:** Catch-all error handler for API routes.

**Usage:**

```typescript
export async function POST(request: Request) {
  try {
    // ... route logic
  } catch (error) {
    return handleRouteError(error);
  }
}
```

**Behavior:**

- If `ApiError`: returns JSON response with error details
- If other error: logs to Sentry, returns generic 500

**Implementation:**

```typescript
export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(error.toJson(), { status: error.status });
  }
  console.error("[API] Unhandled error:", error);
  Sentry.captureException(error);
  const apiErr = internalError(
    process.env.NODE_ENV === "development" && error instanceof Error
      ? error.message
      : "Internal server error",
    error
  );
  return NextResponse.json(apiErr.toJson(), { status: 500 });
}
```

## Standard Route Pattern

Every API route follows this structure:

```typescript
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, CONGRESS_LIMITS } from "@/lib/api/rateLimit";
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
      return NextResponse.json({ error: parsed.error }, { status: 400 });
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

## Dynamic Route Params (Next.js 16)

```typescript
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // ALWAYS await params
  // ... use id
}
```

## Auth Helper Selection

| Helper                       | Location                 | Returns                                  | Use For                       |
| ---------------------------- | ------------------------ | ---------------------------------------- | ----------------------------- |
| `requireAuth()`              | `@/lib/api/requireAuth`  | `{ ok, user }` with optional character   | Most player routes            |
| `requireBasicAuth()`         | `@/lib/api/requireAuth`  | `{ ok, user }` without character         | Fast auth-only checks         |
| `requireAuthWithCharacter()` | `@/lib/api/requireAuth`  | `{ ok, user }` with guaranteed character | Routes needing character data |
| `requireAdmin()`             | `@/lib/api/requireAdmin` | `{ ok, admin }`                          | `/api/admin/*` routes         |
| `requireCron(request)`       | `@/lib/api/requireCron`  | `boolean`                                | Cron-triggered routes         |

## Security Considerations

1. **Always use `require*` helpers** - Never manually check auth with `if (!user?.isAdmin)` patterns
2. **Rate limit user-facing actions** - Especially auth, feedback, congress, election endpoints
3. **Validate all inputs** - Use `parseJsonBody()` with Zod schemas
4. **Use structured errors** - Throw `ApiError` subclasses, not raw errors
5. **Admin routes require `requireAdmin()`** - DB-authoritative check, not just `isAdmin` flag

## Related Systems

- **Auth:** `src/lib/auth.ts` - Core auth with JWT via `jose`
- **MongoDB:** `src/lib/mongodb.ts` - `getDb()` connection
- **Sentry:** Error tracking integration
