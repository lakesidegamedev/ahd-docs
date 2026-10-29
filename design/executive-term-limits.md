# Executive Term Limits

## Summary

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

### Rejection messages

The checks reject with fixed messages. Filing returns HTTP 400 "This character has already served the maximum number of {office} terms." (`src/app/api/elections/[id]/enter/route.ts`). The running-mate route returns HTTP 400 "That character has already served the maximum number of presidential terms and cannot be selected as Vice President." (`src/app/api/elections/[id]/running-mate/route.ts`). Succession does not message the player: it logs a warning and returns `false` (`src/lib/turn/presidentialSuccession.ts`).

## Data

| Collection | Field | Read or written | Notes |
| --- | --- | --- | --- |
| `characters` | `executiveTermsServed` | read, written | `Partial<Record<CountryId, number>>`, one counter per country. Written by `incrementExecutiveTermsServedUpdate` at seating and succession. |
| `characters` | `careerHistory[]` | read, appended | Events with `office.type`, `type` (`elected`, `appointed`), `partyCountryId`, `electionId`, `foundingTerm`. The seating and succession writers push the events that the historical scan later counts. |
| `characters` | `currentOffice` | written | Set to `{ type: "president" }` at seating and succession (not read by the limit itself). |
| `electedOfficials` | president row | written | Updated by succession and seating. The limit does not read it. |
| `elections` | `cycle` | read | `cycle === 0` marks a founding election, which stamps `foundingTerm: true` on the event. |

Player-visible: the White House page reads `getExecutiveTermsServed` to show the current term number (`src/app/api/whitehouse/route.ts`, floored at 1). The cap itself is shown on the executive pages from the country config. The counter and career history are visible on a character's profile.

## Configuration

There are no `gameConfig` fields, flags or era presets for this system. The only configuration is the static `executiveTermLimit` block per country, in the table under Rules.

| Setting | Default | Where set |
| --- | --- | --- |
| `executiveTermLimit.officeKey` | none (no limit) | `executiveTermLimit` in `src/lib/constants/countryClientConfig.ts`, mirrored in `src/lib/countries/<id>/institutionsFacts.ts` |
| `executiveTermLimit.maxTermsPerCharacter` | none | same |
| `executiveTermLimit.blocksRunningMateSelection` | none | same |

The runtime reads `getCountryClientConfig(countryId).executiveTermLimit`, so the client config is the live source. Changing a value needs a deploy. A new country gets a limit only by adding the block.

## Timing

Nothing runs on a schedule. The limit is checked at three moments and the counter moves at two:

- **Filing** for a nationwide executive election: `POST /api/elections/[id]/enter` (`src/app/api/elections/[id]/enter/route.ts`) rejects a candidate who has reached the limit.
- **Running-mate selection**: the running-mate routes (`src/app/api/elections/[id]/running-mate/route.ts` and `.../running-mate/characters/route.ts`) reject or hide a limited character, and the primary-stage auto selection (`src/lib/turn/primaryRunningMates.ts`) skips them, only where `blocksRunningMateSelection` is true.
- **Succession**: `processPresidentialSuccession` in `src/lib/turn/presidentialSuccession.ts` runs each turn after election resolution. When the US president office is vacant and a vice president exists, it refuses the succession if the vice president has reached the limit.
- **Counter increments**: when a winner is seated in the election-resolution turn phase (`src/lib/turn/election/presidentExecutiveSeating.ts`), and when a vice president succeeds (`presidentialSuccession.ts`). The seating write is idempotent: a partially completed seating that is retried restores the office without recording a second term.

The seating write is guarded by a filter that matches only when no career event of the same type and `electionId` already exists, which is what makes the retry safe.

## Worked trace

A US character has `executiveTermsServed.US = 1` and career history showing two `elected` president events, one of them the founding term (`foundingTerm: true`, from a cycle 0 election).

| Step | Computation | Result |
| --- | --- | --- |
| Limit | `getExecutiveTermLimit("US")` | 2 |
| Stored terms | `executiveTermsServed.US` | 1 |
| Historical terms | 2 events with `office.type = "president"`, `type = "elected"`, `partyCountryId = "US"` | 2 |
| Terms served | `max(1, 2)` | 2 |
| Founding terms | events with `foundingTerm === true` | 1 |
| Counted toward limit | `max(0, 2 - 1)` | 1 |
| Reached? | `1 >= 2` | false, filing allowed |

The character files, wins the next cycle (cycle 1, not a founding election), and is seated:

| Step | Computation | Result |
| --- | --- | --- |
| Increment payload | `{"executiveTermsServed.US": 2 + 1}` (effective terms served is 2, so the write is 3) | 3 |
| New career event | `type: "elected"`, `office.type: "president"`, `electionId` set, no `foundingTerm` | 3 events in history |
| Terms served | `max(3, 3)` | 3 |
| Counted toward limit | `3 - 1` | 2 |
| Reached? | `2 >= 2` | true, filing and running-mate picks (US) blocked |

Now the contingent case. A different US character with stored counter 0 and no history is seated as acting president after a House deadlock. Seating skips the counter write (`acting`), pushes an `appointed` event labelled "Acting President", and the history scan counts it: terms served `max(0, 1) = 1`. If that character later wins an election, the history has 2 counted events and the counter is written as `1 + 1 = 2`, so the limit is reached after only one elected term.

## Edge cases and limits

- An **acting** president seated after a [contingent election](./contingent-election.md) deadlock does not increment the stored counter (the seating code skips the increment when `acting`). It is written to career history as `appointed` on the president office, and the historical scan counts `appointed` events, so the term does show up in the effective count through `max(stored, historical)`. The player page agrees: it says the acting term adds to the total through career history. In practice an acting presidency costs one of the two terms.
- Founding terms (cycle 0) are excluded from the cap, see above. A succession event is never flagged as founding, and neither is an acting seating.
- A country with no block never limits anyone.
- `executiveTermsServed` is keyed per country id, so a character's history in one country does not count against a limit in another. An event with no `partyCountryId` is treated as belonging to the country being checked.
- Counted terms are floored at 0, so more founding terms than served terms never produces a negative.
- The block is scoped to the one office in the one country: a limited character can still run for anything else. Ireland's limit does not bar running-mate selection, and Ireland defines no `vicePresident` office, so it has no running-mate selector at all (`countryHasPresidentialRunningMate`). Ireland's `officeKey` is `uachtaran`, so `president` events do not count toward it.
- The filing check only applies to nationwide executive races (`isNationwideExecutive`), not to governors or legislatures.
- A partial term counts as a full term: a succeeding vice president gets the same single increment as a winner.
- Succession is US-only: `processPresidentialSuccession` is hard-wired to the US country id, so the other limited countries have no succession path through this check.

## Invariants

| Invariant | Enforced by |
| --- | --- | 
| The effective count never goes down when career history is added: it is `max(stored, historical)` | By construction in `getExecutiveTermsServed`; `executiveTermLimits.test.ts` covers stored-only, history-only and both |
| Counted terms are never negative | `Math.max(0, ...)` in `getExecutiveTermsCountedTowardLimit`; not directly tested with a negative case |
| A seating retry never records a second term | The `$not $elemMatch` filter on the seating write; `presidentExecutiveSeating.test.ts` checks the increment and event fields, not the retry path |
| An acting seating never touches the stored counter | `presidentExecutiveSeating.test.ts` ("seats an acting president without counting a term") |
| A limited vice president never succeeds | `presidentialSuccession.test.ts` ("blocks succession when the VP character already reached the presidential term limit") |
| Counters are per country | Keyed by `countryId`; `executiveTermLimits.test.ts` covers IE versus US events |
| Stored counter and history agree | Not enforced. Only the max of the two is used, so drift in either direction is tolerated rather than detected. |

## Failure and recovery

- **Counter and history disagree.** Because the count is the max, a missing or low counter is harmless when history is complete. A counter that is too high (for example from a duplicated increment) over-blocks a character. Recovery is a data correction of `executiveTermsServed.<country>` through the heal tooling.
- **Founding flag missing on a seeded first term.** The character is counted one term higher than intended and hits the cap a term early. Recovery is to set `foundingTerm: true` on that career event.
- **Partially completed seating.** The office rows may be cleared before the character write lands. The retry path restores `currentOffice` without a second increment, so a plain rerun of the election-resolution phase is the repair.
- **Succession refused.** A limited vice president is skipped with a logged warning and the office stays as the caller left it. The repair is the normal vacancy handling for the president office, not a change to the counter.
- **Config typo.** An `officeKey` that matches no career events gives a historical count of 0, so only the stored counter protects the cap. There is no startup check that the key exists as an office type.

## Connections

**Driven by:**
- [Elections](./elections.md): winning an executive election seats the winner and increments the counter (`presidentExecutiveSeating.ts`).
- [Contingent Election](./contingent-election.md): an acting presidency does not move the counter but counts through history.
- Presidential succession: a vice president who succeeds gains a term (`presidentialSuccession.ts`).

**Affects:**
- Candidacy filing: `POST /api/elections/[id]/enter` blocks a limited character.
- Running-mate selection: the running-mate routes and `primaryRunningMates.ts` exclude a limited character where the country blocks it.
- Succession: `presidentialSuccession.ts` refuses a limited vice president.
- White House page: `src/app/api/whitehouse/route.ts` shows the current term number from the same count.

## Tests

| Test file | Covers |
| --- | --- |
| `src/lib/elections/executiveTermLimits.test.ts` | Limit lookup, stored versus historical count, founding term exclusion, next-term payload, Ireland `uachtaran` counting, US regression |
| `src/lib/turn/election/presidentExecutiveSeating.test.ts` | Counter increment per country, `foundingTerm` for cycle 0, acting seating leaves the counter alone |
| `src/lib/turn/presidentialSuccession.test.ts` | Succession blocked when the vice president has reached the limit |
| `src/lib/constants/countries.test.ts` | The Ireland config block |
| `src/app/api/whitehouse/route.test.ts` | White House term display |

Known gaps: `src/app/api/elections/[id]/enter/route.test.ts` mocks `hasReachedExecutiveTermLimit` to always return false, so the filing rejection itself has no test. There are no tests for the running-mate routes or `primaryRunningMates.ts` limit checks, and nothing tests the seating retry path.

## Known issues and history

- 2026-10-29 check: the earlier version of this page said the player page claimed an acting term does not count. The player page already states that an acting term counts through career history, and the code agrees with it, so the earlier wording was wrong and has been corrected here.
- Whether an acting presidency should cost a term is a product question. Today it does, through the history scan, even though the stored counter is skipped on purpose.
- The code comment in seating says "an acting presidency is not an elected term (term limits)", which describes the counter write only. The history scan still counts it. The comment and the behaviour differ in intent.
- Succession is wired for the US only. If another limited country gains a vice-presidential succession path it needs the same check.

Last checked: 2026-10-29, version 1.18.0
