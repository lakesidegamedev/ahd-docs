# One-Party States (as shipped)

Twelve countries run as one-party states: CN, RU, DD, PL, CS, HU, RO, BG, YU, UKR, BLR and BAL. In those countries one party rules by right, other parties are tolerated or banned rather than competitive, and the head of government answers to the party rather than to the electorate. Two scalars drive everything: ruling-party confidence in the leader, and popular legitimacy. When they fall far enough the regime walks a four-stage escalation chain that can end in the country converting to a parliamentary or presidential republic, permanently. Where the command-economy flag is on, the same countries also run a planned economy with administered prices, a wage-fund throttle on cash, and a monetary overhang that feeds back into political legitimacy.

Player guide: [One-Party States](https://www.ahousedividedgame.com/wiki/one-party-states)

## Which countries, and what runs for them

`governmentType: "onePartyState"` is set on twelve entries in the country seed (`src/lib/constants/countryRuntimeSeed.ts`; the type itself is in `src/lib/constants/countriesCore.ts`). The runtime value lives on the `countryState` collection, not in config, so a country that converts mid-game stops behaving as a one-party state on the very next turn.

Each country registers a per-turn bill-lifecycle binding in `src/lib/turn/onePartyBillLifecycle.ts`: `processCNBillLifecycle`, `processRUBillLifecycle`, `processDDBillLifecycle`, then `PL`, `CS`, `HU`, `RO`, `BG`, `YU`, `UKR`, `BLR`, `BAL`. All of them call `processOnePartyBillLifecycleForCountry(countryId, now)`, which re-reads `governmentType` from `countryState` and returns immediately if the country is no longer one-party.

Most of these legislatures are unicameral: a bill passes the single chamber by the cast-votes majority rule and enacts with no assent delay. RU is the exception. Its Supreme Soviet is bicameral (`legislature.bicameral` plus `upperElectionSystem`), so a bill must clear both chambers and a second-chamber rejection kills it outright, because a one-party state has no override chamber. The union republics (UKR, BLR, BAL) are unicameral: their Presidium is a standing organ of the same chamber, not a second house.

## What a player sees in the executive hub

Every one-party country renders the shared `OnePartyExecutiveHub` at `/country/[code]/executive`. The per-country copy comes from `src/lib/constants/onePartyExecutiveSurface.ts`, which carries bespoke surfaces for CN, RU and DD and derives a complete surface from `COUNTRY_CONFIGS` for the rest, so adding a one-party country needs no new hub.

- CN: Premier, "NPC Delegate", Chinese Communist Party, plus a President plaque auto-synced to the party chair, a Chairman of the NPC Standing Committee plaque (`chair_npcsc`) and a CPPCC chair plaque (`chair_cppcc`).
- RU: Premier, "Supreme Soviet Deputy", Communist Party of the Soviet Union, with a Chairman of the Presidium elected by a joint sitting.
- DD: General Secretary, "Volkskammer Deputy", Socialist Unity Party of Germany, with a Chairman of the Council of State synced to the SED chair.

The head-of-state seat is filled per `headOfStateSelection`: `"partyChairSync"` reconciles it to the ruling party's chair every turn, `"legislatureAppointment"` seats it through a chamber vote mirroring the premier flow.

The hub also carries a Ruling-Party Confidence panel and, in `RegimeHealthTab.tsx`, the regime stage, dwell counters, active decision and convention state.

## The two scalars

Ruling-party confidence is defined in `src/lib/onePartyState/rulingPartyConfidence.ts`. A newly installed leader starts at `INITIAL_CONFIDENCE = 75`, the range is clamped to `MIN_CONFIDENCE = 0` .. `MAX_CONFIDENCE = 95`, renewal adds `RENEWAL_BUMP = 5`, and up to `MAX_HISTORY_ENTRIES = 50` history rows are kept. Bands: 80+ secure, 65+ stable, 50+ watchful, 35+ strained, 20+ crisis, below 20 critical.

Popular legitimacy (`src/lib/turn/popularLegitimacy.ts`) starts at `INITIAL_POPULAR_LEGITIMACY = 75` and clamps to 0..100.

Order per turn, in `processCountryBills`: run the bill engine, then the popular-legitimacy drift, then the ruling-party confidence drift (which reads the fresh popular value for its coupling bleed), then the regime escalation tick (which reads both post-drift values). The leader-state row is self-healed at the top of the tick via `ensureLeaderStateExists`, so an admin-installed premier does not silently skip every regime driver.

## Purges

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

## Escalation: four stages

The state machine is defined in `src/lib/db/types/regimeEscalation.ts` (one document per country, `_id === countryId`) and the pure math in `src/lib/turn/regimeEscalation.ts`. Stages: `stable`, `discontent`, `crisis`, `internalChallenge`, `collapse`. It is forward-only: raw scalar recovery never regresses a stage, only an explicit decision does, which stops a country from oscillating every turn around a threshold.

`STAGE_THRESHOLDS`:

- Stage 1 (discontent): popular <= 60, dwell 12 turns.
- Stage 2 (crisis): popular <= 35, sustained dwell 36 turns or cumulative 48 turns inside a 168-turn sliding window.
- Stage 3 (internal challenge): party confidence strictly below 15, dwell 24 turns.
- Stage 4 (collapse): popular strictly below 15, dwell 72 turns, only reachable from `internalChallenge`.

Dwell counters move by one per turn in each direction, except the Stage 2 cumulative counter, which erodes by 1 every 4 recovery turns instead of resetting: a regime that escaped Stage 2 once falls back in faster. The Stage 4 counter is frozen entirely while a constitutional convention is in progress. `computeNextStage` evaluates highest stage first, so a country meeting several entry conditions at once jumps straight to the worst.

## Decisions

Each stage transition offers the leader one decision (`src/lib/onePartyState/decisionQueue.ts`). Only one decision is active at a time; further ones sit in a passive queue and promote on resolution. `DECISION_TIMEOUT_TURNS = 48`: if the leader does nothing, the stage's default option fires automatically.

Stage 1, `stage1.addressDiscontent` (default `ignore`):

- Acknowledge and promise reform: -2 confidence, +3 popular, and sets `pendingReformDiscount` at 0.5x for the current turn, halving the next reform's intra-party cost.
- Crack down: -1 popular, one `minor` `discipline` purge, popular decay multiplier 0.5x for 24 turns.
- Ignore: popular decay 1.25x for 24 turns, plus 2 extra Stage 1 dwell.

Stage 2, `stage2.respondToUnrest` (default `ignore`):

- Open dialogue: -3 confidence, +6 popular, Stage 2 dwell decay doubled for 48 turns.
- Selective concession: legalize a chosen banned party (`payload.bannedPartyId`), -5 confidence, +10 popular, and a country-history entry tagged to the beneficiary party.
- Martial law: -8 popular plus an `extreme` `discipline` purge, in exchange for popular decay 0x (frozen) for 72 turns and a Stage 3 block for the same 72 turns. If the Stage 3 dwell counter is already past threshold when the block lapses, this only bought time.
- Ignore: popular decay 1.5x for 48 turns.

Stage 3, `stage3.respondToFactionSplit` (default `ignore`): negotiate power-sharing (-4 confidence, +8 popular), purge the defectors, concede leadership (+5 popular), or ignore.

Stage 4, `stage4.faceCollapse` (default `acceptPeacefully`):

- Resist: -25 confidence, -20 popular, an `extreme` `faction` purge, bans every approved party, and delays conversion by 48 turns. If popular legitimacy is still below 15 when the delay ends, the post-conversion legacy seat reservation is halved.
- Accept peacefully: no direct cost; marks the regime for conversion on the next tick.

## Faction split

Entering Stage 3 fires `fireFactionSplit` (`src/lib/onePartyState/factionSplit.ts`). It picks `max(3, ceil(15% of ruling-party officials))` defectors by divergence score, spawns a new approved party under the country's `factionDefectionName` (CN: "Democratic Faction of the CCP"; RU: "Reformist Faction of the CPSU") seeded from the defectors' own axis positions, not the ruling party's, and reassigns each defector's party field. Only character-held seats defect; NPP-held seats have a null `characterId` and are skipped. The split no-ops when the country has no `factionDefectionName`, no ruling party, or no officials.

### Faction divergence scoring

Who actually leaves is decided in `src/lib/onePartyState/factionDivergence.ts`, two pure (DB-free) kernels:

- `scoreDivergence(official, line)`, Manhattan distance between an official's own (economic, social) axis position and the ruling party's line, normalized to 0..1 (axes run roughly -5..+5, so max distance is 20). An official with no recorded axis position scores 0, since absence of a position is not evidence of disloyalty. Treating a null as maximally distant would purge NPC-imported officials first.
- `applyCaucusCohesion(scored, weight = CAUCUS_COHESION_WEIGHT)`, blends each official's individual score toward their caucus's mean score at `CAUCUS_COHESION_WEIGHT = 0.6`, so a faction leaves together rather than as scattered individuals who happen to cross the divergence line alone. Officials in no caucus keep their unmodified individual score.

The `max(3, ceil(15%))` defector count is then taken by highest cohesion-adjusted divergence, ties broken by input order. `factionCentreOfGravity` averages the defectors' own axis positions (falling back to the ruling party's line only when no defector has a recorded position) to seed the new party's ideology, so the breakaway faction is ideologically distinct from the party it left rather than a renamed copy of it.

## Liberalization reforms

Five actions in `src/lib/onePartyState/reformActions.ts` are available to the ruling-party leader at any time while the country is still one-party. Each trades intra-party confidence for public standing, and most leave a per-turn popular boost with a hard expiry. Cooldowns live on `countryState` (`src/lib/onePartyState/reformCooldowns.ts`).

| Action                   | Confidence | Popular | Per-turn boost   | Cooldown                |
| ------------------------ | ---------- | ------- | ---------------- | ----------------------- |
| Legalize a banned party  | -6         | +8      | +0.2 for 120 t   | 168 turns, per party id |
| Reduce vote multipliers  | -4         | +4      | +0.15 for 96 t   | 240 turns               |
| Honest by-election       | -3         | +5      | none             | 96 turns                |
| Anti-corruption purge    | -2         | +3      | none             | 72 turns                |
| Constitutional amendment | -8         | +12     | +0.3 for 240 t   | one time only           |

The anti-corruption purge records a `minor` `anticorruption` purge event rather than deleting anything. The constitutional amendment is permanent in a second way: it writes `renewalBumpOverride: 2`, so every future leader renewal in that country grants +2 confidence instead of +5. Stage 1's acknowledge option halves the next action's confidence cost, and the discount is consumed on use.

## Elections, vote multipliers and NPPs

Elections still run in one-party states, but they are weighted. `resolveRegimeMultiplier` in `src/lib/turn/onePartyConstraints.ts` reads `countryState.opsVoteMultipliers`, defaulting to `DEFAULT_OPS_VOTE_MULTIPLIERS` (`src/lib/constants/countriesCore.ts`): ruling 3.0, approved 0.375, independent 0.0, banned 0.0. Independents (no party document) are weighted like banned parties.

The same module holds the hard gates:

- `canFormGovernment`: ruling party only.
- `canTriggerNoConfidence`: ruling party only.
- `canCollapseGovernment`: always false, so the generic coalition-loss collapse path never fires.
- `canFieldExecutiveCandidate`: premier and president races are ruling-party only; other offices are open to anything not banned.
- `canFieldLegislativeCandidate`: ruling or approved parties only, which blocks independents at filing.
- `canInviteToCoalition`: ruling party only.

Reduce vote multipliers steps the ruling weight down one rung of `RULING_MULTIPLIER_LADDER` in `src/lib/onePartyState/reformPrimitives.ts`: 3.0, 2.0, 1.5, 1.0, with 1.0 as the floor. Approved, independent and banned weights are untouched: the reform loosens ruling privilege, it does not enfranchise banned parties. Honest by-election writes a one-shot `pendingHonestByElection: { atMultiplier: 1.0 }`, which `src/lib/electionEngine/candidateEnrichment.ts` reads, applies as a flat override on every regime multiplier for that election, and then clears.

NPPs (the game's AI-run politicians) file, hold seats and are enriched with their own policy positions exactly as elsewhere. Two one-party specifics: an NPP-held seat carries a null `characterId` and therefore cannot defect in a faction split, and a banned party's NPP seat-holders have `currentOffice` cleared like any other holder. Most Eastern-bloc satellites are largely NPP-governed, so the NPP brain is what actually operates the planned economy there, using `NPP_DEFAULT_REFORMISM = 0` and `NPP_DEFAULT_INTERNAL_REPRESSION = 0.5` when no player directive exists.

## Banning and unbanning parties

`processBanPartyEffects` (`src/lib/onePartyState/banFlow.ts`) makes a party inert: it deletes every `electedOfficials` document for that party, clears `currentOffice` on the holders, clears `autoRunForReelection` so the auto-re-entry pass does not silently re-file them next turn, and flips the party document to `regimeStatus: "banned"` with `bannedAt`, `bannedReason` and `bannedAtTurn`. There is no by-election machinery in AHD, so vacated seats stay empty until the next regular cycle for that office. Unbanning flips the status back to `approved` and clears the audit fields; it does not restore any seats.

## Constitutional convention: the voluntary exit

`src/lib/onePartyState/constitutionalConvention.ts` runs three phases.

1. `announced`: player-initiated. Sets `conventionInProgress: true` (freezing the Stage 4 dwell counter), parks a draft deadline `DRAFT_PHASE_TURNS = 48` turns out, and applies +15 popular / -10 confidence. Blocked if the country is already in `collapse` (that would race the forced path) or if a convention is already running. Defaults come from config: `legacyReservationDefault` (20 for CN and RU) and `electionDelayDefault`.
2. `draft`: locks in a `targetSystem` from `collapseTargetAllowlist` (CN and RU: `parliamentaryRepublic` or `presidential`), a `legacyReservation` in 0..35, and an `electionDelayTurns` of 12, 24 or 48. If the deadline passes, the tick advances to ratification anyway.
3. `ratification`: at `draftDeadlineTurn + electionDelayTurns` the tick fires the conversion with `path: "voluntary"`.

## Conversion: one way out, and it is one way

`triggerSystemConversion` in `src/lib/onePartyState/systemConversion.ts` does four things: sets the new `governmentType`, nulls `opsVoteMultipliers` and sets `hasLeaderConfidenceModel: false` (which is what switches off every intra-party and popular driver); clears `regimeStatus` on every party in the country (`clearAllRegimeStatusForCountry` in `src/lib/onePartyState/regimeStatusReset.ts`, which sets the field to `null` rather than unsetting it, so legacy readers still find a sentinel instead of `undefined`); writes a `regime_escalation` history event with `subtype: "conversion"`; and calls `bootstrapNewSystem` to park the snap-election marker. No rows are deleted, so the history survives.

The forced path, `checkForcedConversion`, fires on either of two conditions: Stage 4's accept-peacefully set `conversionPendingAtTurn` and that turn has arrived, or the country has sat in `collapse` with no convention and any `stage4Delay` window has elapsed. Forced constants: `FORCED_LEGACY_RESERVATION = 5` seats (halved to `3` when the resist delay expired with popular still below 15), `FORCED_VOTE_SHARE_PENALTY = -0.2` on the former ruling party's first post-conversion election, and `FORCED_ELECTION_DELAY_TURNS = 12`. Both paths are idempotent: the pending marker and the delay marker are cleared once consumed.

`bootstrapNewSystem` writes `pendingPostConversionElection` on `countryState` with the target turn, the legacy reservation, the former ruling party id (captured before the flip nulls it), the forced penalty and the path. The election engine consumes it.

## Command economy

Everything below is gated behind the `commandEconomyEnabled` GameConfig flag. Fresh bootstrap ties the flag to the selected era: Eastern Bloc presets enable it and other presets disable it. The static seed default is fail-safe enabled, but bootstrap makes the final preset-specific write before budget seeding.

The regime is a dial, not a switch. `marketizationLevel` runs 0 (fully command) to `MARKET_LEVEL = 100`, with bands at `COMMAND_CEILING = 30` and `DUAL_TRACK_CEILING = 70` (`src/lib/constants/commandEconomy.ts`). `MARKETIZATION_SCHEDULE` gives each country a trajectory: RU, UKR, BLR and BAL sit at level 10 through 1991; CN moves 10 (through 1978) to 50 (through 1992) to 85 (through 2018) and then to market; DD is at 10 through 1990, PL at 12 through 1989, HU at 15 through 1989.

### Offices

Three player seats operate the planned economy, mapped in `src/lib/constants/commandEconomyOffices.ts`: RU and DD use `chairman_of_gosplan` plus `gosbank_liaison`; CN uses `vice_premier` plus `pboc_governor`. SOE directors are appointed per enterprise onto `SoeState.directorId`, not to a fixed cabinet seat. Authorization is in `src/lib/economy/commandEconomyAuth.ts`: the Gosbank chair or the head of government may drive state credit; the Gosplan planner or the head of government may drive the plan and appoint SOE directors; only the SOE's own director drives that SOE; and internal repression is set by the head of government or the Gosbank chair, never by the planner alone (it is a security call, not a planning one). Lever ranges are clamped server side: credit aggressiveness 0..1, budget softness 0..1, labour-versus-quality 0..1, internal repression 0..1.

### Administered prices

`src/lib/economy/administeredPricing.ts` holds consumer prices at the era base price marked up by a turnover tax, `DEFAULT_TURNOVER_MARKUP = 0.12`, with no supply-and-demand response at all. That is the point: the unmet demand at the held price is the shortage, reported by `demandSupplyGapPct`. The turnover wedge times units actually supplied is the state's main indirect revenue. In a dual-track country `dualTrackPrice` blends administered and market prices by `plannedShare`. This branch runs only on the country-scoped national-price leg, never on the shared global leg, because an administered price leaking into the world price is the naira 100x incident class of bug.

### Two-circuit money

`src/lib/economy/twoCircuitMoney.ts` models the Soviet split between enterprise non-cash money and household cash at the macro level: a wage-fund ceiling. `wageFundConstrainedGrowth` pulls nominal wage growth down toward `realGoodsGrowth + WAGE_FUND_SLACK_PP` (2 percentage points), by the planned share, and never raises it. A tight wage fund is the primary brake on forced saving.

### Overhang, shortage and the second economy

`src/lib/economy/commandEconomyState.ts` accumulates the monetary overhang: the excess of nominal income over real goods, scaled by `plannedShare`, divided by `TURNS_PER_YEAR` (48) because the growth inputs are annual, plus any monetized directed credit (`CREDIT_OVERHANG_SCALE = 1.0`), less what the second economy absorbs. It persists at `OVERHANG_DECAY = 0.99` per turn (roughly a two-year horizon) and is capped at `OVERHANG_CAP = 100`. The black-market premium is capped at `MAX_BLACK_MARKET_PREMIUM = 2.0` (plus 200 percent over official) and the second economy at `MAX_SECOND_ECONOMY_SHARE = 0.6` of activity, tracking its target at 0.25 per turn. The readouts land on `FederalBudget.economicFactors` as `monetaryOverhang`, `shortageIndex`, `blackMarketPremium` and `secondEconomyShare`, and the dashboard presenter (`src/lib/economy/commandEconomyDashboard.ts`) turns them into the marketization gauge alongside SOE plan fulfillment and the government's policy stance.

Politics and economics meet through the drift collectors in `src/lib/turn/popularLegitimacyDriverCollectors.ts`: shortages and economic performance feed popular legitimacy, repression intensity feeds it the other way, and the resulting number is what walks the regime up the escalation chain.

## Timing

Everything regime-related runs inside the per-country bill lifecycle binding
(`processCountryBills` in `src/lib/turn/onePartyBillLifecycle.ts`), once per
turn per one-party country. In order: ensure the leader-state row exists, run
the bill engine, popular-legitimacy drift, ruling-party confidence drift,
regime escalation tick (which also advances the decision queue, convention
phases and forced-conversion checks). Reform actions and purges are
player or admin triggered between turns and are folded in by the next tick.
Elections are resolved by the normal election phases using the regime
multipliers; the post-conversion election marker is consumed by the election
engine. The parliamentary side (PM votes, freeze) is covered in
[parliamentary-government.md](./parliamentary-government.md).

## Edge cases and limits

- Confidence is clamped 0..95 and popular legitimacy 0..100; neither can be
  pushed outside by purges or reforms.
- Stages never regress on recovery, only by decision. Stage 4 is reachable
  only from `internalChallenge`.
- Starting a convention is blocked in `collapse` and while another convention
  is running, because it would race the forced conversion.
- A country that converts stops being one-party on the next turn: the bill
  binding re-reads `governmentType` and returns early. Conversion is permanent;
  no rows are deleted.
- Banning deletes the party's `electedOfficials` and leaves seats empty until
  the next regular cycle, because the game has no by-election machinery.
  Unbanning restores the status, not the seats.
- NPP-held seats cannot defect in a faction split (null `characterId`).
- An official with no axis position scores 0 divergence, so imported officials
  are not purged first.
- Without `commandEconomyEnabled` the whole command-economy section is inert,
  and the 12 countries still run the political regime.
- The constitutional amendment reform is one-time and permanently lowers the
  renewal bump from 5 to 2.

## Connections

**Driven by:**

- [Ruling-party confidence](./ruling-party-confidence.md): the confidence drift in `rulingPartyConfidenceTurn`.
- [Parties](./parties.md): party tiers (ruling, approved, banned) in `onePartyConstraints.ts`.
- [NPPs](./npp-system.md): NPP brain operates the planned economy where no player directive exists.

**Affects:**

- [Parliamentary government](./parliamentary-government.md): one-party states count as parliamentary through `isParliamentarySystem`.
- [Constitutional convention](./constitutional-convention.md): the voluntary exit path to conversion.
- Elections: vote multipliers applied in `src/lib/electionEngine/candidateEnrichment.ts`.

Last checked: 2026-10-29, version 1.18.0
