# API Conventions

Standard patterns for API routes in A House Divided.

## Admin Routes

- **Auth:** Use `requireAdmin()` from `@/lib/api/requireAdmin` at the start of handlers.
- **Status code:** Return 403 (Forbidden) when the user is not an admin.
- **Pattern:**
  ```typescript
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth; // when you need admin.userId, admin.username, etc.
  ```
- **Wrapper alternatives:** `withAdminAuth(handler)` from `@/lib/api/withAdminAuth` runs the same check and passes the narrowed `auth` as the handler's first argument; it does not add error handling. `withAdminRoute(handler)` in the same file also wraps the handler in the standard error boundary.

## Error Handling

- **Pattern:** Wrap the handler body in `try`/`catch` and call `handleRouteError(error)` from `@/lib/api/errors` in the `catch` block. There is no `withRouteError` wrapper; each route writes its own try/catch.
  ```typescript
  export async function GET(request: Request) {
    try {
      // ... handler body
    } catch (error) {
      return handleRouteError(error);
    }
  }
  ```
- **Expected errors:** Throw `ApiError` (or its helpers `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `internalError`) from `@/lib/api/errors` for 4xx/5xx. `handleRouteError` recognizes `ApiError` and returns its `status`/JSON body directly. Expected 4xx errors are intentionally not sent to Sentry.
- **Uncaught errors:** Anything that isn't an `ApiError` is tagged, sent to Sentry via `Sentry.captureException` and `alertOps`, logged, and returned as a generic 500 (`internalError().toJson()`). Pass `{ request, route, extra }` as the optional second argument to tag the Sentry event with the endpoint, method and entity ids.

## Cron Routes

- **Auth:** Use `requireCron(request)` from `@/lib/api/requireCron`.
- **Header:** `Authorization: Bearer ${CRON_SECRET}`
- **Return value:** `requireCron` returns a boolean, not a response. The route returns 401 itself when it is false. It is false when `CRON_SECRET` is unset or the header does not match.

## Status Codes

| Code | Use case                                     |
| ---- | -------------------------------------------- |
| 400  | Bad request (`badRequest`)                   |
| 401  | Not authenticated (no valid token)           |
| 403  | Authenticated but forbidden (e.g. not admin) |
| 404  | Resource not found                           |
| 409  | Conflict (`conflict`)                        |
| 429  | Rate limited                                 |
| 500  | Internal error (`internalError`)             |

## Cron vs Admin

Some routes (e.g. `/api/elections/snapshot`) allow both cron and admin auth. Check cron first with `requireCron(request)`; if false, fall back to `requireAdmin()`.

## Admin or API Key

Scripts can call some admin routes with an `X-Api-Key` header instead of a session. Use `requireAdminOrApiKey(request)` from `@/lib/api/requireAdminOrApiKey`. A wrong key returns 401, a missing session returns 403, and a server without `INTERNAL_API_KEY` configured returns 500.

Last checked: 2026-10-29, version 1.18.0
