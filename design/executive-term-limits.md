# Executive Term Limits

## Overview

Per-country configurable term limits on a single executive office (President, Uachtarán, etc.). Source: `src/lib/elections/executiveTermLimits.ts`, config in `COUNTRY_CONFIGS.<id>.executiveTermLimit`, typed in `src/lib/constants/countries.ts` with each country's value in `src/lib/countries/<id>/institutionsFacts.ts`.

## Configuration

Each country config carries an optional `executiveTermLimit` block:

```
executiveTermLimit?: {
  officeKey: string;               // e.g. "president", "uachtaran"
  maxTermsPerCharacter: number;    // e.g. 2
  blocksRunningMateSelection: boolean;
}
```

A country with no `executiveTermLimit` has no limit, `getExecutiveTermLimit` returns `null` and `hasReachedExecutiveTermLimit` is always `false`.

| Country | `officeKey` | `maxTermsPerCharacter` | `blocksRunningMateSelection` |
| --- | --- | --- | --- |
| US | `president` | 2 | true |
| Ireland (IE) | `uachtaran` | 2 | false |
| (others carrying the block) | `president` | 2 | true |

`blocksRunningMateSelection` distinguishes offices where a term-limited incumbent still cannot be picked as a running mate (US President under the 12th/22nd Amendment reading used here) from offices where the limit only blocks re-election to the office itself.

## Terms-Served Count

`getExecutiveTermsServed(character, countryId)` returns the greater of two sources:

1. **Stored counter**: `character.executiveTermsServed[countryId]`, incremented explicitly on each term start.
2. **Historical derivation**: `getHistoricalExecutiveTermsServed` scans `character.careerHistory` for events where `event.office.type === officeKey`, `event.type` is `"appointed"` or `"elected"`, and `event.partyCountryId` is either this country or unset.

Taking the max means a character imported or backfilled with career history but no stored counter still gets an accurate count, and a stored counter that has already been incremented is never undercounted by a stale history scan.

## Functions

| Function | Purpose |
| --- | --- |
| `getExecutiveTermsServed(character, countryId)` | Effective terms served, max(stored, historical) |
| `getExecutiveTermLimit(countryId)` | `maxTermsPerCharacter` or `null` if the country has no limit configured |
| `hasReachedExecutiveTermLimit(character, countryId)` | `true` when a limit exists and terms served is at or past it |
| `incrementExecutiveTermsServedUpdate(character, countryId)` | Returns a Mongo `$set`-shaped update (`{"executiveTermsServed.<countryId>": n+1}`) for callers to apply on term start/inauguration |

## Usage Notes

- The module is pure, it takes a `Pick<Character, "careerHistory" | "executiveTermsServed">` snapshot and a country id, and returns booleans/numbers. Callers own persistence: gating candidacy filing checks `hasReachedExecutiveTermLimit` before allowing a character to run again, and term-start logic applies the `$set` update returned by `incrementExecutiveTermsServedUpdate`.
- `executiveTermsServed` is keyed per country id, so a character's history in one country does not count against a term limit in another.
