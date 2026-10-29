# Map Services

## Overview

The Map Services layer provides data for political map visualizations across all countries. Services compute party control, lean metrics, and approval ratings for display on interactive maps.

This is a developer-facing service document. No player wiki page covers it; players see its output as the map overlays.

**Location:** `src/lib/map/`

**Key files:**

- `houseService.ts` - House/Commons party control by state/region
- `senateService.ts` - Senate seats by state
- `governorService.ts` - Governor party by state
- `presidentialService.ts` - Presidential election results
- `leanService.ts` - Political lean (economic/social) by state
- `partyOrgService.ts` - Party organization strength
- `approvalService.ts` - Government approval ratings
- `officeholderService.ts` - Seated officeholders (portraits, chamber breakdowns) for the atlas
- `rosterService.ts` - Region roster (id, name, seats, grouping, population) derived live from `states`
- `metricsService.ts` - US state indicators (GDP, per capita and policy scores) for the metrics map
- `overviewTypes.ts`, `metricTypes.ts` - Response types for the routes below

## House Service

### `computeHouseMap(db, countryId)`

**Purpose:** Compute party control of House/Commons seats by state/region.

**Returns:**

```typescript
interface MapHouseState {
  leadingParty: string;
  leadColor: string;
  seats: number;
  total: number;
  tooltip: string[];
}
```

**Logic:**

1. Resolve the lower-chamber office type via `getLowerChamberOfficeType(countryId)` (`src/lib/legislature/chamberOfficeType.ts`). US is `house`, UK is `commons`, DE is `bundestag`, JP is `shugiin`, CN is `npcDelegate`, and other countries follow their `legislature.lowerChamber` mapping.
2. Fetch elected officials with that `officeType`
3. Group by state/region
4. Count seats per party
5. Determine leading party (most seats)
6. Build tooltip with full breakdown

**Country Handling:**

- UK still has a dedicated Commons region builder (`buildCommonsUK`) after the office-type lookup
- Every other country uses the generic `buildHouseOrCommons` path
- Senate (`officeType: "senate"`) and governor (`officeType: "governor"`) maps are still US-office-key queries; they do not go through the chamber-office helper

**Tooltip Format:**

```
Party Name: X / total seats
Lead: +Y
Party1: N seats
Party2: N seats
...
```

**Color Mapping** (`DEFAULT_COLORS` and `partyColor` in `src/lib/map/houseService.ts`; the same table is duplicated in `senateService.ts`, `governorService.ts`, `presidentialService.ts` and `partyOrgService.ts`, so a change must be made in all five). A vacant seat uses `VACANT_COLOR` `#334155`.

```typescript
DEFAULT_COLORS = {
  democrat: "#3B82F6", // Blue
  republican: "#EF4444", // Red
  independent: "#9CA3AF", // Gray
  LAB: "#E4003B", // Labour Red
  CON: "#0087DC", // Conservative Blue
  LD: "#FAA61A", // LibDem Orange
  SNP: "#FFF95D", // SNP Yellow
  PC: "#3F8428", // Plaid Cymru Green
  GREEN: "#02A95B", // Green
  REF: "#12B6CF", // Reform UK Cyan
};
```

## Senate Service

### `computeSenateMap(db, countryId)`

**Purpose:** Compute Senate seat holders by state.

**Returns:**

```typescript
interface MapSenateState {
  seat1: MapSenateSeat | null;
  seat2: MapSenateSeat | null;
}

interface MapSenateSeat {
  party: string;
  color: string;
  name: string;
}
```

**Logic:**

1. Fetch all elected officials with `officeType = "senate"` (also used for JP and BR in the overview route)
2. Sort by state, then senate class
3. Assign seat1 (class 1) and seat2 (class 2/3)
4. Return per-state breakdown

A seat row with no seated character returns `null` (rendered in the shared vacant colour `#334155`), not "independent".

**Note:** UK does not have an elected upper house (Lords are appointed), so the UK overview does not call this service.

## Lean Service

### `computeLeanMap(db, countryId)`

**Purpose:** Compute political lean metrics by state/region.

**Returns:**

```typescript
interface MapLeanState {
  economicLean: number;
  socialLean: number;
  displayLean: number;
  color: string;
  label: string;
  tooltip: string[];
  economicColor: string;
  economicLabel: string;
  socialColor: string;
  socialLabel: string;
}
```

**Lean Calculation:**

```typescript
// 1. Cached state values win when both are set
economicLean = state.cachedEconomicLean;
socialLean = state.cachedSocialLean;

// 2. Otherwise compute from demographics if available
const c = calculateStateLean(demo, demographicCategories);
economicLean = c.economicLean;
socialLean = c.socialLean;

// 3. Otherwise fall back to 2020 election data (US only, else 0)
const margin = ELECTION_2020_MARGIN[stateId];
const lean = margin !== undefined ? marginToLean(margin) : 0;
```

**Display Lean:**

```typescript
displayLean = getDisplayLean(economicLean, socialLean);
// Combines economic and social into single political lean
```

**Tooltip Format (US):**

```
State Name
Political Lean: label
Economic: +X.XX · Social: +X.XX
From demographics (weighted avg)
```

**UK Handling:**

- Uses same calculation but different color hex functions
- No 2020 election fallback (uses 0/neutral default)

## Governor Service

### `computeGovernorMap(db, countryId)`

**Purpose:** Compute governor party by state.

**Inputs:** `electedOfficials` with `officeType = "governor"` (country-filtered in memory) and `politicalParties`.

**Returns:** `MapGovernorState` keyed by state: `leadingParty`, `leadColor`, `governorName` (`"Vacant"` when no character is seated) and a one-line `tooltip`.

## Presidential Service

### `computePresidentialMap(db, countryId)`

**Purpose:** Compute presidential election results by state.

**Inputs:** the most recently updated national election (`elections` with `state = countryId`, status active, upcoming, completed or resolved), its vote tallies, `states`, `politicalParties`, and the live apportionment (`loadApportionment` in `src/lib/elections/apportionment.ts`).

**Returns:** per-state `MapPresidentialState` (`leadingParty`, `leadColor`, `candidateName`, `ev`, `tooltip`), plus optional electoral-vote, candidate name, party and colour maps and `totalElectoralVotes`. With no national election the maps come back empty and the panel assumes 538.

## Party Org Service

### `computePartyOrgMap(db, countryId)`

**Purpose:** Compute party organization strength by state.

**Inputs:** `statePartyOrg` records for the country and `politicalParties`. Only parties matched by `sequentialId` count; old slug-based party ids are stale data and are ignored.

**Returns:** per region `MapPartyOrgState`: `leadingParty`, `leadingPartyName`, `leadColor`, `organization` and `tooltip`. Regions with no organisation use `VACANT_COLOR` `#334155`.

## Approval Service

### `computeApprovalMap(db, countryId)`

**Purpose:** Compute government approval ratings by state.

**Inputs:** merged regional metrics (`findMergedRegionMetricsMany`), `states`, electorate groups, and the era context (`getEraContext`), so the heatmap matches the approval shown on the region page under any era preset. Countries with political approval (`isPoliticalApprovalCountry`) use the hybrid political base from `loadPoliticalApprovalBases`.

**Returns:** per region `MapApprovalState` (`approval`, `color`, `tooltip`). The colour is a linear blend from `#dc2626` at 0 to `#22c55e` at 100 (`approvalToHeatColor` in `src/lib/map/approvalService.ts`); approval is clamped to 0 to 100 for colour only. The formula itself is in [Government Approval](./government-approval.md).

## Officeholder, Roster and Metrics Services

- `computeMapOfficeholders(db, countryId, regionIds)` returns seated senate, house and governor holders per region as `MapOfficeholder` (name, office, party, colour, avatar, seats). Vacant seats are excluded; multi-seat delegations keep their seat count.
- `buildRegionRoster` (`rosterService.ts`) builds the nation map's region list from the country's live `states`. For the US, `filterPoliticalUsRoster` drops non-political regions (unadmitted territories under early eras, DC) so a 1953 world shows 48 states.
- `loadMapMetrics(db, politicalIds)` (`metricsService.ts`) returns current US state indicators with their own prefix, suffix and decimals. It is US only.

## Country Safety

All services use country-aware filtering:

```typescript
// Query without countryId filter (older records may not have it)
const allReps = await db
  .collection<ElectedOfficial>("electedOfficials")
  .find({ officeType })
  .toArray();

// Filter results by countryId field
const reps = allReps.filter((r) => r.state && (r.countryId ?? "US") === countryId);
```

**Rationale:** Historical records may lack `countryId` field; filtering in-memory ensures correctness.

## Color System

Colors are defined in `DEFAULT_COLORS` with fallbacks:

```typescript
function partyColor(partyId: string, storedColor?: string): string {
  return DEFAULT_COLORS[partyId] ?? storedColor ?? "#8B5CF6"; // Purple fallback
}
```

**Party-specific colors:**

- US: democrat (blue), republican (red), independent (gray)
- UK: LAB (red), CON (blue), LD (orange), SNP (yellow), etc.

## Integration Points

### Map Components

Map services are called from client components:

```typescript
// Client-side fetch
const response = await fetch(`/api/map/overview?countryId=${countryId}`);
const data = await response.json();
```

### API Routes

Map services are exposed via API routes:

```typescript
GET /api/map/overview?countryId=US
GET /api/map/metrics?countryId=US
GET /api/map/logistics?countryId=US
GET /api/map/resources?countryId=US&resource=oil
```

| Route | Backed by | Notes |
| --- | --- | --- |
| `/api/map/overview` | All services above | Public. Defaults to `US`; unknown country is 400. Each country has its own branch (US adds senate, governor, presidential, officeholders and electoral votes; UK, DE, JP, BR and CN call a subset). |
| `/api/map/metrics` | `metricsService.ts` | US only (400 otherwise); `Cache-Control: no-store`. |
| `/api/map/logistics` | `sourcingNetworkLoad` and `CommodityPrice.stateSupply` | Freight capacity vs projected haul TEUs per state. |
| `/api/map/resources` | `stateResourceCapacity` and active extraction contracts | Needs a valid `resource`; returns capacity and contracted share per state. |

There are no per-chamber routes (`/api/map/house`, `/senate`, `/lean`); chambers are fields of the overview response.

## Performance Optimizations

### Parallel Fetching

Services fetch data in parallel:

```typescript
const [parties, allReps] = await Promise.all([
  db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
  db.collection<ElectedOfficial>("electedOfficials").find({ officeType }).toArray(),
]);
```

### Map-Based Lookups

Party colors/names are cached in Maps for O(1) lookup:

```typescript
const partyColorMap = new Map(
  parties.map((p) => [String(p.sequentialId), partyColor(String(p.sequentialId), p.color)])
);
```

## Timing

Map services run per request, not in the turn processor. They read whatever the last completed turn wrote (`states`, `statePartyOrg`, regional metrics, `electedOfficials`, `elections`), so a map is at most one turn stale. The overview route runs its services in parallel with `Promise.all`; the individual services do not depend on each other. No result is cached server side, except that `/api/map/metrics` explicitly sets `no-store`.

## Edge cases and limits

- Older `electedOfficials` rows may lack `countryId`; they are treated as US (`(r.countryId ?? "US")`). Services therefore load every row of an office type and filter in memory.
- Vacant seats render in `#334155`, never as independents.
- Lean uses cached values first, so a state with cached lean ignores fresh demographics until the cache is refreshed.
- The 2020 election lean fallback is US only; elsewhere the fallback is 0.
- Era gates: US Alaska and Hawaii are excluded from the roster and electoral votes until admitted.
- The metrics map refuses non-US countries.

## Connections

- **Driven by:** elections and seat changes (`electedOfficials`, `elections`), party organisation (`statePartyOrg`), regional metrics and approval ([Government Approval](./government-approval.md), [National Metrics](./national-metrics.md)), demographics ([Demographics](./demographics.md)), and era presets (`getEraContext`).
- **Affects:** nothing in the simulation. Map services are read-only views; they feed the map components and the region pages.

## Related Systems

- **Demographics:** `src/lib/utils/demographics.ts` - Lean calculations
- **Politics Utils:** `src/lib/utils/politics.ts` - Color/label helpers
- **Countries Config:** `src/lib/constants/countries.ts` - Country definitions
- **UK Constants:** `src/lib/constants/uk.ts` - UK region definitions

Last checked: 2026-10-29, version 1.18.0
