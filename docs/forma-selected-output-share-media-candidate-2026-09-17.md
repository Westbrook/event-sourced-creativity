# Selected media review data contract

This increment adds closed review data for Audio WAV, Video MP4 and GLB to `src/model/selected-output-share.ts`. It does not authorize publication, read a Document or file, call a provider, transform bytes, grant access, or activate a route. Existing text types, selection parser, projection, public decoder, approval parser, title defaults and candidate serialization remain unchanged.

## Separate source and public identities

A media request has the existing seven native selection fields plus mandatory `projectionPolicy: "selected-output-media-exact-bytes-v1"`. The parser accepts only the five existing byte profiles: WAV; strict MP4; the explicit x264 163 r3060 MP4 declaration; untextured GLB; and GLB with qualified PNG textures. Selection JSON is bounded to 1,024 bytes.

`selectedOutputShareNativeMediaSelection` validates that requested policy and returns only the original seven native fields. It does not silently discard an unknown future projection policy.

The private candidate separately retains:

- `sourceMediaSha256`: the selected native media hash.
- `publicMediaSha256`: the public descriptor hash.
- `qualificationPolicy`: the explicit container/metadata profile.
- `projectionPolicy`: the explicit source-to-public projection contract.

The current exact-bytes contract requires source and public hashes to be equal. Their distinct fields leave a clear boundary for a future witnessed projector; no projector is implemented or accepted by this increment. In particular, `selected-output-share-glb-current-view-v1` is refused.

## Finite recipient data and disclosures

`projectSelectedOutputShareMediaCandidate(selection, data, review, now)` takes a closed data record containing `descriptor`, `sourceExpiresAt` and `disclosure`. These values are only data. A server must derive them from its actual current opaque native-byte proof, independently establish publishing authority and rejoin that authority before commit or delivery. The function never copies or inspects a file buffer.

The effective `sourceExpiresAt` supplied by the server includes the native custody reader's source-revision bounds. The reviewed expiry remains explicit, is at most seven days from the supplied current time, and may not exceed that source expiry. Additional provenance expiry limits remain a server responsibility.

Recipient output contains a separately reviewed title and expiry, Forma attribution, a finite media descriptor and one closed disclosure record:

| Output | Disclosure | Meaning |
| --- | --- | --- |
| Audio | `watermark: "synthid-declared"` or `"not-declared"` | The source's declaration, not watermark detection. `not-declared` does not assert absence. |
| Video | `encoderDeclaration: null` or `"x264-163-r3060"` | Must match the selected strict or explicit encoder profile. The latter deliberately discloses the known encoder configuration. |
| 3D | `{}` | No arbitrary metadata or companion files. |

Public descriptors contain no storage URL, filename, Document/Project/input identity, prompt, selected policy, or private receipt. They retain the public media digest and finite technical facts needed to identify the public file. Audio accepts the same PCM bit depths, channel/rate bounds, fmt lengths and possible padding as the existing byte gate. Dimensions, sizes, sample counts and durations are finite and bounded.

Functional default titles are `Audio`, `Video` and `3D`. Existing text default titles still reject media kinds.

## Capture, hashing and approval

Every input is captured through closed enumerable own data properties. Getters, serializers, symbols, hidden fields, custom prototypes, unknown profiles and extra metadata refuse. All values are rebuilt and frozen before the digest await. Property insertion order does not alter the canonical candidate digest.

The candidate digest binds the requested source/revision/content identity, both media hashes, both policy identities, effective source expiry, reviewed title/expiry, public descriptor and disclosure. The additive media approval parser checks the exact deliberate approval shape and digest for a freshly derived candidate. It is not an authority grant or independent verification of a caller-supplied candidate. Additive `Any` APIs dispatch server callers while the original text APIs remain unchanged; malformed media candidates cannot fall back to the old text approval shape.

## Verification

The new declared-data suite and unchanged text candidate suite pass together: 70 tests. Scoped ESLint passes. The new tests cover all five media profiles; exact native selection extraction; privacy exclusions; canonical hashing; input mutation during hashing; every identity/review hash dependency; source/public mismatch; unsupported future projection; numeric limits; PCM variants; disclosures; lifetime boundaries; getters/serializers; media approval fallback; and legitimate text compatibility.

These tests do not claim native custody, opaque byte qualification, publication approval, an activated route, physical-device behavior or provider output. Those remain separate integration evidence.
