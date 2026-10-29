# State-Level Power

State-level offices are the stepping stones of political careers and the foundation of party strength. This guide covers how to leverage governors, state senate seats, and state party positions.

Player guide: [Party Organization](https://www.ahousedividedgame.com/wiki/party-organization), [Party Leadership](https://www.ahousedividedgame.com/wiki/party-leadership) and [Player Progression](https://www.ahousedividedgame.com/wiki/player-progression) (office bonuses). No single wiki page is titled State-Level Power.

## State Offices

### Governor

- **Election** - Statewide single-winner race
- **Benefits** - +2 bonus actions/turn (`officeActionBonus.governor` in `src/lib/seeds/reference/gameConfig.ts`), +$15k/hr fund bonus (`OFFICE_FUND_BONUS.governor` in `src/lib/utils/fundGeneration.ts`, matching Senate)
- **Power** - Highest state-level office; strong influence on state politics
- **Government approval** - Governor's party benefits from state approval ratings in elections

### State Senate

- **Election** - Percentage-based seat allocation across the state
- **Benefits** - +1 bonus action/turn and +$3k/hr fund bonus (`stateSenate` in the same two files); lower than federal offices but a base for growth
- **Power** - State-level legislative influence

### House of Representatives

- **Election** - District-based races
- **Benefits** - +1 bonus action/turn, +$5k/hr fund bonus (`house`)
- **Value** - Easiest federal office to win; stepping stone to Senate or Governor

## State Party Organization

State party organization (Org) is a party's share of a state's organization bucket, and it scales your candidates' general-election votes:

- **Org pool** - Each state starts with a permanent 100-unit Unaffiliated stake (`ORG_BUCKET_BASELINE_UNITS`). `Org% = party units / (100 + all party units) x 100`.
- **Build Org** - Each successful click adds exactly 1 unit (`ORG_BUILD_UNITS_PER_CLICK`). Requires party presence in the state. Costs Political Strength and money from the officer's tier.
- **Vote effect** - In general elections each candidate's weight is multiplied by `orgShare ^ 0.2` (`ORG_WEIGHT_EXPONENT` in `src/lib/electionEngine/electionFormulaFactors.ts`), where `orgShare` is the party's fraction of all party Org in the state. A 3:1 Org lead is about a 1.25:1 weight edge. A party with 0 Org in a populated state gets weight 0, except for a small personal floor (`PERSONAL_ORG_FLOOR_CAP = 0.1`).
- **Decay** - After 96 turns without a Build Org click (`ORG_DECAY_GRACE_TURNS`) a party's units in that state decay 1% per turn (`ORG_UNIT_DECAY_RATE = 0.01`). Constants are in `src/lib/constants/partyOrg.ts`.

Worked example: a state has 100 Unaffiliated units, Party A has 60 and Party B has 20. A's Org is 60/180 = 33.3%, B's is 11.1%. Among parties, A's share is 0.75 and B's 0.25, so A's vote weight factor is 0.75^0.2 = 0.944 and B's is 0.25^0.2 = 0.758, a 1.25:1 edge even though A has 3x B's units.

The older Org cap and momentum model (base cap 15, momentum -10 to +10) is no longer in the game.

### Building Party Org

- Only state chair, vice chair, the state campaigner, or national officers can click Build Org; see [Party Building](./party-building.md) and [Party Leadership Authority](./party-leadership-authority.md).
- Winning offices keeps presence in a state (a player or elected official is required to build) and raises fund income, which pays for Build Org.
- A thin treasury can part-fund a click once it covers the minimum quarter-price floor; below that the click is refused and costs nothing.

## State Party Leadership

Each state party has three elected positions:

| Position   | Role                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| Chair      | Primary party leader in the state; can influence NPPs using party resources |
| Vice Chair | Assists Chair; can also influence same-party NPPs                           |
| Treasurer  | Manages state party treasury                                                |

### Why It Matters

- **NPP influence** - Chairs/VCs can direct NPP endorsements and withdrawals
- **Tax rates** - Leadership sets party tax rates, whole numbers from 0 to 33% (`MAX_TAX_RATE = 33` in `src/lib/api/schemas/settings.ts`; `calculateTaxAmount` in `src/lib/utils/fundGeneration.ts` returns 0 above 33). An unoccupied state taxes NPP income at `DEFAULT_NPP_STATE_TAX_RATE = 5`%
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

- **Home state advantage** - You can only enter elections in your home state (`isHomeState` in `src/lib/elections/entryEligibility.ts`). The exception is nationwide executive races such as President, open to any character of that country
- **State adjacency** - Support and Attack on another character cost 1.25x actions when that character's home is a neighboring state and 1.5x when it is not, against 1.0x for the same home state (`ACTION_COST_MULTIPLIERS` in `src/lib/states/adjacency.ts`, applied in `src/lib/influence/simpleInfluence.ts`). Barnstorm, Campaign and Advertise do not take the distance multiplier. The rule uses the US adjacency map
- **Pick your state wisely** - Some states are more competitive; swing states offer the most opportunity

## Path to Power

1. **Win state party chair** - Gives you NPP influence and party resource access
2. **Win a House seat** - Easiest federal office; builds your fund income
3. **Build org strength** - Your party's org directly helps all your party's candidates
4. **Run for Governor or Senate** - Leverage your established base

## Timing

- Office action bonuses are added when actions refresh each turn (`src/lib/turn/actionRefresh.ts`, reading `officeActionBonus`). Office fund bonuses are added in the hourly fund generation using `OFFICE_FUND_BONUS`.
- Election cycles (`CYCLE_TURNS` in `src/lib/constants/partyOrg.ts`): governor 192 turns, state senate 192, House 96, Senate 288.
- Org decay is computed by the organization bucket rules (`src/lib/parties/rules/organizationBucket.ts`) after the grace period. Build Org is immediate when clicked.
- Org vote weight is applied when a general election resolves and when polls are calculated (`orgVoteWeight`).

## Edge cases and limits

- Office bonuses end when the seat is lost or resigned, including by [Relocation](./relocation.md), which vacates state-bound seats.
- A newly admitted state starts with the seeded party organisation; see [Statehood Admission](./statehood-admission.md).
- Org share is relative: adding units for one party lowers every other share without removing any of their units.
- Tax rates above 33 are rejected; a rate of 0 collects nothing.
- The distance multiplier is US-only and rounds the action cost down with `Math.floor` in `priceExternalBoost`.

## Related Pages

- [Government Approval](./government-approval.md) - How approval affects elections
- [Demographics & Targeting](./demographics-targeting.md) - State demographic profiles
- [Political Parties](./parties.md) - Party system mechanics
- [Election Mechanics](./elections.md) - How state elections work
- [Relocation](./relocation.md) - Moving home state resets state leadership and seats

## Connections

Driven by:

- [Elections](./elections.md): winning a state office grants action and fund bonuses (`actionRefresh.ts`, `fundGeneration.ts`).
- [Party Building](./party-building.md): Build Org clicks raise Org share.

Affects:

- [Elections](./elections.md): Org share scales vote weight (`orgVoteWeight`).
- [Government Approval](./government-approval.md): governor's party benefits from state approval.
- [Relocation](./relocation.md): leaving a state vacates its seats and party posts.

Last checked: 2026-10-29, version 1.18.0
