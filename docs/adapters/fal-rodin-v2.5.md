# Fal Rodin V2.5 adapter contract

Source snapshot: **2026-09-02**. This is the contract for the two named fal endpoints, not for Hyper3D's direct API or other Rodin versions. Public documentation and schemas were inspected without submitting paid inference.

## Endpoint boundary

| Mode | Endpoint | Input |
| --- | --- | --- |
| Text to 3D | `fal-ai/hyper3d/rodin/v2.5/text-to-3d` | A nonempty prompt; no image fields. |
| Image to 3D | `fal-ai/hyper3d/rodin/v2.5` | One to five ordered `image_urls`; optional prompt. |

The shared field allowlist is `prompt`, `tier`, `seed`, `geometry_file_format`, `material`, `quality_mesh_option`, `texture_mode`, `enable_creative_mode`, `hd_texture`, `texture_delight`, `is_micro`, `TAPose`, `bbox_condition`, and `addons`. Only the image endpoint additionally exposes `image_urls`, `use_original_alpha`, and `preview_render`. Do not send the latter two switches to the text endpoint. Sources: [fal text API](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/text-to-3d/api), [fal image API](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/api).

Machine-readable sources: [text OpenAPI schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fhyper3d%2Frodin%2Fv2.5%2Ftext-to-3d), [image OpenAPI schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fhyper3d%2Frodin%2Fv2.5). Refresh these before extending an adapter; do not spread an arbitrary settings object into the provider request.

Neither endpoint accepts a mesh, model URL, or editable 3D scene. Reusing an existing model requires a rendered image reference. These endpoints generate a new asset; they do not promise to preserve the source mesh's topology, rig, or exact geometry.

## Provider settings

| Field | fal values or shape |
| --- | --- |
| `tier` | `Gen-2.5-Minimum`, `Gen-2.5-Extreme-Low`, `Gen-2.5-Low`, `Gen-2.5-Medium`, `Gen-2.5-High`, `Gen-2.5-Extreme-High`; default High. |
| `quality_mesh_option` | `Auto`; `4K Quad`, `8K Quad`, `18K Quad`, `50K Quad`, `100K Quad`, `200K Quad`; `2K Triangle`, `20K Triangle`, `50K Triangle`, `150K Triangle`, `500K Triangle`, `1M Triangle`, `2M Triangle`. |
| `geometry_file_format` | `glb`, `usdz`, `fbx`, `obj`, `stl`; default `glb`. |
| `material` | `PBR`, `Shaded`, `All`, `None`; default `All`. |
| `texture_mode` | `legacy`, `extreme-low`, `low`, `medium`, `high`; omit for the tier default. |
| `seed` | Integer, 0–65,535. |
| `bbox_condition` | Object containing integer `width`, `height`, `length`. |
| `addons` | Object containing boolean `high_pack`. |

The mesh selector replaces direct-API `mesh_mode`, `quality`, and `quality_override`. Minimum forces 50K Triangle. Extreme-Low/Low/Medium support up to 1M Triangle; High/Extreme-High support 20K–2M Triangle. Validate combinations, not just each enum independently. `Auto` selects 50K Triangle for Minimum/Extreme-Low/Low, 500K for Medium/High, and 1M for Extreme-High. Source: [fal schema and settings descriptions](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/api).

Upstream Gen-2.5 documentation additionally constrains creative mode to Medium or higher and micro detail to Extreme-High. Enforce these before submission. Each bounding-box component must be 1–2,048, ordered X/width, Y/height, Z/length when translated upstream; no physical unit is specified. Sources: [Gen-2.5 specification](https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5), [bounding-box specification](https://docs.hyper3d.ai/en/api-specification/bbox-control).

Do not forward upstream-only `images`, `mesh_mode`, `quality`, `quality_override`, `geometry_instruct_mode`, `image_label`, `is_symmetric`, or `uhd_texture`. Fal also does not expose upstream `Hybrid` material or `extreme-high` texture mode. `condition_mode` belongs to older Rodin generations. A negative prompt or safety-checker switch is absent from these fal schemas. `enable_creative_mode` is fal's translation for upstream creative geometry generation.

## Prompt and reference preparation

Enforce the upstream **1,024-character** ceiling on the actual submitted prompt, including any compiled context. Text mode requires content; image mode may omit the prompt and let the provider derive guidance. Do not silently truncate authored content. The first reference supplies material guidance, so keep reference order visible and stable. Sources: [Gen-2.5 input specification](https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5).

Hyper3D lists JPG, PNG, and WebP as common accepted image formats. Its current guidance treats framing, resolution, background, lighting, and subject isolation as optional capture choices. Additional views can supply more detail; one image is sufficient to start. The inspected Gen-2.5/fal documentation does **not** publish numeric image byte-size, pixel-size, or aspect-ratio caps. Do not present an application upload limit, a recommended thumbnail size, or the example values in generic fal errors as a Rodin requirement. Source: [official image-to-3D FAQ](https://hyper3d.ai/features/image-to-3d).

Fal accepts accessible hosted image URLs or data URIs. Private application asset URLs must be resolved or uploaded by the server before submission. A URL that requires a login is not a valid provider reference. Source: [fal file input guidance](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/api#files).

## Outputs and cost

Retain required `model_mesh`, optional additional `model_meshes`, `textures`, and `seed`. Do not assume one mesh or that every returned image is a PBR map: both public playground examples include a preview image in `textures`. File metadata may use `application/octet-stream`; image dimensions can be null. Preserve filenames and artifacts so material variants and supporting files remain downloadable. Sources: [image playground result](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5), [text playground result](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/text-to-3d).

**Application transfer limit:** Forma limits each generated file to **64 MiB** when copying it into private storage. This is an application memory/transfer policy, not a published Rodin file-size limit. The adapter retains the original provider artifact manifest and paid request receipt before downloading. Metadata, response headers, and cumulative streamed bytes enforce the limit; an interrupted or oversized transfer does not purchase a replacement generation. Files are persisted individually before their in-memory bytes are released.

The retained manifest contains provider URLs and metadata, not the bytes of a file whose transfer failed. Provider URLs can expire; recovery is possible only while those files remain available. Uploaded references request a one-day lifecycle. Sources: [fal data retention](https://fal.ai/docs/documentation/model-apis/media-expiration), [object lifecycle preference](https://fal.ai/docs/documentation/model-apis/common-parameters#x-fal-object-lifecycle-preference).

Artifact downloads allow HTTPS on `fal.media` and its subdomains, plus the documented `storage.googleapis.com/falserverless/` output bucket. The latter is not an input-upload destination. Other buckets, credentials in URLs, nonstandard ports, fragments, and redirects are rejected; downloads never receive the Fal API key. Both endpoint schemas above include this output bucket in their examples.

A confirmed content rejection for the original completed request records a completed submission at zero cost, preserving the provider request ID and original error. Fal charges for successful outputs. Uncertain submission, polling, authentication, expired-request, malformed-result, and file-transfer failures do not establish a refund; their existing receipt stays reserved or billed as appropriate. A previously settled cost is never rewritten. Source: [fal pricing](https://fal.ai/docs/documentation/model-apis/pricing).

Fal publishes **$0.40 per generation** and **+$0.80 for HighPack** on both playgrounds. Its tier descriptions say Extreme-High doubles the base charge. The resulting estimate is `0.40 × (Extreme-High ? 2 : 1) + (HighPack ? 0.80 : 0)`: $0.40, $0.80, $1.20, or $1.60. This is a pre-submit estimate derived from published rates, not a provider billing receipt; recheck rates before changing it. Sources: [fal image pricing](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5), [fal text pricing](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/text-to-3d), [fal tier multiplier](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/text-to-3d/api).

**Documented disagreement:** fal's HighPack description still mentions approximately 16× quad faces. The current upstream Gen-2.5 specification explicitly limits HighPack to a texture upgrade, without changing geometry or adding a high-poly mesh. Present HighPack as a texture upgrade; do not promise increased geometry. Upstream's separate credit pricing is not fal's dollar pricing. Source: [Gen-2.5 HighPack semantics](https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5#creative-mode).

## Failures and user guidance

Provider content checks can reject images **and text-only requests**, because text is first converted to an image. Preflight can prevent known malformed requests, but cannot guarantee moderation acceptance. Preserve the user's authored input and provide a clear revision path; do not silently remove safety controls or retry unchanged rejected content. Source: [Hyper3D errors](https://docs.hyper3d.ai/en/api-specification/errors).

| Upstream code | User-facing recovery |
| --- | --- |
| `IMAGE_CONTENT_VIOLATION` | The provider could not accept this content; choose another reference or revise the prompt. Regional restrictions may apply. |
| `API_OBJECT_NOT_FOUND_ON_IMAGE` | Try another supported image with the intended subject easy to inspect. |
| `INVALID_REQUEST` | Show the affected setting and provider detail; correct the request before trying again. |
| `API_PARALLELISM_LIMIT_REACHED` | Wait for an existing generation to finish. |
| `API_INSUFFICIENT_FUNDS`, subscription/permission errors | Explain that provider account access or balance needs attention. |
| `IMAGE_LABEL_LENGTH_TOO_LONG` | Treat as an adapter defect; fal requests should not contain `image_label`. |

The direct Hyper3D API can return HTTP 201 with an application-level `error`; its wrapper may translate this. Do not treat an error body as a generated asset. Honor retry timing for transient failures; deterministic body errors require correction. Source: [Hyper3D error contract](https://docs.hyper3d.ai/en/api-specification/errors).

Fal's standard validation response is `detail[]` with `type`, `loc`, `msg`, and optional `ctx`. Use `type` for logic and `ctx` for actual limits; show `msg` without parsing it. `content_policy_violation` is nonretryable HTTP 422. Map image decoding/format errors to replacement or re-encoding, download errors to an accessible upload, and size errors to the supplied limit. Honor `X-Fal-Needs-Retry: 0` on 5XX and 429, retaining `X-Fal-Retryable: false` for older integrations. A positive retry header never overrides a deterministic validation or safety error, and the adapter never repeats a paid POST automatically. Infrastructure errors instead use a string `detail` and `error_type`. Sources: [fal model errors](https://fal.ai/docs/documentation/model-apis/errors), [fal request errors](https://fal.ai/docs/documentation/model-apis/request-errors), [retry header](https://fal.ai/docs/documentation/serverless/reliability/retries#per-response-x-fal-needs-retry).

## Evidence and verification boundary

The public OpenAPI URLs above are the executable request/response contract. They can be refreshed without a provider key or generation charge:

```sh
curl --fail --silent --show-error --get \
  --data-urlencode 'endpoint_id=fal-ai/hyper3d/rodin/v2.5/text-to-3d' \
  'https://fal.ai/api/openapi/queue/openapi.json' \
  --output /tmp/rodin-v2.5-text.openapi.json
curl --fail --silent --show-error --get \
  --data-urlencode 'endpoint_id=fal-ai/hyper3d/rodin/v2.5' \
  'https://fal.ai/api/openapi/queue/openapi.json' \
  --output /tmp/rodin-v2.5-image.openapi.json
```

The focused contract suite, [`tests/rodin-contract.test.mjs`](../../tests/rodin-contract.test.mjs), checks endpoint payload allowlists, Unicode prompt limits, reference preparation, invalid settings, tier-dependent combinations, and cost estimates. The mocked adapter suite, [`tests/rodin-adapter.test.mjs`](../../tests/rodin-adapter.test.mjs), covers both endpoints, ordered reference uploads, paid receipt recovery, moderation failures, artifact hashes, redirect rejection, per-file persistence, and bounded transfers. Neither suite calls a real provider:

```sh
node --experimental-strip-types --test tests/rodin-contract.test.mjs tests/rodin-adapter.test.mjs
```

These offline checks establish request validation against this snapshot. They do not establish live inference quality, moderation acceptance, successful downloads for every format, or final provider billing. No paid generation was performed for this research.
