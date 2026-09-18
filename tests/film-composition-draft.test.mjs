import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createFilmCompositionDraft, isFilmCompositionDraftAsset } from "../src/model/film-composition-draft.ts";
import { ownedSocialVideo } from "./output-social-asset-fixtures.mjs";

// NEW pure-controller controls with real owned synthetic AVC bytes and the real
// inspector/composer. No Store, provider, upload, acceptance or playback claim.
const SOURCE = ownedSocialVideo("16:9"), sourceRevision = "a".repeat(64);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function asset(id, bytes = SOURCE) {
  const sha256 = digest(bytes);
  return { id, name: `${id}.mp4`, mimeType: "video/mp4", mediaKind: "video", byteLength: bytes.length, sha256,
    sourceDigest: sourceRevision, createdByUserId: "local-author", createdAt: "2026-09-10T00:00:00.000Z",
    available: true, downloadUrl: `/api/output-requirements/assets/${encodeURIComponent(id)}?documentId=film-draft-document`,
    inspection: { status: "inspected", kind: "video", mimeType: "video/mp4", extension: "mp4", byteLength: bytes.length,
      sha256, facts: { durationSeconds: 2 }, checks: [], limitations: [], limitationCodes: [], errors: [] } };
}
function input(overrides = {}) {
  return { context: { documentId: "film-draft-document", targetId: "target:local-film", sourceRevision,
    contractKey: "explicit-authorized-source-plan-target-contract", durationSeconds: 4 }, ready: true,
    assets: [asset("asset:first"), asset("asset:second")], current: () => true,
    download: async () => new Blob([SOURCE], { type: "video/mp4" }), ...overrides };
}
function select(draft, ids = ["asset:first", "asset:second"]) {
  assert.ok(draft); for (const id of ids) assert.equal(draft.add(id), true);
  assert.equal(draft.setRightsConfirmed(true), true);
}
function gate(t) {
  let release, enter;
  const wait = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { enter = resolve; });
  t.after(() => release());
  return { wait, entered, enter, release };
}
function holdDigest(t, predicate) {
  const held = gate(t), original = crypto.subtle.digest.bind(crypto.subtle);
  let count = 0;
  t.mock.method(crypto.subtle, "digest", async (algorithm, bytes) => {
    count++;
    if (predicate(bytes, count)) { held.enter(); await held.wait; }
    return original(algorithm, bytes);
  });
  return held;
}

// An assertion thrown inside an operation can be converted into a refusal.
// The sticky ledger makes any unexpected network dispatch independently fail.
let fetchAttempts = 0;
const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { fetchAttempts++; throw new Error("film_draft_network_forbidden"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(fetchAttempts, 0); });

test("draft captures immutable own-data metadata and refuses unready, malformed or mismatched asset custody", () => {
  let getterReads = 0;
  const accessor = input(); Object.defineProperty(accessor.assets[0], "sha256", { enumerable: true, get() { getterReads++; return digest(SOURCE); } });
  assert.equal(createFilmCompositionDraft(accessor), null); assert.equal(getterReads, 0);
  assert.equal(isFilmCompositionDraftAsset(accessor.assets[0], accessor.context), false); assert.equal(getterReads, 0);
  assert.equal(isFilmCompositionDraftAsset(asset("eligible"), input().context), true);
  const mixed = input(); mixed.assets[0].available = false;
  assert.deepEqual(mixed.assets.filter(row => isFilmCompositionDraftAsset(row, mixed.context)).map(row => row.id), ["asset:second"]);
  assert.equal(createFilmCompositionDraft(mixed), null);
  const indexed = input(); Object.defineProperty(indexed.assets, "0", { get() { getterReads++; return asset("getter"); } });
  assert.equal(createFilmCompositionDraft(indexed), null); assert.equal(getterReads, 0);
  for (const mutate of [
    value => { value.ready = false; }, value => { value.current = () => false; }, value => { value.current = () => { throw new Error("retired"); }; },
    value => { value.context.durationSeconds = NaN; }, value => { value.context.contractKey = ""; },
    value => { value.assets[1].id = value.assets[0].id; }, value => { value.assets[0].available = false; },
    value => { value.assets[0].sourceDigest = "b".repeat(64); }, value => { value.assets[0].inspection.sha256 = "b".repeat(64); },
    value => { value.assets[0].inspection.byteLength++; }, value => { value.assets[0].inspection.status = "unsupported"; },
    value => { value.assets[0].mimeType = "video/webm"; }, value => { value.assets[0].downloadUrl = "https://provider.invalid/clip.mp4"; },
    value => { value.assets[0].downloadUrl += "&documentId=foreign"; },
    value => { value.assets[0].byteLength = value.assets[0].inspection.byteLength = 24_000_001; },
  ]) { const value = input(); mutate(value); assert.equal(createFilmCompositionDraft(value), null); }
  const value = input(), draft = createFilmCompositionDraft(value); assert.ok(draft);
  value.assets[0].name = "replaced"; value.assets[0].sha256 = "b".repeat(64); value.assets.reverse(); value.context.durationSeconds = 99;
  const snapshot = draft.snapshot(); assert.equal(snapshot.choices[0].name, "asset:first.mp4");
  assert.deepEqual(snapshot.choices.map(row => row.id), ["asset:first", "asset:second"]);
  assert.equal(Object.isFrozen(snapshot), true); assert.equal(Object.isFrozen(snapshot.choices), true); assert.equal(Object.isFrozen(snapshot.choices[0]), true);
  assert.throws(() => snapshot.choices[0].name = "mutation", TypeError);
  assert.deepEqual(Object.keys(snapshot.choices[0]).sort(), ["byteLength", "durationSeconds", "id", "name"]);
  draft.retire(); assert.deepEqual(draft.snapshot().choices, []);
});

test("explicit unique order and renewed rights produce actual bytes; File copy survives draft retirement", async () => {
  const reads = [], options = input({ assets: [asset("first"), asset("second"), asset("third")], download: async (row, signal) => {
    reads.push(row.id); assert.equal(Object.isFrozen(row), true); assert.equal(signal.aborted, false); return new Blob([SOURCE]);
  } });
  const draft = createFilmCompositionDraft(options); assert.ok(draft);
  assert.deepEqual(await draft.prepare(), { status: "refused", reason: "rights" });
  draft.setRightsConfirmed(true); assert.deepEqual(await draft.prepare(), { status: "refused", reason: "selection" });
  assert.equal(draft.add("first"), true); assert.equal(draft.add("first"), false); assert.equal(draft.add("unknown"), false);
  assert.equal(draft.add("second"), true); assert.equal(draft.add("third"), true); draft.setRightsConfirmed(true);
  assert.equal(draft.remove("second"), true); assert.equal(draft.snapshot().rightsConfirmed, false);
  assert.equal(draft.move("third", -1), true); assert.equal(draft.move("third", -1), false);
  assert.deepEqual(draft.snapshot().selectedIds, ["third", "first"]); assert.deepEqual(reads, []);
  options.context.durationSeconds = 99; options.assets[2].downloadUrl = "https://foreign.invalid"; options.assets[2].sha256 = "b".repeat(64);
  draft.setRightsConfirmed(true); const result = await draft.prepare(); assert.equal(result.status, "prepared");
  assert.deepEqual(reads, ["third", "first"]); assert.deepEqual(result.selectedAssetIds, ["third", "first"]);
  assert.equal(result.current(), true); assert.equal(result.film.info.durationSeconds, 4); assert.equal(result.film.info.sampleCount, 8);
  assert.equal(result.film.sha256, digest(result.film.bytes)); assert.equal(draft.snapshot().status, "prepared");
  const file = new File([result.film.bytes], "local-film.mp4", { type: "video/mp4" }), sha256 = result.film.sha256;
  draft.retire(); assert.equal(result.current(), false); assert.equal(result.film.bytes.every(byte => byte === 0), true);
  assert.equal(digest(new Uint8Array(await file.arrayBuffer())), sha256);
  assert.deepEqual(draft.snapshot().selectedIds, []); assert.equal(draft.snapshot().rightsConfirmed, false);
});

test("empty and single choices render while preparation, selection count and aggregate source bytes stay bounded", async () => {
  let reads = 0;
  for (const assets of [[], [asset("single")]]) {
    const small = createFilmCompositionDraft(input({ assets, download: async () => { reads++; return new Blob([SOURCE]); } }));
    assert.ok(small); assert.deepEqual(small.snapshot().choices.map(row => row.id), assets.map(row => row.id));
    for (const row of assets) assert.equal(small.add(row.id), true);
    small.setRightsConfirmed(true); assert.deepEqual(await small.prepare(), { status: "refused", reason: "selection" }); small.retire();
  }
  assert.equal(reads, 0);
  assert.equal(createFilmCompositionDraft(input({ assets: Array.from({ length: 257 }, (_, index) => asset(`choice-${index}`)) })), null);
  const draft = createFilmCompositionDraft(input({ assets: Array.from({ length: 33 }, (_, index) => asset(`asset-${index}`)) }));
  assert.ok(draft); for (let index = 0; index < 32; index++) assert.equal(draft.add(`asset-${index}`), true);
  assert.equal(draft.add("asset-32"), false); assert.equal(draft.snapshot().reason, "selection"); draft.retire();
  const options = input(); for (const row of options.assets) row.byteLength = row.inspection.byteLength = 12_000_001;
  const bounded = createFilmCompositionDraft(options); assert.ok(bounded);
  assert.equal(bounded.add("asset:first"), true); assert.equal(bounded.add("asset:second"), false);
  assert.equal(bounded.snapshot().reason, "bytes"); bounded.retire();
});

test("download size, hash, actual container, exact duration and codec compatibility are checked", async () => {
  const corrupted = SOURCE.slice(); corrupted[corrupted.length - 1] ^= 1;
  const unsupported = new Uint8Array(SOURCE.length).fill(7), square = ownedSocialVideo("1:1");
  const cases = [
    [input({ download: async () => null }), "unavailable"],
    [input({ download: async () => new Blob([SOURCE.subarray(1)]) }), "bytes"],
    [input({ download: async () => new Blob([corrupted]) }), "bytes"],
    [input({ assets: [asset("asset:first", unsupported), asset("asset:second", unsupported)], download: async () => new Blob([unsupported]) }), "unsupported"],
    [input({ context: { ...input().context, durationSeconds: 3 } }), "duration"],
    [input({ assets: [asset("asset:first"), asset("asset:second", square)], download: async row => new Blob([row.id === "asset:first" ? SOURCE : square]) }), "unsupported"],
  ];
  for (const [options, reason] of cases) {
    const draft = createFilmCompositionDraft(options); select(draft);
    const result = await draft.prepare(); assert.deepEqual(result, { status: "refused", reason });
    assert.equal(draft.snapshot().status, "idle"); draft.retire();
  }
});

test("editing during download aborts the old selection; duplicate prepare cannot start a second operation", { timeout: 10000 }, async t => {
  const held = gate(t); let requests = 0, firstSignal;
  const draft = createFilmCompositionDraft(input({ download: async (_row, signal) => {
    requests++; if (requests === 1) { firstSignal = signal; held.enter(); await held.wait; }
    return new Blob([SOURCE]);
  } })); select(draft);
  const pending = draft.prepare(); t.after(async () => { held.release(); await pending; draft.retire(); }); await held.entered;
  assert.deepEqual(await draft.prepare(), { status: "refused", reason: "unavailable" }); assert.equal(requests, 1);
  assert.equal(firstSignal.aborted, false); assert.equal(draft.move("asset:second", -1), true);
  assert.equal(firstSignal.aborted, true); assert.equal(draft.snapshot().rightsConfirmed, false);
  held.release(); assert.deepEqual(await pending, { status: "superseded", reason: "superseded" }); assert.equal(requests, 1);
  draft.setRightsConfirmed(true); const retry = await draft.prepare(); assert.equal(retry.status, "prepared");
  assert.deepEqual(retry.selectedAssetIds, ["asset:second", "asset:first"]); assert.equal(requests, 3);
});

test("withdrawn host ownership during download retires permanently and never reads the next clip", { timeout: 10000 }, async t => {
  const held = gate(t); let active = true, requests = 0, signal;
  const draft = createFilmCompositionDraft(input({ current: () => active, download: async (_row, value) => {
    signal = value; requests++; held.enter(); await held.wait; return new Blob([SOURCE]);
  } })); select(draft);
  const pending = draft.prepare(); t.after(async () => { held.release(); await pending; draft.retire(); }); await held.entered;
  active = false; held.release(); assert.deepEqual(await pending, { status: "superseded", reason: "superseded" });
  assert.equal(signal.aborted, true); assert.equal(requests, 1); active = true;
  assert.equal(draft.snapshot().status, "retired"); assert.deepEqual(draft.snapshot().choices, []);
  assert.deepEqual(await draft.prepare(), { status: "superseded", reason: "superseded" });
});

test("host withdrawal during the actual downloaded-byte hash suppresses inspection and publication", { timeout: 10000 }, async t => {
  const held = holdDigest(t, (_bytes, count) => count === 1); let active = true, requests = 0;
  const draft = createFilmCompositionDraft(input({ current: () => active, download: async () => { requests++; return new Blob([SOURCE]); } })); select(draft);
  const pending = draft.prepare(); t.after(async () => { held.release(); await pending; draft.retire(); });
  await Promise.race([held.entered, pending.then(() => assert.fail("Expected the real hash boundary"))]);
  active = false; held.release(); assert.deepEqual(await pending, { status: "superseded", reason: "superseded" });
  assert.equal(requests, 1); assert.equal(draft.snapshot().status, "retired");
});

test("host withdrawal during a Blob read clears its completed bytes before refusing the stale draft", { timeout: 10000 }, async t => {
  const held = gate(t), original = Blob.prototype.arrayBuffer; let active = true, completed, reads = 0;
  t.mock.method(Blob.prototype, "arrayBuffer", async function () {
    const buffer = await original.call(this); completed = new Uint8Array(buffer); held.enter(); await held.wait; return buffer;
  });
  const draft = createFilmCompositionDraft(input({ current: () => active, download: async () => { reads++; return new Blob([SOURCE]); } })); select(draft);
  const pending = draft.prepare(); t.after(async () => { held.release(); await pending; draft.retire(); });
  await Promise.race([held.entered, pending.then(() => assert.fail("Expected the real Blob read boundary"))]);
  assert.equal(digest(completed), digest(SOURCE)); active = false; held.release();
  assert.deepEqual(await pending, { status: "superseded", reason: "superseded" });
  assert.equal(completed.every(byte => byte === 0), true); assert.equal(reads, 1); assert.equal(draft.snapshot().status, "retired");
});

test("host withdrawal during the actual composed output hash suppresses the completed film", { timeout: 10000 }, async t => {
  // Both source buffers are1513 bytes. A larger digest input is the real remuxed
  // output inspection, so this hold occurs inside composeFilmClips without replacing it.
  const held = holdDigest(t, bytes => bytes.byteLength > SOURCE.byteLength); let active = true, requests = 0;
  const draft = createFilmCompositionDraft(input({ current: () => active, download: async () => { requests++; return new Blob([SOURCE]); } })); select(draft);
  const pending = draft.prepare(); t.after(async () => { held.release(); await pending; draft.retire(); });
  await Promise.race([held.entered, pending.then(() => assert.fail("Expected actual composed-output inspection"))]);
  assert.equal(requests, 2); active = false; held.release();
  assert.deepEqual(await pending, { status: "superseded", reason: "superseded" }); assert.equal(draft.snapshot().status, "retired");
});

test("rights withdrawal invalidates an already prepared result without a new read or upload", async () => {
  let requests = 0;
  const draft = createFilmCompositionDraft(input({ download: async () => { requests++; return new Blob([SOURCE]); } })); select(draft);
  const result = await draft.prepare(); assert.equal(result.status, "prepared"); assert.equal(result.current(), true);
  draft.setRightsConfirmed(false); assert.equal(result.current(), false); assert.equal(result.film.bytes.every(byte => byte === 0), true);
  assert.deepEqual(await draft.prepare(), { status: "refused", reason: "rights" }); assert.equal(requests, 2); draft.retire();
});
