# Labour & Unions

## Summary

The labour system models per-sector wage decisions as a first-class economic and political lever. It has explicit worker pay carved out of corporate maintenance costs, a macro feedback loop tying wages into unemployment, income and migration, an NPC unionization metric with strikes, and a full player-run union layer: found a union, organize or raid sectors, elect a leader, strike, bargain collectively, demand wages, set dues, services and political contributions, endorse legislation, get busted or write union law. It ships as one graduated flag so every tier can be validated independently before the next unlocks.

Player guide: [Labour & Wages](https://www.ahousedividedgame.com/wiki/labour-and-wages) and [Unions](https://www.ahousedividedgame.com/wiki/unions)

**Entry point:** `src/lib/labour/featureFlag.ts` (`labourSystemMode`, `isLabourWagesEnabled()`, `isLabourMacroEnabled()`, `isLabourUnionsEnabled()`, `isLabourFullMode()`)

All four layers (wages, macro feedback, NPC unionization with strikes, and the full player-run union layer) are live in current worlds. The tier structure below is how the code is gated, not something a player sees.

## Rules

### Scope and effects

- **Scope:** Per-`CorporateSector` wage economics, national and state macro metrics, NPC and player-run unions, union-law legislation.
- **Target:** All player and NPC corporations. Unions represent the specific `CorporateSector`s they have organized or raided, not an entire (country, industry) pair by default; rival unions may coexist in the same (country, sector type).
- **Effects:** Corp profit margins, state `medianIncome` and `unemploymentRate`, international migration pull, strikes (output throttle), union treasury, approval, dues and services, legislative NPI cost.
- **Enactment:** in-game actions (wage slider, found, organize or raid, vote leader, strike, bargain, bust, demand-wage, dues, services, political contributions, endorse) and `union_law` bill provisions. The minimum-wage Kaitz ratio is a national budget field (`FederalBudget.minimumWageKaitzRatio`) set by the game team through an admin route, not by a bill (see Known issues and history).

### `labourSystemMode` tiers

One graduated flag on `GameConfig` (order `off, wages, macro, unions, full`, `src/lib/labour/modes.ts`), each tier a strict superset of the previous. `getLabourSystemMode()` returns `"off"` only when the field is absent or unknown.

| Tier | Unlocks |
| --- | --- |
| `off` | Nothing: legacy flat `maintenance` cost, no labour fields read or written |
| `wages` | Explicit per-sector labor cost (profit-invariant at baseline), CEO wage-level slider (0.8 to 1.5), minimum wage (Kaitz ratio), automation tech effect |
| `macro` | Wage decisions feed `medianIncome` (Phillips-curve passthrough) and `unemploymentRate` (wage and automation pressure terms), and modulate international migration pull |
| `unions` | NPC-driven per-sector `unionization` (0-100), `unionPremium` labor-cost surcharge, strikes (trigger, concession, wait-out) |
| `full` | Union-busting, union-law legislation, and the entire player-run union layer (found, organize, raid, vote-leader, strike, bargain, demand-wage, dues, services, political contributions, endorse) |

### Wages (`labourSystemMode >= "wages"`)

Explicit per-sector labor cost. In the legacy cost modes it is carved OUT of `maintenance` (never added on top), so it is profit-invariant at the baseline wage multiplier (`computeSectorLaborCost`, `src/lib/labour/laborCost.ts`). Under the explicit plant cost model labour is billed directly on top of inputs and overhead, so the intensity table sets base margins; the wage slider and union premium scale it the same way in both.

`SECTOR_LABOR_INTENSITY` (cost share of revenue) and `SECTOR_WAGE_LEVEL` (relative pay per worker) are separate tables, so a minimum wage bites labor-intensive but low-paid sectors (retail, agriculture) instead of labor-light ones (extraction). The CEO slider is `WageLevelPanel.tsx` (`src/app/corporation/[id]/sector/[sectorId]/sections/`). Automation tech reduces labor cost through the tech-tree framework (`TECH_LABOR_REDUCTION_CAP` = 0.5, `src/lib/constants/techTree/effects.ts`).

Constants (all in `src/lib/labour/laborCost.ts` unless noted):

| Constant | Value |
| --- | --- |
| `WAGE_LEVEL_MIN` / `WAGE_LEVEL_MAX` / `WAGE_LEVEL_DEFAULT` | 0.8 / 1.5 / 1.0 |
| `MIN_WAGE_KAITZ_MAX` | 1.0 |
| `LABOUR_DEFAULT_LABOR_SHARE` (unknown sector type) | 0.2 |
| `eraLaborMultiplier` | 1.0 from 2007, 1.1 from 1991, 1.25 from 1953, 1.35 before |
| `MEDIAN_SECTOR_WAGE_LEVEL` (median of the pay table) | 1.1 |

`SECTOR_LABOR_INTENSITY` (share of revenue):

| Sector | Share | Sector | Share |
| --- | --- | --- | --- |
| technology | 0.35 | retail | 0.191 |
| financial | 0.325 | real_estate | 0.191 |
| media | 0.28 | logistics | 0.18 |
| media_entertainment | 0.28 | agriculture | 0.16 |
| healthcare | 0.277 | manufacturing | 0.159 |
| construction | 0.264 | chemical_industries | 0.15 |
| defense | 0.24 | manufacturing_vehicles | 0.141 |
| telecommunications | 0.2 | extraction | 0.12 |
| | | energy | 0.1 |

`SECTOR_WAGE_LEVEL` (pay per worker): technology 1.8, financial 1.7, healthcare 1.3, defense 1.3, energy 1.2, chemical_industries 1.2, telecommunications 1.2, extraction 1.1, media 1.1, manufacturing_vehicles 1.0, manufacturing 0.95, construction 0.9, real_estate 0.9, media_entertainment 0.85, logistics 0.8, retail 0.6, agriculture 0.55.

Formulas (`resolveSectorLabourEconomics`, `src/lib/turn/corporation/sectorLabour.ts`):

```
laborShare0   = intensity x eraLaborMultiplier(year)        (legacy modes; explicit plants use plantLaborShare)
baselineLabor = max(0, min(grossMaintenance, laborShare0 x hourlyRevenue))
wageLevel     = max(clamp(sector.wageLevel, 0.8, 1.5), collective-agreement wage floor)
floorMult     = floor / sectorWage     if sectorWage < kaitz x 1.1, else 1
premium%      = unionization/100 x 15  (prior turn's stored value; 0 if unions disabled or banned)
wageMult      = wageLevel x floorMult x techLaborCostMultiplier x (1 + premium%/100)
laborCost     = baselineLabor x wageMult
maintenance   = (grossMaintenance - baselineLabor) + laborCost
```

Why two tables: a sector can be labour-intensive yet low-paid (retail) or capital-light yet high-paid (technology). Keeping them apart lets a minimum wage bite the genuinely low-paid sectors. A negotiated agreement floor applies under the employer's own wage level for the life of the agreement and is never written back into `sector.wageLevel`, so pay does not ratchet up after expiry.

**Worked example.** A retail sector earns 100,000 an hour at unionization 40. Labor share is 0.191, so baseline labor is 19,100. The CEO sets wage level 1.2. The union premium at unionization 40 is 40/100 x 15 = 6%, so the combined multiplier is 1.2 x 1.06 = 1.272 and labor cost is 24,295 (rounded). That is 5,195 more an hour, or 5.2 points of margin, in return for a higher real-wage index and lower strike and unionization pressure.

### Macro coupling (`labourSystemMode >= "macro"`)

Routes labour wage decisions into the existing `medianIncome` Phillips-curve node rather than wiring every downstream channel individually.

- **Migration pull:** per-state `labourWageIndex` (worker-weighted `wageLevel x floorMult`, 1.0 = baseline) multiplies `economicPullFactor`'s output via `labourMigrationWageFactor()` = `1 + (index - 1) x 0.5` (`LABOUR_MIGRATION_WAGE_K`), bounded to `[0.7, 1.3]`, re-clamped to `[0.5, 1.5]` overall.
- **Income channel:** `labourWageIndexDelta` (this turn minus prior turn, zero on cold start) feeds `wageGrowthAnnualPct` inside `medianIncomeNode.compute()` via `labourWageIncomePassthrough()` = `delta x 100 x LABOUR_WAGE_PASSTHROUGH`, with `LABOUR_WAGE_PASSTHROUGH` = 0.5.
- **Jobs channel, wage half:** the same delta adds a capped term, `labourUnemploymentWagePressure` = `delta x 1.5` (`LABOUR_UNEMPLOYMENT_WAGE_K`), capped at plus or minus 1.5 pp (`LABOUR_UNEMPLOYMENT_WAGE_CAP_PP`).
- **Jobs channel, automation half:** `automationIndexDelta` (worker-weighted `techEffects.laborCostMultiplier`) adds an inverted term, `-delta x 2.5` (`LABOUR_UNEMPLOYMENT_AUTOMATION_K`), capped at plus or minus 1.5 pp. Automation cutting headcount is deliberately a different signal from wages cutting pay.

Convention: **delta not level** for anything read into a compounding series (`medianIncome`, `unemploymentRate`). A level term would march the series to its bound and pin there. Unionization is the exception because it is a target-trending stock, not a recursive series, and the tightness term below is a deliberate small capped exception.

### Labour market tightness and staffing

`src/lib/labour/labourMarket.ts`. This is not gated on the wage tier, because headcount demand exists whether or not wages are switched on.

| Constant | Value | Use |
| --- | --- | --- |
| `LABOUR_UNEMPLOYMENT_TIGHTNESS_K` | 0.5 | pp of unemployment target per unit of `ln(tightness)` (pressure = `-0.5 x ln(tightness)`) |
| `LABOUR_UNEMPLOYMENT_TIGHTNESS_CAP_PP` | 0.5 | cap on that shift |
| `LABOUR_STAFFING_MAX_TURN_MOVE` | 0.1 | most the staffing factor moves per turn |
| Participation shortage uplift | up to 6 pp, at most 0.25 pp a turn | residents entering the workforce when `tightness > 1` (`nextLabourParticipationBonus`) |
| Bargaining tightness score | `50 + 25 x ln(tightness)`, clamped 0 to 100 | feeds the bargaining mandate |

- **Tightness** = corporate desired headcount over the state's civilian labour force. Missing or non-positive supply returns `undefined`, never infinity.
- **Staffing factor** = 1 when `tightness <= 1`, else `clamp(relativeWageBid / tightness, 0, 1)`. `relativeWageBid` = sector `wageLevel` over the desired-worker-weighted state wage index, clamped to `[0.25, 4]`. If every employer raises pay together, allocations do not change.
- The factor glides toward its target by at most 0.1 per turn and multiplies the sector's output. `filledWorkers` floors at 1 for any sector that wanted at least one worker.
- Desired headcount (not the rationed figure) is what is recorded into next turn's tightness, so rationing cannot switch itself off.

### NPC unionization (`labourSystemMode >= "unions"`)

Per-sector `unionization` (0-100) drifts each turn toward a condition-driven target (`unionizationDriftTarget()` in `src/lib/labour/unionization.ts`). Inputs: CEO `wageLevel` against state cost of living (`realWageIndex()`), state `unemploymentRate` (worker leverage), the country minimum-wage Kaitz ratio, and (once `full`) `unionLawBias`. A shop held by a player union does not use this economic target: it tracks that union's `approval` directly (`representingUnionApproval`), so how the union is run decides density there.

```
target = clamp(UNIONIZATION_BASELINE
               + (1 - realWage) x UNIONIZATION_REAL_WAGE_WEIGHT
               + (UNIONIZATION_NEUTRAL_UNEMPLOYMENT - unemployment) x UNIONIZATION_UNEMPLOYMENT_WEIGHT
               + (UNIONIZATION_NEUTRAL_KAITZ - kaitz) x UNIONIZATION_MINWAGE_WEIGHT
               + unionLawBias x 0.6, 0, 100)
realWage = wageLevel / (costOfLivingIndex / 100)
```

| Constant (`src/lib/labour/unionization.ts`) | Value |
| --- | --- |
| `UNIONIZATION_BASELINE` | 20 |
| `UNIONIZATION_NEUTRAL_UNEMPLOYMENT` (%) | 5 |
| `UNIONIZATION_NEUTRAL_KAITZ` | 0.5 (also used when a country has no minimum wage) |
| `UNIONIZATION_REAL_WAGE_WEIGHT` | 40 |
| `UNIONIZATION_UNEMPLOYMENT_WEIGHT` | 3 |
| `UNIONIZATION_MINWAGE_WEIGHT` | 20 |
| `UNIONIZATION_LAW_WEIGHT` (not exported) | 0.6 (law term max plus or minus 30 pp at bias plus or minus 50) |
| `UNIONIZATION_TREND_STEP_PER_TURN` | 1.5 |
| `UNIONIZATION_BAN_DECAY_STEP_PER_TURN` (country union ban) | 3 |
| `UNION_PREMIUM_MAX_PCT` | 15 |

Stored unionization moves toward the target by at most 1.5 points per turn (`trendUnionization`, rounded to one decimal). `unionPremium(unionization)` is a standing labor-cost surcharge, linear from 0 at unionization 0 to 15 pp at 100, folded into `wageMult` using the prior turn's persisted value (one-turn lag). It is skipped in a country that bans unions.

**Worked example.** A sector at wage level 0.8 (cost of living 100) in a country with unemployment 2%, Kaitz ratio 0.3 and union-law bias +40: 20 + (0.2 x 40 = 8) + (3 x 3 = 9) + (0.2 x 20 = 4) + (40 x 0.6 = 24) = 65. At 1.5 points a turn a sector starting at 20 passes 55 on turn 24 (56.0).

### Strikes (`labourSystemMode >= "unions"`)

Per-sector bounded-duration event (`src/lib/labour/strikes.ts`, `stepStrike`). The gap is `(workerExpectationIndex - realWage) x (1 - strikeSoftening)`.

| Constant | Value |
| --- | --- |
| `STRIKE_UNIONIZATION_THRESHOLD` | 55 |
| `STRIKE_EXPECTATION_GAP_THRESHOLD` (trigger) | 0.12 |
| `STRIKE_CONCESSION_GAP_THRESHOLD` | 0.04 |
| `STRIKE_DURATION_TURNS` | 4 |
| `STRIKE_COOLDOWN_TURNS` | 12 |
| `STRIKE_REVENUE_THROTTLE` | 0.25 (output factor 0.75) |
| `STRIKE_MARGIN_PENALTY_PP` | -8 |
| `STRIKE_WAITOUT_UNIONIZATION_BUMP` | 10 |
| `WORKER_EXPECTATION_TREND_STEP` | 0.02 per turn (bounds 0.3 to 2.0) |
| `STRIKE_LAW_THRESHOLD_WEIGHT` | 0.2 |
| `MAX_STRIKE_SOFTENING` (`src/lib/unions/unionServices.ts`) | 0.6 |

- **Trigger:** `unionization > threshold` and `gap > 0.12`, outside cooldown. The threshold is `55 - bias x 0.2` (so +50 bias gives 45, -50 gives 65). The concession gap is deliberately not biased, to keep the hysteresis between trigger and concession.
- **While active:** output factor 0.75 and margin -8 pp (`resolveSectorLabourProductionEffects`, which also multiplies staffing, industrial action and underground factors).
- **Resolution:** concession (gap at or below 0.04, takes priority and can end it at once), or wait-it-out after 4 turns (unionization +10). The 12-turn cooldown is set on every resolution path.
- **Other end states:** `resolved_banned` (country union ban, no bump) and `resolved_agreement` (an active collective agreement ends a strike and blocks new ones in that local).
- `workerExpectationIndex` trends toward the current real wage by at most 0.02 a turn, so a CEO cannot game the gap by oscillating the slider.
- **Strike softening:** a representing union's running services damp the gap before either threshold sees it (see services below), never to zero.

**Worked example.** A sector pays wage level 0.8 in a state with cost of living 100, so its real wage is 0.8, while workers expect 1.0. The gap is 0.20, above 0.12. At unionization 60 (above 55) a strike starts: output x0.75, margin -8 pp for up to 4 turns. If the CEO raises pay and the gap closes to 0.04 or less, it ends early with a 12 turn cooldown. Otherwise it expires after 4 turns, unionization jumps +10 to 70, and the 12 turn cooldown begins.

**Calibration note:** the trigger and gap pair is deliberately reachable through purely political levers (union-law bias, a well-run union's approval) with zero real wage or employment stress. This is intended (see the `strikes.ts` docblock for the composed-ceiling math), not a miscalibration. For an unrepresented shop no single factor alone crosses the threshold.

### Union-busting and union law (`labourSystemMode >= "full"`)

- **Busting** (`src/lib/labour/unionBusting.ts`, command `attemptUnionBusting.ts`, route `POST /api/corporations/[id]/sectors/[sectorId]/union-busting`): a CEO action modeled on the whip-success pattern. Success chance is `60 - round(unionization x 0.4)`, floored 20 and ceilinged 80, so a shop at unionization 50 busts at 40%.
  - Success: unionization -20 pp (`BUSTING_SUCCESS_UNIONIZATION_DROP`) and any active strike ends (clears `strikeStartedAtTurn`, starts the strike cooldown).
  - Backfire: unionization +15 pp (`BUSTING_BACKFIRE_UNIONIZATION_SPIKE`), strike state untouched.
  - Cash cost: `max(1000, round(0.5 x daily gross revenue))` (`BUSTING_COST_REVENUE_FRACTION`, `BUSTING_MIN_COST`).
  - `BUSTING_COOLDOWN_TURNS` = 12 either way. Rejected with 409 while the turn engine is mid-processing.
- **Union law:** `UnionLawProvision { type: "union_law"; bias: number; banAction? }`, a single signed axis (-50 right-to-work to +50 collective-bargaining, `UNION_LAW_BIAS_MIN` and `UNION_LAW_BIAS_MAX`, `src/lib/labour/unionLaws.ts`) written to `FederalBudget.unionLawBias`.
  - It feeds `unionizationDriftTarget()` (weight 0.6) and the country-adjusted strike-trigger threshold.
  - Bill authoring is an explicit "Include union-law provision" checkbox, since 0 is a valid reset to neutral.
  - NPI (National Political Influence) cost counts union-law provisions like policy and subsidy provisions.
- **Union ban:** `banAction: "ban"` sets `FederalBudget.unionsBanned`, resets enforcement posture to `normal` and suspends every union in the country; `"repeal_ban"` clears both. A ban does not touch `unionLawBias`, so the earlier regime survives a ban and repeal round trip. While banned: no union premium, no new strikes (active ones force-resolve), sector unionization decays 3 points a turn toward underground cell strength, and legal union commands return 403.

### Player-run unions (`labourSystemMode >= "full"`)

Under "union dues v1" a union is no longer a single seeded singleton per (countryId, sectorType) with first-come leadership. Any character may found a rival union in an industry that already has one, and a union only represents the specific `CorporateSector`s it has organized or raided (`CorporateSector.representingUnionId`).

#### Founding, organizing and leadership

| Action | Rule | Constants |
| --- | --- | --- |
| `organizeUnion` (rank-and-file drive, `src/lib/unions/commands/organizeUnion.ts`) | Any character in the union's country. Costs action points, no cash. Adds strength to the union pool and the organizer's banked total. Not available to a suspended or banned union | `ORGANIZE_ACTION_COST` 5, `ORGANIZE_STRENGTH_GAIN` 10, `UNION_STRENGTH_DECAY_PER_TURN` 0.005 (0.5% a turn, both pools) |
| `foundUnion` (`src/lib/unions/commands/foundUnion.ts`) | Pays action points and a campaign-funds fee in one conditional update. Fails if the character already leads a union or the name is taken in that (country, sector type). Starts with zero treasury and no sectors | `UNION_FOUNDING_ACTION_COST` 10; fee 500,000 campaign funds times an FX rate (`unionFoundingCostLocal`, not era-scaled); name 2 to 60 characters |
| `voteUnionLeader` (`voteUnionLeader.ts`) | Open once union strength is at least 100. Organizers vote with weight equal to banked strength. Plurality leader becomes `pendingLeaderCharacterId` and must accept; a tie keeps the sitting player president. Contests stay open while a president sits | `LEADERSHIP_ELECTION_MIN_STRENGTH` 100 |

Organizing is a treadmill: both the union pool and each organizer's banked strength decay 0.5% a turn, so an inactive organizer loses voting weight.

#### Targeted sector drives

`organizeSector` (`src/lib/unions/commands/organizeSector.ts`, head only) spends treasury and 1 action point (`ORGANIZE_SECTOR_ACTION_COST`) to push one sector's `unionization` up.

- **Unrepresented sector:** a straight drive; the first drive claims `representingUnionId`, so the workers count as members at once.
- **Same union:** reinforcement; no ownership change.
- **Rival union:** a raid, winner takes all. The attacker needs `attackerApproval - incumbentApproval >= RAID_APPROVAL_EDGE_REQUIRED` (5), no randomness. A failed raid changes nothing but still costs the treasury and action spend. A won raid adds the normal gain on top of current unionization.
- **Gain:** `SECTOR_UNIONIZATION_GAIN_BASE x approval / 100` (base 5), so an approval-55 union adds 2.75 points.
- **Treasury cost** (`organizeSectorTreasuryCost`): `2 x workers` (`ORGANIZE_TREASURY_COST_PER_WORKER`) clamped 50 to 8,000; reinforcing a held shop scales by current density. Up to 10 sectors per request (`ORGANIZE_SECTORS_BATCH_MAX`).
- No decay is applied by the action. After representation, `trendUnionization` moves the shop toward that union's approval, so a drive is a push, not a permanent purchase.

#### Dues, approval and services

`src/lib/unions/unionDues.ts`, `unionServices.ts`. Replaces the retired `membershipPressure` score.

| Quantity | Rule |
| --- | --- |
| Members | `round(sum of workers x unionization/100)` over represented sectors |
| Dues ceiling | `MAX_DUES_FRACTION_OF_WAGE` 0.1 of the member-weighted average annual wage (`maxDuesForWage`) |
| Dues income per turn | `12 x members x dues / 48` (`UNION_TREASURY_FLOW_SCALE` 12, 48 turns a year) |
| Services cost per turn | `12 x members x annualWage x sum(service cost fractions) / 48` |
| Approval target | `clamp(55 + servicesBonus - 500 x dues/annualWage - politicalPenalty, 0, 100)`; `BASE_APPROVAL` 55 |
| Approval movement | at most 1.5 a turn toward the target |
| Political contributions | share of free cash flow (dues income minus services cost that ran), clamped 0 to 0.5, paid to organizers in proportion to banked strength; approval penalty `(pct / 0.5) x 5` points (`MAX_POLITICAL_CONTRIBUTION_APPROVAL_PENALTY`) |

Services (`UNION_SERVICES`): cost is a fraction of annual wage per member; the table gives approval bonus and strike softening.

| Service | Cost fraction | Approval bonus | Strike softening | Worker-security nudge |
| --- | --- | --- | --- | --- |
| `strikeFund` | 0.015 | 8 | 0 | 0.4 |
| `healthFund` | 0.025 | 12 | 0.18 | 1.2 |
| `legalAid` | 0.01 | 6 | 0.12 | 0.9 |
| `training` | 0.015 | 7 | 0.06 | 0.6 |

If dues income plus treasury cannot cover the whole service bill, the whole slate lapses for that turn with no charge and no approval bonus. The treasury never goes negative from services.

#### Strikes, bargaining and other leader actions

- **`strike`** (`src/app/api/unions/[id]/strike/route.ts`): force-starts a strike on every matching sector at or above `STRIKE_CALL_MIN_UNIONIZATION` (30) that is not already striking, cooling down or under an agreement. Cost is `STRIKE_CALL_COST_PER_SECTOR` (400) per sector, with a `UNION_STRIKE_CALL_COOLDOWN_TURNS` (8) union-level cooldown. It sets each sector's `workerExpectationIndex` at call time so the strike does not auto-resolve as an immediate concession.
- **`bargaining`** (`src/lib/unions/bargaining.ts`, `commands/bargaining.ts`): a formal campaign.
  - Deadline `BARGAINING_DEADLINE_TURNS` 8; escalation ladder `overtime_ban`, `selective_strike`, `industry_strike`, gated on member support 35, 50, 65 (`BARGAINING_ESCALATION_SUPPORT`).
  - Optional mediation window: `BARGAINING_MEDIATION_DELAY_TURNS` 2, `BARGAINING_MEDIATION_MIN_LAW_SUPPORT` 30.
  - Overtime ban: output x `OVERTIME_BAN_OUTPUT_FACTOR` 0.96 and 40 treasury per covered local per turn (`OVERTIME_BAN_UPKEEP_PER_LOCAL`).
  - A dispute lapses after `BARGAINING_DISPUTE_MAX_TURNS` 16; the pair cannot reopen for `BARGAINING_REOPEN_COOLDOWN_TURNS` 8.
- **Ratification** (`src/lib/unions/ratification.ts`): a settlement goes to a member vote lasting `RATIFICATION_VOTE_TURNS` 3, weighted by banked strength frozen at open. It closes early once one side holds a majority of all snapshot strength; ties ratify; unanswered ballots count for the settlement; with no strength held the president settles directly.
- **Agreement:** a ratified settlement becomes a `CollectiveAgreement` lasting 24 (`AGREEMENT_DURATION_MIN_TURNS`) to 192 turns (internal `AGREEMENT_DURATION_MAX_TURNS`). It sets a wage floor on its locals and blocks strikes there until `noStrikeUntilTurn`.
- **`setUnionWageDemand`** (route `demand-wage`): a visible target `wageLevel` (`demandedWageLevel`), shown to CEOs in scope as a banner. One-sided, no accept or reject flow; binding terms are bargaining's job.
- **`setUnionDues`**, **`setUnionServices`** (unknown ids dropped by `normalizeServiceIds`), **`setUnionPoliticalContributions`**: set the levers in the table above.
- **`endorseBill`**: records `endorse` or `oppose` (`UnionEndorsement`), visibility-only with no vote-swing effect.
- **Pension schemes** (`src/lib/pensions/rules.ts`, `runPensionTurn`): a bargained term.
  - Employer contribution `PENSION_CONTRIBUTION_RATE_MIN` 0 to `PENSION_CONTRIBUTION_RATE_MAX` 0.15 of the covered wage bill.
  - Claims accrue at `PENSION_ACCRUAL_RATE` 0.08 of wage cost per covered worker per turn.
  - Below `PENSION_DEFICIT_RATIO` 0.9 funded, the employer owes `PENSION_TOPUP_FRACTION` 0.05 of the shortfall each turn.
  - Spare cash is invested in the country's broad index fund after keeping `PENSION_LIQUIDITY_BUFFER_TURNS` 8 turns of benefits in cash. Shortfalls cut pensions pro rata.
- Leader actions are gated through `resolveOwnedUnion()`, which 403s while the country has an enacted union ban or `union.suspended === true`.

#### Underground unions (`src/lib/unions/underground.ts`)

While a country bans unions, legal drives are off and organizers run hidden drives.

| Constant | Value |
| --- | --- |
| `UNDERGROUND_ACTION_COST` | 10 action points |
| `UNDERGROUND_QUIET_STRENGTH_GAIN` / `UNDERGROUND_MASS_STRENGTH_GAIN` | 4 / 9 |
| `UNDERGROUND_QUIET_HEAT` / `UNDERGROUND_MASS_HEAT` | 4 / 12 |
| `HEAT_DETECTION_THRESHOLD` | 30 (each turn above it rolls for detection) |
| `EXPOSURE_LENGTH_TURNS` | 6 |
| `RAID_ACTION_COST` / `RAID_COOLDOWN_TURNS` / `RAID_HEAT_THRESHOLD` | 2 / 3 / 70 |
| `PROSECUTION_ACTION_COST` / `PROSECUTION_BAR_TURNS` | 3 / 4 |
| `UNDERGROUND_DENSITY_CAP` / `UNDERGROUND_SLOWDOWN_MAX` (`undergroundEffects.ts`) | 35 / 0.08 |

## Data

Collections read and written, with the fields that matter. "Shown" means visible to players in some form.

| Collection | Fields | Written by | Shown |
| --- | --- | --- | --- |
| `gameConfig` (`_id: "default"`) | `labourSystemMode`, `labourSystemModeUpdatedBy` | admin route `src/app/api/admin/config/labour/route.ts` | No |
| `corporateSectors` | `wageLevel` (0.8-1.5, default 1.0), `unionization` (0-100), `workerExpectationIndex`, `strikeStartedAtTurn`, `strikeCooldownUntilTurn`, `bustingCooldownUntilTurn`, `representingUnionId`, `labourStaffingFactor`, `wagePerWorker` | corporation turn, wage and busting commands, union commands | Yes (sector page) |
| `federalBudget` | `minimumWageKaitzRatio`, `unionLawBias`, `unionsBanned`, `unionEnforcementPosture` | admin minimum-wage route, `applyUnionLawProvision` | Yes |
| `unions` | `ownerId`, `ownerType`, `pendingLeaderCharacterId`, `treasury`, `strength`, `approval`, `duesPerWorkerAnnual`, `activeServices`, `serviceReceipts`, `politicalContributionPct`, `suspended`, `lastCalledStrikeTurn`, `demandedWageLevel`, underground fields (`undergroundStrength`, `heat`, `exposedUntilTurn`), `foundedByCharacterId` | union commands, `processUnionsTurn` | Yes (union page; heat only as a vague bracket) |
| `unionOrganizers`, `unionLeaderVotes` | per-organizer `strength`, `organizeCount`, vote rows | organize and vote commands, strength decay | Yes |
| `unionEndorsements` | `unionId`, `billId`, `stance` | `endorseBill` | Yes |
| `bargainingCampaigns`, `bargainingRatificationBallots`, `collectiveAgreements` | offers, mandate, escalation, ratification, wage floor, `noStrikeUntilTurn` | bargaining commands, `processLabourRelationsTurn` | Yes |
| `characters` | `unionLeaderOf` (denormalized cache of `Union.ownerId`), campaign funds | `reconcileUnionOwnerCache`, founding, contributions | Yes |
| `financialTxLog` | `union_contribution` rows | `processUnionsTurn` | Own rows |

Key types: `LabourContext` (`src/lib/labour/laborCost.ts`, assembled per corp turn with `wagesEnabled`, `unionsEnabled`, `fullEnabled`, `minWageRatioByCountry`, `unionLawBiasByCountry`, `unionsById`, agreement floors, no-strike set, banned set), `Union` and related types in `src/lib/db/types/union.ts`, `CorporateSector` in `src/lib/db/types/corporation.ts`.

`Character.unionLeaderOf` is a read cache reconciled on read (`reconcileUnionOwnerCache`, `reconcileUnionLeaderCache` in `src/lib/unions/unionReconciliation.ts`) rather than by a periodic sweep. `Union.membershipPressure` is deprecated and read by nothing; it remains on the type so old documents deserialize.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `gameConfig.labourSystemMode` | absent means `"off"` (`getLabourSystemMode`); live worlds run `full` | `src/app/api/admin/config/labour/route.ts`; type in `src/lib/db/types/gameConfig.ts` |
| `FederalBudget.minimumWageKaitzRatio` | 0 or absent (no minimum wage) | `src/app/api/admin/config/minimum-wage/route.ts`; clamped 0 to 1 |
| `FederalBudget.unionLawBias` | 0 | enacted `union_law` bill |
| `FederalBudget.unionsBanned` | absent (unions legal) | enacted `union_law` bill with `banAction` |
| `FederalBudget.unionEnforcementPosture` | `normal` | set to `normal` on ban; crackdown posture changes elsewhere |
| `CorporateSector.wageLevel` | 1.0 | CEO slider |
| Market recovery stage (`marketRecoveryStage`) | per world | `stagedLaborShare` in `src/lib/market/marketRecoveryStages.ts`; service relief factors are currently empty |
| Explicit plant costs flag | per world | switches `laborShare0` to `plantLaborShare` |
| Country and era presets | none specific | era multiplier is by game year; sector tables are global |

All numeric constants live in the files named under Rules; there is no per-country override of them.

## Timing

The labour system touches several phases of the hourly turn (`src/simulation/phases/turnPhaseRegistry.ts`):

1. `corporationTurn` computes each sector's labor cost, wage index and automation index, trends unionization, steps strikes, and records labour demand.
2. `unionsTurn` runs immediately after (`processUnionsTurn`, `src/lib/turn/unions/index.ts`).
3. `pensionTurn` (`runPensionTurn`) settles contributions, claims, benefits and top-ups, after corporations.
4. The demographics and metric phase later reads the wage index deltas and labour tightness to move `medianIncome` and `unemploymentRate`; migration reads `labourMigrationWageFactor`.

```
corporationTurn: cost, indexes, unionization, strikes, demand
  -> unionsTurn: crackdown approval -> labour relations (deadlines, agreements, ratification)
     -> roster backfill -> strength decay -> underground heat
     -> adopt unrepresented sectors -> per-union: inactivity vacancy, dues, services,
        contributions, approval
  -> pensionTurn
  -> demographics / metrics: income, unemployment, migration, tightness
```

Unionization and the union premium use the prior turn's persisted value, a deliberate one-turn lag. `processUnionsTurn` is a no-op unless the mode is `full`. A player leader inactive beyond `INACTIVE_CEO_TURN_THRESHOLD` (72 turns, `src/lib/turn/corporation/inactiveCeoSectorShed.ts`) is vacated and the union returns to NPC control. NPP leaders are never vacated.

## Worked trace

One retail sector in a modern world (era multiplier 1.0), legacy cost mode, carried through each formula. Inputs: hourly revenue 100,000, gross maintenance 60,000, CEO `wageLevel` 1.2, stored unionization 40, country Kaitz 0.6 and union-law bias +20, state cost of living 110, unemployment 4%, worker expectation index 1.0, no representing union, no automation (multiplier 1.0).

1. **Labor share.** `0.191 x 1.0` = 0.191; baseline labor = `min(60,000, 0.191 x 100,000)` = 19,100.
2. **Minimum wage.** Floor = `0.6 x 1.1` = 0.66. Retail pays 0.6 (below), so `floorMult = 0.66 / 0.6` = 1.1.
3. **Premium.** Prior unionization 40 gives `40/100 x 15` = 6%, factor 1.06.
4. **Multiplier and cost.** `wageMult = 1.2 x 1.1 x 1.0 x 1.06` = 1.3992. Labor cost = `19,100 x 1.3992` = 26,724.72. Maintenance = `(60,000 - 19,100) + 26,724.72` = 67,624.72, which is 7,624.72 above gross (7.6 points of margin).
5. **Unionization target.** Real wage = `1.2 / 1.10` = 1.0909. Terms: `(1 - 1.0909) x 40` = -3.636; `(5 - 4) x 3` = +3; `(0.5 - 0.6) x 20` = -2; `20 x 0.6` = +12. Target = `20 - 3.636 + 3 - 2 + 12` = 29.364. Stored 40 moves at most 1.5 toward it: new unionization 38.5.
6. **Strike check.** Expectation trends from 1.0 toward 1.0909 by at most 0.02, so 1.02. Gap = `1.02 - 1.0909` = -0.071, far below 0.12. Trigger threshold is `55 - 20 x 0.2` = 51, and 38.5 is below it. No strike.
7. **State wage index.** The state has this sector (2,000 workers, `1.2 x 1.1` = 1.32) and a manufacturing sector (8,000 workers, wage 1.0, no floor binding because 0.95 is above 0.66). Index = `(2,000 x 1.32 + 8,000 x 1.0) / 10,000` = 1.064. With a prior index of 1.0, delta = 0.064.
8. **Macro channels.** Income passthrough = `0.064 x 100 x 0.5` = 3.2 added to wage growth. Unemployment wage pressure = `0.064 x 1.5` = 0.096 pp (cap 1.5). Migration factor = `1 + 0.064 x 0.5` = 1.032. If the automation index fell 0.02, pressure would be `0.02 x 2.5` = +0.05 pp.
9. **Staffing.** Suppose tightness is 1.5 (demand 1,200,000 over labour force 800,000). Tightness pressure on unemployment = `-0.5 x ln 1.5` = -0.203 pp. Demand wage index = `(2,000 x 1.2 + 8,000 x 1.0) / 10,000` = 1.04. Retail bid = `1.2 / 1.04` = 1.154, target staffing `1.154 / 1.5` = 0.769; manufacturing bid 0.962, target 0.641. Both glide from 1.0 by at most 0.1, so both run at 0.9 this turn.

Stored result: `wageLevel` 1.2, `unionization` 38.5, `workerExpectationIndex` 1.02, no strike, `labourStaffingFactor` 0.9, labor cost 26,724.72.

## Edge cases and limits

- Wage level is clamped 0.8 to 1.5; a non-finite value becomes 1.0. Kaitz ratio is clamped 0 to 1.0; 0 or unset means no minimum wage.
- With no minimum wage configured the unionization target uses a neutral Kaitz of 0.5, not 0, so absence of a policy does not push unionization up.
- Unionization, union approval and targets are clamped 0 to 100. A strike needs unionization above the threshold and a gap above 0.12, and no single factor alone crosses that for an unrepresented shop.
- A union can only force a strike in a sector at unionization 30 or higher; it cannot create one from nothing.
- Union names are 2 to 60 characters and unique within a country and sector type; a character may lead one union only.
- Founding charges the action cost and the funds cost in one conditional update, so a founder never pays only one.
- Collective agreements last 24 to 192 turns and block new strikes in covered locals. Endorsements are visibility-only.
- Organizer strength decays 0.5% a turn, so an inactive organizer loses voting weight.
- A union ban decays sector unionization 3 points a turn, skips the premium, empties the legal loop and 403s legal union commands. Suspended unions are frozen (no dues, decay or vacancy) so a repeal restores them.
- Dues are re-clamped each turn against current wages, so a falling wage cannot leave the rate above the 10% ceiling.
- A union with a political-contribution rate but no organizers holding strength keeps the surplus in its treasury.
- Command-economy countries have no private sectors; only state-owned enterprise pay applies there.
- When `wagePerWorker` is missing (no workers) dues ceiling and burden read 0 rather than dividing by zero.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| With `wageMult = 1`, maintenance equals gross maintenance (labour is carved out, not added) | `src/lib/labour/laborCost.test.ts` ("is profit-invariant at wageMultiplier=1") |
| Wage index is 1.0 at baseline and for a state with no workers | `laborCost.test.ts` |
| Strike trigger gap is above the concession gap (hysteresis); every resolution path sets a cooldown | `src/lib/labour/strikes.test.ts` |
| Unionization stays in 0-100 and never overshoots its target | `src/lib/labour/unionization.test.ts` |
| Busting chance stays in 20-80 | `src/lib/labour/unionBusting.test.ts` |
| Tightness is `undefined` when supply is unknown, never infinite | `src/lib/labour/labourMarket.test.ts` |
| One leader per union and one union per leader, cache reconciled on read | `src/lib/unions/unionReconciliation.test.ts` |
| A founder pays both founding costs or neither | `src/lib/unions/commands/foundUnion.test.ts` |
| The service bill never makes the treasury negative | `processUnionsTurn` logic; `src/lib/turn/unions/serviceTiming.integration.test.ts` |
| Non-additive mutations never run mid-turn | `isTurnProcessingNow` guard; not covered by a single test across all routes |
| Ratification weights are frozen at open | `src/lib/unions/ratification.test.ts` |

## Failure and recovery

- **Roster incomplete.** At `full`, `processUnionsTurn` compares the union count with the expected one per country and sector type and backfills missing seeded unions with an idempotent seed (no existing union is overwritten). Seen when a flag flip auto-seed partly failed.
- **Unrepresented sectors.** `adoptUnrepresentedSectors` hands sectors with no `representingUnionId` to their industry's seeded union each turn.
- **Owner cache drift.** `Character.unionLeaderOf` disagreeing with `Union.ownerId` is repaired on read by the reconcile helpers.
- **Dangling raid target.** A sector whose representing union no longer exists is treated as unrepresented and the pointer is cleaned up.
- **Inactive leader.** Auto-vacancy returns the union to NPC control after 72 idle turns.
- **Mode switched down.** Turning the mode below `full` freezes union state instead of letting it drift with no leader able to react.
- **Bad data repair.** A wrong union, sector or budget field is repaired with a heal against the affected documents; a ban in force can be undone by a `repeal_ban` provision.

### Turn-processing race safety

Any player-facing union or labour mutation that is not purely additive (union-busting, organizing a sector, strike calls) checks `isTurnProcessingNow(gameState)` (`src/lib/turn/processingLock.ts`) before writing, and rejects with 409 while the turn engine's bulk corp-turn write is in flight. The corp-turn sector write and the unions-turn bulk write both recompute from a pre-mutation snapshot with no optimistic-concurrency filter, so an action landing mid-turn would otherwise be silently overwritten. Reusing the existing `GameState.isProcessing` and heartbeat lock avoids retrofitting concurrency control into shared turn code.

## Connections

**Driven by:**

- [Corporations](./corporations.md): sector revenue and maintenance set the labor cost base in `src/lib/turn/corporation/sectorLabour.ts`.
- [Bills & Legislation](./bills-legislation.md): union-law provisions write `FederalBudget.unionLawBias` and `unionsBanned` (`applyUnionLawProvision`).
- [National Budget](./national-budget.md): the minimum-wage Kaitz ratio lives on the federal budget.
- [National Metrics](./national-metrics.md): unemployment, cost of living and labour force feed the unionization target, strike gap and tightness.

**Affects:**

- [National Metrics](./national-metrics.md): `medianIncome`, `unemploymentRate` and migration pull, via the wage index, automation index and tightness terms (`src/lib/demographics/phase.ts`).
- [Corporations](./corporations.md): labor cost, union premium, strike output throttle and margin penalty, staffing rationing.
- Output quality: the wage level is a pillar with weight 0.2, score `clamp01(0.5 + 0.6 x (wageLevel - 1))` (`src/lib/market/brandQuality.ts`).
- Corporate R&D: `rdMoraleFactor` moves R&D efficiency by `0.5 x (avgWageLevel - 1)`, clamped to plus or minus 15% (`src/lib/constants/corporations.ts`).
- [Pensions](./pensions.md): union pension schemes are bargained terms and use the pension turn.
- [Government Approval](./government-approval.md): a crackdown on unions costs labour approval (`CRACKDOWN_LABOUR_APPROVAL_COST_PER_TURN` = 0.25 in `src/lib/unions/crackdownLabourApproval.ts`).
- Political metrics: disputes, settlements and funded services nudge `economy.workerSecurity` (cap 5) and `society.civicLife` (cap 3) (`src/lib/unions/labourRelationsPoliticalProvider.ts`).

## Tests

| Area | Files |
| --- | --- |
| Wages, floors, indexes | `src/lib/labour/laborCost.test.ts`, `src/lib/turn/corporation/sectorLabour.test.ts` |
| Tightness and rationing | `src/lib/labour/labourMarket.test.ts`, `src/lib/turn/corporation/sectorTurn.labourRationing.test.ts`, `persistLabourMarketTelemetry.test.ts` |
| Unionization and strikes | `src/lib/labour/unionization.test.ts`, `src/lib/labour/strikes.test.ts` |
| Busting | `src/lib/labour/unionBusting.test.ts`, `src/lib/corporations/commands/sectorOperations/attemptUnionBusting.test.ts` |
| Union economy | `src/lib/unions/unionDues.test.ts`, `unionEconomy.test.ts`, `unionEconomy.strength.test.ts`, `unionPoliticalContributions.test.ts`, `unionLeadershipVote.test.ts`, `unionReconciliation.test.ts` |
| Commands | `src/lib/unions/commands/foundUnion.test.ts`, `organizeSector.test.ts`, `unionActions.test.ts`, `ratifySettlement.test.ts` |
| Bargaining and agreements | `src/lib/unions/bargaining.test.ts`, `ratification.test.ts`, `collectiveAgreementEffects.test.ts` |
| Underground and bans | `src/lib/unions/underground.test.ts`, `undergroundEffects.test.ts`, `undergroundLifecycle.integration.test.ts` |
| Turn pass | `src/lib/turn/unions/index.test.ts`, `labourRelationsTurn.test.ts`, `serviceTiming.integration.test.ts` |
| Pensions | `src/lib/pensions/pensionTurn.test.ts`, `rules.test.ts` |

Gaps: no single test asserts the 409 guard on every non-additive route; no test pins the founding fee value; the macro coupling constants are covered through `laborCost.test.ts` only for floors and indexes, not through the metric node end to end.

## Known issues and history

- **Contradiction with the previous version of this page:** it said the player wiki describes the minimum wage as set by legislation. The wiki now says the game team sets it, which matches the code (admin route only); there is no bill that sets it.
- **Contradiction with the previous version:** the data model listed `Union.membershipPressure` as an additive term in the drift target. It is retired by union dues v1 and read by nothing; `approval` anchors drift for represented sectors.
- **Contradiction with the previous version:** the founding cost was described as era and FX scaled. The code comment says it is deliberately not era-scaled (500,000 campaign funds times an FX rate).
- **Contradiction with the previous version:** the per-turn pass was described as including membership pressure decay. The pass now does strength decay for all unions, dues, services, contributions and approval.
- `SECTOR_LABOR_INTENSITY` includes `media_entertainment` (0.28) in addition to `media`.
- `AGREEMENT_DURATION_MAX_TURNS` (192) is a module-internal constant, not exported.
- `endorseBill` has no mechanical effect yet (visibility-only, by design for this phase).
- The service-labour relief stage (`SERVICE_LABOUR_RELIEF_FACTOR`) is currently an empty table, so `stagedLaborShare` returns the share unchanged.
- History in code comments: market recovery phase 1 (2026-10-18) recalibrated `SECTOR_LABOR_INTENSITY` so standard strategies earn 15 to 25% at base prices; `STRIKE_CALL_COST_PER_SECTOR` was lowered from 2000 to 400 because the old cost made striking unreachable; union dues v1 replaced `membershipPressure` with members, dues and approval.

Last checked: 2026-10-29, version 1.18.0
