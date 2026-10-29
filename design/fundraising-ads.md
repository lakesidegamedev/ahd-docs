# Fundraising & Ads

Campaign funds are the fuel for advertising and party operations. This guide covers how to generate funds, spend them effectively, and manage your campaign budget.

## Fund Generation

There are two related but distinct fund-generation mechanics: **personal character funds** (`src/lib/utils/fundGeneration.ts`) and **campaign funds** (`src/lib/campaigns/`). Neither has a per-demographic-group ad-targeting feature.

### Passive Income (personal funds)

Every turn, a character earns passive income based on:

- **State GDP scalar**, wealthier states raise more
- **Donor bonus**, scales with donor base level
- **Office bonus**, flat, per-hour, tied to the office actually held (`OFFICE_FUND_BONUS` in `fundGeneration.ts`):
  - House / Commons / Bundestag: +$5k/hr
  - State Senate / Landtag: +$3k/hr
  - Senate: +$15k/hr
  - Governor: +$15k/hr (same as Senate, not $20k)
  - Minister-President: +$15k/hr
  - Vice President: +$25k/hr
  - President / Prime Minister / Chancellor: +$50k/hr

### Campaign income (fundraisingLevel)

Separately, each campaign has a `fundraisingLevel` (0-10, legacy linear scale) or an unlocked Strategic Operations fundraising tree that determines **per-turn passive campaign income**, scaled by race type (president 1.0x baseline down to State Senate 0.2x). `FUNDRAISING_INCOME[0] = $20k/turn` (no upgrade) up to higher levels at higher investment; this is separate from, and stacks with, the personal office-bonus income above.

### Fundraise Action

The Fundraise action generates immediate funds:

- Base amount: `$50k + $2k × donorBaseLevel`, scaled by state PI/GDP
- Building the donor base (`Build Donor Network` action, one-time unlock per level, L0-L75) increases the yield of future Fundraise actions
- Consider opportunity cost vs. campaigning

## Party Tax System

Your party takes a tax on your income (0-33%):

- Tax rate set by party leadership
- Funds go to party treasury (national or state)
- Plan your budget around the tax cut
- Higher-level offices make tax less painful due to larger base income

## Advertising

### How Ads Work

- **Advertise ("Run Advertisements")**, Spend funds to boost favorability. There is **no audience-targeting**: the action is untargeted and moves the candidate's overall favorability, not a specific demographic group's approval.
- **Effect**: base +3 favorability (`advertiseFavorabilityGain()` in `src/lib/actions/rules.ts`), with diminishing returns above 70% favorability (−0.1 per point over 70, floored at 1), then scaled by the candidate's charisma multiplier (±20%)
- **Cost**: scales with current favorability (tier 0-4, base cost 5-9 action points) and state GDP per capita

### Media Spending (separate upgrade track)

Independent of the Advertise action, campaigns have a `mediaSpendingLevel` (or Strategic Operations media-spending tree) that is an **upgrade**, not a per-turn action: it pays a recurring passive favorability gain each turn (`getMediaFavPerTurn()`, `mediaSpendingLevel × 0.5` on the legacy linear scale, or the tree's Broadcast + Television magnitudes once unlocked). This is diminishing-returns-capped in aggregate by `PASSIVE_FAV_DIMINISH_THRESHOLD`/`RATE` so a maxed media stack cannot permanently pin favorability at 100.

### Ad Strategy

- **Advertise is a blunt instrument**, it raises overall favorability, not a specific group's approval. Targeting specific demographics happens through policy alignment and canvassing (see [Demographics & Targeting](./demographics-targeting.md)), not through ads.
- **Diminishing returns above 70% favorability** make late-game ad spending less efficient than early spending.
- **Match your positions**, policy alignment, not ad targeting, is what makes a candidate resonate with a given demographic group.

## Budget Management

The campaign page budget tab shows:

- **Income vs. spending** over time
- **Category breakdown**, Where your money is going
- **Per-turn rate**, Your net income after expenses and taxes

## Tips

1. **Fundraise early**, Build a war chest before election season
2. **Don't hoard**, Unspent funds don't compound; spend on ads when it matters
3. **Office income is king**, Winning even a House seat dramatically increases your income
4. **Watch party tax**, If your party has a high tax rate, factor it into your planning

## Related Pages

- [Campaign Strategy](./campaign-strategy.md), Overall campaign planning
- [Stats & Actions](./stats-actions.md), Action costs
- [Campaign Manager](./campaign-manager.md), Using the campaign page budget tab
