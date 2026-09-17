# Closed PNG-textured GLB qualification

`qualifySelectedOutputShareTexturedModel3d` is a separate pure entry point with policy `selected-output-share-glb-png-textures-v1`. The original untextured qualifier retains its existing policy and behavior. Neither entry point grants custody or publication authority. This successor preserves exact selected bytes; it does not remove labels, flatten textures, re-encode images, rewrite geometry or generate a replacement.

The graph supports native static triangles with packed float POSITION/NORMAL/COLOR_0 attributes, optional unsigned indices, and float TEXCOORD_0 when the primitive's material uses a supported PNG texture. Normal, base-color and metallic/roughness texture roles are supported; the normal map uses the native loader's derivative path when tangents are absent. Texture references contain only an index and optional `texCoord: 0`. All other UV sets, texture transforms, normal-scale overrides, image MIME families, URI/data-URI resources, extensions, skins, animations and compressed geometry remain outside this profile.

Each used texture reaches a distinct embedded PNG image and image buffer view. Texture reuse across materials is allowed only for the same role. Every material, texture, image, sampler, accessor, view, mesh and node must be reached. A primitive must have TEXCOORD_0 if and only if its material has a texture. Untextured primitives may coexist without a UV accessor. Image views cannot alias geometry or another image. Sampler enum values retain native validation; missing samplers use native defaults, while declared unused samplers refuse. Original bounds, normal/color semantics, full indexed-vertex use and packed geometry checks still apply.

At most eight textures and 32,000,000 total declared decoded image pixels are supported. Both bounds are checked before PNG inflation. PNG identities are derived from slices of the privately captured GLB, after its complete native static qualification and expected top-level SHA-256/length match. PNGs are then checked sequentially through the independently reviewed explicit resolution-only image profile. Per-image descriptor facts supplied by a caller cannot replace these slices. A failed image refuses the entire model.

The PNG resolution profile accepts the existing PNG gate's clean images plus its exact complete fixed resolution-only trio, with full CRC/decode/hash checks. It does not accept arbitrary EXIF, unknown ancillary fields or `caBX`/C2PA data. The original PNG entry point remains strict and refuses resolution metadata. The textured GLB qualifier does not create another PNG metadata parser or bypass image qualification.

Geometry and image views must cover the BIN payload. Between views, only the exact zero padding required for four-byte alignment is accepted. This profile also accepts the same final zero alignment through `ceil(lastUsedByteEnd / 4) * 4` when an exporter includes it in the declared buffer length. It never accepts arbitrary trailing zeros or opaque bytes. Native validation separately checks the GLB's outer framing and final binary chunk padding.

JSON still must equal its compact parsed serialization plus only required GLB space padding. The only optional descriptive fields admitted are this finite generic exporter profile:

| Field | Fixed supported value |
| --- | --- |
| `asset.generator` | `Khronos glTF Blender I/O v4.3.47` |
| Scene name | `Scene` |
| Node, mesh or material name | `model` |
| Normal image name | `texture_normal` |
| Base-color image name | `texture_diffuse` |
| Metallic/roughness image name | `texture_metallic-texture_roughness` |

The image label must match its actual material role. These fields may be absent. Arbitrary user names, version patterns, suffixes, source references, copyright strings, extras and unknown properties remain refused. This finite encoding profile is not an inference of the user's permission to publish those bytes.

The qualified result has opaque local byte identity and records its own policy, the static model policy, PNG texture policy, expected SHA-256, byte length and MIME. A fresh copy can be obtained with the existing `copySelectedOutputShareModel3dBytes`; copied, serialized or forged result objects cannot retrieve bytes. Input mutation during asynchronous texture checks and mutation of a returned copy cannot change the private qualified source.

## Verification boundaries

Focused synthetic cases exercise positive three-texture PBR graphs, one-role subsets, optional/default samplers, shared same-role textures, mixed textured/untextured primitives, eight/nine texture boundaries, the aggregate pixel cap, every broken or unused dependency, strict labels, PNG metadata/CRC/compression failures, alignment, top-level digest ordering and snapshot identity. All original untextured tests remain accepted under their original entry point. Final source review includes the exact separately approved PNG resolution-profile dependency.

An isolated local browser fixture passed a synthetic three-PNG model to the installed Three.js GLTFLoader and observed three actual ImageBitmap decodes, the expected mesh/UV/material assembly, and only three local blob fetches. That is loader/decode coverage, not GPU rendering, physical-device behavior or artistic quality. No retained user asset was rendered by that fixture. Its source was captured before the explicit PNG resolution adapter was integrated; the clean-image decode path and exact synthetic bytes remained unchanged, so that browser exercise was not repeated.

A separate local compatibility observation qualified the already downloaded 21,205,152-byte GLB with SHA-256 `6299862c327a7b4adabb3b9b3acba8e9bca6e5646bf6e8477ec046d568e307f7`. Its opaque returned bytes matched that exact hash and length, and the original file and supplied bytes remained unchanged. There were no network attempts, no rendering or playback, and no new generation. The earlier untextured-gate refusal remains preserved as compatibility history; the new result establishes only this explicit textured format policy, not whole selected-output sharing completion.

Graph reachability does not prove that every texture pixel or channel is visible: a metallic/roughness texture has unused color channels, an atlas may contain unobserved pixels, and geometry may be occluded. This gate makes no claim to detect pixel/numerical steganography, infer source-image semantics, establish rights, or replace human content review. Current native completion/edit/reset custody, a selected public manifest/title, explicit sharing choice, token/lifetime policy and exact-byte delivery remain separate integration work. No sharing route, schema, audience or provider behavior is changed here.
