# Government Approval System

## Overview

Each state and the nation has a **government approval** rating (0-100%). Base 50%. State and national metrics (economic, education, healthcare, etc.) affect approval positively when above average and negatively when below average. Named **approval modifiers** (Democracy 3-style) then add or subtract a fixed amount when specific metric thresholds are simultaneously met - they stack freely.

## Formula

### State Approval

1. **Base**: 50%
2. **Per metric**: Compare state value to national (population-weighted) average
   - **Higher-is-better** metrics (median income, graduation rate, etc.): state > avg → bonus, state < avg → penalty
   - **Lower-is-better** metrics (unemployment, crime, infant mortality, etc.): state < avg → bonus, state > avg → penalty
3. **Contribution**: `(value - avg) / avg` (or flipped for lower-is-better), scaled by 15 and clamped to ±2 per metric
4. **Subtotal**: `50 + (sum of contributions / count) × 2.5`, clamped to 0-100
5. **Modifiers**: Named conditions (see below) are evaluated; each active modifier adds its `effect` to the subtotal. Clamped to 0-100.

### National Approval

- The **country's population-weighted metric averages** are compared against the **global average** (all countries combined), using the same relative math as state approval.
- This avoids the structural ~50% result that would come from averaging relative state scores.
- Modifiers are evaluated against the national average metrics.

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

## Data Source

- Target approval is computed from `stateMetrics` and national averages
- The stored snapshot steps toward that target by at most `APPROVAL_MAX_STEP_PER_TURN` = 2 points per turn (`dampApprovalStep` in `src/lib/utils/governmentApproval.ts`); elections and coattails read the stored snapshot
- APIs: `GET /api/state/[id]/metrics` and `/api/national/metrics` return `governmentApproval` and per-state `modifiers`

## UK Government Transitions and Cabinet Dismissal

Government approval is not directly involved in UK government transitions, but these events are worth noting in context:

When the UK government changes hands - either because a no-confidence vote passes and the PM is removed, or because a new UK government is formed after a general election - **the entire UK cabinet is automatically dismissed** via `clearCabinetOnTransition`. All serving ministers lose their cabinet positions and revert to ordinary MP status. This is handled in `src/lib/turn/ukGovernment.ts` (no-confidence path) and `src/lib/turn/ukGovernmentFormation.ts` (post-election formation path).

This is not an approval change, but it is a government-level disruption that can indirectly affect approval over subsequent turns as new policies take effect under the incoming government.

See [uk-pm-no-confidence.md](./uk-pm-no-confidence.md) for the full mechanics of the no-confidence process.

## No-Confidence Votes and Approval

Government approval does **not** influence the outcome of a no-confidence vote. NPP MPs vote on no-confidence motions based solely on their **favorability toward the PM** (a per-character attribute), not the government approval score:

- PM favorability ≥ 60: 90% of NPP MPs vote to retain the PM
- PM favorability 40-59: 50% of NPP MPs vote to retain the PM
- PM favorability < 40: 90% of NPP MPs vote to remove the PM

Similarly, NPP voting in post-election confidence votes (PM selection) is driven by **party alignment**, not approval.

Government approval and PM favorability are independent values; a high national approval score gives no protection against a no-confidence motion. Players who want to survive a challenge need to maintain good favorability within their own parliamentary party, not just strong headline approval numbers.

## Use in Elections

State government approval is used in the **party strength** modifier during general-election vote accumulation. Each turn, the vote pool for an election is scaled by:

- **Formula**: `(1 + (approval - 0.5) × 0.2) × officeStrength`, with approval as a fraction (`src/lib/electionEngine/tallyManagement.ts`). Approval therefore moves the pool by at most ±10% (0.9 at 0% approval, 1.1 at 100%)
- **Office strength** by race type: Governor 1.0, House 0.9, Senate 0.8, State Senate 0.85

So in high-approval states, somewhat more votes are allocated per turn; governor races get the full office strength, House and Senate are scaled down. When state metrics are missing, approval is treated as 50%. See [Election Mechanics](./elections.md) for the full appeal and vote-accumulation pipeline.

## Implementation

- `src/lib/utils/governmentApproval.ts` - `calculateStateApproval()`, `calculateApprovalFromAverages()`, `computeNationalAveragesFromMetrics()`
- `src/lib/utils/approvalModifiers.ts` - `MODIFIER_DEFS` (82 named conditions), `evaluateModifiers()`, `applyModifiers()`
- `src/components/ApprovalTooltip.tsx` - hover tooltip listing active modifiers; uses a React portal to escape `overflow-hidden` hero containers
- `src/lib/utils/getStateApprovalForElection.ts` - `getStateApprovalForElection(stateId)` for use in the election engine
- Uses same `isHigherBetter` map as national metrics for consistent metric direction
