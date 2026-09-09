import assert from "node:assert/strict";
import test from "node:test";
import {
  NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES, NATIVE_RETAINED_OUTPUT_TEXT_MAX_BYTES,
  NATIVE_RETAINED_OUTPUT_MARKDOWN_MAX_BYTES, NATIVE_RETAINED_OUTPUT_ITEMS_MAX,
  NATIVE_RETAINED_OUTPUT_BULLETS_MAX, NATIVE_RETAINED_OUTPUT_DATA_MAX, NATIVE_RETAINED_OUTPUT_CITATIONS_MAX,
  parseNativeRetainedOutputRoute, nativeRetainedOutputRequestPath, parseNativeRetainedOutputRequestUrl,
  projectNativeRetainedOutput, validateNativeRetainedOutputDto,
} from "../src/model/native-retained-output.ts";

// Synthetic identity/projection tests. Matching fields are not evidence of
// current native read authority, source custody or an authorized Edit handoff.
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const EXPIRY = "2099-01-02T00:00:00.000Z";
const selection = () => ({ documentId: "document:one._-", artifactId: "artifact:one._-", revision: 3, contentSha256: "a".repeat(64) });
const target = (output = "scene") => ({ output, selection: selection() });
const query = selected => `document=${encodeURIComponent(selected.documentId)}&artifact=${encodeURIComponent(selected.artifactId)}`
  + `&revision=${selected.revision}&sha256=${selected.contentSha256}`;
const route = (output = "scene", selected = selection()) => `/make/${output}?${query(selected)}`;
const bytes = value => new TextEncoder().encode(value).byteLength;
const scene = () => ({ schemaVersion: 1, kind: "native-retained-output", output: "scene", selection: selection(),
  title: "  A scene\r\n", expiresAt: EXPIRY, content: { content_markdown: "\ufeff\r\n  INT. ROOM\r\n\r\nA line.  \n", medium: "visual" } });
const presentation = () => ({ aspectRatio: "16:9", theme: "  Research\n", footerLabel: "Report  ", stylePreset: "editorial",
  mode: "light", fontFamily: "Noto Sans Arabic", palette: { background: "#F2EFE8", foreground: "#171714",
    accent: "#b8422f", muted: "#625e56", surface: "#ded8ca" } });
const item = () => ({ title: "  Finding\r\n", body: "\ufeff  Full body\n\nSecond paragraph.  ", notes: "Private presenter text",
  image_prompt: "Private image instruction", context_group_ids: ["context-private"], slide: {
    layout: "scorecard", kicker: "  Evidence\n", bullets: [" First bullet ", "Second\nline"], section: " Section  ",
    sourceOrder: 7, sourceIds: ["source-private"],
    quote: { text: "  Exact quotation\n", speaker: " Speaker ", role: " Role  ", sourceId: "quote-private", citation: "WHO report" },
    citations: [{ sourceId: "citation-private-id", label: "WHO report", anchor: "p. 12", excerpt: "Private complete excerpt" },
      { sourceId: "source-private", label: "Private producer notes", anchor: "source_42", excerpt: "Secret excerpt" }],
    visual: { kind: "scorecard", label: "  Score ", value: "  7.50  ", exactValue: "7.500", displayValue: "7.5",
      unit: " points ", data: [{ label: "  Accuracy ", value: " 75% ", weight: .75, exactValue: "75.000",
        displayValue: "75%", sourceIds: ["datum-private"] }] },
  } });
const rawSlides = () => ({ title: "  Findings\r\n", summary: "Private summary", content_markdown: "Private full deck Markdown",
  presentation: presentation(), items: [item()], producer_metadata: { provider: "private", nested: [true, null, 3] } });
const projectedSlides = () => projectNativeRetainedOutput(target("slides"), rawSlides(), EXPIRY);
const valid = (value, expected = target(value.output)) => validateNativeRetainedOutputDto(value, expected, NOW);

test("native retained output: exact native output routes retain immutable four-field selections", () => {
  for (const output of ["scene", "slides", "storyboard", "model3d"]) for (const revision of [0, 3, Number.MAX_SAFE_INTEGER]) {
    const selected = { ...selection(), revision }, result = parseNativeRetainedOutputRoute(route(output, selected));
    assert.deepEqual(result, { output, selection: selected });
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.selection));
    assert.deepEqual(parseNativeRetainedOutputRoute(`/make/${output}?sha256=${selected.contentSha256}&revision=${revision}`
      + `&artifact=${encodeURIComponent(selected.artifactId)}&document=${encodeURIComponent(selected.documentId)}`), result);
  }
  const boundary = { ...selection(), documentId: "d".repeat(160), artifactId: "a".repeat(160) };
  assert.ok(parseNativeRetainedOutputRoute(route("scene", boundary)));
  assert.equal(parseNativeRetainedOutputRoute(route("scene", { ...boundary, documentId: "d".repeat(161) })), null);
});

test("native retained output: local route decoding rejects ambiguous paths and query identities", () => {
  const healthy = route(), suffix = healthy.slice(healthy.indexOf("?"));
  for (const value of ["https://forma.example" + healthy, "//forma.example" + healthy, " " + healthy, healthy + "\n",
    healthy + "#", healthy + "#fragment", "/make/scene/" + suffix, "/make/other/../scene" + suffix,
    "/make/%73cene" + suffix, "/make/Scene" + suffix, "/make/scene\\" + suffix, "/make/scene", "/make/unknown-output" + suffix,
    healthy + "&revision=3", healthy + "&%72evision=3", healthy + "&extra=1", healthy.replace("&revision=3", ""),
    healthy.replace("document%3Aone._-", "document%2Fone"), healthy.replace("artifact%3Aone._-", "%ZZ"),
    healthy.replace("a".repeat(64), "A".repeat(64)), "/make/scene?" + "x".repeat(2049)]) {
    assert.equal(parseNativeRetainedOutputRoute(value), null, value);
  }
  for (const revision of ["", "-1", "-0", "+1", "01", "1.0", "1e2", "9007199254740992", "NaN"]) {
    assert.equal(parseNativeRetainedOutputRoute(healthy.replace("revision=3", `revision=${revision}`)), null, revision);
  }
  let calls = 0;
  for (const value of [null, 1, [healthy], new String(healthy), { toString() { calls++; return healthy; } }]) {
    assert.equal(parseNativeRetainedOutputRoute(value), null);
  }
  assert.equal(calls, 0);
});

test("native retained output: API paths encode exact identity and reject alternate request forms", () => {
  for (const output of ["scene", "slides", "storyboard", "model3d"]) {
    const expected = target(output), path = nativeRetainedOutputRequestPath(expected);
    assert.equal(path, `/api/retained-output/${output}/document%3Aone._-/artifact%3Aone._-?revision=3&sha256=${"a".repeat(64)}`);
    for (const origin of ["https://forma.example", "http://localhost:4192"]) {
      assert.deepEqual(parseNativeRetainedOutputRequestUrl(origin + path), expected);
    }
    const healthy = "https://forma.example" + path;
    for (const value of [path, "//forma.example" + path, healthy.replace("https:", "ftp:"), healthy.replace("https://", "https://user:pass@"),
      healthy + "#", healthy + "\t", healthy.replace("/retained-output/", "/other/../retained-output/"),
      healthy.replace(`/${output}/`, `/${output.toUpperCase()}/`), healthy.replace(`/${output}/`, "/unknown-output/"),
      healthy.replace("/artifact%3Aone._-?", "/artifact%3Aone._-/?"), healthy.replace("document%3Aone._-", "document%2Fone"),
      healthy.replace("artifact%3Aone._-", "%ZZ"), healthy + "&revision=3", healthy + "&output=scene",
      healthy.replace("revision=3", "revision=01"), healthy.replace("&sha256=" + "a".repeat(64), "")]) {
      assert.equal(parseNativeRetainedOutputRequestUrl(value), null, value);
    }
  }
  let calls = 0;
  assert.equal(parseNativeRetainedOutputRequestUrl({ toString() { calls++; return "https://forma.example"; } }), null);
  assert.equal(calls, 0);
});

test("native retained output: path construction validates target without coercion or getters", () => {
  for (const value of [{ ...target(), output: ["scene"] }, { ...target(), output: "unknown-output" }, { ...target(), extra: true },
    { ...target(), selection: { ...selection(), revision: "3" } }, { ...target(), selection: { ...selection(), documentId: "bad/id" } },
    { ...target(), selection: { ...selection(), contentSha256: "A".repeat(64) } }]) {
    assert.throws(() => nativeRetainedOutputRequestPath(value), TypeError);
  }
  let calls = 0;
  const value = target();
  Object.defineProperty(value.selection, "artifactId", { enumerable: true, get() { calls++; return "artifact"; } });
  assert.throws(() => nativeRetainedOutputRequestPath(value), TypeError);
  assert.equal(calls, 0);
});

test("native retained output: literal Scene projection preserves whitespace, Unicode and witnessed medium", () => {
  const source = scene(), raw = { title: source.title, content_markdown: source.content.content_markdown, private_metadata: { prompt: "private" } };
  for (const medium of [null, "visual", "audio"]) {
    const result = projectNativeRetainedOutput(target(), raw, EXPIRY, medium);
    assert.deepEqual(result, { ...source, content: { ...source.content, medium } });
    assert.deepEqual(valid(result), result);
    assert.deepEqual(Object.keys(result), ["schemaVersion", "kind", "output", "selection", "title", "expiresAt", "content"]);
  }
  for (const medium of ["other", ["visual"], {}, 1]) assert.equal(projectNativeRetainedOutput(target(), raw, EXPIRY, medium), null);
  assert.equal(projectNativeRetainedOutput(target(), { title: "Missing Markdown" }, EXPIRY), null);
  assert.equal(projectNativeRetainedOutput(target(), { title: "Scene", content_markdown: 3 }, EXPIRY), null);
});

test("native retained output: Slides preserve complete native audience fields and remove private evidence", () => {
  const raw = rawSlides(), original = structuredClone(raw), result = projectNativeRetainedOutput(target("slides"), raw, EXPIRY);
  assert.ok(result); assert.deepEqual(raw, original);
  assert.equal(result.title, raw.title); assert.deepEqual(result.content.presentation, raw.presentation);
  const output = result.content.items[0], authored = raw.items[0];
  assert.deepEqual(Object.keys(output), ["title", "body", "notes", "image_prompt", "slide"]);
  assert.equal(output.title, authored.title); assert.equal(output.body, authored.body);
  assert.equal(output.notes, ""); assert.equal(output.image_prompt, "");
  assert.equal(output.slide.kicker, authored.slide.kicker); assert.equal(output.slide.section, authored.slide.section);
  assert.deepEqual(output.slide.bullets, authored.slide.bullets);
  assert.deepEqual(output.slide.quote, { text: authored.slide.quote.text, speaker: authored.slide.quote.speaker,
    role: authored.slide.quote.role, citation: "WHO report" });
  assert.deepEqual(output.slide.citations, [{ label: "WHO report", anchor: "p. 12", excerpt: "" }]);
  assert.deepEqual(output.slide.visual, { ...authored.slide.visual,
    data: authored.slide.visual.data.map(({ sourceIds, ...datum }) => datum) });
  assert.doesNotMatch(JSON.stringify(result), /private|sourceId|sourceOrder|context_group|producer_metadata|Private/u);
  assert.deepEqual(valid(result), result);
});

test("native retained output: every output node is a detached immutable copy", () => {
  const raw = rawSlides(), expected = target("slides"), result = projectNativeRetainedOutput(expected, raw, EXPIRY);
  function frozen(value) {
    if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); for (const nested of Object.values(value)) frozen(nested); }
  }
  frozen(result); frozen(valid(result));
  raw.items[0].slide.bullets[0] = "Changed"; raw.presentation.palette.background = "#000000"; expected.selection.revision++;
  assert.equal(result.content.items[0].slide.bullets[0], " First bullet ");
  assert.equal(result.content.presentation.palette.background, "#F2EFE8"); assert.equal(result.selection.revision, 3);
});

test("native retained output: native optional visual and presentation omissions do not fabricate content", () => {
  for (const extras of [{}, { presentation: null }]) {
    const result = projectNativeRetainedOutput(target("slides"), { title: "Deck", items: [{ title: "Title", body: "Body" }], ...extras }, EXPIRY);
    assert.ok(result); assert.equal(result.content.presentation, null);
    assert.deepEqual(result.content.items, [{ title: "Title", body: "Body", notes: "", image_prompt: "", slide: null }]);
    assert.deepEqual(valid(result), result);
  }
  const withoutCitations = rawSlides(); delete withoutCitations.items[0].slide.citations;
  const projected = projectNativeRetainedOutput(target("slides"), withoutCitations, EXPIRY);
  assert.ok(projected); assert.equal(Object.hasOwn(projected.content.items[0].slide, "citations"), false);
  assert.deepEqual(valid(projected), projected);
  for (const location of ["presentation", "slide"]) for (const value of [{}, [], "", false]) {
    const raw = rawSlides();
    if (location === "presentation") raw.presentation = value; else raw.items[0].slide = value;
    assert.equal(projectNativeRetainedOutput(target("slides"), raw, EXPIRY), null, location);
  }
});

test("native retained output: DTO output and all four identity fields must exactly match requested target", () => {
  for (const [key, value] of [["documentId", "another-document"], ["artifactId", "another-artifact"], ["revision", 4], ["contentSha256", "b".repeat(64)]]) {
    const candidate = scene(); candidate.selection[key] = value;
    assert.equal(valid(candidate), null, key);
    assert.equal(valid(scene(), { output: "scene", selection: { ...selection(), [key]: value } }), null, key);
  }
  assert.equal(valid(scene(), target("slides")), null);
  for (const [key, value] of [["schemaVersion", 2], ["kind", "experience-result"], ["output", ["scene"]],
    ["selection", { ...selection(), revision: "3" }], ["title", 4], ["content", { ...scene().content, medium: "unknown" }]]) {
    assert.equal(valid({ ...scene(), [key]: value }, target()), null, key);
  }
  for (const key of Object.keys(scene())) { const candidate = scene(); delete candidate[key]; assert.equal(valid(candidate, target()), null, key); }
  assert.equal(valid({ ...scene(), releaseHash: "invented" }), null);
  assert.equal(valid({ ...scene(), content: { ...scene().content, editRoute: "/elsewhere" } }), null);
});

test("native retained output: decoder cannot restore producer fields or unprojected citations", () => {
  const mutations = [
    item => { item.notes = "Private notes"; }, item => { item.image_prompt = "Private prompt"; },
    item => { item.context_group_ids = []; }, item => { item.slide.sourceIds = []; }, item => { item.slide.sourceOrder = 1; },
    item => { item.slide.visual.data[0].sourceIds = []; }, item => { item.slide.quote.sourceId = "private"; },
    item => { item.slide.quote.citation = "Private source notes"; }, item => { item.slide.citations[0].sourceId = "private"; },
    item => { item.slide.citations[0].excerpt = "Evidence"; }, item => { item.slide.citations[0].label = "Internal source notes"; },
    item => { item.slide.citations[0].anchor = "  p. 12  "; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(projectedSlides()); mutate(candidate.content.items[0]);
    assert.equal(valid(candidate), null);
  }
});

test("native retained output: public-looking provider flags cannot override citation privacy", () => {
  const raw = rawSlides();
  raw.items[0].slide.quote.citation = "Private source notes";
  const result = projectNativeRetainedOutput(target("slides"), raw, EXPIRY);
  assert.ok(result); assert.equal(Object.hasOwn(result.content.items[0].slide.quote, "citation"), false);
  raw.items[0].slide.citations[1].public = true;
  assert.equal(projectNativeRetainedOutput(target("slides"), raw, EXPIRY), null);
});

test("native retained output: native nested records reject malformed fields without repairs", () => {
  const mutations = [
    raw => { raw.items = []; }, raw => { raw.items = {}; }, raw => { raw.items[0] = null; }, raw => { delete raw.items[0].body; },
    raw => { raw.items[0].notes = 1; }, raw => { raw.items[0].image_prompt = {}; }, raw => { raw.items[0].context_group_ids = "group"; },
    raw => { raw.items[0].slide.layout = "default"; }, raw => { raw.items[0].slide.kicker = 4; },
    raw => { raw.items[0].slide.bullets = "bullet"; }, raw => { raw.items[0].slide.quote = null; },
    raw => { raw.items[0].slide.quote.text = {}; }, raw => { raw.items[0].slide.citations = null; },
    raw => { raw.items[0].slide.citations[0].excerpt = []; }, raw => { raw.items[0].slide.sourceIds = "id"; },
    raw => { raw.items[0].slide.section = 1; }, raw => { raw.items[0].slide.sourceOrder = 0; },
    raw => { raw.items[0].slide.sourceOrder = "7"; }, raw => { raw.items[0].slide.visual.kind = "invented"; },
    raw => { raw.items[0].slide.visual.data = {}; }, raw => { raw.items[0].slide.visual.data[0].weight = "0.75"; },
    raw => { raw.items[0].slide.visual.data[0].weight = 1.1; }, raw => { raw.items[0].slide.visual.data[0].weight = -0.1; },
    raw => { raw.items[0].slide.visual.data[0].exactValue = 75; }, raw => { raw.items[0].slide.visual.data[0].sourceIds = [4]; },
    raw => { raw.items[0].slide.visual.data[0].unknown = "metadata"; }, raw => { raw.presentation.mode = "auto"; },
    raw => { raw.presentation.aspectRatio = "4:3"; }, raw => { raw.presentation.stylePreset = "unknown"; },
    raw => { raw.presentation.palette.background = "red"; }, raw => { delete raw.presentation.footerLabel; },
  ];
  for (const mutate of mutations) { const raw = rawSlides(); mutate(raw); assert.equal(projectNativeRetainedOutput(target("slides"), raw, EXPIRY), null); }
});

test("native retained output: safe native typography is preserved literally without CSS injection", () => {
  for (const font of ["Noto Sans Arabic", "IBM Plex Sans", "日本語", "A".repeat(70)]) {
    const raw = rawSlides(); raw.presentation.fontFamily = font;
    const result = projectNativeRetainedOutput(target("slides"), raw, EXPIRY);
    assert.equal(result.content.presentation.fontFamily, font); assert.deepEqual(valid(result), result);
  }
  for (const font of ["", " Noto Sans", "A".repeat(71), "Font,serif", "Font\";color:red", "url(https://example.com/font)", ["Arial"], 1]) {
    const raw = rawSlides(); raw.presentation.fontFamily = font;
    assert.equal(projectNativeRetainedOutput(target("slides"), raw, EXPIRY), null);
  }
});

test("native retained output: UTF8 component byte limits preserve full boundary text", () => {
  const candidate = scene(); candidate.title = "é".repeat(NATIVE_RETAINED_OUTPUT_TEXT_MAX_BYTES / 2);
  candidate.content.content_markdown = "😀".repeat(NATIVE_RETAINED_OUTPUT_MARKDOWN_MAX_BYTES / 4);
  assert.ok(valid(candidate));
  assert.equal(valid({ ...candidate, title: candidate.title + "x" }), null);
  assert.equal(valid({ ...candidate, content: { ...candidate.content, content_markdown: candidate.content.content_markdown + "x" } }), null);
  const raw = rawSlides(); raw.items = [{ title: "é".repeat(40_000), body: "😀".repeat(20_000), slide: null }];
  assert.ok(projectNativeRetainedOutput(target("slides"), raw, EXPIRY));
  raw.items[0].body += "x"; assert.equal(projectNativeRetainedOutput(target("slides"), raw, EXPIRY), null);
});

test("native retained output: bounded lists accept complete limits and reject overflow instead of truncating", () => {
  const cases = [
    [NATIVE_RETAINED_OUTPUT_ITEMS_MAX, (raw, size) => { raw.items = Array.from({ length: size }, () => ({ title: "Page", body: "Text", slide: null })); }],
    [NATIVE_RETAINED_OUTPUT_BULLETS_MAX, (raw, size) => { raw.items[0].slide.bullets = Array.from({ length: size }, (_, index) => `Bullet ${index}`); }],
    [NATIVE_RETAINED_OUTPUT_DATA_MAX, (raw, size) => { raw.items[0].slide.visual.data = Array.from({ length: size }, (_, index) => ({ label: `Datum ${index}`, value: "1", weight: 1 })); }],
    [NATIVE_RETAINED_OUTPUT_CITATIONS_MAX, (raw, size) => { raw.items[0].slide.citations = Array.from({ length: size }, (_, index) => ({ label: `WHO report ${index}`, anchor: "p. 12", excerpt: "" })); }],
  ];
  for (const [maximum, set] of cases) {
    const raw = rawSlides(); set(raw, maximum); assert.ok(projectNativeRetainedOutput(target("slides"), raw, EXPIRY));
    set(raw, maximum + 1); assert.equal(projectNativeRetainedOutput(target("slides"), raw, EXPIRY), null);
  }
});

test("native retained output: escaped envelope bytes and private metadata count toward the JSON cap", () => {
  const candidate = scene(); candidate.title = ""; candidate.content.content_markdown = "";
  const remaining = NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES - bytes(JSON.stringify(candidate));
  candidate.content.content_markdown = "\0".repeat(Math.floor(remaining / 6)) + "x".repeat(remaining % 6);
  assert.equal(bytes(JSON.stringify(candidate)), NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES); assert.ok(valid(candidate));
  candidate.content.content_markdown += "x"; assert.equal(valid(candidate), null);
  assert.equal(projectNativeRetainedOutput(target(), { title: "Scene", content_markdown: "Text", private: "x".repeat(NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES) }, EXPIRY), null);
});

test("native retained output: descriptor capture rejects executable, cyclic and non-JSON shapes safely", () => {
  let calls = 0;
  const candidates = [];
  for (const location of ["root", "item", "datum", "metadata", "array"]) {
    const raw = rawSlides();
    const container = location === "root" ? raw : location === "item" ? raw.items[0]
      : location === "datum" ? raw.items[0].slide.visual.data[0] : location === "array" ? raw.items : raw.producer_metadata;
    const key = location === "array" ? "0" : location === "root" ? "title" : location === "item" ? "body" : "secret";
    Object.defineProperty(container, key, { enumerable: true, configurable: true, get() { calls++; return "text"; } });
    candidates.push(raw);
  }
  const cyclic = rawSlides(); cyclic.producer_metadata.loop = cyclic; candidates.push(cyclic);
  const serialized = rawSlides(); serialized.toJSON = () => { calls++; return {}; }; candidates.push(serialized);
  const iterable = rawSlides(); iterable.items[Symbol.iterator] = () => { calls++; return [][Symbol.iterator](); }; candidates.push(iterable);
  const sparse = rawSlides(); sparse.items.length = 2; candidates.push(sparse);
  const customArray = rawSlides(); Object.setPrototypeOf(customArray.items, { custom: true }); candidates.push(customArray);
  const inherited = rawSlides(); Object.setPrototypeOf(inherited, { inherited: true }); candidates.push(inherited);
  for (const unsupported of [undefined, Infinity, NaN, 1n, Symbol("private"), new Date(), new String("text")]) {
    candidates.push({ ...rawSlides(), private_metadata: unsupported });
  }
  for (const raw of candidates) assert.equal(projectNativeRetainedOutput(target("slides"), raw, EXPIRY), null);
  const hostile = scene(); Object.defineProperty(hostile.content, "medium", { enumerable: true, get() { calls++; return "visual"; } });
  assert.equal(valid(hostile), null); assert.equal(calls, 0);
  const nullPrototype = Object.assign(Object.create(null), scene()); assert.ok(valid(nullPrototype));
});

test("native retained output: expired or noncanonical timestamps never yield a usable DTO", () => {
  const candidate = scene(), expiry = Date.parse(EXPIRY);
  assert.ok(validateNativeRetainedOutputDto(candidate, target(), expiry - 1));
  assert.equal(validateNativeRetainedOutputDto(candidate, target(), expiry), null);
  for (const expiresAt of ["2099-02-30T00:00:00.000Z", "2099-01-02T00:00:00Z", "2099-01-02T00:00:00.000+00:00", "invalid", "2020-01-01T00:00:00.000Z"]) {
    assert.equal(valid({ ...candidate, expiresAt }), null);
    assert.equal(projectNativeRetainedOutput(target(), { title: "Scene", content_markdown: "Text" }, expiresAt), null);
  }
  for (const now of [NaN, Infinity, "0", null]) assert.equal(validateNativeRetainedOutputDto(candidate, target(), now), null);
});

const model3dFile = () => ({ url: "/api/media/u-6f776e6572%2Fgenerated%2Fmodel.glb", mimeType: "model/gltf-binary",
  fileName: "Original model.glb", fileSize: 976, format: "glb", role: "mesh", sha256: "b".repeat(64), previewSupported: true });
const model3dEnvelope = () => ({ artifact_kind: "model3d", settings: { model3d_files: [model3dFile()],
  model3d: { prompt: "PRIVATE provider input" }, reserved_cost_microusd: 123 }, media_url: "https://provider.invalid/model.glb" });
const rawModel3d = () => ({ title: "Original 3D model", content_markdown: "PRIVATE generation prompt", items: [] });
const projectedModel3d = (receipt = model3dEnvelope()) => projectNativeRetainedOutput(target("model3d"), rawModel3d(), EXPIRY, null, { model3dReceipt: receipt });

test("native retained Model3D projects selected file references without exposing the generation plan", () => {
  const receipt = model3dEnvelope(), dto = projectedModel3d(receipt);
  assert.ok(dto); assert.equal(dto.output, "model3d");
  assert.deepEqual(dto.content, { files: [model3dFile()], availability: "mesh-reference" });
  assert.deepEqual(valid(dto), dto);
  assert.doesNotMatch(JSON.stringify(dto), /PRIVATE|provider\.invalid|reserved_cost|content_markdown/u);
  receipt.settings.model3d_files[0].sha256 = "c".repeat(64);
  assert.equal(dto.content.files[0].sha256, "b".repeat(64));
  for (const value of [dto, dto.content, dto.content.files, dto.content.files[0]]) assert.ok(Object.isFrozen(value));
});

test("native retained Model3D never invents a mesh from a prompt or legacy media URL", () => {
  for (const receipt of [{ artifact_kind: "model3d" }, { artifact_kind: "model3d", settings: {} },
    { artifact_kind: "model3d", settings: { model3d_files: [] }, media_url: model3dFile().url }]) {
    assert.deepEqual(projectedModel3d(receipt).content, { files: [], availability: "metadata-only" });
  }
  const receipt = model3dEnvelope();
  receipt.settings.model3d_files = [{ ...model3dFile(), fileName: "Original package.zip", format: null, mimeType: "application/zip" }];
  assert.equal(projectedModel3d(receipt).content.availability, "file-references");
  assert.equal(projectedModel3d(null), null);
  assert.equal(projectedModel3d({ artifact_kind: "scene" }), null);
});

test("native retained Model3D refuses malformed file identities instead of repairing or dropping rows", () => {
  for (const delta of [{ url: "https://provider.invalid/model.glb" }, { url: "/api/media/%ZZ" },
    { url: "/api/media/u-6f776e6572%2Fgenerated%2F..%2Fmodel.glb" }, { sha256: "" }, { sha256: "A".repeat(64) },
    { fileSize: 0 }, { fileSize: -1 }, { fileName: "../model.glb" }, { role: "manifest" },
    { mimeType: "text/html" }, { previewSupported: "yes" }, { sourcePrompt: "PRIVATE" }]) {
    const receipt = model3dEnvelope(); Object.assign(receipt.settings.model3d_files[0], delta);
    assert.equal(projectedModel3d(receipt), null, JSON.stringify(delta));
  }
  const receipt = model3dEnvelope(); receipt.settings.model3d_files.push(model3dFile());
  assert.equal(projectedModel3d(receipt), null);
  assert.equal(projectedModel3d({ artifact_kind: "model3d", settings: { model3d_files: null } }), null);
});

test("native retained Model3D keeps exact selection and honest derived availability", () => {
  const dto = projectedModel3d();
  for (const delta of [{ documentId: "other" }, { artifactId: "other" }, { revision: 4 }, { contentSha256: "c".repeat(64) }]) {
    assert.equal(valid(dto, { output: "model3d", selection: { ...selection(), ...delta } }), null);
  }
  assert.equal(valid({ ...dto, content: { ...dto.content, availability: "files-retained" } }), null);
  assert.equal(valid({ ...dto, content: { files: [], availability: "mesh-reference" } }), null);
  assert.equal(valid({ ...dto, content: { ...dto.content, content_markdown: "invented editable mesh" } }), null);
});

test("native retained Model3D bounds file metadata and never invokes receipt getters", () => {
  let calls = 0;
  const receipt = model3dEnvelope();
  Object.defineProperty(receipt.settings.model3d_files[0], "url", { enumerable: true, get() { calls++; return model3dFile().url; } });
  assert.equal(projectedModel3d(receipt), null); assert.equal(calls, 0);
  const options = {};
  Object.defineProperty(options, "model3dReceipt", { enumerable: true, get() { calls++; return model3dEnvelope(); } });
  assert.equal(projectNativeRetainedOutput(target("model3d"), rawModel3d(), EXPIRY, null, options), null);
  assert.equal(calls, 0);
  const oversized = model3dEnvelope();
  oversized.settings.model3d_files = Array.from({ length: 65 }, (_, index) => ({ ...model3dFile(), url: `/api/media/file-${index}.glb` }));
  assert.equal(projectedModel3d(oversized), null);
});

const storyboardRaw = () => ({title:"  Harbor لوحة\r\n",content_markdown:"Retained outline",items:[
  {title:"  Frame 1\r\n",body:"\ufeff  Exact <script>copy</script>\nوفحصت ميرا الضوء.  ",notes:"  Pan left\r\n",image_prompt:"  Keeper image\n",slide:null},
  {title:"Frame 2",body:"The image was not retained.",notes:"",image_prompt:"",slide:null},
]});
const storyboardReceipts = () => [
  {id:"frame:keeper",title:"Original title",media_url:"/api/media/u-owner%2Fgenerated%2Fkeeper.png",media_type:"image/png",width:1280,height:720},
  {id:"frame:missing",title:"Original second title",media_url:null,media_type:null,width:null,height:null},
];

test("native storyboard exact routes and API selectors preserve all four source coordinates",()=>{
  assert.deepEqual(parseNativeRetainedOutputRoute(route("storyboard")),target("storyboard"));
  const path=nativeRetainedOutputRequestPath(target("storyboard"));
  assert.deepEqual(parseNativeRetainedOutputRequestUrl(`https://forma.test${path}`),target("storyboard"));
  for(const suffix of ["#changed","&revision=3","&frame=other"])
    assert.equal(parseNativeRetainedOutputRoute(route("storyboard")+suffix),null);
});

test("native storyboard joins exact immutable receipt IDs/order to unmodified current authored text",()=>{
  const raw=storyboardRaw(),receipt=storyboardReceipts(),before=structuredClone({raw,receipt});
  const output=projectNativeRetainedOutput(target("storyboard"),raw,EXPIRY,null,{storyboardItems:receipt});
  assert.ok(output);assert.deepEqual(output.content.frames.map(frame=>frame.id),receipt.map(frame=>frame.id));
  for(const [index,frame] of output.content.frames.entries()){
    const item=raw.items[index];
    assert.deepEqual([frame.title,frame.body,frame.notes,frame.imagePrompt],[item.title,item.body,item.notes,item.image_prompt]);
  }
  assert.equal(output.content.frames[1].image,null);
  assert.deepEqual(output.content.frames[0].image,{url:receipt[0].media_url,mediaType:"image/png",width:1280,height:720});
  assert.deepEqual(validateNativeRetainedOutputDto(output,target("storyboard"),NOW),output);
  assert.ok(Object.isFrozen(output.content.frames[0]));assert.deepEqual({raw,receipt},before);
});

test("native storyboard rejects missing, duplicate or ambiguous frame receipts without fabricating a frame",()=>{
  for(const alter of [r=>r.pop(),r=>r.push({...r[0]}),r=>r[1].id=r[0].id,r=>delete r[0].id,
    r=>r[0].media_url="https://example.test/image.png",r=>r[0].media_url="/api/media/private-token",
    r=>r[0].media_type="text/html",r=>r[0].width=-1,r=>r[1].width=100]){
    const receipt=storyboardReceipts();alter(receipt);
    assert.equal(projectNativeRetainedOutput(target("storyboard"),storyboardRaw(),EXPIRY,null,{storyboardItems:receipt}),null);
  }
  assert.equal(projectNativeRetainedOutput(target("storyboard"),storyboardRaw(),EXPIRY),null);
  let reads=0;const receipts=storyboardReceipts();Object.defineProperty(receipts[0],"id",{enumerable:true,get(){reads++;return "frame:fake";}});
  assert.equal(projectNativeRetainedOutput(target("storyboard"),storyboardRaw(),EXPIRY,null,{storyboardItems:receipts}),null);assert.equal(reads,0);
});

test("native storyboard client keeps identity, expiry and closed frame fields strict",()=>{
  const dto=()=>projectNativeRetainedOutput(target("storyboard"),storyboardRaw(),EXPIRY,null,{storyboardItems:storyboardReceipts()});
  for(const change of [v=>v.selection.revision++,v=>v.selection.artifactId="other",v=>v.selection.contentSha256="b".repeat(64),
    v=>v.selection.documentId="other",v=>v.content.frames[0].injected=true,v=>v.content.frames[0].image.url="data:image/png,anything",
    v=>v.expiresAt="2000-01-01T00:00:00.000Z",v=>v.content.frames.reverse().push(v.content.frames[0])]){
    const value=structuredClone(dto());change(value);assert.equal(validateNativeRetainedOutputDto(value,target("storyboard"),NOW),null);
  }
});
