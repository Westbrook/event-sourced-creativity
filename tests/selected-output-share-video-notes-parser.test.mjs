import assert from "node:assert/strict";
import test from "node:test";
import { selectedOutputShareVideoNotesContent as content, selectedOutputShareVideoNotesEdit as edit } from "../worker/selected-output-share-video-notes.ts";

const original = () => ({ title: "Native original", summary: "One clip", content_markdown: "Retained writing", presentation: null,
  items: [{ title: "Clip", body: "Unchanged clip description", notes: "Original notes", image_prompt: "Prompt", context_group_ids: ["context"], slide: null }] });
const identity = () => ({ ownerId: "owner", documentId: "document", projectId: "project", artifactId: "artifact", contentId: "content", revision: 7, contentSha256: "a".repeat(64) });
const receipt = () => ({ artifact_id: "artifact", artifact_kind: "video", document_id: "document", project_id: "project", content_ref: "content",
  revision: 7, changed_fields: ["content_markdown", "items"], content_sha256: "a".repeat(64), edited_by_user_id: "owner", source_surface: "document-artifact-editor" });
const json = JSON.stringify;

test("current relationship permits Notes changes and a return to the original Notes value", () => {
  const before = original(), after = original(); after.items[0].notes = "Current Notes";
  const beforeRaw = json(before), currentRaw = json(after);
  assert.equal(content(beforeRaw, currentRaw), true);
  assert.equal(content(beforeRaw, beforeRaw), true, "positive revision may return to original Notes");
  assert.equal(json(before), beforeRaw); assert.equal(json(after), currentRaw);
  const reordered = Object.fromEntries(Object.entries(after).reverse());
  reordered.items[0] = Object.fromEntries(Object.entries(reordered.items[0]).reverse());
  assert.equal(content(beforeRaw, json(reordered)), true, "JSON member order is not a content edit");
});

for (const [name, change] of [
  ["title", value => { value.title += " changed"; }],
  ["summary", value => { value.summary += " changed"; }],
  ["markdown", value => { value.content_markdown += " changed"; }],
  ["item title", value => { value.items[0].title += " changed"; }],
  ["item body", value => { value.items[0].body += " changed"; }],
  ["image prompt", value => { value.items[0].image_prompt += " changed"; }],
  ["context IDs", value => { value.items[0].context_group_ids.push("another"); }],
  ["presentation", value => { value.presentation = {}; }],
  ["unknown root key", value => { value.unexpected = true; }],
  ["unknown item key", value => { value.items[0].media_url = "/api/media/other"; }],
  ["missing key", value => { delete value.summary; }],
  ["second item", value => { value.items.push({ ...value.items[0] }); }],
  ["no item", value => { value.items = []; }],
  ["missing Notes", value => { delete value.items[0].notes; }],
  ["null Notes", value => { value.items[0].notes = null; }],
  ["object Notes", value => { value.items[0].notes = { text: "notes" }; }],
]) test(`raw comparator refuses ${name} change even if Notes also change`, () => {
  const before = original(), after = original(); after.items[0].notes = "New notes"; change(after);
  assert.equal(content(json(before), json(after)), false);
  assert.equal(content(json(after), json(before)), false);
});

test("media revision presence is refused in both inputs, including identical null markers", () => {
  for (const key of ["video_revision", "audio_revision", "model3d_revision"]) for (const marker of [null, false, {}, { source: { revision: 0 } }]) {
    const value = original(); value[key] = marker;
    assert.equal(content(json(value), json(value)), false, `${key}:${json(marker)}`);
    assert.equal(content(json(original()), json(value)), false);
    assert.equal(content(json(value), json(original())), false);
  }
});

test("comparison retains unknown nested data instead of normalizing it away", () => {
  const before = original(); before.preserved = { values: [1, null, false, { notes: "Not the editable Notes" }] };
  const after = structuredClone(before); after.items[0].notes = "Allowed current Notes";
  assert.equal(content(json(before), json(after)), true, "pure equality does not confer native plan authority");
  after.preserved.values[3].notes = "Hidden change";
  assert.equal(content(json(before), json(after)), false);
  const special = json(original()).replace('"summary":"One clip"', '"summary":"One clip","__proto__":{"notes":"a"}');
  assert.equal(content(special, special.replace('"notes":"a"', '"notes":"b"')), false);
});

test("raw/Notes limits count UTF-8 bytes and bound both original and current", () => {
  const before = original(), after = original(); after.items[0].notes = "😀".repeat(20_000);
  assert.equal(content(json(before), json(after)), true);
  after.items[0].notes += "a"; assert.equal(content(json(before), json(after)), false);
  assert.equal(content(json(after), json(before)), false);
  for (const oversized of ["x".repeat(1_000_001), json({ text: "é".repeat(500_000) })]) {
    assert.equal(content(oversized, json(before)), false); assert.equal(content(json(before), oversized), false);
  }
  const bounded = original(); bounded.extra = "";
  bounded.extra = "x".repeat(1_000_000 - Buffer.byteLength(json(bounded)));
  assert.equal(Buffer.byteLength(json(bounded)), 1_000_000);
  assert.equal(content(json(bounded), json(bounded)), true);
  bounded.extra += "x"; assert.equal(content(json(bounded), json(bounded)), false);
});

test("raw parsing bounds nesting/nodes and refuses malformed/nonfinite data without coercion", () => {
  const deep = original(); let tail = deep;
  for (let i = 0; i < 65; i++) { tail.child = {}; tail = tail.child; }
  assert.equal(content(json(deep), json(deep)), false);
  const wide = original(); wide.extra = Array(100_000).fill(null);
  assert.equal(Buffer.byteLength(json(wide)) < 1_000_000, true);
  assert.equal(content(json(wide), json(wide)), false);
  const nonfinite = json(original()).replace('"summary":"One clip"', '"summary":1e999');
  assert.equal(content(nonfinite, nonfinite), false);
  let coerced = 0; const attacker = { toString() { coerced++; return json(original()); } };
  for (const bad of [null, undefined, original(), [], attacker, "{", "null", "[]", "true"]) {
    assert.equal(content(bad, json(original())), false); assert.equal(content(json(original()), bad), false);
  }
  assert.equal(coerced, 0);
});

test("duplicate decoded JSON keys cannot conceal root, nested or receipt differences", () => {
  const before = json(original());
  for (const after of [
    before.replace('"title":"Native original"', '"title":"hidden","title":"Native original"'),
    before.replace('"title":"Native original"', '"title":"hidden","ti\\u0074le":"Native original"'),
    before.replace('"body":"Unchanged clip description"', '"body":"hidden","body":"Unchanged clip description"'),
    before.replace('"notes":"Original notes"', '"notes":"hidden","notes":"Current Notes"'),
    before.replace('"context_group_ids":["context"]', '"context_group_ids":[],"context_group_ids":["context"]'),
  ]) {
    assert.equal(content(before, after), false); assert.equal(content(after, before), false);
    assert.equal(content(after, after), false);
  }
  for (const after of [json(receipt()).replace('"revision":7', '"revision":8,"revision":7'),
    json(receipt()).replace('"source_surface":', '"source_surface":"document-artifact-history","source\\u005fsurface":')])
    assert.equal(edit(after, identity()), false);
});

test("numeric spelling/precision cannot collapse a non-Notes JSON difference", () => {
  const withNumber = token => json(original()).replace('"presentation":null', `"presentation":null,"number":${token}`);
  for (const token of ["9007199254740992", "9007199254740993", "1e400", "1e-400", "0.10000000000000001", "-0", "1.0", "1e0", "01", "+1"])
    assert.equal(content(withNumber(token), withNumber(token)), false, token);
  assert.equal(content(withNumber("9007199254740992"), withNumber("9007199254740993")), false);
  assert.equal(content(withNumber("0.1"), withNumber("0.10000000000000001")), false);
  for (const number of [0, -1, 0.1, 1e-7, 5e-324, Number.MAX_SAFE_INTEGER])
    assert.equal(content(withNumber(json(number)), withNumber(json(number))), true, String(number));
  assert.equal(edit(json(receipt()).replace('"revision":7', '"revision":7.0000000000000001'), identity()), false);
});

test("JSON lexical validation preserves valid escapes and refuses invalid grammar", () => {
  const before = json(original());
  const escaped = String.raw`"notes":"Escaped \"quote\" and \\ slash and \u263a"`;
  assert.equal(content(before, before.replace('"notes":"Original notes"', escaped)), true);
  assert.equal(content(` \n${before}\t `, before), true);
  for (const raw of ['{"items":[{"notes":"a"},]}', '{"items":[{"notes":"a"}],}', '{"items" [{"notes":"a"}]}',
    '{"items":[{"notes":"\\x"}]}', '{"items":[{"notes":"line\nbreak"}]}', `${before} null`])
    assert.equal(content(raw, raw), false);
});

test("direct editor grammar binds exact current positive identity and permits arbitrary admitted revision", () => {
  for (const revision of [1, 2, 7, 500, Number.MAX_SAFE_INTEGER]) {
    assert.equal(edit(json({ ...receipt(), revision }), { ...identity(), revision }), true,
      "native custody separately constrains actual contiguous history");
  }
  assert.equal(edit(json(receipt()), identity()), true);
  for (const field of ["artifact_id", "artifact_kind", "document_id", "project_id", "content_ref", "content_sha256", "edited_by_user_id", "source_surface"])
    assert.equal(edit(json({ ...receipt(), [field]: "other" }), identity()), false, field);
  assert.equal(edit(json({ ...receipt(), revision: 6 }), identity()), false);
});

test("direct editor exact fields refuse transition, cross-kind and concealed metadata", () => {
  for (const key of ["video_revision", "audio_revision", "model3d_revision", "revision_action", "restored_from_revision",
    "video_trim_request_sha256", "audio_trim_request_sha256", "model3d_scale_request_sha256", "sponsor", "workflow", "replacement", "unknown"]) {
    for (const value of [null, {}, "x"]) assert.equal(edit(json({ ...receipt(), [key]: value }), identity()), false, key);
  }
  for (const key of Object.keys(receipt())) {
    const value = receipt(); delete value[key]; assert.equal(edit(json(value), identity()), false, key);
  }
  for (const changed_fields of [["notes"], ["content_markdown"], ["items", "content_markdown"], ["content_markdown", "items", "notes"],
    ["content_markdown", "content_markdown"], null, "items"])
    assert.equal(edit(json({ ...receipt(), changed_fields }), identity()), false);
});

test("identity captures only data fields and does not execute getters or serialization hooks", () => {
  let getters = 0;
  const accessor = identity(); Object.defineProperty(accessor, "revision", { enumerable: true, get() { getters++; return 7; } });
  const symbol = identity(); symbol[Symbol("extra")] = true;
  const hidden = identity(); Object.defineProperty(hidden, "hidden", { value: true });
  const exotic = Object.assign(new Date(), identity());
  const inherited = Object.assign(Object.create({ inherited: true }), identity());
  const trap = new Proxy(identity(), { ownKeys() { throw Error("proxy trap"); } });
  for (const candidate of [accessor, symbol, hidden, exotic, inherited, trap, null, {}, { ...identity(), extra: true }])
    assert.equal(edit(json(receipt()), candidate), false);
  assert.equal(getters, 0);
  assert.equal(edit(json(receipt()), Object.assign(Object.create(null), identity())), true);
  for (const revision of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "7"])
    assert.equal(edit(json({ ...receipt(), revision }), { ...identity(), revision }), false);
  for (const update of [{ ownerId: "" }, { ownerId: "has space" }, { documentId: "x".repeat(161) }, { contentSha256: "A".repeat(64) }])
    assert.equal(edit(json(receipt()), { ...identity(), ...update }), false);
});

test("private receipt is bounded raw JSON only, not a caller object or capability", () => {
  assert.equal(edit(receipt(), identity()), false);
  assert.equal(edit(json({ ...receipt(), extra: "x".repeat(1_048_576) }), identity()), false);
  assert.equal(edit("null", identity()), false);
  assert.equal(edit("{", identity()), false);
});
