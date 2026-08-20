# Fal Ideogram V4 image adapter capability receipt

Adapter: `fal-ideogram-v4`  
Version: `v6`
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
| Compiled prompt structures | Prose, bullets, JSON, and XML use the same bounded compiler as the primary adapter. Fal applies `Medium` caption expansion to the Fast endpoint and `Large` to the standard endpoint. This preserves the same submitted context while adapting it to Ideogram 4's structured-caption distribution and each endpoint's accepted enum. |
| Draft/full quality | Draft maps to the Fast endpoint with `TURBO` and its supported `Medium` expansion. Balanced maps to the standard endpoint with `BALANCED` and `Large`; full maps to the standard endpoint with `QUALITY` and `Large`. The stronger standard-endpoint expansion prevents the benign typography safety failure reproduced with Medium. |
| Custom dimensions | 512–3840 px per side, multiples of 16, validated before submission. |
| Safety | Exact prompt and each selected reference are preflighted; Fal's safety checker is always enabled. |
| Reference pixels | One PNG, JPEG, or WebP reference is passed as a server-created data URI. Strength follows Fal's documented transformation semantics: subject preservation stays close to the source, while composition-only and inspiration modes transform strongly enough to replace unrelated source content. Composition prompts explicitly preserve layout while rejecting source identities, objects, text, and story. |
| Multiple references | Not claimed. Requests with more than one reference use the primary adapter and record the selection reason. |
| Rights | Existing reference selection and rights assertions remain upstream of the adapter and are represented in the compiled request receipt. |
| Failure behavior | Authentication, validation, provider, queue failure/cancellation, timeout, empty result, and download errors use normalized provider errors with retry guidance. |
| Usage/cost | OpenAI token counts remain zero for Fal inference. Image cost records both the published per-megapixel render rate and the flat prompt-expansion fee and is marked as a provider-rate estimate. |
| Partial images | Not claimed. The final result is durable; no synthetic streaming receipt is emitted. |

## Laboratory preview

`/laboratory/image-adapters` calls the production request selector without calling either provider. It previews draft, full, one-reference, multi-reference, and WebP request shapes; exposes the chosen adapter and capability-based fallback reason; estimates Fal's output-pixel charge; and shows the normalized progress and receipt pipeline. This dry preview is not evidence that the paid paired evaluation passed.

## Governance status

Implementation and mocked contract tests do not constitute release approval. The current `canvas-image-corpus-v2` report is retained non-passing evidence: v6 completed 49/50 candidate requests, produced 39/49 usable candidates and 6/10 usable reference results, and remained below the instruction-following threshold. The Canvas pilot gate requires:

1. an immutable Fal entitlement/procurement reference;
2. a frozen corpus of at least 50 contexts;
3. a retained same-context comparison report showing the evaluation passed; and
4. an administrator attestation through `/operations/canvas`.

Until those items are present, `second_image_adapter` remains unapproved even when `FAL_KEY` is configured.
