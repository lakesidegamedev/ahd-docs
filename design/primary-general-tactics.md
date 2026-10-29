# Primary vs General Tactics

Primaries and general elections require fundamentally different strategies. Understanding when to pivot is the mark of an experienced player.

Player guide: [Primary vs General Tactics](https://www.ahousedividedgame.com/wiki/primary-general-tactics). That wiki page is the full version; this page keeps the verified numbers.

## Primary Elections

Primaries determine your party's nominee. You compete against members of your own party.

### How Primaries Work

- **Who votes** - Only members of your party in that state
- **Scoring** - State and legislative primaries score up to 100 points: alignment 40 (25 against the state's lean plus 15 against your party platform, or 40 against the platform alone when no state lean is available), Favorability 35 and in-state Political Influence 25, then multiplied by an infamy penalty that falls from 1.0 to 0.95 at 100 infamy (`src/lib/primaryScore.ts`)
- **Duration** - Fixed per office in `src/lib/constants/electionDurations.ts`: primary lengths are House 48 turns, Senate 240, Governor 144 and President 144, each followed by a 48-turn general; UK Commons elections run 24 primary plus 24 general

### Primary Strategy

- **Appeal to your base** - Your party's core demographics are your voters
- **Build influence early** - Political Influence is weighted heavily in primary scoring
- **Policy positioning** - Stay close to your party's median position; extremists lose primaries unless the party is extreme
- **NPP competition** - NPPs get a 50% score penalty against players (their score is multiplied by 0.5 when a player is in the party primary, `NPP_PRIMARY_SCORE_MULTIPLIER` in `src/lib/electionEngine/constants.ts`), but they still compete. Enter races early to discourage NPP entries.

### Presidential Primary Differences

- Uses **national** political influence (not state-level)
- Heavier policy weight: Policy Alignment 40 + Party Influence 20 + National Reach 15 + Favorability 25 (`src/lib/primaryScore.ts`)
- One candidate per party

## General Elections

The general election pits party nominees against each other.

### How Generals Work

- **All voters** in the state can vote (not just your party)
- **Vote accumulation** - Votes accumulate over turns based on appeal, turnout, and party strength
- **State lean** - Blue/red lean gives structural advantage to the aligned party

### General Strategy

- **Broaden appeal** - You need voters beyond your party base
- **Target swing demographics** - Groups near center on both axes
- **Leverage party organization** - Higher party org = more votes per turn
- **State approval matters** - Government approval multiplies your vote total
- **Closing weight** - Votes accumulate over the general window in three tiers: the final 4 turns carry 30 percent of the vote pool, the 8 turns before them 20 percent, and everything earlier 50 percent (`src/lib/electionEngine/voteCalculations.ts`)
- **Campaign season** - Canvassing effectiveness doubles when the election ends within 4 turns (`src/app/api/canvassing/route.ts`)

### Pivoting from Primary to General

1. **Don't shift positions** - Your positions are locked; you can't moderate after the primary
2. **Shift ad targeting** - Move ads from base demographics to swing groups
3. **Increase campaign activity** - Campaign season multiplier makes every action more valuable
4. **Watch your opponent** - If they have higher influence, you need to out-fundraise and out-advertise

## Office-Specific Notes

| Office    | Key Factor                                                       |
| --------- | ---------------------------------------------------------------- |
| House     | State party org strength; many districts mean many NPP opponents |
| Senate    | Statewide appeal; need broad demographic coverage                |
| Governor  | Statewide; government approval matters most                      |
| President | Electoral College; win the swing states, which depend on the era and the current state leans |

## Related Pages

- [Election Mechanics](./elections.md) - Detailed election system
- [Campaign Strategy](./campaign-strategy.md) - Action allocation
- [Demographics & Targeting](./demographics-targeting.md) - Understanding voter groups
- [NPP Opponents Guide](./npp-opponents.md) - Dealing with AI competition

Last checked: 2026-10-29, version 1.18.0
