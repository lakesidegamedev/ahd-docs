# United Kingdom

The UK uses the shared political and economic simulation with a parliamentary
monarchy, country-specific electorate data, Commons elections, devolved
regional offices, Prime Minister formation votes, and an era-aware Cabinet.

## Regions and Commons seats

UK gameplay uses 12 regions for residency, elections, demographics, and
regional policy. The live modern Commons allocation comes from
`UK_COMMONS_SEATS` in `src/lib/constants/states.ts`:

| Code | Region                   | Commons seats |
| ---- | ------------------------ | ------------: |
| LON  | London                   |            75 |
| SEE  | South East England       |            90 |
| SWE  | South West England       |            58 |
| EAE  | East of England          |            60 |
| EMI  | East Midlands            |            47 |
| WMI  | West Midlands            |            57 |
| YHU  | Yorkshire and the Humber |            54 |
| NWE  | North West England       |            75 |
| NEE  | North East England       |            27 |
| SCO  | Scotland                 |            57 |
| WAL  | Wales                    |            32 |
| NIR  | Northern Ireland         |            18 |

The modern total is 650, with a majority threshold of 326. The
`1953-default` preset uses `UK_COMMONS_SEATS_1953`, totaling 625 seats with a
313-seat majority. Do not use the `UK_REGIONS.constituencies` display metadata
for seat allocation.

UK regions use adapted census dimensions and country-specific group weights.
They do not simply reuse the US demographic group ids.

## House of Commons elections

- Each region runs one multi-seat `commons` race.
- Seats are allocated using Hare-quota largest remainder (`pr_hareQuota`).
- The active election window is 48 hours: 24 hours of primary and 24 hours of
  general election.
- The regular cycle is 240 turns, or 5 game years. A snap election resets the
  next regular-cycle anchor.
- Candidacy is normally tied to the character's home region, subject to the
  live entry rules for the office and candidate.

See [UK Elections](./uk-elections.md) for preset-aware seat maps, vacancy
handling, and cycle timing.

## Government formation

The canonical record is `governmentFormations`, updated through
`src/lib/turn/parliamentaryGovernment.ts`. Its status is `pending`, `formed`,
or `collapsed`.

After a Commons cycle, seat totals are refreshed and lower-chamber members may
nominate a Prime Minister through the shared appointment-vote flow. Formation
may be recorded as a majority, coalition, or minority government. Coalition
party ids and their supporting seats are included when applicable. A successful
appointment writes the PM to `governmentFormations`, marks the government
formed, and clears the previous cabinet.

Votes of no confidence need a majority of all Commons seats (`floor(totalSeats / 2) + 1`), not a majority of votes cast. Any eligible
lower-chamber member may propose and vote; the mechanism is not restricted to
the governing block. See [Parliamentary Government](./parliamentary-government.md)
and [PM and No Confidence](./uk-pm-no-confidence.md).

The canonical Downing Street route is `/country/uk/executive`.
`/executive/uk` and `/uk/government` redirect there.

## Cabinet

The sitting PM appoints eligible player-controlled MPs to era-aware positions
from `UK_CABINET_POSITIONS`. Appointees need not belong to the governing party
or coalition. An appointment starts a 24-turn lock for that cabinet seat; the
lock remains if the minister is fired. See [UK Cabinet](./uk-cabinet.md).

## Legislation

UK national bills use `UK_NATIONAL_CONFIG` in
`src/lib/countries/uk/elections/billLifecycle.ts`:

1. The Commons votes by simple majority.
2. About 28% of passed bills enter a 1 to 2 turn Lords-revision hold.
3. The bill then receives automatic Royal Assent and is enacted.

The Lords are not a playable elected chamber. While
`governmentFormations.status` is `pending`, the UK lifecycle is frozen through
`skipWhenGovPending` and resumes automatically when a government forms.

## Devolved regional executives

Scotland, Wales, and Northern Ireland use First Minister labels; London uses a
Mayor. English regions outside London do not have a devolved executive office.
Regional legislation and assent use the country-aware regional office mapping
described in [State-Level Power](./state-level-power.md).

## Related pages

- [UK Elections](./uk-elections.md)
- [UK Cabinet](./uk-cabinet.md)
- [Parliamentary Government](./parliamentary-government.md)
- [Snap Elections](./snap-elections.md)
- [UK PM and No Confidence](./uk-pm-no-confidence.md)
