# Bounded match research — October 27, 2026

Read-only follow-up to `99e470d`. No live catalog, customer records, or production match registry changed in this research pass. “Not found” is not an incompatibility verdict. All rows require the customer's existing cooling capacity and selected furnace input/cabinet/blower configuration, and exactly the selected coil; a row never authorizes changing those assumptions.

## Newly established Guardian candidates

These two complete combinations contain priced catalog components and built-in valves. They could be added as explicit matches in a subsequent implementation step; they are not yet enabled by this research-only change.

| Cooling | Selected Champion furnace configuration | Guardian condenser | Guardian furnace | Unchanged selected coil | SEER2 | Official record |
| --- | --- | --- | --- | --- | --- | --- |
| 1.5 ton | Z8ES060A12SMPS1, 80% | RC318E2S11 | RL18060A12MPS1 | CTM24A5ABS1 | 14.75 | [216781777](https://www.yorknow.com/scfurn216781777v1.html) |
| 4 ton | Z8ES100C16SMPS1, 80% | RC348E2S11 | RL18100C16MPS1 | CTM60D5CGS1 | 14 | [216781366](https://www.yorknow.com/scfurn216781366v1.html) |

The nominal coil capacity differs from condenser capacity in these official combinations. This is evidence for the exact combination only; it does not authorize replacing the user's selected coil or resizing their condenser. Both preserve the matching furnace code. These establish Guardian availability, not a full four-option package.

## Capacity and evidence matrix

XC3/XC4 are priced at all listed capacities. XC6 is priced at 1.5, 2, 3, 4 and 5 tons; 2.5 and 3.5 are absent. Exact Champion records beyond the prior reviewed registry were not located in this bounded pass.

| Cooling | Guardian evidence / limitation | Champion XC3/XC4 | Champion XC6 with requested furnace |
| --- | --- | --- | --- |
| 1.5 | Newly verified 80% 060A12 / CTM24A5ABS1 above | No new exact furnace/coil record found | Furnace/coil-specific certification unresolved |
| 2 | [218365542](https://fortsmith.yorknow.com/scfurn218365542v1.html): RC324E2S11 + RL18060A12MPS1 + CTM18A5AAS1, 13.5 SEER2; separate 5A TXV required, so not ready | No new exact record found | Unresolved |
| 2.5 | No exact priced three-component record established | No new exact record found | No same-capacity priced XC6; do not increase capacity |
| 3 | Existing enabled [214727326](https://www.yorknow.com/scfurn214727326v1.html): RC336E2S11 + RG19060B12MPS1 + CTM36B5CDS1, 13.4 SEER2, built-in valve | No new exact record found | Unresolved |
| 3.5 | Known 96% record uses excluded RG19080C20MPS1; existing 80% RL18080C16 record needs separate 5C TXV | Existing XC342/XC442 + Z9ES080C20SMPS1 + CTM42C5CES1 only | No same-capacity priced XC6 |
| 4 | Newly verified 80% 100C16 / CTM60D5CGS1 above | No new exact record found | Existing XC648 + Z9ES080C20 + CTM48C5CFS1 evidence uses single-stage 96%, not requested high-efficiency two-stage |
| 5 | [218365092](https://www.yorknow.com/scfurn218365092v1.html): RC360E2S11 + RL18120C20MPS1 + CTM48D5CFS1, 13.4 SEER2; separate 5C TXV required. [218365318](https://www.yorknow.com/scfurn218365318v1.html) uses RL18100C16MPS1 with same coil/5C TXV, also 13.4 | No new exact record found | Unresolved |

Additional rejected candidates: [214726196](https://www.yorknow.com/scfurn214726196v1.html) uses an unpriced RG19026A08MPS1, not the selected furnace configuration. [214728033](https://www.yorknow.com/scfurn214728033v1.html) uses the specifically excluded RG19080C20MPS1. Neither is a reason to request those prices or broaden the selection. CTF/CXF matches were not substituted for CTM coils.

## Can a documented rule replace individual match entries?

The manufacturer's [XC6 technical guide 6601765-LTG-A-0125](https://admin.airproductssupply.com/api/documents/XC6%20Tech%20Guide.pdf), pages 8–10, identifies exact outdoor models and coil charge/metering groups. The table includes XC636 with CTM36C**D and CTM42C**E; XC648 with CTM48C/D**F; XC660 with CTM60C/D**G and other listed variants. It explicitly warns that charge adders do not establish ratings for every application, and directs certified ratings to AHRI. It does not identify the requested Z8ES/Z9ET furnace combinations. Consequently it supports targeted candidate research, not a blanket certification rule or invented system SEER2. It is Luxaire-branded manufacturer literature for the same exact XC6 outdoor model strings, not an assertion of Champion certified-brand equivalence.

The [Z9ET manufacturer guide](https://pimmedia.winsupplyinc.com/pim/SPEC/092025/__UPGZ9ET100C16SM_SPEC.pdf) establishes exact AFUE and furnace dimensions/airflow, but does not establish an XC6/coil matched-system rating. The 96% → 96.4/96.8/97% policy remains pending; this research does not change it.

## Search boundary and remaining work

Searched exact full XC3/XC4/XC6 model plus Z8ES/Z9ET/CTM/AHRI combinations, official YorkNOW indexed records across 1.5–5 tons, manufacturer technical literature, and AHRI search. YorkNOW's public catalog primarily exposes YORK/Guardian furnace combinations; YC6/Y92E entries were not relabeled as XC6/Z9ET. No new exact Champion tuple or complete four-option set was established. This is a limitation of accessible evidence, not proof those systems are incompatible.

AHRI public search fetch failed with HTTP 402 through the web tool. Direct executor fetch of YorkNOW failed with proxy HTTP 403; readable web-tool records remained available and were used. No credentials were requested, access controls bypassed, or remote writes attempted. These are read-access failures, not an approval rejection or uncertain mutation.

The most useful next evidence is a manufacturer/distributor AHRI export for the exact priced XC3/XC4/XC6 + Z8ES/Z9ET + CTM combinations, including metering requirements; an explicit certified wildcard/equivalence table would also suffice. This avoids asking the customer to hand-review every combination. Separate TXV records need exact kit identity, existing allowance inclusion and price before use. The unavailable Guardian furnace and 80% two-stage furnace remain excluded; no price requests for either remain.
