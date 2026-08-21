# Ideogram 4 adapter campaign 2

## Objective

Find the first adapter that passes the frozen `canvas-image-corpus-v6` qualification without weakening its acceptance criteria. Run no more than ten immutable candidates (`v21`–`v30`) and stop immediately after the first complete 50-case pass.

## Correction learned from campaign 1

Ideogram 4 is trained on an ordered JSON caption with `high_level_description`, `style_description`, and `compositional_deconstruction`. A native caption must be submitted with expansion disabled. The earlier native candidates combined JSON with provider expansion, so they did not isolate the documented native contract.

The v2 compiler also corrects two semantic losses visible in v20:

- scoped palettes no longer leak into the global style palette;
- AABB decisions become local elements using `[y_min, x_min, y_max, x_max]` coordinates;
- material systems and literal compositional counts/order become explicit elements;
- every receipt identifies the caption strategy and compiler version.

## Progressive funnel

1. Run a no-cost contract preflight for all 50 contexts.
2. Render the 7-case micro cohort covering composition, typography, spatial scope, material fidelity, and both reference modes.
3. Advance only a passing candidate to the 15-case sentinel cohort.
4. Advance only a passing sentinel to the complete 50-case qualification.
5. Stop on the first full pass. A micro or sentinel result can never approve an adapter.

The frozen OpenAI baseline pixels are reused after corpus-hash verification, so the campaign creates no new OpenAI baseline images.

## Candidate order

- `v21`: native JSON, no expansion, combined spatial/material emphasis.
- `v22`: native JSON, no expansion, strict local spatial emphasis.
- `v23`: native JSON, no expansion, explicit material emphasis.
- `v24`: native JSON, no expansion, map additional authored visual facts.
- `v25`: v21 semantics with fully disposable reference scaffolding.
- `v26`: corrected native JSON control without extra emphasis.
- `v27`: v21 semantics with more source composition retained.
- `v28`: strongest expanded-caption control.
- `v29`: medium-expanded control.
- `v30`: final expanded candidate that retains every authored visible fact while balancing composition-reference preservation.

## Authorization and evidence

The coordinator enforces the fresh campaign-specific approval token, a ten-cycle ceiling, immutable per-version output directories, provider prompts and revisions, evaluator fingerprints, latency/cost receipts, and a durable search report. Failed requests, evaluator calls, and moderation probes remain clearly excluded from successful-image cost totals.
