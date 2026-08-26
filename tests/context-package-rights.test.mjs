import assert from "node:assert/strict";
import test from "node:test";
import { packageSourceRightsCurrent } from "../worker/context-package-rights.ts";

test("organization-owned authored decisions remain durable after their source project or owner disappears",async()=>{
  let attemptedSourceReads=0;
  const environment={DB:{prepare(){attemptedSourceReads+=1;throw new Error("orphaned source project must not be consulted");}}};
  const snapshot={schema:1,organizationId:"organization-a",sourceProjectAccessId:"removed-origin",sourceDocumentId:"removed-document",blocks:[
    {sourceBlockId:"orphaned-direction",type:"direction",properties:{text:"Durable organization-owned creative direction",weight:.8}},
    {sourceBlockId:"orphaned-message",type:"message",properties:{text:"Approved exact  wording",exact_text:"Approved exact  wording"}},
  ]};
  assert.equal(await packageSourceRightsCurrent(environment,"organization-a",snapshot),true);
  assert.equal(attemptedSourceReads,0,"tenant-owned unlicensed decisions never depend on a departed creator or deleted source project");
});
