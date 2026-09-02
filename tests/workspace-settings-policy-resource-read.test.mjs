// E successor: invitation and the real pilot-retention form co-render on Members.
// Finite existing cohort, no activation; exact /retention reads and all original
// known-ACK, header-first denial, raw B, original request and fiscal checks remain.
// Root-only causal execution. Complete current Settings/Store + actual native
// policy fixture and installed Lit Parts; finite HTTP, not Worker authorization.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { setup, within, B, notice, endpoint, method } from "./helpers/workspace-policy-native-fixture.mjs";

const options={concurrency:false,timeout:30000},observations=[];
const INVITE={email:"finite-retention-refresh@example.invalid",role:"member"};
const X={transientDays:"30",evidenceDays:"365",revisionDays:"90",legalHold:false};
const get=request=>method(request)==="GET";
after(()=>console.log("POLICY_RESOURCE_READ_CASES "+JSON.stringify({expected:6,observations:observations.length})));

function currentInvitation(f){
  const forms=f.nodes("form").filter(node=>node.owner===f.host&&String(node.handlers.submit).includes("#submitInvite"));
  assert.equal(forms.length,1,"One actual current invitation form");
  const form=forms[0],fields=f.tree().nodes.filter(node=>within(node,form)&&["input","select"].includes(node.tag)&&node.attributes.name);
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

function posture(f,native,original){
  f.draw();const current=native.records().filter(record=>record.key==="pilot-retention");
  assert.ok(current.length<=1,"No duplicate policy owner is manufactured");
  return{oldFormConnected:original.isConnected,currentForm:current[0]?.id??null,
    sameForm:current[0]?.form===original,raw:current.length?native.values():null,
    savedNotice:notice(f).includes(f.i18n.t("workspace.admin.invited","A private, expiring invitation was created.")),
    alerts:f.nodes("p").filter(node=>node.attributes.role==="alert").map(node=>node.text)};
}

for(const locale of ["en","ja"])for(const mode of ["healthy200","temporary503","known403"])test(
  "Policy unsent B through unrelated acknowledged resource "+mode+" and current recovery "+locale,options,async t=>{
    const {f,service,native,target,snapshot}=await setup(t,{locale,section:"members",nativeKey:"pilot-retention",activePilot:true}),reply=service.reply;
    const inviteUrl=endpoint("A","/members"),reads=[],invitations=[];let first=true;
    service.reply=request=>{
      if(!get(request)){
        assert.equal(method(request),"POST");assert.equal(request.url,inviteUrl);assert.deepEqual(request.body,INVITE);
        assert.equal(service.writes.length,0,"Exactly one finite unrelated invitation, no policy command");
        const id="finite-unrelated-retention-invitation",expiresAt="2026-09-06T12:00:00.000Z";
        const receipt={invitationId:id,membershipId:id,status:"pending",expiresAt,
          invitationUrl:"http://localhost/settings/workspaces/invitations?invitation="+id+"&token=finite-only"};
        invitations.push({invitation_id:id,email_normalized:INVITE.email,role:INVITE.role,status:"pending",expires_at:expiresAt});
        service.writes.push({method:"POST",url:inviteUrl,body:structuredClone(request.body),receipt:structuredClone(receipt)});
        return{status:201,body:receipt};
      }
      if(request.url===target){
        const initial=first;first=false;let result;
        if(initial&&mode==="known403"){
          // Reuse the finite service's real known-denial response, unchanged.
          // No Store session/permission mutation or real authorization claim.
          assert.equal(service.denied.has("A"),false);service.denied.add("A");
          try{result=reply(request);}finally{service.denied.delete("A");}
          assert.equal(result.status,403);assert.deepEqual(result.body,{error:"access_denied"});
        }else result=reply(request);
        const original=structuredClone(result);
        if(initial&&mode==="temporary503"){
          assert.equal(result.status,200,"The finite authoritative policy remains available and unchanged");
          result={status:503,body:{error:"finite_retention_read_unavailable"}};
        }
        reads.push({status:result.status,original,delivered:structuredClone(result)});return result;
      }
      const result=reply(request);
      if(result.status===200&&[endpoint("A"),inviteUrl].includes(request.url))result.body.invitations.push(...structuredClone(invitations));
      return result;
    };
    const before=snapshot(),route=f.store.route.get(),scope=f.store.captureAuthorizationScope();
    const original=native.fill(B).port,originalId=native.record().id,originalFields=[...native.record().fields.values()].map(field=>field.node);
    assert.deepEqual(native.values(),B);assert.ok(native.eligibility().every(field=>field.enabled));
    const read=service.queue(request=>request.url===target&&get(request),"body");
    f.submit(currentInvitation(f),INVITE);
    let headers,settled,recovered,retryRequests=0;
    try{
      await read.seen.promise;await f.flush(12);headers=posture(f,native,original);
      assert.equal(service.writes.length,1);assert.equal(headers.savedNotice,true,"The invitation's original ACK is known before its follow-up read");
      if(mode==="known403"){
        assert.equal(read.jsonCalls,0,"Known denial is handled at headers before its body");
        assert.equal(headers.oldFormConnected,false);assert.equal(headers.currentForm,null);
        assert.ok(originalFields.every(field=>!field.isConnected));
      }else{
        assert.equal(read.jsonCalls,1);assert.equal(headers.sameForm,true);assert.deepEqual(headers.raw,B);
      }
    }finally{read.release.resolve();await f.flush(24);}
    settled=posture(f,native,original);
    assert.equal(service.pending,0);assert.equal(service.writes.length,1);
    assert.equal(f.store.route.get(),route);assert.equal(f.store.authorizationScopeActive(scope),true);
    assert.deepEqual(snapshot(),before,"Source, session fiscal values, credentials and tokens are unchanged");
    if(mode!=="healthy200"){
      const retries=f.nodes("button").filter(node=>String(node.handlers.click).includes("this.#load"));
      assert.equal(retries.length,1,"The current actual unavailable surface offers one deliberate Retry read");
      const requestStart=service.requests.length;f.click(retries[0]);await f.flush(24);retryRequests=service.requests.length-requestStart;
      assert.ok(retryRequests>0);assert.ok(service.requests.slice(requestStart).every(get),"Explicit Retry only reads; it does not replay an invitation or submit B");
    }
    recovered=posture(f,native,original);
    assert.ok(recovered.currentForm!==null,"A healthy current read reopens a policy form");
    assert.equal(recovered.savedNotice,true);assert.deepEqual(recovered.alerts,[]);
    assert.equal(f.store.route.get(),route);assert.equal(f.store.authorizationScopeActive(scope),true);assert.deepEqual(snapshot(),before);
    assert.equal(service.pending,0);assert.equal(service.denied.size,0);assert.equal(service.writes.length,1);
    assert.deepEqual(service.requests.filter(request=>!get(request)).map(request=>({method:method(request),url:request.url,body:request.body})),
      [{method:"POST",url:inviteUrl,body:INVITE}]);
    assert.deepEqual(reads.map(item=>item.status),mode==="healthy200"?[200]:mode==="temporary503"?[503,200]:[403,200]);
    for(const item of reads)if(item.status!==503)assert.deepEqual(item.delivered,item.original,"All non-503 response bodies remain unchanged");
    if(mode==="temporary503")assert.deepEqual(reads[1].delivered,reads[0].original,"Retry returns the original unchanged authorized finite policy");
    f.assertNoExternal();assert.deepEqual(f.transport.external,[]);
    const observation={locale,mode,originalForm:originalId,headers,settled,recovered,retryRequests,
      statuses:reads.map(item=>item.status),knownDenialJsonCalls:mode==="known403"?read.jsonCalls:null,
      invitationWrites:1,policyWrites:0,providerAttempts:0,sourceAndFiscalUnchanged:true,
      evidence:"Complete actual Settings/Store, actual connected native form and installed Lit Parts; original finite invitation and current GETs; only temporary503 response replaced. Not Worker policy authority, real email, financial mutation, or physical browser."};
    observations.push(observation);console.log("POLICY_RESOURCE_READ_OBSERVATION "+JSON.stringify(observation));
    // Desired continuation checks occur after all actual Retry observations.
    if(mode==="known403"){
      assert.equal(recovered.sameForm,false);assert.equal(original.isConnected,false);assert.deepEqual(recovered.raw,X);
    }else{
      assert.equal(recovered.sameForm,true,"A same-owner temporary resource failure must not destroy the only native unsent draft");
      assert.deepEqual(recovered.raw,B,"Current recovery must retain B, not silently reload saved X over it");
    }
  });
