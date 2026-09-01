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
const INVITE={email:"finite-policy-cross-surface@example.invalid",role:"member"};
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
function noPolicyWrites(f,service,expectedWrites=0){
  assert.equal(service.writes.length,expectedWrites);
  for(const request of service.requests.filter(request=>method(request)!=="GET")){
    assert.equal(method(request),"POST");assert.equal(request.url,endpoint("A","/members"));assert.deepEqual(request.body,INVITE);
  }
  assert.equal(service.requests.filter(request=>method(request)!=="GET").length,expectedWrites);
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

test("Policy security native select survives a current View access read and explicit Discard",options,async t=>{
  const {f,service,native,snapshot}=await setup(t),form=native.current("security").port,fields=nodes(native.record("security"));
  const defaults=native.values("security"),before=snapshot(),route=f.store.route.get(),scope=f.store.captureAuthorizationScope();
  assert.equal(defaults.authenticationSource,"any");
  const later={...defaults,allowedDomains:"unsent-policy.example.invalid",authenticationSource:"local-development",maxSessionMinutes:"75"};
  native.fill(later,"security");f.draw();const requests=service.requests.length;
  f.click(f.find("button",node=>node.text===f.i18n.t("workspace.admin.viewAccess","View access")));await f.flush(24);
  assert.deepEqual(service.requests.slice(requests).map(request=>({method:method(request),url:request.url})),
    [{method:"GET",url:endpoint("A","/projects/"+FIRST+"/members")}]);
  sameNative(native,"security",form,fields);assert.deepEqual(native.values("security"),later);
  assert.equal(native.record("security").fields.get("authenticationSource").node.value,"local-development");
  assert.equal(f.store.route.get(),route);assert.equal(f.store.authorizationScopeActive(scope),true);
  const afterRead=service.requests.length;native.discard("security");await f.flush(12);
  sameNative(native,"security",form,fields);assert.deepEqual(native.values("security"),defaults);
  assert.equal(native.record("security").fields.get("authenticationSource").node.value,"any");
  assert.equal(form.getAttribute("data-workspace-policy-dirty"),"false");assert.equal(service.requests.length,afterRead);
  assert.deepEqual(snapshot(),before);noPolicyWrites(f,service);
});

function currentInvitation(f){
  const forms=f.nodes("form").filter(node=>node.owner===f.host&&String(node.handlers.submit).includes("#submitInvite"));
  assert.equal(forms.length,1);const form=forms[0];
  const fields=f.tree().nodes.filter(node=>within(node,form)&&["input","select"].includes(node.tag)&&node.attributes.name);
  assert.deepEqual(fields.map(field=>field.attributes.name),["email","role"]);
  for(const field of fields){
    assert.ok(field.port.isConnected&&!field.hiddenBy);
    assert.equal(Object.hasOwn(field.attributes,"disabled")||field.properties.disabled===true||field.port.disabled===true,false);
    assert.equal(Object.hasOwn(field.attributes,"readonly"),false);
    for(let parent=field;parent;parent=parent.parent)assert.equal(Object.hasOwn(parent.attributes??{},"inert")
      ||parent.tag==="fieldset"&&Object.hasOwn(parent.attributes,"disabled"),false);
    const value=INVITE[field.attributes.name];
    if(field.tag==="select")assert.ok(f.tree().nodes.some(option=>option.tag==="option"&&within(option,field)
      &&option.attributes.value===value&&!Object.hasOwn(option.attributes,"disabled")));
    else assert.match(value,/^[^\s@]+@[^\s@]+\.[^\s@]+$/u);
    field.port.value=value;
    field.handlers[field.tag==="select"?"change":"input"]?.call(field.owner,{target:field.port,currentTarget:field.port,preventDefault(){},stopPropagation(){}});
  }
  const buttons=f.nodes("button").filter(node=>within(node,form)&&node.attributes.type==="submit");
  assert.equal(buttons.length,1);assert.equal(Object.hasOwn(buttons[0].attributes,"disabled"),false);return form;
}

async function automationFixture(t,transition){
  const state=await setup(t),{f,service,native}=state,reply=service.reply;
  const inviteUrl=endpoint("A","/members"),invitations=[],reads=[];
  let order=[FIRST,SECOND],policies=structuredClone(X);
  const names={[FIRST]:"PRIVATE_A_AUTOMATION_FIRST",[SECOND]:"PRIVATE_A_AUTOMATION_SECOND"};
  const overviewProject=id=>({organizationId:"settings-org-A",projectAccessId:id,projectId:"finite-project-"+id,projectName:names[id],role:"owner"});
  const detailProject=id=>({project_access_id:id,project_id:"finite-project-"+id,project_name:names[id],
    owner_user_id:"settings-principal",status:"active",created_at:"2026-08-30T12:00:00.000Z"});
  service.reply=request=>{
    if(method(request)!=="GET"){
      assert.equal(method(request),"POST");assert.equal(request.url,inviteUrl);assert.deepEqual(request.body,INVITE);
      assert.equal(service.writes.length,0,"One unrelated finite invitation, never a policy or automation command");
      const id="finite-policy-cross-surface-invitation",expiresAt="2026-09-06T12:00:00.000Z";
      const receipt={invitationId:id,membershipId:id,status:"pending",expiresAt,
        invitationUrl:"http://localhost/settings/workspaces/invitations?invitation="+id+"&token=finite-only"};
      invitations.push({invitation_id:id,email_normalized:INVITE.email,role:INVITE.role,status:"pending",expires_at:expiresAt});
      service.writes.push({method:"POST",url:inviteUrl,body:structuredClone(request.body),receipt:structuredClone(receipt)});
      // Explicit finite current report data, not a real concurrent actor,
      // project removal, automation activation or authorizing receipt.
      order=transition==="reorder"?[SECOND,FIRST]:[SECOND];policies=structuredClone(C);
      return{status:201,body:receipt};
    }
    const id=[FIRST,SECOND].find(candidate=>request.url===automationUrl(candidate));
    if(id){assert.ok(order.includes(id));reads.push({id,policy:structuredClone(policies[id])});return{status:200,body:{policy:structuredClone(policies[id])}};}
    const result=reply(request);
    if(result.status===200&&request.url==="/api/workspaces")result.body.projects=order.map(overviewProject);
    if(result.status===200&&[endpoint("A"),endpoint("A","/projects")].includes(request.url))result.body.projects=order.map(detailProject);
    if(result.status===200&&[endpoint("A"),inviteUrl].includes(request.url))result.body.invitations.push(...structuredClone(invitations));
    return result;
  };
  // Establish two authorized finite current rows using ordinary navigation,
  // before either form contains an unsent draft. No private load invocation.
  f.navigate("B");await f.flush(24);f.navigate("A");await f.flush(24);
  assert.deepEqual(records(native).map(record=>record.key),[key(FIRST),key(SECOND)]);
  for(const id of [FIRST,SECOND])assert.deepEqual(native.values(key(id)),raw(X[id]));
  return{...state,inviteUrl,reads};
}

for(const transition of ["reorder","remove-first"])test("Policy keyed automation native drafts survive current read "+transition,options,async t=>{
  const {f,service,native,snapshot,inviteUrl,reads}=await automationFixture(t,transition);
  const before=snapshot(),route=f.store.route.get(),scope=f.store.captureAuthorizationScope(),originals=new Map(),fields=new Map();
  for(const id of [FIRST,SECOND]){
    originals.set(id,native.fill(RAW[id],key(id)).port);fields.set(id,nodes(native.record(key(id))));
  }
  f.draw();for(const id of [FIRST,SECOND])assert.deepEqual(native.values(key(id)),RAW[id]);
  const gate=service.queue(request=>request.url===inviteUrl&&method(request)==="POST","headers"),readStart=reads.length;
  f.submit(currentInvitation(f),INVITE);
  try{
    await gate.seen.promise;f.draw();
    for(const id of [FIRST,SECOND]){sameNative(native,key(id),originals.get(id),fields.get(id));assert.deepEqual(native.values(key(id)),RAW[id]);}
    assert.equal(reads.length,readStart,"No replacement read is fabricated before the actual invitation acknowledgment");
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
  assert.deepEqual(snapshot(),before);assert.deepEqual(service.writes.map(write=>({method:write.method,url:write.url,body:write.body})),
    [{method:"POST",url:inviteUrl,body:INVITE}]);noPolicyWrites(f,service,1);
});
