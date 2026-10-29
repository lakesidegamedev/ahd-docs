# Elections

Margin of Victory has 49 elections in six countries. Each one has its own candidates, parties, map, starting position and historical events. This page lists them, says how each country is won, and says which ones are free and which are not.

## Access

| What | Price | Includes |
| --- | --- | --- |
| Free | $0 | US 2024, US 2020 and the daily challenge |
| Country bundle | $0.99 each | United States (15 more races, 1960 to 2016), United Kingdom (18), Canada (4), Germany (3), France (4), Australia (3) |
| Complete Collection | $3.99 | Every country bundle, including elections added later |
| Supporter+ and Supporter++ | Your plan | Include the Complete Collection while the plan is active |

Prices are the web store's. Phone and Steam stores follow the same bundles and may show different local prices. Bundles are one-time purchases. Anyone who owned the retired Global pack keeps Canada, Germany, France and Australia. Locked elections show an Unlock prompt where you can buy or redeem a code (see [Getting started](getting-started.md)).

## How each country is won

| Country | Elections | How it is decided | Bar to win |
| --- | --- | --- | --- |
| United States | 17 | Electoral College, state by state | 270 of 538 electoral votes |
| United Kingdom | 18 | First past the post, seat by seat | A Commons majority, 326 of 650 in recent elections |
| Canada | 4 | First past the post across provinces and territories | 172 of 343 seats in 2025 |
| Germany | 3 | Proportional representation in the Bundestag | 316 of 630 seats in 2025, usually through a coalition |
| France | 4 | Two-round presidential election | A majority in the runoff |
| Australia | 3 | Preferential voting for the House of Representatives | 76 of 150 seats in 2025 |

Every state is winner-take-all in a US race except Maine and Nebraska, which give one vote to the winner of each congressional district and two to the statewide winner. Details are on [Polls and scoring](polls-and-scoring.md).

## United States (17)

1960 Kennedy v. Nixon, 1964 Johnson v. Goldwater, 1968 Humphrey v. Nixon, 1972 McGovern v. Nixon, 1976 Carter v. Ford, 1980 Carter v. Reagan, 1984 Mondale v. Reagan, 1988 Dukakis v. Bush, 1992 Clinton v. Bush, 1996 Clinton v. Dole, 2000 Gore v. Bush, 2004 Bush v. Kerry, 2008 Obama v. McCain, 2012 Obama v. Romney, 2016 Clinton v. Trump, 2020 Biden v. Trump, 2024 Harris v. Trump.

## United Kingdom (18)

1951 Churchill's comeback, 1964 Wilson v. Douglas-Home, 1966 Wilson's landslide, 1970 Heath's upset, February 1974 Who governs Britain?, October 1974 Wilson's slim majority, 1979 Winter of Discontent, 1983 The Falklands election, 1987 Thatcher's third, 1992 Major's surprise, 1997 Things Can Only Get Better, 2001 The quiet landslide, 2005 Blair's third act, 2010 The TV-debate election, 2015 Cameron v. Miliband, 2017 May's gamble, 2019 Get Brexit Done, 2024 Starmer's landslide.

## Canada (4)

2015 Trudeau v. Harper, 2019 Trudeau v. Scheer, 2021 Trudeau v. O'Toole, 2025 Carney v. Poilievre.

## Germany (3)

2017 Merkel v. Schulz, 2021 Scholz v. Laschet, 2025 Merz v. Scholz.

## France (4)

2012 Hollande v. Sarkozy, 2017 Macron v. Le Pen, 2022 Macron v. Le Pen, 2027 The Republic's runoff.

## Australia (3)

2019 Morrison v. Shorten, 2022 Albanese v. Morrison, 2025 Albanese v. Dutton.

## Where to start

Each election carries a difficulty tag showing how hard it is to rewrite history on Normal as the historical underdog. Easy means a genuine toss-up winnable from either side. Hard means a decisive result you are fighting.

- **United States:** US 2020 is the original campaign and is free. Easy: 2020, 2016, 2012, 2000 and 1960. Landslide years such as 1964, 1972 and 1984 carry a "historical tide" warning.
- **United Kingdom:** Easy: 1964, February 1974, 2010 and 2017. Medium: 1970 and October 1974. 1983, 1997, 2001 and 2024 are landslides.
- **Canada:** 2025 and 2021 are easy, 2019 and 2015 are hard.
- **Australia:** 2022 is medium, 2019 and 2025 are hard.
- **Germany and France:** every election is hard, and France 2017 is a landslide.

## Related pages

- [The campaign week](the-campaign-week.md): how a turn works in a US election. The chosen election sets the candidates' energy, running mates, events and map.
- [Voter blocs](voter-blocs.md): the electorate each state starts from.
- [Polls and scoring](polls-and-scoring.md): how the result and your score are counted in each country.

Last checked: 2026-10-29, version October 2026 release

## Exact rules

| Fact | Value | Source |
| --- | --- | --- |
| Free elections | `us-2024`, `us-2020` | `src/content/scenarioRegistry.ts` |
| Country bundle price | 99 cents each | `src/content/packs.ts` |
| Complete Collection price | 399 cents | `src/content/packs.ts` |
| Paid US races in the bundle | 15 (1960 to 2016) | `src/content/packs.ts` |
| UK, Canada, Germany, France, Australia | 18, 4, 3, 4, 3 | `src/content/packs.ts` |
| Retired Global pack | Canada, Germany, France, Australia, no longer sold | `src/content/packs.ts` |
| Supporter+ and Supporter++ | Complete Collection | `CHANGELOG.md` |
| Electoral votes in total | 538 | `src/content/states.ts` |
| UK 2024 majority | 326 of 650 | `src/content/uk/elections.ts` |
| Canada 2025 majority | 172 of 343 | `src/content/countries/canada.ts` |
| Germany 2025 majority | 316 of 630 | `src/content/countries/germany.ts` |
| France runoff | 51 of 100 points | `src/content/countries/france.ts` |
| Australia 2025 majority | 76 of 150 | `src/content/countries/australia.ts` |
| Difficulty tags | Per election: easy, medium, hard | `src/content/scenarioRegistry.ts` |
| Historical tide warning | us-1964, us-1972, us-1984, uk-1983, uk-1997, uk-2001, uk-2024, fr-2017 | `src/content/scenarioRegistry.ts` |

Majority bars differ by election: UK elections range from 313 of 625 (1951) to 330 of 659 (1997 and 2001), the three Canadian elections before 2025 use 170 of 338, Germany 2021 uses 368 of 735 and 2017 uses 355 of 709, and the earlier Australian elections use 76 of 151. Each is set in the country's data file under `src/content/countries/` or, for the UK, `src/content/uk/elections.ts`.
