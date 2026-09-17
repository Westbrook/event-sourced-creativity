# Selected media publication integration

This increment joins the existing native retained-media custody, personal publication authority and closed byte-qualification proofs to the selected-output review lifecycle. It supports the five explicit WAV, MP4 and GLB profiles described in the media candidate contract. The dispatcher still has literal `creationEnabled = false`. No runtime flag, schema presence, request field or authenticated actor changes that value. No live sharing, provider execution, retained-asset mutation, schema migration, retention activation or deployment forms part of this verification.

## Current source and deliberate review

Preparation and approval derive the exact current Document selection through `readNativeRetainedMediaCustody`, establish completed personal actor=payer publication provenance through `readSelectedOutputShareMediaAuthority`, and qualify bounded owned media bytes through `readNativeRetainedMediaBytes`. Pure format qualification grants no custody or publishing permission. The supported native lineage and deliberate refusal cases are documented in the separate authority note.

The selection retains the Document/artifact identity, revision, content hash, source media hash, qualification policy and exact-bytes projection policy. Candidate data separately binds source and public media hashes, qualification policy and projection policy. The initial exact-bytes branch requires equal media hashes; it does not overload the source hash to describe a future derivative.

The server derives the public descriptor and finite disclosure from its actual opaque native result. It applies the effective native source expiry and the authority expiry to the explicitly reviewed title and expiry. Preparation stores only the bounded selection, review choices, identities, expiry bounds and hashes. It stores no file buffer, R2 URL or public copy of a private receipt.

Approval uses a freshly derived candidate and the existing explicit approval hash. The final conditional write joins schema readiness, current native source, current creator policy, paid provenance, exact prepared row and live deadline in the same atomic statement. A media issuance uses balanced conjunctions of the same ordered sibling proof relations to stay below D1's expression-depth limit. The native predicates, relation order, binding order and outer write guards are unchanged; text retains the default linear conjunction.

Only the first successful issuance can return its random secret. Replay returns metadata, never a reconstructed or rotated token. If MEDIA no longer matches, cancellation has occurred, or a byte-specific rights deadline has elapsed when the final SQL write completes, the response refuses. The already-consumed candidate stays consumed and a retry cannot disclose a replacement secret.

## Recipient contract

| Route | Result |
| --- | --- |
| `GET /api/selected-output-shared/:token` | Existing selected-output JSON envelope with finite media descriptor, reviewed title, expiry, Forma attribution and the applicable disclosure. |
| `GET /api/selected-output-shared/:token/file` | Complete qualified owned WAV, MP4 or GLB buffer for that exact token-bound current selection. |
| `GET /api/selected-output-shares` | Existing canonical-owner metadata list, including the five supported media profiles. |
| `DELETE /api/selected-output-shares/:shareId` | Existing canonical-owner revocation behavior. |

The file route accepts only the exact 32-character token path and GET method. It does not accept a source identifier, asset URL, MIME override, query, fragment or alternate suffix. It does not redirect to storage, expose an R2 stream, or implement partial byte ranges. Filenames are fixed: `forma-audio.wav`, `forma-video.mp4`, `forma-3d.glb`.

Both public reads resolve the stored canonical owner directly without manufacturing an authenticated Request. They obtain fresh native custody, publication authority and byte qualification. File delivery obtains a locally owned full copy and then executes the complete final share/source/authority proof. A synchronous authentic-byte state check follows that last SQL await and precedes disclosure, retaining the existing environment, DB, MEDIA, configuration, cancellation, expiry and applicable 3D rights bindings.

The entire file operation, including schema/token lookup and the last share proof, has a 30-second cancellation deadline derived from the actual request signal. This outer deadline is specific to file delivery; it is not a new whole-operation timing claim for JSON, preparation or approval. File responses use the qualified MIME and exact length, attachment disposition, `private, no-store`, `nosniff`, `no-referrer`, and a restrictive sandbox CSP.

Owner management validates the exact closed selection shape and supported output/profile/projection combinations without reading native content or media. An expired source or withdrawn generation permission does not prevent its canonical owner from seeing issued-link metadata and revoking access. Unknown future projection policies still refuse. Existing owner, schema, cursor and pagination proofs remain in place.

## Limits and remaining work

This implements an independently verifiable backend boundary. It does not activate creation or add a media review/view UI. Those changes require the separately reviewed client contract and existing retention/runtime activation prerequisites. No arbitrary Document sharing fallback is added.

MP3, Image, unsupported container metadata, specialized Outputs Video/GLB edited lineage, recovery/workflow/replacement lineage and transformed GLB projection are not admitted by this branch. The separately sealed GLB current-view projector is optional compatibility work and is not silently accepted by the exact-bytes policy. A valid private native asset can therefore remain unqualified for selected public sharing without being a private-reader defect.

Qualification constrains container structure and descriptive metadata. It does not certify the meaning of audible samples, rendered pixels, geometry or covert information within permitted content. Audio watermark disclosure reports the source declaration, not detection or absence. The explicit x264 profile discloses its known encoder configuration. Synthetic local fixtures prove code behavior; they do not constitute new live-provider, invoice, physical-device or whole-original-plan acceptance.

## Evidence history

The independent boundary review preserved and repaired two substantive races: MEDIA replacement and 3D rights expiry during the final share SQL await. The authority review preserved and repaired private-only unsupported completion lineage that could disappear from its redacted public event.

Actual local workerd D1 initially passed nine of eleven new media flows. The final issue UPDATE failed at expression depth 100 for edited Video prefix and original Outputs GLB. The exact failing statements and a minimal balanced-conjunction experiment are preserved. Final source qualification, focused test totals, independent review and exact source hashes are recorded in the integration evidence manifest; experimental SQL transforms are not presented as final source verification.
