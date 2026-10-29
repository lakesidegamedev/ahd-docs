# Player Policies

Your character has personal **economic** and **social** policy positions on a −5 to +5 scale. These are separate from the **legislative status quo** tracked for each policy area in government (see [Bills & Legislation](./bills-legislation.md)).

Player guide: [Policy Effects](https://www.ahousedividedgame.com/wiki/policy-effects) (covers personal positions versus enacted policy; no wiki page is dedicated to the policy shift action).

## Personal positions

- **Economic axis** - Left (negative) to right (positive) on fiscal and regulatory questions.
- **Social axis** - Progressive (negative) to conservative (positive) on cultural and rights questions.

You set starting positions at **character creation**. They matter for **election appeal**: candidates closer to a demographic group's lean tend to earn higher appeal with that group during vote calculation (see [Election Mechanics](./elections.md) and [Demographics & Targeting](./demographics-targeting.md)).

## Changing your positions - policy shift

Use the **policy shift** action from settings (API: `POST /api/settings/policy`):

| Resource            | Cost               |
| ------------------- | ------------------ |
| Actions             | 15                 |
| Political influence | −5% (floored at 0) |
| National influence  | −5% (floored at 0) |
| Infamy              | +5                 |

Instead of paying those costs you can spend one **position update voucher**: a voucher shift costs no actions, no influence and no infamy. Vouchers are granted by the game team, not earned in play (`POSITION_UPDATE_VOUCHER_GRANT_AMOUNT = 1` per grant).

Each request moves **one axis** by one step (`direction` ±1). Values clamp to **−5…+5**; out-of-range requests are rejected.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `POLICY_SHIFT_ACTION_COST` | 15 | `src/lib/positionUpdateVouchers/rules.ts` |
| `POLICY_SHIFT_INFAMY_COST` | 5 (infamy clamped 0 to 100) | `src/lib/positionUpdateVouchers/rules.ts` |
| `POLICY_SHIFT_INFLUENCE_MULTIPLIER` | 0.95, result floored, applied to political and national influence | `src/lib/positionUpdateVouchers/rules.ts` |
| Voucher cost | 1 voucher, 0 actions, 0 infamy, influence unchanged | `src/lib/positionUpdateVouchers/rules.ts` |
| Policy range | -5 to +5 | `src/app/api/settings/policy/route.ts` |
| `POSITION_GRID` | 0.05 (positions snap to this grid) | `src/lib/utils/politics.ts` |
| `VOTE_SHIFT_STEP` | 0.25 per axis per bill | `src/lib/policyShift.ts` |
| Policy shift rate limit | 30 requests per 60 s per user | `src/app/api/settings/policy/route.ts` |

Worked example: five deliberate shifts with actions cost 75 actions and 25 infamy, and political and national influence become `floor(x * 0.95)` five times, about 77% of the starting value. Shifting from 0 to +5 on one axis takes five shifts. Five vouchers do the same for free.

The payment, bound check and position change happen in one atomic database update (`findOneAndUpdate` with the action or voucher balance and the -5/+5 bound in the filter), so a failed shift charges nothing. A failure returns 400 with "Policy cannot go beyond -5 or 5.", "No Positions Update Vouchers available." or "Not enough actions."

## Bills and voting

Voting on a bill moves your personal policy coordinates by at most **0.25 per axis per bill** (`VOTE_SHIFT_STEP` in `src/lib/policyShift.ts`). It is not per provision. The bill's position on an axis is the average stance of its policy provisions that take a stance there (omitted or 0 values are left out of the average, and tariffs, subsidies, war declarations and similar are not counted). Then:

- **Aye** moves you toward the bill by 0.25, never past the bill's position.
- **Nay** moves you away from the bill by 0.25.
- **Abstain**, an axis the bill takes no stance on, or already standing exactly on the bill's position: no movement. Abstaining after an Aye or Nay reverts what that vote applied.

Each bill keeps a per-character ledger (`policyShiftLedger`) with your baseline from before the bill first moved you. Changing your vote recomputes from that baseline, so the net effect of one bill never exceeds one step, and shifts from other bills in between are kept. A vote cast before the ledger existed is not re-measured. A party whip's overwritten vote never moved your positions and does not count as a prior vote. Results are clamped to -5 through +5 and snapped to the 0.05 grid.

The vote therefore changes both the public legislative record and, over a long career, the character's own positioning. Enactment separately changes government policy records and metrics.

## Timing

Policy shift is an immediate API call (`POST /api/settings/policy`), not a turn phase, and it resolves instantly. Vote drift is applied when a vote is cast or changed, by `applyBillVotePolicyShift`, from the national and state bill vote commands (`src/lib/legislature/commands/nationalBillActions.ts`, `stateBillActions.ts`). The positions are read later by the election vote calculation, which uses `policies.economic` and `policies.social` (`src/lib/elections/candidateEnrichment.ts`), so a shift made before election night counts.

## Edge cases and limits

- At +5 or -5 on an axis, a shift further out is rejected with no charge. The opposite direction still works.
- With fewer than 15 actions and no voucher the shift is rejected with no charge.
- Influence is floored, so 1 influence becomes 0 and small balances lose their last point.
- Vote drift is capped by the bill ledger, not by a daily limit, so many different bills can add up over time.
- No position lock during a primary or general election exists in this code; shifts are allowed at any time.
- Appeal with demographic groups uses the current position, so deliberate shifts have a real cost: 5% of both influence pools plus infamy.

## Viewing the policy landscape

The **Policy** page (`/policy`) shows current **government** positions by legislation type - national or per-state - with human-readable option names. Use it to see the law as it stands, compare to your personal stance, and plan legislation or campaigns.

## Connections

Driven by:

- [Bills & Legislation](./bills-legislation.md): each vote nudges positions through `applyBillVotePolicyShift`.
- [Stats & Actions](./stats-actions.md): the 15 action cost is paid from the character's action balance.

Affects:

- [Election Mechanics](./elections.md): positions feed `candidateEnrichment` and the demographic appeal calculation.
- [Demographics & Targeting](./demographics-targeting.md): closeness to a group's lean sets appeal with that group.

## Related pages

- [Bills & Legislation](./bills-legislation.md) - Provisions, votes, archetype approval impacts
- [Election Mechanics](./elections.md) - How appeal and vote share work
- [Demographics & Targeting](./demographics-targeting.md) - Groups, leans, and turnout
- [Stats & Actions](./stats-actions.md) - Action economy and costs
- [National Metrics](./national-metrics.md) - Outcomes from enacted policy over time

Last checked: 2026-10-29, version 1.18.0
