# Campaign Strategy

## Summary

Exact rules for campaign budgets, upgrade costs, maintenance, fog of war and election timing in A House Divided, with the strategy reasoning behind them. Campaign doc, endorsements and managers are in [Campaign Manager](./campaign-manager.md).

Player guide: [Campaign Strategy](https://www.ahousedividedgame.com/wiki/campaign-strategy)

## Rules

### Core principle

Every action you spend should move you closer to one goal: **winning your next election**. Early game is about building a base; mid-game is about positioning; late game is about turnout.

### Building influence

Political Influence (0-100) is your footprint in your home state. Higher influence = more votes.

- **Campaign action** - raises Political Influence; the bread-and-butter early move. The per-action gain is in [Stats & Actions](./stats-actions.md).
- **Influence decay** - `POLITICAL_INFLUENCE_DECAY_RATE = 0.0075` (`shared/constants/formulas.ts`): 0.75% of current influence per turn, so decay bites harder the higher you climb. Members of the party holding the national executive decay faster, 1.0x to 2.0x depending on that government's approval (0% approval is 2.0x). You must keep campaigning to maintain your base.
- **Office bonuses** - Holding office gives bonus actions, making it easier to maintain influence.

### Action allocation

You have limited actions each turn. Prioritize based on your situation:

| Situation                     | Priority                                     |
| ----------------------------- | -------------------------------------------- |
| New character, no office      | Campaign > Fundraise > Poll                  |
| Primary season                | Campaign heavily > targeted ads              |
| General election              | Campaign + ads in weak demographics          |
| Incumbent seeking re-election | Maintain influence + fundraise for war chest |

### Campaign funds

Presidential and general-election candidates have a **separate campaign fund pool** distinct from personal Cash on Hand. This pool is:

- **Funded by** - Per-turn fundraising income (starter plus branches, see below), player donations, and party donations
- **Spent on** - Upgrade purchases and maintenance costs
- **Not transferable** - Campaign funds cannot be moved to personal Cash on Hand

#### Fundraising income (legacy flat levels)

Campaigns that have not started the Fundraising tree read a flat level (0-10) from `FUNDRAISING_INCOME` (`src/lib/campaigns/upgradeCosts.ts`) for passive income per turn. Every campaign earns the level 0 base of $20,000 with no upgrade:

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

The live model is the branch tree below; the flat level tables are kept because un-migrated rows still read them and because the tree starters reproduce their level 1 effects.

#### Donations

Any player can donate personal Cash on Hand to any campaign. Party chairs can donate from the party treasury. All donations are logged publicly on the campaign page.

### Campaign actions

Your campaign generates a pool of **campaign actions** each turn, separate from your character's action pool.

- **Baseline** - `max(baseActionsPerTurn, 4)`, halved (minimum 1) for NPP-run campaigns.
- **Endorsements** - NPP endorsements, plus player endorsements in presidential races, increase actions via `baseline + floor(sqrt(endorsements) × 3)` (`campaignActionsPerTurn`, `src/lib/campaigns/actions.ts`). Governor and executive endorsements count at `GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS = 1.5` each.
- **Bank cap** - at most `CAMPAIGN_ACTION_BANK_TURNS = 48` turns of income can be banked.

Campaign actions are spent on strategic upgrades and field offices. Full derivation in [Campaign Manager](./campaign-manager.md).

### Strategic upgrades

Each of four levers is a **starter unlock** plus **three branches** of up to `OPS_MAX_BRANCH_LEVEL = 3` levels (Strategic Operations v2, `OPS_TREES` in `src/lib/campaigns/upgradeCosts.ts`). The starter gates its branches. Every cost below is in anchor dollars for a presidential campaign, and is then multiplied by the race scalar and, in the general phase, by 1.5.

#### Upgrade Costs

**Entry point:** `src/lib/campaigns/upgradeCosts.ts`

Race scalar (`CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE`), applied to costs, maintenance, income and one-time lump sums: president 1.0; senate, governor, commons, shugiin, snap_shugiin, sangiin, bundestag, npcDelegate 0.5; ministerPresident and landtag 0.4; house, special_commons, regionalCouncil, peoplesCongress 0.3; stateSenate 0.2. Unknown or missing types use 1.0.

Balance adjustments (`OPS_UPKEEP_MULTIPLIER`, `OPS_TIER3_FUNDS_MULTIPLIER`): Ground Game and Media Spending upkeep is doubled, and their tier 3 purchase cost is multiplied by 1.5. The figures in the Ground Game and Media tables are the raw table values, before those two adjustments (the legacy flat tables below do not use them). Fundraising and Opposition Research are unchanged. Reason: a maxed presidential campaign raises tens of millions, so cheap upkeep made these levers a non-decision.

**Fundraising**

| Node | Cost | Actions | Effect | Upkeep |
| ---- | ---- | ------- | ------ | ------ |
| Starter | $50,000 | 10 | +$35k/turn base income | none |
| Grassroots 1 / 2 / 3 | $150k / $500k / $1.5M | 15 / 22 / 30 | +$200k / +$700k / +$1.8M per turn (cumulative) | none |
| Bundlers 1 / 2 / 3 | $120k / $320k / $700k | 18 / 24 / 32 | one-time +$250k / +$700k / +$1.5M on purchase | none |
| Direct Mail 1 / 2 / 3 | $200k / $500k / $1.1M | 16 / 22 / 30 | +15% / +35% / +60% on all income | $8k / $20k / $40k |

**Ground Game**

| Node | Cost | Actions | Effect | Upkeep |
| ---- | ---- | ------- | ------ | ------ |
| Starter | $55,000 | 10 | +3% in swing areas | $5,500 |
| Swing Canvassing 1 / 2 / 3 | $110k / $240k / $500k | 15 / 20 / 26 | +4% / +8% / +12% swing | $12k / $30k / $60k |
| Get-Out-The-Vote 1 / 2 / 3 | $130k / $300k / $650k | 16 / 22 / 30 | +1.5% / +3% / +5% in all areas | $10k / $24k / $50k |
| Volunteer Corps 1 / 2 / 3 | $90k / $200k / $420k | 12 / 16 / 22 | -15% / -30% / -50% of this lever's upkeep | none |

**Media Spending**

| Node | Cost | Actions | Effect | Upkeep |
| ---- | ---- | ------- | ------ | ------ |
| Starter | $60,000 | 12 | +0.5%/turn favorability | $6,000 |
| Broadcast 1 / 2 / 3 | $120k / $280k / $600k | 16 / 20 / 26 | +0.5 / +1.0 / +1.5 %/turn | $14k / $34k / $70k |
| Television 1 / 2 / 3 | $80k / $180k / $380k | 12 / 16 / 22 | +0.3 / +0.6 / +1.0 %/turn | $5k / $12k / $26k |
| Rapid Response 1 / 2 / 3 | $100k / $220k / $460k | 14 / 18 / 24 | -25% / -50% / -75% of incoming opposition research | $8k / $18k / $38k |

**Opposition Research**

| Node | Cost | Actions | Effect | Upkeep |
| ---- | ---- | ------- | ------ | ------ |
| Starter | $40,000 | 8 | -0.5%/turn favorability to target | none |
| Dossier 1 / 2 / 3 | $80k / $180k / $400k | 12 / 16 / 22 | -0.5 / -1.0 / -1.5 %/turn (cumulative) | none |
| Scandal Leak 1 / 2 / 3 | $120k / $300k / $650k | 18 / 26 / 36 | one-time -2% / -4% / -7% to current target | none |
| Counter-Intel 1 / 2 / 3 | $90k / $200k / $420k | 12 / 16 / 22 | +20% / +40% / +70% on your recurring drain | none |

Effect rules (`src/lib/campaigns/opsEffects.ts`, `src/lib/campaigns/income.ts`):

- Income = `round((35,000 + Grassroots) × (1 + DirectMail) × scalar)`. A started Fundraising tree replaces the $20k no-upgrade base rather than adding to it.
- Media favorability per turn = `0.5 + Broadcast + Television`, times the season multiplier.
- Opposition drain per turn = `(0.5 + Dossier) × (1 + CounterIntel)`, times `(1 - targetShield)`, times the season multiplier.
- Ground Game swing bonus = `(3 + Swing Canvassing) / 100`; GOTV adds its percentage in all areas. Both are read by the presidential election engine (`src/lib/presidentialElectionEngine.ts`) and, for every other race, by the generic tally through `src/lib/campaigns/raceCampaignEffects.ts`.
- Bundlers and Scandal Leak are one-time: the lump sum lands at purchase and nothing recurs.

**Payback example (president, primary phase).** Starter Fundraising ($50k) plus Grassroots 1 ($150k) pays $35k + $200k = $235k per turn; it repays its $200k outlay in one turn. Adding Direct Mail 1 lifts that to $235k × 1.15 = $270,250 per turn for $200k more plus $8k a turn upkeep, a net gain of about $27k a turn over $235k, so it repays in about 7.3 turns. A governor campaign (scalar 0.5) pays and costs half as much, so the payback in turns is unchanged.

#### Legacy flat-level tables

Campaigns that never started a tree still read these (`UPGRADE_COSTS`). They match the table values the starters were built from.

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
| 1     | $40,000  | 8       | -0.5%/turn to target |
| 2     | $80,000  | 12      | -1.0%/turn to target |
| 3     | $160,000 | 16      | -1.5%/turn to target |
| 4     | $320,000 | 20      | -2.0%/turn to target |
| 5     | $640,000 | 24      | -2.5%/turn to target |

**Ground Game** (5 levels, has maintenance):

| Level | Cost     | Actions | Effect               | Upkeep added at this level |
| ----- | -------- | ------- | -------------------- | ---------------- |
| 1     | $55,000  | 10      | +3% in swing states  | $5,500           |
| 2     | $110,000 | 15      | +6% in swing states  | $16,500          |
| 3     | $220,000 | 20      | +9% in swing states  | $38,500          |
| 4     | $440,000 | 25      | +12% in swing states | $82,500          |
| 5     | $880,000 | 30      | +15% in swing states | $170,500         |

**Media Spending** (5 levels, has maintenance):

| Level | Cost     | Actions | Effect                  | Upkeep added at this level |
| ----- | -------- | ------- | ----------------------- | ---------------- |
| 1     | $60,000  | 12      | +0.5%/turn favorability | $6,000           |
| 2     | $120,000 | 16      | +1.0%/turn favorability | $18,000          |
| 3     | $240,000 | 20      | +1.5%/turn favorability | $42,000          |
| 4     | $480,000 | 24      | +2.0%/turn favorability | $90,000          |
| 5     | $960,000 | 28      | +2.5%/turn favorability | $186,000         |

**General phase multiplier:** `GENERAL_PHASE_UPGRADE_MULTIPLIER = 1.5` on funds and actions once the election is in its general phase. Maintenance is not surcharged.

#### Maintenance Costs

Ground Game, Media Spending and the Direct Mail branch have ongoing maintenance deducted each turn:

**Entry point:** `src/lib/campaigns/maintenance.ts`, `getTreeMaintenanceCost` in `src/lib/campaigns/upgradeCosts.ts`

```
treeUpkeep = (starter + sum of every owned branch tier's upkeep)
           × OPS_UPKEEP_MULTIPLIER      // 2 for Ground Game and Media, else 1
           × (1 - volunteerCorpsReduction)
total      = round(sum over levers of treeUpkeep × raceScalar)
```

Only the lever's own branch with `maintReductionPct` (Volunteer Corps, Ground Game) discounts that lever's upkeep. Levers without a started tree use the legacy cumulative sum:

```typescript
// Legacy: sum of purchased levels' per-level maintenance
// Example: Ground Game level 3 = $5,500 + $16,500 + $38,500 = $60,500/turn
```

Upkeep example (president): Ground Game starter plus Swing Canvassing 2 and GOTV 1. Raw upkeep = 5,500 + (12,000 + 30,000) + 10,000 = 57,500, doubled to $115,000 a turn. Adding Volunteer Corps 2 (-30%) brings it to $80,500.

Maintenance is charged inside `campaignTurn` from campaign funds each turn, after income is added.

##### Insolvency & Auto-Downgrade

If projected funds (`funds + income`) can't cover the next turn's maintenance, the turn processor automatically demotes the campaign one step at a time until maintenance is affordable or nothing maintenance-bearing is left.

**Entry point:** `src/lib/campaigns/autoDowngrade.ts` (`computeAutoDowngrade`)

- **Candidates** - every owned branch tier that carries upkeep, across all started trees, plus legacy `groundGameLevel` and `mediaSpendingLevel` for un-migrated levers. Zero-upkeep branches (Volunteer Corps) are never demoted for savings.
- **Priority** - the single step that saves the most upkeep drops first (the most expensive marginal tier gets cut).
- **Last resort** - once every upkeep-bearing branch of a lever is at 0, the starter itself can be shed (`starter` becomes false and its branches reset to 0).
- **Loop guard** - at most 64 demotions per campaign per turn.
- **No refund** - The player paid for the level; they don't get the money back.
- **Passive effects still fire this turn** - Favorability effects from media/opposition/travel use the _pre-downgrade_ levels - one last gasp before the downgrade takes effect. The maintenance deduction uses the _post-downgrade_ levels, so the campaign doesn't bleed further.
- **Audit trail** - Each demotion pushes a `downgrade` entry to `activityHistory` with `reason: "insolvency"`.

Existing negative `funds` values are not healed - the campaign still owes what it overspent. It simply stops draining further and can slowly recover from fundraising income. To recover: buy a zero-upkeep income branch (Grassroots, Bundlers) before adding upkeep-bearing ones, or take donations.

#### Fundraising Income

**Entry point:** `src/lib/campaigns/income.ts`

```typescript
// Started tree:  round((35_000 + Grassroots) × (1 + DirectMail) × raceScalar)
// No tree:       round(FUNDRAISING_INCOME[fundraisingLevel] × raceScalar)
// FUNDRAISING_INCOME (src/lib/campaigns/upgradeCosts.ts)
[20k, 35k, 60k, 100k, 150k, 200k, 350k, 600k, 1M, 2.5M, 5M]
```

Income is added to campaign funds each turn in `processCampaignTurn`, before maintenance and the solvency check.

#### Opposition Research Retargeting

Once you have opposition research, you can change who you're targeting from the campaign page. `OPPOSITION_RESEARCH_COOLDOWN_TURNS = 6` (`src/lib/campaigns/commands/campaignManagementCommands.ts`) turns apply between retargets. The target must be a real opponent in your race.

### Election timing effects

#### Campaign Season Multiplier

When `election.endTurn - currentTurn <= 4` (`src/lib/turn/campaignTurn.ts`; falls back to `ceil(hoursRemaining) <= 4` when no `endTurn` is stored), passive campaign effects automatically double (2×):

- Media spending favorability boost: `(0.5 + Broadcast + Television) × 2`/turn
- Opposition research drain: `(0.5 + Dossier) × (1 + CounterIntel) × (1 - shield) × 2`/turn to target

Income, maintenance, upgrade costs and campaign actions are not affected. No player action is required. The window matches the vote engine's closing surge so passives and votes intensify together.

#### Phase Strategy

- **During primaries** - Focus on your party's base demographics. Upgrade fundraising early to build the war chest.
- **General phase** - Upgrade costs are 1.5× higher. Front-load upgrades in the primary phase.
- **Final 4 turns** - Media spending and opposition research double in effectiveness. Time your opponent targeting carefully.

### Party organization bonus

Your party's organization level provides a vote multiplier applied across all your party's votes:

- **Formula** - in general elections each party's vote weight is its share of all party organization in the state, raised to the power 0.2 (`orgVoteWeight` and `ORG_WEIGHT_EXPONENT` in `src/lib/electionEngine/electionFormulaFactors.ts`). The exponent softens a dominant party's edge: a 3:1 organization lead gives about a 1.25:1 vote weight.
- **Primaries** - organization is a neutral 1× inside a party
- Building org rewards your whole party's electoral performance

### Fog of war

Opponents don't see your exact upgrade levels - they see a fogged estimate:

**Entry point:** `src/lib/campaigns/fogOfWar.ts` → `updateCampaignFogOfWar()`

| Viewer            | Variance  | Example: If you're level 5 |
| ----------------- | --------- | -------------------------- |
| **Public**        | ±3 levels | They see 2-8               |
| **Party members** | ±1 level  | They see 4-6               |

**Update frequency:** every turn on the turn cron (`src/lib/cron.ts`, also `/api/cron/fog-update`), separate from `campaignTurn`; skipped while the game is paused.

**Implementation:**

```typescript
// applyFog(actualLevel, variance)
const offset = Math.floor(Math.random() * (variance * 2 + 1)) - variance;
const displayedLevel = Math.max(0, Math.min(max, actualLevel + offset));
```

Fog applies to all four upgrade categories independently. It is built from the legacy flat level fields and clamped to each category's maximum (10 for fundraising, 5 for the others), so a rival never sees an impossible level.

### Era price level

When `gameConfig.campaignEraPriceLevelEnabled` is on, purchase funds, lump sums, income and upkeep are multiplied by the era price level before conversion to local currency (`src/lib/campaigns/rules/priceLevel.ts`; actions are not scaled): 1953 0.03673, 1979 0.16688, 1991 0.35808, 1999 0.49707, 2007 0.6562, 2019 1, 2023 1.14996, 2027 1.28579. Off by default, which is a price level of 1. Every table above is at price level 1.

### Passive favorability gain near the top

The summed positive passive gain on a candidate (media, travel presence, primary in-state bonus) is reduced by `(favorability - 80) × 0.15` once favorability is above 80, with a floor of 0.5 a turn (`diminishPassiveFavorabilityGain`, `src/lib/actions.ts`). It applies after the season multiplier. Opposition drain is not reduced.

## Data

- `campaigns` (read and written): `funds`, `actions`, the four `*Tree` objects, the legacy `*Level` fields, `oppositionTargetId`, `activityHistory` (upgrade and `downgrade` entries, `reason: "insolvency"`), `totalFundsGenerated`, `totalFundsSpent`, `totalActionsGenerated`, `totalActionsSpent`, `spendThisTurn`, `spendStock`, `publicFogOfWar`, `partyFogOfWar`.
- `characters` and `npps` (written): `favorability`, by the media gain to self and the opposition drain to the target, clamped to its range.
- `electionCandidates` (read): `travelState`, `primaryCampaignState`; (written) `primaryCampaignTicks`.
- `elections` (read): `electionType` (scalar), `endTurn`, `primaryEndTurn` (phase and season window), `countryId` (currency).
- `gameConfig` and `gameState` (read): `baseActionsPerTurn`, `campaignEraPriceLevelEnabled`, `politicalMediaMarketEnabled`, preset.

Player-visible: the owner sees tree state, next-tier costs and the activity log. Party members and the public see only the fogged level snapshots. Costs and the tables on this page are public in the wiki.

## Configuration

| Setting | Default | Where set |
| ------- | ------- | --------- |
| `gameConfig.baseActionsPerTurn` | 4 (floored at 4 in use) | `src/lib/seeds/reference/gameConfig.ts` |
| `gameConfig.campaignEraPriceLevelEnabled` | unset (price level 1) | `src/lib/db/types/gameConfig.ts` |
| `gameConfig.politicalMediaMarketEnabled` | unset (off); when on, media upkeep is routed through a political media order | `src/lib/db/types/gameConfig.ts` |
| Race scalar | table in Rules | `CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE`, `src/lib/campaigns/upgradeCosts.ts` |
| Ground Game and Media balance | upkeep ×2, tier 3 funds ×1.5 | `OPS_UPKEEP_MULTIPLIER`, `OPS_TIER3_FUNDS_MULTIPLIER` (code constants, not config) |
| General-phase surcharge | 1.5 | `GENERAL_PHASE_UPGRADE_MULTIPLIER` |
| Season window | final 4 turns | `src/lib/turn/campaignTurn.ts` |
| Fog variance | public ±3, party ±1 | `src/lib/campaigns/fogOfWar.ts` |
| Opposition retarget cooldown | 6 turns | `OPPOSITION_RESEARCH_COOLDOWN_TURNS` |
| Insolvency loop guard | 64 demotions per campaign per turn | `src/lib/campaigns/autoDowngrade.ts` |

No era or country preset changes the upgrade tables; countries differ only through the race scalar and which race types are eligible (see [Campaign Manager](./campaign-manager.md)).

## Timing

- **Primary phase**: costs are base; income, maintenance, media and opposition passives run every turn in `campaignTurn` (phase `billsCampaignsAndActivity` in `src/simulation/phases/turnPhaseRegistry.ts`).
- **General phase**: purchase costs (funds and actions) rise 1.5x (`GENERAL_PHASE_UPGRADE_MULTIPLIER`). Upkeep is unchanged.
- **Final 4 turns**: media and opposition passives double.
- **Within one turn**: endorsement sweeps, then `campaignTurn` (income, actions, maintenance and solvency, passives), then later `voteAccumulation`, then `campaignSpendReset`. Purchases and donations are immediate and take effect on the next `campaignTurn`.
- Party organization weights apply in vote accumulation, not in `campaignTurn`.

Full order inside the turn:

```
governor / executive / player-endorsement sweeps
  -> selfHealMissingCampaigns
  -> campaignTurn: income, actions, maintenance + auto-downgrade, passives
  -> campaignFieldOffices upkeep
  -> voteAccumulation (reads spendThisTurn)
  -> campaignSpendReset (spendStock = spendStock x 0.8 + spendThisTurn)
Fog of war: separate cron on the turn schedule, skipped while paused
```

## Worked trace

**A. Buying Broadcast 3 (governor race, general phase).** Raw tier: $600,000, 26 actions, upkeep $70,000.

1. Tier 3 balance adjustment for Media Spending: `600,000 × 1.5 = 900,000`.
2. Race scalar 0.5: `round(900,000 × 0.5) = 450,000`.
3. General phase: `ceil(450,000 × 1.5) = 675,000` funds; actions `ceil(26 × 1.5) = 39`.
4. Upkeep added: `round(70,000 × 2 × 0.5) = 70,000` a turn.

**B. Passives in the final 4 turns.** Media tree: starter + Broadcast 1 + Television 1.

1. Media gain: `0.5 + 0.5 + 0.3 = 1.3`, times season 2 = 2.6.
2. Candidate favorability 85: penalty `(85 - 80) × 0.15 = 0.75`, so the stored gain is `max(0.5, 2.6 - 0.75) = 1.85`.
3. Opposition: starter + Dossier 2 = `0.5 + 1.0 = 1.5`; Counter-Intel 1 gives `× 1.2 = 1.8`; target has Rapid Response 2 (shield 0.5) so `× 0.5 = 0.9`; season `× 2 = 1.8` favorability drain, applied undiminished.

**C. Insolvency (presidential race).** Ground Game starter + Swing Canvassing 2 + GOTV 1. Raw upkeep `5,500 + 12,000 + 30,000 + 10,000 = 57,500`, doubled to 115,000. Funds 20,000 plus income 60,000 gives projected 80,000, which is below 115,000.

1. Candidate steps: Swing Canvassing 2 to 1 saves `30,000 × 2 = 60,000`; GOTV 1 to 0 saves `10,000 × 2 = 20,000`. The starter is not eligible while branches remain.
2. The largest saving wins: Swing Canvassing drops to level 1. New upkeep `(5,500 + 12,000 + 10,000) × 2 = 55,000`, which fits under 80,000, so the loop stops.
3. This turn's media and opposition passives still use the pre-downgrade levels; 55,000 is charged. A `downgrade` entry with `reason: "insolvency"` is appended to `activityHistory`. No refund.

## Edge cases and limits

- **Archived or suspended campaigns** draw no income, actions or maintenance.
- **Funds can go negative** from past overspending; auto-downgrade stops further drain but never heals the debt.
- **Branch cap**: 3 levels per branch; the starter must be bought first.
- **One-time branches** (Bundlers, Scandal Leak) pay out at purchase only and carry no upkeep, so insolvency never removes them.
- **Scalar and rounding**: costs are `ceil(round(cost × scalar) × 1.5)` in the general phase, so tiny races can round up by a dollar.
- **Insolvency order** cuts the largest single upkeep step first, so a cheap branch can survive while an expensive one is shed.
- **Player endorsements** add actions only in presidential races.
- **Why the 1.5x general surcharge**: it pushes players to front-load investment in the primary, when money is scarcer, rather than buying everything late.
- **Price level and currency**: with the era price level on, funds scale by the era value and are then converted to the campaign's local currency at the frozen rate.
- **Unknown race types** use scalar 1.0.
- **Fog granularity**: fog is applied to the four legacy level fields independently, clamped to `[0, max]` (10 for fundraising, 5 for the others).

## Invariants

- Each branch is at most 3 and a starter precedes any branch (purchase gate in `src/lib/campaigns/commands/campaignCommands.ts`). Cost behaviour: `src/lib/campaigns/upgradeCosts.test.ts`.
- After a turn's auto-downgrade, charged maintenance is at most projected funds unless nothing maintenance-bearing is left; the loop ends in at most 64 steps (`src/lib/campaigns/autoDowngrade.test.ts`).
- Displayed fog levels are within `[0, max]` (`src/lib/campaigns/fogOfWar.test.ts`).
- Displayed and charged purchase cost agree because both use `getEffectiveBranchCost`. Not covered by a test that compares the two.
- Bundlers and Scandal Leak never recur and carry no upkeep, so insolvency cannot remove them (by construction in `OPS_TREES`).
- `funds` has no floor. Not enforced.

## Failure and recovery

- **Overspent campaigns**: funds go negative; the auto-downgrade stops the bleed but does not repay it. Players recover with zero-upkeep income branches or donations; a bug-caused balance is repaired by a data heal.
- **Wrong displayed levels** to rivals: fog is regenerated by the next cron run; a rerun of the fog job fixes stale snapshots.
- **Purchase races**: a purchase that loses a race on funds or tree state returns 409 and charges nothing.
- **Wrong rate or price level after a config change**: costs and income read config at the time of the write, so already-stored balances are not recomputed; correct with a heal if a window of turns used the wrong value.

## Connections

**Driven by**

- [Campaign Manager](./campaign-manager.md): the campaign doc, endorsements and managers that feed `campaignActionsPerTurn`.
- [Elections](./elections.md): election type (scalar), phase (1.5x) and `endTurn` (final-4 window).
- [NPP System](./npp-system.md): endorsement sources.
- Party treasury: donations through `donateToCampaign`.

**Affects**

- Candidate and target favorability: `campaignTurn` writes media gain and opposition drain, read by the vote engine.
- Election engines: ground game swing and GOTV bonuses (`getGroundGameSwingBonus` in `src/lib/campaigns/opsEffects.ts`), read by the presidential engine and by the generic tally via `src/lib/campaigns/raceCampaignEffects.ts`.
- Party organization weight (`orgVoteWeight` in `src/lib/electionEngine/electionFormulaFactors.ts`) in vote accumulation.
- Rival intel: fog of war snapshots on the campaign doc (`publicFogOfWar`, `partyFogOfWar`).

Related pages:

- [Election Mechanics](./elections.md) - How elections actually work
- [Demographics & Targeting](./demographics-targeting.md) - Understanding voter groups
- [Stats & Actions](./stats-actions.md) - Action costs and stat effects
- [Campaign Manager](./campaign-manager.md) - Using the campaign page
- [Canvassing](./canvassing.md) - The personal turnout action

## Tests

- `src/lib/campaigns/upgradeCosts.test.ts`: tables, scalar, general-phase cost (`getEffectiveBranchCost`).
- `src/lib/campaigns/income.test.ts`, `src/lib/campaigns/maintenance.test.ts`, `src/lib/campaigns/autoDowngrade.test.ts`: income, upkeep, insolvency.
- `src/lib/campaigns/fogOfWar.test.ts`: `applyFog`.
- `src/lib/campaigns/opsCurrentEffect.test.ts`, `src/lib/campaigns/dto/campaignOpsEffects.test.ts`, `src/lib/campaigns/raceCampaignEffects.test.ts`: effect values and race effects.
- `src/lib/electionEngine/electionFormulaFactors.test.ts`: organization weight.
- `shared/constants/formulas.test.ts`: influence decay constants.
- `src/lib/turn/campaignTurn.test.ts`: the turn pass.
- Gaps: `diminishPassiveFavorabilityGain` is not named in any test file; the season multiplier numbers are covered only through the turn test; no test compares the legacy tables with the starter values.

## Known issues and history

- The legacy flat tables are kept because un-migrated rows still read them and the tree starters reproduce their level 1 effects.
- Fog of war reads only the legacy flat level fields, while purchases change the branch trees. Fog for tree-based campaigns may therefore not track the trees. Read from code, not confirmed against live data.
- Ground Game's vote effect applies to every eligible race through `raceCampaignEffects.ts`, not only the presidency.
- Ground Game and Media Spending upkeep was doubled and their tier 3 cost raised by 1.5 because a maxed presidential campaign raises tens of millions and cheap upkeep made these levers a non-decision (`src/lib/campaigns/upgradeCosts.ts`).

Last checked: 2026-10-29, version 1.18.0
