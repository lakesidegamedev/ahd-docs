# State-Level Power

State-level offices are the stepping stones of political careers and the foundation of party strength. This guide covers how to leverage governors, state senate seats, and state party positions.

## State Offices

### Governor

- **Election** - Statewide single-winner race
- **Benefits** - +2 bonus actions/turn, +$15k/hr fund bonus (matching Senate)
- **Power** - Highest state-level office; strong influence on state politics
- **Government approval** - Governor's party benefits from state approval ratings in elections

### State Senate

- **Election** - Percentage-based seat allocation across the state
- **Benefits** - Lower than federal offices but provide a base for growth
- **Power** - State-level legislative influence

### House of Representatives

- **Election** - District-based races
- **Benefits** - +$5k/hr fund bonus, base office actions
- **Value** - Easiest federal office to win; stepping stone to Senate or Governor

## State Party Organization

State party organization (0-100) is crucial for election success:

- **Org strength** - Higher org = more votes per turn for your party's candidates
- **Org cap** - Starts from a base of 15 and gains office-specific contributions from the party's Governor, Senate, House, and State Senate performance
- **Momentum** (-10 to +10) - Positive momentum grows org; negative shrinks it

### Building Party Org

- Party leadership elections affect org momentum
- Winning elections in the state boosts momentum
- Active party members contribute to org strength

## State Party Leadership

Each state party has three elected positions:

| Position   | Role                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| Chair      | Primary party leader in the state; can influence NPPs using party resources |
| Vice Chair | Assists Chair; can also influence same-party NPPs                           |
| Treasurer  | Manages state party treasury                                                |

### Why It Matters

- **NPP influence** - Chairs/VCs can direct NPP endorsements and withdrawals
- **Tax rates** - Leadership sets party tax rates (0-33%)
- **Treasury** - Controls state party funds for transfers and operations
- **Party GOTV** - Party resources passively boost turnout in aligned demographics

## State Demographics

Each state has a granular electorate assembled from census-backed dimensions
such as age, education, income, geography, race and ethnicity, religion, and
occupation. Country-specific seeds adapt the dimensions and weights to each
country rather than reusing a fixed set of 12 US archetypes. See
[Demographics and Targeting](./demographics-targeting.md) and
[Granular Electorate as Shipped](./granular-electorate-as-shipped.md).

## Equivalent Regional Offices

The regional executive pattern is country-aware. It appears as a US Governor,
German Minister-President, Japanese regional Governor, Chinese Governor, and
as a UK First Minister in Scotland, Wales, or Northern Ireland. London uses a
Mayor. English UK regions outside London have no devolved executive office.

## Geographic Strategy

- **Home state advantage** - You can only enter elections in your home state
- **State adjacency** - Interpersonal actions (Support, Attack, Barnstorm) cost 1.25x in neighboring states and 1.5x in non-neighboring states, against 1.0x in your home state; Campaign and Advertise are not affected (`src/lib/states/adjacency.ts`)
- **Pick your state wisely** - Some states are more competitive; swing states offer the most opportunity

## Path to Power

1. **Win state party chair** - Gives you NPP influence and party resource access
2. **Win a House seat** - Easiest federal office; builds your fund income
3. **Build org strength** - Your party's org directly helps all your party's candidates
4. **Run for Governor or Senate** - Leverage your established base

## Related Pages

- [Government Approval](./government-approval.md) - How approval affects elections
- [Demographics & Targeting](./demographics-targeting.md) - State demographic profiles
- [Political Parties](./parties.md) - Party system mechanics
- [Election Mechanics](./elections.md) - How state elections work
