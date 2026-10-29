# Achievements

Achievements are badges earned through gameplay. They appear on your profile as a **chunky labeled tile grid** organized by category, and can be highlighted in Settings. Each achievement shows what percentage of players have earned it.

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

## Related

- [Player Progression](./player-progression.md): Career path and office benefits
- [Stats & Actions](./stats-actions.md): Core actions that unlock achievements
