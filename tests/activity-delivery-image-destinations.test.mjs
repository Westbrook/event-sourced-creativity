// Two ordinary image origins, not substitutes for the command-image cases.
// Reuse the frozen four-destination prefix without registering its tests or
// changing a renderer/Store/response. Historical metadata is not image pixels,
// actual generation, a provider receipt or successful delivery.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { registerHooks } from "node:module";
import { libraryFocusRoute } from "../src/model/routes.ts";
import { scopedFormaActivity } from "../src/model/activity.ts";
import { describeOutputs, imageOutputNamingCandidate } from "../src/model/output-naming.ts";

const fixtureUrl = new URL("./activity-delivery-exact-destinations.test.mjs", import.meta.url);
const original = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstLoop = tree.statements.find(ts.isForOfStatement); assert.ok(firstLoop);
const fixtureSource = original.slice(0, firstLoop.getFullStart())
  + "\nexport { historicalTargets,lifecyclePage,registerCalmFullPageComponents,createSceneStoreHost,observeActualSceneResumeReads,financial,appendAuditEvent,readWorkspaceEvents,withProjectTaskDocumentInRoute,libraryFocusFromRoute,libraryRootRoute,inside,classed,exactlyOne,currentDestinationLink,destinationNavigationState,installDestinationPublisherInputs };";
const virtual = new URL(fixtureUrl); virtual.search = "?c137-ordinary-image-origin-fixture";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual.href ? { format: "module", source: fixtureSource, shortCircuit: true } : next(url, context);
} });
let shared;
try { shared = await import(virtual.href); } finally { hook.deregister(); }
const { historicalTargets, lifecyclePage, registerCalmFullPageComponents, createSceneStoreHost, observeActualSceneResumeReads,
  financial, appendAuditEvent, readWorkspaceEvents, withProjectTaskDocumentInRoute, libraryFocusFromRoute, libraryRootRoute,
  inside, classed, exactlyOne, currentDestinationLink, destinationNavigationState, installDestinationPublisherInputs } = shared;

for (const [surface, locale] of [["activity", "en"], ["deliver", "ja"]])
  test("Ordinary " + surface + " image origin reaches the exact output namespace through the actual Shell / " + locale,
    { concurrency: false, timeout: 120000 }, async t => {
      let externalAttempts = 0;
      t.mock.method(globalThis, "fetch", async () => { externalAttempts++; assert.fail("No external/provider transport in an ordinary image navigation witness"); });
      const h = await createSceneStoreHost({ count: 1, shared: true, exposeSceneTestAccessors: false }), worker = h.worker;
      const resume = observeActualSceneResumeReads(h); let f, verify = async () => {};
      t.after(async () => { try { await resume.settleOriginalRequests(); await verify(); } finally { resume.restore(); if (!f) await h.close(); } });
      const { target: artifact } = await historicalTargets(worker, "export");
      const target = { id: artifact.id, title: "Exact ordinary image — 同じ ID", mediaUrl: "/api/media/c137-exact-ordinary-image" };
      for (const [id, title, mediaUrl] of [[target.id, target.title, target.mediaUrl], ["c137-other-image", "Different existing image", "/api/media/c137-other-image"]])
        await appendAuditEvent(worker.env, worker.streamId, "worker:fixture-history", "GenerationCompleted", {
          project_id: worker.projectId, document_id: worker.documentId, generation_id: "c137-" + id, object_ids: [id], title,
          quality: "high", purpose: "final", provider: "in-memory-saved-metadata", model_id: "fixture-saved-image",
          media_url: mediaUrl, media_type: "image/png", image_width: 640, image_height: 480,
        });
      await worker.drainBackground();
      const originRoute = withProjectTaskDocumentInRoute("/" + surface, worker.documentId);
      f = await lifecyclePage(t, { route: withProjectTaskDocumentInRoute("/activity", worker.documentId), mode: "configure", locale, storeHost: h });
      await registerCalmFullPageComponents(f, ["forma-deliver", "forma-library", "forma-workspace"]);
      const drain = async () => {
        for (let step = 0; step < 8; step++) {
          await f.settle();
          for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
          await resume.settleOriginalRequests(); await new Promise(setImmediate);
        }
        await f.settle(); await resume.settleOriginalRequests(); await worker.drainBackground(); assert.equal(resume.pendingOriginalCount(), 0);
      };
      await h.store.refreshSession(); await h.store.refreshEvents({ fromStart: true }); await h.store.syncProjectNotifications(); await drain();
      h.store.setRoute(originRoute); await drain();
      assert.equal(h.store.events.get().some(event => event.eventId.startsWith("synthetic-study-") || event.eventId.startsWith("synthetic-extra-")), false);
      const projection = h.store.projection.get(), document = projection.documents.find(row => row.id === worker.documentId && !row.removed);
      assert.ok(document && document.projectId === worker.projectId); assert.equal(projection.documentId, document.id);
      const output = projection.libraryOutputs.find(row => row.id === target.id);
      assert.ok(output && output.documentId === document.id); assert.equal(output.title, target.title); assert.equal(output.mediaUrl, target.mediaUrl);
      const originalGeneration = h.store.events.get().find(event => event.eventId === output.sourceEventId);
      assert.ok(originalGeneration?.type === "GenerationCompleted" && originalGeneration.payload.object_ids.includes(target.id));
      assert.equal(output.sequence, originalGeneration.sequence);
      assert.ok(projection.libraryArtifacts.some(row => row.id === output.id && row.title === artifact.title), "a different artifact namespace genuinely shares the opaque output ID");
      const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      const owner = exactlyOne(f.components().filter(value => value.tag === "forma-" + surface && value.isConnected), "actual current ordinary image origin");
      assert.equal(owner.store, h.store); assert.equal(owner.closest("forma-shell"), f.host); assert.equal(f.host.store, h.store);
      const scope = scopedFormaActivity(h.store.session.get(), projection, [], [], []), documents = new Map(scope.documents.map(row => [row.id, row.title]));
      const scopedArtifacts = projection.libraryArtifacts.filter(row => documents.has(row.documentId));
      const scopedOutputs = projection.libraryOutputs.filter(row => documents.has(row.documentId));
      const displayedOutputs = surface === "activity" ? scopedOutputs.slice(0, 6) : [...scopedOutputs].sort((left, right) => right.sequence - left.sequence);
      const descriptions = describeOutputs([...scopedArtifacts, ...displayedOutputs.map(row => imageOutputNamingCandidate(row, {}, documents.get(row.documentId) ?? projection.projectName))], {
        ...(surface === "activity" ? { peers: [...projection.libraryArtifacts, ...projection.libraryOutputs.map(row => imageOutputNamingCandidate(row, {}, documents.get(row.documentId) ?? projection.projectName))] } : {}),
        events: h.store.events.get(), locale: f.i18n.locale, timeZone: f.i18n.timeZone,
        formatTake: take => f.i18n.t("output.take", "Take {number}", { number: f.i18n.number(take) }), scopedLabels: {
          documents: scope.documents, formatDocument: number => f.i18n.t("artifact.delivery.documentQualifier", "Document {number}", { number: f.i18n.number(number) }),
          formatResult: number => f.i18n.t("artifact.delivery.resultQualifier", "Result {number}", { number: f.i18n.number(number) }),
        },
      });
      const identity = descriptions.find(row => row.displayScope?.key === JSON.stringify([document.id, "image", output.id]));
      assert.ok(identity?.displayScope && identity.displayScope.title.includes(target.title));
      const routeTitle = new Map(descriptions.map(row => [row.id, row.disambiguator ? row.disambiguator + " — " + row.title : row.title])).get(output.id);
      assert.ok(routeTitle, "reuse the exact shared naming result, not an invented image slug or a second collision policy");
      const beforeTree = f.tree(); let action;
      if (surface === "activity") {
        const card = exactlyOne(beforeTree.visible("article").filter(row => row.owner === owner
          && beforeTree.visible("h3").some(heading => inside(heading, row) && heading.text === identity.displayScope.title)), "actual image card, not same-ID artifact card");
        action = exactlyOne(beforeTree.visible("button").filter(row => row.owner === owner && inside(row, card)
          && row.text === f.i18n.t("activity.openResult", "Open result")), "current ordinary Open result");
        assert.equal(action.attributes.type, "button");
      } else action = exactlyOne(beforeTree.visible("a").filter(row => row.owner === owner && row.attributes.class === "button secondary compact"
        && libraryFocusFromRoute(row.attributes.href ?? "")?.kind === "output" && libraryFocusFromRoute(row.attributes.href)?.id === output.id), "current ordinary image footer link");
      assert.ok(action.attributes["aria-label"].includes(target.title)); assert.ok(action.port.isConnected && f.renderer.nodes.includes(action.port));
      assert.equal(action.hiddenBy, null); assert.equal(action.port.matches(":disabled"), false);
      const rawTarget = libraryFocusRoute("output", output.id, routeTitle, surface === "deliver" ? originRoute : "/library");
      const expected = withProjectTaskDocumentInRoute(rawTarget, document.id, originRoute);
      if (surface === "deliver") assert.equal(action.attributes.href, rawTarget);
      const before = { history: await readWorkspaceEvents(worker.env, worker.streamId), money: financial(worker),
        privateContent: worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
        receipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
        notifications: worker.sqlite.prepare("SELECT * FROM project_notifications ORDER BY notification_id").all(),
        events: structuredClone(h.store.events.get()), head: h.store.head.get(), session: JSON.stringify(h.store.session.get()) };
      verify = async () => {
        assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), before.history);
        assert.deepEqual(financial(worker), before.money); assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), before.privateContent);
        assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
        assert.deepEqual(worker.sqlite.prepare("SELECT * FROM project_notifications ORDER BY notification_id").all(), before.notifications);
        assert.deepEqual(h.store.events.get(), before.events); assert.equal(h.store.head.get(), before.head); assert.equal(JSON.stringify(h.store.session.get()), before.session);
        assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
        assert.deepEqual(h.requests.filter(row => (row.init.method ?? "GET") !== "GET" && !resume.isReadOnlyResume(row)), [], "unchanged strict original-response/no-write Resume proof only");
        assert.equal(h.requests.filter(row => row.url.startsWith("/api/document-jobs") && (row.init.method ?? "GET") !== "GET").length, 0);
        assert.equal(externalAttempts, 0);
      };
      const navigation = [], nativePush = globalThis.history.pushState;
      t.mock.method(globalThis.history, "pushState", function(...args) { navigation.push(String(args[2])); return nativePush.apply(this, args); });
      if (surface === "deliver") for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
        action = currentDestinationLink(f, owner, action);
        await f.act(action, "click", { button: 0, defaultPrevented: false, [modifier]: true, preventDefault() { assert.fail("modified native href is not intercepted"); } });
        assert.equal(h.store.route.get(), originRoute); assert.deepEqual(navigation, []);
      }
      if (surface === "deliver") action = currentDestinationLink(f, owner, action);
      f.native.emit("pointerdown", action.port); f.native.focus(action.port); await f.act(action, "click", { button: 0, defaultPrevented: false }); await drain();
      assert.deepEqual(navigation, [expected]); assert.equal(h.store.route.get(), expected);
      assert.deepEqual(libraryFocusFromRoute(expected), { kind: "output", id: target.id });
      assert.equal(h.location.pathname + h.location.search + h.location.hash, expected); assert.equal(owner.isConnected, false);
      const library = exactlyOne(f.components().filter(value => value.tag === "forma-library" && value.isConnected), "actual Library output destination");
      assert.equal(library.store, h.store);
      installDestinationPublisherInputs(t, f, library);
      const arrived = f.tree();
      const dialog = exactlyOne(arrived.visible("dialog").filter(row => row.owner === library && classed(row, "library-focus-dialog")), "actual native output preview is open");
      assert.ok(dialog.port.open);
      const outputCard = exactlyOne(arrived.nodes.filter(row => row.tag === "forma-output-card" && row.component?.isConnected && inside(row, dialog)), "actual exact OutputCard, not artifact reader");
      assert.equal(outputCard.component.store, h.store); assert.equal(outputCard.component.output.id, target.id);
      assert.equal(outputCard.component.output.documentId, document.id); assert.equal(outputCard.component.output.mediaUrl, target.mediaUrl);
      assert.deepEqual(outputCard.component.output, output, "the exact original current metadata, including event/generation identity, reaches the connected viewer");
      assert.equal(arrived.visible("article").filter(row => inside(row, dialog) && row.attributes["data-output-id"] === target.id).length, 1);
      assert.equal(arrived.visible("dialog").filter(row => classed(row, "document-artifact-view")).length, 0, "same-ID artifact is not substituted");
      const close = exactlyOne(arrived.visible("button").filter(row => row.owner === library && inside(row, dialog)
        && row.attributes["aria-label"] === f.i18n.t("projects.closePreview", "Close preview")), "current native output preview Close");
      f.native.emit("pointerdown", close.port); f.native.focus(close.port); await f.act(close, "click", { button: 0 }); await drain();
      assert.equal(h.store.route.get(), libraryRootRoute(expected)); assert.equal(libraryFocusFromRoute(h.store.route.get()), null);
      assert.equal(f.tree().visible("dialog").filter(row => classed(row, "library-focus-dialog")).length, 0);
      const back = exactlyOne(f.tree().visible("a").filter(row => row.owner.tag === "forma-ui-audience-navigation"
        && new URL(row.attributes.href, "https://fixture.invalid").pathname === "/" + surface), "current ordinary return task");
      assert.equal(back.attributes.href, originRoute);
      const beforeReturn = destinationNavigationState(f, h, source, authorization);
      f.native.emit("pointerdown", back.port); f.native.focus(back.port); await f.act(back, "click", { button: 0 }); await drain();
      t.diagnostic("C139_EXACT_IMAGE_RETURN " + JSON.stringify({ surface, href: back.attributes.href,
        before: beforeReturn, after: destinationNavigationState(f, h, source, authorization) }));
      assert.equal(h.store.route.get(), originRoute); assert.equal(h.store.projection.get().documentId, document.id);
      await verify();
      t.diagnostic("ACTIVITY_DELIVER_ACTUAL_IMAGE_DESTINATION " + JSON.stringify({ surface, locale, outputId: target.id,
        sameIdArtifact: artifact.id, documentId: document.id, route: expected, returned: originRoute,
        actualShell: true, noEffects: true, historicalMetadataOnly: true, imagePixelsOrGenerationClaim: false, physicalBrowserClaim: false }));
    });
