import assert from "node:assert/strict";
import test, { after } from "node:test";
import { assignmentPage, flushStoreFrames, libraryFocusFromRoute, artifactFocusOptionsFromRoute,
  originalFetch, externalCount } from "./helpers/assigned-review-action-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { scopedFormaActivity } from "../src/model/activity.ts";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";
import { documentArtifactRevision } from "../src/model/document-artifacts.ts";

after(() => { assert.equal(externalCount(), 0); globalThis.fetch = originalFetch; });

const classed = (node, value) => String(node.attributes?.class ?? "").split(/\s/u).includes(value);
function within(node, value) {
  for (let at = node.parent; at; at = at.parent) if (classed(at, value)) return true;
  return false;
}
const groupButtons = (f, name) => f.tree().visible("button").filter(node => within(node, name));

// Change only the existing finite locale-provider port before mounting Library.
// The real component, resolver, Store and routed Worker remain unchanged.
function localePort(f, locale) {
  f.i18n.hostDisconnected(); f.locale = locale;
  const messages = { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] };
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr",
      timeZone: "UTC", messages, revision: 1 }, () => {});
    return true;
  } });
  f.i18n.hostConnected();
  for (const owner of f.components()) owner.i18n = f.i18n;
  ports.bindFixture(f);
}

async function library(t, locale, otherDocument = false) {
  const q = await assignmentPage(t, "same-document", { observeViewerOpening: true }), { h, f } = q;
  localePort(f, locale); installOutputNavigationFocusNative(t, f, ports);
  const documentId = otherDocument ? q.w.documentId : q.targetDocument;
  h.store.setRoute("/library?document=" + documentId);
  await flushStoreFrames(h); await f.settle();
  assert.equal(h.store.projection.get().documentId, documentId);
  assert.equal(f.components().filter(owner => owner.tag === "forma-library").length, 1);
  // C72 observed the generic first-class query returning the section itself.
  // This reviewer emits no publisher inputs; resolve actual ancestry and fail
  // explicitly if that fixture contract changes. Do not invent input defaults.
  const libraryOwner = f.components().find(owner => owner.tag === "forma-library");
  const previousQuery = f.renderer.query;
  const query = function (owner, selector) {
    if (owner !== libraryOwner || selector !== ".library-organization-context form.workspace-settings-form input")
      return Reflect.apply(previousQuery, this, [owner, selector]);
    const inputs = f.tree().nodes.filter(node => {
      if (node.owner !== owner || node.tag !== "input") return false;
      let form = node.parent;
      while (form && form.tag !== "form") form = form.parent;
      if (!form || !classed(form, "workspace-settings-form")) return false;
      for (let at = form.parent; at; at = at.parent)
        if (at.owner === owner && classed(at, "library-organization-context")) return true;
      return false;
    });
    assert.equal(inputs.length, 0, "The actual review-role Library emits no native publisher inputs");
    return inputs.map(node => node.port);
  };
  f.renderer.query = query;
  t.after(() => { if (f.renderer.query === query) f.renderer.query = previousQuery; });
  const assigned = scopedFormaActivity(h.store.session.get(), h.store.projection.get(), [], h.store.reviewInbox.get(), []).reviews;
  assert.equal(assigned.length, 3, "all three real pending Worker assignments are in the current project");
  const rows = f.tree().visible("li").filter(node => within(node, "library-assigned-reviews"));
  assert.equal(rows.length, assigned.length, "the complete exact task list is retained");
  for (const [index, task] of assigned.entries()) {
    assert.ok(rows[index].text.includes(task.artifactTitle));
    assert.ok(rows[index].text.includes(String(task.revision)));
    const buttons = groupButtons(f, "library-assigned-reviews");
    assert.equal(buttons.length, assigned.length);
    assert.equal(typeof buttons[index].handlers.click, "function", "each original task keeps its current action");
  }
  const actions = creativeNextActions(nextActionFacts(h.store, documentId, null, { lifecycle: true }));
  return { ...q, assigned, actions, documentId, test: t };
}

async function currentOpen(q, button, task) {
  assert.ok(button.port && button.owner.isConnected && !button.hiddenBy);
  const prior = q.viewerCalls.length;
  const tick = q.f.tick, ticks = [], observed = new WeakMap();
  q.test.after(() => { q.f.tick = tick; });
  q.f.tick = async owner => {
    const call = q.viewerCalls[prior];
    if (!call || call.owner !== owner) return tick(owner);
    const store = q.h.store;
    if (!observed.has(call)) {
      const artifact = store.projection.get().libraryArtifacts.find(row => row.id === call.id);
      observed.set(call, { artifact, authorization: store.captureAuthorizationScope(), source: store.captureSourceOwnership(),
        revision: documentArtifactRevision(store.events.get(), call.id), retained: store.content.get()[artifact?.contentRef ?? ""] });
    }
    const original = observed.get(call);
    const snapshot = () => {
      const artifact = store.projection.get().libraryArtifacts.find(row => row.id === call.id);
      const tuple = value => value && [value.id, value.documentId, value.sequence, value.sourceEventId, value.contentRef];
      return { viewerDocumentId: owner.documentId, projectionDocumentId: store.projection.get().documentId,
        artifactDocumentId: artifact?.documentId, connected: owner.isConnected,
        authorityCurrent: store.authorizationScopeActive(original.authorization), sourceCurrent: store.sourceOwnershipActive(original.source),
        revision: documentArtifactRevision(store.events.get(), call.id), originalRevision: original.revision,
        exactArtifactTupleUnchanged: JSON.stringify(tuple(artifact)) === JSON.stringify(tuple(original.artifact)),
        retainedDefinedAtEntry: original.retained !== undefined,
        exactRetainedValueUnchanged: store.content.get()[original.artifact?.contentRef ?? ""] === original.retained };
    };
    const before = snapshot(), result = await tick(owner);
    if (ticks.length < 6) ticks.push({ before, after: snapshot() });
    return result;
  };
  // Observation only: compare the existing native query with actual emitted
  // ancestry. Do not repair ports, normalize defaults or change app admission.
  const publisherQueryDiagnostic = phase => {
    const selector = ".library-organization-context form.workspace-settings-form input";
    const tree = q.f.tree();
    const property = (node, key) => {
      const value = node?.[key];
      return { type: typeof value, ...(value === undefined ? {} : { value }) };
    };
    const describe = node => ({ tag: node?.tag ?? null, tagName: node?.tagName ?? null,
      className: node?.attributes?.class ?? null, typeAttribute: node?.getAttribute?.("type") ?? null,
      nativeType: property(node, "type"), value: property(node, "value"), defaultValue: property(node, "defaultValue"),
      checked: property(node, "checked"), defaultChecked: property(node, "defaultChecked"),
      connected: node?.isConnected ?? null, ownerTag: node?.owner?.tag ?? null,
      inCurrentRenderer: q.f.renderer.nodes.includes(node) });
    const libraries = q.f.components().filter(owner => owner.tag === "forma-library" && owner.isConnected).map(owner => {
      const exact = tree.nodes.filter(node => {
        if (node.owner !== owner || node.tag !== "input") return false;
        let form = node.parent;
        while (form && form.tag !== "form") form = form.parent;
        if (!form || !classed(form, "workspace-settings-form")) return false;
        for (let at = form.parent; at; at = at.parent)
          if (at.owner === owner && classed(at, "library-organization-context")) return true;
        return false;
      });
      const queried = [...owner.querySelectorAll(selector)];
      return { connected: owner.isConnected, actualQuery: queried.map(describe),
        exactSemanticInputs: exact.map(node => ({ ...describe(node.port), semanticTag: node.tag,
          semanticType: node.attributes.type ?? null, hiddenBy: node.hiddenBy,
          portPresent: Boolean(node.port), includedInActualQuery: queried.includes(node.port) })) };
    });
    q.test.diagnostic(JSON.stringify({ diagnostic: "c71-library-publisher-native-query", phase, locale: q.f.locale,
      selector, route: q.h.store.route.get(), toast: q.h.store.ui.toast ?? null,
      viewerCallCount: q.viewerCalls.length, libraries }));
  };
  publisherQueryDiagnostic("before-gesture");
  await q.f.act(button);
  publisherQueryDiagnostic("after-gesture");
  for (let attempt = 0; attempt < 32 && !q.viewerCalls[prior]; attempt++) {
    await flushStoreFrames(q.h); await q.f.settle(); await new Promise(setImmediate);
  }
  assert.equal(q.viewerCalls.length, prior + 1, "one existing viewer opening, no duplicate private read");
  const opened = q.viewerCalls[prior];
  // The click intentionally returns void. Join the pass-through observation of
  // the actual public viewer promise; undefined is not a successful arrival.
  let settled = false, value, rejected;
  opened.pending.then(result => { value = result; settled = true; }, error => { rejected = error; settled = true; });
  for (let attempt = 0; attempt < 32 && !settled; attempt++) {
    await flushStoreFrames(q.h); await q.f.settle(); await new Promise(setImmediate);
  }
  q.test.diagnostic(JSON.stringify({ diagnostic: "c19-library-viewer-property-commit", locale: q.f.locale,
    expectedArtifactId: task.artifactId, expectedDocumentId: task.documentId, expectedRevision: task.revision,
    expectedHash: task.contentSha256, route: q.h.store.route.get(), settled, result: value ?? null,
    rejection: rejected ? String(rejected) : null, ticks }));
  if (rejected) throw rejected;
  assert.ok(settled, "exact viewer promise remained pending: " + JSON.stringify({
    id: opened.id, documentId: opened.owner.documentId, connected: opened.owner.isConnected,
    route: q.h.store.route.get(), observerError: opened.error ?? null,
    dialogOpen: opened.owner.querySelector(".document-artifact-view")?.open ?? false,
  }));
  assert.equal(value, true, "the actual artifact-opening contract returns true, never legacy job void");
  assert.equal(opened.result, true); assert.equal(opened.id, task.artifactId);
  assert.deepEqual(libraryFocusFromRoute(q.h.store.route.get()), { kind: "artifact", id: task.artifactId });
  assert.deepEqual(artifactFocusOptionsFromRoute(q.h.store.route.get()), {
    expectedRevision: task.revision, expectedContentSha256: task.contentSha256, intent: "review",
  });
  assert.ok(opened.owner.isConnected);
  assert.equal(opened.owner.querySelector(".document-artifact-view")?.open, true);
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test(locale + " Library promotes the same exact assigned review once while retaining every task action", async t => {
    const q = await library(t, locale), first = q.assigned[0];
    const index = q.actions.findIndex(action => action.target.kind === "assigned-review" && action.target.reviewId === first.id);
    assert.ok(index >= 0, "precondition: the actual current resolver promotes this exact first Worker task");
    const target = q.actions[index].target;
    assert.equal(target.artifactId, first.artifactId); assert.equal(target.revision, first.revision);
    assert.equal(target.contentSha256, first.contentSha256); assert.equal(target.documentId, first.documentId);
    const cards = groupButtons(q.f, "lifecycle-next-actions");
    assert.equal(cards.length, q.actions.length); assert.ok(cards[index].text.includes(first.artifactTitle));
    // Desired baseline: C19 alone reaches this assertion with one extra banner.
    assert.equal(q.f.tree().visible("aside").filter(node => classed(node, "library-review-priority")).length, 0,
      "the exact same assigned review needs no second priority banner");
    await currentOpen(q, cards[index], first);
  });

  test(locale + " Library retains another Document's priority review when no same-task scoped card exists", async t => {
    const q = await library(t, locale, true), first = q.assigned[0];
    assert.notEqual(first.documentId, q.documentId);
    assert.equal(q.actions.some(action => action.target.kind === "assigned-review" && action.target.reviewId === first.id), false);
    const banners = q.f.tree().visible("aside").filter(node => classed(node, "library-review-priority"));
    assert.equal(banners.length, 1, "an unrelated priority task is not deduplicated by title or action category");
    const buttons = groupButtons(q.f, "library-review-priority");
    assert.equal(buttons.length, 1); assert.equal(buttons[0].text, q.f.i18n.t("activity.openReview", "Open assigned review"));
    await currentOpen(q, buttons[0], first);
  });
}
