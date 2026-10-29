# Moderator Accounts

## Overview

Moderator accounts are an intermediate auth role between admin and player. Admins can assign/remove moderator status from users. Moderators get their own panel at `/moderator` with a subset of admin functionality: player management, financial transaction review, content moderation and site tools. Additional tabs can be added with minimal effort.

This is a staff reference for contributors. It does not describe anything players can do.

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

Mod-facing routes that target a user refuse admin accounts with a 403. The check lives in each mod route, not in the auth guard (the guard checks who you are, the route checks who you are acting on).

## Moderator Panel

### Route Structure

- Page: `src/app/moderator/page.tsx`
- Auth: `getAuthModerator()` check, redirect to `/dashboard` if unauthorized
- Layout: Tab-based navigation using the same pattern as AdminTabs but with its own config

### Tabs

Five tabs: **Priority**, **Players**, **Transactions**, **Content** and **Site** (`src/components/moderator/tabs/ModeratorTabsConfig.tsx`). Mail Reports has its own page under `src/app/moderator/mail-reports/`. Adding more tabs means adding entries to the mod tab config and ensuring API routes accept moderator auth.

### Players Subtabs

| Subtab          | Component Strategy            | Differences from Admin                                      |
| --------------- | ----------------------------- | ----------------------------------------------------------- |
| Users           | Reuse/adapt admin `UsersTab`  | Admin accounts hidden from list, no account deletion button (no mod delete route exists) |
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

| Route group | Methods | Purpose |
| --- | --- | --- |
| `users` | GET | List users (admin accounts excluded) |
| `users/ban` | POST | Ban or unban a user (one route; the body selects) |
| `users/mod-notes` | POST | Add a mod note |
| `resources/grant`, `resources/characters` | POST, GET | Grant resources, look up characters |
| `achievements`, `achievements/grant` | GET, POST | List and grant achievements |
| `characters/update-state`, `update-country`, `update-positions` | POST | Adjust character state |
| `patreon/search`, `patreon/set-status` | GET, POST | Supporter status |
| `activity-log`, `suspicious`, `suspicious/[characterId]/dismiss` | GET, POST | Activity and flagged-account review |
| `audit-log` | GET | The mod action audit log |
| `financial-logs`, `financial-logs/alerts`, `financial-logs/[id]/review` | GET, POST | Transaction review |
| `mod-view` | POST | Audit a restricted page view |
| `news/[id]` | DELETE | Remove a news post |
| `player-ads`, `player-ads/[id]` | GET, PATCH, DELETE | Review banner ads |
| `supporter-requests`, `.../approve`, `.../reject` | GET, POST | Handle supporter requests |

Mutating routes write to `modAuditLog`; read-only routes do not. Mail report review uses `/api/admin/mail-reports` (see [Mail](./mail.md)), which also accepts moderators.

Every mutating mod route follows this pattern:

1. Call `requireModerator()`
2. Validate request body with Zod
3. Refuse admin targets
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

- Staff reach the panel from the staff menu (`src/components/StaffDropdown.tsx`); moderators see only the entries they can use (Mod Panel and Docs)

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

### Legacy `modNote` Field

The legacy `modNote` string remains on the `User` type for old data; new notes go to `modNotes[]`. A migration for old values converts as follows:

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

Last checked: 2026-10-29, version 1.18.0
