# World and era systems as shipped

The game world is wider than the set of countries a player can enter. Historical presets, the world-entity manifest, macro countries, spheres, and transition engines work together to keep the wider map economically and politically meaningful without pretending that every entity has the same simulation depth.

This page describes the current runtime model. For individual subsystems, see [Bloc alignment and spheres](bloc-alignment-and-spheres.md), [Statehood admission](statehood-admission.md), [One-party states](one-party-states-as-shipped.md), [Constitutional conventions](constitutional-convention.md), and [Conflict](conflict-system-as-shipped.md).

## Presets are world starting conditions

`RESET_PRESETS` currently exposes six dated starts:

| Preset | Starting frame | Important distinction |
| --- | --- | --- |
| `1953-default` | Early Cold War | Broad historical roster, world transitions, and founding-phase support |
| `1979-default` | Late Cold War | Broad economy roster and Cold War political structures |
| `1991-default` | Post-Cold-War transition | Historical legislature and demographic anchors for supported countries |
| `2019-default` | Contemporary baseline | The default fallback when a world carries no explicit preset |
| `2023-default` | Recent US baseline | US 118th Congress data, with non-US systems falling back to their 2019 bundles where stated by the preset |
| `2027-default` | Five-country modern world | January 2027 projection with playable US, UK, Japan, Germany and China, using projected US congressional control and the latest completed national elections elsewhere |

Two additional reset modes, `empty` and `2019-no-parties`, provide clean-slate variants. A preset is not merely a displayed year. It selects seat maps, election anchors, demographics, budgets, policy catalogs, currencies, and feature gates throughout bootstrap and turn processing.

The admin reset registry is the authority for selectable presets. Seed helpers must receive the selected preset or read it from `gameState`; silently assuming a contemporary bundle can contaminate a historical world.

## Three simulation tiers

Every entity in the world manifest has one of three simulation tiers:

| Tier | Meaning |
| --- | --- |
| `full-autonomous` | Backed by a deep country or macro-country simulation and able to operate independently |
| `sphere-macro` | Simulated primarily through sponsor, sphere, trade, and macro relationships |
| `historical-presence` | Present for geography, recognition, history, and transition rules without a full country loop |

Tier is separate from player access. `legacyAccess` distinguishes `player`, `economy-preview`, `hidden`, and `config-fallback` access, while readiness records explain why an entity is or is not autonomous or playable. This prevents a map entity, an economy-preview country, and a player-enabled country from being treated as equivalent.

The current static country registry marks the United States, United Kingdom, Germany, Japan, Ireland, and China as active. Historical presets may register many more entities for economic, one-party, macro, or transition behavior. Country status and preset membership therefore answer different questions.

## The world manifest

`src/lib/world/worldEntityManifest.ts` assembles the preset-scoped world view. An entry can carry:

- sovereign, dependent, emergent, or dissolved status;
- parent and co-parent relationships;
- simulation tier and economic archetype;
- sphere sponsorship, alignment, integration, treaties, and treaty state;
- lifecycle windows and transition rule IDs;
- diplomatic recognition and United Nations lifecycle state;
- map feature IDs and exceptional territorial status;
- player and autonomous readiness, including hard blockers and flavor gaps.

The 1953 registry is assembled from regional modules in `src/lib/world/registry/`. Tier 2 macro specifications live in `src/lib/world/macro/`; sphere mechanics live in `src/lib/world/spheres/`; sovereignty transitions live in `src/lib/world/transitions/`.

## Era progression

The live calendar is derived from game time, not wall-clock time. When `eraSystemEnabled` is true, the era-crossing phase runs in the first week of years divisible by ten. It stamps the new decade and publishes a world-news item once. If the feature is enabled in the middle of a decade, the marker quietly self-heals without replaying old decade announcements.

Metric activation uses the same conservative pattern. Its first enabled run records the current year without dumping missed historical events into the news feed. Later year crossings publish only newly activated metric-catalog events. Other systems, including military branches, technology lanes, election anchors, and catalog selection, read the live year or preset through their own explicit gates.

## Historical transitions

Historical outcomes are modeled as pressure and bounded windows where possible, not unconditional scripts.

### US statehood

In the 1953 preset, Alaska and Hawaii begin outside the apportionment map. Once per in-game year, the statehood phase makes an iteration-keyed deterministic draw. Admission pressure runs from 1950 through 1970, with 1959 as the median rather than a guaranteed date. Admission creates the state's political rows and one-seat House floor; later census processing reapportions the full House normally.

### Decolonization

The decolonization phase evaluates its authored roster once per in-game year. It runs only when `worldTransitionsEnabled` is true and refuses to run after 1980, preventing a modern preset from replaying the entire colonial transition roster. Applied rules are recorded and skipped on later turns.

### Regime and constitutional change

One-party systems maintain their own stage and pressure state. Escalation, stabilization, collapse, and constitutional-convention paths can change runtime political structures instead of requiring a new seed. These paths are separate from ordinary election turnover and must preserve the country's historical and institutional context.

## Imperial characters

Imperial characters are economy-facing identities stored separately from ordinary political characters. Current UK and Japan setups use them for ceremonial monarchs who cannot stand in elections, hold elected office, or vote on legislation. They can manage their associated corporation and participate in financial systems such as dividends, bonds, portfolios, and foreign exchange.

This separation is deliberate: the role can participate in the economy without acquiring the permissions of an elected politician.

## Operational rules for contributors

- Treat `gameState.preset` and the live year as explicit inputs. Do not infer them from the current production world.
- Check both country status and manifest readiness before exposing player access.
- Keep transition phases idempotent. Retried turns must not produce duplicate admissions, transitions, or news.
- Gate historical transition engines so later presets cannot replay obsolete events.
- Add a registry or manifest test when introducing a new entity, tier, lifecycle, or preset.
- Update the reset registry, seed selectors, election anchors, and documentation together when adding a preset.

## Source map

- `src/lib/constants/historicalSeats.ts`: selectable reset presets and historical seat bundles
- `src/lib/constants/seedPreset.ts`: explicit fallback preset
- `src/lib/world/worldEntityManifest.ts`: entity tier, access, lifecycle, recognition, and readiness model
- `src/lib/world/registry/`: regional 1953 entity registry
- `src/lib/world/macro/`: Tier 2 macro-country specifications
- `src/lib/world/spheres/`: sphere relationships and effects
- `src/lib/world/transitions/`: sovereignty transition rules and application
- `src/lib/turn/eraCrossing.ts`: decade markers and metric activation news
- `src/lib/turn/decolonizationTurn.ts`: annual gated decolonization phase
- `src/lib/elections/statehoodAdmission.ts`: statehood probability model
- `src/lib/turn/statehood.ts`: runtime admission writes
- `src/lib/db/types/imperialCharacter.ts`: imperial-character domain type
