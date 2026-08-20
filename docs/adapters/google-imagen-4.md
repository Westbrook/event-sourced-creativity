# Google Imagen 4 composite image adapter

Status: implemented candidate; paid qualification not yet run.

Adapter ID: `google-imagen-4`  
Adapter version: `v1`  
Frozen retry corpus: `canvas-image-corpus-v2` (50 contexts)

## Why this replaces the Ideogram candidate

Fal marks its hosted Imagen 4 endpoints as deprecated and unsupported. The registered candidate therefore uses the generally available Imagen 4 models on Google Vertex AI for text-to-image work:

- draft: `imagen-4.0-fast-generate-001`
- standard: `imagen-4.0-generate-001`
- full/ultra: `imagen-4.0-ultra-generate-001`

Imagen 4 is text-to-image only. It does not accept reference pixels, perform image editing, or provide subject/style customization. Requests with opted-in reference pixels are therefore routed explicitly to Fal's current `fal-ai/nano-banana-2/edit` endpoint, a Google Gemini image-editing model that accepts up to 14 images. The receipt records the actual provider and model; the application never labels an edit as an Imagen 4 result.

## Request normalization

Imagen 4 accepts `1:1`, `3:4`, `4:3`, `9:16`, and `16:9`. The adapter selects the closest supported ratio using logarithmic ratio distance and records both the requested dimensions and provider-native dimensions. Draft and balanced requests use 1K output. Full requests use 2K output where supported. The adapter returns a normalization reason whenever requested dimensions cannot be preserved exactly.

The Imagen prompt contract is limited to 480 input tokens. Forma builds a deterministic, technique-aware compact representation with a conservative 1,800-character envelope. It retains every active decision's type, intent, text, weight, and spatial scope, plus typed relationships, standing constraints, and reference policy. If that representation still cannot fit, the request fails before provider submission with a copyable prepared prompt. Evaluation pairs pass the exact same compact prompt to the baseline and candidate.

## Authentication and custody

Vertex authentication is server-only. The worker supports either:

- `GOOGLE_SERVICE_ACCOUNT_JSON`, exchanged for a short-lived OAuth token and cached only in worker memory; or
- `GOOGLE_VERTEX_ACCESS_TOKEN` for short-lived local evaluation use.

`GOOGLE_CLOUD_PROJECT` is required and `GOOGLE_CLOUD_LOCATION` defaults to `us-central1`. Reference-edit requests use the server-held `FAL_KEY`. No credential is returned to the browser or entered in the governance UI.

Reference images are validated before transmission, sent only when their block-level pixel policy opts in, and represented as data URIs to the Fal edit endpoint. Provider output is copied into private application storage by the existing generation workflow.

## Safety and failure behavior

- Exact-prompt and reference moderation runs when the existing moderation provider is available.
- Imagen requests set `includeRaiReason`, `includeSafetyAttributes`, `block_medium_and_above`, and SynthID watermarking.
- Fal edit requests use safety tolerance `4` and `limit_generations: true`.
- Provider safety rejections retain the exact compacted prompt in the technical receipt.
- Missing project, credential, reference-edit entitlement, unsupported format, excessive references, and prompt overflow fail before billable provider submission.
- Vertex HTTP failures and Fal queue failures preserve request IDs where providers supply them.

## Cost receipt

Published Vertex rates are recorded as flat output charges: Imagen 4 Fast `$0.02`, Imagen 4 `$0.04`, and Imagen 4 Ultra `$0.06` per image. Fal Nano Banana 2 edit is estimated by output tier: 0.5K `$0.06`, 1K `$0.08`, 2K `$0.12`, and 4K `$0.16`. Evaluation reports separate image-provider cost from evaluator and moderation cost.

## Approval boundary

The previous `fal-ideogram-v4@v2` report remains immutable failed evidence. This adapter cannot be approved from administrator-entered claims. The server must retain a passing report for `google-imagen-4@v1` and `canvas-image-corpus-v2`; only then can an administrator review the contract/entitlement reference and record approval.

## Primary references

- Google Imagen 4 model card and supported capabilities: https://cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/4-0-generate
- Google Imagen generation REST request: https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images
- Google Imagen output resolution: https://cloud.google.com/vertex-ai/generative-ai/docs/image/set-output-resolution
- Google Vertex AI pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing
- Fal Nano Banana 2 edit schema: https://fal.ai/models/fal-ai/nano-banana-2/edit/api
- Deprecated Fal Imagen 4 endpoint: https://fal.ai/models/fal-ai/imagen4/preview/api
