# Player Policies

Your character has personal **economic** and **social** policy positions on a −5 to +5 scale. These are separate from the **legislative status quo** tracked for each policy area in government (see [Bills & Legislation](./bills-legislation.md)).

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

Instead of paying those costs you can spend one **position update voucher**: a voucher shift costs no actions, no influence and no infamy (`src/lib/positionUpdateVouchers/rules.ts`).

Each request moves **one axis** by one step (`direction` ±1). Values clamp to **−5…+5**; out-of-range requests are rejected.

## Bills and voting

Voting on a bill moves your personal policy coordinates by **0.25 per applicable provision** in the provision's economic or social direction. Values remain clamped to -5 through +5. The vote therefore changes both the public legislative record and, over a long career, the character's own positioning. Enactment separately changes government policy records and metrics.

## Viewing the policy landscape

The **Policy** page (`/policy`) shows current **government** positions by legislation type - national or per-state - with human-readable option names. Use it to see the law as it stands, compare to your personal stance, and plan legislation or campaigns.

## Related pages

- [Bills & Legislation](./bills-legislation.md) - Provisions, votes, archetype approval impacts
- [Election Mechanics](./elections.md) - How appeal and vote share work
- [Demographics & Targeting](./demographics-targeting.md) - Groups, leans, and turnout
- [Stats & Actions](./stats-actions.md) - Action economy and costs
- [National Metrics](./national-metrics.md) - Outcomes from enacted policy over time
