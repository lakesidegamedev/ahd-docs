# Core Systems

The core loop is a persistent shared world. One real hour is one game turn and one turn advances the in-game calendar by roughly one week (about 7.6 days). Forty-eight turns make one game year.

## Actions and character resources

- Characters receive at least 4 base actions each turn.
- Office, cabinet, central-bank, party, and stat systems can add bonuses.
- Unused actions carry. The baseline cap is 200, with a 4-action hoarding penalty above 100; the Energy stat can adjust both thresholds.
- Political Influence decays by 0.75% of its current value each turn.
- National Political Influence gains current PI divided by 100 plus the strongest applicable office or leadership bonus.
- Infamy decays by 5% of its current value each turn.
- Favorability has natural downward pressure only above 60, in addition to attacks and Infamy effects.

See [Stats & Actions](./stats-actions.md) for the dynamic campaign, advertising, donor, polling, and travel costs.

## Elections

Election cadence is country and office specific. The scheduler in `src/lib/elections/canonicalCycle.ts` is authoritative; avoid treating one US term table as a universal clock.

The general-election accumulation weights are:

| Segment          | Share |
| ---------------- | ----: |
| Early pool       |   50% |
| General ramp     |   20% |
| Final four turns |   30% |

Unused actions are intentionally bankable, so saving for the closing sprint is a supported strategy rather than an exploit.

## Government and legislation

- Presidential systems elect a head of state directly and can include an executive signature, veto, and override stage.
- Parliamentary systems require lower-chamber confidence to seat the head of government. A pending government freezes ordinary legislation.
- One-party systems apply their own eligibility, leadership, and bill-lifecycle rules and can transition through the regime system.
- National bill routes are config-driven. Unicameral, sequential bicameral, and concurrent bicameral lifecycles all exist.

## Economy

Fresh worlds start with the full labour system and the plants market tier. Freight starts in shadow settlement mode: routes and Freight demand are calculated, but route limits do not cap corporate sales until an admin enables active settlement. Command-economy handling is enabled for countries and eras configured as planned economies.

The economy includes plants and capacity, commodities, labour and unions, logistics, national budgets, sovereign and corporate debt, banking, forex, central banks, nationalization, index funds, and world trade. Each feature's own as-shipped page is more reliable than old all-in-one phase tables.

## Turn processing

The hourly processor uses an ordered adapter registry and roughly 180 named phases. Most phase failures are isolated, recorded, and allowed to leave warnings while later phases continue. Locking and crash recovery prevent concurrent or blindly repeated turns.

See [The Turn Processor (as shipped)](../engineering/turn-processor-as-shipped.md) for the current registry and [Turn Processing Submodules](./turn-processing.md) for the stable entry points.
