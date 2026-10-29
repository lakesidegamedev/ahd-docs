# Government Approval System

## Overview

Each state and the nation has a **government approval** rating (0-100%). Base 50%. State and national metrics (economic, education, healthcare, etc.) affect approval positively when above average and negatively when below average. Named **approval modifiers** (Democracy 3-style) then add or subtract a fixed amount when specific metric thresholds are simultaneously met. Positive modifiers stack up to a cap, negative ones stack freely.

Player guide: [Government Approval](https://www.ahousedividedgame.com/wiki/government-approval)

Approval exists so that the state of the country, not any one politician's popularity, drives election strength, coattails and the political cost of governing badly. Everything below is checked against the live release.

## Rules

| Constant | Value | Source |
| --- | --- | --- |
| Base approval (`BASE_APPROVAL`) | 50 | `src/lib/utils/governmentApproval.ts` |
| Deviation scale (`CONTRIBUTION_SCALE`) | 15 | `src/lib/utils/governmentApproval.ts` |
| Per-metric cap (`MAX_CONTRIBUTION`) | +/-2 | `src/lib/utils/governmentApproval.ts` |
| Mean-to-points multiplier | 2.5 | `src/lib/utils/governmentApproval.ts` |
| Demographic weighting strength (`APPROVAL_AXIS_WEIGHT_K`) | 1.3 | `src/lib/utils/governmentApproval.ts` |
| Max state step per turn (`APPROVAL_MAX_STEP_PER_TURN`) | 2 points | `src/lib/utils/governmentApproval.ts` |
| Positive modifier net cap (`POSITIVE_MODIFIER_NET_CAP`) | +8 | `src/lib/approval/activeModifier.ts` |
| Named modifiers (`MODIFIER_DEFS`) | 82 (42 positive, 40 negative) | `src/lib/utils/approvalModifiers.ts` |
| History kept | last 20 turns | `src/lib/utils/governmentApproval.ts` (`$slice: -20`) |
| Public expectations drag, full strength | -5 | `src/lib/country/rules/approvalHoneymoon.ts` |
| Expectations ramp length | the head of government's term in turns (48 turns per game year; 4 years if unknown) | `src/lib/country/rules/approvalHoneymoon.ts` |
| Empty cabinet penalty, all seats empty | -7.5 (scales by share of seats empty) | `src/lib/country/rules/approvalHoneymoon.ts` |
| Acting secretary penalty | -0.5 each | `src/lib/utils/governmentApproval.ts` (`ACTING_APPOINTMENT_PENALTY`) |
| Union crackdown | -2 | `src/lib/unions/enforcementCosts.ts` |
| Joint statement, endorse / condemn | +2 / -3, lasts 24 turns | `src/lib/internationalOrganizations/jointStatement.ts` |
| War effort bound | +/-2 | `src/lib/military/warApproval.ts` |
| Alliance contribution bound | +/-1, 6-turn grace after entry | `src/lib/military/warApproval.ts` |
| War exhaustion | starts at +1, falls 1 point per game year (48 turns), floor -25, heals at the same rate in peace | `src/lib/military/warApproval.ts` |

## Formula

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
| Bank failure, union crackdown | per their own rules | `src/lib/banking/failurePolitics.ts`, `src/lib/unions/enforcementCosts.ts` |

Region-level modifiers (State of the State address, Fairness Act drag) are added to the state's own approval before damping.

### Worked example

A state has unemployment 6.0 against a country mean of 5.0 (lower is better): `-(6-5)/5 = -0.2`, times 15 is -3, clamped to -2. Its median income is 52,000 against 50,000: `+0.04 x 15 = +0.6`. GDP growth is 2.4 against 2.0: `+0.2 x 15 = +3`, clamped to +2. With equal weights the mean is `(-2 + 0.6 + 2) / 3 = 0.2`, so the subtotal is `50 + 0.2 x 2.5 = 50.5`. If Economic Boom is also active (+2) the target is 52.5. If the state's stored rating was 49, it moves 2 points to 51 this turn and reaches 52.5 on the next. In a governor race at 51% approval the vote pool multiplier is `(1 + (0.51 - 0.5) x 0.2) x 1.0 = 1.002`.

## Approval Modifiers

Named conditions that fire when **all** their metric thresholds are met simultaneously. Multiple modifiers stack (their effects sum). Labels describe the **metric state**, not a political judgment. Single-condition modifiers fire more easily; multi-condition ones carry stronger effects. Maximum effect per modifier is ±3. The net positive total from named modifiers is capped at +8 (`POSITIVE_MODIFIER_NET_CAP` in `src/lib/approval/activeModifier.ts`); negatives are uncapped. Thresholds in the tables are base values and can shift by era and country. High immigration (migrationRate) is modelled as a net negative. Thresholds are calibrated so both US and UK realistic national averages trigger meaningful conditions.

### Positive Modifiers

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

### Negative Modifiers

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

## Display

- **State page**: Government Approval in the stats strip. Hover to see active modifiers.
- **Country overview page**: Government Approval in the leadership stats strip. Hover to see active modifiers.
- **National metrics page**: Government Approval in the header. Hover to see active modifiers.
- Color coding: green ≥ 50%, amber 40-50%, red < 40%
- Tooltip shows each active modifier with its label and effect, and the net sum.

## Timing

The per-turn snapshot runs as the `approvalSnapshot` phase of the state-effects stage (`src/simulation/phases/stateEffectsPhase.ts`), after the regional metrics for the turn are updated. It runs beside the metric history, interest-rate and party-history snapshots, none of which it depends on. `snapshotApprovalsForTurn` (`src/lib/utils/approvalSnapshotRun.ts`) covers every active country plus any non-playable country currently at war, so a belligerent's war lines are always scored. A non-playable belligerent's approval record is released once its war is over and its exhaustion has healed.

Within one country the order is: score each state (metrics, then state modifiers), damp each state toward its target, take the population-weighted national average, apply national modifiers in one call, write the record and history. Elections and coattails run later in the same turn and read these results (see Use in Elections).

## Data Source

- Target approval is computed from `stateMetrics` and the country's state averages.
- Each state's stored rating (`stateApprovalHistory`) steps toward its target by at most `APPROVAL_MAX_STEP_PER_TURN` = 2 points per turn (`dampApprovalStep`). With no previous value it adopts the target directly. The national rating is not damped a second time; the war lines carry their own slow step (about 0.02 points per turn at most for exhaustion).
- Coattails read the stored snapshot. Vote accumulation recomputes state approval live from current metrics instead (`getAllStateApprovalsForElection`), without damping and without address or fairness modifiers.
- APIs: `GET /api/state/[id]/metrics` and `/api/national/metrics` return `governmentApproval` and per-state `modifiers`.

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

## UK Government Transitions and Cabinet Dismissal

Approval is not directly involved in government transitions, but they matter in context. When the government changes hands (a no-confidence motion carries, or a new government forms after a general election), **the cabinet is cleared** via `clearCabinetOnTransition` (`src/lib/cabinetTransition.ts`), called from `src/lib/turn/parliamentaryGovernment.ts`. Ministers revert to ordinary MP status. A cleared cabinet means empty seats, which cost approval until it is refilled (see National modifiers).

See [uk-pm-no-confidence.md](./uk-pm-no-confidence.md) for the full no-confidence process.

## No-Confidence Votes and Approval

Government approval does **not** influence a no-confidence vote. Player MPs vote as they choose. NPP MPs follow the party line: MPs of governing parties vote against the motion and all others vote for it, unless a player whip for their party says otherwise (`autoVoteNPPsForNoConfidence` in `src/lib/turn/parliamentaryGovernment.ts`). The motion carries when votes for reach the stored majority threshold (`noConfidenceMotionCarries`). A high approval score gives no protection; seat arithmetic does.

## Use in Elections

State government approval scales the vote pool during general-election vote accumulation each turn:

| Race | Multiplier | Source |
| --- | --- | --- |
| Presidential | `(1 + (approval - 0.5) x 0.5) x officeStrength` (up to +/-25%) | `src/lib/presidentialElectionEngine.ts` |
| Every other race | `(1 + (approval - 0.5) x 0.2) x officeStrength` (up to +/-10%) | `src/lib/electionEngine/tallyManagement.ts` |

With approval as a fraction, so 0% gives 0.9 and 100% gives 1.1 in the second row. Office strength (`partyStrengthWeight`, `src/lib/countries/us/institutionsFacts.ts`): President 1.0, Vice President 1.0, Governor 1.0, House 0.9, State Senate 0.85, Senate 0.8, Central Bank Chair 0. Other countries set their own per office. When state metrics are missing, approval is treated as 50%. Coattail magnitude is `1 + clamp((approval - 50) / 25, -1, 1) x 0.09` (`COATTAIL_APPROVAL_SATURATION` 25, `COATTAIL_MAX_BONUS` 0.09 in `src/lib/electionEngine/constants.ts`). See [Election Mechanics](./elections.md).

## Implementation

- `src/lib/utils/governmentApproval.ts` - `calculateStateApproval()`, `computeStateApprovalBase()`, `computeApprovalBaseFromAverages()`, `calculateNationalApproval()`, `computeNationalAveragesFromMetrics()`, `dampApprovalStep()`, `snapshotApprovalHistory()`
- `src/lib/utils/approvalModifiers.ts` - `MODIFIER_DEFS` (82 named conditions), `evaluateModifiers()`, `applyModifiers()`
- `src/lib/approval/activeModifier.ts` - `ActiveModifier`, `POSITIVE_MODIFIER_NET_CAP`, `netModifierEffect()`
- `src/lib/country/rules/approvalHoneymoon.ts` - public expectations ramp and empty-cabinet penalty
- `src/lib/utils/approvalSnapshotRun.ts` - which countries get a snapshot each turn
- `src/components/ApprovalTooltip.tsx` - hover tooltip listing active modifiers; uses a React portal to escape `overflow-hidden` hero containers
- `src/lib/utils/getStateApprovalForElection.ts` - `getStateApprovalForElection(stateId)` for the election engine
- Uses the same `IS_HIGHER_BETTER` direction map as national metrics (`src/lib/utils/metricScoring.ts`)

Last checked: 2026-10-29, version 1.18.0
