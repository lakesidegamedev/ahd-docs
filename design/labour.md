# Labour & Unions

The labour system models per-sector wage decisions as a first-class economic and political lever: explicit worker pay carved out of corporate maintenance costs, a macro feedback loop tying wages into unemployment/income/migration, an NPC unionization metric with strikes, and a full player-run union layer (found a union, organize/raid sectors, elect a leader, strike, bargain collectively, demand wages, set dues/services/political contributions, endorse legislation, get busted or write union law). It ships as one graduated feature flag so every tier can be validated independently before the next unlocks.

Player guide: [Labour & Wages](https://www.ahousedividedgame.com/wiki/labour-and-wages) and [Unions](https://www.ahousedividedgame.com/wiki/unions)

**Entry point:** `src/lib/labour/featureFlag.ts` (`labourSystemMode`, `isLabourWagesEnabled()`/`isLabourMacroEnabled()`/`isLabourUnionsEnabled()`/`isLabourFullMode()`)

All four layers (wages, macro feedback, NPC unionization with strikes, and the full player-run union layer) are live in current worlds. The tier structure below is how the code is gated, not something a player sees.

## Overview

- **Scope:** Per-`CorporateSector` wage economics, national/state macro metrics, NPC + player-run unions, union-law legislation
- **Target:** All player and NPC corporations; unions represent the specific `CorporateSector`s they have organized or raided, not an entire (country, industry) pair by default, rival unions may coexist in the same (country, sector type)
- **Effects:** Corp profit margins, state `medianIncome`/`unemploymentRate`, international migration pull, strikes (revenue throttle), union treasury/membership/dues/services, legislative NPI cost
- **Enactment:** in-game actions (wage slider, found, organize/raid, vote leader, strike, bargain, bust, demand-wage, dues/services/political contributions, endorse); `union_law` bill provisions; the minimum-wage Kaitz ratio is a national budget field (`FederalBudget.minimumWageKaitzRatio`) that the player wiki describes as set by legislation, while the code comments call it administrator-set today (see Edge cases)

## `labourSystemMode` tiers

One graduated flag on `GameConfig` (order `off, wages, macro, unions, full`, `src/lib/labour/modes.ts`), each tier a strict superset of the previous. `getLabourSystemMode()` returns `"off"` only when the field is absent or unknown.

| Tier     | Unlocks                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`    | Nothing, legacy flat `maintenance` cost, no labour fields read or written                                                                                                              |
| `wages`  | Explicit per-sector labor cost (profit-invariant at baseline), CEO wage-level slider (0.8×, 1.5×), minimum wage (Kaitz ratio), automation tech effect                                  |
| `macro`  | Wage decisions feed `medianIncome` (Phillips-curve passthrough) and `unemploymentRate` (wage + automation pressure terms), and modulate international migration pull                   |
| `unions` | NPC-driven per-sector `unionization` (0-100), `unionPremium` labor-cost surcharge, strikes (trigger/concession/waitout)                                                                |
| `full`   | Union-busting, union-law legislation, and the entire player-run union layer (found/organize/raid/vote-leader/strike/bargain/demand-wage/dues/services/political-contributions/endorse) |

## Data model

```typescript
// src/lib/labour/laborCost.ts (LabourContext, assembled per corp turn)
interface LabourContext {
  wagesEnabled: boolean;
  unionsEnabled: boolean;
  fullEnabled: boolean;
  minWageRatioByCountry: Map<CountryId, number>;
  unionLawBiasByCountry: Map<CountryId, number>;
  ownedUnionMembershipPressureByKey: Map<string, number>; // key: `${countryId}|${sectorType}`
}
```

```typescript
// src/lib/db/types/corporation.ts (CorporateSector labour fields)
interface CorporateSector {
  // ...
  wageLevel?: number; // CEO slider, 0.8-1.5, default 1.0
  unionization?: number; // 0-100, NPC-driven trending stock (mode >= "unions")
  workerExpectationIndex?: number; // slow-trending real-wage expectation (strikes)
  strikeStartedAtTurn?: number | null;
  strikeCooldownUntilTurn?: number | null;
  bustingCooldownUntilTurn?: number | null; // mode >= "full"
}
```

```typescript
// src/lib/db/types/union.ts
interface Union {
  _id: ObjectId;
  countryId: CountryId;
  sectorType: CorporationType; // NOT unique on (countryId, sectorType) under union dues v1, foundUnion() lets a rival union coexist in the same pair
  name: string; // era-appropriate seeded display name, or player-chosen on foundUnion
  ownerId: ObjectId | null; // null = NPC/unmanned; source of truth for leadership
  pendingLeaderCharacterId?: ObjectId | null; // top vote-getter from voteUnionLeader, awaiting acceptance
  treasury: number;
  membershipPressure: number; // 0-100, additive term into unionizationDriftTarget()
  suspended?: boolean;
  duesPerWorkerAnnual?: number;
  activeServices?: string[];
  politicalContributionPct?: number; // 0-0.5
  lastCalledStrikeTurn: number | null;
  demandedWageLevel: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UnionEndorsement {
  _id: ObjectId;
  unionId: ObjectId;
  billId: ObjectId;
  stance: "endorse" | "oppose";
  createdAt: Date;
}
```

`Character.unionLeaderOf` is a **denormalized read cache** of `Union.ownerId`, mirroring the existing `factionId`/`caucusMemberships` pattern, reconciled on read (`reconcileUnionOwnerCache`/`reconcileUnionLeaderCache` in `src/lib/unions/unionReconciliation.ts`) rather than via a periodic sweep, since the one-leader/one-union invariant is far simpler than caucus membership.

## Phase 0-1, wages (`labourSystemMode >= "wages"`)

Explicit per-sector labor cost. In the legacy cost modes it is carved OUT of `maintenance` (never added on top), so it is profit-invariant at the baseline wage multiplier (`computeSectorLaborCost`, `src/lib/labour/laborCost.ts`). Under the explicit plant cost model labour is billed directly on top of inputs and overhead, so the intensity table sets base margins; the wage slider and union premium scale it the same way in both. `SECTOR_LABOR_INTENSITY` (cost share of revenue) and `SECTOR_WAGE_LEVEL` (relative pay per worker) are separate tables in `src/lib/labour/laborCost.ts`, so minimum wage correctly bites labor-intensive/low-paid sectors (retail, agriculture) instead of labor-light ones (extraction). CEO wage slider: `WageLevelPanel.tsx`. Minimum wage: Kaitz ratio on `FederalBudget.minimumWageKaitzRatio`, clamped to `[0, MIN_WAGE_KAITZ_MAX = 1.0]`. Automation tech reduces labor cost via the existing tech-tree framework.

Constants (all in `src/lib/labour/laborCost.ts`):

| Constant | Value |
| --- | --- |
| `WAGE_LEVEL_MIN` / `WAGE_LEVEL_MAX` / `WAGE_LEVEL_DEFAULT` | 0.8 / 1.5 / 1.0 |
| `LABOUR_DEFAULT_LABOR_SHARE` (unknown sector type) | 0.2 |
| `eraLaborMultiplier` | 1.0 from 2007, 1.1 from 1991, 1.25 from 1953, 1.35 before |
| `SECTOR_LABOR_INTENSITY` (share of revenue) | technology 0.35, financial 0.325, media 0.28, healthcare 0.277, construction 0.264, defense 0.24, telecommunications 0.2, retail 0.191, real_estate 0.191, logistics 0.18, agriculture 0.16, manufacturing 0.159, chemical_industries 0.15, manufacturing_vehicles 0.141, extraction 0.12, energy 0.1 |
| `SECTOR_WAGE_LEVEL` (pay per worker) | technology 1.8, financial 1.7, healthcare 1.3, defense 1.3, energy 1.2, chemical_industries 1.2, telecommunications 1.2, extraction 1.1, media 1.1, manufacturing_vehicles 1.0, manufacturing 0.95, construction 0.9, real_estate 0.9, media_entertainment 0.85, logistics 0.8, retail 0.6, agriculture 0.55 |

Labor share is `intensity x eraMultiplier`. The minimum-wage floor multiplier is `floor / sectorWage` when the sector's pay level is below `kaitzRatio x MEDIAN_SECTOR_WAGE_LEVEL` (the median of the table above), otherwise 1.

Why two tables: a sector can be labour-intensive yet low-paid (retail) or capital-light yet high-paid (technology). Keeping them apart lets a minimum wage bite the genuinely low-paid sectors.

**Worked example.** A retail sector earns 100,000 an hour at unionization 40. Labor share is 0.191, so baseline labor is 19,100. The CEO sets wage level 1.2. The union premium at unionization 40 is 40/100 x 15 = 6%, so the combined multiplier is 1.2 x 1.06 = 1.272 and labor cost is about 24,295. That is 5,195 more an hour, or 5.2 points of margin, in return for a higher real-wage index and lower strike and unionization pressure.

## Phase 2 (v2), macro coupling (`labourSystemMode >= "macro"`)

Routes labour wage decisions into the existing `medianIncome` Phillips-curve node rather than wiring every downstream channel individually:

- **Migration pull:** per-state `labourWageIndex` (worker-weighted `wageLevel × minWageFloorMultiplier`, 1.0 = baseline) multiplies `economicPullFactor`'s output via `labourMigrationWageFactor()` = `1 + (index - 1) x 0.5` (`LABOUR_MIGRATION_WAGE_K = 0.5`), bounded `[0.7, 1.3]`, re-clamped to `[0.5, 1.5]` overall.
- **Income channel:** `labourWageIndexDelta` (this-turn minus prior-turn index, zero on cold start) feeds `wageGrowthAnnualPct` inside `medianIncomeNode.compute()` via `labourWageIncomePassthrough()` = `delta x 100 x LABOUR_WAGE_PASSTHROUGH` with `LABOUR_WAGE_PASSTHROUGH = 0.5`.
- **Jobs channel:** the same wage delta adds a capped unemployment pressure term (`labourUnemploymentWagePressure`, `LABOUR_UNEMPLOYMENT_WAGE_K = 1.5` pp per index-point, `LABOUR_UNEMPLOYMENT_WAGE_CAP_PP = 1.5`, so ±1.5pp); a separate `automationIndexDelta` (worker-weighted `techEffects.laborCostMultiplier`) adds an inverted pressure term (`labourUnemploymentAutomationPressure`, `LABOUR_UNEMPLOYMENT_AUTOMATION_K = 2.5` pp per index-point, `LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP = 1.5`), automation cutting headcount is deliberately a different signal from wages cutting pay.

A separate level term, `labourMarket.ts`, compares corporate desired headcount with the civilian labour force: tightness shifts the unemployment target by `LABOUR_UNEMPLOYMENT_TIGHTNESS_K = 0.5` pp per unit of ln(tightness), capped at `LABOUR_UNEMPLOYMENT_TIGHTNESS_CAP_PP = 0.5`, and corporate staffing glides toward its target by at most `LABOUR_STAFFING_MAX_TURN_MOVE = 0.1` per turn. It is not gated on the wage tier, because headcount demand exists whether or not wages are switched on.

Convention: **Δ not level** for anything read into a compounding series (medianIncome, unemploymentRate), a level term would march the series to its bound and pin there (the tightness term above is the deliberate exception, capped small). Unionization itself is the exception (see Phase 5) because it's a target-trending stock, not a recursive series.

## Phase 5, NPC unionization metric (`labourSystemMode >= "unions"`)

Per-sector `unionization` (0-100) drifts each turn toward a condition-driven target (`unionizationDriftTarget()` in `src/lib/labour/unionization.ts`), inputs: CEO `wageLevel` vs. state cost-of-living (`realWageIndex()`), state `unemploymentRate` (worker leverage), country minimum-wage Kaitz ratio, and (once `full`) `unionLawBias`. A shop held by a player union does not use this economic target: it tracks that union's approval directly (`representingUnionApproval`), so how the union is run decides density there.

```
target = clamp(UNIONIZATION_BASELINE
               + (1 - realWage) × UNIONIZATION_REAL_WAGE_WEIGHT
               + (UNIONIZATION_NEUTRAL_UNEMPLOYMENT - unemployment) × UNIONIZATION_UNEMPLOYMENT_WEIGHT
               + (UNIONIZATION_NEUTRAL_KAITZ - kaitz) × UNIONIZATION_MINWAGE_WEIGHT
               + unionLawBias × 0.6, 0, 100)
```

| Constant (`src/lib/labour/unionization.ts`) | Value |
| --- | --- |
| `UNIONIZATION_BASELINE` | 20 |
| `UNIONIZATION_NEUTRAL_UNEMPLOYMENT` (%) | 5 |
| `UNIONIZATION_NEUTRAL_KAITZ` | 0.5 (also used when a country has no minimum wage) |
| `UNIONIZATION_REAL_WAGE_WEIGHT` | 40 |
| `UNIONIZATION_UNEMPLOYMENT_WEIGHT` | 3 |
| `UNIONIZATION_MINWAGE_WEIGHT` | 20 |
| union-law weight | 0.6 (law term max ±30pp at bias ±50) |
| `UNIONIZATION_TREND_STEP_PER_TURN` | 1.5 |
| `UNIONIZATION_BAN_DECAY_STEP_PER_TURN` (country union ban) | 3 |
| `UNION_PREMIUM_MAX_PCT` | 15 |

Stored unionization moves toward the target by at most 1.5 points per turn. `unionPremium(unionization)` is a standing labor-cost surcharge, linear from 0 at unionization 0 to 15pp at 100, folded into `wageMultiplier` using the prior turn's persisted value (one-turn lag, consistent with the rest of the labour system). It is skipped in a country that bans unions.

**Worked example.** A sector at wage level 0.8 (cost of living 100) in a country with unemployment 2%, Kaitz ratio 0.3 and union-law bias +40: 20 + (0.2 x 40 = 8) + (3 x 3 = 9) + (0.2 x 20 = 4) + (40 x 0.6 = 24) = 65. At 1.5 points a turn a sector starting at 20 reaches 55 in 24 turns.

## Phase 6, strikes (`labourSystemMode >= "unions"`)

Per-sector bounded-duration event (`src/lib/labour/strikes.ts`). Triggers when `unionization > STRIKE_UNIONIZATION_THRESHOLD` (55, calibrated well under `unionizationDriftTarget()`'s composed ceiling, see the calibration note below) **and** a slow-trending `workerExpectationIndex` lags the current real wage by more than `STRIKE_EXPECTATION_GAP_THRESHOLD` (0.12). While active: revenue ×0.75 (`STRIKE_REVENUE_THROTTLE`), margin −8pp. Resolves via **concession** (gap closes to ≤ `STRIKE_CONCESSION_GAP_THRESHOLD` = 0.04) or **wait-it-out** (`STRIKE_DURATION_TURNS`=4 turns, unionization +10). Cooldown (`STRIKE_COOLDOWN_TURNS`=12) is set on both resolution paths, that, plus the trigger/concession hysteresis gap and the slow expectation index, is what prevents an always-strike/never-strike equilibrium.

`workerExpectationIndex` trends toward the current real wage by at most `WORKER_EXPECTATION_TREND_STEP = 0.02` per turn, so a CEO cannot game the gap by oscillating the slider. Other end states: `resolved_banned` (a country union ban) and `resolved_agreement` (an active collective agreement also blocks new strikes in that local). A union-law bias moves the trigger threshold to `55 - bias x STRIKE_LAW_THRESHOLD_WEIGHT` with `STRIKE_LAW_THRESHOLD_WEIGHT = 0.2` (so +50 bias drops it to 45, -50 raises it to 65).

**Worked example.** A sector pays wage level 0.8 in a state with cost of living 100, so its real wage is 0.8, while workers expect 1.0. The gap is 0.20, above 0.12. At unionization 60 (above 55) a strike starts: revenue x0.75, margin -8pp for up to 4 turns. If the CEO raises pay and the gap closes to 0.04 or less, it ends early with a 12 turn cooldown. Otherwise it expires after 4 turns, unionization jumps +10 to 70, and the 12 turn cooldown begins.

**Calibration note:** the trigger/gap pair is deliberately reachable through _purely political_ levers (union-law bias, membership pressure) with zero real wage or employment stress, not just economic ones, this is intended (see `strikes.ts`'s docblock for the exact composed-ceiling math), not a miscalibration. No single factor alone crosses the threshold.

## Phase 7, union-busting + union law (`labourSystemMode >= "full"`)

- **Busting** (`src/lib/labour/unionBusting.ts`, command `attemptUnionBusting.ts`, route `POST /api/corporations/[id]/sectors/[sectorId]/union-busting`): CEO action modeled on the whip-success pattern. Success chance is `60 - round(unionization x 0.4)`, floored 20 and ceilinged 80 (`BUSTING_BASE_SUCCESS_CHANCE`, `BUSTING_UNIONIZATION_DIFFICULTY_WEIGHT`, `BUSTING_MIN_SUCCESS_CHANCE`, `BUSTING_MAX_SUCCESS_CHANCE`), so a shop at unionization 50 busts at 40%. Success drops `unionization` by 20pp **and ends any active strike** (clears `strikeStartedAtTurn`, starts the strike cooldown); backfire raises unionization by 15pp and leaves strike state untouched. Cash cost `BUSTING_COST_REVENUE_FRACTION = 0.5` of daily gross revenue (floor `BUSTING_MIN_COST = 1000`). `BUSTING_COOLDOWN_TURNS = 12`-turn busting cooldown either way. Rejected with 409 while the turn engine is mid-processing (`isTurnProcessingNow()` guard against a write race with the bulk corp-turn update).
- **Union law:** `UnionLawProvision { type: "union_law"; bias: number }`, a single signed axis (-50 right-to-work .. +50 collective-bargaining) written to `FederalBudget.unionLawBias` (`UNION_LAW_BIAS_MIN`/`UNION_LAW_BIAS_MAX`, `src/lib/labour/unionLaws.ts`). Feeds `unionizationDriftTarget()` (weight 0.6, max ±30pp) and a country-adjusted strike-trigger threshold override, deliberately does **not** bias the strike concession/gap threshold, to preserve Phase 6's hysteresis invariant. Bill authoring is an explicit "Include union-law provision" checkbox (not inferred from `bias !== 0`), since 0 is a valid, legislatable reset to neutral. NPI (National Political Influence) cost counts union-law provisions the same as policy/subsidy provisions, a bill can't add bias-shifting provisions for free.

## Phase 8, player-run unions (`labourSystemMode >= "full"`)

Under "union dues v1" a union is no longer a single seeded singleton per (countryId, sectorType) with first-come `claim` leadership. Any character may **found** a rival union in an industry that already has one (`src/lib/unions/commands/foundUnion.ts`), and a union only represents the specific `CorporateSector`s it has actually organized or raided, not every sector matching its (country, sector type) pair.

- **`organizeUnion`** (rank-and-file drive, `src/lib/unions/commands/organizeUnion.ts`), open to any character in the union's country, not only the head: costs `ORGANIZE_ACTION_COST` = 5 action points (no cash), adds `ORGANIZE_STRENGTH_GAIN` = 10 strength to the union pool and the same 10 to the organizer's banked strength. Both decay by `UNION_STRENGTH_DECAY_PER_TURN` = 0.005 (0.5%) a turn, so organizing is a treadmill. Not available to a suspended or banned union.
- **`foundUnion`**, pays `UNION_FOUNDING_ACTION_COST`=10 action points plus an era/FX-scaled campaign-funds cost (`unionFoundingCostLocal`), both charged in one conditional `findOneAndUpdate` so a founder can never pay one and keep the other. Fails if the character already leads a union (`character.unionLeaderOf`) or the name is already taken in that (country, sector type) pair (`MIN_UNION_NAME_LENGTH`=2, `MAX_UNION_NAME_LENGTH`=60). A founded union starts empty: zero treasury, no represented sectors.
- **`organizeSector`** (`src/lib/unions/commands/organizeSector.ts`, `ORGANIZE_SECTOR_ACTION_COST`=1 action point), the headline union-head action, spends treasury (`organizeSectorTreasuryCost`) to push one sector's `unionization` up (`sectorUnionizationGain`, base `SECTOR_UNIONIZATION_GAIN_BASE`=5):
  - **Unrepresented sector**, a straight organizing drive; the first drive claims `representingUnionId`, so the shop's workers count as members immediately.
  - **Represented by the same union**, reinforcement; pushes `unionization` further, no ownership change.
  - **Represented by a rival union**, a raid. Winner-takes-all: the attacker must out-poll the incumbent's approval by at least `RAID_APPROVAL_EDGE_REQUIRED`=5 points (`raidSucceeds()`), no randomness. A failed raid still costs the treasury/action spend. The gain per drive is `SECTOR_UNIONIZATION_GAIN_BASE x approval / 100`, so an approval-55 union adds 2.75 points. Treasury cost is `ORGANIZE_TREASURY_COST_PER_WORKER` = 2 per worker (clamped 50 to 8,000, `src/lib/unions/organizeSectorEconomy.ts`); reinforcing an already-held shop scales that by current density. One request may target up to `ORGANIZE_SECTORS_BATCH_MAX` = 10 sectors.
  - No decay is applied by the action itself. The first successful drive sets `representingUnionId`; after representation, `trendUnionization` moves the shop toward that union's approval rather than back to the NPC economic target.
- **`voteUnionLeader`** (`src/lib/unions/commands/voteUnionLeader.ts`), leadership is elected, not first-come-claimed, once `isUnionLeadershipElectionOpen()` says the union is strong enough (`LEADERSHIP_ELECTION_MIN_STRENGTH`). `LEADERSHIP_ELECTION_MIN_STRENGTH` is 100 union strength. Organizers (`UnionOrganizer`) vote for a candidate with a weight equal to their banked strength, so fifty drives outvote one; the plurality leader becomes `pendingLeaderCharacterId` and must accept, and a tie keeps the sitting player president. Contests stay open even while a president sits, mirroring corporation CEO votes.
- **`strike`** (`src/app/api/unions/[id]/strike/route.ts`), force-starts a strike on every matching sector at/above `STRIKE_CALL_MIN_UNIONIZATION`=30 not already active/cooling; cost is `STRIKE_CALL_COST_PER_SECTOR` = 400 per matched sector (`strikeCallCost`), with a `UNION_STRIKE_CALL_COOLDOWN_TURNS`=8 union-level cooldown; computes each sector's `workerExpectationIndex` at call time so the strike doesn't spuriously auto-resolve as an immediate concession.
- **`bargaining`** (`src/lib/unions/bargaining.ts`, `src/lib/unions/commands/bargaining.ts`), a formal collective-bargaining campaign, running over `BARGAINING_DEADLINE_TURNS`=8 turns with an escalation ladder (`overtime_ban` → `selective_strike` → `industry_strike`, gated on rising member support thresholds 35/50/65) and an optional mediation window (`BARGAINING_MEDIATION_DELAY_TURNS` = 2, `BARGAINING_MEDIATION_MIN_LAW_SUPPORT` = 30). The overtime ban scales output by `OVERTIME_BAN_OUTPUT_FACTOR` = 0.96 and costs `OVERTIME_BAN_UPKEEP_PER_LOCAL` = 40 treasury per covered local each turn. A dispute lapses after `BARGAINING_DISPUTE_MAX_TURNS` = 16 turns and the pair cannot reopen for `BARGAINING_REOPEN_COOLDOWN_TURNS` = 8. A settlement is no longer final on the president's signature: it goes to a ratification vote (`src/lib/unions/ratification.ts`) lasting `RATIFICATION_VOTE_TURNS` = 3, weighted by banked strength frozen at open; it closes early once one side holds a majority of all snapshot strength, ties ratify, and unanswered ballots count for the settlement (with no strength held the president settles directly). A ratified settlement becomes a `CollectiveAgreement` lasting `AGREEMENT_DURATION_MIN_TURNS`=24 to `AGREEMENT_DURATION_MAX_TURNS`=192 turns.
- **`setUnionWageDemand`** (route `demand-wage`), sets a visible target `wageLevel` (clamped, `demandedWageLevel`), surfaced to CEOs in scope as a banner. One-sided, no accept/reject contract flow, binding wage terms are bargaining's job.
- **`setUnionDues`**, sets the union's annual per-member dues rate, clamped to `[0, maxDuesForWage(averageAnnualWage)]` against the represented workforce's actual wages.
- **`setUnionServices`**, toggles the union's service slate; unknown ids dropped by `normalizeServiceIds`.
- **`setUnionPoliticalContributions`**, sets the share (clamped `[0, MAX_POLITICAL_CONTRIBUTION_OF_FCF = 0.5]`) of remaining per-turn free cash flow sent to organizers as political contributions, at an approval penalty of up to `MAX_POLITICAL_CONTRIBUTION_APPROVAL_PENALTY` = 5 points (`src/lib/unions/unionPoliticalContributions.ts`).
- **`endorseBill`**, records a bill stance (`UnionEndorsement`, `endorse`/`oppose`), visibility-only, no vote-swing effect yet; shown on the union's own dashboard.
- **Underground unions** (`src/lib/unions/underground.ts`): while a country bans unions, legal drives are off and organizers run hidden drives instead. They cost `UNDERGROUND_ACTION_COST` = 10 action points, add `UNDERGROUND_QUIET_STRENGTH_GAIN` = 4 (quiet) or `UNDERGROUND_MASS_STRENGTH_GAIN` = 9 (mass) strength, and add heat (`UNDERGROUND_QUIET_HEAT` = 4, `UNDERGROUND_MASS_HEAT` = 12). From `HEAT_DETECTION_THRESHOLD` = 30 each turn rolls for detection; an exposed union stays visible `EXPOSURE_LENGTH_TURNS` = 6. A raid costs `RAID_ACTION_COST` = 2 (cooldown `RAID_COOLDOWN_TURNS` = 3, with `RAID_HEAT_THRESHOLD` = 70 as the heat level for the raid rules) and a prosecution costs `PROSECUTION_ACTION_COST` = 3 (bar `PROSECUTION_BAR_TURNS` = 4).
- **Pension schemes** (`src/lib/pensions/rules.ts`, `runPensionTurn`): a bargained term, employer contribution `PENSION_CONTRIBUTION_RATE_MIN` 0 to `PENSION_CONTRIBUTION_RATE_MAX` = 0.15 of the covered wage bill. Claims accrue at `PENSION_ACCRUAL_RATE` = 0.08 of wage cost per covered worker per turn, so a scheme at the maximum rate builds a surplus. Below `PENSION_DEFICIT_RATIO` = 0.9 funded the employer owes a top-up of `PENSION_TOPUP_FRACTION` = 0.05 of the shortfall each turn. Spare cash is invested in the country's broad index fund after keeping `PENSION_LIQUIDITY_BUFFER_TURNS` = 8 turns of benefits in cash. Shortfalls cut all pensions pro rata and the unpaid claim stays on the books.
- Leader actions are gated through `resolveOwnedUnion()`, which 403s while the union's country has an enacted union ban (checked against the enactment-time budget flag, not `union.suspended`) or while `union.suspended === true`.

Per-turn processing (`src/lib/turn/unions/index.ts`, `"unionsTurn"` phase, runs immediately after `"corporationTurn"`): treasury dues trickle, services cost, political contributions, membership pressure decay, and inactivity auto-vacancy release the union back to NPC control. Non-additive mutations (union-busting, `organizeSector`, strike calls) are rejected with 409 while `isTurnProcessingNow()`, the corp turn's bulk sectorOps write and the unions-turn bulk write both recompute from a pre-mutation snapshot with no optimistic-concurrency filter, so an action landing mid-turn would otherwise be silently clobbered. All union routes and the turn phase are gated on `isLabourFullMode()`; the leaderboard/dashboard pages (`src/app/unions/page.tsx`, `src/app/unions/[id]/page.tsx`) distinguish a disabled-feature/network error from the legitimate empty state.

## Timing

The labour system touches several phases of the hourly turn (`src/simulation/phases/turnPhaseRegistry.ts`):

1. `corporationTurn` computes each sector's labor cost, wage index and automation index, trends unionization, steps strikes, and records labour demand.
2. `unionsTurn` runs immediately after: dues, services, political contributions, strength decay, and inactivity auto-vacancy.
3. `runPensionTurn` settles contributions, claims, benefits and top-ups (finance group, after corporations).
4. The metric engine later reads the wage index deltas and labour tightness to move `medianIncome` and `unemploymentRate`, and migration reads `labourMigrationWageFactor`.

Unionization and the union premium use the prior turn's persisted value, which is a deliberate one-turn lag.

## Edge cases and limits

- Wage level is clamped to 0.8 to 1.5; a non-finite value becomes 1.0. Kaitz ratio is clamped to 0 to 1.0; 0 or unset means no minimum wage.
- With no minimum wage configured the unionization target uses a neutral Kaitz of 0.5, not 0, so absence of a policy does not push unionization up.
- Unionization, union approval and union-law targets are clamped 0 to 100; the strike requires unionization above 55 and a gap above 0.12, and no single factor alone crosses that for an unrepresented shop.
- A union can only force a strike in a sector at unionization 30 or higher (`STRIKE_CALL_MIN_UNIONIZATION`); it cannot create one from nothing.
- Union names are 2 to 60 characters and unique within a country and sector type; a character may lead one union only. A founded union starts with zero treasury and no sectors.
- Founding charges the action cost and the funds cost in one conditional update, so a founder never pays only one.
- Collective agreements last 24 to 192 turns and block new strikes in covered locals. Endorsements are visibility-only.
- Organizer strength decays 0.5% a turn, so an inactive organizer loses voting weight.
- The minimum-wage Kaitz ratio is a budget field; the player wiki says legislation sets it, but the budget type comments say it is administrator-set today. The union-law bias is set by enacted bill.
- Mutations that are not purely additive (busting, organizing a sector, strike calls) return 409 while a turn is processing, because the bulk corp-turn and unions-turn writes recompute from a pre-mutation snapshot.
- A union ban in a country decays sector unionization 3 points a turn, empties the legal loop and 403s legal union commands.

## Connections

**Driven by:**

- [Corporations](./corporations.md): sector revenue and maintenance set the labor cost base in `src/lib/turn/corporation/sectorLabour.ts`.
- [Bills & Legislation](./bills-legislation.md): union-law provisions write `FederalBudget.unionLawBias`.
- [National Budget](./national-budget.md): the minimum-wage Kaitz ratio lives on the federal budget.
- [National Metrics](./national-metrics.md): unemployment and cost of living feed the unionization target and strike gap.

**Affects:**

- [National Metrics](./national-metrics.md): `medianIncome`, `unemploymentRate` and migration pull, via the labour wage index and tightness terms.
- [Corporations](./corporations.md): labor cost, union premium, strike revenue throttle and margin penalty.
- [Pensions](./pensions.md): union pension schemes are bargained terms and use the pension turn.
- [Government Approval](./government-approval.md): a crackdown on unions costs labour approval (`CRACKDOWN_LABOUR_APPROVAL_COST_PER_TURN` = 0.25 in `src/lib/unions/crackdownLabourApproval.ts`).

## Turn-processing race safety

Any player-facing union/labour mutation that isn't purely additive (union-busting, recruit, strike-call) checks `isTurnProcessingNow(gameState)` (`src/lib/turn/processingLock.ts`) before writing, rejecting with 409 while the turn engine's bulk corp-turn write is in flight, reusing the existing `GameState.isProcessing`/heartbeat lock rather than retrofitting optimistic concurrency into the shared turn-processing code path.

Last checked: 2026-10-29, version 1.18.0
