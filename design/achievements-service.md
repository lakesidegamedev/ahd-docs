# Achievements Service

## Summary

The Achievements Service awards, revokes and queries player achievements. Achievements are **account-bound** (keyed by `userId`) with optional character context for historical tracking. Every function is non-throwing, so a failure in achievements can never block a game action.

Player guide: [Achievements](https://www.ahousedividedgame.com/wiki/achievements). Design: [Achievements](./achievements.md).

**Location:** `src/lib/achievements/`

**Key files:**

- `index.ts` - Core service (award, revoke, query)
- `cache.ts` - Definition and rarity caching
- `triggers.ts` - Trigger-based achievement checks
- `progress.ts` - Progress calculation for in-progress (unearned) achievements, used by `src/app/api/characters/[id]/achievements/route.ts`
- `officeHolders.ts`, `officeHolderRules.ts` - Turn-time award of `cabinet_seat` and `central_banker`

## Rules

### Core functions

#### `getAchievementBySlug(slug)`

**Purpose:** Fetch an achievement definition by slug.

**Returns:** `Achievement | null` (also `null` on error).

**Caching:** Reads the cached definitions when present. On a cache miss for that slug it falls back to a `findOne` on `achievements`. It never fills the cache itself; only `getAllAchievements` does.

```typescript
export async function getAchievementBySlug(slug: string): Promise<Achievement | null> {
  try {
    const cached = getCachedDefinitions();
    if (cached) {
      const found = cached.find((a) => a.slug === slug);
      if (found) return found;
    }

    const db = await getDb();
    const achievement = await db.collection<Achievement>("achievements").findOne({ slug });
    return achievement;
  } catch (error) {
    console.error("[achievements] getAchievementBySlug error:", error);
    return null;
  }
}
```

#### `getAllAchievements()`

**Purpose:** Fetch all achievement definitions.

**Returns:** `Achievement[]` sorted by `order` ascending (`[]` on error).

**Caching:** Returns the cached list when fresh, otherwise queries, stores the list with a 5 minute TTL and returns it.

#### `awardAchievement(userId, slug, characterId?, grantedBy?)`

**Purpose:** Award a single achievement to an account.

**Returns:** `true` if newly awarded, `false` if the account already had it, the slug is unknown, or an error occurred.

**Idempotent:** Calling it multiple times only awards once.

```typescript
export async function awardAchievement(
  userId: ObjectId,
  achievementSlug: string,
  characterId?: ObjectId,
  grantedBy?: ObjectId
): Promise<boolean> {
  try {
    const achievement = await getAchievementBySlug(achievementSlug);
    if (!achievement) {
      console.warn("[achievements] awardAchievement: achievement not found:", achievementSlug);
      return false;
    }

    const db = await getDb();

    const existing = await db.collection<CharacterAchievement>("characterAchievements").findOne({
      userId,
      achievementId: achievement._id,
    });
    if (existing) return false;

    try {
      await db.collection<CharacterAchievement>("characterAchievements").insertOne({
        _id: new ObjectId(),
        userId,
        characterId,
        achievementId: achievement._id,
        earnedAt: new Date(),
        grantedBy,
      });
    } catch (insertError: unknown) {
      // E11000 (duplicate key) means a concurrent call inserted first.
      const isDuplicate =
        insertError != null &&
        typeof insertError === "object" &&
        "code" in insertError &&
        (insertError as { code: number }).code === 11000;
      if (!isDuplicate) throw insertError;
      return false;
    }

    invalidateRarityCache();
    await maybeAwardCompletionist(userId, [achievementSlug], characterId);
    return true;
  } catch (error) {
    console.error("[achievements] awardAchievement error:", error);
    return false;
  }
}
```

#### `awardAchievements(userId, slugs, characterId?, grantedBy?)`

**Purpose:** Award multiple achievements in batch.

**Returns:** Number of newly awarded achievements (`0` on error).

**Efficiency:** Reduces N+1 queries to 1 definition lookup (skipped when the cache is fresh), 1 existing check and 1 `insertMany`, plus the Completionist check described below.

- An empty list returns `0`. A single slug is delegated to `awardAchievement`.
- With a fresh cache, definitions come from `cached.filter(...)` with no database fallback, so a slug missing from the cache is skipped silently until the cache expires.
- `insertMany` uses `{ ordered: false }` so a duplicate-key race on one document does not abort the rest. A duplicate-key error (code 11000) is swallowed; any other error is rethrown to the outer catch and returns `0`.
- The returned count is `toInsert.length`, the number attempted, even if a race made some inserts fail.

```typescript
// 1. Resolve all definitions (cache filter or one $in query)
// 2. Find the account's existing rows for those achievementIds (projection: achievementId)
// 3. Insert only the missing ones in one batch
await db
  .collection<CharacterAchievement>("characterAchievements")
  .insertMany(toInsert, { ordered: false });
invalidateRarityCache();
await maybeAwardCompletionist(userId, achievements.map((a) => a.slug), characterId);
return toInsert.length;
```

#### `maybeAwardCompletionist(userId, awardedSlugs, characterId?)`

Internal. Runs after every successful award. It returns immediately if `awardedSlugs` includes `completionist` (this stops recursion). Otherwise it loads all definitions through `getAllAchievements`, takes every definition except `completionist` as the required set, counts the account's rows whose `achievementId` is in that set, and if the count equals the set size calls `awardAchievement(userId, "completionist", characterId)`. Its own errors are logged and swallowed.

#### `revokeAchievement(userId, slug)`

**Purpose:** Revoke an achievement from an account.

**Returns:** `true` if revoked, `false` if the account did not have it, the slug is unknown, or an error occurred.

```typescript
const result = await db
  .collection<CharacterAchievement>("characterAchievements")
  .deleteOne({ userId, achievementId: achievement._id });

if (result.deletedCount > 0) {
  invalidateRarityCache();
  return true;
}
return false;
```

#### `getAccountAchievements(userId)`

**Purpose:** Get all achievements earned by an account with details.

**Returns:** `Array<{ achievement, earnedAt }>` sorted by achievement `order` ascending. Rows whose definition no longer exists are dropped. Returns `[]` on error or when the account has none.

#### `getAchievementRarityMap()`

**Purpose:** Get the rarity map `achievementId (string) -> % of accounts with it`.

**Denominator:** `users` with `hasCompletedSetup: true`.

**Formula:** `count / totalAccounts * 100`, where `count` is the number of `characterAchievements` rows grouped by `achievementId`.

**Returns:** `Map<string, number>`. Empty when there are no completed accounts, and an uncached empty map on error.

**Caching:** Cached for 2 minutes; invalidated on grant and revoke.

#### `resolveUserIdFromCharacter(characterId)`

**Purpose:** Resolve a character id to its owning user id (`characters.userId`, projection `userId`).

**Use case:** Turn processing and routes that act on another character have a `characterId` and need the `userId` for an award. Returns `null` if the character is missing or on error.

### Trigger system

The trigger system checks for achievement conditions when game events occur. All triggers are **non-blocking**: errors are logged and swallowed. Each trigger takes `userId` and `characterId`, and counts are read per `characterId`, not per account.

#### Action achievements

**Trigger:** `checkActionAchievements(userId, characterId, actionType, currentTurn?)`

**Called from:** `executeAction` (`src/lib/actions/commands/executeAction.ts`) and the poll route (`src/app/api/actions/poll/route.ts`).

It reads, in parallel, the count of `actionLogs` for the character and `actionType`, and the count of all `actionLogs` for the character, then runs the checks below and one batched `awardAchievements`.

**Per-actionType thresholds:**

| Action             | Achievement       | Threshold     |
| ------------------ | ----------------- | ------------- |
| `fundraise`        | `first_fundraise` | 1             |
| `fundraise`        | `fundraiser`      | 10            |
| `fundraise`        | `big_fundraiser`  | 50            |
| `campaign`         | `campaigner`      | 10            |
| `buildDonorBase`   | `grassroots`      | 5             |
| `advertise`        | `advertiser`      | 3             |
| `rest`             | `rested`          | 1             |
| `poll`/`pollLarge` | `pollster`        | 5 total polls |

**Plus three checks that run on every call regardless of `actionType`:**

| Condition                                                | Achievement    | Threshold                                    |
| -------------------------------------------------------- | -------------- | -------------------------------------------- |
| Total `actionLogs` count for the character               | `century_club` | 100                                          |
| `currentTurn` argument passed and `<= 1`                 | `turn_one`     | 1 (first turn)                               |
| Server local hour is `0` (`new Date().getHours() === 0`) | `night_shift`  | 1 (any action taken at midnight server time) |

#### Passive profile achievements

**Trigger:** `checkPassiveProfileAchievements(userId, characterId, facts)`

**Called from:** `src/app/profile/page.tsx` only (fire and forget), passing a `facts` object computed from current character and account state, not from action logs. The character achievements route does not call it.

**Achievements checked, one per fact:**

| Fact                                                             | Achievement          |
| ---------------------------------------------------------------- | -------------------- |
| `iteration.type === "Iteration"` and `iteration.number === 1`    | `iteration4_founder` |
| `hasCeoCorp`                                                     | `corner_office`      |
| `hasCabinetSeat`                                                 | `cabinet_seat`       |
| `hasCentralBankChair`                                            | `central_banker`     |
| `bondIncomePerTurn > 0`                                          | `bondholder`         |
| `dividendIncomePerTurn > 0`                                      | `dividend_day`       |
| `characterCreatedAt` is 30+ days old (`30 * 24 * 60 * 60 * 1000` ms) | `elder_statesman` |
| `statsAllocated`                                                 | `built_different`    |
| `onboardingComplete`                                             | `onboarded`          |
| `hallOfFameTop10`                                                | `hall_of_famer`      |
| `hasElectedOffice && hasCabinetSeat && isPartyChair` (all three) | `iron_triangle`      |

The profile page currently passes `hallOfFameTop10: false`, so `hall_of_famer` is never awarded from here.

#### Office holder achievements (turn)

`awardOfficeHolderAchievements(db, characters)` in `officeHolders.ts` runs at the end of `processActionRefresh` (`src/lib/turn/actionRefresh.ts`). It reads `cabinetMembers` rows with a `characterId` and `centralBanks` rows with a `chairCharacterId`, and `resolveOfficeHolderGrants` (`officeHolderRules.ts`) returns one `cabinet_seat` or `central_banker` grant per account per slug. Existing `(userId, achievementId)` pairs are skipped, and the remainder is written with `insertMany(..., { ordered: false })` and a rarity cache invalidation. It does not run the Completionist check.

#### Election entry achievements

**Trigger:** `checkElectionEntryAchievements(userId, characterId, election)`

**Called from:** `src/app/api/elections/[id]/enter/route.ts`

**Achievements** (candidacy count is `electionCandidates` for the character; type from `election.electionType`):

- `first_candidate` - at least one candidacy
- `house_candidate` - `house`
- `senate_candidate` - `senate`
- `governor_candidate` - `governor`
- `president_candidate` - `president`

#### Election win achievements

**Trigger:** `checkElectionWinAchievements(userId, characterId, electionType)`

**Called from:** General election and presidential resolution in the turn processor.

**Achievements:**

- `house_member` - `house`
- `senator` - `senate`
- `governor` - `governor`
- `state_senator` - `stateSenate`
- `three_terms` - 3 or more `electedOfficials` records for the character

#### Office held achievements

**Trigger:** `checkOfficeHeldAchievements(userId, characterId, officeType)`

**Called from:** Presidential resolution and admin appointments.

**Achievements:**

- `president` - `officeType === "president"`
- `vice_president` - `officeType === "vicePresident"`

#### Influence achievements

**Trigger:** `checkInfluenceAchievements(userId, characterId)`

**Called from:** `src/app/api/characters/[id]/influence/route.ts`

**Achievements:**

- `influencer` - 5+ `actionLogs` of type `supportPlayer`, `attackPlayer` or `barnstorm`
- `barnstormer` - 1+ `barnstorm` actions

#### Subscriber achievements

**Trigger:** `checkSubscriberAchievements(userId, characterId)`

**Called from:** The subscribe route, for the character being subscribed to (`userSubscriptions.subscribedToCharacterId`).

**Achievements:**

- `popular` - 5+ subscribers
- `celebrity` - 20+ subscribers

#### Funds achievements

**Trigger:** `checkFundsAchievements(userId, characterId, funds)`

**Called from:** `executeAction` and both transfer routes, with the balance converted to the anchor currency.

**Achievements:**

- `millionaire` - `funds >= 1_000_000`

#### Bill achievements

**Trigger:** `checkBillSponsoredAchievements(userId, characterId)`

**Called from:** `src/lib/legislature/commands/proposeNationalBill.ts`

**Achievements:**

- `first_bill` - 1+ `bills` with `sponsorId` equal to the character

#### News achievements

**Trigger:** `checkNewsPostAchievements(userId, characterId)` and `checkNewsReplyAchievements(userId, characterId)`

**Called from:** `src/lib/news/commands/newsCommands.ts`

**Achievements:**

- `first_post` - 1+ `newsPosts` by the author with `parentId: null`
- `commenter` - 5+ `newsPosts` by the author with `parentId` not null

### Progress calculation

**Function:** `getAchievementProgress(db, character, achievement)` in `src/lib/achievements/progress.ts`

**Purpose:** Compute `{ current, target }` progress for an achievement the character has not earned yet, driven by the achievement definition's `triggerType` and `triggerConfig` fields rather than by re-running the trigger checks above. Returns `null` for unrecognized `triggerType` values, for a non-finite `count` on `action_count` and `election_won`, or on error. It is called only for achievements the account has not earned.

**Supported `triggerType` values:**

| `triggerType`      | Source of `current`                                                                       | `target` from `triggerConfig` |
| ------------------ | ----------------------------------------------------------------------------------------- | ----------------------------- |
| `action_count`     | `actionLogs` count for the character, filtered by `actionType` or `actionTypes`           | `count`                       |
| `election_won`     | `electedOfficials` count for the character                                                | `count`                       |
| `influence_count`  | `actionLogs` count where `actionType` in `["supportPlayer", "attackPlayer", "barnstorm"]` | `count`                       |
| `subscriber_count` | `userSubscriptions` count for the character                                               | `count`                       |
| `funds_threshold`  | `character.funds` (0 if unset)                                                            | `amount`                      |
| `news_reply`       | `newsPosts` count with non-null `parentId` for the character                              | `count` (defaults to 5)       |

### Caching constants

Both caches are in-memory, per process, and expire on a timer (`src/lib/achievements/cache.ts`).

```typescript
const DEFS_TTL_MS = 5 * 60 * 1000;
const RARITY_TTL_MS = 2 * 60 * 1000;

let definitionsCache: { data: Achievement[]; expiresAt: number } | null = null;
let rarityCache: { data: Map<string, number>; expiresAt: number } | null = null;
```

Public functions: `getCachedDefinitions` / `setCachedDefinitions` / `invalidateDefinitionsCache`, `getCachedRarity` / `setCachedRarity` / `invalidateRarityCache`, and `invalidateAllAchievementCaches()` which clears both. A getter returns `null` once `Date.now() > expiresAt`.

**Invalidation:** Definitions expire after 5 minutes and rarity after 2 minutes. The definitions cache is also cleared by the admin create, update and seed routes (`src/app/api/admin/achievements/`), and the rarity cache on every grant, revoke and bulk grant. The contest and office-holder awards invalidate rarity themselves.

## Data

### Collections

| Collection              | Purpose                                                                                          | Player-visible                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `achievements`          | Achievement definitions (slug, name, description, icon, category, trigger fields, hidden, order) | Yes, through the profile and public API |
| `characterAchievements` | Account-achievement links (userId, achievementId, characterId, earnedAt, grantedBy)              | Yes, earned list and `earnedAt`         |

Read by triggers and progress: `actionLogs`, `electionCandidates`, `electedOfficials`, `userSubscriptions`, `bills`, `newsPosts`, `cabinetMembers`, `centralBanks`, `users` (`hasCompletedSetup`) and `characters` (`userId`). See [Achievements](./achievements.md) for what each trigger counts.

### Document types

```typescript
// src/lib/db/types/achievement.ts
interface Achievement {
  _id: ObjectId;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory; // "milestone" | "election" | "legislation" | "social" | "action" | "special"
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  isHidden: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CharacterAchievement {
  _id: ObjectId;
  userId: ObjectId; // Primary FK (account-bound)
  characterId?: ObjectId; // Optional: which character earned it
  achievementId: ObjectId;
  earnedAt: Date;
  grantedBy?: ObjectId; // Optional: set by admin and moderator grants
}
```

Seed indexes: `achievements.slug` unique; `characterAchievements` unique on `{ characterId, achievementId }`; `characterAchievements.achievementId`. There is no unique index on `userId`.

## Configuration

The service has no `gameConfig` field, era preset, country preset or scenario override. Fixed settings:

| Setting | Default | Where set |
| --- | --- | --- |
| `DEFS_TTL_MS` | 5 minutes | `src/lib/achievements/cache.ts` |
| `RARITY_TTL_MS` | 2 minutes | `src/lib/achievements/cache.ts` |
| Rarity denominator | `users` with `hasCompletedSetup: true` | `src/lib/achievements/index.ts` |
| Completionist required set | every definition except `completionist` | `src/lib/achievements/index.ts` |
| Definitions present | the seed list | `src/lib/seeds/achievements.ts` |

Behaviour that depends on feature flags (`gameState.onboardingChecklistEnabled` for `onboarded`) is documented in [Achievements](./achievements.md).

## Timing

The service has no turn phase of its own; it runs inline with the request or turn step that calls it. Turn-time callers:

```
actionRefresh phase     -> awardOfficeHolderAchievements
election resolution     -> checkElectionWinAchievements -> checkOfficeHeldAchievements
primary resolution      -> awardAchievement ("presidential_nominee")
post-turn contests      -> contest reconciler (direct bulkWrite, own rarity invalidation)
```

Within one `awardAchievement` or `awardAchievements` call the order is: resolve definition(s), check existing rows, insert, invalidate the rarity cache, run the Completionist check. Callers that fire several checks in parallel (for example `executeAction`) can interleave these steps for the same account.

## Worked trace

Character C of account A wins a Senate seat; resolution calls `checkElectionWinAchievements(A, C, "senate")`. C already has 3 `electedOfficials` rows including this win. A holds neither `senator` nor `three_terms`, and the definitions cache is fresh. The world has 66 definitions and 2,000 completed accounts.

1. `typeSlugs["senate"]` is `senator`, so `slugs = ["senator"]`.
2. `electedOfficials.countDocuments({ characterId: C })` returns 3, and `3 >= 3` adds `three_terms`. `slugs = ["senator", "three_terms"]`.
3. `awardAchievements(A, slugs, C)`: length 2, so the batch path. `cached.filter` returns 2 definitions.
4. Existing query on `{ userId: A, achievementId: { $in: [2 ids] } }` returns 0 rows, so `toInsert` has 2 documents `{ userId: A, characterId: C, achievementId, earnedAt: now, grantedBy: undefined }`.
5. `insertMany(toInsert, { ordered: false })` succeeds. `invalidateRarityCache()` runs. The function returns 2.
6. `maybeAwardCompletionist(A, ["senator", "three_terms"], C)`: `completionist` is not in the list, `requiredIds` has 65 ids, and A holds say 20 of them. `20 !== 65`, so nothing more is awarded.
7. The next rarity read recomputes. If 150 accounts now hold `senator`, its value is `150 / 2000 * 100 = 7.5`.

If the same call repeated: step 4 finds both rows, `toInsert` is empty, and the function returns `0` with no insert and no cache invalidation.

## Edge cases and limits

- **Idempotent.** Awarding an already held achievement returns `false`/`0`; duplicate-key (11000) races are tolerated.
- **Unknown slug.** `awardAchievement` and `revokeAchievement` log a warning and return `false`.
- **Cache blind spot.** `awardAchievements` filters the cached list without a database fallback, so a newly added definition is skipped for up to 5 minutes in a process with a warm cache. `awardAchievement` falls back to a `findOne` and is not affected.
- **Batch count.** `awardAchievements` returns the number of documents it tried to insert.
- **`characterId` is optional.** An award with no `characterId` stores no field; because the unique index is on `{ characterId, achievementId }`, such awards collide at null across accounts.
- **Error handling.** All achievement functions are **non-throwing**: they return `false`, `0`, `null`, `[]` or an empty map on failure, log with an `[achievements] <function> error:` prefix, and never block game flow.
- **Revocation is not sticky.** Triggers can re-award a revoked achievement when their condition is next checked.
- **Rarity.** Empty when no accounts completed setup; the numerator counts all rows, so values above 100 are possible.
- **Missing definitions.** `getAccountAchievements` drops rows whose definition is gone.

## Invariants

- No function in the service throws to its caller. Enforced by try/catch in each function; `src/lib/achievements.test.ts` asserts the return values for the not-found and idempotent paths only.
- A successful grant or revoke clears the rarity cache. Enforced in code; the cache itself is tested in `src/lib/achievements/cache.test.ts`, the call sites are not.
- At most one row per `(userId, achievementId)`. Enforced by the pre-check, not a database index.
- `completionist` is never required for itself. Enforced by the `slug !== "completionist"` filter and the early return in `maybeAwardCompletionist`; tested by "awarding completionist itself stops before the completion check recurses".
- Cache entries are never served past their TTL (`Date.now() > expiresAt` returns `null`), tested in `cache.test.ts`.

## Failure and recovery

- **Database errors.** The call logs and returns a failure value; the achievement is not awarded. It is awarded the next time its trigger condition is checked, since most conditions are counts or states, not events.
- **Missing definitions.** Awards return `false` with a warning until definitions are seeded or migrated in.
- **Stale cache.** Definitions lag up to 5 minutes and rarity up to 2 in other processes; restarting the process or waiting clears it.
- **Wrong state.** Use the admin and moderator grant routes, or the revoke route, to correct individual accounts; the next qualifying trigger may re-award a revoked achievement.
- **Duplicate rows.** Only possible when two characters of one account race past the pre-check; delete the extra row.

## Connections

**Driven by**

- **Action Logs:** `actionLogs` (written by `src/lib/actions/commands/executeAction.ts`) is the source of truth for action counts.
- **Election candidates:** `electionCandidates` and `src/app/api/elections/[id]/enter/route.ts` for candidacy tracking.
- **Elected officials:** `src/lib/turn/election/` for win tracking.
- **News Posts:** `src/app/api/news/` and `src/lib/news/commands/newsCommands.ts` for post counting.
- **Turn processing:** `src/lib/turn/actionRefresh.ts` for office-holder awards.

**Affects**

- **Profile Page:** `src/app/profile/page.tsx` calls `checkPassiveProfileAchievements`.
- **Character Achievements Route:** `src/app/api/characters/[id]/achievements/route.ts` calls `getAccountAchievements`, `getAchievementRarityMap`, `getAllAchievements` and `getAchievementProgress`.
- **Settings:** `src/app/api/settings/achievements/route.ts` validates highlights against earned rows.

### Usage patterns

#### In API routes

```typescript
export async function POST(request: Request) {
  const auth = await requireAuthWithCharacter();
  if (!auth.ok) return auth.response;

  // ... perform action ...

  // Award achievement (userId must be an ObjectId)
  await awardAchievement(new ObjectId(auth.user.userId), "policy_shift", auth.user.character._id);

  return NextResponse.json({ success: true });
}
```

#### In turn processing

```typescript
// Turn processing has characterId, needs userId
const { resolveUserIdFromCharacter } = await import("@/lib/achievements");
const userId = await resolveUserIdFromCharacter(characterId);
if (userId) {
  await awardAchievement(userId, "presidential_nominee", characterId);
}
```

#### Batch awards

```typescript
// Efficient batch award (single lookup, single insert)
await awardAchievements(userId, ["first_candidate", "senate_candidate"], characterId);
```

## Tests

| File | Covers |
| --- | --- |
| `src/lib/achievements.test.ts` | `awardAchievement` (not found, idempotent, insert, Completionist recursion stop), `revokeAchievement` |
| `src/lib/achievements/cache.test.ts` | TTL expiry and invalidation for both caches |
| `src/lib/achievements/triggers.test.ts` | `checkPassiveProfileAchievements` batch |
| `src/lib/achievements/officeHolderRules.test.ts`, `src/lib/achievements/officeHolders.test.ts` | Turn-time cabinet and central bank awards |
| `src/app/api/admin/achievements/admin-achievements.integration.test.ts` | Admin list route |

Gaps: no tests for `awardAchievements` batching (including the cache blind spot and `ordered: false` race), `maybeAwardCompletionist` success path, `getAchievementRarityMap`, `getAccountAchievements`, `resolveUserIdFromCharacter`, `getAchievementProgress`, or any trigger other than the passive profile one. `checkActionAchievements` is only mocked in `executeAction` and poll route tests.

## Known issues and history

- `awardAchievements` serves definitions from a warm cache with no database fallback, so newly seeded slugs are silently skipped for up to 5 minutes.
- `awardAchievements` returns the attempted insert count rather than the confirmed count after a duplicate-key race.
- The unique index does not include `userId`, so account-level uniqueness depends on the pre-check.
- `hall_of_famer` is not awarded in practice: the profile page hardcodes `hallOfFameTop10: false`.

Last checked: 2026-10-29, version 1.18.0
