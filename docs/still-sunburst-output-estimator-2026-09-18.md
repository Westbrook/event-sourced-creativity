# Local Sunburst output estimator successor

Baseline: accepted local `0cac64d7e26bd6e51f6cbdfb22611a622892ab39`.
Branch: `codex/still-sunburst-estimator`. This successor is local only: no main
changes, push, activation, deployment, real provider request or financial action.
Previous repair commits, receipts and failure logs remain intact.

## Numerical evidence and implementation

The captured [official calculator asset](https://developers.openai.com/_astro/GptImageTokenCalculator.react.DVgudqu4.js)
was retrieved at `2026-09-18T01:40:08Z`, SHA-256
`db420638507abf236e5535e83759631734d4b47837eb2edf1f53af2461b0d8fa`.
The reviewed research manifest has SHA-256
`e7be0af38492634d824477dc0db7a49491bc07ba9ed7f996be4751e538e1e05e`.
Both hashes were checked locally before implementation.

For exactly `gpt-image-2.5-sunburst`, `outputImageBudget` now uses high-quality
base 48 and the captured JavaScript operation order `base / (long / short)`.
Exact half values round to even; all other values use `Math.round`. Output tokens
are `Math.ceil(base * shortCells * (2_000_000 + width * height) / 4_000_000)`.
The returned version is `gpt-image-2.5-sunburst-doc-calculator-2026-09-18`, with
calculator URL, hash, capture timestamp, model family and quality base included.

The exact operation order matters: 1536 × 944 yields 1,201 tokens, not the 1,242
produced by a rationalized rewrite. A separate offline comparison against the
pinned asset's actual arithmetic function verifies all 29,146 sizes accepted by
the existing size validator, with zero mismatches. The domain maximum of 5,930
is a calculator estimate, not a provider consumption cap.

Image 2 keeps its original formula, rounding, returned shape and
`gpt-image-2-doc-calculator-2026-08-27` provenance. No historical estimator version
or usage record is relabeled. Unsupported model aliases remain refused.

## Existing application policy

The output allowance remains twice the estimate. The input allowance remains
UTF-8 prompt bytes plus 4,096, with the existing 32,000-byte prompt limit.
These are retained application assumptions; the output calculator does not prove
a tokenizer/framing bound or a provider-enforced price ceiling. No new hard-cap
release prerequisite or reserve multiplier is introduced. Native preflight's
existing minimum image-call allowance of 900,000 microUSD remains unchanged.
Reported provider usage continues to determine actual recorded charges.

This qualifies only the existing single-output, high-quality, explicit-size,
zero-reference route. It adds no quality, auto sizing, alias, partial-output,
reference-image or Replay support. Replay's Sunburst refusal remains in place
because this output-only evidence does not qualify its reference-input estimate.
Sponsor/Guest templates and closure-pinned historical qualification remain intact.

## Native caller checks

- `output-image-slides-preflight.ts` resolves an explicit exact size, selects high
  quality, refuses required reference pixels and retains the current call-count
  and admission allowance policies.
- `events-api.ts` passes high quality, the exact full-render size and native
  attempt hooks into `generateCreativeImage`.
- `image-adapter.ts` checks reference count, high quality, zero partial images and
  a qualified size/prompt budget at the paid-dispatch boundary.
- `openai-adapter.ts` builds the actual generation request with the shared
  `outputCount: 1` contract and defaults to zero partial images.

Real-handler synthetic tests capture outgoing requests outside fetch callbacks
for unset and explicit Sunburst models. Each accepted native target reaches one
image request with `n=1`, `quality=high`, the quoted size and no partials, stream
or reference images. The exact prompt reaches moderation. The simulated jobs
complete against in-memory storage. Separate tests preserve reference preflight
refusal and dispatch refusal for low/medium/auto/xhigh/max, references and partials.
No real provider or account is contacted.

## Verification and retained evidence

Four estimator/dispatch tests, five focused native-image tests and nineteen
retained Replay/cost/Still-policy tests pass (28 total), plus the independent
29,146-size equivalence check. Typecheck, targeted lint and production build are
recorded separately in the independent Progress Report evidence.

The first new reference fixture was refused earlier by source-rights admission;
its failure log is retained. The fixture now supplies its synthetic owned-rights
receipt so the test reaches and verifies the intended reference-pricing refusal.
Earlier broader 31/32 failure and 400-vs-502 oracle failure evidence remain
unchanged; their subsequent fixes remain separate commits. No full historical
or closure-pinned mini-app qualification is claimed by these focused checks.
