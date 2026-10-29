# Party Influence

Party influence gives party leadership direct tools to manage same-party NPPs
using party resources (a banked NPP Action Point pool and the party treasury)
instead of personal character actions.

Player guide: [Party Actions](https://www.ahousedividedgame.com/wiki/party-actions)

This page is about party-level actions on NPPs. The separate per-member Party
Influence score that grants bonus actions is documented in
[parties.md](./parties.md). Player-to-NPP actions from an NPP profile are in
[npp-system.md](./npp-system.md).

## Overview

Two separate surfaces exist:

- **National party influence** (`POST /api/country/[code]/parties/[id]/influence`)
- **State / regional party influence** (`POST /api/country/[code]/region/[id]/party/[partyId]/influence`)

Both spend NPP Action Points and treasury, but they do not have identical
scope.

## Rules and constants

### Live action set

| Action | National | State / regional | NPP AP | Treasury cost (USD tier) | Effect |
| --- | --- | --- | --- | --- | --- |
| `boost_favorability` | yes | yes | 1 | $5,000 | Favorability gain on a diminishing curve |
| `boost_influence` | yes | yes | 1 | $5,000 | Political influence gain on a diminishing curve |
| `boost_loyalty` | yes | yes | 1 | $12,500 | Loyalty +1 to +3 (random), max 100 |
| `reduce_stubbornness` | yes | yes | 1 | $12,500 | Stubbornness -1 to -3 (random), min 0 |
| `relocate_state` | yes | no | 1 | none | Moves the NPP's home state |

Sources: `NPP_MANAGEMENT_AP_COST` and `nppManagementFundCost` in
`src/lib/npp/actionPoints.ts`; action sets in
`src/lib/parties/commands/nationalInfluence.ts` and the state `influence`
route; effects in `src/lib/influence/partyExecutorEffects.ts`
(`STAT_CHANGE_AMOUNTS`).

Treasury cost is by currency, not country: USD, GBP, EUR, NGN and SUR use the
amounts above, BRL and CNY pay 25,000 for boosts and 50,000 for loyalty and
cooperation, JPY pays 62,500 and 125,000. Relocation costs no treasury.

Stat gain curves (`src/lib/actions/rules.ts`):

- Favorability: `max(1, floor(3 - 0.1 x max(0, favorability - 70)))`.
- Influence: `max(0.1, 1 - max(0, influence - 50) / 75)`.

Both are the same curves an NPP uses for its own advertise and campaign
actions, so a chair boost cannot outrun the stat's natural decay and pin an NPP
at 100.

### NPP Action Point pools

| Scope | Tier | Pool cap | Regen per turn |
| --- | --- | --- | --- |
| National | Major | 160 | 16 |
| National | Minor | 80 | 8 |
| State | Major | 40 | 4 |
| State | Minor | 20 | 3 |

Source: `NPP_ACTION_POINT_CAP` and `NPP_ACTION_POINT_REGEN` in
`src/lib/npp/actionPoints.ts`. A legacy row with no pool is healed to the cap
on first use.

### Catalog actions that are not offered

`INFLUENCE_ACTIONS` in `src/lib/influence/constants.ts` still defines
`endorse_candidate`, `withdraw_election`, `oppose_candidate` and
`support_leadership` (3 actions each, base chance 40, 25, 35 and 45). The
live management routes reject them ("is not available in NPP Management"), so
players cannot use them from the party pages in the live release. Party
endorsements arranged this way no longer exist; endorsements come from the
player request flow in [npp-system.md](./npp-system.md).

### Success model

Management actions always succeed once validation and payment pass
(`outcome` is fixed to success in `src/lib/influence/partyExecutor.ts`). A
success chance is still computed and stored on the attempt record:

`baseChance = round(loyalty x 0.65 + 38)`
`stubbornnessPenalty = round(stubbornness x 0.32)`
`organizationBonus = round((state org - 50) x 0.1)`
`partyBonus = 0 for same party, -15 for another party`
`finalChance = clamp(base - penalty + party + org + hidden, 5, 85)`, then raised to the NPP's Slate assignment score if that is higher.

The state / regional surface adds a small hidden leadership bonus
(`stateLeadershipBonus`) to this record. Source:
`src/lib/influence/partyExecutorCalculations.ts` and `INFLUENCE_LIMITS`
(min 5, max 85) in `src/lib/influence/constants.ts`.

Worked example: an NPP with loyalty 60 and stubbornness 50 in a state at org 70
has `base = 77`, `penalty = 16`, `org = +2`, so the recorded chance is 63. The
boost is applied regardless.

## National Party Influence

### Authorization

- National Chair
- National Vice Chair
- confirmed campaigner (route-level `canUseNationalPartyInfluence`)
- admin override

### Scope

National influence covers the four stat tools plus relocation on same-party
NPPs, queued in batches. Relocation requires the target state to be in the
party's growth frontier (regions where it has a member, elected official or
active NPP, plus direct neighbours; `src/lib/parties/partyFrontier.ts`) and
respects regional capacity (`calculateRelocationCapacity` in
`src/lib/npp/recruitment.ts`).

## State / Regional Party Influence

### Authorization

- State / Regional Chair
- State / Regional Vice Chair
- admin override

### Current UI shape

The state / regional `NPPs` tab is split into `Recruitment` and `Management`.
Management offers `boost_favorability`, `boost_influence`, `boost_loyalty` and
`reduce_stubbornness`. It does not include relocation.

### Target rules

The panel only targets NPPs who:

- are same-party
- are not retired
- have `homeState` matching that state / region

The panel also flags officeholders and active candidates so local leadership
can see which NPPs are already in active political use.

## Timing

Party influence runs at request time, not in a turn phase. The attempt is
validated, resources are debited atomically (pool and treasury must both cover
the cost, otherwise nothing is charged), the NPP's `influenceState` is stamped
with the current turn, the effect is written, and the attempt is logged to
`nppInfluenceAttempts`. The pool refills each turn in `partyActionGeneration`
(`src/lib/turn/partyActionGeneration.ts`), which runs after `partyTierTurn`
and before `nppBehavior`, so stat changes made this turn are what the NPPs act
on in the same turn's voting and election entry.

## Edge cases and limits

- Boost favorability is refused when favorability is already 100, boost
  influence at 100, boost loyalty at loyalty 100; nothing is charged
  (`src/lib/influence/partyExecutorValidation.ts`).
- If the pool or the treasury cannot cover the cost, the request fails with
  "Insufficient party resources" and charges nothing.
- A state party cannot relocate NPPs and cannot touch NPPs outside its own
  state or party.
- Retired NPPs are not valid targets.
- Management requests are rate limited to 120 per minute
  (`NPP_MANAGEMENT_LIMITS` in `src/lib/api/rateLimit.ts`).

## Connections

**Driven by:**

- [Party building](./party-building.md): tier (Major or Minor) sets the pool size, org level feeds the recorded chance.
- [Parties](./parties.md): treasury, leadership roles and the growth frontier.

**Affects:**

- [NPP system](./npp-system.md): loyalty and stubbornness change whip compliance and Slate acceptance; favorability and influence feed election scoring.
- [Party slate](./party-slate.md): the Slate assignment score sets the floor on recorded chance.
- [Party whips](./party-whips.md): loyalty and stubbornness gate hard-whip rolls.

## Related Docs

- [npp-system.md](./npp-system.md)
- [parties.md](./parties.md)
- [party-building.md](./party-building.md)
- [party-slate.md](./party-slate.md)

Last checked: 2026-10-29, version 1.18.0
