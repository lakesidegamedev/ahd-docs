# Global response crises (as shipped)

Release 1.3 replaces isolated historical crisis cards with a persistent international campaign layer. It sits between the ordinary `crises` decision system, the `livingConflicts` phase engine, shooting wars, Cold War tension, and national nuclear programs. The feature deliberately has no negotiation mini-game.

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

The ordinary crisis resolver remains the command boundary for submitting a response. This keeps treasury debits, expiry defaults, response idempotency, and role authorization in one path.

## Persistent state

Each `livingConflicts` row carries the phase state and an optional `campaign`. `normalizeCampaignState` is the compatibility seam for worlds created before campaign depth existed. The release seeding also writes normalized state onto legacy rows so live data does not depend on a later read to heal.

The campaign state contains:

- Stage: `posture`, `mobilization`, `operations`, `settlement`, or `aftermath`.
- Turns in stage and campaign cycle.
- Consequences: civilian strain, refugees, infrastructure damage, arms proliferation, regional spillover, casualties, and settlement momentum.
- Per-country memory: credibility, war weariness, military commitment, humanitarian commitment, covert exposure, last response id, last response turn, and last commitment kind.

`recordCampaignCommitment` rejects duplicate response ids. It changes only the responding country's memory. Consequence values and country-memory values are clamped from 0 to 100.

## Stage drift

`advanceCampaignTurn` applies slow motion between response windows:

| Stage | Per-turn drift |
| --- | --- |
| Posture | No automatic consequence change |
| Mobilization | Arms proliferation +0.4, regional spillover +0.2 |
| Operations | Civilian strain +0.7, refugees +0.4, infrastructure damage +0.45, casualties +0.6, regional spillover +0.25, settlement momentum +0.15 |
| Settlement | Civilian strain -0.35, refugees -0.15, settlement momentum +0.5 |
| Aftermath | Civilian strain -0.5, refugees -0.25, infrastructure damage -0.15, regional spillover -0.2, settlement momentum -0.25 |

Authored outcomes can move stages, begin a new cycle, or apply additional consequence deltas. Aftermath is therefore recovery state, not deletion of campaign history.

## Capability requirements and information

An authored option may require a stage plus minimum treasury as a share of GDP, military readiness, logistics, domestic support, or intelligence confidence. `assessCampaignRequirement` is shared by read and command paths. The server checks requirements again during submission, so stale client eligibility cannot authorize a response.

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

Discrete events apply immediate deltas and enter a 24-item ledger. Between events, `runTensionTurn` moves the value toward a standing floor. The floor is:

```text
12
+ min(30, Vietnam escalation level * 4)
+ min(12, active international response crisis count * 3)
+ min(18, sqrt(total world warheads) * 1.2)
+ wars
```

The wars term is zero with no active wars. Conventional wars add 0.12 times their summed intensity, capped at 45. If any war has nuclear-armed countries on opposing sides, the term starts at a minimum of 48 (so the floor reaches CRISIS before anything else is counted) and adds 0.15 times the nuclear war intensity plus 0.12 times the other war intensity, capped at 70. Long wars that stay below hot intensity can ease only to a residual danger floor (`src/lib/coldwar/tension.ts`).

The relaxation fraction is 0.08 per turn. If the value is at or below the floor, it moves straight to the floor. `src/lib/coldwar/dials.ts` derives the displayed DEFCON, strategic procurement multiplier, and detente goodwill penalty.

Global response outcomes call `applyTensionEvent`, so campaign decisions can raise or reduce the shared reading. The page shows the current reading, band, floor, direction, each floor component, derived dials, and recent event ledger.

## Nuclear integration

`src/lib/military/nuclearProgram.ts` owns the program tree. Device nodes are public tests and delivery nodes are quiet adoptions. The conventional `Nuclear Delivery` doctrine node gates program actions. Deterrence is zero without both warheads and at least one delivery node.

Nuclear mechanics connect to the crisis layer in three places:

1. A device test applies an immediate global-tension event.
2. Total world warheads raise the standing tension floor.
3. The `nuclear_incident` living conflict cannot open until `nuclearStandoffPossible` finds at least two credible programs. A calendar year alone cannot create a bilateral nuclear alert.

Warhead counts are game-scaled balance units, not literal historical inventories. `seedColdWarFoundations` inserts missing era-appropriate programs for the United States, Soviet Union or Russia, and United Kingdom. It sets production to zero, so later buildup remains a player budget decision. It also inserts or completes the `Nuclear Delivery` doctrine prerequisite where absent. Existing program rows are never overwritten.

## Seeding and release migration

Fresh worlds call `seedColdWarFoundations` after `initializeGameState`. Release 1.3 also runs the same seeding for existing worlds. The operation is idempotent and does the following:

- Enables `conflictsEnabled`, `coldWarEnabled`, and `livingConflictsEnabled`.
- Inserts one closed baseline row for every authored living-conflict definition that is missing.
- Completes missing campaign state on legacy conflict rows.
- Inserts missing era-scaled nuclear program rows without changing existing programs.
- Inserts or completes the nuclear doctrine prerequisite without replacing other doctrine choices or points.
- Inserts the `coldWarTension/current` row when absent, initialized at the arsenal pressure floor.

`DEFAULT_GAME_STATE_FLAGS.livingConflictsEnabled` is true, so later fresh worlds use the same release posture.

The player wiki source is `src/lib/seeds/wiki/content/globalResponseCrises.ts`.

## Vietnam compatibility

Vietnam remains the first full authored family. Its existing ladder is imported into the generic campaign state. The United States and Soviet Union receive independent country-scoped response windows. At the air campaign rung the engine can open a real North Vietnam versus South Vietnam conflict while the superpowers remain patrons. Dropping below that rung winds the front down, and reaching zero ends the family without allowing a restart.

Missed response windows resolve through the authored cautious default. An inactive office holder cannot freeze the campaign.
