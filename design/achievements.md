# Achievements

## Summary

Achievements are badges earned through gameplay. They appear on your profile as a chunky labeled tile grid organized by category, and up to 5 can be highlighted in Settings. Each achievement shows what percentage of players have earned it. They are cosmetic: nothing in the economy, elections or turn processing reads them.

Player guide: [Achievements](https://www.ahousedividedgame.com/wiki/achievements). Service code reference: [Achievements Service](./achievements-service.md).

- **Profile display.** Achievements show as a category-organized tile grid. Up to 5 can be featured. Locked achievements appear grayed out with their unlock criteria visible, except hidden ones, whose details are concealed until earned (`src/components/ProfileAchievements.tsx`).
- **Settings.** Settings, then Achievement Highlights, chooses which 5 to display. Slots may be left empty.
- **Account-bound.** Achievements are tied to the account, not the character, and persist across character retirements. `characterAchievements` uses `userId` as the primary key link; `characterId` is optional and records which character earned it.
- **Rarity.** "X% of players" is the share of accounts that finished setup (have a character) holding the achievement. NPPs are not counted.
- **Categories.** Special, Elections, Legislation, Actions, Social, Milestones, in that display order. The `AchievementCategory` union in `src/lib/db/types/achievement.ts` is `"milestone" | "election" | "legislation" | "social" | "action" | "special"`.

## Rules

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| Achievement definitions | 66: 58 literal entries, 6 contest entries, 2 Supreme Court entries (`ACHIEVEMENT_SEED`) | `src/lib/seeds/achievements.ts`, `src/lib/contests/achievementDefinitions.ts`, `src/lib/scotus/achievementDefinitions.ts` |
| Contest achievement display order | `600 + index` | `src/lib/seeds/achievements.ts` |
| Supreme Court achievement display order | 71 (confirmed), 72 (died in office) | `src/lib/scotus/achievementDefinitions.ts` |
| Highlighted achievements per character | max 5, each must be earned by that character | `src/app/api/settings/achievements/route.ts` |
| Highlight update rate limit | 30 requests per 60 seconds per user | `src/app/api/settings/achievements/route.ts` |
| Definitions cache TTL | 5 minutes (`DEFS_TTL_MS`) | `src/lib/achievements/cache.ts` |
| Rarity cache TTL | 2 minutes (`RARITY_TTL_MS`) | `src/lib/achievements/cache.ts` |
| Fundraise tiers | 1, 10, 50 `fundraise` actions | `src/lib/achievements/triggers.ts` |
| Campaign / donor base / ad / poll | 10 `campaign`, 5 `buildDonorBase`, 3 `advertise`, 5 `poll` plus `pollLarge` | `src/lib/achievements/triggers.ts` |
| Century Club | 100 logged actions of any type for one character | `src/lib/achievements/triggers.ts` |
| Rested | 1 `rest` action | `src/lib/achievements/triggers.ts` |
| Influence | 5 combined `supportPlayer`, `attackPlayer`, `barnstorm` actions; 1 `barnstorm` | `src/lib/achievements/triggers.ts` |
| Subscribers | 5 (`popular`), 20 (`celebrity`), counted on the subscribed-to character | `src/lib/achievements/triggers.ts` |
| Millionaire | funds of 1,000,000 or more, measured in the anchor currency | `src/lib/achievements/triggers.ts`, `src/lib/actions/commands/executeAction.ts` |
| Three terms | 3 `electedOfficials` records for the character | `src/lib/achievements/triggers.ts` |
| News replies | 5 (`commenter`) | `src/lib/achievements/triggers.ts` |
| Elder Statesman | character at least 30 real days old (`30 * 24 * 60 * 60 * 1000` ms) | `src/lib/achievements/triggers.ts` |
| Night Shift | server local hour is 0 | `src/lib/achievements/triggers.ts` |
| In at the Ground Floor | action taken while the current turn is 1 or lower | `src/lib/achievements/triggers.ts` |

### Formulas

- Rarity of an achievement: `holders / acceptedAccounts * 100`, where `holders` is the number of `characterAchievements` rows for that `achievementId` and `acceptedAccounts` is `users` with `hasCompletedSetup: true` (`getAchievementRarityMap` in `src/lib/achievements/index.ts`).
- Completionist: awarded when the count of the account's rows for every definition except `completionist` equals the number of those definitions (`maybeAwardCompletionist`).
- Millionaire input: `finalBalanceAnchor = campaignBalanceLocal / campaignRate` (forex is always on, so the division always applies) in `executeAction`; the transfer routes pass the sender's balance after the transfer, converted the same way.

### Trigger functions

Entry point: `src/lib/achievements/triggers.ts`.

| Trigger | Called from | Checks |
| --- | --- | --- |
| `checkActionAchievements` | Action API routes | first_fundraise, fundraiser, big_fundraiser, campaigner, grassroots, advertiser, rested, pollster, century_club (100+ total actions), turn_one (turn 1 or lower), night_shift (server hour 0) |
| `checkPassiveProfileAchievements` | Profile page render | iteration4_founder, corner_office, cabinet_seat, central_banker, bondholder, dividend_day, elder_statesman (30+ real days), built_different, onboarded, hall_of_famer, iron_triangle (office + Cabinet + party chair at once) |
| `checkElectionEntryAchievements` | `/api/elections/[id]/enter` | first_candidate, house/senate/governor/president_candidate |
| `checkElectionWinAchievements` | Election resolution | house_member, senator, governor, state_senator, three_terms |
| `checkOfficeHeldAchievements` | Office assumption | president, vice_president |
| `checkInfluenceAchievements` | Influence actions | influencer, barnstormer |
| `checkSubscriberAchievements` | Subscription events | popular (5+), celebrity (20+) |
| `checkFundsAchievements` | Action and transfer fund changes | millionaire ($1M+) |
| `checkBillSponsoredAchievements` | Bill sponsorship | first_bill |
| `checkNewsPostAchievements` | News posting | first_post |
| `checkNewsReplyAchievements` | News replies | commenter (5+) |

`awardAchievement` and `awardAchievements` also run `maybeAwardCompletionist` after every award, which grants `completionist` once an account holds every other achievement.

### Achievements awarded outside `triggers.ts`

Several call `awardAchievement` directly at the point of the game event:

- `lawmaker`: `src/lib/turn/billLifecycle/lifecycleHelpers.ts`, `src/lib/presidentialBillAction.ts`.
- `cosponsor`: `src/lib/legislature/commands/nationalBillActions.ts`.
- `donor` (sender) and `big_spender` (receiver): `src/app/api/v1/transfer/route.ts`, `src/app/api/characters/[id]/transfer/route.ts`. A replayed idempotency key awards nothing again.
- `speaker_candidate`: `src/lib/congress/speaker/actions.ts`.
- `party_leader`: `src/lib/nationalPartyElections.ts`, `src/lib/statePartyElections.ts`, `src/lib/parties/applyCharacterPartyJoin.ts`, the party leadership appointment route.
- `policy_shift`: `src/app/api/settings/policy/route.ts`.
- `first_subscriber`: `src/app/api/characters/[id]/subscribe/route.ts`.
- `presidential_nominee`: `src/lib/turn/primaryResolution.ts`.
- `alpha_tester`: `src/app/api/auth/character/route.ts`, at character creation.
- `supreme_court_justice`: `src/lib/turn/scotusNominationLifecycle.ts`. `died_in_office_justice`: `src/lib/turn/scotusTenureTurn.ts` when the seat is vacated by death.
- `patreon_supporter_plus`: `src/lib/patreon/service.ts`, when a Patreon sync reports a Supporter+ tier or better.
- `cabinet_seat` and `central_banker`: also awarded by the turn (`src/lib/achievements/officeHolders.ts`), see Timing.
- The six `contest_*` achievements: `reconcileContestAchievements` in `src/lib/contests/achievements.ts`, using the milestone rules in `src/lib/contests/rules/history.ts`.

Only `beta2_veteran`, `wiki_contributor`, `party_founder` and `dealmaker` are seeded `manual_only` with no automatic award path of any kind. They are granted by an admin or moderator through `src/app/api/admin/achievements/grant/route.ts` or `src/app/api/moderator/achievements/grant/route.ts`. `patreon_supporter_plus` is also seeded `manual_only` but is awarded automatically by the Patreon sync.

### Contest milestone rules

`contestAchievementSlugs` in `src/lib/contests/rules/history.ts` evaluates a user's awarded placings (positive-score winners) in settlement order:

| Slug | Condition |
| --- | --- |
| `contest_podium` | at least 1 placing |
| `contest_first_win` | at least 1 placing with rank 1 |
| `contest_repeat_winner` | 3 or more rank-1 placings |
| `contest_versatile_winner` | rank-1 placings across 3 or more distinct contest kinds |
| `contest_cross_iteration` | rank-1 placings in 2 or more distinct non-empty `iterationKey` values |
| `contest_winning_streak` | rank-1 placings in rounds `n`, `n+1`, `n+2` of the same kind and iteration (kind `referrals_iteration` and unknown iterations are skipped) |

`contestAchievementMilestones` attributes each slug to the first placing that satisfied it.

### Award logic

```typescript
// src/lib/achievements/index.ts

// Single achievement
await awardAchievement(userId, slug, characterId);

// Multiple achievements (batch)
await awardAchievements(userId, [slug1, slug2, ...], characterId);
```

### Action count thresholds

```typescript
// src/lib/achievements/triggers.ts (checkActionAchievements)

if (actionType === "fundraise") {
  if (count >= 1) award("first_fundraise");
  if (count >= 10) award("fundraiser");
  if (count >= 50) award("big_fundraiser");
}
if (actionType === "campaign" && count >= 10) award("campaigner");
if (actionType === "buildDonorBase" && count >= 5) award("grassroots");
if (actionType === "advertise" && count >= 3) award("advertiser");
if (actionType === "poll" || actionType === "pollLarge") {
  if (count >= 5) award("pollster");
}
```

## Data

### Collections

| Collection | Fields | Player-visible |
| --- | --- | --- |
| `achievements` | `slug`, `name`, `description`, `icon`, `category`, `triggerType`, `triggerConfig?`, `isHidden`, `order`, `createdAt`, `updatedAt` (`src/lib/db/types/achievement.ts`) | Yes: names, descriptions, icons, categories and rarity through the profile and `GET /api/characters/[id]/achievements` |
| `characterAchievements` | `userId`, `characterId?`, `achievementId`, `earnedAt`, `grantedBy?` | Yes: earned list with `earnedAt` |
| `characters` | `highlightedAchievementIds` (written by `PATCH /api/settings/achievements`) | Yes: highlighted tiles |

The join field is `achievementId`, an `ObjectId` reference to the achievement's `_id`, not a slug string. `userId` is the primary link; `characterId` is stored for historical context. Slug-to-`_id` lookups go through `getAchievementBySlug`. `grantedBy` receives the granting admin's character id from the admin grant route (`auth.admin.character?._id`).

Seed indexes: `achievements.slug` unique; `characterAchievements` unique on `{characterId, achievementId}`; `characterAchievements.achievementId` (created in `src/lib/admin/seed/seedAchievements.ts`, `src/lib/admin/seed/runCoreSeed.ts` and `src/app/api/admin/achievements/seed/route.ts`). There is no unique index on `userId`.

### Collections read by triggers and progress

| Collection | Used for |
| --- | --- |
| `actionLogs` | Action counts per character and action type |
| `electionCandidates` | Candidacy count (`first_candidate`) |
| `electedOfficials` | Win count (`three_terms`, progress) |
| `userSubscriptions` | Subscriber count (`subscribedToCharacterId`) |
| `bills` | Sponsored count (`sponsorId`) |
| `newsPosts` | Posts (`parentId: null`) and replies (`parentId` not null), by `authorId` |
| `cabinetMembers`, `centralBanks` | Current seat and chair holders (`chairCharacterId`) for the turn award |
| `contestRounds` | Settled winners for contest achievements |
| `users` | `hasCompletedSetup` for the rarity denominator; `isBanned` excluded from contest awards |
| `characters` | Owner lookup (`resolveUserIdFromCharacter`), `highlightedAchievementIds`, `funds` for progress |

### Achievement list

Names, descriptions and hidden status come from `src/lib/seeds/achievements.ts` (`ACHIEVEMENT_SEED`) and the two definition files above. Icons are Lucide icon component names, not emoji. Hidden achievements show no details until earned.

#### Special

| Icon | Name | Description | Hidden |
| --- | --- | --- | --- |
| FlaskConical | Founding Father | Joined during the alpha phase of the game | |
| Sparkles | Patron Plus | Reached Supporter+ on Patreon | |
| History | Cold War Veteran | Played during Beta 2, the era before the 1953 relaunch | |
| Landmark | Fourth Founding | Joined the Fourth Founding and the 1953 relaunch | |
| BookOpen | Keeper of the Record | Contributed research, corrections, or new lore to the wiki | |
| Triangle | Iron Triangle | Held elected office, a Cabinet seat, and party leadership at once | Yes |
| Rocket | In at the Ground Floor | Took an action in turn one of a brand-new era | Yes |
| Moon | Night Shift | Took an action between midnight and 1am server time | Yes |
| Gem | The Completionist | Earned every other achievement in the game | Yes |
| Hourglass | Served for Life | Died in office while serving as a Supreme Court Justice | |

#### Actions

| Icon | Name | Description |
| --- | --- | --- |
| HandCoins | Passing the Hat | Completed your first fundraise |
| BadgeDollarSign | K Street Regular | Raised funds 10 times |
| Banknote | Money Machine | Raised funds 50 times |
| Vote | Stump Speaker | Campaigned 10 times |
| Sprout | Whistle Stop | Built donor base 5 times |
| ChartNoAxesColumnIncreasing | Gallup's Ghost | Commissioned 5 polls |
| Tv | Prime Time | Ran 3 ad campaigns |
| Bed | Executive Time | Rested to recover actions |
| Award | Century Club | Logged 100 actions with one character (hidden until earned) |

#### Elections

| Icon | Name | Description |
| --- | --- | --- |
| Target | Throwing Your Hat In | Entered your first election |
| House | Mr. Smith Goes to Washington | Ran for the U.S. House |
| Building2 | Senatorial Ambition | Ran for the U.S. Senate |
| Star | Mansion on the Hill | Ran for Governor |
| Flag | Hail to the Chief | Entered a presidential race |
| Medal | The Nomination | Won your party's presidential primary |
| Landmark | The People's Voice | Won a U.S. House seat |
| Scale | The Upper Chamber | Won a U.S. Senate seat |
| Badge | The Governor's Mansion | Won a gubernatorial election |
| ScrollText | The Statehouse | Won a state senate seat |
| Shield | Leader of the Free World | Became President |
| Bird | A Heartbeat Away | Became Vice President |
| ClipboardCheck | The Incumbent | Won 3 elections |
| Users | At the President's Table | Accepted an appointment to a Cabinet position |
| PiggyBank | Master of the Mint | Became Chair of a Central Bank |
| FlagTriangleRight | A Party of One | Founded a new political party |
| Scale | Equal Justice Under Law | Confirmed to the Supreme Court |

#### Legislation

| Icon | Name | Description |
| --- | --- | --- |
| FileText | The First Draft | Sponsored your first bill |
| CircleCheck | Filibuster Buster | Had a bill pass into law |
| Handshake | Across the Aisle | Cosponsored a bill |

#### Social

| Icon | Name | Description |
| --- | --- | --- |
| Megaphone | Pulling Strings | Influenced another character 5 times |
| Tornado | Rough Rider | Used barnstorm on a character |
| Eye | Following the Trail | Subscribed to another character |
| Heart | Beltway Buzz | Gained 5 subscribers |
| Newspaper | Front Page News | Gained 20 subscribers |
| FilePenLine | Off the Record | Made your first news post |
| MessageCircle | The Pundit | Replied to 5 news posts |
| RefreshCw | Flip-Flopper | Changed your policy positions |

#### Milestones

| Icon | Name | Description |
| --- | --- | --- |
| CircleDollarSign | Fat Cat | Reached $1,000,000 in campaign funds |
| Gift | Pork Barrel | Received funds from another character |
| HandHeart | The Bundler | Donated to another character's campaign |
| AudioLines | Order in the House | Ran for Speaker of the House |
| Crown | The Kingmaker | Held a party leadership position |
| Briefcase | Corner Office | Took the CEO seat of a corporation |
| ScrollText | Clip the Coupon | Collected steady income from bonds |
| Coins | Dividend Day | Collected dividend income from shares |
| Hourglass | Elder Statesman | Kept one character active for 30 real-world days |
| Dumbbell | Built Different | Allocated every point that makes a politician tick |
| GraduationCap | Learned the Ropes | Completed new-player onboarding |
| Trophy | Hall of Famer | Cracked the Top 10 of the global Hall of Fame |
| Handshake | Dealmaker | Closed a corporate merger or acquisition |
| Trophy | On the Podium | Earn an awarded placing in a contest |
| Trophy | First Across the Line | Win a contest for the first time |
| Trophy | Returning Champion | Win three contest rounds across any categories or iterations |
| Trophy | Three in a Row | Win three consecutive weekly rounds of the same contest in one iteration |
| Trophy | All-Round Champion | Win contests in three different categories |
| Trophy | Champion Through the Ages | Win a contest in two different iterations |

Progress bars for unearned achievements come from `src/lib/achievements/progress.ts`, driven by each definition's `triggerType` (`action_count`, `election_won`, `influence_count`, `subscriber_count`, `funds_threshold`, `news_reply`); other trigger types return no progress. Progress is read for the character being viewed, while earned status is read for the account.

## Configuration

There is no `gameConfig` field, era preset or country preset for achievements. Behaviour is fixed by the constants in Rules plus these switches:

| Setting | Default | Effect | Where set |
| --- | --- | --- | --- |
| Seeded definitions | 66 rows | Which achievements exist; a world with no `achievements` rows awards nothing | `ACHIEVEMENT_SEED` in `src/lib/seeds/achievements.ts`, loaded by the admin seed route or the core seed |
| `gameState.onboardingChecklistEnabled` | off (`true` required) | Gates the onboarding reward claim (`src/app/api/onboarding/claim/route.ts`) that sets `onboarding.rewardGrantedAt`, which `onboarded` reads | `src/lib/onboarding/featureFlag.ts` |
| Forex | always on (`isForexEnabled` returns `true`) | Millionaire is judged on the anchor-currency balance | `src/lib/currency/featureFlag.ts` |
| Server local time zone | host setting | Defines "hour 0" for Night Shift | process environment |
| Startup migration `2026-10-16-scotus-career-achievements` | runs once | Adds the Supreme Court definitions to worlds that already seeded | `src/lib/migrations/entries/2026-10-16-scotus-career-achievements.ts` |

## Timing

Achievements are event driven. Almost no turn phase sweeps for them; each check runs inside the request or turn step that produced the event, and all checks swallow their errors so they never block the game action.

```
request: action        -> executeAction -> checkActionAchievements + checkFundsAchievements
request: election entry-> checkElectionEntryAchievements
turn: general election -> checkElectionWinAchievements (per winner)
turn: presidential     -> checkElectionWinAchievements -> checkOfficeHeldAchievements
turn: primaries        -> presidential_nominee (direct award)
turn: actionRefresh    -> awardOfficeHolderAchievements (cabinet_seat, central_banker)
turn: post-turn        -> reconcileContestAchievements (contest_*)
request: profile view  -> checkPassiveProfileAchievements (fire and forget)
every award            -> invalidate rarity cache -> maybeAwardCompletionist
```

1. **Player actions.** `executeAction` (`src/lib/actions/commands/executeAction.ts`) runs `checkActionAchievements` and `checkFundsAchievements` together after at least one action completed, passing the current turn number. The poll route (`src/app/api/actions/poll/route.ts`) calls `checkActionAchievements` itself.
2. **Election entry.** `checkElectionEntryAchievements` runs in `src/app/api/elections/[id]/enter/route.ts` when a candidate enters.
3. **Election resolution (turn processor).** General election resolution (`src/lib/turn/election/generalResolution.ts`) calls `checkElectionWinAchievements` for each winner. Presidential resolution (`src/lib/turn/election/presidentResolutionMessaging.ts`) calls `checkElectionWinAchievements` and then `checkOfficeHeldAchievements` for the president, and `checkOfficeHeldAchievements` for the vice president. Admin appointments (`src/app/api/admin/officials/appoint/route.ts`) also call `checkOfficeHeldAchievements`.
4. **Primary resolution.** `presidential_nominee` is awarded directly from `src/lib/turn/primaryResolution.ts`.
5. **Action refresh phase.** `processActionRefresh` (`src/lib/turn/actionRefresh.ts`, phase `actionRefresh` in `src/simulation/phases/turnPhaseRegistry.ts`) ends with `awardOfficeHolderAchievements`, so every account whose character currently holds a Cabinet seat (acting or confirmed) or chairs a central bank earns `cabinet_seat` or `central_banker` that turn, without opening the profile.
6. **Profile views.** `checkPassiveProfileAchievements` runs fire and forget from `src/app/profile/page.tsx` only, so the other career-state achievements (CEO seat, bonds, dividends, Elder Statesman, Iron Triangle, and the Cabinet and central bank ones too) land the next time the owner loads their own profile. The character achievements route does not call it.
7. **Contests.** `runContestsAfterTurn` calls `runContests`, which ends with `reconcileContestAchievements` (`src/lib/contests/engine.ts`).
8. **Other events.** Influence (`src/app/api/characters/[id]/influence/route.ts`), subscriptions (`src/app/api/characters/[id]/subscribe/route.ts`), bill sponsorship (`src/lib/legislature/commands/proposeNationalBill.ts`), news posts and replies (`src/lib/news/commands/newsCommands.ts`) and transfers (`src/app/api/v1/transfer/route.ts`, `src/app/api/characters/[id]/transfer/route.ts`, funds check on the sender) each call their trigger inline.
9. **After every award.** `awardAchievement` and `awardAchievements` invalidate the rarity cache and then run `maybeAwardCompletionist`, so the Completionist is granted in the same call that completes the set.

Order inside `checkActionAchievements`: per-type threshold checks first, then Century Club, Ground Floor and Night Shift, then one batched `awardAchievements` call.

## Worked trace

Account A has character C. C has 9 earlier `fundraise` logs and 90 other logs (99 total), and A already holds `first_fundraise`. At server hour 0 (00:20), on turn 412, C takes a fundraise action that leaves the campaign balance at 1,250,000 local with `campaignRate = 1.25`.

1. `executeAction` commits the action. C now has 10 `fundraise` logs and 100 logs total.
2. `checkActionAchievements(A, C, "fundraise", 412)` reads `countForType = 10` and `totalActionCount = 100`.
3. Checks: `10 >= 1` adds `first_fundraise`; `10 >= 10` adds `fundraiser`; `10 >= 50` fails. `100 >= 100` adds `century_club`. `412 <= 1` fails, so no `turn_one`. `getHours() === 0` adds `night_shift`. The list is 4 slugs.
4. `awardAchievements` resolves 4 definitions, finds 1 existing row (`first_fundraise`), builds 3 documents `{ userId: A, characterId: C, achievementId, earnedAt: now }`, and runs `insertMany(..., { ordered: false })`. It invalidates the rarity cache and returns 3.
5. In parallel, `checkFundsAchievements` receives `1,250,000 / 1.25 = 1,000,000`. `1,000,000 >= 1,000,000`, so `awardAchievement(A, "millionaire", C)` inserts a fourth row.
6. After each call `maybeAwardCompletionist` counts A's rows against the 65 non-Completionist definitions in a fully seeded world. If A holds 12 of them, nothing happens.
7. Next rarity read: 2,000 accounts have `hasCompletedSetup`. If 300 hold `fundraiser` the cached percentage is `300 / 2000 * 100 = 15`. It was `299 / 2000 * 100 = 14.95` before A's row.
8. Stored result: 4 new `characterAchievements` rows for A, all with `characterId: C`.

## Edge cases and limits

- **Idempotent.** Awarding an achievement an account already holds returns `false` and changes nothing. A concurrent duplicate insert that fails with a duplicate-key error (code 11000) is treated the same way.
- **Account-bound.** The award check looks up `userId` plus `achievementId`, so a second character on the same account cannot earn a duplicate; `characterId` records only the character that earned it first.
- **Unknown slug.** Awarding a slug with no definition logs a warning and returns `false`.
- **Failures never propagate.** Every function catches its own errors, logs, and returns `false` (or `0`, or an empty map). A broken achievement check cannot fail an action, an election resolution or a profile load.
- **Manual only.** `beta2_veteran`, `wiki_contributor`, `party_founder` and `dealmaker` have no automatic path.
- **Founding Father.** `alpha_tester` is awarded on every new character creation in `src/app/api/auth/character/route.ts`, not through `triggers.ts`. The seed `triggerType` is `character_created`.
- **Completionist excludes itself.** It requires every definition except `completionist`, and the required set is every row in the `achievements` collection, so adding a definition makes already-complete accounts incomplete until they earn it. The contest reconciler also awards it when its own batch completes the set.
- **Highlights.** More than 5 highlighted ids is rejected with a 400, and ids the current character has not earned (matched on `characterId`, not the account) are rejected.
- **Rarity denominator.** Only accounts that finished setup count in the denominator, but every row counts in the numerator, so a value above 100 is possible if rows exist for accounts that are not counted. Rarity is cached for 2 minutes; any award or revoke clears the cache immediately in the process that handled it. Definitions can lag up to 5 minutes in other processes.
- **Zero cases.** With no completed accounts the rarity map is empty and no percentages are shown.
- **Elder Statesman measures real time**, not game turns, and uses character creation date.
- **Night Shift uses server local time**, not the player's time zone.
- **Hall of Famer** is never awarded by the profile check, which always passes `hallOfFameTop10: false` (see Known issues).
- **Revoking.** `revokeAchievement` removes the account record and clears the rarity cache. It does not stop a trigger from re-awarding the achievement the next time its condition is checked.
- **Banned accounts** are skipped by the contest reconciler (`isBanned: true`) and keep rows already earned.
- **Awards with no `characterId`.** The unique index is `{characterId, achievementId}`, so two awards of the same achievement with no `characterId` collide at null across accounts (noted in `src/lib/patreon/service.ts`). Callers pass a character id where possible.

## Invariants

- At most one row per `(userId, achievementId)`. Enforced in code by the pre-check in `awardAchievement` and `awardAchievements`, not by a database index (the unique index is on `characterId` and `achievementId`). Covered by "returns false when account already has achievement (idempotent)" in `src/lib/achievements.test.ts`. The office-holder award checks existing `(userId, achievementId)` pairs too (`src/lib/achievements/officeHolders.test.ts`). The contest reconciler uses a deterministic `_id` per `(userId, achievementId)` with `$setOnInsert`, so retries cannot duplicate.
- `resolveOfficeHolderGrants` yields at most one grant per account per slug (`src/lib/achievements/officeHolderRules.test.ts`).
- The rarity cache is invalidated on every grant and revoke performed through the service. Not enforced for direct writes: the office-holder and contest awards call `invalidateRarityCache` themselves, but the seed script's admin grants and world reset write or delete rows without a cache call.
- Highlights are a subset of the character's earned set at write time. Not enforced afterwards: revoking an achievement leaves its id in `highlightedAchievementIds`.
- No achievement check may throw into its caller. Enforced by the try/catch in each function; not asserted by a test for every trigger.

## Failure and recovery

- **No definitions seeded.** Every award returns `false` with a warning because the slug cannot be resolved. Repair: reseed definitions (admin seed route, which only runs on an empty collection, or the core seed).
- **Definitions added later.** New definitions need a one-off migration to reach worlds that already seeded (the 2026-10-16 Supreme Court migration is the model). Until then awards for the new slug return `false`.
- **Missed career awards.** Passive achievements depend on the owner loading their profile. Missed awards self-heal on the next profile load; cabinet and central bank awards self-heal on the next turn.
- **Stale rarity or definitions.** Wait out the TTL (2 and 5 minutes) or restart the process; admin create and update routes clear the definitions cache.
- **Wrongly granted or missing awards.** Repair with the admin grant, revoke and bulk-grant routes (`src/app/api/admin/achievements/`), or the moderator grant route. A revoked trigger-based achievement may return on the next qualifying check.
- **Duplicate rows for one account.** Possible only if two characters raced past the pre-check, since the unique index does not cover `userId`. Repair by deleting the extra row.
- **Contest awards failing.** A failure in `reconcileContestAchievements` is reported to error tracking and does not fail settlement. It runs again after the next settlement and is idempotent.
- **Account deletion and world reset** delete the account's rows or all rows (`src/app/api/auth/delete-account/route.ts`, `src/lib/admin/resetGameWorld.ts`).

## Connections

**Driven by**

- [Stats & Actions](./stats-actions.md): the action log (`actionLogs`) supplies every count, via `src/lib/actions/commands/executeAction.ts`.
- Elections: entry in `src/app/api/elections/[id]/enter/route.ts`, results from `src/lib/turn/election/generalResolution.ts` and `src/lib/turn/primaryResolution.ts`.
- Legislation: bill sponsorship and passage (`src/lib/legislature/commands/proposeNationalBill.ts`, `src/lib/turn/billLifecycle/lifecycleHelpers.ts`).
- Social: subscriptions, influence and news posts.
- Contests: settled rounds (`src/lib/contests/engine.ts`, `src/lib/contests/achievements.ts`).
- Supreme Court: confirmation and death in office (`src/lib/turn/scotusNominationLifecycle.ts`, `src/lib/turn/scotusTenureTurn.ts`).
- Patreon: tier sync (`src/lib/patreon/service.ts`).
- [Player Progression](./player-progression.md): career state read by the profile facts (Cabinet seat, party chair, CEO seat, bonds, dividends, Hall of Fame).
- Admin and moderator grant routes for the manual achievements.

**Affects**

- Profile page: tile grid, progress bars (`src/lib/achievements/progress.ts`) and highlights.
- Settings: highlighted achievements stored on the character.
- Retirement and recaps: `src/lib/retireCharacter.ts` counts the character's achievements into the retirement snapshot, and career recaps read them (`src/lib/recap/buildSeasonRecaps.ts`).
- Nothing in the economy, elections or turn processing reads achievements. They are cosmetic and informational.

Related: [Player Progression](./player-progression.md) for career path and office benefits; [Stats & Actions](./stats-actions.md) for the core actions that unlock achievements.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/achievements.test.ts` | `awardAchievement` (not found, idempotent, insert, Completionist recursion stop), `revokeAchievement` |
| `src/lib/achievements/cache.test.ts` | TTL expiry and invalidation for both caches |
| `src/lib/achievements/triggers.test.ts` | `checkPassiveProfileAchievements` batch |
| `src/lib/achievements/officeHolderRules.test.ts`, `src/lib/achievements/officeHolders.test.ts` | Cabinet and central bank turn awards |
| `src/lib/contests/rules/history.test.ts`, `src/lib/contests/history.mongo.integration.test.ts` | Contest milestone rules and reconcile idempotency |
| `src/app/api/admin/achievements/admin-achievements.integration.test.ts` | Admin list route |
| `src/components/ProfileAchievements.test.tsx` | Profile tile rendering |

Gaps: no direct tests for `awardAchievements` batch behaviour, `checkActionAchievements` thresholds (only mocked in the executeAction and poll route tests), the other trigger functions, `getAchievementRarityMap`, `getAchievementProgress`, the highlight route, or the revoke and bulk-grant routes.

## Known issues and history

- `hall_of_famer` has no live award path: the profile page passes `hallOfFameTop10: false` because the legacy leaderboard is too expensive to compute on each profile load (`src/app/profile/page.tsx`).
- The unique index covers `characterId` and `achievementId` only, so the account-level uniqueness rule rests on the pre-check, and a no-`characterId` award collides across accounts.
- Highlight validation matches on `characterId`, so achievements earned by a previous character on the same account cannot be highlighted by a newer one, even though the profile shows them as earned.
- Revoking an achievement does not remove it from `highlightedAchievementIds`.
- The seed script's admin grants insert rows with no `userId` (`src/lib/admin/seed/seedAchievements.ts`), which the account-keyed queries do not see.
- 2026-10-16: Supreme Court achievements added by migration, with a backfill of confirmed justices. Deaths in office are not backfilled (`src/lib/migrations/entries/2026-10-16-scotus-career-achievements.ts`).

Last checked: 2026-10-29, version 1.18.0
