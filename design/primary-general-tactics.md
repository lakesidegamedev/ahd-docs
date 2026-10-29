# Primary vs General Tactics

Primaries and general elections require fundamentally different strategies. Understanding when to pivot is the mark of an experienced player.

## Primary Elections

Primaries determine your party's nominee. You compete against members of your own party.

### How Primaries Work

- **Who votes** - Only members of your party in that state
- **Scoring** - Based on policy alignment, favorability, and political influence
- **Duration** - Set by admin; typically runs for several turns

### Primary Strategy

- **Appeal to your base** - Your party's core demographics are your voters
- **Build influence early** - Political Influence is weighted heavily in primary scoring
- **Policy positioning** - Stay close to your party's median position; extremists lose primaries unless the party is extreme
- **NPP competition** - NPPs get a 50% score penalty against players (their score is multiplied by 0.5 when a player is in the party primary), but they still compete. Enter races early to discourage NPP entries.

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
- **Campaign season** - Canvassing effectiveness doubles 4 turns before election end

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
| President | Electoral College; win swing states (AZ, GA, MI, NH, NV, PA, WI) |

## Related Pages

- [Election Mechanics](./elections.md) - Detailed election system
- [Campaign Strategy](./campaign-strategy.md) - Action allocation
- [Demographics & Targeting](./demographics-targeting.md) - Understanding voter groups
- [NPP Opponents Guide](./npp-opponents.md) - Dealing with AI competition
