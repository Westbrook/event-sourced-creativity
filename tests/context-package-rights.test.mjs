import assert from "node:assert/strict";
import test from "node:test";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { packageSourceRightsCurrent, packageSourceRightsValidity } from "../worker/context-package-rights.ts";

test("organization-owned authored decisions remain durable after their source project or owner disappears",async()=>{
  let attemptedSourceReads=0;
  const environment={DB:{prepare(){attemptedSourceReads+=1;throw new Error("orphaned source project must not be consulted");}}};
  const snapshot={schema:1,organizationId:"organization-a",sourceProjectAccessId:"removed-origin",sourceDocumentId:"removed-document",blocks:[
    {sourceBlockId:"orphaned-direction",type:"direction",properties:{text:"Durable organization-owned creative direction",weight:.8}},
    {sourceBlockId:"orphaned-message",type:"message",properties:{text:"Approved exact  wording",exact_text:"Approved exact  wording"}},
  ]};
  assert.equal(await packageSourceRightsCurrent(environment,"organization-a",snapshot),true);
  assert.deepEqual(await packageSourceRightsValidity(environment,"organization-a",snapshot),{current:true,validUntil:null});
  assert.equal(attemptedSourceReads,0,"tenant-owned unlicensed decisions never depend on a departed creator or deleted source project");
});

test("source-rights validity reports the earliest normalized boundary without treating malformed metadata as perpetual",()=>{
  const now=Date.parse("2026-08-01T00:00:00.000Z"),later="2026-08-01T00:05:00.000Z",earliest="2026-08-01T00:01:00.000Z";
  for(const field of["source_expires_at","license_expires_at","rights_expires_at"]){
    const properties={rights_class:"owned_or_licensed",source_expires_at:later,license_expires_at:later,rights_expires_at:later,[field]:"2026-08-01T01:01:00+01:00"};
    assert.deepEqual(creativeContextRightsValidity(properties,now),{issue:null,validUntil:earliest});
  }
  assert.deepEqual(creativeContextRightsValidity({rights_class:"owned"},now),{issue:null,validUntil:null});
  assert.deepEqual(creativeContextRightsValidity({license_expires_at:"not a timestamp"},now),{issue:"invalid",validUntil:null});
  assert.deepEqual(creativeContextRightsValidity({rights_revoked:true,license_expires_at:later},now),{issue:"revoked",validUntil:null});
  assert.deepEqual(creativeContextRightsValidity({source_expires_at:"2026-08-01T00:00:00.000Z"},now),{issue:"expired",validUntil:null});
});
test("a malformed immutable package deadline cannot silently become an unlimited source license",async()=>{
  let reads=0;const environment={DB:{prepare(){reads++;throw new Error("Invalid snapshot must be rejected before source lookup");}}};
  const snapshot={schema:1,organizationId:"organization-a",sourceProjectAccessId:"origin",sourceDocumentId:"document",blocks:[{sourceBlockId:"licensed-message",type:"message",properties:{text:"Licensed statement"},rightsExpiresAt:"not a timestamp"}]};
  assert.deepEqual(await packageSourceRightsValidity(environment,"organization-a",snapshot),{current:false,validUntil:null});assert.equal(await packageSourceRightsCurrent(environment,"organization-a",snapshot),false);assert.equal(reads,0);
});

import { sourceRightsDispatchGuard, sourceRightsDispatchGuardForStructuredAssistant } from "../worker/context-package-rights.ts";
import { assistantStructuredOwnSendGuard } from "../worker/assistant-context-source.ts";

// The two-event/three-content v2 shape is the existing context-source fixture's
// producer-shaped synthetic input. These are construction tests, not SQL parity
// or evidence that a source license exists in a native database.
function structuredRightsOwnFootprint(shared=false){
  const now=new Date().toISOString(),expiry=new Date(Date.now()+3_600_000).toISOString();
  const actor="synthetic-memory-actor",turn="synthetic-memory-turn",project="synthetic-project",document="synthetic-document";
  const scope=shared?{organizationId:"synthetic-organization",projectAccessId:"synthetic-access",projectId:project,ownerUserId:"synthetic-owner"}:null;
  const owner=scope?.ownerUserId??actor,stream="creative:"+owner,sourceHead=1;
  const rows=["user","assistant"].map((role,index)=>{
    const contentId="synthetic-content-"+role,eventId="synthetic-event-"+role;
    const payload={actor_user_id:actor,turn_id:turn,project_id:project,document_id:document,content_ref:contentId,
      ...(index?{operation:"creative-chat",memory_origin_version:2,organization_id:scope?.organizationId??null,
        project_access_id:scope?.projectAccessId??null,owner_user_id:owner}:{})};
    return {event:[eventId,stream,sourceHead+index+1,now,now,"user:"+actor,"web:assistant",actor+":"+turn,
      index?"synthetic-event-user":null,null,1,index?"AssistantReasoned":"ChatMessageSent",JSON.stringify(payload),owner,project,document,null],
      content:[contentId,actor,index?"chat-assistant-memory":"chat-user",role+" bytes",now,expiry,null],
      receipt:[stream,"synthetic-receipt-"+role,eventId,sourceHead+index+1,now]};
  });
  const manifestContentId="synthetic-manifest",contents=[...rows.map(row=>row.content),
    [manifestContentId,actor,"memory-structured-origin",'{"schemaVersion":1,"context":"private manifest"}',now,expiry,null]];
  return {streamId:stream,sourceHead,actorUserId:actor,turnId:turn,memoryAnswer:{version:2},scope,projectId:project,documentId:document,manifestContentId,
    eventWrites:rows.map(row=>row.event),contents,receipts:rows.map(row=>row.receipt),
    resources:scope?contents.map(content=>[scope.projectAccessId,"content",content[0],scope.organizationId,scope.projectId,owner,"actor_private",null,actor,now]):[],
    retentions:scope?contents.map(content=>[content[0],scope.organizationId,scope.projectAccessId,scope.projectId,actor,"transient-private",1,expiry,now]):[]};
}

function structuredRightsDependencies(own){
  const source={kind:"source",organizationId:"licensed-organization",projectAccessId:"licensed-access",projectId:"licensed-project",
    ownerUserId:own.scope?.ownerUserId??own.actorUserId,sourceHead:own.sourceHead,indexedHead:own.sourceHead,
    events:[{eventId:"licensed-event",sequence:own.sourceHead,type:"RightsAsserted",payload:'{"rights_class":"owned_or_licensed"}',privateJson:null,privateOwner:null}],
    resources:[{kind:"document",id:"licensed-document"}]};
  const version={kind:"package",organizationId:"licensed-organization",packageId:"licensed-package",versionId:"licensed-version",
    contentSha256:"a".repeat(64),contentJson:'{"schema":1,"retained":"immutable licensed bytes"}'};
  return {dispatchDependencies:[source,version]};
}

test("structured rights construction retains full v2 proof and cumulative immutable dependencies",()=>{
  for(const shared of[false,true]){
    const own=structuredRightsOwnFootprint(shared),rights=structuredRightsDependencies(own);
    const extra=structuredClone(rights.dispatchDependencies[0]);extra.resources.push({kind:"block",id:"licensed-block"});
    rights.dispatchDependencies.push(extra);
    const beforeOwn=structuredClone(own),beforeRights=structuredClone(rights),ordinary=sourceRightsDispatchGuard(rights);
    const suffix=assistantStructuredOwnSendGuard(own),guard=sourceRightsDispatchGuardForStructuredAssistant(rights,own);
    const packed=JSON.parse(guard.bindings[0]);
    assert.deepEqual(packed,{dependencies:[{...beforeRights.dispatchDependencies[0],resources:extra.resources},beforeRights.dispatchDependencies[1]],
      ownAssistant:{streamId:own.streamId,sourceHead:own.sourceHead,endHead:own.sourceHead+2,eventIds:own.eventWrites.map(event=>event[0])}});
    assert.ok(guard.sql.endsWith(") AND ("+suffix.sql+")"));
    assert.deepEqual(guard.bindings.slice(1),suffix.bindings,"the complete v2 contents, receipts and custody proof is not omitted");
    assert.deepEqual(own,beforeOwn);assert.deepEqual(rights,beforeRights);
    assert.deepEqual(sourceRightsDispatchGuard(rights),ordinary,"the default guard and its input remain unchanged");
  }
});

test("structured rights construction rejects v1, incomplete v2, foreign custody and inconsistent own heads",()=>{
  const valid=structuredRightsOwnFootprint(true),rights=structuredRightsDependencies(valid);
  assert.doesNotThrow(()=>sourceRightsDispatchGuardForStructuredAssistant(rights,valid));
  for(const alter of[
    own=>{own.memoryAnswer.version=1;},
    own=>{own.contents.pop();},
    own=>{own.scope.projectAccessId="foreign-access";},
    own=>{own.receipts[1][0]="creative:foreign-owner";},
    own=>{own.eventWrites.push([...own.eventWrites[1]]);},
    own=>{own.sourceHead++;},
  ]){
    const invalid=structuredClone(valid);alter(invalid);
    assert.throws(()=>sourceRightsDispatchGuardForStructuredAssistant(rights,invalid));
  }
});

test("structured rights construction never rebases foreign source heads or drops package obligations",()=>{
  const own=structuredRightsOwnFootprint(),rights=structuredRightsDependencies(own);
  rights.dispatchDependencies[0].sourceHead=41;rights.dispatchDependencies[0].indexedHead=41;
  rights.dispatchDependencies[0].ownerUserId="different-source-owner";
  const guard=sourceRightsDispatchGuardForStructuredAssistant(rights,own),packed=JSON.parse(guard.bindings[0]);
  assert.deepEqual(packed.dependencies,rights.dispatchDependencies);
  assert.equal(packed.ownAssistant.sourceHead,1);assert.equal(packed.ownAssistant.endHead,3);
  assert.ok(guard.sql.includes("json_extract(dependency.value,'$.indexedHead')=json_extract(dependency.value,'$.sourceHead')"));
  assert.ok(guard.sql.includes("json_extract(dependency.value,'$.sourceHead')=json_extract(source_rights.value,'$.ownAssistant.sourceHead')"));
  assert.ok(guard.sql.includes("SELECT COALESCE(MAX(event.sequence),0) FROM events event WHERE event.stream_id='creative:'||project.owner_user_id"));
  assert.ok(guard.sql.includes("version.redacted_at IS NULL"));
});
