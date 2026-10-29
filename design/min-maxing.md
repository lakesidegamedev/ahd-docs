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

- At high influence, 0.75% decay per turn (`shared/constants/formulas.ts`) means you lose more each turn
- Maintain 40-60% influence outside election season; surge to 80%+ during campaigns
- Don't waste actions maintaining 90%+ influence when no election is near

## Fund Optimization

### Income Maximization

- **Win office early** - Even a House seat gives $5k/hr passive
- **Low-tax party** - Consider party tax rates when choosing allegiance
- **Stacked bonuses** - Office bonus + donor level + state population tier

### Spending Efficiency

- **Don't hoard** - Funds don't compound; spend them on ads when elections are near
- **Batch ads** - Run ads in the 4 turns before an election (campaign season 2x multiplier)
- **Target ROI demographics** - Ads on demographics close to your positions give better returns

## Position Optimization

Your economic and social positions are set at character creation. Choose wisely:

### Safe Positions (broad appeal)

- Center-left (-2/-2) or center-right (+2/+2) - Appeal to the most demographics
- Match your party's median - Win primaries more easily

### Risky Positions (niche power)

- Extreme positions (-5/-5 or +5/+5) - Dominate aligned demographics but alienate others
- Only works in heavily-leaned states where your demographics are the majority

## State Selection

Your home state determines your entire career path:

### Optimal States

- **Swing states** (AZ, GA, MI, NH, NV, PA, WI) - Most competitive; elections are exciting but harder
- **Aligned states** - States matching your policy positions; easier to win but less competitive
- **High-population states** - Higher donor base for fundraising

### Avoid

- States where the opposite party has overwhelming lean (unless you join that party)
- Very small states (low donor base, few House seats)

## Election Timing

### When to Enter

- Enter primaries early - Discourages NPP entry (their entry chance halves)
- Don't enter too many races - Focus resources on one winnable race

### When to Campaign Hard

- 4 turns before election end - Campaign season multiplier is active
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
