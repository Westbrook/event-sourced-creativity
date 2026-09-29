// E task migration: only other-form Discard and pristine unrelated-ACK cases
// use Members pilot-retention. The seven direct cases retain normal Usage.
// invitationRefresh is also reused by four separately named resource boundaries.
import assert from "node:assert/strict";
import test from "node:test";
import { setup, within, A, B, C, notice, saved, endpoint, method } from "./helpers/workspace-policy-native-fixture.mjs";

const X={transient_days:30,evidence_days:365,revision_days:90,legal_hold:0,version:1,updated_at:"2026-08-30T12:00:00.000Z"};
const NEWER={...X,transient_days:Number(C.transientDays),evidence_days:Number(C.evidenceDays),revision_days:Number(C.revisionDays),version:2,updated_at:"2026-08-30T12:00:01.000Z"};
const INVITE={email:"finite-retention-refresh@example.invalid",role:"member"};

function currentInvitation(f){
  const forms=f.nodes("form").filter(node=>node.owner===f.host&&String(node.handlers.submit).includes("#submitInvite"));
  assert.equal(forms.length,1,"The current Members task includes one actual invitation form");
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


async function invitationRefresh(t,changed=true){
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

  return {f,service,native,target,snapshot,reads};
}

const options={concurrency:false,timeout:30000};
const raw=policy=>({transientDays:String(policy.transient_days),evidenceDays:String(policy.evidence_days),revisionDays:String(policy.revision_days),legalHold:Boolean(policy.legal_hold)});
const kept=f=>f.i18n.t("workspace.admin.newerFormKept");
const draftHint=(f,key)=>{const form=f.native.current(key);return f.tree().visible("small").filter(node=>within(node,form)).map(node=>node.text).join(" ");};
function safe(f){f.assertNoExternal();assert.deepEqual(f.transport.external,[]);assert.equal(f.service.requests.some(request=>/\/holds(?:\/|$)|\/(?:policy|pilot)$/.test(request.url)&&method(request)!=="GET"),false);}
async function savedWithB(t,settings={}){
  const state=await setup(t,settings),{f,service,native,target}=state;f.native=native;
  native.fill(A);const gate=service.queue(request=>request.url===target&&method(request)==="PATCH","headers");native.submit();
  try{await gate.seen.promise;f.draw();native.fill(B);}finally{gate.release.resolve();await f.flush(24);}
  assert.deepEqual(native.values(),B);assert.ok(notice(f).includes(saved(f)));assert.ok(notice(f).includes(kept(f)));
  return state;
}

for(const locale of ["en","ja"])test("Policy deliberate Discard resolves actual live values and unchecked default "+locale,options,async t=>{
  const {f,native,service,snapshot}=await setup(t,{locale});f.native=native;const before=snapshot(),form=native.current().port;
  // Desired checkbox input is UNSENT. No finite or real hold is activated.
  native.fill({...B,legalHold:true});f.draw();
  assert.deepEqual(native.values(),{...B,legalHold:true});assert.ok(draftHint(f,"retention").includes(f.i18n.t("workspace.admin.policyDraftKept")));
  const requests=service.requests.length;native.discard();await f.flush(12);
  assert.equal(native.current().port,form);assert.deepEqual(native.values(),raw(X));
  assert.equal(form.getAttribute("data-workspace-policy-dirty"),"false");
  assert.equal(draftHint(f,"retention"),"");assert.equal(service.requests.length,requests);assert.equal(service.writes.length,0);
  assert.deepEqual(snapshot(),before);safe(f);
});

test("Policy matching Discard retires only its retained-values suffix, not the known A acknowledgment",options,async t=>{
  const {f,native,service}=await savedWithB(t),form=native.current().port,requests=service.requests.length;
  native.discard();await f.flush(12);
  assert.equal(native.current().port,form);assert.deepEqual(native.values(),A);
  assert.ok(notice(f).includes(saved(f)));assert.equal(notice(f).includes(kept(f)),false);
  assert.equal(service.requests.length,requests);assert.equal(service.writes.length,1);safe(f);
});

test("Policy other-form Discard preserves the original form's retained B and acknowledgment suffix",options,async t=>{
  const {f,native,service}=await savedWithB(t,{section:"members",nativeKey:"pilot-retention",activePilot:true}),requests=service.requests.length;
  const originalSecurity=native.values("security");
  native.fill({...originalSecurity,maxSessionMinutes:"75"},"security");f.draw();native.discard("security");await f.flush(12);
  assert.deepEqual(native.values("security"),originalSecurity);assert.deepEqual(native.values(),B);
  assert.ok(notice(f).includes(saved(f)));assert.ok(notice(f).includes(kept(f)));
  assert.equal(service.requests.length,requests);assert.equal(service.writes.length,1);safe(f);
});

test("Policy pristine form follows newer current saved C after an unrelated acknowledged refresh",options,async t=>{
  const {f,native,service,reads}=await invitationRefresh(t,true);f.native=native;
  assert.deepEqual(native.values(),raw(X));const form=native.current().port;
  f.submit(currentInvitation(f),INVITE);await f.flush(24);
  assert.equal(native.current().port,form);assert.deepEqual(reads.at(-1),NEWER);assert.deepEqual(native.values(),C);
  assert.equal(form.getAttribute("data-workspace-policy-dirty"),"false");assert.equal(draftHint(f,"pilot-retention"),"");
  assert.equal(service.writes.length,1);safe(f);
});

test("Policy known A plus failed session follow-up keeps same-form B and does not call A failed",options,async t=>{
  const {f,native,service,target}=await setup(t);f.native=native;
  const sessionFailure=service.queue(request=>request.url==="/api/session"&&method(request)==="GET","headers",{status:503,body:{error:"finite_session_unavailable"}});
  native.fill(A);native.submit();
  try{await sessionFailure.seen.promise;f.draw();native.fill(B);}finally{sessionFailure.release.resolve();await f.flush(24);}
  assert.deepEqual(native.values(),B);assert.ok(notice(f).includes(saved(f)));assert.ok(notice(f).includes(kept(f)));
  assert.ok(f.tree().visible("p").some(node=>node.attributes.role==="alert"));
  assert.equal(service.writes.length,1);assert.equal(service.writes[0].url,target);safe(f);
});

test("Policy actual current 403 withdraws dirty native fields before body; a fresh read never revives them",options,async t=>{
  const {f,native,service,target}=await setup(t);f.native=native;
  const ack=service.queue(request=>request.url===target&&method(request)==="PATCH","headers");
  const denial=service.queue(request=>request.url===target&&method(request)==="GET","body",{status:403,body:{error:"access_denied"}});
  native.fill(A);const old=native.current().port;native.submit();
  try{
    await ack.seen.promise;f.draw();native.fill(B);ack.release.resolve();
    await denial.seen.promise;await f.flush(12);
    assert.equal(old.isConnected,false);assert.equal(denial.jsonCalls,0);
    assert.equal(f.values().includes(B.transientDays),false);assert.equal(f.values().includes(B.evidenceDays),false);
    assert.ok(notice(f).includes(saved(f)));
  }finally{ack.release.resolve();denial.release.resolve();await f.flush(12);}
  const refresh=f.nodes("button").filter(node=>String(node.handlers.click).includes("this.#load"));assert.equal(refresh.length,1);
  f.click(refresh[0]);await f.flush(24);
  assert.notEqual(native.current().port,old);assert.deepEqual(native.values(),A);
  assert.equal(native.current().port.getAttribute("data-workspace-policy-dirty"),"false");
  assert.equal(service.writes.length,1);safe(f);
});

test("Policy disconnected original cannot publish into a reconnected native C form",options,async t=>{
  const {f,native,service,target}=await setup(t);f.native=native;
  native.fill(A);const old=native.current().port,gate=service.queue(request=>request.url===target&&method(request)==="PATCH","headers");native.submit();
  try{await gate.seen.promise;f.disconnect();f.reconnect();await f.flush(24);native.fill(C);}
  finally{gate.release.resolve();await f.flush(24);}
  assert.notEqual(native.current().port,old);assert.equal(old.isConnected,false);assert.deepEqual(native.values(),C);
  assert.equal(gate.jsonCalls,0);assert.equal(notice(f).includes(saved(f)),false);assert.equal(service.writes.length,1);safe(f);
});

test("Policy two current retention forms have independent native dirty and Discard ownership",options,async t=>{
  const {f,native,service}=await setup(t);f.native=native;const reply=service.reply;
  service.reply=request=>{
    const result=reply(request);
    if(method(request)==="GET"&&request.url===endpoint("A","/pilot")&&result.status===200)result.body.cohort={
      cohort_id:"finite-existing-pilot",status:"active",starts_at:"2026-08-29T12:00:00.000Z",ends_at:"2026-09-28T12:00:00.000Z",
      max_participants:10,participant_cap_microusd:15000000,organization_cap_microusd:150000000,source_classification:"non-sensitive-licensed"};
    return result;
  };
  // An existing finite report, not a pilot activation or financial command.
  f.navigate("B");await f.flush(24);f.navigate("A");await f.flush(24);
  const normal=native.current("retention").port,pilot=native.current("pilot-retention").port;assert.notEqual(normal,pilot);
  native.fill(B,"retention");native.fill(C,"pilot-retention");f.draw();const requests=service.requests.length;
  native.discard("retention");await f.flush(12);
  assert.deepEqual(native.values("retention"),raw(X));assert.deepEqual(native.values("pilot-retention"),C);
  assert.equal(native.current("pilot-retention").port,pilot);assert.equal(service.requests.length,requests);assert.equal(service.writes.length,0);safe(f);
});
