import assert from 'node:assert/strict';
import {fixture as initialFixture,requestFor} from './sponsor-initial-intake-fixture.mjs';

const [{SPONSOR_IMAGE_INTAKE_READ_OPERATIONS,SPONSOR_INTAKE_READ_POLICY_SCHEMA},
  {SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,prepareSponsorIntakeReadApproval,approveSponsorIntakeReadPolicy},
  {SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA}]=await Promise.all([
  import('../worker/experience-sponsor-intake-read-policy.ts'),
  import('../worker/experience-sponsor-intake-read-approval.ts'),
  import('../worker/experience-sponsor-intake-read-attempts.ts'),
]);

export {initialFixture,requestFor};
export {nativeRequest,headersFor,installImageTransport} from './sponsor-initial-intake-fixture.mjs';

/** Synthetic reviewed fixture values only; these are not launch defaults. */
export function defaultReadTerms(maximumBytes=1_000_000,deadlineMs=10_000){
  return {version:1,windowMs:60_000,
    operations:Object.fromEntries(SPONSOR_IMAGE_INTAKE_READ_OPERATIONS.map(operation=>[operation,{maximumBytes,deadlineMs}])),
    actor:{maximumRequestsPerWindow:20,maximumBytesPerWindow:maximumBytes*20},
    campaign:{maximumRequestsPerWindow:40,maximumBytesPerWindow:maximumBytes*40}};
}

const financialTables=['budget_counters','cost_budget_counters'];
const unpaidTables=['document_jobs','output_execution_grants','experience_sponsor_grants','experience_sponsor_consumptions',
  'budget_reservations','cost_budget_reservations','output_provider_calls'];
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const financialCounters=f=>Object.fromEntries(financialTables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

/** Canonical accounts, actual generation approval, then actual payer review of
 * separate intake-read terms. Setup creates no draft, Document, read attempt,
 * provider request or financial reservation and invokes no transport route. */
export async function routeFixture(t,{terms=defaultReadTerms(),...initialFixtureOptions}={}){
  const originalFetch=globalThis.fetch;let setupFetchAttempts=0;
  globalThis.fetch=()=>{setupFetchAttempts++;throw Error('Sponsor intake route fixture setup prohibits network');};
  try{
    const f=await initialFixture(t,initialFixtureOptions);
    assert.ok(f.compiled,'Route fixture requires actual generation payer approval');
    const originalFinancialCounters=financialCounters(f);
    for(const schema of [SPONSOR_INTAKE_READ_POLICY_SCHEMA,SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA]){
      assert.ok(Array.isArray(schema),'Dormant read schema must be explicitly exported');
      for(const sql of schema)f.sqlite.exec(sql);
    }
    const readTerms=structuredClone(terms),readProposal={version:1,campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy:readTerms};
    const payerRequest=body=>requestFor(f,body,{actorUserId:f.payer,path:'/__fixture/sponsor-intake-read-approval'});
    const readReview=await prepareSponsorIntakeReadApproval(payerRequest({action:'prepare-sponsor-intake-read-policy',proposal:readProposal}),f.env);
    const readApprovalCommand={action:'approve-sponsor-intake-read-policy',approvalId:`read-${f.campaignId}`,proposal:readProposal,
      reviewedTermsDigest:readReview.termsDigest,confirmation:'APPROVE_SPONSOR_INTAKE_READ_POLICY'};
    const readApproval=await approveSponsorIntakeReadPolicy(payerRequest(readApprovalCommand),f.env);
    Object.assign(f,{readTerms,readProposal,readReview,readApproval,readApprovalCommand,originalFinancialCounters});
    f.httpRequest=(method,path,body,{actorUserId=f.actor,headers={},signal}={})=>{
      const url=new URL(path,'http://localhost');assert.equal(url.origin,'http://localhost');
      const requestHeaders=new Headers(f.headersFor(actorUserId));
      if(body!==undefined)requestHeaders.set('content-type','application/json');
      new Headers(headers).forEach((value,key)=>requestHeaders.set(key,value));
      return new Request(url,{method,headers:requestHeaders,...(body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});
    };
    f.assertNoPaidWork=()=>{
      for(const table of unpaidTables)assert.equal(count(f,table),0,table);
      assert.deepEqual(financialCounters(f),originalFinancialCounters);
      assert.equal(f.media.size,0);
    };
    for(const table of ['private_content','events','event_private_payloads','event_client_receipts','experience_sponsor_intakes',
      'experience_sponsor_resource_receipts','experience_sponsor_intake_read_attempts'])assert.equal(count(f,table),0,table);
    f.assertNoPaidWork();assert.equal(setupFetchAttempts,0);
    return f;
  }finally{globalThis.fetch=originalFetch;}
}
