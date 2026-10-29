# Political System - Registration / Support Model

Historical record: this page describes the Phase 0.5 design as of 2026-05-05. For current behaviour see [Party Organization](https://www.ahousedividedgame.com/wiki/party-organization) and [Granular Electorate as Shipped](./granular-electorate-as-shipped.md).

Player guide: [Party Organization](https://www.ahousedividedgame.com/wiki/party-organization)

> **Historical:** this is the Phase 0.5 design record. Numbers in the body are as designed then; where the live value differs, a correction note says so.
>
> **Status:** Complete pending user review (Phase 0.5 of the political-system rework, kicked off and closed 2026-05-05)
> **Owner:** political-system-rework
> **Sources of truth this doc supersedes:** none yet - this is the first design doc that defines `Reg%`, `Support`, and the per-state pool composition.
> **Gate 0 audit findings:** see the `### Gate 0 - Findings (recorded 2026-05-05)` section of the plan.

This document is the single source of truth for the Registration / Support model that powers the political-system rework. Phases 1, 2, 3, 4, 5, 5.5, and 6 link to specific anchors here rather than restating the model.

## Table of Contents

- [1. Scope](#1-scope)
- [2. Model-type decision](#2-model-type-decision)
- [3. Support storage](#3-support-storage) - _populated by Task 0.5.1_
- [4. Registration storage + state-level pools](#4-registration-storage--state-level-pools) - _populated by Task 0.5.2_
- [5. orgRegLedger schema](#5-orgregledger-schema) - _populated by Task 0.5.3_
- [6. Default-party defenses](#6-default-party-defenses) - _populated by Task 0.5.4_
- [7. PS / Org / Reg / Support interactions + election formula contracts](#7-ps--org--reg--support-interactions--election-formula-contracts) - _populated by Task 0.5.5_
- [8. Pacing & turn-order contract](#8-pacing--turn-order-contract) - _populated by Task 0.5.6_
- [9. Migration sketch](#9-migration-sketch) - _populated by Task 0.5.7_
- [10. Cross-references back to the plan](#10-cross-references-back-to-the-plan) - _populated by Task 0.5.7_
- [Per-Task Audit Log](#per-task-audit-log)
- [Final Audit](#final-audit)

---

## 1. Scope

### In scope (this doc)

- The conceptual model: what `Org%`, `Reg%`, `Support` mean, what they store, and how each metric moves.
- TypeScript schema sketches for every new field, collection, constant, and helper that downstream phases will create.
- Index plans for new collections.
- Default-party defense numbers committed as constants, not "tunable."
- The per-state pool composition (party shares + `Independent` + `Unregistered` = 100%).
- Cross-references to the plan's locked assumptions and per-phase responsibilities.

### Out of scope (deferred to later phases)

- Actual creation of TypeScript files, API routes, UI components - Phase 1+ work.
- Migration script implementation - Phase 1+ work that uses this doc's schema sketches.
- Game-balance tuning beyond the explicit constants here - landed in the plan's Balance Appendix at Phase 3 kickoff.
- PS pressure-ladder steady-state walkthrough - Phase 3 kickoff gate (referenced from the plan).
- Country-specific `Reg%` UI copy decisions - Phase 5 owns wording.

### Country support

- **In scope at Phase 0.5:** US, UK, JP, DE - the active country simulations at that time.
- **Not in scope at Phase 0.5:** Brazil, China, Ireland - these had party seeds (`brParties.ts`, etc.) but were not yet active country simulations. Ireland and China are active now. The Reg/Support model applies to them when they become active; nothing here precludes that.

### Authority

When this doc and the plan disagree on a Reg/Support detail, this doc wins. When this doc and existing plan-locked assumptions disagree, the plan wins until the plan is updated to point here. Resolve disagreements by updating one or the other - don't let them sit.

---

## 2. Model-type decision

**Decision: Registration + Support (both exist as distinct concepts).**

The plan's user-locked assumptions (2026-05-03) drive this:

> - `Support` exists as a short-term electoral mood layer.
> - In primaries, Support is candidate-specific and acts only as a modifier on candidate capture within party `Reg%`; it is not a full separate state pool.
> - The registration pool is `party shares + Independent + Unregistered = 100%`.
> - `Reg%` is slow-moving partisan lean / influence, not literal vote share.

This is a `Registration + Support` model: `Reg%` is the slow territorial baseline, `Support` is the fast candidate-level mood. Both exist; they have different jobs.

### Why not `Support only`

Without `Reg%`, primaries would have to compute candidate share against the entire state population uniformly, ignoring partisan baseline. That breaks the design's "candidates carve up Party Registration" mechanic from the Claude Design handoff (the original design brief, opening user message) and removes the slow-moving territorial layer the rework is built around.

### Why not `Registration only`

Without `Support`, candidates within the same party have no mood / momentum signal - primaries would be decided purely by party-state baseline + demographics + influence with no room for last-week swings, scandals, or endorsement bumps. The Claude Design handoff chat (same file as above) explicitly calls for both layers - "a slice of this Metric, affected by demographics, archetype, etc."

### Country-agnostic vs country-family-specific

`Support` and `Reg%` are **country-agnostic in their data shape** - every supported country's `StatePartyOrg` row and primary-eligible candidate gets the same fields. Country-specific behavior lives in:

- the bootstrap seed values for `Reg%` (curated per country in the plan's Bootstrap Seed appendix)
- the election formulas that consume them (per-race-family adapters in Phase 5 / 5.5)
- which UI surfaces show numeric values vs. honest placeholders (Phase 1+)
- whether some race families even surface a `Reg%`-aware UI at all (e.g. UK without a devolved-executive office type per Gate 0 - the regional-executive chip hides, but the underlying state-level `Reg%` data still exists and is consumed by primary / general election math)

So: the model **shape** is country-agnostic; UI surfaces and consumer formulas may be country-family-specific. Storing the data uniformly does not commit the UI to displaying it uniformly.

### Acceptance: this section answers...

- Whether the game has Support / Reg+Support / Reg-only → **Registration + Support, both.**
- Whether `Support` is country-agnostic or country-family-specific → **country-agnostic.**

---

## 3. Support storage

### 3.1 Canonical: `electionCandidates.support`

`Support` is **candidate-specific in primaries**. The canonical store is a new field on the existing `electionCandidates` document:

```ts
// src/lib/db/types/election.ts - extension to ElectionCandidate
export interface ElectionCandidate {
  // ... existing fields ...

  /**
   * Short-term electoral mood for this candidate, scoped to this election cycle.
   * Bounds: 0..100 (clamped on every write; reads must tolerate 0 absence).
   * Lifecycle is keyed off `Election.status` (see §3.1.1), not "primary phase":
   *   - written on candidate entry (defaulted to a calibration constant per Phase 4 kickoff)
   *   - mutated by Support actions (rallies, ad buys, scandals, endorsements, debate moments)
   *   - decays per turn while `Election.status === "active"` (rate calibrated in Phase 4 - see §8 step 5)
   *   - cleared at `Election.status === "resolved"` (set to undefined; applies to both
   *     primaries and direct generals - see §3.1.1 for the unified contract)
   *   - withdrawal does NOT clear the field; only `resolved` clears
   * In primaries: modifies how much of the party's `Reg%` capturable pool
   *   this candidate can win.
   * In generals: read by general-election formulas as a candidate-level
   *   bonus / penalty on top of party `Reg%` and `Org%` (Phase 5).
   */
  support?: number;
}
```

**Bounds:** `0..100`. Implementations must clamp on every write; reads must tolerate `undefined` (treat as `0`).

**Writers (exclusive - these are the only places that write `electionCandidates.support`):**

1. **Candidate entry path** (file currently in `src/lib/elections/` or via API route - Phase 4 audit pinpoints exact location). Sets initial Support to a per-country / per-race-family default constant. Default constant lives in `src/lib/elections/supportConstants.ts` once Phase 4 ships; Phase 0.5 commits the _shape_ (per-country, per-race-family lookup) without committing the numeric values.
2. **Support actions** (rallies, ad buys, scandals, endorsements, etc.) - these are Phase 3+ mechanics that produce a typed `delta` and route through a single `applySupportDelta(electionId, candidateId, delta, source)` helper that writes the field and the ledger row in the same operation. Negative deltas (scandal hits) are clamped at the lower bound (`0`); the field never goes negative.
3. **Resolution path** - clears the field (sets to `undefined`) when the election closes (`status` transitions to `resolved`). Applies to primaries AND general elections; the field is per-`electionCandidates`-row, so cleanup is the same regardless of race type.
4. **Per-turn decay processor** - applies the locked decay rate during the politics turn phase. Runs in step 5 of the turn-order contract (§8). Decays for races where `Election.status === "active"` (primaries and generals during their active window). Off-cycle candidates (status `upcoming`) do not decay because their Support is `undefined` until entry.

### 3.1.1 Lifecycle clarification - what about races without primaries?

Most non-US races (UK Commons constituency, JP shugiin proportional, DE Bundestag list) do not have separate primaries - candidates appear directly in the general. The Support lifecycle is **per `Election` row, not per `phase`**: Support starts at candidate entry, decays during `status === "active"`, and clears at `status === "resolved"`. This applies uniformly across primaries (where active spans the primary window) and direct generals (where active spans the general window). Withdrawals do **not** clear Support - the field persists on the candidate row through `status === "withdrawn"` so analytics can see "they had X support when they withdrew." Only `resolved` clears.

**Readers:**

- `resolveElection()` / `_enrichElection()` (already exists at `src/lib/elections/resolveElection.ts`) - surfaces in the response so primary / general-election UI can consume it.
- Phase 1 KPI: not directly. Phase 1 derives the state KPI label from this field via the rollup overlay in §3.2.

### 3.2 Derived overlays: `Party.support` and `StatePartyOrg.support`

Optional read-only rollups. These are **derived from candidate Support**, not authoritative:

```ts
// src/lib/db/types/party.ts - extension to PoliticalParty
export interface PoliticalParty {
  // ... existing fields ...

  /**
   * National rollup of candidate Support across in-cycle primary candidates,
   * decayed for off-cycle. Read-only for general-election display surfaces.
   *
   * NEVER written by a player action or a Support action; only by the
   * derivation processor. Treat as a cached aggregate, not a source of truth.
   *
   * Bounds: 0..100. May be undefined if no in-cycle primary candidates exist.
   * Updated: once per turn during the politics phase (§8 step 5).
   */
  support?: number;
}

// src/lib/db/types/statePartyOrg.ts - extension to StatePartyOrg
export interface StatePartyOrg {
  // ... existing fields ...

  /**
   * Per-state rollup of candidate Support across in-cycle primary candidates
   * who are running in this state's primaries (or campaigning here, for
   * presidential primaries). Same caching contract as Party.support.
   */
  support?: number;
}
```

**Derivation rule (Phase 5 implements; doc here so Phase 1 KPI can read consistently):**

The rollup considers all **in-cycle candidates of `partyId` whose `electionCandidates` row carries a `support` value AND whose election applies to this state**. That includes:

- primary candidates running in this state's primary
- general-election candidates running in this state (for race families that go straight to general - UK Commons, JP shugiin, DE Bundestag, etc.)
- presidential primary / general candidates currently campaigning in this state

```
StatePartyOrg.support[stateId][partyId]
  = weighted_average(
      candidates: all in-cycle electionCandidates rows where party=partyId AND scope-includes(stateId),
      weights: each candidate's stake (primary delegate weight, seat weight, or 1 for single-seat races),
      value: candidate.support
    )
  // Off-cycle behavior: when no in-cycle candidate exists, the rollup is
  // simply `undefined`. Phase 5 may later add an off-cycle persistence
  // model (e.g. last-cycle value × decay-per-turn) but Phase 0.5 commits
  // the simpler "undefined when empty" semantic.

Party.support[partyId]
  = weighted_average(
      states: all StatePartyOrg.support[*][partyId] entries,
      weights: state delegate weight or state population weight,
      value: that state's rollup
    )
  // undefined when no states have a defined rollup
```

**Race-family scoping rules:**

- **US presidential general** has one national `electionCandidates` row per candidate, not per-state. The per-state rollup attributes the candidate's national Support uniformly to every state. (Per-state mood signals like `primaryCampaignState` are presidential-primary-only and don't change the national candidate's general-election support.)
- **US down-ballot generals** (Senate, Governor, House) have per-state or per-district rows; rollups follow the natural state mapping.
- **UK Commons constituency, JP shugiin proportional, DE Bundestag list, and other direct-general races without separate primaries:** the rollup pulls from general-election candidates' Support directly during the active general window. For proportional / list races, weights are seat-weighted as documented above.
- **The rollup is `undefined`** when no eligible candidate exists in any race family for that `(party, state)` pair.

Exact weights calibrated at Phase 5 kickoff. Default values land in a new `src/lib/turn/parties/supportDecayConstants.ts` (or sibling) at that point - **not** in `defenseConstants.ts` (which is reserved for the org-floor / unmanned-cap mechanic in §6) or `pacingConstants.ts` (Reg drift / decay only). The candidate-Support per-turn decay rate (a separate concern - applied to `electionCandidates.support`, not the rollup) is also calibrated at Phase 4 / 5 - see §8 step 5.

**Writer (exclusive):**

- A single `derivePartySupportRollups(now)` processor invoked once per turn during the politics phase, after candidate Support decay (§8 step 5). It writes both `Party.support` and `StatePartyOrg.support` for every party / state pair. No other writer.

**Readers:**

- Phase 1 KPI strip - reads `StatePartyOrg.registration` directly for the `Reg%` KPI under the chosen Reg+Support model. The `StatePartyOrg.support` rollup is **not** used by Phase 1 - Phase 1 ships before Phase 4 (which writes `electionCandidates.support`) and Phase 5 (which writes the rollup), so there's nothing to read.
- Phase 5 General-election screen - reads `StatePartyOrg.support` and `Party.support` for the party-level mood overlay. This is the primary consumer of the rollups.

### 3.3 Field bounds, lifecycle, write contract - summary

| Field                        | Type      | Bounds   | Writers                                                                | Readers                                     | Lifecycle                                                                                                                                                       |
| ---------------------------- | --------- | -------- | ---------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electionCandidates.support` | `number?` | `0..100` | candidate entry, Support actions, decay processor, election resolution | `resolveElection()`, primary UI, general UI | Set on entry; decays per turn while `Election.status === "active"`; cleared at `Election.status === "resolved"` (primary or general); withdrawal does not clear |
| `Party.support`              | `number?` | `0..100` | derivation processor only (Phase 5+)                                   | Phase 5 general UI                          | Recomputed per turn from rollups; undefined before Phase 5                                                                                                      |
| `StatePartyOrg.support`      | `number?` | `0..100` | derivation processor only (Phase 5+)                                   | Phase 5 general UI                          | Recomputed per turn from rollups; undefined before Phase 5                                                                                                      |

### 3.4 What this section answers

- ✅ Plan Phase 0.5 deliverable #1 (Support exists; this is its storage)
- ✅ Plan Phase 0.5 deliverable #7 (Support storage and ownership; canonical vs derived; writer scoping)
- ✅ Plan §11 "Support default behavior" - short-term mood, candidate-specific by default, decay over a matter of days
- ✅ Plan acceptance criterion: "the plan records whether Support is country-agnostic or country-family-specific" - country-agnostic shape; per-race / per-country defaults at Phase 4 / 5 kickoff

---

## 4. Registration storage + state-level pools

### 4.1 The two distinct pools

The political system maintains **two separate normalized 100% pools per state / region**, each scoped to the same `(countryId, stateId)` location but tracking different concepts:

| Pool                  | Buckets                                               | Sums to | Existing storage                                      | New storage needed?                                    |
| --------------------- | ----------------------------------------------------- | ------- | ----------------------------------------------------- | ------------------------------------------------------ |
| **Org pool**          | `Σ party shares` + `Unaffiliated Org`                 | `100%`  | `StatePartyOrg.organization` per `(stateId, partyId)` | `Unaffiliated Org` derived as `100 - Σ` (no new field) |
| **Registration pool** | `Σ party Reg shares` + `Independent` + `Unregistered` | `100%`  | nothing today (Gate 0 finding)                        | Yes - see §4.2 + §4.3                                  |

These are **separate pools**: a state can have `DEM Org 36% / GOP Org 22% / Unaffiliated Org 42%` _and_ `DEM Reg 49% / GOP Reg 27% / Independent 16% / Unregistered 8%` simultaneously. The pools do not need to align - they represent different things (organizational machinery vs. partisan lean of the population).

### 4.2 Per-party Reg% - `StatePartyOrg.registration`

Adds one new field to the existing `StatePartyOrg` document:

```ts
// src/lib/db/types/statePartyOrg.ts - extension to StatePartyOrg
export interface StatePartyOrg {
  // ... existing fields including organization, hasPresence, actionPool ...

  /**
   * Party Registration percent in this state - slow-moving partisan lean,
   * NOT a literal vote-share promise.
   *
   * Bounds: 0..100 (per individual row). The full registration pool is
   * normalized to 100% across:
   *   sum of all StatePartyOrg.registration for parties in this (countryId, stateId)
   *   + StateRegistrationPool.independent
   *   + StateRegistrationPool.unregistered
   *   = 100
   *
   * Lifecycle:
   *   - seeded at country bootstrap from the Bootstrap Seed appendix
   *     (per-country curated tables in the plan)
   *   - drifts toward Org baseline at 0.04% / turn (Phase 0.5 §8 pacing).
   *     The drift moves Reg toward this party's *own* organization value;
   *     displaced Reg is routed to other parties or non-party buckets per
   *     the 10% Org eligibility rule (§8). Drift applies to every party
   *     regardless of its own Org level - see §4.2.1.
   *   - decays / erodes at 0.004% / turn, routed via the same 10% Org
   *     eligibility rule (§8) to other parties or non-party buckets
   *   - mutated by explicit Phase 3 Reg actions: Registration Drive
   *     (vs Unregistered), Persuasion (vs Independent), Contest / poach
   *     (vs rival party Reg). All rate-limited per the plan.
   *   - on party-row deletion (cleanup of a collapsed third party): the
   *     deleted row's Reg share is preserved by routing it to non-party
   *     buckets (`Independent`, then `Unregistered`) in a single ledger
   *     entry sourced as `partyCollapse`. The pool invariant must remain
   *     satisfied across the deletion.
   *
   * Defaulting: undefined means "not yet computed / seeded" - readers must
   * treat as 0 and surface honest placeholder UI rather than fabricating
   * a derived value. Once the bootstrap seed run lands, every existing
   * StatePartyOrg row has this field populated.
   */
  registration?: number;
}
```

#### 4.2.1 Drift applies to every party regardless of Org level

The drift rate (`0.04% / turn` toward Org baseline) applies to every party with a `StatePartyOrg` row, **not** only to parties with `≥ 10% Org`. The 10% eligibility threshold is for _catching_ drifted Reg, not for _losing_ it. A collapsed party at `Org = 0%` still has its `Reg` drift toward 0 - and the displaced share routes to eligible rivals or non-party buckets per §8. This prevents stranded Reg on a defunct party.

A party at `Org = 0%` and `Reg = 0%` has no drift (zero delta); the row remains in the collection but no ledger row is written.

### 4.3 Non-party buckets - new collection `stateRegistrationPool`

The non-party buckets (`Independent`, `Unregistered`) are state-level, not party-level. They live in a new collection - one document per `(countryId, stateId)`:

```ts
// src/lib/db/types/stateRegistrationPool.ts (new file)
import type { CountryId } from "../../constants/countries";

export interface StateRegistrationPool {
  /** Composite key: `${countryId}_${stateId}` (mirrors StatePartyOrg pattern). */
  _id: string;

  countryId: CountryId;
  stateId: string;

  /**
   * Politically engaged but unattached share. Moved primarily by persuasion,
   * candidate quality, scandals, endorsements, and issue salience (Plan §12).
   * Bounds: 0..100.
   */
  independent: number;

  /**
   * Lower-engagement population share. Primarily moved by registration /
   * civic-engagement actions (Plan §12).
   * Bounds: 0..100.
   */
  unregistered: number;

  /**
   * Last turn at which any share moved (matches `gameState.currentTurn`
   * semantics). Useful for change detection and for skipping renormalization
   * scans on quiet states.
   */
  lastUpdatedTurn: number;

  createdAt: Date;
  updatedAt: Date;
}
```

**Index plan:**

```
{ countryId: 1, stateId: 1 }   unique
```

The composite key in `_id` already enforces uniqueness; the explicit index supports `find({ countryId, stateId })` queries from `getStateOverview()` and per-state drift / decay processors without a collection scan.

### 4.4 Pool-sum invariant

For any `(countryId, stateId)`:

```
Σ StatePartyOrg.registration[partyId] for partyId in all-parties-in-country
  + StateRegistrationPool.independent
  + StateRegistrationPool.unregistered
  = 100   (exactly, after every politics-phase write)
```

The sum runs over every party that exists in the country, **including parties with no presence in this state** - those parties contribute `registration: 0` (or undefined → treated as 0). For this invariant to hold, the bootstrap seed must create a `StatePartyOrg` row for every `(state, party)` pair in the country. Any party-creation flow added later must do the same: when a new third party is created via Phase 6's charter ratification, the system must create a `StatePartyOrg` row for that party in every state at the moment of ratification, with `organization: 0`, `registration: 0`, `hasPresence: false`. The current US bootstrap seed already does this for default-party-and-curated-third-party combinations; Phase 1 audit confirms the pattern, Phase 6 extends it.

A small validator runs after step 4 (Reg decay / rerouting) of the politics phase - by which point all Reg-affecting writes for the turn have completed (steps 5-7 don't touch the registration pool):

```ts
// src/lib/turn/partyOrg/validateRegistrationPool.ts (Phase 1+ implementation)
export function validateRegistrationPool(
  rows: StatePartyOrg[],
  pool: StateRegistrationPool,
  tolerance = 0.001 // floating-point slop
): { ok: true } | { ok: false; sum: number; expected: 100; delta: number };
```

If a state's pool ever drifts off `100` by more than `tolerance` **at the end of the politics phase**, log an error and re-normalize (proportional rescale). The ledger (§5) records the renormalization as a separate row with `source: "renormalize"` so the divergence is auditable.

**Mid-phase reads:** the invariant is asserted only at the end of each politics-phase run, not after every individual write within the phase. Mid-phase reads (e.g. one processor reading state during steps 3-4) may briefly observe sums that don't equal 100 - this is expected and the validator does not flag it.

### 4.5 Unaffiliated Org

The Org pool's analogue of `Independent` / `Unregistered` is `Unaffiliated Org`. Decision: **derive it, do not store it.**

```ts
// src/lib/turn/partyOrg/computeUnaffiliatedOrg.ts (Phase 1+ implementation)
export function computeUnaffiliatedOrg(rows: StatePartyOrg[]): number {
  const sumOrg = rows.reduce((acc, r) => acc + (r.organization ?? 0), 0);
  return Math.max(0, 100 - sumOrg);
}
```

Rationale: `StatePartyOrg.organization` already stores all the data needed; adding a separate `unaffiliatedOrg` field would create a redundant value that has to be kept in sync. Deriving it avoids the sync risk and is cheap (one sum per state per read).

**Where this is consumed:**

- Phase 1's `getStateOverview()` aggregator computes it for the `unaffiliatedPct` field on `StateOverviewResult`.
- Phase 3's Org-capture mechanic reads it to decide whether to pull from the unaffiliated remainder vs. rival parties.

### 4.6 Bootstrap seed shape

The bootstrap seed (per the plan's `### Pass 2 - Curated Assignments` for US/UK/JP/DE) populates both `StatePartyOrg.registration` (per-party rows) and `StateRegistrationPool.independent` / `.unregistered` (per-state row) at country reset. The seed format already gives both pools' values for every state - the implementation copies them into the right collection during seed.

A seed validator runs after the bootstrap completes:

- every per-state combination must sum to exactly `100` (within floating-point tolerance)
- if any combination is off, the seed run fails loudly rather than producing skewed game state

The validator is a Phase 1+ task; this design doc commits the rule.

### 4.7 What this section answers

- ✅ Plan Phase 0.5 deliverable #2 (each metric meaning, storage fields, what moves them, election-surface usage, separate normalized pools, partisan-lean framing, non-party buckets are explicit)
- ✅ Plan Phase 0.5 deliverable #3 (Org / Reg interaction; unaffiliated remainder modeled; rate-limited poaching documented in §3 Reg actions)
- ✅ Plan acceptance: "the plan records the registration-pool composition, including whether `Independent` and `Unregistered` are explicit buckets" - yes, both explicit.

---

## 5. orgRegLedger schema

### 5.1 Purpose

The new `orgRegLedger` collection is the audit trail for every change to `Org%`, `Reg%`, `Support`, and the non-party buckets (`Independent`, `Unregistered`, `UnaffiliatedOrg`). It exists to:

- detect bad balance (e.g. "Reg trended to 0 over 100 turns") before players report it
- provide a paper trail for player-facing change explanations ("your Reg% dropped because Party Y poached 0.06% in turn 12345")
- support the per-state `Reg history` chart (Phase 1 post-Reg-lock-in) and the per-party `Org pressure` chart (Phase 3 Party Hub)
- give a reconciliation source if `StatePartyOrg.registration` or pool fields drift from the invariant

### 5.2 Schema

```ts
// src/lib/db/types/orgRegLedger.ts (new file)
import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export type OrgRegMetric =
  | "org"
  | "reg"
  | "support"
  | "independent"
  | "unregistered"
  | "unaffiliatedOrg";

export type OrgRegLedgerSource =
  | "action" // explicit player or chair action (rally, ad buy, registration drive, etc.)
  | "drift" // passive Org→Reg drift (turn-order step 3)
  | "decay" // passive Reg decay / erosion (turn-order step 4)
  | "poach" // direct rival-party Reg capture (Phase 3 contest action)
  | "passive" // any other passive source (PS trickle, NPP/officeholder bonuses)
  | "renormalize" // pool-sum invariant correction (§4.4)
  | "partyCollapse" // routing on party-row deletion (§4.2 lifecycle)
  | "supportDecay" // candidate Support decay (separate from Reg decay)
  | "supportAction" // candidate Support delta from a Support action
  | "migration" // one-shot backfill events relevant to this ledger's
  // metrics - e.g. Phase 1 seeding StatePartyOrg.registration
  // from the bootstrap appendix on existing rows. Field
  // renames that don't touch org/reg/support don't log
  // here (e.g. the Phase 3 actionPool → politicalStrength
  // rename has no ledger row).
  | "seed"; // bootstrap seed run

/**
 * Sentinel partyId used for state-level pool buckets (Independent, Unregistered).
 * These buckets are not scoped to a party but live in the same ledger so a
 * single per-state read returns the full audit trail.
 */
export const POOL_SENTINEL_PARTY_ID = "__pool__" as const;

export interface OrgRegLedger {
  _id: ObjectId;

  /** Game turn at which the change applied. Matches gameState.currentTurn semantics. */
  turn: number;

  countryId: CountryId;
  stateId: string;

  /**
   * For metrics scoped to a party (`org`, `reg`, `support` as a rollup, or
   * `unaffiliatedOrg` when computed for accounting). For metrics scoped to
   * the state-level pool (`independent`, `unregistered`), this is the
   * sentinel value `POOL_SENTINEL_PARTY_ID` (exported below).
   */
  partyId: string;

  metric: OrgRegMetric;

  /**
   * Signed delta in percentage points. Positive = gain, negative = loss.
   * Bounds: roughly -100..100 in practice, but no hard schema cap.
   */
  delta: number;

  /**
   * Resulting value after the delta. Useful so reconciliation can verify
   * `prev + delta = next` against the live document without a second query.
   */
  value: number;

  source: OrgRegLedgerSource;

  /**
   * Optional actor: the user / NPP whose action produced this ledger row.
   * Always set for `action`, `poach`, and `supportAction` sources; null for
   * passive / drift / decay / renormalize / partyCollapse / migration / seed.
   */
  actorId: ObjectId | null;

  /**
   * Optional free-form context. Examples:
   *  - action source: `"action:registrationDrive"` or `"action:contest:dem"`
   *  - poach source: `"poach:from:gop"` to record the source-party
   *  - migration source: `"migration:phase1:registrationBackfill"`
   * Reserved for human-readable context in change history UI; not parsed by code.
   */
  note?: string;

  createdAt: Date;
}
```

### 5.3 Index plan

```
{ countryId: 1, stateId: 1, partyId: 1, turn: -1 }   // primary state-detail read path
{ turn: -1 }                                          // turn-debug / per-turn audit reads
{ source: 1, turn: -1 }                               // "show me every renormalize event in the last week"
{ actorId: 1, turn: -1 }   sparse                     // "show me every Support action by user X"
```

The first index covers the dominant read path: "every change for `(countryId, stateId, partyId)` in chronological order" - used by both the per-state Reg-history chart and the per-party Org-pressure chart. The `turn: -1` direction is intentional so the most-recent rows surface first.

### 5.4 Writer contract

Every Org / Reg / Support / pool-bucket change produces a ledger row in the **same database operation** as the live-field update, where MongoDB allows. In the native driver, this means:

```ts
// Inside any politics-phase processor or action handler:
const session = client.startSession();
await session.withTransaction(async () => {
  await db
    .collection<StatePartyOrg>("statePartyOrg")
    .updateOne({ _id: rowId }, { $set: { registration: newValue, updatedAt: now } }, { session });
  await db.collection<OrgRegLedger>("orgRegLedger").insertOne(
    {
      turn,
      countryId,
      stateId,
      partyId,
      metric: "reg",
      delta: newValue - prevValue,
      value: newValue,
      source: "action",
      actorId: userId ?? null,
      note: `action:registrationDrive`,
      createdAt: now,
    },
    { session }
  );
});
```

**Transaction availability:** MongoDB transactions require a replica set or sharded cluster. In single-node dev environments, transactions are unavailable. The implementation must:

1. Detect transaction support at **per-process startup** (web server, cron worker, migration script - each separately) via `db.admin().command({ replSetGetStatus: 1 })` or equivalent. Cache the result in process-local state so each subsequent paired write doesn't re-probe.
2. When transactions are available, wrap every paired live-update + ledger-insert in `withTransaction()`.
3. When transactions are unavailable, fall back to a "live-update first, ledger-insert immediately after" pattern with **idempotent live updates** (e.g. setting a value rather than incrementing) so a partial run can be safely retried. Document the fallback in each affected processor's file header.

A drift between live state and ledger is detectable by the reconciliation tooling in §5.5 and §4.4; in production (replica-set MongoDB) it should never occur.

**Concurrency contract:** the politics phase runs single-threaded per turn - one cron worker dispatches all turn processors serially. Player-initiated actions (Support actions, registration drives, contests) are processed serially through API routes and don't race against the politics phase because actions queue against the politics-phase phase boundary. So in practice, no two writers ever target the same `(countryId, stateId, partyId, metric)` row simultaneously, and last-write-wins semantics never apply. Any future change that violates this contract (parallelizing the politics phase, adding background workers) must re-evaluate the ledger writer contract.

### 5.5 Retention policy

- **Detail rows:** keep at least one full election cycle of detail. For the US, that's the longest cycle (presidential, 8 days) - about 192 hourly turns. Round up to **256 turns** of detail rows per state-party-metric for safety margin.
- **Beyond 256 turns:** roll up into weekly aggregates: one row per `(countryId, stateId, partyId, metric, weekStartTurn)` with summed `delta`, count of source rows, and value at the start / end of the week. The detail rows are then deleted (or moved to an archive collection if storage cost permits).
- **Renormalize, partyCollapse, migration, and seed events are never rolled up** - these are rare and forensically important. Keep them indefinitely.
- A nightly turn-phase task (`src/lib/turn/orgRegLedgerRollup.ts`, Phase 1+) handles the rollup.

### 5.6 Scope: what this ledger does NOT track

`orgRegLedger` covers movements in `Org%`, `Reg%`, candidate `Support`, and the state-level pool buckets (`Independent`, `Unregistered`, `UnaffiliatedOrg`). It does **not** track:

- **Political Strength (PS) movement** - that lives in the separate `partyPoliticalStrengthLedger` collection per the plan's Phase 3 spec. PS spends produce two ledger rows: one in `partyPoliticalStrengthLedger` for the PS debit, and one in `orgRegLedger` for the resulting Org / Reg / Support delta the spend produced. Cross-reference via `turn` + `actorId` if needed.
- **Action queue / reservation lifecycle** - actions queued but not yet applied are tracked elsewhere (Phase 3 design); only the realized delta lands here.
- **Election seat changes** - vote counts and seat allocation live in election-specific collections, not this ledger.

### 5.7 What this section answers

- ✅ Plan Phase 0.5 deliverable #9 (orgRegLedger telemetry collection, schema, indexes, writer contract, retention)
- ✅ Plan acceptance: telemetry exists for the new economy so balance can be debugged before players notice

---

## 6. Default-party defenses

### 6.1 Goal

Prevent a focused player from hollowing out an unmanned default party in its stronghold without resistance. This is the structural anti-grief / anti-decay-spiral mechanism that lets stronghold states stay strong for a default party even if no player is actively running it.

### 6.2 Constants file

> **Post-implementation correction (2026-08-11):** `DEFENSE_ORG_FLOOR` is now **inert**. Per the 2026-05-20 cap-cleanup pass in `src/lib/turn/partyOrg/defenseConstants.ts`, no per-party Org floor is enforced at runtime, so any party can be chipped from any Org level down to 0 via the Build Org rival-poach. The tier bands and helper functions below still exist in code as scaffolding for analytics and possible future re-introduction, but nothing on the action paths reads `DEFENSE_ORG_FLOOR`. The pool-sum invariant and the 0-clamp at action time are the only structural ceilings left. `DEFENSE_UNMANNED_CAPTURE_MULTIPLIER` and `resolveHomeDefaultParty()` / `isUnmannedDefault()` are still live code, but §6.3's floor-clamp row no longer applies.

**Why a new file rather than extending `src/lib/turn/partyOrg/constants.ts`:** the existing `constants.ts` holds organization cap-contribution weights and momentum constants (load-bearing for the existing turn pipeline). Defense constants are a separate concern - anti-decay-spiral protection - with their own helper functions. Keeping them in a sibling file makes the rule discoverable when a future engineer searches for "defense" or "floor" in `partyOrg/` and prevents accidental coupling with the cap-contribution math.

```ts
// src/lib/turn/partyOrg/defenseConstants.ts (new file)
import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";

/** Tier classification of a state by the home-default party's Org%. */
export type DefenseTier = "strong" | "solid" | "lean" | "competitive";

/**
 * Tier-scaled minimum Org% floor for the home default party in a state.
 * The home default party's `StatePartyOrg.organization` cannot be reduced
 * below this floor by external action (Org capture, contest, etc.).
 *
 * Passive collapse from no-presence is still allowed - the floor protects
 * against active attack, not against the party itself withering.
 *
 * Bands tuned to match the US lane-template Org numbers exactly:
 *   Strong D / R: home-party Org = 36 → floor 18
 *   Solid D / R:  home-party Org = 34 → floor 14
 *   Lean D / R:   home-party Org = 31 → floor 10
 *   Competitive:  home-party Org = 29 → floor 0
 */
export const DEFENSE_ORG_FLOOR: Record<DefenseTier, number> = {
  strong: 18,
  solid: 14,
  lean: 10,
  competitive: 0,
} as const;

/**
 * Capture-rate multiplier applied to rival actions when the targeted
 * default party has no active human chair. Restored to 1.0 once a human
 * chair is seated.
 *
 * Applies to Org capture, Reg poach, GOTV, Suppression - every external
 * action whose primary effect is reducing the targeted party's metrics.
 * Does NOT apply to non-targeted effects (e.g. when a party builds Org
 * for itself by pulling from `Unaffiliated Org`, the unmanned-default
 * cap is not engaged because no rival party is being attacked).
 */
export const DEFENSE_UNMANNED_CAPTURE_MULTIPLIER = 0.5 as const;

/**
 * Derive the defense tier for a state from the home default party's Org%.
 * Bands are inclusive on the lower bound, exclusive on the upper bound,
 * so the boundary numbers (28, 32, 36) belong to the higher tier each
 * (Lean ≥ 28, Solid ≥ 32, Strong ≥ 36).
 */
export function deriveDefenseTier(homeDefaultOrgPct: number): DefenseTier {
  if (homeDefaultOrgPct >= 36) return "strong";
  if (homeDefaultOrgPct >= 32) return "solid";
  if (homeDefaultOrgPct >= 28) return "lean";
  return "competitive";
}

/**
 * Resolve the home default party for a state. Returns the highest-Org
 * party in that state with `politicalParties.isDefault === true`, or
 * `null` if no default party has any presence in this state.
 *
 * In countries where multiple default parties exist (UK Lab + Con; DE
 * SPD + CDU/CSU + Greens + FDP; JP LDP + opposition), this picks
 * whichever default has the highest Org% in this specific state.
 *
 * Tie-breaking: when two default parties have identical Org% (rare),
 * picks alphabetically lowest `partyId` for determinism. The choice is
 * arbitrary by design - ties are unlikely to persist for more than a
 * turn or two given any movement in the system.
 *
 * Non-default parties (regional like SNP / Plaid, or third parties)
 * never qualify as home default regardless of Org%.
 */
export function resolveHomeDefaultParty(
  parties: PoliticalParty[],
  rows: StatePartyOrg[]
): { partyId: string; orgPct: number } | null {
  // partyId on StatePartyOrg rows is the party's `sequentialId` cast to string,
  // not `_id` (matches the codebase pattern in `getRegionPartyOrg` /
  // `getRegionOfficials`; same fix applied in Phase 1 Pass 1).
  const defaults = new Set(parties.filter((p) => p.isDefault).map((p) => String(p.sequentialId)));
  let best: { partyId: string; orgPct: number } | null = null;
  for (const r of rows) {
    if (!defaults.has(r.partyId)) continue;
    const orgPct = r.organization ?? 0;
    if (
      best === null ||
      orgPct > best.orgPct ||
      (orgPct === best.orgPct && r.partyId < best.partyId)
    ) {
      best = { partyId: r.partyId, orgPct };
    }
  }
  return best;
}

/**
 * Convenience: resolve tier + floor in one call.
 */
export function resolveDefenseFloor(
  parties: PoliticalParty[],
  rows: StatePartyOrg[]
): { partyId: string; tier: DefenseTier; floor: number } | null {
  const home = resolveHomeDefaultParty(parties, rows);
  if (home === null) return null;
  const tier = deriveDefenseTier(home.orgPct);
  return { partyId: home.partyId, tier, floor: DEFENSE_ORG_FLOOR[tier] };
}

/**
 * Predicate: is the targeted party an unmanned default?
 *
 * "Unmanned" means the party's chair seat does not currently hold an
 * **active human player**. Specifically:
 *   - chairId === null (vacant seat) → unmanned
 *   - chairId points to an NPP (npps collection) → unmanned
 *   - chairId points to a Character whose userId belongs to a banned
 *     or inactive user → unmanned
 *   - chairId points to a Character whose userId is an active human
 *     player → MANNED (cap does not apply)
 *
 * The `isActiveHumanChair` callback abstracts the chairId → user lookup
 * so this constants module doesn't depend on the NPP / Character / User
 * collection access pattern. The expected implementation:
 *
 *   async function isActiveHumanChair(chairId: ObjectId | null): Promise<boolean> {
 *     if (chairId === null) return false;
 *     const character = await db.collection<Character>("characters").findOne({ _id: chairId });
 *     if (!character?.userId) return false;
 *     const user = await db.collection<User>("users").findOne({ _id: character.userId });
 *     return user != null && !user.isBanned && /* active criteria * /;
 *   }
 *
 * Phase 3 wires this in; this constants file just declares the contract.
 */
export async function isUnmannedDefault(
  party: PoliticalParty,
  isActiveHumanChair: (chairId: PoliticalParty["chairId"]) => Promise<boolean>
): Promise<boolean> {
  if (!party.isDefault) return false;
  return !(await isActiveHumanChair(party.chairId));
}
```

### 6.3 Where each constant is consumed

| Mechanic                                                                                  | Consumes                                                                                                                                                                                             | Phase              |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Org capture (rival party reducing the home default's Org via Boost / Contest)             | `resolveDefenseFloor()` - refuse to apply the capture if it would drop home default below the floor; clamp the delta.                                                                                | Phase 3            |
| Reg poach (rival party stealing Reg from the home default via the Phase 3 contest action) | `isUnmannedDefault()` × `DEFENSE_UNMANNED_CAPTURE_MULTIPLIER` - applied as a yield reduction on the poach delta.                                                                                     | Phase 3            |
| GOTV (boosting own party turnout)                                                         | Floor and unmanned cap **do not apply** - GOTV adds, doesn't subtract from another party.                                                                                                            | Phase 2            |
| Suppression (reducing rival turnout)                                                      | `isUnmannedDefault()` × cap multiplier on the targeting effect.                                                                                                                                      | Phase 2            |
| Bootstrap seed                                                                            | Does not consume defenses (seeds the initial values directly).                                                                                                                                       | Phase 1            |
| Phase 1 Overview UI                                                                       | Consumes `resolveDefenseFloor()` only for tooltip / informational display ("This state's GOP has a 14% floor as Solid R") if the design wants to surface it. Otherwise no UI consumption in Phase 1. | Phase 1 (optional) |

### 6.4 Why these bands

The bands match the US lane-template Org numbers exactly, by design:

| Lane         | DEM / GOP home-party Org | Tier (derived) | Floor |
| ------------ | ------------------------ | -------------- | ----- |
| Strong D / R | 36                       | strong         | 18    |
| Solid D / R  | 34                       | solid          | 14    |
| Lean D / R   | 31                       | lean           | 10    |
| Competitive  | 29 / 28                  | competitive    | 0     |

- The floor sits below the seed Org for each protected tier (Strong 36 → 18, Solid 34 → 14, Lean 31 → 10). Strong is exactly half-Org; Solid and Lean are tuned tighter than half so contesting them remains rewarding while still preventing total hollowing. The intent: a focused player can move home-default Org down by a meaningful amount from the seed by sustained external action, but below the floor, structural advantage takes over.
- Competitive tier has a `0` floor on purpose: those states are meant to be genuinely contestable, including for the home default. No structural advantage applies.
- Non-default parties never receive a floor regardless of Org%. Regional parties (SNP, Plaid, Bayern CSU vs. nationwide CDU) and third parties build and lose by their own dynamics.

### 6.5 Tunability

These constants are committed at Phase 0.5 and intended to ship through Phase 3 unchanged. Tuning happens in the Balance Appendix of the plan, not by editing these constants ad-hoc. If a Phase 3 playtest shows the floors are too aggressive (e.g. Strong floors are unbreakable in practice) or too soft (e.g. Solid hollowing is still trivial), the appendix records the intended tune and a separate commit updates this constants file with a paired ADR-style note in the migration sketch.

### 6.6 What this section answers

- ✅ Plan Phase 0.5 deliverable #8 (default-party passive defense - both tier-scaled floor and unmanned capture-rate cap, expressed as constants, not "tunable")
- ✅ Plan acceptance: "the default-party defense numbers committed as constants, not tunable"

---

## 7. PS / Org / Reg / Support interactions + election formula contracts

### 7.1 4×4 interaction matrix

Each cell describes "what does the row metric do to the column metric." Cells are read row-on-column: `PS → Org` means "what PS does to Org."

|             | → PS                                                       | → Org                                                                                                                                                                  | → Reg                                                                                                            | → Support                                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PS**      | passive `+1/turn` trickle + treasury-driven gain (Phase 3) | spent on `Boost Organization` action → captures from `Unaffiliated Org` first, then rivals                                                                             | spent on `Registration Drive` (vs Unregistered) / `Persuasion` (vs Independent) / `Contest` (vs rival party Reg) | spent on `Rally`, `Ad Buy`, `Endorse` etc. → boosts targeted candidate's `electionCandidates.support`                                                                                                       |
| **Org**     | none                                                       | passive `-0.125 / turn` decay back to the state's Unaffiliated pool (as designed; live Org is a unit bucket that decays 1% per turn after 96 idle turns, see `src/lib/constants/partyOrg.ts`); growth via PS-spend Build Org / Contest at request time (state-wide pool sum is the only ceiling) | drives passive `Org → Reg` drift at `0.075% / turn` (`PASSIVE_REG_DRIFT_RATE`, `src/lib/turn/partyOrg/pacingConstants.ts`), one-directional (up only) toward this party's own Org level (§4.2 + §8 step 3; see post-implementation correction below §8.1)          | none directly - Org drives turnout in formulas (§7.3) which influences who shows up to vote, not candidate Support                                                                                          |
| **Reg**     | none                                                       | none directly                                                                                                                                                          | passive decay at `0.004% / turn` routed via 10% Org eligibility rule (§8 step 4)                                 | none directly. Reg gates _how Support translates to votes_ via the §7.3.1 primary formula contract (high party Reg → larger pool that Support carves up) - but Reg does not modify the Support value itself |
| **Support** | none                                                       | none                                                                                                                                                                   | none directly                                                                                                    | per-turn decay during `Election.status === "active"` (rate locked in §8); Support actions add positive deltas, scandals add negative deltas (clamped at 0)                                                  |

**Design note on what's deliberately empty:**

- `Org → Support` is empty: organization machinery doesn't directly create candidate mood. Org affects turnout (the size of the vote), not enthusiasm for a specific candidate.
- `Reg → Org`, `Reg → Support` direct cells are empty: Reg is a slow partisan baseline; it doesn't push Org or Support around. Reg's effect on outcomes is via the formula contracts (§7.3).
- `Support → *` is empty except the diagonal: Support is a mood layer, not a generator of structural advantage.

This deliberate sparsity is the design's anti-snowball property: PS is the only mover, everything else is downstream. Players spend PS to push Org / Reg / Support; the four metrics don't cross-feed each other in self-amplifying loops.

### 7.2 Unaffiliated Org capture rule (Phase 3 implements)

The following is **pseudocode** sketching the contract. Phase 3 picks real helper names and exact loop structure. The required behavior:

```
// Pseudocode, not real TypeScript.
// Inputs in scope: `action: { targetPartyId, orgDelta }`,
//                  `rows: StatePartyOrg[]` for this state,
//                  `parties: PoliticalParty[]` for this country,
//                  `targetParty = rows.find(r => r.partyId === action.targetPartyId)`
//                  `isActiveHumanChair: (chairId) => Promise<boolean>` (per §6.2)

let stateUnaffiliated = computeUnaffiliatedOrg(rows);  // = 100 - Σ organization
let capture = action.orgDelta;                          // e.g. +1.0%

if (stateUnaffiliated >= capture) {
  // Pull entirely from Unaffiliated Org
  // No rival party's Org is reduced.
  applyDelta(targetParty, +capture);
  // Unaffiliated Org reduces by `capture` automatically (it's derived).
} else {
  // Pull what's available from Unaffiliated Org first
  applyDelta(targetParty, +stateUnaffiliated);
  let remainder = capture - stateUnaffiliated;
  // Then pull proportionally from rival parties' shares
  let rivals = rows.filter(r => r.partyId !== targetParty.partyId);
  let rivalSum = rivals.reduce((s, r) => s + r.organization, 0);
  for (const r of rivals) {
    let proportion = r.organization / rivalSum;
    let rivalDelta = -(remainder * proportion);
    // Apply unmanned-default capture multiplier first IF this rival is the
    // home default of this state and is unmanned (per §6.2 isUnmannedDefault).
    // resolveHomeDefaultParty() returns { partyId, orgPct } | null; compare
    // partyId against r.partyId to decide if this rival is the home default.
    // The PoliticalParty row for the rival is looked up by partyId so
    // isUnmannedDefault can read its chairId.
    const home = resolveHomeDefaultParty(parties, rows);
    const rivalParty = parties.find(p => String(p._id) === r.partyId);
    if (
      home?.partyId === r.partyId
      && rivalParty != null
      && await isUnmannedDefault(rivalParty, isActiveHumanChair)
    ) {
      rivalDelta *= DEFENSE_UNMANNED_CAPTURE_MULTIPLIER;
    }
    // Then clamp at the floor for home defaults - refuse the part of the
    // delta that would breach the floor; reduce action's overall
    // effectiveness rather than partially attacking.
    let postClampDelta = clampToFloor(r, rivalDelta);
    applyDelta(r, postClampDelta);
  }
}
```

**Operation order is fixed:** unmanned-cap multiplier first, then floor clamp. Order matters in edge cases where the post-cap delta would still breach the floor; the spec'd order (`unmannedCapMultiplier → floorClamp`) ensures the cap and the floor compose predictably.

**Side-effect of clamping:** if rival parties together absorb less than `remainder` due to floor clamps (e.g. all rivals are home defaults at floor), the leftover capture amount is **dropped** - the action under-delivers but doesn't error. The ledger logs the actual movement, not the intended movement.

### 7.3 Election formula contracts

Three layers, three jobs:

| Metric    | Job                                                                                                                                                                                  | Where consumed                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `Org%`    | **mobilization / turnout / machine efficiency** - multiplier on baseline turnout in general-election math                                                                            | general election vote accumulation (Phase 5); `partyOrg/electionIntegration.ts` already contributes here today |
| `Reg%`    | **partisan baseline / capturable primary electorate / persuasion resistance** - defines the "reachable pool" for the party in primaries; in generals, baseline persuasion-resistance | primary resolution (Phase 4 wires); general-election persuasion model (Phase 5)                                |
| `Support` | **short-term candidate mood / momentum** - modifier on per-candidate vote share within the party's `Reg%` capturable pool in primaries; candidate-level bonus / penalty in generals  | primary resolution (Phase 4); general-election candidate-level overlays (Phase 5)                              |

#### 7.3.1 Primary formula contract

For a primary in state `S` with party `P` and candidates `C ∈ P.candidates`:

```
total reachable pool       = StatePartyOrg.registration[S][P]      // % of state pop
each candidate's raw share = candidate.support × demographicAffinity × influence × archetypeFit
each candidate's pool share = (raw / Σ raw) × total reachable pool
each candidate's vote share = pool share / total turnout in state  // for display
delegates / seats           = round per the existing primaryAllocation method (PR / WTA)
```

This preserves the existing `primaryResolution.ts` score-oriented structure (favorability, influence, alignment all still meaningful) but **gates the ceiling at `Reg%`** - a candidate cannot pull votes from outside their party's capturable pool in a primary. Phase 4 wires this; Phase 0.5 commits the contract.

**Where `demographicAffinity`, `influence`, and `archetypeFit` come from:** the existing `primaryResolution.ts` and adjacent files (`demographicAppeal.ts`, candidate enrichment) already compute these from existing character / NPP attributes. This contract does not re-derive them - Phase 4 wires `candidate.support` as a new factor in the existing score pipeline.

**Backfill behavior for in-flight cycles:** `electionCandidates` rows from cycles in flight at the moment Phase 4 deploys may not have `support` set. Phase 4 chooses one of: (a) backfill `support` to the per-race-family default constant for all in-flight rows during deploy, (b) ship Phase 4 only between cycles so no in-flight rows exist, or (c) accept zero Support for in-flight rows and let new entries get the default. Phase 4 documents the choice in `### Phase 4 - Decisions Recorded During Execution`.

**Edge cases the Phase 4 implementation must handle:**

- **Σ raw = 0 (every candidate has score 0).** Fall back to even split: each candidate gets `pool share = total reachable pool / candidates.length`. Document the choice in `### Phase 4 - Decisions Recorded During Execution`.
- **`StatePartyOrg.registration` undefined or 0 for this party.** No primary runs for that party in that state - the candidates' rows resolve with `0` votes. If this happens for a major default party, escalate (the seed run failed); for a third party with no Reg footprint, this is normal and expected.
- **Candidate count = 0.** No primary to resolve - short-circuit before reaching this contract.

#### 7.3.2 General-election formula contract

For a general election in state `S` with parties `P_1..P_n`:

```
// Each party's nominal vote share before persuasion swings:
nominal_share(P_i) = StatePartyOrg.organization[S][P_i] × turnoutBaseline × govModifier(if any)
                     × candidate_support_factor(P_i)

// Persuasion swings: every other party can try to peel some of P_i's nominal share away.
// Higher P_i.Reg% defends against peeling (resistance); higher peeler.Reg% sources less
// per-state Reg movement (already entrenched).
swing_from_Reg(P_i → P_j) = transferable_share(P_i.Reg%) × persuasion_drivers(P_j vs P_i)
                            × (1 - persuasionResistance(P_i.Reg%))

// P_i's final share is its nominal share minus what it loses to peelers, plus what it
// gains by peeling from others.
final_share(P_i) = nominal_share(P_i)
                   - Σ_j swing_from_Reg(P_i → P_j)
                   + Σ_j swing_from_Reg(P_j → P_i)

winner = top final_share, per existing electionResolution.ts logic
```

Where:

- `turnoutBaseline` is the existing baseline (per `demographicTurnoutCalculations.ts`), unchanged by this rework.
- `govModifier` is from `getRegionalExecutive()` (US/DE only per Gate 0); `1.0` elsewhere.
- `candidate_support_factor(P_i)` aggregates over the party's candidates in the race. For single-seat / FPTP races (US Senate, UK Commons constituency, US Governor) this is just the one candidate's Support. For proportional / list races (JP shugiin proportional, DE Bundestag list) this is the seat-weighted aggregate of the party's listed candidates. Phase 5 picks the exact aggregator per race family.
- `persuasionResistance(Reg%)` is monotonic in `Reg%` - higher own `Reg%` = harder to peel away. Bounds: `0..1`. Exact curve calibrated in Phase 5.
- `transferable_share(Reg%)` is the maximum share of a party's nominal vote that can be peeled by persuasion in one election. Bounds: `0..1`. Higher own `Reg%` → larger absolute pool but smaller transferable fraction (entrenched voters resist). Exact curve calibrated in Phase 5.

This corrects the previous formula sketch which incorrectly multiplied `persuasionResistance` into the _mobilized vote_ line - that would have inverted the intended effect (high Reg reducing own vote). Resistance applies only to persuasion swings.

Phase 5 implements this and updates every general-election family's vote-accumulation code. Phase 0.5 commits the contract that all families consume `Org%` for mobilization, `Reg%` for baseline + resistance, and `Support` for candidate-level mood.

#### 7.3.3 Race families: spec'd contract (verification due in Phase 4 / 5 / 5.5)

This table records what each race family is **spec'd to consume** under this design. Phase 4 / 5 / 5.5 each verify their families against the actual `electionResolution.ts` and `primaryResolution.ts` dispatchers via the race-domain audit template (plan section). Verification populates the actual matrix in those phases' `### Phase N - Decisions Recorded During Execution` sections; cells below that don't verify are downgraded to `placeholder` (or `no` if structurally impossible) in the phase matrix and a note explains why.

| Race family                          | Spec'd to consume `Org%`?   | Spec'd to consume `Reg%`?                                                                           | Spec'd to consume `Support`? |
| ------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------- |
| US presidential primary              | yes (state primary turnout) | yes (capturable pool)                                                                               | yes (candidate mood)         |
| US senate primary                    | yes                         | yes                                                                                                 | yes                          |
| US house primary (where competitive) | yes                         | yes                                                                                                 | yes                          |
| US governor primary                  | yes                         | yes                                                                                                 | yes                          |
| US presidential general              | yes                         | yes (persuasion)                                                                                    | yes                          |
| US senate general                    | yes                         | yes                                                                                                 | yes                          |
| US house / state senate general      | yes                         | yes                                                                                                 | yes                          |
| US governor general                  | yes                         | yes                                                                                                 | yes                          |
| UK commons general                   | yes                         | yes                                                                                                 | yes                          |
| UK regional council general          | yes                         | yes                                                                                                 | yes                          |
| JP shugiin / sangiin general         | yes                         | yes (persuasion only - proportional math may not use per-state Org the same way; verify in Phase 5) | yes                          |
| DE bundestag general                 | yes                         | yes                                                                                                 | yes                          |

The "spec'd" framing is intentional: this design doc commits the contract; verification is the next phase's job. A row marked `yes` here is an instruction to Phase 4/5/5.5, not a claim that the code already does it.

### 7.4 What this section answers

- ✅ Plan Phase 0.5 deliverable #5 (PS interacts with Support and Org via direct spend; Support and Reg via direct spend on Phase 3 actions; no auto-cross-feeds)
- ✅ Plan §18 election-formula-contracts (Org = mobilization, Reg = partisan baseline, Support = mood)
- ✅ Plan §19 primary formula contract
- ✅ Plan acceptance: "the plan records how normalized Org pool share is consumed in general-election math across every supported race family" - yes, §7.3.3

---

## 8. Pacing & turn-order contract

### 8.1 Pacing constants

> **Post-implementation correction (2026-08-11):** the block below is the original Phase 0.5 sketch and is stale on two points. The live `src/lib/turn/partyOrg/pacingConstants.ts` sets `PASSIVE_REG_DRIFT_RATE = 0.075` (bumped from `0.04` on 2026-06-21 after the active Registration Drive action was reverted, so Build Org auto-drift is the only Reg-growth lever). Drift is also **one-directional (up only)** as of 2026-07-28: Reg only rises toward the party's Org level and never drifts down; downward pressure comes solely from `PASSIVE_REG_DECAY_RATE`. This was a fix for the Solid South's seeded 85-90% Democratic registration getting eroded by bidirectional drift over ~800 turns. `REG_LAG_BELOW_ORG_PCT_BY_COUNTRY` (referenced in §8.2 below) was also decoupled to an empty map on 2026-06-18, so Reg now targets Org directly with no per-country lag, though the map is retained as a tunable. `PASSIVE_REG_DECAY_RATE`, `REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT`, `NON_PARTY_BUCKET_INDEPENDENT_BIAS`, and `STRONGHOLD_FALL_TIME_TURNS_TARGET` below still match the live code.

```ts
// src/lib/turn/partyOrg/pacingConstants.ts (new file, sibling to defenseConstants.ts)

/**
 * Passive Reg% drift per turn toward each party's own Org% baseline.
 * Higher Org → Reg trends up; lower Org → Reg trends down toward Org level.
 * Direction is per-party-per-state - this is NOT a single-direction drift.
 *
 * Bounds: percent points per hourly turn.
 * Source: plan-locked assumption from user direction (2026-05-03).
 */
export const PASSIVE_REG_DRIFT_RATE = 0.04 as const; // superseded: live value is 0.075, one-directional (up only); see correction note above

/**
 * Passive Reg% decay / erosion per turn. Independent of drift - Reg loses
 * a small amount each turn unless actively maintained, regardless of where
 * Org sits. Routes via the 10% Org eligibility rule (§8.3 step 4) to other
 * parties or non-party buckets.
 *
 * Bounds: percent points per hourly turn.
 * Source: plan-locked assumption from user direction (2026-05-03).
 */
export const PASSIVE_REG_DECAY_RATE = 0.004 as const;

/**
 * Eligibility threshold for a party to "catch" drifted Reg.
 * Parties below this Org% in a state cannot absorb Reg from drift / decay
 * routing - the displaced share routes to non-party buckets instead
 * (Independent first, then Unregistered, with bias toward Independent).
 */
export const REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT = 10 as const;

/**
 * Independent vs Unregistered routing bias when displaced Reg goes to
 * non-party buckets. Higher = more goes to Independent. 1.0 = even split.
 */
export const NON_PARTY_BUCKET_INDEPENDENT_BIAS = 1.5 as const;

/**
 * Soft pacing target (NOT consumed by mutation logic - documentation
 * only). Expected number of hourly turns for a Strong stronghold to be
 * moved to a Lean tier by sustained external attack. Calibrated in the
 * Balance Appendix and Phase 3 PS walkthrough; exported here so
 * playtest tooling has a single canonical reference.
 *
 * Range: ~150-300 turns (about a week to two weeks of sustained
 * coordinated effort against an unmanned default).
 */
export const STRONGHOLD_FALL_TIME_TURNS_TARGET = 200 as const;
```

These constants live in a new file `src/lib/turn/partyOrg/pacingConstants.ts`, sibling to `defenseConstants.ts`. Phase 1+ imports them. Phase 3 (PS rework) and Phase 5 (general-election formulas) read them. The plan's Balance Appendix (Phase 3) records calibration changes.

### 8.2 Why these rates

> **Post-implementation correction (2026-08-11):** the "bidirectional drift with a per-country lag" design below is what Phase 0.5 committed to, but it is not what shipped. Drift is one-directional (up only, 2026-07-28) and `REG_LAG_BELOW_ORG_PCT_BY_COUNTRY` ships empty (decoupled 2026-06-18), so Reg targets Org directly with no lag. Downward Reg movement now comes only from `PASSIVE_REG_DECAY_RATE`. The paragraphs below are kept for historical context on the original reasoning; treat the rates as illustrative, not current.

- **Drift > Decay (10×), historically bidirectional.** The original design had drift move Reg toward each party's lagged Org target (`max(0, Org − REG_LAG_BELOW_ORG_PCT_BY_COUNTRY[country])`), raising Reg when the target was above current Reg and lowering it when below. The 10× ratio meant a party that maintains Org converges its Reg back to the lagged target meaningfully faster than baseline erosion bleeds it.
- **Reg lags Org by a country-specific gap, no longer applied.** Real-world friction - not every voter the party reaches actually registers with that party. The gap reflected each country's registration culture: US 5pp (strong "Independent" identity, 40%+ of voters self-ID as independent), UK 4pp (less Independent framing), JP 8pp (mushikutei dominance, weak party ID), DE 3pp (Stammwähler tradition, list-based system). The map now ships empty (0pp lag for every country); Reg targets Org exactly. Floor: target = `max(0, Org − lag)` so tiny-Org parties don't target negative Reg.
- **Both rates are very small per turn.** At the live `0.075% / turn` one-directional drift toward Org, moving Reg by 1 percentage point takes about 13 turns (~13 hours) of pure drift; moving it by 10 points takes about 133 turns (~5.5 days). Active actions (poach) speed this up; passive movement alone is a slow background pressure.
- **Decay routing through 10% Org eligibility** prevents tiny-presence parties from absorbing every other party's losses (which would create snowballing). It also routes naturally toward non-party buckets when no party has structural footprint. The Independent / Unregistered split is country-specific (`NON_PARTY_BUCKET_INDEPENDENT_BIAS_BY_COUNTRY`): US 70/30, UK 50/50, JP 60/40, DE 30/70 - matching each country's non-party identity culture.

### 8.3 Politics turn-order contract

The politics-phase processor runs each hour in this order:

| Step | Phase                              | Writes to                                                                                                                                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Explicit party actions / PS spends | `Party.politicalStrength`, `StatePartyOrg.politicalStrength`, `StatePartyOrg.registration`, `electionCandidates.support`, `orgRegLedger`, `partyPoliticalStrengthLedger` (and queues Org-capture intents for step 2) | Player and chair-initiated actions queued during the previous turn boundary. **Direct-write actions** (Registration Drive, Persuasion, Contest, Rally, Ad Buy, Endorse, etc.) mutate their target field in step 1. **Org-capture actions** (Boost Organization, Establish Presence) are _queued_ in step 1 with their intent and applied in step 2 with the §7.2 Unaffiliated-Org-first rule + §6 floor / unmanned-cap composition. **Action affordability (PS reserve sufficient, target legal, cooldown satisfied) is validated at queue time on the API route - the politics phase trusts the queue and does not re-validate.** Any action that fails to apply during the phase (e.g. target row deleted between queue and dispatch) is logged with `source: "action"` and `delta: 0`, and a follow-up reconciliation row clears the queued PS reservation. |
| 2    | Org capture / Org loss updates     | `StatePartyOrg.organization`, `orgRegLedger`                                                                                                                                                                         | Applies step 1's queued Org-capture intents through the `Unaffiliated Org` capture rule (§7.2), with floor clamps + unmanned-cap composition (§6). Also handles cap-contribution growth/decay from elected seat counts (existing `partyOrg/calculations.ts`). This is the only step that writes `StatePartyOrg.organization` during the politics phase.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3    | Passive `Org → Reg` drift          | `StatePartyOrg.registration`, `StateRegistrationPool.{independent,unregistered}`, `orgRegLedger`                                                                                                                     | Each party's Reg drifts up toward its own Org level by `PASSIVE_REG_DRIFT_RATE` (live value `0.075`, one-directional up-only; see §8.1 correction note). Net effect on the state: Reg redistributes toward the party-Org distribution; non-party buckets absorb residuals via the routing rules. Drift applies regardless of Org level (§4.2.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4    | Passive Reg decay / rerouting      | `StatePartyOrg.registration`, `StateRegistrationPool.{independent,unregistered}`, `orgRegLedger`                                                                                                                     | Each party loses `PASSIVE_REG_DECAY_RATE` per turn. Lost Reg routes to eligible parties (≥ `REG_DRIFT_CATCH_ELIGIBILITY_ORG_PCT`% Org) via `sqrt(Org%)` weighted distribution; if no eligible party exists, routes to non-party buckets with `NON_PARTY_BUCKET_INDEPENDENT_BIAS` favoring Independent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5    | Support update / decay             | `electionCandidates.support`, `Party.support`, `StatePartyOrg.support`, `orgRegLedger` (with `metric: "support"`)                                                                                                    | Candidate Support decays per turn during `Election.status === "active"`. Decay rate is **TBD at Phase 4 kickoff** - Phase 0.5 commits the directional target only: from a typical entry value, an unaltered candidate's Support should decay to roughly half over ~2 IRL days (48 turns). The exact per-turn rate (likely a multiplicative decay factor, e.g. `support × 0.985^turn`) is calibrated in Phase 4. Then the derivation processor (§3.2) writes `Party.support` and `StatePartyOrg.support` rollups.                                                                                                                                                                                                                                                                                                                                               |
| 6    | Election vote accumulation         | various election collections                                                                                                                                                                                         | Existing logic. Reads `Org%` for mobilization, `Reg%` for capturable pool, `Support` for candidate mood per the formula contracts (§7.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7    | Election resolution                | `electionCandidates.support` (cleared), various election collections                                                                                                                                                 | Existing `electionResolution.ts` and `primaryResolution.ts` with the new metrics integrated. Resolution clears `electionCandidates.support` for the resolved election.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### 8.4 Step ordering invariants

The order is not arbitrary. Several invariants depend on it:

- **Step 1 before step 2:** step 1 queues Org-capture intents (and direct-writes for Reg / Support / PS actions); step 2 then applies the queued Org intents through the Unaffiliated-Org capture rule. Reversing would mean step 2 has nothing to consume.
- **Step 2 before steps 3-4:** Org updates settle before drift / decay reads `Org%`. Otherwise drift would read stale Org.
- **Step 3 before step 4:** drift moves Reg toward Org first; decay then erodes a small amount on top. Reversing would produce wrong totals because decay would erode pre-drift values.
- **Steps 3-4 before step 5:** Support is a fast layer; running it before the slow Reg layer would mean Support decay competes with Reg drift for ledger ordering. Slow first, fast after.
- **Step 5 before steps 6-7:** Support changes apply to the same turn's election math. Otherwise election day decisions would lag a turn behind candidate Support.
- **Step 6 before step 7:** vote accumulation must complete before resolution reads the totals.

Phase 3 implements the ordering; this design doc commits the contract.

### 8.5 Ledger writes per step

Each politics-phase step that mutates Org / Reg / Support / pool buckets emits ledger rows per the writer contract in §5.4. Step-level summary:

| Step | Typical ledger source value(s)                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `action`, `poach`, `supportAction` (Reg / Support / PS actions only - Org-capture actions queue without emitting a ledger row at this step)       |
| 2    | `action` (emitted when applying queued Org-capture intents through §7.2), `partyCollapse` (if a row deletes), `renormalize` (if invariant breaks) |
| 3    | `drift`                                                                                                                                           |
| 4    | `decay`                                                                                                                                           |
| 5    | `supportDecay` (`supportAction` lives in step 1, not step 5)                                                                                      |
| 6-7  | none typically - resolution may emit `migration` if it migrates a candidate's last Support to a permanent record before clearing                  |

### 8.6 What this section answers

- ✅ Plan Phase 0.5 deliverable #6 (pacing expectations: Org slow, Reg slower, passive drift gentle, default-party inertia)
- ✅ Plan §3-4 Recommended default mechanics - passive drift / decay rates committed as constants
- ✅ Plan §8 turn-order contract - committed as code-shape table with invariants
- ✅ Plan acceptance: "the plan records the intended pacing: Org slow, Reg slower" - yes, with rates pinned in §8.1

---

## 9. Migration sketch

### 9.1 What changes shape during Phase 0.5

**Nothing.** Phase 0.5 is design-only - no source files in `src/` are added, modified, or deleted by this phase. All TypeScript shown in this document is **schema sketch**, not actual TypeScript files. The shapes below are commitments that downstream phases implement.

### 9.2 What downstream phases create

A consolidated list of every new field, collection, file, and constant this design implies. Each entry pins which phase owns the implementation; the plan's Phase Map controls the order.

#### New fields on existing types

| Where               | Field          | Type      | Default                       | Phase                                                                                                                                                                                     | Notes |
| ------------------- | -------------- | --------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `StatePartyOrg`     | `registration` | `number?` | seeded via §9.3               | Phase 1 (schema add only); Phase 1.5 / Phase 2 prerequisite (bootstrap backfill); Phase 3 (mutations begin) - split per the plan's `### Phase 1 - Decisions Recorded During Execution` D1 | §4.2  |
| `Party`             | `support`      | `number?` | undefined                     | Phase 5 (derived overlay populates)                                                                                                                                                       | §3.2  |
| `StatePartyOrg`     | `support`      | `number?` | undefined                     | Phase 5 (derived overlay populates)                                                                                                                                                       | §3.2  |
| `ElectionCandidate` | `support`      | `number?` | per-race-family entry default | Phase 4 (write path); Phase 4 + Phase 5 (read paths)                                                                                                                                      | §3.1  |

All four fields are **optional**. Existing rows can lack them without breaking reads; absence is treated as "not yet set" / "not applicable" per the field's documented default behavior.

#### New collections

| Collection              | File                                        | Phase                                                                                                                           | Indexes                               | Notes |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----- |
| `stateRegistrationPool` | `src/lib/db/types/stateRegistrationPool.ts` | Phase 1 (schema only), Phase 1.5 / Phase 2 prerequisite (bootstrap creates docs), Phase 3 (mutations begin) - split per plan D1 | `{ countryId: 1, stateId: 1 }` unique | §4.3  |
| `orgRegLedger`          | `src/lib/db/types/orgRegLedger.ts`          | Phase 1 (schema only), Phase 1.5 / Phase 2 prerequisite (first writes from bootstrap) - split per plan D1                       | 4-index plan §5.3                     | §5    |

#### New helpers / constants files

| File                                        | Phase (defined) | Phase (consumed)                                    | Notes                                                                                                   |
| ------------------------------------------- | --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/lib/turn/partyOrg/defenseConstants.ts` | Phase 3         | Phase 3 (Org / Reg actions, Org capture, Reg poach) | §6. Created when first consumed; the schema sketch in this doc is the code-shape commitment until then. |
| `src/lib/turn/partyOrg/pacingConstants.ts`  | Phase 3         | Phase 3 (drift / decay processors)                  | §8.1. Same convention - created when first consumed.                                                    |
| `src/lib/elections/supportConstants.ts`     | Phase 4         | Phase 4 (candidate-entry path)                      | §3.1                                                                                                    |
| `src/lib/states/regionalExecutive.ts`       | Phase 1         | Phase 1 (consumed by `getStateOverview()`)          | Plan Phase 1                                                                                            |

#### New turn-phase processors

| Processor                    | File                                                      | Phase                                                         | Reads                                                                 | Writes                                                                                        |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Drift / decay processor      | `src/lib/turn/partyOrg/regDriftDecay.ts` (new)            | Phase 3                                                       | `StatePartyOrg.{organization, registration}`, `StateRegistrationPool` | `StatePartyOrg.registration`, `StateRegistrationPool`, `orgRegLedger`                         |
| Support decay processor      | `src/lib/turn/elections/supportDecay.ts` (new)            | Phase 4                                                       | `electionCandidates.support`, `Election.status`                       | `electionCandidates.support`, `orgRegLedger` (`metric: support`)                              |
| Support derivation processor | `src/lib/turn/parties/derivePartySupportRollups.ts` (new) | Phase 5                                                       | `electionCandidates.support`, party / state membership tables         | `Party.support`, `StatePartyOrg.support`                                                      |
| Pool renormalize processor   | `src/lib/turn/partyOrg/validateRegistrationPool.ts` (new) | Phase 1 (validator), Phase 3 (renormalize-on-violation logic) | `StatePartyOrg.registration`, `StateRegistrationPool`                 | `StatePartyOrg.registration`, `StateRegistrationPool`, `orgRegLedger` (`source: renormalize`) |
| Ledger rollup processor      | `src/lib/turn/orgRegLedgerRollup.ts` (new)                | Phase 1 (skeleton), nightly rollup runs from Phase 3 onward   | `orgRegLedger` (detail rows beyond retention)                         | `orgRegLedger` (rollup rows; deletes detail)                                                  |

#### Modified existing turn processors

| Processor                   | File                                           | Phase   | Why                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Party action generation     | `src/lib/turn/partyActionGeneration.ts`        | Phase 3 | Replace flat `+5/turn` with PS reserve generation per plan Phase 3 specs (passive trickle + treasury-driven gain + soft-cap slowdown). Also rename `actionPool → politicalStrength`. |
| Election integration        | `src/lib/turn/partyOrg/electionIntegration.ts` | Phase 5 | Read `Reg%` for capturable pool + persuasion resistance per §7.3 contracts.                                                                                                          |
| Primary resolution          | `src/lib/turn/primaryResolution.ts`            | Phase 4 | Gate candidate share at party `Reg%`; modify by candidate `Support`.                                                                                                                 |
| General-election resolution | `src/lib/turn/electionResolution.ts`           | Phase 5 | Consume `Org%` for mobilization, `Reg%` for persuasion resistance, `Support` for candidate mood.                                                                                     |

### 9.3 Bootstrap data migration

The plan's Bootstrap Seed appendix (Pass 1 lane templates for US + Pass 2 curated assignments for US/UK/JP/DE) gives concrete `Org%` and `Reg%` values per state. Phase 1 implements:

1. **Backfill `StatePartyOrg.registration`** for every existing row using the appendix value for that `(countryId, stateId, partyId)`. Rows without an explicit value (rare third parties not in the appendix) get `0`.
2. **Create `stateRegistrationPool` documents** for every `(countryId, stateId)` using the appendix's `IND` / `UNR` values. Validate the per-state sum equals `100` (within floating-point tolerance) before committing.
3. **Create `orgRegLedger` rows** sourced as `seed` for every backfill - one row per `(state, party, metric)` populated. Single transaction per state, idempotent so the seed run can be re-run safely.

The migration is a one-shot script under `scripts/migrations/2026-XX-XX-seed-registration.mjs` (Phase 1 file).

### 9.4 Existing-data coverage gaps

The bootstrap appendix covers US/UK/JP/DE. The codebase contains seeds for additional countries (`brParties.ts`, `cnParties.ts`, `ieParties.ts`) that are not currently active country simulations. For those:

- `StatePartyOrg` rows exist (or will exist when those countries activate) but `registration` stays `undefined`.
- `stateRegistrationPool` documents are not created until the country's seed run includes the IND/UNR values.
- The Reg/Support model does not engage for that country - primary resolution will fall back to existing pre-rework logic per §7.3.1's "Reg% undefined or 0 for this party" edge case until the country activates.

Activating a new country requires:

1. Adding curated `Org%` and `Reg%` lane / curation tables to the plan's Bootstrap Seed appendix.
2. Running the Phase 1 backfill migration scoped to that country.
3. Phase 5's race-domain audit verifying the new country's race families consume the metrics correctly.

### 9.5 Phase 3 actionPool migration (cross-reference)

The `actionPool → politicalStrength` rename on `Party` and `StatePartyOrg` is **not part of this design doc**. It lives in the plan's Phase 3 schema sketch and uses a separate one-shot migration script. This doc only tracks Reg/Support migration; the Phase 3 PS migration is referenced for context but not duplicated here.

**Reading order during the migration window:** §8.3 step 1 names `Party.politicalStrength` and `StatePartyOrg.politicalStrength` as the field reads. These references describe the **post-Phase-3 state of the field**. During the Phase 1 → Phase 3 transition, code reading those fields must read `actionPool` (the current name) and the rename happens once at Phase 3. Phase 1 and Phase 2 do not depend on PS spends in step 1 (their work is read-only on Reg/Support), so the rename ordering does not block earlier phases.

### 9.6 Bootstrap seed re-run idempotency

The `scripts/migrations/2026-XX-XX-seed-registration.mjs` migration is idempotent: re-running it overwrites `StatePartyOrg.registration`, `stateRegistrationPool.{independent, unregistered}`, and the `seed`-sourced `orgRegLedger` rows with the latest appendix values. This is intentional - when the Bootstrap Seed appendix is updated (e.g. for tuning a country's curated table), re-running the migration applies the new values without manually nulling fields. Each re-run records a fresh `orgRegLedger` row with `source: "seed"` so the change is auditable.

The migration only touches rows whose `(countryId, stateId, partyId)` combination matches an appendix entry; rows for other countries (e.g. BR/CN/IE before they activate) are not modified. This prevents accidental clobbering of in-progress data for countries the appendix doesn't yet cover.

### 9.7 What this section answers

- ✅ Plan Phase 0.5 deliverable acceptance: "a migration sketch if any existing field changes shape" - yes, §9.3 + §9.4 cover the registration backfill; §9.5 cross-references the Phase 3 PS migration without duplicating it
- ✅ Plan Phase 0.5 acceptance: "a TS schema sketch of any new fields added to Party, StatePartyOrg, electionCandidates, or any new collection" - yes, §9.2 lists all of them with phase ownership

---

## 10. Cross-references back to the plan

This design doc is the source of truth for the Reg/Support model. The plan must point here from every clause where the model matters.

### 10.1 Plan sections that should anchor here

| Plan section                                       | Anchor in this doc                                           |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Gate 0 finding #1 (Reg/Support phase boundary)     | §1, §2                                                       |
| Phase 0.5 Recommended default mechanics #1-22      | §3, §4, §6, §7, §8                                           |
| Phase 1 Task 1.0 Step 3 (Reg% source decision)     | §4                                                           |
| Phase 1 Task 1.4 KPI Strip                         | §3.2 (Support overlay), §4.2 (Reg field)                     |
| Phase 1 Task 1.7 wiring (default tab)              | n/a                                                          |
| Phase 2 acceptance (Org sectors, GOTV/Suppression) | §6 (defenses), §7.2 (Org capture rule)                       |
| Phase 3 PS rework - open questions                 | §7.1 (PS interactions), §8 (turn order)                      |
| Phase 4 Primary screen rework                      | §3.1 (Support), §4 (Reg), §7.3.1 (primary contract)          |
| Phase 5 General Election rework                    | §7.3.2 (general contract), §7.3.3 (race families table)      |
| Phase 5.5 Campaign Manager                         | §3.1.1 (lifecycle), §7.3.3                                   |
| Phase 6 Charter                                    | §4.4 (charter ratification creates zero-rows in every state) |
| Bootstrap Seed appendix                            | §4.3, §9.3                                                   |

Phase 1 work (or its kickoff) should sweep the plan and add anchor links to specific subsections of this doc on every bullet point that depends on the model.

### 10.2 Phase 0.5 acceptance checklist

Walking through the plan's Phase 0.5 acceptance criteria, marking each:

- ✅ **No later phase can claim a numeric `Reg%` without pointing back to this phase's model** - §4 defines Reg storage; downstream phases must link.
- ✅ **No later phase can ship `RegistrationLedger` or registration-influence copy if this phase chose `Support only`** - N/A; this phase chose `Reg + Support`.
- ✅ **The plan records whether `Support` is country-agnostic or country-family-specific** - §2 records "country-agnostic shape; consumer formulas / UI may be family-specific."
- ✅ **The plan records how normalized Org pool share is consumed in general-election math across every supported race family** - §7.3.2 + §7.3.3 spec the contract for every supported family with verification handed to Phase 5.
- ✅ **The plan records the registration-pool composition, including whether `Independent` and `Unregistered` are explicit buckets** - §4.1 + §4.3 record both buckets explicitly with TS schema.
- ✅ **The plan records the intended pacing: Org slow, Reg slower** - §8.1 records constants; §8.2 explains why drift > decay × 10.
- ✅ **TS schema sketch of any new fields** - §9.2 lists all four new fields + 2 new collections + 4 new files.
- ✅ **Explicit storage decisions for Support committed as code-shape** - §3.1 + §3.2 give complete TS extension types.
- ✅ **Migration sketch if any existing field changes shape** - §9.3-9.5 cover registration backfill; §9.1 confirms Phase 0.5 itself is design-only.
- ✅ **`orgRegLedger` schema with index plan** - §5.2 + §5.3.
- ✅ **Default-party defense numbers committed as constants** - §6.2 commits `DEFENSE_ORG_FLOOR` record, `DEFENSE_UNMANNED_CAPTURE_MULTIPLIER`, plus the resolver helpers.

All 11 acceptance items satisfied (verified through the final audit cycle below).

### 10.3 What this section answers

- ✅ Plan Phase 0.5 acceptance: "the plan records ..." for each of the 6 prose items
- ✅ Plan kickoff requirements: TS schema sketches, storage decisions, ledger schema, defense constants - all committed as code-shape, not prose

---

## Per-Task Audit Log

After each Phase 0.5 task, an audit pass is recorded here. Format per pass:

```
### Audit after Task N - <date>

**High risk:** ...
**Medium risk:** ...
**Low risk:** ...
**Edge cases:** ...

Findings: <count>. Fixes applied: <summary>.
```

### Audit after Task 0.5.0 - 2026-05-05

**High risk:** none - the section is descriptive only and locks no behavior.

**Medium risk:**

- _M1:_ The "Why not Support only" / "Why not Registration only" justifications cite the chat transcript without an anchor. Future readers won't know which transcript or where to look. **Fix applied:** anchored to the plan's "Design Bundle" reference at line 29 and the chat at the original design brief.

**Low risk:**

- _L1:_ Section 1 lists Brazil/China/Ireland as out-of-scope at Phase 0.5 but doesn't say what triggers their inclusion. **Fix applied:** added a sentence clarifying that "becomes active country simulation" is the trigger.

**Edge cases:**

- _E1:_ The "country-agnostic concepts" claim is true for shape but not necessarily for _whether the metric ships at all_. UK / JP without devolved-executive office types might not surface a `Reg%` UI for some race families. **Fix applied:** added a clarifying sentence under "Country-agnostic vs country-family-specific" - the model shape is country-agnostic; UI surfaces and consumer formulas may be country-family-specific.

**Findings:** 3. **Fixes:** all applied below.

### Audit after Task 0.5.1 - 2026-05-05

**High risk:**

- _H1:_ Lifecycle initially said "cleared at primary resolution" but most non-US races don't have a primary phase - UK Commons / JP shugiin / DE Bundestag candidates appear directly in the general. The lifecycle would have been undefined for those races. **Fix applied:** rewrote §3.1 writer #3 and added §3.1.1 to clarify that lifecycle is keyed off `Election.status` transitions, not "primary resolution" specifically. Resolution clears in both race families uniformly.
- _H2:_ The decay processor was described as running in §8 step 5 without saying what it decays _during_. For an `upcoming` election the candidate row exists but isn't actively campaigned - running decay on those rows would silently drain Support before the election even opens. **Fix applied:** restricted decay to `Election.status === "active"`; off-cycle candidates have `support === undefined` and aren't touched.

**Medium risk:**

- _M1:_ Withdrawal mid-primary: not addressed. Could cause silent data loss when an analyst tries to study why someone withdrew. **Fix applied:** §3.1.1 now states withdrawals do not clear Support; only `resolved` clears.
- _M2:_ Negative Support from scandals: the original write said "Bounds: 0..100" without specifying clamp behavior on negative deltas. **Fix applied:** writer #2 now explicitly clamps negative deltas at `0`.
- _M3:_ The field name `support` collides with an unrelated `support: number` field on `coalitions/priorities.ts` (legislative coalition support). Different collection, different namespace - no actual conflict, but worth noting for searchability. **No fix needed** - the names are unambiguous in context (`electionCandidates.support` vs `coalitionPriorities.support`); flagging here for future readers.

**Low risk:**

- _L1:_ "Per-country / per-race-family default constant" was vague about where the constant lives. **Fix applied:** writer #1 now points to `src/lib/elections/supportConstants.ts` as the future home.

**Edge cases:**

- _E1:_ Presidential primary candidates have separate `electionCandidates` rows per state primary (one row per `(electionId, candidateId)` per the existing schema). Each row carries its own Support - confirmed this fits the design (per-state Support tracking for the same candidate). **No fix; documented for clarity.**
- _E2:_ Endorsement bumps applied off-cycle (between primaries, before a candidate enters the next race) - the writer table allows Support actions to run anytime, but Support only exists on `electionCandidates` rows for active candidacies. Off-cycle endorsements would not write to Support; they'd accrue elsewhere or wait until the next entry. **Resolution: this is correct behavior** - Support is per-election-cycle by design; cross-cycle momentum belongs in a future per-character "narrative" field, not here.

**Findings:** 6 (2 high, 3 medium, 1 low) + 2 edge cases. **Fixes:** 5 applied; 1 medium (M3) flagged as no-action; 2 edge cases resolved without code change.

### Audit after Task 0.5.2 - 2026-05-05

**High risk:**

- _H1:_ The "drifts toward Org baseline" rule didn't say where displaced Reg goes when drift moves a party's Reg toward its own (lower) Org. Could read as "vanishes." **Fix applied:** the field comment now explicitly says displaced Reg routes via the 10% Org eligibility rule per §8.
- _H2:_ The pool-sum invariant only sums correctly if every (state, party) pair has a `StatePartyOrg` row. If third parties have rows only where they have presence, summing returns less than 100. **Fix applied:** §4.4 now requires bootstrap seed (and Phase 6 charter ratification) to create a row for every (state, party) pair in the country, with zero values for absent parties.

**Medium risk:**

- _M1:_ Migration of existing `StatePartyOrg` rows to add `registration: number` not addressed in §4. Will land in §9 (migration sketch). **Deferred to Task 0.5.7.**
- _M2:_ `lastUpdatedTurn` semantics not pinned to existing `gameState.currentTurn`. **Fix applied:** added a comment.
- _M3:_ Renormalization on invariant violation could surface as small unexplained Reg jitter for players. The ledger logs it (auditable), but UX-wise undocumented. **No fix this task** - log via the ledger is the spec; visible-to-player surfacing belongs to Phase 1+ UI work.

**Low risk:**

- _L1:_ `_id` format and index plan stylistic choices align with existing `StatePartyOrg` patterns. **No fix.**

**Edge cases:**

- _E1:_ Passive drift on a party at `Org = 0` and `Reg = 0`: would compute `0.04% × 0 = 0` either way, but writing a zero-delta ledger row would be noise. **Fix applied:** §4.2.1 explicitly states no ledger row is written when both are 0.
- _E2:_ Party-row deletion on third-party collapse: §4.4 invariant would break if a row with non-zero Reg simply vanished. **Fix applied:** §4.2 lifecycle now routes the deleted row's Reg to non-party buckets (Independent → Unregistered) with a `partyCollapse` ledger source.
- _E3:_ Bootstrap seed for `Independent` / `Unregistered`: every plan-curated table already lists these values. **No fix.**

**Findings:** 6 (2 high, 3 medium, 1 low) + 3 edge cases. **Fixes:** 4 applied; 1 medium deferred to §9 (M1); 1 medium and 1 low flagged no-action; 2 edge cases addressed.

### Audit after Task 0.5.3 - 2026-05-05

**High risk:**

- _H1:_ Original §5.4 used `withTransaction()` without acknowledging that MongoDB transactions require a replica set / sharded cluster - single-node dev wouldn't support them, and the writer contract would silently break in dev. **Fix applied:** §5.4 now documents transaction-availability detection, fallback to "update-then-insert" with idempotent updates, and explicit per-processor documentation requirement.

**Medium risk:**

- _M1:_ Magic string `"__pool__"` for pool-scoped ledger rows. **Fix applied:** exported as `POOL_SENTINEL_PARTY_ID` constant; references updated.
- _M2:_ The `migration` ledger source originally said "field rename / backfill events (Phase 3 PS migration, etc.)" - but Phase 3 renames `actionPool` which isn't an org/reg/support metric, so it wouldn't log here. The example was misleading. **Fix applied:** clarified that `migration` source is only for backfills relevant to this ledger's metrics (e.g. Phase 1 backfilling `registration` from the appendix); pure renames of unrelated fields don't log.
- _M3:_ Concurrency between politics-phase processors and live player actions wasn't addressed in §5.4. Without explicit single-threaded policy, last-write-wins races could occur and ledger could log delta-ordering inversions. **Fix applied:** §5.4 now documents the single-threaded politics-phase contract and how player actions queue against the phase boundary.

**Low risk:**

- _L1:_ Index size for `{ source: 1, turn: -1 }` could grow large over many turns. Acceptable for the forensic value. **No fix.**
- _L2:_ `value` field is partially redundant with `prev + delta`. Kept for one-query reconciliation. **No fix.**

**Edge cases:**

- _E1:_ Zero-delta writes: §4.2.1 already says no ledger row when both prev and curr are 0. Confirmed consistent here. **No fix.**
- _E2:_ Bootstrap seed row volume: ~600 rows for US Reg/Org alone is fine, but worth a perf note. **No fix** - within MongoDB's no-blink range.
- _E3:_ Migration source originally suggested it covered actionPool rename. **Already addressed in M2 above.**

**Findings:** 6 (1 high, 3 medium, 2 low) + 3 edge cases. **Fixes:** 4 applied (H1, M1, M2, M3); 2 low + 3 edge cases no-action.

### Audit after Task 0.5.4 - 2026-05-05

**High risk:**

- _H1:_ `isUnmannedDefault()` originally took `isPlayer(userId)` as a synchronous check, but `chairId` points to a `Character` row, not a user, and resolving "is this an active human player" requires DB lookups. The callback signature was misleading. **Fix applied:** changed to `async isActiveHumanChair(chairId)` with documented reference implementation showing the chairId → character → user lookup chain.

**Medium risk:**

- _M1:_ "Exactly half the seed Org" framing was technically false (34→14 is not 17, 31→10 is not 15.5). **Fix applied:** corrected the framing - Strong is exactly half, Solid and Lean are tuned tighter.
- _M2:_ Sibling vs. merge with existing `partyOrg/constants.ts` not justified. **Fix applied:** §6.2 now explains why a separate file is preferred (separation of concerns; existing constants are cap-contribution math, this is anti-decay protection).
- _M3:_ Tie-breaking when two default parties have identical Org% was non-deterministic (loop order dependent). **Fix applied:** added alphabetical-by-`partyId` tiebreaker.

**Low risk:**

- _L1:_ Plan §17 says NPPs and officeholders provide passive Org/Reg drift bonus. The defense floor and unmanned cap don't interact with that - they're separate mechanics. **No fix** - flagged for clarity in §6.3 implicitly.

**Edge cases:**

- _E1:_ Banned/inactive player as chair - should count as unmanned. **Fix applied via H1** - the new `isActiveHumanChair` contract explicitly excludes banned / inactive users.
- _E2:_ No `StatePartyOrg` row for any default party in a state - `resolveHomeDefaultParty` returns `null`, no floor applies. Correct behavior. **No fix.**
- _E3:_ Tie at top home-default Org%. **Fix applied via M3.**

**Findings:** 5 (1 high, 3 medium, 1 low) + 3 edge cases. **Fixes:** 5 applied (H1, M1, M2, M3, E1+E3 via the H1/M3 fixes); 1 low + 1 edge case no-action.

### Audit after Task 0.5.5 - 2026-05-05

**High risk:**

- _H1:_ §7.3.3's table read as authoritative claim that every race family already consumes Org/Reg/Support. The plan's race-domain audit explicitly forbids aspirational rows. **Fix applied:** retitled to "spec'd to consume" with explicit "verification due in Phase 4/5/5.5" framing; clarified that Phase 0.5 commits the contract while later phases verify code compliance.
- _H2:_ §7.2 Unaffiliated Org capture pseudocode used `clampToFloor(r, rivalDelta)` and `applyDelta` without saying what happens when clamps reduce the action's total effect. Could be read as "the action's full delta gets applied somewhere else" (resulting in over-pulling). **Fix applied:** spelled out that leftover capture is **dropped** (under-deliver, don't error); the ledger logs actual movement, not intended.

**Medium risk:**

- _M1:_ The pseudocode could be mistaken for actual TypeScript. **Fix applied:** added explicit "Pseudocode, not real TypeScript" header.
- _M2:_ Operation order (cap multiplier vs floor clamp) was implicit. **Fix applied:** §7.2 now explicitly fixes the order as cap → clamp.
- _M3:_ JP shugiin / sangiin general claim that Org% applies the same way may be wrong (proportional list math). **Fix applied:** flagged for Phase 5 verification with explicit "verify in Phase 5" note in the table.

**Low risk:**

- _L1:_ The 4×4 matrix sparsity is a feature, not a bug - design intends no auto-cross-feed loops. **No fix.**

**Edge cases:**

- _E1:_ Σ raw = 0 in primary (all candidates score 0). **Fix applied:** §7.3.1 now lists fallback (even split) as a Phase 4 documented decision.
- _E2:_ Reg% = 0 for the party in this state (e.g. seed missed it). **Fix applied:** §7.3.1 documents the no-primary-runs-for-this-party-in-this-state outcome.
- _E3:_ persuasion-resistance vs transferable-share inverse relationship was implicit. **No fix** - the curves are calibrated in Phase 5; Phase 0.5 contract just specifies the directional relationship, which is captured by "monotonic in Reg%."

**Findings:** 6 (2 high, 3 medium, 1 low) + 3 edge cases. **Fixes:** 5 applied (H1, H2, M1, M2, M3); E1 + E2 documented as Phase 4 decisions; 1 low + 1 edge case no-action.

### Audit after Task 0.5.6 - 2026-05-05

**High risk:**

- _H1:_ Step 5's placeholder Support decay rate of `2 / turn` was actually `48% / day` if interpreted literally (2 absolute points per hourly turn). That would drain typical Support to 0 in ~1.5 IRL days, contradicting plan-stated "matter of days, not weeks." **Fix applied:** removed the misleading numeric placeholder, replaced with a directional target ("decay to half over ~2 IRL days") and explicit Phase 4 calibration handoff with a multiplicative-decay candidate formula example.

**Medium risk:**

- _M1:_ `STRONGHOLD_FALL_TIME_TURNS_TARGET` exported as a typed constant could mislead future engineers into thinking it's consumed by mutation logic. **Fix applied:** comment now says explicitly "documentation only - not consumed by mutation logic."
- _M2:_ Step 1's action-validation contract (PS reserve sufficient, cooldowns, etc.) wasn't documented. Could lead to politics phase silently applying bogus actions. **Fix applied:** step 1 now documents that affordability is validated at queue-time on the API route; politics phase trusts the queue and logs no-ops if the world has changed by dispatch time.
- _M3:_ Order invariant in §8.4 lists steps 1-7 but doesn't address what happens if a step internally writes a partial state and a later step reads inconsistent values within the same turn. The single-threaded contract from §5.4 covers this implicitly. **No fix** - already covered.

**Low risk:**

- _L1:_ Constants file path consistent with `defenseConstants.ts` sibling pattern. **No fix.**

**Edge cases:**

- _E1:_ Mid-turn tier transition (Org drops 28→27, party falls from Lean to Competitive). Step 3's drift target updates correctly because it reads the post-step-2 Org value. **No fix.**
- _E2:_ Action queued but PS spent between queue and dispatch (player did something else first). **Fix applied via M2** - affordability re-validation NOT performed in politics phase; queue-time validation + reservation pattern handles this.
- _E3:_ Concurrent Reg poach actions targeting the same row in step 1. Single-threaded contract makes this a no-issue. **No fix.**

**Findings:** 5 (1 high, 3 medium, 1 low) + 3 edge cases. **Fixes:** 3 applied (H1, M1, M2); 1 medium + 1 low + 3 edge cases no-action (already covered by other contracts).

### Audit after Task 0.5.7 - 2026-05-05

**High risk:**

- _H1:_ §8.3 step 1 names post-rename field `politicalStrength`, but Phase 1 / 2 ship before Phase 3 does the rename. A reader implementing Phase 1 might mistakenly look for a `politicalStrength` field. **Fix applied:** §9.5 now documents the reading-order convention - references describe post-Phase-3 state; Phase 1/2 read `actionPool` until the rename.

**Medium risk:**

- _M1:_ `defenseConstants.ts` and `pacingConstants.ts` were marked "Phase 1 (defines)" but Phase 1 doesn't consume them - the Overview tab is read-only on the political model and doesn't invoke defense or pacing logic. Creating the file in Phase 1 just to satisfy the design would be premature; the schema sketch in this doc IS the code-shape commitment. **Fix applied:** §9.2 helpers table now creates these files in Phase 3 when first consumed.

**Low risk:**

- _L1:_ §10.1 plan-anchor table is descriptive, not prescriptive. **No fix.**

**Edge cases:**

- _E1:_ Migration order between `StatePartyOrg.registration` backfill and `stateRegistrationPool` creation. Single-threaded migration; no race. **No fix.**
- _E2:_ Re-running the seed when fields already have values. **Fix applied:** §9.6 added - idempotent overwrite is intentional; only rows in the appendix are touched.

**Findings:** 4 (1 high, 1 medium, 1 low) + 2 edge cases. **Fixes:** 3 applied (H1, M1, E2); 1 low + 1 edge case no-action.

---

## Final Audit

### Final Audit - Pass 1 (2026-05-05)

End-to-end read of the design doc. Findings:

**High risk:**

- _F1.H1:_ §4.2.1 markdown bug - the `#### 4.2.1` heading was nested **inside** the `StatePartyOrg` TS code block, so the heading would render as code. **Fix applied:** moved the closing ` ` ``` above the heading.
- _F1.H2:_ §3.1's TS code block had a stale "Lifecycle" comment saying "decays per turn during primary phase" and "cleared at primary resolution" - these were the original primary-only words from before §3.1.1's clarification that lifecycle is keyed off `Election.status`. **Fix applied:** updated the comment to reference `Election.status === "active"` for decay and `=== "resolved"` for clearing, with cross-reference to §3.1.1.
- _F1.H3:_ §3.3 summary table row for `electionCandidates.support` had the same stale "primary resolution" wording. **Fix applied:** rewrote the lifecycle column to match §3.1.1.
- _F1.H4:_ §7.2 had two contradictory statements about the unmanned-cap × floor-clamp ordering: "Operation order is fixed" (line 811) said the order matters, while a later sentence claimed the operations were "commutative." **Fix applied:** removed the "commutative" sentence; merged the two paragraphs into a single consistent statement.
- _F1.H5:_ §9 had two `### 9.6` headings (one for the seed re-run idempotency, one for "What this section answers"). **Fix applied:** renumbered the second to `### 9.7`.

**Medium risk:**

- _F1.M1:_ §3.2 derivation rule said Support decay multipliers land in `defenseConstants.ts` - wrong file. Defense constants are floor / unmanned-cap; Support decay is a separate concern. **Fix applied:** §3.2 now points to a future `src/lib/turn/parties/supportDecayConstants.ts` and explicitly says NOT in `defenseConstants.ts` or `pacingConstants.ts`.
- _F1.M2:_ §4.2 lifecycle bullet said Reg is mutated only by "explicit Reg-poach actions" - but Phase 3 also has Registration Drive (vs Unregistered) and Persuasion (vs Independent), neither of which is poach. **Fix applied:** the bullet now lists all three Phase 3 Reg actions.
- _F1.M3:_ §5.6 framing implied `orgRegLedger` covers the entire new economy, but it doesn't track PS movement (which lives in the separate `partyPoliticalStrengthLedger` per Phase 3). **Fix applied:** added an explicit "what this ledger does NOT track" subsection, renumbered §5.6 → §5.7.

**Low risk:**

- _F1.L1:_ Forward references (e.g. §3.1 referencing §8 before §8 is read) are awkward but the markdown is readable as-is. **No fix** - would require anchor links across many cells; defer to a polish pass if ever desired.
- _F1.L2:_ `STRONGHOLD_FALL_TIME_TURNS_TARGET` is exported but never imported. **No fix** - it's a documented playtest constant; tooling Phase 3+ will read it.

**Edge cases:**

- _F1.E1:_ §4.4 invariant was unclear about mid-phase reads. **Fix applied:** explicit "asserted at the end of the politics phase, not after every individual write" with a paragraph clarifying mid-phase reads may briefly violate the sum.
- _F1.E2:_ §5.4 transaction-availability detection said "at startup" without scoping to per-process. Cron workers and the web server are separate processes. **Fix applied:** "per-process startup" with caching.

**Findings:** 10 (5 high, 3 medium, 2 low) + 2 edge cases. **Fixes:** 10 applied (5 high + 3 medium + 2 edge cases); 2 low no-action.

Pass 1 had non-zero findings → Pass 2 is required.

### Final Audit - Pass 2 (2026-05-05)

**High risk:**

- _F2.H1:_ §3.2 derivation rule scoped only to "in-cycle primary candidates" - but UK Commons / JP shugiin / DE Bundestag / DE etc. don't have separate primaries; their candidates are general-only. Under the original wording, those races would never produce a `Party.support` or `StatePartyOrg.support` rollup, contradicting §3.2's "Phase 5 General-election screen reads StatePartyOrg.support." **Fix applied:** rewrote derivation rule to include in-cycle electionCandidates from any race family with `support` set; explicitly notes proportional / direct-general scope.
- _F2.H2:_ §7.1 4×4 matrix's Reg → Support cell described an indirect interaction ("Reg increases the ceiling for Support"), but the design note immediately below said "Reg → Support direct cells are empty." Direct contradiction. **Fix applied:** the cell now reads "none directly" with a note that Reg gates _the translation_ of Support to votes, not the Support value itself.
- _F2.H3:_ §7.3.2 general-election formula sketch placed `persuasionResistance(Reg%)` on the _mobilized vote_ line, which would have caused higher own `Reg%` to _reduce_ a party's own vote - the opposite of the intended "Reg defends against peeling." **Fix applied:** rewrote the formula to keep nominal share clean of resistance and apply `persuasionResistance` only to the inbound peeling factor on the swing-from-Reg lines. Explicit correction note included.

**Medium risk:**

- _F2.M1:_ §7.2 pseudocode referenced a helper `isHomeDefault(r)` that doesn't exist in §6.2. **Fix applied:** replaced with `resolveHomeDefaultParty(parties, rows)?.partyId === r.partyId`.
- _F2.M2:_ §7.3.2 formula's `Σ candidate.support` was ambiguous - for FPTP races there's typically one candidate per party. **Fix applied:** introduced `candidate_support_factor(P_i)` with explicit per-race-family aggregation (single candidate for FPTP; seat-weighted for proportional).

**Low risk:** none new.

**Edge cases:** none new.

**Findings:** 5 (3 high, 2 medium). **Fixes:** 5 applied.

Pass 2 had non-zero findings → Pass 3 is required.

### Final Audit - Pass 3 (2026-05-05)

**High risk:** none.

**Medium risk:**

- _F3.M1:_ §3.2 derivation rule's race-family scoping covered UK / JP / DE direct generals but did not explicitly handle US presidential general (one national `electionCandidates` row, not per-state). Could ambiguate whether the national candidate's support attributes uniformly to every state. **Fix applied:** §3.2 now lists US presidential general explicitly with the "national support attributes uniformly per state" rule, plus US down-ballot for completeness.
- _F3.M2:_ §7.3.1 primary contract referenced `demographicAffinity`, `influence`, `archetypeFit` without saying where they come from; could imply Phase 4 must invent them. **Fix applied:** added a paragraph confirming these come from existing `primaryResolution.ts` / `demographicAppeal.ts` and Phase 4 just wires `candidate.support` as a new factor.

**Low risk:**

- _F3.L1:_ §8.5 step 5 ledger-source phrasing was awkward (`supportDecay (decay), then supportAction is not used in step 5`). **Fix applied:** simplified to `supportDecay (supportAction lives in step 1, not step 5)`.
- _F3.L2:_ Backfill behavior for in-flight `electionCandidates` rows when Phase 4 deploys was unaddressed. **Fix applied:** §7.3.1 now documents the three options Phase 4 can choose (backfill, deploy-between-cycles, or accept zero); decision deferred to Phase 4 kickoff.

**Edge cases:** none new.

**Findings:** 4 (0 high, 2 medium, 2 low). **Fixes:** 4 applied.

Pass 3 had non-zero findings → Pass 4 is required.

### Final Audit - Pass 4 (2026-05-05)

**High risk:** none.

**Medium risk:**

- _F4.M1:_ §5.2 schema's `note` field example for `migration` source said `"migration:phase3:actionPoolRename"` - but earlier in the same code block, the source description explicitly states "the Phase 3 actionPool → politicalStrength rename has no ledger row." The example contradicted its own source description. **Fix applied:** replaced the example with `"migration:phase1:registrationBackfill"`, which is a real org/reg/support migration that does log to this ledger.
- _F4.M2:_ §4.4 validator timing was inconsistent - said "at the end of every politics phase (turn-order step 4 + 5)" but step 5 is Support, not Reg. The validator should run after Reg-affecting writes complete (step 4). **Fix applied:** clarified to "after step 4 (Reg decay / rerouting)" with explicit note that steps 5-7 don't touch the registration pool.
- _F4.M3:_ §3.2 readers list described Phase 1 KPI as reading `StatePartyOrg.support` "when Phase 0.5 chooses Support-only fallback" - but Phase 0.5 chose Reg+Support. The conditional reader description was vestigial and misleading. **Fix applied:** rewrote to clarify Phase 1 reads `StatePartyOrg.registration` directly; the Support rollup is Phase 5+ only.

**Low risk:**

- _F4.L1:_ §3.3 summary table lifecycle column for `Party.support` / `StatePartyOrg.support` said "Recomputed per turn from rollups" without noting they're undefined before Phase 5. **Fix applied:** added "; undefined before Phase 5" to both rows.

**Edge cases:** none new.

**Findings:** 4 (0 high, 3 medium, 1 low). **Fixes:** 4 applied.

Pass 4 had non-zero findings → Pass 5 is required.

### Final Audit - Pass 5 (2026-05-05)

**High risk:** none.

**Medium risk:**

- _F5.M1:_ §3.2 derivation rule had a contradiction: line 192 mentioned "off-cycle decay multiplier (default 0.5) when no in-cycle candidate exists," but line 207 said "the rollup is `undefined` when no eligible candidate exists." Two incompatible off-cycle behaviors. **Fix applied:** removed the multiplier reference; the rollup is simply `undefined` off-cycle. Note added that Phase 5 may add a persistence model later if needed.

**Low risk:**

- _F5.L1:_ §7.2 pseudocode called `isUnmannedDefault(rivalParty, isActiveHumanChair)` but `rivalParty` (a `PoliticalParty` row) was never resolved from `r` (the `StatePartyOrg` row). **Fix applied:** added explicit `parties.find(p => String(p._id) === r.partyId)` lookup with null guard before the `isUnmannedDefault` call.

**Edge cases:** none new.

**Findings:** 2 (0 high, 1 medium, 1 low). **Fixes:** 2 applied.

Pass 5 had non-zero findings → Pass 6 is required.

### Final Audit - Pass 6 (2026-05-05)

**High risk:** none.

**Medium risk:**

- _F6.M1:_ §9.2 new-fields table for `ElectionCandidate.support` claimed "Phase 1 (read tolerates undefined)" - but Phase 1 doesn't read this field at all per §3.2 (Phase 1 reads `StatePartyOrg.registration` directly). The table row was misleading. **Fix applied:** corrected to "Phase 4 (write path); Phase 4 + Phase 5 (read paths)."

**Low risk:**

- _F6.L1:_ §7.2 pseudocode used `targetParty`, `parties`, `isActiveHumanChair` etc. without saying where they come from. **Fix applied:** added an "Inputs in scope" comment block at the top of the pseudocode listing the expected variables.

**Edge cases:** none new.

**Findings:** 2 (0 high, 1 medium, 1 low). **Fixes:** 2 applied.

Pass 6 had non-zero findings → Pass 7 is required.

### Final Audit - Pass 7 (2026-05-05)

**High risk:** none.

**Medium risk:**

- _F7.M1:_ §8.3 turn-order steps 1 and 2 had ambiguous Org-write semantics - step 1's "Writes to" listed `StatePartyOrg.organization`, but step 2 also wrote it via the Unaffiliated-Org capture rule. Could be read as redundant double-writes or a race. **Fix applied:** clarified that step 1 directly mutates fields for _direct-write actions_ (Registration Drive, Persuasion, Contest, Rally, etc.) but **queues** Org-capture intents (Boost Organization, Establish Presence) for step 2 to apply through the §7.2 rule. Step 2 is the only step that writes `StatePartyOrg.organization`.

**Low risk:**

- _F7.L1:_ §8.2 "Drift > Decay (10×)" framing implied drift is one-directional ("trending toward" the baseline). Drift is actually bidirectional - moves Reg toward Org, which can be either up or down depending on the gap. **Fix applied:** rewrote the bullet to clarify drift is bidirectional, with the 10× ratio meaning maintained-Org parties converge faster than they erode.

**Edge cases:** none new.

**Findings:** 2 (0 high, 1 medium, 1 low). **Fixes:** 2 applied.

Pass 7 had non-zero findings → Pass 8 is required.

### Final Audit - Pass 8 (2026-05-05)

**High risk:** none.

**Medium risk:**

- _F8.M1:_ §8.4 step 1→2 invariant rationale used pre-Pass-7 wording about "post-action state" - but Pass 7 clarified Org-capture actions queue rather than apply in step 1. The rationale was now inconsistent with the model. **Fix applied:** rewrote the bullet to say step 1 queues Org-capture intents and step 2 applies them.

**Low risk:**

- _F8.L1:_ §8.5 step 2 ledger row said "`action` (re-emitted with the post-aggregation final delta)" - but step 1 doesn't emit Org-capture rows, so step 2 isn't _re-emitting_; it's emitting the only row. **Fix applied:** rewrote step 1 and step 2 ledger rows to clarify Org-capture queues without emitting in step 1, and step 2 emits the row when applying through §7.2.
- _F8.L2:_ §10.2 closing sentence said "Phase 0.5 is ready for the final audit cycle" - past-tense from a point we've now passed. **Fix applied:** rewrote to "All 11 acceptance items satisfied (verified through the final audit cycle below)."

**Edge cases:** none new.

**Findings:** 3 (0 high, 1 medium, 2 low). **Fixes:** 3 applied.

Pass 8 had non-zero findings → Pass 9 is required.

### Final Audit - Pass 9 (2026-05-05)

End-to-end re-read with discipline (correctness defects only, not polish).

**High risk:** none.

**Medium risk:** none.

**Low risk:** none.

**Edge cases:** none.

Verification spot-checks:

- §4.4 invariant + validator signature consistent with §5 ledger writes.
- §6.2 helper functions (`resolveHomeDefaultParty`, `deriveDefenseTier`, `resolveDefenseFloor`, `isUnmannedDefault`) compose correctly: §7.2's pseudocode references match the exported helpers.
- §7.3.2 formula's `final_share(P_i)` math is dimensionally consistent (nominal − swing-out + swing-in); summation over j is the implicit "j ≠ i" convention (`swing_from_Reg(P_i → P_i) = 0` by design).
- §8.3 step 2 is the sole `StatePartyOrg.organization` writer, and step 1's queue-then-apply convention is reflected in step 2's ledger contract (§8.5).
- §9.2 / §9.5 - Phase 3 actionPool rename appears in the modified-processor table for context only; full migration rationale lives in §9.5 + the plan, no duplication.
- §10.2 acceptance checklist all 11 items still trace to current section content after all preceding passes.

**Findings:** 0.

Pass 9 is the first zero-finding pass. Pass 10 must also produce zero findings to close the cycle.

### Final Audit - Pass 10 (2026-05-05)

**High risk:** none.

**Medium risk:** none.

**Low risk:**

- _F10.L1:_ §10 (Cross-references back to the plan) was added during Task 0.5.7 but never added to the Table of Contents at the top of the doc. Readers using TOC navigation would miss it. **Fix applied:** added §10 entry to the TOC.

**Edge cases:** none.

**Findings:** 1 (0 high, 0 medium, 1 low).

Pass 10 had a finding → the consecutive-zero counter resets. Pass 11 + Pass 12 must both be zero to close the cycle.

### Final Audit - Pass 11 (2026-05-05)

End-to-end verification:

- TOC at the top includes all 10 numbered sections plus Per-Task Audit Log + Final Audit. ✓
- No remaining `_Populated in Task ..._` placeholders in section bodies. ✓
- No `TODO` / `TBD` / `FIXME` / `XXX` markers remaining (the only "placeholder" mentions are intentional product references - "honest placeholder UI" - or audit-log retrospectives). ✓
- Section numbering is contiguous: §1 through §10, with sub-sections numbered consistently within each parent.
- All §X.Y "What this section answers" rollups still cite the right plan deliverables.
- §10.2 Phase 0.5 acceptance checklist all 11 items still trace.

**High risk:** none.

**Medium risk:** none.

**Low risk:** none.

**Edge cases:** none.

**Findings:** 0.

Pass 11 is zero-finding (1 of 2 consecutive). Pass 12 must also be zero to close the cycle.

### Final Audit - Pass 12 (2026-05-05)

Final verification pass:

- Status header (line 3) reads "In progress (Phase 0.5 of the political-system rework, kickoff 2026-05-05)" - accurate at the moment Pass 12 runs (the user-review pause has not yet taken place; status will flip to "Complete pending user review" once the audit cycle closes).
- TOC entries §1 through §10 + Per-Task Audit Log + Final Audit all resolve to real anchors.
- Forward cross-references checked: §3.1.1, §4.2.1, §4.4, §5.4, §5.5, §6.2, §7.2, §7.3.1, §7.3.2, §7.3.3, §8.1, §8.3, §8.5, §9.3, §9.4, §9.5 - all exist.
- TOC's `_populated by Task 0.5.X_` annotations are historical and accurate.
- §1 Authority statement consistent with the rest of the doc (this doc is source of truth for Reg/Support; plan wins on its own locked assumptions until updated to point here).
- §10.2's 11-item acceptance checklist still matches the plan's Phase 0.5 acceptance criteria.

**High risk:** none.

**Medium risk:** none.

**Low risk:** none.

**Edge cases:** none.

**Findings:** 0.

**Pass 12 is zero-finding (2 of 2 consecutive). Audit cycle closes.**

---

## Phase 0.5 - Closeout (2026-05-05)

The final audit cycle ran 12 passes:

| Pass | Findings                 | Notes                                                                                                                                   |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 10 (5H, 3M, 2L) + 2 edge | Markdown bugs, stale primary-only lifecycle wording, contradictory ordering claim, duplicate §9.6 heading, scope clarifications         |
| 2    | 5 (3H, 2M)               | Derivation-rule scoping for non-primary races; 4×4 matrix self-contradiction; general-election formula error (resistance on wrong line) |
| 3    | 4 (0H, 2M, 2L)           | US presidential-general scoping; multiplier source-file pin; ledger phrasing; in-flight backfill options                                |
| 4    | 4 (0H, 3M, 1L)           | Ledger note example consistency; validator timing; reader scoping; lifecycle disclaimer                                                 |
| 5    | 2 (0H, 1M, 1L)           | Off-cycle behavior contradiction; rivalParty resolution                                                                                 |
| 6    | 2 (0H, 1M, 1L)           | Field reader phase mapping; pseudocode input declaration                                                                                |
| 7    | 2 (0H, 1M, 1L)           | Step 1/2 Org-write split; bidirectional drift framing                                                                                   |
| 8    | 3 (0H, 1M, 2L)           | Invariant rationale alignment; ledger row source clarification; tense fix                                                               |
| 9    | 0                        | First zero-finding pass                                                                                                                 |
| 10   | 1 (0H, 0M, 1L)           | TOC missing §10 entry                                                                                                                   |
| 11   | 0                        | First zero-finding pass after Pass 10 reset                                                                                             |
| 12   | 0                        | Second consecutive zero-finding pass - cycle closes                                                                                     |

**Total findings across all passes:** 33. **Total fixes applied:** 33.

The design doc covers all Phase 0.5 deliverables (per §10.2 acceptance checklist) with TS schema sketches, indexes, constants, and explicit phase ownership. **Phase 0.5 is complete pending user review**; per the plan's per-phase pause rule, Phase 1 is paused until user approval to proceed.

Last checked: 2026-10-29, version 1.18.0
