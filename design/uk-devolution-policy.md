# UK Devolution Policy + Independence/Reunification Desire

**Status:** Proposal and implementation-history document. Devolved executive
offices have shipped, but policy details and open phase notes below are not a
current shipped-behavior specification.
**Depends on:** UK FM/Mayor wiring (Phases 1-4 of `uk-jp-devolved-executives.md`)

## Motivation

UK devolved-executive offices now exist mechanically (Phase 1+) and have
real elections + seated FMs (Phases 2-3). But the FM role currently has
no policy choices specific to the devolution question itself - the major
political axis that defines Scottish / Welsh / NI politics IRL.

This adds:

- A **Devolution** tab on the FM's office page (SCO/WAL/NIR only)
- A three-option Devolution Policy chosen by the FM
- A per-region **Independence Desire** metric (Reunification Desire for NIR)
- A turn-driven drift engine driven by FM policy + regional/national mood
- A soft electoral hook nudging vote share toward pro-independence parties
  when desire is high

## Scope decisions

| Decision           | Choice                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanic depth     | **Soft electoral hook** - metric drives vote-share nudge for pro-independence parties when high; a referendum trigger was deferred at the time (it has since shipped, see below) |
| Policy change cost | **2 Office AP + 72-turn cooldown**                                                                                                      |
| Tab scope          | SCO, WAL, NIR only (LON excluded - Mayor of London has no devolution axis)                                                              |

## Data model

### Per-region metric: `independenceDesire`

Stored as a single field on `StateMetrics` (or a sibling collection if
StateMetrics is full):

- 0-100 scale (UI label varies: "Independence" for SCO/WAL, "Reunification" for NIR)
- Defaults to 50 for any state without explicit seeding (neutral)
- Bounded `[0, 100]` after every drift

For NIR the same numeric field represents _Irish Reunification Desire_;
only the UI label differs. The engine math is identical.

### Per-FM-seat policy: `devolutionPolicy`

Stored on `governorOfficeState` (already a per-`(countryId, stateId)`
document):

- `"anti" | "pro" | "independence"` - three discrete options
- Default `"pro"` when unset (matches the historical baseline for most
  FM seats - devolved governance without explicit independence campaign)
- `devolutionPolicyChangedAtTurn?: number` - last-change turn for
  cooldown enforcement

In UI, NIR's `"independence"` option is labeled **"Irish Reunification"**;
SCO/WAL keep `"Independence"`. The stored enum value is the same.

## Seed defaults

### `independenceDesire` per (region, preset)

| Region | 1991 preset | 2019 preset | Rationale                                                                 |
| ------ | ----------- | ----------- | ------------------------------------------------------------------------- |
| SCO    | 25          | 45          | Pre-1997 referendum mood / post-Brexit SNP surge                          |
| WAL    | 10          | 25          | 1979 referendum failed badly / modest Plaid-led growth                    |
| NIR    | 30          | 40          | Catholic reunification at height of Troubles / Brexit + demographic shift |

### `devolutionPolicy` per (region, preset, seeded FM party)

| Region | 1991 (party) | 2019 (party) | Policy default                        |
| ------ | ------------ | ------------ | ------------------------------------- |
| SCO    | Labour       | SNP          | 1991: `"pro"`, 2019: `"independence"` |
| WAL    | Labour       | Labour       | both: `"pro"`                         |
| NIR    | UUP          | DUP          | both: `"anti"` (unionist)             |

## Engine: per-turn metric drift

Each turn `processIndependenceDesireDrift` applies a delta to the metric
for SCO/WAL/NIR. Drivers (additive):

| Driver                                                                                                | Range per turn   |
| ----------------------------------------------------------------------------------------------------- | ---------------- |
| **FM Devolution Policy**: anti = -0.04, pro = 0, independence = +0.05                                 | -0.04 to +0.05   |
| **Regional approval** (governor approval of that state): linear, 0.002/turn per full pp away from 50%, capped at 0.05 | -0.050 to +0.050 |
| &nbsp;&nbsp;&nbsp; e.g. 49% → +0.002, 30% → +0.040, 20% or lower → +0.050 (cap); 70% → -0.040, 80% or higher → -0.050          |                  |
| **National PM approval** (UK PM): same linear formula as regional approval                            | -0.050 to +0.050 |
| **National inflation**: >5% → +0.02; 2-5% → 0; <2% → -0.01                                            | -0.01 to +0.02   |
| **Mean-reversion toward 25**: 0.003/turn toward 25 (status-quo baseline)                              | -0.003 to +0.003 |

The approval drivers are **linear** and **capped**: contribution is
`sign(50 − approval) × floor(|50 − approval|) × 0.002` per turn, clamped to
±0.05 (`APPROVAL_DRIFT_PER_POINT` and `APPROVAL_DRIFT_CAP` in
`src/lib/governorOffice/devolution/rules.ts`), with fractional points
truncated toward zero (so 48.1 acts as 49).

Total range: roughly **-0.15 to +0.17/turn** at extremes.

**Long-run baseline:** mean reversion pulls toward 25, not 50. Without sustained pro-indy drivers, sentiment defaults to the established constitutional settlement (devolved governance without separatist momentum), not a perfectly balanced 50/50 split. The rate (0.003/turn) is intentionally small so this is a gentle floor pull, not a fast unwind.

**Pace calibration** (illustrative - actual paths depend on starting value):

- **Max-positive run** (Pro-Indy FM, both approvals at 0%, inflation above 5%): **+0.17/turn** → ~70 turns per 12 points of climb. Climbing from the 25 baseline to ~95 takes ~8.5 game-years (~2.1 FM terms), reachable only in deep-crisis conditions.
- **Plausible-positive run** (Pro-Indy FM, both approvals around 30%, high inflation): ~+0.15/turn → climbing 25 → 70 takes ~6.5 game-years (~1.7 FM terms) to cross the "possibility" threshold.
- **Mid-band run** (Pro-Indy FM, neutral approvals, moderate inflation): **~+0.05/turn**, but mean reversion (-0.003) means net ~+0.047/turn above 25. From the 25 baseline → 70 takes ~20 game-years - independence stays a marginal force without a crisis.
- **Max-suppression run** (Anti-Devolution FM, both approvals at 100%, inflation below 2%): **-0.15/turn** → drags down quickly until mean reversion flips positive below 25 and creates a soft floor.

A sustained pro-independence FM run paired with sub-50 governments is
needed for a generation before separation looks plausible - matching
the SNP / Plaid IRL arc.

## Soft electoral hook

When resolving general elections in SCO/WAL/NIR, two stacked effects apply:

### (a) Soft electoral transfer (vote-share redistribution)

Pro-indy party gets a bonus, unionist rivals split a matching penalty -
total votes preserved. Magnitude: `(desire - 50) * 0.001` per pro-indy
party (so at desire=100, +5pp bonus and split penalty to rivals). Capped
to ±5pp per party.

- SCO: SNP (uk_snp) gets bonus; Conservative penalised
- WAL: Plaid (uk_plaid) gets bonus; Conservative penalised
- NIR: Sinn Féin (uk_sf) gets bonus; DUP / UUP split the penalty

### (b) Pro-indy high-desire bonus (additive vote gain)

Stepped, vote-gain-only multiplier on the pro-indy party's votes when
desire ≥ 60. No rival penalty - total votes increase. Applied AFTER the
transfer above, multiplicatively per pro-indy candidate.

| Desire range | Bonus |
| ------------ | ----- |
| < 60         | 0     |
| 60-69        | +1.5% |
| 70-79        | +3.0% |
| 80-89        | +4.5% |
| 90-99        | +6.0% |
| 100          | +7.5% |

Bonus is region-locked: SNP only in SCO, Plaid only in WAL, SF only in
NIR. Applies to commons / snap_commons / regionalCouncil / governor.
Bands are strict - desire must reach the next full 10pp threshold before
the bonus steps up (48.1 acts as 49, 69 still gets +1.5%).

## UI: Devolution tab

New tab between Overview and Legislation in `GovernorOfficeClient`,
conditionally rendered only when `(countryId === "UK" && state ∈
{SCO, WAL, NIR})`.

Layout:

- **Metric card** at top: current `independenceDesire` with a sparkline
  of the last 24 turns (~half a game year)
- **Driver breakdown**: shows the current per-turn delta with each
  driver itemised ("Your Pro policy: +0.00/turn", "Regional approval at
  42%: +0.05/turn", "Inflation 4.2%: +0.10/turn", etc.) - so the FM
  understands _why_ the meter is moving
- **Policy selector**: three radio cards (Anti / Pro / Independence
  [or Reunification]), each with an LARP blurb. Selecting one costs 2
  Office AP and stamps `devolutionPolicyChangedAtTurn`. Disabled during
  cooldown.

## Phases

### Phase 1 - Data model + types 

- `StateMetrics`: add `independenceDesire?: number` field
- `governorOfficeState`: add `devolutionPolicy?: "anti" | "pro" | "independence"`,
  `devolutionPolicyChangedAtTurn?: number`
- New constants file `lib/constants/devolution.ts` for cost / cooldown /
  drift magnitudes
- Helper functions for region eligibility + label resolution

### Phase 2 - Seeding

- Seed `independenceDesire` per region per preset (table above)
- Seed `devolutionPolicy` defaults via `seedOfficeStates` (when creating
  a new `governorOfficeState` row for SCO/WAL/NIR, populate the policy
  from a small map per preset)

### Phase 3 - Turn engine: metric drift

- `processIndependenceDesireDrift(currentTurn)` turn phase
- Reads each SCO/WAL/NIR state metrics + governorOfficeState + national
  approval + inflation; writes new `independenceDesire`
- Logs per-driver attribution for telemetry / UI

### Phase 4 - UI: Devolution tab

- New `DevolutionTab.tsx` + selector modal
- New API endpoint `POST /api/country/uk/region/[id]/office/devolution-policy`
- Wire into `GovernorOfficeClient.TABS` conditionally

### Phase 5 - Soft electoral hook

- Hook into general election resolution to apply the vote-share nudge
  during SCO/WAL/NIR races. Capped magnitude to avoid pathological
  outcomes.

## Open questions (deferred)

- **Referendum trigger** - resolved after this proposal: referendum code now exists and uses `independenceDesire` (`src/lib/referendum/`).
- **Per-policy LARP blurbs** - final copy will live in the
  `DevolutionTab.tsx` component; placeholders for now.
- **UI label override for NIR** - `getDevolutionLabel(stateId, policy)`
  returns `"Irish Reunification"` for NIR + `"independence"` policy; the
  rest are stateId-agnostic.
