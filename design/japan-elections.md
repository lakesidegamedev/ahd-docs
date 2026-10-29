# Japan - Elections & Bills

Technical rules for how Japan elects its Diet, how the Prime Minister can dissolve the lower house, and how a bill moves between the two chambers. Player guide: [Japan](https://www.ahousedividedgame.com/wiki/jp-overview). Country structure: [Japan](./japan.md).

## Rules

### Electoral System

Japan uses **Hare-quota proportional representation** (`pr_hareQuota`) for
Shūgiin, Sangiin, and Regional Council seats (`electionSystems` in `src/lib/countries/jp/institutionsFacts.ts`, and every era override under `src/lib/countries/jp/eras/`). A mixed-member system is not used for regular races. The 1991 world carries a frozen record of the pre-1994 multi-member law (`sntv-1991-v1`) that fixes its seat map, and a bill-gated 1994 reform to 300 district plus 200 list seats can replace it from 1994 on (`src/lib/countries/jp/rules/shugiinElectoralLaw.ts`). Some description strings in the country config still say "FPTP"; the electoral system key is what the engine reads.

Seat totals depend on the starting preset (`getJpShugiinSeats`, `getJpSangiinSeats` in `src/lib/countries/jp/data/jpSeats.ts`):

| Preset | Shūgiin | Sangiin | Coalition threshold | Source |
| --- | --- | --- | --- | --- |
| Modern default (2019 and later) | 465 | 248 | 233 | `jpSeats.ts`, `institutionsFacts.ts` |
| `1953-default` | 466 | 248 | 234 | `jpSeats.ts`, `eras/1953.ts` |
| `1991-default` | 512 | 252 | 233 | `jpSeats.ts`, `eras/1991.ts` |

### Election Types

#### Shugiin (House of Representatives)

- **465 seats** across 8 regions in the default setup; the 1953 start has 466 and the 1991 start has 512 (`src/lib/countries/jp/data/jpSeats.ts`)
- **Duration:** 192 hours (144h primary + 48h general), `DEFAULT_DURATIONS.shugiin` in `src/lib/constants/electionDurations.ts`
- **Term cycle:** 4 game years (192 turns; 48 turns per game year)
- All seats contested every cycle
- Can be dissolved via snap election

#### Sangiin (House of Councillors)

- **248 seats** across 8 regions in the default setup (252 in the 1991 start), split into 2 staggered classes
- **Duration:** 144 hours (72h primary + 72h general), `DEFAULT_DURATIONS.sangiin`
- **Term cycle:** 6 game years (288 turns) per class; half-elections every 3 game years (144 turns)
- Every region contests **both** classes. Class 1 seats = `ceil(regionSeats / 2)` (**125** total). Class 2 seats = `floor(regionSeats / 2)` (**123** total). Together they sum to 248 (`getJpSangiinClassSeats`). The 1991 map has all-even regional totals, so each class holds 126 of 252.
- Class 1 / Class 2 are not "some regions vs others." Hokkaido 4+3, Tohoku 10+10, Kanto 40+40, Chubu 22+22, Kansai 22+22, Chugoku 7+7, Shikoku 4+4, Kyushu 16+15.
- Cannot be dissolved - provides legislative continuity

#### Governor

- **1 per region** (8 total)
- **Duration:** 192 hours (144h primary + 48h general)
- **Term cycle:** 4 game years (192 turns)
- Uses generic `ensurePerpetualElections` path (same as US governors)

### Snap Elections

The PM can dissolve the Shugiin and trigger a snap election.

#### Snap rules

- **Who:** Sitting PM only
- **Limit:** 2 snap elections per PM appointment (`SNAP_ELECTION_LIMIT`, resets on new PM)
- **Cooldown:** 336 turns (`SNAP_ELECTION_COOLDOWN_TURNS`, 2 real-time weeks) between snap elections
- **Blocked while** a vote of no confidence is active
- Limit and cooldown are in `src/lib/turn/snapElection.ts`
- **Scope:** Shugiin only - Sangiin is unaffected
- **Duration:** 48 hours (24h primary + 24h general)
- **Election type:** `"snap_shugiin"` (distinct from regular `"shugiin"`)

#### Effects

- All active/upcoming regular Shugiin elections and Shugiin by-elections are cancelled, and their candidates withdrawn
- Fresh snap elections spawn for all 8 regions
- After resolution, the next regular Shūgiin cycle is anchored at the snap election's end turn plus 192 turns
- In-progress Shūgiin bills are failed. Sangiin-origin, Cabinet-review, and enrolled bills are preserved.
- Government resets to "pending" - new PM appointment process begins

#### Tracking

- `snapElectionsUsed: number` on GovernmentFormation document
- `lastSnapElectionTurn: number | null` on GovernmentFormation document
- Both reset when a new PM is appointed

#### API

- `POST /api/country/[code]/pm/snap-election` - PM-only, config-gated via `snapElectionsAllowed`

### Major Party Spoiler Modeling

Vote accumulation still uses configured major-party sets when applying spoiler
redistribution before PR allocation:

- **Kansai (KNS):** `{ ishin, ldp }` - Nippon Ishin dominates as opposition
- **All other regions:** `{ ldp, cdp }` - from `COUNTRY_CONFIGS.JP.majorPartyIds`

### Government Formation

Parliamentary system matching the UK pattern:

1. Post-election: largest party leader nominated as PM
2. PM appointment vote in Shugiin (lower house only)
3. Coalition negotiation if no majority (`coalitionThreshold` 233 for the modern preset, `src/lib/countries/jp/institutionsFacts.ts`)
4. Minority government attempt if no coalition
5. No-confidence vote handling (48-turn cooldown, `NO_CONFIDENCE_COOLDOWN_TURNS` in `src/lib/constants/governmentFormation.ts`)

If no PM is appointed within 96 turns of the government entering "pending" (`PM_VACANCY_DEADLINE_TURNS` in `src/lib/constants/turnTime.ts`), an automatic snap election fires with limits bypassed.

### Bills - Bicameral Lifecycle

#### Diet Bill Flow

```
Cabinet-origin:
  "cabinet_review" → "active" (Shugiin) → "active_other" (Sangiin) → "signed"
                                                 ↓ reject
                                           "override_shugiin" → "signed" / "failed"

Shugiin-origin (Diet member):
  "active" (Shugiin) → "active_other" (Sangiin) → "signed"
                              ↓ reject
                        "override_shugiin" → "signed" / "failed"

Sangiin-origin (Diet member):
  "active" (Sangiin) → "active_other" (Shugiin) → "signed"
                               ↓ reject
                            "failed"   (no override - Shugiin supremacy)
```

#### Key Differences from US System

- **No executive veto** - passage in both chambers = enacted immediately
- **Shugiin override** - if Sangiin rejects, Shugiin can override with 2/3 of votes cast. Every other vote (Cabinet, Shugiin, Sangiin) is a simple majority of votes cast. Each chamber vote lasts 24 hours (`VOTING_HOURS`). The whole lifecycle is frozen while the JP government is forming.
- Defined in `src/lib/countries/jp/elections/billLifecycle.ts` (`JP_NATIONAL_CONFIG`)
- **Chamber keys:** `"shugiin"` / `"sangiin"` (not `"house"` / `"senate"`)

#### Cabinet-Origin Bills

- PM or Cabinet members can propose bills through Cabinet review
- `"cabinet_review"` status with 24-hour vote duration (`CABINET_VOTE_DURATION_MS`, `src/app/api/country/[code]/legislature/cabinet-bills/route.ts`)
- PM + all player-held cabinet positions vote (simple majority of votes cast); proposing needs at least 2 distinct player-held positions including the PM
- NPP-held positions don't vote and don't count against threshold
- On pass: enters normal Shugiin → Sangiin cycle with `originChamber: "cabinet"`
- Limit: 1 cabinet bill in `"cabinet_review"` at a time per country
- Config-gated: `cabinetBillsEnabled: true` (only JP in v1)

#### Diet-Member Bills

Any seated Shūgiin or Sangiin member may propose a national bill.

- Proposals follow the shared Diet proposal form (category + 1-3 provisions), with the standard action-point and national-influence costs defined in `shared/constants/legislation.ts`.
- **Origin chamber** is the sponsor's own chamber - Shūgiin members originate in Shūgiin, Sangiin members originate in Sangiin.
- **Second chamber** is the opposing chamber. On passage there, the bill enacts (no executive signing step - Japan's parliamentary system has no PM signature).
- **Shūgiin supremacy on rejection:** if the second chamber rejects, behavior depends on origin:
  - Shūgiin-origin bills rejected by the Sangiin → Shūgiin 2/3 override vote.
  - Sangiin-origin bills rejected by the Shūgiin → fail outright; the Sangiin cannot override the Shūgiin.
- **Cabinet bills** continue to use the existing `cabinet_review` path (PM + ministers).

## Timing

- **Regular races** open and resolve in the country election phases `jpElections` (Shūgiin), `jpCouncillorElections` (Sangiin), `jpGovernorElections` and `jpRegionalCouncilElections` (names in `src/simulation/phases/countryElectionPhaseNames.ts`; spawners in `src/lib/countries/jp/elections/perpetual.ts`).
- **Snap elections** are triggered synchronously by the PM through the API (`POST /api/country/[code]/pm/snap-election`), or by the turn-phase vacancy watcher `processPMVacancyDeadlines` (`src/lib/turn/pmVacancyDeadline.ts`) once the 96-turn deadline passes. `triggerSnapElection` cancels the old races, fails Shūgiin bills, spawns the snap races and resets the government in one call.
- **Bills** advance in the `billLifecycle` turn phase (`src/simulation/phases/turnPhaseRegistry.ts`), which closes expired votes and moves each bill to its next status. Bills are frozen while the government is pending (`skipWhenGovPending`).
- After a snap, `planNextLowerChamberCycle` (`src/lib/elections/snapShift.ts`) anchors the next regular Shūgiin to the snap's end turn plus 192.

### Worked example

On turn 10,000 a PM with no previous snaps calls one. The snap lasts 48 turns, so primaries end on turn 10,024 and the general on 10,048. The next regular Shūgiin race is anchored to 10,048 + 192 = 10,240. `snapElectionsUsed` becomes 1 and `lastSnapElectionTurn` is 10,000, so the next call is refused until turn 10,336 (336 turns later). That second call is the last one allowed for this appointment (limit 2).

## Edge cases and limits

- The Sangiin is never dissolved, and its half-election schedule is untouched by a Shūgiin snap.
- A snap does not fail Sangiin-origin, Cabinet-review or enrolled bills.
- A Sangiin-origin bill rejected by the Shūgiin fails outright; the Sangiin has no override, which is the Shūgiin supremacy rule.
- Cabinet bills: only one in review per country at a time; NPP-held cabinet positions do not vote and do not raise the threshold; fewer than 2 player holders blocks a proposal. Cabinet bills are enabled only for Japan (`cabinetBillsEnabled`).
- Kansai's spoiler set is `{ishin, ldp}`; other regions use `majorPartyIds` (`ldp`, `cdp` modern; `ryo`, `jsp` in 1953).
- The Sangiin class split uses `ceil`/`floor`, never `ceil` for both, which would create phantom seats in Hokkaido and Kyushu.

## Connections

**Driven by:**
- [Parliamentary Government](./parliamentary-government.md): PM appointment, no-confidence and the vacancy deadline (`src/lib/turn/parliamentaryGovernment.ts`).
- [Snap Elections](./snap-elections.md): the shared trigger and limits (`src/lib/turn/snapElection.ts`).

**Affects:**
- [Bills and Legislation](./bills-legislation.md): in-progress Shūgiin bills fail on dissolution (`failInProgressBills`).
- [Government Approval](./government-approval.md): a new government clears the cabinet, which costs approval until seats are filled.
- [Live Election Results](./live-election-results.md): Shūgiin and snap Shūgiin results feed the national board.

Last checked: 2026-10-29, version 1.18.0
