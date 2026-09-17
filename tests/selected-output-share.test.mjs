import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  parseSelectedOutputShareApproval,
  parseSelectedOutputShareSelection,
  projectSelectedOutputShareCandidate,
  validateSelectedOutputSharePublicOutput,
} from "../src/model/selected-output-share.ts";
import {
  NATIVE_RETAINED_OUTPUT_MARKDOWN_MAX_BYTES,
  projectNativeRetainedOutput,
} from "../src/model/native-retained-output.ts";

// Entirely synthetic projection checks. These records grant no native read,
// public release, media access, generation, payer, guest, or claim authority.
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const SOURCE_EXPIRY = "2099-01-01T00:00:00.000Z";
const PURPOSE = "selected-output-read-v1";
const OUTPUTS = ["short_story", "scene", "slides"];
const PRIVATE_TITLE = "PRIVATE_NATIVE_TITLE_MUST_NOT_BECOME_SHARE_TITLE";
const LITERAL = "\ufeff  مرحبا 日本語\r\n\n![source](/api/media/private-input.png)\n"
  + "<img src='https://untrusted.invalid/pixel'><script>leak()</script>\n"
  + "[open](javascript:alert(1)) https://untrusted.invalid/no-fetch  ";
const iso = value => new Date(value).toISOString();
const nativeSelection = () => ({ documentId: "document:private._-", artifactId: "artifact:private._-",
  revision: 2, contentSha256: "a".repeat(64) });
const selection = (output = "scene") => ({ output, ...nativeSelection() });
const review = () => ({ title: "A deliberately selected output", expiresAt: iso(NOW + DAY) });
const story = () => ({ schemaVersion: 1, kind: "native-retained-short-story", selection: nativeSelection(),
  title: PRIVATE_TITLE, expiresAt: SOURCE_EXPIRY, contentMarkdown: LITERAL });
const scene = () => ({ schemaVersion: 1, kind: "native-retained-output", output: "scene", selection: nativeSelection(),
  title: PRIVATE_TITLE, expiresAt: SOURCE_EXPIRY, content: { content_markdown: LITERAL, medium: "visual" } });
const rawSlides = () => ({ title: PRIVATE_TITLE, content_markdown: "PRIVATE_DECK_PLAN", summary: "PRIVATE_SUMMARY",
  presentation: { aspectRatio: "16:9", theme: "Report", footerLabel: "Public attribution", stylePreset: "editorial",
    mode: "light", fontFamily: "Noto Sans Arabic", palette: { background: "#f2efe8", foreground: "#171714",
      accent: "#b8422f", muted: "#625e56", surface: "#ded8ca" } },
  items: [{ title: "Finding", body: LITERAL, notes: "PRIVATE_NOTES", image_prompt: "PRIVATE_IMAGE_PROMPT",
    context_group_ids: ["PRIVATE_CONTEXT_GROUP"], slide: { layout: "scorecard", kicker: "Evidence",
      bullets: ["A complete first point", "A complete second point"], section: "Results", sourceOrder: 4,
      sourceIds: ["PRIVATE_SOURCE_ID"], quote: { text: "Exact public quotation", speaker: "Researcher", role: "Author",
        sourceId: "PRIVATE_QUOTE_ID", citation: "WHO report" },
      citations: [{ sourceId: "PRIVATE_CITATION_ID", label: "WHO report", anchor: "p. 12", excerpt: "PRIVATE_EXCERPT" },
        { sourceId: "PRIVATE_SECOND_ID", label: "Private producer notes", anchor: "source_42", excerpt: "PRIVATE_EVIDENCE" }],
      visual: { kind: "scorecard", label: "Score", value: "7.50", exactValue: "7.500", displayValue: "7.5", unit: "points",
        data: [{ label: "Accuracy", value: "75%", weight: 0.75, exactValue: "75.000", displayValue: "75%",
          sourceIds: ["PRIVATE_DATUM_ID"] }] } } }],
  producer_metadata: { provider: "PRIVATE_PROVIDER", prompt: "PRIVATE_PROMPT" } });
function slides() {
  const dto = projectNativeRetainedOutput({ output: "slides", selection: nativeSelection() }, rawSlides(), SOURCE_EXPIRY);
  assert.ok(dto, "the existing retained audience projector must produce the synthetic fixture");
  return structuredClone(dto);
}
const native = output => output === "short_story" ? story() : output === "slides" ? slides() : scene();
const candidate = (output = "scene", dto = native(output), publication = review()) =>
  projectSelectedOutputShareCandidate(selection(output), dto, publication, NOW);
const approval = expected => ({ purpose: PURPOSE, candidateSha256: expected.candidateSha256, allowPublicRead: true });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function frozen(value) {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) frozen(child);
}
function publicKeys(value) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...publicKeys(child)]);
}
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
}

test("share selection captures exactly one supported output and explicit native revision", () => {
  for (const output of OUTPUTS) for (const revision of [0, 2, Number.MAX_SAFE_INTEGER]) {
    const input = { ...selection(output), revision }, result = parseSelectedOutputShareSelection(input);
    assert.deepEqual(result, input);
    assert.notEqual(result, input);
    assert.ok(Object.isFrozen(result));
    input.documentId = "changed-after-capture";
    assert.equal(result.documentId, "document:private._-");
  }
});

test("share selection rejects absent, ambiguous, coerced and unsupported identities", () => {
  for (const key of Object.keys(selection())) {
    const missing = selection(); delete missing[key];
    assert.equal(parseSelectedOutputShareSelection(missing), null, `missing ${key}`);
  }
  const mutations = {
    output: ["image", "storyboard", "audio", "video", "model3d", "short-story", "Scene", "", null, ["scene"]],
    documentId: ["", "has/slash", "has space", "d".repeat(161), 1, null],
    artifactId: ["", "has/slash", "has space", "a".repeat(161), 1, null],
    revision: ["2", "latest", -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, null],
    contentSha256: ["A".repeat(64), "a".repeat(63), "g".repeat(64), "", null],
  };
  for (const [key, values] of Object.entries(mutations)) for (const value of values) {
    assert.equal(parseSelectedOutputShareSelection({ ...selection(), [key]: value }), null, `${key}: ${String(value)}`);
  }
  for (const value of [null, [], "scene", { ...selection(), extra: true }, { ...selection(), selection: nativeSelection() },
    Object.assign(Object.create({ inherited: true }), selection())]) assert.equal(parseSelectedOutputShareSelection(value), null);
});

test("share selection rejects executable or hidden descriptors without calling them", () => {
  let hooks = 0;
  for (const key of Object.keys(selection())) {
    const input = selection();
    Object.defineProperty(input, key, { enumerable: true, get() { hooks++; throw new Error("getter must not run"); } });
    assert.equal(parseSelectedOutputShareSelection(input), null);
  }
  const symbol = selection(); symbol[Symbol("private")] = "hidden";
  const hidden = selection(); Object.defineProperty(hidden, "private", { value: "hidden" });
  const hiddenRequired = selection(); Object.defineProperty(hiddenRequired, "documentId", { value: "document:one", enumerable: false });
  const serialized = { ...selection(), toJSON() { hooks++; throw new Error("toJSON must not run"); } };
  for (const input of [symbol, hidden, hiddenRequired, serialized]) assert.equal(parseSelectedOutputShareSelection(input), null);
  assert.equal(hooks, 0);
});

test("all five media modes refuse before inspecting their untrusted native payload", async () => {
  let touches = 0;
  const forbidden = new Proxy({}, {
    get() { touches++; throw new Error("unsupported native DTO touched"); },
    getPrototypeOf() { touches++; throw new Error("unsupported native DTO reflected"); },
    ownKeys() { touches++; throw new Error("unsupported native DTO enumerated"); },
  });
  for (const output of ["image", "storyboard", "audio", "video", "model3d"]) {
    assert.equal(await projectSelectedOutputShareCandidate({ ...selection(), output }, forbidden, review(), NOW), null);
  }
  assert.equal(touches, 0);
});

test("Short story and Scene public envelopes contain complete literal text and the reviewed title only", async () => {
  for (const output of ["short_story", "scene"]) {
    const result = await candidate(output);
    assert.ok(result);
    assert.deepEqual(result.publicOutput, { schemaVersion: 1, kind: "selected-output-read", output,
      title: review().title, expiresAt: review().expiresAt, attribution: "Forma",
      content: output === "short_story" ? { text: LITERAL } : { text: LITERAL, medium: "visual" } });
    assert.equal(result.publicOutput.content.text, LITERAL);
    assert.equal(JSON.stringify(result.publicOutput).includes(PRIVATE_TITLE), false);
    assert.deepEqual(result.selection, selection(output));
    assert.equal(result.sourceExpiresAt, SOURCE_EXPIRY);
    frozen(result);
  }
  for (const medium of [null, "visual", "audio"]) {
    const dto = scene(); dto.content.medium = medium;
    assert.equal((await candidate("scene", dto)).publicOutput.content.medium, medium);
  }
});

test("Slides retain audience copy and visual data without producer fields or evidence", async () => {
  const dto = slides(), original = structuredClone(dto), result = await candidate("slides", dto);
  assert.ok(result);
  assert.deepEqual(dto, original, "projection does not edit the private reader DTO");
  const publicItems = structuredClone(dto.content.items).map(item => {
    for (const citation of item.slide?.citations ?? []) delete citation.excerpt;
    return { title: item.title, body: item.body, slide: item.slide };
  });
  assert.deepEqual(result.publicOutput.content, {
    items: publicItems,
    presentation: dto.content.presentation,
  });
  assert.deepEqual(Object.keys(result.publicOutput.content.items[0]).sort(), ["body", "slide", "title"]);
  assert.doesNotMatch(JSON.stringify(result.publicOutput), /PRIVATE_|sourceIds|sourceOrder|context_group|notes|image_prompt/u);
  assert.deepEqual(result.publicOutput.content.items[0].slide.citations, [{ label: "WHO report", anchor: "p. 12" }]);
  assert.equal(publicKeys(result.publicOutput).includes("excerpt"), false);
  assert.equal(result.publicOutput.content.items[0].slide.visual.data[0].exactValue, "75.000");
  assert.equal(result.publicOutput.content.items[0].body, LITERAL);
  frozen(result);
});

test("public payloads expose no native identities, source expiry or candidate digest", async () => {
  for (const output of OUTPUTS) {
    const result = await candidate(output), keys = publicKeys(result.publicOutput);
    for (const forbidden of ["selection", "documentId", "artifactId", "revision", "contentSha256", "candidateSha256",
      "sourceExpiresAt", "inputRef", "claim", "memory", "ownerId", "email"]) assert.equal(keys.includes(forbidden), false, forbidden);
    const encoded = JSON.stringify(result.publicOutput);
    assert.equal(encoded.includes("document:private._-"), false);
    assert.equal(encoded.includes("artifact:private._-"), false);
  }
});

test("candidate SHA-256 binds the closed source selection, expiry and complete reviewed projection", async () => {
  for (const output of OUTPUTS) {
    const result = await candidate(output);
    assert.ok(result);
    assert.deepEqual(Object.keys(result).sort(), ["candidateSha256", "kind", "publicOutput", "purpose", "schemaVersion", "selection", "sourceExpiresAt"]);
    const preimage = { schemaVersion: 1, kind: "selected-output-share-candidate", purpose: PURPOSE,
      selection: selection(output), sourceExpiresAt: SOURCE_EXPIRY, publicOutput: result.publicOutput };
    assert.match(result.candidateSha256, /^[a-f0-9]{64}$/u);
    assert.equal(result.candidateSha256, digest(preimage));
    assert.equal((await candidate(output)).candidateSha256, result.candidateSha256);
  }
  const base = await candidate();
  const variations = [
    candidate("scene", scene(), { ...review(), title: "Different public title" }),
    candidate("scene", scene(), { ...review(), expiresAt: iso(NOW + 2 * DAY) }),
  ];
  const changedBody = scene(); changedBody.content.content_markdown += "a"; variations.push(candidate("scene", changedBody));
  const changedExpiry = scene(); changedExpiry.expiresAt = "2098-01-01T00:00:00.000Z"; variations.push(candidate("scene", changedExpiry));
  const changedIdentity = selection(), changedDto = scene(); changedIdentity.revision++; changedDto.selection.revision++;
  variations.push(projectSelectedOutputShareCandidate(changedIdentity, changedDto, review(), NOW));
  for (const promise of variations) {
    const changed = await promise; assert.ok(changed);
    assert.notEqual(changed.candidateSha256, base.candidateSha256);
    assert.equal(parseSelectedOutputShareApproval(approval(base), changed), null);
  }
});

test("each source identity must match independently and cross-kind native DTOs refuse", async () => {
  for (const output of OUTPUTS) {
    for (const [key, value] of Object.entries({ documentId: "document:other", artifactId: "artifact:other", revision: 3, contentSha256: "b".repeat(64) })) {
      const dto = native(output); dto.selection[key] = value;
      assert.equal(await candidate(output, dto), null, `${output} ${key}`);
    }
    for (const other of OUTPUTS.filter(value => value !== output)) assert.equal(await candidate(output, native(other)), null);
  }
});

test("input property insertion order does not change a candidate or its approval digest", async () => {
  for (const output of OUTPUTS) {
    const normal = await candidate(output);
    const reordered = await projectSelectedOutputShareCandidate(reverseKeys(selection(output)), reverseKeys(native(output)), reverseKeys(review()), NOW);
    assert.deepEqual(reordered, normal);
    assert.ok(parseSelectedOutputShareApproval(approval(normal), reordered));
  }
});

test("expired, invalid and noncanonical native lifetimes refuse without extending retention", async () => {
  for (const output of OUTPUTS) for (const expiresAt of [iso(NOW), iso(NOW - 1), "2030-01-02T00:00:00Z",
    "2030-01-02T00:00:00.000+00:00", "2030-02-30T00:00:00.000Z", "never", null]) {
    const dto = native(output); dto.expiresAt = expiresAt;
    assert.equal(await candidate(output, dto), null, `${output} ${expiresAt}`);
  }
});

test("publication expiry is future, canonical and bounded by both seven days and native retention", async () => {
  for (const output of OUTPUTS) {
    for (const offset of [1, DAY, 7 * DAY]) {
      assert.ok(await candidate(output, native(output), { ...review(), expiresAt: iso(NOW + offset) }));
    }
    for (const offset of [-1, 0, 7 * DAY + 1]) assert.equal(await candidate(output, native(output), { ...review(), expiresAt: iso(NOW + offset) }), null);
    const dto = native(output); dto.expiresAt = iso(NOW + DAY);
    assert.ok(await candidate(output, dto, { ...review(), expiresAt: dto.expiresAt }));
    assert.equal(await candidate(output, dto, { ...review(), expiresAt: iso(NOW + DAY + 1) }), null);
    for (const expiresAt of ["2030-01-02T00:00:00Z", "2030-01-02T00:00:00.000+00:00", "2030-02-30T00:00:00.000Z", "", null, NOW + DAY]) {
      assert.equal(await candidate(output, native(output), { ...review(), expiresAt }), null);
    }
  }
  for (const now of [NaN, Infinity, -Infinity, "2030-01-01", null]) {
    assert.equal(await projectSelectedOutputShareCandidate(selection(), scene(), review(), now), null);
  }
});

test("review requires an explicit bounded literal title and never falls back to private source title", async () => {
  for (const title of ["Readable title", "日本語 عنوان", "  Exact reviewed title  ", "é".repeat(256), "x".repeat(512), "<b>Literal title</b>"]) {
    const result = await candidate("scene", scene(), { ...review(), title });
    assert.ok(result); assert.equal(result.publicOutput.title, title);
  }
  for (const title of ["", " ", "\n", "bad\0title", "bad\ttitle", "bad\rtitle", "bad\ntitle", "bad\u007ftitle",
    "bad\u0080title", "bad\u0085title", "bad\u009ftitle", "é".repeat(257), "x".repeat(513), null, 3, ["title"]]) {
    assert.equal(await candidate("scene", scene(), { ...review(), title }), null);
  }
  const noTitle = review(); delete noTitle.title;
  assert.equal(await candidate("scene", scene(), noTitle), null);
});

test("review is a closed captured record and invokes no supplied hooks", async () => {
  let hooks = 0;
  for (const key of ["title", "expiresAt"]) {
    const value = review();
    Object.defineProperty(value, key, { enumerable: true, get() { hooks++; throw new Error("review getter"); } });
    assert.equal(await candidate("scene", scene(), value), null);
  }
  const hidden = review(); Object.defineProperty(hidden, "hidden", { value: "PRIVATE" });
  const symbol = review(); symbol[Symbol("private")] = true;
  for (const value of [null, [], "title", { ...review(), allowPublicRead: true }, { ...review(), claimToken: "PRIVATE" }, hidden, symbol,
    Object.assign(Object.create({ private: true }), review()), { ...review(), toJSON() { hooks++; throw new Error("review serializer"); } }]) {
    assert.equal(await candidate("scene", scene(), value), null);
  }
  assert.equal(hooks, 0);
});

test("malformed native records and nested producer additions fail closed", async () => {
  for (const output of OUTPUTS) {
    const dto = native(output); dto.extra = "PRIVATE";
    assert.equal(await candidate(output, dto), null);
    assert.equal(await candidate(output, Object.assign(Object.create({ private: true }), native(output))), null);
  }
  const mutations = [
    dto => { dto.content.items[0].notes = "PRIVATE_NOTES"; },
    dto => { dto.content.items[0].image_prompt = "PRIVATE_PROMPT"; },
    dto => { dto.content.items[0].context_group_ids = ["PRIVATE"]; },
    dto => { dto.content.items[0].mediaUrl = "/api/media/private.png"; },
    dto => { dto.content.items[0].slide.sourceIds = []; },
    dto => { dto.content.items[0].slide.sourceOrder = 1; },
    dto => { dto.content.items[0].slide.quote.sourceId = "PRIVATE"; },
    dto => { dto.content.items[0].slide.citations[0].excerpt = "PRIVATE_EVIDENCE"; },
    dto => { dto.content.items[0].slide.citations[0].public = true; },
    dto => { dto.content.items[0].slide.visual.data[0].sourceIds = []; },
    dto => { dto.content.presentation.fontFamily = "Injected;url(https://invalid.test)"; },
  ];
  for (const mutate of mutations) { const dto = slides(); mutate(dto); assert.equal(await candidate("slides", dto), null); }
});

test("native getters, serializers and custom array iterators never execute", async () => {
  let hooks = 0;
  for (const output of OUTPUTS) {
    const dto = native(output);
    Object.defineProperty(dto, "title", { enumerable: true, get() { hooks++; throw new Error("native getter"); } });
    assert.equal(await candidate(output, dto), null);
  }
  const nested = slides();
  Object.defineProperty(nested.content.items[0].slide.visual.data[0], "value", { enumerable: true, get() { hooks++; throw new Error("nested getter"); } });
  assert.equal(await candidate("slides", nested), null);
  const iterator = slides();
  iterator.content.items[Symbol.iterator] = function* () { hooks++; yield { title: "bad" }; };
  assert.equal(await candidate("slides", iterator), null);
  const serializer = slides(); serializer.content.items[0].toJSON = () => { hooks++; return {}; };
  assert.equal(await candidate("slides", serializer), null);
  assert.equal(hooks, 0);
});

test("body byte limits reject overflow without truncating accepted literal content", async () => {
  for (const output of ["short_story", "scene"]) {
    const dto = native(output), field = output === "short_story" ? dto : dto.content;
    const key = output === "short_story" ? "contentMarkdown" : "content_markdown";
    field[key] = "é".repeat(NATIVE_RETAINED_OUTPUT_MARKDOWN_MAX_BYTES / 2);
    const accepted = await candidate(output, dto);
    assert.ok(accepted); assert.equal(accepted.publicOutput.content.text, field[key]);
    field[key] += "a";
    assert.equal(await candidate(output, dto), null);
  }
});

test("all input fields are captured before the digest await and returned records are deeply immutable", async () => {
  const selected = selection("slides"), dto = slides(), publication = review();
  const promised = projectSelectedOutputShareCandidate(selected, dto, publication, NOW);
  selected.artifactId = "artifact:changed";
  selected.contentSha256 = "c".repeat(64);
  dto.selection.revision = 500;
  dto.content.items[0].body = "changed";
  dto.content.items[0].slide.visual.data[0].value = "changed";
  dto.content.presentation.palette.background = "#000000";
  publication.title = "changed"; publication.expiresAt = iso(NOW + 2 * DAY);
  const result = await promised, expected = await candidate("slides");
  assert.deepEqual(result, expected);
  assert.notEqual(result.selection, selected);
  assert.notEqual(result.publicOutput.content.items, dto.content.items);
  assert.notEqual(result.publicOutput.content.items[0].slide, dto.content.items[0].slide);
  frozen(result);
  assert.throws(() => { result.publicOutput.title = "mutate frozen result"; }, TypeError);
  assert.throws(() => { result.publicOutput.content.items[0].slide.visual.data.push({}); }, TypeError);
});

test("approval is exact, immutable and bound to one independently prepared candidate digest", async () => {
  for (const output of OUTPUTS) {
    const expected = await candidate(output), input = approval(expected);
    const captured = parseSelectedOutputShareApproval(input, expected);
    assert.deepEqual(captured, input);
    assert.notEqual(captured, input); assert.ok(Object.isFrozen(captured));
    input.candidateSha256 = "f".repeat(64);
    assert.equal(captured.candidateSha256, expected.candidateSha256);
  }
  const expected = await candidate();
  for (const key of Object.keys(approval(expected))) {
    const missing = approval(expected); delete missing[key];
    assert.equal(parseSelectedOutputShareApproval(missing, expected), null);
  }
  for (const value of [
    { ...approval(expected), purpose: "generation" }, { ...approval(expected), purpose: "claim" },
    { ...approval(expected), purpose: "selected-output-read-v2" },
    { ...approval(expected), allowPublicRead: false }, { ...approval(expected), allowPublicRead: 1 },
    { ...approval(expected), allowPublicRead: "true" }, { ...approval(expected), candidateSha256: "b".repeat(64) },
    { ...approval(expected), candidateSha256: expected.candidateSha256.toUpperCase() },
    { ...approval(expected), candidateSha256: "" }, { ...approval(expected), candidateSha256: null },
    { ...approval(expected), claimToken: "PRIVATE" }, { ...approval(expected), allowGeneration: true },
    { ...approval(expected), mediaKeys: [] }, { ...approval(expected), expiresAt: review().expiresAt }, null, [],
  ]) assert.equal(parseSelectedOutputShareApproval(value, expected), null);
});

test("approval parsing rejects hooks, hidden fields and custom prototypes without executing them", async () => {
  const expected = await candidate();
  let hooks = 0;
  for (const key of Object.keys(approval(expected))) {
    const input = approval(expected);
    Object.defineProperty(input, key, { enumerable: true, get() { hooks++; throw new Error("approval getter"); } });
    assert.equal(parseSelectedOutputShareApproval(input, expected), null);
  }
  const hidden = approval(expected); Object.defineProperty(hidden, "private", { value: true });
  const symbol = approval(expected); symbol[Symbol("private")] = true;
  for (const input of [hidden, symbol, Object.assign(Object.create({ inherited: true }), approval(expected)),
    { ...approval(expected), toJSON() { hooks++; return approval(expected); } }]) {
    assert.equal(parseSelectedOutputShareApproval(input, expected), null);
  }
  assert.equal(hooks, 0);
});

test("public decoder round-trips only detached literal public content", async () => {
  for (const output of OUTPUTS) {
    const expected = (await candidate(output)).publicOutput, input = structuredClone(expected);
    const decoded = validateSelectedOutputSharePublicOutput(input, NOW);
    assert.deepEqual(decoded, expected);
    assert.notEqual(decoded, input); frozen(decoded);
    input.title = "changed";
    if (output === "slides") input.content.items[0].body = "changed";
    else input.content.text = "changed";
    assert.deepEqual(decoded, expected);
  }
});

test("public decoder refuses source identities, extra authority and media envelopes", async () => {
  for (const output of OUTPUTS) {
    const good = (await candidate(output)).publicOutput;
    for (const key of ["selection", "documentId", "contentSha256", "inputRef", "ownerId", "claimToken", "media", "prompt"]) {
      assert.equal(validateSelectedOutputSharePublicOutput({ ...good, [key]: "PRIVATE" }, NOW), null, key);
    }
    for (const [key, value] of [["schemaVersion", 2], ["kind", "native-retained-output"], ["attribution", "Other"],
      ["expiresAt", iso(NOW)], ["expiresAt", "2030-01-02T00:00:00Z"], ["title", ""], ["title", "bad\0title"], ["title", "bad\u0085title"]]) {
      assert.equal(validateSelectedOutputSharePublicOutput({ ...good, [key]: value }, NOW), null, key);
    }
    for (const unsupported of ["image", "storyboard", "audio", "video", "model3d"]) {
      assert.equal(validateSelectedOutputSharePublicOutput({ ...good, output: unsupported }, NOW), null);
    }
  }
});

test("public Slides decoder cannot restore private fields at any nested level", async () => {
  const good = (await candidate("slides")).publicOutput;
  const mutations = [
    value => { value.content.items[0].notes = ""; },
    value => { value.content.items[0].image_prompt = ""; },
    value => { value.content.items[0].context_group_ids = []; },
    value => { value.content.items[0].slide.sourceIds = []; },
    value => { value.content.items[0].slide.sourceOrder = 1; },
    value => { value.content.items[0].slide.quote.sourceId = "PRIVATE"; },
    value => { value.content.items[0].slide.citations[0].excerpt = ""; },
    value => { value.content.items[0].slide.citations[0].sourceId = "PRIVATE"; },
    value => { value.content.items[0].slide.citations[0].public = true; },
    value => { value.content.items[0].slide.visual.data[0].sourceIds = []; },
    value => { value.content.presentation.url = "https://untrusted.invalid/font"; },
    value => { value.content.presentation.palette.background = "url(https://untrusted.invalid/pixel)"; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(good); mutate(value);
    assert.equal(validateSelectedOutputSharePublicOutput(value, NOW), null);
  }
});

test("public decoder never invokes getters or custom array iteration", async () => {
  let hooks = 0;
  for (const output of OUTPUTS) {
    const value = structuredClone((await candidate(output)).publicOutput);
    Object.defineProperty(value, "content", { enumerable: true, get() { hooks++; throw new Error("public getter"); } });
    assert.equal(validateSelectedOutputSharePublicOutput(value, NOW), null);
  }
  const value = structuredClone((await candidate("slides")).publicOutput);
  value.content.items[Symbol.iterator] = function* () { hooks++; yield {}; };
  assert.equal(validateSelectedOutputSharePublicOutput(value, NOW), null);
  assert.equal(hooks, 0);
});

test("projection performs no fetch and URL-looking output remains literal data", async () => {
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = () => { reads++; throw new Error("pure projection must not fetch"); };
  try {
    for (const output of OUTPUTS) {
      const result = await candidate(output);
      assert.ok(result);
      const text = output === "slides" ? result.publicOutput.content.items[0].body : result.publicOutput.content.text;
      assert.equal(text, LITERAL);
    }
    assert.equal(reads, 0);
  } finally { globalThis.fetch = original; }
});
