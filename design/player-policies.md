# Player Policies

## Summary

Your character has personal **economic** and **social** policy positions on a -5 to +5 scale. These are separate from the **legislative status quo** tracked for each policy area in government (see [Bills & Legislation](./bills-legislation.md)). Positions are set at character creation, can be changed deliberately with a paid **policy shift**, and drift a little when you vote on bills. They feed the election appeal calculation.

Player guide: [Policy Effects](https://www.ahousedividedgame.com/wiki/policy-effects) (covers personal positions versus enacted policy; no wiki page is dedicated to the policy shift action).

## Rules

### Personal positions

- **Economic axis** - Left (negative) to right (positive) on fiscal and regulatory questions.
- **Social axis** - Progressive (negative) to conservative (positive) on cultural and rights questions.

You set starting positions at **character creation** (the creation route rounds them to whole numbers). They matter for **election appeal**: candidates closer to a demographic group's lean tend to earn higher appeal with that group during vote calculation (see [Election Mechanics](./elections.md) and [Demographics & Targeting](./demographics-targeting.md)).

### Changing your positions: policy shift

Use the **policy shift** action from settings (API: `POST /api/settings/policy`):

| Resource            | Cost               |
| ------------------- | ------------------ |
| Actions             | 15                 |
| Political influence | -5% (floored at 0) |
| National influence  | -5% (floored at 0) |
| Infamy              | +5                 |

Instead of paying those costs you can spend one **position update voucher**: a voucher shift costs no actions, no influence and no infamy. Vouchers are granted by the game team, not earned in play (`POSITION_UPDATE_VOUCHER_GRANT_AMOUNT = 1` per grant).

Each request moves **one axis** by one step (`direction` is -1 or +1). The route refuses a shift only when the current value is already at the bound in that direction (see the edge case below for fractional positions).

The payment, bound check and position change happen in one atomic database update (`findOneAndUpdate` with the action or voucher balance and the bound in the filter), so a failed shift charges nothing. A failure returns 400 with "Policy cannot go beyond -5 or 5.", "No Positions Update Vouchers available." or "Not enough actions. You need 15 actions." A successful shift also awards the `policy_shift` achievement (shown as "Flip-Flopper"); a failure to award it is logged and does not undo the shift.

#### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `POLICY_SHIFT_ACTION_COST` | 15 | `src/lib/positionUpdateVouchers/rules.ts` |
| `POLICY_SHIFT_INFAMY_COST` | 5 (infamy clamped 0 to 100) | `src/lib/positionUpdateVouchers/rules.ts` |
| `POLICY_SHIFT_INFLUENCE_MULTIPLIER` | 0.95, result floored, applied to political and national influence | `src/lib/positionUpdateVouchers/rules.ts` |
| `POSITION_UPDATE_VOUCHER_GRANT_AMOUNT` | 1 voucher per grant | `src/lib/positionUpdateVouchers/rules.ts` |
| Voucher cost | 1 voucher, 0 actions, 0 infamy, influence unchanged | `src/lib/positionUpdateVouchers/rules.ts` |
| Policy range | -5 to +5 | `src/app/api/settings/policy/route.ts` |
| `POSITION_GRID` | 0.05 (positions snap to this grid) | `src/lib/utils/politics.ts` |
| `VOTE_SHIFT_STEP` | 0.25 per axis per bill | `src/lib/policyShift.ts` |
| Policy shift rate limit | 30 requests per 60 s per user | `src/app/api/settings/policy/route.ts` |

Example: five deliberate shifts with actions cost 75 actions and 25 infamy, and political and national influence become `floor(x * 0.95)` five times, about 77% of the starting value. Shifting from 0 to +5 on one axis takes five shifts. Five vouchers do the same for free.

### Bills and voting

Voting on a bill moves your personal policy coordinates by at most **0.25 per axis per bill** (`VOTE_SHIFT_STEP` in `src/lib/policyShift.ts`). It is not per provision. The bill's position on an axis is the average stance of its policy provisions that take a stance there (omitted or 0 values are left out of the average, and tariffs, subsidies, war declarations and similar are not counted). Then:

- **Aye** moves you toward the bill by 0.25, never past the bill's position.
- **Nay** moves you away from the bill by 0.25.
- **Abstain**, an axis the bill takes no stance on, or already standing exactly on the bill's position: no movement. Abstaining after an Aye or Nay reverts what that vote applied.

Each bill keeps a per-character ledger (`policyShiftLedger`) with your baseline from before the bill first moved you. Changing your vote recomputes from that baseline, so the net effect of one bill never exceeds one step, and shifts from other bills in between are kept. A vote cast before the ledger existed is not re-measured. A party whip's overwritten vote never moved your positions and does not count as a prior vote. Results are clamped to -5 through +5 and snapped to the 0.05 grid.

The vote therefore changes both the public legislative record and, over a long career, the character's own positioning. Enactment separately changes government policy records and metrics.

### Viewing the policy landscape

The **Policy** page (`/policy`) shows current **government** positions by legislation type, national or per-state, with human-readable option names. Use it to see the law as it stands, compare to your personal stance, and plan legislation or campaigns.

## Data

| Collection | Fields | Access | Player-visible |
| --- | --- | --- | --- |
| `characters` | `policies.economic`, `policies.social` | Read by election enrichment; written by the shift route and by vote drift | Yes |
| `characters` | `actions`, `infamy`, `politicalInfluence`, `nationalInfluence` | Written by a paid shift | Yes |
| `characters` | `positionUpdateVouchers` | Decremented by a voucher shift; incremented by an admin grant | Yes, in settings |
| `bills` and `stateBills` | `policyShiftLedger.<characterId>` as `{ baseline, applied }` | Written on each vote that can move positions | No |
| `characterAchievements` | the `policy_shift` award | Written on a successful shift | Yes |

## Configuration

There are no `gameConfig` fields, era presets or scenario overrides for personal policies. Every value is a code constant (table above). The only operational switch is the voucher balance, which is raised by the admin resource-grant route (`src/app/api/admin/resources/grant/route.ts`) by `POSITION_UPDATE_VOUCHER_GRANT_AMOUNT` per grant; new characters start with `positionUpdateVouchers: 0` (`src/app/api/auth/character/route.ts`).

## Timing

Policy shift is an immediate API call (`POST /api/settings/policy`), not a turn phase, and it resolves instantly. Vote drift is applied when a vote is cast or changed, by `applyBillVotePolicyShift`, from the national and state bill vote commands (`src/lib/legislature/commands/nationalBillActions.ts`, `stateBillActions.ts`). The positions are read later by the election vote calculation, which uses `policies.economic` and `policies.social` (`src/lib/elections/candidateEnrichment.ts`), so a shift made before election night counts.

## Worked trace

A character has economic 3, social -1, 40 actions, 37 political influence, 12 national influence and infamy 98.

**Deliberate shift** (economic, direction +1, no voucher):

| Field | Calculation | Result |
| --- | --- | --- |
| Actions | 40 - 15 | 25 |
| Infamy | min(100, 98 + 5) | 100 |
| Political influence | floor(37 x 0.95 = 35.15) | 35 |
| National influence | floor(12 x 0.95 = 11.4) | 11 |
| Economic | 3 + 1 | 4 |

**Vote drift** (from the original economic 3, social -1, ignoring the shift above). A bill has two economic provisions with stances 4 and 1, a provision with economic 0 (left out), and two social provisions with stances -3 and -2. Targets: economic (4 + 1) / 2 = 2.5, social (-3 + -2) / 2 = -2.5.

| Vote | Economic | Social |
| --- | --- | --- |
| Aye, baseline 3 / -1 | distance -0.5, step min(0.25, 0.5) = 0.25 toward, lands 2.75 | distance -1.5, step 0.25 toward, lands -1.25 |
| Change to Nay | landing from baseline: 3 + 0.25 = 3.25; change = 3.25 - (-0.25) = +0.5; stored 2.75 + 0.5 = 3.25 | landing -1 + 0.25 = -0.75; change +0.5; stored -1.25 + 0.5 = -0.75 |
| Change to Abstain | landing 3; change 0 - 0.25 = -0.25 (from the applied +0.25); stored 3.00 | landing -1; change -0.25; stored -1.00 |

The ledger keeps baseline 3 / -1, so the net effect of this bill never exceeds one 0.25 step in either direction.

## Edge cases and limits

- At +5 or -5 on an axis, a shift further out is rejected with no charge. The opposite direction still works.
- With fewer than 15 actions and no voucher the shift is rejected with no charge.
- Influence is floored, so 1 influence becomes 0 and small balances lose their last point.
- Vote drift is capped by the bill ledger, not by a daily limit, so many different bills can add up over time.
- No position lock during a primary or general election exists in this code; shifts are allowed at any time.
- Appeal with demographic groups uses the current position, so deliberate shifts have a real cost: 5% of both influence pools plus infamy.
- Fractional positions: vote drift can leave a position such as 4.75. The shift route only checks that the current value is below 5 (or above -5), and it adds a whole 1 without clamping, so a deliberate +1 from 4.75 stores 5.75. See Known issues.
- Infamy is clamped to 0 to 100 on a paid shift, so a character at 98 pays the full 15 actions but gains only 2 infamy.
- A voucher shift leaves infamy and both influence pools unchanged.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| A failed shift charges nothing | Payment, bound and move are one atomic update; tested in `src/app/api/settings/policy/route.test.ts` |
| Vote drift never moves a position outside -5 to +5 | `clamp` in `computeVoteShift` and `applyBillVotePolicyShift`; tested in `src/lib/policyShift.test.ts` ("clamps so the position stays within the -5..+5 range") |
| Net movement from one bill never exceeds one step | Ledger baseline in `applyBillVotePolicyShift`; tested in `policyShift.test.ts` |
| Vote-drift results sit on the 0.05 grid | `onGrid`; tested for fractional averages |
| A deliberate shift keeps the position within -5 to +5 | Not enforced: see the fractional edge case |

## Failure and recovery

- **A shift fails.** Nothing is charged; the player sees one of the three 400 messages and can retry.
- **Vote drift fails.** The call in the bill vote command is wrapped, so the failure is logged and the vote is still recorded without moving positions. Re-voting later applies the shift if the ledger has no entry.
- **Partial drift write.** The character update and the ledger write are two separate writes. If the ledger write fails after the character moved, a later vote change cannot be measured from the original baseline. Such cases are repaired by an administrator correcting the position (a data heal) rather than by code.
- **Out-of-range stored value.** Repaired by setting the position back inside -5 to +5; there is no automatic clamp pass.

## Connections

Driven by:

- [Bills & Legislation](./bills-legislation.md): each vote nudges positions through `applyBillVotePolicyShift`.
- [Stats & Actions](./stats-actions.md): the 15 action cost is paid from the character's action balance.

Affects:

- [Election Mechanics](./elections.md): positions feed `candidateEnrichment` and the demographic appeal calculation.
- [Demographics & Targeting](./demographics-targeting.md): closeness to a group's lean sets appeal with that group.

Related pages:

- [Bills & Legislation](./bills-legislation.md) - Provisions, votes, archetype approval impacts
- [Election Mechanics](./elections.md) - How appeal and vote share work
- [Demographics & Targeting](./demographics-targeting.md) - Groups, leans, and turnout
- [Stats & Actions](./stats-actions.md) - Action economy and costs
- [National Metrics](./national-metrics.md) - Outcomes from enacted policy over time

## Tests

| File | Covers |
| --- | --- |
| `src/lib/positionUpdateVouchers/rules.test.ts` | Standard and voucher payment costs |
| `src/app/api/settings/policy/route.test.ts` | Voucher consumption, voucher failure, standard action and penalty path |
| `src/lib/policyShift.test.ts` | Bill targets, vote shift sizes, previews, ledger behaviour, whip handling, state bills |

Gaps: no test covers the bound check at 5 or -5 through the route, the fractional-position overshoot, infamy clamping, or influence flooring.

## Known issues and history

- A deliberate shift from a fractional position inside one step of the bound (for example 4.75) passes the bound check and stores a value beyond 5 or -5, because the route adds a whole 1 with no clamp. Vote drift clamps; the paid shift does not. The existing text "out-of-range requests are rejected" only holds for positions exactly at the bound or beyond it.
- The wiki Policy Effects page covers enacted policy and does not describe the personal policy shift action, costs or vouchers.
- Vote drift ledger and whip handling were refined in later fixes (omitted and 0 stances excluded from the bill average, prior votes read from the voter's own chamber map); the code comments record this but give no dates.

Last checked: 2026-10-29, version 1.18.0
