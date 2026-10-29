# The freight network

Freight is lane capacity. Goods move between regions by truck, rail, pipeline and ship, and every cross-region purchase on the [commodity exchange](commodity-exchange.md) pays a freight charge on top of the seller's price. Owning carriers cuts your own freight bill to 65 percent of the base rate and earns money from rivals. Reserving lanes can lock rivals out. Either way, freight decides which suppliers you can afford.

## How it works

A **lane** is a pair of regions in one mode. A **carrier** is a logistics division that runs a mode. The lots a carrier made last week, counted over a 400 km reference haul, are its capacity this week, and that capacity is spread over the lanes it serves.

When a shipment is needed, the engine:

1. Looks at the division's shipping policy (cheapest by default).
2. Builds routes of one to three legs through hubs. A change of mode at a hub adds a week.
3. Prices each lane. Your own carriers come first, at cost. Then lanes you hold contracts on. Then other firms' carriers at a rate that rises as the lane fills. Outside carriers take whatever is left at a premium, so goods never stop. Pipelines have no outside carriers: a shipment either fits or has to take another mode.
4. Charges the shipper once. The shipper's cash pays exactly what carriers receive.

### Modes

| Mode | Cost per lot per km | Speed (km a week) | Smallest load (lots) | Reach (km) | Needs | Carries |
| --- | --- | --- | --- | --- | --- | --- |
| Truck | 3 cents | 500 | 1 | 700 | Nothing; price moves with road condition | Dry, liquid, bulk, cold |
| Rail | 2 cents | 600 | 20 | 1,100 | Rail terminal at both ends | Dry, liquid, bulk, cold |
| Pipeline | 0.9 cents | 400 | 10 | Built lanes only | Built pipeline capacity on the lane | Liquids and gas only |
| Ship | 0.7 cents | 450 | 50 | Any distance on one sea system | Port at both ends | Dry, liquid, bulk |

Cold goods (food, livestock, pharmaceuticals) go by truck or rail only. Services are never shipped.

### Rates

All rates are shares of the mode's base rate above.

| Who carries | Rate |
| --- | --- |
| Your own carriers | 65 percent (cost) |
| Empty lane, other owners | 100 percent |
| Lane you hold a contract on | 90 percent of the spot rate, locked for the term |
| Full lane, other owners | 125 percent |
| Outside carriers | 125 percent |

An owner's price climbs along a smooth curve with the lane's fill: 100 percent at empty, about 106 percent at half full, 116 percent at 80 percent full, 125 percent when full. There is no cliff where owners meet the outside price.

**Worked example.** You ship 100 lots of steel 600 km. By truck, at the base rate that is 100 x 600 x 3 cents = $1,800, taking 2 weeks. By rail at the base rate it is 100 x 600 x 2 cents = $1,200, taking 1 week, but both ends need a rail terminal. On your own rail carrier it costs 65 percent of $1,200, $780. On an outside carrier it would cost 125 percent, $1,500. If a rival owns the rail lane and it is 80 percent full, you pay 116 percent, $1,392. Owning the carrier saves $720 on each such shipment against an outside carrier, and that saving is what a carrier plant has to repay.

## What you can do

- **Own carriers.** Build carrier divisions (Trucking, Full-Service, Freight Rail, Pipeline, Lake and Sea Shipping) in Command Center or on the region board. Rail terminals and ports are separate buildings, and one you build opens its region to every firm. Carriers that run under 85 percent full cut their run rate; carriers at 90 percent or more raise it.
- **Pick a shipping policy** per division: cheapest, fastest, own carriers first or most reliable, with an optional preferred mode or carrier. It governs the freight a division pays for, meaning goods arriving in its region. A division's Shipping summary shows the bill, the premium you paid to outside carriers, and the three costliest lanes.
- **Reserve a lane.** A lane contract reserves lots for 4 to 52 weeks at 90 percent of the spot rate, locked for the term. You can hold up to 80 percent of a lane. The fee is paid every week whether you use the lots or not, and you lose the contract if you cannot pay. Reserved lots are not for sale to anyone else, so a busy lane pushes rivals onto dearer routes. Rivals can do the same to you.
- **Read the alerts.** You are alerted only for lanes you ship on: a lane full for 4 weeks, a carrier rate rise of a fifth over 4 weeks, or a rival reserving a lane. The map's freight layer colours lanes by congestion.

Tips: a lane full for weeks is the best place to build a carrier; check the Shipping summary's suggestion before you do. Never reserve more than you will use, because the weekly fee runs even if you stop shipping.

## Connections

**Driven by**
- [Your holding company](companies.md): carrier divisions you own and the lane contracts you hold set what lanes cost.
- [Currencies](currencies.md): freight rates follow each country's money.
- [The commodity exchange](commodity-exchange.md): every cross-region purchase books lane demand.
- [Governments and market laws](governments.md): common carrier law caps owners' rates and contract shares.
- [Regions and labour](regions-and-labour.md): region distances, public terminals and ports, and road condition set lane lengths and truck prices.
- [Rivals](rivals.md): rivals build carriers on busy lanes and aggressive ones reserve lanes.
- [Scenarios](scenarios.md): each scenario's starting terminals, ports, sea systems and pipelines.

**Affects**
- [Regions and labour](regions-and-labour.md): rail terminals and ports you build open a region to every firm.
- [The commodity exchange](commodity-exchange.md): freight becomes part of the delivered price that ranks every offer.
- [Rivals](rivals.md): locking a rival out of a lane creates a grudge.
- [Your holding company](companies.md): owned logistics divisions take part of the division overhead off.
- [Currencies](currencies.md): freight crossing a currency line is converted at the day's rate.

## Status

Live in every scenario and difficulty. Which terminals, ports, sea systems and pipelines exist on day one depends on the scenario (see [Scenarios](scenarios.md)); Great Lakes has lake shipping, Texas has pipelines from the Permian and Cushing, Ruhr and Rhine has Rhine barges. Common carrier law applies only while a Workers' Party government is in power.

Last checked: 2026-10-29, version 1.8.0

Technical detail: every constant, formula and source file is in [Exact rules](#exact-rules) at the end of this page.

## Exact rules

Sources: `content/logistics.json`, `crates/cw-sim/src/economy/logistics.rs`, `crates/cw-sim/src/economy/pricing.rs`, `crates/cw-sim/src/economy/freight.rs`.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `own_cost_bps` | 6,500 | `content/logistics.json` |
| `empty_lane_bps` | 10,000 | `content/logistics.json` |
| `contract_discount_bps` | 9,000 | `content/logistics.json` |
| `outside_premium_bps` | 12,500 | `content/logistics.json` |
| `MAX_LEGS` | 3 | `logistics.rs` |
| `REF_KM` | 400 | `logistics.rs` |
| `MIN_CONTRACT_WEEKS`, `MAX_CONTRACT_WEEKS` | 4, 52 | `logistics.rs` |
| `MAX_CONTRACT_SHARE_BPS` | 8,000 | `logistics.rs` |
| `COMMON_CARRIER_CONTRACT_BPS` | 4,000 | `logistics.rs` |
| `COMMON_CARRIER_RATE_PCT` | 40 | `logistics.rs` |
| `CONGESTED_BPS` | 9,000 | `logistics.rs` |
| `SUSTAINED_WEEKS` | 4 | `logistics.rs` |
| `HIKE_BPS` | 2,000 | `logistics.rs` |
| `TRANSFER_WEEKS` | 1 | `logistics.rs` |
| `CARRIER_CUT_BPS` | 8,500 | `pricing.rs` |
| `CARRIER_RAISE_BPS` | 9,000 | `pricing.rs` |
| `CARRIER_OVERFLOW_BPS` | 4,000 | `pricing.rs` |
| Mode rates (milli-cents per lot-km) | truck 3,000, rail 2,000, pipeline 900, sea 700 | `content/logistics.json` |
| Speed (km a week) | truck 500, rail 600, pipeline 400, sea 450 | `content/logistics.json` |
| Smallest load (lots) | truck 1, rail 20, pipeline 10, sea 50 | `content/logistics.json` |
| Reach (km) | truck 700, rail 1,100, sea 100,000, pipeline 0 | `content/logistics.json` |
| Carrier lanes served | `MAX_SERVED = [10, 8, 1, 6]` by mode order | `logistics.rs` |

The rates in `content/logistics.json` are labelled authored engineering calibration, not real freight rates.

### Formulas

- Leg cost: `lots x km x rate_milli_cents x road x multiplier / (1,000 x 10,000 x 10,000)`, rounded half to even, where `road` is 10,000 except for road-sensitive modes (truck), and `multiplier` is the lane's rate in basis points of the base rate, carried to today's price level (`leg_cents`, `at_price_level`).
- Spot multiplier at fill `f` (0 to 10,000): `10,000 + (12,500 - 10,000) x f x f / 100,000,000` (`spot_mult_bps`).
- Transit weeks per leg: `ceil(km / speed)`, at least 1 (`leg_weeks`). A mode change at a hub adds `TRANSFER_WEEKS`.
- Common carrier cap: `10,000 + (12,500 - 10,000) x 40 / 100 = 11,000` (110 percent), also applied to contract rates, and contracts together may hold 40 percent of a lane instead of 80 (`regulated_cap_bps`, `contract_share_bps`).
- Contract rate: `spot x 9,000 / 10,000`, fixed for the term.
- Carrier planning (`pricing.rs`): fill is lot-km moved over capacity times the 400 km reference. Below 85 percent a carrier cuts its run rate, unless 40 percent or more of its lanes' lots went to outside carriers. From 90 percent it raises its run rate.

### Timing

Freight is charged during the weekly exchange clearing; the contract fee is paid at the opening of each week. Alerts and congestion flags are computed from the previous week's fill.

### Edge cases and limits

- Pipelines carry tank-class goods only; cold goods go by truck or rail only; a pipeline lane exists only where a firm has built capacity on it.
- Rail needs a terminal at both ends of a leg and sea needs a port at both ends on one sea system. Public terminals and ports come from the scenario (`public_rail`, `public_ports`, `sea_systems` in `logistics.json`).
- A shipper short of cash pays what it has and every receipt shrinks together.
- A contract holder that cannot pay the weekly fee loses the contract. You cannot reserve against your own group's carriers.
- Systemic disruptions (`crates/cw-sim/src/economy/systemic.rs`) include pipeline spills (a lane shut for 3 to 8 weeks), lane outages (1 to 4 weeks), port strikes (2 to 5 weeks) and refinery fires (8 to 16 weeks).
- Freight-related random events (bridge closure, freight congestion at 90 percent lane use) have a 26 week cooldown (`content/events/events.json`).
