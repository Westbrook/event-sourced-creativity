# Fal Ideogram V4 image adapter capability receipt

Adapter: `fal-ideogram-v4`  
Version: `v1`  
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
| Compiled prompt structures | Prose, bullets, JSON, and XML use the same bounded compiler as the primary adapter. |
| Draft/full quality | Draft maps to the fast endpoint with `TURBO`; medium maps to `BALANCED`; full maps to `QUALITY`. |
| Custom dimensions | 512–3840 px per side, multiples of 16, validated before submission. |
| Safety | Exact prompt and each selected reference are preflighted; Fal's safety checker is always enabled. |
| Reference pixels | One PNG, JPEG, or WebP reference is passed as a server-created data URI. Strength is derived from the block's pixel-use policy. |
| Multiple references | Not claimed. Requests with more than one reference use the primary adapter and record the selection reason. |
| Rights | Existing reference selection and rights assertions remain upstream of the adapter and are represented in the compiled request receipt. |
| Failure behavior | Authentication, validation, provider, queue failure/cancellation, timeout, empty result, and download errors use normalized provider errors with retry guidance. |
| Usage/cost | OpenAI token counts remain zero for Fal inference. Image cost is recorded separately from the published per-megapixel rate and marked as a rate estimate. |
| Partial images | Not claimed. The final result is durable; no synthetic streaming receipt is emitted. |

## Laboratory preview

`/laboratory/image-adapters` calls the production request selector without calling either provider. It previews draft, full, one-reference, multi-reference, and WebP request shapes; exposes the chosen adapter and capability-based fallback reason; estimates Fal's output-pixel charge; and shows the normalized progress and receipt pipeline. This dry preview is not evidence that the paid paired evaluation passed.

## Governance status

Implementation and mocked contract tests do not constitute release approval. The Canvas pilot gate additionally requires:

1. an immutable Fal entitlement/procurement reference;
2. a frozen corpus of at least 50 contexts;
3. a retained same-context comparison report showing the evaluation passed; and
4. an administrator attestation through `/operations/canvas`.

Until those items are present, `second_image_adapter` remains unapproved even when `FAL_KEY` is configured.
