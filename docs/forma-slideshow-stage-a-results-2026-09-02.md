# Slideshow comparison: Stage A

Executed from tested commit `f3aafce83325c2d1df7d74bc2ccc1e1ee1d65255` on September 2, 2026 (US Eastern). The user approved four serial composition calls with a $1.50 ceiling. The exact six-slide source, options and complete wire content were frozen; only model and effort varied. No automatic repairs, retries, paid judges, native artifact writes or production-default changes occurred.

## Results

| Arm | Measured cost | Response latency | Result |
| --- | ---: | ---: | --- |
| Terra medium | $0.053798 | 28.277 s | Six slides; zero normalized validator issues, but five raw within-slide copy pairs required local normalization. |
| Terra high | $0.078998 | 51.664 s | Six slides; six validation issues, including an incomplete opening matrix, missing visible opening promise and repeated closing values. |
| Sol medium | $0.137872 | 59.682 s | Six slides; three repeated closing values remain after normalization. |
| Sol high | $0.154412 | 88.579 s | Incomplete at `max_output_tokens`; no structured items array. Stopped without retry. |
| **Total** | **$0.425080** | | Four calls; all four have attributable usage and priced receipts. |

Every arm used 6,103 input tokens and a 6,500 output-token cap. Sol high consumed 6,235 reasoning tokens within its 6,500 output tokens, leaving 265 other output tokens. Its candidate stopped inside Markdown before producing structured slides. Its empty duplicate arrays are **not assessable**, not a clean-copy result. Reasoning tokens are already included in billed output tokens; they are not charged twice.

Terra medium is the cheapest, fastest and only normalized-contract pass in this small run. It is not a defect-free raw first pass: normalization removes duplicate labels and replaces repeated kickers. Its slide 2 also describes context facets in both body and graphic. Sol medium organizes that slide more cleanly, but leaves three closing value duplicates. No effort produced acceptable normalized candidates for both models. This single sample per arm does not justify a production model upgrade or establish stable model superiority.

## Source and visual checks

The source snapshot SHA-256 is `eb7cce6143f1dcdacd2990c5bc8bacd5597dbce0bf927faa00e1fd322a86b2e4`, revision `rev-1v4zjth`. The manifest digest is `4a0358aef33742437f19990fb2a39cd3d5cd06065ec792796888fe6804f5c0fc`. All four content-comparison digests match.

Direct structured-field inspection confirms the exact protected phrase in the opening and closing of Terra medium and Sol medium. Terra high places it in the closing but omits it from audience-facing opening fields; Markdown or citations do not repair that omission. The harness's whole-field exact-pair detector is separate from placement checking: zero authorized pairs does not mean protected wording is absent. Terra medium's two raw cross-deck pairs overlap the source's middle heading and bookend wording; they are not two unrelated invented claims.

The complete candidates keep future experiences conditional. The medium-effort candidates retain the permission/scope and no-automatic-retraining qualifications in visible content; Terra high relies more on notes/citations for those qualifications. These are structured-content observations, **not native rendered visual-hierarchy, overflow or export acceptance**. None of these evaluation outputs was imported into Forma.

## Accounting and durability

Fresh native Settings after the run still shows $9.405443 settled and $2 reserved. Direct evaluation usage is separate from that application ledger. Adding the four measured evaluation costs gives $9.830523 measured spending and **$11.830523 including the two historical holds**, against the original $30 total.

The canonical local comparison admission claim remains $1.50. Its conservative exposure is $12.905443, already covering the $0.425080 actual evaluation usage; do not add both to the same tally. This local claim is not another application/provider hold. No historical hold or local claim was released.

Independent review verified each call's unique client, provider-response and HTTP request identity; raw-response hash; effective settings; own usage and frozen tariff; and durable pending → raw response → financial → terminal sequence before the next call. Sol high is a **known, priced incomplete response**, not an uncertain submission. The final run state is `stopped` because its output cap fired; no all-quality-pass report is implied by successful financial capture.

Full source, wire bodies and provider responses remain in owner-only ignored local evidence storage. The adjacent JSON report preserves source-free identities, digests, usage, cost and validation findings for review. No private candidate/source body is committed.

## Next steps and boundaries

Stage B is prepared offline from the predeclared complete Terra-medium result, not whichever result was easiest to repair. Its exact candidate digest is `3061773b04f33b2422ea6ac5ff815764be5d69a6f8efd4801289354aae02db66`; all four editor arms share identical source/candidate content and use the existing validation-repair wire. The largest complete-wire bound is 46,899 tokens, below the 64,000 allowance. It has made zero paid calls and requires separate approval. C/D also remain unapproved; no common effort has been qualified for them.

The deployed version remains 179 as last verified. The new implementation commits are local, not production. Code-only release approval and the $0 native retained-draft editing/verification approval are separate outstanding gates. The existing source, podcast and video were not modified. The original task remains open while the native deck and historical accounting are unresolved.
