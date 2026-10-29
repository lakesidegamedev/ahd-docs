# Moderator Accounts

## Overview

Moderator accounts are an intermediate auth role between admin and player. Admins can assign/remove moderator status from users. Moderators get their own panel at `/moderator` with a subset of admin functionality - currently limited to player management. The system is designed so additional tabs can be added to the mod panel with minimal effort.

Mod notes and audit logs are shared between panels: admins see everything moderators do, and both roles can write mod notes with automatic attribution.

## Data Model

### User Document Changes

The `role` field on `User` expands from `"admin" | "player"` to:

```ts
role: "admin" | "moderator" | "player";
```

The `modNote?: string` field is replaced with a structured array:

```ts
modNotes?: ModNote[]
```

Where `ModNote` is:

```ts
interface ModNote {
  authorId: ObjectId;
  authorName: string;
  authorRole: "admin" | "moderator";
  text: string;
  createdAt: Date;
}
```

Both admins and moderators can add notes. All notes display in both the Admin Panel and Mod Panel with attribution (e.g., "ModeratorX - 2026-04-11: Note text").

### New Collection: `modAuditLog`

Tracks every privileged action a moderator takes. Admin actions are NOT logged here - this exists specifically for mod accountability.

```ts
interface ModAuditLogEntry {
  _id: ObjectId;
  moderatorId: ObjectId;
  moderatorName: string;
  action: string; // e.g. "ban_user", "unban_user", "add_mod_note", "grant_resources"
  targetUserId?: ObjectId;
  targetUsername?: string;
  details?: string; // human-readable context, e.g. "Banned for multiboxing"
  createdAt: Date;
}
```

No separate collection for moderator roster - moderators are queried via `{ role: "moderator" }` on the `users` collection.

## Auth System

### New Auth Guard: `requireModerator()`

Location: `src/lib/api/requireModerator.ts`

- Accepts users with `role: "moderator"` OR `role: "admin"` (admins inherit all mod privileges)
- Returns `{ ok: true; user: AuthUserWithCharacter }` on success
- Returns `{ ok: false; response: NextResponse }` with 403 on failure
- Follows the same pattern as `requireAdmin()`

### New Server Component Helper: `getAuthModerator()`

Location: `src/lib/auth.ts`

- Mirrors `getAuthAdmin()` - returns `AuthUserWithCharacter | null`
- Returns the user if `role === "moderator"` or `role === "admin"`, otherwise `null`
- Used for page-level protection on `/moderator` routes

### JWT Changes

No structural changes. The `role` field is already carried in the JWT payload via `userPayloadSchema`. The expanded role union is sufficient.

### Existing Guards Unchanged

- `requireAdmin()` - still only accepts `role: "admin"`, untouched
- `requireAuth()` / `requireBasicAuth()` / `requireAuthWithCharacter()` - unchanged, work for all roles
- `requireAdminOrApiKey()` - unchanged, admin-only

### Target Protection

Mod-facing API routes that target a user must check the target is not an admin:

```ts
const targetUser = await db.collection<User>("users").findOne({ _id: new ObjectId(targetUserId) });
if (targetUser?.role === "admin") {
  return NextResponse.json({ error: "Cannot perform actions on admin accounts" }, { status: 403 });
}
```

This check lives in each mod API route, not in the auth guard (the guard checks who you are, the route checks who you're targeting).

## Moderator Panel

### Route Structure

- Page: `src/app/moderator/page.tsx`
- Auth: `getAuthModerator()` check, redirect to `/dashboard` if unauthorized
- Layout: Tab-based navigation using the same pattern as AdminTabs but with its own config

### Tabs

Five tabs: **Priority**, **Players**, **Transactions**, **Content** and **Site** (`src/components/moderator/tabs/ModeratorTabsConfig.tsx`). Adding more tabs means adding entries to the mod tab config and ensuring API routes accept moderator auth.

### Players Subtabs

| Subtab          | Component Strategy            | Differences from Admin                                      |
| --------------- | ----------------------------- | ----------------------------------------------------------- |
| Users           | Reuse/adapt admin `UsersTab`  | Admin accounts hidden from list, no account deletion button |
| Grant Resources | Reuse `ResourceGrantManager`  | No differences                                              |
| Achievements    | Reuse `AchievementsTab`       | No differences                                              |
| Characters      | Reuse `CharacterStateManager` | No differences                                              |
| Patreon         | Reuse `PatreonManagementTab`  | No differences                                              |
| Activity Log    | Reuse `ActivityLogTab`        | No differences                                              |
| Suspicious      | Reuse `SuspiciousActivityTab` | No differences                                              |

### Component Reuse

Most admin player components can be reused directly. Where behavior differs (delete button visibility, admin account filtering), pass a `context: "admin" | "moderator"` prop. This avoids forking entire components while allowing targeted differences.

## API Routes

### Moderator Routes (`/api/moderator/`)

| Route                               | Method | Purpose                              | Audit Logged |
| ----------------------------------- | ------ | ------------------------------------ | ------------ |
| `/api/moderator/users`              | GET    | List users (excludes admin accounts) | No           |
| `/api/moderator/users/ban`          | POST   | Ban a user                           | Yes          |
| `/api/moderator/users/unban`        | POST   | Unban a user                         | Yes          |
| `/api/moderator/users/mod-notes`    | POST   | Add a mod note                       | Yes          |
| `/api/moderator/resources/grant`    | POST   | Grant resources to a player          | Yes          |
| `/api/moderator/achievements`       | GET    | List achievements                    | No           |
| `/api/moderator/achievements/grant` | POST   | Grant achievement                    | Yes          |
| `/api/moderator/characters`         | GET    | List/view characters                 | No           |
| `/api/moderator/characters/update`  | POST   | Update character state               | Yes          |
| `/api/moderator/patreon`            | GET    | View Patreon info                    | No           |
| `/api/moderator/patreon/update`     | POST   | Update Patreon tier                  | Yes          |
| `/api/moderator/activity-log`       | GET    | View activity log                    | No           |
| `/api/moderator/suspicious`         | GET    | View suspicious activity             | No           |
| `/api/moderator/audit-log` | GET | List the mod action audit log | No |
| `/api/moderator/financial-logs` | GET | Paginated financial transaction log | No |
| `/api/moderator/financial-logs/alerts` | GET | Suspect alert summary by entity | No |
| `/api/moderator/financial-logs/[id]/review` | POST | Mark a financial log reviewed | Yes |
| `/api/moderator/mod-view` | POST | Audit unlocking a restricted page view | Yes |
| `/api/moderator/news/[id]` | DELETE | Delete a player news post | Yes |
| `/api/moderator/player-ads` | GET | List banner ads for review | No |
| `/api/moderator/player-ads/[id]` | PATCH/DELETE | Update or remove a banner ad | Yes |
| `/api/moderator/supporter-requests` | GET | List supporter requests | No |
| `/api/moderator/supporter-requests/[id]/approve` | POST | Approve a supporter request | Yes |
| `/api/moderator/supporter-requests/[id]/reject` | POST | Reject a supporter request | Yes |

Every mutating mod route follows this pattern:

1. Call `requireModerator()`
2. Validate request body with Zod
3. Check target user is not an admin
4. Perform the action
5. Write entry to `modAuditLog`
6. Return response

### Admin-Only Moderator Management Routes (`/api/admin/moderators/`)

| Route                             | Method | Purpose                                      |
| --------------------------------- | ------ | -------------------------------------------- |
| `/api/admin/moderators`           | GET    | List all moderators                          |
| `/api/admin/moderators/assign`    | POST   | Assign moderator role to a user              |
| `/api/admin/moderators/remove`    | POST   | Remove moderator role (set back to "player") |
| `/api/admin/moderators/audit-log` | GET    | View mod audit log (filterable, paginated)   |

These use `requireAdmin()`. Moderators cannot assign/remove other moderators.

## Admin Panel Changes

### New Subtabs under Admin > Players

**Moderators subtab:**

- Lists all users with `role: "moderator"` - shows username, assigned date, character name
- "Assign Moderator" action: search for a user by username, confirm dialog, sets role to `"moderator"`
- "Remove Moderator" action: button per mod, confirm dialog, sets role back to `"player"`
- Cannot assign moderator to another admin

**Mod Audit Log subtab:**

- Chronological list from `modAuditLog` collection, most recent first
- Columns: timestamp, moderator name, action type, target user, details
- Filterable by moderator and/or action type
- Paginated

## Navbar & Visibility

### Navbar

- Moderators see a "Mod Panel" link in the navbar (same position/style as the "Admin Panel" link)
- Admins do NOT see a "Mod Panel" link - Admin Panel is a superset
- The link uses the same styling pattern as the admin link but points to `/moderator`

### Profile Badge

- Moderator badge: blue pill using `info` design tokens
  - Classes: `rounded-full border border-info/30 bg-info/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-info sm:px-2 sm:text-[10px]`
  - Text: "Moderator"
- Displayed in the same badge row as the existing Admin badge on profile headers
- Also shown in player lists (politicians page, state player lists)
- Visible to all players (public)

### Admin Badge (existing, unchanged)

- Gold/amber pill: `border-warning/30 bg-warning/10 text-warning`
- Text: "Admin"

## Migration

### Existing `modNote` Field

Users with an existing `modNote` string value need migration to the new `modNotes[]` array format. Migration script should:

1. Find all users where `modNote` exists and is non-empty
2. Convert each to a single-entry `modNotes` array: `{ authorId: adminId, authorName: "System (migrated)", text: modNote, createdAt: user.updatedAt }`
3. Unset the old `modNote` field

No users need role migration - all existing users remain `"admin"` or `"player"` as-is.

## Gameplay Impact

None. Moderator status has zero effect on gameplay mechanics - elections, legislation, campaigns, NPP behavior, etc. are completely unaware of the moderator role. Mods play the game as normal players with their characters.

## Extensibility

Adding new tabs to the mod panel in the future:

1. Add tab entry to the mod panel tab config
2. Create or reuse the component
3. Add corresponding `/api/moderator/` routes with `requireModerator()` guard
4. No auth system changes needed
