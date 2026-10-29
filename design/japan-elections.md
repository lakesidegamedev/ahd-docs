# Japan - Elections & Bills

## Electoral System

Japan uses **Hare-quota proportional representation** (`pr_hareQuota`) for
Shūgiin, Sangiin, and Regional Council seats. Mixed-member proportional
representation is not implemented.

## Election Types

### Shugiin (House of Representatives)

- **465 seats** across 8 regions in the default setup; the 1953 start has 466 and the 1991 start has 512 (`src/lib/countries/jp/eras/`)
- **Duration:** 192 hours (144h primary + 48h general)
- **Term cycle:** 4 game years (192 turns)
- All seats contested every cycle
- Can be dissolved via snap election

### Sangiin (House of Councillors)

- **248 seats** across 8 regions in the default setup (252 in the 1991 start), split into 2 staggered classes
- **Duration:** 144 hours (72h primary + 72h general)
- **Term cycle:** 6 game years (288 turns) per class; half-elections every 3 game years (144 turns)
- Every region contests **both** classes. Class 1 seats = `ceil(regionSeats / 2)` (**125** total). Class 2 seats = `floor(regionSeats / 2)` (**123** total). Together they sum to 248.
- Class 1 / Class 2 are not "some regions vs others." Hokkaido 4+3, Tohoku 10+10, Kanto 40+40, Chubu 22+22, Kansai 22+22, Chugoku 7+7, Shikoku 4+4, Kyushu 16+15.
- Cannot be dissolved - provides legislative continuity

### Governor

- **1 per region** (8 total)
- **Duration:** 192 hours (144h primary + 48h general)
- **Term cycle:** 4 game years (192 turns)
- Uses generic `ensurePerpetualElections` path (same as US governors)

## Snap Elections

The PM can dissolve the Shugiin and trigger a snap election.

### Rules

- **Who:** Sitting PM only
- **Limit:** 2 snap elections per PM appointment (resets on new PM)
- **Cooldown:** 336 turns (2 real-time weeks) between snap elections
- **Scope:** Shugiin only - Sangiin is unaffected
- **Duration:** 48 hours (24h primary + 24h general)
- **Election type:** `"snap_shugiin"` (distinct from regular `"shugiin"`)

### Effects

- All active/upcoming regular Shugiin elections are cancelled
- Fresh snap elections spawn for all 8 regions
- After resolution, the next regular Shūgiin cycle is anchored at the snap election's end turn plus 192 turns
- In-progress Shūgiin bills are failed. Sangiin-origin, Cabinet-review, and enrolled bills are preserved.
- Government resets to "pending" - new PM appointment process begins

### Tracking

- `snapElectionsUsed: number` on GovernmentFormation document
- `lastSnapElectionTurn: number | null` on GovernmentFormation document
- Both reset when a new PM is appointed

### API

- `POST /api/country/[code]/pm/snap-election` - PM-only, config-gated via `snapElectionsAllowed`

## Major Party Spoiler Modeling

Vote accumulation still uses configured major-party sets when applying spoiler
redistribution before PR allocation:

- **Kansai (KNS):** `{ ishin, ldp }` - Nippon Ishin dominates as opposition
- **All other regions:** `{ ldp, cdp }` - from `COUNTRY_CONFIGS.JP.majorPartyIds`

## Government Formation

Parliamentary system matching the UK pattern:

1. Post-election: largest party leader nominated as PM
2. PM appointment vote in Shugiin (lower house only)
3. Coalition negotiation if no majority (coalitionThreshold: 233)
4. Minority government attempt if no coalition
5. No-confidence vote handling (48-turn cooldown)

## Bills - Bicameral Lifecycle

### Diet Bill Flow

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

### Key Differences from US System

- **No executive veto** - passage in both chambers = enacted immediately
- **Shugiin override** - if Sangiin rejects, Shugiin can override with 2/3 supermajority
- **Chamber keys:** `"shugiin"` / `"sangiin"` (not `"house"` / `"senate"`)

### Cabinet-Origin Bills

- PM or Cabinet members can propose bills through Cabinet review
- `"cabinet_review"` status with 24-hour vote duration
- PM + all player-held cabinet positions vote (simple majority, minimum 2 players)
- NPP-held positions don't vote and don't count against threshold
- On pass: enters normal Shugiin → Sangiin cycle with `originChamber: "cabinet"`
- Limit: 1 cabinet bill in `"cabinet_review"` at a time per country
- Config-gated: `cabinetBillsEnabled: true` (only JP in v1)

### Diet-Member Bills

Any seated Shūgiin or Sangiin member may propose a national bill.

- Proposals follow the shared Diet proposal form (category + 1-3 provisions), with the standard action-point and national-influence costs defined in `shared/constants/legislation.ts`.
- **Origin chamber** is the sponsor's own chamber - Shūgiin members originate in Shūgiin, Sangiin members originate in Sangiin.
- **Second chamber** is the opposing chamber. On passage there, the bill enacts (no executive signing step - Japan's parliamentary system has no PM signature).
- **Shūgiin supremacy on rejection:** if the second chamber rejects, behavior depends on origin:
  - Shūgiin-origin bills rejected by the Sangiin → Shūgiin 2/3 override vote.
  - Sangiin-origin bills rejected by the Shūgiin → fail outright; the Sangiin cannot override the Shūgiin.
- **Cabinet bills** continue to use the existing `cabinet_review` path (PM + ministers).
