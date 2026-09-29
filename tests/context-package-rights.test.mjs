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
