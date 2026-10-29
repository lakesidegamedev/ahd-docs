# Executive Term Limits

## Overview

Per-country configurable term limits on a single executive office (President, Uachtarán, etc.). The logic is the pure module `src/lib/elections/executiveTermLimits.ts`. The per-country values sit in the `executiveTermLimit` block of each country's client config in `src/lib/constants/countryClientConfig.ts`, mirrored in `src/lib/countries/<id>/institutionsFacts.ts`, and typed in `src/lib/constants/countries.ts`.

Player guide: [Executive Term Limits](https://www.ahousedividedgame.com/wiki/executive-term-limits)

The limit exists so a single character cannot hold the top executive office forever, and so the vice-presidency cannot be used as a back door around the cap.

## Rules

Each country config carries an optional `executiveTermLimit` block:

```
executiveTermLimit?: {
  officeKey: string;               // e.g. "president", "uachtaran"
  maxTermsPerCharacter: number;    // e.g. 2
  blocksRunningMateSelection: boolean;
}
```

A country with no `executiveTermLimit` has no limit: `getExecutiveTermLimit` returns `null` and `hasReachedExecutiveTermLimit` is always `false`.

| Country | `officeKey` | `maxTermsPerCharacter` | `blocksRunningMateSelection` | Source |
| --- | --- | --- | --- | --- |
| United States | `president` | 2 | true | `src/lib/countries/us/institutionsFacts.ts` |
| Ireland (IE) | `uachtaran` | 2 | false | `src/lib/countries/ie/institutionsFacts.ts` |
| Brazil (BR) | `president` | 2 | true | `src/lib/countries/br/institutionsFacts.ts` |
| Nigeria (NG) | `president` | 2 | true | `src/lib/countries/ng/institutionsFacts.ts` |

`blocksRunningMateSelection` distinguishes offices where a term-limited incumbent still cannot be picked as a running mate (US President under the 12th/22nd Amendment reading used here) from offices where the limit only blocks re-election to the office itself.

### Terms-served count

`getExecutiveTermsServed(character, countryId)` returns the greater of two sources:

1. **Stored counter**: `character.executiveTermsServed[countryId]`, incremented on each term start.
2. **Historical derivation**: `getHistoricalExecutiveTermsServed` counts `character.careerHistory` events where `event.office.type === officeKey`, `event.type` is `"appointed"` or `"elected"`, and `event.partyCountryId` is either this country or unset.

Taking the max means a character imported or backfilled with career history but no stored counter still gets an accurate count, and a stored counter that has already been incremented is never undercounted by a stale history scan.

### Terms counted toward the limit

`getExecutiveTermsCountedTowardLimit = max(0, termsServed - foundingTerms)`. A **founding term** is a career event flagged `foundingTerm: true` for the executive office: the term won at a world's founding (cycle 0) election. It still counts as served for display but not toward the cap, so a seeded first president is not penalised for the world's starting point. The limit is reached when the counted number is greater than or equal to `maxTermsPerCharacter`.

### Functions

| Function | Purpose |
| --- | --- |
| `getExecutiveTermsServed(character, countryId)` | Effective terms served, max(stored, historical) |
| `getExecutiveTermLimit(countryId)` | `maxTermsPerCharacter` or `null` if the country has no limit configured |
| `hasReachedExecutiveTermLimit(character, countryId)` | `true` when a limit exists and counted terms are at or past it |
| `incrementExecutiveTermsServedUpdate(character, countryId)` | Returns a Mongo `$set`-shaped update (`{"executiveTermsServed.<countryId>": n+1}`) where `n` is the effective terms served, for callers to apply on term start |

### Worked example

A US character has `executiveTermsServed.US = 1` and career history showing two `elected` president events (one of them the founding term). Historical count is 2, so terms served is `max(1, 2) = 2`. Founding terms are 1, so 1 term counts toward the limit. The cap is 2, so the character can file again; after one more elected term the counter becomes `2 + 1 = 3`, counted terms are 2, and filing is blocked.

## Timing

Nothing runs on a schedule. The limit is checked at three moments and the counter moves at two:

- **Filing** for a nationwide executive election: `POST /api/elections/[id]/enter` (`src/app/api/elections/[id]/enter/route.ts`) rejects a candidate who has reached the limit.
- **Running-mate selection**: the running-mate routes (`src/app/api/elections/[id]/running-mate/route.ts` and `.../running-mate/characters/route.ts`) reject or hide a limited character, and the primary-stage auto selection (`src/lib/turn/primaryRunningMates.ts`) skips them, only where `blocksRunningMateSelection` is true.
- **Succession**: when a vice president would become president, `src/lib/turn/presidentialSuccession.ts` refuses the succession if the vice president has reached the limit.
- **Counter increments**: when a winner is seated in the election-resolution turn phase (`src/lib/turn/election/presidentExecutiveSeating.ts`), and when a vice president succeeds (`presidentialSuccession.ts`). The seating write is idempotent: a partially completed seating that is retried restores the office without recording a second term.

## Edge cases and limits

- An **acting** president seated after a [contingent election](./contingent-election.md) deadlock does not increment the stored counter (the seating code skips the increment when `acting`). It is written to career history as `appointed` on the president office, and the historical scan counts `appointed` events, so the term can still show up in the effective count through `max(stored, historical)`. The player page says an acting term does not count; the code only guarantees that the stored counter is untouched. Flagged for a product decision.
- Founding terms (cycle 0) are excluded from the cap, see above.
- A country with no block never limits anyone.
- `executiveTermsServed` is keyed per country id, so a character's history in one country does not count against a limit in another. An event with no `partyCountryId` is treated as belonging to the country being checked.
- Counted terms are floored at 0, so more founding terms than served terms never produces a negative.
- The block is scoped to the one office in the one country: a limited character can still run for anything else. Ireland's limit does not bar running-mate selection.
- The filing check only applies to nationwide executive races (`isNationwideExecutive`), not to governors or legislatures.

## Connections

**Driven by:**
- [Elections](./elections.md): winning an executive election seats the winner and increments the counter (`presidentExecutiveSeating.ts`).
- [Contingent Election](./contingent-election.md): an acting presidency does not count.
- Presidential succession: a vice president who succeeds gains a term (`presidentialSuccession.ts`).

**Affects:**
- Candidacy filing: `POST /api/elections/[id]/enter` blocks a limited character.
- Running-mate selection: the running-mate routes and `primaryRunningMates.ts` exclude a limited character where the country blocks it.
- Succession: `presidentialSuccession.ts` refuses a limited vice president.

Last checked: 2026-10-29, version 1.18.0
