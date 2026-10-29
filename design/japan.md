# Japan - Government Structure

## Summary

Japan is a parliamentary constitutional monarchy. The Emperor is a ceremonial head of state with no political power. The Prime Minister leads government through confidence in the House of Representatives (Shugiin), the lower chamber of the bicameral National Diet. This page is the structure reference for the country: chambers, executive, Cabinet, regions, parties, regional government, metrics and central bank.

Player guide: [Japan](https://www.ahousedividedgame.com/wiki/jp-overview). Election, snap election and bill rules with their sources: [Japan - Elections & Bills](./japan-elections.md). Figures below are for the modern default preset; the 1953 and 1991 presets use different seat totals, listed in that page.

## Rules

Configuration lives in `src/lib/countries/jp/institutionsFacts.ts`, seats in `src/lib/countries/jp/data/jpSeats.ts`, cabinet in `src/lib/countries/jp/cabinet/positions.ts`, regions in `src/lib/countries/jp/data/jpRegionDirectory.ts`.

### National Diet (Legislature)

#### House of Representatives (Shugiin)

- **465 seats** allocated by Hare-quota PR across 8 regional constituencies
- **4-year terms** (`termYears` 4), but can be dissolved by the PM for snap elections
- Invests confidence in the Cabinet - the PM must command a Shugiin majority
- Bills may originate in the Shūgiin, the Sangiin, or Cabinet review; the Shūgiin has override power over the Sangiin (2/3 supermajority)

#### House of Councillors (Sangiin)

- **248 seats** allocated by Hare-quota PR on staggered 6-year terms
- Half elected every 3 game years (2 classes, alternating)
- Cannot be dissolved - provides legislative continuity
- Revises and can reject legislation, but Shugiin override is available

### Executive

#### Prime Minister

- Appointed via confidence vote in the Shugiin (lower house only)
- No fixed term - serves until losing confidence, resigning, or snap election
- Can dissolve the Shugiin and trigger snap elections (limit 2 per appointment, 336-turn cooldown)
- Appoints all Cabinet members directly (no Diet confirmation); eligible members sit in either the Shugiin or the Sangiin (`cabinetEligibleChamberKeys`)
- Office type `primeMinister` config: `actionBonus` 4, `partyStrengthWeight` 1 (`institutionsFacts.ts`)

#### Emperor

- Ceremonial head of state - Emperor Naruhito
- No political role in the game (the old real-person ceremonial NPP is retired and cleaned up by the seeder, `removeLegacyJPCeremonialIdentity` in `src/lib/countries/jp/seed.ts`)
- Represents constitutional continuity
- The imperial character (title Emperor, Empress or Emperor by gender, `imperialTitles`) is tied to the imperial corporation `Chrysanthemum Properties` in the `real_estate` sector (`imperialCorporation` in `institutionsFacts.ts`)

### Cabinet

11 ministerial positions (`src/lib/countries/jp/cabinet/positions.ts`; metric duties in `mechanics.ts`), each with metric responsibilities:

| # | Position | Metrics it answers for (`mechanics.ts`) |
| --- | --- | --- |
| 1 | Chief Cabinet Secretary | `governmentTransparency`, `publicTrust`, `pressFreedom` |
| 2 | Minister of Finance | `gdpGrowth`, `unemploymentRate`, `medianIncome`, `costOfLiving` |
| 3 | Minister of Foreign Affairs | `gdpGrowth`, `governmentTransparency` |
| 4 | Minister of Justice | `corruptionIndex`, `crimeRate`, `publicTrust` |
| 5 | Minister of Defense | `publicSafetyConfidence`, `naturalDisasterPreparedness`, `publicTrust` |
| 6 | Minister of Economy, Trade and Industry | `gdpGrowth`, `smallBusinessFormation`, `roboticsAdoption` |
| 7 | Minister of Health, Labour and Welfare | `elderCareQuality`, `lifeExpectancy`, `physicianRate`, `workLifeBalance` |
| 8 | Minister of Education, Culture, Sports, Science and Technology | `testPerformance`, `workforceSkill`, `educationSpending`, `academicPressure` |
| 9 | Minister of Land, Infrastructure, Transport and Tourism | `transportEfficiency`, `publicTransit`, `roadCondition`, `naturalDisasterPreparedness` |
| 10 | Minister of the Environment | `airQuality`, `carbonEmissions`, `renewableEnergy`, `nuclearSafety` |
| 11 | Minister of Internal Affairs and Communications | `broadbandAccess`, `demographicDecline`, `voterTurnout`, `ruralRevitalization` |

The finance post is `finance_minister` (`financeMinisterCabinetId`). All 11 positions are enabled from year 1775 (`yearEnabled`), so every era has the full set.

#### Cabinet Bills (Japan-specific mechanic)

The PM or any Cabinet member can propose bills through Cabinet review before they enter the normal Diet pipeline. See [Japan - Elections & Bills](./japan-elections.md) for the full cabinet bill lifecycle.

### Regions

8 game regions (each containing multiple prefectures; the 47 prefectures are the seeded administrative units, the 8 regions are the planning regions elections use). Every region contests both Sangiin classes; Class 1 gets `ceil` and Class 2 `floor` of the regional total:

| ID  | Name             | Population | Shugiin | Sangiin | Class 1 | Class 2 |
| --- | ---------------- | ---------- | ------- | ------- | ------- | ------- |
| HOK | Hokkaido         | 5.2M       | 12      | 7       | 4       | 3       |
| TOH | Tohoku           | 8.6M       | 37      | 20      | 10      | 10      |
| KAN | Kanto            | 43.5M      | 150     | 80      | 40      | 40      |
| CHU | Chubu            | 21.1M      | 81      | 44      | 22      | 22      |
| KNS | Kansai           | 22.5M      | 82      | 44      | 22      | 22      |
| CGK | Chugoku          | 7.1M       | 28      | 14      | 7       | 7       |
| SHI | Shikoku          | 3.7M       | 14      | 8       | 4       | 4       |
| KYU | Kyushu & Okinawa | 14.3M      | 61      | 31      | 16      | 15      |

Totals: Shugiin 465, Sangiin 248 (Class 1 125, Class 2 123). Source: `jpRegionDirectory.ts` and `jpSeats.ts`.

### Political Parties

6 default parties in the modern scenario (`src/lib/countries/jp/data/jpParties.ts`; the 1953 and 1991 presets seed their own parties):

- **LDP** (Liberal Democratic Party) - centre-right, dominant ruling party
- **CDP** (Constitutional Democratic Party) - centre-left, main opposition
- **Komeito** - centrist, LDP coalition partner (Soka Gakkai-aligned)
- **JCP** (Japanese Communist Party) - left-wing
- **Nippon Ishin no Kai** - neoliberal reform, Kansai stronghold
- **DPFP** (Democratic Party for the People) - centrist reformist

The major-party pair used for spoiler modelling is `["ldp", "cdp"]` (`majorPartyIds`), with Ishin and LDP in Kansai.

### Regional Government

Each of the 8 regions elects a Governor and a Regional Council, both on a 4-year term (`termYears` in `src/lib/countries/jp/institutionsFacts.ts`). The Regional Council chamber has 2,679 seats in total (`subNationalChamber.seats`). A Prime Minister may appoint eligible Cabinet members seated in either the Shūgiin or the Sangiin.

### Metrics

Japan-specific regional metrics:

- `elderCareQuality` - elder care capacity (world's oldest population)
- `naturalDisasterPreparedness` - earthquake/tsunami/typhoon readiness
- `transportEfficiency` - Shinkansen and transit network quality
- `workLifeBalance` - overwork/karoshi index
- `demographicDecline` - birth rate trends, population aging
- `roboticsAdoption` - industrial and service robotics deployment

### Central Bank

Bank of Japan (BoJ) - Governor of the Bank of Japan, 5-year term, default prime rate 1.0% (`defaultPrimeRate` in `src/lib/countries/jp/institutionsFacts.ts`; `termYears` 5, `actionBonus` 3, `partyStrengthWeight` 0).

### Stock Exchange

Nikkei (`exchangeName`) - displayed on the `/country/jp/stockmarket` page.

## Data

This is a structure page, so the data is mostly static configuration seeded into the world.

| Collection or object | Content | Player-visible |
| --- | --- | --- |
| `states` | The 8 regions (population, `houseDistricts`, Sangiin seats) | Yes, map and region pages |
| `seats` | Seat totals per chamber and region | Yes |
| `electedOfficials`, `characters`, `npps` | Who holds each Diet seat, governor and council seat | Yes |
| `governmentFormations` (`_id: "JP"`) | PM, status, majority threshold, snap counters | Yes |
| `cabinetMembers` | Holders of the 11 Cabinet positions | Yes |
| `politicalParties` | The default parties | Yes |
| `JP_CABINET_POSITIONS`, `JP_CABINET_MECHANICS` | Code constants, not stored | Shown on office pages |

## Configuration

| Setting | Value and file |
| --- | --- |
| Seats per chamber by preset | `src/lib/countries/jp/data/jpSeats.ts` (modern 465 and 248, `1953-default` 466 and 248, `1991-default` 512 and 252) |
| `lowerElectionSystem` / `upperElectionSystem` | Term 4 and 6 years, partial contest for the upper chamber, 2 staggered classes (`institutionsFacts.ts`) |
| `electionSystems` | `pr_hareQuota` for all three chambers (`institutionsFacts.ts`, era files) |
| `coalitionThreshold` | 233 (`institutionsFacts.ts`); 234 in `eras/1953.ts` |
| `cabinetBillsEnabled`, `cabinetEligibleChamberKeys` | true, `["shugiin", "sangiin"]` |
| `centralBank.defaultPrimeRate` | 1 (per cent) |
| `governmentType` | `parliamentaryMonarchy` |
| `fiscalYearStartTurnInYear` | 40 |
| `gameState.preset` | World seed; picks the era overrides in `src/lib/countries/jp/eras/` |

## Timing

Structure is static; the behaviours it enables run in the phases described in [Japan - Elections & Bills](./japan-elections.md): election phases `jpElections`, `jpCouncillorElections`, `jpGovernorElections`, `jpRegionalCouncilElections`, the bill lifecycle phase, and the PM vacancy watcher. Cabinet metric duties are read when an office page is rendered, not on a schedule.

## Worked trace

Seat arithmetic for the modern preset, carried from the region table to the thresholds:

1. Kyushu & Okinawa has 31 Sangiin seats, split across two classes: Class 1 `ceil(31 / 2)` = 16, Class 2 `floor(31 / 2)` = 15. Summing all regions: Class 1 `4+10+40+22+22+7+4+16` = 125, Class 2 `3+10+40+22+22+7+4+15` = 123, total 248.
2. Shugiin regions sum `12+37+150+81+82+28+14+61` = 465.
3. Majority of the chamber: `floor(465 / 2) + 1` = 233, so a party on 220 seats needs 13 more.
4. A bloc may propose a PM as a minority government from `ceil(465 x 0.1538)` = `ceil(71.517)` = 72 seats.
5. The Cabinet adds 11 appointed ministers under the PM; the PM can only appoint members of the Shugiin or Sangiin.

## Edge cases and limits

- The Emperor has no vote and no office slot in the Diet or Cabinet.
- Cabinet members must sit in the Shugiin or Sangiin (`cabinetEligibleChamberKeys`); the PM appoints them directly with no Diet confirmation.
- The 1953 and 1991 presets change seat totals, parties and thresholds; the table above is the modern preset only.
- Regions group prefectures; elections and seat tables never address a prefecture directly.
- The Regional Council seat total (2,679) is a config figure for the whole country, not split in this table.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Regional Shugiin seats sum to the chamber total, Sangiin classes sum to the Sangiin total | `src/lib/countries/jp/data/jpSeats1991.test.ts` and `src/lib/countries/jp/japanReachable.test.ts` (seat tables) |
| Class 1 and Class 2 never create phantom seats | `getJpSangiinClassSeats`, tested in `jpSeats1991.test.ts` |
| Japan stays reachable through country registries (config, identity, cabinet, seed data) | `src/lib/countries/jp/japanReachable.test.ts` |
| The six default parties for the modern world | `src/lib/countries/jp/data/jpParties2027.test.ts` |
| Cabinet positions list matches mechanics ids | Not enforced by a dedicated test |

## Failure and recovery

- **Seat or region data drifts from the tables** (a reseed with an old map): the JP readiness expectations (`src/lib/countries/jp/data/jpReadinessExpectations.ts`, `seatMin` 713 = 465 + 248) report seeding shortfalls, and a reseed or heal of the seat and region documents corrects it.
- **Legacy ceremonial identity records** from older seeders are removed by `removeLegacyJPCeremonialIdentity` on seed.
- **Missing Cabinet holders** leave positions unfilled; they are re-filled by PM appointment, and the government approval cost applies until then.

## Connections

**Driven by:**
- [Japan - Elections & Bills](./japan-elections.md): who holds the Diet and Regional Council seats.
- [Parliamentary Government](./parliamentary-government.md): who is PM and which Cabinet is seated.

**Affects:**
- Cabinet office pages: the metric duties in `JP_CABINET_MECHANICS` set what each minister sees and moves.
- Elections: seat tables and region data feed `ensureJPElections` and the other JP spawners (`src/lib/countries/jp/elections/perpetual.ts`).
- The map, stock exchange and central bank pages for Japan.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/countries/jp/japanReachable.test.ts` | Config, identity, institutions, seat tables and cabinet data reachable through registries |
| `src/lib/countries/jp/data/jpSeats1991.test.ts` | Seat maps per preset, class split |
| `src/lib/countries/jp/data/jpParties2027.test.ts` | Modern party set |
| `src/lib/countries/jp/data/jpRegions2027.test.ts`, `jpRegionCensusData2027.test.ts`, `jpRegionCensusData1991.test.ts` | Region and census data |
| `src/lib/countries/jp/data/jpMetricPresets.test.ts` | Metric presets |

Gaps: no test ties the Cabinet position list to the mechanics table, and no test checks the Regional Council seat total.

## Known issues and history

- The Shugiin description in `institutionsFacts.ts` still says "elected by FPTP" and `singleMemberConstituencies` is true; the engine reads `electionSystems` (Hare-quota PR), which is what this page documents.
- The Cabinet table here replaces the older prose list, which described the Minister of Foreign Affairs as covering "international relations" and the Justice minister as "judicial and legal affairs"; the code lists those metrics explicitly (`mechanics.ts`).
- The Emperor's real-person ceremonial NPP was retired and is removed by the seeder.

Last checked: 2026-10-29, version 1.18.0
