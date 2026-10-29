# Moderator Accounts

## Summary

Moderator accounts are an intermediate auth role between admin and player. Admins can assign/remove moderator status from users. Moderators get their own panel at `/moderator` with a subset of admin functionality: player management, financial transaction review, content moderation and site tools. Additional tabs can be added with minimal effort.

This is a staff reference for contributors. It does not describe anything players can do, so there is no player guide to link to; players only see a moderator label in a few player lists (see Connections).

Mod notes and audit logs are shared between panels: admins see everything moderators do, and both roles can write mod notes with automatic attribution.

## Rules

Role and privilege rules:

| Rule | Value | Source |
| --- | --- | --- |
| `User.role` union | `"admin" \| "moderator" \| "player"` | `src/lib/db/types/user.ts` |
| Admin test | `user.isAdmin === true \|\| user.role === "admin"` | `mapUserToAuthUser` in `src/lib/auth.ts` |
| Moderator test | `isModerator = isAdmin \|\| user.role === "moderator"` (admins inherit mod privileges) | `src/lib/auth.ts` |
| Privilege source | The current database account record. A verified token only identifies the account, so a stale token never re-grants staff access after a demotion | `src/lib/auth.ts`, `src/lib/auth.accountPrivileges.test.ts` |
| Mod note text length | 1 to 2000 characters, trimmed | `src/app/api/moderator/users/mod-notes/route.ts` |
| Audit `details` for a note | first 200 characters of the note | same file |
| Default ban reason | `"Violation of rules"` | `src/app/api/moderator/users/ban/route.ts` |
| Mod audit log page size | default 50, max 100 | `src/app/api/moderator/audit-log/route.ts`, `src/app/api/admin/moderators/audit-log/route.ts` |
| Moderator list page size | default 100, max 500 | `src/app/api/admin/moderators/route.ts` |

### Auth guards

**`requireModerator()`**, location `src/lib/api/requireModerator.ts`:

- Accepts users with `role: "moderator"` OR `role: "admin"` (admins inherit all mod privileges)
- Returns `{ ok: true; user: AuthUserWithCharacter }` on success
- Returns `{ ok: false; response: NextResponse }` with 403 on failure
- Follows the same pattern as `requireAdmin()`

**`getAuthModerator()`**, location `src/lib/auth.ts`:

- Mirrors `getAuthAdmin()` - returns `AuthUserWithCharacter | null`
- Returns the user if `isModerator` is true (role `moderator` or admin), otherwise `null`
- Used for page-level protection on `/moderator` routes

**JWT:** no structural changes. The `role` field is already carried in the JWT payload via `userPayloadSchema`, and the expanded union is sufficient. The role in the token is not trusted for privilege (see table above).

**Existing guards unchanged:**

- `requireAdmin()` - still only accepts `role: "admin"`, untouched
- `requireAuth()` / `requireBasicAuth()` / `requireAuthWithCharacter()` - unchanged, work for all roles
- `requireAdminOrApiKey()` - unchanged, admin-only

### Target protection

Mod-facing routes that target a user refuse admin accounts with a 403. The check lives in each mod route, not in the auth guard (the guard checks who you are, the route checks who you are acting on). Routes that refuse admin targets (`role === "admin"`): `users/ban`, `users/mod-notes`, `characters/update-state`, `update-country`, `update-positions`, `patreon/set-status`, and `news/[id]` (by author). `users` and `patreon/search` exclude admin accounts from their results. A moderator also cannot ban themselves (400).

The admin routes `assign` and `remove` apply their own rules: you cannot assign the role to an admin or to someone who already has it (400), and you cannot remove it from someone who is not a moderator (400).

### Moderator panel

- Page: `src/app/moderator/page.tsx`
- Auth: `getAuthModerator()` check, redirect to `/dashboard` if unauthorized
- Layout: tab-based navigation using the same pattern as AdminTabs but with its own config (`src/components/ModeratorTabs.tsx`)

**Tabs.** Five tabs: **Priority**, **Players**, **Transactions**, **Content** and **Site** (`src/components/moderator/tabs/ModeratorTabsConfig.tsx`). Mail Reports has its own page under `src/app/moderator/mail-reports/` as well as a Content subtab. Adding more tabs means adding entries to the mod tab config and ensuring API routes accept moderator auth.

**Players subtabs** (`VALID_MOD_SUBS.players`):

| Subtab | Component Strategy | Differences from Admin |
| --- | --- | --- |
| Users | Reuse/adapt admin `UsersTab` (`context="moderator"`) | Admin accounts hidden from list, no account deletion button (no mod delete route exists), identity signals shown as hashed keys with raw IPs and fingerprints nulled |
| Achievements | Reuse `AchievementsTab` | No differences |
| Characters | Reuse `CharacterStateManager` | No differences |
| Patreon | Reuse `PatreonManagementTab` | No differences |
| Activity log | Reuse `ActivityLogTab` | No differences |
| Suspicious | Reuse `SuspiciousActivityTab` | No differences |
| Audit log | `ModAuditLogTab` with `apiBase="/api/moderator"` | Moderators see only their own entries (see Edge cases) |

**Content subtabs:** news, banner-ads, wiki, wiki-review, supporter-requests, mail-reports, player-reports. **Site tab:** `TurnPausePanel` and `RegistrationControlsPanel`. **Transactions tab:** the financial ledger panel with `apiBase="/api/moderator/financial-logs"`.

**Component reuse.** Most admin player components can be reused directly. Where behavior differs (delete button visibility, admin account filtering), pass a `context: "admin" | "moderator"` prop. This avoids forking entire components while allowing targeted differences. `ResourceGrantManager` accepts the same prop and the `resources/grant` route exists, but the moderator Players tab in this release does not render it (see Known issues).

### API routes

**Moderator routes (`/api/moderator/`):**

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

Mutating routes write to `modAuditLog`; read-only routes do not. Mail report review uses `/api/admin/mail-reports` (see [Mail](./mail.md)), which also accepts moderators through `requireModerator()`.

Every mutating mod route follows this pattern:

1. Call `requireModerator()`
2. Validate request body with Zod
3. Refuse admin targets
4. Perform the action
5. Write entry to `modAuditLog`
6. Return response

Audit action names written by the routes: `ban_user`, `unban_user`, `add_mod_note`, `grant_resources`, `grant_achievement`, `set_patreon_status`, `update_character_state`, `update_character_country`, `update_character_positions`, `review_financial_tx_flag`, `delete_news_post`, `toggle_player_ad`, `delete_player_ad`, `approve_supporter_request`, `reject_supporter_request`, plus `view_private_corporation`, `admin_view_private_corporation` and `view_party_mod_view` from `mod-view`. Suspicious-flag dismissal also writes through `createModAuditLog`.

**Admin-only moderator management routes (`/api/admin/moderators/`):**

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/admin/moderators` | GET | List all moderators |
| `/api/admin/moderators/assign` | POST | Assign moderator role to a user |
| `/api/admin/moderators/remove` | POST | Remove moderator role (set back to "player") |
| `/api/admin/moderators/audit-log` | GET | View mod audit log (filterable, paginated) |

These use `requireAdmin()`. Moderators cannot assign/remove other moderators.

### Admin panel additions

New subtabs under Admin > Players (`src/components/admin/tabs/AdminPlayersTab.tsx`):

**Moderators subtab** (`ModeratorsManagementTab`):

- Lists all users with `role: "moderator"` - shows username, assigned date, character name
- "Assign Moderator" action: search for a user by username, confirm dialog, sets role to `"moderator"`
- "Remove Moderator" action: button per mod, confirm dialog, sets role back to `"player"`
- Cannot assign moderator to another admin

**Mod Audit Log subtab** (`ModAuditLogTab`, default `apiBase` `/api/admin/moderators`):

- Chronological list from `modAuditLog` collection, most recent first
- Columns: timestamp, moderator name, action type, target user, details
- Filterable by moderator and/or action type
- Paginated (cursor on `_id`)

### Navbar and visibility

**Navbar.** Staff reach the panel from the staff menu (`src/components/StaffDropdown.tsx`, items built in `src/components/navbar/staffNavItems.ts`); moderators see only the entries they can use (Mod Panel and Docs). Admins also see Admin Panel, Ops Dashboard, Tickets and Suggestions.

**Moderator badge:** blue pill using `info` design tokens, text "Moderator". In the politicians list (`src/app/country/[code]/politicians/PoliticiansClient.tsx`) the classes are `rounded-full border border-info/30 bg-info/10 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-info`, shown only when the person is a moderator and not an admin. State player lists show plain "Moderator" text (`src/components/state/politics/PlayersList.tsx`, `src/components/state/overview/PlayerRoster.tsx`). Visible to all players (public).

**Admin badge (existing, unchanged):** gold/amber pill, `border-warning/30 bg-warning/10 text-warning`, text "Admin".

### Extensibility

Adding new tabs to the mod panel in the future:

1. Add tab entry to the mod panel tab config
2. Create or reuse the component
3. Add corresponding `/api/moderator/` routes with `requireModerator()` guard
4. No auth system changes needed

## Data

| Collection | Field | Read | Written | Player visible |
| --- | --- | --- | --- | --- |
| `users` | `role` | every auth resolution, moderator list | assign and remove routes | Only as a badge or label in some player lists |
| `users` | `moderatorSince` | moderator list | set on assign, unset on remove | No |
| `users` | `modNotes[]` | mod panels | mod-notes routes (`$push`) | No |
| `users` | `modNote` (legacy string) | mod panels, migration on next note | legacy admin route `PATCH /api/admin/users/mod-note` | No |
| `users` | `isBanned`, `banReason`, `bannedAt`, `bannedShareReleaseCorporationIds` | auth (banned users are rejected) | ban route | Ban reason is staff only |
| `modAuditLog` | whole entry | audit log routes | `createModAuditLog` in `src/lib/modAuditLog.ts` | No |
| `actionAuditLog` | `action: "mod.<action>"` envelope with `refs.modAuditLogId` | forensics views | mirrored by `createModAuditLog` through `recordAudit` | No |
| `adminLog` | `moderator_assigned`, `moderator_removed` | admin logs | assign and remove routes via `createAdminLog` | No |

The `role` field on `User` expands from `"admin" | "player"` to:

```ts
role: "admin" | "moderator" | "player";
```

The `modNote?: string` field is replaced with a structured array:

```ts
modNotes?: ModNote[]
```

Where `ModNote` is (`src/lib/db/types/user.ts`):

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

**Collection `modAuditLog`** (`src/lib/db/types/modAuditLog.ts`). Tracks every privileged action taken through a mod route. The mod routes accept admins too (`requireModerator()` admits them), so an admin who uses a mod route is also logged here; admin actions on admin-only routes are not.

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

No separate collection for moderator roster - moderators are queried via `{ role: "moderator" }` on the `users` collection. `modAuditLog` is in the `preserved` category of the seed manifest (`src/lib/admin/seed/seedManifestPreserved.ts`), so reseeds keep it.

## Configuration

Moderator accounts have no `gameConfig` fields, era or country presets, scenario overrides or feature flags.

| Setting | Default | Where it is set |
| --- | --- | --- |
| Who is a moderator | `role: "player"` for everyone | Admin assign route; no seed or environment grant |
| Docs link shown in the staff menu | `https://docs.lakesidegames.net` unless `NEXT_PUBLIC_DOCS_URL` is set | `src/components/navbar/staffNavItems.ts` |
| Ops Dashboard menu item | Hidden when `OPS_DASHBOARD_URL` is empty | `src/components/navbar/staffNavItems.ts` (admins only) |
| User document cache TTL (affects how fast a role change lands) | 10 seconds | `TTL_MS` in `src/lib/auth/userDocCache.ts` |
| Audit mirror into `actionAuditLog` | Flag-gated, fire-and-forget | `recordAudit` in `src/lib/audit/recordAudit.ts` |

## Timing

Moderator accounts run per request, not per turn. No turn phase reads or writes them, and moderator status is not an input to any simulation formula.

```text
Request:  auth (DB role, 10 s user cache)
            -> requireModerator
            -> Zod body validation
            -> self-target check, load target, admin-target check
            -> write (users / characters / ...)
            -> cascades (ban only: withdraw candidacies, party cleanup, flags sync)
            -> invalidateCachedUser (ban only)
            -> createModAuditLog (modAuditLog, then actionAuditLog mirror)
            -> response
```

The audit entry is written after the action, and a failed audit write is logged and swallowed, so the action stands even if its audit row is missing.

A role change takes effect on the next request that misses the 10 second user cache. The ban route calls `invalidateCachedUser`; the assign and remove routes do not, so a demotion can lag by up to the cache TTL on the instance that cached the user.

## Worked trace

Input: moderator "ModX" (role `moderator`) bans user "Target" (role `player`) with reason "Multiboxing".

| Step | What happens | Stored or returned |
| --- | --- | --- |
| 1 | `getAuthModerator()` loads ModX from the database: `isAdmin` false, `role` moderator, so `isModerator` is true | auth passes |
| 2 | Zod `adminBanUserSchema`: `{ userId, ban: true, reason: "Multiboxing" }` | valid |
| 3 | Self check: `moderator.userId !== userId` | passes |
| 4 | Load Target; `role` is `player`, not `admin` | passes |
| 5 | Load Target's character and CEO corporation ids | `bannedShareReleaseCorporationIds` set |
| 6 | `users.updateOne` | `isBanned: true`, `banReason: "Multiboxing"`, `bannedAt: now`, `updatedAt: now`; `bannedShareReleaseProcessedAt` unset |
| 7 | Cascades | candidacies withdrawn, party elections cleaned, party leadership vacated, party membership stripped |
| 8 | Cache eviction and flag sync | `invalidateCachedUser(userId)`; suspicious flags resolved |
| 9 | `createModAuditLog` | `modAuditLog` row `{ moderatorId, moderatorName: "ModX", action: "ban_user", targetUserId, targetUsername: "Target", details: "Multiboxing", createdAt }`, mirrored as `actionAuditLog` action `mod.ban_user` |
| 10 | Response | `{ success: true, message: "User Target has been banned" }` |

Adding a note follows the same shape: text "Seen sharing a device" (21 characters, within 1 to 2000) is trimmed, pushed to `modNotes` with `authorRole: "moderator"`, and audited as `add_mod_note` with `details` equal to the first 200 characters. If `modNote` (legacy) existed and `modNotes` was empty, it is first converted to a one-entry `modNotes` array authored by "System (migrated)".

## Edge cases and limits

- Admins pass every moderator guard. In notes and audit entries `authorRole` is set from `moderator.isAdmin`, so an admin acting through a mod route is recorded as `admin`.
- A moderator cannot ban themselves, and cannot act on admin accounts (403). Banning another moderator is allowed by the code.
- `GET /api/moderator/users` excludes `role: "admin"` and sets `isAdmin: false` on every row. It returns hashed identity keys (`registrationIpKey`, `lastKnownIpKey`) and nulls the raw IP, token and fingerprint fields.
- `GET /api/moderator/audit-log` is meant to show moderators only their own entries and admins everything. Cursor paging there is by `createdAt`, while the admin audit route pages by `_id`.
- Audit writes never throw into the caller. A database failure on the audit insert leaves the action done and unlogged.
- Role removal also unsets `moderatorSince`. The moderator list falls back to `updatedAt` when `moderatorSince` is missing (accounts assigned before the field existed).
- Mod notes are append-only through the routes; there is no edit or delete route for `modNotes`.

### Legacy `modNote` field

The legacy `modNote` string remains on the `User` type for old data; new notes go to `modNotes[]`. The conversion happens lazily when a note is next added through either `POST /api/moderator/users/mod-notes` or `POST /api/admin/users/mod-notes`:

1. Find the user where `modNote` exists and `modNotes` is empty or absent
2. Convert it to a single-entry `modNotes` array: `{ authorId: <acting user>, authorName: "System (migrated)", text: modNote, createdAt: user.updatedAt }`
3. Unset the old `modNote` field

No users need role migration - all existing users remain `"admin"` or `"player"` as-is.

### Gameplay impact

None on game mechanics. Moderator status has zero effect on gameplay mechanics - elections, legislation, campaigns, NPP behavior, etc. are completely unaware of the moderator role. Mods play the game as normal players with their characters. The role does grant read access that players lack: private corporation and party "mod views" (audited through `mod-view`), sandbox access (`src/lib/sandbox/access.ts`), wiki staging access (`src/lib/api/wikiGuard.ts`), and receipt of mail and player report notifications (`src/lib/mail/commands/playerMail.ts`, `src/lib/safety/playerSafety.ts`). A world reset keeps moderator accounts (`src/lib/admin/resetGameWorld.ts`).

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Privilege comes from the current account record, never a stale token claim | `mapUserToAuthUser`; `src/lib/auth.accountPrivileges.test.ts` (stale admin claim denied, stale moderator claim denied, current moderator promoted) |
| A moderator cannot act on an admin account | A per-route `role === "admin"` check; tested for `update-state` (`src/app/api/moderator/characters/update-state/route.test.ts`) and `update-positions`; not enforced centrally, and not checked by `resources/grant` or `achievements/grant` |
| Only admins assign or remove the role | `requireAdmin()` on the four `/api/admin/moderators` routes; no test |
| An admin cannot be given the moderator role | `assign` route 400; no test |
| Every mutating mod route writes an audit entry | Convention in each route; not enforced by a test or lint rule |
| An audit failure never breaks the action | try/catch in `createModAuditLog` |
| `modAuditLog` survives a reseed | `preserved` category in `src/lib/admin/seed/seedManifestPreserved.ts`, checked by `src/lib/admin/seed/seedManifest.test.ts` |

## Failure and recovery

- **Missing audit rows.** An audit insert failure is logged to the server error stream and dropped. Recovery is to reconstruct from the mirrored `actionAuditLog` envelope when that mirror was on, or from the action's own record (for example the user's `bannedAt`).
- **Wrong role after assign or remove.** Roles can lag for up to 10 seconds because of the user cache. A stuck role is repaired by re-running assign or remove, or by a data fix to `users.role`.
- **Empty moderator audit view.** A moderator who sees no entries of their own is hitting the id-type problem described in Known issues; admins still see everything through the admin audit route.
- **Ban cascade partly failed.** The ban update lands before the cascades. If a cascade throws, the user is banned but may still hold a candidacy or party seat. Re-sending the ban request re-runs the cascades.
- **Legacy note conversion.** If the conversion write succeeds but the new note write fails, the legacy text is already in `modNotes`; retrying the note adds only the new one.
- **Admin accidentally given moderator via direct data edit.** Both `isAdmin` and `role` are checked for admin, so an account with `isAdmin: true` stays admin regardless of `role`.

## Connections

Driven by:

- Account authentication: the role and ban state are read on every request (`src/lib/auth.ts`, `src/lib/auth/userDocCache.ts`).
- Admin panel: assignment, removal and the full audit view (`src/app/api/admin/moderators/`).

Affects:

- Player lists and profiles: the Moderator label in politician and state player lists.
- [Mail](./mail.md): mail and player reports notify admins and moderators, and review runs under the moderator panel.
- Elections and parties: a ban withdraws candidacies and vacates party leadership (`src/lib/elections/withdrawBannedCandidates.ts`, `src/lib/elections/vacatePartyLeadershipForBannedUser.ts`).
- Forensics: every mod action is mirrored to the unified action audit (`src/lib/modAuditLog.ts`).

## Tests

| Test file | Covers |
| --- | --- |
| `src/lib/auth.accountPrivileges.test.ts` | Role and `isModerator` derivation from the account record, stale claim handling |
| `src/app/api/moderator/characters/update-state/route.test.ts` | State relocation and refusal to act on admin accounts |
| `src/app/api/moderator/characters/update-positions/route.test.ts` | Position updates, audit |
| `src/app/api/moderator/supporter-requests/[id]/approve/route.test.ts` | Approval flows |
| `src/app/api/moderator/users/route.eligibility.test.ts` | Identity signal eligibility on the user list |
| `src/components/navbar/staffNavItems.test.ts` | Which staff menu items each role sees |

Gaps: no tests for `requireModerator`, the ban or mod-notes routes, the four admin moderator-management routes, `createModAuditLog`, the moderator audit-log route, or the legacy `modNote` conversion.

## Known issues and history

- The moderator audit-log route filters non-admin callers with `filter.moderatorId = user.userId`, which is a string, while entries store `moderatorId` as an object id. As written the filter would not match stored entries, so a moderator may see an empty list. Not verified against a live database.
- `resources/grant` and `achievements/grant` have no admin-target check, although the Target protection rule above says mod routes refuse admins. Grants are by character id.
- The moderator Players tab has no Grant Resources subtab in this release, although the route and the `ResourceGrantManager` `context="moderator"` support exist.
- The admin Users tab still writes the legacy single-string `modNote` through `PATCH /api/admin/users/mod-note`, while moderators and the structured admin route write `modNotes[]`. The two views can therefore hold different note data for the same user.
- Profile headers do not show a moderator badge in this release; the badge appears in the politicians list and as plain text in two state player lists.
- The original design said admin actions are not logged in `modAuditLog`; in code an admin who uses a `/api/moderator` route is logged, and `mod-view` writes a separate `admin_view_private_corporation` action for them.
- History: the page records the original 2026-04 design (the note attribution example is dated 2026-04-11). The `modNotes` array, the structured audit log and the `/moderator` panel replaced the single `modNote` string and admin-only tooling. No other dated changes are recorded here.

Last checked: 2026-10-29, version 1.18.0
