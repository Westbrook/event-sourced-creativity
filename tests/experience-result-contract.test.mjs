import assert from "node:assert/strict";
import test from "node:test";
import { nothing } from "lit";
import {
  validateExperienceResult, RESULT_JSON_MAX_BYTES, RESULT_MARKDOWN_MAX_BYTES,
  RESULT_ITEM_TEXT_MAX_BYTES, RESULT_MAX_ITEMS, RESULT_SLIDE_MAX_BULLETS, RESULT_SLIDE_MAX_DATA,
} from "../src/experiences/results/contracts.ts";
import { experienceResultViewers } from "../src/experiences/results/registry.ts";
import { renderExperienceShortStory } from "../src/experiences/results/short-story-reader.ts";
import {
  isResultMediaPathForNamespace, RESULT_ASSET_MAX_BYTES, RESULT_MODEL3D_MAX_BYTES,
  RESULT_MAX_DIMENSION, RESULT_MAX_DURATION_SECONDS,
} from "../src/experiences/results/media.ts";

// Synthetic projected DTOs only. These are not native read, owner, provider,
// media, generation, publication or accessibility qualification fixtures.
const kinds = ["image", "short_story", "scene", "slides", "storyboard", "video", "audio", "model3d"];
const namespace = "u-66697874757265";
const hash = "a".repeat(64), sourceDigest = "b".repeat(64), releaseHash = "sha256:" + "c".repeat(64);
const writing = "  # Title\r\n\r\nA complete passage.\n<script>literal text</script>\n[Label](https://example.invalid)\n終わり  ";
const encode = new TextEncoder();
function mediaAsset(kind, name = kind) {
  const formats = { image: ["image/png", "png"], audio: ["audio/mpeg", "mp3"], video: ["video/mp4", "mp4"], model3d: ["model/gltf-binary", "glb"] };
  const [mime, extension] = formats[kind];
  const base = { url: "/api/media/" + encodeURIComponent(namespace + "/generated/" + name + "." + extension), mime, sha256: hash, bytes: 4096 };
  if (kind === "image") return { ...base, width: 1200, height: 800 };
  if (kind === "model3d") return base;
  return { ...base, duration: { basis: "estimate", seconds: 32 } };
}
function identity(kind) {
  return {
    documentId: "document-fixture", outputId: "output-fixture", sourceRevision: "rev-fixture",
    sourceDigest, contentHash: kind === "image" ? hash : null, releaseHash,
    outputObjectKind: kind === "image" ? "generation" : "artifact", outputRevision: kind === "image" ? null : 3,
  };
}
function slide(id = "slide-1") {
  return {
    id, title: "Title", body: "Complete audience text",
    slide: {
      layout: "scorecard", kicker: "Section", section: null, bullets: ["First", "Second"],
      quote: { text: "Complete quotation", speaker: "Speaker", role: "Role", citation: "Audience attribution" },
      citations: [{ label: "Audience source", anchor: "p. 2" }],
      visual: {
        kind: "scorecard", label: "Metric", value: "42", exactValue: "42.00", displayValue: "42", unit: "/100",
        data: [{ label: "Value", value: "42", weight: 0.42, exactValue: "42.00", displayValue: "42" }],
      },
    },
  };
}
function content(kind) {
  switch (kind) {
    case "image": return { image: mediaAsset("image"), alt: "Square object", caption: "Caption" };
    case "short_story": return { content_markdown: writing };
    case "scene": return { medium: "audio", content_markdown: writing };
    case "slides": return {
      slides: [slide()],
      presentation: {
        aspectRatio: "16:9", stylePreset: "gallery", mode: "light", footerLabel: "Footer",
        palette: { background: "#ffffff", foreground: "#18181b", accent: "#287260", muted: "#667069", surface: "#f5f3ee" },
      },
    };
    case "storyboard": return { frames: [{ id: "frame-1", title: "Frame", body: "Complete frame text", image: mediaAsset("image"), alt: "Square object", caption: "Caption", duration: { basis: "unknown", seconds: null } }] };
    case "video": return { clips: [{ id: "clip-1", title: "Clip", asset: mediaAsset("video"), transcript: null, description: "Clip description" }] };
    case "audio": return { asset: mediaAsset("audio"), transcript: null, description: "Instrumental recording" };
    case "model3d": return {
      glb: mediaAsset("model3d"), view: { version: 1, position: [3.6, 2.7, 4.5], target: [0, 0, 0], fov: 35, background: "#ffffff" },
      poster: { image: mediaAsset("image", "poster"), alt: "Model still" }, description: "Model description",
    };
  }
}
function fixture(kind) {
  return { schemaVersion: 1, output: kind, viewerRef: kind + ".read-only@1", viewerContractRevision: 1, identity: identity(kind), title: "Result", content: content(kind) };
}
function expected(kind) {
  // A separately constructed synthetic host expectation, never copied from a
  // candidate's fields. Real personal-scope authority remains unimplemented.
  const assets = kind === "image" || kind === "storyboard" ? [mediaAsset("image")]
    : kind === "audio" || kind === "video" ? [mediaAsset(kind)]
      : kind === "model3d" ? [mediaAsset("model3d"), mediaAsset("image", "poster")] : [];
  return { output: kind, viewerRef: kind + ".read-only@1", viewerContractRevision: 1, identity: identity(kind), media: { namespace, assets } };
}
function valid(input, expectation) {
  const result = validateExperienceResult(input, expectation);
  assert.equal(result.ok, true, result.code);
  return result.value;
}
function invalid(input, expectation, code) {
  const result = validateExperienceResult(input, expectation);
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result).sort(), ["code", "ok"]);
  if (code) assert.equal(result.code, code);
}
function frozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(frozen);
}
function at(value, path) { return path.reduce((parent, key) => parent[key], value); }

test("closed keyed registry is immutable fixture metadata, not executable capability", () => {
  assert.deepEqual(Object.keys(experienceResultViewers).sort(), [...kinds].sort());
  for (const kind of kinds) {
    const descriptor = experienceResultViewers[kind];
    assert.equal(descriptor.output, kind); assert.equal(descriptor.id, kind + ".read-only@1");
    assert.equal(descriptor.qualification, "fixture-only");
    assert.deepEqual(Object.keys(descriptor).sort(), ["activation", "contractRevision", "dtoVersion", "id", "output", "qualification"]);
    assert.equal(Object.values(descriptor).some(value => typeof value === "function"), false);
    frozen(descriptor);
  }
  frozen(experienceResultViewers);
});

for (const kind of kinds) test(kind + ": validates a separately expected projected DTO without fetching", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Pure DTO validation must not fetch"));
  const input = fixture(kind), expectation = expected(kind), before = structuredClone(input);
  const result = valid(input, expectation);
  assert.deepEqual(result, before); assert.deepEqual(input, before); assert.notEqual(result, input); frozen(result);
  input.title = "Changed later"; expectation.identity.releaseHash = "sha256:" + "d".repeat(64);
  assert.equal(result.title, "Result"); assert.equal(result.identity.releaseHash, releaseHash);
  assert.equal(Object.isFrozen(input), false);
});

test("retained releases are compared exactly without resolving the current intake catalog", () => {
  const input = fixture("short_story"), expectation = expected("short_story");
  input.identity.releaseHash = expectation.identity.releaseHash = "sha256:" + "e".repeat(64);
  valid(input, expectation);
  expectation.viewerContractRevision = 2;
  invalid(input, expectation, "unsupported-viewer-contract");
  expectation.viewerContractRevision = 1; expectation.viewerRef = "short_story.read-only@2";
  invalid(input, expectation, "unsupported-viewer-contract");
  const newerEnvelope = fixture("short_story"); newerEnvelope.schemaVersion = 2;
  invalid(newerEnvelope, expected("short_story"), "unsupported-viewer-contract");
});

for (const [key, value] of [
  ["documentId", "other-document"], ["outputId", "other-output"], ["outputRevision", 4],
  ["sourceRevision", "rev-other"], ["sourceDigest", "d".repeat(64)], ["contentHash", hash],
  ["releaseHash", "sha256:" + "d".repeat(64)],
]) test("independent expected identity rejects changed " + key, () => {
  const input = fixture("short_story"); input.identity[key] = value;
  invalid(input, expected("short_story"), "identity-mismatch");
});

test("image generation identity is not interchangeable with an editable artifact revision", () => {
  const input = fixture("image"); input.identity.outputObjectKind = "artifact"; input.identity.outputRevision = 0;
  invalid(input, expected("image"));
  const artifact = fixture("short_story"); artifact.identity.outputRevision = null;
  invalid(artifact, expected("short_story"));
  for (const [key, value] of [["output", "scene"], ["viewerRef", "scene.read-only@1"], ["viewerContractRevision", 2]]) {
    const changed = fixture("short_story"); changed[key] = value;
    invalid(changed, expected("short_story"), "identity-mismatch");
  }
});

for (const kind of ["short_story", "scene"]) test(kind + ": complete written content is retained once, literally and without a summary substitute", () => {
  const result = valid(fixture(kind), expected(kind));
  assert.equal(result.content.content_markdown, writing);
  assert.deepEqual(Object.keys(result.content).sort(), kind === "scene" ? ["content_markdown", "medium"] : ["content_markdown"]);
  for (const extra of ["items", "sections", "notes", "image_prompts", "audio", "summary"]) {
    const input = fixture(kind); input.content[extra] = [];
    invalid(input, expected(kind));
  }
  const missing = fixture(kind); delete missing.content.content_markdown;
  invalid(missing, expected(kind));
});

test("full narrative byte ceilings preserve ASCII and multibyte writing without the old short-string limit", () => {
  for (const kind of ["short_story", "scene"]) for (const writing of ["x".repeat(RESULT_MARKDOWN_MAX_BYTES), "界".repeat(170_666) + "ab"]) {
    assert.equal(encode.encode(writing).length, RESULT_MARKDOWN_MAX_BYTES);
    const input = fixture(kind); input.content.content_markdown = writing;
    assert.equal(valid(input, expected(kind)).content.content_markdown, writing);
    input.content.content_markdown += "x";
    invalid(input, expected(kind));
  }
});

// Actual Lit template contracts only; these do not qualify browser rendering,
// current custody, result transport, mobile layout, or native continuation.
test("Short story reader keeps complete title and narrative in literal text parts", () => {
  const input = fixture("short_story");
  input.title = '  <img src="https://example.invalid/title" onerror="run()"> & 終わり  ';
  input.content.content_markdown = writing + '\n![Remote](https://example.invalid/image)\n<a href="javascript:run()">Literal</a>';
  const result = valid(input, expected("short_story"));
  const rendered = renderExperienceShortStory(result);
  assert.equal(rendered._$litType$, 1);
  assert.equal(rendered.values.length, 2);
  assert.equal(rendered.values[1], input.content.content_markdown);
  const heading = rendered.values[0];
  assert.equal(heading._$litType$, 1);
  assert.deepEqual(heading.values, [input.title]);
  assert.deepEqual([...heading.strings], ['<h2 class="experience-short-story-title" dir="auto">', '</h2>']);
  assert.deepEqual([...rendered.strings], [
    '<article class="experience-short-story-reader" aria-label="Short story">\n    ',
    '\n    <pre class="experience-short-story-content" dir="auto">',
    '</pre>\n  </article>',
  ]);
});

test("Short story reader preserves maximum narrative bytes through repeated rendering", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Read-only template must not fetch"));
  const input = fixture("short_story");
  input.content.content_markdown = '\ufeff\r\n' + "界".repeat(170_663) + '終\n  ';
  assert.equal(encode.encode(input.content.content_markdown).length, RESULT_MARKDOWN_MAX_BYTES);
  const result = valid(input, expected("short_story"));
  const before = JSON.stringify(result);
  const first = renderExperienceShortStory(result), second = renderExperienceShortStory(result);
  assert.deepEqual(first.values[0].values, [result.title]);
  assert.equal(first.values[1], input.content.content_markdown);
  assert.deepEqual(second.values, first.values);
  assert.equal(first.values.filter(value => value === input.content.content_markdown).length, 1);
  assert.equal(JSON.stringify(result), before);
  frozen(result);
});

test("Short story reader omits blank headings without inventing a title or losing text", () => {
  for (const title of ["", " \t\r\n "]) {
    const input = fixture("short_story"); input.title = title;
    const result = valid(input, expected("short_story"));
    const rendered = renderExperienceShortStory(result);
    assert.deepEqual(rendered.values, [nothing, writing]);
    assert.equal(result.title, title);
  }
});

test("canonical item text and item-count bounds reject rather than truncate", () => {
  const input = fixture("slides");
  input.content.slides[0].body = "é".repeat(RESULT_ITEM_TEXT_MAX_BYTES / 2);
  assert.equal(valid(input, expected("slides")).content.slides[0].body, input.content.slides[0].body);
  input.content.slides[0].body += "x"; invalid(input, expected("slides"));
  input.content.slides = Array.from({ length: RESULT_MAX_ITEMS }, (_, index) => ({ id: "slide-" + index, title: "", body: "Complete", slide: null }));
  assert.equal(valid(input, expected("slides")).content.slides.length, RESULT_MAX_ITEMS);
  input.content.slides.push({ id: "extra", title: "", body: "Extra", slide: null });
  invalid(input, expected("slides"));
});

test("the maximum supported slide nesting fits the JSON node/depth budget", () => {
  const input = fixture("slides");
  input.content.slides = Array.from({ length: RESULT_MAX_ITEMS }, (_, index) => {
    const item = slide("slide-" + index);
    item.slide.bullets = Array.from({ length: RESULT_SLIDE_MAX_BULLETS }, () => "");
    item.slide.citations = Array.from({ length: RESULT_MAX_ITEMS }, () => ({ label: "L", anchor: "" }));
    item.slide.visual.data = Array.from({ length: RESULT_SLIDE_MAX_DATA }, () => ({ label: "L", value: "", weight: 1, exactValue: null, displayValue: null }));
    return item;
  });
  assert.ok(encode.encode(JSON.stringify(input)).length < RESULT_JSON_MAX_BYTES);
  assert.equal(valid(input, expected("slides")).content.slides.length, RESULT_MAX_ITEMS);
  input.content.slides[0].slide.bullets.push("Excess"); invalid(input, expected("slides"));
  input.content.slides[0].slide.bullets.pop();
  input.content.slides[0].slide.visual.data.push({ label: "Extra", value: "", weight: 1, exactValue: null, displayValue: null });
  invalid(input, expected("slides"));
});

test("total JSON bytes are bounded before a captured result is published", () => {
  const input = fixture("slides");
  input.content.slides = Array.from({ length: 13 }, (_, index) => ({ id: "slide-" + index, title: "", body: "x".repeat(RESULT_ITEM_TEXT_MAX_BYTES), slide: null }));
  assert.ok(encode.encode(JSON.stringify(input)).length > RESULT_JSON_MAX_BYTES);
  invalid(input, expected("slides"));
});

// These fixtures remain intentionally outside the exact result schema. A
// harmless traversal witness distinguishes capture's early stop from the later
// schema rejection; its reachable control must visit the same witness first.
test("capture stops at its depth boundary before reaching a deeper traversal witness", () => {
  for (const [wrappers, expectedVisits] of [[6, 1], [7, 0]]) {
    const input = fixture("short_story");
    let visits = 0;
    let branch = new Proxy({}, { ownKeys() { visits++; return []; } });
    for (let index = 0; index < wrappers; index++) branch = { child: branch };
    // Root is depth 0, content 1, extra 2. The empty witness is at 8 or 9.
    input.content.extra = branch;
    invalid(input, expected("short_story"), "invalid-result");
    assert.equal(visits, expectedVisits, `Witness at depth ${wrappers + 2}`);
  }
});

test("capture stops at its node boundary independently of schema, bytes and depth", () => {
  for (const [leaves, expectedVisits] of [[8, 1], [9, 0]]) {
    const input = fixture("short_story");
    input.content.extra = Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => Array(leaves).fill(0)));
    input.boundaryWitness = {};
    // Inspect only the plain data fixture, before installing the witness.
    let nodes = 0, maximumDepth = 0, maximumArray = 0, maximumKeys = 0;
    function count(value, depth = 0) {
      nodes++; maximumDepth = Math.max(maximumDepth, depth);
      if (value && typeof value === "object") {
        if (Array.isArray(value)) maximumArray = Math.max(maximumArray, value.length);
        else maximumKeys = Math.max(maximumKeys, Object.keys(value).length);
        for (const child of Object.values(value)) count(child, depth + 1);
      }
    }
    count(input);
    assert.equal(nodes > 100_000, leaves === 9, "Only the larger fixture exceeds the declared capture node budget");
    assert.ok(maximumDepth <= 8 && maximumArray <= 100 && maximumKeys <= 64);
    assert.ok(encode.encode(JSON.stringify(input)).length < RESULT_JSON_MAX_BYTES);
    let visits = 0;
    input.boundaryWitness = new Proxy({}, { ownKeys() { visits++; return []; } });
    invalid(input, expected("short_story"), "invalid-result");
    assert.equal(visits, expectedVisits, "The final witness is reachable below the node limit and untouched above it");
  }
});

test("canonical encoded separators are accepted without URL normalization or a personal-scope claim", () => {
  assert.equal(isResultMediaPathForNamespace(mediaAsset("image").url, namespace), true);
  const legacy = "legacy-owner";
  assert.equal(isResultMediaPathForNamespace("/api/media/" + encodeURIComponent(legacy + "/upload-file.png"), legacy), true);
  assert.equal(isResultMediaPathForNamespace(mediaAsset("image").url, "another-namespace"), false);
  // Project and personal media can share this syntax. This result is not an
  // assertion about which account, project or recipient may read these bytes.
  assert.equal(isResultMediaPathForNamespace("/api/media/" + encodeURIComponent(namespace + "/generated/project-file.png"), namespace), true);
});

test("media syntax rejects schemes, shared routes, traversal, controls and ambiguous encoding", () => {
  const url = mediaAsset("image").url, suffix = url.slice("/api/media/".length);
  const invalidUrls = [
    "https://forma.invalid" + url, "//forma.invalid" + url, "data:image/png;base64,AA==", "javascript:void(0)",
    "/api/shared/token/media/" + suffix, "/api/shared/token", url + "?download=1", url + "#fragment",
    "/api/media/" + namespace + "/generated/image.png", url.replace("%2F", "%2f"), url.replace("%2F", "%252F"),
    "/api/media/" + namespace + "%2F..%2Fimage.png", "/api/media/" + namespace + "%2F%2E%2E%2Fimage.png",
    "/api/media/" + namespace + "%2F%2Fimage.png", "/api/media/" + namespace + "%2Fimage.png%2F",
    "/api/media/" + namespace + "%2Fimage%00.png", "/api/media/" + namespace + "%2Fimage%0A.png",
    "/api/media/" + namespace + "%2Fimage%5Cname.png", "/api/media/" + namespace + "%2Fimage%3Fq.png",
    "/api/media/" + namespace + "%2Fimage%23q.png", "/api/media/" + namespace + "%2Fimage%ZZ.png",
    url + "\n", url.replace("image", "\u202eimage"), "/api/media/", "/other/" + suffix,
  ];
  for (const candidate of invalidUrls) assert.equal(isResultMediaPathForNamespace(candidate, namespace), false, candidate);
});

for (const [key, value] of [["url", mediaAsset("image", "another").url], ["mime", "image/jpeg"], ["sha256", "d".repeat(64)], ["bytes", 4097], ["width", 1201]]) {
  test("media manifest binds exact " + key, () => {
    const input = fixture("image"); input.content.image[key] = value;
    invalid(input, expected("image"), "media-mismatch");
  });
}

test("MIME is narrowed by family and missing/extra manifest assets fail closed", () => {
  const audio = fixture("audio"), audioExpected = expected("audio");
  audio.content.asset = mediaAsset("video"); audioExpected.media.assets = [mediaAsset("video")];
  invalid(audio, audioExpected);
  for (const mime of ["image/svg+xml", "text/html", "application/octet-stream", "image/png; charset=utf-8"]) {
    const image = fixture("image"); image.content.image.mime = mime; invalid(image, expected("image"));
  }
  const extra = expected("image"); extra.media.assets.push(mediaAsset("image", "unrelated"));
  invalid(fixture("image"), extra, "media-mismatch");
  const duplicate = expected("image"); duplicate.media.assets.push(mediaAsset("image"));
  invalid(fixture("image"), duplicate, "invalid-expectation");
  const missing = fixture("image"); delete missing.content.image.width;
  invalid(missing, expected("image"));
});

test("duration provenance is exact retained metadata, never promoted from estimate to recorded or measured", () => {
  for (const basis of ["unknown", "estimate", "recorded", "measured"]) {
    const input = fixture("audio"), expectation = expected("audio");
    const retained = { basis, seconds: basis === "unknown" ? null : 32 };
    input.content.asset.duration = structuredClone(retained); expectation.media.assets[0].duration = structuredClone(retained);
    assert.deepEqual(valid(input, expectation).content.asset.duration, retained);
  }
  const input = fixture("audio"); input.content.asset.duration.basis = "measured";
  invalid(input, expected("audio"), "media-mismatch");
  for (const duration of [{ basis: "unknown", seconds: 32 }, { basis: "recorded", seconds: null }, { basis: "estimate", seconds: 0 }, { basis: "estimated", seconds: 32 }, { basis: "measured", seconds: Infinity }]) {
    const changed = fixture("audio"); changed.content.asset.duration = duration; invalid(changed, expected("audio"));
  }
});

test("native metadata ceilings are enforced without inspecting or requesting media bytes", () => {
  for (const [kind, assetPath, key, max] of [
    ["image", ["content", "image"], "bytes", RESULT_ASSET_MAX_BYTES],
    ["image", ["content", "image"], "width", RESULT_MAX_DIMENSION],
    ["model3d", ["content", "glb"], "bytes", RESULT_MODEL3D_MAX_BYTES],
  ]) {
    const input = fixture(kind), expectation = expected(kind);
    at(input, assetPath)[key] = max; expectation.media.assets[0][key] = max; valid(input, expectation);
    at(input, assetPath)[key] = max + 1; expectation.media.assets[0][key] = max + 1;
    invalid(input, expectation, "invalid-expectation");
  }
  const audio = fixture("audio"), expectation = expected("audio");
  audio.content.asset.duration.seconds = expectation.media.assets[0].duration.seconds = RESULT_MAX_DURATION_SECONDS;
  valid(audio, expectation);
  audio.content.asset.duration.seconds++; expectation.media.assets[0].duration.seconds++;
  invalid(audio, expectation, "invalid-expectation");
});

test("nested audience projection rejects notes, prompts, source IDs and arbitrary style rather than stripping them", () => {
  const paths = [
    [["content", "slides", 0], "notes"], [["content", "slides", 0], "image_prompt"],
    [["content", "slides", 0], "context_group_ids"], [["content", "slides", 0, "slide"], "sourceIds"],
    [["content", "slides", 0, "slide", "quote"], "sourceId"], [["content", "slides", 0, "slide", "citations", 0], "excerpt"],
    [["content", "slides", 0, "slide", "visual", "data", 0], "sourceIds"],
    [["content", "presentation"], "fontFamily"], [["content", "presentation", "palette"], "css"],
  ];
  for (const [path, key] of paths) {
    const input = fixture("slides"); at(input, path)[key] = "private or unsupported";
    invalid(input, expected("slides"));
  }
  const style = fixture("slides"); style.content.presentation.stylePreset = "new-native-style";
  invalid(style, expected("slides"));
  const color = fixture("slides"); color.content.presentation.palette.background = "url(https://example.invalid)";
  invalid(color, expected("slides"));
});

for (const kind of kinds) test(kind + ": unknown envelope/content/identity metadata is rejected", () => {
  for (const path of [[], ["identity"], ["content"]]) {
    const input = fixture(kind); at(input, path).providerRawResponse = { actorEmail: "fixture@example.invalid" };
    invalid(input, expected(kind));
  }
  const expectation = expected(kind); expectation.identity.providerRequestId = "private";
  invalid(fixture(kind), expectation, "invalid-expectation");
});

test("asset, duration, frame, clip and model-poster objects reject independent unknown keys", () => {
  const paths = [
    ["image", ["content", "image"]],
    ["storyboard", ["content", "frames", 0]],
    ["storyboard", ["content", "frames", 0, "image"]],
    ["storyboard", ["content", "frames", 0, "duration"]],
    ["video", ["content", "clips", 0]],
    ["video", ["content", "clips", 0, "asset"]],
    ["video", ["content", "clips", 0, "asset", "duration"]],
    ["audio", ["content", "asset"]],
    ["audio", ["content", "asset", "duration"]],
    ["model3d", ["content", "glb"]],
    ["model3d", ["content", "poster"]],
    ["model3d", ["content", "poster", "image"]],
  ];
  for (const [kind, path] of paths) {
    const input = fixture(kind);
    at(input, path).providerRawResponse = { actorEmail: "fixture@example.invalid" };
    invalid(input, expected(kind), "invalid-result");
  }
  for (const kind of ["image", "audio", "video", "model3d"]) {
    const expectation = expected(kind);
    expectation.media.assets[0].providerRequestId = "private";
    invalid(fixture(kind), expectation, "invalid-expectation");
  }
  const expectedDuration = expected("audio");
  expectedDuration.media.assets[0].duration.providerTiming = "private";
  invalid(fixture("audio"), expectedDuration, "invalid-expectation");
  const expectedPoster = expected("model3d");
  expectedPoster.media.assets[1].providerUrl = "https://example.invalid";
  invalid(fixture("model3d"), expectedPoster, "invalid-expectation");
});

test("GLB camera validation is exact before the one existing coordinate normalization", () => {
  const input = fixture("model3d");
  input.content.view.position[0] = 3.123456789;
  const result = valid(input, expected("model3d"));
  assert.equal(result.content.view.position[0], 3.123457);
  assert.equal(input.content.view.position[0], 3.123456789);
  for (const mutate of [
    view => { view.extra = true; }, view => { view.fov = 36; }, view => { view.version = "1"; },
    view => { view.position = [0, 0, 0]; }, view => { view.target = [3, 0, 0]; },
    view => { view.position = [3, 2, 4, 1]; }, view => { view.position[0] = "3"; },
    view => { view.position[0] = NaN; }, view => { view.background = "url(x)"; },
  ]) {
    const changed = fixture("model3d"); mutate(changed.content.view); invalid(changed, expected("model3d"));
  }
  const unsupported = fixture("model3d"); unsupported.content.glb.previewSupported = true;
  invalid(unsupported, expected("model3d"));
});

test("array order and shared source references produce independent frozen snapshots", () => {
  const input = fixture("storyboard"), first = input.content.frames[0];
  input.content.frames.push({ ...first, id: "frame-2" });
  const result = valid(input, expected("storyboard"));
  assert.deepEqual(result.content.frames.map(frame => frame.id), ["frame-1", "frame-2"]);
  assert.notEqual(result.content.frames[0].image, result.content.frames[1].image);
  first.image.width = 900;
  assert.equal(result.content.frames[0].image.width, 1200);
  const duplicate = fixture("storyboard");
  duplicate.content.frames.push({ ...duplicate.content.frames[0] });
  invalid(duplicate, expected("storyboard"), "invalid-result");
});

test("non-JSON descriptors, sparse arrays, custom prototypes and cycles are rejected without invoking getters", () => {
  let calls = 0;
  for (const mutate of [
    input => Object.defineProperty(input.content, "content_markdown", { enumerable: true, get() { calls++; return writing; } }),
    input => Object.defineProperty(input.content, "extra", { enumerable: false, value: "hidden" }),
    input => { input.content[Symbol("extra")] = true; },
    input => { input.content.toJSON = () => { calls++; return {}; }; },
    input => { Object.setPrototypeOf(input.content, { inherited: true }); },
    input => { input.content.extra = input; },
    input => { input.content.content_markdown = undefined; },
    input => { input.content.content_markdown = 1n; },
  ]) {
    const input = fixture("short_story"); mutate(input); invalid(input, expected("short_story"));
  }
  const sparse = fixture("slides"); sparse.content.slides = new Array(1); invalid(sparse, expected("slides"));
  const decorated = fixture("slides"); decorated.content.slides.extra = true; invalid(decorated, expected("slides"));
  const expectation = expected("short_story");
  Object.defineProperty(expectation.identity, "sourceDigest", { enumerable: true, get() { calls++; return sourceDigest; } });
  invalid(fixture("short_story"), expectation, "invalid-expectation");
  assert.equal(calls, 0);
});

test("descriptor quarantine never rereads Proxy values or invokes metadata accessors", () => {
  let liveReads = 0, metadataReads = 0;
  const input = fixture("short_story");
  const original = input.content;
  input.content = new Proxy(original, {
    get(target, key) {
      liveReads++;
      // The old validate-then-reread path could accept the first string and
      // publish this unvalidated object on its later snapshot read.
      if (key === "content_markdown") return liveReads === 1 ? writing : { actorEmail: "private@example.invalid", providerRawResponse: {} };
      return Reflect.get(target, key);
    },
  });
  const result = valid(input, expected("short_story"));
  assert.equal(liveReads, 0);
  assert.equal(result.content.content_markdown, writing);
  assert.deepEqual(Object.keys(result.content), ["content_markdown"]);
  frozen(result);
  original.content_markdown = "Changed after capture";
  assert.equal(result.content.content_markdown, writing);

  const image = fixture("image");
  Object.defineProperty(image.content.image, "sha256", {
    enumerable: true, get() { metadataReads++; return hash; },
  });
  invalid(image, expected("image"), "invalid-result");
  const expectation = expected("audio");
  Object.defineProperty(expectation.media.assets[0].duration, "seconds", {
    enumerable: true, get() { metadataReads++; return 32; },
  });
  invalid(fixture("audio"), expectation, "invalid-expectation");
  assert.equal(metadataReads, 0);

  // A descriptor trap may itself disclose an invalid captured value. Reject
  // that value; do not fall back to a different live getter result.
  const changedDescriptor = fixture("short_story");
  changedDescriptor.content = new Proxy(changedDescriptor.content, {
    get() { liveReads++; return writing; },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return key === "content_markdown" ? { ...descriptor, value: { actorEmail: "private@example.invalid" } } : descriptor;
    },
  });
  invalid(changedDescriptor, expected("short_story"), "invalid-result");
  assert.equal(liveReads, 0);
});
