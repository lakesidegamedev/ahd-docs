# Achievements

Achievements are badges earned through gameplay. They appear on your profile as a **chunky labeled tile grid** organized by category, and can be highlighted in Settings. Each achievement shows what percentage of players have earned it.

Player guide: [Achievements](https://www.ahousedividedgame.com/wiki/achievements)

## How It Works

- **Profile Display**: Achievements display as a category-organized tile grid on your profile. Up to 5 achievements can be highlighted as featured. Visitors and you can expand to view all earned achievements. Locked achievements appear grayed out with their unlock criteria visible.
- **Settings**: Go to Settings → Achievement Highlights to choose which 5 to display. Leave slots empty if you prefer.
- **Account-Bound**: Achievements are tied to your account, not your character. They persist across character retirements. The `characterAchievements` collection uses `userId` as the primary FK; `characterId` is optional and tracks which character earned the achievement.
- **Rarity**: "X% of players" shows how many accounts (with at least one character) have each achievement (NPPs are not counted).
- **Categories**: Achievements are grouped by category (Special, Elections, Legislation, Actions, Social, Milestones, in that display order). This is the `AchievementCategory` union in `src/lib/db/types/achievement.ts`: `"milestone" | "election" | "legislation" | "social" | "action" | "special"`. Full definitions live in `src/lib/seeds/achievements.ts` (58 achievements as of this writing).

## Achievement List

Names, descriptions, and hidden status below come from `src/lib/seeds/achievements.ts` (`ACHIEVEMENT_SEED`). Icons are Lucide icon component names from the definitions, not emoji.

### Special

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

### Actions

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
| Award | Century Club | Logged 100 actions with one character |

### Elections

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

### Legislation

| Icon | Name | Description |
| --- | --- | --- |
| FileText | The First Draft | Sponsored your first bill |
| CircleCheck | Filibuster Buster | Had a bill pass into law |
| Handshake | Across the Aisle | Cosponsored a bill |

### Social

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

### Milestones

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

## Implementation

**Entry point:** `src/lib/achievements/triggers.ts`

### Trigger Functions

| Trigger                          | Called From                 | Checks                                                                                            |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `checkActionAchievements`         | Action API routes           | first_fundraise, fundraiser, big_fundraiser, campaigner, grassroots, advertiser, rested, pollster, century_club (100+ total actions), turn_one (turn ≤1), night_shift (server hour 0) |
| `checkPassiveProfileAchievements` | Profile/status refresh      | iteration4_founder, corner_office, cabinet_seat, central_banker, bondholder, dividend_day, elder_statesman (30+ real days), built_different, onboarded, hall_of_famer, iron_triangle (office + Cabinet + party chair at once) |
| `checkElectionEntryAchievements`  | `/api/elections/[id]/enter` | first_candidate, house/senate/governor/president_candidate                                        |
| `checkElectionWinAchievements`    | Election resolution         | house_member, senator, governor, state_senator, three_terms                                       |
| `checkOfficeHeldAchievements`     | Office assumption           | president, vice_president                                                                         |
| `checkInfluenceAchievements`      | Influence actions           | influencer, barnstormer                                                                           |
| `checkSubscriberAchievements`     | Subscription events         | popular (5+), celebrity (20+)                                                                     |
| `checkFundsAchievements`          | Fund thresholds             | millionaire ($1M+)                                                                                |
| `checkBillSponsoredAchievements`  | Bill sponsorship            | first_bill                                                                                        |
| `checkNewsPostAchievements`       | News posting                | first_post                                                                                        |
| `checkNewsReplyAchievements`      | News replies                | commenter (5+)                                                                                    |

`awardAchievement`/`awardAchievements` also runs `maybeAwardCompletionist` after every award, which grants `completionist` once an account holds every other achievement.

Not every achievement goes through `src/lib/achievements/triggers.ts`. Several call `awardAchievement` directly at the point of the game event instead of through a shared trigger function: `lawmaker` (`src/lib/turn/billLifecycle/lifecycleHelpers.ts`, `src/lib/presidentialBillAction.ts`), `cosponsor` (`src/lib/legislature/commands/nationalBillActions.ts`), `donor`/`big_spender` (`src/app/api/v1/transfer/route.ts`, `src/app/api/characters/[id]/transfer/route.ts`), `speaker_candidate` (`src/lib/congress/speaker/actions.ts`), `party_leader` (`src/lib/nationalPartyElections.ts`, `src/lib/statePartyElections.ts`, `src/lib/parties/applyCharacterPartyJoin.ts`, the party leadership appointment route), `policy_shift` (`src/app/api/settings/policy/route.ts`), `first_subscriber` (`src/app/api/characters/[id]/subscribe/route.ts`), and `presidential_nominee` (`src/lib/turn/primaryResolution.ts`). Only `patreon_supporter_plus`, `beta2_veteran`, `wiki_contributor`, `party_founder`, and `dealmaker` are seeded `manual_only` with no automatic award path (admin/moderator grant only, via `src/app/api/admin/achievements/grant/route.ts` or `src/app/api/moderator/achievements/grant/route.ts`).

### Award Logic

```typescript
// src/lib/achievements/index.ts

// Single achievement
await awardAchievement(userId, slug, characterId);

// Multiple achievements (batch)
await awardAchievements(userId, [slug1, slug2, ...], characterId);
```

### Action Count Thresholds

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

### Data Model

| Collection              | Fields                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `achievements`          | Master list of achievement definitions: `slug`, `name`, `description`, `icon`, `category`, `triggerType`, `triggerConfig?`, `isHidden`, `order`, `createdAt`, `updatedAt` (see `src/lib/db/types/achievement.ts`) |
| `characterAchievements` | `userId`, `characterId?`, `achievementId` (ObjectId reference to `achievements._id`), `earnedAt`, `grantedBy?` |

**Note:** the join field is `achievementId`, an `ObjectId` reference to the achievement's `_id`, not an `achievementSlug` string. `userId` is the primary FK, achievements are account-bound, not character-bound. `characterId` is stored for historical context (which character earned it). Slug-to-`_id` lookups go through `getAchievementBySlug` in `src/lib/achievements/index.ts`.

## Rules

| Constant | Value | Source |
| --- | --- | --- |
| Achievement definitions | 58 (`ACHIEVEMENT_SEED`) | `src/lib/seeds/achievements.ts` |
| Highlighted achievements per account | max 5, each must be earned | `src/app/api/settings/achievements/route.ts` |
| Highlight update rate limit | 30 requests per 60 seconds per user | `src/app/api/settings/achievements/route.ts` |
| Definitions cache TTL | 5 minutes (`DEFS_TTL_MS`) | `src/lib/achievements/cache.ts` |
| Rarity cache TTL | 2 minutes (`RARITY_TTL_MS`) | `src/lib/achievements/cache.ts` |
| Rarity formula | holders of the achievement / accounts with `hasCompletedSetup`, times 100 | `src/lib/achievements/index.ts` (`getAchievementRarityMap`) |
| Fundraise tiers | 1, 10, 50 `fundraise` actions | `src/lib/achievements/triggers.ts` |
| Campaign / donor base / ad / poll | 10 `campaign`, 5 `buildDonorBase`, 3 `advertise`, 5 `poll` plus `pollLarge` | `src/lib/achievements/triggers.ts` |
| Century Club | 100 logged actions of any type for one character | `src/lib/achievements/triggers.ts` |
| Rested | 1 `rest` action | `src/lib/achievements/triggers.ts` |
| Influence | 5 combined `supportPlayer`, `attackPlayer`, `barnstorm` actions; 1 `barnstorm` | `src/lib/achievements/triggers.ts` |
| Subscribers | 5 (popular), 20 (celebrity) | `src/lib/achievements/triggers.ts` |
| Millionaire | funds of 1,000,000 or more (campaign currency converted to the anchor currency when forex is on) | `src/lib/achievements/triggers.ts`, `src/lib/actions/commands/executeAction.ts` |
| Three terms | 3 `electedOfficials` records for the character | `src/lib/achievements/triggers.ts` |
| News replies | 5 | `src/lib/achievements/triggers.ts` |
| Elder Statesman | character at least 30 real days old (30 x 24 x 60 x 60 x 1000 ms) | `src/lib/achievements/triggers.ts` |
| Night Shift | server local hour is 0 | `src/lib/achievements/triggers.ts` |
| In at the Ground Floor | action taken while the current turn is 1 or lower | `src/lib/achievements/triggers.ts` |

## Timing

Achievements are event driven. There is no turn phase that sweeps for them; each check runs inside the request or turn step that produced the event, and all checks swallow their errors so they never block the game action.

1. **Player actions.** `executeAction` (`src/lib/actions/commands/executeAction.ts`) runs `checkActionAchievements` and `checkFundsAchievements` together after at least one action completed, passing the current turn number. The poll route (`src/app/api/actions/poll/route.ts`) calls `checkActionAchievements` itself.
2. **Election entry.** `checkElectionEntryAchievements` runs in `src/app/api/elections/[id]/enter/route.ts` when a candidate enters.
3. **Election resolution (turn processor).** General election resolution (`src/lib/turn/election/generalResolution.ts`) calls `checkElectionWinAchievements` for each winner. Presidential resolution (`src/lib/turn/election/presidentResolutionMessaging.ts`) calls `checkElectionWinAchievements` and then `checkOfficeHeldAchievements` for the president, and `checkOfficeHeldAchievements` for the vice president. Admin appointments (`src/app/api/admin/officials/appoint/route.ts`) also call `checkOfficeHeldAchievements`.
4. **Primary resolution.** `presidential_nominee` is awarded directly from `src/lib/turn/primaryResolution.ts`.
5. **Profile views.** `checkPassiveProfileAchievements` runs fire and forget from `src/app/profile/page.tsx` and from the character achievements route, so career-state achievements (CEO seat, Cabinet seat, bonds, dividends, Elder Statesman, Hall of Famer, Iron Triangle) land the next time the profile is loaded, not at the moment the state changes.
6. **Other events.** Influence (`src/app/api/characters/[id]/influence/route.ts`), subscriptions (`src/app/api/characters/[id]/subscribe/route.ts`), bill sponsorship (`src/lib/legislature/commands/proposeNationalBill.ts`), news posts and replies (`src/lib/news/commands/newsCommands.ts`) and transfers (`src/app/api/v1/transfer/route.ts`, `src/app/api/characters/[id]/transfer/route.ts`, funds check on the sender) each call their trigger inline.
7. **After every award.** `awardAchievement` and `awardAchievements` invalidate the rarity cache and then run `maybeAwardCompletionist`, so the Completionist is granted in the same call that completes the set.

Order inside `checkActionAchievements`: per-type threshold checks first, then Century Club, Ground Floor and Night Shift, then one batched `awardAchievements` call.

## Edge cases and limits

- **Idempotent.** Awarding an achievement an account already holds returns `false` and changes nothing. A concurrent duplicate insert that fails with a duplicate-key error (code 11000) is treated the same way.
- **Account-bound.** The award check looks up `userId` plus `achievementId`, so a second character on the same account cannot earn a duplicate; `characterId` records only the character that earned it first.
- **Unknown slug.** Awarding a slug with no definition logs a warning and returns `false`.
- **Failures never propagate.** Every function catches its own errors, logs, and returns `false` (or `0`, or an empty map). A broken achievement check cannot fail an action, an election resolution or a profile load.
- **Manual only.** `patreon_supporter_plus`, `beta2_veteran`, `wiki_contributor`, `party_founder` and `dealmaker` have no automatic path. They are granted by an admin or moderator through `src/app/api/admin/achievements/grant/route.ts` or `src/app/api/moderator/achievements/grant/route.ts`.
- **No trigger function for Founding Father.** `alpha_tester` has `triggerType: "character_created"` in the seed, but no trigger function in `src/lib/achievements/triggers.ts` awards it.
- **Completionist excludes itself.** It requires every definition except `completionist`, and the required set is every row in the `achievements` collection, so adding a definition makes already-complete accounts incomplete until they earn it.
- **Highlights.** More than 5 highlighted ids is rejected with a 400, and ids the current character has not earned (matched on `characterId`, not the account) are rejected.
- **Rarity denominator.** Only accounts that finished setup count. Rarity is cached for 2 minutes, so a new award can take up to that long to show in percentages, although any award or revoke clears the cache immediately in the process that handled it. Definitions can lag up to 5 minutes in other processes.
- **Zero cases.** With no completed accounts the rarity map is empty and no percentages are shown.
- **Elder Statesman measures real time**, not game turns, and uses character creation date.
- **Night Shift uses server local time**, not the player's time zone.
- **Revoking.** `revokeAchievement` removes the account record and clears the rarity cache. It does not stop a trigger from re-awarding the achievement the next time its condition is checked.

## Connections

**Driven by**

- [Stats & Actions](./stats-actions.md): the action log (`actionLogs`) supplies every count, via `src/lib/actions/commands/executeAction.ts`.
- Elections: entry in `src/app/api/elections/[id]/enter/route.ts`, results from `src/lib/turn/election/generalResolution.ts` and `src/lib/turn/primaryResolution.ts`.
- Legislation: bill sponsorship and passage (`src/lib/legislature/commands/proposeNationalBill.ts`, `src/lib/turn/billLifecycle/lifecycleHelpers.ts`).
- Social: subscriptions, influence and news posts.
- [Player Progression](./player-progression.md): career state read by the profile facts (Cabinet seat, party chair, CEO seat, bonds, dividends, Hall of Fame).
- Admin and moderator grant routes for the manual achievements.

**Affects**

- Profile page: tile grid, progress bars (`src/lib/achievements/progress.ts`) and highlights.
- Settings: highlighted achievements stored on the character.
- Nothing in the economy, elections or turn processing reads achievements. They are cosmetic and informational.

## Related

- [Player Progression](./player-progression.md): Career path and office benefits
- [Stats & Actions](./stats-actions.md): Core actions that unlock achievements

Last checked: 2026-10-29, version 1.18.0
