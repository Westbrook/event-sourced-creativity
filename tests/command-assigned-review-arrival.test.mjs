import assert from "node:assert/strict";
import test,{after} from "node:test";
import { assignmentPage, sceneDeferred, flushStoreFrames, libraryFocusFromRoute, artifactFocusOptionsFromRoute,
  originalFetch, externalCount } from "./helpers/assigned-review-action-fixture.mjs";
import { calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { commandDiscoveryCopy } from "../src/components/design-system/locales/command-discovery-messages.ts";

after(()=>{assert.equal(externalCount(),0);globalThis.fetch=originalFetch;});

async function finish(q,pending){
  let done=false,value,error;
  pending.then(result=>{value=result;done=true;},caught=>{error=caught;done=true;});
  for(let attempt=0;attempt<32&&!done;attempt++){
    await flushStoreFrames(q.h);await q.f.settle();await new Promise(setImmediate);
  }
  assert.ok(done,"the actual bounded command/Library opening settled");
  if(error)throw error;return value;
}
async function commandPage(t,entry){
  const q=await assignmentPage(t,entry,{observeViewerOpening:true});
  await flushStoreFrames(q.h);await q.f.settle();
  const native=installOutputNavigationFocusNative(t,q.f,ports),storeCalls=[];
  const original=q.h.store.openAssignedReview;
  t.mock.method(q.h.store,"openAssignedReview",function(task,options){
    assert.equal(task.id,q.task.id);
    for(const key of ["organizationId","projectAccessId","projectId","documentId","artifactId","revision","contentSha256"])
      assert.equal(task[key],q.task[key],"the selected review retains exact "+key);
    const call={task,options};storeCalls.push(call);
    call.pending=original.call(this,task,options);
    void call.pending.then(value=>{call.result=value;call.settled=true;},error=>{call.error=error;call.settled=true;});
    return call.pending;
  });
  const trigger=()=>q.f.find("button",node=>node.owner.tag==="forma-shell"
    &&String(node.attributes.class).includes("command-trigger"));
  const choose=async()=>{
    await q.f.act(trigger());
    const input=q.f.find("input",node=>node.attributes.id==="command-search");
    input.port.value=q.task.artifactTitle;await q.f.act(input,"input");
    const hint=[commandDiscoveryCopy(q.f.locale).review,q.task.organizationName,q.task.projectName,q.task.documentTitle].filter(Boolean).join(" · ");
    const row=q.f.find("button",node=>node.attributes.role==="option"&&node.text.includes(q.task.artifactTitle)
      &&node.children.some(child=>typeof child!=="string"&&child.tag==="small"&&child.text===hint));
    await q.f.act(row);
  };
  return{...q,native,storeCalls,trigger,choose};
}
async function completeOpening(q,activation){
  await finish(q,activation);
  assert.equal(q.storeCalls.length,1,"one actual Store context handshake");
  assert.equal(await finish(q,q.storeCalls[0].pending),true,"the genuine Store route handoff completed");
  await finish(q,Promise.all(q.viewerCalls.map(call=>call.pending)));
  await flushStoreFrames(q.h);await q.f.settle();
}
for(const entry of ["same-document","cross-project"])test("C1 review command proves exact native arrival and preserves later ordinary viewer interaction / "+entry,
  {timeout:25_000},async t=>{
    const q=await commandPage(t,entry);await completeOpening(q,q.choose());
    assert.deepEqual(libraryFocusFromRoute(q.h.store.route.get()),{kind:"artifact",id:q.artifactId});
    assert.deepEqual(artifactFocusOptionsFromRoute(q.h.store.route.get()),
      {expectedRevision:q.task.revision,expectedContentSha256:q.hash,intent:"review"});
    assert.equal(q.h.store.session.get().projectContext.projectId,q.task.projectId);
    assert.equal(q.viewerCalls.length,1,"arrival joins the existing route opening, not a second private read");
    const call=q.viewerCalls[0];
    assert.equal(call.result,true);assert.equal(call.owner.documentId,q.targetDocument);assert.ok(call.owner.isConnected);
    assert.equal(call.owner.querySelector(".document-artifact-view")?.open,true);
    assert.match(q.f.tree().root.text,/EXACT_ASSIGNED_B_BODY/);
    const control=q.f.tree().visible("button").find(node=>String(node.attributes.class??"").includes("artifact-viewer-focus-toggle"));
    assert.ok(control,"an ordinary existing viewer control is reachable after exact arrival");
    q.native.emit("keydown",control.port);await q.f.act(control);await q.f.settle();
    assert.equal(call.owner.querySelector(".document-artifact-view")?.open,true,
      "disposing the opening lease must not disable healthy admitted viewer interaction");
  });

for(const boundary of ["pointerdown","keydown","new-command","superseded-task"])test(
  "C1 review command refuses "+boundary+" during the same deferred actual child opening",
  {timeout:25_000},async t=>{
    const q=await commandPage(t,"cross-project"),gate=sceneDeferred(),entered=sceneDeferred(),tick=q.f.tick;
    const traceStart=q.f.trace.length;let held=false;
    t.after(()=>gate.resolve());
    q.f.tick=async owner=>{
      // Delay only the finite native update-completion port. The actual complete
      // Store, Library and DocumentArtifacts methods are neither replaced nor extracted.
      if(!held&&owner?.tag==="forma-document-artifacts"&&q.viewerCalls.length){
        held=true;entered.resolve();await gate.promise;
      }
      return tick(owner);
    };
    const activation=q.choose();await finish(q,entered.promise);
    assert.equal(q.storeCalls.length,1);
    assert.equal(await finish(q,q.storeCalls[0].pending),true,
      "the causal barrier is after the genuine Store handoff, not a fabricated navigation success");
    assert.equal(q.viewerCalls.length,1);
    assert.equal(q.viewerCalls[0].owner.querySelector(".document-artifact-view")?.open??false,false);
    if(boundary==="new-command")await q.f.act(q.trigger());
    else if(boundary==="superseded-task"){await q.supersede();await q.h.store.syncReviewInbox();await q.f.settle();}
    else q.native.emit(boundary);
    gate.resolve();await completeOpening(q,activation);
    assert.equal(held,true,"the actual existing child opening reached the held native boundary");
    assert.equal(q.viewerCalls.length,1,"no replacement viewer request or fallback task");
    assert.notEqual(q.viewerCalls[0].result,true);
    assert.ok(!q.f.trace.slice(traceStart).some(value=>value==="open:document-artifact-view"),
      "a stale child must not transiently promote before its eventual refusal");
    assert.equal(q.f.tree().visible("dialog").filter(node=>node.port?.open
      &&String(node.attributes.class??"").includes("document-artifact-view")).length,0);
    if(boundary==="new-command")assert.equal(q.h.store.ui.commandOpen,true,"the newer command remains in charge");
    if(boundary==="superseded-task")assert.ok(!q.h.store.reviewInbox.get().some(task=>task.id===q.task.id),
      "the actual Worker supersession is retained, not replaced by a same-Document task");
  });


// Original context success is not permission to discard a newer origin edit.
// Reuse the complete command/Store/Worker fixture and its strict financial,
// source-history and exact-viewer assertions; no callback is invoked by tests.
function cReviewAssistantReadPort(t, q) {
  const previous = globalThis.fetch, pending = new Set(), records = [], errors = [];
  const tables = ["assistant_turns", "assistant_action_proposals", "assistant_action_commits",
    "assistant_specialist_tasks", "assistant_billing_reconciliations"];
  const assertEmpty = () => {
    for (const table of tables) if (q.w.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
      assert.equal(q.w.sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n, 0,
        "The actual read-only fixture has no Assistant turn, proposal, task, commit or billing row: " + table);
    assert.equal(errors.length, 0, "The actual Assistant read observer did not reject a transport or body");
  };
  assertEmpty();
  const bridge = (input, init = {}) => {
    const url = new URL(String(input), "https://fixture.invalid");
    if (url.origin !== "https://fixture.invalid" || url.pathname !== "/api/assistant") return previous(input, init);
    assert.equal(String(init.method ?? "GET").toUpperCase(), "GET", "Only the actual Assistant read is bridged; never Send or a provider action");
    const record = { url: url.pathname + url.search, status: null, body: null }; records.push(record);
    const request = q.h.fetch(record.url, init).then(async response => {
      record.status = response.status; record.body = await response.clone().json();
      return response; // Original response/body/cookie semantics, never a replacement payload.
    });
    pending.add(request);
    void request.then(() => pending.delete(request), error => { errors.push(error); pending.delete(request); });
    return request;
  };
  const restore = () => { if (globalThis.fetch === bridge) globalThis.fetch = previous; };
  globalThis.fetch = bridge; t.after(restore);
  return { records, assertEmpty, restore, settle: async () => {
    while (pending.size) await Promise.allSettled([...pending]);
    await q.w.drainBackground(); assertEmpty();
  } };
}

async function cReviewOriginWorkspace(t) {
  const q = await commandPage(t, "cross-project"), { h, f } = q;
  await registerCalmFullPageComponents(f, ["forma-workspace", "forma-creative-assistant"]);
  const work = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && new URL(node.attributes.href, "https://fixture.invalid").pathname.startsWith("/document/" + q.entryDocument + "/"));
  const href = work.attributes.href;
  await f.act(work, "click", { button: 0 });
  await flushStoreFrames(h); await f.settle(); await flushStoreFrames(h); await f.settle();
  assert.equal(h.store.route.get(), href, "The actual current Work link opens the existing personal Document");
  assert.equal(h.store.projection.get().projectId, q.entryProject);
  assert.equal(h.store.projection.get().documentId, q.entryDocument);
  assert.equal(h.store.session.get().projectContext, undefined);
  const session = h.store.session.get(), context = session.projectContext, tree = f.tree();
  const describe = node => ({ tag: node.tag, owner: node.owner?.tag ?? null, id: node.attributes.id ?? null,
    className: node.attributes.class ?? null, disabled: Boolean(node.port?.disabled || Object.hasOwn(node.attributes, "disabled")),
    hiddenBy: node.hiddenBy });
  t.diagnostic("C_REVIEW_ORIGIN_ENTRY " + JSON.stringify({ route: h.store.route.get(),
    assistantEnabled: session.assistant?.enabled ?? false, policyAccepted: session.policy.accepted,
    sharedContext: Boolean(context), canAuthor: !context || context.permissions.includes("project.author"),
    canGenerate: !context || context.permissions.includes("project.output.request"),
    capabilities: Object.fromEntries(["project.read", "project.author", "project.output.request", "project.assistant.read"]
      .map(key => [key, (context?.permissions ?? session.capabilities).includes(key)])),
    connectedOwners: f.components().filter(owner => ["forma-workspace", "forma-creative-assistant", "forma-assistant-panel", "forma-ui-conversation-composer"].includes(owner.tag))
      .map(owner => ({ tag: owner.tag, connected: owner.isConnected, parentTag: owner.parentElement?.tag ?? null,
        ...(owner.tag === "forma-assistant-panel" ? { open: owner.open } : {}) })),
    allTextareas: tree.nodes.filter(node => node.tag === "textarea").map(describe),
    visibleTextareas: tree.visible("textarea").map(describe),
    visibleEntryControls: tree.visible("button").filter(node => String(node.attributes.class ?? "").split(/\s/u).includes("forma-assistant-launcher")
      || Object.hasOwn(node.attributes, "data-workbench-pane")).map(node => ({ ...describe(node), text: node.text })) }));
  // C76: the real session enables Assistant, so no fallback Ask textarea is
  // emitted. Open the current clean nonmodal panel; never alter that feature.
  assert.equal(session.assistant.enabled, true); assert.equal(session.policy.accepted, true);
  const assistantReads = cReviewAssistantReadPort(t, q);
  const launcher = f.find("button", node => node.owner.tag === "forma-assistant-panel"
    && String(node.attributes.class ?? "").split(/\s/u).includes("forma-assistant-launcher"));
  const originPanel = launcher.owner, originAssistant = originPanel.parentElement;
  assert.equal(originAssistant.tag, "forma-creative-assistant"); assert.equal(originAssistant.store, h.store);
  await f.act(launcher); await assistantReads.settle(); await f.settle(); await assistantReads.settle();
  assert.ok(originPanel.isConnected && originPanel.open);
  assert.equal(originPanel.navigationBlocked, false, "The actual Assistant opens with no raw draft or unresolved request");
  assert.ok(assistantReads.records.length > 0, "Opening used the actual Worker read, not a fabricated context");
  for (const record of assistantReads.records) {
    assert.equal(record.status, 200);
    assert.deepEqual(record.body.context.scope, { actorUserId: session.user.userId, organizationId: null,
      projectAccessId: null, projectId: q.entryProject, documentId: q.entryDocument });
    assert.deepEqual(record.body.turns, []); assert.deepEqual(record.body.tasks, []);
  }
  const composers = f.components().filter(owner => owner.tag === "forma-ui-conversation-composer" && owner.parentElement === originPanel);
  assert.equal(composers.length, 1);
  const originComposer = composers[0], originWorkspace = f.components().find(owner => owner.tag === "forma-workspace");
  assert.ok(originWorkspace?.isConnected && originComposer.isConnected);
  const field = () => f.find("textarea", node => node.owner === originComposer
    && String(node.attributes.class ?? "").split(/\s/u).includes("forma-assistant-input"));
  return { ...q, field, originWorkspace, originPanel, originComposer, assistantReads };
}

function cReviewHeldContext(q) {
  const { h } = q, previous = h.intercept, entered = sceneDeferred(), release = sceneDeferred();
  const path = "/api/workspaces/" + encodeURIComponent(q.task.organizationId)
    + "/projects/" + encodeURIComponent(q.task.projectAccessId) + "/context";
  const gate = { entered, release, response: null, body: null, count: 0, requests: [] };
  const intercept = async request => {
    if (request.init.method !== "POST" || request.url !== path)
      return previous ? previous(request) : undefined;
    gate.count++; gate.requests.push(request);
    assert.equal(gate.count, 1, "One deliberate original context command, never a retry");
    try {
      const response = await q.serverRequest(request);
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.clone().json();
      assert.equal(body.organizationId, q.task.organizationId);
      assert.equal(body.projectAccessId, q.task.projectAccessId);
      assert.equal(body.projectId, q.task.projectId);
      assert.ok(body.permissions.includes("project.read") && body.permissions.includes("project.review.approve"));
      assert.ok(response.headers.get("set-cookie"), "The unaltered actual Worker response carries its context cookie");
      gate.response = response; gate.body = body; entered.resolve();
      await release.promise;
      return q.receive(response);
    } catch (error) { entered.reject(error); throw error; }
  };
  h.intercept = intercept;
  gate.restore = () => { if (h.intercept === intercept) h.intercept = previous; };
  return gate;
}

for (const boundary of ["healthy", "new-raw", "route-aba", "actor-aba", "source-aba"]) test(
  "C review command positive-context origin admission / " + boundary, { timeout: 30_000 }, async t => {
    // The source-denial case uses the real shared cookie whose rotation can
    // invalidate an old read. It does not invent authoring inputs for a reviewer.
    const q = boundary === "source-aba" ? await commandPage(t, "same-document") : await cReviewOriginWorkspace(t);
    const { h, f } = q, source = h.store.captureSourceOwnership(), origin = h.store.route.get();
    const actor = h.store.session.get().user, beforeEvents = h.store.events.get();
    const originalWrites = h.requests.filter(row => row.init.method === "POST" && row.url === "/api/events").length;
    assert.ok(h.store.sourceOwnershipActive(source));
    const gate = cReviewHeldContext(q);
    let activation;
    try {
      activation = q.choose();
      await finish(q, gate.entered.promise);
      await finish(q, activation);
      assert.equal(q.storeCalls.length, 1);
      assert.equal(q.storeCalls[0].settled, undefined, "The original Store promise still waits for its actual response");
      assert.equal(q.viewerCalls.length, 0);
      assert.equal(h.store.route.get(), origin);
      assert.equal(h.store.ui.commandOpen, false, "The command palette is closed before any newer native edit");
      assert.deepEqual(h.store.events.get(), beforeEvents, "The held response has not adopted destination history");
      const raw = "  Newer unsubmitted origin draft B — retain exactly  ";
      if (boundary === "new-raw") {
        const input = q.field();
        assert.equal(input.owner, q.originComposer);
        assert.equal(input.port.value, "", "The current Assistant composer was clean before this new edit");
        assert.ok(input.port.isConnected && !input.port.disabled && !Object.hasOwn(input.attributes, "disabled"));
        input.port.value = raw;
        await f.act(input, "input");
        const current = q.field();
        assert.equal(current.owner, q.originComposer);
        assert.equal(current.port.value, raw);
        assert.ok(current.port.isConnected);
        assert.equal(q.originPanel.navigationBlocked, true, "The original emitted input event reached the actual Assistant draft owner");
        assert.ok(h.store.sourceOwnershipActive(source), "Ordinary new raw input does not change Source authority");
        assert.equal(h.store.route.get(), origin);
      } else if (boundary === "route-aba") {
        const activity = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
          && new URL(node.attributes.href, "https://fixture.invalid").pathname === "/activity");
        await f.act(activity, "click", { button: 0 });
        assert.notEqual(h.store.route.get(), origin);
        const back = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation" && node.attributes.href === origin);
        await f.act(back, "click", { button: 0 });
        assert.equal(h.store.route.get(), origin, "Actual native task navigation returned to the same route string");
      } else if (boundary === "actor-aba") {
        // Existing native authentication port; both sessions are real Worker
        // responses, not replaced Store state or invented permissions.
        q.activatePrincipal({});
        await h.store.refreshSession(); await f.settle();
        assert.equal(h.store.session.get().user.userId, q.w.owner);
        assert.notEqual(h.store.session.get().user.userId, actor.userId);
        q.activatePrincipal({ "oai-authenticated-user-id": actor.userId, "oai-authenticated-user-email": actor.email });
        await h.store.refreshSession(); await h.store.refreshEvents({ fromStart: true }); await f.settle();
        assert.equal(h.store.session.get().user.userId, actor.userId);
        assert.equal(h.store.sourceOwnershipActive(source), false, "Restored actor A does not revive the original Source owner");
      } else if (boundary === "source-aba") {
        await assert.rejects(h.store.refreshEvents(), /403/);
        assert.equal(h.store.sourceOwnershipActive(source), false);
        assert.equal(h.store.events.get().length, 0);
        // Deliver only the original real response's headers to the native cookie
        // port, then obtain a genuine new read; the original await stays held.
        q.receive(gate.response.clone());
        await h.store.refreshEvents({ fromStart: true }); await f.settle();
        assert.ok(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()));
        assert.equal(h.store.sourceOwnershipActive(source), false, "A successful renewed read cannot revive the old selection");
        assert.equal(q.storeCalls[0].settled, undefined);
      }
      await f.settle();
      const beforeRelease = h.requests.length, currentSession = h.store.session.get();
      gate.release.resolve();
      await finish(q, activation);
      const result = await finish(q, q.storeCalls[0].pending);
      await finish(q, Promise.all(q.viewerCalls.map(call => call.pending)));
      await flushStoreFrames(h); await f.settle();
      const sessionReads = h.requests.slice(beforeRelease).filter(row => row.url === "/api/session");
      const currentFields = f.tree().visible("textarea").filter(node => node.owner === q.originComposer
        && String(node.attributes.class ?? "").split(/\s/u).includes("forma-assistant-input"));
      t.diagnostic("C_REVIEW_ORIGIN_HANDOFF " + JSON.stringify({ boundary, contextStatus: gate.response.status,
        exactProject: gate.body.projectId, contextCommands: gate.count, result,
        origin, route: h.store.route.get(), sessionReadsAfterRelease: sessionReads.length,
        currentProject: h.store.session.get().projectContext?.projectId ?? null,
        originalSourceActive: h.store.sourceOwnershipActive(source),
        originWorkspaceConnected: q.originWorkspace?.isConnected ?? null,
        originPanelConnected: q.originPanel?.isConnected ?? null, originComposerConnected: q.originComposer?.isConnected ?? null,
        inputOwner: q.originComposer?.tag ?? null, assistantReadStatuses: q.assistantReads?.records.map(record => record.status) ?? [],
        currentRawValues: currentFields.map(node => node.port.value), viewerCalls: q.viewerCalls.length,
        evidence: "actual command, native input/task controls, original Worker context response and current Store; no physical or provider claim" }));
      assert.equal(gate.count, 1);
      assert.equal(h.requests.filter(row => row.init.method === "POST" && row.url === "/api/events").length, originalWrites,
        "Neither admission nor refusal submits the Ask draft or another authored command");
      if (boundary === "healthy") {
        assert.equal(result, true);
        await completeOpening(q, activation);
        assert.ok(sessionReads.length > 0, "The healthy positive context is deliberately adopted through the existing session read");
        assert.equal(h.store.sourceOwnershipActive(source), false, "Legitimate cross-project adoption retires the old Source");
        assert.equal(h.store.session.get().projectContext.projectId, q.task.projectId);
        assert.deepEqual(libraryFocusFromRoute(h.store.route.get()), { kind: "artifact", id: q.artifactId });
        assert.deepEqual(artifactFocusOptionsFromRoute(h.store.route.get()),
          { expectedRevision: q.task.revision, expectedContentSha256: q.hash, intent: "review" });
        assert.equal(q.viewerCalls.length, 1);
        assert.equal(q.viewerCalls[0].result, true);
        assert.equal(q.viewerCalls[0].owner.documentId, q.targetDocument);
        assert.equal(q.viewerCalls[0].owner.querySelector(".document-artifact-view")?.open, true);
        assert.match(f.tree().root.text, /EXACT_ASSIGNED_B_BODY/);
      } else {
        // Explicit migration of the former zero-session-read oracle: an actual
        // completed cookie must reconcile privacy even when its UI was refused.
        assert.ok(sessionReads.length > 0, "The completed cookie gets a fresh same-principal session read, never another context write");
        assert.equal(result, false);
        assert.equal(h.store.session.get().user.userId, currentSession.user.userId);
        assert.equal(h.store.session.get().projectContext.projectId, q.task.projectId);
        assert.equal(h.store.sourceOwnershipActive(source), false, "No old Source is restored to preserve its obsolete private fields");
        assert.equal(h.store.route.get(), origin);
        assert.equal(q.viewerCalls.length, 0, "No exact or fallback viewer is opened by the disowned response");
        if (boundary === "new-raw") {
          // The unchanged pre-release assertions above prove B belonged to the
          // original live owner. Actual authorization retirement is different:
          // it must not expose that private B under the new shared Source.
          assert.ok(!currentFields.some(node => node.port.value === raw), "Obsolete personal raw B is not exposed under the reconciled shared Source");
        }
      }
    } finally {
      gate.release.resolve();
      try {
        await Promise.allSettled([activation, ...q.storeCalls.map(call => call.pending)].filter(Boolean));
        await Promise.allSettled(q.viewerCalls.map(call => call.pending));
        await flushStoreFrames(h); await f.settle();
        await q.assistantReads?.settle();
      } finally { gate.restore(); q.assistantReads?.restore(); }
    }
  });

// Separate read-after-cookie controls. The five original origin-admission
// case registrations above remain; the separately disclosed legacy privacy
// oracle forward replaces zero-session-read/old-Source retention after a real cookie.
// Context response/cookie and follow-up event/session bodies are original RAM
// Worker responses. No invented permission, current callback, Source or ACK.
for (const boundary of ["healthy", "newer-raw"]) test(
  "C positive context cookie keeps a subsequent event read in its actual Source scope / " + boundary,
  { timeout: 30_000 }, async t => {
    const q = await cReviewOriginWorkspace(t), { h, f } = q;
    const origin = h.store.route.get(), source = h.store.captureSourceOwnership();
    const authorization = h.store.captureAuthorizationScope(), actor = h.store.session.get().user.userId;
    assert.ok(source && authorization && h.store.sourceOwnershipActive(source));
    assert.equal(h.store.session.get().projectContext, undefined);
    assert.equal(h.store.projection.get().projectId, q.entryProject);
    assert.notEqual(q.entryProject, q.task.projectId, "This is an actual personal-to-shared scope change, not an audience-only refresh");
    const gate = cReviewHeldContext(q), raw = "  Newer personal draft B before the actual shared cookie — 原稿  ";
    let activation, readRestore = () => {};
    try {
      activation = q.choose();
      await finish(q, gate.entered.promise); await finish(q, activation);
      assert.equal(q.storeCalls.length, 1); assert.equal(q.storeCalls[0].settled, undefined);
      assert.equal(gate.response.status, 200); assert.equal(gate.body.projectId, q.task.projectId);
      assert.equal(h.store.route.get(), origin); assert.equal(q.viewerCalls.length, 0);
      if (boundary === "newer-raw") {
        const input = q.field();
        assert.ok(input.port.isConnected && !input.port.disabled);
        assert.equal(input.port.value, "");
        q.native.emit("pointerdown", input.port); q.native.focus(input.port);
        input.port.value = raw; await f.act(input, "input");
        const current = q.field(); q.native.focus(current.port);
        assert.equal(current.owner, q.originComposer); assert.equal(current.port.value, raw);
        assert.equal(q.originPanel.navigationBlocked, true);
        assert.ok(h.store.sourceOwnershipActive(source), "New raw input itself is not permission retirement");
      }
      const traceStart = f.trace.length, requestsBeforeRelease = h.requests.length;
      gate.release.resolve(); await finish(q, activation);
      const returned = await finish(q, q.storeCalls[0].pending);
      await finish(q, Promise.all(q.viewerCalls.map(call => call.pending)));
      await flushStoreFrames(h); await f.settle();
      if (boundary === "healthy") {
        assert.equal(returned, true); await completeOpening(q, activation);
        assert.equal(q.viewerCalls.length, 1); assert.equal(q.viewerCalls[0].result, true);
        assert.equal(q.viewerCalls[0].owner.documentId, q.targetDocument);
        assert.equal(q.viewerCalls[0].owner.querySelector(".document-artifact-view")?.open, true);
        assert.deepEqual(artifactFocusOptionsFromRoute(h.store.route.get()),
          { expectedRevision: q.task.revision, expectedContentSha256: q.hash, intent: "review" });
      } else {
        assert.equal(returned, false, "The retired UI cannot claim the exact review opened");
        assert.equal(h.store.route.get(), origin); assert.equal(q.viewerCalls.length, 0);
        assert.ok(!f.trace.slice(traceStart).some(value => value === "open:document-artifact-view"),
          "No old exact or fallback dialog may promote after the newer native gesture");
      }
      assert.equal(gate.count, 1, "One original context command, never a retry or a replacement");

      // Observe the browser cookie's actual current session without publishing
      // it into the Store. This diagnostic GET is not another context ACK.
      const liveResponse = await q.nativeRequest({ url: "/api/session", init: {} });
      assert.equal(liveResponse.status, 200);
      const live = await liveResponse.json();
      assert.equal(live.user.userId, actor);
      assert.equal(live.projectContext?.organizationId, q.task.organizationId);
      assert.equal(live.projectContext?.projectAccessId, q.task.projectAccessId);
      assert.equal(live.projectContext?.projectId, q.task.projectId);

      const reads = [], previous = h.intercept;
      const intercept = async request => {
        if (!request.url.startsWith("/api/events?")) return previous?.(request);
        assert.equal(request.init.method ?? "GET", "GET");
        const response = await q.nativeRequest(request);
        const body = await response.clone().json();
        reads.push({ url: request.url, status: response.status, eventCount: body.events?.length ?? 0,
          projects: [...new Set((body.events ?? []).map(event => event.payload?.project_id).filter(Boolean))],
          contentCount: Object.keys(body.content ?? {}).length });
        return response;
      };
      h.intercept = intercept;
      readRestore = () => { if (h.intercept === intercept) h.intercept = previous; };
      const beforeRead = { sourceActive: h.store.sourceOwnershipActive(source),
        authority: h.store.captureAuthorizationScope()?.key,
        publishedProject: h.store.session.get().projectContext?.projectId ?? null };
      let readError = null;
      try { await finish(q, h.store.refreshEvents({ fromStart: true })); }
      catch (error) { readError = String(error); }
      await flushStoreFrames(h); await f.settle();
      const current = h.store.session.get(), currentAuthorization = h.store.captureAuthorizationScope();
      const targetEvents = h.store.events.get().filter(event => event.payload?.project_id === q.task.projectId);
      const sourceNow = h.store.captureSourceOwnership();
      const coherentDestination = current?.user.userId === actor
        && current.projectContext?.organizationId === q.task.organizationId
        && current.projectContext?.projectAccessId === q.task.projectAccessId
        && current.projectContext?.projectId === q.task.projectId
        && currentAuthorization?.key !== authorization.key;
      t.diagnostic("C_CONTEXT_COOKIE_SOURCE " + JSON.stringify({ boundary, originalStatus: gate.response.status,
        originalCommands: gate.count, returned, nativeSessionProject: live.projectContext.projectId,
        storeSessionReadsAfterRelease: h.requests.slice(requestsBeforeRelease).filter(row => row.url === "/api/session").length,
        diagnosticNativeSessionReads: 1, beforeRead, reads, readError,
        publishedProject: current?.projectContext?.projectId ?? null, originalAuthorityStillCurrent: currentAuthorization?.key === authorization.key,
        originalSourceActive: h.store.sourceOwnershipActive(source), currentSourceActive: h.store.sourceOwnershipActive(sourceNow),
        targetEventCount: targetEvents.length, coherentDestination, route: h.store.route.get(), viewerCalls: q.viewerCalls.length,
        evidence: "actual command, original context cookie, one diagnostic native session GET, ordinary Store event read; no provider or browser claim" }));
      assert.equal(h.store.session.get().user.userId, actor);
      assert.ok(reads.length > 0 || readError, "The ordinary Store read either reaches its original resource or refuses before transport");
      assert.ok(targetEvents.length === 0 || coherentDestination,
        "Destination-project events must never publish under the original personal Source/authorization after a completed context cookie");
      if (boundary === "healthy") {
        assert.equal(readError, null); assert.ok(targetEvents.length > 0); assert.equal(coherentDestination, true);
      } else {
        assert.equal(h.store.route.get(), origin); assert.equal(q.viewerCalls.length, 0);
        assert.ok(!f.trace.slice(traceStart).some(value => value === "open:document-artifact-view"));
        // Privacy retirement may remove an obsolete field. This new pair never
        // demands restoration of old authority merely to retain its raw body.
      }
      await q.assistantReads.settle(); q.assistantReads.assertEmpty();
    } finally {
      gate.release.resolve(); readRestore();
      try {
        await Promise.allSettled([activation, ...q.storeCalls.map(call => call.pending)].filter(Boolean));
        await Promise.allSettled(q.viewerCalls.map(call => call.pending));
        await flushStoreFrames(h); await f.settle(); await q.assistantReads?.settle();
      } finally { gate.restore(); q.assistantReads?.restore(); }
    }
  });
