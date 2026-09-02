// E explicit successors: security and automation use genuine same-task GET-only
// Refresh instead of cross-task View access/invitation. Original ACK coverage
// remains in separate Members pilot-retention cases; no ACK is claimed here.
// Additive only: actual Workspace/Store, actual mounted Cluster and installed
// Lit AttributePart/PropertyPart through the shared native-policy fixture.
// No Worker, physical browser, policy/automation/budget command or provider.
import assert from "node:assert/strict";
import test from "node:test";
import { setup, within, endpoint, method } from "./helpers/workspace-policy-native-fixture.mjs";

const options={concurrency:false,timeout:30000};
const FIRST="settings-access-A",SECOND="settings-access-A-second";
const key=id=>"automation:"+id;
const automationUrl=id=>endpoint("A","/projects/"+id+"/automation");
const X={
  [FIRST]:{enabled:false,notifyContextChanges:false,notifyOutputReady:false,reviewDueHours:48,reminderHours:24,version:1},
  [SECOND]:{enabled:false,notifyContextChanges:false,notifyOutputReady:false,reviewDueHours:72,reminderHours:12,version:1},
};
const C={
  [FIRST]:{...X[FIRST],reviewDueHours:64,reminderHours:8,version:2},
  [SECOND]:{...X[SECOND],reviewDueHours:96,reminderHours:6,version:2},
};
const RAW={
  [FIRST]:{enabled:true,notifyContextChanges:true,notifyOutputReady:false,reviewDueHours:"91",reminderHours:"13"},
  [SECOND]:{enabled:false,notifyContextChanges:false,notifyOutputReady:true,reviewDueHours:"113",reminderHours:"17"},
};
const raw=policy=>({enabled:policy.enabled,notifyContextChanges:policy.notifyContextChanges,
  notifyOutputReady:policy.notifyOutputReady,reviewDueHours:String(policy.reviewDueHours),reminderHours:String(policy.reminderHours)});
const draftHint=(f,native,id)=>{const form=native.current(id);return f.tree().visible("small")
  .filter(node=>within(node,form)).map(node=>node.text).join(" ");};
const records=native=>native.records().filter(record=>record.key.startsWith("automation:"));
const nodes=record=>new Map([...record.fields].map(([name,field])=>[name,field.node]));
function sameNative(native,id,original,fields){
  assert.equal(native.current(id).port,original,"The exact keyed native form remains current");
  for(const [name,node]of fields){assert.equal(native.record(id).fields.get(name).node,node);assert.equal(node.isConnected,true);}
}
function currentRefresh(f){
  return f.find("button",node=>Object.hasOwn(node.attributes,"data-workspace-settings-refresh"));
}
function noPolicyWrites(f,service){
  assert.equal(service.writes.length,0);
  assert.ok(service.requests.every(request=>method(request)==="GET"),"The current-task action only reads");
  f.assertNoExternal();assert.deepEqual(f.transport.external,[]);
}

test("Policy budget native input and Discard keep the exact form without any budget write",options,async t=>{
  const {f,service,native,snapshot}=await setup(t),reply=service.reply,usage=endpoint("A","/usage");
  service.reply=request=>{
    if(method(request)==="GET"&&request.url===usage)return{status:200,body:{
      organization:{organizationId:"settings-org-A",name:"Workspace A",role:"owner"},period:"2026-08",
      policy:{token_limit:100000,microusd_limit:60000000},
      cost:{used_microusd:2400,reserved_microusd:19644000},tokens:{used_tokens:12,reserved_tokens:34},reservations:[],
      outcomes:{activatedCreators:0,approvedDeliverables:0,releasedApprovedDeliverables:0,pendingReviews:0,
        adoptedContextPackages:0,settledCostPerApprovedDeliverableMicrousd:null,averageReviewMinutes:null},
    }};
    return reply(request);
  };
  // Real section navigation happens before this unsent draft is created.
  f.navigate("A","usage");await f.flush(24);
  const form=native.current("budget").port,fields=nodes(native.record("budget")),before=snapshot();
  assert.deepEqual(native.values("budget"),{usdLimit:"60",tokenLimit:"100000"});
  const requests=service.requests.length,later={usdLimit:"57.25",tokenLimit:"98765"};
  native.fill(later,"budget");f.draw();f.draw();
  sameNative(native,"budget",form,fields);assert.deepEqual(native.values("budget"),later);
  assert.ok(draftHint(f,native,"budget").includes(f.i18n.t("workspace.admin.policyDraftKept")));
  native.discard("budget");await f.flush(12);
  sameNative(native,"budget",form,fields);assert.deepEqual(native.values("budget"),{usdLimit:"60",tokenLimit:"100000"});
  assert.equal(form.getAttribute("data-workspace-policy-dirty"),"false");assert.equal(draftHint(f,native,"budget"),"");
  assert.equal(service.requests.length,requests);assert.deepEqual(snapshot(),before);noPolicyWrites(f,service);
});

test("E Policy security native select survives current-task Refresh and explicit Discard",options,async t=>{
  const {f,service,native,snapshot}=await setup(t,{section:"members",nativeKey:"security"}),form=native.current("security").port,fields=nodes(native.record("security"));
  const defaults=native.values("security"),before=snapshot(),route=f.store.route.get(),scope=f.store.captureAuthorizationScope();
  assert.equal(defaults.authenticationSource,"any");
  const later={...defaults,allowedDomains:"unsent-policy.example.invalid",authenticationSource:"local-development",maxSessionMinutes:"75"};
  native.fill(later,"security");f.draw();const requests=service.requests.length;
  f.click(currentRefresh(f));await f.flush(24);
  assert.deepEqual(service.requests.slice(requests).map(request=>({method:method(request),url:request.url})),
    ["/api/workspaces",endpoint("A"),...["members","pilot","retention","context-packages","assurance","security","holds","recovery","security/provisioning-credentials","deletion"].map(suffix=>endpoint("A","/"+suffix))]
      .map(url=>({method:"GET",url})));
  sameNative(native,"security",form,fields);assert.deepEqual(native.values("security"),later);
  assert.equal(native.record("security").fields.get("authenticationSource").node.value,"local-development");
  assert.equal(f.store.route.get(),route);assert.equal(f.store.authorizationScopeActive(scope),true);
  const afterRead=service.requests.length;native.discard("security");await f.flush(12);
  sameNative(native,"security",form,fields);assert.deepEqual(native.values("security"),defaults);
  assert.equal(native.record("security").fields.get("authenticationSource").node.value,"any");
  assert.equal(form.getAttribute("data-workspace-policy-dirty"),"false");assert.equal(service.requests.length,afterRead);
  assert.deepEqual(snapshot(),before);noPolicyWrites(f,service);
});

async function automationFixture(t,transition){
  const state=await setup(t),{f,service,native}=state,reply=service.reply,reads=[];
  let order=[FIRST,SECOND],policies=structuredClone(X);
  const names={[FIRST]:"PRIVATE_A_AUTOMATION_FIRST",[SECOND]:"PRIVATE_A_AUTOMATION_SECOND"};
  const overviewProject=id=>({organizationId:"settings-org-A",projectAccessId:id,projectId:"finite-project-"+id,projectName:names[id],role:"owner"});
  const detailProject=id=>({project_access_id:id,project_id:"finite-project-"+id,project_name:names[id],
    owner_user_id:"settings-principal",status:"active",created_at:"2026-08-30T12:00:00.000Z"});
  service.reply=request=>{
    assert.equal(method(request),"GET","The E successor has no invitation or policy command");
    const id=[FIRST,SECOND].find(candidate=>request.url===automationUrl(candidate));
    if(id){assert.ok(order.includes(id));reads.push({id,policy:structuredClone(policies[id])});return{status:200,body:{policy:structuredClone(policies[id])}};}
    const result=reply(request);
    if(result.status===200&&request.url==="/api/workspaces")result.body.projects=order.map(overviewProject);
    if(result.status===200&&[endpoint("A"),endpoint("A","/projects")].includes(request.url))result.body.projects=order.map(detailProject);
    return result;
  };
  // Enter the real Projects task before either form contains a draft.
  f.navigate("A","projects");await f.flush(24);
  assert.deepEqual(records(native).map(record=>record.key),[key(FIRST),key(SECOND)]);
  for(const id of [FIRST,SECOND])assert.deepEqual(native.values(key(id)),raw(X[id]));
  const advanceReport=()=>{
    // Explicit finite read data, not a command, actual second actor or receipt.
    order=transition==="reorder"?[SECOND,FIRST]:[SECOND];policies=structuredClone(C);
  };
  return{...state,reads,advanceReport};
}

for(const transition of ["reorder","remove-first"])test("Policy keyed automation native drafts survive current read "+transition,options,async t=>{
  const {f,service,native,snapshot,reads,advanceReport}=await automationFixture(t,transition);
  const before=snapshot(),route=f.store.route.get(),scope=f.store.captureAuthorizationScope(),originals=new Map(),fields=new Map();
  for(const id of [FIRST,SECOND]){
    originals.set(id,native.fill(RAW[id],key(id)).port);fields.set(id,nodes(native.record(key(id))));
  }
  f.draw();for(const id of [FIRST,SECOND])assert.deepEqual(native.values(key(id)),RAW[id]);
  const gate=service.queue(request=>request.url==="/api/workspaces"&&method(request)==="GET","body"),readStart=reads.length;
  advanceReport();f.click(currentRefresh(f));
  try{
    await gate.seen.promise;f.draw();
    for(const id of [FIRST,SECOND]){sameNative(native,key(id),originals.get(id),fields.get(id));assert.deepEqual(native.values(key(id)),RAW[id]);}
    assert.equal(reads.length,readStart,"No project-policy replacement publishes before the actual whole-read body");
  }finally{gate.release.resolve();await f.flush(24);}
  const expected=transition==="reorder"?[SECOND,FIRST]:[SECOND];
  assert.equal(service.pending,0);assert.deepEqual(records(native).map(record=>record.key),expected.map(key));
  assert.deepEqual(reads.slice(readStart),expected.map(id=>({id,policy:C[id]})),"Actual current GETs supply the reordered/removed list's exact policies");
  assert.equal(f.store.route.get(),route);assert.equal(f.store.authorizationScopeActive(scope),true);
  for(const id of expected){
    sameNative(native,key(id),originals.get(id),fields.get(id));assert.deepEqual(native.values(key(id)),RAW[id]);
    assert.ok(draftHint(f,native,key(id)).includes(f.i18n.t("workspace.admin.policyDraftChanged")));
  }
  if(transition==="remove-first"){
    assert.equal(originals.get(FIRST).isConnected,false);
    for(const node of fields.get(FIRST).values())assert.equal(node.isConnected,false);
    assert.equal(records(native).some(record=>record.key===key(FIRST)),false,"Removed raw fields are not grafted into the remaining row");
  }
  const requests=service.requests.length;
  if(transition==="reorder"){
    native.discard(key(FIRST));await f.flush(12);
    sameNative(native,key(FIRST),originals.get(FIRST),fields.get(FIRST));assert.deepEqual(native.values(key(FIRST)),raw(C[FIRST]));
    assert.deepEqual(native.values(key(SECOND)),RAW[SECOND],"Discarding the now-second row does not clear the other current draft");
    assert.equal(originals.get(SECOND).getAttribute("data-workspace-policy-dirty"),"true");
  }
  native.discard(key(SECOND));await f.flush(12);
  sameNative(native,key(SECOND),originals.get(SECOND),fields.get(SECOND));assert.deepEqual(native.values(key(SECOND)),raw(C[SECOND]));
  assert.equal(originals.get(SECOND).getAttribute("data-workspace-policy-dirty"),"false");
  assert.equal(draftHint(f,native,key(SECOND)),"");assert.equal(service.requests.length,requests);
  assert.deepEqual(snapshot(),before);assert.deepEqual(service.writes,[]);noPolicyWrites(f,service);
});
