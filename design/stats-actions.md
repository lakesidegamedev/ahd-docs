# Stats & Actions

## Core Stats

### Political Influence (per state)

- **Scale**: 0-100
- **Starting Value**: 0
- **Increased by**: Campaign (+1 base, diminishing above 50 and floored at +0.1)
- **Decreased by**: Decay (0.75% of current influence per turn, floor 0)
- **Affects**: Election vote potential (reach fraction), campaign appeal, primary scores
- **Scope**: Single value (home state focus in current implementation)

### National Political Influence (NPI)

- **Scale**: Uncapped (starts at 0)
- **Starting Value**: 0
- **Increased by**: +state influence / 100 per turn, plus the strongest applicable office or leadership bonus
- **Affects**: **Presidential elections exclusively** - not used in state races (House, Senate, Governor, State Senate). Drives both reach and appeal in presidential vote accumulation and primaries.
- **Scaling**: General elections use the sqrt `normalizeNPI` curve, hard-capped at 1.0 once NPI reaches 100. NPI=25 → 0.5×; NPI=50 → ~0.71×; NPI=85 → ~0.92×; NPI=99 → ~0.995×; NPI ≥ 100 → 1.0×. Presidential primaries use a separate diminishing-return curve, `1 - exp(-NPI/45)`, which approaches 1.0 without a hard cap.
- **Scope**: National (single value)

### Favorability

- **Scale**: 0-100
- **Starting Value**: 50 (neutral)
- **Increased by**: Campaign (minor), Ads (+1-3, diminishing above 70%), Travel (+1%/turn while in travel state)
- **Decreased by**: Attacks from opponents, high Infamy (passive drain), natural decay only when above 60%
- **Affects**: Vote potential (approval multiplier in appeal formula)
- **Scope**: Single value

```favorability-decay

```

### Infamy

- **Scale**: 0-100
- **Starting Value**: 0
- **Increased by**: Attack actions (+2% per attack), NPP boost "lower" (+2%)
- **Effects**:
  - 0-20%: No penalty
  - 20%+: Favorability drain = (infamy − 20) × 0.05% per turn
  - Attack failure: Infamy × 10 = % chance attack fails (roll 0-999)
- **Decay**: 5% of current value per turn (new = value × 0.95)

### Policy Positions

- **Scale**: -5 to +5 per axis (economic, social)
- **Set**: At character creation
- **Changed by**: Voting on bills (±0.25 per vote in direction of bill)
- **Compared against**: Demographic group leans for election calculations; party position for primary scores and party influence

### Campaign Funds

- **Starting Value**: $250,000
- **Increased by**: Fundraise, per-turn fund generation (base + donor base + office bonus)
- **Office fund bonus**: Governor +$15k, Senate +$15k, VP +$25k, President +$50k, House +$5k, State Senate +$3k
- **Decreased by**: Ads, Build Donor Base, polls, NPP influence, party taxes, personal campaign donations
- **Used for**: All campaign activities and actions with fund costs
- **Note**: Separate from Cash on Hand - the two pools do not mix

### Cash on Hand

- **Starting Value**: 0 (earned separately from Campaign Funds)
- **Increased by**: Passive income streams, personal campaign donations (50% of amount converts to Cash on Hand)
- **Decreased by**: Wire Transfers to other politicians
- **Used for**: Investments, transfers, sponsored posts, and conversion into campaign funds where the relevant surface allows it
- **Note**: Cross-country transfers are blocked; you can only wire to politicians in your own country

### Actions

- **Base per Turn**: 4
- **Office Bonus**: House +1, State Senate +1, Senate +2, Governor +2, Vice President +2, President +4
- **Starting Bonus**: 25 one-time grant on character creation
- **Regeneration**: Actions accumulate each turn (base + office bonus added to pool)
- **Cap**: 200 actions at Energy 1, rising to 250 at Energy 10 (`src/lib/stats/statsConstants.ts`)
- **Hoarding Penalty**: -4/turn when holding more than the hoard threshold, 100 at Energy 1 rising to 125 at Energy 10 (applied before refresh)

### Party Influence

- **Scale**: 0-100
- **Starting Value**: 0 (only applies to party members; independents always 0)
- **Increased by**: Turns spent in a party with active contributions; accrues each turn based on party investment
- **Decreased by**: Inactivity within the party; leaving and rejoining resets it
- **Affects**: Share of the party's **bonus action pool** distributed each turn. Members with higher party influence receive proportionally more bonus actions (up to a configurable cap per turn).
- **Closeness modifier**: Alignment between your policy positions and the party's official economic/social positions amplifies your effective share. Members ideologically close to the party platform extract more value from the same raw influence score.
- **View**: Shown on your profile page under Party Standing; also in the Party Members table on the party page

### Donor Base Level

- **Scale**: Uncapped (starts at 1 for new characters)
- **Increased by**: Build Donor Network action
- **Fund cost to increase**: ₳3,000 + ₳1,500 × current level, scaled by state GDP per capita
- **Action cost to increase**: 4 to 20, following the donor-level cost curve
- **Income**: Per-turn fund generation includes donor bonus (scaled by state population tier)
  - Small state (<2M): +$500/hr per level
  - Medium (2-8M): +$1,000/hr per level
  - Large (8-20M): +$2,000/hr per level
  - Mega (>20M): +$4,000/hr per level

---

## Available Actions

### Standard Campaign Actions

| Action                         | Actions | Funds                         | Effect                                                     |
| ------------------------------ | ------- | ----------------------------- | ---------------------------------------------------------- |
| **Campaign**                   | 1 to 5  | GDP-scaled campaign cost      | PI gain starts at +1 and diminishes above 50               |
| **Fundraise**                  | 3       | Earns a dynamic quoted amount | Yield uses donor level, PI, Fundraising stat, and currency |
| **Run Advertisements**         | 5 to 9  | GDP-scaled campaign cost      | +1-3 Favorability (diminishing above 70%)                  |
| **Build Donor Network**        | 4 to 20 | GDP-scaled level cost         | +1 Donor Base Level                                        |
| **Quick Poll**                 | 2       | −$25,000                      | Topline appeal + best/worst 5 groups                       |
| **Full Demographic Poll**      | 6       | −$75,000                      | Complete breakdown by demographic category                 |
| **Post news (player feed)**    | 0       | -                             | Free article on `/news`; 12-hour cooldown per author       |
| **Sponsored news post**        | 5       | −$100,000 **personal cash**   | Paid placement on `/news`; 30-minute cooldown per author   |
| **Personal Campaign Donation** | 2       | Converts chosen Cash on Hand  | 50% of amount → Campaign Funds; Infamy scales with size    |
| **Rest**                       | 0       | -                             | No effect                                                  |

### Out-of-State Multipliers

- Home state: **1.0×**
- Neighboring state: **1.25×**
- Non-neighboring state: **1.5×**

Applies to the action cost of Support and Attack. Campaign and Advertise use GDP-based fund scaling instead.

---

### Interpersonal Actions (on other politicians)

These actions target another player character or NPP. They are taken from the target's profile page and use `src/lib/influence/simpleInfluence.ts`. Cross-country actions are blocked.

| Action        | Actions | Funds     | Effect on Target                                             | Effect on You       |
| ------------- | ------- | --------- | ------------------------------------------------------------ | ------------------- |
| **Support**   | Quote   | Quote     | +1% Favorability, subject to the per-target swing cap        | -                   |
| **Attack**    | Quote   | Quote     | −1% Favorability (fails if roll < Infamy × 10)               | +2% Infamy (always) |
| **Barnstorm** | Quote   | Quote     | +1% Political Influence (+2% if target's home state matches) | -                   |

Costs are not flat. Each is priced from the equivalent self-action quote (`src/lib/influence/rules.ts`): Support from an Advertise quote with a 1.25x premium, Attack with a 1.5x premium, and Barnstorm from a Campaign quote with a 1.25x premium. Action points round down and funds round to the nearest unit.

**Support/Attack notes:**

- The action cost also scales with state proximity (see Out-of-State Multipliers above)
- Even a failed attack costs you 2 Infamy
- Attacking high-Infamy players is safer (their attack-failure chance is the one that matters, not yours - but your Infamy affects _your_ attacks)
- You cannot Support or Attack yourself

**Barnstorm notes:**

- Ignores out-of-state multipliers; the price does not depend on the target's location
- The +2% bonus applies when your home state matches the **target's** home state
- Useful for helping allies build influence before an election

---

### Presidential Travel (general election only)

Available to active candidates in a presidential election during the general phase.

| Action     | Actions | Funds | Effect                                                                                    |
| ---------- | ------- | ----- | ----------------------------------------------------------------------------------------- |
| **Travel** | 3 to 10 | -     | Cost follows the destination's electoral-vote band; earn +1 Favorability/turn while there |

- You can only travel to a **US state** (one at a time)
- Your travel state is displayed as a badge on the electoral map and candidate list so opponents can see where you're focusing
- Switching states costs another 3 to 10 actions based on the new destination
- Travel expires if you withdraw or the election ends

---

## NPP Direct Interaction Actions

From NPP profile pages (`/npp/[id]`), players can use the deterministic direct-interaction panel:

| Action                  | Actions | Campaign Funds | Relationship Gate | Effect                                  |
| ----------------------- | ------- | -------------- | ----------------- | --------------------------------------- |
| **Request Endorsement** | 6       | $0             | hidden 40-50      | NPP endorses your candidacy publicly    |
| **Private Meeting**     | 3       | $0             | -50               | +5 relationship                         |
| **Boost Favorability**  | 5       | $10,000        | none              | +3 favorability, +2 relationship        |
| **Reduce Favorability** | 5       | $10,000        | none              | -3 favorability, -2 relationship        |
| **Boost Influence**     | 6       | $20,000        | none              | +2 political influence, +2 relationship |
| **Reduce Influence**    | 6       | $20,000        | none              | -2 political influence, -2 relationship |

These actions are deterministic once their action/fund/relationship gates are met.

See [NPP System](./npp-system.md) for full documentation.

---

## Party-Level Actions

Party Chairs and Vice Chairs can use the **party action pool** to run influence operations targeting NPPs in their state (or nationally for National Chair). The action pool refills each turn based on party member contributions.

See [Political Parties](./parties.md) and [Party Building](./party-building.md) for details.

---

## Action Economy

- **Base per Turn**: 4 actions
- **Accumulation**: Unused actions carry over; cap 200 (250 at max Energy)
- **Hoarding Penalty**: −4/turn when over the hoard threshold, 100 (125 at max Energy) (encourages active play)
- **Initial Bonus**: 25 actions on character creation
- **Party Bonus**: Distributed each turn from the party influence pool - variable per member, up to a per-turn cap

**Strategic planning**: Expensive one-time costs (Build Donor Network, Barnstorm, Full Poll) reward saving actions over multiple turns. Office holders who bank actions can execute these more frequently.

---

## Related Documentation

- [Core Systems](./core-systems.md) - Turn structure, action refresh, office bonuses
- [Player Progression](./player-progression.md) - Career path, when each stat matters
- [NPP System](./npp-system.md) - NPP influence details, success formulas
- [Political Parties](./parties.md) - Party influence, action pool, bonus actions
- [Election Mechanics](./elections.md) - How PI, NPI, Favorability feed into vote calculations
