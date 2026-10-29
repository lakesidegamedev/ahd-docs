# Scenarios

A scenario is a starting world: a map, a cast of rival firms, a starting position and a world price history. Each has its own economic regions built from whole counties or districts. Regional figures are game estimates built on real census and statistical areas, not statistics. You pick one on the New game screen, or build your own in the scenario editor.

## Which scenario to start with

Start with **Great Lakes, 2000**. It has the fewest rivals (30), one currency, an ordinary economy and a plain start: a farm in central Ohio. The others add a sharper problem each: a bust you must see coming (Texas), a bubble and its crash (Silicon Valley), and several currencies (Ruhr and Rhine). All four are fully playable on every difficulty.

| | Great Lakes 2000 | Texas Oil Patch 1981 | Silicon Valley 1995 | Ruhr and Rhine 1991 |
| --- | --- | --- | --- | --- |
| Start year | 2000 | 1981 | 1995 | 1991 |
| Regions | 31 | 22 | 16 | 18 |
| States or countries | 8 states | 3 states | 1 state | 5 countries |
| Rival firms | 30 | 45 | 56 | 55 |
| You start with | A farm, central Ohio | Oil wells, Permian Basin | A chip and hardware maker, San Jose | A steel mill, the Ruhr |
| Currencies | US dollar | US dollar | US dollar | Mark, guilder, two francs |
| Default world price path | Historical | Historical with variance | Historical with variance | Historical |
| Feel | Steady, broad | Boom then bust | Bubble then crash | Complex, hawkish central bank |

Your starting capital depends on difficulty: $8,000,000 on Easy, $5,000,000 on Standard, $3,000,000 on Hard (see [Rivals](rivals.md) for what difficulty does to rivals). You cannot mix scenarios in one game.

## Great Lakes, 2000

Steel, autos and farms at the turn of the century, on stretched credit.

- Thirty-one regions across eight states around the Great Lakes and the Ohio Valley: Illinois, Indiana, Kentucky, Michigan, New York, Ohio, Pennsylvania and West Virginia, sized from the 2000 census.
- Each state has two specialised sector types whose plants use fewer inputs there, for example extraction and chemicals in West Virginia (see [Regions and labour](regions-and-labour.md)).
- Lake shipping links the ports (see [Freight](freight.md)).
- Default price path: Historical. Oil climbs to more than four times its starting price by the 2008 peak, then collapses.

## Texas Oil Patch, 1981

Oil at forty dollars a barrel, banks lending against every rig, and the 1982 bust a year away.

- Twenty-two regions across Texas, Oklahoma and Louisiana, from Houston and the Permian Basin to Cushing, New Orleans and Shreveport, sized from the 1980 census.
- Forty-five rival firms cover the oil chain: independent drillers, refiners, petrochemicals, savings and loans lending against rigs, farms and cattle, builders and carriers.
- Pipelines from the Permian and Cushing to the Gulf Coast exist on day one, run by rival carriers. Six Gulf ports are linked by sea and by gateway legs to the Atlantic, the Caribbean and the Mississippi.
- You start with oil wells in the Permian. Default price path: Historical with variance. Oil drifts down, then falls to just over a third of its starting price around the middle of the path.

## Silicon Valley, 1995

The web arrives. Chips, software and telecoms race for capital toward the dot-com peak and the crash after it.

- Sixteen regions built from whole California counties, from San Jose and San Francisco to Los Angeles, San Diego, Fresno and Redding, sized from 1995 Census estimates.
- Fifty-six rival firms cover chips and hardware, software, telecoms, defence and aerospace, studios, farms, banks and venture-style financiers, retail and construction.
- Five ports share a Pacific sea system with gateway legs to Asia and the Pacific and the Panama route. The Bakersfield pipeline to Los Angeles and Oakland exists on day one.
- You start with a chip and hardware maker in San Jose. Default price path: Historical with variance. A separate chips and electronics index slides, spikes around 2000 and then falls to about 56 percent of its start in the bust.

## Ruhr and Rhine, 1991

Germany has just reunified. Rebuild the east's industry, compete with western giants, and answer to a hawkish central bank guarding the Deutsche Mark.

- Eighteen regions across Germany (including the Ruhr, Hamburg, Munich and the new eastern states), the Netherlands, Belgium, Luxembourg and France (Lorraine and Alsace).
- The first scenario with more than one [currency](currencies.md): the Deutsche Mark, guilder, Belgian and Luxembourg franc and French franc, the last three pegged to the mark.
- Rhine barge, rail, road, the Rotterdam and Antwerp pipelines to the Ruhr and North Sea gateways connect the regions.
- Fifty-five rival firms cover coal, steel, chemicals, autos, engineering, utilities, banks and logistics.
- You start with a steel mill in the Ruhr. Default price path: Historical. Coal declines steadily to 70 percent of its start, steel dips then recovers, and the weaker pegs come under pressure in the 1992 to 1993 window (see [Governments and market laws](governments.md)).

## Scenario editor

The scenario editor, on the main menu, takes any built-in scenario and lets you change its numbers: starting capital, difficulty, the opening economy (historic, calm, boom or downturn), which rivals start and how big (a size percentage) and cash-rich (a cash percentage) they are, wage and demand levels in each region, the laws in force in week one (corporate tax, wage floor, merger review share and union law) and the world price path. Saved scenarios appear in the new-game picker beside the built-in ones, and every built-in scenario card has a Customize button.

World price paths work as described on [The commodity exchange](commodity-exchange.md).

## Where each system matters most

- Money across borders: [Currencies](currencies.md), Ruhr and Rhine only.
- Moving goods: [Freight](freight.md), strongest in Texas (pipelines) and Great Lakes (lake ports).
- Starting your group: [Your holding company](companies.md).
- The cycle, the bank and the parties: [Governments and market laws](governments.md).

Last checked: 2026-10-29, version 1.8.0

Sources: `content/scenarios.json`, `content/scenarios/*/regions.json`, `content/scenarios/*/firms.json`, `content/price-paths.json`, `crates/cw-data/src/lib.rs` (starting region and strategy, difficulty capital), `crates/cw-data/src/custom.rs` (editor fields). Regions, states and rival counts above are counts of entries in those files.
