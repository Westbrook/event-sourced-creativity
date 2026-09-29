import assert from "node:assert/strict";
import test from "node:test";
import { writeFixture, readWorkspaceEvents, financial, sceneDeferred, untilScene, withDocumentInRoute } from "./helpers/event-source-retirement-fixture.mjs";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";

// Complete actual Workspace/Shell/Store/RAM Worker. Only the original positive
// response delivery is held. No private field/method, permission or ACK is set.
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, parent) => { for (let at = node.parent; at; at = at.parent) if (at === parent) return true; return false; };
const eventPost = request => request.url === "/api/events" && request.init.method === "POST";

// Reuse E's exact descendant-query/select seam, scoped to this actual owner.
// It models only the native input call, not CSS, physical focus or authority.
function renameNative(f, workspace) {
  const selections = [], query = f.renderer.query.bind(f.renderer), collect = f.renderer.collect.bind(f.renderer);
  f.renderer.query = (owner, selector) => {
    if (owner !== workspace || selector !== ".document-title-editor input") return query(owner, selector);
    const tree = f.tree(), forms = tree.visible("form").filter(node => node.owner === owner && classed(node, "document-title-editor"));
    assert.ok(forms.length <= 1);
    const fields = tree.visible("input").filter(node => node.owner === owner && node.attributes.id === "document-title-input" && inside(node, forms[0]));
    assert.ok(fields.length <= 1); return fields.map(node => node.port);
  };
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length, result = collect(markup, owner);
    if (owner === workspace) for (const node of f.renderer.nodes.slice(start)) if (node.tag === "input" && node.attributes.id === "document-title-input")
      node.select = () => {
        assert.ok(node.isConnected && f.renderer.nodes.includes(node));
        node.selectionStart = 0; node.selectionEnd = String(node.value).length; selections.push(node.value);
      };
    return result;
  };
  return selections;
}

async function renamePage(t, locale) {
  let cleanup = async () => {};
  // Settle the held original before writeFixture's existing SQLite cleanup.
  t.after(async () => { await cleanup(); });
  const h = await writeFixture(t, { shared: false }), worker = h.worker;
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get() };
  const resumes = observeActualSceneResumeReads(h);
  cleanup = async () => { await resumes.settleOriginalRequests(); await worker.drainBackground(); resumes.restore(); };
  const f = await createCalmFullPage(t, { locale, storeHost: { ...h, close() {} } });
  // Discard only the existing presentation sample, restoring the actual source
  // captured before constructing the complete page; never seed a rename result.
  h.store.events.set(original.events); h.store.head.set(original.head);
  h.store.content.set(original.content); h.store.session.set(original.session);
  const document = h.store.projection.get().documents.find(row => row.id === worker.documentId && row.projectId === worker.projectId && !row.removed);
  assert.ok(document); h.store.setRoute(withDocumentInRoute("/", document.id, document.title));
  await h.store.syncDocumentFromRoute(); await f.settle();
  const owners = f.components().filter(owner => owner.tag === "forma-workspace" && owner.store === h.store && owner.isConnected);
  assert.equal(owners.length, 1); const workspace = owners[0];
  assert.equal(workspace.closest("forma-shell"), f.host);
  const native = installOutputNavigationFocusNative(t, f, ports), selections = renameNative(f, workspace);
  await f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground();
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
  assert.equal(h.store.projection.get().projectId, worker.projectId); assert.equal(h.store.projection.get().documentId, document.id);
  assert.equal(h.store.projection.get().documentTitle, document.title);
  assert.ok(h.store.session.get().capabilities.includes("project.author"));
  const prior = h.transport, q = { h, f, worker, workspace, document, native, selections, resumes, source, authorization, pending: null, original: null };
  const privateContent = () => worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all();
  const privateEvents = () => worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all();
  const clientReceipts = () => worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
  q.floor = async () => ({ history: await readWorkspaceEvents(worker.env, worker.streamId), financial: financial(worker),
    privateContent: privateContent(), privateEvents: privateEvents(), clientReceipts: clientReceipts(),
    sourceEvents: JSON.stringify(h.store.events.get()), content: JSON.stringify(h.store.content.get()), head: h.store.head.get(), requests: h.requests.length });
  q.unchanged = async floor => {
    await f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground();
    assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), floor.history);
    assert.deepEqual(financial(worker), floor.financial); assert.deepEqual(privateContent(), floor.privateContent);
    assert.deepEqual(privateEvents(), floor.privateEvents); assert.deepEqual(clientReceipts(), floor.clientReceipts);
    assert.equal(JSON.stringify(h.store.events.get()), floor.sourceEvents); assert.equal(JSON.stringify(h.store.content.get()), floor.content);
    assert.equal(h.store.head.get(), floor.head);
    assert.deepEqual(h.requests.slice(floor.requests).filter(request => request.init.method === "POST" && !resumes.isReadOnlyResume(request)), []);
  };
  h.transport = async request => {
    if (!eventPost(request)) return prior(request);
    const a = q.original; assert.ok(a, "Only the one explicitly armed native Save is admitted");
    assert.equal(a.request, null, "No retry, replacement or second rename"); a.request = request;
    try {
      const bytes = request.init.body, body = request.body;
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, a.floor.head);
      assert.deepEqual(body.events, [{ type: "DocumentRenamed", payload: { document_id: document.id, old_title: document.title, new_title: a.title } }]);
      assert.deepEqual(body.event, body.events[0]); assert.equal(bytes, JSON.stringify(body));
      assert.equal(h.store.route.get(), a.route); assert.ok(workspace.isConnected);
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
      assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
      const event = receipt.appended[0]; assert.equal(event.type, "DocumentRenamed"); assert.deepEqual(event.payload, body.event.payload);
      assert.equal(event.streamId, worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit");
      assert.equal(event.sequence, a.floor.head + 1); assert.equal(receipt.head, event.sequence);
      await worker.drainBackground(); assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...a.floor.history, event]);
      const rows = privateEvents(), added = rows.filter(row => !a.floor.privateEvents.some(before => before.private_event_id === row.private_event_id));
      assert.equal(added.length, 1); assert.equal(added[0].private_event_id, event.eventId);
      assert.deepEqual(JSON.parse(added[0].private_json), event.payload);
      assert.deepEqual(rows.filter(row => row.private_event_id !== event.eventId), a.floor.privateEvents);
      assert.deepEqual(privateContent(), a.floor.privateContent); assert.deepEqual(clientReceipts(), a.floor.clientReceipts);
      assert.deepEqual(financial(worker), a.floor.financial);
      a.response = response; a.receipt = receipt; a.privateEvents = rows;
      await a.gate.promise;
      assert.equal(request.init.body, bytes); assert.equal(JSON.stringify(request.body), bytes);
      a.delivered++; return response;
    } catch (error) { a.error = error; throw error; }
  };
  q.arm = async title => {
    assert.equal(q.original, null); await f.settle(); await resumes.settleOriginalRequests();
    q.original = { title, floor: await q.floor(), route: h.store.route.get(), gate: sceneDeferred(), request: null, receipt: null, response: null, delivered: 0, error: null };
    return q.original;
  };
  q.effects = async () => {
    const a = q.original; await f.settle(); await resumes.settleOriginalRequests(); await worker.drainBackground();
    assert.ok(a?.receipt); assert.equal(a.delivered, 1); assert.equal(a.response.bodyUsed, true);
    assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...a.floor.history, ...a.receipt.appended]);
    assert.deepEqual(privateEvents(), a.privateEvents); assert.deepEqual(privateContent(), a.floor.privateContent);
    assert.deepEqual(clientReceipts(), a.floor.clientReceipts); assert.deepEqual(financial(worker), a.floor.financial);
    assert.equal(JSON.stringify(h.store.content.get()), a.floor.content); assert.equal(h.store.head.get(), a.receipt.head);
    assert.deepEqual(h.store.events.get().find(event => event.eventId === a.receipt.appended[0].eventId), a.receipt.appended[0]);
    assert.equal(h.store.projection.get().projectId, worker.projectId); assert.equal(h.store.projection.get().documentId, document.id);
    assert.equal(h.store.projection.get().documentTitle, a.title);
    assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    assert.equal(h.requests.filter(eventPost).length, 1);
    assert.deepEqual(h.requests.slice(a.floor.requests).filter(request => request.init.method === "POST" && request !== a.request && !resumes.isReadOnlyResume(request)), []);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
  };
  cleanup = async () => {
    q.original?.gate.resolve(); if (q.pending) await q.pending.catch(() => {});
    await resumes.settleOriginalRequests(); await worker.drainBackground(); h.transport = prior; resumes.restore();
  };
  return q;
}

function renameControls(q) {
  const { f, workspace, h } = q, tree = f.tree();
  const forms = tree.visible("form").filter(node => node.owner === workspace && classed(node, "document-title-editor"));
  assert.equal(forms.length, 1); const form = forms[0];
  const field = tree.visible("input").filter(node => node.owner === workspace && node.attributes.id === "document-title-input" && inside(node, form));
  const buttons = tree.visible("button").filter(node => node.owner === workspace && inside(node, form));
  assert.equal(field.length, 1); assert.equal(buttons.length, 2);
  const cancel = buttons.filter(node => node.attributes.type === "button"), save = buttons.filter(node => node.attributes.type === "submit");
  assert.equal(cancel.length, 1); assert.equal(save.length, 1);
  // This RendererPort calls render() directly, without the production update()
  // literal localizer. Exact native form/type identify these emitted controls.
  assert.equal(cancel[0].text, "Cancel"); assert.equal(save[0].text, "Save name");
  assert.ok(workspace.isConnected && q.h.store.projection.get().documentId === q.document.id);
  assert.equal(h.store.projection.get().projectId, q.worker.projectId);
  return { form, field: field[0], cancel: cancel[0], save: save[0] };
}
async function renameClick(q, node) {
  assert.ok(node.port.isConnected && q.f.renderer.nodes.includes(node.port)); assert.equal(node.hiddenBy, null);
  assert.equal(node.port.matches(":disabled"), false); q.native.emit("pointerdown", node.port); q.native.focus(node.port);
  await q.f.act(node); await q.f.settle();
}
async function renameOpen(q) {
  const title = q.h.store.projection.get().documentTitle;
  const buttons = q.f.tree().visible("button").filter(node => node.owner === q.workspace
    && node.handlers.click?.toString().includes("#beginDocumentRename")
    && node.attributes["aria-label"] === q.f.i18n.system("Rename {documentTitle}", { documentTitle: title }));
  assert.equal(buttons.length, 1); await renameClick(q, buttons[0]);
  assert.equal(renameControls(q).field.port.value, title); return renameControls(q);
}
async function renameType(q, raw) {
  const { field } = renameControls(q); assert.equal(field.port.matches(":disabled"), false);
  q.native.emit("pointerdown", field.port); q.native.focus(field.port); field.port.value = raw;
  await q.f.act(field, "input"); await q.f.settle();
  assert.equal(renameControls(q).field.port.value, raw); assert.equal(renameControls(q).field.properties.value, raw);
}
function renameSubmit(q) {
  const { form, field, save } = renameControls(q); assert.ok(field.port.value.trim()); assert.equal(save.port.matches(":disabled"), false);
  q.native.emit("pointerdown", save.port); q.native.focus(save.port);
  return q.f.act(form, "submit", { submitter: save.port });
}

for (const [mode, locale] of [["unchanged", "en"], ["newer", "ja"], ["reopened", "fr"]]) test(
  "C Workspace rename original ACK / " + mode + " / " + locale,
  { concurrency: false, timeout: 45_000 }, async t => {
    const q = await renamePage(t, locale), { f, h, workspace, document } = q;
    const initialRoute = h.store.route.get();
    // Preserve the existing padded unchanged-title Save contract: no event.
    const noOp = await q.floor(); await renameOpen(q); await renameType(q, "  " + document.title + "  ");
    await renameSubmit(q); await q.unchanged(noOp);
    assert.equal(f.tree().visible("form").filter(node => node.owner === workspace && classed(node, "document-title-editor")).length, 0);
    await renameOpen(q);
    const title = "Original acknowledged name A", submitted = "  " + title + "  ", newer = "  Café e\u0301 日本語 — later name B  ";
    await renameType(q, submitted); const a = await q.arm(title);
    q.pending = renameSubmit(q); q.pending.catch(() => {});
    try {
      await untilScene(() => Boolean(a.receipt || a.error), "The exact original DocumentRenamed reaches real Worker200 before holding delivery");
      if (a.error) throw a.error; assert.equal(a.response.bodyUsed, false); assert.equal(a.delivered, 0);
      assert.equal(h.store.events.get().some(event => event.eventId === a.receipt.appended[0].eventId), false);
      await f.settle(); assert.equal(renameControls(q).field.port.value, submitted);
      if (mode === "reopened") {
        const old = renameControls(q).field.port; await renameClick(q, renameControls(q).cancel);
        assert.equal(old.isConnected, false);
        assert.equal(f.tree().visible("form").filter(node => node.owner === workspace && classed(node, "document-title-editor")).length, 0);
        await renameOpen(q);
      }
      if (mode !== "unchanged") await renameType(q, newer);
      const currentPart = renameControls(q).field.propertyParts.value;
      assert.equal(typeof currentPart, "string"); assert.equal(h.requests.filter(eventPost).length, 1);
      a.gate.resolve(); await q.pending; await q.effects();
      const fields = f.tree().visible("input").filter(node => node.owner === workspace && node.attributes.id === "document-title-input");
      t.diagnostic("C_WORKSPACE_RENAME_ACK " + JSON.stringify({ mode, locale, originalStatus: a.response.status,
        originalEventId: a.receipt.appended[0].eventId, originalDocumentId: document.id, originalTitle: title,
        route: h.store.route.get(), ownerConnected: workspace.isConnected, currentRaw: fields[0]?.port.value ?? null,
        originalWrites: h.requests.filter(eventPost).length, exactHistoryPrivateReceiptsFiscal: true,
        evidence: "actual full Workspace controls/Store/RAM Worker with held original positive delivery; finite native ports, not physical or provider proof" }));
      assert.equal(h.store.route.get(), withDocumentInRoute(initialRoute, document.id, title));
      assert.equal(h.store.projection.get().documentId, document.id); assert.ok(workspace.isConnected);
      const currentOwners = f.components().filter(owner => owner.tag === "forma-workspace" && owner.store === h.store && owner.isConnected);
      assert.equal(currentOwners.length, 1); assert.equal(currentOwners[0] === workspace, true);
      if (mode === "unchanged") assert.equal(fields.length, 0, "Acknowledged unchanged A closes normally");
      else {
        assert.equal(fields.length, 1, "A late original success cannot remove the current newer rename form");
        assert.equal(fields[0].port.value, newer); assert.equal(fields[0].properties.value, newer);
        assert.equal(fields[0].propertyParts.value, currentPart);
        const afterAck = await q.floor(); await renameClick(q, renameControls(q).cancel); await q.unchanged(afterAck);
        assert.equal(f.tree().visible("form").filter(node => node.owner === workspace && classed(node, "document-title-editor")).length, 0);
        assert.equal(h.store.projection.get().documentTitle, title, "Cancel discards only B; acknowledged A stays saved");
      }
      assert.ok(q.selections.length >= 2);
    } finally { a.gate.resolve(); await q.pending; }
  });

// Select-all is observed independently of focus. The original renameNative
// port asserts a connected/current input at each select() call and never focuses.
for (const newer of [false, true]) test(
  "C Workspace Rename opening / " + (newer ? "same-turn newer native interaction suppresses select-all" : "healthy current title selection"),
  { concurrency: false, timeout: 45_000 }, async t => {
    const q = await renamePage(t, "en"), { f, h, workspace, native } = q;
    const floor = await q.floor(), route = h.store.route.get(), session = h.store.session.get();
    const title = h.store.projection.get().documentTitle;
    const buttons = f.tree().visible("button").filter(node => node.owner === workspace
      && node.handlers.click?.toString().includes("#beginDocumentRename")
      && node.attributes["aria-label"] === f.i18n.system("Rename {documentTitle}", { documentTitle: title }));
    assert.equal(buttons.length, 1); const rename = buttons[0];
    assert.ok(rename.port.isConnected && !rename.hiddenBy); assert.equal(rename.port.matches(":disabled"), false);
    assert.equal(f.tree().visible("dialog").filter(node => node.port.open).length, 0);
    native.emit("pointerdown", rename.port); native.focus(rename.port);
    const selectionMark = q.selections.length, pending = f.act(rename); pending.catch(() => {});
    let focusMark;
    try {
      const later = f.find("button", node => node.owner === f.host && classed(node, "command-trigger"));
      assert.ok(later.port.isConnected && !later.hiddenBy); assert.equal(later.port.matches(":disabled"), false);
      // Focus only: do not open command discovery or execute a departure.
      if (newer) { native.emit("pointerdown", later.port); native.focus(later.port); }
      focusMark = native.nativeFocus.length;
    } finally { await pending; }
    await f.settle();
    const selections = q.selections.slice(selectionMark), current = renameControls(q);
    const lateFocus = native.nativeFocus.slice(focusMark).filter(row => row.node.owner === workspace);
    t.diagnostic("C_WORKSPACE_RENAME_OPEN_SELECTION " + JSON.stringify({ newer, selectCalls: selections.length,
      selectedValues: selections, lateWorkspaceFocusCalls: lateFocus.length,
      boundary: "actual Rename and same-turn native gesture; select() is not focus(), scheduler unchanged" }));
    assert.equal(current.field.port.value, title); assert.equal(current.field.properties.value, title);
    assert.equal(h.store.route.get(), route); assert.equal(h.store.session.get(), session);
    assert.ok(workspace.isConnected && workspace.store === h.store);
    assert.ok(h.store.sourceOwnershipActive(q.source) && h.store.authorizationScopeActive(q.authorization));
    await q.unchanged(floor); assert.equal(h.requests.length, floor.requests);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
    assert.equal(lateFocus.length, 0, "The selection-only native port must not manufacture focus");
    if (newer) assert.equal(selections.length, 0, "Earlier Rename must not select-all after newer native interaction");
    else { assert.equal(selections.length, 1); assert.equal(selections[0], title); }
    await renameClick(q, renameControls(q).cancel); await q.unchanged(floor);
    assert.equal(f.tree().visible("form").filter(node => node.owner === workspace && classed(node, "document-title-editor")).length, 0);
    assert.equal(h.store.projection.get().documentTitle, title);
  });
