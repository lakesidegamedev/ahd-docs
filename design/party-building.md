# Party Building

Player guide: [Party Organization](https://www.ahousedividedgame.com/wiki/party-organization)

Party building is the long-game layer behind elections, treasury, NPP bench
management, and internal faction power.

## Structure

Each party currently operates across:

- a **national organization**
- **state / regional chapters**
- elected **Chair**, **Vice Chair**, and **Treasurer** roles at both levels

## Organization

Party organization is a percentage (0 to 100) per state or region per party. It is derived from stored contribution units, not from a cap. Code: `src/lib/parties/rules/organizationBucket.ts`, constants in `src/lib/constants/partyOrg.ts`.

### What Org Does

- improves party election support in that geography
- gates local party capacity, such as NPP recruitment slots (2 / 3 / 4 / 6 at org 0 / 30 / 40 / 50, `RECRUITMENT_SLOT_TIERS` in `src/lib/npp/recruitment.ts`)
- interacts with treasury planning and growth decisions

### Share formula

Every region has a permanent Unaffiliated stake of `ORG_BUCKET_BASELINE_UNITS = 100` units that never decays and is always in the denominator.

`org% = party units / (100 + sum of all parties' units) x 100`

Because shares are proportional, adding one party's units slightly dilutes everyone else's percentage without removing any of their units. There is no per-state cap: the old "lean decides the cap" and "base plus seat share cap" models are gone.

### Growth

A successful Build Org click deposits `ORG_BUILD_UNITS_PER_CLICK = 1` unit and resets that party's decay clock in that region (`applyOrganizationBuild`). Each click costs both Political Strength and treasury cash:

| Input | Value | Source |
| --- | --- | --- |
| Base Political Strength cost | 1, rising with pressure up to a cap of 8 | `BUILD_ORG_BASE_PS_COST`, `PRESSURE_LADDER_MAX_COST` in `src/lib/politicalStrength/strengthConstants.ts` |
| Cash price | `round(rate x 0.075 x effective PS cost x size multiplier)` | `orgBuildCashPrice` in `src/lib/politicalStrength/buildOrgFunding.ts`, `ORG_BUILD_TREASURY_FRACTION` |
| Size multiplier | `sqrt(state population) / country mean`, clamped 0.5 to 2.0 | `orgBuildSizeMultiplier`, `ORG_BUILD_SIZE_MULTIPLIER_MIN/MAX` |
| Minimum treasury to click | 25% of the price | `ORG_BUILD_MIN_FUNDED_FRACTION` |

State parties pay from the state treasury, the national party from the national treasury. A refused click (no presence, no funds) costs nothing.

Worked example: a state party at 20 units in a region with no other party has `20 / 120 = 16.7%`. Ten more clicks give `30 / 130 = 23.1%`, not 26.7%, because the denominator grew too.

### Decay

A party with no Build Org click for `ORG_DECAY_GRACE_TURNS = 96` turns loses `ORG_UNIT_DECAY_RATE = 1%` of its units per turn (`applyOrganizationDecay`), a half-life of about 69 turns once decay starts. Units decay, not percentage points, so accumulated investment keeps its meaning. Decay runs in the `partyOrgTurn` phase.

### Presence

Building requires party presence in the region: at least one party player character or elected official there (a national officer can build into vacant states). With presence lost, `orgBuildingPercent` resets to 0 (`src/lib/partyBudgetGuards.ts`).

## Treasury

Party treasury is now more than a raw send / transfer wallet.

### Core Functions

- collect member tax
- collect NPP tax where applicable
- send funds to members
- transfer funds between national and state / regional chapters
- fund NPP management and party actions

### Treasury Planning

Current treasury surfaces support:

- reserve targets
- planning presets
- state-funding visibility
- override history

This makes party treasury a real leadership role rather than a passive balance
sheet.

## Leadership

Party leadership elections cover `Chair`, `Vice Chair`, and `Treasurer` at both
national and state / regional levels. The default voting window is **72 turns**
(`NATIONAL_ELECTION_DURATION_TURNS` / `ELECTION_DURATION_TURNS` = 72, about
72 real hours at the standard 1-turn-per-hour cadence). Founding-phase
elections use 12 turns. National parties can adopt a custom duration of
168-420 turns via committee proposal.

Role identities:

- `Chair` -> broad authority and political control
- `Vice Chair` -> assists with political management
- `Treasurer` -> planning, reserve posture, funding visibility, and treasury
  oversight

## NPP Building

Party-building now relies heavily on NPP systems.

### Recruitment

Parties can recruit new same-party NPP bench where recruitment rules allow.

### Management

Leadership can also shape the existing NPP bench through:

- favorability
- influence
- loyalty
- stubbornness / cooperation
- endorsements
- withdrawals
- Slate assignment

## Slate

Slate is now part of party building, not a future note.

It acts as the party's bench-management board:

- view relevant races by state / region
- assign players or same-party NPPs
- persist those assignments across cycles
- let local leadership coordinate local filing pressure

## Analytics

Party pages now include internal analytics surfaces.

Current intended uses:

- identify underbuilt states
- surface local and national discipline issues
- track Slate coverage and assignment trouble
- show caucus health on the national surface

## Caucuses

Caucuses are now part of the live party-building loop.

They give parties:

- internal factions
- caucus treasury
- caucus whip
- caucus chair elections
- relationship-driven NPP sub-blocs

## Coalitions

Coalitions are a parallel cross-party layer rather than a replacement for party
building, but coalition priorities and cohesion now sit adjacent to party
strategy.

## Timing

`partyOrgTurn` applies decay and settles org shares each turn. Build Org clicks happen at request time through the build-org routes (`src/app/api/country/[code]/region/[id]/party/[partyId]/build-org/route.ts`), so shares update immediately. Leadership elections resolve in `statePartyElections`, `nationalPartyElections` and `nationalCommitteeElections`, which run after `partyOrgTurn` and `partyTierTurn` and before `nppBehavior`. See [parties.md](./parties.md) for the full phase order.

## Edge cases and limits

- Leadership election length: 72 turns default, 12 in the founding phase, 168 to 420 custom (`src/lib/nationalPartyElectionConstants.ts`).
- Org percentage is rounded to a fixed precision and can never reach 100 because the Unaffiliated stake is permanent.
- Legacy rows that stored a plain percentage are converted to units at a regional scale capped at `ORG_LEGACY_UNITS_PER_PERCENT_MAX = 10`, and their decay clock starts at the current turn so deployment causes no cliff.
- A recruited NPP is never retired when org drops below a slot tier; the party just cannot recruit more until it is under the cap.
- A treasurer has planning access only; chairs and vice chairs keep emergency transfer access.

## Connections

**Driven by:**

- [Parties](./parties.md): treasury taxes and presence feed Build Org.
- Political Strength: spent on every Build Org click.

**Affects:**

- [Party influence](./party-influence.md): org tiers set NPP recruitment capacity.
- [Party slate](./party-slate.md): analytics find underbuilt states for slate coverage.
- [Caucuses](./caucuses.md) and [Coalitions](./coalitions.md): cross-cutting layers on the same parties.
- Elections: org share improves party support in the region.

## Related Docs

- [parties.md](./parties.md)
- [party-influence.md](./party-influence.md)
- [party-slate.md](./party-slate.md)
- [caucuses.md](./caucuses.md)
- [coalitions.md](./coalitions.md)

Last checked: 2026-10-29, version 1.18.0
