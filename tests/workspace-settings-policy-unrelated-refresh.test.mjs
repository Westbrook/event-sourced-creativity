// E successor: the same unrelated invitation ACK and /retention command-free read
// now share the actual Members active-pilot retention form. Existing finite
// cohort only; no pilot activation. All raw/authority/fiscal assertions remain.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { setup, within, B, C, notice, endpoint, method } from "./helpers/workspace-policy-native-fixture.mjs";
const observations=[];
after(()=>console.log("RETENTION_UNRELATED_CASES "+JSON.stringify({expected:2,observations:observations.length})));

const X={transient_days:30,evidence_days:365,revision_days:90,legal_hold:0,version:1,updated_at:"2026-08-30T12:00:00.000Z"};
const NEWER={...X,transient_days:Number(C.transientDays),evidence_days:Number(C.evidenceDays),revision_days:Number(C.revisionDays),version:2,updated_at:"2026-08-30T12:00:01.000Z"};
const INVITE={email:"finite-retention-refresh@example.invalid",role:"member"};

function currentInvitation(f){
  const forms=f.nodes("form").filter(node=>node.owner===f.host&&String(node.handlers.submit).includes("#submitInvite"));
  assert.equal(forms.length,1,"The existing current overview includes one actual invitation form");
  const form=forms[0],fields=f.tree().nodes.filter(node=>within(node,form)&&["input","select"].includes(node.tag)&&node.attributes.name);
  assert.deepEqual(fields.map(field=>field.attributes.name),["email","role"]);
  for(const field of fields){
    assert.ok(field.port.isConnected&&!field.hiddenBy);
    assert.equal(Object.hasOwn(field.attributes,"disabled")||field.properties.disabled===true||field.port.disabled===true,false);
    assert.equal(Object.hasOwn(field.attributes,"readonly"),false);
    for(let parent=field;parent;parent=parent.parent)assert.equal(Object.hasOwn(parent.attributes??{},"inert")||parent.tag==="fieldset"&&Object.hasOwn(parent.attributes,"disabled"),false);
    const value=INVITE[field.attributes.name];
    if(field.tag==="select")assert.ok(f.tree().nodes.some(option=>option.tag==="option"&&within(option,field)&&option.attributes.value===value&&!Object.hasOwn(option.attributes,"disabled")));
    else assert.match(value,/^[^\s@]+@[^\s@]+\.[^\s@]+$/u);
    field.port.value=value;
    field.handlers[field.tag==="select"?"change":"input"]?.call(field.owner,{target:field.port,currentTarget:field.port,preventDefault(){},stopPropagation(){}});
  }
  const buttons=f.nodes("button").filter(node=>within(node,form)&&node.attributes.type==="submit");
  assert.equal(buttons.length,1);assert.equal(Object.hasOwn(buttons[0].attributes,"disabled"),false);
  return form;
}

for(const changed of [false,true])test("Workspace unsent retention B survives another acknowledged action with "+(changed?"newer finite C":"unchanged finite X"),{concurrency:false,timeout:30000},async t=>{
  const {f,service,native,target,snapshot}=await setup(t,{section:"members",nativeKey:"pilot-retention",activePilot:true}),originalReply=service.reply;
  const inviteUrl=endpoint("A","/members"),reads=[],invitations=[];let policy=structuredClone(X);
  service.reply=request=>{
    if(method(request)!=="GET"){
      assert.equal(method(request),"POST");assert.equal(request.url,inviteUrl,"Only the actual unrelated invitation command is admitted");
      assert.deepEqual(request.body,INVITE);assert.equal(service.writes.length,0);
      const id="finite-unrelated-retention-invitation",expiresAt="2026-09-06T12:00:00.000Z";
      const receipt={invitationId:id,membershipId:id,status:"pending",expiresAt,invitationUrl:"http://localhost/settings/workspaces/invitations?invitation="+id+"&token=finite-only"};
      invitations.push({invitation_id:id,email_normalized:INVITE.email,role:INVITE.role,status:"pending",expires_at:expiresAt});
      service.writes.push({method:"POST",url:inviteUrl,body:structuredClone(request.body),receipt:structuredClone(receipt)});
      // Explicit finite authoritative report state, not a policy mutation or
      // a fabricated claim that a real second actor changed the organization.
      policy=structuredClone(changed?NEWER:X);
      return{status:201,body:receipt};
    }
    const result=originalReply(request);
    if(result.status===200&&request.url===target){result.body.policy=structuredClone(policy);reads.push(structuredClone(policy));}
    if(result.status===200&&[endpoint("A"),inviteUrl].includes(request.url))result.body.invitations.push(...structuredClone(invitations));
    return result;
  };
  const before=snapshot(),route=f.store.route.get(),scope=f.store.captureAuthorizationScope();
  const original=native.fill(B).port,formId=native.record().id;
  assert.deepEqual(native.values(),B);assert.ok(native.eligibility().every(item=>item.enabled));
  const gate=service.queue(request=>request.url===inviteUrl&&method(request)==="POST","headers");
  const invitation=currentInvitation(f);f.submit(invitation,INVITE);
  let pendingEligibility;
  try{
    await gate.seen.promise;f.draw();pendingEligibility=native.eligibility();
    assert.equal(native.current().port,original);assert.deepEqual(native.values(),B,"B was typed before busy and is untouched while the unrelated positive reply is held");
    const beforeDraw=native.commits.length;f.draw();f.draw();
    assert.equal(native.commits.length,beforeDraw,"An unchanged pending binding does not manufacture loss");
    assert.equal(service.writes.length,1);assert.equal(service.requests.filter(request=>request.url===target&&method(request)!=="GET").length,0);
  }finally{gate.release.resolve();await f.flush(24);}
  assert.equal(service.pending,0);assert.deepEqual(snapshot(),before);
  assert.equal(f.store.route.get(),route);assert.equal(f.store.authorizationScopeActive(scope),true);
  assert.equal(native.current().port,original);assert.equal(native.record().id,formId);
  assert.ok(reads.length>=1,"The real acknowledged invitation path performs a fresh retention read");
  assert.deepEqual(reads.at(-1),changed?NEWER:X);
  assert.equal(service.writes.length,1);assert.equal(service.writes[0].url,inviteUrl);assert.deepEqual(service.writes[0].body,INVITE);
  assert.equal(service.requests.filter(request=>request.url===target&&method(request)!=="GET").length,0);
  assert.ok(notice(f).includes(f.i18n.t("workspace.admin.invited","A private, expiring invitation was created.")));
  assert.ok(native.eligibility().every(item=>item.enabled));
  f.assertNoExternal();assert.deepEqual(f.transport.external,[]);
  const observation={changed,originalForm:formId,currentForm:native.record().id,expected:B,actual:native.values(),pendingEligibility,
    finalFinitePolicy:policy,actualFreshPolicyReads:reads.length,invitationWrites:1,policyWrites:0,providerAttempts:0,
    nativeInputDuringBusy:0,propertyCommits:native.commits,sourceAndFinancialFixtureStateUnchanged:true,
    limits:"Whole actual Settings/Store + installed Lit PropertyPart; finite invitation/report state only, not a Worker, second actor, email, policy or physical browser operation"};
  observations.push(observation);console.log("RETENTION_UNRELATED_OBSERVATION "+JSON.stringify(observation));
  assert.deepEqual(native.values(),B,"An unrelated acknowledged refresh must not silently replace the pre-existing unsent retention draft");
});
