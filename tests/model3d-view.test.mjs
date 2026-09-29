import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL3D_MAX_DISTANCE,
  MODEL3D_MIN_DISTANCE,
  isModel3dMediaSource,
  model3dPresetView,
  normalizeModel3dView,
} from "../src/model/model3d-view.ts";

const presets = ["perspective", "front", "back", "left", "right", "top"];
const backgrounds = ["transparent", "#ffffff", "#18181b"];
const view = (patch = {}) => ({ ...model3dPresetView(), ...patch });

test("every camera preset and background survives persistence with independent vectors", () => {
  for (const preset of presets) {
    for (const background of backgrounds) {
      const original = model3dPresetView(preset, background);
      const restored = normalizeModel3dView(JSON.parse(JSON.stringify(original)));
      assert.deepEqual(restored, original, `${preset} with ${background}`);

      const normalized = normalizeModel3dView(original);
      assert.notStrictEqual(normalized.position, original.position);
      assert.notStrictEqual(normalized.target, original.target);
      normalized.position[0] += 1;
      normalized.target[0] += 1;
      assert.deepEqual(original, restored, "editing a restored camera cannot mutate its source");

      const another = model3dPresetView(preset, background);
      original.position[0] += 1;
      original.target[0] += 1;
      assert.deepEqual(model3dPresetView(preset, background), another, "editing a preset cannot mutate future presets");
    }
  }
  assert.deepEqual(model3dPresetView(), model3dPresetView("perspective", "#ffffff"));
});

test("persisted cameras reject malformed schemas and unsupported lens or background values", () => {
  for (const malformed of [undefined, null, false, 35, "camera", [], {}, [view()]]) {
    assert.equal(normalizeModel3dView(malformed), null);
  }
  for (const patch of [
    { version: undefined }, { version: 0 }, { version: 2 }, { version: "1" },
    { fov: undefined }, { fov: 0 }, { fov: 34 }, { fov: 36 }, { fov: "35" },
    { fov: NaN }, { fov: Infinity },
    { background: undefined }, { background: null }, { background: "white" },
    { background: "#FFFFFF" }, { background: "#000000" },
    { background: new String("#ffffff") },
    { background: { toString: () => "transparent" } },
  ]) {
    assert.equal(normalizeModel3dView(view(patch)), null);
  }
});

test("camera position and target reject missing, nonnumeric, nonfinite, and sparse coordinates", () => {
  const sparse = [0, 0, 6.4];
  delete sparse[1];
  const malformedVectors = [
    undefined, null, "0,0,6.4", {}, new Float32Array([0, 0, 6.4]),
    [], [0, 0], [0, 0, 6.4, 0], [0, "0", 6.4], [null, 0, 6.4],
    [0, NaN, 6.4], [0, Infinity, 6.4], [0, -Infinity, 6.4],
    [33, 0, 6.4], [-33, 0, 6.4], sparse, new Array(3),
  ];
  for (const field of ["position", "target"]) {
    for (const malformed of malformedVectors) {
      assert.equal(normalizeModel3dView(view({ [field]: malformed })), null, `${field} must contain three finite numeric coordinates`);
    }
  }
});

test("camera distance is measured relative to its target and respects the supported zoom range", () => {
  for (const distance of [MODEL3D_MIN_DISTANCE, MODEL3D_MAX_DISTANCE]) {
    const candidate = view({ position: [1, 0, distance], target: [1, 0, 0] });
    assert.deepEqual(normalizeModel3dView(candidate), candidate);
  }
  for (const distance of [0, MODEL3D_MIN_DISTANCE - 0.001, MODEL3D_MAX_DISTANCE + 0.001]) {
    assert.equal(normalizeModel3dView(view({ position: [1, 0, distance], target: [1, 0, 0] })), null);
  }
  assert.equal(normalizeModel3dView(view({ position: [1, 1, 1], target: [1, 1, 1] })), null);
});

test("panning stays within the normalized model region in every direction", () => {
  for (const target of [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, 0, -2]]) {
    const candidate = view({ target, position: [target[0], target[1], target[2] + 6.4] });
    assert.deepEqual(normalizeModel3dView(candidate), candidate);
  }
  for (const target of [[2.001, 0, 0], [-2.001, 0, 0], [0, 2.001, 0], [0, 0, -2.001], [1.5, 1.5, 0]]) {
    assert.equal(normalizeModel3dView(view({ target, position: [target[0], target[1], target[2] + 6.4] })), null);
  }
});

test("persisted coordinates have stable precision without mutating the input", () => {
  const candidate = view({ position: [0.123456789, 2.123456789, 6.123456789], target: [0.123456789, 0, 0] });
  const original = structuredClone(candidate);
  const normalized = normalizeModel3dView(candidate);
  assert.deepEqual(normalized.position, [0.123457, 2.123457, 6.123457]);
  assert.deepEqual(normalized.target, [0.123457, 0, 0]);
  assert.deepEqual(normalizeModel3dView(normalized), normalized);
  assert.deepEqual(candidate, original);
});

test("the viewer accepts private and shared media route URLs", () => {
  for (const source of [
    "/api/media/model.glb",
    "/api/media/project/model.glb",
    "/api/media/project%2Fmodel.glb",
    "/api/media/model.glb?download=1",
    "/api/shared/share-token/media/model.glb",
    "/api/shared/share-token/media/project%2Fmodel.glb",
  ]) {
    assert.equal(isModel3dMediaSource(source), true, source);
  }
});

test("the viewer rejects external sources, route lookalikes, fragments, and path traversal", () => {
  for (const source of [
    undefined, null, 42, {},
    "https://provider.example/model.glb",
    "https://forma.invalid/api/media/model.glb",
    "//provider.example/api/media/model.glb",
    "//forma.invalid/api/media/model.glb",
    "file:///api/media/model.glb",
    "data:model/gltf-binary;base64,AA==",
    "blob:https://forma.invalid/model",
    "api/media/model.glb",
    "/api/media-lookalike/model.glb",
    "/api/shared-lookalike/token/media/model.glb",
    "/api/media/model.glb#asset",
    "/api/media/../../private.glb",
    "/api/media/../media/model.glb",
    "/api/media/project/../model.glb",
    "/api/media/%2e%2e/media/model.glb",
    "/api/shared/token/media/../model.glb",
    "/api/shared/token/media/%2E%2E/model.glb",
    "/api/media/project\\..\\model.glb",
  ]) {
    assert.equal(isModel3dMediaSource(source), false, String(source));
  }
});
