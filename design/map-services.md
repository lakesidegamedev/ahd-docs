# Map Services

## Overview

The Map Services layer provides data for political map visualizations across all countries. Services compute party control, lean metrics, and approval ratings for display on interactive maps.

**Location:** `src/lib/map/`

**Key files:**

- `houseService.ts` - House/Commons party control by state/region
- `senateService.ts` - Senate seats by state
- `governorService.ts` - Governor party by state
- `presidentialService.ts` - Presidential election results
- `leanService.ts` - Political lean (economic/social) by state
- `partyOrgService.ts` - Party organization strength
- `approvalService.ts` - Government approval ratings

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

**Color Mapping:**

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

1. Fetch all elected officials with `officeType = "senate"`
2. Sort by state, then senate class
3. Assign seat1 (class 1) and seat2 (class 2/3)
4. Return per-state breakdown

**Note:** UK does not have an elected upper house (Lords are appointed), so this service primarily serves US data.

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
// From demographics if available
const c = calculateStateLean(demo, demographicCategories);
economicLean = c.economicLean;
socialLean = c.socialLean;

// Fallback to cached state values
economicLean = state.cachedEconomicLean;
socialLean = state.cachedSocialLean;

// Fallback to 2020 election data (US only)
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

**Returns:** Similar structure to houseService, showing gubernatorial control.

## Presidential Service

### `computePresidentialMap(db, countryId)`

**Purpose:** Compute presidential election results by state.

**Returns:** Electoral vote allocations and state winners.

## Party Org Service

### `computePartyOrgMap(db, countryId)`

**Purpose:** Compute party organization strength by state.

**Returns:** Party org levels (0-100) for visualization.

## Approval Service

### `computeApprovalMap(db, countryId)`

**Purpose:** Compute government approval ratings by state.

**Returns:** Approval percentages for state and national government.

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

## Related Systems

- **Demographics:** `src/lib/utils/demographics.ts` - Lean calculations
- **Politics Utils:** `src/lib/utils/politics.ts` - Color/label helpers
- **Countries Config:** `src/lib/constants/countries.ts` - Country definitions
- **UK Constants:** `src/lib/constants/uk.ts` - UK region definitions
