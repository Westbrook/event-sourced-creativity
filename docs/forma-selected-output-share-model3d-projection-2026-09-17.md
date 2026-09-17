# Current-view GLB share copies

`projectSelectedOutputShareModel3d` creates a separately identified share copy of a supported current GLB. It addresses native scale derivatives whose current geometry is valid but whose file also retains old position streams. It does not change the retained asset, native geometry writer, ordinary download, or existing byte qualification policies.

## Identity and authority

The pure asynchronous helper takes plain `Uint8Array` bytes and an exact closed `{sha256, byteLength}` expected source descriptor. It captures both before its first await, rejects shared memory and unsupported object shapes, and verifies source identity before parsing/repacking.

A successful opaque result is deeply frozen at its exposed levels:

```typescript
{
  status: "qualified",
  policy: "selected-output-share-glb-current-view-v1",
  source: { sha256, byteLength },
  public: {
    sha256, byteLength, mimeType: "model/gltf-binary",
    qualificationPolicy, staticPolicy, texturePolicy? // Textured copies only.
  }
}
```

`copyProjectedSelectedOutputShareModel3dBytes(result)` returns a fresh public-byte copy only for the exact local opaque result. Serialized facts, clones, proxies, and refusals cannot retrieve bytes. Source and public hashes have separate roles even when an already compact input produces identical bytes. A caller must never substitute the public hash for the selected retained source identity.

The result establishes no Document ownership, current revision, rights, consent, audience, or publication authority. The integration must separately bind native current custody to `source` and bind review/public storage to `public`, with the projection policy recorded independently from the byte qualification policy. This module has no network, provider, storage, route, schema, or UI behavior.

## Supported representation

The native bounded GLB validator first establishes framing and reference validity. The source must then use exact compact JSON with only required GLB padding. Duplicate keys, alternate escapes, and extra JSON whitespace cannot be normalized away. The projector changes only the accessor/view arrays, necessary reference indices, buffer length, and container layout.

Every source accessor and view is closed before filtering. Accessors must have zero offset and own one exact packed view; there is no stride, sparse data, normalized data, overlapping/aliased view, or hole within a view. Multiple primitives may safely refer to the same accessor. Two accessors may not claim the same view. Source ranges must cover the complete BIN in disjoint order, with only required zero alignment and final padding.

An inactive accessor can be omitted only when it is a closed packed Float32 VEC3 stream with finite components and exact minimum/maximum bounds. Every view must belong to an accessor or an image; orphan views and opaque tails are refused. This is an explicit current-view selection rule, not a claim that the omitted stream's native edit history has been proved. No predecessor history needs to be fetched.

All mesh attributes and indices, images, materials, samplers, nodes and scenes are preserved in the candidate graph. Unknown keys or resources are not removed as unused. Remaining unsupported properties therefore still cause the unchanged final qualifier to refuse. Rights/provenance metadata, arbitrary names, extras, URIs, and extensions cannot be stripped to force a pass. The existing finite generic names and exact PNG resolution profile are supported only under the existing textured gate's conditions.

Active accessor components, index widths/values, and PNG bytes are copied exactly. Signed zero and Float32 rounding are preserved. Active bounds are preserved and validated by the unchanged final gate, never silently repaired. Current POSITION bytes may differ from old positions after a rounded scale; only the selected current stream is included. No geometry conversion, image re-encoding, or regeneration occurs.

The packed copy is qualified under the unchanged `selected-output-share-glb-untextured-v1` or `selected-output-share-glb-png-textures-v1` policy before becoming an opaque result. Native static-preview qualification and the existing sequential PNG metadata/decoded-pixel checks remain mandatory. Source and output are each bounded to 64 MiB, JSON to 2 MiB, and existing native graph/component limits apply. Source, candidate, qualifier copies, and texture decoding are finite; this does not claim a device performance budget.

## Limits and acceptance

Interleaved native derivatives, two accessors sharing a buffer view, unsupported active semantics, unknown metadata, and arbitrary unused data remain explicit compatibility limits. An original POSITION accessor still used by a different current semantic is not discarded; that semantic must pass the final qualifier, including its metadata restrictions. This initial packed subset supports ordinary single and repeated native uniform scales of qualified packed untextured or PNG-textured assets. It does not claim every privately valid GLB can be shared.

The focused synthetic suite compares independently decoded active render data and exact resource bytes before/after projection. It uses the actual native scale writer for single/repeated edits, covers different index widths, signed zero and rounding collisions, and verifies meaningful malformed/metadata/layout/identity refusals. A collision case establishes that distinct old coordinates can round to the same current geometry without surviving in the share copy. Source input mutation and opaque-result forgery are also covered.

The projector cannot infer visible artistic content, sensitive content in texture pixels, numerical steganography, or human publication permission. Those are unchanged limits of the existing byte gates. No accepted real asset or live provider journey is needed to verify this pure increment.

The implementation is independently reviewable before integration. Enabling publication requires the separately owned custody/lifecycle composition to record both identities and the projection policy; publication is not claimed merely because these synthetic tests pass.
