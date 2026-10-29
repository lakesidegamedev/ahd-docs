# The Granular Layer-1 Electorate (as shipped)

## Summary

The electorate that casts votes in A House Divided is not the 12 voter archetypes any more: it is a lattice of granular demographic cells, the cross-product of Layer-1 census dimensions (race, age, education, wealth in the US; ethnicity, income, urbanization variants abroad), IPF-raked to each state's census marginals. 

This is the live vote path for every country, not a proposal or a flag: the `granularElectorateEnabled` OFF branch has been removed from the tally engine, and a null substrate now means only "this state has no census row yet" (the flag still exists on game state and is read by the primary stagger path, see Known issues and history). The core is `src/lib/demographics/granularElectorate.ts`.

This document supersedes `design/demographics.md` and the two `demographic-election-*audit.md` documents where they describe the archetype electorate or a flag-gated granular path as current.

Player guide: [Demographics](https://www.ahousedividedgame.com/wiki/demographics) and [Granular Polling](https://www.ahousedividedgame.com/wiki/granular-polling)

Terms used below: a **cell** is one combination across the census dimensions (for example white, mature, no college, middle income). A **unit** is a group of cells merged because they lean and vote alike. The **substrate** is the list of units the vote engine counts in place of the old archetype groups. An **overlay** is a durable adjustment added to the census tables before cells are derived.

## Rules

### Cells, units, and the substrate

`buildGranularElectorateSubstrate` produces a drop-in replacement for the legacy engine inputs: a synthetic `DemographicCategory` (id `granularCells`), a `StateDemographics` whose "groups" are cells, live turnouts, and a turnout pool. 

The vote-distribution engines (`voteDistribution.ts`, `voteDistributionSwingFlow.ts`) are unchanged: they iterate whatever groups they are handed, so the appeal formula (policy-distance dominance, favorability weighting, org/reg/support multipliers, see [Formula Deep-Dive](./formula-deep-dive.md)) applies to cells exactly as it did to archetypes.

Derivation, per state (`deriveCellsForState` then `coalesceCells`):

1. **Derive cells.** US states use the state census config plus resolved position tables; other countries use their seeded `CountryLayer1Model` (every country has one). When the era clock is live (`gameState.currentYear` set), census marginals, positions, and turnout rates are resolved for the YEAR, sliding between era anchors (`eraSubstrateForYear.ts`); failures degrade to the frozen-preset lookup with a recorded fallback, never a thrown turn.
2. **Prune.** Cells below `ELECTORATE_PRUNE_FLOOR` = 0.0025 (0.25% of the electorate) are dropped and the rest renormalized.
3. **Coalesce.** Surviving cells merge into units on quantized leans and turnout (`LEAN_QUANT` = 0.5 on the shared −5..+5 axes, `TURNOUT_QUANT` = 5 points), storing share-weighted means and share-weighted `bucketWeights` ("dim:key" → 0..1). Appeal depends only on a unit's leans, so coalescing is the memoization: each distinct quantized lean pair is scored once per candidate.
4. **Memoize.** Unit lists are cached per (country, state, preset, turnout-modifier signature, overlay signatures, year), `UNIT_CACHE_MAX` = 800 entries. The year and the durable overlays are part of the key because they change the derivation itself.

Why this design: the archetype electorate gave twelve fixed groups per country, so a law or a census change could only move whole archetypes. Cells let one law move exactly the voters it touches, and coalescing keeps the cost of scoring thousands of cells down to a few hundred units.

Clamps: bucket rates feeding the geometric mean are held to [1, 99] (`BUCKET_TURNOUT_RATE_MIN`, `BUCKET_TURNOUT_RATE_MAX`), a derived cell's turnout to [15, 95] (`clampTurnout`, `src/lib/demographics/granularCells.ts`), and a unit's turnout to [5, 95].

**Worked example.** Two cells survive pruning: A with share 0.004, lean (1.3, -2.2) and turnout 62, and B with share 0.006, lean (1.4, -2.1) and turnout 61. Their quantized keys are both (round(1.3/0.5) = 3, round(-2.2/0.5) = -4, round(62/5) = 12) so they merge into one unit with share 0.010, lean (1.36, -2.14) and turnout 61.4. Appeal is then scored once for that unit per candidate, not twice.

### Turnout rates and the vote pool

Base bucket turnout comes from `DEMOGRAPHIC_TURNOUT_RATES` in `src/lib/seeds/demographicCategories.ts` (modern national baselines: race white 63 / black 60 / hispanic 48; age young 38 / mid 56 / mature 66 / senior 76; education no_college 52 / college 66 / graduate 74; wealth low 44 / middle 60 / high 74), replaced by era-resolved tables when the year clock is live. A cell's turnout is the geometric mean of its buckets' rates, rescaled so the population-weighted mean matches the state baseline. For example, a white, mature, no-college, middle-wealth cell has bucket rates 63, 66, 52 and 60, a geometric mean of about 60.0 before the rescale.

GOTV, canvassing, and suppression modifiers compose in three ways: US dim-keyed modifiers add directly to bucket rates; archetype-keyed modifiers project onto buckets via the archetype map; non-US archetype-keyed modifiers scale every cell by the state's aggregate live-vs-static ratio (magnitude preserved, per-group targeting not). Ideology-dim modifiers have no cell axis and are dropped on the granular path (documented limitation).

The substrate's `totalPool` is Σ over units of `statePopulation × share × turnout`, where the population basis is `state.votingEligiblePopulation` when the cohort vectors exist. In `src/lib/electionEngine/tallyManagement.ts` this pool replaces `resolveTurnout().totalPool` and is spread across the general-phase turn window by `turnVoteWeight`, then scaled by state approval and office strength.

Registration enters separately, per party, from `statePartyOrg` rows: `registration` feeds `regResistanceMultiplier` (Phase 5a persuasion resistance: entrenched registration resists peel), and `registrationShare` feeds `regBaselineMultiplier` on worlds whose seeds author partisan baselines (UK era polling). Rows without the fields resolve to a neutral 1.0×.

### Mapping archetypes onto cells

Gameplay systems still author effects against archetypes: character and NPP `archetypeApprovals`, legislation `demographicEffects`, Address-driven party-group favorability, GOTV modifiers. `src/lib/demographics/archetypeBucketMap.ts` projects each of the 12 US archetypes onto 2 or 3 census buckets with weights summing to exactly 1.0 (retirees: age:senior 0.7 + age:mature 0.3; new_immigrants: race:hispanic 0.5 + race:asian 0.3 + race:other 0.2; ideology-dominant archetypes like evangelicals are approximated by census correlates). `archetypeValuesToBuckets` distributes a value V as V × w per bucket; a unit then picks up Σ bucketWeight × bucketValue, so a cell matching all of an archetype's buckets receives the full value and partial matches a proportional fraction. 

Non-US countries project through their own seeded `composition` tables (`countryArchetypeBuckets.ts`); archetype ids with no mapping are counted in `getUnmappedArchetypeDrops` rather than silently vanishing. Candidate approvals and `${partyId}:${archetypeId}` favorability deltas are remapped onto unit keys through the same projection, clamped to [−100, 100].

Ordinary legislation lean drift still works: the per-archetype delta (live `stateDemographics` minus the seeded `demographicDefaults` snapshot) is projected onto buckets and folded into unit leans, clamped to the −5..+5 axis. That fold is deliberately zero-sum for anything that moves live and default together, which is exactly why realignments need their own channel.

### Era checkpoints: durable realignment

`src/lib/demographics/eraCheckpoints.ts` declares dated, historically anchored pulls; `src/lib/turn/eraCheckpointTurn.ts` applies them each turn, strictly after `demographicEffects` in the `stateEffectsAndNationalAggregation` phase (both `$set` the same fields, so concurrency would race a lost update).

The registry (`ERA_CHECKPOINTS`) currently ships eight US checkpoints (`southern-realignment-1954`, `road-to-1960`, `national-civil-rights-act-1964`, `voting-rights-act-enfranchisement-1965`, Engel, Reynolds, Griswold, Miranda): the Southern Realignment (triggered by Brown v. Board's docket outcome, 15 years × 48 turns, shifting Deep South voters right through bucket targets: `race:white` by +6.8 economic and +5.85 social, `education:no_college` by +2.8 and +2.55, and `age:mature` by +0.8 and +0.7).

The other checkpoints are the Road to 1960 (late-fifties realignments, 4 years × 48 turns, with Northern Black consolidation among its targets), the national Civil Rights Act Black consolidation (race:black, −2.5 economic / −1.5 social, all states), the Voting Rights Act enfranchisement (a TURNOUT-axis shift: +40 points for race:black in MS and AL, +20 in LA/GA/SC/VA over 3 years), and Engel, Reynolds, Griswold, and Miranda lean nudges. Checkpoints only run in worlds with `startingYear` 1953.

**Worked example.** The Southern Realignment spreads a `race:white` economic shift of +6.8 across 15 x 48 = 720 turns, so the pull is 6.8 / 720 = about 0.0094 per turn in each Deep South state. A sustained law pulling the same bucket the other way at the same rate would net the checkpoint to zero in that state.

Mechanics:

- A target's per-turn pull is `totalShift / durationTurns`. SCOTUS-gated checkpoints start at the case's `decidedAtTurn` when it affirms history and fall back to a later `fallbackStartTurn` when it diverges: a differently composed Court slows history, it does not erase it.
- **Gravity, not rails.** Opposing legislative shifts on the same target net against the pull at `COUNTER_PRESSURE_MULTIPLIER` = 1, so a sustained countervailing law can cancel or reverse a checkpoint in a targeted state. Same-direction legislation is not double-counted.
- **Three substrates move from the same netted delta.** (1) The archetype leans on both `stateDemographics` and `demographicDefaults`, in lockstep, which relocates the resting point without fighting the decay-to-baseline channel and keeps the legacy read paths (state lean, position editor, wiki) moving. (2) A durable per-(dimension, bucket) delta on `demographicDefaults.layer1PositionOverrides`, the only channel the granular vote path reads a checkpoint through: `applyPositionOverlay` adds it to the resolved position table BEFORE cell derivation, so it moves the actual base value a cell's lean is averaged from, and it is never decayed. (3) For turnout-axis targets, `layer1TurnoutOverrides`, applied by `applyTurnoutRateOverlay` to the composed bucket-rate table before derivation, the enfranchisement channel.

Bucket-kind targets (`dim` + `bucket`, e.g. race:white × the Deep South) write only the overlays: precise Layer-1 targeting with no archetype proxy. `checkpointBakedShifts.ts` de-duplicates each checkpoint's `historicalWindow` out of the interpolated era baselines so the shift is not applied twice.

### Vote accumulation through the election engine

The turn phase `voteAccumulation` (`accumulateGeneralElectionVotes` in `src/lib/turn/primaryResolution.ts`, group 7, election resolution, of the turn processor) finds every active election in its general phase (no upper bound on `endTime`, so the final turn's votes are never dropped) and calls into `tallyManagement.ts` per election. There the substrate is built once per state and swapped in for demographics, categories, live turnouts, pool, enriched candidates, and favorability; the turn's vote slice then flows through `distributeVotesByGroupLevelAllocation` or `distributeVotesBySwingFlow` over the units, and the resulting per-candidate votes are added to the persistent `ElectionVoteTally`. Later phases in the same sequential group (`primarySnapshots`, `electionResolution`) resolve races from those accumulated tallies.

Presidential races (`presidentialElectionEngine.ts`), primary stagger waves (`primaryStaggerPhase.ts`), and the cached state-lean read (`cachedStateLean.ts`) consume the same substrate, so polls, leans, and votes cannot disagree about who the electorate is.

The demographics tab reads the same units too: `src/lib/demographics/bucketProfile.ts` aggregates per-bucket share, leans, and turnout as share-weighted sums over `unit.bucketWeights`, so what the player sees is a projection of the exact electorate the engine counts, not a parallel archetype table.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `ELECTORATE_PRUNE_FLOOR` | 0.0025 (0.25% of the electorate) | `src/lib/demographics/granularElectorate.ts` |
| `LEAN_QUANT` | 0.5 on the -5 to +5 axes | `src/lib/demographics/granularElectorate.ts` |
| `TURNOUT_QUANT` | 5 points | `src/lib/demographics/granularElectorate.ts` |
| `UNIT_CACHE_MAX` | 800 cached unit lists | `src/lib/demographics/granularElectorate.ts` |
| Unit turnout clamp | 5 to 95 | `src/lib/demographics/granularElectorate.ts` |
| Cell turnout clamp | 15 to 95 | `src/lib/demographics/granularCells.ts` |
| Bucket turnout clamp | 1 to 99 | `src/lib/demographics/granularElectorate.ts` |
| Lean clamp | -5 to +5, one decimal | `src/lib/demographics/granularCells.ts` |
| `COUNTER_PRESSURE_MULTIPLIER` | 1 | `src/lib/demographics/eraCheckpoints.ts` |
| Archetype weights per archetype | sum to 1.0 over 2 to 3 buckets | `src/lib/demographics/archetypeBucketMap.ts` |
| Candidate approval and favorability deltas | clamped to -100 to +100 | `src/lib/demographics/archetypeBucketMap.ts` |
| Voting Rights Act turnout shift | +40 points race:black in MS and AL, +20 in LA, GA, SC, VA over 3 x 48 turns | `src/lib/demographics/eraCheckpoints.ts` |
| Civil Rights Act consolidation | race:black -2.5 economic, -1.5 social, all states, 10 x 48 turns | `src/lib/demographics/eraCheckpoints.ts` |
| Road to 1960 | 4 x 48 turns, Northern Black consolidation and other targets | `src/lib/demographics/eraCheckpoints.ts` |

Base US bucket turnout rates (race white 63, black 60, hispanic 48, asian 52, other 52; age young 38, mid 56, mature 66, senior 76; education no_college 52, college 66, graduate 74; wealth low 44, middle 60, high 74) are `DEMOGRAPHIC_TURNOUT_RATES` in `src/lib/seeds/demographicCategories.ts`. The US archetype to bucket weights (`ARCHETYPE_BUCKET_MAP`, `src/lib/demographics/archetypeBucketMap.ts`):

| Archetype | Buckets and weights |
| --- | --- |
| young_renters | age:young 0.5, wealth:low 0.3, education:no_college 0.2 |
| evangelicals | race:white 0.6, education:no_college 0.4 |
| rural_traditionalists | education:no_college 0.5, race:white 0.3, age:mature 0.2 |
| union_trades | education:no_college 0.4, wealth:low 0.35, race:black 0.25 |
| soccer_moms | age:mid 0.5, wealth:middle 0.4, race:white 0.1 |
| college_liberals | education:college 0.4, education:graduate 0.3, age:young 0.3 |
| small_business | wealth:high 0.5, age:mature 0.3, race:white 0.2 |
| public_sector | education:college 0.4, wealth:middle 0.4, education:graduate 0.2 |
| retirees | age:senior 0.7, age:mature 0.3 |
| libertarians | race:white 0.4, education:college 0.3, wealth:middle 0.3 |
| new_immigrants | race:hispanic 0.5, race:asian 0.3, race:other 0.2 |
| secular_professionals | education:graduate 0.5, wealth:high 0.3, age:mid 0.2 |

**Worked example.** A law raises retirees' approval of a candidate by 10. It becomes +7 on age:senior and +3 on age:mature. A senior cell picks up +7, a mature cell +3, and a young cell nothing, because each cell takes the sum of bucket weight times bucket value over its own buckets.

### Turn-by-turn population mechanics

Two modules run every turn to keep the underlying population vectors (and the historical baseline they're compared against) internally consistent, independent of the vote-distribution machinery above.

#### `cohortFlows.ts`, age×sex population advance

`advanceCohort()` (`src/lib/demographics/cohortFlows.ts`) advances one region's age×sex population vector (`AgeSexVector`) by one turn, in a fixed order:

1. **Continuous aging** (`applyContinuousAging`), runs every turn, not gated on a year boundary: `1/turnsPerYear` of each age cohort graduates up each turn, smoothing the age structure rather than jumping it once a year.
2. **Mortality** (`applyMortality`), applies a healthcare-modified death rate (`healthcareMortalityModifier`) to the post-aging vector.
3. **Fertility** (`computeBirths` / `splitNewbornsBySex`), converts the `population.birthRate` index to a TFR via `birthRateIndexToTFR()` (anchored to the preset's `replacementTFR`), computes births from the surviving vector (excluding women in mandatory military service from the childbearing pool when `servingFemaleByAge` is supplied, the conscription interaction), and splits newborns by sex into age-0.
4. **International migration** (`applyInternationalMigration`), applies the region's allocated share of national net international migrants (can be negative), using a migrant age/sex profile derived from `migrantShareMale`.

All flows are per-cell non-negative except the international-migration step, which can change total headcount. There is no cross-region internal migration yet (tracked as a future phase). The function returns both the advanced vector and a `CohortFlowTallies` summary (`births`, `deaths`, `netMigration`) for turn reporting.

#### `checkpointBakedShifts.ts`, de-duplicating era checkpoints against authored history

Era checkpoints (`eraCheckpoints.ts`, see above) model historical realignments as a live per-turn pull. But the era anchor tables they pull toward are themselves authored from real election results, which already contain that history baked in, e.g. Alabama's `race:white` economic lean is authored at −3.0 in 1953 and +2.5 in 1979, and that +5.5 swing IS the Southern Realignment. 

Interpolating between those anchors as a live baseline while ALSO running the checkpoint's durable overlay would double-count the same historical shift, pinning the state at the ±5 axis edge.

`bakedCheckpointBucketShifts(stateId, axis, year, startingYear, countryId)` computes exactly how much of each checkpoint's `totalShift` real history had already delivered by a given year (`historicalDeliveredFraction()`: 0 before the checkpoint's `historicalWindow` opens, linear inside it, 1 after it closes), summed per `"dim:key"` bucket. That amount is subtracted from the interpolated era baseline so that `interpolated baseline + durable overlay == the authored anchor` at every anchor point, with smooth movement between anchors. 

This only runs for `startingYear === 1953` worlds (`CHECKPOINT_SEED_YEAR`), the only preset where checkpoints fire at all, any other starting year returns an empty record and the authored anchors are used untouched. The subtraction uses real-world calendar years from `historicalWindow`, not in-world turn counts, so it stays a pure function of the year regardless of how a particular world's SCOTUS docket paced the underlying checkpoint.

## Data

| Collection | Fields | Read or written | Player-visible |
| --- | --- | --- | --- |
| `states` | `population`, `votingEligiblePopulation`, `countryId` | Read | Yes |
| `stateDemographics` | live per-archetype leans and group shares | Read; written by `demographicEffects` and `eraCheckpointTurn` | Yes (demographics tab, as bucket profiles) |
| `demographicDefaults` | seeded archetype leans, `layer1PositionOverrides`, `layer1TurnoutOverrides` | Read; written by `eraCheckpointTurn` | No |
| `demographicCategories` | archetype categories (the engine builds a synthetic `granularCells` category in memory, not stored) | Read | No |
| `stateDemographicTurnout` | per-group turnout modifiers | Read; written by decay, canvassing and GOTV | Partly (polls and turnout views) |
| `statePartyOrg` | `registration`, `registrationShare`, org | Read | Yes |
| `stateRegistrationPool` | registration pools | Read | Yes |
| `regionDemographics` | age by sex population vector (`AgeSexVector`), birth and migration inputs | Read and written by `demographicFlows` | Yes |
| `docketCases` | decided case outcomes and turns | Read by `eraCheckpointTurn` (SCOTUS-gated checkpoints) | Yes |
| `legislationTypes` | `demographicEffects` on laws | Read | Yes |
| `electionVoteTallies` | running per-candidate votes | Written by vote accumulation | Yes (results) |
| `gameState` | `preset`, `startingYear`, `currentYear`, `eraSystemEnabled`, `granularElectorateEnabled`, `granularPollEnabled` | Read | No |

The unit lists themselves are not stored. They are cached in process memory (up to 800 entries) and rebuilt from the collections above whenever the key changes.

## Configuration

| Setting | Default | Where set | Effect |
| --- | --- | --- | --- |
| `gameState.granularElectorateEnabled` | true on fresh worlds | `src/lib/seeds/reference/featureFlagDefaults.ts` | Read by the primary stagger path (`src/lib/turn/primaryStaggerPhase.ts`); the general-election tally no longer reads it |
| `gameState.granularPollEnabled` | true on fresh worlds; absent reads as off | `src/lib/seeds/reference/featureFlagDefaults.ts`, `src/lib/demographics/granularPollFlag.ts` | Poll panel breakdowns only, not votes |
| `gameState.eraSystemEnabled`, `currentYear` | world-specific | World config | Live era clock; year-resolved census, positions and turnout |
| `gameState.startingYear` | world-specific | World reset | 1953 turns era checkpoints on |
| `gameState.preset` | world preset | World reset | Frozen-preset fallback tables |
| Country Layer-1 model | seeded for every country | Seeds (`CountryLayer1Model`) | Non-US cell derivation |
| Census marginals and position tables | per state and era | Seeds, `eraSubstrateForYear.ts` | Cell derivation inputs |

All constants in the Constants table are source constants, not runtime settings.

## Timing

1. Group 2 (`demographicsAndPartySetup`): turnout decay and party GOTV move the turnout modifiers, which are part of the unit cache key.
2. Group 7 (`electionResolutionAndGovernment`): `primaryResolution`, then `voteAccumulation`, which builds the substrate per state for every active general election and adds the turn's votes to the tallies, then `campaignSpendReset`, with `primarySnapshots` and `electionResolution` later in the same group.
3. The state-effects stage, which runs after election resolution within the same turn: `demographicEffects` applies enacted-law effects to the live archetype leans (compared with the seeded defaults), then `eraCheckpointTurn` runs strictly after it in the same phase because both write the same fields, then `demographicFlows` and the cohort advance (`advanceCohort`) keep the population vectors consistent, independent of the vote engine.

Because the state-effects stage comes after election resolution, a turn's votes are counted against the leans, overlays and cohorts left by the previous turn's state-effects stage. Unit lists are rebuilt only when their cache key changes (turnout-modifier signature, overlay signatures, year), so most turns reuse a cached list.

```
group 2   turnout decay, party GOTV      -> turnout-modifier signature changes cache key
group 7   voteAccumulation               -> substrate (cached units) -> distribute votes -> electionVoteTallies
stage     demographicEffects -> eraCheckpointTurn -> demographicFlows (advanceCohort)
          (writes leans and overlays that the NEXT turn's substrate reads)
```

## Worked trace

Carrying the cell example from Rules through to the pool. A state has 1,000,000 voting-eligible people. Cells A and B (above) merge into unit U1 with share 0.010, lean (1.36, -2.14) and turnout 61.4, and U1's bucket weights are `age:senior` 0.4 (A) and `age:mature` 0.6 (B), since weights are the share-weighted fractions.

| Step | Calculation | Result |
| --- | --- | --- |
| Pool contribution | `1,000,000 x 0.010 x (61.4 / 100)` | 6,140 into `totalPool` (the pool is rounded once over all units) |
| Law effect on U1 | A law raises retirees' approval of a candidate by 10: `age:senior` +7, `age:mature` +3. Unit value is `0.4 x 7 + 0.6 x 3` | +4.6 |
| Effective favorability | Candidate favorability 64 plus half of 4.6 | 66.3 |
| Approval term | `(66.3 / 100)^0.8` | about 0.720 (against 0.700 without the law) |
| Appeal | Scored once for lean (1.36, -2.14), shared by A and B | one `calcAppeal` call per candidate |

The state's `totalPool` then replaces the legacy pool, `turnVoteWeight` slices it across the general window, state approval and office strength scale the slice, and the unit's weight (appeal, reach, approval and the other factors in [Formula Deep-Dive](./formula-deep-dive.md)) splits U1's share of the slice among candidates. The result is added to `electionVoteTallies`.

## Edge cases and limits

- A null substrate means only that the state has no census row yet; it does not turn a flag off.
- Year-resolved census, positions and turnout failures fall back to the frozen-preset lookup with a recorded fallback, never a thrown turn.
- Ideology-dimension turnout modifiers have no cell axis and are dropped on the granular path.
- Non-US archetype-keyed turnout modifiers scale every cell by the state's live-versus-static ratio, so magnitude is kept but per-group targeting is lost.
- Archetype ids with no bucket mapping are counted in `getUnmappedArchetypeDrops` instead of vanishing silently.
- Checkpoints fire only in worlds with `startingYear` 1953; any other start returns no baked shifts and uses the authored anchors untouched.
- If the Court case that triggers a checkpoint diverges, the pull starts later (`fallbackStartTurn`): a different Court slows history, it does not erase it.
- Legislation drift is zero-sum for anything moving live and default values together, which is why realignments use a separate overlay channel.
- International migration is the only cohort flow that can change total headcount; there is no cross-region internal migration yet.
- Granular polling breakdowns are gated by `granularPollEnabled` on the game state (fail closed: absent reads as off). That gate affects only the poll panel, not the vote path.
- A state with zero surviving cells after pruning has no substrate and counts as no census row.
- Unit turnout is clamped to 5 to 95 after cell turnout was clamped to 15 to 95, so the wider unit clamp only matters for share-weighted means of already clamped cells.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Surviving cell shares are renormalized to sum to 1 after pruning | `src/lib/demographics/granularElectorate.test.ts` |
| Archetype to bucket weights sum to exactly 1.0 per archetype, over 1 to 3 buckets | `src/lib/demographics/granularElectorate.test.ts` (mapping invariants), `archetypeBucketCoverage.test.ts` for the non-US tables |
| Leans stay within -5 to +5; cell turnout within 15 to 95; unit turnout within 5 to 95 | Clamps in `granularCells.ts` and `granularElectorate.ts`; cell turnout upper bound asserted in `granularCells.test.ts`, the others not directly tested |
| Era checkpoints start at the case decision or the fallback turn, and do nothing outside a 1953 world | `src/lib/demographics/eraCheckpoints.test.ts`, `src/lib/turn/eraCheckpointTurn.test.ts` |
| Opposing laws net against a checkpoint pull | `src/lib/demographics/durableRealignment.test.ts` |
| Checkpoints and demographic effects never write the same fields concurrently | Sequencing in `stateEffectsPhase.ts`; `src/lib/turn/eraCheckpointTurn.test.ts`. No test pins the order itself |
| Interpolated baseline plus durable overlay equals the authored anchor at every anchor | `checkpointBakedShifts.ts` design; no dedicated test found |
| Unmapped archetype ids are counted, not silently dropped | `src/lib/demographics/archetypeDropVisibility.test.ts` |
| Cohort flows are non-negative except international migration | `src/lib/demographics/cohortFlows.test.ts` |

## Failure and recovery

- **No substrate for a state.** The state has no census row. Symptom: the state has no units, so the engine treats it as having no census row. Repair is to seed or restore the census row, after which the next accumulation builds units.
- **Year-resolved data fails.** The derivation falls back to the frozen-preset lookup with a recorded fallback and never throws the turn. Symptom: era-sliding values stop moving for that state. Repair the era tables and the cache key (year) rebuilds units.
- **A checkpoint bug.** Checkpoint processing is isolated and logged, so a failure cannot mark the whole demographic effects phase failed or discard its writes. The repair is a code fix, after which the next turn applies the pull again; check that the affected states' overlays advanced as expected.
- **Overlays out of step with leans.** If live and default archetype leans drift apart, the legacy read paths (state lean, editor) and the vote path disagree. A demographics heal that rewrites both from the seeds restores them; overlays are separate and can be rebuilt from the checkpoint definitions.
- **Stale unit cache.** Cached lists are keyed on every input that changes the derivation, so staleness shows only after a code change; a process restart clears it.

## Connections

**Driven by:**

- [Policy system](./policy-system.md) and [Bills & Legislation](./bills-legislation.md): `demographicEffects` on enacted laws move archetype leans, which are projected onto buckets.
- [Demographics](./demographics.md) and [Demographics & Targeting](./demographics-targeting.md): turnout modifiers (GOTV, canvassing, suppression) feed bucket rates.
- [World and era systems](./world-and-era-systems-as-shipped.md): the era clock selects census, positions and turnout rates for the year, and starting year 1953 enables checkpoints.

**Affects:**

- [Election Engine](./election-engine.md): the units are the groups the vote distribution iterates, in `tallyManagement.ts`, `presidentialElectionEngine.ts` and `primaryStaggerPhase.ts`.
- [Demographics & Targeting](./demographics-targeting.md): the demographics tab and polls read the same units via `bucketProfile.ts`.
- [Formula Deep-Dive](./formula-deep-dive.md): cell lean and turnout are the appeal and pool inputs for every vote weight.

## Tests

| Area | Test files |
| --- | --- |
| Cells, coalescing, overlays | `src/lib/demographics/granularElectorate.test.ts`, `granularCells.test.ts`, `granularElectorateYear.test.ts`, `granularElectorateBetweenness.test.ts`, `granularElectorateIntlModifiers.test.ts` (same folder) |
| Archetype projection | `src/lib/demographics/archetypeBucketCoverage.test.ts`, `countryArchetypeBuckets.test.ts`, `archetypeDropVisibility.test.ts` |
| Era checkpoints | `src/lib/demographics/eraCheckpoints.test.ts`, `src/lib/demographics/durableRealignment.test.ts`, `src/lib/demographics/deepSouthElectorate.test.ts`, `src/lib/turn/eraCheckpointTurn.test.ts` |
| Population mechanics | `src/lib/demographics/cohortFlows.test.ts`, `cohortVector.test.ts` |
| Demographics tab | `src/lib/demographics/bucketProfile.test.ts` |
| Polling gate | `src/lib/actions/granularPollPayload.test.ts` |
| Engine use | `src/lib/electionEngine/tallyManagement.test.ts`, `src/lib/demographicEffects.buckets.test.ts` |

Gaps: `applyTurnoutRateOverlay` and `bakedCheckpointBucketShifts` have no tests that call them by name, and the phase order of `demographicEffects` then `eraCheckpointTurn` is protected only by a code comment.

## Known issues and history

- `granularElectorateEnabled` still exists. Its type comment in `src/lib/db/types/gameState.ts` still says false means legacy archetype behavior, which is no longer true for general elections, and `src/lib/turn/primaryStaggerPhase.ts` still reads it (substrate is used when it is true or when the race uses campaign ads).
- Ideology-dimension turnout modifiers are dropped on the granular path, a documented limitation in `granularElectorate.ts`.
- Non-US archetype-keyed turnout modifiers keep magnitude but lose per-group targeting.
- No cross-region internal migration yet; the code marks it as a future phase.
- Corrected 2026-10-29 (code contradicted this page): vote accumulation is turn group 7, not group 5; the Timing list put `demographicEffects` and `eraCheckpointTurn` before vote accumulation, but the state-effects stage runs after election resolution, so votes use the previous turn's values.
- This page supersedes the archetype-era demographics design pages where they describe the archetype electorate as current (stated in Summary).

Last checked: 2026-10-29, version 1.18.0
