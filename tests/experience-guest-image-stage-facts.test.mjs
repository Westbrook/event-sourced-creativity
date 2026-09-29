import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture,request,snapshot,changes,batchHook,addLease,GUEST_DB_NOW} from './helpers/guest-image-stage-fixture.mjs';
const [{prepareGuestImageConfirmation,confirmGuestImageRequirement},{preflightGuestImage},
  {collectRetainedGuestImageHistory,together,guestImageHistorySessionProof},
  {collectGuestImageStageFacts,guestImageStageUnclaimedClosure,guestImageStageClosureRows},
  {inspectGuestImageStageInventory,guestImageStageInventoryData}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../worker/experience-guest-image-preflight.ts'),
  import('../worker/experience-guest-image-history.ts'),import('../worker/experience-guest-image-stage-facts.ts'),
  import('../worker/experience-guest-image-stage-inventory.ts')]);
async function setup(t,state){
  const f=await fixture(t),review=await prepareGuestImageConfirmation(request(),f.env,f.input);
  await confirmGuestImageRequirement(request(),f.env,{...f.input,reviewedRequirementDigest:review.reviewedRequirementDigest,explicitRequirementsConfirmation:true});
  if(state==='preflight-claimed-unknown'){
    const restore=batchHook(f,statements=>statements.some(statement=>/^INSERT INTO experience_sponsor_driver_stages\(/u.test(statement.sql)),()=>{throw Error('lost construction ACK');});
    try{await assert.rejects(preflightGuestImage(request(),f.env,f.input),/lost construction ACK/u);}finally{restore();}
  }else if(state==='quoted')await preflightGuestImage(request(),f.env,f.input);
  return f;
}
const check=(f,proof)=>f.DB.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...proof.bindings).first();

for(const state of ['confirmed','preflight-claimed-unknown','quoted'])test(`${state} factual components reconstruct the exact strict unclaimed proof without acquiring its brand`,async t=>{
  const f=await setup(t,state),before=snapshot(f),count=changes(f);
  const history=await collectRetainedGuestImageHistory(request(),f.env,{proof:f.proof}),facts=await collectGuestImageStageFacts(history);
  assert.equal(facts.stageState,state);assert.equal(Object.hasOwn(facts,'proof'),false);assert.equal(Object.hasOwn(facts,'commonProof'),false);
  assert.throws(()=>guestImageStageInventoryData(f.env,facts));
  assert.deepEqual(history.currentGuards,[history.currentPolicyProof,history.currentSessionProof]);
  const original=history.original;
  assert.equal(original.parts.filter(part=>part===original.sessionProof).length,1);
  assert.deepEqual(original.associationParts,original.parts.filter(part=>part!==original.sessionProof));
  assert.equal(original.associationParts.includes(original.sessionProof),false);
  const closure=guestImageStageUnclaimedClosure(facts),groups=guestImageStageClosureRows(history);
  assert.deepEqual(groups.leaseRows,[['experience_guest_claim_leases','d.session_id=s.sessionId']]);
  assert.equal(groups.originalGraphRows.some(([table])=>table==='experience_guest_claim_leases'),false);
  const common=together([...original.parts,...history.currentGuards,history.sponsor.proof,history.memory.proof,
    ...facts.stageParts,facts.blockCustodyProof,facts.eventCountProof,closure,facts.recordedTimeProof]);
  const assembled=together([common,...facts.tailProofs]);
  const strict=await inspectGuestImageStageInventory(request(),f.env,{proof:f.proof});
  assert.deepEqual(guestImageStageInventoryData(f.env,strict).proof,assembled,'native SQL text and ordered binding values');
  assert.equal((await check(f,assembled)).current,1);
  assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);
  addLease(f);
  assert.equal((await check(f,closure)).current,0,'fact extraction does not relax the strict lease exclusion');
  await assert.rejects(inspectGuestImageStageInventory(request(),f.env,{proof:f.proof}));
});

test('the structural session successor permits only the exact revocation field while original association proofs stay intact',async t=>{
  const f=await setup(t,'confirmed'),history=await collectRetainedGuestImageHistory(request(),f.env,{proof:f.proof});
  const {original}=history,revokedAtMs=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  const successor=guestImageHistorySessionProof(original,{revokedAtMs});
  assert.equal((await check(f,successor)).current,0);
  assert.equal((await check(f,original.sessionProof)).current,1);
  const association=together(original.associationParts);
  assert.equal((await check(f,association)).current,1);
  f.sqlite.prepare('UPDATE experience_guest_sessions SET revoked_at_ms=? WHERE session_id=?').run(revokedAtMs,f.session.sessionId);
  assert.equal((await check(f,successor)).current,1);
  assert.equal((await check(f,original.sessionProof)).current,0);
  assert.equal((await check(f,association)).current,1);
  assert.equal((await check(f,history.currentSessionProof)).current,0);
  assert.equal((await check(f,history.currentPolicyProof)).current,1);
  const foreignSession={...original.session,document_id:'foreign-document'};
  assert.equal((await check(f,guestImageHistorySessionProof({session:foreignSession},{revokedAtMs}))).current,0);
  assert.throws(()=>guestImageHistorySessionProof({session:{...original.session,revoked_at_ms:revokedAtMs+1}},{revokedAtMs}));
  for(const input of [{revokedAtMs:-1},{revokedAtMs:NaN},{revokedAtMs,sql:'1'},{}])assert.throws(()=>guestImageHistorySessionProof(original,input));
  await assert.rejects(inspectGuestImageStageInventory(request(),f.env,{proof:f.proof}));
});
