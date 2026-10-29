# Government Approval System

## Summary

Each state and the nation has a **government approval** rating (0-100%). Base 50%. State and national metrics (economic, education, healthcare, etc.) affect approval positively when above average and negatively when below average. Named **approval modifiers** (Democracy 3-style) then add or subtract a fixed amount when specific metric thresholds are simultaneously met. Positive modifiers stack up to a cap, negative ones stack freely.

Player guide: [Government Approval](https://www.ahousedividedgame.com/wiki/government-approval)

Approval exists so that the state of the country, not any one politician's popularity, drives election strength, coattails and the political cost of governing badly. Everything below is checked against the live release.

## Rules

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| Base approval (`BASE_APPROVAL`) | 50 | `src/lib/utils/governmentApproval.ts` |
| Deviation scale (`CONTRIBUTION_SCALE`) | 15 | `src/lib/utils/approvalContributionRules.ts` |
| Per-metric cap (`MAX_CONTRIBUTION`) | +/-2 | `src/lib/utils/approvalContributionRules.ts` |
| Mean-to-points multiplier | 2.5 | `src/lib/utils/governmentApproval.ts` |
| Demographic weighting strength (`APPROVAL_AXIS_WEIGHT_K`) | 1.3 | `src/lib/utils/governmentApproval.ts` |
| Max state step per turn (`APPROVAL_MAX_STEP_PER_TURN`) | 2 points | `src/lib/utils/governmentApproval.ts` |
| Positive modifier net cap (`POSITIVE_MODIFIER_NET_CAP`) | +8 | `src/lib/approval/activeModifier.ts` |
| Named modifiers (`MODIFIER_DEFS`) | 82 (42 positive, 40 negative) | `src/lib/utils/approvalModifiers.ts` |
| History kept | last 20 turns | `src/lib/utils/governmentApproval.ts` (`$slice: -20`) |
| Public expectations drag, full strength | -5 | `src/lib/country/rules/approvalHoneymoon.ts` |
| Expectations ramp length | the head of government's term in turns (48 turns per game year; 4 years if unknown) | `src/lib/country/rules/approvalHoneymoon.ts` |
| Empty cabinet penalty, all seats empty | -7.5 (scales by share of seats empty) | `src/lib/country/rules/approvalHoneymoon.ts` |
| Acting secretary penalty | -0.5 each | `src/lib/country/rules/approvalHoneymoon.ts` (`ACTING_APPOINTMENT_PENALTY`) |
| Union crackdown | -2 | `src/lib/unions/enforcementCosts.ts` |
| Joint statement, endorse / condemn | +2 / -3, lasts 24 turns | `src/lib/internationalOrganizations/jointStatement.ts` |
| War effort bound | +/-2 | `src/lib/military/warApproval.ts` |
| Alliance contribution bound | +/-1, 6-turn grace after entry | `src/lib/military/warApproval.ts` |
| War exhaustion | starts at +1, falls 1 point per game year (48 turns), floor -25, heals at the same rate in peace | `src/lib/military/warApproval.ts` |
| War defeat | -5 after losing a war, fades over 3 game years (`WAR_DEFEAT_WINDOW_TURNS` = 3 x 48), combined cap -10 (`WAR_DEFEAT_PENALTY_CAP`) | `src/lib/military/rules/warDefeat.ts` |
| Naval losses or fleet condition | 0 to -1 (`NAVAL_APPROVAL_BOUND`), linear from nothing at fleet condition 70 (`FLEET_ALARM_THRESHOLD`) to the full bound at a destroyed fleet; never a bonus | `src/lib/navair/navalApproval.ts` |
| Redistricting fairness drag | -2 to -5 on a state whose map exceeds its fairness ceiling: `-min(5, 2 + floor(over / 0.05))` where `over` is the efficiency gap above the ceiling; only when redistricting is enabled | `src/lib/redistricting/fairnessApproval.ts` |

### State Approval

1. **Base**: 50%
2. **Per metric**: Compare the state value to the average across the country's states
   - **Higher-is-better** metrics (median income, graduation rate, etc.): state > avg gives a bonus, state < avg a penalty
   - **Lower-is-better** metrics (unemployment, crime, infant mortality, etc.): state < avg gives a bonus, state > avg a penalty
3. **Contribution**: `(value - avg) / |avg|` (sign flipped for lower-is-better), times 15, clamped to +/-2 per metric. An average near zero uses a denominator of 1.
4. **Subtotal**: `50 + (weighted sum of contributions / total weight) x 2.5`, clamped to 0-100 and rounded to one decimal. Each metric is weighted by how strongly it ties to the electorate's economic and social leanings (`effectiveMetricWeight`); a state with no demographic groups weights every metric 1, giving the plain mean.
5. **Modifiers**: Named conditions (see below) are evaluated; each active modifier adds its `effect`. The sum of positives is capped at +8, negatives are uncapped. The result is clamped to 0-100.

Metrics excluded from the base score (they feed approval indirectly through the economy): `sexRatio`, `dependencyRatio`, `populationGrowth`, `medianAge`, plus era-anachronistic metrics before 2000 (`APPROVAL_EXCLUDED_METRICS`, `getApprovalExcludedMetrics`). `migrationRate` is deliberately kept as a direct term.

### National Approval

National approval is the **population-weighted average of the states' stored (damped) approvals** (`calculateNationalApproval`), rounded to one decimal. National-scope modifiers are then applied in a single `applyModifiers` call, so the +8 positive cap and the 0-100 clamp apply once to everything. The state "average" each metric is compared against is the unweighted mean across that country's own states (`computeNationalAveragesFromMetrics`), not a global average across countries.

### National modifiers

Built in `snapshotApprovalHistory` (`src/lib/utils/governmentApproval.ts`) and stored in `activeNationalModifiers` on the country's approval record, so the chips shown on the approval page always sum to the stored rating.

| Modifier | Effect | Source |
| --- | --- | --- |
| Head-of-government address | the address bump, while active | `src/lib/governorOffice/address/activeAddressModifiers.ts` |
| International joint statement | +2 endorse, -3 condemn, for 24 turns | `src/lib/internationalOrganizations/jointStatement.ts` |
| War effort | -2 to +2: `1.4 x (position - expected) + 0.6 x momentum`, clamped | `src/lib/military/warApproval.ts` |
| War exhaustion | +1 down to -25, one point per 48 turns | `src/lib/military/warApproval.ts` |
| Alliance contribution | -1 to +1 versus co-belligerents | `src/lib/military/warApproval.ts` |
| Higher public expectations | 0 on taking office, linear to -5 over the term, flat after | `src/lib/country/rules/approvalHoneymoon.ts` |
| Empty cabinet seats | `-7.5 x (empty / total)`, rounded to a tenth | `src/lib/country/rules/approvalHoneymoon.ts` |
| Acting secretaries | -0.5 each, only where the government type requires confirmation | `src/lib/utils/governmentApproval.ts` |
| War defeat, naval losses | as in Constants | `src/lib/military/rules/warDefeat.ts`, `src/lib/navair/navalApproval.ts` |
| Bank failure, union crackdown | per their own rules | `src/lib/banking/failurePolitics.ts`, `src/lib/unions/enforcementCosts.ts` |

Region-level modifiers (State of the State address, Fairness Act drag) are added to the state's own approval before damping.

### Approval modifiers

Named conditions that fire when **all** their metric thresholds are met simultaneously. Multiple modifiers stack (their effects sum). Labels describe the **metric state**, not a political judgment. Single-condition modifiers fire more easily; multi-condition ones carry stronger effects. Maximum effect per modifier is ±3. The net positive total from named modifiers is capped at +8 (`POSITIVE_MODIFIER_NET_CAP` in `src/lib/approval/activeModifier.ts`); negatives are uncapped. Thresholds in the tables are base values and can shift by era and country. High immigration (migrationRate) is modelled as a net negative. Thresholds are calibrated so both US and UK realistic national averages trigger meaningful conditions.

#### Positive modifiers

| Modifier | Effect | Conditions |
| --- | --- | --- |
| Economic Boom | +2 | GDP growth ≥ 3, Unemployment rate ≤ 4.5 |
| Low Unemployment | +1 | Unemployment rate ≤ 3.5 |
| Low Poverty Rate | +1 | Poverty rate ≤ 8 |
| Affordable Cost of Living | +1 | Cost of living ≤ 90 |
| Strong Economic Growth | +1 | GDP growth ≥ 2.5 |
| Healthcare Excellence | +2 | Life expectancy ≥ 83, Affordability index ≥ 78 |
| Universal Healthcare Access | +2 | Uninsured rate ≤ 5, Physician rate ≥ 2.5 |
| High Life Expectancy | +1 | Life expectancy ≥ 82 |
| Low Crime Rate | +2 | Violent crime rate ≤ 320, Public safety confidence ≥ 70 |
| Falling Crime | +1 | Violent crime rate ≤ 300 |
| Low Reoffending Rate | +1 | Recidivism rate ≤ 30 |
| Clean Environment | +2 | Renewable energy ≥ 50, Air quality ≤ 25 |
| Green Energy Transition | +1 | Renewable energy ≥ 40 |
| Strong Recycling Culture | +1 | Recycling rate ≥ 45 |
| High Government Transparency | +2 | Government transparency ≥ 78, Public trust ≥ 62 |
| High Public Trust | +1 | Public trust ≥ 68 |
| High Voter Turnout | +1 | Voter turnout ≥ 72 |
| Balanced Budget | +1 | Budget balance ≥ 0.5 |
| Skilled Workforce | +1 | High school grad rate ≥ 88, Workforce skill ≥ 68 |
| Education Excellence | +2 | High school grad rate ≥ 92, Test performance ≥ 115, Literacy rate ≥ 97 |
| Strong Social Cohesion | +1 | Social cohesion ≥ 68, Civic participation ≥ 62 |
| Strong Safety Net | +2 | Food insecurity ≤ 7, Homelessness rate ≤ 8 |
| High Social Mobility | +1 | Social mobility ≥ 78 |
| Modern Infrastructure | +2 | Road condition ≥ 80, Broadband access ≥ 90, Water quality ≥ 95 |
| High Broadband Access | +1 | Broadband access ≥ 90 |
| Clean Water Supply | +1 | Water quality ≥ 96 |
| High Civic Participation | +1 | Voter turnout ≥ 75, Civic participation ≥ 68 |
| Innovation Economy | +2 | Small business formation ≥ 6, Workforce skill ≥ 75 |
| Free Press | +1 | Press freedom ≥ 79 |
| High News Trust | +1 | News trust ≥ 65, Media polarization ≤ 28 |
| Healthy Longevity | +1 | Life expectancy ≥ 82, Preventable mortality ≤ 280 |
| Affordable Housing | +1 | Housing affordability ≤ 28 |
| Research & Development Hub | +1 | Rd intensity ≥ 3.2 |
| Economic Freedom | +1 | Economic freedom ≥ 75, Regulatory burden < 35 |
| Strong Defense | +1 | Military readiness ≥ 88, National pride ≥ 85 |
| National Confidence | +1 | National pride ≥ 86 |
| Fiscal Discipline | +1 | Budget balance ≥ 1, Debt to GDP ≤ 90 |
| Secure Border | +1 | Border security ≥ 62 |
| Broad Firearm Rights | +1 | Firearm rights ≥ 88 |
| Population Boom | +1 | Population growth ≥ 1.2, Migration rate ≥ 0.2 |
| Young Population | +1 | Median age ≤ 35, Population growth ≥ 0.5 |
| Brain Gain | +1 | Migration rate ≥ 0.3, Workforce skill ≥ 70 |

#### Negative modifiers

| Modifier | Effect | Conditions |
| --- | --- | --- |
| Recession | −3 | GDP growth ≤ 0, Unemployment rate ≥ 7 |
| High Unemployment | −2 | Unemployment rate ≥ 8 |
| Stagnant Economy | −1 | GDP growth ≤ 1 |
| Cost of Living Crisis | −2 | Cost of living ≥ 140, Poverty rate ≥ 17 |
| High Poverty Rate | −1 | Poverty rate ≥ 15 |
| High Immigration Pressure | −1 | Migration rate ≥ 1.5 |
| Aging Population | −1 | Median age ≥ 42 |
| Population Decline | −1 | Population growth ≤ 0, Migration rate ≤ 0 |
| Healthcare System Strain | −2 | Affordability index ≤ 48, Preventable mortality ≥ 350 |
| Low Life Expectancy | −2 | Life expectancy ≤ 76 |
| High Preventable Mortality | −1 | Preventable mortality ≥ 350 |
| Weak Healthcare Capacity | −1 | Physician rate ≤ 2, Affordability index ≤ 55 |
| High Crime Rate | −2 | Violent crime rate ≥ 420, Public safety confidence ≤ 55 |
| High Violent Crime | −1 | Violent crime rate ≥ 450 |
| High Incarceration Rate | −1 | Incarceration rate ≥ 850, Recidivism rate ≥ 55 |
| Environmental Degradation | −2 | Air quality ≥ 48, Carbon emissions ≥ 18 |
| Poor Air Quality | −1 | Air quality ≥ 47 |
| High Carbon Footprint | −1 | Carbon emissions ≥ 17 |
| Slow Energy Transition | −1 | Energy transition progress ≤ 18, Renewable energy ≤ 15 |
| High Corruption | −3 | Corruption index ≥ 58, Public trust ≤ 35 |
| Corruption Concerns | −1 | Corruption index ≥ 54 |
| Low Public Trust | −1 | Public trust ≤ 42 |
| Government Deficit | −1 | Budget balance ≤ −2 |
| Fiscal Crisis | −2 | Budget balance ≤ −5 |
| Extreme Income Inequality | −2 | Income inequality ≥ 46, Homelessness rate ≥ 22 |
| Rising Inequality | −1 | Income inequality ≥ 44 |
| High Homelessness | −1 | Homelessness rate ≥ 20 |
| Social Fragmentation | −2 | Food insecurity ≥ 16, Social cohesion ≤ 45 |
| Food Insecurity | −1 | Food insecurity ≥ 14 |
| Housing Stress | −1 | Housing affordability ≥ 65 |
| Low Social Mobility | −1 | Social mobility ≤ 42 |
| Skills Gap | −1 | Workforce skill ≤ 45, Unemployment rate ≥ 7 |
| Crumbling Infrastructure | −2 | Road condition ≤ 55, Water quality ≤ 80, Broadband access ≤ 68 |
| Poor Broadband Access | −1 | Broadband access ≤ 70 |
| Disinformation Spread | −2 | Media polarization ≥ 60, Disinformation risk ≥ 55 |
| Polarized Media | −1 | Media polarization ≥ 52 |
| Restricted Press Freedom | −2 | Press freedom ≤ 40, Disinformation risk ≥ 50 |
| Negative Net Migration | −1 | Migration rate ≤ −1, Population growth ≤ 0 |
| Unaffordable Housing | −2 | Homelessness rate ≥ 28, Cost of living ≥ 130 |
| Heavy Public Debt | −1 | Debt to GDP ≥ 115 |

### Use in elections

State government approval scales the vote pool during general-election vote accumulation each turn:

| Race | Multiplier | Source |
| --- | --- | --- |
| Presidential | `(1 + (approval - 0.5) x 0.5) x officeStrength` (up to +/-25%) | `src/lib/presidentialElectionEngine.ts` |
| Every other race | `(1 + (approval - 0.5) x 0.2) x officeStrength` (up to +/-10%) | `src/lib/electionEngine/tallyManagement.ts` |

With approval as a fraction, so 0% gives 0.9 and 100% gives 1.1 in the second row. Office strength (`partyStrengthWeight`, `src/lib/countries/us/institutionsFacts.ts`): President 1.0, Vice President 1.0, Governor 1.0, House 0.9, State Senate 0.85, Senate 0.8, Central Bank Chair 0. Other countries set their own per office. When state metrics are missing, approval is treated as 50%. Coattail magnitude is `1 + clamp((approval - 50) / 25, -1, 1) x 0.09` (`COATTAIL_APPROVAL_SATURATION` 25, `COATTAIL_MAX_BONUS` 0.09 in `src/lib/electionEngine/constants.ts`). See [Election Mechanics](./elections.md).

### Government transitions and cabinet dismissal

Approval is not directly involved in government transitions, but they matter in context. When the government changes hands (a no-confidence motion carries, or a new government forms after a general election), **the cabinet is cleared** via `clearCabinetOnTransition` (`src/lib/cabinetTransition.ts`), called from `src/lib/turn/parliamentaryGovernment.ts`. Ministers revert to ordinary MP status. A cleared cabinet means empty seats, which cost approval until it is refilled (see National modifiers).

See [uk-pm-no-confidence.md](./uk-pm-no-confidence.md) for the full no-confidence process.

### No-confidence votes and approval

Government approval does **not** influence a no-confidence vote. Player MPs vote as they choose. NPP MPs follow the party line: MPs of governing parties vote against the motion and all others vote for it, unless a player whip for their party says otherwise (`autoVoteNPPsForNoConfidence` in `src/lib/turn/parliamentaryGovernment.ts`). The motion carries when votes for reach the stored majority threshold (`noConfidenceMotionCarries`). A high approval score gives no protection; seat arithmetic does.

## Data

### Collections

| Collection | Fields | Written by | Player-visible |
| --- | --- | --- | --- |
| `governmentApprovals` (one document per country, `_id` is the country id) | `approvalRating`, `approvalBase`, `disapprovalRating`, `netApproval`, `activeNationalModifiers`, `activeRegionalModifiers`, `warApprovalTotal`, `warExhaustion`, `warExhaustionConflictId`, `headOfGovernmentKey`, `headOfGovernmentSinceTurn`, `history` (last 20) | `snapshotApprovalHistory` | Yes: rating, modifier chips, history chart |
| `stateApprovalHistory` (one per state) | `approvalRating`, `history` (last 20) | `buildStateApprovalBulkOps` | Yes: state page |
| `stateMetrics` and `stateDemographics` | every metric, group shares and leans | Metric and demographic phases | Metrics yes |
| `cabinetMembers` | filled, empty and acting seats | Cabinet systems | Yes |
| `governorAddresses` | active address bumps | Address system | Yes |
| `gameConfig` | `privateBankingEnabled`, `marketAdjustmentStage` | Admin config | No |
| Long-horizon telemetry (`appendApprovalTelemetry`) | damped state and national values per turn | Snapshot, after the operational writes | Research views |

### Where values come from

- Target approval is computed from `stateMetrics` and the country's state averages.
- Each state's stored rating (`stateApprovalHistory`) steps toward its target by at most `APPROVAL_MAX_STEP_PER_TURN` = 2 points per turn (`dampApprovalStep`). With no previous value it adopts the target directly. The national rating is not damped a second time; the war lines carry their own slow step (about 0.02 points per turn at most for exhaustion).
- Coattails read the stored snapshot. Vote accumulation recomputes state approval live from current metrics instead (`getAllStateApprovalsForElection`), without damping and without address or fairness modifiers.
- APIs: `GET /api/state/[id]/metrics` and `/api/national/metrics` return `governmentApproval` and per-state `modifiers`.

### Display

- **State page**: Government Approval in the stats strip. Hover to see active modifiers.
- **Country overview page**: Government Approval in the leadership stats strip. Hover to see active modifiers.
- **National metrics page**: Government Approval in the header. Hover to see active modifiers.
- Color coding: green ≥ 50%, amber 40-50%, red < 40%
- Tooltip shows each active modifier with its label and effect, and the net sum.

## Configuration

| Setting | Default | Where set | Effect |
| --- | --- | --- | --- |
| `gameConfig.privateBankingEnabled` | on for fresh worlds | `src/lib/seeds/reference/featureFlagDefaults.ts` | Passed as `bankFailurePolitics`: bank failures add approval modifiers |
| `gameConfig.marketAdjustmentStage` | 0 or absent (off) | Staged-rollout config | Market adjustment approval effects |
| `actingAppointmentsEnabled(countryId)` | per country (parliamentary and one-party systems: off) | `src/lib/cabinet/actingEligibility.ts` | Whether acting secretaries cost approval |
| Era and country modifier patches | per era and country | `resolveModifierDef`, `getEraConditionShift` in `src/lib/utils/approvalModifiers.ts` | Shifts thresholds, hides modifiers for metrics that do not exist yet |
| `APPROVAL_EXCLUDED_METRICS` | `sexRatio`, `dependencyRatio`, `populationGrowth`, `medianAge` plus pre-2000 anachronisms | `src/lib/utils/governmentApproval.ts` | Metrics left out of the base score |
| Country term length | from the office config, 4 years if unknown | `expectationsRampTurns` in `src/lib/country/rules/approvalHoneymoon.ts` | Length of the public expectations ramp |

Every constant in the Rules table is a source constant; changing one needs a code change.

## Timing

The per-turn snapshot runs as the `approvalSnapshot` phase of the state-effects stage (`src/simulation/phases/stateEffectsPhase.ts`), after the regional metrics for the turn are updated. It runs beside the metric history, interest-rate and party-history snapshots, none of which it depends on. `snapshotApprovalsForTurn` (`src/lib/utils/approvalSnapshotRun.ts`) covers every active country plus any non-playable country currently at war, so a belligerent's war lines are always scored. A non-playable belligerent's approval record is released once its war is over and its exhaustion has healed.

Within one country the order is: score each state (metrics, then state modifiers), damp each state toward its target, take the population-weighted national average, apply national modifiers in one call, write the record and history. Elections run earlier in the same turn than this snapshot (election resolution is turn group 7, the state-effects stage that holds the snapshot comes after the fiscal-year step). Coattails therefore read the previous turn's stored snapshot, while vote accumulation recomputes state approval live from current metrics (see Use in Elections).

```
election resolution (group 7)   vote accumulation reads LIVE state approval (no damping, no address modifiers)
                                coattails read the STORED snapshot from the previous turn
state-effects stage (later)     score each state -> damp (max 2 points) -> national average
                                -> national modifiers (one call, +8 cap) -> write record and history
```

## Worked trace

A state has unemployment 6.0 against a country mean of 5.0 (lower is better): `-(6-5)/5 = -0.2`, times 15 is -3, clamped to -2. Its median income is 52,000 against 50,000: `+0.04 x 15 = +0.6`. GDP growth is 2.6 against 2.0: `+0.3 x 15 = +4.5`, clamped to +2. With equal weights the mean is `(-2 + 0.6 + 2) / 3 = 0.2`, so the subtotal is `50 + 0.2 x 2.5 = 50.5`.

GDP growth of 2.6 meets Strong Economic Growth (GDP growth of 2.5 or more, +1), so the target is 51.5. If the state's stored rating was 49, it moves 2 points to 51 this turn and reaches 51.5 on the next. In a governor race at 51% approval the vote pool multiplier is `(1 + (0.51 - 0.5) x 0.2) x 1.0 = 1.002`.

Extending it to the nation. Two states hold stored ratings of 51 (population 6,000,000) and 47 (population 4,000,000). Population-weighted average `(51 x 6 + 47 x 4) / 10 = 49.4`. 

The head of government has been in office 24 turns of a 192-turn (4-year) ramp: `-round(5 x 24/192 x 10) / 10 = -0.6`. Two of eight cabinet seats are empty: `-round(7.5 x 2/8 x 10) / 10 = -1.9`. A joint statement endorsement adds +2.

Positives sum to 2 (under the +8 cap), negatives to -2.5, so the national rating is `49.4 - 0.5 = 48.9`. Disapproval is 51.1 and net approval is -2.2. The record stores 48.9 and pushes `{ turn, approval: 48.9, net: -2.2 }` onto `history`, dropping the oldest entry beyond 20.

## Edge cases and limits

- A state or country with no metrics scores exactly 50 (`BASE_APPROVAL`), and a state with metrics but no usable comparisons also returns 50.
- Approval and disapproval always sum to 100; there is no undecided share.
- A metric whose country average is below 1e-6 in magnitude is divided by 1, so near-zero averages cannot explode a contribution.
- Negative averages (budget deficits) use the absolute value as denominator so a worse deficit never turns into a bonus.
- Positive modifiers cap at +8 in total; a stack of crises is not capped, so approval can fall to 0 but never below.
- Modifier thresholds shift with era and with per-country patches (`resolveModifierDef`, `getEraConditionShift`); a condition on a metric that does not yet exist in the current era never fires. The tables above give the modern base values.
- A demographic group can zero out a metric it is hostile to but never invert it (group weights floor at 0).
- Public expectations: an unknown start turn keeps the full -5; the ramp restarts only when the head of government changes.
- The acting-secretary penalty only applies where acting appointments exist (`actingAppointmentsEnabled`); parliamentary and one-party systems fill posts directly and pay nothing.
- History keeps 20 entries per country and per state; older entries are dropped.

## Invariants

| Invariant | Enforced by |
| --- | --- | 
| Approval and disapproval sum to 100 | Computed as `100 - approval` in `snapshotApprovalHistory`; `src/lib/utils/governmentApproval.test.ts` |
| Rating stays within 0 to 100 | `applyModifiers` clamp; `src/lib/utils/approvalModifiers.test.ts` |
| Positive modifiers never add more than +8 | `POSITIVE_MODIFIER_NET_CAP`; `src/lib/utils/approvalModifiers.inflation.test.ts` |
| A state moves at most 2 points per turn | `dampApprovalStep`; `src/lib/utils/governmentApproval.test.ts` |
| The chips on the approval page sum to the stored rating | Chips are the stored `activeNationalModifiers`; `src/lib/country/rules/approvalBreakdown.test.ts` |
| History holds at most 20 entries | `$slice: -20` in the write; no dedicated test |
| Every active country plus warring guests is scored, and guest documents are released after the war | `src/lib/utils/approvalSnapshotRun.test.ts` |
| One metric moves approval by at most 2 points | `metricApprovalContribution`, `src/lib/utils/approvalContributionRules.ts`; only indirectly tested (`src/lib/wiki/charts/legislature.test.ts` reads the constant) |

## Failure and recovery

- **Snapshot fails for a country.** The turn logs the failure; the stored rating and chips stay at the previous turn's values and the next turn recomputes from live metrics. No manual repair is needed unless the metrics themselves are wrong.
- **Stale approval pinned on a page.** A non-playable country's war document would keep its wartime number if never released; the snapshot run releases it once the war is over and exhaustion has healed, and a missed release is repaired by rerunning the snapshot or deleting the stale record so the live recompute takes over.
- **Implausible approval in one state.** Usually bad metric data (a seeded value or a sudden unit change). Repair the metric, then the damping walks approval to the new target at 2 points per turn, so recovery takes several turns by design.
- **Chips do not add up to the rating.** Means a modifier moved the rating without being stored in `activeNationalModifiers`; fix the modifier source so it is included in the single `applyModifiers` call.
- **War scoring fails.** `computeWarApproval` catches the error, logs it, and holds the stored exhaustion with the front terms dropped, so a failed read never moves approval on invented data.
- **Cabinet cleared by a government change** drops approval by the empty-seat penalty until seats are refilled; this is intended, not a fault.

## Connections

**Driven by:**
- [National Metrics](./national-metrics.md): every state metric is an input (`stateMetrics` read in `snapshotApprovalHistory`).
- [Cabinet](./cabinet.md): empty and acting seats become national modifiers (`buildCabinetApprovalModifiers`).
- War and alliances: war effort, exhaustion and alliance lines (`computeWarApproval` in `src/lib/military/warApproval.ts`); see [Conflict System](./conflict-system-as-shipped.md).
- International joint statements, governor and head-of-government addresses, bank failures, union crackdowns: each supplies a modifier at snapshot time.
- [Crisis System](./crisis-system.md): active crises apply direct approval effects during turn processing.

**Affects:**
- [Election Mechanics](./elections.md): the vote-pool multiplier (`src/lib/electionEngine/tallyManagement.ts`, `src/lib/presidentialElectionEngine.ts`).
- Coattails: governor and presidential coattail multipliers read stored approval (`src/lib/electionEngine/coattailMagnitude.ts`, `govCoattail.ts`, `presidentialCoattail.ts`).
- Incumbency: executive re-election drag and the earned-officeholding registration bonus (`src/lib/government/rules/accountability.ts`).
- Devolution drift: governor approval nudges regional behaviour (`src/lib/governorOffice/devolution/rules.ts`).
- Company margins: modifier ids feed profit-margin effects (`marginEffectForModifier`).

### Implementation

- `src/lib/utils/governmentApproval.ts` - `calculateStateApproval()`, `computeStateApprovalBase()`, `computeApprovalBaseFromAverages()`, `calculateNationalApproval()`, `computeNationalAveragesFromMetrics()`, `dampApprovalStep()`, `snapshotApprovalHistory()`
- `src/lib/utils/approvalModifiers.ts` - `MODIFIER_DEFS` (82 named conditions), `evaluateModifiers()`, `applyModifiers()`
- `src/lib/approval/activeModifier.ts` - `ActiveModifier`, `POSITIVE_MODIFIER_NET_CAP`, `netModifierEffect()`
- `src/lib/country/rules/approvalHoneymoon.ts` - public expectations ramp and empty-cabinet penalty
- `src/lib/utils/approvalSnapshotRun.ts` - which countries get a snapshot each turn
- `src/components/ApprovalTooltip.tsx` - hover tooltip listing active modifiers; uses a React portal to escape `overflow-hidden` hero containers
- `src/lib/utils/getStateApprovalForElection.ts` - `getStateApprovalForElection(stateId)` for the election engine
- Uses the same `IS_HIGHER_BETTER` direction map as national metrics (`src/lib/utils/metricScoring.ts`)

## Tests

| Area | Test files |
| --- | --- |
| Base score, damping, national average | `src/lib/utils/governmentApproval.test.ts`, `src/lib/utils/governmentApproval.weighting.test.ts`, `src/lib/utils/governmentApproval.demographics.test.ts`, `src/lib/utils/governmentApprovalDirection.test.ts` |
| Live versus stored parity | `src/lib/utils/governmentApproval.liveShift.test.ts`, `src/lib/utils/governmentApproval.downstreamParity.test.ts`, `src/lib/macroMetrics/approvalParity.test.ts` |
| Modifiers | `src/lib/utils/approvalModifiers.test.ts`, `approvalModifiers.symmetry.test.ts`, `approvalModifiers.era.test.ts`, `approvalModifiers.allCountries.test.ts`, `approvalModifiers.inflation.test.ts`, `approvalModifiers.seedAudit.test.ts` (same folder) |
| Cabinet and expectations | `src/lib/utils/governmentApproval.cabinet.test.ts`, `src/lib/country/rules/approvalHoneymoon.test.ts`, `src/lib/country/rules/approvalBreakdown.test.ts` |
| Which countries are scored | `src/lib/utils/approvalSnapshotRun.test.ts`, `src/lib/utils/approvalSnapshotTargets.test.ts` |
| War, statements, union lines | `src/lib/military/warApproval.test.ts`, `src/lib/internationalOrganizations/jointStatement.test.ts`, `src/lib/unions/enforcementCosts.test.ts` |
| Election use | `src/lib/electionEngine/coattailMagnitude.test.ts`, `src/lib/utils/getStateApprovalForElection.test.ts` |
| Cabinet clearing and no-confidence | `src/lib/cabinetTransition.test.ts`, `src/lib/turn/parliamentaryGovernment.test.ts` |

Gaps: the vote-pool multiplier (`approvalVoteMultiplier`) has no dedicated test, and the 20-entry history cap is untested.

## Known issues and history

- Corrected 2026-10-29 (code contradicted this page): the deviation scale and per-metric cap live in `approvalContributionRules.ts`, not `governmentApproval.ts`; the acting-secretary penalty constant lives in `approvalHoneymoon.ts`; the Timing section claimed elections run after the snapshot in the same turn, but election resolution runs before the state-effects stage, so coattails read the previous turn's snapshot; the worked example named Economic Boom although its metrics did not meet that modifier's thresholds (replaced with a modifier the numbers do meet).
- The header comment of `src/lib/utils/approvalModifiers.ts` still says modifier effects are at most plus or minus 2, but two modifiers reach -3 (Recession and High Corruption) and ten positives reach +2; the table above is correct.
- Positive modifier stacking is capped at +8 on purpose; a war going well, an address and endorsements all share that cap (source comment in `snapshotApprovalHistory` calls this deliberate, and raising it is a balance decision).
- Durable approval telemetry (#2099) records the damped values for long-horizon research; it runs after the operational writes so it can never block them.
- Public expectations ramp, empty-cabinet scaling and the war lines (effort, exhaustion, alliance) are documented in Rules; no dated change log is kept in the source for them.

Last checked: 2026-10-29, version 1.18.0
