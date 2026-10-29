# One-Party States (as shipped)

## Summary

Twelve countries run as one-party states: CN, RU, DD, PL, CS, HU, RO, BG, YU, UKR, BLR and BAL. In those countries one party rules by right, other parties are tolerated or banned rather than competitive, and the head of government answers to the party rather than to the electorate. Two scalars drive everything: ruling-party confidence in the leader, and popular legitimacy. When they fall far enough the regime walks a four-stage escalation chain that can end in the country converting to a parliamentary republic, and the escalation chain never reverses on its own. Where the command-economy flag is on, the same countries also run a planned economy with administered prices, a wage-fund throttle on cash, and a monetary overhang that feeds back into political legitimacy.

Player guide: [One-Party States](https://www.ahousedividedgame.com/wiki/one-party-states)

Scope note: the seed marks all twelve countries `onePartyState`, but the leader-confidence model flag is on only for CN, RU and DD (see Configuration), the popular-mood profile exists for nine of them, and the forced conversion target and the faction split exist only for CN, RU and DD. Rules below say which part applies to which set.

## Rules

### Which countries, and what runs for them

`governmentType: "onePartyState"` is set on twelve entries in the country seed (`src/lib/constants/countryRuntimeSeed.ts`; the type itself is in `src/lib/constants/countriesCore.ts`). The runtime value lives on the `countryState` collection, not in config, so a country that converts mid-game stops behaving as a one-party state on the very next turn.

Each country registers a per-turn bill-lifecycle binding in `src/lib/turn/onePartyBillLifecycle.ts`: `processCNBillLifecycle`, `processDDBillLifecycle`, then `PL`, `CS`, `HU`, `RO`, `BG`, `YU`, `UKR`, `BLR`, `BAL`. RU is re-exported from `src/lib/turn/ruBillLifecycle.ts`. They all end in `processOnePartyBillLifecycleForCountry(countryId, now)`, which re-reads `governmentType` from `countryState` and returns immediately if the country is no longer one-party.

Most of these legislatures are unicameral: a bill passes the single chamber by the cast-votes majority rule and enacts with no assent delay. RU is the exception. Its Supreme Soviet is bicameral (`legislature.bicameral` plus `upperElectionSystem`), so a bill must clear both chambers and a second-chamber rejection kills it outright, because a one-party state has no override chamber. The union republics (UKR, BLR, BAL) are unicameral: their Presidium is a standing organ of the same chamber, not a second house.

### What a player sees in the executive hub

Every one-party country renders the shared `OnePartyExecutiveHub` at `/country/[code]/executive` (`src/app/country/[code]/executive/OnePartyExecutiveHub.tsx`). The per-country copy comes from `src/lib/constants/onePartyExecutiveSurface.ts`, which carries bespoke surfaces for CN, RU and DD and derives a complete surface from `COUNTRY_CONFIGS` for the rest, so adding a one-party country needs no new hub.

- CN: Premier, "NPC Delegate", Chinese Communist Party, plus a President plaque auto-synced to the party chair, a Chairman of the NPC Standing Committee plaque (`chair_npcsc`) and a CPPCC chair plaque (`chair_cppcc`).
- RU: Premier, "Supreme Soviet Deputy", Communist Party of the Soviet Union, with a Chairman of the Presidium elected by a joint sitting.
- DD: General Secretary, "Volkskammer Deputy", Socialist Unity Party of Germany, with a Chairman of the Council of State synced to the SED chair.

The head-of-state seat is filled per `headOfStateSelection` (`src/lib/constants/countries.ts`): `"partyChairSync"` reconciles it to the ruling party's chair every turn, `"legislatureAppointment"` seats it through a chamber vote mirroring the premier flow. The hub also carries a Ruling-Party Confidence panel and, in `RegimeHealthTab.tsx` beside it, the regime stage, dwell counters, active decision and convention state.

### The two scalars

| Constant | Value | Source |
| --- | --- | --- |
| `INITIAL_CONFIDENCE` | 75 | `src/lib/onePartyState/rulingPartyConfidence.ts` |
| `MIN_CONFIDENCE` / `MAX_CONFIDENCE` | 0 / 95 | same |
| `RENEWAL_BUMP` | +5 on leader renewal (+2 after the constitutional amendment) | same |
| `MAX_HISTORY_ENTRIES` | 50 confidence history rows | same |
| Confidence bands | 80+ secure, 65+ stable, 50+ watchful, 35+ strained, 20+ crisis, below 20 critical | same |
| `INITIAL_POPULAR_LEGITIMACY` | 75 | `src/lib/turn/popularLegitimacy.ts` |
| `MIN_POPULAR_LEGITIMACY` / `MAX_POPULAR_LEGITIMACY` | 0 / 100 | same |
| `MAX_POPULAR_HISTORY_ENTRIES` | 50 | same |
| `POPULAR_RECOVERY_TARGET` / `POPULAR_RECOVERY_RATE` | 60 / 0.1 per turn | same |
| `POPULAR_BANDS` (shown to players) | 75+ strong, 36+ discontent, 16+ crisis, below 16 collapsing | same |

Natural recovery moves popular legitimacy by `(60 - popular) * 0.1` each turn, which is negative above 60. The other drift inputs (economy, repression, policy alignment, election credibility, purges, enacted bills) are in `src/lib/turn/popularLegitimacyDrivers.ts` and `src/lib/turn/popularLegitimacyDriverCollectors.ts`; the confidence side is in `src/lib/turn/rulingPartyConfidenceTurn.ts` and [ruling-party-confidence.md](./ruling-party-confidence.md).

### Purges

Purges are simulation events, not data deletions. `POST /api/admin/country/[code]/ruling-party-purge` inserts one row into `rulingPartyPurgeEvents` with a severity, a reason and an optional target count. The route rejects any country that is not a one-party state.

Confidence deltas, from `PURGE_SEVERITY_DELTA` in `src/lib/onePartyState/rulingPartyPriorities.ts`:

| Severity | Confidence delta |
| -------- | ---------------- |
| minor    | -2               |
| regional | -4               |
| senior   | -7               |
| faction  | -10              |
| extreme  | -15              |

Purges also carry a `kind` (`discipline`, `anticorruption`, `faction`, `ideological`) written by `recordPurgeEvent` in `src/lib/onePartyState/partyEffectAdapters.ts`. The popular driver treats `anticorruption` as a public benefit rather than repression. Unprocessed purges are folded into both drifts and marked `processed: true` only once a leader exists to absorb them, so a purge backlog inherited by the first premier is never lost or double-counted.

### Escalation: four stages

The state machine is defined in `src/lib/db/types/regimeEscalation.ts` (one document per country, `_id === countryId`) and the pure math in `src/lib/turn/regimeEscalation.ts`. Stages: `stable`, `discontent`, `crisis`, `internalChallenge`, `collapse`. It is forward-only: raw scalar recovery never regresses a stage, only an explicit decision does, which stops a country from oscillating every turn around a threshold.

`STAGE_THRESHOLDS` in `src/lib/turn/regimeEscalation.ts`:

| Stage | Entry condition | Dwell |
| --- | --- | --- |
| 1 discontent | popular `<= 60` | `stage1` counter reaches 12 |
| 2 crisis | popular `<= 35` | `stage2.sustained` reaches 36, or `stage2.cumulativeIn168` reaches 48 (window 168) |
| 3 internal challenge | party confidence strictly `< 15` | `stage3` counter reaches 24 |
| 4 collapse | popular strictly `< 15`, current stage must be `internalChallenge` | `stage4` counter reaches 72 |

Counter rules (`updateDwellCounters`):

- Each counter goes up by 1 on a turn that meets its entry condition and down by 1 (floor 0) on a turn that does not.
- `stage2.cumulativeIn168` goes up by 1 on a turn at or below 35, capped at the window size 168. On recovery turns it drops by 1 only when its current value is a multiple of 4 (see Known issues).
- The `stage4` counter is frozen entirely while `conventionInProgress` is true.
- `computeNextStage` checks the highest stage first and is forward-only, so a country meeting several entry conditions at once jumps straight to the worst. Stage 3 can be entered from `stable`, `discontent` or `crisis`.

### Decisions

Each stage transition offers the leader one decision (`src/lib/onePartyState/decisionQueue.ts`, handlers in `src/lib/onePartyState/decisionEvents/`). Only one decision is active at a time; further ones sit in a passive queue and promote on resolution. `DECISION_TIMEOUT_TURNS = 48`: if the leader does nothing, the stage's default option fires automatically.

Stage 1, `stage1.addressDiscontent` (default `ignore`):

- Acknowledge and promise reform: -2 confidence, +3 popular, and sets `pendingReformDiscount` at 0.5x for the current turn, halving the next reform's intra-party cost.
- Crack down: -1 popular, one `minor` `discipline` purge, popular decay multiplier 0.5x for 24 turns.
- Ignore: popular decay 1.25x for 24 turns, plus 2 extra Stage 1 dwell.

Stage 2, `stage2.respondToUnrest` (default `ignore`):

- Open dialogue: -3 confidence, +6 popular, Stage 2 dwell decay doubled for 48 turns.
- Selective concession: legalize a chosen banned party (`payload.bannedPartyId`), -5 confidence, +10 popular, and a country-history entry tagged to the beneficiary party.
- Martial law: -8 popular plus an `extreme` `discipline` purge, in exchange for popular decay 0x (frozen) for 72 turns and a Stage 3 block (`stage3Block`) for the same 72 turns. If the Stage 3 dwell counter is already past threshold when the block lapses, this only bought time.
- Ignore: popular decay 1.5x for 48 turns.

Stage 3, `stage3.respondToFactionSplit` (default `ignore`):

- Negotiate power-sharing: -4 confidence, +8 popular.
- Purge defectors: bans the breakaway party and records an `extreme` `faction` purge; no direct popular benefit.
- Concede leadership: installs the successor, +5 popular.
- Ignore.

Stage 4, `stage4.faceCollapse` (default `acceptPeacefully`):

- Resist: -25 confidence, -20 popular, an `extreme` `faction` purge, bans every approved party, and delays conversion by `RESIST_DELAY_TURNS = 48` turns.
- Accept peacefully: no direct cost; sets `conversionPendingAtTurn` so conversion fires on the next tick.

### Faction split

Entering Stage 3 fires `fireFactionSplit` (`src/lib/onePartyState/factionSplit.ts`). It picks `max(3, ceil(15% of ruling-party officials))` defectors by divergence score, spawns a new approved party under the country's `factionDefectionName` (CN: "Democratic Faction of the CCP"; RU: "Reformist Faction of the CPSU"; DD: "Reform Wing of the SED"; all in each country's `institutionsFacts.ts`) seeded from the defectors' own axis positions, not the ruling party's, and reassigns each defector's party field. Only character-held seats defect; NPP-held seats have a null `characterId` and are skipped. The split no-ops when the country has no `factionDefectionName`, no ruling party, or no officials.

Who actually leaves is decided in `src/lib/onePartyState/factionDivergence.ts`, two pure (DB-free) kernels:

- `scoreDivergence(official, line)`: Manhattan distance between an official's own (economic, social) axis position and the ruling party's line, divided by `MAX_DISTANCE = 20` and clamped to 0..1 (axes run -5..+5, `AXIS_SCALE = 5`). An official with no recorded axis position scores 0, since absence of a position is not evidence of disloyalty. Treating a null as maximally distant would purge NPC-imported officials first.
- `applyCaucusCohesion(scored, weight = CAUCUS_COHESION_WEIGHT)`: `adjusted = individual * (1 - w) + caucusMean * w`, with `CAUCUS_COHESION_WEIGHT = 0.6`, so a faction leaves together rather than as scattered individuals who happen to cross the line alone. Officials in no caucus keep their unmodified individual score.

The defector count is then taken by highest cohesion-adjusted divergence, ties broken by input order. `factionCentreOfGravity` averages the defectors' own axis positions (rounded to 0.1, falling back to the ruling party's line only when no defector has a recorded position) to seed the new party's ideology, so the breakaway faction is ideologically distinct from the party it left rather than a renamed copy of it.

### Liberalization reforms

Five actions in `src/lib/onePartyState/reformActions.ts` are available to the ruling-party leader at any time while the country is still one-party. Each trades intra-party confidence for public standing, and most leave a per-turn popular boost with a hard expiry. Cooldowns live on `countryState.reformCooldowns` (`src/lib/onePartyState/reformCooldowns.ts`).

| Action                   | Confidence | Popular | Per-turn boost   | Cooldown                |
| ------------------------ | ---------- | ------- | ---------------- | ----------------------- |
| Legalize a banned party  | -6         | +8      | +0.2 for 120 t   | 168 turns, per party id |
| Reduce vote multipliers  | -4         | +4      | +0.15 for 96 t   | 240 turns               |
| Honest by-election       | -3         | +5      | none             | 96 turns                |
| Anti-corruption purge    | -2         | +3      | none             | 72 turns                |
| Constitutional amendment | -8         | +12     | +0.3 for 240 t   | one time only           |

The anti-corruption purge records a `minor` `anticorruption` purge event rather than deleting anything. The constitutional amendment is permanent in a second way: it writes `renewalBumpOverride: 2` (`CONSTITUTIONAL_AMENDMENT_RENEWAL_BUMP`), so every future leader renewal in that country grants +2 confidence instead of +5. Stage 1's acknowledge option halves the next action's confidence cost, and the discount is consumed on use.

### Elections, vote multipliers and NPPs

Elections still run in one-party states, but they are weighted. `resolveRegimeMultiplier` in `src/lib/turn/onePartyConstraints.ts` reads `countryState.opsVoteMultipliers`, defaulting to `DEFAULT_OPS_VOTE_MULTIPLIERS` (`src/lib/constants/countriesCore.ts`):

| Tier | Multiplier |
| --- | --- |
| ruling | 3.0 |
| approved | 0.375 |
| independent | 0.0 |
| banned | 0.0 |

Independents (no party document) are weighted like banned parties. The same module holds the hard gates:

- `canFormGovernment`: ruling party only.
- `canTriggerNoConfidence`: ruling party only.
- `canCollapseGovernment`: always false, so the generic coalition-loss collapse path never fires.
- `canFieldExecutiveCandidate`: premier and president races are ruling-party only; other offices are open to anything not banned.
- `canFieldLegislativeCandidate`: ruling or approved parties only, which blocks independents at filing.
- `canInviteToCoalition`: ruling party only.

Reduce vote multipliers steps the ruling weight down one rung of `RULING_MULTIPLIER_LADDER` in `src/lib/onePartyState/reformPrimitives.ts`: 3.0, 2.0, 1.5, 1.0, with 1.0 as the floor. Approved, independent and banned weights are untouched: the reform loosens ruling privilege, it does not enfranchise banned parties. Honest by-election writes a one-shot `pendingHonestByElection: { atMultiplier: 1.0 }`, which `src/lib/electionEngine/candidateEnrichment.ts` reads, applies as a flat override on every regime multiplier for that election, and then clears.

NPPs (the game's AI-run politicians) file, hold seats and are enriched with their own policy positions exactly as elsewhere. Two one-party specifics: an NPP-held seat carries a null `characterId` and therefore cannot defect in a faction split, and a banned party's NPP seat-holders have `currentOffice` cleared like any other holder. Most Eastern-bloc satellites are largely NPP-governed, so the NPP brain is what actually operates the planned economy there, using `NPP_DEFAULT_REFORMISM = 0` and `NPP_DEFAULT_INTERNAL_REPRESSION = 0.5` when no player directive exists (`src/lib/constants/commandEconomy.ts`; the same file sets `NPP_DEFAULT_CREDIT_AGGRESSIVENESS = 0.55` and `NPP_DEFAULT_BUDGET_SOFTNESS = 0.85`).

### Banning and unbanning parties

`processBanPartyEffects` (`src/lib/onePartyState/banFlow.ts`) makes a party inert: it deletes every `electedOfficials` document for that party, clears `currentOffice` on the holders, clears `autoRunForReelection` so the auto-re-entry pass does not silently re-file them next turn, and flips the party document to `regimeStatus: "banned"` with `bannedAt`, `bannedReason` and `bannedAtTurn`. There is no by-election machinery in AHD, so vacated seats stay empty until the next regular cycle for that office. Unbanning flips the status back to `approved` and clears the audit fields; it does not restore any seats.

### Constitutional convention: the voluntary exit

`src/lib/onePartyState/constitutionalConvention.ts` runs three phases, with shared limits in `src/lib/onePartyState/conventionRules.ts`.

1. `announced`: player-initiated. Sets `conventionInProgress: true` (freezing the Stage 4 dwell counter), parks a draft deadline `CONVENTION_DRAFT_PHASE_TURNS = 48` turns out, and applies `ANNOUNCE_POPULAR_BUMP = +15` popular and `ANNOUNCE_INTRA_COST = -10` confidence. Blocked if the country is already in `collapse` (that would race the forced path) or if a convention is already running. Defaults come from config: `legacyReservationDefault` (20 for CN, RU and DD) and `electionDelayDefault` (24).
2. `draft`: locks in a `targetSystem` from `collapseTargetAllowlist` (CN and RU: `parliamentaryRepublic` or `presidential`; DD has only `collapseTargetSystem: "parliamentaryRepublic"`), a `legacyReservation` in 0..`CONVENTION_LEGACY_RESERVATION_MAX = 35`, and an `electionDelayTurns` from `CONVENTION_ELECTION_DELAYS` (12, 24 or 48). If the deadline passes, the tick advances to ratification anyway.
3. `ratification`: at `draftDeadlineTurn + electionDelayTurns` the tick fires the conversion with `path: "voluntary"`.

### Conversion: one way out of the chain

`triggerSystemConversion` in `src/lib/onePartyState/systemConversion.ts` does four things: sets the new `governmentType`, nulls `opsVoteMultipliers` and sets `hasLeaderConfidenceModel: false` (which is what switches off the leader-confidence installation); clears `regimeStatus` on every party in the country (`clearAllRegimeStatusForCountry` in `src/lib/onePartyState/regimeStatusReset.ts`, which sets the field to `null` rather than unsetting it, so legacy readers still find a sentinel instead of `undefined`); writes a `regime_escalation` history event with `subtype: "conversion"`; and calls `bootstrapNewSystem` (`src/lib/onePartyState/conversionBootstrap.ts`) to park the snap-election marker. No rows are deleted, so the history survives.

The forced path, `checkForcedConversion`, fires on either of two conditions: Stage 4's accept-peacefully set `conversionPendingAtTurn` and that turn has arrived, or the country has sat in `collapse` with no convention and any `stage4Delay` window has elapsed. It does nothing for a country with no `collapseTargetSystem`. Forced constants:

| Constant | Value | Source |
| --- | --- | --- |
| `FORCED_LEGACY_RESERVATION` | 5 seats | `src/lib/onePartyState/systemConversion.ts` |
| Halved reservation | 3 (`FORCED_LEGACY_RESERVATION_HALVED`) when a resist delay was recorded | same |
| `FORCED_VOTE_SHARE_PENALTY` | -0.2 on the former ruling party's first post-conversion election | same |
| `FORCED_ELECTION_DELAY_TURNS` | 12 | same |

Both paths are idempotent: the pending marker and the delay marker are cleared once consumed. `bootstrapNewSystem` writes `pendingPostConversionElection` on `countryState` with the target turn (`atTurn`), the legacy reservation, the former ruling party id (captured before the flip nulls it), the forced penalty and the path. The election engine consumes it (`src/lib/turn/postConversionElections.ts`).

The reverse direction exists outside this chain: `installOnePartyState` (`src/lib/onePartyState/installOnePartyState.ts`) turns a country into a one-party state, restoring exactly what conversion clears. It is used by peace terms and by reunification, not by escalation.

### Command economy

Everything in this subsection is gated behind the `commandEconomyEnabled` GameConfig flag. The regime is a dial, not a switch. `marketizationLevel` runs 0 (fully command) to `MARKET_LEVEL = 100`, with bands at `COMMAND_CEILING = 30` and `DUAL_TRACK_CEILING = 70` (`src/lib/constants/commandEconomy.ts`). Below 30 the country is fully command, 30 to 70 is dual-track (plan and market engines split by `plannedShare`), 70 and above runs the standard market engine.

`MARKETIZATION_SCHEDULE` (`src/lib/constants/marketizationSchedule.ts`) gives each country a trajectory; each level applies for years up to and including `throughYear`, then the country is fully market:

| Country | Steps |
| --- | --- |
| RU, UKR, BLR, BAL | level 10 through 1991 |
| CN | 10 through 1978, 50 through 1992, 85 through 2018 |
| DD | 10 through 1990 |
| PL | 12 through 1989 |
| HU | 15 through 1989 |
| CS | 10 through 1989 |
| BG | 10 through 1990 |
| RO | 8 through 1989 |
| YU | 20 through 1964, 35 through 1990 |

The level is not read straight from the schedule. It is stored per country and drifts each turn (`marketizationDrift` plus a weak pull back to the schedule, `marketizationGravity`):

- `MARKETIZATION_DRIFT_WEIGHTS`: black-market pressure 0.22, SOE plan shortfall 0.18, policy stance 0.12.
- `MARKETIZATION_GRAVITY_RATE = 0.004` per level-point of gap, capped at `MARKETIZATION_GRAVITY_MAX_STEP = 0.02` per turn.

Offices: three player seats operate the planned economy, mapped in `src/lib/constants/commandEconomyOffices.ts`: RU and DD use `chairman_of_gosplan` plus `gosbank_liaison`; CN uses `vice_premier` plus `pboc_governor`. SOE directors are appointed per enterprise onto `SoeState.directorId`, not to a fixed cabinet seat. Authorization is in `src/lib/economy/commandEconomyAuth.ts`: the Gosbank chair or the head of government may drive state credit; the Gosplan planner or the head of government may drive the plan and appoint SOE directors; only the SOE's own director drives that SOE; and internal repression is set by the head of government or the Gosbank chair, never by the planner alone (it is a security call, not a planning one). Lever ranges are clamped server side: credit aggressiveness 0..1, budget softness 0..1, labour-versus-quality 0..1, internal repression 0..1.

Administered prices (`src/lib/economy/administeredPricing.ts`): `price = basePrice * (1 + markup)` with `DEFAULT_TURNOVER_MARKUP = 0.12`, and no supply-and-demand response at all. The unmet demand at the held price is the shortage: `demandSupplyGapPct = (demand - supply) / (supply + 1) * 100` when demand exceeds supply, else 0. Turnover tax revenue is `basePrice * markup * suppliedUnits`, the state's main indirect revenue. In a dual-track country `dualTrackPrice = administered * w + market * (1 - w)` with `w = plannedShare` clamped to 0..1. This branch runs only on the country-scoped national-price leg, never on the shared global leg, because an administered price leaking into the world price is the naira 100x incident class of bug.

Two-circuit money (`src/lib/economy/twoCircuitMoney.ts`) models the Soviet split between enterprise non-cash money and household cash at the macro level as a wage-fund ceiling. With `cap = realGoodsGrowth + WAGE_FUND_SLACK_PP` (`WAGE_FUND_SLACK_PP = 2`), `wageFundConstrainedGrowth` returns the wage growth unchanged if it is at or under the cap, else `wage - plannedShare * (wage - cap)`. It never raises wage growth. A tight wage fund is the primary brake on forced saving.

Overhang, shortage and the second economy (`src/lib/economy/commandEconomyState.ts`):

| Constant | Value |
| --- | --- |
| `OVERHANG_DECAY` | 0.99 per turn (about a two-year horizon) |
| `OVERHANG_CAP` | 100 (`src/lib/economy/rules.ts`) |
| `PLAN_SHORTFALL_GOODS_DEFICIT` | 20 (percentage points of annual goods deficit per unit of plan shortfall) |
| `CREDIT_OVERHANG_SCALE` | 1.0 |
| `MAX_BLACK_MARKET_PREMIUM` | 2.0 (plus 200 percent over official) |
| `MAX_SECOND_ECONOMY_SHARE` | 0.6 of activity |
| `SECOND_ECONOMY_ADJUST` | 0.25 per turn toward target |
| `TURNS_PER_YEAR` | 48 (`src/lib/constants/calendar.ts`, re-exported by `turnTime.ts`) |

Formulas, with `shortfall = max(0, 1 - planFulfillment)`:

- `gap = wageGrowth - realGoodsGrowth + shortfall * 20`
- `flow = plannedShare * max(0, gap) / 48`
- `overhang' = clamp(overhang * 0.99 + flow + creditInjection - secondEconomyRelief, 0, 100)`
- `creditInjection = clamp(1.0 * (monetizedIssuance / planBase) * 100 * plannedShare, 0, 100)`
- `blackMarketPremium = clamp((0.8 * s + 0.2 * o) * 2.0 * (1 - 0.4 * tol), 0, 2.0)` with `s = shortageIndex / 100`, `o = overhang / 100`, `tol` the tolerance lever (default 0.3)
- `secondEconomyTarget = clamp(s * (0.2 + 0.6 * tol), 0, 0.6)`; `share' = share + (target - share) * 0.25`; `relief = share' * tol * 0.5 * overhang`

The readouts land on `FederalBudget.economicFactors` as `monetaryOverhang`, `shortageIndex`, `blackMarketPremium` and `secondEconomyShare`, and the dashboard presenter (`src/lib/economy/commandEconomyDashboard.ts`) turns them into the marketization gauge alongside SOE plan fulfillment and the government's policy stance.

Politics and economics meet through the drift collectors in `src/lib/turn/popularLegitimacyDriverCollectors.ts`: shortages and economic performance feed popular legitimacy, repression intensity feeds it the other way, and the resulting number is what walks the regime up the escalation chain.

## Data

| Collection | Fields read or written | Player visible |
| --- | --- | --- |
| `countryState` (`_id` is the country id) | `governmentType`, `rulingPartyId`, `opsVoteMultipliers`, `hasLeaderConfidenceModel`, `reformCooldowns`, `pendingReformDiscount`, `popularBoostModifiers`, `renewalBumpOverride`, `pendingHonestByElection`, `pendingPostConversionElection` | Government type and ruling party yes; the rest are leader-only diagnostics or internal |
| `countryLeaderStates` (`_id` is `${countryId}_${leader}`) | `partyConfidence`, `popularLegitimacy`, `confidenceHistory`, `startedAtTurn`, `lastRenewedAtTurn`, `renewalCount` | Band label to all; raw numbers to ruling-party leadership only |
| `regimeEscalation` (`_id` is the country id) | `currentStage`, `stageEnteredAtTurn`, `dwellCounters`, `conventionInProgress`, `convention`, `activeDecision`, `decisionQueue`, `transitionHistory`, `popularDecayModifier`, `stage2DwellDecayBoost`, `stage3Block`, `conversionPendingAtTurn`, `stage4Delay` | Stage and short description on the public overview; counters to leadership |
| `rulingPartyPurgeEvents` | severity, kind, reason, turn, target count, `processed` | No |
| `politicalParties` | `regimeStatus` (`ruling`, `approved`, `banned`, or `null` after conversion), `bannedAt`, `bannedReason`, `bannedAtTurn`, `sequentialId` | Tier badge yes |
| `electedOfficials` | deleted for banned parties; `party` rewritten on defection; `characterId` null for NPP seats | Yes |
| `governmentFormations` | head of government read to resolve the leader | Yes |
| `countryHistory` | `regime_escalation` with `from`, `to`, `popularLegitimacy`, `partyConfidence`, conversion subtype | Yes (country history feed) |
| `gameConfig` (`_id: "default"`) | `commandEconomyEnabled`, `commandEconomyEnabledBy`, `commandEconomyEnabledAt`, `commandEconomySecondEconomyTolerance` | No |
| `FederalBudget.economicFactors` | `monetaryOverhang`, `shortageIndex`, `blackMarketPremium`, `secondEconomyShare` | Via the command-economy dashboard |

Types: `src/lib/db/types/regimeEscalation.ts`, `src/lib/db/types/countryLeaderState.ts`, `src/lib/db/types/countryState.ts`.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `governmentType: "onePartyState"` | 12 countries | `src/lib/constants/countryRuntimeSeed.ts` |
| `hasLeaderConfidenceModel` | true for CN, RU, DD; false for the other nine | `src/lib/constants/countryRuntimeSeed.ts`, plus `hasLeaderConfidenceModel: true` in `src/lib/countries/{cn,ru,dd}/institutionsFacts.ts` |
| `popularMoodProfile` | set for CN, RU, DD, PL, CS, HU, RO, BG, YU; absent for UKR, BLR, BAL | `src/lib/countries/<id>/institutionsFacts.ts`. Without it the popular drift returns null |
| `factionDefectionName` | set for CN, RU, DD only | `institutionsFacts.ts` for each |
| `collapseTargetSystem` | `parliamentaryRepublic` for CN, RU, DD; unset elsewhere | `institutionsFacts.ts` for each |
| `collapseTargetAllowlist`, `legacyReservationDefault`, `electionDelayDefault` | CN and RU: allowlist of `parliamentaryRepublic` and `presidential`, 20, 24. DD: 20, 24 | same |
| `headOfStateSelection` | `partyChairSync` or `legislatureAppointment` per country | `src/lib/constants/countries.ts` |
| `opsVoteMultipliers` | `DEFAULT_OPS_VOTE_MULTIPLIERS` (3.0 / 0.375 / 0 / 0) | `src/lib/constants/countriesCore.ts`; per country on `countryState` |
| `confidenceVoteMechanism`, `snapElectionsAllowed` | false for `onePartyState` | defaults in `src/lib/constants/countriesCore.ts` |
| `commandEconomyEnabled` | Static seed value true (`src/lib/seeds/reference/gameConfig.ts`), but world bootstrap rewrites it to true only for the 1953 and 1979 eras and false otherwise (`isEasternBlocEra` in `src/lib/seeds/presetSelector.ts`, written in `src/lib/admin/bootstrapGameWorld.ts`). The type comment in `gameConfig.ts` says absent means off | `gameConfig` |
| `commandEconomySecondEconomyTolerance` | 0.3 when absent | `src/lib/db/types/gameConfig.ts` |
| Marketization schedule and drift weights | tables in Rules | `src/lib/constants/marketizationSchedule.ts`, `src/lib/constants/commandEconomy.ts` |
| Reform costs and cooldowns, decision effects | tables in Rules | `src/lib/onePartyState/reformActions.ts`, `src/lib/onePartyState/decisionEvents/` |

## Timing

Everything regime-related runs inside the per-country bill lifecycle binding (`processCountryBills` in `src/lib/turn/onePartyBillLifecycle.ts`), once per turn per one-party country. Reform actions and purges are player or admin triggered between turns and are folded in by the next tick. Elections are resolved by the normal election phases using the regime multipliers; the post-conversion election marker is consumed by the election engine in the post-conversion step of the turn (`src/lib/turn/postConversionElections.ts`). The parliamentary side (PM votes, freeze) is covered in [parliamentary-government.md](./parliamentary-government.md).

```
per turn, per one-party country (processCountryBills)
  1. ensureLeaderStateExists          (self-heal the leader-state row)
  2. runBillLifecycle                 (bill engine, returns enacted categories)
  3. processCountryPopularDrift       (needs popularMoodProfile)
  4. processCountryConfidenceDrift    (reads fresh popular value; folds in unprocessed purges)
  5. processCountryEscalation         (reads both post-drift values; advances stages,
                                       decision queue, convention phases, forced conversion)
```

The popular drift runs before the confidence drift so the popular-to-party coupling bleed reads a fresh value, and the escalation tick runs last so it reads both post-drift values.

## Worked trace

Escalation after a crash: popular legitimacy falls to 30 at turn T and stays; party confidence stays at 70. All counters start at 0.

| Turn | `stage1` | `stage2.sustained` | `stage2.cumulativeIn168` | `stage3` | Result |
| --- | --- | --- | --- | --- | --- |
| T | 1 | 1 | 1 | 0 | stable |
| T + 11 | 12 | 12 | 12 | 0 | `30 <= 60` and `12 >= 12`, so stage becomes `discontent`; Stage 1 decision offered |
| T + 35 | 36 | 36 | 36 | 0 | `30 <= 35` and `36 >= 36`, so `crisis`; Stage 2 decision offered |

Stage 3 never starts because confidence 70 is not below 15, so `stage3` stays at 0. If the leader ignores the Stage 1 decision, after `DECISION_TIMEOUT_TURNS = 48` turns the default fires: decay multiplier 1.25 for 24 turns and `stage1` dwell plus 2. Natural recovery pulls the other way at `(60 - 30) * 0.1 = +3.0` per turn before the other drivers, which is why a regime sitting at 30 needs sustained bad drivers to stay there.

Confidence deltas: a new leader starts at 75 (band stable). A regional purge (-4) gives 71, then a senior purge (-7) gives 64, which drops the band from stable (65+) to watchful. This is the direct delta before the next drift tick adds its own terms.

Faction split: a ruling party with 40 officials loses `max(3, ceil(0.15 * 40)) = 6`. An official at (3, -2) against a party line of (-1, 1) has distance `|3 - (-1)| + |-2 - 1| = 7`, divergence `7 / 20 = 0.35`. If three officials in one caucus score 0.35, 0.55 and 0.15, the caucus mean is 0.35 and the adjusted scores are `0.35 * 0.4 + 0.35 * 0.6 = 0.35`, `0.55 * 0.4 + 0.21 = 0.43` and `0.15 * 0.4 + 0.21 = 0.27`: the loyal member is pulled toward the group and the radical one is pulled back. Defectors at (3, -2), (2, -3) and (4, -1) seed the new party at their mean, (3.0, -2.0).

Command economy, one turn: previous overhang 20, wage growth 8, real goods growth 3, `plannedShare` 1, plan fulfillment 0.85, no relief or injection.

1. Wage fund: `cap = 3 + 2 = 5`; wage 8 exceeds it, so constrained growth is `8 - 1 * (8 - 5) = 5`.
2. `shortfall = 0.15`; goods deficit `0.15 * 20 = 3.0`; `gap = 8 - 3 + 3.0 = 8.0`; `flow = 1 * 8.0 / 48 = 0.1667`.
3. `overhang' = 20 * 0.99 + 0.1667 = 19.9667`.
4. Shortage index 40, tolerance 0.3: `s = 0.4`, `o = 0.1997`; premium `(0.8 * 0.4 + 0.2 * 0.1997) * 2.0 * (1 - 0.12) = 0.6335` (63 percent over official).
5. Second economy from share 0.10: target `0.4 * (0.2 + 0.18) = 0.152`; `share' = 0.10 + (0.152 - 0.10) * 0.25 = 0.113`; relief `0.113 * 0.3 * 0.5 * 19.9667 = 0.338`, applied in the next turn's overhang.
6. Prices: base 100 gives an administered price `100 * 1.12 = 112`. With supply 80 and demand 100 the gap is `20 / 81 * 100 = 24.7` percent, and turnover revenue is `100 * 0.12 * 80 = 960`. In a dual-track country at `plannedShare` 0.5 with market price 130 the blended price is `112 * 0.5 + 130 * 0.5 = 121`.

Forced conversion: Stage 4 is reached and the leader accepts peacefully at turn C. On the next tick conversion fires with legacy reservation 5 seats, vote-share penalty -0.2 and `electionAtTurn = C + 12`. Had the leader chosen Resist, the delay would hold conversion until C + 48 and the reservation would be 3.

## Edge cases and limits

- Confidence is clamped 0..95 and popular legitimacy 0..100; neither can be pushed outside by purges or reforms.
- Stages never regress on recovery, only by decision. Stage 4 is reachable only from `internalChallenge`.
- Starting a convention is blocked in `collapse` and while another convention is running, because it would race the forced conversion.
- A country that converts stops being one-party on the next turn: the bill binding re-reads `governmentType` and returns early. No rows are deleted. Only `installOnePartyState` reverses it.
- A one-party country with no `collapseTargetSystem` (the nine other than CN, RU and DD) can reach `collapse` but `checkForcedConversion` returns without converting.
- Banning deletes the party's `electedOfficials` and leaves seats empty until the next regular cycle, because the game has no by-election machinery. Unbanning restores the status, not the seats.
- NPP-held seats cannot defect in a faction split (null `characterId`).
- An official with no axis position scores 0 divergence, so imported officials are not purged first.
- Without `commandEconomyEnabled` the whole command-economy section is inert, and the 12 countries still run the political regime.
- The constitutional amendment reform is one-time and permanently lowers the renewal bump from 5 to 2.
- Independents are blocked at legislative filing and weighted 0.0 at the count.
- No-confidence votes can only be moved by the ruling party, and `canCollapseGovernment` is always false.

## Invariants

- Confidence stays in 0..95 and popular legitimacy in 0..100: enforced by `clampConfidence` and `clampPopular`, tested in `src/lib/turn/rulingPartyConfidence.test.ts` and `src/lib/turn/popularLegitimacy.test.ts`.
- A stage never decreases through scalar recovery: `computeNextStage` is forward-only, tested in `src/lib/turn/regimeEscalation.test.ts`.
- Only one decision is active per country, the rest are queued: `src/lib/onePartyState/decisionQueue.test.ts`.
- A purge is applied once: the `processed` flag is set when a leader absorbs it. No dedicated test for the backlog inheritance case.
- Conversion is idempotent: markers are cleared once consumed, covered by `src/lib/onePartyState/conversion.e2e.test.ts` and `systemConversion.test.ts`.
- Conversion deletes no rows: not enforced by a test beyond the e2e path.
- Reduce vote multipliers cannot go below 1.0: `setRulingPartyVoteMultiplierTier` throws at the floor; tested in `reformPrimitives.test.ts`.
- Overhang stays in 0..100 and is finite for non-finite inputs: `src/lib/economy/commandEconomyState.test.ts` ("stays finite and within [0, OVERHANG_CAP]").
- Administered prices never reach the global price leg: not enforced by a test that crosses the two legs; guarded by code structure only.

## Failure and recovery

- **Leader-state row missing** (for example an admin-installed premier): every regime driver would silently skip. `ensureLeaderStateExists` self-heals the row at the top of each tick.
- **Stage stuck or decision never resolving:** the 48 turn decision timeout fires the default option automatically; a stale decision can be cleared by a data repair of the `regimeEscalation` document.
- **Countries left in `collapse` with no conversion** (no `collapseTargetSystem`): the document stays in `collapse`; a staff repair either converts the country or resets the stage.
- **Wrong flags after conversion:** `hasLeaderConfidenceModel` and `opsVoteMultipliers` are rewritten by `triggerSystemConversion`; a migration (`adopt-one-party-confidence-model`) realigned the flag for one-party states that shipped without it.
- **Banned party seats lost by mistake:** unbanning does not restore seats; recovery is a manual seat repair or waiting for the next regular cycle.
- **Command economy flag wrong for the era** (for example off in a 1979 world): the planned-economy seeds do not run; fix is toggling the flag and reseeding the budgets for the affected countries.
- **Administered price leaking to world price:** previously caused a large currency incident; the branch is restricted to the country-scoped leg and any leak is repaired by recomputing prices and re-running the affected turn's pricing step.

## Connections

**Driven by:**

- [Ruling-party confidence](./ruling-party-confidence.md): the confidence drift in `rulingPartyConfidenceTurn`.
- [Parties](./parties.md): party tiers (ruling, approved, banned) in `onePartyConstraints.ts`.
- [NPPs](./npp-system.md): NPP brain operates the planned economy where no player directive exists.
- Peace terms and reunification: `installOnePartyState` turns a country into a one-party state.

**Affects:**

- [Parliamentary government](./parliamentary-government.md): one-party states count as parliamentary through `isParliamentarySystem`.
- [Constitutional convention](./constitutional-convention.md): the voluntary exit path to conversion.
- Elections: vote multipliers applied in `src/lib/electionEngine/candidateEnrichment.ts`; post-conversion marker consumed in `src/lib/turn/postConversionElections.ts`.
- Budget and prices: the command-economy readouts on `FederalBudget.economicFactors`.

## Tests

- Escalation: `src/lib/turn/regimeEscalation.test.ts`, `regimeEscalationTurn.test.ts`, `regimeEscalationTurn.nppJourney.test.ts`.
- Scalars: `src/lib/turn/popularLegitimacy.test.ts`, `popularLegitimacyDrivers.test.ts`, `popularLegitimacyDriverCollectors.test.ts`, `popularLegitimacyTurn.test.ts`, `rulingPartyConfidence.test.ts`, `rulingPartyConfidenceTurn.test.ts`, `rulingPartyPriorities.test.ts`.
- Bill lifecycle and gates: `src/lib/turn/onePartyBillLifecycle.test.ts`, `onePartyBillLifecycle.crossover.test.ts`, `onePartyBillLifecycle.democratic1991.test.ts`, `onePartyConstraints.test.ts`, `onePartyConstraints.parliamentary.test.ts`.
- Regime actions: `src/lib/onePartyState/reformActions.test.ts`, `reformCooldowns.test.ts`, `reformPrimitives.test.ts`, `decisionQueue.test.ts`, `factionSplit.test.ts`, `factionDivergence.test.ts`, `banFlow.test.ts`, `constitutionalConvention.test.ts`, `systemConversion.test.ts`, `conversionBootstrap.test.ts`, `conversion.e2e.test.ts`, `installOnePartyState.test.ts`, and the four stage handlers under `src/lib/onePartyState/decisionEvents/`.
- Hub: `src/lib/constants/onePartyExecutiveSurface.test.ts`, `src/app/country/[code]/executive/RegimeHealthTab.test.tsx`.
- Command economy: `src/lib/economy/administeredPricing.test.ts`, `twoCircuitMoney.test.ts`, `commandEconomyState.test.ts`, `commandEconomyAuth.test.ts`, `commandEconomyDashboard.test.ts`.

Gaps: the `stage2.cumulativeIn168` recovery rule has only a loose "at most 40" assertion; no test pins that the resist-delay halving depends on the popular value; the marketization drift and gravity have no cross-check against the schedule table here.

## Known issues and history

- `stage2.cumulativeIn168` erosion is weaker than its comment says. The code drops it by 1 only when the current value is a multiple of 4, so once it reaches a non-multiple (for example 20 to 19) it stays put through recovery. The comment and this page's earlier text describe "1 every 4 recovery turns". The 168-turn "sliding window" is a cap on the counter, not a true window that expires old turns.
- The Stage 4 Resist option sets `halveLegacyBonusIfStillBelow15` to true unconditionally, and `checkForcedConversion` halves the reservation whenever that flag is present. The code never re-checks that popular legitimacy is still below 15 when the delay ends, so the "if still below 15" condition in the design text is not enforced.
- Only CN, RU and DD have a forced conversion target, a faction defection name, convention defaults and the confidence model flag; the other nine one-party countries run the political gates and bills but the full escalation chain does not end in conversion for them.
- Three countries (UKR, BLR, BAL) have no `popularMoodProfile`, so their popular drift is skipped.
- The older version of this page said the Eastern Bloc presets enable the command economy and called the seed default fail-safe enabled. Code: the seed object says true, bootstrap overwrites it per era (true only for the 1953 and 1979 eras), and the type comment says the default is off.
- The older version of this page gave `DRAFT_PHASE_TURNS` as a constant in the convention module and listed the marketization schedule as holding only a subset of countries; the constant lives in `conventionRules.ts` as `CONVENTION_DRAFT_PHASE_TURNS`, and the schedule covers all twelve.
- Marketization is stateful (Command Economy v2): the level drifts on black-market pressure, SOE performance and policy stance and is pulled gently toward the schedule, instead of reading the schedule directly.

Last checked: 2026-10-29, version 1.18.0
