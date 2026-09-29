# Fal Ideogram V4 image adapter capability receipt

Adapter: `fal-ideogram-v4`  
Version: `v52`
Contract: creative image adapter contract `7`

## Purpose

This server-side adapter supplies a provider-independent image path for the same compiled creative context used by the OpenAI image adapter. The Fal key is read only by the Worker. It is never included in browser state, events, receipts, or logs.

## Endpoint family

- Full text-to-image: `ideogram/v4`
- Fast draft text-to-image: `ideogram/v4/fast`
- One-reference editing: `ideogram/v4/image-to-image`

Model identifiers are environment-configurable. The adapter uses Fal's queued request protocol, retains the provider request identifier in completion receipts, reports queue/render/download stages, and copies finished bytes into the application's private media store.

## Capability matrix

| Capability | Delivery |
| --- | --- |
| Compiled prompt structures | Prose, bullets, JSON, and XML remain canonical document representations. `ideogram-context-v6` classifies the requested capability before supporting attributes, then deterministically translates durable context into a bounded `production_director` visual contract while retaining canonical and provider-prompt hashes. Fal's expansion step converts that input into the provider's JSON caption; the revised caption is retained in the result receipt. |
| Prompt expansion | The adapter uses `Medium` on the fast draft endpoint and `Large` on the standard and image-to-image endpoints. Model-aware validation prevents unsupported expansion/endpoint combinations. The model choice and published expansion charge are explicit in previews and receipts. The native compiler remains available for diagnostics. |
| Draft/full quality | Lightweight drafts map to the Fast endpoint with `BALANCED`; balanced maps to the standard endpoint with `BALANCED`; full maps to the standard endpoint with `QUALITY`. Low-quality material studies route to the standard endpoint because the frozen evidence showed that their subject, action, count, and surface requirements are not lightweight. |
| Custom dimensions | 512–3840 px per side, multiples of 16, validated before submission. |
| Safety | The exact bounded provider input and each selected reference are preflighted; Fal's safety checker is always enabled. Provider expansion changes representation without bypassing either safety layer, and the returned revised caption is retained for review. |
| Reference pixels | One PNG, JPEG, or WebP reference is passed as a server-created data URI. Fal documents that `1.0` ignores the input while lower values stay closer. V52 uses `0.30` for subject, `0.88` for composition, `0.72` for style, `0.99` for inspiration, and `0.90` by default. The provider input describes the authorized reference role; authored content remains authoritative. |
| Optional typography | Low-weight or conditional typography is omitted from the provider input. Required display copy becomes one exact phrase with benign story context and an explicit ban on additional copy. |
| Mandatory subjects and space | Every authored subject/action is promoted to the primary visual requirement and repeated as a final check. AABB scopes are translated to concise, named visual regions before provider expansion. Receipts record source subject block IDs and whether the repeated subject contract survived bounding. |
| Multiple references | Not claimed. Requests with more than one reference use the primary adapter and record the selection reason. |
| Rights | Existing reference selection and rights assertions remain upstream of the adapter and are represented in the compiled request receipt. |
| Failure behavior | Authentication, validation, provider, queue failure/cancellation, timeout, empty result, and download errors use normalized provider errors with retry guidance. |
| Usage/cost | OpenAI token counts remain zero for Fal inference. Image cost records the published per-megapixel render rate plus the published Medium or Large expansion charge. |
| Partial images | Not claimed. The final result is durable; no synthetic streaming receipt is emitted. |

## Laboratory preview

`/laboratory/image-adapters` calls the production request selector without calling either provider. It previews draft, full, one-reference, multi-reference, and WebP request shapes; exposes the chosen adapter and capability-based fallback reason; estimates Fal's output-pixel charge; and shows the normalized progress and receipt pipeline. It also displays the retained campaign search and passing v52 qualification; the dry request preview itself is not qualification evidence.

## Governance status

Implementation and mocked contract tests do not constitute release approval. Earlier reports remain immutable non-passing evidence. The Canvas pilot gate requires:

1. an immutable Fal entitlement/procurement reference;
2. a frozen corpus of at least 50 contexts;
3. the retained `canvas-image-corpus-v6` same-context v52 comparison showing all overall, reference, capability-family, and prompt-technique criteria passed; and
4. an administrator attestation through `/operations/canvas`.

The v52 report now satisfies the evaluation requirement. `second_image_adapter` remains unapproved until an administrator reviews that report, provides the independent Fal entitlement or contract reference, and records approval in `/operations/canvas`.

The v9 three-request diagnostic is complete. Native-caption/None failed provider output safety; concise-prose/Medium and concise-prose/Large both returned coherent pixels from the same context. Medium completed in 12.4 seconds and Large in 17.6 seconds; both recorded $0.056215 in successful provider cost. The v10 no-cost preflight then passed all 50 expanded request contracts with zero provider calls: 40 Medium and 10 Large.

The explicitly authorized full v10 qualification completed all 50 paired requests but failed the creative-quality gates. Four bounded campaigns then retained each unsuccessful hypothesis without relabeling it. Campaign 5 stopped at v52 after the unchanged 50-case gate passed: 43/50 candidate outputs were usable, all 10 references were usable, instruction adherence was within 0.30 points of the OpenAI baseline, every capability and prompt-technique subgroup cleared 70%, and no request failed. The passing report is `docs/evaluations/ideogram-adapter-cycle-5-outcome.md`. V7 through v52 evidence remains immutable.

## Evaluation corrections retained from prior passes

- Provider prompts and canonical prompts now have separate hashes joined by one semantic-context hash; provider-native translation is evaluated as part of the adapter.
- Evaluator cache entries include both generated-image hashes, the reference hash, the canonical prompt, rubric, evaluator model, and evaluator version. Changed pixels can never inherit a stale judgment.
- The runner validates all 50 request shapes without a provider call before paid authorization.
- Native-caption validation enforces exact key order, exactly one photo/art style branch, valid object/text elements, 0–1000 bounding boxes, and uppercase hexadecimal palettes.
- Acceptance retains the existing 80% overall usability, 70% reference usability, and −0.75 instruction delta, then adds a 70% usability floor for every capability and prompt-technique family.
- Pair evaluation remains blind and deterministic in A/B ordering. It scores both outputs against the common canonical context, not against each provider's private prompt wording.
