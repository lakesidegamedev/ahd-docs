# Ruling-Party Confidence Subsystem

Country-agnostic design notes for the one-party-state confidence model
that drives leader stability in any country with
`governmentType: "onePartyState"`. CN is the first consumer; the
subsystem is shaped so a second one-party country populates a
`CountryConfig.priorityProfile` and immediately participates without
code changes.

For CN-flavour specifics (9-axis profile contents, regional structure,
purge labels), see [`china.md`](./china.md).

## Overview

In a one-party state, the head of government is selected and retained
by the ruling party rather than by direct popular vote. Their tenure
depends on internal confidence - a numeric score (0-95) that drifts each
turn based on:

1. Policy alignment with the ruling-party's priorities (enacted bills'
   categories scored against per-axis weights).
2. Purge events (admin-recorded internal-discipline actions).
3. Leader-mandate renewals (re-elections, confirmations) that bump
   confidence.

When confidence drops past thresholds, in-game consequences progress
from "no effect" to "discipline loss" to "appointment resistance" to
"forced crisis" - the lowest band signals a leadership transition risk.

## Components

### Priority profile (`RulingPartyPriorityProfile`)

A 9-axis profile capturing the ruling party's ideology weights. Each
axis has an `id`, `name`, `weight` (0-1, summing to 1.0), and a
`description`. Defined per country on
`CountryConfig.priorityProfile`. Validated by
`validatePriorityProfile()`.

### Policy-axis effects (`Record<string, PolicyAxisEffect[]>`)

Maps broad policy categories (e.g. `"market-liberalization"`,
`"industrial-investment"`, `"censorship"`) to per-axis deltas in the
range −100…+100. Lives on `CountryConfig.policyAxisEffects`. Each
enacted bill's `category` field is looked up here at turn-resolution
time and folded into the country's drift score.

### Confidence state (`CountryLeaderState`)

Per-leader document in the `countryLeaderStates` collection, keyed by
`${countryId}_${leaderObjectId}`. Carries the current `partyConfidence`
(0-95), `renewalCount`, and a rolling history of up to 50 deltas with
turn, reason, and previous/next values for audit.

### Confidence bands

- **secure** (≥80) - leadership solid
- **stable** (≥65) - normal operation
- **watchful** (≥50) - party paying attention
- **strained** (≥35) - visible tensions
- **crisis** (≥20) - leadership challenge risk
- **critical** (<20) - forced transition path eligible

### Consequence ladder (`ConfidenceConsequenceLevel`)

- **none** (≥50) - no penalty
- **discipline_loss** (<50) - NPC discipline weakens
- **challenge_risk** (<35) - internal challenge events become likely
- **appointment_resistance** (<25) - cabinet appointments face delay
- **forced_crisis** (<15) - special leadership-removal mechanics
  become eligible

Today the consequence ladder is informational; consumers (NPC discipline
modulation, forced-transition triggers) are future work.

### Purge events

`PurgeEvent` documents in the `rulingPartyPurgeEvents` collection.
Severity (`minor` / `regional` / `senior` / `faction` / `extreme`)
maps to a fixed confidence delta via `PURGE_SEVERITY_DELTA`:

| Severity | Delta |
| -------- | ----- |
| minor    | −2    |
| regional | −4    |
| senior   | −7    |
| faction  | −10   |
| extreme  | −15   |

Inserted via admin endpoint `POST /api/admin/country/[code]/ruling-party-purge`.
Consumed by `onePartyBillLifecycle` on the next turn - once consumed,
each event is marked `processed: true` so drift is not double-counted.

## Per-turn flow

`processOnePartyBillLifecycleForCountry(countryId, now)` runs each turn
for every one-party country:

1. Process expired lower-chamber bills (enact or fail).
2. Collect enacted policy categories.
3. Load any unprocessed purge events for the country.
4. Call `processRulingPartyConfidenceTurn(db, countryId, ...)` which:
   - Loads the country's priority profile + axis effects from config.
   - Computes drift via `computeTurnDrift` (policy alignment + purge
     deltas).
   - Applies the delta to the country's leader confidence state.
   - Returns drift details + consequence level for telemetry.
5. Mark consumed purges as processed.

## Lifecycle hooks

- `installNewLeader(db, countryId, leaderId, officeType, partyId, turn)`  - 
  fresh confidence of 75. Called when a new PM is seated.
- `renewLeaderMandate(db, countryId, leaderId, ...)` - +5 bump (capped
  at 95), or the country's `renewalBumpOverride` when the constitutional
  reform action has set one. Called when the seated leader is confirmed for
  another term.
- Reunification: when the leader's state absorbs another, the carried head of
  government takes `REUNIFICATION_BUMP` = +10 (`src/lib/settlement/actuate.ts`,
  constant in `src/lib/onePartyState/rulingPartyConfidence.ts`).
- `adjustLeaderConfidence(db, countryId, leaderId, delta, reason, turn)`  - 
  arbitrary delta with history entry. Used by the turn driver and any
  future ad-hoc consumers.

## File map

| File                                                            | Role                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/turn/rulingPartyConfidence.ts`                         | install/renew/adjust helpers + bands                                |
| `src/lib/turn/rulingPartyConfidenceTurn.ts`                     | per-turn driver, reads config                                       |
| `src/lib/turn/rulingPartyPriorities.ts`                         | profile/axis-effect types, drift math, purge severity, consequences |
| `src/lib/turn/onePartyBillLifecycle.ts`                         | turn driver iterating one-party countries                           |
| `src/app/api/admin/country/[code]/ruling-party-purge/route.ts`  | admin insert for purge events                                       |
| `src/app/api/admin/country/[code]/one-party-readiness/route.ts` | admin diagnostic                                                    |
| `countryLeaderStates` (MongoDB)                                 | per-leader confidence state                                         |
| `rulingPartyPurgeEvents` (MongoDB)                              | purge event queue                                                   |

## Adding a new one-party country

To onboard a second one-party country (call it "XX"):

1. Set `governmentType: "onePartyState"` and `rulingPartyId: <seq>` on
   `COUNTRY_CONFIGS.XX`.
2. Populate `XX.priorityProfile` with the country's 9-axis profile
   (axes can differ from CN's; weights must sum to 1.0).
3. Populate `XX.policyAxisEffects` with the country's policy-category
   → axis-delta map.
4. If the country has a CN-style regional budget (local tax retention
   - central transfer), populate `XX.onePartyRegionalBudget` and call
     `processCNRegionalBudgets` from the country's turn phase. (File
     name pending a future rename - the function reads the budget knobs
     from config so the same processor handles XX.)
5. Seed parties with `regimeStatus` values (one `"ruling"`, others
   `"approved"` or `"banned"`).
6. Register a per-country entry in `COUNTRY_BILL_PHASES` bound to
   `processOnePartyBillLifecycleForCountry("XX", now)`.

That's it. No subsystem-code changes required.
