# Min-Maxing Guide

Optimize every aspect of gameplay for maximum political impact. This guide covers advanced efficiency tactics for experienced players.

## Action Efficiency

You have limited actions each turn. Every action should produce maximum value.

### Action Priority by Phase

**Early Game (no office)**

1. Campaign - Build influence to 30%+
2. Fundraise - Build a war chest for ads
3. Poll - Understand your demographic appeal (do this once)

**Mid Game (holding House seat)**

1. Campaign - Maintain/grow influence
2. Run ads - Boost favorability in weak demographics before election season
3. Fundraise - Office income covers basics; fundraise for extra

**Late Game (Senate/Governor+)**

1. Strategic campaigning during election season only
2. Ads targeting swing demographics
3. NPP influence (if party chair/VC) - shape your competition

### The Influence Sweet Spot

- Influence decays by 0.75% of its current value per turn (`POLITICAL_INFLUENCE_DECAY_RATE` in `shared/constants/formulas.ts`), so the higher you are the more points you lose each turn. Example: at 80 you lose 0.6 points a turn, at 40 you lose 0.3
- Maintain 40-60% influence outside election season; surge to 80%+ during campaigns
- Don't waste actions maintaining 90%+ influence when no election is near

## Fund Optimization

### Income Maximization

- **Win office early** - Even a House seat gives $5k/hr passive
- **Low-tax party** - Consider party tax rates when choosing allegiance
- **Stacked bonuses** - Office bonus + donor level + state population tier

### Spending Efficiency

- **Don't hoard** - Funds don't compound; spend them on ads when elections are near
- **Batch ads and canvassing** - Spend them close to the vote. The campaign season doubling (final 4 turns before an election closes) applies to canvassing and to campaign passives such as media spending and opposition research, not to ads (see [Canvassing](./canvassing.md) and [Campaign Manager](./campaign-manager.md))
- **Target ROI demographics** - Ads on demographics close to your positions give better returns

## Position Optimization

You choose economic and social positions (-5 to +5) at character creation. They are not locked: voting on bills shifts them by 0.25 per vote in the direction of the bill (see [Player Progression](./player-progression.md)), so choose a starting point wisely:

### Safe Positions (broad appeal)

- Center-left (-2/-2) or center-right (+2/+2) - Appeal to the most demographics
- Match your party's median - Win primaries more easily

### Risky Positions (niche power)

- Extreme positions (-5/-5 or +5/+5) - Dominate aligned demographics but alienate others
- Only works in heavily-leaned states where your demographics are the majority

## State Selection

Your home state determines your entire career path:

### Optimal States

- **Swing states** - The closest states for the current era and lean (check the Lean map overlay, see [Map Services](./map-services.md)); elections are exciting but harder
- **Aligned states** - States matching your policy positions; easier to win but less competitive
- **High-population states** - Higher donor base for fundraising

### Avoid

- States where the opposite party has overwhelming lean (unless you join that party)
- Very small states (low donor base, few House seats)

## Election Timing

### When to Enter

- Enter primaries early to lock your slot before an NPP does. This does not stop NPP challengers: an NPP can still join an already filled primary with a base 15% chance per cycle, halved in countries with players (`src/lib/turn/npp/electionEntry.ts`; see [NPP Opponents](./npp-opponents.md))
- Don't enter too many races - Focus resources on one winnable race

### When to Campaign Hard

- Final 4 turns before the election closes - the campaign season multiplier is active for canvassing and campaign passives
- During primary only if contested - Save resources if you're unopposed

## Party Leadership Meta

Winning party chair/VC gives you NPP influence actions:

- **Clear your primary** - Use influence to withdraw NPP opponents
- **Stack endorsements** - Get NPPs to endorse you for vote boost
- **Deny opponents** - Oppose NPPs from endorsing your general election opponent

## Multi-Office Strategy

1. Start with House (easiest to win)
2. Build funds and influence with office bonuses
3. Run for Senate or Governor (statewide races)
4. If ambitious: Presidential run (requires national influence + party org)

## Related Pages

- [Campaign Strategy](./campaign-strategy.md) - Foundation strategy guide
- [Formula Deep-Dive](./formula-deep-dive.md) - Exact formulas for optimization
- [Demographics & Targeting](./demographics-targeting.md) - Voter group mechanics
- [State-Level Power](./state-level-power.md) - State office strategy
- [Meta Strategy](./meta-strategy.md) - Multi-player tactics

Last checked: 2026-10-29, version 1.18.0
