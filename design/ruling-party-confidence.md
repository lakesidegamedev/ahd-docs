# Ruling-Party Confidence Subsystem

Country-agnostic design notes for the one-party-state confidence model that drives leader stability in any country with `governmentType: "onePartyState"`. CN is the first consumer; the subsystem is shaped so a second one-party country populates a `CountryConfig.priorityProfile` and immediately participates without code changes.

Player guide: [One-Party States](https://www.ahousedividedgame.com/wiki/one-party-states). The as-shipped design doc for the surrounding regime system (escalation stages, reforms, conversion) is [`one-party-states-as-shipped.md`](./one-party-states-as-shipped.md). For CN-flavour specifics (9-axis profile contents, regional structure, purge labels), see [`china.md`](./china.md).

## Overview

In a one-party state, the head of government is selected and retained by the ruling party rather than by direct popular vote. Their tenure depends on internal confidence, a numeric score (0 to 95) that changes each turn based on:

1. Policy alignment with the ruling party's priorities (enacted bills' categories scored against per-axis weights).
2. Purge events (recorded internal-discipline actions).
3. A drag from collapsing popular legitimacy.
4. Leader-mandate renewals, reunification and regime reforms and decisions, which add or remove points directly.

As confidence falls past thresholds the consequence level moves from "no effect" to "discipline loss" to "appointment resistance" to "forced crisis". The lowest band signals leadership-transition risk. Today the consequence level is computed, logged and shown in the executive hub and executive API, but no system yet consumes it to change NPC behaviour (see Edge cases).

## Rules

All constants live in `src/lib/onePartyState/rulingPartyConfidence.ts` unless stated otherwise. `src/lib/turn/rulingPartyConfidence.ts` re-exports them and holds the persistence helpers.

| Rule | Constant | Value |
| --- | --- | --- |
| New leader confidence | `INITIAL_CONFIDENCE` | 75 |
| Renewal bump | `RENEWAL_BUMP` | +5 (or the country's `renewalBumpOverride`, see below) |
| Reunification bump | `REUNIFICATION_BUMP` | +10 (`src/lib/settlement/actuate.ts`) |
| Maximum | `MAX_CONFIDENCE` | 95 |
| Minimum | `MIN_CONFIDENCE` | 0 |
| History kept per leader | `MAX_HISTORY_ENTRIES` | 50 (newest first) |

### Priority profile (`RulingPartyPriorityProfile`)

A 9-axis profile capturing the ruling party's ideology weights. Each axis has an `id`, `name`, `weight` (0 to 1, summing to 1.0) and a `description`. Defined per country on `CountryConfig.priorityProfile`, with `DEFAULT_CN_PRIORITY_PROFILE` as the fallback. Validated by `validatePriorityProfile()`. File: `src/lib/onePartyState/rulingPartyPriorities.ts`.

### Policy-axis effects (`Record<string, PolicyAxisEffect[]>`)

Maps broad policy categories (for example `"market-liberalization"`, `"industrial-investment"`, `"censorship"`) to per-axis deltas from -100 to +100. Lives on `CountryConfig.policyAxisEffects`, defaulting to `DEFAULT_POLICY_AXIS_EFFECTS`. Each enacted bill's `category` is looked up at turn resolution; an unknown category uses the `default` entry, which is empty (score 0).

### Policy alignment and per-turn delta

```
weightedSum = sum(effect.delta * axis.weight)
totalWeight = sum(|axis.weight|)   (only axes present in the profile)
score = clamp(round(weightedSum / (totalWeight * 50) * 100), -100, 100)
```

`scoreToTurnDelta(score)` then converts each enacted bill's score into a confidence change:

| Alignment score | Delta |
| --- | --- |
| 40 or more | +1 |
| 10 to 39 | 0 (+0.25 only when fractional mode is on, which the turn does not use) |
| -9 to 9 | 0 |
| -39 to -10 | -1 |
| -40 or less | `max(-4, round(score / 20))`, so -2 to -4 |

### Popular legitimacy drag

`popularLegitimacyBleedIntoParty(popular)` adds a one-way per-turn drag: 0 when popular legitimacy is 30 or more, -0.25 from 15 to under 30, -0.5 below 15 (halved in ticket #3165 because confidence has no natural recovery). It is skipped when the leader state has no `popularLegitimacy` value.

### Confidence state (`CountryLeaderState`)

Per-leader document in the `countryLeaderStates` collection, keyed by `${countryId}_${leaderObjectId}`. It carries `partyConfidence` (0 to 95), `renewalCount`, `startedAtTurn`, `lastRenewedAtTurn` and a rolling history of up to 50 deltas with turn, reason, and previous and next values for audit.

### Confidence bands (`CONFIDENCE_BANDS`)

| Band | Minimum | Meaning |
| --- | --- | --- |
| secure | 80 | leadership solid |
| stable | 65 | normal operation |
| watchful | 50 | party paying attention |
| strained | 35 | visible tensions |
| crisis | 20 | leadership challenge risk |
| critical | 0 | forced transition path eligible |

### Consequence ladder (`getConfidenceConsequenceLevel`, `rulingPartyPriorities.ts`)

| Level | Confidence below | Description in code |
| --- | --- | --- |
| none | 50 and above | no penalty |
| discipline_loss | 50 | NPC and party auto-vote discipline reduced |
| challenge_risk | 35 | internal challenge events likely |
| appointment_resistance | 25 | cabinet appointments face delay |
| forced_crisis | 15 | forced leadership crisis path eligible |

These thresholds (50, 35, 25, 15) are not the same as the band thresholds (80, 65, 50, 35, 20); the ladder is a separate scale.

### Purge events

`PurgeEvent` documents in the `rulingPartyPurgeEvents` collection. Severity maps to a fixed confidence delta via `PURGE_SEVERITY_DELTA` (`rulingPartyPriorities.ts`):

| Severity | Delta |
| --- | --- |
| minor | -2 |
| regional | -4 |
| senior | -7 |
| faction | -10 |
| extreme | -15 |

Purges enter the queue through the admin endpoint `POST /api/admin/country/[code]/ruling-party-purge` and through `recordPurgeEvent` (`src/lib/onePartyState/partyEffectAdapters.ts`), which the anti-corruption purge reform (`src/lib/onePartyState/reformActions.ts`) and the Stage 3 faction-split decision call. Each unprocessed event is consumed once by the next confidence tick and marked `processed: true`, so drift is not double-counted.

### Worked example

A CN leader is installed at 75 (band stable). On one turn two enacted bills score +45 and -22 against the profile, a senior purge is queued, and popular legitimacy is 20.

- Policy delta: `+1 + -1 = 0`.
- Purge delta: -7.
- Popular drag: -0.25.
- Total: -7.25, so confidence goes from 75 to 67.75. Still stable.

The next turn nothing is queued but popular legitimacy is 12: drag -0.5, confidence 67.25. A mandate renewal later adds +5 up to the cap of 95.

## Lifecycle hooks

- `installNewLeader(db, countryId, leaderId, officeType, partyId, turn)`: fresh confidence of 75, replacing any existing state for that leader. Called when a new PM is seated (`src/lib/turn/parliamentaryGovernment.ts`), and by the self-heal in `onePartyBillLifecycle.ts` when a formed government has no state row.
- `renewLeaderMandate(db, countryId, leaderId, ...)`: +5 bump (capped at 95), or the country's `renewalBumpOverride` from `resolveRenewalBumpForCountry` when the constitutional reform action has set one. Called when the seated leader is confirmed for another term. If the leader differs from the stored one it reinstalls at 75 instead. Increments `renewalCount`.
- Reunification: when the leader's state absorbs another, the carried head of government takes `REUNIFICATION_BUMP` = +10 (`src/lib/settlement/actuate.ts`).
- `adjustLeaderConfidence(db, countryId, leaderId, delta, reason, turn)`: arbitrary delta with a history entry, clamped to 0..95. Used by the turn driver, the five liberalization reform actions (`src/lib/onePartyState/reformActions.ts`), the stage decision events (`src/lib/onePartyState/decisionEvents/`), the voluntary constitutional convention, and economic system reform (`src/lib/economy/economicSystemReform.ts`).

## Timing

`processOnePartyBillLifecycleForCountry(countryId, now)` (`src/lib/turn/onePartyBillLifecycle.ts`) runs each turn for every one-party country as that country's bill phase. `COUNTRY_BILL_PHASES` in `src/lib/turn/countryPhases.ts` registers per-country wrappers such as `cnBillLifecycle` and `ddBillLifecycle`; RU goes through `src/lib/countries/ru/billLifecycle.ts`. Inside `processCountryBills`, the order is:

1. Self-heal: ensure a leader-state row exists for the seated leader.
2. Resolve expired lower-chamber bills through the bill lifecycle engine (enact or fail). The enacted policy categories feed the next steps.
3. `processCountryPopularDrift`: popular legitimacy ticks first, so the next step reads a fresh value.
4. `processCountryConfidenceDrift`: loads unprocessed purge events, calls `processRulingPartyConfidenceTurn` (`src/lib/turn/rulingPartyConfidenceTurn.ts`), which loads the country's profile and axis effects, runs `computeTurnDrift`, applies the total through `adjustLeaderConfidence`, and returns drift details and the consequence level.
5. Purges are marked `processed` only if a leader existed and the drift applied. With no leader, they stay queued for the first PM.
6. `processCountryEscalation`: the regime escalation tick reads the post-drift popular legitimacy and confidence.

Mandate renewals and installs happen in the parliamentary government phase when a PM is confirmed or seated, so they land before or after the drift tick depending on which phase runs first that turn; both write through the same history log.

## Edge cases and limits

- **Cap and floor:** confidence is clamped to 0..95 on every write. A renewal at 92 gives 95, not 97. At 0, further negative drift changes nothing, and no automatic removal fires.
- **No natural recovery.** Nothing drifts confidence upward on its own. Only well-aligned bills (+1 each), renewals, reunification and reform or decision effects raise it.
- **No leader installed:** the confidence tick returns nothing and purges stay queued.
- **Unknown bill category:** uses the empty default effects, score 0, delta 0.
- **Several bills in one turn:** each bill's delta is summed, so many aligned bills can add several points in a turn.
- **Consequence ladder is informational.** `challenge_risk`, `appointment_resistance` and `forced_crisis` are labels shown on the executive hub (`OnePartyExecutiveHub.tsx`) and API. Discipline modulation and forced-transition triggers are not wired to them. Regime collapse comes from the separate escalation state machine, which reads confidence and popular legitimacy.
- **History cap:** only the newest 50 entries are kept.
- **Banned-party NPPs** do not vote in federal bills in a one-party state (`src/lib/turn/npp/billVoting.ts`), which affects which bills pass and so what feeds drift.

## Connections

**Driven by**
- [One-party states](./one-party-states-as-shipped.md): which countries run the regime, ruling and approved party status, and the reform and decision actions that adjust confidence.
- [Bills and legislation](./bills-legislation.md): enacted bill categories feed alignment through `engineResult.enactedCategories` in `onePartyBillLifecycle.ts`.
- Popular legitimacy drivers: the popular drag reads `state.popularLegitimacy`, which `processCountryPopularDrift` updates first.
- [Parliamentary government](./parliamentary-government.md): PM seating and confirmation call `installNewLeader` and `renewLeaderMandate`.
- Settlement and reunification: `src/lib/settlement/actuate.ts` credits +10.

**Affects**
- Regime escalation: the escalation tick reads post-drift confidence and popular legitimacy and advances stage dwell counters.
- Popular legitimacy: purges are also read by the popular driver (`mapPurgeEventsToInput`), where anti-corruption purges count as a public benefit.
- Executive hub and API: confidence, band and consequence level are surfaced (`src/app/api/country/[code]/executive/route.ts`).

## File map

| File | Role |
| --- | --- |
| `src/lib/onePartyState/rulingPartyConfidence.ts` | pure constants, bands, clamp and bump helpers |
| `src/lib/onePartyState/rulingPartyPriorities.ts` | profile and axis-effect types, drift math, purge severity, consequences |
| `src/lib/turn/rulingPartyConfidence.ts` | install, renew and adjust helpers; `renewalBumpOverride` lookup; re-exports the pure surface |
| `src/lib/turn/rulingPartyConfidenceTurn.ts` | per-turn driver, reads country config |
| `src/lib/turn/onePartyBillLifecycle.ts` | turn driver iterating one-party countries |
| `src/app/api/admin/country/[code]/ruling-party-purge/route.ts` | admin insert for purge events |
| `src/app/api/admin/country/[code]/one-party-readiness/route.ts` | admin diagnostic |
| `countryLeaderStates` (MongoDB) | per-leader confidence state |
| `rulingPartyPurgeEvents` (MongoDB) | purge event queue |

## Adding a new one-party country

To onboard a second one-party country (call it "XX"):

1. Set `governmentType: "onePartyState"` and `rulingPartyId: <seq>` on `COUNTRY_CONFIGS.XX`.
2. Populate `XX.priorityProfile` with the country's 9-axis profile (axes can differ from CN's; weights must sum to 1.0).
3. Populate `XX.policyAxisEffects` with the country's policy-category to axis-delta map.
4. If the country has a CN-style regional budget (local tax retention plus central transfer), populate `XX.onePartyRegionalBudget` and call `processCNRegionalBudgets` from the country's turn phase. (File name pending a future rename; the function reads the budget knobs from config so the same processor handles XX.)
5. Seed parties with `regimeStatus` values (one `"ruling"`, others `"approved"` or `"banned"`).
6. Register a per-country entry in `COUNTRY_BILL_PHASES` bound to `processOnePartyBillLifecycleForCountry("XX", now)`.

No subsystem-code changes are required.

Last checked: 2026-10-29, version 1.18.0
