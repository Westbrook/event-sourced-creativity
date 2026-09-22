# Forma and Still Draft images — Flare

New Draft images now use `gpt-image-2.5-flare`, including plain previews, preview fans, reference edits, storyboard frames and managed-production image studies that request low quality. The Draft policy takes precedence over `FORMA_IMAGE_PROVIDER`, `FAL_IMAGE_PREVIEW_MODEL`, and the final-image `OPENAI_IMAGE_MODEL` setting. Existing final image selection is unchanged.

Flare executes through the existing OpenAI image adapter used by Sunburst. It retains authored context compilation, spatial and negative constraints, prose/bullets/JSON/XML prompts, reference labels and pixel policies, multiple reference images, exact-prompt and per-reference moderation, safety acknowledgements, size validation, compressed PNG/JPEG/WebP output, streaming partial images, private storage and provider-token cost receipts. There is no Ideogram prompt conversion or caption-expansion hop for new Draft images.

Both direct OpenAI calls and shared provider selection use one model policy. Draft readiness uses the Flare provider-health identity and OpenAI size validation, without depending on Fal credentials. Its cache namespace changes so a saved Ideogram readiness result cannot govern a new Flare Draft.

Already-purchased Fal requests retain their original recovery route. New frames after recovery use Flare. Historical outputs and receipts retain their actual models. Diagnostic tests and direct Ideogram adapter evaluation remain available; they do not determine new application Draft routing.

Flare rates are explicitly registered at $5 per million text-input tokens, $8 per million image-input tokens and $30 per million output tokens. These are token rates, not a promised per-image cost. The existing administrator Replay estimate remains unqualified for the new models; even a legacy final-model override cannot qualify its now-Flare Draft calls using Image 2 assumptions.

Source: [OpenAI Flare model documentation](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare). No paid live latency benchmark was performed in this migration; speed improvement is the model-selection intent, not a measured application result.

## Verification

- Shared adapter transport checks exercise all four prompt techniques with zero, one and three reference images; exact prompt parity, moderation, pixel bytes, formats, model identity and cost receipts are checked.
- Actual Forma and Still job admission/execution checks verify Flare Draft requests with a Fal deployment default and unavailable Fal credentials.
- An actual storyboard job completes and settles the Flare receipt.
- Existing image generation, streaming, final Sunburst routing and legacy Fal adapter recovery checks pass.
- Typecheck, localization and production build pass; changed-source lint is checked separately from repository-wide lint debt.
- Repository-wide lint currently reports 247 errors outside the changed files.
- Older storyboard HTTP recovery fixtures still create their historical initial Fal purchases through the application Draft route. Those fixtures require migration to seeded historical purchases; the new route correctly selects Flare instead. Legacy accepted-receipt recovery is covered by the adapter durability checks. The standalone historical pure-preflight suite also has a stale dependency manifest (`output-fal-image-contract.ts` is already missing from its baseline closure).

Publication uses the guarded package that retains the 41 pre-Memory migrations and excludes the already repaired original Memory SQL from the Sites executor.
