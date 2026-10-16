# A House Divided - Public API v1

Base URL: `https://ahousedividedgame.com`

Use the API to build tools that read game data or automate fund transfers and forex trades. Generate keys in Settings -> API Keys in-game.

This document is canonical. The old in-app `/api-guide` page redirects here.

## Authentication

All API requests require a personal API key in the `X-API-Key` header:

```
X-API-Key: ahd_pub_...   # public scope (read-only)
X-API-Key: ahd_priv_...  # private scope (read + write)
```

Key scopes:

| Prefix      | Scope   | Access                                                                           |
| ----------- | ------- | -------------------------------------------------------------------------------- |
| `ahd_pub_`  | Public  | Read-only access to all public endpoints. Cannot send funds or trade forex.      |
| `ahd_priv_` | Private | All public endpoints + send campaign funds + trade forex. Treat like a password. |

You can have up to 3 active keys per scope type. The full token is shown only once at creation.

## Rate limits

| Category                | Limit                                                        |
| ----------------------- | ------------------------------------------------------------ |
| Public read             | 60 req/min per account, per endpoint, for a base key          |
| Public read (Supporter+)  | 90 req/min per account, per endpoint (1.5x)                 |
| Public read (Supporter++) | 180 req/min per account, per endpoint (3x)                  |
| Fund transfers          | 20 req/min per account                                       |
| Forex trades            | 30 req/min per account                                       |
| Key introspection       | 30 req/min per key (`GET /api/v1/key`)                       |
| Key management          | 10 req/min per account (creating and rotating keys in Settings) |

Read limits are counted per key owner and per endpoint bucket, so two keys on one account share an allowance, and polling `/game` does not use up the allowance for `/elections`. The Supporter+ and Supporter++ multipliers apply while the pledge is active; plain Supporter keeps the base allowance. A pledge change takes effect within one minute.

Rate-limited responses return HTTP 429 with a `Retry-After` header (seconds).

## Usage guidelines

- Cache responses when possible. Game state turns over every few minutes; polling faster than once per minute is unnecessary.
- Do not create multiple keys to circumvent limits. All requests under your account count toward the same quota regardless of which key you use.
- Never commit keys to source control or embed them in client-side code. Revoke compromised keys immediately in Settings.
- Automated fund transfers respect all in-game rules (cooldowns, minimums, same-country restrictions, admin pauses). Attempting to bypass them revokes API access.
- Abuse (repeated rate-limit violations, key sharing) results in key revocation and possibly account-level API restrictions.

## Response envelope

Success:

```json
{ "ok": true, ... }
```

Error:

```json
{ "ok": false, "error": "Human-readable message", "code": "ERROR_CODE" }
```

## Stability contract

`/v1/` endpoints are additive-only. Fields may be added; existing fields will not be removed or renamed. Breaking changes will be released under `/v2/`.

All timestamps are UTC ISO 8601.

## Error responses

| Status | Code                                 | Meaning                                     |
| ------ | ------------------------------------ | ------------------------------------------- |
| 401    | missing / invalid                    | No API key, or key not found/revoked        |
| 403    | insufficient scope                   | Public key used on a private endpoint       |
| 403    | Transfers are paused                 | Admin has temporarily paused fund transfers |
| 403    | Currency exchange is not yet enabled | Forex is disabled on this server            |
| 429    | rate_limited                         | Too many requests, check `Retry-After`      |

## Public read endpoints

All accessible with any personal API key via `X-API-Key`.

### GET /api/public/v1/game

Current game state and turn timing.

| Field               | Type           | Description                                   |
| ------------------- | -------------- | --------------------------------------------- |
| ok                  | boolean        | Always true on success                        |
| found               | boolean        | Whether game data was found                   |
| currentTurn         | number         | Current turn number                           |
| displayTurn         | number         | Calendar turn after any founding-phase offset |
| currentYear         | number         | Current in-game calendar year                 |
| startingYear        | number         | Calendar year at turn 1 for this world        |
| gameDate            | string         | In-game date (YYYY-MM-DD)                     |
| gameDateLabel       | string         | Human-readable in-game date                   |
| calendar            | object         | `{ month, weekOfMonth, year }`                |
| nextTurnAt          | string \| null | ISO 8601 timestamp of next turn               |
| lastTurnAt          | string \| null | ISO 8601 timestamp of the last processed turn |
| turnDurationMs      | number         | Turn duration in milliseconds                 |
| status              | string         | `active` or `paused`                          |
| isActive / fastMode | boolean        | Turn-system state and cadence                 |
| preset              | string \| null | World seed preset id                          |
| iteration           | object \| null | Current game iteration `{ type, number }`     |

### GET /api/public/v1/character

Search characters. Requires `name` or `discordId` query param. Alias: `GET /api/public/v1/characterSearch` (same params and response).

| Param     | Type   | Description                    |
| --------- | ------ | ------------------------------ |
| name      | string | Character name (partial match) |
| discordId | string | Discord user ID                |

Response: `ok`, `found`, `characters[]` with fields:

| Field              | Type           | Description                      |
| ------------------ | -------------- | -------------------------------- |
| id                 | string         | Character ObjectId               |
| name               | string         | Display name                     |
| bio                | string \| null | Character biography              |
| countryId          | string \| null | Home country code                |
| party              | string         | Party name                       |
| partyId            | string \| null | Party ObjectId                   |
| partyColor         | string         | Hex color                        |
| state              | string         | Home state name                  |
| stateCode          | string         | Home state code                  |
| position           | string         | Current office/position          |
| politicalInfluence | number         | PI score                         |
| nationalInfluence  | number         | NPI score                        |
| favorability       | number         | Favorability rating              |
| campaignFunds      | number         | Campaign treasury                |
| netWorth           | number         | Total net worth                  |
| isCeo              | boolean        | Whether CEO of a corporation     |
| profileUrl         | string         | Relative profile URL             |
| activeElection     | object \| null | Current election info if running |

### GET /api/public/v1/character/[id]

Full character details by public sequential id (e.g. `75`) or ObjectId. Same field shape as the characters array above, wrapped as `{ ok, found, character }` with additional detail fields.

### GET /api/public/v1/character/[id]/career

Character career history.

| Field              | Type           | Description                              |
| ------------------ | -------------- | ---------------------------------------- |
| ok                 | boolean        | Always true                              |
| found              | boolean        | Whether the character exists             |
| characterId        | string         | Character ObjectId                       |
| characterName      | string         | Display name                             |
| career[].type      | string         | Entry type (election, appointment, etc.) |
| career[].office    | string \| null | Office held                              |
| career[].party     | string \| null | Party at time                            |
| career[].fromState | string \| null | Start turn/term                          |
| career[].toState   | string \| null | End turn/term                            |

### GET /api/public/v1/character/[id]/achievements

Achievements earned by a character.

| Field                      | Type           | Description                |
| -------------------------- | -------------- | -------------------------- |
| achievements[].id          | string         | Achievement ID             |
| achievements[].name        | string \| null | Display name               |
| achievements[].description | string \| null | Description text           |
| achievements[].icon        | string \| null | Emoji/icon                 |
| achievements[].category    | string \| null | Category                   |
| achievements[].isHidden    | boolean        | Whether hidden from others |
| achievements[].earnedAt    | string \| null | ISO 8601 timestamp         |

### GET /api/public/v1/party?id=ID&country=CODE

Party details. Both `id` and `country` params required.

| Field                  | Type           | Description                |
| ---------------------- | -------------- | -------------------------- |
| party.id               | string         | Party ObjectId             |
| party.name             | string         | Party name                 |
| party.abbreviation     | string \| null | Short name                 |
| party.color            | string         | Hex color                  |
| party.economicPosition | number         | Economic axis position     |
| party.socialPosition   | number         | Social axis position       |
| party.memberCount      | number         | Active member count        |
| party.seatCount        | number         | Legislative seats held     |
| party.treasury         | number         | Party treasury balance     |
| party.chairName        | string \| null | Party chair name           |
| party.topMembers       | array          | Top 5 members by influence |

### GET /api/public/v1/country

List every registered country in runtime order.

Response rows: `countries[].id`, `name`, `governmentType`, `status`,
`enabledForPlayers`, `economyPreview`, `currencyCode`, `regionCount`,
`population`, and `gdpMillions`.

### GET /api/public/v1/country/[code]

Country details by code (e.g. US, GB).

| Field                              | Type           | Description                                    |
| ---------------------------------- | -------------- | ---------------------------------------------- |
| countryId                          | string         | Country code                                   |
| name                               | string         | Country name                                   |
| governmentType                     | string         | Regime type (e.g. presidential, parliamentary) |
| population                         | number \| null | Population count                               |
| currentLeader                      | object \| null | `{ name, party, profileUrl }` or null          |
| legislatureComposition[].partyName | string         | Party name                                     |
| legislatureComposition[].seats     | number         | Seats held                                     |
| legislatureComposition[].seatPct   | number         | Percentage of total                            |
| lastElectionCycle                  | number \| null | Last election cycle number                     |

### GET /api/public/v1/country/[code]/legislature

Legislature details for a country.

| Field                 | Type   | Description                                                |
| --------------------- | ------ | ---------------------------------------------------------- |
| chamber               | string | Chamber name                                               |
| totalSeats            | number | Total legislative seats                                    |
| composition           | array  | Party seat breakdown                                       |
| pendingBills[].id     | string | Bill ObjectId                                              |
| pendingBills[].title  | string | Bill title                                                 |
| pendingBills[].status | string | Bill status                                                |
| recentlyPassed        | array  | Recently passed bills (`{ yes, no }` vote tally per entry) |

### GET /api/public/v1/country/[code]/economy

Economic indicators for a country.

| Field                      | Type           | Description                                     |
| -------------------------- | -------------- | ----------------------------------------------- |
| primeRate                  | number \| null | Current central bank rate                       |
| inflation                  | number \| null | Current inflation rate                          |
| gdpGrowth                  | number \| null | GDP growth rate                                 |
| currencyCode               | string \| null | National currency code                          |
| population                 | number \| null | Sum of live regional population                 |
| gdp                        | number \| null | Live national GDP in local-currency units       |
| gdpPerCapita               | number \| null | GDP divided by population                       |
| debt                       | object \| null | Principal, debt-to-GDP ratio, and credit rating |
| budgetBalance              | number \| null | Revenue less spending                           |
| budgetBalancePctGdp        | number \| null | Balance as a percentage of smoothed GDP         |
| investorConfidence         | number \| null | Current investor-confidence index               |
| chair                      | object \| null | Central bank chair `{ name, profileUrl }`       |
| rateHistory                | array          | `[{ turn, rate }]` historical rates             |
| stockMarket.totalMarketCap | number         | Total market cap                                |
| stockMarket.change24h      | number         | 24h change percentage                           |

### GET /api/public/v1/country/[code]/economy/history

Bounded historical monetary, growth, inflation, fiscal, and sovereign debt
data for one country. Points are returned oldest to newest.

| Param    | Type   | Description                                  |
| -------- | ------ | -------------------------------------------- |
| fromTurn | number | Optional inclusive first turn                |
| toTurn   | number | Optional inclusive last turn                 |
| limit    | number | Maximum points, 1-240, default 48            |

Response:

- `series.primeRate[]`, `series.inflation[]`, and `series.gdpGrowth[]` contain
  `{ turn, value }` points from the per-turn monetary history.
- `fiscalYears[]` contains annual snapshots with `fiscalYear`, `turn`,
  `recordedAt`, `currencyCode`, `gdp`, `revenue`, `spending`, `surplus`,
  `debtPrincipal`, `debtToGdpRatio`, `creditRating`, and `inflation`.
- `range` echoes the effective filters. `found` is false when the country is
  valid but its current world has not accumulated history yet.

Internal policy drivers, actor ids, tax bases, and enacted-law implementation
details are not exposed.

### GET /api/public/v1/country/[code]/regions

All regions for a country in one request, ordered by name.

Response: `countryId`, `countryName`, `count`, and `regions[]` with `id`,
`name`, `regionType`, `parentRegionId`, `region`, `population`,
`votingEligiblePopulation`, `workingAgePopulation`, `gdpMillions`,
`gdpPerCapita`, `houseDistricts`, `stateSenateSeats`, `votingSystem`,
`economicLean`, `socialLean`, `sectorSpecializations`, `topSectors`, and
`metricsUpdatedAt`.

### GET /api/public/v1/country/[code]/metrics?category=CATEGORY

National quality-of-life and economic metrics with regional context. `category`
is optional and accepts `economic`, `education`, `healthcare`, `infrastructure`,
`publicSafety`, `environment`, `social`, `governance`, `population`, or
`mediaInformation`.

| Field                                    | Type   | Description                                            |
| ---------------------------------------- | ------ | ------------------------------------------------------ |
| countryId / countryName                  | string | Country identity                                       |
| calculatedAt                             | string | ISO 8601 calculation timestamp                         |
| population                               | number | Live national population                               |
| gdpMillions                              | number | GDP in millions of local-currency units                |
| gdpPerCapita                             | number | GDP per resident in local-currency units               |
| currencyCode                             | string | Currency used by GDP fields                            |
| governmentApproval                       | number | Current national approval                              |
| governmentApprovalBase                   | number | Approval before public modifiers                       |
| categories                               | object | Metric families keyed by stable metric id              |
| categories._._.average                   | number | Simple regional average                                |
| categories._._.populationWeightedAverage | number | Population-weighted national value                     |
| categories._._.trend                     | number | Population-weighted trend                              |
| categories._._.min / max                 | object | Regional extreme `{ value, stateId, stateName }`       |
| regions                                  | array  | Public `{ id, name, approval, baseApproval }` readings |

Policy tick rates, demographic drivers, and modifier ledgers are not exposed.

### GET /api/public/v1/country/[code]/budget

Current national fiscal position. Money fields are in `currencyCode` units.
Sensitive defence accounts and player data are not included.

| Field              | Type           | Description                                               |
| ------------------ | -------------- | --------------------------------------------------------- |
| fiscalYear         | number         | Current fiscal year                                       |
| currencyCode       | string         | Currency for monetary fields                              |
| gdp / gdpSmoothed  | number \| null | Live GDP and ratio denominator                            |
| revenue            | object         | Total and source breakdown                                |
| spending           | object         | Total, categories, grants, and debt interest              |
| balance            | number         | Revenue less spending                                     |
| balancePctGdp      | number \| null | Balance as a percentage of smoothed GDP                   |
| treasuryBalance    | number \| null | Signed national cash position                             |
| debt               | object         | Principal, rate, ceiling, ratio, rating, and crisis state |
| taxRates           | object         | Current national tax rates                                |
| economicIndicators | object         | Inflation, GDP, wage, trade, and confidence readings      |
| updatedAt          | string \| null | ISO 8601 budget update timestamp                          |

### GET /api/public/v1/forex

Current currency-market snapshot without history. Returns `currencies[]` with
`countryId`, `currencyCode`, `rate`, `baseRate`, `macroTarget`, percentage
changes, 24-turn buy/sell/net volume, declared regime, intervention band,
cycle pressure, spread strength, and `updatedAt`.

Rates are local currency units per one internal anchor unit.

### GET /api/public/v1/forex/[currency]?history=N

One active currency plus trailing rate history. `history` defaults to 48 and
must be from 1 to 240. Response shape: `{ ok, found, currency }`; the currency
object has the collection fields above plus `history: [{ turn, rate }]`.

### GET /api/public/v1/trade/tariffs?country=CODE[&targetCountry=CODE][&scope=SCOPE][&limit=N]

Active tariff layers. `country` filters the country imposing the tariff;
`targetCountry` filters origin-country targets. `scope` accepts `economy_wide`,
`sector`, `origin_country`, or `corporation`. `limit` defaults to 100 and must be
from 1 to 200.

Response rows include `id`, `countryId`, `scopeType`, `targetSectorType`,
`targetOriginCountryId`, resolved `targetCorporation: { id, name }`, `rate`,
`sourceBillId`, `createdAt`, and `updatedAt`.

### GET /api/public/v1/trade/embargoes?country=CODE[&includePending=true]

Active ministerial, legislative, and organization trade restrictions. `country`
matches either the imposing or target country. The response includes
`currentTurn` and `embargoes[]` with source and target countries, commodity,
direction, mode, cap, origin, lifecycle turns, and public bill or organization
resolution provenance.

Pass `includePending=true` to add embargo and end-embargo bills still moving
through a legislature under `pending[]`. Internal acting-character IDs are not
returned.

### GET /api/public/v1/trade/flows?country=CODE[&commodity=KEY][&fromTurn=N][&toTurn=N][&limit=N]

Historical inter-country commodity trade, returned oldest to newest. `limit`
defaults to 48 and accepts 1-240. `fromTurn` and `toTurn` are inclusive.

Every point contains `turn`, `recordedAt`, and world `grossVolume`,
`clearedVolume`, and `unclearedSurplus`. Passing `country` adds that country's
exports, imports, net balance, and largest surplus and deficit partners.
Passing `commodity` adds its label and world volume. Passing both adds the
country's exports, imports, net, and uncleared amount for that commodity.

All monetary values use the game's anchor unit, reported as
`monetaryUnit: "anchor"`. Full bilateral matrices and internal reachable market
books are not exposed.

### GET /api/public/v1/sovereigns

World-wide sovereign-debt monitoring. Each `countries[]` row includes
`countryId`, `countryName`, `crisisState`, `creditRating`, consecutive failed
auctions, turns since default, debt-to-GDP, inflation, GDP growth, trust, coupon
rate, 10-turn FX depreciation, entity holdings, and required issuance.

`demand` contains the subscription ratio, `subscribed`, `undersubscribed`, or
`failed` band, and the public contribution breakdown. `sustainability` contains
the 0-100 Debt Sustainability Assessment score, band, and components.

### GET /api/public/v1/government?country=CODE

Government overview. Requires `country` query param.

| Field                     | Type           | Description                     |
| ------------------------- | -------------- | ------------------------------- |
| officials[].role          | string         | Position title                  |
| officials[].characterName | string \| null | Office holder name              |
| officials[].party         | string \| null | Party affiliation               |
| officials[].section       | string         | `"executive"` or `"leadership"` |
| cabinet                   | array          | Cabinet members                 |
| governmentFormation       | object         | Varies by regime type           |

### GET /api/public/v1/elections?country=CODE[&state=STATE]

Active elections. Requires `country`; optional `state`.

| Field                                  | Type    | Description                   |
| -------------------------------------- | ------- | ----------------------------- |
| elections[].id                         | string  | Election ObjectId             |
| elections[].electionType               | string  | Type (primary, general, etc.) |
| elections[].state                      | string  | State code                    |
| elections[].status                     | string  | Status (open, closed, etc.)   |
| elections[].candidates[].characterName | string  | Candidate name                |
| elections[].candidates[].party         | string  | Party name                    |
| elections[].candidates[].isNPP         | boolean | Non-party member              |

### GET /api/public/v1/elections/[id]

Detailed election info including candidates, votes, and phases.

| Field                 | Type           | Description                                     |
| --------------------- | -------------- | ----------------------------------------------- |
| election.electionType | string         | Type                                            |
| election.status       | string         | Current status                                  |
| election.totalSeats   | number         | Seats contested                                 |
| phase                 | object         | `{ inPrimary, inGeneral, isUpcoming, isEnded }` |
| incumbent             | object \| null | `{ name, party }` or null                       |
| candidates            | array          | Full candidate list with details                |
| votes                 | object \| null | Vote tallies and snapshots                      |

### GET /api/public/v1/news?limit=N[&category=CAT]

News feed. Optional `limit` and `category`.

| Field              | Type           | Description           |
| ------------------ | -------------- | --------------------- |
| posts[].id         | string         | Post ObjectId         |
| posts[].title      | string \| null | Headline              |
| posts[].content    | string \| null | Body text             |
| posts[].authorName | string \| null | Author                |
| posts[].isSystem   | boolean        | System-generated post |
| posts[].category   | string \| null | Category tag          |
| posts[].countryId  | string \| null | Related country       |
| posts[].createdAt  | string \| null | ISO 8601 timestamp    |

### GET /api/public/v1/legislation?country=CODE[&status=pending\|passed\|failed][&limit=N]

Bills and votes. Optional filters.

| Field           | Type           | Description                |
| --------------- | -------------- | -------------------------- |
| bills[].id      | string         | Bill ObjectId              |
| bills[].title   | string         | Bill title                 |
| bills[].sponsor | string \| null | Sponsor name               |
| bills[].status  | string         | pending, passed, or failed |
| bills[].vote    | object         | `{ yes, no, abstain }`     |
| bills[].effects | array          | `[{ metric, direction }]`  |

### GET /api/public/v1/market?type=SECTOR&country=CODE&page=N

Stock market data. `type` param required. Pass `view=share` for shares, `view=unowned` for unowned sectors.

| Field                | Type   | Description               |
| -------------------- | ------ | ------------------------- |
| mode                 | string | `"share"` or `"unowned"`  |
| sectorType           | string | Requested sector type     |
| page / totalPages    | number | Pagination                |
| companies \| sectors | array  | Results (depends on mode) |

### GET /api/public/v1/bonds?corp=NAME&page=N

Bond market data. Optional `corp` and `page`.

| Field                   | Type           | Description                                 |
| ----------------------- | -------------- | ------------------------------------------- |
| bonds[].id              | string         | Bond ObjectId                               |
| bonds[].couponRate      | number         | Coupon rate (e.g. 0.05 = 5%)                |
| bonds[].maturityLabel   | string \| null | Maturity description                        |
| bonds[].totalIssued     | number         | Total bonds issued                          |
| bonds[].marketPrice     | number         | Current market price                        |
| bonds[].yieldToMaturity | number \| null | YTM                                         |
| bonds[].defaulted       | boolean        | Whether bond is in default                  |
| pagination              | object         | `{ page, perPage, totalCount, totalPages }` |

### GET /api/public/v1/corporations

List all corporations. Returns `corporations[]` of `{ id, name, sequentialId, type, countryId }`.

### GET /api/public/v1/corporation?name=X[&id=N]

Corporation details. Requires `name` or `id`. Note: `id` is the corporation's `sequentialId` (e.g. 112), not the Mongo ObjectId.

| Field            | Type           | Description                                       |
| ---------------- | -------------- | ------------------------------------------------- |
| id               | string         | Corporation ObjectId                              |
| name             | string         | Corporation name                                  |
| type / typeLabel | string         | Corporation type (+ human-readable label)         |
| ceo              | object \| null | `{ name, profileUrl }`                            |
| financials       | object         | Revenue, income, costs, dividends                 |
| balanceSheet     | object         | `{ cashOnHand, marketCapitalization, totalDebt }` |
| shareStructure   | object         | Shares, price, float, shareholders                |
| creditRating     | object         | Rating, score, components                         |
| bonds            | array          | Corporate bonds                                   |
| sectors          | array          | Operational sectors                               |

### GET /api/public/v1/leaderboard?country=CODE[&metric=METRIC][&limit=N]

Player rankings. Metrics: `npi`, `pi`, `favorability`, `funds`, `actions`.

| Field                           | Type   | Description      |
| ------------------------------- | ------ | ---------------- |
| metric                          | string | Requested metric |
| characters[].rank               | number | Position         |
| characters[].name               | string | Character name   |
| characters[].party              | string | Party name       |
| characters[].funds              | number | Campaign funds   |
| characters[].politicalInfluence | number | PI score         |
| characters[].profileUrl         | string | Profile link     |

### GET /api/public/v1/country/[code]/history?limit=N[&type=TYPE][&beforeTurn=N]

Append-only country event log (leader changes, bill enactments, referendums, regime changes, international relations). Written by the turn processor.

| Param      | Type   | Description                                                                     |
| ---------- | ------ | ------------------------------------------------------------------------------- |
| limit      | number | 1-200, default 50                                                               |
| type       | string | Filter by eventType (e.g. `leader_change`, `bill_enacted`, `referendum_passed`) |
| beforeTurn | number | Pagination cursor: events strictly before this turn                             |

Response rows: `events[].turn`, `eventType`, `title`, `officeType`, `characterId` / `characterName` / `party`, `billScope`, `details`, `iterationStartingYear`, `timestamp`.

### GET /api/public/v1/country/[code]/battles?limit=N

Recent battle reports involving the country (as declarer or target), newest turn first.

Response rows: `battles[].theaterId`, `declarerCountry`, `targetCountry`, `attackers`, `defenders`, `turn`, `result` (null = no contact), `noContact`, `unopposedAdvance`, `controlBefore` / `controlAfter` (front-line movement, null when unknown).

### GET /api/public/v1/conflicts?country=CODE[&status=STATUS][&limit=N]

Conflicts, newest first. Filter by involved country (host or belligerent) and/or status (`active`, `escalating`, `winding_down`, `resolved`).

Response rows: `conflicts[].conflictId` (public sequential number), `name`, `hostCountry`, `region`, `type`, `status`, `bloc`, `terrain`, `severity`, `intensity`, `control` (share of host held by side B, 0-100), `supplyA` / `supplyB`, and both sides as `{ label, countries, kind, backer }`.

### GET /api/public/v1/parties?country=CODE

All parties for a country, ordered by member count. Seat counts come from the elected-officials roster so they reconcile with the legislature endpoints.

Response rows: `parties[].id` (sequential id usable with `/party?id=`), `name`, `abbreviation`, `color`, `economicPosition`, `socialPosition`, `memberCount`, `seatCount`, `treasury`, `isDefault`.

### GET /api/public/v1/elections/archives?country=CODE[&limit=N][&type=TYPE]

Completed/resolved elections for a country, newest first.

Response rows: `elections[].id`, `seatId`, `electionType`, `state`, `cycle`, `electionYear`, `totalSeats`, `startTime` / `endTime`, `status`, `totalVotes`, `finalized`, `candidateCount`, and `winner: { characterName, party, votes }` when a final tally exists.

### GET /api/public/v1/referendums?country=CODE[&status=STATUS][&limit=N]

Referendum campaigns and history, newest update first. `country` and `status`
are optional; `limit` defaults to 50 and must be from 1 to 200.

Response rows: `referendums[].id`, `countryId`, `region: { id, name }`, `kind`,
`targetCountryId`, `status`, lifecycle turns under `timing`, current and baseline
Yes shares, `pollHistory`, resolved public party positions, and `result` with
Yes/No shares, turnout, pass/fail, and resolution turn. Internal cohort models
and campaign-spend ledgers are not exposed.

### GET /api/public/v1/referendums/[id]

One referendum by ObjectId with the same shape as a collection row, wrapped as
`{ ok, found, referendum }`.

### GET /api/public/v1/organizations

International organization summaries. Returns `count` and `organizations[]`
with identity, category, founding and dissolution years, leadership office and
holder, full member roster, voting-member count, and activity counts for
membership proposals, resolutions, leadership elections, and withdrawals.

### GET /api/public/v1/organizations/[id]

One built-in or custom organization, matched case-insensitively. Adds `charter`,
pending membership proposals, pending and active resolutions, leadership
elections, and pending withdrawals.

Vote objects contain aggregate `yes`, `no`, and `abstain` totals plus each
country's public position and cast turn. Proposer and voter character IDs are
not exposed.

### GET /api/public/v1/commodities?country=CODE

All commodity markets. Each row includes `key`, `label`, `unit`, `basePrice`,
global price/supply/demand, and `turn`. Passing `country` adds national
price/supply/demand.

### GET /api/public/v1/commodity/[key]?country=CODE

One commodity with state price/supply/demand maps plus its top ten producers
and consumers. Passing `country` limits state data to that country.

### GET /api/public/v1/funds[?slug=SLUG][&country=CODE][&scope=country\|global]

Index funds. Without `slug`: list all funds sorted by NAV. With `slug`: full detail including top holdings enriched with corporation names.

List rows: `funds[].slug`, `name`, `tickerSymbol`, `scope`, `kind`, `countryId`, `sectorType`, `status`, `pauseReason`, `quotedNav`, `unitSupply`, `anchorCurrencyCode`, `backingRatio`, `sponsorName`, `expenseRatioAnnual`, `updatedAt`.

Detail adds: `reserveUnits`, `cashAnchor`, `lastRebalancedAt`, `charteredAtTurn`, `seedCapitalAnchor`, `windDownStartedAtTurn`, `topHoldings[]` of `{ corporationId, corporationName, shares, lastValueAnchor, avgCostPerShareAnchor }`.

### GET /api/public/v1/corporation/shares/history?name=X[&id=N][&page=N][&pageSize=N]

Public share-trade tape for one corporation (same data the in-game corp page shows). Requires `name` or `id` (sequential id).

Response: `corporation: { id, name }`, `page`, `pageSize`, `total`, `pageCount`, and `entries[]` of `{ kind, turn, createdAt, shares, pricePerShareAnchor, totalAnchor, corpCurrencyCode, from: { name }, to: { name }, note }`. `from`/`to` are null when the public float is that side.

### GET /api/public/v1/characters/bulk?ids=1,7,42

Bulk character lookup for dashboards: up to 100 comma-separated sequential ids in one request. Unknown and invalid ids are skipped (match on what came back).

Response: `ok`, `found`, `requested` / `returned` counts, and `characters[]` with the same shape as the search endpoint.

### GET /api/public/v1/meta

Machine-readable catalog of every v1 endpoint with its params, plus base URL,
auth header, rate limits, OpenAPI URL, and the stability contract. Bots can
validate their integration against this instead of scraping docs.

### GET /api/public/v1/openapi.json

OpenAPI 3.1 contract generated from the same route catalog as `/meta`. It
describes every public v1 path, query and path parameters, both supported auth
headers, standard error responses, and rate-limit headers. Use it to generate a
client or import the interface into API tooling.

```bash
curl -H "X-API-Key: $AHD_API_KEY" \
  https://ahousedividedgame.com/api/public/v1/openapi.json
```

### GET /api/public/v1/cdn

Machine-readable catalog of the public static asset CDN, so clients can build image URLs instead of hardcoding the bucket layout. The key gates this directory document only; the assets themselves are public files.

Response: `ok`, `cdnBase`, `urlPattern` (`{cdnBase}/static/{category}/{slug}.{ext}`), `defaultExtension` (`webp`), `categories[]` of `{ name, description, urlTemplates[], slugs?, notes? }`, and `assets` with named, fully resolved URLs and slug sets. A category asserts the URL scheme, not that every possible slug exists.

### GET /api/v1/leaderboard[?metric=influence|favorability|funds][&country=CODE][&limit=N][&playersOnly=true]

Top politicians in one country by Political Influence (default), favorability or campaign funds. No key is required. `country` defaults to `US`; `limit` defaults to 10 (1 to 50). `funds` values are in that country's currency.

Response: `metric`, `country`, `nativeCurrencyCode`, `playersOnly`, `limit`, and `entries[]` of `{ id, sequentialId, name, party, homeState, currentOffice, avatarUrl, value, isNPP }`.

### GET /api/v1/leaderboard/legacy[?scope=all|current][&rankBy=legacy|netWorth]

Cross-iteration career records: each account's strongest political or business career plus lifetime laws, contest results and achievements. No key is required; signed-in callers also get their own rank.

### GET /api/v1/key

Describes the key you send: works with any scope and only ever returns the presenting key. Rate limit 30 req/min per key, separate from transfer and forex quotas.

Response: `success`, `key: { id, name, prefix, scope, createdAt, lastUsedAt, requestCount, revokeAt }`, `ownerUserId`, and `allowedOperations` (`["read"]` for public keys, `["read", "transfer", "forex"]` for private keys). `revokeAt` is set while a rotation grace window is running; the key stops working at that time.

## Private endpoints (send funds and forex)

Require a **private** personal API key. All in-game restrictions apply identically to API requests.

### POST /api/v1/transfer

Send campaign funds to another character.

Request body:

```json
{ "targetCharacterId": "<recipient ObjectId>", "amount": 5000 }
```

`amount` is in your character's home currency (same unit as your in-game balance, min 1000, integer).

Response: `success`, `amount`, `currency` (sender home currency code), `senderRemainingFunds`, `targetName`.

Restrictions:

- Minimum transfer: 1,000 (home currency)
- Sender and target must be in the same country
- Cannot transfer to yourself
- Must have sufficient campaign funds
- Transfers may be paused by admins (returns 403)

### POST /api/v1/forex/exchange

Execute a forex market order.

Request body:

```json
{ "fromCurrency": "USD", "toCurrency": "GBP", "amount": 1000 }
```

Response: `success`, `trade.fromCurrency`, `trade.toCurrency`, `trade.fromAmount`, `trade.toAmount`, `trade.effectiveRate`, `trade.spreadCharged`. The base market spread is 1%, scaled by the source currency's central-bank spread strength (0.5x to 1.5x). Player trades also pay a size and liquidity adjustment: larger recent trading and thinly traded pairs cost more, and splitting a trade does not avoid it. Of the fee, 50% is destroyed and 50% goes to the central bank.

Restrictions:

- Cannot trade a currency for itself
- Forex must be enabled on the server
- Must have sufficient funds in source currency
- Character must exist and be in an active country

## Quick start

```bash
# Read public data (any key)
curl -H "X-API-Key: $AHD_API_KEY" \
  https://ahousedividedgame.com/api/public/v1/game

# Send funds (private key)
curl -X POST -H "X-API-Key: $AHD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"targetCharacterId":"507f1f77bcf86cd799439011","amount":5000}' \
  https://ahousedividedgame.com/api/v1/transfer
```

Python:

```python
import os, requests

BASE = "https://ahousedividedgame.com"
headers = {"X-API-Key": os.environ["AHD_API_KEY"]}

game = requests.get(f"{BASE}/api/public/v1/game", headers=headers).json()
print(f"Turn {game['currentTurn']}")
```
