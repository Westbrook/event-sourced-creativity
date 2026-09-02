import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MODEL3D_SETTINGS,
  MODEL3D_FORMATS,
  Model3dInputError,
  RODIN_IMAGE_MIME_TYPES,
  RODIN_IMAGE_MODEL,
  RODIN_MATERIALS,
  RODIN_MAX_IMAGE_REFERENCES,
  RODIN_PROMPT_MAX_CHARS,
  RODIN_QUALITY_MESH_OPTIONS,
  RODIN_TEXT_MODEL,
  RODIN_TEXTURE_MODES,
  RODIN_TIERS,
  estimateModel3dCostMicrousd,
  model3dPromptLength,
  serializeRodinInput,
  validateModel3dRequest,
} from "../src/model/model3d.ts";

// Independent expectations from the two fal schemas and upstream constraints,
// retrieved 2026-08-31; see docs/adapters/fal-rodin-v2.5.md.
const PROMPT = "A carved wooden chair with brass feet.";
const REFERENCES = ["https://example.com/front.png", "https://example.com/back.webp"];
const SHARED_FIELDS = [
  "prompt", "tier", "seed", "geometry_file_format", "material", "quality_mesh_option",
  "texture_mode", "enable_creative_mode", "hd_texture", "texture_delight", "is_micro",
  "TAPose", "bbox_condition", "addons",
];
const FULL_SETTINGS = {
  tier: "Gen-2.5-Extreme-High", geometry_file_format: "obj", material: "PBR",
  quality_mesh_option: "2M Triangle", texture_mode: "high", seed: 65535,
  enable_creative_mode: true, hd_texture: true, texture_delight: true, is_micro: true,
  TAPose: true, bbox_condition: { width: 1, height: 1024, length: 2048 }, addons: { high_pack: true },
};

function hasIssue(issues, code, field) {
  return issues.some((issue) => issue.code === code && issue.field === field);
}

function expectInvalid(request, code, field) {
  const checked = validateModel3dRequest(request);
  assert.equal(checked.valid, false, `${code}: request unexpectedly passed`);
  assert.ok(hasIssue(checked.issues, code, field), `${code} on ${field}: ${JSON.stringify(checked.issues)}`);
  return checked;
}

function expectSerializationError(prompt, settings, references, code, field) {
  assert.throws(
    () => serializeRodinInput(prompt, settings, references),
    (error) => error instanceof Model3dInputError && hasIssue(error.issues, code, field),
  );
}

test("matches the published endpoint IDs, enums, and safe application defaults", () => {
  assert.equal(RODIN_TEXT_MODEL, "fal-ai/hyper3d/rodin/v2.5/text-to-3d");
  assert.equal(RODIN_IMAGE_MODEL, "fal-ai/hyper3d/rodin/v2.5");
  assert.equal(RODIN_PROMPT_MAX_CHARS, 1024);
  assert.equal(RODIN_MAX_IMAGE_REFERENCES, 5);
  assert.deepEqual(RODIN_TIERS, ["Gen-2.5-Minimum", "Gen-2.5-Extreme-Low", "Gen-2.5-Low", "Gen-2.5-Medium", "Gen-2.5-High", "Gen-2.5-Extreme-High"]);
  assert.deepEqual(MODEL3D_FORMATS, ["glb", "usdz", "fbx", "obj", "stl"]);
  assert.deepEqual(RODIN_MATERIALS, ["PBR", "Shaded", "All", "None"]);
  assert.deepEqual(RODIN_QUALITY_MESH_OPTIONS, ["Auto", "4K Quad", "8K Quad", "18K Quad", "50K Quad", "100K Quad", "200K Quad", "2K Triangle", "20K Triangle", "50K Triangle", "150K Triangle", "500K Triangle", "1M Triangle", "2M Triangle"]);
  assert.deepEqual(RODIN_TEXTURE_MODES, ["auto", "legacy", "extreme-low", "low", "medium", "high"]);
  assert.deepEqual(RODIN_IMAGE_MIME_TYPES, ["image/jpeg", "image/png", "image/webp"]);
  assert.deepEqual(DEFAULT_MODEL3D_SETTINGS, {
    tier: "Gen-2.5-High", geometry_file_format: "glb", material: "All", quality_mesh_option: "Auto",
    texture_mode: "auto", seed: null, enable_creative_mode: false, hd_texture: false,
    texture_delight: false, is_micro: false, TAPose: false, use_original_alpha: false,
    preview_render: false, bbox_condition: null, addons: { high_pack: false },
  });
  assert.deepEqual(serializeRodinInput(PROMPT).input, {
    prompt: PROMPT, tier: "Gen-2.5-High", geometry_file_format: "glb", material: "All",
    quality_mesh_option: "Auto", enable_creative_mode: false, hd_texture: false,
    texture_delight: false, is_micro: false, TAPose: false, addons: { high_pack: false },
  });
});

test("serializes each endpoint's exact allowlist and preserves ordered image references", () => {
  const text = serializeRodinInput(PROMPT, FULL_SETTINGS);
  assert.equal(text.model, RODIN_TEXT_MODEL);
  assert.deepEqual(Object.keys(text.input).sort(), [...SHARED_FIELDS].sort());
  assert.deepEqual(text.input, { prompt: PROMPT, ...FULL_SETTINGS });

  const images = [...REFERENCES];
  const image = serializeRodinInput("", { ...FULL_SETTINGS, use_original_alpha: true, preview_render: true }, images);
  assert.equal(image.model, RODIN_IMAGE_MODEL);
  assert.deepEqual(Object.keys(image.input).sort(), [...SHARED_FIELDS, "image_urls", "use_original_alpha", "preview_render"].sort());
  assert.deepEqual(image.input, { prompt: "", ...FULL_SETTINGS, image_urls: REFERENCES, use_original_alpha: true, preview_render: true });
  assert.notEqual(image.input.image_urls, images);
  images.reverse();
  assert.deepEqual(image.input.image_urls, REFERENCES);

  expectSerializationError(PROMPT, { use_original_alpha: true }, [], "model3d_alpha_requires_image", "use_original_alpha");
  expectSerializationError(PROMPT, { preview_render: true }, [], "model3d_preview_requires_image", "preview_render");
  expectInvalid({ prompt: PROMPT, mode: "text", referenceCount: 1 }, "model3d_text_images_unsupported", "references");
});

test("accepts every published enum without leaking the app-only texture auto sentinel", () => {
  for (const [field, values] of [
    ["tier", RODIN_TIERS], ["geometry_file_format", MODEL3D_FORMATS],
    ["material", RODIN_MATERIALS], ["texture_mode", RODIN_TEXTURE_MODES],
  ]) {
    for (const value of values) {
      const { input } = serializeRodinInput(PROMPT, { [field]: value });
      if (field === "texture_mode" && value === "auto") assert.equal(Object.hasOwn(input, field), false);
      else assert.equal(input[field], value);
    }
  }
  for (const quality_mesh_option of RODIN_QUALITY_MESH_OPTIONS) {
    const tier = quality_mesh_option === "2K Triangle" ? "Gen-2.5-Low" : "Gen-2.5-High";
    assert.equal(serializeRodinInput(PROMPT, { tier, quality_mesh_option }).input.quality_mesh_option, quality_mesh_option);
  }
});

test("counts the 1024-character ceiling in Unicode code points and never truncates the prompt", () => {
  for (const unit of ["a", "🪑"]) {
    const prompt = unit.repeat(1024);
    const checked = validateModel3dRequest({ prompt });
    assert.equal(model3dPromptLength(prompt), 1024);
    assert.equal(checked.promptCharacters, 1024);
    assert.equal(checked.valid, true);
    assert.equal(serializeRodinInput(prompt).input.prompt, prompt);
    const tooLong = `${prompt}${unit}`;
    assert.equal(expectInvalid({ prompt: tooLong }, "model3d_prompt_too_long", "prompt").promptCharacters, 1025);
    expectSerializationError(tooLong, undefined, [], "model3d_prompt_too_long", "prompt");
    expectSerializationError(tooLong, undefined, REFERENCES, "model3d_prompt_too_long", "prompt");
  }
  assert.equal(model3dPromptLength("e\u0301🪑"), 3, "combining marks remain separate code points");
  const authored = "  A wooden chair.\nKeep the carved mark.  ";
  assert.equal(serializeRodinInput(authored).input.prompt, authored);
});

test("rejects an overlength final composed prompt even when its source fragments each fit", () => {
  const context = "c".repeat(600);
  const direction = "d".repeat(600);
  const composed = `Context:\n${context}\nDirection:\n${direction}`;
  assert.equal(validateModel3dRequest({ prompt: context }).valid, true);
  assert.equal(validateModel3dRequest({ prompt: direction }).valid, true);
  const rejected = expectInvalid({ prompt: composed }, "model3d_prompt_too_long", "prompt");
  assert.equal(rejected.promptCharacters, Array.from(composed).length);
  expectSerializationError(composed, undefined, REFERENCES, "model3d_prompt_too_long", "prompt");
});

test("requires text in text mode while allowing an empty prompt with image guidance", () => {
  for (const prompt of ["", " \n\t "]) {
    expectSerializationError(prompt, undefined, [], "model3d_prompt_required", "prompt");
    const checked = validateModel3dRequest({ prompt, mode: "image", referenceCount: 1, referenceMimeTypes: ["image/png"] });
    assert.equal(checked.valid, true);
    assert.equal(serializeRodinInput(prompt, undefined, [REFERENCES[0]]).input.prompt, prompt);
  }
  for (const prompt of [undefined, null, 1, {}, []]) {
    expectInvalid({ prompt }, "model3d_prompt_invalid", "prompt");
  }
});

test("rejects missing, excessive, mismatched, and unsupported image references before submission", () => {
  for (const referenceCount of [1, 5]) {
    const referenceMimeTypes = Array.from({ length: referenceCount }, (_, index) => ["image/jpeg", "image/png", "image/webp"][index % 3]);
    assert.equal(validateModel3dRequest({ prompt: "", mode: "image", referenceCount, referenceMimeTypes }).valid, true);
    const urls = Array.from({ length: referenceCount }, (_, index) => `https://example.com/view-${index}.png`);
    assert.deepEqual(serializeRodinInput("", undefined, urls).input.image_urls, urls);
  }
  for (const referenceCount of [0, -1, 1.5, 6]) {
    expectInvalid({ prompt: "", mode: "image", referenceCount }, "model3d_reference_count", "references");
  }
  expectSerializationError(PROMPT, undefined, Array(6).fill(REFERENCES[0]), "model3d_reference_count", "references");
  expectInvalid({ prompt: PROMPT, referenceCount: 2, referenceMimeTypes: ["image/png"] }, "model3d_reference_count_mismatch", "references");
  for (const mime of ["image/gif", "image/tiff", "image/svg+xml", "model/gltf-binary", ""]) {
    expectInvalid({ prompt: PROMPT, referenceMimeTypes: [mime] }, "model3d_reference_format", "references.0");
  }
  for (const invalidUrl of ["", " \n", null, 42]) {
    expectSerializationError(PROMPT, undefined, [invalidUrl], "model3d_reference_url_invalid", "references");
  }
});

test("rejects invalid authored values and upstream-only or unknown settings instead of sanitizing them", () => {
  for (const settings of [null, [], "settings", false]) {
    expectSerializationError(PROMPT, settings, [], "model3d_settings_invalid", "settings");
  }
  for (const [field, value] of [
    ["tier", "Regular"], ["geometry_file_format", "gltf"], ["material", "Hybrid"],
    ["quality_mesh_option", "500K"], ["texture_mode", "extreme-high"],
    ["tier", null], ["geometry_file_format", "GLB"],
  ]) {
    expectSerializationError(PROMPT, { [field]: value }, [], "model3d_setting_enum_invalid", field);
  }
  for (const field of ["enable_creative_mode", "hd_texture", "texture_delight", "is_micro", "TAPose", "use_original_alpha", "preview_render"]) {
    expectSerializationError(PROMPT, { [field]: "false" }, [], "model3d_setting_boolean_invalid", field);
  }
  for (const field of ["images", "mesh_mode", "quality", "quality_override", "geometry_instruct_mode", "image_label", "is_symmetric", "uhd_texture", "condition_mode", "negative_prompt", "enable_safety_checker", "unknown"]) {
    expectSerializationError(PROMPT, { [field]: true }, [], "model3d_setting_unsupported", field);
  }
  for (const addons of [null, [], "HighPack", { high_pack: "true" }]) {
    expectSerializationError(PROMPT, { addons }, [], "model3d_addons_invalid", "addons.high_pack");
  }
  expectSerializationError(PROMPT, { addons: { high_pack: false, unsupported: true } }, [], "model3d_addon_unsupported", "addons.unsupported");
});

test("only submits hosted HTTP(S) references or supported image data URIs", () => {
  // URL syntax is checked here; the worker prepares and validates the image bytes.
  const encodedBytes = Buffer.from("prepared-image-fixture").toString("base64");
  for (const url of [
    "http://example.com/reference.jpg", "https://example.com/reference.png?version=1",
    ...["jpeg", "png", "webp"].map((format) => `data:image/${format};base64,${encodedBytes}`),
  ]) {
    assert.deepEqual(serializeRodinInput(PROMPT, undefined, [url]).input.image_urls, [url]);
  }
  for (const url of [
    "blob:http://localhost/demo", "not-a-url", "/private-reference.png",
    "file:///tmp/reference.png", "ftp://example.com/reference.png",
    "https://name:password@example.com/reference.png", "data:image/png;base64,",
    `data:image/svg+xml;base64,${encodedBytes}`, "data:image/png,unencoded-bytes",
  ]) {
    expectSerializationError(PROMPT, undefined, [url], "model3d_reference_url_invalid", "references");
  }
});

test("validates seed boundaries without converting strings or fractional values", () => {
  for (const seed of [0, 65535]) assert.equal(serializeRodinInput(PROMPT, { seed }).input.seed, seed);
  assert.equal(Object.hasOwn(serializeRodinInput(PROMPT, { seed: null }).input, "seed"), false);
  for (const seed of [-1, 65536, 0.5, "0", NaN, Infinity]) {
    expectSerializationError(PROMPT, { seed }, [], "model3d_seed_invalid", "seed");
  }
});

test("requires all three bounding-box dimensions as integers within 1–2048 and rejects extra keys", () => {
  for (const edge of [1, 2048]) {
    const bbox_condition = { width: edge, height: edge, length: edge };
    assert.deepEqual(serializeRodinInput(PROMPT, { bbox_condition }).input.bbox_condition, bbox_condition);
  }
  for (const axis of ["width", "height", "length"]) {
    for (const value of [0, -1, 2049, 1.5, "100", NaN, undefined]) {
      const bbox_condition = { width: 100, height: 100, length: 100, [axis]: value };
      expectSerializationError(PROMPT, { bbox_condition }, [], "model3d_bbox_dimension_invalid", `bbox_condition.${axis}`);
    }
  }
  expectSerializationError(PROMPT, { bbox_condition: [100, 100, 100] }, [], "model3d_bbox_object_invalid", "bbox_condition");
  expectSerializationError(PROMPT, { bbox_condition: { width: 1, height: 1, length: 1, units: "meters" } }, [], "model3d_bbox_field_unsupported", "bbox_condition.units");
});

test("enforces tier-dependent mesh limits and explains Minimum's forced 50K mesh", () => {
  for (const tier of ["Gen-2.5-High", "Gen-2.5-Extreme-High"]) {
    assert.equal(validateModel3dRequest({ prompt: PROMPT, settings: { tier, quality_mesh_option: "2M Triangle" } }).valid, true);
    expectSerializationError(PROMPT, { tier, quality_mesh_option: "2K Triangle" }, [], "model3d_mesh_minimum_for_tier", "quality_mesh_option");
  }
  for (const tier of ["Gen-2.5-Extreme-Low", "Gen-2.5-Low", "Gen-2.5-Medium"]) {
    assert.equal(validateModel3dRequest({ prompt: PROMPT, settings: { tier, quality_mesh_option: "1M Triangle" } }).valid, true);
    expectSerializationError(PROMPT, { tier, quality_mesh_option: "2M Triangle" }, [], "model3d_mesh_maximum_for_tier", "quality_mesh_option");
  }
  const minimum = validateModel3dRequest({ prompt: PROMPT, settings: { tier: "Gen-2.5-Minimum", quality_mesh_option: "2M Triangle" } });
  assert.equal(minimum.valid, true, "Minimum overrides the mesh selection at the provider");
  assert.ok(minimum.warnings.some((warning) => /Minimum.*50K Triangle.*overrides/i.test(warning)));
  for (const quality_mesh_option of ["Auto", "50K Triangle"]) {
    const checked = validateModel3dRequest({ prompt: PROMPT, settings: { tier: "Gen-2.5-Minimum", quality_mesh_option } });
    assert.equal(checked.valid, true);
    assert.equal(checked.warnings.some((warning) => /overrides.*mesh/i.test(warning)), false);
  }
});

test("allows creative mode only on Medium or higher and micro detail only on Extreme-High", () => {
  for (const tier of ["Gen-2.5-Minimum", "Gen-2.5-Extreme-Low", "Gen-2.5-Low"]) {
    expectSerializationError(PROMPT, { tier, enable_creative_mode: true }, [], "model3d_creative_tier_mismatch", "enable_creative_mode");
  }
  for (const tier of ["Gen-2.5-Medium", "Gen-2.5-High", "Gen-2.5-Extreme-High"]) {
    assert.equal(serializeRodinInput(PROMPT, { tier, enable_creative_mode: true }).input.enable_creative_mode, true);
  }
  for (const tier of ["Gen-2.5-Minimum", "Gen-2.5-Extreme-Low", "Gen-2.5-Low", "Gen-2.5-Medium", "Gen-2.5-High"]) {
    expectSerializationError(PROMPT, { tier, is_micro: true }, [], "model3d_micro_tier_mismatch", "is_micro");
  }
  assert.equal(serializeRodinInput(PROMPT, { tier: "Gen-2.5-Extreme-High", is_micro: true }).input.is_micro, true);
});

test("keeps the published base, Extreme-High, and HighPack estimates consistent with submitted settings", () => {
  for (const [tier, high_pack, expected] of [
    ["Gen-2.5-High", false, 400_000], ["Gen-2.5-Extreme-High", false, 800_000],
    ["Gen-2.5-High", true, 1_200_000], ["Gen-2.5-Extreme-High", true, 1_600_000],
  ]) {
    const settings = { tier, addons: { high_pack } };
    assert.equal(estimateModel3dCostMicrousd(settings), expected);
    assert.equal(validateModel3dRequest({ prompt: PROMPT, settings }).estimatedCostMicrousd, expected);
    assert.equal(serializeRodinInput(PROMPT, settings).estimatedCostMicrousd, expected);
  }
  for (const tier of ["Gen-2.5-Minimum", "Gen-2.5-Extreme-Low", "Gen-2.5-Low", "Gen-2.5-Medium"]) {
    assert.equal(estimateModel3dCostMicrousd({ tier }), 400_000);
  }
});
