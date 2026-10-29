# NPP Opponents Guide

Non-Player Politicians (NPPs) are AI-controlled politicians that fill offices, run in elections, and vote on legislation. Understanding their behavior gives you a competitive edge.

This page is the player-facing companion to [npp-system.md](./npp-system.md), which has the full mechanical detail. Where the two disagree, `npp-system.md` is authoritative.

## NPP Election Behavior

NPP election entry is **deterministic and priority-based**, not a random ambition roll (`src/lib/turn/npp/electionEntry.ts`, `src/lib/turn/nppEntryLogic.ts`). There is no entry-chance percentage and no per-turn dice roll for whether an NPP shows up.

Entry runs in a fixed order each turn:

1. **Defending incumbents** auto-file first for the seat they already hold, bypassing that seat's cooldown.
2. **Accepted Slate NPPs** file next, even if this creates a same-party primary against a defending incumbent.
3. **Fallback fill** then adds at most one generic same-party NPP to an otherwise open primary, following `RACE_PRIORITY` order (state senate and regional/subnational races before national legislature, governor last).

A small **v3 ambitious-challenger pass** can add a second same-party NPP to an already-filled primary: base 15% chance per already-filled party slot per cycle (`CHALLENGER_BASE_PROBABILITY`), halved in player-enabled countries (`PLAYER_COUNTRY_CHALLENGER_MULT = 0.5`), further capped by `ChallengerBudget`.

- **Country isolation**, NPPs only enter elections in their own `countryId`.
- **One race at a time**, an NPP already in an active race is not eligible to enter another.
- **Presidential entry is blocked** by default; SP3 lifts the bar only in autonomy-active, non-player-enabled countries, where there is no player to contest the presidency.

### NPP Advantages

- They keep a **political influence floor of 10** (`NPP_POLITICAL_INFLUENCE_FLOOR` in `shared/constants/formulas.ts`): decay never takes them below it. Players have a decay floor of 0, but new characters also start at 10
- They start with realistic policy positions based on party
- They have real politician avatars and names

### NPP Disadvantages

- **50% score penalty** when competing against player characters in primaries (`NPP_PRIMARY_SCORE_MULTIPLIER = 0.5` in `src/lib/electionEngine/constants.ts`)
- **20% vote-weight penalty** in general elections when a player is in the race (`NPP_GENERAL_WEIGHT_MULTIPLIER = 0.8`, same file)
- They receive an `electionCooldowns` entry when they drop out of a race, and fallback fill respects it (defending incumbents can still re-file for their own seat regardless)
- They can't strategically time their campaigns
- They can't run ads or fundraise strategically

## Beating NPPs

### In Primaries

1. **Enter early**, your presence still matters because of the NPP primary score penalty once you're in the race
2. **Build influence**, NPPs have a floor of 10; exceed it significantly
3. **Stay ideologically aligned**, NPPs sit close to their party median; match or exceed their alignment
4. **One race at a time**, NPPs can only be in one primary at once; if they're in yours, they can't be elsewhere

### In Generals

1. **Leverage your party org**, NPPs benefit from party org too, but you can actively improve it
2. **Campaign actively**, NPPs can't canvass or run targeted ads
3. **Target their weak demographics**, NPPs have fixed positions; find demographics they don't appeal to

## NPP Influence System

The NPP profile page (`/politicians/npp/[id]`) exposes a deterministic direct-interaction action set (`src/lib/capital/actions.ts`), not a hidden-roll "influence request" table:

| Action                | AP  | Campaign Funds | Gate                | Effect                                       |
| ---------------------- | --- | -------------- | -------------------- | --------------------------------------------- |
| `request_endorsement`  | 6   | $0             | hidden evaluation (relationship and policy fit) | Creates or refreshes an arranged endorsement |
| `private_meeting`      | 3   | $0             | relationship -50      | +5 relationship                               |
| `boost_favorability`   | 5   | $10,000        | none                  | +3 favorability, +2 relationship              |
| `reduce_favorability`  | 5   | $10,000        | relationship -100     | -3 favorability, -2 relationship              |
| `boost_influence`      | 6   | $20,000        | none                  | +2 influence, +2 relationship                 |
| `reduce_influence`     | 6   | $20,000        | relationship -100     | -2 influence, -2 relationship                 |

Party chairs and vice chairs get a separate party-side surface for NPP management (recruitment, `boost_loyalty`, `reduce_stubbornness`), see [party-influence.md](./party-influence.md).

## NPP Bill Voting

NPPs vote on legislation through a **deterministic cross-pressure verdict**, not a pure ideology roll (`src/lib/turn/npp/billVoting.ts`, `crossPressure.ts`). Each vote sums four signed forces, ideology, whip, district/home-region sentiment, donors, and resolves to `for` above +5, `against` below -5, otherwise `abstain` (`VERDICT_THRESHOLD = 5` in `crossPressure.ts`). NPPs holding multiple seats contribute their `seatsHeld` weight to the tally.

## Related Pages

- [npp-system.md](./npp-system.md), Full NPP mechanics documentation
- [election-engine.md](./election-engine.md), How elections work
- [campaign-strategy.md](./campaign-strategy.md), Overall strategy guide

Last checked: 2026-10-29, version 1.18.0
