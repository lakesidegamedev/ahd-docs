# Global response crises (as shipped)

Release 1.3 replaces isolated historical crisis cards with a persistent international campaign layer. It sits between the ordinary `crises` decision system, the `livingConflicts` phase engine, shooting wars, Cold War tension, and national nuclear programs. The feature deliberately has no negotiation mini-game.

Player guide: [Global Response Crises](https://www.ahousedividedgame.com/wiki/global-response-crises)

## Player surfaces

- `/world/conflicts` is the combined strategic board: global tension, response campaigns, the shooting-war register, and links to Command and Situation boards.
- `/world/crises` and action cards carry open response windows.
- The Defence Office carries conventional doctrine and the nuclear program.
- Wire events and news carry campaign openings, stage changes, outcomes, and nuclear tests.

The combined board does not render an empty world map when there are no shooting wars. Its tension scale, pressure floor, driver cards, consequence bars, intensity markers, lean bars, and summary counts all carry inline help.

The International Response Desk on `/world/conflicts` lists every active crisis carrying a `globalResponse` definition. These records are often stored with `scope: "country"` because each eligible government owns a separate national decision. The National label therefore describes response ownership, not geographic reach. The desk explains that distinction, shows turn progress and participating governments, and links into the full response page. Ordinary domestic crises without a global-response definition, such as a national industrial strike, remain on the crises and actions surfaces rather than appearing on the strategic world board.

## Module boundary

The deep module is `src/lib/livingConflict/`.

- `registry.ts` owns the authored campaign definitions.
- `engine.ts` owns the pure phase state machine.
- `driver.ts` owns persistence and one-turn advancement.
- `campaign.ts` owns campaign stages, country memory, capacity requirements, consequence drift, and commitment application.
- `globalResponse.ts` owns capability snapshots and player-facing briefing projection.
- `processTurn.ts` materializes response windows into the ordinary crisis system.
- `vietnamCompat.ts` migrates the legacy Vietnam ladder into the generic engine.
- `defs/` holds the authored families, registered in `registry.ts`: Vietnam, pandemic, Northern Ireland, transnational terrorism, Yugoslavia, Arab uprisings, global financial crisis, Russia-Ukraine, Berlin, Congo, Suez aftermath, oil disruption, and nuclear incident.

The ordinary crisis resolver remains the command boundary for submitting a response. This keeps treasury debits, expiry defaults, response idempotency, and role authorization in one path.

## Persistent state

Each `livingConflicts` row carries the phase state and an optional `campaign`. `normalizeCampaignState` is the compatibility seam for worlds created before campaign depth existed. The release seeding also writes normalized state onto legacy rows so live data does not depend on a later read to heal.

The campaign state contains:

- Stage: `posture`, `mobilization`, `operations`, `settlement`, or `aftermath`.
- Turns in stage and campaign cycle.
- Consequences: civilian strain, refugees, infrastructure damage, arms proliferation, regional spillover, casualties, and settlement momentum.
- Per-country memory: credibility, war weariness, military commitment, humanitarian commitment, covert exposure, last response id, last response turn, and last commitment kind.

`recordCampaignCommitment` rejects duplicate response ids. It changes only the responding country's memory, plus any consequence deltas the commitment carries. Consequence values and country-memory values are clamped from 0 to 100 and rounded to one decimal. Memory starts at credibility 50 and every other value 0.

What each memory value does to the numbers (`recordCampaignCommitment`, `src/lib/livingConflict/campaign.ts`):

| Memory | Moves by |
| --- | --- |
| Credibility | the commitment's `credibilityDelta` |
| War weariness | the commitment's `warWearinessDelta` |
| Military commitment | + `scale` when the commitment kind is military |
| Humanitarian commitment | + `scale` when the kind is humanitarian |
| Covert exposure | + `covertExposureRisk / 4` when the kind is covert |

Why: the memory makes a government's history count. Repeated military commitments build a different position from relief or staying out, and covert exposure is the pressure that later makes hidden moves public.

## Stage drift

`advanceCampaignTurn` applies slow motion between response windows:

| Stage | Per-turn drift |
| --- | --- |
| Posture | No automatic consequence change |
| Mobilization | Arms proliferation +0.4, regional spillover +0.2 |
| Operations | Civilian strain +0.7, refugees +0.4, infrastructure damage +0.45, casualties +0.6, regional spillover +0.25, settlement momentum +0.15 |
| Settlement | Civilian strain -0.35, refugees -0.15, settlement momentum +0.5 |
| Aftermath | Civilian strain -0.5, refugees -0.25, infrastructure damage -0.15, regional spillover -0.2, settlement momentum -0.25 |

Authored outcomes can move stages, begin a new cycle, or apply additional consequence deltas (`applyCampaignOutcome`). An outcome applies exactly once per resolution id, increments the cycle, and resets turns-in-stage when the stage changes. If the outcome names no next stage the stage is inferred: settlement momentum 80 or more from settlement goes to aftermath; momentum 55 or more goes to settlement; casualties 50 or more or arms proliferation 60 or more goes to operations; posture goes to mobilization. Aftermath is therefore recovery state, not deletion of campaign history.

**Worked example.** A campaign sits in Operations for 10 turns with nobody responding. Drift alone adds civilian strain +7.0, refugees +4.0, infrastructure damage +4.5, casualties +6.0, regional spillover +2.5 and settlement momentum +1.5. Casualties reach 50 after about 84 turns of Operations drift alone, so in practice outcomes and commitments, not drift, push a campaign between stages.

## Capability requirements and information

An authored option may require a stage plus minimum military readiness, logistics, domestic support (shown as domestic mandate), or intelligence confidence. Treasury is not a gate: response costs go through `spendFromTreasury`, which spends any surplus first and finances the rest as debt, so a cash-balance check would contradict the real payment path. Legacy crisis documents may still carry `minTreasuryPctGdp`, which is ignored. `assessCampaignRequirement` is shared by read and command paths. The server checks requirements again during submission, so stale client eligibility cannot authorize a response.

Briefings are asymmetric. `projectCampaignBriefing` uses the country's role, live capability snapshot, and campaign exposure to decide which intelligence notes and consequence detail it may see. Covert commitments raise `covertExposure`; they do not create a separate negotiation or secret-deal system.

## Global tension

`src/lib/coldwar/tension.ts` stores one `coldWarTension` row keyed `current`. The current value is 0 to 100, with bands:

| Range | Band |
| --- | --- |
| 0 to below 15 | Detente |
| 15 to below 35 | Calm |
| 35 to below 60 | Elevated |
| 60 to below 80 | Crisis |
| 80 to 100 | Brink |

Discrete events apply immediate deltas and enter a ledger that keeps the 24 newest items (`planTensionEvent`, `src/lib/coldwar/rules/tensionEvent.ts`). Between events, `runTensionTurn` moves the value toward a standing floor. The floor is:

```text
TENSION_BASELINE (12)
+ min(30, Vietnam escalation level * 4)
+ min(12, active international response crisis count * 3)
+ min(18, sqrt(total world warheads) * 1.2)
+ wars
```

The wars term is zero with no active wars. Conventional wars add `0.12` times their summed intensity, capped at 45. If any war has nuclear-armed countries on opposing sides (a country counts as nuclear-armed when its program holds at least one warhead), the term starts at a minimum of 48 (`NUCLEAR_WAR_MINIMUM_TENSION` 60 minus the baseline 12, so the floor reaches CRISIS before anything else is counted) and adds `0.15` times the nuclear war intensity plus `0.12` times the other war intensity, capped at 70. All of this is `tensionPressureBreakdown` in `src/lib/coldwar/tension.ts`.

Public alarm slowly normalizes around a long limited war (`warAcclimationMultiplier`). The reduction starts after `WAR_ACCLIMATION_GRACE_TURNS` = 12 turns below hot intensity, grows to at most `WAR_ACCLIMATION_MAX_REDUCTION` = 40% over another `WAR_ACCLIMATION_TURNS_TO_MAX` = 40 turns, and fades out as intensity climbs from `WAR_ACCLIMATION_FULL_INTENSITY` = 70 to `WAR_ACCLIMATION_HOT_INTENSITY` = 85 (at 85 or more there is no reduction). A nuclear-opponent war can ease only to a residual of `NUCLEAR_WAR_RESIDUAL_PRESSURE` = 30. The reduction changes pressure, never the war's combat intensity.

Declaring a war applies an immediate spike (`warDeclarationTensionDelta`): +20 for a war between nuclear-armed sides, +10 for any other interstate war, +5 for the rest.

The relaxation fraction is `TENSION_RELAXATION` = 0.08 of the gap to the floor per turn. If the value is at or below the floor, it moves straight to the floor (it never sits below the floor). Values are clamped 0 to 100 and rounded to one decimal.

`src/lib/coldwar/dials.ts` derives the displayed dials. From tension alone: DEFCON is 5 below 45, 4 from 45, 3 from 65, 2 from 85, and tension alone never reaches DEFCON 1; the procurement multiplier is `1 + max(0, tension - 12) * 0.005`; the detente goodwill penalty is `round(max(0, tension - 35) * 0.75)`. When the Vietnam ladder is also live, each dial takes the tighter of the two readings.

**Worked example.** The Vietnam ladder is at rung 3, 2 international response crises are open, the world holds 400 warheads, and there are no wars: the floor is 12 + 12 + 6 + min(18, 24) = 48. A reading of 70 relaxes to 70 + (48 - 70) x 0.08 = 68.2 next turn. Now add one fresh nuclear-opponent war at intensity 60 to a quiet world with 100 warheads: arsenal 12, wars min(70, 48 + 0.15 x 60) = 57, floor 12 + 12 + 57 = 81, which is Brink.

Global response outcomes call `applyTensionEvent` (`src/lib/livingConflict/globalResponse.ts`), so campaign decisions can raise or reduce the shared reading. A negative delta cannot push the value below the current standing floor (`minimumValue`): relief never crosses the floor, so a hot world never reads calm. Keyed events are applied once, so a retried outcome cannot duplicate or omit a shock. The page shows the current reading, band, floor, direction, each floor component, derived dials, and recent event ledger.

## Nuclear integration

`src/lib/military/nuclearProgram.ts` owns the program tree. Device nodes are public tests and delivery nodes are quiet adoptions. The conventional `Nuclear Delivery` doctrine node gates program actions. Deterrence is zero without both warheads and at least one delivery node.

Nuclear mechanics connect to the crisis layer in three places:

1. A device test applies an immediate global-tension event.
2. Total world warheads raise the standing tension floor.
3. The `nuclear_incident` living conflict cannot open until `nuclearStandoffPossible` finds at least two credible programs. A calendar year alone cannot create a bilateral nuclear alert.

Warhead counts are game-scaled balance units, not literal historical inventories. `seedColdWarFoundations` inserts missing era-appropriate programs for the United States, Soviet Union or Russia, and United Kingdom. It sets production to zero, so later buildup remains a player budget decision. It also inserts or completes the `Nuclear Delivery` doctrine prerequisite where absent. Existing program rows are never overwritten.

## Seeding

Fresh worlds call `seedColdWarFoundations` after `initializeGameState`. The operation is idempotent and guarantees that every world has:

- The conflict, cold war and living-conflict flags enabled. `DEFAULT_GAME_STATE_FLAGS.livingConflictsEnabled` is true (`src/lib/seeds/reference/featureFlagDefaults.ts`).
- One closed baseline row for every authored living-conflict definition.
- Complete campaign state on legacy conflict rows.
- Era-scaled nuclear program rows where missing, without changing existing programs.
- The nuclear doctrine prerequisite, without replacing other doctrine choices or points.
- A `coldWarTension/current` row, initialized at the arsenal pressure floor.

## Timing

The tension and campaign layers run in different parts of the hourly turn (`src/simulation/phases/turnPhaseNames.ts`):

1. `coldWarTension` runs near the start, right after the income tax bases and before `actionRefresh`. It reads standing pressure and relaxes the value toward the floor, so every later phase reads the current temperature. It is skipped when `coldWarEnabled` is not true, and a re-run of the same turn is a no-op.
2. `crisisTurn` runs in the effects group, after regional budgets and before `intelligenceTurn` and ministerial orders. It runs `processLivingConflictsTurn` (phase machine, campaign drift, window materialization) and resolves expired or answered global response windows, which can apply tension events.

Discrete tension events from outcomes land in `crisisTurn`, so the standing-floor relaxation sees them on the next turn's `coldWarTension` phase.

## Edge cases and limits

- Consequence and memory values clamp to 0 to 100; tension clamps to 0 to 100.
- A missed window resolves through the authored cautious default for that role, so the campaign never freezes. The window length is set per authored event (`windowTurns`, for example 24 for the Russia-Ukraine and Arab uprisings families).
- Only countries with a role in the campaign's `roleByCountry` map get a window. Other governments are bystanders and receive no decision, but still feel the shared tension reading.
- A duplicate response id is ignored, and an outcome applies once per resolution id.
- Legacy rows without campaign state are normalized on read, and seeding also writes the normalized state.
- Tension relief cannot cross the standing floor; a nuclear-opponent war holds the floor at CRISIS or higher while it burns.
- Nuclear alert campaigns need at least two credible programs (`nuclearStandoffPossible`), so a calendar year alone cannot create a standoff. Deterrence is zero without both warheads and a delivery node.
- Unknown or non-finite consequence values fall back to the range minimum.

## Connections

**Driven by:**

- [Conflict system](./conflict-system-as-shipped.md): active wars and their intensity feed the wars term of the floor via `src/lib/coldwar/standingPressure.ts`.
- [Crisis system](./crisis-system.md): response windows are ordinary crises, so submission, treasury debit and expiry go through the crisis resolver.
- [Defence procurement](./defence-procurement.md): nuclear programs and warhead stockpiles feed the arsenal term.

**Affects:**

- [Defence procurement](./defence-procurement.md): the tension reading sets the strategic procurement multiplier (`src/lib/coldwar/dials.ts`).
- [Conflict system](./conflict-system-as-shipped.md): campaign stage can open or wind down shooting wars (Vietnam at the air campaign rung).
- [National budget](./national-budget.md): response costs are spent from the treasury through `spendFromTreasury`, financed as debt when no surplus exists.

## Vietnam compatibility

Vietnam remains the first full authored family. Its existing ladder is imported into the generic campaign state. The United States and Soviet Union receive independent country-scoped response windows. At the air campaign rung the engine can open a real North Vietnam versus South Vietnam conflict while the superpowers remain patrons. Dropping below that rung winds the front down, and reaching zero ends the family without allowing a restart.

Missed response windows resolve through the authored cautious default. An inactive office holder cannot freeze the campaign.

Last checked: 2026-10-29, version 1.18.0
