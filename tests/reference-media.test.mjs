import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inferDocumentArtifactKind } from "../src/model/document-output-intent.ts";
import { hasSavedModel3dView, isImageReference, referenceMedium } from "../src/model/reference-media.ts";
import { model3dPresetView } from "../src/model/model3d-view.ts";

const legacyPitchSource = {
  reference_id: "pitch-source-reference",
  label: "Project source excerpt",
  text: "FORMA: YOUR CONTENT. ONE CONTEXT. INFINITE PATHS TO YOUR TARGET. Formerly .doc, .ppt, .mov, .mp3, and .psd.",
  source_type: "pasted-text",
  source_citation: "Pasted and explicitly licensed by the project creator",
  subtype: "Mood",
  weight: 0.8,
  authority: "authored",
  pixel_reference_mode: "context_only",
  extraction_status: "ready",
};

test("the existing pitch context's historical pasted source remains text despite its legacy pixel-policy hint", () => {
  assert.equal(referenceMedium(legacyPitchSource), "text");
  assert.equal(isImageReference(legacyPitchSource), false);
  assert.equal(referenceMedium({ ...legacyPitchSource, source_type: undefined }), "text", "historical text without any MIME or source-kind metadata remains readable text");
  assert.equal(referenceMedium({ ...legacyPitchSource, source_kind: "text", source_mime_type: "text/plain", media_type: "text/plain" }), "text", "new project-intake metadata agrees with historical inference");
});

test("trusted source MIME takes priority over misleading labels, fallback metadata, and image hints", () => {
  assert.equal(referenceMedium({ source_mime_type: "application/pdf", media_type: "image/png", label: "misleading.png", media_url: "/api/media/opaque", pixel_reference_mode: "inspiration" }), "document");
  assert.equal(referenceMedium({ source_mime_type: "text/plain; charset=UTF-8", media_type: "image/png", label: "copy.png", media_url: "/api/media/opaque", pixel_reference_mode: "context_only" }), "text");
  assert.equal(referenceMedium({ source_mime_type: " IMAGE/PNG ; charset=binary", source_kind: "text", media_url: "/api/media/image" }), "image");
  assert.equal(referenceMedium({ source_mime_type: "application/ld+json" }), "text");
  assert.equal(referenceMedium({ source_mime_type: "application/octet-stream" }), "unknown");
});

test("uploaded PDFs, Word files, presentations, and spreadsheets are documents rather than images", () => {
  for (const [label, mime, sourceKind] of [
    ["source.pdf", "application/pdf", "pdf"],
    ["source.doc", "application/msword", "word"],
    ["source.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "word"],
    ["source.ppt", "application/vnd.ms-powerpoint", "presentation"],
    ["source.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "presentation"],
    ["source.xls", "application/vnd.ms-excel", "spreadsheet"],
    ["source.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheet"],
    ["source.odt", "application/vnd.oasis.opendocument.text", "word"],
  ]) {
    const properties = { label, media_url: "/api/media/opaque", source_mime_type: mime, source_kind: sourceKind, pixel_reference_mode: "context_only" };
    assert.equal(referenceMedium(properties), "document", label);
    assert.equal(isImageReference(properties), false, `${label} must never expose image analysis or pixel transfer`);
    assert.equal(referenceMedium({ label, media_url: "/api/media/opaque", source_kind: sourceKind }), "document", `${label} remains a document without legacy MIME metadata`);
  }
});

test("image, audio, and video retain their own media identity and historical image permissions", () => {
  assert.equal(referenceMedium({ source_mime_type: "image/webp", media_url: "/api/media/opaque" }), "image");
  assert.equal(referenceMedium({ media_type: "audio/mpeg", media_url: "/api/media/opaque" }), "audio");
  assert.equal(referenceMedium({ media_type: "video/mp4", media_url: "/api/media/opaque" }), "video");
  assert.equal(referenceMedium({ source_type: "audio-upload", label: "Narration", media_url: "/api/media/opaque" }), "audio");
  assert.equal(referenceMedium({ source_type: "video-upload", label: "Scene", media_url: "/api/media/opaque" }), "video");
  assert.equal(referenceMedium({ source_type: "generated-image", media_url: "/api/media/opaque" }), "image");
  assert.equal(referenceMedium({ label: "legacy-reference.jpg", media_url: "/api/media/opaque" }), "image");
  assert.equal(referenceMedium({ media_url: "/api/media/legacy-reference.png?download=false" }), "image");
  assert.equal(referenceMedium({ media_url: "/api/media/opaque", pixel_reference_mode: "inspiration" }), "image", "real historical visual references keep their explicit pixel-rights controls");
  assert.equal(referenceMedium({ media_url: "/api/media/opaque", source_evidence_hash: "verified", text: "Approved document excerpt" }), "document");
  assert.equal(referenceMedium({ media_url: "/api/media/opaque", text: "Descriptive copy, but no trusted medium" }), "unknown", "opaque bytes never silently become pixels");
  assert.equal(referenceMedium({ source_page_url: "https://foreign.example/looks-like-an-image.jpg", text: "Licensed written citation" }), "text", "foreign citation URLs never grant image-preview or pixel-transfer permission");
});

test("3D originals retain their model identity despite generic MIME and legacy image hints", () => {
  for (const properties of [
    { source_mime_type: "model/gltf-binary", media_type: "image/png", media_url: "/api/media/opaque", label: "misleading.png" },
    { source_mime_type: "model/gltf+json", media_url: "/api/media/opaque" },
    { media_type: "model/vnd.usdz+zip", media_url: "/api/media/opaque" },
    { source_type: "generated-model3d", media_url: "/api/media/opaque" },
    ...["glb", "gltf", "obj", "fbx", "stl", "usdz"].map((extension) => ({ source_mime_type: "application/octet-stream", media_url: `/api/media/model.${extension}`, label: "misleading.png" })),
    { model_url: "/api/media/model.glb", model_mime_type: "model/gltf-binary", text: "A rounded vase" },
    { model_url: "/api/media/model.glb", media_url: "/api/media/model.glb", media_type: "image/png" },
  ]) {
    const source = { ...properties, pixel_reference_mode: "preserve_subject", image_caption: "Legacy preview hint" };
    assert.equal(referenceMedium(source), "model3d", JSON.stringify(properties));
    assert.equal(isImageReference(source), false);
  }
});

test("a saved model view is classified as its separate image without overriding the original", () => {
  const source = {
    model_url: "/api/media/model.glb", model_mime_type: "model/gltf-binary", model_reference_id: "original-model",
    media_url: "/api/media/saved-view.png", media_type: "image/png", source_mime_type: "image/png", reference_id: "derived-view",
    pixel_reference_mode: "context_only",
  };
  assert.equal(referenceMedium(source), "image");
  assert.equal(isImageReference(source), true);
  assert.equal(source.model_url, "/api/media/model.glb");
});

test("model visual controls require a saved view bound to a distinct original and image reference", () => {
  const properties = {
    model_url: "/api/media/model.glb", model_mime_type: "model/gltf-binary", model_content_hash: "a".repeat(64), model_reference_id: "original",
    media_url: "/api/media/model-view.png", media_type: "image/png", source_mime_type: "image/png", source_content_hash: "b".repeat(64), reference_id: "saved-view",
    model_view: model3dPresetView(),
  };
  assert.equal(hasSavedModel3dView(properties), true);
  for (const patch of [
    { media_url: null }, { media_url: properties.model_url }, { media_url: "https://provider.example/preview.png" },
    { media_type: "model/gltf-binary" }, { model_mime_type: "model/obj" }, { source_mime_type: undefined },
    { model_content_hash: undefined }, { source_content_hash: "bad" },
    { model_reference_id: "" }, { reference_id: "" }, { reference_id: properties.model_reference_id },
    { model_view: undefined }, { model_view: { ...properties.model_view, fov: 0 } },
  ]) {
    assert.equal(hasSavedModel3dView({ ...properties, ...patch }), false, JSON.stringify(patch));
  }
});

test("context blocks gate image-only affordances by medium and label text sources accurately", async () => {
  const source = await readFile(new URL("../src/components/context-block.ts", import.meta.url), "utf8");
  assert.match(source, /referenceMedium\(p\)/);
  assert.match(source, /medium==="image"\s*\?\s*html`<forma-reference-image/);
  assert.match(source, /medium==="image"\s*\?\s*html`<forma-reference-findings/);
  assert.match(source, /medium==="image"\s*\?\s*html`<forma-reference-pixel-policy/);
  assert.match(source, /class="reference-source-kind"/);
  assert.match(source, /this\.i18n\.system\("Source text"\)/);
  assert.match(source, /this\.i18n\.t\("command\.document", "Document"\)/);
  assert.match(source, /this\.i18n\.t\("action\.ready", "Ready"\)/);
  assert.doesNotMatch(source, /source_mime_type\s*\?\?\s*"image\//);
});

test("presentation, video, audio, and written format blocks do not receive an image-only frame editor", async () => {
  for (const [description, expected] of [
    ["A persuasive slide deck", "slides"],
    ["A four-second video", "video"],
    ["An audio podcast", "audio"],
    ["A written short story", "short_story"],
    ["A four-frame storyboard", "storyboard"],
  ]) {
    assert.equal(inferDocumentArtifactKind([{ type: "format", properties: { text: description, image_format: { dimensions: { width: 1536, height: 1024 } } } }]), expected, description);
  }

  const source = await readFile(new URL("../src/components/context-block.ts", import.meta.url), "utf8");
  assert.match(source, /const formatKind = this\.block\.type === "format" \? inferDocumentArtifactKind/);
  assert.match(source, /formatKind === "storyboard" \|\| !formatKind/);
  assert.match(source, /\$\{imageFormat \? html`<forma-image-format-editor/);
});
