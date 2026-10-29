# Japan - Government Structure

## Overview

Japan is a parliamentary constitutional monarchy. The Emperor is a ceremonial head of state with no political power. The Prime Minister leads government through confidence in the House of Representatives (Shugiin), the lower chamber of the bicameral National Diet.

## National Diet (Legislature)

### House of Representatives (Shugiin)

- **465 seats** allocated by Hare-quota PR across 8 regional constituencies
- **4-year terms**, but can be dissolved by the PM for snap elections
- Invests confidence in the Cabinet - the PM must command a Shugiin majority
- Bills may originate in the Shūgiin, the Sangiin, or Cabinet review; the Shūgiin has override power over the Sangiin (2/3 supermajority)

### House of Councillors (Sangiin)

- **248 seats** allocated by Hare-quota PR on staggered 6-year terms
- Half elected every 3 game years (2 classes, alternating)
- Cannot be dissolved - provides legislative continuity
- Revises and can reject legislation, but Shugiin override is available

## Executive

### Prime Minister

- Appointed via confidence vote in the Shugiin (lower house only)
- No fixed term - serves until losing confidence, resigning, or snap election
- Can dissolve the Shugiin and trigger snap elections (limit 2 per appointment, 336-turn cooldown)
- Appoints all Cabinet members directly (no Diet confirmation)

### Emperor

- Ceremonial head of state - Emperor Naruhito
- No political role in the game (NPP marked as retired)
- Represents constitutional continuity

## Cabinet

11 ministerial positions, each with metric responsibilities:

1. Chief Cabinet Secretary - governance, transparency, press relations
2. Minister of Finance - economy, employment, income
3. Minister of Foreign Affairs - GDP growth, international relations
4. Minister of Justice - judicial and legal affairs
5. Minister of Defense - public safety, national security
6. Minister of Economy, Trade and Industry - business formation, robotics
7. Minister of Health, Labour and Welfare - healthcare, elder care, work-life balance
8. Minister of Education, Culture, Sports, Science and Technology - test performance, workforce skill
9. Minister of Land, Infrastructure, Transport and Tourism - transport, disaster preparedness
10. Minister of the Environment - air quality, renewables, disaster preparedness
11. Minister of Internal Affairs and Communications - broadband, demographic decline, turnout

### Cabinet Bills (Japan-specific mechanic)

The PM or any Cabinet member can propose bills through Cabinet review before they enter the normal Diet pipeline. See `japan-elections.md` for the full cabinet bill lifecycle.

## Regions

8 game regions (each containing multiple prefectures). Every region contests both Sangiin classes; Class 1 gets `ceil` and Class 2 `floor` of the regional total:

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

## Political Parties

6 default parties:

- **LDP** (Liberal Democratic Party) - centre-right, dominant ruling party
- **CDP** (Constitutional Democratic Party) - centre-left, main opposition
- **Komeito** - centrist, LDP coalition partner (Soka Gakkai-aligned)
- **JCP** (Japanese Communist Party) - left-wing
- **Nippon Ishin no Kai** - neoliberal reform, Kansai stronghold
- **DPFP** (Democratic Party for the People) - centrist reformist

## Regional Government

Each of the 8 regions elects a Governor on a 4-year cycle and a Regional
Council. A Prime Minister may appoint eligible Cabinet members seated in
either the Shūgiin or the Sangiin.

## Metrics

Japan-specific regional metrics:

- `elderCareQuality` - elder care capacity (world's oldest population)
- `naturalDisasterPreparedness` - earthquake/tsunami/typhoon readiness
- `transportEfficiency` - Shinkansen and transit network quality
- `workLifeBalance` - overwork/karoshi index
- `demographicDecline` - birth rate trends, population aging
- `roboticsAdoption` - industrial and service robotics deployment

## Central Bank

Bank of Japan (BoJ) - Governor of the Bank of Japan, default prime rate 1.0%.

## Stock Exchange

Nikkei - displayed on the `/country/jp/stockmarket` page.
