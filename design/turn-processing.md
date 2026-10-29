# Turn Processing Submodules

> Historical index. For the current registry, ordering, lock recovery, phase counts, and telemetry contract, use [The Turn Processor (as shipped)](../engineering/turn-processor-as-shipped.md).

The live turn is driven by `processTurn()` in `src/lib/turnSystem.ts` and entered through authenticated `GET /api/cron/turn`. It runs adapters from `src/simulation/phases/turnPhaseRegistry.ts`; each adapter calls individually named phases through the runtime wrapper in `src/simulation/engine/turnPhaseRuntime.ts`.

## Stable invariants

- Adapter order is load-bearing. Move a phase only after identifying every read-after-write dependency.
- Election resolution is strictly ordered: primary resolution, vote accumulation, spend reset, timer advancement, snapshots, general resolution, and office handoff cannot be freely parallelized.
- Fiscal-year processing uses each country's configured boundary, which is turn 40 for the current country configs.
- A phase failure is isolated and recorded. An error outside a phase can abort the turn.
- The processing lock, heartbeat, timeout, crash recovery, and final `turnLog` are part of the correctness contract.
- The cron route is `GET`, protected by a bearer-token secret.

## Where code lives

| Concern                         | Location                                      |
| ------------------------------- | --------------------------------------------- |
| Orchestrator                    | `src/lib/turnSystem.ts`                       |
| Adapter registry                | `src/simulation/phases/turnPhaseRegistry.ts`  |
| Phase runtime and telemetry     | `src/simulation/engine/turnPhaseRuntime.ts`   |
| Large state-effects adapter     | `src/simulation/phases/stateEffectsPhase.ts`  |
| Domain implementations          | `src/lib/turn/` and the owning domain modules |
| Per-country election phase list | `src/lib/turn/countryPhases.ts`               |
| HTTP entry                      | `src/app/api/cron/turn/route.ts`              |

Counts and exact membership change frequently. Do not copy a numbered phase list from an older design document into new code or operational runbooks; inspect the registry or the as-shipped page instead.
