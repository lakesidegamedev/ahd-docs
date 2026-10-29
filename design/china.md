# China (CN), System Design

## Overview

China is modelled as a one-party state (`governmentType: "onePartyState"`). The Chinese Communist
Party (CCP, code id `ccp`) dominates government formation, bill passage, and executive
appointment. Other parties (CDL, CNDCA) participate in the CPPCC advisory body
and can hold NPC seats but are gated from forming governments or fielding
premier candidates.

## Legislature

**National People's Congress (NPC)**: 2,980 seats in the modern preset and
1,226 in `1953-default`, organised across 7 geographic macro-regions. Each
region runs one multi-seat `npcDelegate` race using Hare-quota PR
(`pr_hareQuota`).

**CPPCC** (2,169 seats): advisory body only. Not elected. Not part of the
player legislative loop. Seats are seeded per-region but have no turn-engine
mechanics.

## Executive

**Premier** (head of government): appointed via parliamentary confidence vote,
gated by one-party constraints so only CPC can form a government or field a
candidate.

## One-Party Constraints

File: `src/lib/turn/onePartyConstraints.ts`

| Operation                             | Gate                |
| ------------------------------------- | ------------------- |
| Form government                       | CCP only            |
| Field premier candidate               | CCP only            |
| Trigger VONC                          | Disabled by default |
| Invite to coalition                   | CCP only            |
| Government collapse on coalition loss | Disabled            |

China inherits `confidenceVoteMechanism: false` from the one-party-state
government-type default. It does not override that field in its country
config. `canTriggerNoConfidence` still limits movers to the ruling party as a
defence-in-depth gate if the mechanism is enabled later.

## CPC Confidence Model

Files: `src/lib/turn/rulingPartyPriorities.ts`, `src/lib/turn/rulingPartyConfidenceTurn.ts`

The subsystem is country-agnostic, the priority profile and policy-axis
effects map for CN live on `COUNTRY_CONFIGS.CN.priorityProfile` and
`COUNTRY_CONFIGS.CN.policyAxisEffects`. See
[`docs/design/ruling-party-confidence.md`](./ruling-party-confidence.md)
for the generic design; this section describes CN's specific profile.

Each turn, enacted bills are scored against the CPC's 9-axis priority profile
(party control, social stability, state-sector strength, industrial policy,
economic growth, national security, regional balance, market openness,
anti-corruption). The score drives leader confidence drift.

## Regional Budget

File: `src/lib/countries/cn/cnRegionalBudget.ts`

**Revenue sources per region:**

1. **EIT local share** (企业所得税地方分成): 40% of Enterprise Income Tax
   collected in-territory. Derived from enacted `cn_enterprise_income_tax` rate
   × regional GDP × 6% corporate profit ratio. Defaults to 25% EIT if not
   enacted.

2. **Central transfer grant** (中央转移支付): Finance Minister
   (`CN_minister_of_finance` cabinet setting) sets allocation percentages.
   Defaults to an equal 1/7th split of a national pool sized by
   `centralTransferPerCapita: 35` (`COUNTRY_CONFIGS.CN.onePartyRegionalBudget`,
   `src/lib/countries/cn/institutionsFacts.ts`) × national population, a flat per-capita
   figure, not the generic 4,000 default used elsewhere. Era overrides (e.g.
   the 1953 seed) rescale it further (`centralTransferPerCapita: 2.77`).

3. **Provincial resource tax** from the enacted
   `cn_provincial_resource_tax` policy.

4. **Standing business tax** at 24% of the configured 0.50 GDP consumption
   base.

**Austerity**: Regions in deficit for more than one turn have their most
expensive programme downgraded one tier, matching UK and JP behaviour.

**Provincial spending bills**: The provincial-scope §29 legislation
(`cn_provincial_education`, `cn_provincial_public_security`,
`cn_provincial_economic_development`, `cn_provincial_health_services`,
`cn_provincial_culture_propaganda`, `cn_provincial_environmental_policy`,
`cn_provincial_infrastructure_investment`) all carry `annualCostPerCapita`
on their policy options, so each region's enacted spending is summed
against revenue to drive the austerity check. Regions default to the
statutory baseline (center option) on seed; provincial People's Congress
legislation moves them.

## Regions

7 macro-regions replace 31 provincial-level divisions for gameplay
(`src/lib/constants/cn.ts`), named with pinyin, not English:

| Code | Pinyin name | English gloss   |
| ---- | ----------- | --------------- |
| DB   | Dongbei     | Northeast       |
| HB   | Huabei      | North (Beijing) |
| HD   | Huadong     | East (Shanghai) |
| HZ   | Huazhong    | Central (Wuhan) |
| HN   | Huanan      | South           |
| XN   | Xinan       | Southwest       |
| XB   | Xibei       | Northwest       |

Total NPC seats: 2,980. Total CPPCC seats: 2,169.

## Elections

Each 5-year cycle includes one multi-seat `npcDelegate` PR race per region,
a matching regional `peoplesCongress` race, and a regional `governor` race.
The election window is 48 hours. The CPPCC is appointed rather than elected,
and China has no snap elections. The ceremonial President is synchronized to
the CCP chair through `syncPartyChairHeadOfState`.
