# Ideogram adapter candidate campaign 3 outcome

## Decision

Campaign 3 exhausted its ten explicitly authorized candidates without producing an approvable adapter. Production routing and governance remain unchanged. No candidate reached the paid 50-case qualification.

The campaign was nevertheless materially informative. The new `ideogram-context-v4` compiler corrected the prior micro-stage composition and XML regressions. Two candidates—`v33` and `v35`—cleared the seven-case micro screen and advanced to the 15-case sentinel, the first candidates in any bounded campaign to do so.

## Scope and safeguards

- Immutable candidates: `v31` through `v40`.
- Frozen semantic corpus: `canvas-image-corpus-v6`.
- Funnel: 50-case no-cost contract preflight, 7-case paid micro screen, 15-case paid sentinel, then 50-case paid qualification only after both screens pass.
- New OpenAI image cost: zero; the existing frozen baseline was reused.
- Stop condition: first passing 50-case report or ten paid candidate cycles.
- Recorded successful Fal image cost: `$4.514546`. This excludes evaluator, moderation, and failed-attempt charges.

An initial orchestration attempt exposed a campaign-specific approval-token defect before any provider request was sent. The paid boundary refused every request, the child runner was corrected, and the campaign was restarted with the same authorized ceiling. That failed attempt consumed no paid cycles and no provider image cost.

## What changed

`ideogram-context-v4` adds a provider-facing literal contract over the durable context:

- edge-only framing becomes an explicit visible-body contract;
- named objects must remain visible while faces, heads, shoulders, torsos, and full bodies are excluded when the direction requires hands-only framing;
- prose, bullets, JSON, and XML are compiled through the same visual-fact representation;
- candidate strategies can place composition or constraints first, remove lower-authority styling, or end with a numbered visible acceptance checklist;
- every strategy remains named and immutable in its evaluation receipt.

All ten versions passed the full 50-case no-cost prompt and request-shape preflight. The longest canonical prompt was 9,671 characters; the longest provider prompt was 3,243 characters. Every provider request remained within the adapter contract.

## Results

| Candidate | Highest stage | Result | Key evidence |
| --- | --- | --- | --- |
| `v31` | Micro | 5/7 usable, 1/2 references | Literal contract fixed composition and XML but missed material and one reference case. |
| `v32` | Micro | 5/7 usable, 1/2 references | Composition-first ordering did not improve total or reference usability. |
| `v33` | Sentinel | 11/15 usable, 2/3 references | Complete and provider-stable; spatial, JSON, and XML were strong, but total and reference rates missed their floors. |
| `v34` | Micro | 4/7 usable, 2/2 references | Compact input preserved references but lost too much typography and spatial intent. |
| `v35` | Sentinel | 11/12 evaluated usable, 2/2 references | Strong evaluated output, but a Fal safety rejection made the run incomplete and stopped qualification. |
| `v36` | Micro | 4/6 evaluated usable, 2/2 references | Medium expansion did not preserve the literal contract consistently. |
| `v37` | Micro | 1/7 usable, 0/2 references | Medium composition-first expansion regressed sharply. |
| `v38` | Micro | 5/6 evaluated usable, 1/2 references | Fal safety rejected the benign material case. |
| `v39` | Micro | 4/7 usable, 1/2 references | Slightly lower reference strength did not generalize. |
| `v40` | Micro | 5/6 evaluated usable, 2/2 references | Fal safety again rejected the same benign material case. |

### Best complete finalist: `v33`

`v33` completed all 15 sentinel requests without a provider failure. Eleven were usable, or 73.3%, against the frozen 80% floor. Two of three reference studies were usable, or 66.7%, against the 70% reference floor. Its instruction score trailed the paired OpenAI baseline by only 0.266 points, comfortably inside the permitted 0.75-point delta.

The broader cohort revealed instability hidden by the micro screen: preserve-composition reference behavior fell from 2/2 references usable at micro to 2/3 at sentinel. Composition, typography, material, and reference families each finished at 2/3 usable, just below the 70% family floor. Bullets finished at 1/4 usable. Spatial finished at 3/3, JSON at 4/4, and XML at 3/3.

### Strongest incomplete finalist: `v35`

`v35` made eleven of twelve evaluated outputs usable and both evaluated reference outputs usable. It cannot qualify because Fal rejected `v6-03-night-market-spatial` at output safety, leaving the paired run incomplete. The exact request ID is retained in the report.

## Provider-safety signal

The campaign retained three Fal output-safety failures:

- `v35`, `v6-03-night-market-spatial`;
- `v38`, `v6-08-signal-kitchen-material`;
- `v40`, `v6-08-signal-kitchen-material`.

The repeated benign material-case rejection across distinct literal profiles suggests a provider-output reliability problem that prompt ordering alone will not resolve. A future campaign should first isolate stochastic versus prompt-specific rejection and define an auditable, bounded retry policy. Safety checks must not be weakened or bypassed.

## Evidence

- Search receipt: `outputs/image-adapter-cycles/search-2026-08-20T22-54-14-932Z.json`
- Best complete finalist: `outputs/image-adapter-cycles/v33/sentinel/report.json`
- Strongest incomplete finalist: `outputs/image-adapter-cycles/v35/sentinel/report.json`
- Full no-cost contract preflight: `outputs/image-adapter-cycles/v33/full/preflight.json`

All generated pixels, canonical prompts, provider prompts, request IDs, progress receipts, evaluator responses, costs, checkpoints, and reports remain under `outputs/image-adapter-cycles/v31` through `v40`.
