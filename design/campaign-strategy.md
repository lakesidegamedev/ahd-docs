# Campaign Strategy

A practical guide to building influence, allocating actions, and winning elections in A House Divided.

## Core Principle

Every action you spend should move you closer to one goal: **winning your next election**. Early game is about building a base; mid-game is about positioning; late game is about turnout.

## Building Influence

Political Influence (0-100) is your footprint in your home state. Higher influence = more votes.

- **Campaign action** - +1% Political Influence per action. The bread-and-butter early move.
- **Influence decay** - 1%/turn at high levels, 0.1%/turn below 1%. You must keep campaigning to maintain your base.
- **Office bonuses** - Holding office gives bonus actions, making it easier to maintain influence.

## Action Allocation

You have limited actions each turn. Prioritize based on your situation:

| Situation                     | Priority                                     |
| ----------------------------- | -------------------------------------------- |
| New character, no office      | Campaign > Fundraise > Poll                  |
| Primary season                | Campaign heavily > targeted ads              |
| General election              | Campaign + ads in weak demographics          |
| Incumbent seeking re-election | Maintain influence + fundraise for war chest |

## Campaign Funds

Presidential and general-election candidates have a **separate campaign fund pool** distinct from personal Cash on Hand. This pool is:

- **Funded by** - Per-turn fundraising income (based on fundraising level), player donations, and party donations
- **Spent on** - Upgrade purchases and maintenance costs
- **Not transferable** - Campaign funds cannot be moved to personal Cash on Hand

### Fundraising Levels

Each campaign has a fundraising level (0-10) that determines passive income per turn:

| Level | Income/turn |
| ----- | ----------- |
| 0     | $20,000     |
| 1     | $35,000     |
| 2     | $60,000     |
| 3     | $100,000    |
| 4     | $150,000    |
| 5     | $200,000    |
| 6     | $350,000    |
| 7     | $600,000    |
| 8     | $1,000,000  |
| 9     | $2,500,000  |
| 10    | $5,000,000  |

Upgrading is expensive and gets progressively steeper - costs multiply by 1.5× once the election enters the general phase.

### Donations

Any player can donate personal Cash on Hand to any campaign. Party chairs can donate from the party treasury. All donations are logged publicly on the campaign page.

## Campaign Actions

Your campaign generates a pool of **campaign actions** each turn, separate from your character's action pool.

- **Base floor** - Every campaign generates at least 1 action/turn, more for a more active player.
- **Endorsements** - NPP and player endorsements (presidential only) increase actions via `baseline + floor(sqrt(endorsements) × 3)`, where the baseline is your own base action gain (at least 1; `src/lib/campaigns/actions.ts`).

Campaign actions are spent on strategic upgrades.

## Strategic Upgrades

Upgrade four dimensions of your campaign from the campaign page. Each has up to 5 levels (opposition research, ground game, media spending) or 10 levels (fundraising):

| Upgrade                 | Effect                                                      |
| ----------------------- | ----------------------------------------------------------- |
| **Fundraising**         | Passive income per turn (10 levels, $20k-$5M/turn)          |
| **Media Spending**      | +0.5% favorability per level per turn (passive)             |
| **Ground Game**         | +3% turnout boost in swing states per level (ongoing bonus) |
| **Opposition Research** | −0.5% favorability drain to your target per level per turn  |

### Upgrade Costs

**Entry point:** `src/lib/campaigns/upgradeCosts.ts`

The tables below are the baseline ladder, sized for a US presidential campaign. Costs, maintenance and fundraising income are multiplied by a per-race scalar (`CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE`): president 1.0, senate, governor and commons 0.5, special commons and house 0.3, state senate 0.2. Each lever is now bought as a starter unlock plus three branches (a, b, c) of up to 3 levels each, for example Grassroots, Bundlers and Direct Mail under Fundraising; the branch definitions are in the same file. Ground game and media upkeep is doubled, and their tier 3 purchase costs 1.5×.

**Fundraising** (10 levels):

| Level | Cost        | Actions | Effect      |
| ----- | ----------- | ------- | ----------- |
| 1     | $50,000     | 10      | +$35k/turn  |
| 2     | $120,000    | 15      | +$60k/turn  |
| 3     | $250,000    | 20      | +$100k/turn |
| 4     | $500,000    | 25      | +$150k/turn |
| 5     | $900,000    | 30      | +$200k/turn |
| 6     | $1,500,000  | 40      | +$350k/turn |
| 7     | $2,500,000  | 50      | +$600k/turn |
| 8     | $4,000,000  | 60      | +$1M/turn   |
| 9     | $6,500,000  | 75      | +$2.5M/turn |
| 10    | $10,000,000 | 90      | +$5M/turn   |

**Opposition Research** (5 levels):

| Level | Cost     | Actions | Effect               |
| ----- | -------- | ------- | -------------------- |
| 1     | $40,000  | 8       | −0.5%/turn to target |
| 2     | $80,000  | 12      | −1.0%/turn to target |
| 3     | $160,000 | 16      | −1.5%/turn to target |
| 4     | $320,000 | 20      | −2.0%/turn to target |
| 5     | $640,000 | 24      | −2.5%/turn to target |

**Ground Game** (5 levels, has maintenance):

| Level | Cost     | Actions | Effect               | Maintenance/turn |
| ----- | -------- | ------- | -------------------- | ---------------- |
| 1     | $55,000  | 10      | +3% in swing states  | $5,500           |
| 2     | $110,000 | 15      | +6% in swing states  | $16,500          |
| 3     | $220,000 | 20      | +9% in swing states  | $38,500          |
| 4     | $440,000 | 25      | +12% in swing states | $82,500          |
| 5     | $880,000 | 30      | +15% in swing states | $170,500         |

**Media Spending** (5 levels, has maintenance):

| Level | Cost     | Actions | Effect                  | Maintenance/turn |
| ----- | -------- | ------- | ----------------------- | ---------------- |
| 1     | $60,000  | 12      | +0.5%/turn favorability | $6,000           |
| 2     | $120,000 | 16      | +1.0%/turn favorability | $18,000          |
| 3     | $240,000 | 20      | +1.5%/turn favorability | $42,000          |
| 4     | $480,000 | 24      | +2.0%/turn favorability | $90,000          |
| 5     | $960,000 | 28      | +2.5%/turn favorability | $186,000         |

**General phase multiplier:** Costs are 1.5× higher once the election enters the general phase.

### Maintenance Costs

Ground game and media spending have ongoing maintenance costs deducted each turn:

**Entry point:** `src/lib/campaigns/maintenance.ts`

```typescript
// Total maintenance = sum of all purchased levels
// Example: Ground Game level 3 = $5,500 + $16,500 + $38,500 = $60,500/turn
```

Maintenance is deducted from campaign funds before any other spending.

#### Insolvency & Auto-Downgrade

If projected funds (`funds + income`) can't cover the next turn's maintenance, the turn processor automatically demotes the campaign one level at a time until maintenance is affordable or both tiers reach level 0.

**Entry point:** `src/lib/campaigns/autoDowngrade.ts`

- **Priority** - The tier with the higher _incremental_ maintenance at its current level drops first (i.e., the most expensive marginal level gets cut).
- **Tie-breaker** - Media Spending goes first (advertising is easier to pull than canvassers).
- **No refund** - The player paid for the level; they don't get the money back.
- **Passive effects still fire this turn** - Favorability effects from media/opposition/travel use the _pre-downgrade_ levels - one last gasp before the downgrade takes effect. The maintenance deduction uses the _post-downgrade_ levels, so the campaign doesn't bleed further.
- **Audit trail** - Each demotion pushes a `downgrade` entry to `activityHistory` with `reason: "insolvency"`.

Existing negative `funds` values are not healed - the campaign still owes what it overspent. It simply stops draining further and can slowly recover from fundraising income.

### Fundraising Income

**Entry point:** `src/lib/campaigns/income.ts`

```typescript
// FUNDRAISING_INCOME array (src/lib/campaigns/upgradeCosts.ts)
[20k, 35k, 60k, 100k, 150k, 200k, 350k, 600k, 1M, 2.5M, 5M]
```

Income is added to campaign funds at the start of each turn (Group 1 processing).

### Opposition Research Retargeting

Once you have opposition research, you can change who you're targeting at any time from the campaign page. A 6-hour cooldown applies between retargets.

## Election Timing

### Campaign Season Multiplier

During the **final 4 turns** before an election closes, passive campaign effects automatically double (2×):

- Media spending favorability boost: `level × 0.5 × 2 = level × 1.0`/turn
- Opposition research drain: `level × 0.5 × 2 = level × 1.0`/turn to target

No player action is required - the multiplier activates automatically based on the election timer.

### Phase Strategy

- **During primaries** - Focus on your party's base demographics. Upgrade fundraising early to build the war chest.
- **General phase** - Upgrade costs are 1.5× higher. Front-load upgrades in the primary phase.
- **Final 4 turns** - Media spending and opposition research double in effectiveness. Time your opponent targeting carefully.

## Party Organization Bonus

Your party's organization level provides a vote multiplier applied across all your party's votes:

- **Formula** - in general elections each party's vote weight is its share of all party organization in the state, raised to the power 0.2 (`orgVoteWeight` and `ORG_WEIGHT_EXPONENT` in `src/lib/electionEngine/electionFormulaFactors.ts`). The exponent softens a dominant party's edge: a 3:1 organization lead gives about a 1.25:1 vote weight.
- **Primaries** - organization is a neutral 1× inside a party
- Building org rewards your whole party's electoral performance

## Fog of War

Opponents don't see your exact upgrade levels - they see a fogged estimate:

**Entry point:** `src/lib/campaigns/fogOfWar.ts` → `updateCampaignFogOfWar()`

| Viewer            | Variance  | Example: If you're level 5 |
| ----------------- | --------- | -------------------------- |
| **Public**        | ±3 levels | They see 2-8               |
| **Party members** | ±1 level  | They see 4-6               |

**Update frequency:** Every turn during campaign processing (Group 6)

**Implementation:**

```typescript
// applyFog(actualLevel, variance)
const offset = Math.floor(Math.random() * (variance * 2 + 1)) - variance;
const displayedLevel = actualLevel + offset;
```

Fog applies to all four upgrade categories independently.

## Related Pages

- [Election Mechanics](./elections.md) - How elections actually work
- [Demographics & Targeting](./demographics-targeting.md) - Understanding voter groups
- [Stats & Actions](./stats-actions.md) - Action costs and stat effects
- [Campaign Manager](./campaign-manager.md) - Using the campaign page
