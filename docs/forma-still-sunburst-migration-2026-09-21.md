# Forma and Still: Sunburst migration

The production environment explicitly pinned `OPENAI_IMAGE_MODEL=gpt-image-2` at revision 13, despite the shared adapter already defaulting to Sunburst. The requested migration changes that runtime setting to `gpt-image-2.5-sunburst` and makes the remaining live contracts agree with it. Forma’s separate `fal-ideogram` routing and `ideogram/v4/fast` Draft model remain unchanged.

## Source changes

- Health checks, provider status, initial model registration, image selection, Memory preview and new live evaluations share the existing Sunburst default.
- Native Output review, sponsored templates, guest claims, retained input disclosures and local adoption accept Sunburst with its own qualified budget. Legacy Image 2 records retain their original model identity and remain readable.
- The guest claim adapter now obtains its three exact schema-read forms from the same builder as private-content preparation. This fixes an existing mismatch involving `consumer_schema` while preserving the three-read limit, zero-binding schema checks and ownership guards.
- New Sunburst evaluations use separate output storage and model-aware cache matching. Frozen candidate evaluations continue to validate and reuse their historical Image 2 pixels; corrupt evidence fails instead of buying replacements. Historical failed attempts retain the explicit retry gate.

The existing Sunburst high-quality, zero-reference output estimator remains unchanged. It is an application allowance based on a model-specific output estimate, not a provider-enforced spending cap. The old Replay reference-input estimate remains unqualified for Sunburst. Because production was pinned to Image 2, this runtime change makes **new administrator-only paid Replay fixture generation unavailable**, returning `replay_image_estimate_unqualified`. Saved Replay sessions remain readable. Current OpenAI documentation provides output estimates but does not qualify Sunburst reference-input token counts; the existing guard is preserved pending provider evidence or a separately bounded qualification study. Historical scenarios, frozen test goldens and retained evaluation reports are not relabeled.

## Verification

Provider-mocked checks cover direct generation, reference edits, streamed previews, Fal fallback, health identity, model-specific review and sponsor terms, and the guest admission → execution → private-copy → claim → fresh-read chain for both Image 2 and Sunburst. The legacy claim remains readable after the environment selects Sunburst. All 480 focused checks, TypeScript, changed-file lint, localization audit and the production build passed. No live paid image generation or new speed/quality benchmark is part of this migration.

## Release constraints

Publish the exact verified source after reconciling local and remote main. Change only the production image-model key, preserve the existing audience and other runtime settings, and package with `scripts/package-disabled-memory-release.mjs`. The established Memory migration hold remains active; this image update does not activate Memory or apply its held migrations.

The comparison and separate Draft recommendation are in [the model decision report](forma-still-draft-model-comparison-2026-09-21.md). Flare is recommended for a matched Draft evaluation, not selected automatically.
