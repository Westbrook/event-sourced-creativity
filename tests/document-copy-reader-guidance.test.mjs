import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// Reuse the existing complete extracted production copy UI/Store fixture.
// These are rendering/permission tests with deterministic native/network ports,
// not full-Worker erasure, real-browser focus, physical keyboard or AT evidence.
const sourceURL = new URL("./document-copy-ui.test.mjs", import.meta.url);
const source = readFileSync(sourceURL, "utf8");
const cut = source.indexOf('\ntest("the real copy handler');
assert.ok(cut > 0, "existing production-method fixture boundary");
const fixtureURL = new URL("./_ram_copy_reader_guidance_fixture.mjs", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === fixtureURL.href ? { url: fixtureURL.href, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === fixtureURL.href ? { format: "module", source: source.slice(0, cut) + "\nexport { fixture, flatten, copyModel };", shortCircuit: true }
      : next(url, context);
  },
});
const { fixture, flatten, copyModel } = await import(fixtureURL.href).finally(() => hook.deregister());
const ambient = ["HTMLElement", "customElements"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => true, define() {} };
after(() => { for (const [key, descriptor] of ambient) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
const { FORMA_DEFAULT_MESSAGES } = await import("../src/components/design-system/localization.ts");
const catalogs = { en: FORMA_DEFAULT_MESSAGES };
for (const locale of ["fr", "ar", "ja"]) catalogs[locale] = (await import("../src/components/design-system/locales/" + locale + ".ts")).default;
const cases = ["review", "applying", "uncertain", "applied", "retired"];
const text = markup => markup.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
const paragraphs = markup => [...markup.matchAll(/<p\b[^>]*role="status"[^>]*>([\s\S]*?)<\/p>/gu)].map(match => text(match[1]));
const buttons = markup => [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gu)].map(match => text(match[1]));

for (const locale of ["en", "fr", "ar", "ja"]) for (const author of [true, false]) for (const phase of cases) {
  test("saved copy guidance follows current reader/author access and exact phase: " + [locale, author ? "author" : "reader", phase].join("/"), async t => {
    const f = fixture(), messages = catalogs[locale];
    // Older extracted fixture lacks navigation; reuse a provided route Signal
    // or supply only its stable route port. No production method is replaced.
    f.store.route ??= { get: () => "/studio/project" };
    f.host.i18n.t = (key, fallback = key, values = {}) => Object.entries(values).reduce(
      (value, [name, replacement]) => value.replaceAll("{" + name + "}", String(replacement)), messages[key] ?? fallback);
    f.host.i18n.number = value => new Intl.NumberFormat(locale).format(value);
    const original = await f.review(), originalEvents = JSON.stringify(original.preview.events);
    if (phase === "applying") { f.controls.applying = true; await f.host._applyCopy(); }
    if (phase === "uncertain") { f.controls.loseApply = true; await f.host._applyCopy(); }
    if (phase === "applied") await f.host._applyCopy();
    if (!author) f.state.session.capabilities = ["project.read"];
    if (phase === "retired") {
      // A model-admitted, typed server-envelope fixture; this test does not
      // claim that the simulated gateway performed actual storage erasure.
      const key = copyModel.documentCopyKey(f.target), saved = f.store.documentCopyReviews.get()[key];
      const previewId = "copy-preview-" + "c".repeat(64), actorUserId = f.state.session.user.userId;
      const envelope = { status: "retired", operationId: saved.operationId, previewId,
        retirement: { version: "document-copy-erased-operation-v1", meaning: "globally-erased-unapplied", scope: "authorized-request", ...f.target, actorUserId } };
      const admitted = copyModel.documentCopyOutcome({ ...saved, previewId }, "resume", envelope, true, { retirementActorUserId: actorUserId });
      const authorityKey = f.store._documentCopyFacts(f.target).authorityKey;
      f.store.documentCopyReviews.set({ [key]: { ...admitted, authorityKey } });
    }
    const current = f.store.documentCopyReview(f.target), before = structuredClone(f.requests);
    const markup = flatten(f.host._copyDialog()), statuses = paragraphs(markup), controls = buttons(markup);
    assert.equal(current.phase, phase); assert.equal(f.store.documentCopyAccess(f.target).canRead, true);
    assert.equal(f.store.documentCopyAccess(f.target).canAuthor, author);
    assert.equal(current.operationId, original.operationId, "inspection keeps the original operation");
    assert.deepEqual(f.requests, before, "rendering cannot submit or retrieve a copy");
    assert.equal(controls.includes(messages["document.copy.apply"]), author && phase === "review");
    if (!author) {
      assert.doesNotMatch(markup, /<input\b|<select\b/u);
      assert.ok(text(markup).includes(messages["document.copy.readOnly"]));
      await f.host._applyCopy(); assert.deepEqual(f.requests, before, "reader cannot invoke hidden Apply");
    }
    if (phase !== "retired") {
      assert.equal(JSON.stringify(current.preview.events), originalEvents, "all exact destination/source event details remain intact");
      assert.equal(current.previewId, original.previewId); assert.equal(current.approvalHash, original.approvalHash);
      assert.equal(current.destinationDocumentId, original.destinationDocumentId);
      assert.equal((markup.match(/<li>/gu) ?? []).length, original.preview.changes.length);
      assert.ok(markup.includes(JSON.stringify(current.preview.events, null, 2)));
      assert.ok(markup.includes(current.sourceTitle));
    } else {
      assert.equal(current.receipt, null); assert.equal(current.preview, null); assert.equal(current.intent, null);
      assert.ok(controls.includes(messages["context.changes.done"]));
      assert.equal(controls.includes(messages["document.copy.preview"]), false);
      assert.equal(controls.includes(messages["document.copy.discard"]), false);
    }
    if (phase === "review" && !author) {
      const checkBefore = f.requests.length;
      assert.ok(controls.includes(messages["document.copy.check"]));
      await f.host._checkCopy();
      assert.equal(f.requests.length, checkBefore + 1); assert.equal(f.requests.at(-1).action, "retrieve");
      assert.equal(f.requests.at(-1).previewId, original.previewId); assert.equal(f.requests.at(-1).approvalHash, original.approvalHash);
    }
    const atomic = text(markup).includes(messages["context.changes.atomic"]);
    t.diagnostic(JSON.stringify({ locale, author, phase, statuses, controls, atomic, requestActions: f.requests.map(request => request.action),
      ramCanonicalCopies: f.seenCopyCount(), envelopeOnlyRetirement: phase === "retired" }));
    assert.equal(atomic, author && phase === "review", "only an editable unsubmitted author preview gives confirmation guidance");
    if (phase === "review") {
      const expected = author ? f.host.i18n.t("context.changes.summary", "", { blocks: f.host.i18n.number(original.preview.blockCount), relations: f.host.i18n.number(original.preview.relationCount) }) : messages["document.copy.reviewTitle"];
      assert.ok(statuses.includes(expected), "reader inspection is not presented as a future save");
    } else if (phase === "applying") assert.ok(statuses.includes(messages["context.changes.applying"]));
    else if (phase === "uncertain") assert.ok(statuses.includes(messages["document.copy.uncertain"]));
    else if (phase === "applied") {
      assert.ok(statuses.includes(f.host.i18n.t("context.changes.applied", "", { blocks: f.host.i18n.number(original.preview.blockCount), relations: f.host.i18n.number(original.preview.relationCount) })));
      assert.ok(text(markup).includes(messages["context.changes.appliedHint"]), "readers retain the confirmed receipt explanation");
    } else {
      if (!author) assert.equal(statuses.some(value => value.includes(messages["document.copy.apply"])), false, "reader completion status cannot direct an unavailable new-copy action");
      const key = author ? "document.copy.retired" : "document.copy.retiredReadOnly";
      assert.notEqual(messages[key], undefined, "exact four-language retired message");
      assert.ok(statuses.includes(f.host.i18n.t(key, undefined, { done: messages["context.changes.done"], apply: messages["document.copy.apply"] })));
    }
    assert.equal(f.seenCopyCount(), ["uncertain", "applied"].includes(phase) ? 1 : 0);
  });
}
