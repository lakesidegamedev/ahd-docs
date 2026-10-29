# Elections

## Overview

Elections run perpetually across five race types: House, Senate, Governor, State Senate, and President. Each election has a **primary phase** (intra-party competition) followed by a **general phase** (inter-party competition). One turn = one hour; timers advance each turn.

## Election Types

| Type             | Seats                | Scope                    | Notes                               |
| ---------------- | -------------------- | ------------------------ | ----------------------------------- |
| **House**        | 435 total (by state) | Per state                | Multi-seat; proportional allocation |
| **Senate**       | 100 (2 per state)    | Per state, per class     | Single-seat; 3 staggered classes    |
| **Governor**     | 50 (1 per state)     | Per state                | Single-seat                         |
| **State Senate** | Varies               | Per state                | Multi-seat; proportional allocation |
| **President**    | 1 (national)         | National (`state: "US"`) | Electoral College; 270 to win       |

## Seat Identifiers

Each political seat has a stable `seatId` that persists across election cycles, enabling external systems (Discord bots, APIs) to reliably track races.

**Format**: `{countryId}-{electionType}-{localRegionId}[-{senateClass}]`

| Seat                        | seatId           |
| --------------------------- | ---------------- |
| Pennsylvania Senate Class 1 | `US-senate-PA-1` |
| Pennsylvania House          | `US-house-PA`    |
| California Governor         | `US-governor-CA` |
| U.S. President              | `US-president`   |
| London Commons              | `UK-commons-LON` |
| Scotland Commons            | `UK-commons-SCO` |

**Historical race IDs** append the cycle number: `US-senate-PA-1-c3` (third cycle).

The `seats` collection stores permanent seat documents with display names. Elections reference seats via the `seatId` field. Source: `src/lib/seats/seatId.ts`, `src/lib/db/types/seat.ts`.

## Election Phases

### Primary Phase

- **Purpose**: Select party nominee(s) for each office
- **Entry**: Players and NPPs declare candidacy during primary phase (`primaryEndTime > now`)
- **Voting**: No vote accumulation; resolution uses a **primary score** (see below)
- **Result**: One candidate per party advances to general; losers marked `withdrawn`
- **Resolution**: When `primaryEndTime <= now`, `resolvePrimariesIfNeeded()` runs (inside `advanceElectionTimers`)

### General Phase

- **Purpose**: Select office holder(s) from party nominees
- **Voting**: Vote accumulation each turn via `accumulateGeneralElectionVotes()`
- **Result**: Winner(s) take office; `electedOfficials` updated; next cycle spawned
- **Resolution**: When `endTime <= now`, election marked `completed`; `resolveGeneralElections()` runs

## Duration by Race Type

48 hours = 1 year in game time.

| Type         | Total Duration      | Primary Duration | General Duration |
| ------------ | ------------------- | ---------------- | ---------------- |
| House        | 96 hours (2 years)  | 48 hours         | 48 hours         |
| Senate       | 288 hours (6 years) | 240 hours        | 48 hours         |
| Governor     | 192 hours (4 years) | 144 hours        | 48 hours         |
| State Senate | 192 hours (4 years) | 144 hours        | 48 hours         |
| President    | 192 hours (4 years) | 144 hours        | 48 hours         |

Senate classes staggered by 96 hours (2 years): Class 1 now, Class 2 +96h, Class 3 +192h.

Durations are configurable per election; new elections inherit from the most recently completed election for that slot. Source: `src/lib/turn/perpetualElections.ts` (`DEFAULT_DURATIONS`).

## Turn Processing Order

Election steps run as strictly sequential sub-phases of the `electionResolutionAndGovernment` phase in `src/simulation/phases/turnPhaseRegistry.ts`:

1. **Withdraw inactive candidates**
2. **Candidate party sweep**, withdraws stale or ineligible candidacies after party switches
3. **Resolve primaries**, eliminates losers when `primaryEndTime` passes; must run before vote accumulation
4. **Accumulate general election votes**, one turn of votes for all active general-phase elections; **must run before timer advancement**
5. **Campaign spend reset**, clears `Campaign.spendThisTurn` after the tallies have read it
6. **Advance election timers**, marks elections "completed" when `endTime` passes
7. **Record primary snapshots**, for elections still in primary phase (trend data)
8. **Resolve completed general elections**, determines winners, updates `electedOfficials`, spawns next cycle
9. **Clear resolved support, vacate leadership**, removes leadership from members who lost/changed office
10. **Parliamentary government formation**

NPP behavior, bill lifecycle and the campaign turn (income, actions, maintenance) run in other phases.

> **Critical ordering** (documented in the registry): primaries resolve → votes accumulate → timers advance → elections resolve. Reordering would lose final-turn votes or include eliminated candidates in tallies.

## Primary Resolution

When `primaryEndTime` passes, `resolvePrimariesIfNeeded()` in `src/lib/turn/primaryResolution.ts`:

1. Finds elections with `primaryEndTime <= now` and `endTime > now`
2. For each party with multiple candidates, computes a **primary score** per candidate. The raw score is then multiplied by an **infamy penalty**, `1 − 0.05 × (infamy/100)`, for player characters (NPPs aren't affected).

   **State-level races** (House, Senate, Governor, State Senate):
   - **Alignment, state**: `25 − (|econ − stateEconLean| + |social − stateSocialLean|) × 1.25`, max 25 pts (when state cached lean is available)
   - **Alignment, party**: `15 − (|econ − partyEcon| + |social − partySocial|) × 0.75`, max 15 pts
   - **Favorability**: `(favorability / 100) × 35`, max 35 pts
   - **Political Influence**: `normalizeNPI(politicalInfluence) × 25`, max 25 pts (sqrt curve, capped at 1.0 once PI reaches 100)
   - **Fallback when state lean is missing**: alignment collapses to a single 40-pt party-only check (`max(0, 40 − (|econDiff_party| + |socialDiff_party|) × 2.0)`), preserving the pre-rework formula.

   **Presidential** (national, no state-position component):
   - **Alignment**: `40 − (|econ − partyEcon| + |social − partySocial|) × 2.0`, max 40 pts
   - **Party Influence** (candidate's accumulated party clout): `normalizePartyInfluencePresidentialPrimary(partyInfluence) × 20`, weight 20 (`PRESIDENT_PRIMARY_PARTY_INFLUENCE_WEIGHT`)
   - **National Influence**: `normalizeNationalReachPresidentialPrimary(nationalInfluence) × 15`, max 15 pts (linear-up-to-cap, NPI ≥ 100 saturates at 1.0)
   - **Favorability**: `(favorability / 100) × 25`, max 25 pts

3. Highest score per party advances; others marked `withdrawn`
4. Win/loss notifications sent to player candidates
5. General vote tally initialized (or created if missing)

## Vote Accumulation (General Phase)

Handled by `src/lib/electionEngine.ts` and `accumulateVoteTurn()`.

### Model

- **Total pool**: State turnout derived from demographics (category weights, group populations, default turnout)
- **Per-turn weight**: A **three-tier closing surge**, not a flat split (`turnVoteWeight()` in `src/lib/electionEngine/voteCalculations.ts`):
  - **Early band**: `EARLY_POOL_SHARE = 0.5` of the pool, spread over every turn before the ramp band
  - **Ramp band**: the `RAMP_TURNS = 8` turns before election day get `RAMP_POOL_SHARE = 0.2` of the pool
  - **Final band**: the last `ELECTION_DAY_TURNS = 4` turns get `FINAL_POOL_SHARE = 0.3` of the pool
  - Shares sum to 1. Very short races (`totalTurns <= 4`) spread the pool evenly instead.
- **Party strength**: The turn pool is scaled by `(1 + (approval − 0.5) × 0.2) × officeStrength` for state races, `(1 + (approval − 0.5) × 0.5) × officeStrength` for president (see below)
- **Distribution**: Each turn, the **effective** pool is distributed proportionally to each candidate's **vote potential**

### FPTP & RCV, Vote-Splitting System

The voting system used by each state determines whether the **vote-splitting (spoiler) effect** is applied after the group-level allocation.

#### First Past the Post (FPTP), Default

In FPTP states, third-party candidates create an explicit **spoiler effect**:

1. After group-level votes are distributed, for each third-party candidate in the race, **`FPTP_SPOILER_RATE` (4%) × the third party's own group-level allocation** is drawn from the ideologically nearest **major-party** candidate (per `getMajorPartiesForRegion(countryId, parentRegionId)`, e.g. Democrat/Republican in the US, Labour/Conservative in England, SNP/Labour in Scotland) and transferred to the third party.
2. "Nearest" is measured by Manhattan distance on the economic / social policy grid.
3. This models the real-world vote-splitting dynamic: a Green Party candidate on the left bleeds coalition voters from the Democratic candidate, potentially handing the race to the Republican.

**Political implications (design intent):**

- Major parties view nearby third parties as **existential threats**, a strong Green Party or Libertarian Party can flip a seat to the opposing major party.
- This creates a natural wedge between the major-party establishment and third-party movements.
- Third parties cannot easily win seats under FPTP even with significant support, they spoil the nearest major party's chances without securing victory themselves.
- This drives the third-party strategic goal: **advocate for states to adopt RCV**, where the spoiler dynamic disappears.

**Example (FPTP, Texas):**

| Candidate | Party      | Group-level votes | After FPTP spoiler   |
| --------- | ---------- | ----------------- | -------------------- |
| Adams     | Democrat   | 400,000           | 392,000 (−8,000)     |
| Brooks    | Republican | 450,000           | 450,000 (unaffected) |
| Chen      | Green      | 200,000           | 208,000 (+8,000)     |

_Green is ideologically near Democrat. 4% × 200,000 = 8,000 spoiled, drawn from Dem. Rep is unaffected._

The key outcome: Democrat loses 8,000 votes; Green gains 8,000, but Green still finishes second. Republican wins with the plurality. In a tighter race the 8,000-vote swing is enough to flip the seat.

#### Ranked Choice Voting (RCV), Optional (legislated per state)

In RCV states, **no vote-splitting adjustment is applied**. Third parties compete on equal footing with major parties:

- Voters can safely express a third-party first preference without harming their second-choice major-party candidate.
- A strong Green candidate in an RCV state does **not** bleed votes from the Democrat.
- Third parties can build genuine coalition support and grow their seat share without triggering the spoiler dynamic.
- States switch to RCV through legislation; switching back removes the advantage.

**Implementation:** `FPTP_SPOILER_RATE` is defined in `src/lib/electionEngine/constants.ts`. Major parties for the spoiler step come from `getMajorPartiesForRegion()` in `src/lib/constants/countries.ts`, the same helper used in `src/lib/electionEngine/voteDistribution.ts` and in-race poll math in `src/lib/actions/pollCalculations.ts` (invoked from `src/app/api/actions/poll/route.ts`). The voting system is stored per state in `states.votingSystem` (`"fptp"` | `"rcv"`, defaults to `"fptp"`).

### Total Appeal System (Pipeline)

**Two distribution paths exist.** Primaries and commissioned polls use the **group-level competitive allocation** model described below (each demographic group votes as a bloc, splitting its vote pool among candidates by relative appeal). General-election vote accumulation defaults to the **swing-flow model** (`distributeVotesBySwingFlow()` in `src/lib/electionEngine/voteDistributionSwingFlow.ts`, set unconditionally in `tallyManagement.ts`); group-level allocation remains available as a fallback/legacy path for generals but is not the live default. See [Election Engine](./election-engine.md) for the swing-flow driver stack (coattails, median-voter, persuasion, incumbency; term fatigue now lives in the economic referendum channel, `src/lib/electionEngine/economicReferendum.ts`). The appeal/reach/approval math below is the shared foundation both paths build on.

The full pipeline from candidate and state to votes per turn (shared with poll and NPP dropout via `src/lib/utils/demographicAppeal.ts`):

> **Stat used by race type:**
>
> - **State races** (House, Senate, Governor, State Senate): use **Political Influence** (`politicalInfluence`, capped 0-100)
> - **Presidential race**: use **National Political Influence** (`nationalInfluence`)

1. **Reach**, `normalizeNPI(influence)`: fraction of turned-out voters the candidate can reach. Sqrt curve, hard-capped at 1.0 once PI/NPI reaches 100. Both state and presidential general elections use this curve. Presidential primary reach uses the separate diminishing-return function `1 - exp(-NPI/45)`.
2. **Appeal (per demographic group)**, Position score `25 × (positionRaw/50)^1.5 + floor`, where `positionRaw = max(0, 50 − |econDiff|×5 − |socialDiff|×5)` and `APPEAL_POSITION_EXPONENT = 1.5` (`src/lib/utils/demographicAppeal.ts`), plus a directional (tribal-voter) bonus of up to `DIRECTION_BONUS_PER_AXIS = 5` per axis, plus `normalizeNPI(influence) × 12.5` when influence is included. Max 50 (position ~25 + influence ~25 at PI=100). Does NOT include favorability, that scales at the end. (γ=2, the legacy squared curve, is still supported as a special case but is not the live default.)
3. **Group-level competitive allocation**, Each demographic group contributes to the turn pool proportionally to its size. Within each group, candidates split that contribution by relative `(appeal × reach × approval × partyOrg × infamyMult)`. Groups vote as blocs; higher appeal with a group yields a larger share of that group's votes.
4. **Approval scalar**, `(favorability / 100)^0.8`: voters will not support candidates they do not approve of, while the exponent softens the middle of the curve. 0% approval = 0 votes.
5. **Party org scalar**, General elections: `normalizedOrgShare ^ ORG_WEIGHT_EXPONENT` (`ORG_WEIGHT_EXPONENT = 0.2`), the party's normalized share of statewide Org among all parties, with diminishing returns; no Org data anywhere falls back to a neutral 1×. Primaries use a uniform neutral 1× (intra-party Org cancels). This retired the older flat `0.5 + (org/100)×0.5` scalar (2026-06-18).
6. **Infamy scalar**, `1 − 0.05 × (infamy/100)`: player characters lose up to 5% of their per-group weight at infamy=100. NPPs leave infamy unset and are unaffected.
7. **Party strength modifier**, `(1 + (approvalDecimal − 0.5) × 0.2) × officeStrength` for state races (`× 0.5` in place of `× 0.2` for president, so presidential races feel state approval 2.5x more strongly):
   - **State government approval**: 0-100% from state metrics vs. national averages (see [Government Approval](./government-approval.md)). When metrics are missing, 50% is used. At 50% approval the modifier is 1.0x baseline regardless of office; state races swing ±10% (0% approval → 0.9x, 100% → 1.1x) before the office-strength factor, president swings ±25% (0.75x-1.25x).
   - **Office strength**: Governor 1.0, House 0.9, Senate 0.8, State Senate 0.85.
8. **Effective turn pool**, Base turn pool × party strength modifier. Same modifier for all candidates in that election; relative shares are unchanged.
9. **Distribution**, For each group, its share of the effective turn pool is split among candidates by relative (appeal × reach × approval × partyOrg × infamyMult). Votes per candidate are summed across all groups.

### Factors Affecting Votes

| Factor                                 | Effect                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Policy alignment**                   | Power curve, exponent 1.5: `25 × (positionRaw/50)^1.5 + floor`, `positionRaw = 50 − econDiff×5 − socialDiff×5`; closer = higher appeal            |
| **Political influence (PI)**           | State races only, reach + appeal score. Capped 0-100; max reach = 1.0                                                                            |
| **National Political Influence (NPI)** | Presidential race only, sqrt scaling via `normalizeNPI`, hard-capped at 1.0 once NPI reaches 100. Above 100 it saturates (no celebrity bonus).   |
| **Favorability (approval)**            | Final scalar: `(favorability/100)^0.8` (`APPROVAL_SCALAR_EXPONENT`); 0% approval = 0 votes                                                        |
| **Party org**                          | Final scalar in general elections: `normalizedOrgShare ^ 0.2` (`ORG_WEIGHT_EXPONENT`), a party's normalized share of statewide Org with diminishing returns. Primaries use a uniform neutral 1×. |
| **Government approval**                | Scales the turn pool by (1 + approval); high-approval states allocate more votes per turn                                                         |
| **Office strength**                    | Governor 1.0, House 0.9, Senate 0.8, State Senate 0.85, governor races most affected by approval                                                 |
| **Voting system (FPTP/RCV)**           | FPTP: third-party candidates gain `FPTP_SPOILER_RATE` × their own allocation drawn from nearest major party (spoiler effect). RCV: no adjustment. |

Campaign actions raise favorability and influence; ads raise recognition and favorability.

## Polls vs simulated votes

**State and general elections (House, Senate, Governor, State Senate, Commons, etc.):** Commissioned polls use the **group-level competitive allocation** and **FPTP spoiler** rules, including **region-aware major parties** and **per-archetype effective favorability** for opponents when that data exists (`src/lib/actions/pollCalculations.ts`, `src/lib/actions/electionOpponents.ts`). Turn-by-turn general-election vote accumulation itself defaults to the **swing-flow model** instead (see above); polls are an appeal-based projection and do not replay the swing-flow driver stack.

**Presidential:** Simulated votes are accumulated **per electoral unit** in `src/lib/presidentialElectionEngine.ts` (averaged party vs character positions, national influence for reach, influence included in appeal, state/district lean, independent penalty, swing-state ground game). The **FPTP spoiler step is applied at half rate** (`PRESIDENTIAL_SPOILER_RATE = 2%`) on the presidential distribution path to prevent fragmented fields from producing EC landslides via winner-take-all. Player polls remain **home-state** projections and do **not** replicate the national presidential model, treat poll topline and in-race breakdowns as **indicative for the character’s state**, not as an Electoral College forecast.

## Multi-Seat Races (House, State Senate)

- **House**: Real seat distribution (e.g., CA 52, TX 38). See `HOUSE_SEATS` in `src/lib/turn/electionResolution.ts`
- **Proportional allocation**: Largest-remainder method
- **Minimum share**: set per chamber by `getMultiSeatMinShare()` in `src/lib/turn/election/rules/seatEligibility.ts`. The US House gate scales with the state delegation, `clamp(1 / (seats + 1), 10%, 20%)`, so small delegations sit at 20% and large ones drop toward 10%. State Senate, Regional Council and most other legislatures use a flat 10% so smaller parties can win seats in larger districts. Chambers not listed there, and non-US House races (such as Nigeria's), keep 20%.
- **2-seat House special case**: Winner takes both seats unless at least one opponent reaches the minimum share threshold (the House gate above, 10% for State Senate)
- **Seats estimate**: Updated each vote turn; `voteFraction × totalSeats` per candidate

## Senate Elections

- **Staggered classes**: Class 1, 2, 3, each state has 2 senators in different classes
- **Elections**: One seat per class per state; single-winner
- **Continuity**: Senate slots spawn only if that class was previously initialized (admin or prior election)

## Governor Elections

- **Scope**: One governor per state; single-seat, single-winner (like Senate).
- **Duration**: 192 hours total (4 years), 48 hours primary; configurable per election.
- **Continuity**: Governor elections run perpetually. When a state has no active or upcoming governor race, a new one is spawned. **Bootstrap**: If no state has ever completed a governor election, one governor election is spawned per state so the first cycle exists; thereafter, replacement is spawned only after the previous governor election for that state completes.
- **Vote accumulation**: Uses the same appeal and party-strength rules as above, with office strength 1.0 (governor races are most affected by state government approval).

## Candidacy Rules

- **One office at a time**: Players can only run for one office per election cycle
- **Home state only**: `homeState === election.state`; out-of-state returns 403. **Exception**: President (`state: "US"`), any state.
- **Party**: Characters run under their current party affiliation. Independents can run in the "independent" party primary, no penalty at entry, but general-election vote penalties apply (see [Presidential](#presidential-election)).
- **Declaration**: Must declare during primary phase (`primaryEndTime > now`). Independents run in the "independent" party primary like any other party, no general-phase exception.
- **House/State Senate**: Candidates may request multiple seats (`seatsRequested`)
- **Country restriction**: `character.countryId === election.countryId`; cross-country entry returns 403

## Election Entry API

**Endpoint:** `POST /api/elections/[id]/enter`

**Validation:**

```typescript
// src/app/api/elections/[id]/enter/route.ts

// 1. Election must be upcoming or active
if (election.status !== "upcoming" && election.status !== "active") {
  return 400; // "This election is not open for entry"
}

// 2. Primary deadline enforced
if (primaryEnded) {
  return 400; // "The primary entry period has ended"
}

// 3. Country restriction
if (electionCountry !== characterCountry) {
  return 403; // "This election is for {X} characters only"
}

// 4. Home state restriction (president is national)
if (!isPresident && election.state !== character.homeState) {
  return 403; // "You can only run for office in your home state"
}

// 5. One race at a time check
const blocking = await findBlockingActiveCandidacy(db, character._id, electionObjectId);
if (blocking) {
  return 400; // "You are already running in {race}"
}
```

**Party switching:** If already entered under a different party, the old candidacy is auto-withdrawn before creating the new one.

**Achievement trigger:** Election entry triggers achievement checks via `checkElectionEntryAchievements()`.

## Withdrawal Mechanics

**Endpoint:** `POST /api/elections/[id]/withdraw`

**Effects:**

```typescript
// src/app/api/elections/[id]/withdraw/route.ts

// 1. Mark candidate as withdrawn
await db
  .collection("electionCandidates")
  .updateOne({ _id: candidate._id }, { $set: { status: "withdrawn", withdrawnAt: now } });

// 2. Remove votes from tally
await removeWithdrawnCandidateFromTally(db, electionObjectId, candidate._id.toString());

// 3. Delete campaign document
await db.collection("campaigns").deleteOne({
  electionId: electionObjectId,
  candidateId: candidate.characterId,
});
```

**Restrictions:**

- Cannot withdraw from completed, resolved, or cancelled elections
- Withdrawn candidates cannot re-enter the same election
- Votes are permanently removed from the tally (not redistributed)

## Election Continuity

All race types run perpetually:

- **House**: Next cycle spawned immediately when previous resolves (`spawnHouseElection`)
- **Senate / Governor / State Senate**: `ensurePerpetualElections()` runs each turn; spawns replacement for any slot with no active or upcoming race
- **Governor bootstrap**: If no state has any completed governor election yet, one governor election is spawned per state so every state has an initial governor race; after that, governor is spawned only when that state's previous governor election has completed
- **President**: Spawned via canonical LARP schedule when no active/upcoming president election exists. Anchored to real-world presidential election years (2020, 2024, 2028…). The `isPresidentialElectionYear(turn)` guard was removed, the canonical cycle window together with the 24h-primary / 24h-general gate ensures president only spawns in valid windows.
- New elections use canonical `DEFAULT_DURATIONS` from `src/lib/constants/electionDurations.ts`, not the prior cycle's durations. Admin timer edits do not drag the LARP calendar.
- Cycle counter increments on each spawned election
- **Admin**: "Spawn Missing Elections" in Admin → Elections → Manage triggers immediate continuity check

## Polling & Display

- **No WebSocket**: Client-side polling on page load and after actions (see [Technical Architecture](./technical-architecture.md))
- **Primary snapshots**: Recorded each turn for elections in primary phase; used for trend graphs
- **General tally**: `electionVoteTallies` stores `totalVotes`, `turnSnapshots`, `sharesPct`, `seatsEstimate`
- **API**: `GET /api/elections`, `GET /api/elections/[id]` return polling data and candidate lists

## Presidential Election

- **Scope**: National (`electionType: "president"`, `state: "US"`). Any state can run; no home-state check.
- **Influence stat**: Uses **NPI** (`nationalInfluence`) exclusively, not `politicalInfluence`. NPI grows passively each turn (+state influence ÷ 100). Reach uses a sqrt curve hard-capped at 1.0 once NPI reaches 100; presidential primary scoring uses a separate linear-up-to-cap function on the same value.
- **Primaries**: One national primary per party; national appeal score (population-weighted state blend). Independents skip primary; enter during general phase only.
- **General**: Per-state (and ME/NE district) vote accumulation; Electoral College resolution. 538 total EV; 270 to win.
- **Electoral College**: `ELECTORAL_VOTE_UNITS` in `src/lib/constants/states.ts`. ME and NE split by congressional district (ME: 2 at-large + CD1 + CD2; NE: 2 at-large + CD1 + CD2 + CD3). District lean proxies applied for ME/NE (see `UNIT_LEAN`).
- **Independent penalty**: 0.3× vote share in general (70% reduction).
- **Running mate (VP)**: After primary, each nominee selects a running mate. VP cannot be current President. Stored on `ElectionCandidate.runningMateId`.

**API:** `POST /api/elections/[id]/running-mate`

```typescript
// src/app/api/elections/[id]/running-mate/route.ts

// Validation:
// - Only the candidate can set their own running mate
// - Running mate cannot be the current President
// - Running mate cannot be the same person (self-selection)
// - Accepts character ObjectId or "" to clear

await db
  .collection<ElectionCandidate>("electionCandidates")
  .updateOne(
    { _id: myCandidate._id },
    { $set: { runningMateId: runningMateObjectId, updatedAt: new Date() } }
  );
```

- **Timing**: Spawned via canonical LARP schedule when no active/upcoming president election exists. Anchored to real-world presidential election years (2024, 2028, 2032 under the 2019-default preset; 1992, 1996, 2000… under the 1991-default preset). 48 turns = 1 year. `pickNextCanonicalCycle()` in `src/lib/elections/canonicalCycle.ts` returns the next cycle whose remaining primary AND general windows clear the 24h+24h floor at `currentTurn`; the legacy `isPresidentialElectionYear()` guard has been removed.
- **Tie-breaker**: 269-269 EV tie resolved by deterministic coin flip (election ID + candidate IDs).
- **Vote accumulation**: `accumulatePresidentVoteTurn()` in `src/lib/presidentialElectionEngine.ts`; resolution in `electionResolution.ts`.
- **Vote-flow model**: Presidential general votes are distributed by `distributeVotesBySwingFlow()` in `src/lib/electionEngine/voteDistributionSwingFlow.ts`, the only model the presidential engine calls; there is no legacy/alternate path selectable at runtime.
- **Presidential vote weights**: Appeal position averages **candidate and party** via `partyPositionWeight` (`= 1/3` in `presidentialElectionEngine.ts`): `pos = (pw × party + candidate) / (pw + 1)` = `(party + 3×candidate) / 4`, roughly **75% candidate position, 25% party position**, so the candidate's own stance dominates. **State lean** applies a small tiebreaker multiplier on top of appeal (`leanVoteMultiplier()`): `1 + lean × sign × STATE_LEAN_STRENGTH`, with `STATE_LEAN_STRENGTH = 0.1` for states (`0.3` for ME/NE congressional districts), clamped to `[0.8, 1.2]`, at most a 1.5:1 swing. Lean is already priced into appeal via the swing-flow substrate; this multiplier is a demoted tiebreaker, not the primary driver.
- **Electoral map**: Presidential election detail shows `PresidentialElectoralMap` with per-unit EV allocation, state-level vote totals in tooltips, and EV lead summary.

## NPP Election Participation

See [NPP System](./npp-system.md) for full documentation. NPPs autonomously enter and drop out of elections each turn via `processElectionEntry()` in `src/lib/turn/npp/electionEntry.ts`.

### Entry

- **Eligibility**: Not retired, not on cooldown for that election, not already in an active race
- **Scope**: Home state for all regional races (House, Senate, Governor, State Senate, Commons, Shugiin, Sangiin, Regional Council, Bundestag). **NPPs are barred from presidential races in player-enabled countries**, so players always have the opportunity to contest the presidency without NPP auto-entry distorting the field. The bar is lifted in countries where NPP autonomy is active and there is no player to contest the presidency, and for the first round of Russian direct presidential ballots.
- **Types**: All race types except president (subject to the exceptions above)
- **Timing**: Only during primary phase (`primaryEndTime > now`)
- **Priority order** (highest to lowest): State Senate → Regional Council → Sangiin → House → Senate → Shugiin → Governor → President → Commons
- **One NPP per party per primary**: Each primary gets exactly one NPP candidate per party to avoid splitting the party vote
- **Two-pass system**: Incumbents get first priority to defend their seats; non-incumbents fill remaining slots by party/state priority. Deterministic, no random chance.

### Dropout / Elimination

- NPPs are eliminated during **primary resolution** (same as player candidates) when their primary score is not the highest in their party
- Eliminated NPPs are marked `withdrawn` and receive a per-election cooldown; they cannot re-enter until `primaryEndTime` passes
- There is no separate "appeal-based" dropout pass, NPPs compete on the same primary score formula as players

### Spawn (Admin)

Admin → Elections → NPP Management: spawn 1-500 NPPs per party with weighting (`lean` / `members` / `both`).

## Presidential Travel

During the general election phase, presidential candidates can travel to specific states to campaign in person.

- **Cost**: `getTravelActionCost()` scales with the target state's electoral votes: EV ≤ 5 → 3 actions, EV ≤ 10 → 5, EV ≤ 20 → 7, EV > 20 → 10 (small states are cheap, big states are expensive)
- **Effect**: Traveling to a state is the eligibility requirement for the character's canvassing actions in that state. It also grants a travel presence bonus of +1.0 favorability each turn while a travel state is set (presidential, non-NPP candidates only). A running mate who is travelling adds a surrogate presence bonus on top (`src/lib/turn/campaignTurn.ts`)
- **Visibility**: Travel state shown on the electoral map as a badge
- **Strategy**: Lets candidates focus campaign presence (canvassing) in swing states
- **Restrictions**: Only active presidential candidates can travel; one state at a time

**API:** `POST /api/elections/[id]/travel`

```typescript
// src/app/api/elections/[id]/travel/route.ts

const actionCost = getTravelActionCost(stateId, gameState?.preset);

// Validates:
// - Election is presidential and active
// - User is an active candidate
// - Has enough actions (cost varies by state EV)
// - State is a valid US state

await db
  .collection<ElectionCandidate>("electionCandidates")
  .updateOne({ _id: candidate._id }, { $set: { travelState: stateId, traveledAt: now } });
```

Travel is a presidential-only mechanic. State-level races use standard campaign/ads actions instead.

## Campaign Strategy

### Building Support

- **Campaign**: Raises **Political Influence** (up to +1% per action, diminishing returns above 50% PI), name recognition / reach. Cost scales with current PI and state GDP per capita.
- **Advertise**: Raises **Favorability** (+1-3 per action, diminishing returns above 70%). Cost scales with current favorability and state GDP.
- **Build Donor Network**: Increases donor base level (unlocks higher fundraising yields). One-time unlock; L0→L75 costs ~₳4.4M at national-average GDP.
- **Fundraise**: Converts donor base level into campaign funds. ₳50K floor + ₳2K per donor level, scaled by state PI.
- Policy alignment with demographics affects vote calculations
- Endorsements provide stat boosts

### Attack Strategy

- **Attack** (influence action): Reduces target Favorability by 1, costs 2 Infamy to attacker
- **Action-point cost**: priced dynamically per target in `src/lib/influence/simpleInfluence.ts` and `src/lib/influence/rules.ts`. A boost to another player costs the equivalent self-action quote plus a 1.25x premium (attack uses 1.5x), scaled by a distance multiplier for out-of-state targets, so the price is not a flat number. Favorability strikes compete with campaigning, fundraising and political operations for a player's turn.
- **Per-turn cap**: `MAX_NET_FAVORABILITY_SWING_PER_TURN = 12`, the net favorability change any one target can absorb from player support/attack actions in a single turn, in either direction. This is a backstop against extreme coordinated pile-ons, not the primary limiter (the AP cost is); it sits well above normal single-turn swings.
- **Failure chance**: Attacks can fail based on attacker's Infamy (`failureChance = infamy × 10`). Failed attacks still cost 2 Infamy.
- **Infamy drain**: Infamy > 20% causes passive Favorability drain each turn (`(infamy − 20) × 0.05%`)
- **Cross-state cost**: Attacking out-of-state targets costs more action points, scaled by a distance multiplier

### Geographic Strategy

- Campaign costs scale with state GDP per capita
- Out-of-state campaigning costs more
- Different states have different demographic compositions

## Database Collections

| Collection            | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `elections`           | Active, upcoming, completed elections                |
| `electionCandidates`  | Candidates per election; status active/withdrawn     |
| `electionVoteTallies` | General-phase vote totals, snapshots, seats estimate |
| `primarySnapshots`    | Hourly primary standings for trend display           |

## Election Engine Module Structure

The election vote calculation pipeline is implemented across two modules:

### `src/lib/electionEngine/`, Core vote calculation engine

| File                     | Purpose                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voteDistribution.ts`    | Group-level competitive allocation: distributes votes by demographic blocs using appeal × reach × approval × partyOrg; applies FPTP spoiler effect. Used for primaries and polls; fallback/legacy path for generals |
| `voteDistributionSwingFlow.ts` | Two-phase pairwise swing-flow allocation; default vote model for general elections. Layers coattails, median-voter, persuasion, and incumbency drivers on top of the base appeal calculation |
| `tallyManagement.ts`     | Accumulates vote turns, initializes tallies, computes seat estimates for multi-seat races                                                          |
| `voteCalculations.ts`    | Turn vote weight formula (three-tier closing surge: 50% early / 20% ramp / 30% final 4 turns), state turnout calculation                            |
| `resolvedTurnout.ts`     | Combines static `StateDemographics.turnout` with dynamic `StateDemographicTurnout.modifiers` from GOTV/canvassing/suppression                      |
| `candidateEnrichment.ts` | Fetches character/NPP data and merges with candidate records for vote calculations                                                                 |
| `types.ts`               | `EnrichedCandidate`, `DistributeVotesOptions`, `AccumulateVoteTurnPreload`                                                                         |
| `constants.ts`           | `FPTP_SPOILER_RATE` (0.04), `PARTY_STRENGTH_BY_OFFICE` (deprecated, now in CountryConfig)                                                         |

### `src/lib/elections/`, API helpers and election lifecycle

| File                         | Purpose                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `electoralVoteService.ts`    | Presidential Electoral College computation, per-unit EV allocation, map data, EV-by-turn tracking |
| `buildPollingData.ts`        | Poll computation using same group-level allocation as vote accumulation                           |
| `enrichElection.ts`          | Full election enrichment with candidates, tally, polling data                                     |
| `resolveElection.ts`         | General election resolution: winner determination, seat allocation, NPP influence updates         |
| `candidateEnrichment.ts`     | Alternative enrichment for API responses (includes party logos, campaign IDs)                     |
| `electionParamResolution.ts` | Resolves election duration, primary duration from config or previous cycle                        |
| `voteTallyService.ts`        | Simple tally fetcher for API responses                                                            |
| `phases.ts`                  | Computes election phase (upcoming/primary/general/ended) from timers and game time                |
| `activeCandidacy.ts`         | Checks if a character has an active candidacy (for validation)                                    |
| `electionResponseTypes.ts`   | TypeScript types for API response shapes                                                          |

## Vote Accumulation Pipeline

Each turn, `accumulateVoteTurn()` in `tallyManagement.ts` runs the following pipeline:

1. **Fetch tally + candidates**, Load `ElectionVoteTally` and active `ElectionCandidate` records
2. **Load state context**, State demographics, categories, party orgs, turnout modifiers
3. **Resolve effective turnout**, `resolveTurnout()` combines baseline turnout with GOTV/canvassing/suppression modifiers
4. **Compute turn pool**, `turnVoteWeight()` allocates the pool in a three-tier closing surge: 50% early, 20% in the 8-turn ramp band, 30% in the final 4 turns
5. **Apply party strength**, State government approval × office strength scales the pool
6. **Enrich candidates**, `fetchEnrichedCandidates()` merges character/NPP stats (policies, favorability, influence, archetype approvals)
7. **Distribute votes**, general elections call `distributeVotesBySwingFlow()` (default); primaries call `distributeVotesByGroupLevelAllocation()`:
   - For each demographic group: compute appeal, reach, approval, partyOrg
   - Split group's share of pool proportionally by candidate weights
   - Apply FPTP spoiler effect (if general election in FPTP state): transfer `FPTP_SPOILER_RATE × thirdPartyVotes` from nearest major party
   - Swing-flow additionally layers coattails, median-voter, persuasion, and incumbency drivers, see [Election Engine](./election-engine.md)
8. **Update tally**, Accumulate votes, update shares, compute seat estimates for multi-seat races
9. **Snapshot**, Push turn snapshot to `turnSnapshots` array for trend tracking

### FPTP Spoiler Effect

In FPTP states (default), third-party candidates create a spoiler effect:

```typescript
// From voteDistribution.ts:145-166
for (const tp of thirdParties) {
  const spoiled = votesPerCandidate[tp.candidateId] * FPTP_SPOILER_RATE; // 4% of third-party votes
  // Find ideologically nearest major party (Manhattan distance on EP/SP grid)
  let nearest = majorParties.findClosest(tp.charEP, tp.charSP);
  votesPerCandidate[nearest.candidateId] -= spoiled;
  votesPerCandidate[tp.candidateId] += spoiled;
}
```

This models real-world vote-splitting: a Green Party candidate bleeds Democratic votes; a Libertarian bleeds Republican votes. RCV states skip this step entirely.

### Presidential Electoral College

Presidential elections use `computeElectoralVotes()` in `electoralVoteService.ts`:

- **538 total EVs**, 270 to win
- **Per-unit accumulation**, Each electoral unit (state + ME/NE districts) tracks votes separately
- **Winner-take-all**, Unit winner gets all EVs (ME/NE split by district)
- **Tie-breaker**, Deterministic coin flip using election ID + candidate IDs
- **EV-by-turn tracking**, `unitTurnSnapshots` stores per-turn EV allocation for trend graphs

## Elections Hub

The `/elections` page is the central listing of all elections across all race types and states.

- **Active Only toggle**: Filters the list to show only elections currently in primary or general voting phase (hides upcoming races not yet open for candidacy)
- **Default state**: All elections shown
- **Compact campaign cards**: Each candidate entry links to their dedicated campaign page (`/campaign/[id]`)

## County & Congressional District Maps

State-level results for presidential, governor, and senate elections can be explored at `/elections/[id]/state/[stateId]`.

### County Maps

- **Visualization**: Interactive SVG map showing county-level vote distribution
- **Data**: 3,142 US counties (and county-equivalents) with real population and partisan lean data
- **Hover**: Tooltips showing candidate vote breakdown, margin, and partisan lean per county
- **Algorithm**: Vote distribution is derived from county partisan lean and population; more partisan counties vote more heavily for aligned candidates

### Congressional District Maps

- **Visualization**: Shows House seat allocation by congressional district for that state
- **Data**: Real congressional district boundaries and seat counts
- **API**:
  - `GET /api/elections/[id]/state/[stateId]/county-results`, county vote distribution
  - `GET /api/elections/[id]/state/[stateId]/cd-results`, district seat assignments

## Related Documentation

- [Core Systems](./core-systems.md), Turn structure, term cycles
- [NPP System](./npp-system.md), NPP entry, dropout, spawn
- [Demographics](./demographics.md), Demographic groups, policy preferences
- [Campaign Strategy](./campaign-strategy.md), Fundraising, campaign operations, endorsements
- [Technical Architecture](./technical-architecture.md), Implementation status
- [Cabinet](./cabinet.md), Cabinet nominations use Senate confirmation (related process)
