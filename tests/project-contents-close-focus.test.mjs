// Actual full Shell/ProjectContents/Store/RAM Worker, using the existing copy
// fixture. A same-turn later native interaction is an explicit ownership policy
// control: no held updateComplete and no claim that a physical user task can
// precede ordinary Lit's microtask. No duplicate preview/Apply or job operation.
import assert from "node:assert/strict";
import test from "node:test";
import { copyHost } from "./helpers/document-copy-recovery-host.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { retainDeferredFocusInvokers } from "./helpers/deferred-focus-invokers.mjs";

for (const newer of [false, true]) test("C ordinary Duplicate Close focus / " +
  (newer ? "same-turn newer Overview search wins" : "unchanged native opener returns"),
  { concurrency: false, timeout: 45_000 }, async t => {
    const p = await copyHost(t, "en"), { f, h } = p;
    const owners = f.components().filter(owner => owner.tag === "forma-project-contents" && owner.isConnected);
    assert.equal(owners.length, 1); const owner = owners[0];
    const native = installOutputNavigationFocusNative(t, f, ports);
    retainDeferredFocusInvokers(f, new Set([owner])); await f.settle();
    const opener = p.open(); assert.ok(opener.port.isConnected); assert.equal(opener.port.matches(":disabled"), false);
    const retainedOpener = opener.port; await f.settle();
    assert.equal(p.open().port, retainedOpener, "the exact unchanged EventPart retains its real native invoker");
    native.emit("pointerdown", retainedOpener); native.focus(retainedOpener);
    await f.act(p.open()); await p.join();
    const dialog = f.tree().visible("dialog").filter(node => node.owner === owner && node.port.open
      && String(node.attributes.class ?? "").split(/\s+/u).includes("new-document-dialog"));
    assert.equal(dialog.length, 1); assert.equal(h.store.documentCopyReview(p.target)?.phase, "draft");
    assert.equal(p.open().port, retainedOpener); assert.ok(retainedOpener.isConnected);
    const baseline = { route: h.store.route.get(), source: h.store.captureSourceOwnership(), authority: h.store.captureAuthorizationScope(),
      session: h.store.session.get(), project: h.store.projection.get().projectId, events: h.store.events.get(),
      content: h.store.content.get(), head: h.store.head.get(), requests: h.requests.length, receipts: p.receipts(), financial: financial(h.worker) };
    const close = p.byLabel("action.close"); assert.ok(close?.port.isConnected && !close.hiddenBy);
    native.emit("pointerdown", close.port); native.focus(close.port);
    const pending = f.act(close);
    assert.equal(dialog[0].port.open, false, "actual Close has synchronously dismissed the exact native dialog");
    const search = f.find("input", node => node.owner === owner && node.handlers.input?.toString().includes("#query"));
    assert.ok(search.port.isConnected); assert.equal(search.port.matches(":disabled"), false);
    if (newer) { native.emit("pointerdown", search.port); native.focus(search.port); }
    const mark = native.nativeFocus.length;
    await pending; await p.join();
    const late = native.nativeFocus.slice(mark).filter(row => row.node.owner === owner);
    t.diagnostic(JSON.stringify({ newer, lateFocus: late.map(row => ({ tag: row.node.tag,
      label: row.node.attributes["aria-label"] ?? null, class: row.node.attributes.class ?? null })),
      sameNativeOpener: p.open().port === retainedOpener, requestsAfterClose: h.requests.length - baseline.requests,
      boundary: "same-turn native interaction before existing finite update microtask; not physical scheduling proof" }));
    if (newer) assert.equal(late.length, 0, "later native interaction permanently cancels old deferred return");
    else { assert.equal(late.length, 1); assert.equal(late[0].node, retainedOpener); }
    assert.equal(p.open().port, retainedOpener); assert.ok(retainedOpener.isConnected);
    assert.equal(f.components().filter(candidate => candidate === owner && candidate.isConnected).length, 1);
    assert.equal(f.tree().visible("dialog").filter(node => node.owner === owner && node.port.open).length, 0);
    assert.equal(h.store.route.get(), baseline.route); assert.equal(h.store.session.get(), baseline.session);
    assert.equal(h.store.projection.get().projectId, baseline.project);
    assert.ok(h.store.sourceOwnershipActive(baseline.source)); assert.ok(h.store.authorizationScopeActive(baseline.authority));
    assert.equal(h.store.events.get(), baseline.events); assert.equal(h.store.content.get(), baseline.content); assert.equal(h.store.head.get(), baseline.head);
    assert.equal(h.requests.length, baseline.requests); assert.deepEqual(p.receipts(), baseline.receipts);
    assert.deepEqual(financial(h.worker), baseline.financial); assert.equal(globalThis.fetch.mock.callCount(), 0);
  });

// Additive current-C full-host case; original two Close-focus cases stay exact.
import { readWorkspaceEvents } from "./helpers/event-source-retirement-fixture.mjs";
import { registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { withDocumentInRoute } from "../src/model/routes.ts";

test("C actual Open copied document preserves sibling Assistant raw until explicit clear", { concurrency: false, timeout: 45_000 }, async t => {
  const p = await copyHost(t, "en"), { f, h, target } = p;
  const owners = f.components().filter(value => value.tag === "forma-project-contents" && value.store === h.store && value.isConnected);
  assert.equal(owners.length, 1); const owner = owners[0];
  const native = installOutputNavigationFocusNative(t, f, ports);
  retainDeferredFocusInvokers(f, new Set([owner])); f.nativeHistoryLocation = h.location;
  const hasClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
  const within = (node, parent) => { for (let value = node; value; value = value.parent)
    if (value === parent || value.port && value.port === parent.port) return true; return false; };
  const modal = () => f.find("dialog", node => node.owner === owner && hasClass(node, "document-copy-dialog") && node.port.open);
  const click = async control => {
    assert.ok(control?.port.isConnected && f.renderer.nodes.includes(control.port));
    assert.equal(control.port.matches(":disabled"), false);
    native.emit("pointerdown", control.port); native.focus(control.port);
    await f.act(control, "click", { button: 0 });
  };

  // Same finite Assistant GET bridge and native route-event forwarding used by
  // current full-Shell controls. No granted flag, replacement body or handler.
  const previousFetch = globalThis.fetch, previousTransport = h.transport, dispatch = h.window.dispatchEvent;
  const pendingReads = new Set(), readErrors = [], assistantReads = [];
  const track = original => { pendingReads.add(original); void original.then(() => pendingReads.delete(original), error => {
    readErrors.push(error); pendingReads.delete(original);
  }); return original; };
  const transport = request => {
    const original = previousTransport ? previousTransport(request) : h.worker.request(request.url, request.init);
    return (request.init.method ?? "GET") === "GET" ? track(original) : original;
  };
  h.transport = transport;
  const bridge = (input, init = {}) => {
    const url = new URL(String(input), "https://fixture.invalid");
    if (url.origin !== "https://fixture.invalid" || url.pathname !== "/api/assistant") return previousFetch(input, init);
    assert.equal(init.method ?? "GET", "GET");
    const row = { url: url.pathname + url.search, response: null, body: null }; assistantReads.push(row);
    return track(h.fetch(row.url, init).then(async response => {
      assert.equal(response.status, 200); row.response = response; row.body = await response.clone().json();
      assert.equal(response.bodyUsed, false); return response;
    }));
  };
  const routedDispatch = function (event) {
    const result = dispatch.call(this, event);
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener(event);
    return result;
  };
  h.window.dispatchEvent = routedDispatch;
  const settle = async () => {
    let queues;
    for (let step = 0; step < 4; step++) {
      while (pendingReads.size) await Promise.allSettled([...pendingReads]);
      for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
      await p.join();
      while (pendingReads.size) await Promise.allSettled([...pendingReads]);
      await h.worker.drainBackground();
      queues = { reads: pendingReads.size, frames: f.frames.size,
        storeFrames: [...h.timers.values()].filter(timer => timer.delay === 16).length, renderRequests: Number(f.requested) };
      if (Object.values(queues).every(value => value === 0)) break;
    }
    assert.deepEqual(queues, { reads: 0, frames: 0, storeFrames: 0, renderRequests: 0 }); assert.deepEqual(readErrors, []);
  };
  const useReads = async action => {
    assert.equal(globalThis.fetch, previousFetch); globalThis.fetch = bridge;
    let value, failure;
    try { value = await action(); } catch (error) { failure = error; }
    try { await settle(); } catch (error) { failure ??= error; }
    finally { if (globalThis.fetch === bridge) globalThis.fetch = previousFetch; }
    if (failure) throw failure; return value;
  };
  const restore = () => {
    if (globalThis.fetch === bridge) globalThis.fetch = previousFetch;
    if (h.transport === transport) h.transport = previousTransport;
    if (h.window.dispatchEvent === routedDispatch) h.window.dispatchEvent = dispatch;
  };
  t.after(restore);
  let assistant, panel, scope;
  const field = expected => {
    assert.ok(panel.isConnected && panel.open && assistant.isConnected); assert.equal(panel.conversationScope, scope);
    const composers = f.components().filter(value => value.tag === "forma-ui-conversation-composer" && value.parentElement === panel && value.isConnected);
    assert.equal(composers.length, 1);
    const rows = f.tree().visible("textarea").filter(node => node.owner === composers[0] && hasClass(node, "forma-assistant-input"));
    assert.equal(rows.length, 1); const current = rows[0];
    assert.ok(current.port.isConnected && f.renderer.nodes.includes(current.port)); assert.equal(current.port.matches(":disabled"), false);
    assert.equal(current.port.value, expected); assert.equal(current.properties.value, expected); return current;
  };
  const openAssistant = async expected => {
    assert.equal(f.tree().visible("dialog").filter(node => node.port.open).length, 0, "Never activate the background Assistant through the copy modal");
    assert.equal(panel.open, false); await click(f.find("button", node => node.owner === panel && hasClass(node, "forma-assistant-launcher")));
    await settle(); field(expected);
  };
  const typeAssistant = async (before, value) => {
    const current = field(before), requests = h.requests.length;
    native.emit("keydown", current.port); native.focus(current.port); current.port.value = value;
    await f.act(current, "input"); await settle(); field(value); assert.equal(h.requests.length, requests);
  };
  const closeAssistant = async expected => {
    field(expected); await click(f.find("button", node => node.owner === panel && hasClass(node, "forma-assistant-close")));
    await settle(); assert.equal(panel.open, false); assert.equal(panel.conversationScope, scope);
    assert.equal(assistant.captureCommandDeparture().blocked(), expected !== "");
  };
  const raw = "  Keep this original Assistant draft beside the saved copy — 未送信\n  ";
  const originalOpen = h.store.openDocument, opens = [];
  t.mock.method(h.store, "openDocument", function (...args) {
    const original = originalOpen.apply(this, args); opens.push({ args, original }); return original;
  });
  // Observe the existing public Promise, forwarding its exact arguments/result;
  // no permission, method body, navigation predicate or fulfillment is replaced.
  const joinOpen = async () => { await Promise.all(opens.map(row => row.original)); await settle(); };
  try {
    await useReads(async () => {
      await registerCalmFullPageComponents(f, ["forma-project-contents", "forma-creative-assistant", "forma-workspace"]);
      h.worker.env.OPENAI_API_KEY = ""; // Existing RAM-only no-provider fixture convention, not an authorization grant.
      await h.store.refreshSession(); await settle();
      const session = h.store.session.get(); assert.equal(session.assistant.enabled, true); assert.equal(session.provider.configured, false);
      assert.equal(session.policy.accepted, true); assert.equal(session.projectContext.projectId, target.projectId);
      assert.equal(session.projectContext.organizationId, h.worker.sharing.organizationId);
      assert.equal(session.projectContext.projectAccessId, h.worker.sharing.projectAccessId);
      assert.ok(session.projectContext.permissions.includes("project.author"));
      const rows = f.components().filter(value => value.tag === "forma-creative-assistant" && value.store === h.store && value.isConnected);
      assert.equal(rows.length, 1); assistant = rows[0];
      const panels = f.components().filter(value => value.tag === "forma-assistant-panel" && value.parentElement === assistant && value.isConnected);
      assert.equal(panels.length, 1); panel = panels[0]; scope = panel.conversationScope;
      assert.equal(JSON.parse(scope)[9], h.store.route.get()); assert.equal(panel.open, false);
      await openAssistant(""); await typeAssistant("", raw); await closeAssistant(raw);
    });
    assert.ok(assistantReads.length > 0);
    for (const read of assistantReads) assert.deepEqual(read.body.context.scope, {
      actorUserId: h.store.session.get().user.userId, organizationId: h.worker.sharing.organizationId,
      projectAccessId: h.worker.sharing.projectAccessId, projectId: target.projectId, documentId: null,
    });

    let preview, originalApply = null;
    await useReads(async () => { preview = await p.review(); await settle(); });
    assert.equal(assistant.captureCommandDeparture().blocked(), true); assert.equal(panel.conversationScope, scope);
    const beforeApply = await readWorkspaceEvents(h.worker.env, h.worker.streamId), money = financial(h.worker);
    const oldIntercept = h.intercept;
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "apply") return oldIntercept?.(request);
      assert.equal(originalApply, null, "Only the one actual current Apply reaches the Worker");
      assert.deepEqual(request.body, { action: "apply", ...target, previewId: preview.previewId, approvalHash: preview.approvalHash });
      assert.equal(request.init.body, JSON.stringify(request.body));
      const response = await h.worker.request(request.url, request.init), body = await response.clone().json();
      assert.equal(response.status, 200); assert.equal(body.status, "applied"); assert.equal(response.bodyUsed, false);
      originalApply = { request, init: request.init, bytes: request.init.body, response, body }; return response;
    };
    try { await useReads(async () => { await click(p.byLabel("document.copy.apply")); await p.join(); }); }
    finally { h.intercept = oldIntercept; }
    assert.ok(originalApply); assert.equal(originalApply.response.bodyUsed, true);
    assert.equal(originalApply.request.init, originalApply.init); assert.equal(originalApply.request.init.body, originalApply.bytes);
    const applied = h.store.documentCopyReview(target); assert.equal(applied.phase, "applied"); assert.equal(applied.busy, false);
    assert.equal(applied.previewId, preview.previewId); assert.equal(applied.approvalHash, preview.approvalHash);
    assert.equal(applied.receipt.operationId, preview.operationId); assert.equal(applied.receipt.documentId, preview.destinationDocumentId);
    assert.equal(originalApply.body.operationId, applied.receipt.operationId); assert.equal(originalApply.body.documentId, applied.receipt.documentId);
    assert.equal(originalApply.body.previewId, applied.previewId); assert.equal(originalApply.body.approvalHash, applied.approvalHash);
    const copied = h.store.projection.get().documents.find(value => value.id === applied.receipt.documentId && value.projectId === target.projectId && !value.removed);
    assert.ok(copied); const destination = withDocumentInRoute("/", copied.id, copied.title);
    const openCopy = () => { const dialog = modal(); return f.find("a", node => node.owner === owner && within(node, dialog)
      && node.attributes.href === destination && node.text.includes(f.i18n.t("document.copy.open")) && typeof node.handlers.click === "function"); };
    assert.equal(p.receipts().length, 1); assert.equal(p.calls().filter(row => row.body.action === "apply").length, 1);
    const history = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
    assert.deepEqual(history.slice(0, beforeApply.length), beforeApply); assert.equal(history.length - beforeApply.length, preview.preview.events.length);
    assert.equal(history.filter(value => value.type === "DocumentCreated" && value.payload.source_document_id === target.documentId).length, 1);
    const before = { route: h.store.route.get(), url: h.location.href, source: h.store.captureSourceOwnership(), authority: h.store.captureAuthorizationScope(),
      session: h.store.session.get(), events: structuredClone(h.store.events.get()), content: structuredClone(h.store.content.get()), head: h.store.head.get(),
      receipt: structuredClone(applied.receipt), commits: p.receipts(), calls: structuredClone(p.calls().map(row => row.body)), requests: h.requests.length };
    assert.equal(panel.open, false); assert.equal(assistant.captureCommandDeparture().blocked(), true); assert.equal(opens.length, 0);
    await useReads(async () => { await click(openCopy()); await joinOpen(); });
    const sameScope = panel.isConnected && panel.conversationScope === scope;
    t.diagnostic("C_OPEN_COPY_SIBLING " + JSON.stringify({ route: h.store.route.get(), destination,
      currentContents: owner.isConnected, sameAssistantScope: sameScope, retainedRawBlocker: sameScope && panel.commandDepartureBlocked,
      actualOpenCalls: opens.length, copyReceipts: p.receipts().length, copyId: copied.id, requestsAfterOpen: h.requests.length - before.requests }));
    assert.equal(h.store.route.get(), before.route, "Applied-copy availability cannot bypass the current sibling draft");
    assert.equal(h.location.href, before.url); assert.ok(owner.isConnected && modal().port.open); assert.equal(sameScope, true);
    assert.equal(opens.length, 0, "Refusal occurs before the existing Store Open operation"); assert.equal(h.requests.length, before.requests);
    assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.assistantOwnsWork"));
    assert.deepEqual(h.store.documentCopyReview(target).receipt, before.receipt); assert.deepEqual(p.receipts(), before.commits);
    assert.deepEqual(p.calls().map(row => row.body), before.calls); assert.deepEqual(h.store.events.get(), before.events);
    assert.deepEqual(h.store.content.get(), before.content); assert.equal(h.store.head.get(), before.head); assert.equal(h.store.session.get(), before.session);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authority));
    assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), history); assert.deepEqual(financial(h.worker), money);

    await useReads(async () => {
      await click(p.byLabel("action.close")); await p.join(); await settle();
      assert.equal(f.tree().visible("dialog").filter(node => node.owner === owner && node.port.open).length, 0);
      assert.deepEqual(h.store.documentCopyReview(target).receipt, before.receipt);
      await openAssistant(raw); await typeAssistant(raw, ""); await closeAssistant("");
      await click(p.open()); await p.join(); await settle();
      const recovered = h.store.documentCopyReview(target); assert.equal(recovered.phase, "applied");
      assert.deepEqual(recovered.receipt, before.receipt); assert.equal(recovered.previewId, preview.previewId); assert.equal(recovered.approvalHash, preview.approvalHash);
      assert.deepEqual(p.calls().at(-1).body, { action: "retrieve", ...target, previewId: preview.previewId, approvalHash: preview.approvalHash });
      await click(openCopy()); await joinOpen();
    });
    assert.equal(opens.length, 1); assert.deepEqual(opens[0].args.slice(0, 3), [copied.id, "/", "project-document-duplicate"]);
    assert.equal(await opens[0].original, true); assert.equal(h.store.route.get(), destination); assert.equal(h.store.projection.get().documentId, copied.id);
    assert.equal(owner.isConnected, false); assert.equal(f.components().filter(value => value.tag === "forma-workspace" && value.isConnected).length, 1);
    assert.equal(p.calls().filter(row => row.body.action === "apply").length, 1); assert.equal(p.calls().filter(row => row.body.action === "preview").length, 1);
    assert.equal(p.calls().some(row => ["revise", "dismiss"].includes(row.body.action)), false);
    assert.deepEqual(p.receipts(), before.commits); assert.deepEqual(h.store.documentCopyReview(target).receipt, before.receipt);
    assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), history); assert.deepEqual(financial(h.worker), money);
    assert.equal(h.store.session.get(), before.session); assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authority));
    assert.equal(h.requests.filter(row => row.url === "/api/events" && (row.init.method ?? "GET") !== "GET").length, 0);
    assert.equal(h.requests.filter(row => row.url.startsWith("/api/document-jobs") && row.init.method === "POST").length, 0);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
  } finally { restore(); }
});

// R21 independently observed native Close retaining focus instead of the
// intended name field. This is a source contract for the native declaration,
// not simulated UA autofocus or a change to the original three full-host cases.
import { readFile } from "node:fs/promises";

test("D428 only an ordinary blank document declares native name autofocus", async () => {
  const source = await readFile(new URL("../src/components/forma-project-contents.ts", import.meta.url), "utf8");
  const section = (from, to) => {
    const start = source.indexOf(from), end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start, "inspect the actual current owner: " + from);
    return source.slice(start, end);
  };
  const opening = section("  #beginNew(){", "  async #beginDuplicate(");
  const dialog = section("  #ordinaryDocumentDialog(){", "  #ordinaryDocumentRecovery(){");
  const copy = section("  #copyDialog(){", "  #openRoute(");
  assert.ok(opening.includes("const focus=captureOutputNavigationFocus(this.ownerDocument);"));
  assert.ok(opening.includes("owner.current()&&this.store.route.get()===route&&focus.current()"));
  assert.ok(opening.includes("focus.run(target,()=>{target.focus();return true;})"));
  assert.ok(dialog.includes("const owner=this.#ordinaryDocument;if(!owner?.current())return nothing;"));
  assert.ok(dialog.includes("original=owner.original,document=this.#originalOrdinaryDocument()"));
  assert.ok(dialog.includes("owner.current()&&opening===this.#newDocumentRequest&&this.#newDocument&&!this.#duplicateSourceId"));
  assert.equal((dialog.match(/<input\b/gu) ?? []).length, 1);
  const start = dialog.indexOf("<input "), end = dialog.indexOf("\n          @input=", start);
  assert.ok(start >= 0 && end > start);
  const input = dialog.slice(start, end);
  assert.ok(input.includes('required maxlength="80"'));
  assert.ok(input.includes('.value=${this.#title}'), "keep the owned raw name binding");
  assert.doesNotMatch(copy, /\bautofocus\b/u, "the separate Duplicate renderer receives no new autofocus policy");
  assert.ok(input.includes(' ?autofocus=${!original} '),
    "native showModal may choose the name only while this ordinary opening has no original request");
  assert.equal((dialog.match(/\bautofocus\b/gu) ?? []).length, 1);
});
