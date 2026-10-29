# Achievements Service

## Overview

The Achievements Service provides a comprehensive system for awarding, revoking, and tracking player achievements. Achievements are **account-bound** (keyed by `userId`) with optional character context for historical tracking.

**Location:** `src/lib/achievements/`

**Key files:**

- `index.ts` - Core service (award, revoke, query)
- `cache.ts` - Definition and rarity caching
- `triggers.ts` - Trigger-based achievement checks
- `progress.ts` - Progress calculation for in-progress (unearned) achievements, used by the profile page and `src/app/api/characters/[id]/achievements/route.ts`

## Core Functions

### `getAchievementBySlug(slug)`

**Purpose:** Fetch achievement definition by slug.

**Returns:** `Achievement | null`

**Caching:** Uses cached definitions when available.

```typescript
export async function getAchievementBySlug(slug: string): Promise<Achievement | null> {
  const cached = getCachedDefinitions();
  if (cached) {
    const found = cached.find((a) => a.slug === slug);
    if (found) return found;
  }

  const db = await getDb();
  return await db.collection<Achievement>("achievements").findOne({ slug });
}
```

### `getAllAchievements()`

**Purpose:** Fetch all achievement definitions.

**Returns:** `Achievement[]` sorted by `order` field.

**Caching:** Caches full definition list after first fetch.

### `awardAchievement(userId, slug, characterId?, grantedBy?)`

**Purpose:** Award single achievement to account.

**Returns:** `true` if newly awarded, `false` if already had it or error.

**Idempotent:** Calling multiple times only awards once.

```typescript
export async function awardAchievement(
  userId: ObjectId,
  achievementSlug: string,
  characterId?: ObjectId,
  grantedBy?: ObjectId
): Promise<boolean> {
  const achievement = await getAchievementBySlug(achievementSlug);
  if (!achievement) return false;

  const db = await getDb();

  // Check if already has it
  const existing = await db
    .collection<CharacterAchievement>("characterAchievements")
    .findOne({ userId, achievementId: achievement._id });
  if (existing) return false;

  // Award it
  await db.collection<CharacterAchievement>("characterAchievements").insertOne({
    _id: new ObjectId(),
    userId,
    characterId,
    achievementId: achievement._id,
    earnedAt: new Date(),
    grantedBy,
  });

  invalidateRarityCache();
  return true;
}
```

### `awardAchievements(userId, slugs, characterId?, grantedBy?)`

**Purpose:** Award multiple achievements in batch.

**Returns:** Number of newly awarded achievements.

**Efficiency:** Reduces N+1 queries:

- 1 definition lookup (cached or single query)
- 1 existing check
- 1 `insertMany`

```typescript
export async function awardAchievements(
  userId: ObjectId,
  achievementSlugs: string[],
  characterId?: ObjectId,
  grantedBy?: ObjectId
): Promise<number> {
  if (achievementSlugs.length === 0) return 0;
  if (achievementSlugs.length === 1) {
    return (await awardAchievement(userId, achievementSlugs[0], characterId, grantedBy)) ? 1 : 0;
  }

  const db = await getDb();

  // 1. Resolve all definitions
  const cached = getCachedDefinitions();
  let achievements: Achievement[];
  if (cached) {
    achievements = cached.filter((a) => achievementSlugs.includes(a.slug));
  } else {
    achievements = await db
      .collection<Achievement>("achievements")
      .find({ slug: { $in: achievementSlugs } })
      .toArray();
  }
  if (achievements.length === 0) return 0;

  // 2. Check which ones account already has
  const achievementIds = achievements.map((a) => a._id);
  const existing = await db
    .collection<CharacterAchievement>("characterAchievements")
    .find({ userId, achievementId: { $in: achievementIds } }, { projection: { achievementId: 1 } })
    .toArray();
  const existingIds = new Set(existing.map((e) => e.achievementId.toString()));

  // 3. Insert only new ones
  const toInsert: CharacterAchievement[] = achievements
    .filter((a) => !existingIds.has(a._id.toString()))
    .map((a) => ({
      _id: new ObjectId(),
      userId,
      characterId,
      achievementId: a._id,
      earnedAt: new Date(),
      grantedBy,
    }));
  if (toInsert.length === 0) return 0;

  await db.collection<CharacterAchievement>("characterAchievements").insertMany(toInsert);
  invalidateRarityCache();
  return toInsert.length;
}
```

### `revokeAchievement(userId, slug)`

**Purpose:** Revoke achievement from account.

**Returns:** `true` if revoked, `false` if didn't have it or error.

```typescript
export async function revokeAchievement(
  userId: ObjectId,
  achievementSlug: string
): Promise<boolean> {
  const achievement = await getAchievementBySlug(achievementSlug);
  if (!achievement) return false;

  const db = await getDb();
  const result = await db
    .collection<CharacterAchievement>("characterAchievements")
    .deleteOne({ userId, achievementId: achievement._id });

  if (result.deletedCount > 0) {
    invalidateRarityCache();
    return true;
  }
  return false;
}
```

### `getAccountAchievements(userId)`

**Purpose:** Get all achievements earned by account with details.

**Returns:** `Array<{ achievement, earnedAt }>` sorted by achievement order.

```typescript
export async function getAccountAchievements(
  userId: ObjectId
): Promise<Array<{ achievement: Achievement; earnedAt: Date }>> {
  const db = await getDb();
  const cas = await db
    .collection<CharacterAchievement>("characterAchievements")
    .find({ userId })
    .toArray();

  const achievementIds = cas.map((ca) => ca.achievementId);
  if (achievementIds.length === 0) return [];

  const achievements = await db
    .collection<Achievement>("achievements")
    .find({ _id: { $in: achievementIds } })
    .toArray();

  const aMap = new Map(achievements.map((a) => [a._id.toString(), a]));
  return cas
    .map((ca) => {
      const a = aMap.get(ca.achievementId.toString());
      if (!a) return null;
      return { achievement: a, earnedAt: ca.earnedAt };
    })
    .filter((x): x is { achievement: Achievement; earnedAt: Date } => x !== null)
    .sort((x, y) => x.achievement.order - y.achievement.order);
}
```

### `getAchievementRarityMap()`

**Purpose:** Get rarity map: `achievementId → % of accounts with it`.

**Denominator:** Total accounts with completed setup (have characters).

**Returns:** `Map<string, number>` (percentage per achievement)

**Caching:** Caches rarity map for 2 minutes; invalidated on grant/revoke.

```typescript
export async function getAchievementRarityMap(): Promise<Map<string, number>> {
  const cached = getCachedRarity();
  if (cached) return cached;

  const db = await getDb();
  const totalAccounts = await db.collection("users").countDocuments({ hasCompletedSetup: true });
  if (totalAccounts === 0) {
    const empty = new Map<string, number>();
    setCachedRarity(empty);
    return empty;
  }

  const counts = await db
    .collection<CharacterAchievement>("characterAchievements")
    .aggregate<{ _id: ObjectId; count: number }>([
      { $group: { _id: "$achievementId", count: { $sum: 1 } } },
    ])
    .toArray();

  const map = new Map<string, number>();
  for (const c of counts) {
    map.set(c._id.toString(), (c.count / totalAccounts) * 100);
  }
  setCachedRarity(map);
  return map;
}
```

### `resolveUserIdFromCharacter(characterId)`

**Purpose:** Resolve character ID to owning user ID.

**Use case:** Turn processing has `characterId`, needs `userId` for achievement award.

```typescript
export async function resolveUserIdFromCharacter(characterId: ObjectId): Promise<ObjectId | null> {
  const db = await getDb();
  const character = await db
    .collection<{ _id: ObjectId; userId: ObjectId }>("characters")
    .findOne({ _id: characterId }, { projection: { userId: 1 } });
  return character?.userId ?? null;
}
```

## Trigger System

The trigger system automatically checks for achievement conditions when game events occur. All triggers are **non-blocking** - errors are logged and swallowed.

### Action Achievements

**Trigger:** `checkActionAchievements(userId, characterId, actionType, currentTurn?)`

**Called from:** Action handlers (fundraise, campaign, poll, etc.)

**Achievements checked (per-actionType thresholds):**

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

**Plus two checks that run on every call regardless of `actionType`:**

| Condition                                          | Achievement    | Threshold                |
| --------------------------------------------------- | -------------- | ------------------------- |
| Total `actionLogs` count for the character           | `century_club` | 100                       |
| `currentTurn` argument passed and `<= 1`             | `turn_one`     | 1 (first turn)            |
| Server local hour is `0` (`new Date().getHours() === 0`) | `night_shift`  | 1 (any action taken at midnight server time) |

### Passive Profile Achievements

**Trigger:** `checkPassiveProfileAchievements(userId, characterId, facts)`

**Called from:** `src/app/profile/page.tsx` and `src/app/api/characters/[id]/achievements/route.ts`, passing a `facts` object computed from current character/account state (not from action logs).

**Achievements checked, one per fact:**

| Fact                                                                 | Achievement          |
| --------------------------------------------------------------------- | -------------------- |
| `iteration.type === "Iteration"` and `iteration.number === 1`         | `iteration4_founder` |
| `hasCeoCorp`                                                          | `corner_office`      |
| `hasCabinetSeat`                                                      | `cabinet_seat`       |
| `hasCentralBankChair`                                                 | `central_banker`     |
| `bondIncomePerTurn > 0`                                               | `bondholder`         |
| `dividendIncomePerTurn > 0`                                           | `dividend_day`       |
| `characterCreatedAt` is 30+ days old                                  | `elder_statesman`    |
| `statsAllocated`                                                      | `built_different`    |
| `onboardingComplete`                                                  | `onboarded`          |
| `hallOfFameTop10`                                                     | `hall_of_famer`      |
| `hasElectedOffice && hasCabinetSeat && isPartyChair` (all three)      | `iron_triangle`      |

### Election Entry Achievements

**Trigger:** `checkElectionEntryAchievements(userId, characterId, election)`

**Called from:** Election entry handlers

**Achievements:**

- `first_candidate` - First candidacy ever
- `house_candidate` - House candidacy
- `senate_candidate` - Senate candidacy
- `governor_candidate` - Governor candidacy
- `president_candidate` - Presidential candidacy

### Election Win Achievements

**Trigger:** `checkElectionWinAchievements(userId, characterId, electionType)`

**Called from:** Election resolution

**Achievements:**

- `house_member` - Win House election
- `senator` - Win Senate election
- `governor` - Win governor election
- `state_senator` - Win state senate election
- `three_terms` - Win 3+ elections total

### Office Held Achievements

**Trigger:** `checkOfficeHeldAchievements(userId, characterId, officeType)`

**Called from:** Office assumption

**Achievements:**

- `president` - Become President
- `vice_president` - Become Vice President

### Influence Achievements

**Trigger:** `checkInfluenceAchievements(userId, characterId)`

**Called from:** Influence action handlers

**Achievements:**

- `influencer` - 5+ influence actions
- `barnstormer` - 1+ barnstorm actions

### Subscriber Achievements

**Trigger:** `checkSubscriberAchievements(userId, characterId)`

**Called from:** Subscription handlers

**Achievements:**

- `popular` - 5+ subscribers
- `celebrity` - 20+ subscribers

### Funds Achievements

**Trigger:** `checkFundsAchievements(userId, characterId, funds)`

**Called from:** Fund update handlers

**Achievements:**

- `millionaire` - Reach $1,000,000

### Bill Achievements

**Trigger:** `checkBillSponsoredAchievements(userId, characterId)`

**Called from:** Bill sponsorship

**Achievements:**

- `first_bill` - Sponsor first bill

### News Achievements

**Trigger:** `checkNewsPostAchievements(userId, characterId)` and `checkNewsReplyAchievements(userId, characterId)`

**Called from:** News post creation

**Achievements:**

- `first_post` - First original post
- `commenter` - 5+ reply posts

## Progress Calculation

**Function:** `getAchievementProgress(db, character, achievement)` in `src/lib/achievements/progress.ts`

**Purpose:** Compute `{ current, target }` progress for an achievement the character hasn't earned yet, driven by the achievement definition's `triggerType` and `triggerConfig` fields rather than by re-running the trigger checks above. Returns `null` for unrecognized `triggerType` values or on error.

**Supported `triggerType` values:**

| `triggerType`       | Source of `current`                                                            | `target` from `triggerConfig`         |
| -------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| `action_count`        | `actionLogs` count for the character, filtered by `actionType` or `actionTypes` | `count`                                |
| `election_won`        | `electedOfficials` count for the character                                       | `count`                                |
| `influence_count`      | `actionLogs` count where `actionType` in `["supportPlayer", "attackPlayer", "barnstorm"]` | `count`                        |
| `subscriber_count`     | `userSubscriptions` count for the character                                      | `count`                                |
| `funds_threshold`      | `character.funds`                                                                | `amount`                               |
| `news_reply`           | `newsPosts` count with non-null `parentId` for the character                     | `count` (defaults to 5)               |

## Caching System

### Definition Cache

Both caches are in-memory and expire on a timer (`src/lib/achievements/cache.ts`).

```typescript
const DEFS_TTL_MS = 5 * 60 * 1000;
const RARITY_TTL_MS = 2 * 60 * 1000;

let definitionsCache: { data: Achievement[]; expiresAt: number } | null = null;

export function getCachedDefinitions(): Achievement[] | null {
  if (!definitionsCache || Date.now() > definitionsCache.expiresAt) return null;
  return definitionsCache.data;
}

export function setCachedDefinitions(data: Achievement[]): void {
  definitionsCache = { data, expiresAt: Date.now() + DEFS_TTL_MS };
}

export function invalidateDefinitionsCache(): void {
  definitionsCache = null;
}
```

### Rarity Cache

```typescript
let rarityCache: { data: Map<string, number>; expiresAt: number } | null = null;

export function getCachedRarity(): Map<string, number> | null {
  if (!rarityCache || Date.now() > rarityCache.expiresAt) return null;
  return rarityCache.data;
}

export function setCachedRarity(data: Map<string, number>): void {
  rarityCache = { data, expiresAt: Date.now() + RARITY_TTL_MS };
}

export function invalidateRarityCache(): void {
  rarityCache = null;
}
```

**Invalidation:** Definitions expire after 5 minutes and rarity after 2 minutes. The definitions cache is also cleared on create and update, and the rarity cache on every grant, revoke and bulk grant. `invalidateAllAchievementCaches()` clears both.

## Data Model

### Collections

| Collection              | Purpose                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `achievements`          | Achievement definitions (slug, name, description, order)                            |
| `characterAchievements` | Account-achievement links (userId, achievementId, characterId, earnedAt, grantedBy) |

### Document Types

```typescript
interface Achievement {
  _id: ObjectId;
  slug: string;
  name: string;
  description: string;
  icon?: string;
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
  grantedBy?: ObjectId; // Optional: admin who granted
  createdAt: Date;
  updatedAt: Date;
}
```

## Usage Patterns

### In API Routes

```typescript
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  // ... perform action ...

  // Award achievement
  await awardAchievement(auth.user.userId, "first_action", auth.user.character?._id);

  return NextResponse.json({ success: true });
}
```

### In Turn Processing

```typescript
// Turn processing has characterId, needs userId
const { resolveUserIdFromCharacter } = await import("@/lib/achievements");
const userId = await resolveUserIdFromCharacter(characterId);
if (userId) {
  await awardAchievement(userId, "election_winner", characterId);
}
```

### Batch Awards

```typescript
// Efficient batch award (single lookup, single insert)
await awardAchievements(userId, ["first_win", "third_term", "millionaire"], characterId);
```

## Error Handling

All achievement functions are **non-throwing**:

- Return `false` on failure
- Log errors to console
- Never block game flow

```typescript
try {
  await awardAchievement(userId, slug, characterId);
} catch (error) {
  console.error("[achievements] awardAchievement error:", error);
  return false;
}
```

## Related Systems

- **Action Logs:** `src/lib/actionLogs/` - Source of truth for action counts
- **Election Candidates:** `src/lib/electionEngine/` - Candidacy tracking
- **Elected Officials:** `src/lib/turn/election/` - Win tracking
- **News Posts:** `src/app/api/news/` - Post counting
- **Profile Page:** `src/app/profile/page.tsx` - Calls `checkPassiveProfileAchievements` and renders progress from `getAchievementProgress`
- **Character Achievements Route:** `src/app/api/characters/[id]/achievements/route.ts` - Calls `checkPassiveProfileAchievements` and `getAchievementProgress`
