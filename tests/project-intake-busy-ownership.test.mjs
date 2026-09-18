// Additive actual Projects/Shell/Memory/Store -> routed Worker/RAM SQLite.
// Prepared for root execution only. Native event and navigation ports are
// finite fixtures, not a physical browser or actual multi-user measurement.
import assert from "node:assert/strict";
import test from "node:test";
import {documentIdFromRoute} from "../src/model/routes.ts";
import {createProjectIntakeFixture,assertComplete,sceneDeferred,untilScene} from "./helpers/project-intake-fixture.mjs";

const options={concurrency:false,timeout:45000};
const hasDisabled=node=>Object.hasOwn(node.attributes,"disabled");
const privateView=x=>({events:structuredClone(x.h.store.events.get()),head:x.h.store.head.get(),content:structuredClone(x.h.store.content.get())});
function memoryButton(x,owner){
  const labels=[x.f.i18n.system("Check due policies"),x.f.i18n.system("Checking…")];
  return x.f.find("button",node=>node.owner===owner&&labels.includes(node.text));
}
function assertOneOriginal(canonical,original,row){
  assert.equal(canonical.projects.length,1);assert.equal(canonical.documents.length,1);
  assert.equal(canonical.projects[0].projectId,original.projectId);
  assert.equal(canonical.documents[0].documentId,original.documentId);
  assert.equal(canonical.delta.length,4);assert.equal(canonical.eventClientReceipts,4);
  assert.deepEqual(canonical.delta.map(event=>event.eventId),row.reply.appended.map(event=>event.eventId));
}

for(const locale of ["en","ja"])for(const scenario of ["newer-memory","retired-without-newer","current-success"]){
  test(`intake busy ownership ${locale} ${scenario}`,options,async t=>{
    const x=await createProjectIntakeFixture(t,{locale}),store=x.h.store;
    const source=store.captureSourceOwnership(),beforePrivate=privateView(x);
    assert.equal(store.sourceOwnershipActive(source),true);
    const conditions=store.projection.get().conditions;
    assert.deepEqual(conditions,[{condition_id:"condition-palette-3",condition_ref:"three-new-generations",scope:"project",fired:false}],
      "Retain the actual unfired legacy seed; do not delete or disable it for this test");
    const sets=beforePrivate.events.filter(event=>event.type==="ConditionSet"&&event.payload.condition_id===conditions[0].condition_id);
    assert.equal(sets.length,1,"One actual ConditionSet establishes the Worker's fallback creation sequence");
    const since=Number(conditions[0].created_sequence??sets[0].sequence),threshold=Number(conditions[0].threshold??3);
    const laterGenerations=beforePrivate.events.filter(event=>event.sequence>since&&event.type==="GenerationCompleted"&&event.payload.report_space!=="scout");
    assert.equal(threshold,3);assert.equal(laterGenerations.length,0,"Both seeded generations precede this condition; it is not due");
    assert.ok(laterGenerations.length<threshold,"The real generation-count policy must not append or trigger work");
    const checkedCount=conditions.filter(condition=>!condition.fired).length;assert.equal(checkedCount,1);
    const originalMethods={intake:store.commitProjectIntake,check:store.checkConditions,append:store.appendBatchWithReceipt};
    const releaseAWorker=sceneDeferred(),releaseAAck=sceneDeferred(),releaseBAck=sceneDeferred();
    let aRow=null,bRow=null,bDelivered=false,bFinished=false,pendingB=null,overlap=null;
    x.setBehavior(async(stage,row)=>{
      if(stage==="before-worker"){
        assert.equal(aRow,null,"Only one original intake dispatch");aRow=row;
        // The original client request has dispatched. Only its delivery to
        // the actual Worker is delayed; no success or head is fabricated.
        await releaseAWorker.promise;
      }else if(stage==="after-worker")await releaseAAck.promise;
    });
    const originalIntercept=x.h.intercept;
    x.h.intercept=async request=>{
      if(request.url!=="/api/events"||request.init.method!=="POST"||request.body?.action!=="check_conditions")return originalIntercept(request);
      assert.equal(bRow,null,"The visible Memory control dispatches exactly once");
      const response=await x.worker.request(request.url,request.init);
      bRow={request,status:response.status,reply:await response.clone().json()};
      await releaseBAck.promise;bDelivered=true;
      return response; // SAME genuine Worker response, not a synthetic ACK.
    };
    const pendingA=x.submit();
    try{
      await untilScene(()=>aRow!==null,"Original current form dispatched before route retirement");
      assert.equal(store.busy.get(),"project-intake");assert.equal(aRow.status,null);
      if(scenario!=="current-success"){
        // Existing public navigation port, also used by the current intake
        // late-ACK suite. This represents leaving the route (e.g. history),
        // not clicking a disabled modal Close or a background inert link.
        store.setRoute("/memory");await x.f.settle();
        assert.equal(store.route.get(),"/memory");
        assert.equal(x.f.components().includes(x.owner),false,"The original Projects owner is genuinely disconnected");
        assert.equal(store.sourceOwnershipScopeActive(source),true,"The same authorized personal scope remains current");
        assert.deepEqual(privateView(x),beforePrivate,"Navigation does not fabricate a newer source/head");
      }
      if(scenario==="newer-memory"){
        const owners=x.f.components().filter(component=>component.tag==="forma-memory");
        assert.equal(owners.length,1,"One fully rendered actual Memory owner");
        const owner=owners[0],Memory=x.f.modules.get("src/components/forma-memory.ts")?.FormaMemory;
        assert.equal(typeof Memory,"function");assert.equal(owner instanceof Memory,true);
        const button=memoryButton(x,owner);assert.equal(hasDisabled(button),false,"Current Memory action is enabled during intake A");
        pendingB=x.f.act(button).then(()=>{bFinished=true;});
        await untilScene(()=>bRow!==null,"Newer current Memory action reaches the real Worker independently");
        assert.equal(bRow.status,200);assert.deepEqual(bRow.reply.appended,[]);assert.deepEqual(bRow.reply.rejected,[]);
        assert.equal(bRow.reply.checked,checkedCount,"The real Worker checks the retained not-due seed");assert.equal(bRow.reply.head,beforePrivate.head);
        assert.equal(bRow.request.body.expectedSequence,beforePrivate.head,"No stale-sequence or forged-head prerequisite");
        assert.equal((await x.canonical()).delta.length,0,"The no-due-policy check has written no authored events");
        await x.f.settle();
        assert.equal(store.busy.get(),"check-conditions");assert.equal(hasDisabled(memoryButton(x,owner)),true);
        assert.equal(bDelivered,false);assert.equal(bFinished,false);
      }
      releaseAWorker.resolve();
      await untilScene(()=>aRow.reply!==null,"Original genuine Worker response has completed observation before releasing its ACK");
      const original=assertComplete(aRow),committed=await x.canonical();
      assertOneOriginal(committed,original,aRow);
      releaseAAck.resolve();await pendingA;await x.f.settle();
      assert.equal(x.dispatches.length,1);assertOneOriginal(await x.canonical(),original,aRow);
      assert.equal(store.commitProjectIntake,originalMethods.intake);assert.equal(store.checkConditions,originalMethods.check);
      assert.equal(store.appendBatchWithReceipt,originalMethods.append,"No application or persistence method is replaced");
      if(scenario==="newer-memory"){
        const owner=x.f.components().find(component=>component.tag==="forma-memory"),button=memoryButton(x,owner);
        overlap={busy:store.busy.get(),disabled:hasDisabled(button),text:button.text,
          stillPending:!bDelivered&&!bFinished,route:store.route.get(),sameScope:store.sourceOwnershipScopeActive(source),
          intakeStatus:aRow.status,checkStatus:bRow.status,checkAppended:bRow.reply.appended.length,
          originalEventCount:committed.delta.length,originalReceiptCount:committed.eventClientReceipts};
        assert.equal(overlap.stillPending,true);assert.equal(overlap.route,"/memory");assert.equal(overlap.sameScope,true);
        assert.deepEqual(privateView(x),beforePrivate,"Retired intake cannot publish its private response into the newer route");
        releaseBAck.resolve();await pendingB;await x.f.settle();
        assert.equal(store.busy.get(),"");assert.equal(hasDisabled(memoryButton(x,owner)),false,"B's own completed response may re-enable its control");
        assert.equal(memoryButton(x,owner).text,x.f.i18n.system("Check due policies"));
        assert.deepEqual(privateView(x),beforePrivate,"The genuine empty B response adds no private content or event");
        assertOneOriginal(await x.canonical(),original,aRow);
        t.diagnostic(JSON.stringify({locale,scenario,...overlap}));
        // These desired assertions run after releasing both genuine replies,
        // so a baseline failure cannot strand either in-memory operation.
        assert.equal(overlap.busy,"check-conditions","Retired intake A must not clear newer pending Memory B's busy label");
        assert.equal(overlap.disabled,true,"B must stay visibly Checking and non-repeatable until its own response arrives");
        assert.equal(overlap.text,x.f.i18n.system("Checking…"));
      }else{
        assert.equal(store.busy.get(),"","A still clears its own busy label when no newer owner exists");
        if(scenario==="current-success"){
          assert.equal(documentIdFromRoute(store.route.get()),original.documentId);
          assert.equal(x.visible().modal,false);
          assert.equal(store.events.get().some(event=>event.eventId===aRow.reply.appended[0].eventId),true);
        }else{
          assert.equal(store.route.get(),"/memory");assert.deepEqual(privateView(x),beforePrivate);
        }
        t.diagnostic(JSON.stringify({locale,scenario,busy:store.busy.get(),intakeStatus:aRow.status,checkRequests:bRow?1:0,originalEventCount:committed.delta.length,originalReceiptCount:committed.eventClientReceipts}));
      }
    }finally{
      releaseAWorker.resolve();releaseAAck.resolve();releaseBAck.resolve();
      await Promise.allSettled([pendingA,...(pendingB?[pendingB]:[])]);
      x.h.intercept=originalIntercept;
    }
  });
}
