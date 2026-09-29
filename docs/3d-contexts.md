# 3D contexts and reference scenes

Forma can keep a 3D asset as creative context, use an explicitly saved image of it in another generation, and generate downloadable models with Hyper3D Rodin v2.5 through fal.

## Add and manage a model

Choose **3D model** in the document context editor or upload a `.glb` in the reference picker. Confirm the existing source-rights declaration. The Library can create and manage the same block type.

Uploads use self-contained GLB 2.0 files up to 64 MiB. Geometry, textures, and materials must be embedded; external resource links and unsupported compressed geometry are rejected before loading. The original model stays in private project storage. The viewer provides orbit controls, keyboard controls, front/back/side/top presets, and transparent/light/dark backgrounds.

Choose **Use this view** to save a 1,024 × 1,024 PNG with its camera settings. Saving a view retains the block's visual-use policy; enable the desired visual reference mode separately. A model in **Describe only** contributes authored notes without transferring either its mesh or image.

## When to choose the view

Save the default camera while creating or managing the block. Before generating, review the selected image references and their order. The server freezes the saved PNG, its content hash, the original model identity, and the camera receipt with the request.

Rendering does not take a fresh screenshot or guess a new camera. This makes repeated requests and recovery stable, and keeps background work independent of an open WebGL viewer. To use another angle, save a different view before submission; duplicate the context block when several independently adjustable views are useful. Per-request camera overrides are not part of this initial implementation.

## Generate and export a model

Open **3D model** from the output creation controls. Write the exact description that will be sent, choose optional image references, and review the settings and cost before confirming.

- Text-to-3D requires a nonempty prompt, up to 1,024 Unicode characters.
- Image-to-3D accepts one to five ordered JPG, PNG, or WebP references and an optional prompt with the same limit. The first reference guides materials.
- Existing meshes steer a new model through saved images. Neither endpoint edits an input mesh directly.
- Shared browser and server validation checks the endpoint's allowlisted fields, enums, seed, bounding box, reference count, and tier-dependent options. Invalid values and overlong text are preserved for correction.
- Only reviewed settings are sent. There is no implicit document-wide planning call or silent prompt truncation.

The full generation dialog supports GLB, USDZ, FBX, OBJ, and STL output. Retained original meshes, additional meshes, textures, and previews have separate download links and a file manifest. GLB is the default and the supported editable context/viewer format. A valid generated GLB with unsupported viewer features remains downloadable; it is not presented as a usable image reference.

The Output context supports model deliverables with quantity unit **model**. Its native path uses a reviewed exact prompt, default GLB settings, and the explicitly disclosed active visual references. Returned model files are inspected as geometry, never as a PNG preview. Large GLB delivery packages use streaming ZIP assembly.

Current private transfer and model upload limits are 64 MiB per file. Higher-detail settings can exceed the application limit even when the provider succeeds. Start with High, Auto mesh settings, and HighPack off. A transfer-limit failure retains the original provider file URLs, metadata, and paid request receipt. The oversized file itself is not saved; recovery depends on the provider URL remaining available before it expires. The app does not buy a replacement generation.

Provider content checks can still reject a request, including an internally generated image on the text path. The interface explains this before submission and gives actionable revision guidance on refusal. No adapter can guarantee provider acceptance.

## Compose a reference scene

Once the document has an eligible image reference or saved model view, use **Compose reference scene** to arrange it with other references. Position, scale, layer order, opacity, aspect ratio, and background remain editable; all controls are available without dragging.

**Use composition** saves a bounded PNG and the exact recipe. Its constituent references in the current document switch to **Describe only**, while the new reference preserves composition. This avoids sending both the scene image and duplicate source pixels. Locked source blocks must be unlocked before changing their policy.

Use **Edit reference scene** on a saved composition to reopen it. If a source view changed, choose the explicit source-update action, review the arrangement, and save again. Old requests retain their original pixels. Copies preserve the immutable recipe and image provenance; editing a copy does not change another document's source policies.

The compositor is a 2D reference board. It does not calculate shared 3D lighting, occlusion, or physical scale. Use it to communicate placement and framing to image/video models. For Rodin multi-view reconstruction, separate consistent views of one subject are usually clearer than a collage.

## Runtime and verification

The adapter uses the existing authenticated media routes, project-scoped events, cost reservations, and durable document jobs. It records prepared, pending, accepted, and completed provider receipts. Known accepted work is recovered with retrieval requests; ambiguous submission never causes an automatic second purchase. Generated files are persisted sequentially to bound Worker memory.

Original model rights and saved-image rights are tracked independently. Derived compositions recursively verify current source rights, media hashes, model/camera bindings, and project custody before provider transfer. Captures and saves are fenced to their originating document, account, and editor. Provider input metadata never substitutes for an authorized source receipt.

Contract and lifecycle tests use mocked provider responses. Local browser fixtures exercise real WebGL rendering, PNG capture, settings validation, and composition controls. No paid provider call is required to run this verification.

For the researched API details and source links, see [Rodin adapter contract](adapters/fal-rodin-v2.5.md).

For deployment prerequisites and the limits of local verification, see [3D production readiness](3d-production-readiness.md).
