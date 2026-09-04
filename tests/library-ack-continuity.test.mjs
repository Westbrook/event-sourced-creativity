import assert from "node:assert/strict";
import test from "node:test";
import {
  writeFixture, appendAuditEvent, readWorkspaceEvents, financial, sceneDeferred, untilScene, withDocumentInRoute,
} from "./helpers/event-source-retirement-fixture.mjs";
import {
  createCalmFullPage, calmFullPageNativePorts as ports, registerCalmFullPageComponents,
} from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { documentIdFromRoute, libraryFocusFromRoute, libraryRootRoute } from "../src/model/routes.ts";
import { png } from "./output-asset-fixtures.mjs";
import { installImageFormatNativeLifetime } from "./helpers/image-format-native-lifetime.mjs";
import { installManualOutputNativeLifetime } from "./helpers/manual-output-native-lifetime.mjs";
import { storePrivateContent as cSlidesStorePrivateContent } from "../worker/pilot-policy.ts";

// Baseline only: actual Library/Store/RAM Worker. The ordinary append may commit;
// these cases do not turn a later navigation/focus choice into server cancellation.
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const eventPost = request => request.url === "/api/events" && request.init.method === "POST";
const inside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const reusableId = "library-ack-reusable-direction";

async function libraryAckPage(t, kind, { manual = null, libraryViewer = false, taste = false, slides = false, locale = "en" } = {}) {
  assert.ok(!libraryViewer || manual === "artifact-viewer" && kind === "artifact", "Exact Library viewer source option only");
  assert.ok(manual === null || cManualCallers.includes(manual), "Explicit finite manual-reuse fixture option");
  assert.ok(!taste || manual === "output-card" && kind === "copy" && !libraryViewer, "Only the exact retained personal OutputCard admits the Taste observer");
  assert.ok(!slides || manual === "artifact-viewer" && kind === "artifact" && !libraryViewer && !taste, "Only the exact current Slides viewer admits its separate original matcher");
  let cleanup = async () => {};
  // Release the original transport before the existing fixture closes SQLite.
  t.after(async () => { await cleanup(); });
  const h = await writeFixture(t, { shared: false }), worker = h.worker;
  if (kind === "remove") await appendAuditEvent(worker.env, worker.streamId, "user", "AddedToLibrary", {
    object_id: "saved-scene-story", item_id: "saved-scene-story",
    document_id: worker.documentId, meaning: "personal-reusable-output",
  });
  else await appendAuditEvent(worker.env, worker.streamId, "user", "BlockCreated", {
    project_id: worker.projectId, scope: "library", block_id: reusableId, type: "direction",
    handle: "direction/library-ack", position: "l-library-ack",
    properties: { label: "Exact reusable direction", text: "Exact retained reusable wording.", weight: 0.65, authority: "authored" },
  });
  if (manual) await cManualSeed(t, h, manual);
  const slidesSeed = slides ? await cSlidesMenuSeed(h) : null;
  await h.store.refreshEvents();
  const events = h.store.events.get(), head = h.store.head.get(), content = h.store.content.get(), session = h.store.session.get();
  const resumes = observeActualSceneResumeReads(h);
  cleanup = async () => { await resumes.settleOriginalRequests(); await worker.drainBackground(); resumes.restore(); };
  const f = await createCalmFullPage(t, { locale, storeHost: h });
  // The complete page fixture's 14-block presentation sample is not source proof.
  h.store.events.set(events); h.store.head.set(head); h.store.content.set(content); h.store.session.set(session);
  h.store.setRoute(withDocumentInRoute("/", worker.documentId, "One current authored direction"));
  await h.store.syncDocumentFromRoute(); await f.settle();
  await registerCalmFullPageComponents(f, ["forma-workspace", "forma-library", "forma-activity"]);
  f.native = installOutputNavigationFocusNative(t, f, ports);
  await f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground();
  const task = pathname => f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && new URL(node.attributes.href, "https://fixture.invalid").pathname === pathname);
  await f.act(task("/library"), "click", { button: 0 });
  const owners = f.components().filter(component => component.tag === "forma-library");
  assert.equal(owners.length, 1);
  const owner = owners[0], Library = f.modules.get("src/components/forma-library.ts")?.FormaLibrary;
  assert.equal(typeof Library, "function"); assert.ok(owner instanceof Library);
  assert.equal(owner.isConnected, true);
  assert.equal(h.store.projection.get().documentId, worker.documentId);
  assert.equal(h.store.projection.get().projectId, worker.projectId);
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  assert.ok(source && authorization && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
  assert.ok(h.store.session.get().capabilities.includes("project.author"));
  const q = { f, h, worker, resumes, owner, kind, manual, libraryViewer, taste, slides, slidesSeed, source, authorization, task, pending: null, armed: null };
  q.originalBlock = structuredClone(h.store.projection.get().libraryBlocks.find(block => block.id === (kind === "copy" || kind === "artifact" ? reusableId : "scene-reuse-direction")));
  assert.ok(q.originalBlock);
  if (kind === "artifact") {
    q.originalArtifact = structuredClone(h.store.projection.get().libraryArtifacts.find(artifact => artifact.id === (slides ? slidesSeed.id : "saved-scene-story")));
    assert.ok(q.originalArtifact);
    if (slides) {
      assert.equal(q.originalArtifact.kind, "slides"); assert.equal(q.originalArtifact.contentRef, slidesSeed.contentRef);
      assert.equal(await h.store.ensurePrivateContent(slidesSeed.contentRef, { force: true }), slidesSeed.bytes);
      await f.settle(); assert.equal(h.store.content.get()[slidesSeed.contentRef], slidesSeed.bytes);
    }
  }
  if (manual && manual !== "artifact-viewer") {
    q.originalOutput = structuredClone(h.store.projection.get().libraryOutputs.find(output => output.id === cManualImageId));
    assert.ok(q.originalOutput?.mediaUrl);
  }
  assert.equal(h.store.content.get()[worker.contentRef], worker.content);
  const prior = h.transport;
  let canonicalWrite = null;
  h.transport = async request => {
    if (!eventPost(request)) {
      // total_changes is connection-wide. Later native reads wait only for the
      // actual append+canonical observation, never for the held response delivery.
      if (canonicalWrite) await canonicalWrite;
      return prior(request);
    }
    const a = q.armed;
    assert.ok(a, "Only the explicitly activated original Library append is admitted");
    assert.equal(a.request, null, "No retry, replacement, or second authored request");
    a.request = request; a.init = request.init; a.bytes = request.init.body;
    const barrier = sceneDeferred(); canonicalWrite = barrier.promise;
    try {
      await resumes.settleOriginalRequests();
      const body = request.body;
      if(taste)await cTasteOriginalWrite(q,request,prior);
      else{
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      const eventCount = manual && manual !== "artifact-viewer" ? 2 : 1;
      assert.equal(body.action, eventCount === 1 ? "append" : "batch", "The actual original command length owns its public action");
      assert.equal(body.clientId, "web:lit");
      assert.equal(body.expectedSequence, a.head);
      assert.equal(body.events.length, eventCount); assert.deepEqual(body.event, body.events[0]);
      assert.equal(request.init.body, JSON.stringify(body));
      assert.equal(h.store.route.get(), a.route);
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      if (manual) cManualOriginalInputs(q, body.events, a.head);
      else if (kind === "remove") assert.deepEqual(body.event, {
        type: "RemovedFromLibrary", payload: {
          object_id: "saved-scene-story", item_id: "saved-scene-story",
          document_id: worker.documentId, meaning: "personal-reusable-output",
        },
      });
      else if (kind === "artifact") cLibraryArtifactOriginalEvent(q, body.event, a.head);
      else {
        const block = q.originalBlock, payload = body.event.payload;
        assert.match(payload.block_id, uuid); assert.match(payload.properties.context_set_id, uuid);
        assert.notEqual(payload.block_id, block.id);
        assert.deepEqual(body.event, { type: "BlockCreated", payload: {
          block_id: payload.block_id, document_id: worker.documentId, type: block.type,
          handle: block.handle + "-copy-" + String(a.head + 1).padStart(3, "0"),
          position: "z" + String(a.head + 1).padStart(6, "0"),
          properties: { ...block.properties, authority: "authored", copied_from_block_id: block.id,
            copied_as_context_set: false, context_set_id: payload.properties.context_set_id,
            context_set_root_id: payload.block_id, combined_context_memberships: [],
            semantic_isolation: false, created_from: "library" },
        } });
      }
      // Same original request and actual Worker response, not a fabricated ACK.
      const response = await prior(request);
      assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json();
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
      assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, eventCount);
      const event = receipt.appended[0];
      assert.equal(event.type, body.event.type); assert.deepEqual(event.payload, body.event.payload);
      assert.equal(event.streamId, worker.streamId); assert.equal(event.actor, "user");
      assert.equal(event.clientId, "web:lit"); assert.equal(event.sequence, a.head + 1);
      assert.equal(receipt.head, a.head + eventCount); assert.equal(event.compensatesEventId, null);
      for (const [index, extra] of receipt.appended.slice(1).entries()) {
        const input = body.events[index + 1];
        assert.equal(extra.type, input.type); assert.deepEqual(extra.payload, input.payload);
        assert.equal(extra.streamId, worker.streamId); assert.equal(extra.actor, "user"); assert.equal(extra.clientId, "web:lit");
        assert.equal(extra.sequence, a.head + index + 2); assert.equal(extra.compensatesEventId, null);
        assert.equal(extra.payload.client_event_id, undefined);
      }
      assert.equal(event.payload.client_event_id, undefined);
      assert.equal(response.bodyUsed, false);
      await worker.drainBackground();
      assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...a.history, ...receipt.appended]);
      const row = worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
      assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, event.type);
      assert.deepEqual(JSON.parse(row.private_json), event.payload);
      for (const extra of receipt.appended.slice(1)) {
        const exact = worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(extra.eventId);
        assert.ok(exact); assert.equal(exact.sequence, extra.sequence); assert.equal(exact.type, extra.type);
        assert.deepEqual(JSON.parse(exact.private_json), extra.payload);
      }
      assert.deepEqual(financial(worker), a.financial);
      assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), a.clientReceipts,
        "Ordinary append has an exact observed event, not a newly invented client recovery key");
      a.response = response; a.receipt = receipt; a.sql = { eventId: row.event_id, sequence: row.sequence, type: row.type };
      }
    } catch (error) { a.error = error; throw error; }
    finally { canonicalWrite = null; barrier.resolve(); }
    await a.gate.promise;
    assert.equal(request.init, a.init); assert.equal(request.init.body, a.bytes);
    a.delivered++; return a.response;
  };
  q.arm = async () => {
    assert.equal(q.armed, null); await f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground();
    const acknowledgmentOwner = { authorizationKey: authorization.key, actorUserId: h.store.session.get().user.userId,
      projectId: worker.projectId, sourceGeneration: source.generation };
    q.armed = { gate: sceneDeferred(), request: null, receipt: null, error: null, delivered: 0,
      route: h.store.route.get(), head: h.store.head.get(), history: await readWorkspaceEvents(worker.env, worker.streamId),
      financial: financial(worker), clientReceipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
      acknowledgmentOwner, oldObservations: h.store.eventWriteAcknowledgments(acknowledgmentOwner).map(value => value.observationId) };
    if(taste){q.armed.tasteOriginal={...q.tasteOriginal};q.armed.privateBefore=cTastePrivateRows(worker);}
    return q.armed;
  };
  q.reached = async () => {
    await untilScene(() => Boolean(q.armed?.receipt || q.armed?.error), "Actual original Library Worker200 and canonical row must be reached");
    if (q.armed.error) throw q.armed.error;
    assert.equal(q.armed.delivered, 0);
    assert.equal(h.store.events.get().some(event => event.eventId === q.armed.receipt.appended[0].eventId), false,
      "The canonical commit is real but the original response is still withheld from Store");
    const a = q.armed;
    const pending = h.store.eventWriteAcknowledgments(a.acknowledgmentOwner).filter(value => !a.oldObservations.includes(value.observationId));
    if(taste){
      assert.deepEqual(pending,[],"critiqueObject is a direct original command, not an append-recovery observation");
      assert.equal(h.store.busy.get(),"critique-object");
      assert.equal(h.store.content.get()[a.receipt.appended[0].payload.note_ref],undefined,"Withheld response has not published its original private note to Store");
      return;
    }
    assert.equal(pending.length, 1, "The exact original invocation owns one still-pending local observation");
    assert.equal(pending[0].action, manual && manual !== "artifact-viewer" ? "batch" : "append"); assert.deepEqual(pending[0].owner, a.acknowledgmentOwner);
    assert.equal(pending[0].privateUnavailable, false);
    assert.deepEqual(pending[0].requestedClientEventIds, []);
    assert.deepEqual(pending[0].committed, []); assert.deepEqual(pending[0].rejectedIndices, []);
    assert.equal(pending[0].observedHead, null, "Withheld HTTP delivery has not become an observed Store acknowledgment");
    a.pendingObservationId = pending[0].observationId;
  };
  cleanup = async () => {
    q.armed?.gate.resolve();
    if (q.pending) await q.pending.catch(() => {});
    await resumes.settleOriginalRequests(); await worker.drainBackground();
    h.transport = prior; resumes.restore();
  };
  return q;
}

async function libraryAckEffects(q) {
  const { h, worker, resumes, armed: a } = q;
  await resumes.settleOriginalRequests(); await worker.drainBackground();
  assert.ok(a?.receipt); assert.equal(a.delivered, 1);
  assert.equal(a.response.bodyUsed, true, "Actual Store consumed the original acknowledged response");
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...a.history, ...a.receipt.appended]);
  assert.deepEqual(financial(worker), a.financial);
  assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), a.clientReceipts);
  assert.ok(h.store.sourceOwnershipActive(q.source) && h.store.authorizationScopeActive(q.authorization));
  assert.deepEqual(h.store.projection.get().libraryBlocks.find(block => block.id === q.originalBlock.id), q.originalBlock);
  assert.equal(h.store.content.get()[worker.contentRef], worker.content);
  const event = a.receipt.appended[0];
  assert.deepEqual(h.store.events.get().find(value => value.eventId === event.eventId), event);
  for (const extra of a.receipt.appended.slice(1)) assert.deepEqual(h.store.events.get().find(value => value.eventId === extra.eventId), extra);
  const observations = h.store.eventWriteAcknowledgments(a.acknowledgmentOwner).filter(value => !a.oldObservations.includes(value.observationId));
  if(q.taste){cTastePrivateEffects(q);assert.deepEqual(observations,[],"The original critique does not invent an append-recovery receipt");}
  else{
  assert.match(a.pendingObservationId, uuid);
  }
  assert.equal(observations.length, 0,
    "Store releases a published observed receipt; the pending/uncertain registry is not a durable success ledger");
  assert.equal(h.store.appendFailure.get(), "");
  assert.equal(h.store.head.get(), a.receipt.head);
  const posts = h.requests.filter(request => request.init.method === "POST");
  assert.equal(posts.filter(eventPost).length, 1);
  for (const request of posts) {
    if (request === a.request) continue;
    assert.ok(resumes.isReadOnlyResume(request), "Every other POST needs the unchanged exact original read-only Resume observation");
    assert.equal(resumes.isReadOnlyResume({ ...request }), false, "A cloned outer request is not admitted");
  }
  return event;
}

// The finite shared renderer does not compose this one CSS descendant selector.
// Resolve only that native DOM contract from the exact current structural tree.
// No production query/method, component constructor, or shared renderer is replaced.
function libraryAckFallbackQuery(q) {
  const { f, owner } = q, prior = f.renderer.query.bind(f.renderer), observed = [];
  f.renderer.query = (queryOwner, selector) => {
    if (queryOwner !== owner || selector !== '.compact-segmented button[aria-pressed="true"]') return prior(queryOwner, selector);
    const tree = f.tree(), groups = tree.nodes.filter(node => node.component?.tag === "forma-ui-segmented-control"
      && node.component.parentElement === owner && classed(node, "compact-segmented")
      && node.component.label === f.i18n.t("projects.outputHistory", "Output history"));
    assert.equal(groups.length, 1, "The real current Output history group owns the fallback");
    const matches = tree.visible("button").filter(node => inside(node, groups[0]) && node.attributes["aria-pressed"] === "true");
    assert.equal(matches.length, 1); assert.ok(matches[0].port?.isConnected);
    observed.push(matches[0].port);
    return matches.map(node => node.port);
  };
  return observed;
}

for (const newerSearch of [false, true]) test(
  newerSearch ? "Library kept removal original Worker200 must not focus over a newer current Search"
    : "Library sole kept removal healthy original Worker200 focuses the real empty-list fallback",
  { concurrency: false, timeout: 45_000 }, async t => {
    const q = await libraryAckPage(t, "remove"), { f, h, owner, worker } = q;
    assert.deepEqual(h.store.projection.get().libraryArtifacts.filter(artifact => artifact.library).map(artifact => artifact.id), ["saved-scene-story"]);
    assert.equal(h.store.projection.get().libraryOutputs.filter(output => output.library).length, 0);
    await f.act(f.find("button", node => node.owner.tag === "forma-ui-segmented-control"
      && node.owner.parentElement === owner && node.owner.label === f.i18n.t("projects.outputHistory", "Output history")
      && node.text === f.i18n.t("projects.kept", "Kept") + " 1"));
    const cards = f.tree().visible("article").filter(node => node.owner === owner && classed(node, "library-output"));
    assert.equal(cards.length, 1, "One actual kept artifact makes the empty-list fallback causal");
    const fallback = libraryAckFallbackQuery(q), a = await q.arm();
    const remove = f.find("button", node => node.owner === owner && String(node.attributes["aria-pressed"]) === "true"
      && node.text === f.i18n.t("projects.removeKept", "Remove from kept"));
    f.native.emit("pointerdown", remove.port); f.native.focus(remove.port);
    q.pending = f.act(remove); q.pending.catch(() => {});
    try {
      await q.reached(); await f.settle();
      if (newerSearch) {
        let search = f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === owner);
        f.native.emit("pointerdown", search.port); f.native.focus(search.port);
        search.port.value = "newer local search"; await f.act(search, "input");
        search = f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === owner);
        assert.equal(search.port.value, "newer local search");
        f.native.emit("pointerdown", search.port); f.native.focus(search.port);
      }
      const focusStart = f.native.nativeFocus.length;
      a.gate.resolve(); await q.pending; await f.settle();
      const event = await libraryAckEffects(q);
      assert.equal(event.type, "RemovedFromLibrary"); assert.equal(event.payload.object_id, "saved-scene-story");
      assert.equal(h.store.projection.get().libraryArtifacts.find(artifact => artifact.id === "saved-scene-story").library, false);
      assert.equal(h.store.projection.get().documentId, worker.documentId);
      assert.equal(h.store.route.get(), a.route); assert.ok(owner.isConnected);
      const late = f.native.nativeFocus.slice(focusStart);
      t.diagnostic(JSON.stringify({ originalEvent: a.sql, original200Delivered: a.delivered,
        newerSearch, lateFocus: late.map(call => ({ tag: call.node.tag, text: call.node.textContent,
          pressed: call.node.attributes?.["aria-pressed"] })), fallbackQueries: fallback.length,
        sourceAndFiscalPreserved: true, physicalNodeRetentionClaim: false }));
      if (newerSearch) {
        assert.equal(f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === owner).port.value, "newer local search");
        assert.equal(late.length, 0, "The original removal ACK must not override the newer explicit Search gesture");
      } else {
        assert.equal(late.length, 1);
        assert.equal(fallback.length, 1); assert.equal(late[0].node, fallback[0]);
        assert.equal(late[0].node.owner.value, "kept"); assert.equal(late[0].node.attributes["aria-pressed"], "true");
      }
    } finally { a.gate.resolve(); await q.pending; }
  });

for (const depart of [false, true]) test(
  depart ? "Library use-copy original Worker200 preserves a newer actual Activity route after preview Close"
    : "Library use-copy healthy original Worker200 arrives at the captured open Document",
  { concurrency: false, timeout: 45_000 }, async t => {
    const q = await libraryAckPage(t, "copy"), { f, h, owner, worker } = q;
    assert.equal(q.originalBlock.scope, "library"); assert.equal(q.originalBlock.documentId, "");
    assert.equal(h.store.projection.get().libraryBlockRelations.filter(relation => relation.fromBlockId === reusableId).length, 0);
    const preview = f.find("a", node => node.owner === owner && classed(node, "asset-focus-trigger")
      && libraryFocusFromRoute(node.attributes.href)?.kind === "block" && libraryFocusFromRoute(node.attributes.href)?.id === reusableId);
    f.native.emit("pointerdown", preview.port); f.native.focus(preview.port);
    await f.act(preview, "click", { button: 0 });
    assert.equal(libraryFocusFromRoute(h.store.route.get())?.id, reusableId);
    assert.equal(f.tree().visible("dialog").filter(node => node.owner === owner && classed(node, "library-focus-dialog") && node.port.open).length, 1);
    const a = await q.arm();
    const copy = f.find("button", node => node.owner === owner && node.text === f.i18n.system("Use a copy in the open document"));
    f.native.emit("pointerdown", copy.port); f.native.focus(copy.port);
    q.pending = f.act(copy); q.pending.catch(() => {});
    let activityRoute = null;
    try {
      await q.reached(); await f.settle();
      if (depart) {
        const close = f.find("button", node => node.owner === owner && classed(node, "modal-close")
          && node.attributes["aria-label"] === f.i18n.t("projects.closePreview", "Close preview"));
        f.native.emit("pointerdown", close.port); f.native.focus(close.port);
        await f.act(close);
        assert.equal(libraryFocusFromRoute(h.store.route.get()), null);
        assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0,
          "Actual preview Close precedes the new task gesture; no inert background activation");
        const activity = q.task("/activity"); activityRoute = activity.attributes.href;
        f.native.emit("pointerdown", activity.port); f.native.focus(activity.port);
        await f.act(activity, "click", { button: 0 });
        assert.equal(h.store.route.get(), activityRoute); assert.equal(owner.isConnected, false);
        assert.equal(f.components().filter(component => component.tag === "forma-activity").length, 1);
        assert.ok(h.store.sourceOwnershipActive(q.source) && h.store.authorizationScopeActive(q.authorization));
      }
      a.gate.resolve(); await q.pending; await f.settle();
      const event = await libraryAckEffects(q);
      const copies = h.store.projection.get().libraryBlocks.filter(block => block.properties.copied_from_block_id === reusableId);
      assert.equal(copies.length, 1); assert.equal(copies[0].id, event.payload.block_id);
      assert.equal(copies[0].documentId, worker.documentId);
      t.diagnostic(JSON.stringify({ originalEvent: a.sql, original200Delivered: a.delivered,
        canonicalCopyDocument: event.payload.document_id, originalBlockId: reusableId,
        depart, newerRoute: activityRoute, observedRoute: h.store.route.get(),
        sourceAndFiscalPreserved: true, canceledServerWriteClaim: false }));
      if (depart) assert.equal(h.store.route.get(), activityRoute,
        "The original copy may commit in its captured Document but must not force a newer Activity owner back to Workspace");
      else {
        assert.equal(documentIdFromRoute(h.store.route.get()), worker.documentId);
        assert.equal(f.components().filter(component => component.tag === "forma-workspace").length, 1);
        assert.equal(f.components().filter(component => component.tag === "forma-library").length, 0);
      }
    } finally { a.gate.resolve(); await q.pending; }
  });


// Defensive caller-lifetime controls. The four original C50 case bodies above
// are unchanged; these reuse the same native page, genuine Worker gate and
// closed exact-event/financial/Resume observer.
test("Library held removal ACK stays retired after a keyboard gesture without a focus change",
  { concurrency: false, timeout: 45_000 }, async t => {
    const q = await libraryAckPage(t, "remove"), { f, h, owner } = q;
    await f.act(f.find("button", node => node.owner.tag === "forma-ui-segmented-control"
      && node.owner.parentElement === owner && node.owner.label === f.i18n.t("projects.outputHistory", "Output history")
      && node.text === f.i18n.t("projects.kept", "Kept") + " 1"));
    assert.equal(f.tree().visible("article").filter(node => node.owner === owner && classed(node, "library-output")).length, 1);
    libraryAckFallbackQuery(q);
    const a = await q.arm();
    const remove = f.find("button", node => node.owner === owner && String(node.attributes["aria-pressed"]) === "true"
      && node.text === f.i18n.t("projects.removeKept", "Remove from kept"));
    f.native.emit("pointerdown", remove.port); f.native.focus(remove.port);
    q.pending = f.act(remove); q.pending.catch(() => {});
    try {
      await q.reached();
      // Do not redraw before this key: it is delivered to the genuinely current
      // focused native Remove control, not a retained disconnected callback.
      assert.ok(remove.port.isConnected && f.renderer.nodes.includes(remove.port));
      assert.equal(remove.port.matches(":disabled"), false);
      assert.equal(f.native.document.activeElement, remove.port);
      const focusStart = f.native.nativeFocus.length;
      f.native.emit("keydown", remove.port);
      assert.equal(f.native.document.activeElement, remove.port, "The keyboard interruption does not manufacture a focus change");
      assert.equal(h.store.route.get(), a.route);
      a.gate.resolve(); await q.pending; await f.settle();
      const event = await libraryAckEffects(q);
      assert.equal(event.type, "RemovedFromLibrary");
      assert.equal(h.store.projection.get().libraryArtifacts.find(artifact => artifact.id === "saved-scene-story").library, false);
      assert.equal(h.store.route.get(), a.route);
      const late = f.native.nativeFocus.slice(focusStart);
      t.diagnostic(JSON.stringify({ originalEvent: a.sql, keydownOnCurrentFocusedControl: true,
        focusChangedBeforeACK: false, lateFocusCalls: late.length, sourceAndFiscalPreserved: true }));
      assert.equal(late.length, 0, "An unchanged focused element must not revive a lease retired by the newer key gesture");
    } finally { a.gate.resolve(); await q.pending; }
  });

test("Library held copy ACK cannot regain navigation after actual Activity and exact preview route return",
  { concurrency: false, timeout: 45_000 }, async t => {
    const q = await libraryAckPage(t, "copy"), { f, h, owner, worker } = q;
    const preview = f.find("a", node => node.owner === owner && classed(node, "asset-focus-trigger")
      && libraryFocusFromRoute(node.attributes.href)?.kind === "block" && libraryFocusFromRoute(node.attributes.href)?.id === reusableId);
    f.native.emit("pointerdown", preview.port); f.native.focus(preview.port);
    await f.act(preview, "click", { button: 0 });
    const a = await q.arm();
    const copy = f.find("button", node => node.owner === owner && node.text === f.i18n.system("Use a copy in the open document"));
    f.native.emit("pointerdown", copy.port); f.native.focus(copy.port);
    q.pending = f.act(copy); q.pending.catch(() => {});
    try {
      await q.reached(); await f.settle();
      const close = f.find("button", node => node.owner === owner && classed(node, "modal-close")
        && node.attributes["aria-label"] === f.i18n.t("projects.closePreview", "Close preview"));
      f.native.emit("pointerdown", close.port); f.native.focus(close.port);
      await f.act(close);
      assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
      const activity = q.task("/activity");
      f.native.emit("pointerdown", activity.port); f.native.focus(activity.port);
      await f.act(activity, "click", { button: 0 });
      assert.equal(owner.isConnected, false, "The original Library really departed before route return");
      assert.equal(f.components().filter(component => component.tag === "forma-activity").length, 1);
      const library = q.task("/library");
      f.native.emit("pointerdown", library.port); f.native.focus(library.port);
      await f.act(library, "click", { button: 0 });
      const currentOwners = f.components().filter(component => component.tag === "forma-library");
      assert.equal(currentOwners.length, 1);
      const currentOwner = currentOwners[0];
      const reopen = f.find("a", node => node.owner === currentOwner && classed(node, "asset-focus-trigger")
        && libraryFocusFromRoute(node.attributes.href)?.kind === "block" && libraryFocusFromRoute(node.attributes.href)?.id === reusableId);
      f.native.emit("pointerdown", reopen.port); f.native.focus(reopen.port);
      await f.act(reopen, "click", { button: 0 });
      assert.equal(h.store.route.get(), a.route, "The exact original raw route is restored through current native actions");
      assert.equal(h.store.projection.get().projectId, worker.projectId);
      assert.equal(h.store.projection.get().documentId, worker.documentId);
      assert.ok(h.store.sourceOwnershipActive(q.source) && h.store.authorizationScopeActive(q.authorization));
      assert.equal(f.tree().visible("dialog").filter(node => node.owner === currentOwner
        && classed(node, "library-focus-dialog") && node.port.open).length, 1);
      a.gate.resolve(); await q.pending; await f.settle();
      const event = await libraryAckEffects(q);
      const copies = h.store.projection.get().libraryBlocks.filter(block => block.properties.copied_from_block_id === reusableId);
      assert.equal(copies.length, 1); assert.equal(copies[0].id, event.payload.block_id);
      assert.equal(copies[0].documentId, worker.documentId);
      t.diagnostic(JSON.stringify({ originalEvent: a.sql, exactRouteRestoredBeforeACK: a.route,
        observedRoute: h.store.route.get(), sameLibraryInstanceAfterReturn: currentOwner === owner,
        canonicalCopyDocument: event.payload.document_id, sourceAndFiscalPreserved: true }));
      assert.equal(h.store.route.get(), a.route, "Route equality after departure cannot revive the retired original copy continuation");
      assert.ok(currentOwner.isConnected);
      assert.equal(f.tree().visible("dialog").filter(node => node.owner === currentOwner
        && classed(node, "library-focus-dialog") && node.port.open).length, 1);
    } finally { a.gate.resolve(); await q.pending; }
  });


// Distinct from an interaction arriving AFTER dispatch: existing cached raw
// work is already present before this new Copy gesture begins. Reuse the exact
// original copy observer above; no fixture defaults, requests or receipts change.
async function cLibraryCopyCustodyClick(q, node) {
  const { f } = q;
  assert.ok(node.port?.isConnected && f.renderer.nodes.includes(node.port));
  assert.equal(node.hiddenBy, null); assert.equal(node.port.matches(":disabled"), false);
  assert.equal(typeof node.handlers.click, "function");
  f.native.emit("pointerdown", node.port); f.native.focus(node.port);
  await f.act(node, "click", { button: 0, defaultPrevented: false }); await f.settle();
}

async function cLibraryCopyCustodyNoWrite(q, floor) {
  const { f, h, worker, resumes, armed } = q;
  await f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground();
  assert.equal(armed.request, null); assert.equal(armed.receipt, null); assert.equal(armed.delivered, 0);
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), armed.history);
  assert.deepEqual(financial(worker), armed.financial);
  assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), armed.clientReceipts);
  assert.equal(JSON.stringify(h.store.events.get()), floor.events); assert.equal(h.store.head.get(), floor.head);
  assert.ok(h.store.sourceOwnershipActive(q.source) && h.store.authorizationScopeActive(q.authorization));
  assert.deepEqual(h.store.projection.get().libraryBlocks.find(block => block.id === reusableId), q.originalBlock);
  assert.equal(h.store.content.get()[worker.contentRef], worker.content);
  assert.deepEqual(h.store.eventWriteAcknowledgments(armed.acknowledgmentOwner).map(value => value.observationId), armed.oldObservations);
  assert.deepEqual(h.requests.slice(floor.requests).filter(request => request.init.method === "POST"
    && !resumes.isReadOnlyResume(request)), [], "Refusal and local resolution cannot issue Copy, Save or a provider/approval command");
}

for (const dirty of [false, true]) test(
  "C Library use-copy pre-existing raw custody / " + (dirty ? "refuses while original cached edits remain reachable" : "healthy exact original copy and destination"),
  { concurrency: false, timeout: 45_000 }, async t => {
    const q = await libraryAckPage(t, "copy"), { f, h, owner, worker } = q;
    await registerCalmFullPageComponents(f, ["forma-library-block-editor"]);
    const controls = () => f.find("button", node => node.owner === owner && node.attributes["data-context-controls-id"] === reusableId);
    await cLibraryCopyCustodyClick(q, controls());
    const editors = f.components().filter(component => component.tag === "forma-library-block-editor"
      && component.store === h.store && component.blockId === reusableId && component.isConnected);
    assert.equal(editors.length, 1); const editor = editors[0];
    assert.equal(editor.closest("forma-library"), owner);
    const field = () => f.find("input", node => node.owner === editor && String(node.attributes.maxlength) === "96");
    assert.equal(field().port.value, q.originalBlock.handle); assert.equal(field().port.matches(":disabled"), false);
    const raw = "  direction/unsent-before-copy — 未保存  ";
    if (dirty) {
      const input = field(); f.native.emit("pointerdown", input.port); f.native.focus(input.port);
      input.port.value = raw; await f.act(input, "input"); await f.settle();
      assert.equal(field().port.value, raw); assert.equal(field().properties.value, raw);
    }
    const part = field().propertyParts.value; assert.equal(typeof part, "string");
    await cLibraryCopyCustodyClick(q, f.find("button", node => node.owner === editor
      && node.text === f.i18n.system("Back to Library")));
    assert.equal(editor.isConnected, false); assert.ok(owner.isConnected);
    assert.equal(f.tree().visible("form").some(node => node.owner === editor), false,
      "Back really detaches the original editor; no hidden field is activated");
    const previews = f.tree().visible("a").filter(node => node.owner === owner && classed(node, "asset-focus-trigger")
      && libraryFocusFromRoute(node.attributes.href)?.kind === "block" && libraryFocusFromRoute(node.attributes.href)?.id === reusableId);
    assert.equal(previews.length, 1); await cLibraryCopyCustodyClick(q, previews[0]);
    const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === owner
      && classed(node, "library-focus-dialog") && node.attributes["aria-labelledby"] === "block-focus-title");
    assert.equal(dialogs.length, 1); const dialog = dialogs[0]; assert.equal(dialog.port.open, true);
    const blocks = tree.visible("forma-context-block").filter(node => inside(node, dialog) && node.component?.block?.id === reusableId);
    assert.equal(blocks.length, 1); assert.equal(blocks[0].component.readOnly, true); assert.equal(blocks[0].component.store, h.store);
    const copies = tree.visible("button").filter(node => node.owner === owner && inside(node, dialog)
      && node.text === f.i18n.system("Use a copy in the open document"));
    assert.equal(copies.length, 1);
    assert.equal(copies[0].port.matches(":disabled"), false); assert.equal(copies[0].hiddenBy, null);
    const a = await q.arm(), floor = { events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length };
    assert.equal(a.route, h.store.route.get()); assert.equal(libraryFocusFromRoute(a.route)?.id, reusableId);
    const currentTree = f.tree(), currentDialogs = currentTree.visible("dialog").filter(node => node.owner === owner
      && classed(node, "library-focus-dialog") && node.attributes["aria-labelledby"] === "block-focus-title" && node.port.open);
    assert.equal(currentDialogs.length, 1);
    const currentCopies = currentTree.visible("button").filter(node => node.owner === owner && inside(node, currentDialogs[0])
      && node.text === f.i18n.system("Use a copy in the open document"));
    assert.equal(currentCopies.length, 1); const copy = currentCopies[0];
    assert.ok(copy.port.isConnected && f.renderer.nodes.includes(copy.port)); assert.equal(copy.port.matches(":disabled"), false);
    f.native.emit("pointerdown", copy.port); f.native.focus(copy.port);
    let finished = false, failure = null;
    q.pending = f.act(copy, "click", { button: 0, defaultPrevented: false });
    void q.pending.then(() => { finished = true; }, error => { failure = error; finished = true; });
    try {
      // Old runtime is permitted to reach its genuine erroneous command. A
      // repaired pre-dispatch refusal instead settles the actual handler with
      // no request. Neither branch invents an ACK or waits for a forbidden call.
      await untilScene(() => Boolean(a.receipt || a.error || finished), "Original Copy reaches its real receipt or the actual current handler refuses before dispatch");
      if (a.error || failure) throw a.error ?? failure;
      let copied = null;
      if (a.receipt) {
        await q.reached(); assert.equal(a.response.status, 200); assert.equal(a.response.bodyUsed, false);
        a.gate.resolve(); await q.pending; await f.settle(); copied = await libraryAckEffects(q);
      } else { await q.pending; await cLibraryCopyCustodyNoWrite(q, floor); }
      t.diagnostic("C_LIBRARY_COPY_PREEXISTING_CUSTODY " + JSON.stringify({ dirty, originalRoute: a.route,
        route: h.store.route.get(), libraryConnected: owner.isConnected, originalEditorConnected: editor.isConnected,
        originalCopyRequests: Number(Boolean(a.request)), actualWorkerStatus: a.response?.status ?? null,
        originalCopyEvent: a.sql ?? null, exactCopiedDocument: copied?.payload.document_id ?? null,
        originalDelivered: a.delivered, sourceHistoryReceiptFiscalExact: true,
        evidence: "actual current native Controls/Back/read-only Copy and original RAM Worker observer; not a canceled write or physical-focus claim" }));
      if (!dirty) {
        assert.ok(copied); assert.equal(copied.type, "BlockCreated"); assert.equal(copied.payload.document_id, worker.documentId);
        assert.equal(h.store.projection.get().libraryBlocks.filter(block => block.properties.copied_from_block_id === reusableId).length, 1);
        assert.equal(documentIdFromRoute(h.store.route.get()), worker.documentId); assert.equal(owner.isConnected, false);
        assert.equal(f.components().filter(component => component.tag === "forma-workspace" && component.store === h.store && component.isConnected).length, 1);
      } else {
        assert.equal(h.store.route.get(), a.route, "Copy is not permission to leave Library and discard already-existing cached raw work");
        assert.ok(owner.isConnected); assert.equal(a.request, null, "The raw-work refusal precedes the original copy command");
        assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
        assert.equal(f.tree().visible("dialog").filter(node => node.owner === owner && classed(node, "library-focus-dialog") && node.port.open).length, 1,
          "Refusal leaves the original current preview visible; it does not auto-close or reopen the editor");
        await cLibraryCopyCustodyNoWrite(q, floor);
        const close = f.find("button", node => node.owner === owner && classed(node, "modal-close")
          && node.attributes["aria-label"] === f.i18n.t("projects.closePreview", "Close preview"));
        await cLibraryCopyCustodyClick(q, close);
        assert.equal(libraryFocusFromRoute(h.store.route.get()), null);
        await cLibraryCopyCustodyClick(q, controls());
        const current = f.components().filter(component => component.tag === "forma-library-block-editor"
          && component.store === h.store && component.blockId === reusableId && component.isConnected);
        assert.deepEqual(current, [editor], "Existing local Controls reopens the same retained raw owner for resolution");
        assert.equal(field().port.value, raw); assert.equal(field().properties.value, raw); assert.equal(field().propertyParts.value, part);
        await cLibraryCopyCustodyNoWrite(q, floor);
      }
    } finally { a.gate.resolve(); if (q.pending) await q.pending; }
  });


// Separate manual artifact-card executor. Reuse libraryAckPage's original
// Store/Worker/private-row/fiscal/Resume observer; only kind="artifact" admits
// this exact retained one-part story shape. No production event builder is used
// to manufacture the expected event, and no generic POST is permitted.
function cLibraryArtifactOriginalEvent(q, event, head) {
  const { worker, originalArtifact: artifact } = q, content = JSON.parse(worker.content);
  assert.equal(artifact.id, "saved-scene-story"); assert.equal(artifact.kind, "short_story");
  assert.equal(artifact.documentId, worker.documentId); assert.equal(artifact.contentRef, worker.contentRef);
  assert.equal(artifact.items.length, 1); assert.equal(content.items.length, 1);
  assert.equal(content.content_markdown, "The keeper checks harbor position 1.");
  assert.match(event.payload.block_id, uuid); assert.match(event.payload.properties.context_set_id, uuid);
  const id = event.payload.block_id, set = event.payload.properties.context_set_id;
  assert.notEqual(id, q.originalBlock.id);
  const expected = { type: "BlockCreated", payload: {
    project_id: worker.projectId, document_id: worker.documentId, source_surface: "library",
    source_artifact_id: artifact.id, source_artifact_kind: "short_story", source_document_id: artifact.documentId,
    block_id: id, type: "message", handle: "message/saved-complete-story-ne-story",
    position: "z" + String(head + 1).padStart(8, "0"), properties: {
      label: artifact.title, text: content.content_markdown, artifact_markdown: content.content_markdown,
      subtype: "Narrative source", intent: "include", authority: "authored", weight: 0.9,
      source_artifact_id: artifact.id, source_artifact_kind: "short_story", source_document_id: artifact.documentId,
      source_artifact_content_ref: artifact.contentRef, source_artifact_input_ref: artifact.inputRef ?? null,
      artifact_summary: artifact.summary, artifact_item_count: artifact.itemCount,
      artifact_structure: { presentation: content.presentation ?? artifact.presentation, items: [{
        source_artifact_item_id: artifact.items[0].id, title: content.items[0].title, body: content.items[0].body,
        notes: content.items[0].notes, image_prompt: content.items[0].image_prompt,
        context_group_ids: content.items[0].context_group_ids, slide: content.items[0].slide,
      }] },
      media_url: artifact.mediaUrl, media_type: artifact.mediaType, provider: artifact.provider, model_id: artifact.modelId,
      input_mode: "full_output", context_set_id: set, context_set_root_id: id,
      copied_as_context_set: true, semantic_isolation: true,
      combined_context_memberships: [{ contextSetId: set, name: artifact.title, role: "sequence",
        target: artifact.title + " narrative continuity", application: "ordered", relativity: 1,
        memberOrder: 0, sourceCanvasId: "" }], created_from: "library",
    },
  } };
  assert.deepEqual(event, JSON.parse(JSON.stringify(expected)), "Exact original artifact request preserves complete retained content and lineage");
}

function cLibraryArtifactOwner(q) {
  const owners = q.f.components().filter(component => component.tag === "forma-library"
    && component.isConnected && component.store === q.h.store);
  assert.equal(owners.length, 1); return owners[0];
}

async function cLibraryArtifactAll(q, owner = cLibraryArtifactOwner(q)) {
  const button = q.f.find("button", node => node.owner.tag === "forma-ui-segmented-control"
    && node.owner.parentElement === owner && node.owner.label === q.f.i18n.t("projects.libraryContent", "Library content")
    && node.text === q.f.i18n.t("projects.filter.all", "All"));
  await cLibraryCopyCustodyClick(q, button);
}

function cLibraryArtifactAction(q, { adopted = false, owner = cLibraryArtifactOwner(q) } = {}) {
  const tree = q.f.tree(), cards = tree.visible("article").filter(node => node.owner === owner
    && classed(node, "library-artifact-output") && tree.visible("a").some(link => inside(link, node)
      && classed(link, "library-artifact-open") && libraryFocusFromRoute(link.attributes.href)?.kind === "artifact"
      && libraryFocusFromRoute(link.attributes.href)?.id === q.originalArtifact.id));
  assert.equal(cards.length, 1, "The current exact saved artifact owns the native action");
  const name = "\u2068" + q.originalArtifact.title + "\u2069";
  const label = q.f.i18n.t(adopted ? "projects.editInputNamed" : "projects.useEditNamed",
    adopted ? "Edit input: {name}" : "Use & edit: {name}", { name });
  const actions = tree.visible("button").filter(node => node.owner === owner && inside(node, cards[0])
    && node.attributes["aria-label"] === label);
  assert.equal(actions.length, 1); const action = actions[0];
  assert.ok(action.port.isConnected && q.f.renderer.nodes.includes(action.port));
  assert.equal(action.hiddenBy, null); assert.equal(action.port.matches(":disabled"), false);
  assert.equal(typeof action.handlers.click, "function"); return action;
}

async function cLibraryArtifactRaw(q) {
  const { f, h, owner } = q;
  await registerCalmFullPageComponents(f, ["forma-library-block-editor"]);
  const controls = () => f.find("button", node => node.owner === owner && node.attributes["data-context-controls-id"] === reusableId);
  await cLibraryCopyCustodyClick(q, controls());
  const editors = f.components().filter(component => component.tag === "forma-library-block-editor"
    && component.isConnected && component.store === h.store && component.blockId === reusableId);
  assert.equal(editors.length, 1); const editor = editors[0]; assert.equal(editor.closest("forma-library"), owner);
  const field = () => f.find("input", node => node.owner === editor && String(node.attributes.maxlength) === "96");
  assert.equal(field().port.value, q.originalBlock.handle);
  const raw = "  direction/before-artifact-copy — 未保存  ", input = field();
  f.native.emit("pointerdown", input.port); f.native.focus(input.port); input.port.value = raw;
  await f.act(input, "input"); assert.equal(field().port.value, raw); assert.equal(field().properties.value, raw);
  const part = field().propertyParts.value; assert.equal(typeof part, "string");
  const back = () => f.find("button", node => node.owner === editor && node.text === f.i18n.system("Back to Library"));
  await cLibraryCopyCustodyClick(q, back());
  assert.equal(editor.isConnected, false); assert.ok(owner.isConnected);
  assert.equal(f.tree().visible("form").some(node => node.owner === editor), false);
  await cLibraryArtifactAll(q, owner);
  return { editor, field, controls, back, raw, part };
}

async function cLibraryArtifactUnchanged(q, floor) {
  const { h, worker, resumes } = q;
  await q.f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground();
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), floor.history);
  assert.deepEqual(financial(worker), floor.financial);
  assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), floor.clientReceipts);
  assert.equal(JSON.stringify(h.store.events.get()), floor.events); assert.equal(h.store.head.get(), floor.head);
  assert.ok(h.store.sourceOwnershipActive(q.source) && h.store.authorizationScopeActive(q.authorization));
  assert.deepEqual(h.store.projection.get().libraryArtifacts.find(item => item.id === q.originalArtifact.id), q.originalArtifact);
  assert.equal(h.store.content.get()[worker.contentRef], worker.content);
  assert.deepEqual(h.requests.slice(floor.requests).filter(request => request.init.method === "POST"
    && !resumes.isReadOnlyResume(request)), [], "Existing input Edit and deliberate local resolution issue no replacement copy or other command");
}

for (const mode of ["healthy", "cached-raw", "newer-search"]) test(
  "C Library artifact Use & edit original custody / " + mode,
  { concurrency: false, timeout: 45_000 }, async t => {
    const q = await libraryAckPage(t, "artifact"), { f, h, owner, worker } = q;
    if(mode === "newer-search")cManualNativeLifetime(t,q,{librarySearch:true});
    assert.equal(h.store.projection.get().libraryBlocks.some(block => block.properties.source_artifact_id === q.originalArtifact.id), false);
    const raw = mode === "cached-raw" ? await cLibraryArtifactRaw(q) : null;
    const a = await q.arm(), floor = { events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length };
    const action = cLibraryArtifactAction(q); f.native.emit("pointerdown", action.port); f.native.focus(action.port);
    let finished = false, failure = null;
    q.pending = f.act(action, "click", { button: 0, defaultPrevented: false });
    void q.pending.then(() => { finished = true; }, error => { failure = error; finished = true; });
    let search = null, newerRaw = null, lateFocus = 0, copied = null;
    try {
      await untilScene(() => Boolean(a.receipt || a.error || finished), "The actual artifact action reaches its original Worker response or refuses before dispatch");
      if (a.error || failure) throw a.error ?? failure;
      if (a.receipt) {
        await q.reached(); assert.equal(a.response.status, 200); assert.equal(a.response.bodyUsed, false);
        if (mode === "newer-search") {
          search = f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === owner);
          const originalSearch=search.port;
          f.native.emit("pointerdown", search.port); f.native.focus(search.port);
          newerRaw = "  newer Library search B — 未保存  "; search.port.value = newerRaw;
          await f.act(search, "input");
          search = f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === owner);
          assert.equal(search.port,originalSearch);assert.ok(originalSearch.isConnected&&f.renderer.nodes.includes(originalSearch));
          assert.equal(originalSearch.closest("forma-shell"),f.host);
          assert.equal(search.port.value, newerRaw); assert.equal(h.store.route.get(), a.route);
          assert.ok(owner.isConnected && h.store.sourceOwnershipActive(q.source) && h.store.authorizationScopeActive(q.authorization));
          f.native.emit("pointerdown", search.port); f.native.focus(search.port);
          lateFocus = f.native.nativeFocus.length;
        }
        a.gate.resolve(); await q.pending; await f.settle(); copied = await libraryAckEffects(q);
      } else { await q.pending; await cLibraryCopyCustodyNoWrite(q, floor); }
      t.diagnostic("C_LIBRARY_ARTIFACT_COPY_CUSTODY " + JSON.stringify({ mode, originalRoute: a.route,
        currentRoute: h.store.route.get(), libraryConnected: owner.isConnected,
        originalWorkerStatus: a.response?.status ?? null, originalEvent: a.sql ?? null,
        delivered: a.delivered, exactOriginalHistoryPrivateFiscalAndResume: true,
        evidence: "actual native Library action and original RAM Worker receipt; not server cancellation or physical focus" }));
      if (mode === "cached-raw") {
        assert.equal(h.store.route.get(), a.route, "Artifact reuse cannot abandon raw work already retained by Library");
        assert.ok(owner.isConnected); assert.equal(a.request, null, "Existing raw refusal precedes the original copy dispatch");
        assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
        assert.equal(raw.editor.isConnected, false, "Refusal never silently reopens or discards the retained editor");
        await cLibraryCopyCustodyNoWrite(q, floor);
        await cLibraryCopyCustodyClick(q, raw.controls());
        assert.equal(raw.editor.isConnected, true); assert.equal(raw.field().port.value, raw.raw);
        assert.equal(raw.field().properties.value, raw.raw); assert.equal(raw.field().propertyParts.value, raw.part);
        const input = raw.field(); f.native.emit("pointerdown", input.port); f.native.focus(input.port);
        input.port.value = q.originalBlock.handle; await f.act(input, "input");
        assert.equal(raw.field().port.value, q.originalBlock.handle);
        await cLibraryCopyCustodyClick(q, raw.back()); await cLibraryArtifactAll(q, owner);
        await cLibraryCopyCustodyNoWrite(q, floor);
        const fresh = cLibraryArtifactAction(q); f.native.emit("pointerdown", fresh.port); f.native.focus(fresh.port);
        q.pending = f.act(fresh, "click", { button: 0, defaultPrevented: false }); void q.pending.catch(() => {});
        await q.reached(); a.gate.resolve(); await q.pending; await f.settle(); copied = await libraryAckEffects(q);
      }
      assert.ok(copied); assert.equal(copied.type, "BlockCreated"); assert.equal(copied.payload.document_id, worker.documentId);
      const roots = h.store.projection.get().libraryBlocks.filter(block => block.properties.source_artifact_id === q.originalArtifact.id
        && !block.properties.source_artifact_item_id);
      assert.equal(roots.length, 1); assert.equal(roots[0].id, copied.payload.block_id);
      assert.equal(roots[0].properties.artifact_markdown, JSON.parse(worker.content).content_markdown);
      assert.deepEqual(h.store.projection.get().libraryArtifacts.find(item => item.id === q.originalArtifact.id), q.originalArtifact);
      if (mode === "newer-search") {
        assert.equal(h.store.route.get(), a.route, "Original copy success is not a fresh departure gesture after newer Library intent");
        assert.ok(owner.isConnected);
        const current = f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === owner);
        assert.equal(current.port.value, newerRaw); assert.equal(f.native.document.activeElement, current.port);
        assert.equal(f.native.nativeFocus.length, lateFocus, "No late native focus belongs to the retired original copy");
      } else {
        assert.equal(documentIdFromRoute(h.store.route.get()), worker.documentId); assert.equal(owner.isConnected, false);
        const workspaces = f.components().filter(component => component.tag === "forma-workspace" && component.isConnected && component.store === h.store);
        assert.equal(workspaces.length, 1); assert.equal(h.store.ui.editingBlockId, roots[0].id);
      }
      if (mode === "healthy") {
        // Preserve the known-existing zero-write branch: return deliberately and
        // activate the current Edit input, never recreate the original artifact.
        await cLibraryCopyCustodyClick(q, q.task("/library"));
        const currentOwner = cLibraryArtifactOwner(q); await cLibraryArtifactAll(q, currentOwner);
        const before = { history: await readWorkspaceEvents(worker.env, worker.streamId), financial: financial(worker),
          clientReceipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
          events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length };
        const edit = cLibraryArtifactAction(q, { adopted: true, owner: currentOwner });
        await cLibraryCopyCustodyClick(q, edit); await cLibraryArtifactUnchanged(q, before);
        assert.equal(documentIdFromRoute(h.store.route.get()), worker.documentId);
        assert.equal(h.store.ui.editingBlockId, roots[0].id);
        assert.equal(h.store.projection.get().libraryBlocks.filter(block => block.properties.source_artifact_id === q.originalArtifact.id).length, 1);
        assert.equal(a.delivered, 1, "Known-existing Edit does not deliver or invent another original receipt");
      }
    } finally { a.gate.resolve(); if (q.pending) await q.pending; }
  });


// Four explicitly selected manual callers. These additions share the original
// Library ACK ledger; no second receipt store or general POST allowance exists.
const cManualCallers = ["output-card", "generation-actions", "prompt-fan", "artifact-viewer"];
const cManualSource = caller => ({ "output-card": "output-card", "generation-actions": "document-generation-actions",
  "prompt-fan": "prompt-fan-comparison", "artifact-viewer": "document-artifact-viewer" })[caller];
const cManualImageId = "c-manual-retained-image";

async function cManualSeed(t, h, caller) {
  assert.ok(cManualCallers.includes(caller));
  if (caller === "artifact-viewer") {
    await appendAuditEvent(h.worker.env, h.worker.streamId, "worker:renderer", "DocumentRenderCompleted", {
      project_id: h.worker.projectId, document_id: h.worker.documentId, artifact_id: "c-manual-other-story-b",
      artifact_kind: "short_story", title: "Other retained story B", summary: "Separate current viewer B",
      content_ref: h.worker.contentRef, source_block_versions: [{ block_id: "scene-reuse-direction", version: 1 }],
      item_count: 1, items: [{ id: "other-story-part-0", title: "Beat 1" }],
    });
    return;
  }
  // Same real upload/bucket contract as the existing Source-continuation image
  // fixture. The initial generation row is explicitly historical simulation;
  // it is not a provider result, charge, generation request or new permission.
  const rows = new Map();
  h.worker.env.MEDIA = {
    async put(key, value, options = {}) { const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      rows.set(key, { bytes, customMetadata: structuredClone(options.customMetadata ?? {}), httpMetadata: structuredClone(options.httpMetadata ?? {}) }); return { key }; },
    async head(key) { const row = rows.get(key); return row ? { key, size: row.bytes.length, customMetadata: structuredClone(row.customMetadata),
      httpMetadata: structuredClone(row.httpMetadata), writeHttpMetadata(headers) { if (row.httpMetadata.contentType) headers.set("content-type", row.httpMetadata.contentType); } } : null; },
    async get(key) { const row = rows.get(key); return row ? { key, size: row.bytes.length, body: new Response(row.bytes).body,
      customMetadata: structuredClone(row.customMetadata), httpMetadata: structuredClone(row.httpMetadata),
      arrayBuffer: async () => row.bytes.slice().buffer,
      writeHttpMetadata(headers) { if (row.httpMetadata.contentType) headers.set("content-type", row.httpMetadata.contentType); } } : null; },
    async delete(key) { rows.delete(key); },
  };
  const form = new FormData(); form.append("file", new File([png({ width: 1, height: 1 })], "manual-retained.png", { type: "image/png" }));
  form.append("rightsConfirmed", "true"); form.append("nonSensitiveConfirmed", "true");
  const response = await h.worker.request("/api/media", { method: "POST", body: form });
  assert.equal(response.status, 200, await response.clone().text()); const media = await response.json();
  assert.ok(media.url.startsWith("/api/media/")); assert.equal(rows.size, 1);
  await appendAuditEvent(h.worker.env, h.worker.streamId, "worker:renderer", "GenerationCompleted", {
    project_id: h.worker.projectId, document_id: h.worker.documentId, object_ids: [cManualImageId],
    generation_id: "c-manual-historical-generation", simulation: true, provider: "simulation", model_id: "fixture",
    media_url: media.url, media_type: "image/png", image_width: 1, image_height: 1, source_surface: "document",
    ...(caller === "prompt-fan" ? { prompt_fan_id: "c-manual-retained-fan", prompt_technique: "prose" } : {}),
  });
}

function cManualOriginalInputs(q, events, head) {
  if (q.slides) { cSlidesMenuOriginalInput(q, events, head); return; }
  const source = q.libraryViewer ? "library-artifact-viewer" : cManualSource(q.manual); assert.ok(source);
  if (q.manual === "artifact-viewer") {
    assert.equal(events.length, 1); assert.equal(events[0].payload.source_surface, source);
    assert.equal(events[0].payload.properties.created_from, source);
    // The frozen story matcher remains exact. Validate the two caller-specific
    // source strings first, then reuse its otherwise identical original shape.
    cLibraryArtifactOriginalEvent(q, { ...events[0], payload: { ...events[0].payload, source_surface: "library",
      properties: { ...events[0].payload.properties, created_from: "library" } } }, head);
    return;
  }
  const output = q.originalOutput, { worker } = q;
  assert.ok(output && output.id === cManualImageId && output.documentId === worker.documentId && output.mediaUrl);
  assert.equal(output.contentRef, null, "The historical fixture has no unverified private direction payload");
  assert.equal(events.length, 2); const referenceId = events[0].payload.reference_id, blockId = events[1].payload.block_id;
  assert.match(referenceId, uuid); assert.match(blockId, uuid); assert.notEqual(referenceId, blockId);
  const shared = { project_id: worker.projectId, document_id: worker.documentId, source_surface: source,
    source_output_id: output.id, source_generation_id: output.generationId, source_document_id: output.documentId };
  const title = output.title?.trim() || (output.quality === "low" ? "Draft" : "Full-quality") + " image input";
  const expected = [
    { type: "ReferenceIngested", payload: { ...shared, reference_id: referenceId, source_type: "generated-output",
      source_ref: output.mediaUrl, media_url: output.mediaUrl, media_type: output.mediaType,
      rights_class: "account-generated", provider: output.provider, model_id: output.modelId } },
    { type: "BlockCreated", payload: { ...shared, block_id: blockId, type: "reference",
      handle: "reference/generated-" + output.id.slice(-8), position: "z" + String(head + 1).padStart(8, "0"), properties: {
        reference_id: referenceId, label: title, text: "Use this selected generation as visual inspiration for the next output.",
        output_palette: [], palette: [], image_caption: title, media_url: output.mediaUrl, media_type: output.mediaType, source_mime_type: output.mediaType,
        width: output.width, height: output.height, focal_point: output.focalPoint, source_output_id: output.id,
        source_generation_id: output.generationId, source_output_content_ref: output.contentRef, source_output_prompt_ref: output.promptRef,
        source_document_id: output.documentId, prompt_technique: output.promptTechnique, prompt_fan_id: output.promptFanId,
        pixel_reference_mode: "inspiration", intent: "include", authority: "authored", weight: 0.8,
        input_mode: "full_output", created_from: source,
      } } },
  ];
  assert.deepEqual(events, JSON.parse(JSON.stringify(expected)), "The original two-event image copy retains actual upload custody and lineage");
}

// Explicit opt-in native lifetime. Actual callbacks/route events stay original;
// this finite port is not browser/AT or production-history evidence.
function cManualNativeLifetime(t,q,{librarySearch=false}={}){
  return q.manualNative=installManualOutputNativeLifetime(t,{
    f:q.f,h:q.h,ports,dialogOwner:owner=>owner===q.caller,
    searchOwner:owner=>(q.manual==="prompt-fan"||q.libraryViewer||librarySearch)&&owner.parentElement===q.owner
      &&q.owner.isConnected&&q.owner.store===q.h.store,
    routeEvents:q.libraryViewer===true,
  });
}

function cManualRenderedEditor(q,block,target){
  const tree=q.f.tree(),forms=tree.visible("form").filter(node=>node.owner===target&&classed(node,"block-editor"));
  assert.equal(forms.length,1,"The exact original copied ContextBlock renders its current visible editor");
  const form=forms[0];assert.ok(form.port.isConnected);assert.equal(form.port.closest("forma-context-block"),target);
  const fields=tree.nodes.filter(node=>["input","textarea"].includes(node.tag)&&!node.hiddenBy&&inside(node,form)
    &&node.port?.isConnected&&!node.port.matches(":disabled")&&!Object.hasOwn(node.attributes,"readonly"));
  assert.ok(fields.length>0,"At least one actual current field is editable, not only an editingBlockId flag");
  for(const field of fields){assert.equal(field.port.closest("forma-context-block"),target);assert.equal(typeof field.port.value,"string");}
  if(block.properties.source_output_id)assert.ok(fields.some(field=>field.port.value===String(block.properties.label)),"Original image label is visible in its actual editable field");
  else{
    const inputs=q.f.components().filter(component=>component.tag==="forma-output-input-editor"&&component.isConnected
      &&component.store===q.h.store&&component.closest("forma-context-block")===target&&component.block?.id===block.id);
    assert.equal(inputs.length,1,"The exact copied artifact owns its current structured input editor");
    assert.ok(fields.some(field=>field.port.closest("forma-output-input-editor")===inputs[0]));
  }
}

async function cManualPage(t, caller, { taste = false, slides = false } = {}) {
  const q = await libraryAckPage(t, caller === "artifact-viewer" ? "artifact" : "copy", { manual: caller, taste, slides });
  const { f, h, owner, worker } = q;
  cManualNativeLifetime(t,q);
  if (caller === "generation-actions" || caller === "artifact-viewer") {
    const work = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
      && new URL(node.attributes.href, "https://fixture.invalid").pathname.startsWith("/document/")
      && documentIdFromRoute(node.attributes.href) === worker.documentId);
    await cLibraryCopyCustodyClick(q, work); assert.equal(owner.isConnected, false);
    const workspaces = f.components().filter(component => component.tag === "forma-workspace"
      && component.store === h.store && component.isConnected);
    assert.equal(workspaces.length, 1); q.workspace = workspaces[0];
    installImageFormatNativeLifetime({ f, h, after: callback => t.after(callback) });
    await f.settle();
    const result = f.find("button", node => node.owner === q.workspace && node.attributes["data-workbench-pane"] === "result");
    await cLibraryCopyCustodyClick(q, result);
    assert.equal(f.tree().nodes.find(node => node.owner === q.workspace && node.attributes.id === "document-results-panel")?.hiddenBy, null);
  }
  if (caller === "output-card") {
    const cards = f.components().filter(component => component.tag === "forma-output-card"
      && component.store === h.store && component.output?.id === cManualImageId && component.isConnected);
    assert.equal(cards.length, 1); q.caller = cards[0]; assert.equal(q.caller.closest("forma-library"), owner);
  } else if (caller === "generation-actions") {
    const controls = f.components().filter(component => component.tag === "forma-generation-actions"
      && component.store === h.store && component.closest("forma-workspace") === q.workspace && component.source === "document" && component.isConnected);
    assert.equal(controls.length, 1); q.caller = controls[0];
    await cLibraryCopyCustodyClick(q, f.find("button", node => node.owner === q.caller && classed(node, "generation-details-trigger")));
  } else if (caller === "prompt-fan") {
    const fans = f.components().filter(component => component.tag === "forma-prompt-fan-review"
      && component.store === h.store && component.fanId === "c-manual-retained-fan" && component.isConnected);
    assert.equal(fans.length, 1); q.caller = fans[0]; assert.equal(q.caller.closest("forma-library"), owner);
    await cLibraryCopyCustodyClick(q, f.find("button", node => node.owner === q.caller && classed(node, "prompt-fan-review-trigger")));
  } else {
    const viewers = f.components().filter(component => component.tag === "forma-document-artifacts"
      && component.store === h.store && component.closest("forma-workspace") === q.workspace && component.source === "document" && component.isConnected);
    assert.equal(viewers.length, 1); q.caller = viewers[0];
    await cManualOpenArtifact(q, q.originalArtifact.title);
  }
  assert.ok(q.caller.isConnected && q.caller.store === h.store);
  assert.equal(h.store.projection.get().projectId, worker.projectId); assert.equal(h.store.projection.get().documentId, worker.documentId);
  return q;
}

function cManualDialog(q) {
  const name = q.manual === "generation-actions" ? "generation-details-dialog" : q.manual === "prompt-fan" ? "prompt-fan-dialog" : "document-artifact-view";
  const dialogs = q.f.tree().visible("dialog").filter(node => node.owner === q.caller && classed(node, name) && node.port.open);
  assert.equal(dialogs.length, 1); return dialogs[0];
}

// Reuse the original E witness's current owner and native popovertarget default.
async function cManualOpenMore(q) {
  const initial = eManualPopupCurrent(q);
  if (!initial.panel.port.matches(":popover-open")) {
    assert.equal(initial.trigger.hiddenBy, null);
    assert.equal(initial.trigger.port.matches(":disabled"), false);
    q.f.native.emit("pointerdown", initial.trigger.port);
    q.f.native.focus(initial.trigger.port);
    initial.trigger.port.click();
    await q.f.settle();
  }
  const current = eManualPopupCurrent(q);
  assert.equal(current.owner, initial.owner);
  assert.equal(current.panel.port.matches(":popover-open"), true);
  return current;
}

async function cManualAction(q) {
  const popup = ["output-card", "artifact-viewer"].includes(q.manual) ? await cManualOpenMore(q) : null;
  const tree = popup?.tree ?? q.f.tree(), dialog = q.manual === "output-card" ? null
    : tree.visible("dialog").find(node => node.owner === q.caller && node.port.open
      && classed(node, q.manual === "generation-actions" ? "generation-details-dialog" : q.manual === "prompt-fan" ? "prompt-fan-dialog" : "document-artifact-view"));
  if (q.manual !== "output-card") assert.ok(dialog);
  const name = q.manual === "generation-actions" ? q.f.i18n.system("Use and edit the selected image as reusable input")
    : q.manual === "prompt-fan" ? "Use and edit the Prose image as input"
    : q.manual === "artifact-viewer" ? q.f.i18n.system("Use {value} as input", { value: "short story" }) : null;
  const actions = tree.visible("button").filter(node => node.owner === (popup?.owner ?? q.caller)
    && (!dialog || inside(node, dialog)) && (!popup || inside(node, popup.panel))
    && (name ? node.attributes["aria-label"] === name : node.text.trim().endsWith(q.f.i18n.system("Use & edit input"))));
  assert.equal(actions.length, 1); const action = actions[0];
  assert.ok(action.port.isConnected && q.f.renderer.nodes.includes(action.port));
  assert.equal(action.hiddenBy, null); assert.equal(action.port.matches(":disabled"), false); return action;
}

async function cManualArtifactOpen(q,node,artifactId){
  const port=node.port,owner=node.owner;
  const library=q.libraryViewer===true&&owner===q.owner&&owner.tag==="forma-library";
  const href=port.getAttribute("href"),parent=owner.parentElement,route=q.h.store.route.get();
  const before=q.h.store.projection.get(),artifact=before.libraryArtifacts.find(value=>value.id===artifactId);
  if(library){
    assert.equal(q.h.store.ui.libraryView,"all","This remains the original actual All-to-preview journey");
    assert.ok(artifact);assert.equal(libraryFocusFromRoute(href)?.kind,"artifact");
    assert.equal(libraryFocusFromRoute(href)?.id,artifactId);
  }
  q.manualNative.retainArtifactOpener(port,artifactId);
  await cLibraryCopyCustodyClick(q,node);
  if(library){
    // All -> Outputs moves this real link to a different template part. The
    // old native node must retire; this readback is never a replacement opener.
    assert.equal(port.isConnected,false);assert.equal(q.f.renderer.nodes.includes(port),false);
    assert.equal(q.h.store.ui.libraryView,"outputs");
    const current=q.f.tree().visible("a").filter(value=>value.owner===owner&&classed(value,"library-artifact-open")
      &&value.attributes.href===href&&libraryFocusFromRoute(value.attributes.href)?.kind==="artifact"
      &&libraryFocusFromRoute(value.attributes.href)?.id===artifactId);
    assert.equal(current.length,1);assert.notEqual(current[0].port,port);
    assert.ok(current[0].port.isConnected&&q.f.renderer.nodes.includes(current[0].port));
    assert.equal(current[0].port.closest(owner.tag),owner);assert.equal(current[0].port.closest("forma-shell"),q.f.host);
    assert.equal(owner.parentElement,parent);assert.equal(libraryFocusFromRoute(q.h.store.route.get())?.id,artifactId);
    assert.equal(libraryRootRoute(q.h.store.route.get()),libraryRootRoute(route));
    const after=q.h.store.projection.get();assert.equal(after.projectId,before.projectId);assert.equal(after.documentId,before.documentId);
    assert.deepEqual(after.libraryArtifacts.find(value=>value.id===artifactId),artifact);
  }else{
    assert.ok(port.isConnected&&q.f.renderer.nodes.includes(port),"The actual clicked opener stays in its committed native EventPart");
    const current=q.f.tree().nodes.filter(value=>value.port===port);
    assert.equal(current.length,1);assert.equal(current[0].owner,owner);assert.equal(port.closest(owner.tag),owner);
    assert.equal(port.closest("forma-shell"),q.f.host);
  }
  assert.ok(owner.isConnected&&owner.store===q.h.store);
  assert.ok(q.h.store.sourceOwnershipActive(q.source)&&q.h.store.authorizationScopeActive(q.authorization));
}

async function cManualOpenArtifact(q, title) {
  const tree = q.f.tree(), lists = tree.visible("div").filter(node => node.owner === q.caller && classed(node, "document-artifact-list"));
  assert.equal(lists.length, 1);
  const cards = tree.visible("button").filter(node => node.owner === q.caller && inside(node, lists[0])
    && tree.visible("b").some(label => inside(label, node) && label.text === title));
  assert.equal(cards.length, 1);
  const artifacts=q.h.store.projection.get().libraryArtifacts.filter(value=>value.title===title&&value.documentId===q.caller.documentId);
  assert.equal(artifacts.length,1);await cManualArtifactOpen(q,cards[0],artifacts[0].id);
  assert.equal(cManualDialog(q).port.getAttribute("aria-label"), title);
}

async function cManualClose(q) {
  const tree = q.f.tree(), current = tree.visible("dialog").filter(node => node.owner === q.caller && node.port.open
    && classed(node, q.manual === "prompt-fan" ? "prompt-fan-dialog" : "document-artifact-view"));
  assert.equal(current.length, 1);
  const label = q.manual === "prompt-fan" ? q.f.i18n.system("Close prompt fan comparison") : q.f.i18n.t("action.close", "Close");
  const buttons = tree.visible("button").filter(node => node.owner === q.caller && inside(node, current[0])
    && node.attributes["aria-label"] === label);
  assert.equal(buttons.length, 1); await cLibraryCopyCustodyClick(q, buttons[0]);
  await q.manualNative.settle();
  assert.equal(q.f.tree().visible("dialog").filter(node => node.owner === q.caller && node.port.open).length, 0);
}

async function cManualEffects(q) {
  await libraryAckEffects(q);
  const event = q.armed.receipt.appended.find(item => item.type === "BlockCreated"); assert.ok(event);
  const id = event.payload.block_id, block = q.h.store.projection.get().libraryBlocks.find(item => item.id === id);
  assert.ok(block); assert.equal(block.documentId, q.worker.documentId); assert.equal(block.projectId, q.worker.projectId);
  assert.deepEqual(block.properties, event.payload.properties);
  if (q.originalOutput) assert.deepEqual(q.h.store.projection.get().libraryOutputs.find(item => item.id === q.originalOutput.id), q.originalOutput);
  return block;
}

// Diagnostic only: observe the original public reveal Promise and only current()
// calls the application already makes on that same supplied focus object.
function cManualOriginalFocusObservation(t,q){
  const {f,h}=q,store=h.store,descriptor=Object.getOwnPropertyDescriptor(store,"revealOutputInput"),original=store.revealOutputInput;
  const records=[],restores=[];let calls=0,entry=null,firstFalse=null;
  const snapshot=(phase,focus,value,blockId)=>{
    try{
      const active=f.native.document.activeElement,arrival=focus?store.captureWorkspaceNavigationFocus(store.route.get(),focus):null;
      const row={phase,value,blockId,route:store.route.get(),editingBlockId:store.ui.editingBlockId,focusBlockId:store.ui.focusBlockId,
        sameSource:store.sourceOwnershipActive(q.source),sameAuthority:store.authorizationScopeActive(q.authorization),
        sameSuppliedLease:Boolean(arrival&&arrival.focus===focus),routeRecordPresent:Boolean(arrival),
        active:active?{tag:active.tagName??active.tag,owner:active.owner?.tag??null,connected:active.isConnected,
          className:active.getAttribute?.("class")??null,id:active.getAttribute?.("id")??null,
          dataBlockId:active.getAttribute?.("data-block-id")??null,sameAsRevealEntry:active===entry,
          inCurrentRenderer:f.renderer.nodes.includes(active),ownedByOriginalViewer:active.owner===q.caller}:null};
      calls++;if(records.length<80)records.push(row);if(value===false&&!firstFalse)firstFalse=row;
    }catch(error){records.push({phase,diagnosticError:error?.name??"Error"});}
  };
  const observed=function(...args){
    const focus=args[2]?.focus;entry=f.native.document.activeElement;snapshot("reveal-entry",focus,undefined,args[0]);
    if(focus){
      const current=focus.current,currentDescriptor=Object.getOwnPropertyDescriptor(focus,"current");
      const observeCurrent=function(...values){const result=Reflect.apply(current,this,values);snapshot("original-focus-current",focus,result,args[0]);return result;};
      focus.current=observeCurrent;
      restores.push(()=>{if(focus.current===observeCurrent){if(currentDescriptor)Object.defineProperty(focus,"current",currentDescriptor);else delete focus.current;}});
    }
    const promise=Reflect.apply(original,this,args);
    void promise.then(value=>snapshot("original-reveal-settled",focus,value,args[0]),()=>snapshot("original-reveal-rejected",focus,false,args[0]));
    return promise;
  };
  store.revealOutputInput=observed;
  t.after(()=>{for(const restore of restores)restore();if(store.revealOutputInput===observed){if(descriptor)Object.defineProperty(store,"revealOutputInput",descriptor);else delete store.revealOutputInput;}});
  return()=>({calls,firstFalse,records});
}

for (const caller of cManualCallers) for (const changed of [false, true]) test(
  "C manual retained output reuse / " + caller + " / " + (changed ? "owned work survives" : "healthy original result"),
  { concurrency: false, timeout: 60_000 }, async t => {
    const q = await cManualPage(t, caller), { f, h, worker } = q;
    const focusObservation=caller==="artifact-viewer"&&!changed?cManualOriginalFocusObservation(t,q):null;
    let raw = null, field = null, canonical = null;
    if (changed && caller === "output-card") {
      await cTasteToggle(q);
      field = () => f.find("input", node => node.owner === q.caller && String(node.attributes.maxlength) === "120");
      raw = "  keep this precise raw Taste B — 未保存  "; const input = field();
      f.native.emit("pointerdown", input.port); f.native.focus(input.port); input.port.value = raw;
      await f.act(input, "input"); assert.equal(field().port.value, raw); assert.equal(field().properties.value, raw);
    }
    if (changed && caller === "generation-actions") {
      const formats = f.components().filter(component => component.tag === "forma-image-format-editor"
        && component.store === h.store && component.closest("forma-generation-actions") === q.caller && component.isConnected);
      assert.equal(formats.length, 1); const format = formats[0];
      field = () => f.find("input", node => node.owner === format && node.attributes.name === "width");
      canonical = field().port.value; raw = String(Number(canonical) + 17); const input = field();
      f.native.emit("pointerdown", input.port); f.native.focus(input.port); input.port.value = raw;
      assert.equal(field().port.value, raw);
      assert.equal(new FormData(field().port.closest("form")).get("width"), raw, "The actual owned native form retains the unsubmitted width");
      assert.equal(cManualDialog(q).port.open, true);
    }
    const a = await q.arm(), floor = { events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length };
    let done = false, failure = null, newer = null, lateFocus = 0;
    const action = await cManualAction(q); f.native.emit("pointerdown", action.port); f.native.focus(action.port);
    q.pending = f.act(action, "click", { button: 0, defaultPrevented: false });
    void q.pending.then(() => { done = true; }, error => { failure = error; done = true; });
    try {
      await untilScene(() => Boolean(a.receipt || a.error || done), "Current manual action reaches exact original response or pre-dispatch refusal");
      if (a.error || failure) throw a.error ?? failure;
      let copied = null;
      if (a.receipt) {
        await q.reached(); assert.equal(a.response.status, 200); assert.equal(a.response.bodyUsed, false);
        if (changed && caller === "prompt-fan") {
          await cManualClose(q);
          const search = f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === q.owner);
          newer = "  later Library Search B  "; f.native.emit("pointerdown", search.port); f.native.focus(search.port);
          search.port.value = newer; await f.act(search, "input");
          const current = f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === q.owner);
          assert.equal(current.port.value, newer); f.native.emit("pointerdown", current.port); f.native.focus(current.port);
          lateFocus = f.native.nativeFocus.length;
        }
        if (changed && caller === "artifact-viewer") {
          await cManualClose(q); await cManualOpenArtifact(q, "Other retained story B");
          newer = cManualDialog(q).port; assert.equal(newer.getAttribute("aria-label"), "Other retained story B");
          lateFocus = f.native.nativeFocus.length;
        }
        a.gate.resolve(); await q.pending; await f.settle(); copied = await cManualEffects(q);
      } else { await q.pending; await cLibraryCopyCustodyNoWrite(q, floor); }
      t.diagnostic("C_MANUAL_RETAINED_OUTPUT_REUSE " + JSON.stringify({ caller, changed,
        originalRoute: a.route, observedRoute: h.store.route.get(), originalStatus: a.response?.status ?? null,
        originalEvents: a.receipt?.appended.map(event => ({ id: event.eventId, type: event.type, sequence: event.sequence })) ?? [],
        delivered: a.delivered, originalHistoryPrivateFiscalResumeExact: true,
        evidence: "actual full host/native caller and original RAM Worker response; historical seeded output, not provider or physical evidence" }));
      if (changed && ["output-card", "generation-actions"].includes(caller)) {
        assert.equal(h.store.route.get(), a.route, "A manual reuse action cannot abandon existing unsent local work");
        assert.equal(a.request, null, "Initial raw refusal precedes original copy admission");
        assert.equal(field().port.value, raw);
        if (caller === "generation-actions") assert.equal(cManualDialog(q).port.open, true, "Admission must precede closing the current Image options");
        const input = field(); f.native.emit("pointerdown", input.port); f.native.focus(input.port);
        input.port.value = caller === "output-card" ? "" : canonical;
        if (caller === "output-card") await f.act(input, "input");
        assert.equal(field().port.value, caller === "output-card" ? "" : canonical);
        await cLibraryCopyCustodyNoWrite(q, floor);
        const fresh = await cManualAction(q); f.native.emit("pointerdown", fresh.port); f.native.focus(fresh.port);
        q.pending = f.act(fresh, "click", { button: 0, defaultPrevented: false }); void q.pending.catch(() => {});
        await q.reached(); a.gate.resolve(); await q.pending; await f.settle(); copied = await cManualEffects(q);
      }
      assert.ok(copied, "Healthy/current original produces a real canonical editable input");
      if (changed && caller === "prompt-fan") {
        assert.equal(h.store.route.get(), a.route, "A committed original cannot replace later Library Search with a new reveal");
        const current = f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === q.owner);
        assert.equal(current.port.value, newer); assert.equal(f.native.document.activeElement, current.port);
        assert.equal(f.native.nativeFocus.length, lateFocus);
      } else if (changed && caller === "artifact-viewer") {
        assert.equal(h.store.route.get(), a.route); assert.equal(cManualDialog(q).port, newer);
        assert.equal(newer.open, true, "Old artifact A may commit but cannot close the newer current viewer B");
        assert.equal(newer.getAttribute("aria-label"), "Other retained story B");
        assert.equal(f.native.nativeFocus.length, lateFocus);
      } else {
        assert.equal(documentIdFromRoute(h.store.route.get()), worker.documentId);
        assert.equal(h.store.ui.editingBlockId, copied.id, "The actual original input, not an arbitrary target, is opened for editing");
        const workspaces = f.components().filter(component => component.tag === "forma-workspace" && component.isConnected && component.store === h.store);
        assert.equal(workspaces.length, 1);
        const targets = f.components().filter(component => component.tag === "forma-context-block" && component.isConnected
          && component.store === h.store && component.block?.id === copied.id && component.surface === "document");
        assert.equal(targets.length, 1); assert.equal(targets[0].readOnly, false);
        cManualRenderedEditor(q,copied,targets[0]);
      }
    } finally { a.gate.resolve(); if (q.pending) await q.pending;
      if(focusObservation)t.diagnostic("C_WORKSPACE_ARTIFACT_ORIGINAL_FOCUS "+JSON.stringify(focusObservation())); }
  });

test("C manual retained output reuse / Library artifact viewer / healthy original native parent close",{concurrency:false,timeout:60_000},async t=>{
  const q=await libraryAckPage(t,"artifact",{manual:"artifact-viewer",libraryViewer:true}),{f,h,worker}=q;
  const viewers=f.components().filter(component=>component.tag==="forma-document-artifacts"&&component.isConnected
    &&component.store===h.store&&component.closest("forma-library")===q.owner&&component.source==="library");
  assert.equal(viewers.length,1);q.caller=viewers[0];assert.equal(q.caller.launcherOnly,true);
  cManualNativeLifetime(t,q);await f.settle();await cLibraryArtifactAll(q);
  const link=f.find("a",node=>node.owner===q.owner&&classed(node,"library-artifact-open")
    &&libraryFocusFromRoute(node.attributes.href)?.kind==="artifact"&&libraryFocusFromRoute(node.attributes.href)?.id===q.originalArtifact.id);
  await cManualArtifactOpen(q,link,q.originalArtifact.id);
  assert.equal(cManualDialog(q).port.getAttribute("aria-label"),q.originalArtifact.title);
  assert.equal(libraryFocusFromRoute(h.store.route.get())?.id,q.originalArtifact.id);
  const a=await q.arm(),expectedRoot=libraryRootRoute(a.route),calls=[],setRoute=h.store.setRoute;
  t.mock.method(h.store,"setRoute",function(...args){
    const returned=Reflect.apply(setRoute,this,args);calls.push({args,returned});return returned;
  });
  const action=await cManualAction(q);f.native.emit("pointerdown",action.port);f.native.focus(action.port);
  q.pending=f.act(action,"click",{button:0,defaultPrevented:false});void q.pending.catch(()=>{});
  try{
    await q.reached();assert.equal(a.response.status,200);assert.equal(a.response.bodyUsed,false);
    a.gate.resolve();await q.pending;await q.manualNative.settle();await f.settle();const copied=await cManualEffects(q);
    assert.equal(calls.filter(call=>call.args[0]===expectedRoot).length,1,"The original native viewer Close invokes its actual Library parent root route exactly once");
    assert.equal(documentIdFromRoute(h.store.route.get()),worker.documentId);
    assert.equal(h.store.ui.editingBlockId,copied.id);
    const targets=f.components().filter(component=>component.tag==="forma-context-block"&&component.isConnected
      &&component.store===h.store&&component.block?.id===copied.id&&component.surface==="document");
    assert.equal(targets.length,1);assert.equal(targets[0].readOnly,false);cManualRenderedEditor(q,copied,targets[0]);
    assert.equal(q.owner.isConnected,false,"The real Library owner hands off only after its original copy");
    const native=q.manualNative.deliveries.filter(value=>value.owner===q.caller);
    assert.equal(native.length,1);assert.equal(native[0].target,1);assert.ok(native[0].ordinary>=1);
    const roots=q.manualNative.routeDeliveries.filter(value=>value.path===expectedRoot);
    assert.equal(roots.length,1);assert.equal(roots[0].storeRoute,expectedRoot);assert.ok(roots[0].callbacks>0);
    assert.equal(q.manualNative.pendingCloseCount(),0);
    t.diagnostic("C_LIBRARY_VIEWER_ORIGINAL_CLOSE "+JSON.stringify({originalRoute:a.route,expectedNativeCloseRoot:expectedRoot,
      observedOriginalSetRouteArguments:calls.map(call=>call.args[0]),observedRoute:h.store.route.get(),
      originalStatus:a.response.status,originalEvents:a.receipt.appended.map(event=>({id:event.eventId,type:event.type,sequence:event.sequence})),
      originalHistoryPrivateFiscalResumeExact:true,nativeCloseTiming:"explicit finite queued close callbacks with between-callback microtask checkpoints, later tasks and original Store-window route bridge; not physical browser proof"}));
  }finally{a.gate.resolve();if(q.pending)await q.pending;}
});

test("C manual retained output reuse / Library artifact viewer / newer Search survives queued original parent close",{concurrency:false,timeout:60_000},async t=>{
  const q=await libraryAckPage(t,"artifact",{manual:"artifact-viewer",libraryViewer:true}),{f,h,worker}=q;
  const viewers=f.components().filter(component=>component.tag==="forma-document-artifacts"&&component.isConnected
    &&component.store===h.store&&component.closest("forma-library")===q.owner&&component.source==="library");
  assert.equal(viewers.length,1);q.caller=viewers[0];assert.equal(q.caller.launcherOnly,true);
  cManualNativeLifetime(t,q);await f.settle();await cLibraryArtifactAll(q);
  const link=f.find("a",node=>node.owner===q.owner&&classed(node,"library-artifact-open")
    &&libraryFocusFromRoute(node.attributes.href)?.kind==="artifact"&&libraryFocusFromRoute(node.attributes.href)?.id===q.originalArtifact.id);
  await cManualArtifactOpen(q,link,q.originalArtifact.id);
  const originalDialog=cManualDialog(q).port;
  assert.equal(originalDialog.getAttribute("aria-label"),q.originalArtifact.title);
  const close=q.manualNative.holdNextClose(originalDialog),a=await q.arm(),expectedRoot=libraryRootRoute(a.route);
  const calls=[],setRoute=h.store.setRoute;
  t.mock.method(h.store,"setRoute",function(...args){const returned=Reflect.apply(setRoute,this,args);calls.push({args,returned});return returned;});
  const action=await cManualAction(q);f.native.emit("pointerdown",action.port);f.native.focus(action.port);
  q.pending=f.act(action,"click",{button:0,defaultPrevented:false});void q.pending.catch(()=>{});
  try{
    await q.reached();assert.equal(a.response.status,200);assert.equal(a.response.bodyUsed,false);
    a.gate.resolve();await close.reached;
    assert.equal(originalDialog.open,false,"Native close changes open before its queued event is delivered");
    assert.equal(q.manualNative.deliveries.filter(value=>value.node===originalDialog).length,0);
    const copied=await cManualEffects(q);
    assert.equal(h.store.route.get(),a.route,"The original copy must join its actual parent close before revealing a destination");
    assert.ok(q.owner.isConnected&&q.caller.isConnected&&q.owner.store===h.store&&q.caller.store===h.store);
    const tree=f.tree(),searches=tree.visible("input").filter(node=>node.owner.tag==="forma-ui-search"
      &&node.owner.parentElement===q.owner&&node.attributes.type==="search");
    assert.equal(searches.length,1);const search=searches[0],newer="  newer Library search after original close  ";
    assert.ok(search.port.isConnected);assert.equal(search.port.matches(":disabled"),false);assert.equal(search.hiddenBy,null);
    f.native.emit("pointerdown",search.port);f.native.focus(search.port);search.port.value=newer;await f.act(search,"input");
    const current=f.find("input",node=>node.owner.tag==="forma-ui-search"&&node.owner.parentElement===q.owner);
    assert.equal(current.port,search.port);assert.equal(current.port.value,newer);assert.equal(f.native.document.activeElement,current.port);
    const focusStart=f.native.nativeFocus.length;
    close.release();await q.manualNative.settle();await q.pending;await f.settle();await q.manualNative.settle();
    const confirmed=await cManualEffects(q);assert.equal(confirmed.id,copied.id);
    assert.equal(calls.filter(call=>call.args[0]===expectedRoot).length,1,"Even a retired copy gesture keeps the actual parent root cleanup");
    assert.equal(h.store.route.get(),expectedRoot);assert.equal(h.store.projection.get().documentId,worker.documentId);
    assert.ok(q.owner.isConnected&&q.owner.store===h.store);
    const after=f.find("input",node=>node.owner.tag==="forma-ui-search"&&node.owner.parentElement===q.owner);
    assert.equal(after.port,search.port);assert.equal(after.port.value,newer);assert.equal(f.native.document.activeElement,after.port);
    assert.equal(f.native.nativeFocus.length,focusStart,"Neither inherited opener, Shell main, nor a fresh reveal may override the newer Search");
    assert.notEqual(h.store.ui.editingBlockId,copied.id,"The committed original input does not gain new arrival permission");
    const native=q.manualNative.deliveries.filter(value=>value.node===originalDialog);
    assert.equal(native.length,1);assert.equal(native[0].target,1);assert.ok(native[0].ordinary>=1);
    const roots=q.manualNative.routeDeliveries.filter(value=>value.path===expectedRoot);
    assert.equal(roots.length,1);assert.equal(roots[0].storeRoute,expectedRoot);assert.ok(roots[0].callbacks>0);
    assert.equal(q.manualNative.pendingCloseCount(),0);
    t.diagnostic("C_LIBRARY_VIEWER_QUEUED_NEWER_SEARCH "+JSON.stringify({originalRoute:a.route,originalStatus:a.response.status,
      originalEvents:a.receipt.appended.map(event=>({id:event.eventId,type:event.type,sequence:event.sequence})),
      actualParentRoot:calls.filter(call=>call.args[0]===expectedRoot).map(call=>call.args[0]),currentRoute:h.store.route.get(),
      queuedCloseDeliveries:native.length,actualRouteCallbacks:roots[0].callbacks,lateNativeFocus:f.native.nativeFocus.length-focusStart,
      originalHistoryPrivateFiscalResumeExact:true,finiteNativeScope:"queued original callbacks, between-callback microtask checkpoints, later timer tasks and original Store-window route-event bridge; not physical browser proof"}));
  }finally{a.gate.resolve();close.release();await q.manualNative.settle();if(q.pending)await q.pending;}
});

// Separate original Taste-save completion family. The historical retained
// OutputCard is the existing manual seed; this is not a generated media claim.
const cTasteA={axis:"palette",polarity:"positive",value:"  original restrained amber A  ",note:"  original private explanation A — 保持  "};
const cTasteB={axis:"composition",polarity:"negative",value:"  newer unsubmitted symmetry B — 未保存  ",note:"  newer private draft B, not part of A  "};
const cTastePrivateRows=worker=>Object.fromEntries(["events","event_private_payloads","private_content","private_content_retention_scopes","project_resource_scopes","event_client_receipts"]
  .map(table=>[table,worker.sqlite.prepare('SELECT * FROM "'+table+'" ORDER BY rowid').all()]));

async function cTasteOriginalWrite(q,request,prior){
  const {h,worker,armed:a}=q,body=request.body,original=a.tasteOriginal;
  assert.equal(q.taste,true);assert.equal(q.manual,"output-card");assert.equal(q.kind,"copy");
  assert.equal(request,a.request);assert.equal(h.store.route.get(),a.route);
  assert.ok(h.store.sourceOwnershipActive(q.source)&&h.store.authorizationScopeActive(q.authorization));
  assert.deepEqual(original,cTasteA,"The observer owns only the independently selected original A");
  assert.deepEqual(Object.keys(body).sort(),["action","expectedSequence","clientId","objectId","axis","polarity","value","note"].sort());
  assert.deepEqual(body,{action:"critique_object",expectedSequence:a.head,clientId:"web:studio",objectId:q.originalOutput.id,
    axis:original.axis,polarity:original.polarity,value:original.value.trim(),note:original.note.trim()});
  assert.equal(request.init.body,JSON.stringify(body));
  assert.equal(q.originalOutput.id,cManualImageId);assert.equal(q.originalOutput.documentId,worker.documentId);
  const response=await prior(request);
  assert.equal(response.status,200,await response.clone().text());const receipt=await response.clone().json();
  assert.deepEqual(Object.keys(receipt).sort(),["appended","content","head","rejected"].sort());
  assert.deepEqual(receipt.rejected,[]);assert.equal(receipt.appended.length,1);assert.equal(receipt.head,a.head+1);
  const event=receipt.appended[0],payload=event.payload;
  assert.equal(event.type,"ObjectCritiqued");assert.match(event.eventId,uuid);assert.equal(event.streamId,worker.streamId);
  assert.equal(event.sequence,a.head+1);assert.equal(event.actor,"user");assert.equal(event.clientId,"web:studio");
  assert.match(event.correlationId,uuid);assert.equal(event.causationId,null);assert.equal(event.compensatesEventId,null);assert.equal(event.schemaVersion,1);
  assert.equal(event.occurredAt,event.recordedAt);assert.ok(Number.isFinite(Date.parse(event.recordedAt)));
  assert.match(payload.note_ref,uuid);assert.ok(Number.isFinite(Date.parse(payload.content_expires_at)));
  assert.deepEqual(payload,{object_id:q.originalOutput.id,axis_ref:original.axis,polarity:original.polarity,value:original.value.trim(),note_ref:payload.note_ref,content_expires_at:payload.content_expires_at});
  assert.deepEqual(receipt.content,{[payload.note_ref]:original.note.trim()});
  assert.equal(response.bodyUsed,false,"Only a clone observes this actual original Response before delivery");
  await worker.drainBackground();
  assert.deepEqual(await readWorkspaceEvents(worker.env,worker.streamId),[...a.history,event]);
  const after=cTastePrivateRows(worker),before=a.privateBefore;
  assert.deepEqual(after.events.slice(0,before.events.length),before.events,"Every old canonical row remains exact");
  assert.equal(after.events.length,before.events.length+1);
  const canonical=after.events.at(-1);assert.equal(canonical.event_id,event.eventId);assert.equal(canonical.sequence,event.sequence);assert.equal(canonical.type,event.type);
  assert.deepEqual(after.event_private_payloads.slice(0,before.event_private_payloads.length),before.event_private_payloads);
  assert.equal(after.event_private_payloads.length,before.event_private_payloads.length+1);
  const secret=after.event_private_payloads.at(-1);
  assert.deepEqual({...secret},{private_event_id:event.eventId,owner_id:worker.owner,project_id:null,document_id:null,private_json:JSON.stringify(payload),created_at:event.recordedAt,redacted_at:null},"Only the exact original private event payload is added");
  assert.deepEqual(after.private_content.slice(0,before.private_content.length),before.private_content,"All previous private content bytes and retention remain unchanged");
  assert.equal(after.private_content.length,before.private_content.length+1);
  const note=after.private_content.at(-1);
  assert.deepEqual({...note},{content_id:payload.note_ref,owner_id:worker.owner,kind:"critique",content:original.note.trim(),created_at:note.created_at,expires_at:payload.content_expires_at,redacted_at:null});
  assert.ok(Number.isFinite(Date.parse(note.created_at)));assert.equal(Date.parse(note.expires_at)-Date.parse(note.created_at),30*86_400_000);
  assert.ok(Date.parse(note.created_at)<=Date.parse(event.recordedAt));
  for(const table of ["private_content_retention_scopes","project_resource_scopes","event_client_receipts"])assert.deepEqual(after[table],before[table],table+" has no invented project grant, note scope or recovery receipt");
  assert.deepEqual(financial(worker),a.financial,"All nine full fiscal tables are unchanged by this free original critique");
  a.response=response;a.receipt=receipt;a.sql={eventId:event.eventId,sequence:event.sequence,type:event.type};a.privateAfter=after;
}

function cTastePrivateEffects(q){
  const {h,worker,armed:a}=q,event=a.receipt.appended[0];
  assert.deepEqual(cTastePrivateRows(worker),a.privateAfter,"Delivery cannot rewrite the exact committed history or private-note rows");
  assert.equal(h.store.content.get()[event.payload.note_ref],cTasteA.note.trim());
  assert.equal(h.store.busy.get(),"");
  assert.equal(h.store.ui.toast,"Axis-specific critique recorded for the taste ledger.");
  assert.equal(q.tasteCalls.length,1);assert.equal(q.tasteCalls[0].returned,true,"Original Store truth is preserved independently of newer native draft cleanup");
  assert.deepEqual(q.tasteCalls[0].args,[q.originalOutput.id,cTasteA.axis,cTasteA.polarity,cTasteA.value.trim(),cTasteA.note.trim()]);
  assert.deepEqual(h.store.projection.get().libraryOutputs.find(value=>value.id===q.originalOutput.id),q.originalOutput);
}

function cTasteForms(q,tree=q.f.tree()){return tree.visible("form").filter(node=>node.owner===q.caller&&classed(node,"output-critique"));}
function cTasteForm(q,tree=q.f.tree()){const forms=cTasteForms(q,tree);assert.equal(forms.length,1,"The actual current Taste form is visible");assert.ok(forms[0].port.isConnected);return forms[0];}
function cTasteControl(q,predicate,tree=q.f.tree()){
  const form=cTasteForm(q,tree),matches=tree.visible("button").filter(node=>node.owner===q.caller&&inside(node,form)&&predicate(node));
  assert.equal(matches.length,1);return matches[0];
}
function cTasteField(q,kind,{visible=false}={},tree=q.f.tree()){
  const form=cTasteForm(q,tree),matches=(visible?tree.visible(kind==="value"?"input":"textarea"):tree.nodes)
    .filter(node=>node.owner===q.caller&&inside(node,form)&&node.tag===(kind==="value"?"input":"textarea")&&String(node.attributes.maxlength)===(kind==="value"?"120":"500"));
  assert.equal(matches.length,1);assert.ok(matches[0].port.isConnected);assert.equal(matches[0].port.matches(":disabled"),false);return matches[0];
}
async function cTasteToggle(q){
  const current=await cManualOpenMore(q);
  const buttons=current.tree.visible("button").filter(node=>node.owner===current.owner&&inside(node,current.panel)
    &&node.text.trim().endsWith(q.f.i18n.system("Taste evidence")));
  assert.equal(buttons.length,1);const button=buttons[0];
  await cLibraryCopyCustodyClick(q,button);
}
function cTasteOpenNote(q){
  const tree=q.f.tree(),form=cTasteForm(q,tree),details=tree.visible("details").filter(node=>node.owner===q.caller&&inside(node,form));
  assert.equal(details.length,1);const detail=details[0],summaries=tree.visible("summary").filter(node=>node.parent===detail);
  assert.equal(summaries.length,1);assert.ok(summaries[0].port.isConnected);assert.equal(summaries[0].handlers.click,undefined);
  // Only the actual current native summary default is represented. The finite
  // renderer does not certify disclosure retention or physical input behavior.
  if(!detail.port.open)detail.port.open=true;
  return cTasteField(q,"note",{visible:true});
}
function cTasteRead(q){
  const tree=q.f.tree(),form=cTasteForm(q,tree),pressed=tree.visible("button").filter(node=>node.owner===q.caller&&inside(node,form)&&node.attributes["aria-pressed"]===true);
  const axes=pressed.filter(node=>!classed(node,"positive")&&!classed(node,"negative")),polarity=pressed.filter(node=>classed(node,"positive")||classed(node,"negative"));
  assert.equal(axes.length,1);assert.equal(polarity.length,1);
  for(const node of pressed)assert.equal(String(node.port.getAttribute("aria-pressed")),"true","The actual selected native port still exposes the exact true ARIA token");
  const value=cTasteField(q,"value",{},tree),note=cTasteField(q,"note",{},tree);
  assert.equal(value.properties.value,value.port.value);assert.equal(note.properties.value,note.port.value);
  return{axis:axes[0].text,polarity:classed(polarity[0],"positive")?"positive":"negative",value:value.port.value,note:note.port.value};
}
async function cTasteFill(q,draft){
  assert.ok(draft.value.length<=120&&draft.note.length<=500&&draft.value.trim());
  await cLibraryCopyCustodyClick(q,cTasteControl(q,node=>node.text===draft.axis));
  await cLibraryCopyCustodyClick(q,cTasteControl(q,node=>classed(node,draft.polarity)));
  let field=cTasteField(q,"value",{visible:true});assert.ok(Object.hasOwn(field.attributes,"required"));
  q.f.native.emit("pointerdown",field.port);q.f.native.focus(field.port);field.port.value=draft.value;
  await q.f.act(field,"input");
  field=cTasteOpenNote(q);q.f.native.emit("pointerdown",field.port);q.f.native.focus(field.port);field.port.value=draft.note;
  await q.f.act(field,"input");assert.deepEqual(cTasteRead(q),draft);
}
function cTasteRecord(q){
  const button=cTasteControl(q,node=>classed(node,"primary"));assert.equal(button.attributes.type??"submit","submit");return button;
}

for(const successor of ["unchanged","same-open-B","close-reopen-B"])test("C Taste critique original Worker200 / "+successor,
  {concurrency:false,timeout:60_000},async t=>{
    const q=await cManualPage(t,"output-card",{taste:true}),{f,h}=q;
    assert.ok(q.caller.isConnected&&q.caller.store===h.store);assert.equal(q.caller.output.id,q.originalOutput.id);
    assert.equal(Boolean(h.store.session.get().projectContext),false);
    const original=h.store.critiqueObject;q.tasteCalls=[];
    t.mock.method(h.store,"critiqueObject",function(...args){
      const call={args,returned:undefined};q.tasteCalls.push(call);const promise=Reflect.apply(original,this,args);call.promise=promise;
      promise.then(value=>{call.returned=value;},error=>{call.error=error;});return promise;
    });
    await cTasteToggle(q);await cTasteFill(q,cTasteA);q.tasteOriginal={...cTasteA};
    const a=await q.arm(),submit=cTasteRecord(q),form=cTasteForm(q);
    assert.equal(submit.port.matches(":disabled"),false);assert.equal(submit.hiddenBy,null);
    f.native.emit("pointerdown",submit.port);f.native.focus(submit.port);
    q.pending=f.act(form,"submit",{submitter:submit.port});void q.pending.catch(()=>{});
    try{
      await q.reached();await f.settle();assert.equal(q.tasteCalls.length,1);assert.equal(q.tasteCalls[0].returned,undefined);
      assert.equal(cTasteRecord(q).port.matches(":disabled"),true,"Only Record is blocked while the real original result is held");
      assert.deepEqual(cTasteRead(q),cTasteA);
      for(const kind of ["value","note"])assert.equal(cTasteField(q,kind).port.matches(":disabled"),false);
      for(const choose of [node=>node.text==="composition",node=>classed(node,"negative"),node=>node.attributes["aria-label"]==="Close taste evidence",node=>node.text===f.i18n.system("Cancel")])
        assert.equal(cTasteControl(q,choose).port.matches(":disabled"),false);
      if(successor==="close-reopen-B"){
        await cLibraryCopyCustodyClick(q,cTasteControl(q,node=>node.attributes["aria-label"]==="Close taste evidence"));
        assert.equal(cTasteForms(q).length,0);assert.equal(h.store.busy.get(),"critique-object");
        await cTasteToggle(q);assert.deepEqual(cTasteRead(q),cTasteA,"Close did not claim cancellation or discard the original fields");
      }
      if(successor!=="unchanged")await cTasteFill(q,cTasteB);
      assert.equal(h.store.route.get(),a.route);assert.ok(h.store.sourceOwnershipActive(q.source)&&h.store.authorizationScopeActive(q.authorization));
      const before=cTasteRead(q);a.gate.resolve();await q.pending;await f.settle();
      const event=await libraryAckEffects(q),forms=cTasteForms(q),after=forms.length?cTasteRead(q):null;
      assert.equal(event.type,"ObjectCritiqued");assert.equal(a.delivered,1);assert.equal(a.response.status,200);
      assert.equal(h.store.route.get(),a.route);assert.ok(q.caller.isConnected&&q.caller.store===h.store);
      t.diagnostic("C_TASTE_ORIGINAL_ACK "+JSON.stringify({successor,originalEvent:a.sql,originalNoteRef:event.payload.note_ref,
        actualStoreReturned:q.tasteCalls[0].returned,actual200Delivered:a.delivered,originalWriteCount:h.requests.filter(eventPost).length,
        before,after,formVisible:forms.length===1,originalHistoryPrivateFiscalExact:true,physicalOrProviderClaim:false}));
      if(successor==="unchanged"){
        assert.equal(forms.length,0,"Healthy original completion closes its own unchanged Taste form");
        await cTasteToggle(q);assert.deepEqual(cTasteRead(q),{...cTasteA,value:"",note:""},"Only acknowledged raw fields clear; selectors are retained");
        assert.equal(cTasteRecord(q).port.matches(":disabled"),true,"An empty value cannot submit a second critique");
        const activity=q.task("/activity");await cLibraryCopyCustodyClick(q,activity);
        assert.equal(h.store.route.get(),activity.attributes.href,"Retained axis/polarity alone must not become a sticky local-work block");
        assert.equal(q.caller.isConnected,false);await libraryAckEffects(q);
      }else{
        assert.equal(forms.length,1,"The old original ACK cannot close the newer current Taste draft");
        assert.deepEqual(after,cTasteB,"Current raw value/private note and B axis/polarity survive exact original A completion");
        assert.equal(cTasteRecord(q).port.matches(":disabled"),false,"After A settles the current unsent B is still usable, not permanently busy");
        const note=cTasteOpenNote(q);assert.equal(note.port.value,cTasteB.note,"The actual current disclosure can expose the preserved private note");
        assert.equal(h.requests.filter(eventPost).length,1,"No automatic or replacement critique is sent for B");
      }
    }finally{a.gate.resolve();if(q.pending)await q.pending;}
  });

// One current Slides menu control, separate from future E formats. The initial
// retained private artifact is explicit RAM history setup, not a generated deck.
const cSlidesMenuId = "c-manual-slides-menu";
async function cSlidesMenuSeed(h) {
  const title = "Retained Slides menu", summary = "Exact current Slides menu fixture";
  const item = { title: "Original retained slide", body: "SLIDES_RETAINED_PRIVATE_A",
    notes: "Original retained speaker note A", image_prompt: "", context_group_ids: [], slide: null };
  const content = { title, summary, content_markdown: item.body, presentation: null, items: [item] };
  const bytes = JSON.stringify(content);
  const stored = await cSlidesStorePrivateContent(h.worker.env, h.worker.owner, "document-artifact", bytes);
  await appendAuditEvent(h.worker.env, h.worker.streamId, "worker:renderer", "DocumentRenderCompleted", {
    project_id: h.worker.projectId, document_id: h.worker.documentId, artifact_id: cSlidesMenuId,
    artifact_kind: "slides", title, summary, content_ref: stored.contentId, item_count: 1,
    items: [{ id: cSlidesMenuId + "-part", title: item.title }],
    source_block_versions: [{ block_id: "scene-reuse-direction", version: 1 }], requested_by_user_id: h.worker.owner,
  });
  return { id: cSlidesMenuId, title, summary, bytes, content, contentRef: stored.contentId };
}

function cSlidesMenuOriginalInput(q, events, head) {
  assert.equal(q.manual, "artifact-viewer"); assert.equal(q.slides, true); assert.equal(q.libraryViewer, false);
  const { worker, originalArtifact: artifact, slidesSeed: seed } = q;
  assert.equal(artifact.id, cSlidesMenuId); assert.equal(artifact.kind, "slides");
  assert.equal(artifact.documentId, worker.documentId); assert.equal(artifact.contentRef, seed.contentRef);
  assert.equal(q.h.store.content.get()[seed.contentRef], seed.bytes);
  assert.equal(artifact.title, seed.title); assert.equal(artifact.summary, seed.summary);
  assert.equal(artifact.items.length, 1); assert.equal(artifact.items[0].id, cSlidesMenuId + "-part");
  assert.equal(events.length, 1); const event = events[0], payload = event.payload;
  assert.match(payload.block_id, uuid); assert.match(payload.properties.context_set_id, uuid);
  assert.notEqual(payload.block_id, q.originalBlock.id); assert.ok(q.slidesPresentation);
  const id = payload.block_id, set = payload.properties.context_set_id, source = "document-artifact-viewer";
  const expected = { type: "BlockCreated", payload: {
    project_id: worker.projectId, document_id: worker.documentId, source_surface: source,
    source_artifact_id: seed.id, source_artifact_kind: "slides", source_document_id: worker.documentId,
    block_id: id, type: "message", handle: "message/retained-slides-menu-" + seed.id.slice(-8),
    position: "z" + String(head + 1).padStart(8, "0"), properties: {
      label: seed.title, text: seed.content.content_markdown, artifact_markdown: seed.content.content_markdown,
      subtype: "Presentation source", intent: "include", authority: "authored", weight: 0.9,
      source_artifact_id: seed.id, source_artifact_kind: "slides", source_document_id: worker.documentId,
      source_artifact_content_ref: seed.contentRef, source_artifact_input_ref: artifact.inputRef ?? null,
      artifact_summary: seed.summary, artifact_item_count: 1,
      artifact_structure: { presentation: q.slidesPresentation, items: [{
        source_artifact_item_id: seed.id + "-part", ...seed.content.items[0],
      }] },
      media_url: artifact.mediaUrl, media_type: artifact.mediaType, provider: artifact.provider, model_id: artifact.modelId,
      input_mode: "full_output", context_set_id: set, context_set_root_id: id,
      copied_as_context_set: true, semantic_isolation: true,
      combined_context_memberships: [{ contextSetId: set, name: seed.title, role: "slide_chapter",
        target: seed.title + " presentation sequence", application: "ordered", relativity: 1,
        memberOrder: 0, sourceCanvasId: "" }], created_from: source,
    },
  } };
  assert.deepEqual(event, JSON.parse(JSON.stringify(expected)),
    "One exact original Slides input retains current public deck styling and the complete retained private item");
}

function cSlidesMenuCurrent(q) {
  const tree = q.f.tree(), viewers = tree.visible("dialog").filter(node => node.owner === q.caller
    && classed(node, "document-artifact-view") && node.port.open);
  assert.equal(viewers.length, 1); const viewer = viewers[0];
  const menus = tree.nodes.filter(node => node.component?.tag === "forma-ui-popover"
    && classed(node, "artifact-viewer-actions-popover") && inside(node, viewer));
  assert.equal(menus.length, 1); const menu = menus[0], owner = menu.component;
  assert.ok(owner.isConnected); assert.equal(owner.closest("forma-document-artifacts"), q.caller);
  const panels = tree.nodes.filter(node => node.owner === owner && node.tag === "section"
    && classed(node, "ui-popover-panel") && inside(node, menu));
  const triggers = tree.visible("button").filter(node => node.owner === owner && classed(node, "ui-popover-trigger") && inside(node, menu));
  assert.equal(panels.length, 1); assert.equal(triggers.length, 1);
  const panel = panels[0], trigger = triggers[0];
  assert.equal(trigger.attributes.popovertarget, panel.attributes.id);
  const actions = tree.nodes.filter(node => node.tag === "button" && node.owner === owner && inside(node, panel)
    && node.attributes["aria-label"] === q.f.i18n.system("Use {value} as input", { value: "slides" }));
  assert.equal(actions.length, 1); const action = actions[0];
  assert.equal(action.port.closest("forma-document-artifacts"), q.caller);
  assert.equal(action.port.closest("forma-shell"), q.f.host);
  assert.ok([viewer.port, panel.port, trigger.port, action.port].every(port => port?.isConnected && q.f.renderer.nodes.includes(port)));
  return { tree, viewer, menu, owner, panel, trigger, action };
}

// Only the explicitly selected current popup target receives closed-popover box
// reflection. Current Slides and future E witnesses opt in independently. It
// reads the existing real panel's native state; it never supplies currentness,
// remaps activeElement, opens the panel, or invokes an application method.
function cSlidesMenuGeometry(t, current) {
  const { action, panel, owner } = current, node = action.port, descriptor = Object.getOwnPropertyDescriptor(node, "getClientRects");
  const original = node.getClientRects;
  assert.equal(typeof original, "function");
  node.getClientRects = function() {
    return this === node && node.isConnected && panel.port.isConnected && owner.isConnected
      && node.closest("forma-ui-popover") === owner && panel.port.matches(":popover-open")
      ? Reflect.apply(original, this, []) : [];
  };
  t.after(() => { if (descriptor) Object.defineProperty(node, "getClientRects", descriptor); else delete node.getClientRects; });
  return () => node.getClientRects().length > 0;
}

async function cSlidesMenuClick(q, current, visible, trace, captureBodyClass = "artifact-viewer-actions-body") {
  const { f } = q, node = current.action.port;
  assert.equal(current.action.hiddenBy, null); assert.ok(visible()); assert.equal(node.matches(":disabled"), false);
  assert.ok(node.isConnected && f.renderer.nodes.includes(node));
  const path = []; for (let row = current.action; row; row = row.parent) path.push(row);
  const capture = path.filter(row => row.handlers?.click?.capture === true);
  assert.equal(capture.length, 1); assert.ok(classed(capture[0], captureBodyClass));
  assert.equal(typeof capture[0].handlers.click.handleEvent, "function");
  let stopped = false, immediate = false; const pending = [];
  const event = { type: "click", target: node, currentTarget: null, eventPhase: 0, bubbles: true, cancelable: true,
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; },
    stopImmediatePropagation() { stopped = true; immediate = true; },
    composedPath: () => [...path.map(row => row.port ?? row.component).filter(Boolean), f.native.document, q.h.window],
  };
  const invoke = (row, phase) => {
    const handler = row.handlers?.click; if (!handler || immediate) return;
    event.currentTarget = row.port ?? row.component; event.eventPhase = phase === "target" ? 2 : phase === "capture" ? 1 : 3;
    trace.push({ phase, tag: row.tag, exactViewer: event.currentTarget === current.viewer?.port,
      targetVisible: visible(), popoverOpen: current.panel.port.matches(":popover-open") });
    const returned = typeof handler === "function" ? handler.call(row.owner, event) : handler.handleEvent(event);
    if (returned?.then) pending.push(returned);
  };
  // The current target was visible when its native click began. Hiding it in an
  // ancestor callback does not cancel that already-dispatched target callback.
  for (const row of [...path].reverse()) { if (stopped) break; if (row.handlers?.click?.capture === true) invoke(row, "capture"); }
  if (!stopped) invoke(current.action, "target");
  for (const row of path.slice(1)) { if (stopped) break; if (row.handlers?.click && row.handlers.click.capture !== true) invoke(row, "bubble"); }
  event.currentTarget = null; event.eventPhase = 0;
  await Promise.all(pending); await f.settle();
}

test("C manual retained output reuse / current Slides native menu / healthy original input", { concurrency: false, timeout: 60_000 }, async t => {
  const q = await cManualPage(t, "artifact-viewer", { slides: true }), { f, h, worker } = q;
  assert.equal(q.originalArtifact.kind, "slides"); assert.equal(h.store.content.get()[q.slidesSeed.contentRef], q.slidesSeed.bytes);
  const decks = f.components().filter(component => component.tag === "forma-presentation-deck" && component.isConnected
    && component.store === h.store && component.closest("forma-document-artifacts") === q.caller && component.preferenceKey === cSlidesMenuId);
  assert.equal(decks.length, 1); assert.equal(decks[0].presentation, null);
  q.slidesPresentation = structuredClone(decks[0].activePresentation);
  assert.ok(q.slidesPresentation && typeof q.slidesPresentation === "object");
  const a = await q.arm(), floor = { events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length };
  const closed = cSlidesMenuCurrent(q), closedVisible = cSlidesMenuGeometry(t, closed);
  assert.equal(closed.panel.port.matches(":popover-open"), false); assert.ok(closed.action.hiddenBy); assert.equal(closedVisible(), false);
  f.native.emit("pointerdown", closed.trigger.port); f.native.focus(closed.trigger.port);
  closed.trigger.port.click(); await f.settle(); await cLibraryCopyCustodyNoWrite(q, floor);
  const current = cSlidesMenuCurrent(q), visible = cSlidesMenuGeometry(t, current), trace = [];
  assert.equal(current.owner, closed.owner); assert.equal(current.panel.port.matches(":popover-open"), true);
  assert.equal(current.action.hiddenBy, null); assert.ok(visible());
  let done = false, failure = null;
  f.native.emit("pointerdown", current.action.port); f.native.focus(current.action.port);
  q.pending = cSlidesMenuClick(q, current, visible, trace);
  void q.pending.then(() => { done = true; }, error => { failure = error; done = true; });
  try {
    await untilScene(() => Boolean(a.receipt || a.error || done), "Current Slides menu reaches its exact original response or genuine pre-dispatch refusal");
    if (a.error || failure) throw a.error ?? failure;
    let copied = null;
    if (a.receipt) { await q.reached(); assert.equal(a.response.status, 200); a.gate.resolve(); await q.pending;
      await q.manualNative.settle(); await f.settle(); copied = await cManualEffects(q); }
    else { await q.pending; await cLibraryCopyCustodyNoWrite(q, floor); }
    assert.deepEqual(trace.slice(0, 2).map(value => value.phase), ["capture", "target"], "Original current ancestor capture precedes the actual child callback");
    assert.equal(trace.filter(value => value.phase === "target").length, 1);
    const dialogBubbles = trace.filter(value => value.phase === "bubble" && value.tag === "dialog");
    assert.equal(dialogBubbles.length, 1); assert.equal(dialogBubbles[0].exactViewer, true,
      "The actual original viewer backdrop handler also receives its non-backdrop bubbled click");
    assert.equal(trace[0].targetVisible, true);
    t.diagnostic("C_SLIDES_MENU_ORIGINAL_COPY " + JSON.stringify({ trace, originalRoute: a.route, route: h.store.route.get(),
      originalRequests: Number(Boolean(a.request)), originalStatus: a.response?.status ?? null, originalEvents: a.receipt?.appended.map(event => ({ id: event.eventId, type: event.type, sequence: event.sequence })) ?? [],
      delivered: a.delivered, exactOriginalHistoryPrivateFiscalResume: true,
      evidence: "actual Slides/Popover/Shell/Store and original RAM Worker; explicit finite capture/geometry, historical seeded deck, no provider or physical proof" }));
    assert.ok(copied, "A healthy visible current Slides menu action must produce its real canonical editable input");
    assert.equal(trace[1].targetVisible, true, "The current native trigger remains visible through initial child admission");
    assert.equal(documentIdFromRoute(h.store.route.get()), worker.documentId); assert.equal(h.store.ui.editingBlockId, copied.id);
    assert.equal(h.store.projection.get().libraryBlocks.filter(block => block.properties.source_artifact_id === cSlidesMenuId).length, 1);
    assert.deepEqual(h.store.projection.get().libraryArtifacts.find(artifact => artifact.id === cSlidesMenuId), q.originalArtifact);
    assert.equal(h.store.content.get()[q.slidesSeed.contentRef], q.slidesSeed.bytes);
    const targets = f.components().filter(component => component.tag === "forma-context-block" && component.isConnected
      && component.store === h.store && component.block?.id === copied.id && component.surface === "document");
    assert.equal(targets.length, 1); assert.equal(targets[0].readOnly, false); cManualRenderedEditor(q, copied, targets[0]);
    assert.equal(q.manualNative.deliveries.filter(value => value.owner === q.caller).length, 1);
    assert.equal(f.tree().visible("dialog").filter(node => node.owner === q.caller && node.port.open).length, 0);
  } finally { a.gate.resolve(); if (q.pending) await q.pending; }
});

// Future E only: actual popup-origin copies, not inventory/handler-presence proof.
// Reuse Atomic's frozen current Slides finite capture/native-visibility seam.
function eManualPopupCurrent(q) {
  const { f } = q, popupClass = q.manual === "output-card" ? "output-actions-popover" : "artifact-viewer-actions-popover";
  const tree = f.tree(), viewers = q.manual === "artifact-viewer" ? tree.visible("dialog").filter(node => node.owner === q.caller
    && classed(node, "document-artifact-view") && node.port.open) : [];
  assert.equal(viewers.length, q.manual === "artifact-viewer" ? 1 : 0);
  const viewer = viewers[0] ?? null, menus = tree.nodes.filter(node => node.component?.tag === "forma-ui-popover"
    && classed(node, popupClass) && node.component.isConnected && node.component.closest(q.caller.tag) === q.caller);
  assert.equal(menus.length, 1, "E prerequisite: the exact actual owner's native More exists");
  const menu = menus[0], owner = menu.component;
  if (viewer) { assert.ok(inside(menu, viewer)); assert.ok(viewer.port.isConnected && f.renderer.nodes.includes(viewer.port)); }
  const panels = tree.nodes.filter(node => node.owner === owner && node.tag === "section"
    && node.attributes.popover === "auto" && inside(node, menu));
  const triggers = tree.visible("button").filter(node => node.owner === owner
    && classed(node, "ui-popover-trigger") && inside(node, menu));
  assert.equal(panels.length, 1); assert.equal(triggers.length, 1);
  const panel = panels[0], trigger = triggers[0];
  assert.equal(trigger.attributes.popovertarget, panel.attributes.id);
  const name = q.manual === "artifact-viewer" ? f.i18n.system("Use {value} as input", { value: "short story" }) : null;
  const actions = tree.nodes.filter(node => node.tag === "button" && node.owner === owner && inside(node, panel)
    && (name ? node.attributes["aria-label"] === name : node.text.trim().endsWith(f.i18n.system("Use & edit input"))));
  assert.equal(actions.length, 1); const action = actions[0];
  assert.ok([panel.port, trigger.port, action.port].every(port => port?.isConnected && f.renderer.nodes.includes(port)));
  assert.equal(action.port.closest("forma-ui-popover"), owner);
  assert.equal(action.port.closest(q.caller.tag), q.caller); assert.equal(action.port.closest("forma-shell"), f.host);
  assert.equal(typeof action.handlers.click, "function");
  return { tree, viewer, menu, owner, panel, trigger, action };
}

// Opt-in reflection of native popover removal for this original captured owner.
// The finite renderer replaces its query tree before disconnectedCallback runs.
// Never infer removal from an ACK/route, or close a connected same-ID successor.
function eManualPopupRemoval(t, q, current) {
  const { f } = q, { owner, panel } = current, node = panel.port, id = panel.attributes.id;
  assert.equal(owner.tag, "forma-ui-popover"); assert.equal(node.owner, owner);
  assert.equal(node.attributes.popover, "auto"); assert.equal(typeof id, "string"); assert.ok(id);
  assert.ok(owner.isConnected && node.isConnected && f.renderer.nodes.includes(node));
  const read = () => ({ ownerConnected: owner.isConnected, panelConnected: node.isConnected,
    panelPresent: f.renderer.nodes.includes(node),
    sameOwnerNodes: f.renderer.nodes.filter(candidate => candidate.owner === owner).length,
    connectedSameIdNodes: f.renderer.nodes.filter(candidate => candidate.isConnected && candidate.attributes.id === id).length,
    open: f.renderer.openPopovers.has(id) });
  const authoredPanels = current.tree.nodes.filter(row => row.port?.isConnected && row.attributes.id === id);
  assert.equal(authoredPanels.length, 1, "One current authored native panel, not its ancestor renderer replicas");
  assert.equal(authoredPanels[0].port, node);
  assert.equal(authoredPanels[0].owner, owner);
  const draw = f.renderer.draw, descriptor = Object.getOwnPropertyDescriptor(f.renderer, "draw"), records = [];
  const reflectedDraw = function(...args) {
    const result = Reflect.apply(draw, this, args), before = read();
    if (!records.length && before.ownerConnected === false && before.panelConnected === false
      && !before.panelPresent && before.sameOwnerNodes === 0 && before.connectedSameIdNodes === 0) {
      const active = f.native.document.activeElement, otherIds = [...f.renderer.openPopovers].filter(value => value !== id);
      const removedOpenId = f.renderer.openPopovers.delete(id);
      assert.equal(f.native.document.activeElement, active, "Native removal reflection cannot assign focus");
      assert.deepEqual([...f.renderer.openPopovers], otherIds, "Only this disconnected original ID may retire");
      records.push({ ...before, removedOpenId, openAfter: f.renderer.openPopovers.has(id) });
    }
    return result;
  };
  f.renderer.draw = reflectedDraw;
  t.after(() => {
    // Do not reinstall an older wrapper after the existing lifetime cleanup.
    if (f.renderer.draw !== reflectedDraw) return;
    if (descriptor) Object.defineProperty(f.renderer, "draw", descriptor); else delete f.renderer.draw;
  });
  return { records, read };
}

for (const caller of ["output-card", "artifact-viewer"]) test(
  "E current More preserves the original copy and exact editable arrival / " + caller,
  { concurrency: false, timeout: 60_000 }, async t => {
    const q = await cManualPage(t, caller), { f, h, worker } = q;
    const a = await q.arm(), floor = { events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length };
    const closed = eManualPopupCurrent(q), closedVisible = cSlidesMenuGeometry(t, closed);
    assert.equal(closed.panel.port.matches(":popover-open"), false); assert.ok(closed.action.hiddenBy); assert.equal(closedVisible(), false);
    f.native.emit("pointerdown", closed.trigger.port); f.native.focus(closed.trigger.port);
    closed.trigger.port.click(); await f.settle(); await cLibraryCopyCustodyNoWrite(q, floor);
    // q.arm/NoWrite settle the complete host. Capture this final actual tree only afterward.
    const current = eManualPopupCurrent(q), visible = cSlidesMenuGeometry(t, current), trace = [];
    assert.equal(current.owner, closed.owner); assert.equal(current.panel.port.matches(":popover-open"), true);
    assert.equal(current.action.hiddenBy, null); assert.ok(visible());
    const panelId = current.panel.attributes.id, bodyClass = caller === "output-card" ? "output-secondary-actions" : "artifact-viewer-actions-body";
    const removal = eManualPopupRemoval(t, q, current);
    let done = false, failure = null;
    f.native.emit("pointerdown", current.action.port); f.native.focus(current.action.port);
    q.pending = cSlidesMenuClick(q, current, visible, trace, bodyClass);
    void q.pending.then(() => { done = true; }, error => { failure = error; done = true; });
    try {
      await untilScene(() => Boolean(a.receipt || a.error || done), "E native popup action reaches original Worker response or explicit refusal");
      if (a.error || failure) throw a.error ?? failure;
      if (!a.receipt) {
        await q.pending; await cLibraryCopyCustodyNoWrite(q, floor);
        t.diagnostic("E_POPUP_COPY " + JSON.stringify({ caller, phase: "before-original-dispatch", trace, originalStatus: null,
          routeUnchanged: h.store.route.get() === a.route, historyPrivateFiscalResumeExact: true }));
      }
      assert.ok(a.receipt, "An enabled healthy popup action must admit the original copy before its trigger is hidden");
      await q.reached(); assert.equal(a.response.status, 200); assert.equal(a.response.bodyUsed, false);
      assert.equal(h.store.route.get(), a.route, "An unsettled copy does not own destination navigation");
      assert.equal(removal.records.length, 0, "Pending current-owner redraw is not native removal");
      assert.equal(removal.read().ownerConnected, true);
      assert.equal(f.renderer.openPopovers.has(panelId), true, "Original pending copy retains its own current More presentation");
      if (caller === "artifact-viewer") assert.equal(cManualDialog(q).port.open, true);
      a.gate.resolve(); await q.pending; await q.manualNative.settle(); await f.settle();
      const copied = await cManualEffects(q);
      assert.deepEqual(trace.slice(0, 2).map(value => value.phase), ["capture", "target"]);
      assert.equal(trace.filter(value => value.phase === "target").length, 1);
      const viewerBubbles = trace.filter(value => value.phase === "bubble" && value.tag === "dialog");
      assert.equal(viewerBubbles.length, caller === "artifact-viewer" ? 1 : 0);
      if (caller === "artifact-viewer") assert.equal(viewerBubbles[0].exactViewer, true);
      assert.equal(trace[0].targetVisible, true); assert.equal(trace[1].targetVisible, true);
      assert.equal(a.delivered, 1); assert.equal(documentIdFromRoute(h.store.route.get()), worker.documentId);
      assert.equal(h.store.ui.editingBlockId, copied.id);
      const targets = f.components().filter(component => component.tag === "forma-context-block" && component.isConnected
        && component.store === h.store && component.block?.id === copied.id && component.surface === "document");
      assert.equal(targets.length, 1); assert.equal(targets[0].readOnly, false);
      cManualRenderedEditor(q, copied, targets[0]);
      const nativeRemoval = removal.read();
      t.diagnostic("E_POPUP_NATIVE_REMOVAL " + JSON.stringify({ caller, current: nativeRemoval, records: removal.records }));
      if (caller === "output-card") {
        assert.deepEqual(nativeRemoval, { ownerConnected: false, panelConnected: false, panelPresent: false,
          sameOwnerNodes: 0, connectedSameIdNodes: 0, open: false });
        assert.equal(removal.records.length, 1, "Exactly the retired original owner supplied the removal proof");
      }
      assert.equal(f.renderer.openPopovers.has(panelId), false, "Only the acknowledged original closes its popup on arrival");
      t.diagnostic("E_POPUP_COPY " + JSON.stringify({ caller, phase: "original-arrival", trace, originalStatus: a.response.status,
        eventTypes: a.receipt.appended.map(event => event.type), copiedBlockId: copied.id,
        historyPrivateFiscalResumeExact: true,
        evidence: "actual native-menu handlers and original RAM Worker; explicit finite capture and panel visibility, not browser/provider evidence" }));
    } finally { a.gate.resolve(); if (q.pending) await q.pending; }
  });


// One local-route contrast: Library's keyed editor is intentionally retained by
// Back, but a sibling Assistant owns its exact route-scoped unsent draft.
function cLibraryBackAssistantReads(q) {
  const { h, worker } = q, previous = globalThis.fetch, rows = [], pending = new Set(), errors = [];
  const bridge = (input, init = {}) => {
    const url = new URL(String(input), "https://fixture.invalid");
    if (url.origin !== "https://fixture.invalid" || url.pathname !== "/api/assistant") return previous(input, init);
    const row = { url: url.pathname + url.search, request: null, response: null, body: null }; rows.push(row);
    const original = (async () => {
      assert.equal(init.method ?? "GET", "GET", "Only the actual current Assistant context read is bridged");
      assert.deepEqual(init, { headers: { accept: "application/json" }, cache: "no-store" });
      assert.equal(url.searchParams.get("route"), h.store.route.get());
      assert.equal(url.searchParams.get("projectId"), worker.projectId);
      assert.deepEqual([...url.searchParams.keys()], ["route", "projectId"]);
      const request = h.fetch(row.url, init); row.request = h.requests.at(-1);
      assert.equal(row.request.url, row.url); assert.strictEqual(row.request.init, init); assert.equal(row.request.body, null);
      const response = await request; row.response = response;
      assert.equal(response.status, 200, await response.clone().text());
      row.body = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(row.body.context.scope, { actorUserId: h.store.session.get().user.userId,
        organizationId: null, projectAccessId: null, projectId: worker.projectId, documentId: null });
      assert.deepEqual(row.body.turns, []); assert.deepEqual(row.body.tasks, []);
      return response; // The same original Worker Response reaches the real Assistant.
    })();
    pending.add(original); void original.then(() => pending.delete(original), error => { errors.push(error); pending.delete(original); });
    return original;
  };
  globalThis.fetch = bridge;
  return { rows, pendingCount: () => pending.size,
    restore() { if (globalThis.fetch === bridge) globalThis.fetch = previous; },
    async settle() { while (pending.size) await Promise.allSettled([...pending]); await worker.drainBackground(); assert.deepEqual(errors, []); },
    empty() {
      for (const table of ["assistant_turns", "assistant_action_proposals", "assistant_action_commits", "assistant_specialist_tasks", "assistant_billing_reconciliations"])
        if (worker.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
          assert.equal(worker.sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n, 0, "No Assistant business row: " + table);
      assert.deepEqual(errors, []);
    } };
}

async function cLibraryBackAssistantSettle(x) {
  const { f, h, resumes, reads } = x; let queues;
  for (let step = 0; step < 4; step++) {
    await resumes.settleOriginalRequests(); await reads.settle();
    for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
    await f.settle(); await resumes.settleOriginalRequests(); await reads.settle();
    queues = { transports: resumes.pendingOriginalCount(), assistantReads: reads.pendingCount(),
      componentFrames: f.frames.size, storeFrames: [...h.timers.values()].filter(timer => timer.delay === 16).length,
      renderRequests: Number(f.requested) };
    if (Object.values(queues).every(value => value === 0)) break;
  }
  assert.deepEqual(queues, { transports: 0, assistantReads: 0, componentFrames: 0, storeFrames: 0, renderRequests: 0 });
  reads.empty();
}

async function cLibraryBackAssistantClick(x, node) {
  await cLibraryCopyCustodyClick(x, node); await cLibraryBackAssistantSettle(x);
}

function cLibraryBackAssistantField(x, raw) {
  const { f, panel } = x;
  assert.ok(panel.isConnected && panel.open); assert.equal(panel.conversationScope, x.scope);
  const composers = f.components().filter(owner => owner.tag === "forma-ui-conversation-composer"
    && owner.isConnected && owner.parentElement === panel && panel.parentElement === x.assistant);
  assert.equal(composers.length, 1);
  const field = f.find("textarea", node => node.owner === composers[0] && classed(node, "forma-assistant-input"));
  assert.ok(field.port.isConnected && f.renderer.nodes.includes(field.port)); assert.equal(field.hiddenBy, null);
  assert.equal(field.port.matches(":disabled"), false); assert.equal(typeof field.handlers.input, "function");
  assert.equal(typeof field.propertyParts.value, "string"); assert.equal(field.port.value, raw); assert.equal(field.properties.value, raw);
  return field;
}

async function cLibraryBackAssistantOpen(x, raw) {
  const { f, h, panel, reads } = x, beforeReads = reads.rows.length, beforeRequests = h.requests.length;
  assert.ok(panel.isConnected && !panel.open); x.scope = panel.conversationScope;
  assert.equal(JSON.parse(x.scope)[9], h.store.route.get());
  await cLibraryBackAssistantClick(x, f.find("button", node => node.owner === panel && classed(node, "forma-assistant-launcher")));
  cLibraryBackAssistantField(x, raw);
  assert.equal(reads.rows.length, beforeReads + 1); const read = reads.rows.at(-1);
  assert.equal(read.response.bodyUsed, true, "Current Assistant consumes its same original context response");
  assert.deepEqual(h.requests.slice(beforeRequests), [read.request], "Only this exact deliberate context GET occurs on reopening");
}

async function cLibraryBackAssistantType(x, before, raw) {
  const { f, h } = x, field = cLibraryBackAssistantField(x, before), requests = h.requests.length;
  f.native.emit("keydown", field.port); f.native.focus(field.port); field.port.value = raw;
  await f.act(field, "input"); await cLibraryBackAssistantSettle(x); cLibraryBackAssistantField(x, raw);
  assert.equal(h.requests.length, requests, "Actual Assistant typing or clear makes no request");
}

async function cLibraryBackAssistantClose(x, raw) {
  const { f, h, panel } = x, requests = h.requests.length; cLibraryBackAssistantField(x, raw);
  await cLibraryBackAssistantClick(x, f.find("button", node => node.owner === panel && classed(node, "forma-assistant-close")));
  assert.equal(panel.open, false); assert.equal(panel.conversationScope, x.scope);
  assert.equal(panel.commandDepartureBlocked, raw !== ""); assert.equal(x.assistant.captureCommandDeparture().blocked(), raw !== "");
  assert.equal(h.requests.length, requests, "Collapse neither submits nor discards the current draft");
}

async function cLibraryBackAssistantNoEffects(x, floor) {
  const { h, worker, resumes, reads } = x;
  await cLibraryBackAssistantSettle(x); await worker.drainBackground();
  assert.equal(x.armed, null, "No Copy, Save or original append is armed in this local navigation case");
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), floor.history);
  assert.deepEqual(financial(worker), floor.financial);
  assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), floor.receipts);
  assert.equal(JSON.stringify(h.store.events.get()), floor.events); assert.equal(h.store.head.get(), floor.head);
  assert.equal(JSON.stringify(h.store.content.get()), floor.content); assert.equal(JSON.stringify(h.store.session.get()), floor.session);
  assert.ok(h.store.sourceOwnershipActive(floor.source) && h.store.authorizationScopeActive(floor.authorization));
  assert.deepEqual(h.store.projection.get().libraryBlocks.find(block => block.id === reusableId), x.originalBlock);
  assert.deepEqual(h.store.eventWriteAcknowledgments(floor.acknowledgmentOwner), floor.acknowledgments);
  assert.deepEqual(h.requests.slice(floor.requests).filter(request => (request.init.method ?? "GET") !== "GET"
    && !resumes.isReadOnlyResume(request)), [], "Only independently certified original free Resume can use POST; no implicit Save, Copy or provider command");
  reads.empty();
}

test("C Library Back retains its own cached editor but must preserve a sibling Assistant draft", { concurrency: false, timeout: 45_000 }, async t => {
  // This cleanup is registered before libraryAckPage's actual Worker teardown.
  let finish = async () => {}; t.after(async () => { await finish(); });
  const q = await libraryAckPage(t, "copy"), { f, h, worker } = q;
  await registerCalmFullPageComponents(f, ["forma-creative-assistant", "forma-library-block-editor"]);
  f.nativeHistoryLocation = h.location;
  const dispatch = h.window.dispatchEvent, routedDispatch = function (event) {
    const result = dispatch.call(this, event);
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener(event);
    return result;
  };
  h.window.dispatchEvent = routedDispatch;
  const reads = cLibraryBackAssistantReads(q), x = Object.assign(q, { reads });
  finish = async () => { try { await reads.settle(); await q.resumes.settleOriginalRequests(); await worker.drainBackground(); }
    finally { reads.restore(); if (h.window.dispatchEvent === routedDispatch) h.window.dispatchEvent = dispatch; } };
  // Genuine Worker session, using the existing mounted-Assistant fixture's
  // no-provider RAM configuration; no permission/session flag is fabricated.
  worker.env.OPENAI_API_KEY = ""; await h.store.refreshSession(); await cLibraryBackAssistantSettle(x);
  const session = h.store.session.get(); assert.equal(session.assistant.enabled, true);
  assert.equal(session.provider.configured, false); assert.equal(session.policy.accepted, true); assert.equal(session.projectContext, undefined);
  assert.ok(session.capabilities.includes("project.author"));
  const libraries = f.components().filter(value => value.tag === "forma-library" && value.isConnected && value.store === h.store);
  assert.equal(libraries.length, 1); const owner = libraries[0]; x.owner = owner;
  assert.ok(owner instanceof f.modules.get("src/components/forma-library.ts").FormaLibrary);
  const assistants = f.components().filter(value => value.tag === "forma-creative-assistant" && value.isConnected && value.store === h.store);
  assert.equal(assistants.length, 1); x.assistant = assistants[0]; assert.equal(x.assistant.closest("forma-shell"), f.host);
  const panels = f.components().filter(value => value.tag === "forma-assistant-panel" && value.isConnected && value.parentElement === x.assistant);
  assert.equal(panels.length, 1); x.panel = panels[0]; assert.equal(x.panel.open, false);
  assert.equal(x.panel.commandDepartureBlocked, false); assert.equal(x.assistant.captureCommandDeparture().blocked(), false);
  const rootRoute = h.store.route.get(); assert.equal(libraryFocusFromRoute(rootRoute), null);
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  const acknowledgmentOwner = { authorizationKey: authorization.key, actorUserId: session.user.userId,
    projectId: worker.projectId, sourceGeneration: source.generation };
  const floor = { source, authorization, acknowledgmentOwner, acknowledgments: structuredClone(h.store.eventWriteAcknowledgments(acknowledgmentOwner)),
    history: await readWorkspaceEvents(worker.env, worker.streamId), financial: financial(worker),
    receipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
    events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), content: JSON.stringify(h.store.content.get()),
    session: JSON.stringify(session), requests: h.requests.length };
  const controls = () => f.find("button", node => node.owner === owner && node.attributes["data-context-controls-id"] === reusableId);
  await cLibraryBackAssistantClick(x, controls());
  const editors = f.components().filter(value => value.tag === "forma-library-block-editor" && value.isConnected
    && value.store === h.store && value.blockId === reusableId);
  assert.equal(editors.length, 1); const editor = editors[0]; assert.equal(editor.closest("forma-library"), owner);
  const editorRoute = h.store.route.get(); assert.notEqual(editorRoute, rootRoute);
  const field = () => f.find("input", node => node.owner === editor && String(node.attributes.maxlength) === "96");
  const back = () => f.find("button", node => node.owner === editor && node.text === f.i18n.system("Back to Library"));
  assert.equal(field().port.value, q.originalBlock.handle); assert.equal(field().port.matches(":disabled"), false);
  const rawEditor = "  direction/retained-local-Back — 未保存  ", input = field();
  f.native.emit("pointerdown", input.port); f.native.focus(input.port); input.port.value = rawEditor;
  await f.act(input, "input"); await cLibraryBackAssistantSettle(x);
  const part = field().propertyParts.value; assert.equal(typeof part, "string"); assert.equal(field().port.value, rawEditor);
  assert.equal(field().properties.value, rawEditor); assert.equal(editor.navigationBlocked, true);
  assert.equal(owner.captureCommandDeparture().blocked(), true); assert.equal(x.assistant.captureCommandDeparture().blocked(), false);
  await cLibraryBackAssistantClick(x, back());
  assert.equal(h.store.route.get(), rootRoute, "Back safely retains its own keyed editor; it must not acquire a blanket raw-editor lock");
  assert.equal(editor.isConnected, false); assert.ok(owner.isConnected);
  assert.equal(f.tree().visible("form").some(node => node.owner === editor), false);
  await cLibraryBackAssistantNoEffects(x, floor);
  await cLibraryBackAssistantClick(x, controls());
  assert.deepEqual(f.components().filter(value => value.tag === "forma-library-block-editor" && value.isConnected), [editor]);
  assert.equal(h.store.route.get(), editorRoute); assert.equal(field().port.value, rawEditor);
  assert.equal(field().properties.value, rawEditor); assert.equal(field().propertyParts.value, part);
  await cLibraryBackAssistantOpen(x, "");
  const rawAssistant = "  Keep this unrelated Library Assistant draft — 未送信\n  ";
  await cLibraryBackAssistantType(x, "", rawAssistant); await cLibraryBackAssistantClose(x, rawAssistant);
  assert.equal(editor.navigationBlocked, true); assert.equal(owner.captureCommandDeparture().blocked(), true);
  assert.equal(f.tree().visible("dialog").filter(node => node.port.open).length, 0, "Back is not an inert background gesture");
  await cLibraryBackAssistantNoEffects(x, floor);
  const requests = h.requests.length, readCount = reads.rows.length, focus = f.native.nativeFocus.length, scroll = f.native.nativeScroll.length;
  await cLibraryBackAssistantClick(x, back()); await cLibraryBackAssistantNoEffects(x, floor);
  const sameScope = x.panel.isConnected && x.panel.conversationScope === x.scope;
  t.diagnostic("C_LIBRARY_BACK_SIBLING_CUSTODY " + JSON.stringify({ rootRoute, editorRoute, actualRoute: h.store.route.get(),
    libraryConnected: owner.isConnected, editorConnected: editor.isConnected, ownEditorStillBlocked: editor.navigationBlocked,
    sameAssistantScope: sameScope, assistantStillBlocked: sameScope && x.panel.commandDepartureBlocked,
    originalHistoryPrivateReceiptFiscalUnchanged: true, newRequests: h.requests.length - requests,
    evidence: "actual Controls/Back/cache and complete Assistant with original RAM Worker GET; safe own retention differs from sibling scope retirement; no physical/provider claim" }));
  assert.equal(h.store.route.get(), editorRoute, "Local Back must not retire the unrelated Assistant's existing route-scoped draft");
  assert.equal(h.location.pathname + h.location.search + h.location.hash, editorRoute);
  assert.ok(owner.isConnected && editor.isConnected); assert.equal(field().port.value, rawEditor);
  assert.equal(field().properties.value, rawEditor); assert.equal(field().propertyParts.value, part);
  assert.equal(sameScope, true); assert.equal(x.panel.open, false); assert.equal(x.panel.commandDepartureBlocked, true);
  assert.equal(x.assistant.captureCommandDeparture().blocked(), true); assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.assistantOwnsWork"));
  assert.equal(h.requests.length, requests); assert.equal(reads.rows.length, readCount);
  assert.equal(f.native.nativeFocus.slice(focus).some(call => call.node.attributes?.id === "main-content"), false);
  assert.equal(f.native.nativeScroll.length, scroll);
  await cLibraryBackAssistantOpen(x, rawAssistant); await cLibraryBackAssistantType(x, rawAssistant, ""); await cLibraryBackAssistantClose(x, "");
  assert.equal(editor.navigationBlocked, true, "Clearing Assistant does not discard the independent cached editor draft");
  await cLibraryBackAssistantClick(x, back()); assert.equal(h.store.route.get(), rootRoute); assert.equal(editor.isConnected, false);
  await cLibraryBackAssistantNoEffects(x, floor); await cLibraryBackAssistantClick(x, controls());
  assert.deepEqual(f.components().filter(value => value.tag === "forma-library-block-editor" && value.isConnected), [editor]);
  assert.equal(field().port.value, rawEditor); assert.equal(field().properties.value, rawEditor); assert.equal(field().propertyParts.value, part);
  assert.equal(x.assistant.captureCommandDeparture().blocked(), false); await cLibraryBackAssistantNoEffects(x, floor);
});


// C227: one real blank Library editor, no new reusable entity or Save.
test("C Library new reusable block / different catalog choice retains its emitted option identity", { concurrency: false, timeout: 45_000 }, async t => {
  let cleanup = async () => {}; t.after(async () => { await cleanup(); });
  const h = await writeFixture(t, { shared: false }), worker = h.worker;
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get(),
    history: await readWorkspaceEvents(worker.env, worker.streamId) };
  const resumes = observeActualSceneResumeReads(h);
  cleanup = async () => { await resumes.settleOriginalRequests(); await worker.drainBackground(); resumes.restore(); };
  const f = await createCalmFullPage(t, { locale: "en", storeHost: h });
  // Reuse the existing Library local-navigation bridge: forward the ORIGINAL
  // Store window event to the complete Shell's registered window listeners.
  f.nativeHistoryLocation = h.location;
  const dispatch = h.window.dispatchEvent, routedDispatch = function (event) {
    const result = dispatch.call(this, event);
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener(event);
    return result;
  };
  h.window.dispatchEvent = routedDispatch;
  cleanup = async () => { try { await resumes.settleOriginalRequests(); await worker.drainBackground(); }
    finally { resumes.restore(); if (h.window.dispatchEvent === routedDispatch) h.window.dispatchEvent = dispatch; } };
  // As in libraryAckPage, retain the actual Worker records, not the full host's
  // study-shaped presentation sample. This case adds no audit seed.
  h.store.events.set(original.events); h.store.head.set(original.head); h.store.content.set(original.content); h.store.session.set(original.session);
  h.store.setRoute(withDocumentInRoute("/", worker.documentId, "One current authored direction"));
  await h.store.syncDocumentFromRoute(); await f.settle();
  await registerCalmFullPageComponents(f, ["forma-workspace", "forma-library", "forma-library-block-editor"]);
  f.native = installOutputNavigationFocusNative(t, f, ports);
  const settle = async () => { await f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground(); await f.settle(); };
  await settle();
  const libraryTask = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && new URL(node.attributes.href, "https://fixture.invalid").pathname === "/library");
  f.native.emit("pointerdown", libraryTask.port); f.native.focus(libraryTask.port);
  await f.act(libraryTask, "click", { button: 0 }); await settle();
  const libraries = f.components().filter(value => value.tag === "forma-library" && value.isConnected && value.store === h.store);
  assert.equal(libraries.length, 1); const library = libraries[0];
  assert.ok(library instanceof f.modules.get("src/components/forma-library.ts").FormaLibrary);
  const create = f.find("button", node => node.owner === library && node.attributes["data-context-controls-id"] === "__new__");
  assert.equal(create.text.includes(f.i18n.t("projects.newReusableBlock", "New reusable block")), true);
  assert.ok(create.port.isConnected && f.renderer.nodes.includes(create.port)); assert.equal(create.port.matches(":disabled"), false);
  f.native.emit("pointerdown", create.port); f.native.focus(create.port);
  await f.act(create, "click", { button: 0 }); await settle();
  const editors = f.components().filter(value => value.tag === "forma-library-block-editor" && value.isConnected && value.store === h.store);
  assert.equal(editors.length, 1); const editor = editors[0];
  assert.ok(editor instanceof f.modules.get("src/components/library-block-editor.ts").LibraryBlockEditor);
  assert.equal(editor.blockId, null); assert.equal(editor.closest("forma-library"), library); assert.equal(editor.closest("forma-shell"), f.host);
  assert.equal(h.store.projection.get().projectId, worker.projectId); assert.equal(h.store.projection.get().documentId, worker.documentId);
  assert.equal(h.store.session.get().projectContext, undefined);
  assert.ok(h.store.session.get().capabilities.includes("project.author"));
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), original.history, "Opening an untouched form creates no entity or navigation append");
  const view = () => {
    const tree = f.tree(), forms = tree.visible("form").filter(node => node.owner === editor && classed(node, "library-block-form"));
    assert.equal(forms.length, 1); const form = forms[0]; assert.ok(form.port.isConnected);
    const labels = tree.visible("label").filter(node => node.owner === editor && inside(node, form)
      && node.children.some(child => typeof child === "string" && child.trim() === f.i18n.system("Suggested subtype")));
    assert.equal(labels.length, 1);
    const selects = tree.visible("select").filter(node => node.owner === editor && inside(node, labels[0]));
    assert.equal(selects.length, 1); const select = selects[0];
    assert.ok(select.port.isConnected && f.renderer.nodes.includes(select.port));
    assert.equal(select.port.closest("forma-library-block-editor"), editor); assert.equal(select.port.matches(":disabled"), false);
    assert.equal(select.port.handlers.change, select.handlers.change); assert.equal(typeof select.handlers.change, "function");
    const handles = tree.visible("input").filter(node => node.owner === editor && inside(node, form) && String(node.attributes.maxlength) === "96");
    assert.equal(handles.length, 1);
    return { select, handle: handles[0], options: tree.nodes.filter(node => node.tag === "option" && node.owner === editor && inside(node, select)) };
  };
  const optionBinding = (current, value) => {
    const options = current.options.filter(node => String(node.attributes.value ?? node.text) === value);
    assert.equal(options.length, 1); const option = options[0]; assert.ok(option.port.isConnected);
    const token = option.port.full.match(/\svalue=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u); assert.ok(token);
    const binding = f.renderer.bindings[Number(token[1])];
    assert.equal(binding.owner, editor); assert.equal(binding.value, value); assert.equal(typeof binding.part, "string");
    return { option, part: binding.part };
  };
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  assert.ok(source && authorization && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
  const acknowledgementOwner = { authorizationKey: authorization.key, actorUserId: h.store.session.get().user.userId,
    projectId: worker.projectId, sourceGeneration: source.generation };
  const privateRows = () => ({ content: worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(),
    payloads: worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all() });
  const floor = { route: h.store.route.get(), history: await readWorkspaceEvents(worker.env, worker.streamId), private: privateRows(),
    money: financial(worker), receipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
    events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), content: JSON.stringify(h.store.content.get()),
    session: JSON.stringify(h.store.session.get()), blocks: JSON.stringify(h.store.projection.get().libraryBlocks),
    acknowledgements: structuredClone(h.store.eventWriteAcknowledgments(acknowledgementOwner)), requests: h.requests.length };
  const unchanged = async () => {
    await settle();
    assert.equal(editor.isConnected, true); assert.equal(editor.store, h.store); assert.equal(editor.blockId, null);
    assert.equal(editor.closest("forma-library"), library); assert.equal(editor.closest("forma-shell"), f.host);
    assert.equal(h.store.route.get(), floor.route);
    assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), floor.history); assert.deepEqual(privateRows(), floor.private);
    assert.deepEqual(financial(worker), floor.money);
    assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), floor.receipts);
    assert.equal(JSON.stringify(h.store.events.get()), floor.events); assert.equal(h.store.head.get(), floor.head);
    assert.equal(JSON.stringify(h.store.content.get()), floor.content); assert.equal(JSON.stringify(h.store.session.get()), floor.session);
    assert.equal(JSON.stringify(h.store.projection.get().libraryBlocks), floor.blocks);
    assert.deepEqual(h.store.eventWriteAcknowledgments(acknowledgementOwner), floor.acknowledgements);
    assert.deepEqual(h.requests.slice(floor.requests), [], "Native choice and local raw input make no HTTP request, Save or entity");
    assert.equal(globalThis.fetch.mock.callCount(), 0, "No swallowed external/provider request");
  };
  const change = async (node, value, eventName) => {
    assert.ok(node.port.isConnected && f.renderer.nodes.includes(node.port)); assert.equal(node.port.matches(":disabled"), false);
    f.native.emit("pointerdown", node.port); f.native.focus(node.port);
    node.port.value = value; await f.act(node, eventName); await unchanged();
  };
  let current = view();
  assert.equal(current.select.port.value, "Campaign goal"); assert.equal(current.handle.port.value, "");
  assert.equal(editor.navigationBlocked, false);
  const initial = optionBinding(current, "Campaign goal"), chosen = optionBinding(current, "Emotional outcome");
  assert.deepEqual(current.options.map(node => String(node.attributes.value)), ["Campaign goal", "Emotional outcome", "Behavioral objective", "Exploration question"]);
  await unchanged(); current = view();
  assert.equal(optionBinding(current, "Campaign goal").part, initial.part);
  assert.equal(optionBinding(current, "Emotional outcome").part, chosen.part, "Healthy unchanged render retains each value's emitted option part");
  await change(current.select, "Emotional outcome", "change");
  current = view(); const changed = optionBinding(current, "Emotional outcome");
  assert.equal(current.select.port.value, "Emotional outcome"); assert.equal(current.select.properties.value, "Emotional outcome");
  assert.equal(current.handle.port.value, ""); assert.equal(editor.navigationBlocked, true);
  t.diagnostic("C_LIBRARY_DIFFERENT_CATALOG_OPTION " + JSON.stringify({ originalSubtype: "Campaign goal", chosenSubtype: "Emotional outcome",
    currentReportedValue: current.select.port.value, chosenEmittedOptionPartRetained: changed.part === chosen.part,
    selectedIndex: typeof current.select.port.selectedIndex === "number" ? current.select.port.selectedIndex : null,
    nativeOptionSelected: typeof changed.option.port.selected === "boolean" ? changed.option.port.selected : null,
    sameActualEditor: editor.isConnected && editor.store === h.store, originalHistoryPrivateReceiptsAndFiscalUnchanged: true,
    boundary: "actual current change and emitted AttributePart identity; no select IDL, DOM-lifetime or physical native proof; no Save" }));
  assert.equal(changed.part, chosen.part, "A different actual catalog choice must keep its own emitted option value part, not another value's reused position");
  const raw = "  direction/unsaved-subtype-choice — 未保存  ";
  await change(current.handle, raw, "input"); current = view();
  assert.equal(current.handle.port.value, raw); assert.equal(current.handle.properties.value, raw);
  assert.equal(current.select.port.value, "Emotional outcome"); assert.equal(optionBinding(current, "Emotional outcome").part, chosen.part);
  await change(current.handle, "", "input"); await change(view().select, "Campaign goal", "change");
  current = view(); assert.equal(current.handle.port.value, ""); assert.equal(current.select.port.value, "Campaign goal");
  assert.equal(optionBinding(current, "Campaign goal").part, initial.part); assert.equal(editor.navigationBlocked, false);
  await unchanged();
});

// E11 copy only: reuse the original actual Library/Store/RAM Worker fixture.
// Its existing remove setup supplies one genuinely kept story before the floor;
// these cases never arm or activate Remove, Keep, import, creation or generation.
// All old case bodies remain unchanged; the optional locale still defaults to en.
// Observe every real filtered state and all custody before the desired copy.
// This is finite text/interaction evidence, not CSS, native-language or audio proof.
const E11_LIBRARY_FILTER_HELP = {
  en: {
    description: "Find reusable ideas and creative outputs in this project.",
    recent: "Project outputs appear here when they match the current search and collection filter.",
    kept: "Outputs kept for reuse appear here when they match the current search and collection filter.",
  },
  fr: {
    description: "Retrouvez les idées réutilisables et les créations de ce projet.",
    recent: "Les créations du projet apparaissent ici lorsqu’elles correspondent à la recherche et au filtre de collection actuels.",
    kept: "Les créations conservées pour réutilisation apparaissent ici lorsqu’elles correspondent à la recherche et au filtre de collection actuels.",
  },
  ar: {
    description: "اعثر على الأفكار القابلة لإعادة الاستخدام والمخرجات الإبداعية في هذا المشروع.",
    recent: "تظهر مخرجات المشروع هنا عندما تطابق البحث الحالي وعامل تصفية المجموعة الحالي.",
    kept: "تظهر المخرجات المحفوظة لإعادة الاستخدام هنا عندما تطابق البحث الحالي وعامل تصفية المجموعة الحالي.",
  },
  ja: {
    description: "このプロジェクトの再利用可能なアイデアやクリエイティブな成果物を探せます。",
    recent: "現在の検索条件とコレクションのフィルターに一致するプロジェクトの成果物がここに表示されます。",
    kept: "再利用のために保存した成果物のうち、現在の検索条件とコレクションのフィルターに一致するものがここに表示されます。",
  },
};
for (const [locale, expected] of Object.entries(E11_LIBRARY_FILTER_HELP)) test(
  "E11 Library " + locale + " description and filtered Recent/Kept help are format-neutral without dispatch",
  { concurrency: false, timeout: 45_000 }, async t => {
    const q = await libraryAckPage(t, "remove", { locale }), { f, h, worker, owner, resumes, source, authorization } = q;
    const settle = async () => { await f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground(); await f.settle(); };
    await settle();
    assert.equal(f.i18n.locale, locale); assert.equal(owner.i18n.locale, locale);
    assert.equal(h.store.ui.libraryView, "all"); assert.equal(h.store.ui.libraryOutputScope, "recent");
    assert.equal(h.store.ui.focusCollectionId, "", "Use the existing all-collections scope; no active-collection witness is claimed");
    const original = structuredClone(h.store.projection.get().libraryArtifacts.find(artifact => artifact.id === "saved-scene-story"));
    assert.ok(original); assert.equal(original.library, true); assert.equal(original.documentId, worker.documentId);
    assert.deepEqual(h.store.projection.get().libraryArtifacts.filter(artifact => artifact.library).map(artifact => artifact.id), [original.id]);
    assert.equal(h.store.projection.get().libraryOutputs.filter(output => output.library).length, 0);
    assert.equal(h.store.content.get()[worker.contentRef], worker.content);
    const acknowledgementOwner = { authorizationKey: authorization.key, actorUserId: h.store.session.get().user.userId,
      projectId: worker.projectId, sourceGeneration: source.generation };
    const privateRows = () => ({ content: worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(),
      payloads: worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all() });
    const floor = { route: h.store.route.get(), history: await readWorkspaceEvents(worker.env, worker.streamId),
      private: privateRows(), money: financial(worker),
      receipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
      events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), content: JSON.stringify(h.store.content.get()),
      session: JSON.stringify(h.store.session.get()), blocks: JSON.stringify(h.store.projection.get().libraryBlocks),
      artifacts: JSON.stringify(h.store.projection.get().libraryArtifacts), outputs: JSON.stringify(h.store.projection.get().libraryOutputs),
      collections: JSON.stringify(h.store.projection.get().collections), membership: JSON.stringify(h.store.projection.get().membership),
      acknowledgements: structuredClone(h.store.eventWriteAcknowledgments(acknowledgementOwner)), requests: h.requests.length };
    const unchanged = async () => {
      await settle();
      assert.equal(owner.isConnected, true); assert.equal(owner.store, h.store); assert.equal(owner.closest("forma-shell"), f.host);
      assert.equal(h.store.route.get(), floor.route);
      assert.equal(h.store.projection.get().projectId, worker.projectId); assert.equal(h.store.projection.get().documentId, worker.documentId);
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), floor.history);
      assert.deepEqual(privateRows(), floor.private); assert.deepEqual(financial(worker), floor.money);
      assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), floor.receipts);
      assert.equal(JSON.stringify(h.store.events.get()), floor.events); assert.equal(h.store.head.get(), floor.head);
      assert.equal(JSON.stringify(h.store.content.get()), floor.content); assert.equal(JSON.stringify(h.store.session.get()), floor.session);
      assert.equal(JSON.stringify(h.store.projection.get().libraryBlocks), floor.blocks);
      assert.equal(JSON.stringify(h.store.projection.get().libraryArtifacts), floor.artifacts);
      assert.equal(JSON.stringify(h.store.projection.get().libraryOutputs), floor.outputs);
      assert.equal(JSON.stringify(h.store.projection.get().collections), floor.collections);
      assert.equal(JSON.stringify(h.store.projection.get().membership), floor.membership);
      assert.equal(h.store.ui.focusCollectionId, ""); assert.equal(h.store.ui.libraryView, "all");
      assert.deepEqual(h.store.projection.get().libraryArtifacts.find(artifact => artifact.id === original.id), original);
      assert.deepEqual(h.store.eventWriteAcknowledgments(acknowledgementOwner), floor.acknowledgements);
      assert.equal(q.armed, null); assert.equal(q.pending, null);
      assert.deepEqual(h.requests.slice(floor.requests), [], "Filtering changes no request, receipt, import, entity, output or provider state");
      assert.equal(globalThis.fetch.mock.callCount(), 0, "No swallowed external/provider call");
    };
    const view = () => {
      const tree = f.tree();
      const headers = tree.visible("header").filter(node => node.owner === owner && classed(node, "page-header--library"));
      assert.equal(headers.length, 1);
      const descriptions = tree.visible("p").filter(node => node.owner === owner && inside(node, headers[0]));
      assert.equal(descriptions.length, 1);
      const histories = tree.nodes.filter(node => node.tag === "forma-ui-segmented-control" && !node.hiddenBy
        && node.owner === owner && classed(node, "compact-segmented"));
      assert.equal(histories.length, 1); const history = histories[0];
      assert.equal(history.component.parentElement, owner);
      assert.equal(history.component.label, f.i18n.t("projects.outputHistory", "Output history"));
      let section = history.parent; while (section && section.tag !== "section") section = section.parent;
      assert.ok(section); assert.equal(section.owner, owner);
      const grids = tree.visible("div").filter(node => node.owner === owner && classed(node, "library-output-grid") && inside(node, section));
      assert.equal(grids.length, 1);
      const buttons = tree.visible("button").filter(node => node.owner === history.component && inside(node, history));
      assert.equal(buttons.length, 2);
      const pressed = buttons.filter(node => String(node.attributes["aria-pressed"]) === "true");
      assert.equal(pressed.length, 1);
      const empty = tree.visible("div").filter(node => node.owner === owner && classed(node, "family-empty") && inside(node, section));
      const cards = tree.visible("article").filter(node => node.owner === owner && classed(node, "library-output") && inside(node, grids[0]));
      const artifactIds = tree.nodes.filter(node => node.tag === "forma-artifact-summary" && !node.hiddenBy && inside(node, grids[0]))
        .map(node => node.component.artifact.id);
      const help = empty.length ? tree.visible("p").filter(node => node.owner === owner && inside(node, empty[0])) : [];
      assert.equal(empty.length, cards.length ? 0 : 1); assert.equal(help.length, empty.length);
      return { description: descriptions[0].text, history, buttons, pressed: pressed[0], cards, artifactIds, help: help[0]?.text };
    };
    const currentSearch = () => f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === owner);
    const assertScope = (current, value) => {
      assert.equal(current.history.component.value, value); assert.equal(h.store.ui.libraryOutputScope, value);
      const option = current.history.component.options.find(item => item.value === value); assert.ok(option);
      assert.equal(current.pressed.text, option.label);
    };
    const choose = async value => {
      const current = view(), option = current.history.component.options.find(item => item.value === value); assert.ok(option);
      const buttons = current.buttons.filter(node => node.text === option.label); assert.equal(buttons.length, 1);
      const button = buttons[0]; assert.ok(button.port.isConnected && f.renderer.nodes.includes(button.port));
      assert.equal(button.port.matches(":disabled"), false);
      f.native.emit("pointerdown", button.port); f.native.focus(button.port); await f.act(button);
      await unchanged(); assertScope(view(), value);
    };
    const search = async value => {
      const current = currentSearch(); assert.ok(current.port.isConnected && f.renderer.nodes.includes(current.port));
      assert.equal(current.port.matches(":disabled"), false);
      f.native.emit("pointerdown", current.port); f.native.focus(current.port); current.port.value = value;
      await f.act(current, "input"); await unchanged(); assert.equal(currentSearch().port.value, value);
    };
    let current = view(); assertScope(current, "recent"); assert.equal(currentSearch().port.value, "");
    assert.ok(current.artifactIds.includes(original.id));
    const observed = { description: current.description, recent: "", kept: "" };
    await choose("kept"); current = view();
    assert.equal(current.cards.length, 1); assert.deepEqual(current.artifactIds, [original.id]);
    await choose("recent");
    const raw = "  e11-no-matching-library-output-" + locale + " — 未入力  ";
    await search(raw); current = view(); assertScope(current, "recent");
    assert.equal(current.cards.length, 0); assert.deepEqual(current.artifactIds, []); assert.ok(current.help);
    observed.recent = current.help;
    await choose("kept"); current = view(); assert.equal(currentSearch().port.value, raw);
    assert.equal(current.cards.length, 0); assert.deepEqual(current.artifactIds, []); assert.ok(current.help);
    observed.kept = current.help;
    await search(""); current = view(); assertScope(current, "kept");
    assert.equal(current.cards.length, 1); assert.deepEqual(current.artifactIds, [original.id]);
    await choose("recent"); await unchanged(); current = view(); assertScope(current, "recent");
    assert.equal(currentSearch().port.value, ""); assert.ok(current.artifactIds.includes(original.id));
    t.diagnostic("E11_LIBRARY_FILTER_HELP " + JSON.stringify({ locale, observed, originalArtifact: original.id,
      realRecentAndKeptFilteredEmptyThenRestored: true, defaultAllCollectionsOnly: true,
      originalSourceHistoryPrivateReceiptsAndFinancialUnchanged: true, newRequests: h.requests.length - floor.requests,
      boundary: "actual rendered catalog text and current emitted controls; no physical-fit, audio, active-collection or generation claim" }));
    assert.deepEqual(observed, expected, "Only after both real empty views, restored kept work and zero-new-effects proof: truthful format-neutral help");
  });

// E-stage copy only. Actual Library/Store/RAM Worker; no new audit seed or Save.
// Property/label/help observations do not certify CSS, native selection or AT.
test("E Library reusable content / French catalog guidance keeps authored text and selector keys", { concurrency: false, timeout: 45_000 }, async t => {
  let cleanup = async () => {}; t.after(async () => { await cleanup(); });
  const h = await writeFixture(t, { shared: false }), worker = h.worker;
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get(),
    history: await readWorkspaceEvents(worker.env, worker.streamId) };
  const resumes = observeActualSceneResumeReads(h);
  cleanup = async () => { await resumes.settleOriginalRequests(); await worker.drainBackground(); resumes.restore(); };
  const f = await createCalmFullPage(t, { locale: "fr", storeHost: h });
  // Existing original Store window-event bridge, not a replacement navigation.
  f.nativeHistoryLocation = h.location;
  const dispatch = h.window.dispatchEvent, routedDispatch = function (event) {
    const result = dispatch.call(this, event);
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener(event);
    return result;
  };
  h.window.dispatchEvent = routedDispatch;
  cleanup = async () => { try { await resumes.settleOriginalRequests(); await worker.drainBackground(); }
    finally { resumes.restore(); if (h.window.dispatchEvent === routedDispatch) h.window.dispatchEvent = dispatch; } };
  h.store.events.set(original.events); h.store.head.set(original.head); h.store.content.set(original.content); h.store.session.set(original.session);
  h.store.setRoute(withDocumentInRoute("/", worker.documentId, "One current authored direction"));
  await h.store.syncDocumentFromRoute(); await f.settle();
  await registerCalmFullPageComponents(f, ["forma-workspace", "forma-library", "forma-library-block-editor"]);
  f.native = installOutputNavigationFocusNative(t, f, ports);
  const settle = async () => { await f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground(); await f.settle(); };
  const activate = async (node, eventName = "click", value) => {
    assert.ok(node.port.isConnected && f.renderer.nodes.includes(node.port)); assert.equal(node.port.matches(":disabled"), false);
    assert.equal(node.port.handlers[eventName], node.handlers[eventName]); assert.equal(typeof node.handlers[eventName], "function");
    f.native.emit("pointerdown", node.port); f.native.focus(node.port); if (value !== undefined) node.port.value = value;
    await f.act(node, eventName, { button: 0 }); await settle();
  };
  await settle();
  await activate(f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && new URL(node.attributes.href, "https://fixture.invalid").pathname === "/library"));
  const libraries = f.components().filter(value => value.tag === "forma-library" && value.isConnected && value.store === h.store);
  assert.equal(libraries.length, 1); const library = libraries[0];
  assert.ok(library instanceof f.modules.get("src/components/forma-library.ts").FormaLibrary);
  const create = f.find("button", node => node.owner === library && node.attributes["data-context-controls-id"] === "__new__");
  assert.equal(create.text.includes(f.i18n.t("projects.newReusableBlock", "New reusable block")), true);
  await activate(create);
  const editors = f.components().filter(value => value.tag === "forma-library-block-editor" && value.isConnected && value.store === h.store);
  assert.equal(editors.length, 1); const editor = editors[0];
  assert.ok(editor instanceof f.modules.get("src/components/library-block-editor.ts").LibraryBlockEditor);
  assert.equal(editor.blockId, null); assert.equal(editor.closest("forma-library"), library); assert.equal(editor.closest("forma-shell"), f.host);
  assert.equal(editor.i18n.locale, "fr"); assert.equal(h.store.session.get().projectContext, undefined);
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), original.history, "Opening the untouched form creates no entity");
  const view = () => {
    const tree = f.tree(), forms = tree.visible("form").filter(node => node.owner === editor && classed(node, "library-block-form"));
    assert.equal(forms.length, 1); const form = forms[0]; assert.ok(form.port.isConnected);
    const richNodes = tree.nodes.filter(node => node.tag === "forma-ui-rich-text" && node.owner === editor && classed(node, "block-editor-copy") && inside(node, form));
    assert.equal(richNodes.length, 1);
    const rich = richNodes[0].component; assert.ok(rich.isConnected); assert.equal(rich.closest("forma-library-block-editor"), editor);
    assert.ok(rich instanceof f.modules.get("src/components/design-system/forms.ts").FormaUiRichText);
    const fields = tree.visible("textarea").filter(node => node.owner === rich && classed(node, "ui-rich-text-input"));
    assert.equal(fields.length, 1); const text = fields[0]; assert.ok(text.port.isConnected);
    const labels = tree.visible("label").filter(node => node.owner === rich && node.attributes.for === text.attributes.id);
    const helpId = String(text.attributes["aria-describedby"]).split(" ")[0];
    const helps = tree.visible("small").filter(node => node.owner === rich && node.attributes.id === helpId);
    assert.equal(labels.length, 1); assert.equal(helps.length, 1);
    const identity = tree.visible("fieldset").filter(node => node.owner === editor && node.attributes["aria-labelledby"] === "library-block-identity");
    assert.equal(identity.length, 1);
    const selects = tree.visible("select").filter(node => node.owner === editor && inside(node, identity[0]));
    assert.equal(selects.length, 3);
    for (const select of selects) assert.ok(select.port.isConnected && select.port.closest("form") === form.port);
    const option = tree.nodes.filter(node => node.tag === "option" && node.owner === editor && inside(node, selects[0]) && node.attributes.value === "direction");
    assert.equal(option.length, 1);
    return { rich, text, label: labels[0], help: helps[0], selects, typeName: option[0].text };
  };
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  assert.ok(source && authorization && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
  const ackOwner = { authorizationKey: authorization.key, actorUserId: h.store.session.get().user.userId,
    projectId: worker.projectId, sourceGeneration: source.generation };
  const privateRows = () => ({ content: worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(),
    payloads: worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all() });
  const floor = { route: h.store.route.get(), history: await readWorkspaceEvents(worker.env, worker.streamId), private: privateRows(), money: financial(worker),
    receipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), events: JSON.stringify(h.store.events.get()),
    head: h.store.head.get(), content: JSON.stringify(h.store.content.get()), session: JSON.stringify(h.store.session.get()),
    blocks: JSON.stringify(h.store.projection.get().libraryBlocks), acknowledgements: structuredClone(h.store.eventWriteAcknowledgments(ackOwner)), requests: h.requests.length };
  const noEffects = async () => {
    await settle(); assert.equal(editor.isConnected, true); assert.equal(editor.blockId, null); assert.equal(editor.store, h.store);
    assert.equal(h.store.route.get(), floor.route); assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), floor.history); assert.deepEqual(privateRows(), floor.private);
    assert.deepEqual(financial(worker), floor.money); assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), floor.receipts);
    assert.equal(JSON.stringify(h.store.events.get()), floor.events); assert.equal(h.store.head.get(), floor.head);
    assert.equal(JSON.stringify(h.store.content.get()), floor.content); assert.equal(JSON.stringify(h.store.session.get()), floor.session);
    assert.equal(JSON.stringify(h.store.projection.get().libraryBlocks), floor.blocks);
    assert.deepEqual(h.store.eventWriteAcknowledgments(ackOwner), floor.acknowledgements); assert.deepEqual(h.requests.slice(floor.requests), []);
    assert.equal(globalThis.fetch.mock.callCount(), 0, "No external/provider request");
  };
  let current = view(); const keys = current.selects.map(node => node.port.value);
  assert.deepEqual(keys, ["direction", "Campaign goal", "include"]); assert.equal(current.typeName, "Orientation");
  assert.equal(current.text.port.value, ""); assert.equal(editor.navigationBlocked, false);
  const raw = "  The outcome or change the work should create — 私の文章  ";
  await activate(current.text, "input", raw); await noEffects(); current = view();
  assert.equal(current.text.port.value, raw); assert.equal(current.text.properties.value, raw); assert.equal(current.rich.value, raw);
  assert.deepEqual(current.selects.map(node => node.port.value), keys); assert.equal(editor.navigationBlocked, true);
  const label = f.i18n.system("{label} content", { label: f.i18n.system("Direction") });
  const description = f.i18n.system("The outcome or change the work should create");
  assert.equal(description, "Le résultat ou le changement que la création doit produire");
  const help = f.i18n.system("{description}. This remains project context until someone copies it into a document.", { description });
  t.diagnostic("E_LIBRARY_CATALOG_COPY " + JSON.stringify({ locale: editor.i18n.locale, typeKey: keys[0], typeLabel: current.typeName,
    actualLabel: current.rich.label, actualHelp: current.rich.help, sameEditor: editor.isConnected && editor.store === h.store,
    rawUnchanged: current.text.port.value === raw, originalHistoryPrivateReceiptsAndFiscalUnchanged: true }));
  assert.equal(current.rich.label, label, "The catalog type inside the translated label uses the same existing French term as Type");
  assert.equal(current.label.text, label); assert.equal(current.rich.help, help, "Translate the catalog description before interpolating the translated guidance");
  assert.equal(current.help.text, help + " " + f.i18n.t("editor.help"));
  await activate(current.text, "input", ""); await noEffects(); current = view();
  assert.equal(current.text.port.value, ""); assert.deepEqual(current.selects.map(node => node.port.value), keys); assert.equal(editor.navigationBlocked, false);
});

// E4: one exact native edit handler at a time changes A to B and back to A.
// The original three Taste witnesses above remain unchanged; identical final
// bytes do not make a newer local editing intent belong to an older ACK.
for (const editedField of ["axis", "polarity", "value", "note"]) test(
  "E4 Taste original Worker200 preserves same-opening A-B-A / " + editedField,
  { concurrency: false, timeout: 60_000 }, async t => {
    const q = await cManualPage(t, "output-card", { taste: true }), { f, h } = q, caller = q.caller;
    assert.ok(caller.isConnected && caller.store === h.store); assert.equal(caller.output.id, q.originalOutput.id);
    assert.equal(Boolean(h.store.session.get().projectContext), false);
    const original = h.store.critiqueObject; q.tasteCalls = [];
    t.mock.method(h.store, "critiqueObject", function (...args) {
      const call = { args, returned: undefined }; q.tasteCalls.push(call);
      const promise = Reflect.apply(original, this, args); call.promise = promise;
      promise.then(value => { call.returned = value; }, error => { call.error = error; }); return promise;
    });
    await cTasteToggle(q); await cTasteFill(q, cTasteA); q.tasteOriginal = { ...cTasteA };
    const a = await q.arm(), submit = cTasteRecord(q), form = cTasteForm(q);
    assert.equal(submit.port.matches(":disabled"), false); assert.equal(submit.hiddenBy, null);
    f.native.emit("pointerdown", submit.port); f.native.focus(submit.port);
    q.pending = f.act(form, "submit", { submitter: submit.port }); void q.pending.catch(() => {});
    try {
      await q.reached(); await f.settle();
      assert.equal(q.tasteCalls.length, 1); assert.equal(q.tasteCalls[0].returned, undefined);
      assert.equal(cTasteRecord(q).port.matches(":disabled"), true);
      assert.deepEqual(cTasteRead(q), cTasteA);
      const edits = [];
      for (const value of [cTasteB[editedField], cTasteA[editedField]]) {
        if (editedField === "axis" || editedField === "polarity") {
          const control = cTasteControl(q, node => editedField === "axis" ? node.text === value : classed(node, value));
          assert.equal(control.port.matches(":disabled"), false);
          await cLibraryCopyCustodyClick(q, control);
        } else {
          const field = editedField === "note" ? cTasteOpenNote(q) : cTasteField(q, "value", { visible: true });
          assert.equal(field.owner, caller); assert.ok(field.port.isConnected && f.renderer.nodes.includes(field.port));
          assert.equal(field.port.matches(":disabled"), false);
          f.native.emit("pointerdown", field.port); f.native.focus(field.port); field.port.value = value;
          await f.act(field, "input");
        }
        const observed = cTasteRead(q); edits.push(observed);
        assert.deepEqual(observed, { ...cTasteA, [editedField]: value }, "Only the selected real field changes; no other handler masks its A-B-A currency");
        assert.equal(q.caller, caller); assert.ok(caller.isConnected && caller.store === h.store);
        assert.equal(h.store.route.get(), a.route);
        assert.ok(h.store.sourceOwnershipActive(q.source) && h.store.authorizationScopeActive(q.authorization));
        assert.deepEqual(caller.output, q.originalOutput);
        assert.equal(h.store.busy.get(), "critique-object"); assert.equal(q.tasteCalls[0].returned, undefined);
        assert.equal(cTasteRecord(q).port.matches(":disabled"), true);
        assert.equal(h.requests.filter(eventPost).length, 1, "Editing does not retry or replace the original critique");
      }
      const before = cTasteRead(q);
      assert.deepEqual(before, cTasteA, "The newer draft has the original bytes in the same still-open form");
      a.gate.resolve(); await q.pending; await f.settle();
      const event = await libraryAckEffects(q), forms = cTasteForms(q), after = forms.length ? cTasteRead(q) : null;
      assert.equal(event.type, "ObjectCritiqued"); assert.equal(a.delivered, 1); assert.equal(a.response.status, 200);
      assert.equal(h.store.route.get(), a.route); assert.ok(caller.isConnected && caller.store === h.store);
      assert.deepEqual(caller.output, q.originalOutput);
      t.diagnostic("E4_TASTE_SAME_OPENING_ABA " + JSON.stringify({ editedField, edits, before, after,
        originalEvent: a.sql, originalNoteRef: event.payload.note_ref, actualStoreReturned: q.tasteCalls[0].returned,
        actual200Delivered: a.delivered, originalWriteCount: h.requests.filter(eventPost).length,
        formVisible: forms.length === 1, originalHistoryPrivateFiscalExact: true, physicalOrProviderClaim: false }));
      assert.equal(forms.length, 1, "The original ACK cannot close a newer A-B-A editing intent");
      assert.deepEqual(after, cTasteA, "All exact raw fields and selectors of the newer intent remain available");
      assert.equal(cTasteRecord(q).port.matches(":disabled"), false, "The retained current draft is usable once the original recording settles");
      assert.equal(cTasteOpenNote(q).port.value, cTasteA.note);
      assert.equal(h.requests.filter(eventPost).length, 1, "No automatic second critique is sent for the preserved draft");
      await cLibraryCopyCustodyClick(q, cTasteControl(q, node => node.text === f.i18n.system("Cancel")));
      assert.equal(cTasteForms(q).length, 0, "Deliberate Close/Cancel remains available after settlement");
      await cTasteToggle(q); assert.deepEqual(cTasteRead(q), cTasteA, "Existing close-and-reopen retention is not converted into discard");
      await libraryAckEffects(q);
    } finally { a.gate.resolve(); if (q.pending) await q.pending; }
  });
