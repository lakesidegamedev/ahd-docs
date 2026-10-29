# National Metrics System

Player guide: [National Metrics](https://www.ahousedividedgame.com/wiki/national-metrics)

## Summary

National metrics are the country-level scorecard. Every region (state, Land, prefecture, devolved nation) keeps its own metric values. Each turn, after every writer has finished, the game rolls the regional values up into one national document per country, snapshots the result into history arrays, and records government approval. The national page (rankings, min and max region, distribution) and the approval calculation read from the same regional data.

The metric system has two halves.

- **Macro half** (`economic`, `population`, plus three governance fields). Stored in the `macroMetrics` collection for every country. This is what the national rollup, the history snapshot and the national metrics endpoint read and write.
- **Political half** (nine categories of seven families each). Lives on the political "board" (`politicalMetrics`), not in the macro store. The national view of the board is computed at read time, not stored.

The live metric-engine registry (`METRIC_REGISTRY` in `src/lib/metricEngine/registry/index.ts`) holds 74 nodes across 9 categories: economic 12, education 6, environment 5, governance 11, healthcare 9, infrastructure 7, media and information 5, public safety 8, social 11. Some nodes are country-specific (for example `gcseAttainment`, `nhsWaitingTime`, `bbcTrust`, `bundeswehrReadiness`). Schema and approval still use 10 `MetricCategoryId` buckets (`src/lib/db/types/stateMetrics.ts`), including `population`, which has no registry file.

Government approval walks all 10 buckets but skips four cohort-flow metrics as approval terms. Approval in turn scales the vote pool in elections. For the approval formula and named modifiers, see [Government Approval](./government-approval.md).

## Rules

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `METRIC_HISTORY_CAP` | 96 entries per metric (2 game years at 48 turns per year) | `src/lib/metricHistory.ts` |
| Rollup rounding | 3 decimals (`Math.round(x * 1000) / 1000`) | `src/lib/nationalMetrics/rules.ts` |
| Government approval history | 20 entries, most recent last (`$slice: -20`) | `src/lib/utils/governmentApproval.ts`, `src/lib/db/types/governmentApproval.ts` |
| `BASE_APPROVAL` (also the default when a region has no metrics) | 50 | `src/lib/utils/governmentApproval.ts` |
| Legislative approval slope | 0.2 | `src/lib/electionEngine/approvalVoteMultiplier.ts` |
| Presidential approval slope | 0.5 | `src/lib/electionEngine/approvalVoteMultiplier.ts` |
| Office strength (US) | Governor 1.0, House 0.9, Senate 0.8, State Senate 0.85, President 1.0 | `src/lib/countries/us/institutionsFacts.ts`, read through `getPartyStrengthWeight` in `src/lib/constants/countries.ts` |
| Office strength default | 0.9 when an office has no configured weight | `src/lib/constants/countries.ts` |
| Metric registry size | 74 nodes in 9 categories | `src/lib/metricEngine/registry/index.ts` |
| `MAX_PER_METRIC_MODIFIER_PER_TURN` | 0.08 (combined cabinet pressure on one metric per turn, then scaled by the metric span) | `src/lib/turn/ministerialOrderProcessing.ts` |
| `DECAY_RATE` | 0.0025 of the remaining gap to baseline per turn | `src/lib/turn/metricDecay.ts` |
| `INCOME_BAND_BACKSOLVE_MIN` / `MAX` | 0.4 / 2.5 | `src/lib/nationalMetrics.ts` |
| Political history cadence | one snapshot every 24 turns | `src/lib/politicalMetrics/historyCadence.ts` |
| Political history caps | 365 entries national, 90 per region | `src/lib/politicalMetrics/historyCadence.ts` |
| National scope ids | `federal` (US), `uk_national`, `sco_national`, `wal_national`, `jp_national`, `de_national`, `br_national`, `ie_national`, `cn_national`, `ng_national`, `su_national` (RU), `dd_national` | `src/lib/constants/nationalScope.ts` |

### National rollup formulas

`computeNationalMetrics` (`src/lib/nationalMetrics.ts`) runs once per country with at least one region and a non-zero total population. For each category and metric key it builds one row per region (value, population, GDP, labour force) and calls `aggregateNationalMetricValue` (`src/lib/nationalMetrics/rules.ts`). Regions with a missing or non-finite value are skipped, never treated as zero. National-scope documents are excluded from the input so they cannot feed back into themselves.

| Metric | Aggregation |
| --- | --- |
| `economic.laborForce` | Sum of regional headcounts, written only when every region has a valid, non-negative value |
| `economic.unemploymentRate` | `sum(rate * laborForce) / sum(laborForce)`, used only when every region with a rate also has a positive labour force. Otherwise falls back to population weighting |
| `economic.gdpGrowth` | `sum(value * regionGdp) / sum(regionGdp)`, regions with zero or missing GDP excluded |
| `economic.labourDemand` | Sum of regional demand, written only when every region has a reading stamped with this turn. Otherwise the field and its turn stamp are cleared |
| `economic.labourTightness` | `sum(demand) / sum(laborForce)`, same completeness rule, rounded to 3 decimals |
| `governance.budgetBalance` | `surplus / budget.gdp * 100`, where `surplus` is `budget.surplus` or `revenue.total - spending.total`. Written when the federal budget has a positive GDP |
| `governance.debtToGdp` | `budget.debtToGdpRatio * 100`, written when that ratio is a number |
| Everything else | `sum(value * population) / sum(population)` |

Only macro paths are written (`isMacroMetricPath` in `src/lib/macroMetrics/paths.ts`: the `economic` and `population` categories, `governance.independenceDesire`, `governance.budgetBalance`, `governance.debtToGdp`). The rollup does not write political paths. Each write is an upsert to `macroMetrics` under the national-scope id with `countryId`.

### Era income-band index

Only while `gameState.eraSystemEnabled` is true. For each country: `gdpPc` is national GDP per capita (`aggregateNationalGdp`). If no baseline is stored, `impliedIndex = weightedMedianIncome / eraAnchor`. The baseline is `gdpPc / impliedIndex` when `impliedIndex` is inside 0.4 to 2.5, otherwise `gdpPc` (index 1.0 at world start). The stored index is `round(gdpPc / baseline * 10000) / 10000`. Seeds whose income and anchor disagree on currency scale fall outside the band; without the guard a 1953 UK law priced on the income term came out about 7.3 times too dear.

### National metrics endpoint

`GET /api/country/[code]/metrics` (`src/app/api/country/[code]/metrics/route.ts`, backed by `loadNationalMetrics` in `src/lib/country/nationalMetrics.ts`). The country is a path segment, not a query parameter; `category` is an optional query filter. Any `CountryId` in `COUNTRY_CONFIGS` is valid; an unknown code returns 400 and a country with no metrics returns 404.

1. Loads the country's regions and their merged macro metric documents.
2. For each metric that is active in the current era (`isMetricActive`), computes the simple average, the population-weighted average over covered population (`populationWeightedAverage`), the weighted trend, and the min and max region.
3. Ranks all regions per metric. Direction comes from `IS_HIGHER_BETTER`: higher-is-better ranks descending, lower-is-better ascending.
4. Builds the country's own population-weighted averages, scores each region against them (`calculateStateApproval`), and loads the national approval (`loadNationalApproval`).
5. Adds national GDP, GDP per capita, currency code and per-metric tick rates (`computeAllNationalMetricTickRates`).

The response carries `categories`, `stateRankings`, `totalPopulation`, `gdpMillions`, `gdpPerCapita`, `currencyCode`, `tickRates`, `calculatedAt`, `governmentApproval`, `governmentApprovalBase`, `governmentApprovalModifiers` and `stateApprovals`. Keys named `__proto__`, `constructor` and `prototype` are dropped. The route sends `Cache-Control: no-store, no-transform`.

### National approval endpoint

`GET /api/country/[code]/approval` (`src/app/api/country/[code]/approval/route.ts`, backed by `loadNationalApproval` in `src/lib/country/nationalApproval.ts`). Returns `governmentApproval`, `governmentApprovalBase`, `history`, `modifiers`, `stateAverage` and `nationalAdjustments`, also with `no-store`. It prefers the stored snapshot in `governmentApprovals` (rating, base, regional and national modifiers). Only when a field is missing does it recompute live: `recomputePoliticalNationalApproval` for board countries, `recomputeNationalApproval` otherwise. The live path is deliberately lighter than the snapshot and carries no war, address, organisation or cabinet terms.

Both routes score a region against the country's own national average. There is no cross-country baseline.

### Approval into elections

Each turn the vote pool for a race is scaled by `(1 + (approvalDecimal - 0.5) * slope) * officeStrength` (`approvalVoteMultiplier`, `src/lib/electionEngine/approvalVoteMultiplier.ts`). Legislative races use slope 0.2 in `src/lib/electionEngine/tallyManagement.ts`; presidential races use slope 0.5 in `src/lib/presidentialElectionEngine.ts`. `approvalDecimal` is the state's approval as a 0 to 1 fraction, and a missing state approval falls back to `BASE_APPROVAL`. Centering on 0.5 stops the multiplier dominating the pool; the presidential slope is steeper for the same shape.

### What moves a metric

State metrics change from enacted laws (policy effects), demographic shifts, the metric engine's own links between nodes, cabinet orders and settings, the budget and economic model, decay toward baseline, and events such as crises. Players move them by passing laws, running cabinet actions and managing the budget. They cannot edit a metric directly.

## Data

| Collection | Read or written | What it holds | Shown to players |
| --- | --- | --- | --- |
| `macroMetrics` | Read and written | One document per region plus one per national-scope id: `economic`, `population`, `governance.budgetBalance`, `governance.debtToGdp`, top-level `independenceDesire`, `economicModel`, `lastUpdated`. National documents are derived and have `countryId` set | Yes, through the metrics endpoint and region pages |
| `macroMetricsHistory` | Written each turn, read by `getMetricHistory` | Per-metric arrays of `{ turn, value }`, capped at 96, for regions and national-scope ids | Yes, as history charts |
| `politicalMetrics` | Read by approval and display code, written by `politicalMetricsDynamics` | The board: `values` per family, plus residual fields | Yes, through political metric displays |
| `politicalMetricsHistory`, `politicalMetricsRegionHistory` | Written by the dynamics phase | `entries` of `{ turn, values }`, one per 24 turns (national and per region) | Yes |
| `states` | Read | `population`, `gdp`, `countryId` per region (the rollup weights) | Partly |
| `federalBudget` | Read | `gdp`, `surplus`, `revenue.total`, `spending.total`, `debtToGdpRatio` | Yes, in budget views |
| `gameState` (`current`) | Read and written | Reads `currentTurn`, `currentYear`, `startingYear`, `eraSystemEnabled`, `eraGdpPerCapitaBaseline`, `incomeStartVintages`. Writes `incomeBandIndexByCountry` and, on first computation, `eraGdpPerCapitaBaseline` | No |
| `governmentApprovals` | Read by the routes, written by the approval snapshot | One document per country keyed by `CountryId`: `approvalRating`, `disapprovalRating`, `netApproval`, `approvalBase`, `activeRegionalModifiers`, `activeNationalModifiers`, `source`, `headOfGovernmentKey`, `headOfGovernmentSinceTurn`, `warExhaustion`, `history` (20 entries), `updatedAt` | Yes (rating, history, modifiers) |
| `stateDemographics` | Read | Demographic groups per region, used to weight state approval | No |

Each metric value has the shape `{ value: number; trend?: number }` (`StateMetricValue`). The legacy `stateMetrics` document shape is retained as the read model (`StateMetrics`), but `src/lib/macroMetrics/merge.ts` projects it from `macroMetrics` alone; the rollup no longer writes a political half.

### Metric categories (document buckets)

The lists below are the original seeded fields per `MetricCategoryId` bucket. The registry and some countries add more (for example `sectorGrowth`, `laborForce`, `labourDemand`, `labourTightness`, `consumerConfidence`, `investorConfidence`).

| Bucket | Seeded metrics |
| --- | --- |
| Economic (6) | `unemploymentRate`, `medianIncome`, `gdpGrowth`, `povertyRate`, `costOfLiving`, `smallBusinessFormation` |
| Education (6) | `highSchoolGradRate`, `universityEnrollment`, `testPerformance`, `educationSpending`, `literacyRate`, `workforceSkill` |
| Healthcare (6) | `uninsuredRate`, `affordabilityIndex`, `physicianRate`, `lifeExpectancy`, `preventableMortality`, `publicHealthPreparedness` |
| Infrastructure (6) | `roadCondition`, `broadbandAccess`, `publicTransit`, `waterQuality`, `powerGridReliability`, `infrastructureInvestmentGap` |
| Public Safety (6) | `crimeRate`, `violentCrimeRate`, `policePerCapita`, `incarcerationRate`, `recidivismRate`, `publicSafetyConfidence` |
| Environment (6) | `airQuality`, `renewableEnergy`, `carbonEmissions`, `recyclingRate`, `climateResilience`, `protectedLand` |
| Social (6) | `socialMobility`, `incomeInequality`, `homelessnessRate`, `foodInsecurity`, `civicParticipation`, `socialCohesion` |
| Governance (5) | `governmentTransparency`, `budgetBalance`, `corruptionIndex`, `voterTurnout`, `publicTrust` |
| Population (4) | `populationGrowth`, `urbanizationRate`, `medianAge`, `migrationRate` |
| Media and Information (5) | `mediaPolarization`, `disinformationRisk`, `pressFreedom`, `socialMediaSentiment`, `newsTrust` |

The field is `universityEnrollment`, not `collegeEnrollment`. The metric was merged (#909) into a single higher-education enrolment metric with a country-appropriate model: high-school-graduation-driven in the US, GCSE-driven elsewhere (`src/lib/metricEngine/registry/education.ts`). `collegeEnrollment` no longer exists.

### Political board

The political half has 9 categories (`economy`, `education`, `health`, `infrastructure`, `order`, `environment`, `society`, `governance`, `defense`), seven families each, defined in `src/lib/politicalMetrics/types.ts`. The national view is `aggregateNationalPoliticalMetrics` (`src/lib/politicalMetrics/aggregate.ts`): per family, `sum(value * regionPopulation) / sum(regionPopulation)` over regions with positive population and a finite value, or 0 when no region qualifies. A category score is the mean of its families; the overall score is the mean of the category scores.

## Configuration

| Setting | Effect | Default and where set |
| --- | --- | --- |
| `gameState.eraSystemEnabled` | Turns on the era income-band index and, through `isMetricActive`, hides metrics that do not exist in the current year from the national page, rankings and tick rates | Set on the `current` game state; off unless the era system is enabled |
| `gameState.incomeStartVintages`, `startingYear` | Pick the era income anchor used for the back-solve | Stamped at world start from `src/lib/era/metricCatalog.ts` |
| `gameState.eraGdpPerCapitaBaseline` | Per-country baseline for the income-band index; self-heals on the first computation, never overwritten once stored | Written by `computeNationalMetrics` |
| `gameState.preset` | Selects era patches in approval modifiers and scoring | `DEFAULT_SEED_PRESET` in `src/lib/constants/seedPreset.ts` |
| `NATIONAL_SCOPE` | Which countries get a national-scope document. Adding a country is one line | `src/lib/constants/nationalScope.ts` |
| `CountryConfig.approvalSource` and office `partyStrengthWeight` | Approval source type and the per-office strength multiplier in the vote pool | `COUNTRY_CONFIGS` in `src/lib/constants/countries.ts` and each country's `institutionsFacts.ts` or era file |
| Regional budget cadence | Regional budget phases run every N turns and feed policy delivery | `src/simulation/phases/regionalBudgetCadence.ts` |

Approval excludes `populationGrowth`, `medianAge`, `sexRatio` and `dependencyRatio` as approval terms (`src/lib/utils/governmentApproval.ts`). `migrationRate` stays, because it is a policy lever.

## Timing

Everything runs inside the `stateEffectsAndNationalAggregation` adapter (`src/simulation/phases/stateEffectsPhase.ts`), registered in the turn pipeline described in [Turn Processing](./turn-processing.md).

```text
serialized:  crisisTurn -> intelligenceTurn -> navairOperations -> ministerialOrders -> policyEffects
parallel with it (one Promise.all): demographicEffects, archetypeApprovalDecay, unownedSectorGrowth,
    metricDecay, subsidyBudget, regional budget processors, politicalMetricsDynamics, ...
then in order: metricEngine -> demographicFlows -> statehood -> census -> eraCrossing -> metricActivation
    -> cabinetYearCrossing -> militaryBranchYearCrossing -> nationalMetrics -> fiscalBaseGrowth
    -> economicModel -> tradeGrowthMirror -> inflationRecalc -> ... -> independenceDesireDrift
    -> referendumLifecycle -> partyMemberCountReconcile
finally (together): metricHistory (snapshotMetricHistory) and approvalSnapshot (snapshotApprovalsForTurn)
```

Order matters for three reasons. `crisisTurn` and `ministerialOrders` write the same metric paths with `$inc` and `policyEffects` does a read-modify-write, so they are serialized (crisis, then orders, then policy) to avoid a lost update. `nationalMetrics` runs after the metric engine and every other writer, so the national average sees finished values. The history and approval snapshots run last, so they record those same finished values.

The approval snapshot covers every country that already has a `governmentApprovals` document, every active country, and every current belligerent (`src/lib/utils/approvalSnapshotTargets.ts`). A belligerent that is not otherwise active is a guest and is released once its war exhaustion has healed.

## Worked trace

A country with two regions. Region A: population 30,000,000, GDP 900,000, labour force 15,000,000, unemployment 4.0, GDP growth 2.0, median income 40,000, labour demand 12,000,000. Region B: population 10,000,000, GDP 100,000, labour force 4,000,000, unemployment 8.0, GDP growth 6.0, median income 30,000, labour demand 3,800,000. Both labour demand readings are stamped with this turn. The federal budget has GDP 4,000, surplus -120 and `debtToGdpRatio` 0.62.

| Stored field | Calculation | Stored value |
| --- | --- | --- |
| `economic.laborForce` | 15,000,000 + 4,000,000 | 19,000,000 |
| `economic.unemploymentRate` | (4.0 * 15,000,000 + 8.0 * 4,000,000) / 19,000,000 = 92,000,000 / 19,000,000 = 4.842105 | 4.842 |
| `economic.gdpGrowth` | (2.0 * 900,000 + 6.0 * 100,000) / 1,000,000 = 2,400,000 / 1,000,000 | 2.4 |
| `economic.medianIncome` | (40,000 * 30 + 30,000 * 10) / 40 = 1,500,000 / 40 | 37,500 |
| `economic.labourDemand` | 12,000,000 + 3,800,000 | 15,800,000 |
| `economic.labourTightness` | 15,800,000 / 19,000,000 = 0.831579 | 0.832 |
| `governance.budgetBalance` | round(-120 / 4,000 * 100 * 1000) / 1000 = round(-3000) / 1000 | -3 |
| `governance.debtToGdp` | round(0.62 * 100 * 1000) / 1000 | 62 |

Each value is written to the `macroMetrics` document for the national-scope id, then `snapshotMetricHistory` appends `{ turn, value }` to `macroMetricsHistory`, dropping the oldest entry once an array holds 96.

The page endpoint reports different numbers for the same inputs, because it weights every metric by covered population: unemployment `(4.0 * 30 + 8.0 * 10) / 40 = 5.0` (simple average 6.0) and GDP growth `(2.0 * 30 + 6.0 * 10) / 40 = 3.0`. See Known issues.

Vote pool: a state with approval 62 has `approvalDecimal = 0.62`, so `0.62 - 0.5 = 0.12`. Legislative multiplier `1 + 0.12 * 0.2 = 1.024`. Times office strength: Governor 1.024, House 0.9216, Senate 0.8192, State Senate 0.8704. Presidential multiplier `1 + 0.12 * 0.5 = 1.06`, times strength 1.0.

A policy that cuts region B's unemployment by 1 point lowers the stored national rate by `1 * 4,000,000 / 19,000,000 = 0.2105` points.

## Edge cases and limits

- National-scope documents are never averaged back into aggregates, which would double count.
- A country with no regions or zero total population is skipped and its national document is not touched.
- A region missing a metric is skipped for that metric, not counted as zero. A region with no population contributes nothing to a population-weighted figure. In the page endpoint the denominator is covered population, so a region without the metric does not dilute the average.
- Unemployment falls back to population weighting when any region lacks a positive labour force, which also supports older worlds without the field. `laborForce` is never written as a partial sum.
- Labour demand and tightness are cleared when any region lacks a reading stamped with the current turn, so stale telemetry cannot persist.
- If all regions have zero GDP, `gdpGrowth` is omitted from the write rather than set to zero.
- Missing metrics default to 50% approval, so one absent node cannot swing a vote pool.
- History arrays drop the oldest entry at 96 (metrics) and 20 (approval).
- Country-specific nodes exist only in the countries that use them. In an earlier era, `isMetricActive` hides metrics that did not exist yet from the page only; the turn-phase rollup is deliberately ungated.
- Some countries have no national-scope document (the id is null in the rollup). They still get their income-band index computed when era vintages are stamped.
- Rankings are direction-aware: for lower-is-better metrics a low value ranks well.
- State ids collide across countries (for example Bremen and Huabei both use `HB`), so every regional read is scoped by `countryId`.
- Ministerial orders are clamped to 0.08 per metric per turn before span scaling, so a minister cannot move a metric by more than a small fixed step each turn.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| National documents exclude existing national-scope documents from their inputs | `src/lib/nationalMetrics.test.ts` ("does not include existing national docs in the state average", "excludes uk_national from UK state averages") |
| Rollup values carry at most 3 decimals | `src/lib/nationalMetrics.test.ts` ("rounding") |
| A partial labour force or partial labour demand never produces a national total | `src/lib/nationalMetrics.test.ts` ("does not write a partial national labor-force sum", "clears national labor telemetry when any region lacks a current-turn demand snapshot") |
| GDP growth is GDP weighted, unemployment labour-force weighted | `src/lib/nationalMetrics.test.ts` ("weights gdpGrowth by state GDP, not population", "uses labor-force weights for unemployment ...") |
| One country's regions never contaminate another's national document | `src/lib/nationalMetrics.test.ts` ("US and UK national docs do not contaminate each other") |
| History keeps at most 96 entries per metric | Mongo `$slice: -METRIC_HISTORY_CAP`; the push operation is asserted in `src/lib/metricHistory.test.ts` |
| Approval history keeps at most 20 entries | `$slice: -20` in the snapshot; not covered by a dedicated length test |
| Approval stays in 0 to 100 | Clamp in `src/lib/utils/governmentApproval.ts` (`Math.max(0, Math.min(100, ...))`); a malformed metric document can still yield `NaN` from `recomputeNationalApproval`, which callers must check |
| Every country in the game is registered in `NATIONAL_SCOPE` | Not enforced by a test; DD was missing until it became playable and had no national row or economy chart entry |

## Failure and recovery

- **Missing national document.** A country absent from `NATIONAL_SCOPE` gets no national metrics row and drops out of economy charts and health checks. Repair is adding the line and letting the next turn upsert the document.
- **Stale or missing approval snapshot.** If a country has no `governmentApprovals` document (for example a non-playable country not at war), the approval route recomputes live. That figure is lighter than the stored one and shows no war or cabinet terms. The next snapshot creates the document for active countries and belligerents.
- **Labour telemetry stale.** Cleared automatically on any turn where a region lacks a fresh reading, and refilled when the corporation turn stamps all regions again.
- **Bad income-band baseline.** A seed whose income and era anchor disagree on scale is detected by the 0.4 to 2.5 band and given index 1.0. A wrong stored baseline is repaired by clearing `eraGdpPerCapitaBaseline` for that country so the next turn back-solves it.
- **A writer lost an update.** The serialization of crisis, orders and policy exists for this. If metrics show a missing shock or order effect, the symptom is a value that ignores a known `$inc`; a rerun of the turn recomputes from the stored state.
- **Corrupt metric document.** Approval can return a non-finite number. Decisions based on it must check for it.

## Connections

Driven by:

- [Bills & Legislation](./bills-legislation.md) and [Policy System](./policy-system.md): enacted laws write state metric effects (`processStatePolicyEffects`).
- [Ministerial Orders](./ministerial-orders.md) and [Cabinet](./cabinet.md): per-turn order and setting deltas (`processMinisterialOrders`).
- [Demographics](./demographics.md): `demographicEffects` and `demographicFlows` adjust metrics and population.
- [National Budget](./national-budget.md): `economicModel` and `fiscalBaseGrowth` write GDP, unemployment and inflation effects; the budget mirrors write `governance.budgetBalance` and `governance.debtToGdp`.

Affects:

- [Government Approval](./government-approval.md): approval is computed from regional metrics against the country's own national average (`src/lib/utils/governmentApproval.ts`).
- [Elections](./elections.md): approval scales the vote pool in `tallyManagement.ts` and `presidentialElectionEngine.ts` through `approvalVoteMultiplier.ts`.
- [National Budget](./national-budget.md): inflation, GDP growth and unemployment read from the metrics feed revenue, tax-base growth and the inflation model.

Key implementation files:

- `src/lib/db/types/stateMetrics.ts`: `StateMetrics` read shape and `MetricCategoryId`
- `src/lib/db/types/macroMetrics.ts`: `MacroMetricsDoc`
- `src/lib/db/types/governmentApproval.ts`: `GovernmentApproval`
- `src/lib/nationalMetrics.ts` and `src/lib/nationalMetrics/rules.ts`: the rollup and its pure aggregation rules
- `src/lib/metricHistory.ts`: `snapshotMetricHistory()`, `getMetricHistory()`
- `src/lib/constants/nationalScope.ts`: `NATIONAL_SCOPE`, `NATIONAL_SCOPE_IDS`
- `src/lib/country/nationalMetrics.ts` and `src/lib/country/nationalApproval.ts`: the two endpoints' loaders
- `src/lib/utils/governmentApproval.ts` and `src/lib/utils/approvalModifiers.ts`: approval calculation and named modifiers

Related pages:

- [Government Approval](./government-approval.md), formulas and modifiers
- [National Budget](./national-budget.md), treasury panels and fiscal display
- [Bills & Legislation](./bills-legislation.md), how laws move metrics
- [Elections](./elections.md), vote pool scaling by approval

## Tests

| Area | Test files |
| --- | --- |
| Rollup weighting, rounding, partial data, multi-country | `src/lib/nationalMetrics.test.ts` |
| Era income-band index | `src/lib/nationalMetrics.era.test.ts` |
| History snapshot of national documents | `src/lib/metricHistory.test.ts` |
| Page loader dictionaries and prototype-key safety | `src/lib/country/nationalMetrics.test.ts` |
| GDP growth on the national page | `src/lib/country/nationalGdpGrowth.test.ts` |
| Approval parity and live recompute | `src/lib/country/nationalApproval.parity.test.ts`, `src/lib/country/recomputeNationalApproval.test.ts` |
| Approval snapshot roster | `src/lib/utils/approvalSnapshotTargets.test.ts`, `src/lib/utils/approvalSnapshotRun.test.ts` |
| Approval scoring | `src/lib/utils/governmentApproval.test.ts` and its variants |
| Political board aggregation | `src/lib/politicalMetrics/aggregate.test.ts` |
| Macro and political path split | `src/lib/macroMetrics/split.test.ts`, `src/lib/macroMetrics/engineSplit.test.ts` |
| Metric engine nodes | `src/lib/metricEngine/registry/*.test.ts` |

Gaps: there is no test that every playable country appears in `NATIONAL_SCOPE`, none that the page endpoint and the stored national document agree, and none for the approval history length cap.

## Known issues and history

- **Weighting differs between the page and the stored document.** The rollup weights unemployment by labour force and GDP growth by GDP, while `loadNationalMetrics` weights every metric by covered population. For the trace inputs the page shows unemployment 5.0 and GDP growth 3.0 against stored 4.842 and 2.4. The player guide describes the rollup weighting.
- **Two approval paths.** The metrics page and approval chart can show slightly different numbers: the chart history reflects whatever the snapshot computed at turn time, and the live route is a lighter fallback.
- **Earlier version of this page described a global baseline.** The metrics endpoint used to compare a country against an average across all countries. It no longer does: regions are scored against the country's own population-weighted average. Corrected 2026-10-29.
- **Earlier version of this page described a single document store.** Political categories now live on the board and the national rollup writes only the macro half. The legacy `stateMetrics` read shape remains for consumers; corrected 2026-10-29.
- **DD national scope.** `dd_national` was missing from `NATIONAL_SCOPE` after DD became playable (#3488), so East Germany had no national row and no economy chart entry. Now registered.
- **Cabinet order cap.** `MAX_PER_METRIC_MODIFIER_PER_TURN` was raised from 0.05 to 0.08 in #0800 after a runaway `gdpGrowth` bug (#0571) showed the need for a hard cap.
- **Wiki and design mismatch, none found for the rollup.** The player guide's unemployment and GDP growth weighting matches `src/lib/nationalMetrics/rules.ts`.

Last checked: 2026-10-29, version 1.18.0
