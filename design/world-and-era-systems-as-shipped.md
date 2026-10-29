# World and era systems as shipped

## Summary

The game world is wider than the set of countries a player can enter. Historical presets, the world-entity manifest, macro countries, spheres, and transition engines work together to keep the wider map economically and politically meaningful without pretending that every entity has the same simulation depth.

This page describes the current runtime model. For individual subsystems, see [Bloc alignment and spheres](bloc-alignment-and-spheres.md), [Statehood admission](statehood-admission.md), [One-party states](one-party-states-as-shipped.md), [Constitutional conventions](constitutional-convention.md), and [Conflict](conflict-system-as-shipped.md).

Player guide: this page has no single player wiki page; the player-facing country and era pages link here for the exact rules.

## Rules

### Presets are world starting conditions

`RESET_PRESETS` (`src/lib/constants/historicalSeats.ts`) currently exposes eight entries, six of them dated starts:

| Preset | Starting frame | Important distinction |
| --- | --- | --- |
| `1953-default` | Early Cold War | Broad historical roster, world transitions, and founding-phase support |
| `1979-default` | Late Cold War | Broad economy roster and Cold War political structures |
| `1991-default` | Post-Cold-War transition | Historical legislature and demographic anchors for supported countries |
| `2019-default` | Contemporary baseline | The default fallback when a world carries no explicit preset |
| `2023-default` | Recent US baseline | US 118th Congress data, with non-US systems falling back to their 2019 bundles where stated by the preset |
| `2027-default` | Five-country modern world | January 2027 projection with playable US, UK, Japan, Germany and China, using projected US congressional control and the latest completed national elections elsewhere |

Two additional reset modes provide clean-slate variants: `empty` (named "2019 Start Date - No NPPs", no seated officials, all seats vacant) and `2019-no-parties` (no NPPs and `deleteDefaultParties: true`). Both have an empty `countries` list. A preset is not merely a displayed year. It selects seat maps, election anchors, demographics, budgets, policy catalogs, currencies, and feature gates throughout bootstrap and turn processing.

The admin reset registry is the authority for selectable presets. Seed helpers must receive the selected preset or read it from `gameState`; silently assuming a contemporary bundle can contaminate a historical world. The one remaining fallback is `DEFAULT_SEED_PRESET = "2019-default"` in `src/lib/constants/seedPreset.ts`.

### Four simulation tiers

Every entity in the world manifest has one of four simulation tiers (`WorldSimulationTier` in `src/lib/world/worldEntityManifest.ts`):

| Tier | Meaning |
| --- | --- |
| `full-autonomous` | Backed by a deep country or macro-country simulation and able to operate independently |
| `sphere-macro` | Simulated primarily through sponsor, sphere, trade, and macro relationships |
| `background-macro` | A sovereign polity simulated only as a light background macro country, taken from the background roster (`src/lib/world/backgroundCountryRoster.ts`) when the alignment catalogue lacks it |
| `historical-presence` | Present for geography, recognition, history, and transition rules without a full country loop |

Tier is separate from player access. `legacyAccess` (`LegacyCountryAccess`) distinguishes `player`, `economy-preview`, `hidden`, and `config-fallback` access, while readiness records explain why an entity is or is not autonomous or playable. This prevents a map entity, an economy-preview country, and a player-enabled country from being treated as equivalent.

The static country configs (`status` in each `src/lib/countries/<id>/institutionsFacts.ts`) mark the United States, United Kingdom, Germany, Japan, Ireland, and China as `active`; other configured countries (for example Nigeria, Russia, France, Brazil) are `coming-soon`. Historical presets may register many more entities for economic, one-party, macro, or transition behavior. Country status and preset membership therefore answer different questions.

### The world manifest

`src/lib/world/worldEntityManifest.ts` assembles the preset-scoped world view. An entry can carry:

- sovereign, dependent, emergent, or dissolved status (`WorldEntityStatus`);
- parent and co-parent relationships;
- simulation tier and economic archetype (`market`, `planned`, `mixed`, `macro`, `none`);
- sphere sponsorship, alignment, integration, treaties, and treaty state (`none`, `proposed`, `active`, `suspended`);
- lifecycle windows and transition rule IDs;
- diplomatic recognition and United Nations lifecycle state;
- map feature IDs and exceptional territorial status;
- player and autonomous readiness (`ready` or `blocked`), including hard blockers and flavor gaps.

The 1953 registry is assembled from regional modules in `src/lib/world/registry/`. Tier 2 macro specifications live in `src/lib/world/macro/`; sphere mechanics live in `src/lib/world/spheres/`; sovereignty transitions live in `src/lib/world/transitions/`.

### Era progression

The live era is a decade bucket derived from the live in-game year, never from the seed preset string (`eraFromYear` in `src/lib/era/era.ts`). The year is clamped to `ERA_DOMAIN = { min: 1950, max: 2049 }`, `startYear = floor(year / 10) * 10`, id and label are `"{startYear}s"`, and `endYear = startYear + 9`.

When `eraSystemEnabled` is true, the era-crossing phase (`runEraCrossing`, `src/lib/turn/eraCrossing.ts`) fires when `currentYear % 10 === 0` and `currentYear > lastEraCrossedYear`. It stamps `currentEraId` and `lastEraCrossedYear` and posts one world-news item titled "The {era} Begin". If the feature is enabled in the middle of a decade, the marker quietly self-heals without a news item. No preset start year (1953, 1979, 1991, 2019) is divisible by ten, so nothing fires at bootstrap. Scoring never reads the stamp (it computes from the year), so a missed stamp cannot skew math.

Metric activation (`runMetricActivation`) uses the same conservative pattern. Its first enabled run records `lastMetricActivationYear` without dumping missed historical events into the news feed. Later year crossings publish only newly activated metric-catalog events, one post per activation event, also sent to the news webhook. Other systems, including military branches, technology lanes, election anchors, and catalog selection, read the live year or preset through their own explicit gates.

### Historical transitions

Historical outcomes are modeled as pressure and bounded windows where possible, not unconditional scripts.

**US statehood** (`src/lib/elections/statehoodAdmission.ts`, `src/lib/turn/statehood.ts`). In the 1953 preset, Alaska and Hawaii begin outside the apportionment map. Once per in-game year the statehood phase makes an iteration-keyed deterministic draw per pending territory.

- Window: `windowStartYear = 1950`, `windowEndYear = 1970`, `historicalYear = 1959` for both territories (`TERRITORY_ADMISSIONS`).
- Cumulative admission curve, with `ADMISSION_CDF_AT_HISTORICAL_YEAR = 0.5` and zero year `windowStartYear - 1 = 1949`:
  - before the window: 0; from `windowEndYear`: 1;
  - up to and including 1959: `0.5 * ((year - 1949) / 10)^2`;
  - after 1959: `0.5 + 0.5 * ((year - 1959) / 11)^0.7`, where `0.7` is `POST_WINDOW_RAMP_EXPONENT`.
- Yearly hazard: `(F(y) - F(y-1)) / (1 - F(y-1))`. A territory is admitted when `admissionRoll(stateId, year, iteration) < hazard`. The roll is `hash("statehood:{iteration}:{stateId}:{year}") / 2^32`, keyed on year (not turn), so a replayed turn cannot roll twice.
- Admission creates the state's political rows and gives it `INITIAL_HOUSE_SEATS_ON_ADMISSION = 1` House seat. The state document gets `admittedYear`. Later census processing reapportions the full House normally.

**Decolonization** (`src/lib/turn/decolonizationTurn.ts`). The phase evaluates the authored roster `DECOLONIZATION_ROSTER_RULE_IDS` once per in-game year, only when `currentTurn % TURNS_PER_YEAR === 0` (`TURNS_PER_YEAR = 48`, `src/lib/constants/calendar.ts`). It returns without work after `DECOLONIZATION_ERA_LAST_YEAR = 1980`, because the evaluator's prior for a year past a rule's window is 0.95 and would fire every rule at once. Applied rules are recorded in `appliedWorldTransitions` and skipped on later turns. One rule failing is caught and logged without stopping the rest. Pressures are left at their authored defaults: the evaluator's historical calendar and priors drive the timing.

**Regime and constitutional change.** One-party systems maintain their own stage and pressure state. Escalation, stabilization, collapse, and constitutional-convention paths can change runtime political structures instead of requiring a new seed. These paths are separate from ordinary election turnover and must preserve the country's historical and institutional context.

### Imperial characters

Imperial characters (`ImperialCharacter`, `src/lib/db/types/imperialCharacter.ts`) are economy-facing identities stored separately from ordinary political characters. Current UK and Japan setups use them for ceremonial monarchs who cannot stand in elections, hold elected office, or vote on legislation. They can manage their associated corporation and participate in financial systems such as dividends, bonds, portfolios, and foreign exchange. Which countries have the role is set by the country config (`isImperialCountry`, `imperialTitles`, `imperialCorporation`, `imperialSharedWith` in `src/lib/constants/countries`, used by `src/lib/imperial.ts`).

This separation is deliberate: the role can participate in the economy without acquiring the permissions of an elected politician.

### Operational rules for contributors

- Treat `gameState.preset` and the live year as explicit inputs. Do not infer them from the current production world.
- Check both country status and manifest readiness before exposing player access.
- Keep transition phases idempotent. Retried turns must not produce duplicate admissions, transitions, or news.
- Gate historical transition engines so later presets cannot replay obsolete events.
- Add a registry or manifest test when introducing a new entity, tier, lifecycle, or preset.
- Update the reset registry, seed selectors, election anchors, and documentation together when adding a preset.

### Source map

- `src/lib/constants/historicalSeats.ts`: selectable reset presets and historical seat bundles
- `src/lib/constants/seedPreset.ts`: explicit fallback preset
- `src/lib/world/worldEntityManifest.ts`: entity tier, access, lifecycle, recognition, and readiness model
- `src/lib/world/registry/`: regional 1953 entity registry
- `src/lib/world/macro/`: Tier 2 macro-country specifications
- `src/lib/world/spheres/`: sphere relationships and effects
- `src/lib/world/transitions/`: sovereignty transition rules and application
- `src/lib/era/era.ts`: decade era derivation
- `src/lib/turn/eraCrossing.ts`: decade markers and metric activation news
- `src/lib/turn/decolonizationTurn.ts`: annual gated decolonization phase
- `src/lib/elections/statehoodAdmission.ts`: statehood probability model
- `src/lib/turn/statehood.ts`: runtime admission writes
- `src/lib/db/types/imperialCharacter.ts`: imperial-character domain type
- `src/lib/world/backgroundCountryRoster.ts`: background-macro roster

## Data

| Collection or field | Read or written | Notes |
| --- | --- | --- |
| `gameState.preset` | read | Selects seat maps, anchors, catalogs. Never inferred |
| `gameState.eraSystemEnabled` | read | Gates era crossing and metric activation |
| `gameState.currentYear`, `currentEraId`, `lastEraCrossedYear`, `lastMetricActivationYear` | read and written | Era marker. `currentEraId` is shown in the admin panel and flags route |
| `gameState.lastStatehoodYear`, `gameState.iteration` | read, `lastStatehoodYear` written | Once-per-year guard and the roll key |
| `states` (`admittedYear`) | written on admission | Read by every statehood gate through `admittedStateIdsAsOf` |
| `appliedWorldTransitions` | written | `_id` is the rule ID; fields `ruleId`, `turn`, `year`, `appliedAt`. Decolonization idempotency record |
| News posts | written | Decade begins, newly activated metrics, state admissions. Player-visible |
| Imperial characters collection | read and written by economy systems | Separate from `characters`. Profile is player-visible |

The world manifest itself is computed from code at request time and is not stored.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `gameState.preset` | none; callers fall back to `DEFAULT_SEED_PRESET = "2019-default"` | `src/lib/constants/seedPreset.ts`; chosen at world reset from `RESET_PRESETS` |
| `eraSystemEnabled` | off when unset | `GameState` (`src/lib/db/types/gameState.ts`), toggled by admin. While off, era-aware systems keep legacy behavior |
| `DECOLONIZATION_ERA_LAST_YEAR` | 1980 | `src/lib/turn/decolonizationTurn.ts` |
| `TERRITORY_ADMISSIONS` windows | 1950 to 1970, median 1959 | `src/lib/elections/statehoodAdmission.ts` |
| `POST_WINDOW_RAMP_EXPONENT` | 0.7 | `src/lib/elections/statehoodAdmission.ts` |
| `INITIAL_HOUSE_SEATS_ON_ADMISSION` | 1 | `src/lib/elections/statehoodAdmission.ts` |
| `ERA_DOMAIN` | 1950 to 2049 | `src/lib/era/era.ts` |
| Country `status` | `active` for US, UK, DE, JP, IE, CN | each `src/lib/countries/<id>/institutionsFacts.ts` |

The earlier text of this page said decolonization runs only when a `worldTransitionsEnabled` flag is true. No such flag exists in the code: the phase is gated only by the year boundary, the 1980 cutoff, and the applied-rules record.

## Timing

Turn phases run in the turn registry (`src/simulation/phases/turnPhaseRegistry.ts`, `src/simulation/phases/stateEffectsPhase.ts`). The authoritative turn-context year is used, not the persisted `gameState.currentYear`, which is only stamped at the end of a turn.

```
each turn:       eraCrossing (only acts in a year divisible by 10) -> metricActivation
once per year:   statehood (guard: year > lastStatehoodYear)
year boundary:   decolonization (turn % 48 == 0, year <= 1980)
```

The statehood, era crossing and metric activation calls sit in `stateEffectsPhase.ts`; the `decolonization` phase is registered in `turnPhaseRegistry.ts`.

## Worked trace

Alaska in a `1953-default` world, iteration key `I`, in year 1956 (`windowStart 1950`, `historical 1959`, `windowEnd 1970`).

1. Zero year is `1950 - 1 = 1949`. `F(1955) = 0.5 * (6/10)^2 = 0.5 * 0.36 = 0.18`.
2. `F(1956) = 0.5 * (7/10)^2 = 0.5 * 0.49 = 0.245`.
3. Hazard 1956 is `(0.245 - 0.18) / (1 - 0.18) = 0.065 / 0.82 = 0.0793`.
4. The roll is `hash("statehood:I:AK:1956") / 2^32`, a fixed value for that world and year. If it is below 0.0793, Alaska is admitted; otherwise it stays a territory and the year is stamped in `lastStatehoodYear`.
5. If it survives to 1959: `F(1958) = 0.5 * 0.81 = 0.405`, `F(1959) = 0.5`, hazard `0.095 / 0.595 = 0.1597`.
6. If it is still pending in 1960: `F(1960) = 0.5 + 0.5 * (1/11)^0.7 = 0.5 + 0.5 * 0.1867 = 0.5934`, hazard `0.0934 / 0.5 = 0.1867`.
7. On admission, the state gets `admittedYear`, political rows, and 1 House seat; a news item announces it.

Decade crossing: at turn 480 of a world that started in 1953 the year is 1963, so nothing fires. In 1970, `1970 % 10 = 0` and `1970 > lastEraCrossedYear` (for example 1960), so `currentEraId = "1970s"`, `lastEraCrossedYear = 1970`, and the news post "The 1970s Begin" is created once.

## Edge cases and limits

- **Eras outside 1950 to 2049** clamp to the domain edge.
- **A world that misses the historical year** still resolves: the post-1959 ramp climbs fast, and by `windowEndYear = 1970` the CDF is 1, so a pending territory is admitted by then.
- **Presets with Alaska and Hawaii already on the apportionment map** (`pendingTerritories` excludes territories present in the preset's seat map) never evaluate them.
- **Decolonization after 1980** is skipped entirely, so modern presets never replay the colonial roster.
- **Missing year**: era crossing, metric activation and decolonization return without work when the year is not finite.
- **Enabling the era system mid-decade** stamps the marker without news.
- **Empty and no-parties modes** carry no country bundle; their content comes from the base seed.
- **Imperial characters** cannot vote, stand or hold office by design.
- **Why tiers exist**: a deep simulation for every map entity would be unaffordable, and treating a light macro country like a playable one would hide real gaps.

## Invariants

- A decolonization rule applies at most once. Enforced by the `appliedWorldTransitions` upsert keyed on rule ID; tested in `src/lib/world/transitions/transitions.test.ts` and `roster.test.ts`.
- Statehood is deterministic per world, territory and year, and its median is the historical year. Enforced by the keyed roll and `ADMISSION_CDF_AT_HISTORICAL_YEAR`; `src/lib/elections/statehoodAdmission.test.ts` pins the historical year as the modal year.
- A decade announcement posts at most once per decade. Enforced by the `lastEraCrossedYear` comparison; tested in `src/lib/turn/eraCrossing.test.ts`.
- Every manifest entry carries a tier and readiness. Checked by `src/lib/world/worldEntityManifest.test.ts`, `src/lib/world/eraRosterInvariants.test.ts` and `src/lib/world/registry/coverage1953.test.ts`.
- Country status and manifest readiness agreeing is checked by `src/lib/world/countryReadinessContract.test.ts`.
- That seed helpers never silently assume a preset is by type (the `preset` argument is required), not by a runtime check.

## Failure and recovery

- **A transition rule throws**: logged, the rest of the roster continues, and the failed rule is retried on the next year boundary because it was not recorded as applied.
- **A world seeded with the wrong preset**: seed data from the wrong era (modern budgets in a historical world) is not detected at runtime; it is repaired by a reseed with the correct preset.
- **Era marker missing or stale**: repaired automatically by the mid-decade self-heal on the next turn when the era system is on.
- **Admission or transition applied wrongly**: repaired by a data heal on the affected state or applied-transitions record; clearing the record lets the rule run again.
- **A retried or replayed turn**: safe by design; the year-keyed roll and the applied records prevent duplicates.

## Connections

**Driven by**

- Reset presets chosen at world creation (`RESET_PRESETS`) and `gameState.preset`.
- The turn calendar (`TURNS_PER_YEAR`, the live year) through the phase registry.
- `eraSystemEnabled` and country `status` flags.

**Affects**

- [Bloc alignment and spheres](bloc-alignment-and-spheres.md): the manifest carries sponsor and alignment state; decolonization seeds macro countries with sphere relationships.
- [Statehood admission](statehood-admission.md): admission writes `admittedYear`, read by apportionment, seat creation, bootstrap officials and the election spawner through `admittedStateIdsAsOf`.
- [One-party states](one-party-states-as-shipped.md) and [Constitutional conventions](constitutional-convention.md): regime change paths alter runtime political structures.
- [Conflict](conflict-system-as-shipped.md): territorial status and recognition in the manifest.
- Economy systems (dividends, bonds, forex): imperial characters participate.
- World news: era crossings, metric activations and admissions post items.

## Tests

- `src/lib/turn/eraCrossing.test.ts`: decade crossing and metric activation.
- `src/lib/elections/statehoodAdmission.test.ts`, `src/lib/turn/statehood.test.ts`, `src/lib/elections/apportionmentStatehood.test.ts`, `src/lib/turn/perpetualElections.eraStatehood.test.ts`: statehood model, runtime writes and downstream gates.
- `src/lib/world/transitions/transitions.test.ts`, `roster.test.ts`, `dependencyRetirement.test.ts`: transition engine and roster.
- `src/lib/world/worldEntityManifest.test.ts`, `worldEntityMap.test.ts`, `backgroundCountryRoster.test.ts`, `backgroundMacroRoster.test.ts`, `eraRoster.test.ts`, `eraRosterInvariants.test.ts`, `eraContract.test.ts`, `countryReadinessContract.test.ts`, `releaseGate1953.test.ts`, `tier1ReadinessMatrix1953.test.ts`, `registry/coverage1953.test.ts`, `spheres/spheres.test.ts`.
- `src/lib/constants/historicalSeats.test.ts` (plus `.de.test.ts` and `.cn.test.ts`): preset seat bundles.
- `src/lib/imperial.test.ts`: imperial characters.
- Gaps: no test file is named for the decolonization phase wrapper itself (`decolonizationTurn.ts`, including the 1980 cutoff and year-boundary guard), and `RESET_PRESETS` membership as a whole has no dedicated test.

## Known issues and history

- Decolonization does not derive live pressure from sphere alignment or parent capacity yet; it relies on the authored calendar and priors (noted in the code as the natural next step).
- Before the decolonization phase was wired into the turn registry, the colonial map stayed frozen for a whole 1953 run. The phase now runs the roster annually.
- Before the statehood phase existed, Alaska and Hawaii stayed seatless under `1953-default`; the phase now admits them with a pressure model centred on 1959.
- The post-window ramp exponent was tuned to 0.7 rather than 0.5 because a square root made the year after the historical year the most likely admission year.
- A prior version of this page referred to a `worldTransitionsEnabled` flag that does not exist in the code.

Last checked: 2026-10-29, version 1.18.0
