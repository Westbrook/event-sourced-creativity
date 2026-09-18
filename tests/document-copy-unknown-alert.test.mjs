import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// Reuse the actual complete extracted copy UI/Store methods. Transport failures
// here are named deterministic ports; real Worker/erasure proof lives in the
// existing erasure tests. This does not certify native rendering or AT speech.
const originalURL = new URL("./document-copy-ui.test.mjs", import.meta.url);
const original = readFileSync(originalURL, "utf8"), cut = original.indexOf('\ntest("the real copy handler');
assert.ok(cut > 0);
const virtualURL = new URL("./_ram_copy_unknown_alert_fixture.mjs", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) { return specifier === virtualURL.href ? { url: virtualURL.href, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === virtualURL.href ? { format: "module", source: original.slice(0, cut) + "\nexport { fixture, flatten, copyModel };", shortCircuit: true } : next(url, context); },
});
const { fixture, flatten, copyModel } = await import(virtualURL.href).finally(() => hook.deregister());
const ambient = ["HTMLElement", "customElements"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => true, define() {} };
after(() => { for (const [key, descriptor] of ambient) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
const { FORMA_DEFAULT_MESSAGES } = await import("../src/components/design-system/localization.ts");
const catalogs = { en: FORMA_DEFAULT_MESSAGES };
for (const locale of ["fr", "ar", "ja"]) catalogs[locale] = (await import("../src/components/design-system/locales/" + locale + ".ts")).default;
const scenarios = ["unknown-known", "unknown-op-only", "unsubmitted-stale", "applying", "retained-uncertain", "applied-refresh", "rights-existing"];
const text = value => value.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
const alerts = markup => [...markup.matchAll(/<p\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/p>/gu)].map(match => text(match[1]));
const buttons = markup => [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gu)].map(match => text(match[1]));

for (const locale of ["en", "fr", "ar", "ja"]) for (const scenario of scenarios) {
  test("copy recovery alert names a current state without inventing actions: " + locale + "/" + scenario, async t => {
    const f = fixture(), messages = catalogs[locale];
    assert.equal(typeof f.store.route.get, "function", "reuse the current explicit route Signal port");
    f.host.i18n.t = (key, fallback = key, values = {}) => Object.entries(values).reduce(
      (value, [name, replacement]) => value.replaceAll("{" + name + "}", String(replacement)), messages[key] ?? fallback);
    let original;
    if (scenario === "unknown-op-only") {
      await f.host._beginDuplicate(f.target.documentId); f.host._title = "Original unconfirmed preview · " + locale;
      f.controls.losePreview = true; await f.host._createDocument({ preventDefault() {} });
      original = f.store.documentCopyReview(f.target);
      assert.equal(original.phase, "uncertain"); assert.equal(original.previewId, ""); assert.ok(original.operationId);
    } else original = await f.review();
    if (scenario === "unknown-known") {
      f.controls.response = async () => { throw new Error("named loss of the submitted copy response"); };
      await f.host._applyCopy(); assert.equal(f.store.documentCopyReview(f.target).commitSubmitted, true);
    }
    if (scenario.startsWith("unknown-")) {
      // First, unflagged exact recovery denial: the later explicit C repair may
      // offer guarded adjudication, but this test invents no such certificate.
      f.controls.response = async () => new Response(JSON.stringify({ error: "authoring_preview_unavailable" }), { status: 403 });
      await f.host._checkCopy();
    } else if (scenario === "unsubmitted-stale") {
      f.controls.stale = true; await f.host._checkCopy();
    } else if (scenario === "applying") {
      f.controls.applying = true; await f.host._applyCopy();
    } else if (scenario === "retained-uncertain") {
      f.controls.loseApply = true; await f.host._applyCopy();
    } else if (scenario === "applied-refresh") {
      f.controls.refreshFail = true; await f.host._applyCopy();
    } else if (scenario === "rights-existing") {
      // Existing typed presentation-error control, not a claim that a real
      // source-rights endpoint disclosed this private response shape.
      const key = copyModel.documentCopyKey(f.target), owned = f.store.documentCopyReviews.get()[key];
      f.store.documentCopyReviews.set({ [key]: { ...owned, phase: "unavailable", preview: null, intent: null,
        stale: true, issue: "authoring_source_rights_invalid" } });
    }
    const state = f.store.documentCopyReview(f.target), beforeRender = structuredClone(f.requests);
    const markup = flatten(f.host._copyDialog()), actual = alerts(markup), visible = buttons(markup);
    assert.equal(f.store.documentCopyAccess(f.target).canRead, true); assert.equal(f.store.documentCopyAccess(f.target).canAuthor, true);
    assert.equal(state.operationId, original.operationId); assert.equal(state.previewId, original.previewId); assert.equal(state.approvalHash, original.approvalHash);
    assert.deepEqual(f.requests, beforeRender, "copy-only presentation performs no request");
    assert.equal(visible.includes(messages["document.copy.apply"]), false);
    assert.ok(visible.includes(messages["document.copy.check"]), "the existing exact recovery remains available");
    if (scenario.startsWith("unknown-")) {
      assert.equal(state.preview, null); assert.equal(state.intent, null); assert.equal(state.receipt, null);
      assert.equal(state.issue, "document_copy_unavailable"); assert.equal(state.stale, true);
      assert.equal(state.phase, scenario === "unknown-known" ? "uncertain" : "unavailable");
      assert.equal(visible.includes(messages["document.copy.discard"]), false, "first unknown read grants no completion authority");
    } else if (scenario === "unsubmitted-stale") {
      assert.equal(state.phase, "review"); assert.equal(state.commitSubmitted, false);
      assert.ok(visible.includes(messages["document.copy.discard"])); assert.ok(state.preview);
    } else if (scenario === "applying") assert.equal(state.phase, "applying");
    else if (scenario === "retained-uncertain") { assert.equal(state.phase, "uncertain"); assert.ok(state.preview); }
    else if (scenario === "rights-existing") { assert.equal(state.phase, "unavailable"); assert.equal(state.preview, null); }
    else { assert.equal(state.phase, "applied"); assert.ok(state.receipt); assert.ok(visible.includes(messages["context.changes.done"])); }
    const key = ({ "unknown-known": "document.copy.uncertain", "unknown-op-only": "document.copy.unavailable",
      "unsubmitted-stale": "document.copy.stale", "retained-uncertain": "document.copy.uncertain", "applied-refresh": "document.copy.refresh", "rights-existing": "document.copy.rights" })[scenario];
    t.diagnostic(JSON.stringify({ locale, scenario, phase: state.phase, submitted: state.commitSubmitted, alerts: actual, buttons: visible, requestActions: f.requests.map(row => row.action) }));
    if (key) {
      assert.notEqual(messages[key], undefined, "existing exact localized catalog entry");
      assert.deepEqual(actual, [messages[key]], "private unknown recovery must not suggest an unavailable discard or imply known completion");
    } else assert.deepEqual(actual, [], "known applying status does not acquire an unrelated alert");
    if (scenario.startsWith("unknown-")) assert.equal(actual.includes(messages["document.copy.stale"]), false);
  });
}
