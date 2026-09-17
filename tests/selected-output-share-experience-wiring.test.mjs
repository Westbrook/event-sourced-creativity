import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { parseSelectedOutputShareSelection } from "../src/model/selected-output-share.ts";

const source = readFileSync(new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
const begin = source.indexOf("  #shareSource?:"), end = source.indexOf("  #resultReadStage?:", begin);
assert.ok(begin >= 0 && end > begin, "exact new host sharing lifetime members");
// Execute the complete actual sharing members. Only private names become public
// for fixture setup; source/reader/generation logic is neither stubbed into this
// fragment nor claimed as full browser/host acceptance.
const SharingHost = new Function("parseSelectedOutputShareSelection", stripTypeScriptTypes(
  "class SharingHost {" + source.slice(begin, end).replaceAll("#", "") + "}") + ";return SharingHost;")(parseSelectedOutputShareSelection);
function fixture(output = "short_story") {
  const host = new SharingHost(), native = { documentId: "doc", artifactId: "artifact", revision: output === "scene" ? 0 : 3, contentSha256: "a".repeat(64) };
  let visible = true, current = true;
  const result = { output, candidate: { artifactId: "artifact" }, current: () => current,
    ...(output === "short_story" ? { story: { selection: native } } : output === "scene" ? { scene: { content: { selection: {
      ...native, screenplaySha256: "b".repeat(64), bodySha256: "c".repeat(64),
      displaySource: { characters: [{ id: "A", name: "One" }, { id: "B", name: "Two" }], location: "Library" }, expiresAt: "2099-01-01T00:00:00.000Z",
    } } } }
      : output === "slides" ? { slides: { selection: native } } : {}) };
  const binding = { plan: { documentId: "doc" } };
  Object.assign(host, { result, binding, busy: false, loading: false, visible: () => visible });
  return { host, native, result, binding, hide: () => { visible = false; }, show: () => { visible = true; }, stale: () => { current = false; }, restore: () => { current = true; } };
}

for (const output of ["short_story", "scene", "slides"]) test(output + " sharing pins the exact retained revision/hash and preserves a live source across rerenders", () => {
  const f = fixture(output), lease = f.host.selectedShareSource(f.result, f.binding);
  assert.deepEqual(lease.selection, { ...f.native, output });
  assert.notEqual(lease.selection, f.native); assert.ok(Object.isFrozen(lease)); assert.ok(Object.isFrozen(lease.selection));
  assert.equal(lease.isCurrent(), true); assert.equal(lease.signal.aborted, false);
  assert.equal(f.host.selectedShareSource(f.result, f.binding), lease, "a locale/render update preserves this source");
});

for (const reason of ["hidden", "source", "busy", "loading", "replacement", "binding"]) test("sharing retires synchronously for " + reason + " and cannot revive A after B", () => {
  const f = fixture("slides"), lease = f.host.selectedShareSource(f.result, f.binding);
  let aborts = 0; lease.signal.addEventListener("abort", () => aborts++);
  if (reason === "hidden") f.hide();
  if (reason === "source") f.stale();
  if (reason === "busy") f.host.busy = true;
  if (reason === "loading") f.host.loading = true;
  if (reason === "replacement") f.host.result = { ...f.result };
  if (reason === "binding") f.host.binding = { ...f.binding };
  f.host.shareSync();
  assert.equal(lease.signal.aborted, true); assert.equal(lease.isCurrent(), false); assert.equal(aborts, 1);
  f.show(); f.restore(); Object.assign(f.host, { busy: false, loading: false, result: f.result, binding: f.binding });
  assert.equal(f.host.selectedShareSource(f.result, f.binding), null);
  const fresh = { ...f.result }; f.host.result = fresh;
  const next = f.host.selectedShareSource(fresh, f.binding);
  assert.ok(next); assert.notEqual(next, lease); assert.equal(next.isCurrent(), true); assert.equal(aborts, 1);
});

test("authorization/source retirement aborts immediately without requiring session publication", () => {
  const f = fixture(), lease = f.host.selectedShareSource(f.result, f.binding);
  f.host.shareWithdraw(); assert.equal(lease.signal.aborted, true); assert.equal(lease.isCurrent(), false);
  assert.equal(f.host.selectedShareSource(f.result, f.binding), null);
  for (const type of ["forma-authorization-changed", "forma-event-source-retired"]) {
    assert.ok(source.includes(`addEventListener("${type}", this.#shareWithdraw)`));
    assert.ok(source.includes(`removeEventListener("${type}", this.#shareWithdraw)`));
  }
  assert.match(source, /this\.#shareUnsubscribe = this\.store\.subscribe\(this\.#shareSync\)/u);
  assert.match(source, /this\.#shareUnsubscribe\?\.\(\); this\.#shareUnsubscribe = undefined/u);
});

test("unsupported output kinds and changed exact native identity do not mount a sharing source", () => {
  for (const output of ["image", "storyboard", "audio", "video", "model3d"]) {
    const f = fixture(output); assert.equal(f.host.selectedShareSource(f.result, f.binding), null);
  }
  for (const edit of [native => native.documentId = "foreign", native => native.artifactId = "foreign",
    native => native.contentSha256 = "invalid", native => native.revision = -1]) {
    const f = fixture(); edit(f.native); assert.equal(f.host.selectedShareSource(f.result, f.binding), null);
  }
});

test("result clearing aborts the share before private result cleanup and host rendering uses only that source", () => {
  const start = source.indexOf("  #clearResult() {"), stop = source.indexOf("  #storySync =", start);
  const method = stripTypeScriptTypes(source.slice(start, stop).replace("#clearResult", "function clearResult").replaceAll("this.#", "this."));
  const clear = new Function(method + ";return clearResult;")(), f = fixture(), lease = f.host.selectedShareSource(f.result, f.binding), steps = [];
  lease.signal.addEventListener("abort", () => steps.push("share aborted"));
  Object.assign(f.host, { reader: { abort() { steps.push("reader aborted"); } }, querySelectorAll() { return []; } });
  clear.call(f.host);
  assert.deepEqual(steps, ["share aborted", "reader aborted"]); assert.equal(lease.isCurrent(), false); assert.equal(f.host.result, undefined);
  assert.match(source, /const shareSource = this\.#selectedShareSource\(result, binding\)/u);
  assert.match(source, /shareSource \? html`<forma-selected-output-share-review \.source=\$\{shareSource\} \.enabled=\$\{true\}/u);
});
