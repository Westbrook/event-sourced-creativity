import assert from "node:assert/strict";
import test from "node:test";
import { buildAdaptiveProposalApplication } from "../src/model/adaptive-proposal-application.ts";
import { receiptFixture, unchanged, close, documentPort, adaptiveProposalScope, turn, event, ITEM, EXECUTION, BINDING, listenerCounts } from "./helpers/canvas-receipt-result-navigation-host.mjs";
import { view, openView, action, activateViewAction, dialog, dispatchLit, event as menuEvent } from "./helpers/canvas-view-resume-action-host.mjs";

// Complete actual Canvas/controller/model/resolver and installed Lit EventPart.
// Store, read responses, DOM and scheduling are existing finite ports, not
// Worker authorization, provider creation, native input or browser/AT evidence.
const initialFetch = globalThis.fetch; let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error("No provider or external request is authorized"); };
test.after(() => { try { assert.equal(externalCalls, 0); } finally { globalThis.fetch = initialFetch; } });

async function openOriginalItem(h){
  const {f}=h;
  h.button.focus();h.button.handlers.click.call(f.host,event(h.button));
  await f.flush();await turn();
  assert.equal(f.proposalReview.receipt===h.receipt,true);
  const target=f.host.querySelector('[data-canvas-item-id="'+ITEM+'"]');
  assert.ok(target?.isConnected);assert.equal(documentPort.activeElement===target,true);
  assert.deepEqual(f.state.selected,[ITEM]);assert.equal(f.proposalReview.visible,false);
  assert.equal(f.store.canvasPlanningDocumentId(),"");
  assert.equal(adaptiveProposalScope(f.store,"document-0","board-a"),null);
  const scope=f.proposalReview.ports.scope();assert.equal(scope?.key,h.scope.key);assert.equal(scope.documentId,"document-0");
  assert.equal(scope.canAuthor,false);assert.equal(f.proposalReview.canPreview,false);assert.equal(f.proposalReview.canApply,false);
  for(const action of["preview","apply","dismiss"])await assert.rejects(f.proposalReview.ports.request({
    action,projectId:"p",documentId:"document-0",canvasId:"board-a"}),/adaptive_changes_scope_changed/u);
  assert.deepEqual(listenerCounts(f),h.listeners);unchanged(h);
}

function planningObservation(f){
  const owned=view(f),selectors=f.renderer.ownNodes(owned.menu,"select").filter(node=>
    node.handlers.change?.toString().includes("chooseCanvasPlanningDocument"));
  const section=f.native("section",node=>node.classList.contains("canvas-next-document"));
  let concealed=false;
  for(let node=section;node&&node!==f.host;node=node.parentElement){
    if(Object.hasOwn(node.attributes??{},"hidden")||Object.hasOwn(node.attributes??{},"inert")
      ||node.tag==="dialog"&&!node.open
      ||Object.hasOwn(node.attributes??{},"popover")&&!node.matches(":popover-open"))concealed=true;
  }
  const guidance=f.i18n.t("canvas.controls.chooseInView","Choose a planning document in View, or select one document on the board.");
  return{guidance,guideRendered:f.renderer.markup.includes(guidance),
    guideContainerConnected:Boolean(section?.isConnected),guideContainerPortExposed:Boolean(section&&!concealed),
    selectorCount:selectors.length,selectorValues:selectors.map(node=>node.value),
    selectorDisabled:selectors.map(node=>node.disabled),menuOpen:owned.panel.matches(":popover-open"),
    originalDocumentOptionPresent:f.renderer.ownNodes(owned.menu,"option").some(node=>node.value==="document-0"),
    qualification:"finite-render/native-port exposure and actual existing View selector, not browser pixels"};
}

function chooseOriginalPlanningDocument(f){
  const owned=openView(f),selectors=f.renderer.ownNodes(owned.menu,"select").filter(node=>
    node.handlers.change?.toString().includes("chooseCanvasPlanningDocument"));
  assert.equal(selectors.length,1);const selector=selectors[0];
  assert.ok(selector.isConnected&&!selector.disabled);
  assert.ok(f.renderer.ownNodes(owned.menu,"option").some(node=>node.value==="document-0"));
  selector.value="document-0";selector.focus();
  const wrapper=selector.closest(".canvas-view-actions");assert.ok(wrapper?.handlers.change);
  const value=menuEvent("change",selector);
  dispatchLit(wrapper,owned.menu,value);
  assert.equal(value.immediateStopped,false);dispatchLit(selector,owned.menu,value);
  f.draw();
}

for(const locale of["en","ja"])for(const continuation of["ordinary-close","open-item"]){
  test(locale+" current View Resume preserves the exact original receipt after "+continuation,async t=>{
    const h=await receiptFixture(locale),{f}=h;
    try{
      if(continuation==="open-item")await openOriginalItem(h);
      else{
        const closeButton=f.native("button",node=>node.handlers.click?.toString().replace(/\s+/gu,"").includes("()=>close()"));
        assert.ok(closeButton?.isConnected&&!closeButton.disabled,"actual current review Close control");
        closeButton.focus();closeButton.handlers.click.call(f.host,event(closeButton));await f.flush();await turn();
        assert.equal(f.proposalReview.visible,false);assert.equal(f.proposalReview.receipt===h.receipt,true);
        assert.equal(f.store.canvasPlanningDocumentId(),"document-0");unchanged(h);
      }
      const before={events:JSON.stringify(f.state.events),selection:[...f.state.selected],requests:f.state.requests.length,
        executionId:f.proposalReview.executionId,bindingHash:f.proposalReview.bindingHash,handle:structuredClone(f.proposalReview.handle)};
      const owned=openView(f),button=action(f,owned,"resume");button.focus();
      // The same exact model-shaped receipt already used by receiptFixture.
      // No new success, canonical insertion, method override or different ID.
      // This queued original can be consumed ONLY if production dispatches its
      // next exact retrieve; the suspected path never reaches this port.
      assert.equal(h.wireReceipt.status,"applied");assert.equal(h.wireReceipt.idempotent,true);
      for(const [key,value] of Object.entries(h.receipt))assert.deepEqual(h.wireReceipt[key],value,"original wire/controller parity: "+key);
      f.state.replies.push(h.wireReceipt);
      const result=activateViewAction(f,owned,button);
      for(let step=0;step<4;step++)await f.flush();
      const after={visible:f.proposalReview.visible,phase:f.proposalReview.phase,notice:f.proposalReview.notice,
        dialogOpen:Boolean(dialog(f,"adaptive-proposal-dialog")?.open),newRequests:f.state.requests.slice(before.requests),
        receiptSame:f.proposalReview.receipt===h.receipt,receipt:f.proposalReview.receipt,
        handle:f.proposalReview.handle,planningDocument:f.store.canvasPlanningDocumentId(),selection:[...f.state.selected],
        canPreview:f.proposalReview.canPreview,canApply:f.proposalReview.canApply,
        planningGuidanceAndSelector:planningObservation(f),
        targetReached:result.targetReached,closedBeforeTarget:result.closedBeforeTarget,
        triggerFocusedBeforeTarget:result.triggerFocusedBeforeTarget,error:result.error?.message??null};
      t.diagnostic("P8_RECEIPT_RESUME "+JSON.stringify({locale,continuation,before,after,externalCalls,
        qualification:"full current Canvas/controller/model/Lit; finite existing Store/read/native ports, not Worker or physical input"}));
      assert.equal(result.targetReached,true);assert.equal(result.error,null);
      assert.equal(result.closedBeforeTarget,true);assert.equal(result.triggerFocusedBeforeTarget,true);
      assert.equal(JSON.stringify(f.state.events),before.events);assert.deepEqual(f.state.selected,before.selection);
      assert.equal(f.state.batches.length,0);assert.equal(externalCalls,0);
      assert.equal(f.proposalReview.canPreview,false);assert.equal(f.proposalReview.canApply,false);
      assert.deepEqual(after.newRequests,[{url:"/api/context/adaptive/apply",body:{action:"retrieve",projectId:"p",documentId:"document-0",canvasId:"board-a",
        previewId:before.handle.previewId,approvalHash:before.handle.approvalHash}}],"fresh visible Resume must reach an exact original read, not silently retire itself");
      assert.equal(f.proposalReview.visible,true);assert.equal(after.dialogOpen,true);
      assert.equal(f.proposalReview.phase,"applied");assert.deepEqual(f.proposalReview.receipt,h.receipt);
      assert.equal(f.proposalReview.executionId,before.executionId);assert.equal(f.proposalReview.bindingHash,before.bindingHash);
    }finally{close(h);}
  });
}


for(const locale of["en","ja"])test(locale+" explicit original planning choice can recover after attempted receipt Resume",async t=>{
  const h=await receiptFixture(locale),{f}=h;
  try{
    await openOriginalItem(h);
    const events=JSON.stringify(f.state.events),originalHandle=structuredClone(f.proposalReview.handle);
    const beforeFirst=f.state.requests.length,owned=openView(f),button=action(f,owned,"resume");
    button.focus();f.state.replies.push(h.wireReceipt);
    const direct=activateViewAction(f,owned,button);
    for(let step=0;step<4;step++)await f.flush();
    assert.equal(direct.targetReached,true);assert.equal(direct.error,null);
    const afterDirect={visible:f.proposalReview.visible,phase:f.proposalReview.phase,
      newRequests:f.state.requests.slice(beforeFirst),handle:structuredClone(f.proposalReview.handle),
      planning:planningObservation(f)};
    assert.deepEqual(f.proposalReview.handle,originalHandle,"original content-free handle survives either direct outcome");
    // If direct Resume is later fixed and leaves a current dialog, close it
    // using its existing connected control before the independent View choice.
    if(f.proposalReview.visible){
      const closer=f.native("button",node=>node.handlers.click?.toString().replace(/\s+/gu,"").includes("()=>close()"));
      assert.ok(closer?.isConnected&&!closer.disabled);closer.focus();
      closer.handlers.click.call(f.host,event(closer));await f.flush();
    }
    chooseOriginalPlanningDocument(f);await f.flush();
    assert.equal(f.store.canvasPlanningDocumentId(),"document-0");assert.deepEqual(f.state.selected,[]);
    const beforeSecond=f.state.requests.length,next=openView(f),resumeButton=action(f,next,"resume");
    resumeButton.focus();
    // Reuse the still-unconsumed original reply, or queue that same existing
    // wire object if the previous direct continuation already consumed it.
    assert.ok(f.state.replies.length<=1);
    if(!f.state.replies.length)f.state.replies.push(h.wireReceipt);
    const recovered=activateViewAction(f,next,resumeButton);
    for(let step=0;step<4;step++)await f.flush();
    const afterChoice={visible:f.proposalReview.visible,phase:f.proposalReview.phase,
      dialogOpen:Boolean(dialog(f,"adaptive-proposal-dialog")?.open),newRequests:f.state.requests.slice(beforeSecond),
      receipt:f.proposalReview.receipt,handle:f.proposalReview.handle,
      planningDocument:f.store.canvasPlanningDocumentId(),selection:[...f.state.selected]};
    t.diagnostic("P8_RECEIPT_RESUME_WORKAROUND "+JSON.stringify({locale,afterDirect,afterChoice,externalCalls,
      qualification:"explicit current View selector intentionally clears selected item; no automatic choice or Worker/native claim"}));
    assert.equal(recovered.targetReached,true);assert.equal(recovered.error,null);
    assert.deepEqual(afterChoice.newRequests,[{url:"/api/context/adaptive/apply",body:{action:"retrieve",
      projectId:"p",documentId:"document-0",canvasId:"board-a",...originalHandle}}]);
    assert.equal(afterChoice.visible,true);assert.equal(afterChoice.dialogOpen,true);assert.equal(afterChoice.phase,"applied");
    assert.deepEqual(f.proposalReview.receipt,h.receipt);assert.deepEqual(f.proposalReview.handle,originalHandle);
    assert.equal(f.proposalReview.canApply,false);assert.equal(f.proposalReview.canPreview,false);
    assert.equal(JSON.stringify(f.state.events),events);assert.equal(f.state.batches.length,0);assert.equal(externalCalls,0);
  }finally{close(h);}
});


const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function settle(f) { for (let step = 0; step < 4; step++) await f.flush(); }
function resumeFromView(f) {
  const owned = openView(f), button = action(f, owned, "resume"); button.focus();
  const result = activateViewAction(f, owned, button);
  assert.equal(result.targetReached, true); assert.equal(result.error, null);
  assert.equal(result.closedBeforeTarget, true); assert.equal(result.triggerFocusedBeforeTarget, true);
}
async function closeReview(f) {
  const button = f.native("button", node => node.handlers.click?.toString().replace(/\s+/gu, "").includes("()=>close()"));
  assert.ok(button?.isConnected && !button.disabled, "the actual current review Close control");
  button.focus(); button.handlers.click.call(f.host, event(button)); await settle(f);
  assert.equal(f.proposalReview.visible, false); assert.equal(f.proposalReview.busy, false);
}
function exactReadOnly(h) {
  const { f } = h, scope = f.proposalReview.ports.scope();
  assert.equal(scope?.key, h.scope.key); assert.equal(scope.documentId, "document-0"); assert.equal(scope.canAuthor, false);
  assert.equal(f.store.canvasPlanningDocumentId(), ""); assert.deepEqual(f.state.selected, [ITEM]);
  assert.equal(f.proposalReview.canPreview, false); assert.equal(f.proposalReview.canApply, false);
  assert.deepEqual(f.proposalReview.handle, { previewId: h.receipt.previewId, approvalHash: h.receipt.approvalHash });
  assert.equal(f.proposalReview.executionId, EXECUTION); assert.equal(f.proposalReview.bindingHash, BINDING);
  assert.equal(JSON.stringify(f.state.events), h.events); assert.equal(f.state.batches.length, 0);
  assert.equal(externalCalls, 0);
}
function exactRequests(h, count) {
  const requests = h.f.state.requests.slice(3);
  assert.equal(requests.length, count);
  for (const request of requests) assert.deepEqual(request, { url: "/api/context/adaptive/apply", body: {
    action: "retrieve", projectId: "p", documentId: "document-0", canvasId: "board-a",
    previewId: h.receipt.previewId, approvalHash: h.receipt.approvalHash } });
}
function holdExactReads(f) {
  const original = f.store.guardedFetch, reads = [];
  f.store.guardedFetch = async (...args) => {
    // Consume the existing finite transport's exact prepared response first.
    // This helper owns only delivery timing; it invents no success or authority.
    const response = await original(...args), gate = deferred();
    reads.push(gate); await gate.promise; return response;
  };
  return { reads, restore() { f.store.guardedFetch = original; reads.forEach(gate => gate.resolve()); } };
}

for (const locale of ["en", "ja"]) test(locale + " exact item Resume and visible Check own only their current read", async () => {
  const h = await receiptFixture(locale), { f } = h;
  try {
    await openOriginalItem(h); f.state.replies.push(h.wireReceipt); resumeFromView(f); await settle(f);
    exactReadOnly(h); exactRequests(h, 1);
    assert.equal(f.proposalReview.visible, true); assert.equal(dialog(f, "adaptive-proposal-dialog")?.open, true);
    assert.notEqual(f.proposalReview.receipt, h.receipt, "the actual decoder normalizes a new receipt");
    const first = f.proposalReview.receipt, presentation = f.proposalReview.presentationId;
    f.state.replies.push(h.wireReceipt);
    await f.click("button", node => node.handlers.click?.toString().includes("controller.resume()")); await settle(f);
    assert.equal(f.proposalReview.presentationId, presentation, "visible Check retains its existing presentation");
    assert.notEqual(f.proposalReview.receipt, first); assert.deepEqual(f.proposalReview.receipt, h.receipt);
    exactReadOnly(h); exactRequests(h, 2);
    await closeReview(f); exactReadOnly(h);
    f.state.replies.push(h.wireReceipt); resumeFromView(f); await settle(f);
    assert.equal(f.proposalReview.presentationId, presentation + 1); assert.equal(f.proposalReview.visible, true);
    exactReadOnly(h); exactRequests(h, 3);
    // Outside the exact owned read, even an equivalent object substitution
    // must retire the context: reference guards have not been globally relaxed.
    f.proposalReview.receipt = structuredClone(f.proposalReview.receipt); f.draw();
    assert.equal(h.notifications.size, 0); assert.equal(f.proposalReview.receipt, null);
    assert.equal(f.proposalReview.ports.scope(), null); assert.equal(f.proposalReview.visible, false);
    assert.equal(JSON.stringify(f.state.events), h.events); exactRequests(h, 3);
  } finally { close(h); }
});

const pendingChanges = ["close", "close-resume", "close-reopen", "route-ABA", "authority-ABA", "source-ABA", "selection-ABA", "foreign-receipt"];
for (const locale of ["en", "ja"]) for (const change of pendingChanges) {
  test(locale + " pending exact item Resume retires only its owned continuation on " + change, async () => {
    const h = await receiptFixture(locale), { f } = h;
    let held;
    try {
      await openOriginalItem(h); held = holdExactReads(f);
      // The sole foreign response is a negative decoder/identity control, never
      // used as the source or setup for a successful continuation.
      f.state.replies.push(change === "foreign-receipt" ? { ...h.wireReceipt, previewId: "different-preview" } : h.wireReceipt);
      resumeFromView(f); await settle(f);
      assert.equal(held.reads.length, 1); assert.equal(f.proposalReview.visible, true); assert.equal(f.proposalReview.busy, true);
      assert.equal(f.proposalReview.receipt, h.receipt); exactReadOnly(h); exactRequests(h, 1);
      const presentation = f.proposalReview.presentationId;
      if (change.startsWith("close")) {
        await closeReview(f); exactReadOnly(h);
        assert.equal(f.proposalReview.presentationId, presentation);
        if (change === "close-resume") {
          f.state.replies.push(h.wireReceipt); resumeFromView(f); await settle(f);
          assert.equal(held.reads.length, 2); assert.equal(f.proposalReview.presentationId, presentation + 1);
          assert.equal(f.proposalReview.visible, true); assert.equal(f.proposalReview.busy, true);
          exactReadOnly(h); exactRequests(h, 2);
        } else if (change === "close-reopen") {
          f.proposalReview.reopen(); f.draw();
          assert.equal(h.notifications.size, 0, "a generic unowned reopen cannot inherit the read continuation");
        }
      } else if (change === "route-ABA") {
        const route = f.route; f.route = "/canvas/board-a/board-a?view=list"; f.draw(); f.route = route; f.draw();
      } else if (change === "authority-ABA") {
        f.state.authorization = "different-authority"; f.draw(); f.state.authorization = "actor-a"; f.draw();
      } else if (change === "source-ABA") {
        // Same existing read-only metadata port as the navigation negatives.
        let withdrawalRevision = 1;
        f.store.adaptiveProposalSource = (documentId, canvasId, executionId) => {
          if (executionId !== EXECUTION) return null;
          f.proposalSourceReads.push({ documentId, canvasId, executionId });
          return { executionId: EXECUTION, bindingHash: BINDING, structure: null, readable: false, withdrawalRevision };
        };
        f.draw(); withdrawalRevision = 0; f.draw();
      } else if (change === "selection-ABA") {
        await f.select(0, "document");
        const target = f.host.querySelector('[data-canvas-item-id="' + ITEM + '"]'); assert.ok(target?.isConnected);
        target.handlers.click.call(f.host, event(target)); f.draw(); assert.deepEqual(f.state.selected, [ITEM]);
      }
      const before = { visible: f.proposalReview.visible, busy: f.proposalReview.busy,
        presentation: f.proposalReview.presentationId, receipt: f.proposalReview.receipt,
        handle: structuredClone(f.proposalReview.handle), focus: documentPort.activeElement };
      held.reads[0].resolve(); await settle(f);
      if (change !== "foreign-receipt") {
        assert.equal(f.proposalReview.visible, before.visible); assert.equal(f.proposalReview.busy, before.busy);
        assert.equal(f.proposalReview.presentationId, before.presentation); assert.equal(f.proposalReview.receipt, before.receipt);
        assert.deepEqual(f.proposalReview.handle, before.handle); assert.equal(documentPort.activeElement, before.focus);
      }
      if (change === "close-resume") {
        assert.equal(f.proposalReview.busy, true, "the old completion cannot clear a newer read's busy state");
        held.reads[1].resolve(); await settle(f); exactReadOnly(h);
        assert.equal(f.proposalReview.visible, true); assert.equal(f.proposalReview.busy, false);
        assert.deepEqual(f.proposalReview.receipt, h.receipt); assert.notEqual(f.proposalReview.receipt, h.receipt);
        assert.equal(dialog(f, "adaptive-proposal-dialog")?.open, true); exactRequests(h, 2);
      } else if (change === "close") {
        exactReadOnly(h); assert.equal(f.proposalReview.visible, false); assert.equal(h.notifications.size, 1);
        assert.equal(f.proposalReview.receipt, h.receipt, "a closed late read cannot replace even an equivalent receipt");
      } else {
        assert.equal(h.notifications.size, 0); assert.equal(f.proposalReview.ports.scope(), null);
        assert.equal(f.proposalReview.receipt, null); assert.equal(f.proposalReview.visible, false);
        assert.equal(f.proposalReview.busy, false); assert.equal(f.proposalReview.canPreview, false); assert.equal(f.proposalReview.canApply, false);
      }
      assert.equal(JSON.stringify(f.state.events), h.events); assert.equal(f.state.batches.length, 0);
      assert.equal(externalCalls, 0); exactRequests(h, change === "close-resume" ? 2 : 1);
    } finally { held?.restore(); await turn(); close(h); }
  });
}

// Additive counterexamples only. The passing R1 cases above remain byte-exact.
async function receiptCounterContext(h, context) {
  const { f } = h;
  if (context === "opened-item") {
    await openOriginalItem(h); f.state.replies.push(h.wireReceipt); resumeFromView(f); await settle(f);
    exactReadOnly(h); exactRequests(h, 1);
  } else unchanged(h);
  assert.equal(f.proposalReview.visible, true); assert.equal(dialog(f, "adaptive-proposal-dialog")?.open, true);
  assert.deepEqual(f.proposalReview.receipt, h.receipt);
  return { selection: [...f.state.selected], planning: f.store.canvasPlanningDocumentId(), route: f.store.route.get(),
    authorization: f.state.authorization, source: f.store.captureSourceOwnership(), requests: f.state.requests.length,
    presentation: f.proposalReview.presentationId, handle: structuredClone(f.proposalReview.handle) };
}
function unchangedCounterContext(h, before) {
  const { f } = h;
  assert.deepEqual(f.state.selected, before.selection); assert.equal(f.store.canvasPlanningDocumentId(), before.planning);
  assert.equal(f.store.route.get(), before.route); assert.equal(f.state.authorization, before.authorization);
  assert.equal(f.store.sourceOwnershipActive(before.source), true);
  assert.equal(JSON.stringify(f.state.events), h.events); assert.equal(f.state.batches.length, 0);
  assert.deepEqual(f.proposalReview.handle, before.handle); assert.equal(f.proposalReview.executionId, EXECUTION);
  assert.equal(f.proposalReview.bindingHash, BINDING); assert.equal(f.proposalReview.canPreview, false);
  assert.equal(f.proposalReview.canApply, false); assert.equal(externalCalls, 0);
}
function receiptListResponse(h, discovery) {
  // Existing canonical receipt normalized by the actual controller from the
  // model-shaped fixture's original wire response; never a new authority proof.
  // Envelope matches worker/adaptive-proposal-application-api.ts receipt page.
  const common = { status: "receipts", projectId: "p", documentId: "document-0", canvasId: "board-a",
    receipts: [h.receipt], nextCursor: null, pageSize: 20, readOnly: true, canApply: false,
    noPayment: true, noAutomaticRetry: true };
  return discovery === "proposal" ? { ...common, executionId: EXECUTION, bindingHash: BINDING }
    : { ...common, discovery: "destination", executionId: null, bindingHash: null };
}
function counterObservation(f) {
  const check = f.native("button", node => node.handlers.click?.toString().includes("controller.resume()"));
  return { visible: f.proposalReview.visible, busy: f.proposalReview.busy, phase: f.proposalReview.phase,
    notice: f.proposalReview.notice, dialogOpen: Boolean(dialog(f, "adaptive-proposal-dialog")?.open),
    checkConnected: Boolean(check?.isConnected), checkDisabled: check?.disabled ?? null,
    receipt: f.proposalReview.receipt, receipts: f.proposalReview.receipts,
    handle: f.proposalReview.handle, scopeKey: f.proposalReview.ports.scope()?.key ?? null };
}

for (const locale of ["en", "ja"]) for (const context of ["original-document", "opened-item"]) for (const discovery of ["proposal", "destination"]) {
  test(locale + " receipt read counterexample list " + discovery + " remains usable in " + context, async t => {
    const h = await receiptFixture(locale), { f } = h;
    try {
      const before = await receiptCounterContext(h, context), reply = receiptListResponse(h, discovery);
      f.state.replies.push(reply);
      await f.click("button", node => node.handlers.click?.toString().includes(discovery === "proposal"
        ? "controller.discoverReceipts()" : "controller.discoverDestinationReceipts()")); await settle(f);
      const request = { url: "/api/context/adaptive/apply", body: { action: discovery === "proposal" ? "resume" : "receipts",
        projectId: "p", documentId: "document-0", canvasId: "board-a",
        ...(discovery === "proposal" ? { executionId: EXECUTION, bindingHash: BINDING } : {}) } };
      t.diagnostic("P8_RECEIPT_READ_LIST_COUNTEREXAMPLE " + JSON.stringify({ locale, context, discovery,
        originalReceipt: h.receipt, reply, requests: f.state.requests.slice(before.requests), after: counterObservation(f),
        qualification: "actual full Canvas/controller/native controls; existing finite Store and model-shaped read response, not Worker authority" }));
      assert.deepEqual(f.state.requests.slice(before.requests), [request]);
      unchangedCounterContext(h, before);
      assert.equal(f.proposalReview.visible, true, "a healthy explicit receipt list must not silently retire its current read destination");
      assert.equal(dialog(f, "adaptive-proposal-dialog")?.open, true); assert.equal(f.proposalReview.phase, "receipts");
      assert.equal(f.proposalReview.presentationId, before.presentation);
      assert.deepEqual(f.proposalReview.receipts, [h.receipt]); assert.equal(f.proposalReview.receiptDiscovery, discovery);
      assert.equal(f.proposalReview.ports.scope()?.key, h.scope.key);
      if (context === "opened-item") assert.equal(f.proposalReview.ports.scope()?.canAuthor, false);
      const choose = f.native("button", node => node.handlers.click?.toString().includes("controller.chooseReceipt(item)"));
      assert.ok(choose?.isConnected && !choose.disabled, "the actual returned original row remains explicitly readable");
      f.state.replies.push(h.wireReceipt); choose.focus();
      await choose.handlers.click.call(f.host, event(choose)); await settle(f);
      assert.deepEqual(f.state.requests.slice(before.requests), [request, { url: "/api/context/adaptive/apply", body: {
        action: "retrieve", projectId: "p", documentId: "document-0", canvasId: "board-a", ...before.handle } }]);
      assert.equal(f.proposalReview.visible, true); assert.equal(f.proposalReview.phase, "applied");
      assert.deepEqual(f.proposalReview.receipt, h.receipt); unchangedCounterContext(h, before);
    } finally { close(h); }
  });
}

for (const locale of ["en", "ja"]) for (const context of ["original-document", "opened-item"]) for (const failure of ["throw", "http-503"]) {
  test(locale + " receipt read counterexample " + failure + " retains an explicit Check in " + context, async t => {
    const h = await receiptFixture(locale), { f } = h;
    const originalTransport = f.store.guardedFetch; let faults = 0;
    try {
      const before = await receiptCounterContext(h, context);
      f.store.guardedFetch = async (...args) => {
        // Keep the existing finite transport's request log and queued response.
        // Only this first response is changed into the declared transient fault.
        const response = await originalTransport(...args);
        if (faults++) return response;
        if (failure === "throw") throw new Error("finite transient receipt transport failure");
        return { ...response, status: 503 };
      };
      f.state.replies.push({ ok: false, body: { error: "temporary_receipt_read_unavailable" } });
      await f.click("button", node => node.handlers.click?.toString().includes("controller.resume()")); await settle(f);
      const request = { url: "/api/context/adaptive/apply", body: { action: "retrieve",
        projectId: "p", documentId: "document-0", canvasId: "board-a", ...before.handle } };
      t.diagnostic("P8_RECEIPT_READ_FAILURE_COUNTEREXAMPLE " + JSON.stringify({ locale, context, failure, faults,
        requests: f.state.requests.slice(before.requests), after: counterObservation(f),
        qualification: "actual full Canvas/controller/native controls; one finite transport throw or status503, no authorization or receipt substitution" }));
      assert.equal(faults, 1); assert.deepEqual(f.state.requests.slice(before.requests), [request]);
      unchangedCounterContext(h, before);
      assert.equal(f.proposalReview.visible, true, "a transient exact read failure must leave a visible explicit Check, not lose its read destination");
      assert.equal(dialog(f, "adaptive-proposal-dialog")?.open, true); assert.equal(f.proposalReview.busy, false);
      assert.equal(f.proposalReview.presentationId, before.presentation);
      assert.equal(f.proposalReview.notice, "adaptive.changes.checkRequired");
      const check = f.native("button", node => node.handlers.click?.toString().includes("controller.resume()"));
      assert.ok(check?.isConnected && !check.disabled, "the existing exact-handle Check is available without a planning-selector detour");
      assert.equal(f.proposalReview.ports.scope()?.key, h.scope.key);
      if (context === "opened-item") assert.equal(f.proposalReview.ports.scope()?.canAuthor, false);
      f.state.replies.push(h.wireReceipt); check.focus();
      await check.handlers.click.call(f.host, event(check)); await settle(f);
      assert.equal(faults, 2); assert.deepEqual(f.state.requests.slice(before.requests), [request, request]);
      assert.equal(f.proposalReview.visible, true); assert.equal(f.proposalReview.busy, false);
      assert.equal(f.proposalReview.phase, "applied"); assert.deepEqual(f.proposalReview.receipt, h.receipt);
      unchangedCounterContext(h, before);
    } finally { f.store.guardedFetch = originalTransport; close(h); }
  });
}

async function lifecycleFixture(locale, discovery = "destination") {
  const h = await receiptFixture(locale), { f } = h;
  const executionId = discovery === "proposal" ? EXECUTION : "second-canonical-execution";
  const bindingHash = discovery === "proposal" ? BINDING : "d".repeat(64);
  const ids = ["second-canonical-block", "second-canonical-item"];
  const plan = buildAdaptiveProposalApplication({ projection: f.store.projection.get(), documentId: "document-0", canvasId: "board-a",
    structure: { interpretation: "Previously saved second decision", active_decision: {
      type: "subject", label: "Second saved result", prompt: "Second original decision", why: "A separate existing result" },
      suggested_blocks: [], hidden_until_later: [] }, executionId, bindingHash,
    selections: [{ proposalId: "/active_decision", placement: { x: 500, y: 100, w: 300, h: 210 } }], createId: () => ids.shift() });
  // Explicit finite model-shaped retained setup, before the handoff. This is
  // not a provider/private-original/Worker insertion or authority claim.
  plan.events.forEach(input => f.append(input)); f.draw(); h.events = JSON.stringify(f.state.events);
  h.button = f.native("button", node => node.handlers.click?.toString().includes('options.open("canvas-item", id)'));
  assert.ok(h.button?.isConnected && !h.button.disabled); h.listeners = listenerCounts(f);
  const wire = { status: "applied", idempotent: true, previewId: "second-canonical-preview", approvalHash: "e".repeat(64),
    executionId, bindingHash, selectionKey: "f".repeat(64), blockIds: plan.blockIds, canvasItemIds: plan.canvasItemIds,
    relationCount: 0, createdAt: "2026-08-27T12:01:00Z", dismissed: false };
  const { status, idempotent, ...row } = wire;
  assert.deepEqual(plan.events.map(input => input.type), ["BlockCreated", "CanvasItemPlaced"]);
  assert.deepEqual(row.blockIds, ["second-canonical-block"]); assert.deepEqual(row.canvasItemIds, ["second-canonical-item"]);
  let privateReads = 0;
  f.store.loadAdaptiveProposalOriginal = async () => { privateReads++; throw new Error("No private original is authorized by a receipt read"); };
  const before = await receiptCounterContext(h, "opened-item");
  return { h, f, before, wire, row, discovery, privateReads: () => privateReads };
}
function lifecycleInvariant(x) {
  const { h, f, before } = x;
  assert.equal(JSON.stringify(f.state.events), h.events); assert.equal(f.state.batches.length, 0);
  assert.deepEqual(f.state.selected, before.selection); assert.equal(f.store.canvasPlanningDocumentId(), before.planning);
  assert.equal(f.store.route.get(), before.route); assert.equal(f.state.authorization, before.authorization);
  assert.equal(f.store.sourceOwnershipActive(before.source), true);
  assert.equal(f.proposalReview.canPreview, false); assert.equal(f.proposalReview.canApply, false);
  assert.equal(x.privateReads(), 0); assert.equal(externalCalls, 0);
}
function lifecyclePage(x, rows = [x.h.receipt, x.row], cursor = null) {
  return { ...receiptListResponse(x.h, x.discovery), receipts: rows, nextCursor: cursor };
}
function lifecycleRead(row) {
  return { url: "/api/context/adaptive/apply", body: { action: "retrieve", projectId: "p", documentId: "document-0", canvasId: "board-a",
    previewId: row.previewId, approvalHash: row.approvalHash } };
}
function lifecycleList(x, cursor) {
  return { url: "/api/context/adaptive/apply", body: { action: x.discovery === "proposal" ? "resume" : "receipts",
    projectId: "p", documentId: "document-0", canvasId: "board-a",
    ...(x.discovery === "proposal" ? { executionId: EXECUTION, bindingHash: BINDING } : {}), ...(cursor ? { cursor } : {}) } };
}
async function lifecycleFind(x, reply = lifecyclePage(x)) {
  x.f.state.replies.push(reply);
  await x.f.click("button", node => node.handlers.click?.toString().includes(x.discovery === "proposal"
    ? "controller.discoverReceipts()" : "controller.discoverDestinationReceipts()")); await settle(x.f);
}
function lifecycleChoice(x, index) {
  const buttons = x.f.renderer.ownNodes(x.f.host, "button").filter(node => node.handlers.click?.toString().includes("controller.chooseReceipt(item)"));
  assert.equal(buttons.length, x.f.proposalReview.receipts.length);
  const button = buttons[index]; assert.ok(button?.isConnected && !button.disabled); return button;
}
function lifecycleVisible(x, row = x.row) {
  const { f } = x;
  assert.equal(f.proposalReview.visible, true); assert.equal(dialog(f, "adaptive-proposal-dialog")?.open, true);
  assert.equal(f.proposalReview.phase, "applied"); assert.deepEqual(f.proposalReview.receipt, row);
  assert.deepEqual(f.proposalReview.handle, { previewId: row.previewId, approvalHash: row.approvalHash });
  assert.equal(f.proposalReview.executionId, row.executionId); assert.equal(f.proposalReview.bindingHash, row.bindingHash);
  assert.equal(f.proposalReview.ports.scope()?.key, x.h.scope.key); assert.equal(f.proposalReview.ports.scope()?.canAuthor, false);
  lifecycleInvariant(x);
}

for (const locale of ["en", "ja"]) for (const discovery of ["proposal", "destination"]) {
  test(locale + " receipt lifecycle pagination explicitly selects a different " + discovery + " receipt", async () => {
    const x = await lifecycleFixture(locale, discovery), { f } = x;
    try {
      const start = f.state.requests.length;
      await lifecycleFind(x, lifecyclePage(x, [x.h.receipt, x.row], "next-exact-page"));
      assert.equal(f.proposalReview.phase, "receipts"); assert.equal(f.proposalReview.visible, true);
      assert.deepEqual(f.state.requests.slice(start), [lifecycleList(x)]);
      assert.deepEqual(f.proposalReview.handle, x.before.handle, "a returned second row is never autochosen");
      const oldRow = f.proposalReview.receipts[1], oldChoice = lifecycleChoice(x, 1);
      await f.proposalReview.chooseReceipt({ ...oldRow, previewId: "not-in-returned-page" });
      assert.deepEqual(f.state.requests.slice(start), [lifecycleList(x)], "an unreturned identity cannot begin a read");
      f.state.replies.push(lifecyclePage(x, [x.row]));
      await f.click("button", node => node.handlers.click?.toString().includes("controller.nextCursor")); await settle(f);
      assert.deepEqual(f.state.requests.slice(start), [lifecycleList(x), lifecycleList(x, "next-exact-page")]);
      assert.notEqual(f.proposalReview.receipts[0], oldRow, "the second page owns a fresh validated row object");
      assert.deepEqual(f.proposalReview.handle, x.before.handle); assert.equal(f.proposalReview.phase, "receipts");
      await oldChoice.handlers.click.call(f.host, event(oldChoice)); await settle(f);
      assert.equal(f.state.requests.length, start + 2, "a callback from the previous page cannot choose even an equal-ID current row");
      const choose = lifecycleChoice(x, 0); f.state.replies.push(x.wire);
      await choose.handlers.click.call(f.host, event(choose)); await settle(f);
      assert.deepEqual(f.state.requests.slice(start), [lifecycleList(x), lifecycleList(x, "next-exact-page"), lifecycleRead(x.row)]);
      lifecycleVisible(x);
      await closeReview(f); f.state.replies.push(x.wire); resumeFromView(f); await settle(f);
      lifecycleVisible(x); assert.deepEqual(f.state.requests.slice(start).at(-1), lifecycleRead(x.row));
      assert.deepEqual(f.state.selected, [ITEM], "choosing another receipt does not silently navigate to or select its result");
    } finally { close(x.h); }
  });
}

for (const locale of ["en", "ja"]) for (const fault of ["throw", "http-503", "refresh"]) {
  test(locale + " receipt lifecycle second-row " + fault + " keeps only its explicit read", async () => {
    const x = await lifecycleFixture(locale), { f } = x, original = f.store.guardedFetch, refresh = f.store.refreshEvents, gate = deferred();
    let calls = 0, refreshes = 0;
    try {
      await lifecycleFind(x); const start = f.state.requests.length, choose = lifecycleChoice(x, 1);
      f.store.guardedFetch = async (...args) => {
        const response = await original(...args);
        if (calls++) return response;
        await gate.promise;
        if (fault === "throw") throw new Error("finite second-row transport failure");
        return fault === "http-503" ? { ...response, status: 503 } : response;
      };
      if (fault === "refresh") f.store.refreshEvents = async () => { refreshes++; throw new Error("finite refresh failure after a verified receipt"); };
      f.state.replies.push(fault === "refresh" ? x.wire : { ok: false, body: { error: "temporary_receipt_read_unavailable" } });
      const pending = choose.handlers.click.call(f.host, event(choose)); await settle(f);
      assert.equal(f.proposalReview.busy, true); assert.equal(f.proposalReview.receipt, null, "the superseded result is not presented as the newly chosen receipt");
      assert.deepEqual(f.proposalReview.handle, { previewId: x.row.previewId, approvalHash: x.row.approvalHash });
      lifecycleInvariant(x); gate.resolve(); await pending; await settle(f);
      assert.deepEqual(f.state.requests.slice(start), [lifecycleRead(x.row)]);
      assert.equal(f.proposalReview.visible, true); assert.equal(f.proposalReview.busy, false);
      if (fault === "refresh") {
        lifecycleVisible(x); assert.equal(refreshes, 1); assert.equal(f.proposalReview.refreshFailed, true);
        assert.equal(f.proposalReview.notice, "adaptive.changes.refreshFailed");
      } else {
        assert.equal(f.proposalReview.receipt, null); assert.equal(f.proposalReview.notice, "adaptive.changes.checkRequired");
        assert.equal(f.proposalReview.ports.scope()?.key, x.h.scope.key); lifecycleInvariant(x);
      }
      f.store.refreshEvents = refresh; f.state.replies.push(x.wire);
      await f.click("button", node => node.handlers.click?.toString().includes("controller.resume()")); await settle(f);
      lifecycleVisible(x); assert.equal(f.proposalReview.refreshFailed, false);
      assert.deepEqual(f.state.requests.slice(start), [lifecycleRead(x.row), lifecycleRead(x.row)]);
    } finally { gate.resolve(); f.store.guardedFetch = original; f.store.refreshEvents = refresh; close(x.h); }
  });
}

const lifecycleInvalid = ["wrong-list-destination", "duplicate-list", "invalid-cursor", "malformed-json", "wrong-receipt",
  "retention-503", "authorization-503", "malformed-503", "denied-403", "authority-reject"];
for (const locale of ["en", "ja"]) for (const invalid of lifecycleInvalid) {
  test(locale + " receipt lifecycle retires invalid " + invalid, async () => {
    const x = await lifecycleFixture(locale), { f } = x, original = f.store.guardedFetch;
    try {
      const list = ["wrong-list-destination", "duplicate-list", "invalid-cursor", "malformed-json"].includes(invalid);
      if (!list) await lifecycleFind(x);
      const start = f.state.requests.length;
      let reply = list ? lifecyclePage(x) : x.wire;
      if (invalid === "wrong-list-destination") reply = { ...reply, documentId: "document-1" };
      if (invalid === "duplicate-list") reply = lifecyclePage(x, [x.row, x.row]);
      if (invalid === "invalid-cursor") reply = { ...reply, nextCursor: 5 };
      if (invalid === "wrong-receipt") reply = { ...x.wire, selectionKey: "a".repeat(64) };
      if (invalid === "retention-503") reply = { ok: false, body: { error: "temporary_receipt_read_unavailable", retentionUnavailable: true } };
      if (invalid === "authorization-503") reply = { ok: false, body: { error: "context_authorization_changed" } };
      if (invalid === "malformed-503") reply = { ok: false, body: [] };
      if (invalid === "denied-403") reply = { ok: false, body: { error: "context_authorization_changed" } };
      f.store.guardedFetch = async (...args) => {
        const response = await original(...args);
        if (invalid === "malformed-json") return { ...response, json: async () => { throw new SyntaxError("finite invalid receipt page JSON"); } };
        if (invalid === "authority-reject") {
          // Existing finite authority port models the Store's post-fetch throw;
          // separate unchanged full-Store tests prove its real source epoch.
          f.state.authorization = "different-authority"; f.store.notify(); f.state.authorization = x.before.authorization; f.store.notify();
          throw new Error("finite post-fetch authorization refusal");
        }
        return invalid.endsWith("503") ? { ...response, status: 503 } : invalid === "denied-403" ? { ...response, status: 403 } : response;
      };
      if (list) await lifecycleFind(x, reply);
      else {
        const choose = lifecycleChoice(x, 1); f.state.replies.push(reply);
        await choose.handlers.click.call(f.host, event(choose)); await settle(f);
      }
      assert.equal(f.state.requests.length, start + 1); assert.equal(f.proposalReview.visible, false);
      assert.equal(f.proposalReview.receipt, null); assert.deepEqual(f.proposalReview.receipts, []);
      assert.equal(f.proposalReview.busy, false); assert.equal(f.proposalReview.ports.scope(), null);
      assert.equal(x.h.notifications.size, 0); lifecycleInvariant(x);
      const before = f.state.requests.length; resumeFromView(f); await settle(f);
      assert.equal(f.state.requests.length, before, "an invalidated lease cannot revive by a later same-value Resume");
      assert.equal(f.proposalReview.visible, false); assert.equal(x.privateReads(), 0);
    } finally { f.store.guardedFetch = original; close(x.h); }
  });
}

for (const locale of ["en", "ja"]) for (const operation of ["page", "choose"]) for (const change of ["close-resume", "route-ABA", "selection-ABA", "source-ABA"]) {
  test(locale + " receipt lifecycle pending " + operation + " yields to " + change, async () => {
    const x = await lifecycleFixture(locale), { f } = x;
    let held;
    try {
      if (operation === "choose") await lifecycleFind(x);
      held = holdExactReads(f); const start = f.state.requests.length;
      let pending;
      if (operation === "page") {
        f.state.replies.push(lifecyclePage(x));
        const button = f.native("button", node => node.handlers.click?.toString().includes("controller.discoverDestinationReceipts()"));
        assert.ok(button?.isConnected); pending = button.handlers.click.call(f.host, event(button));
      } else {
        const button = lifecycleChoice(x, 1); f.state.replies.push(x.wire); pending = button.handlers.click.call(f.host, event(button));
      }
      await settle(f); assert.equal(held.reads.length, 1); assert.equal(f.proposalReview.busy, true);
      const target = operation === "choose" ? x.row : x.h.receipt;
      if (change === "close-resume") {
        await closeReview(f);
        f.state.replies.push(operation === "choose" ? x.wire : x.h.wireReceipt); resumeFromView(f); await settle(f);
        assert.equal(held.reads.length, 2); assert.equal(f.proposalReview.busy, true);
      } else if (change === "route-ABA") {
        f.store.setRoute("/canvas/board-a/board-a?view=list"); f.store.setRoute(x.before.route); f.draw();
      } else if (change === "selection-ABA") {
        await f.select(0, "document");
        const item = f.host.querySelector('[data-canvas-item-id="' + ITEM + '"]'); assert.ok(item?.isConnected);
        item.handlers.click.call(f.host, event(item)); f.draw();
      } else {
        const source = f.store.adaptiveProposalSource;
        f.store.adaptiveProposalSource = (_document, _canvas, id) => id === target.executionId ? {
          executionId: target.executionId, bindingHash: target.bindingHash, structure: null, readable: false, withdrawalRevision: 1 } : null;
        f.store.notify(); f.store.adaptiveProposalSource = source; f.store.notify(); f.draw();
      }
      const current = { presentation: f.proposalReview.presentationId, receipt: f.proposalReview.receipt,
        handle: structuredClone(f.proposalReview.handle), busy: f.proposalReview.busy, visible: f.proposalReview.visible };
      held.reads[0].resolve(); await pending; await settle(f);
      assert.equal(f.proposalReview.presentationId, current.presentation); assert.equal(f.proposalReview.receipt, current.receipt);
      assert.deepEqual(f.proposalReview.handle, current.handle); assert.equal(f.proposalReview.busy, current.busy);
      assert.equal(f.proposalReview.visible, current.visible);
      if (change === "close-resume") {
        assert.equal(f.proposalReview.busy, true, "late A cannot clear B's pending state or adopt its old page");
        held.reads[1].resolve(); await settle(f); lifecycleVisible(x, target);
        assert.equal(f.state.requests.length, start + 2); assert.deepEqual(f.state.requests.at(-1), lifecycleRead(target));
      } else {
        assert.equal(f.proposalReview.visible, false); assert.equal(f.proposalReview.receipt, null);
        assert.equal(f.proposalReview.ports.scope(), null); assert.equal(x.h.notifications.size, 0);
        assert.equal(f.state.requests.length, start + 1); lifecycleInvariant(x);
      }
    } finally { held?.restore(); await turn(); close(x.h); }
  });
}

for (const locale of ["en", "ja"]) for (const mismatch of ["result-ids", "canonical-reuse"]) {
  test(locale + " receipt lifecycle publication veto rejects explicit-row " + mismatch + " before changed or refresh", async () => {
    const x = await lifecycleFixture(locale), { f } = x;
    const changed = f.proposalReview.ports.changed, refresh = f.store.refreshEvents;
    const published = []; let refreshes = 0;
    try {
      await lifecycleFind(x); const start = f.state.requests.length, choose = lifecycleChoice(x, 1);
      const reply = mismatch === "result-ids"
        ? { ...x.wire, blockIds: ["unlisted-result-block"], canvasItemIds: ["unlisted-result-item"] }
        : { ...x.wire, previewId: "unlisted-reused-preview", approvalHash: "9".repeat(64),
          requestedPreviewId: x.wire.previewId, reusedPreviewId: "unlisted-reused-preview" };
      assert.equal(reply.executionId, x.row.executionId); assert.equal(reply.bindingHash, x.row.bindingHash);
      assert.equal(reply.selectionKey, x.row.selectionKey, "exercise the post-decoder exact-row veto, not the earlier selection-key rejection");
      f.proposalReview.ports.changed = () => {
        // Observe before delegating the existing changed port. No production
        // method is replaced and the real renderer still receives every change.
        if (f.proposalReview.receipt) published.push(structuredClone(f.proposalReview.receipt));
        return changed();
      };
      f.store.refreshEvents = async () => { refreshes++; return refresh(); };
      f.state.replies.push(reply); await choose.handlers.click.call(f.host, event(choose)); await settle(f);
      assert.deepEqual(f.state.requests.slice(start), [lifecycleRead(x.row)]);
      assert.deepEqual(published, [], "the lease veto precedes every changed/publication callback");
      assert.equal(refreshes, 0, "a rejected selected-row identity cannot start post-receipt refresh");
      assert.equal(f.proposalReview.receipt, null); assert.equal(f.proposalReview.visible, false);
      assert.equal(f.proposalReview.ports.scope(), null); assert.equal(x.h.notifications.size, 0);
      assert.deepEqual(f.proposalReview.handle, { previewId: x.row.previewId, approvalHash: x.row.approvalHash });
      lifecycleInvariant(x);
    } finally { f.proposalReview.ports.changed = changed; f.store.refreshEvents = refresh; close(x.h); }
  });
}
