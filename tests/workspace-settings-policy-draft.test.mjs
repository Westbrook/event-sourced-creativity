import assert from "node:assert/strict";
import test, { after } from "node:test";
import { setup, A, B, C, command, notice, saved, method } from "./helpers/workspace-policy-native-fixture.mjs";
const observations=[];
function observe(value){observations.push(value);console.log("RETENTION_DRAFT_OBSERVATION "+JSON.stringify(value));}
const options={concurrency:false,timeout:30000};
after(()=>console.log("RETENTION_DRAFT_CASES "+JSON.stringify({expected:6,observations:observations.length})));

for(const stage of ["positive-policy-headers","followup-retention-read"])for(const edited of [false,true])
  test("Workspace controlled retention "+stage+" "+(edited?"newer native B":"unchanged A"),options,async t=>{
    const {f,service,native,target,policy,snapshot}=await setup(t),before=snapshot(),route=f.store.route.get(),scope=f.store.captureAuthorizationScope();
    const form=native.fill(A).port,identity=native.record().id;
    const gate=service.queue(request=>request.url===target&&method(request)===(stage==="positive-policy-headers"?"PATCH":"GET"),"headers");
    native.submit();let admittedB=false,pendingEligibility;
    try{
      await gate.seen.promise;f.draw();
      assert.equal(service.writes.length,1);assert.deepEqual(service.writes[0].body,command(A));
      assert.equal(native.current().port,form,"The unchanged current template retains the original form");
      assert.equal(Object.hasOwn(native.button(native.current()).attributes,"disabled"),true,"The current pending save is one-shot");
      pendingEligibility=native.eligibility();
      const count=pendingEligibility.filter(item=>item.enabled).length;
      assert.ok(count===0||count===4,"A declared pending lock must cover the complete form, not silently drop a partial field set");
      if(edited&&count===4){native.fill(B);admittedB=true;}
      const beforeDraw=native.values(),commitsBefore=native.commits.length;
      f.draw();f.draw();
      assert.deepEqual(native.values(),beforeDraw,"Equal committed Lit values must not fabricate draft loss on a plain pending draw");
      assert.equal(native.commits.length,commitsBefore,"Two unchanged pending draws emit no PropertyPart commit");
    }finally{gate.release.resolve();await f.flush(24);}
    assert.equal(service.pending,0);assert.deepEqual(snapshot(),before);
    assert.equal(f.store.route.get(),route);assert.equal(f.store.authorizationScopeActive(scope),true);
    const current=native.current(),actual=native.values(),expected=admittedB?B:A;
    assert.equal(current.port,form);assert.equal(native.record().id,identity);
    assert.ok(native.eligibility().every(item=>item.enabled),"The current fields become editable again after owned completion");
    assert.deepEqual(policy(),{transient_days:31,evidence_days:366,revision_days:120,legal_hold:0,version:2,updated_at:"2026-08-30T12:00:00.000Z"});
    assert.equal(service.writes.length,1);assert.deepEqual(service.writes[0].body,command(A));
    assert.ok(notice(f).includes(saved(f)),"The exact finite positive policy response is still acknowledged");
    f.assertNoExternal();assert.deepEqual(f.transport.external,[]);
    observe({stage,edited,admittedB,pendingEligibility,originalForm:identity,currentForm:native.record().id,
      actual,expected,finitePolicy:policy(),finiteWrites:service.writes.length,propertyCommits:native.commits,
      sameRoutePrincipalSource:true,financialAndPrivateFixtureStateUnchanged:true,
      limits:"Actual whole Settings/Store + installed Lit PropertyPart; finite nonfinancial HTTP, no actual Worker policy, hold, SQL, browser or provider proof"});
    assert.deepEqual(actual,expected,"A's completed save/refresh must not silently replace admitted newer native B");
  });

for(const boundary of ["route","principal"])test("Workspace controlled retention late A respects "+boundary+" retirement",options,async t=>{
  const {f,service,native,target,snapshot}=await setup(t),before=snapshot();
  const old=native.fill(A).port,oldId=native.record().id;
  const gate=service.queue(request=>request.url===target&&method(request)==="PATCH","headers");
  native.submit();let freshId,currentBeforeRelease,currentRoute,currentScope;
  try{
    await gate.seen.promise;f.draw();
    if(boundary==="route"){f.navigate("B");await f.flush(24);}
    else{await f.refreshAuthority({user:{...service.session.user,userId:"another-settings-principal"}});await f.flush(24);}
    assert.equal(old.isConnected,false,"Actual route/principal retirement destroys the former private form");
    const fresh=native.fill(C);freshId=native.record().id;assert.notEqual(fresh.port,old);
    // Principal retirement legitimately clears the old Store source. Compare
    // the late response with the new current owner, not with private old data.
    currentBeforeRelease=snapshot();currentRoute=f.store.route.get();currentScope=f.store.captureAuthorizationScope();
    for(const key of ["budgets","costBudgets","credentials","tokenCount"])assert.deepEqual(currentBeforeRelease[key],before[key]);
  }finally{gate.release.resolve();await f.flush(24);}
  assert.equal(service.pending,0);assert.deepEqual(snapshot(),currentBeforeRelease);
  assert.equal(f.store.route.get(),currentRoute);assert.equal(f.store.authorizationScopeActive(currentScope),true);
  assert.equal(native.record().id,freshId);assert.deepEqual(native.values(),C);
  assert.equal(notice(f).includes(saved(f)),false,"The retired original cannot announce completion in the newer view");
  assert.equal(gate.jsonCalls,0,"Retired response headers cannot expose the old positive body");
  assert.equal(service.writes.length,1);assert.deepEqual(service.writes[0].body,command(A));
  f.assertNoExternal();assert.deepEqual(f.transport.external,[]);
  observe({boundary,oldForm:oldId,currentForm:freshId,oldConnected:old.isConnected,actual:native.values(),
    finiteWrites:1,lateBodyReads:gate.jsonCalls,oldNoticePublished:false,financialFixtureStateUnchanged:true,
    newOwnerSourceUnchangedByLateReply:true,originalSourceRetentionNotRequired:boundary==="principal",
    limits:"Actual current route/principal and native form ports; finite HTTP only, no production authority certificate"});
});
