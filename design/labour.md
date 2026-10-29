# Labour & Unions

The labour system models per-sector wage decisions as a first-class economic and political lever: explicit worker pay carved out of corporate maintenance costs, a macro feedback loop tying wages into unemployment/income/migration, an NPC unionization metric with strikes, and a full player-run union layer (found a union, organize/raid sectors, elect a leader, strike, bargain collectively, demand wages, set dues/services/political contributions, endorse legislation, get busted or write union law). It ships as one graduated feature flag so every tier can be validated independently before the next unlocks.

**Entry point:** `src/lib/labour/featureFlag.ts` (`labourSystemMode`, `isLabourWagesEnabled()`/`isLabourMacroEnabled()`/`isLabourUnionsEnabled()`/`isLabourFullMode()`)

## Overview

- **Scope:** Per-`CorporateSector` wage economics, national/state macro metrics, NPC + player-run unions, union-law legislation
- **Target:** All player and NPC corporations; unions represent the specific `CorporateSector`s they have organized or raided, not an entire (country, industry) pair by default, rival unions may coexist in the same (country, sector type)
- **Effects:** Corp profit margins, state `medianIncome`/`unemploymentRate`, international migration pull, strikes (revenue throttle), union treasury/membership/dues/services, legislative NPI cost
- **Enactment:** Admin toggle (Admin → Economy → Labour) for the mode tier; in-game actions (wage slider, found, organize/raid, vote leader, strike, bargain, bust, demand-wage, dues/services/political contributions, endorse) once a tier is live; `union_law` bill provisions once at `full`

## `labourSystemMode` tiers

One graduated flag on `GameConfig`, each tier a strict superset of the previous. `getLabourSystemMode()` returns `"off"` only when the field is absent or unknown.

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

Explicit per-sector labor cost carved OUT of `maintenance` (never added on top), profit-invariant at the baseline wage multiplier. `SECTOR_LABOR_INTENSITY` (cost share of revenue) and `SECTOR_WAGE_LEVEL` (relative pay per worker) are separate tables in `src/lib/labour/laborCost.ts`, so minimum wage correctly bites labor-intensive/low-paid sectors (retail, agriculture) instead of labor-light ones (extraction). CEO wage slider: `WageLevelPanel.tsx`. Minimum wage: Kaitz ratio on `FederalBudget.minimumWageKaitzRatio`, admin-settable via Admin → Economy → Labour (`LabourAdminPanel.tsx`). Automation tech reduces labor cost via the existing tech-tree framework.

## Phase 2 (v2), macro coupling (`labourSystemMode >= "macro"`)

Routes labour wage decisions into the existing `medianIncome` Phillips-curve node rather than wiring every downstream channel individually:

- **Migration pull:** per-state `labourWageIndex` (worker-weighted `wageLevel × minWageFloorMultiplier`, 1.0 = baseline) multiplies `economicPullFactor`'s output via `labourMigrationWageFactor()`, bounded `[0.7, 1.3]`, re-clamped to `[0.5, 1.5]` overall.
- **Income channel:** `labourWageIndexDelta` (this-turn minus prior-turn index, zero on cold start) feeds `wageGrowthAnnualPct` inside `medianIncomeNode.compute()` via `labourWageIncomePassthrough()`.
- **Jobs channel:** the same wage delta adds a capped unemployment pressure term (`labourUnemploymentWagePressure`, 1.5pp per index-point, ±1.5pp cap); a separate `automationIndexDelta` (worker-weighted `techEffects.laborCostMultiplier`) adds an inverted pressure term (`labourUnemploymentAutomationPressure`, 2.5pp coefficient), automation cutting headcount is deliberately a different signal from wages cutting pay.

Convention: **Δ not level** for anything read into a compounding series (medianIncome, unemploymentRate), a level term would march the series to its bound and pin there. Unionization itself is the exception (see Phase 5) because it's a target-trending stock, not a recursive series.

## Phase 5, NPC unionization metric (`labourSystemMode >= "unions"`)

Per-sector `unionization` (0-100) drifts each turn toward a condition-driven target (`unionizationDriftTarget()` in `src/lib/labour/unionization.ts`), inputs: CEO `wageLevel` vs. state cost-of-living (`realWageIndex()`), state `unemploymentRate` (worker leverage), country minimum-wage Kaitz ratio, plus (once `full`) `unionLawBias` and owned-union `membershipPressure`. `unionPremium(unionization)` is a standing labor-cost surcharge, linear 0-15pp (`UNION_PREMIUM_MAX_PCT`), folded into `wageMultiplier` using the prior turn's persisted value (one-turn lag, consistent with the rest of the labour system).

## Phase 6, strikes (`labourSystemMode >= "unions"`)

Per-sector bounded-duration event (`src/lib/labour/strikes.ts`). Triggers when `unionization > STRIKE_UNIONIZATION_THRESHOLD` (55, calibrated well under `unionizationDriftTarget()`'s composed ceiling, see the calibration note below) **and** a slow-trending `workerExpectationIndex` lags the current real wage by more than `STRIKE_EXPECTATION_GAP_THRESHOLD` (0.12). While active: revenue ×0.75 (`STRIKE_REVENUE_THROTTLE`), margin −8pp. Resolves via **concession** (gap closes to ≤0.04) or **wait-it-out** (`STRIKE_DURATION_TURNS`=4 turns, unionization +10). Cooldown (`STRIKE_COOLDOWN_TURNS`=12) is set on both resolution paths, that, plus the trigger/concession hysteresis gap and the slow expectation index, is what prevents an always-strike/never-strike equilibrium.

**Calibration note:** the trigger/gap pair is deliberately reachable through _purely political_ levers (union-law bias, membership pressure) with zero real wage or employment stress, not just economic ones, this is intended (see `strikes.ts`'s docblock for the exact composed-ceiling math), not a miscalibration. No single factor alone crosses the threshold.

## Phase 7, union-busting + union law (`labourSystemMode >= "full"`)

- **Busting** (`src/lib/labour/unionBusting.ts`, command `attemptUnionBusting.ts`, route `POST /api/corporations/[id]/sectors/[sectorId]/union-busting`): CEO action modeled on the whip-success pattern. Success chance starts at 60, drops with unionization, floored 20/ceilinged 80. Success drops `unionization` by 20pp **and ends any active strike** (clears `strikeStartedAtTurn`, starts the strike cooldown); backfire raises unionization by 15pp and leaves strike state untouched. Cash cost 50% of daily gross revenue (floor 1000). 12-turn busting cooldown either way. Rejected with 409 while the turn engine is mid-processing (`isTurnProcessingNow()` guard against a write race with the bulk corp-turn update).
- **Union law:** `UnionLawProvision { type: "union_law"; bias: number }`, a single signed axis (-50 right-to-work .. +50 collective-bargaining) written to `FederalBudget.unionLawBias`. Feeds `unionizationDriftTarget()` (weight 0.6, max ±30pp) and a country-adjusted strike-trigger threshold override, deliberately does **not** bias the strike concession/gap threshold, to preserve Phase 6's hysteresis invariant. Bill authoring is an explicit "Include union-law provision" checkbox (not inferred from `bias !== 0`), since 0 is a valid, legislatable reset to neutral. NPI (National Political Influence) cost counts union-law provisions the same as policy/subsidy provisions, a bill can't add bias-shifting provisions for free.

## Phase 8, player-run unions (`labourSystemMode >= "full"`)

Under "union dues v1" a union is no longer a single seeded singleton per (countryId, sectorType) with first-come `claim` leadership. Any character may **found** a rival union in an industry that already has one (`src/lib/unions/commands/foundUnion.ts`), and a union only represents the specific `CorporateSector`s it has actually organized or raided, not every sector matching its (country, sector type) pair.

- **`foundUnion`**, pays `UNION_FOUNDING_ACTION_COST`=10 action points plus an era/FX-scaled campaign-funds cost (`unionFoundingCostLocal`), both charged in one conditional `findOneAndUpdate` so a founder can never pay one and keep the other. Fails if the character already leads a union (`character.unionLeaderOf`) or the name is already taken in that (country, sector type) pair (`MIN_UNION_NAME_LENGTH`=2, `MAX_UNION_NAME_LENGTH`=60). A founded union starts empty: zero treasury, no represented sectors.
- **`organizeSector`** (`src/lib/unions/commands/organizeSector.ts`, `ORGANIZE_SECTOR_ACTION_COST`=1 action point), the headline union-head action, spends treasury (`organizeSectorTreasuryCost`) to push one sector's `unionization` up (`sectorUnionizationGain`, base `SECTOR_UNIONIZATION_GAIN_BASE`=5):
  - **Unrepresented sector**, a straight organizing drive; the first drive claims `representingUnionId`, so the shop's workers count as members immediately.
  - **Represented by the same union**, reinforcement; pushes `unionization` further, no ownership change.
  - **Represented by a rival union**, a raid. Winner-takes-all: the attacker must out-poll the incumbent's approval by at least `RAID_APPROVAL_EDGE_REQUIRED`=5 points (`raidSucceeds()`), no randomness. A failed raid still costs the treasury/action spend.
  - No decay is applied by the action itself. The first successful drive sets `representingUnionId`; after representation, `trendUnionization` moves the shop toward that union's approval rather than back to the NPC economic target.
- **`voteUnionLeader`** (`src/lib/unions/commands/voteUnionLeader.ts`), leadership is elected, not first-come-claimed, once `isUnionLeadershipElectionOpen()` says the union is strong enough (`LEADERSHIP_ELECTION_MIN_STRENGTH`). Organizers (`UnionOrganizer`, built from prior `organizeSector` drives) vote for a candidate; plurality leader becomes `pendingLeaderCharacterId`. Contests stay open even while a president sits, mirroring corporation CEO votes.
- **`strike`** (`src/app/api/unions/[id]/strike/route.ts`), force-starts a strike on every matching sector at/above `STRIKE_CALL_MIN_UNIONIZATION`=30 not already active/cooling; cost scales per matched sector (`strikeCallCost`, `UNION_STRIKE_CALL_COOLDOWN_TURNS`=8 cooldown); computes each sector's `workerExpectationIndex` at call time so the strike doesn't spuriously auto-resolve as an immediate concession.
- **`bargaining`** (`src/lib/unions/bargaining.ts`, `src/lib/unions/commands/bargaining.ts`), a formal collective-bargaining campaign, running over `BARGAINING_DEADLINE_TURNS`=8 turns with an escalation ladder (`overtime_ban` → `selective_strike` → `industry_strike`, gated on rising member support thresholds 35/50/65) and an optional mediation window. A ratified settlement becomes a `CollectiveAgreement` lasting `AGREEMENT_DURATION_MIN_TURNS`=24 to `AGREEMENT_DURATION_MAX_TURNS`=192 turns.
- **`setUnionWageDemand`** (route `demand-wage`), sets a visible target `wageLevel` (clamped, `demandedWageLevel`), surfaced to CEOs in scope as a banner. One-sided, no accept/reject contract flow, binding wage terms are bargaining's job.
- **`setUnionDues`**, sets the union's annual per-member dues rate, clamped to `[0, maxDuesForWage(averageAnnualWage)]` against the represented workforce's actual wages.
- **`setUnionServices`**, toggles the union's service slate; unknown ids dropped by `normalizeServiceIds`.
- **`setUnionPoliticalContributions`**, sets the share (clamped `[0, 0.5]`) of remaining per-turn free cash flow sent to organizers as political contributions.
- **`endorseBill`**, records a bill stance (`UnionEndorsement`, `endorse`/`oppose`), visibility-only, no vote-swing effect yet; shown on the union's own dashboard.
- Leader actions are gated through `resolveOwnedUnion()`, which 403s while the union's country has an enacted union ban (checked against the enactment-time budget flag, not `union.suspended`) or while `union.suspended === true`.

Per-turn processing (`src/lib/turn/unions/index.ts`, `"unionsTurn"` phase, runs immediately after `"corporationTurn"`): treasury dues trickle, services cost, political contributions, membership pressure decay, and inactivity auto-vacancy release the union back to NPC control. Non-additive mutations (union-busting, `organizeSector`, strike calls) are rejected with 409 while `isTurnProcessingNow()`, the corp turn's bulk sectorOps write and the unions-turn bulk write both recompute from a pre-mutation snapshot with no optimistic-concurrency filter, so an action landing mid-turn would otherwise be silently clobbered. All union routes and the turn phase are gated on `isLabourFullMode()`; the leaderboard/dashboard pages (`src/app/unions/page.tsx`, `src/app/unions/[id]/page.tsx`) distinguish a disabled-feature/network error from the legitimate empty state.

## Turn-processing race safety

Any player-facing union/labour mutation that isn't purely additive (union-busting, recruit, strike-call) checks `isTurnProcessingNow(gameState)` (`src/lib/turn/processingLock.ts`) before writing, rejecting with 409 while the turn engine's bulk corp-turn write is in flight, reusing the existing `GameState.isProcessing`/heartbeat lock rather than retrofitting optimistic concurrency into the shared turn-processing code path.
