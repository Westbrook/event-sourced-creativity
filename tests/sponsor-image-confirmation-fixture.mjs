import assert from 'node:assert/strict';
import {fixture as initialFixture,requestFor} from './sponsor-initial-intake-fixture.mjs';

const [{SPONSOR_IMAGE_INTAKE_READ_V2_OPERATIONS,SPONSOR_INTAKE_READ_POLICY_SCHEMA},
  {SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,prepareSponsorIntakeReadApproval,approveSponsorIntakeReadPolicy},
  {SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA},{createSponsorImageIntakeRoute},{createSponsorImageTransport}]=await Promise.all([
  import('../worker/experience-sponsor-intake-read-policy.ts'),
  import('../worker/experience-sponsor-intake-read-approval.ts'),
  import('../worker/experience-sponsor-intake-read-attempts.ts'),
  import('../worker/experience-sponsor-intake-route.ts'),
  import('../src/experiences/sponsor-image-transport.ts'),
]);

export const base='/api/experiences/sponsor/image';
export const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
export const attempts=f=>f.sqlite.prepare('SELECT * FROM experience_sponsor_intake_read_attempts ORDER BY admitted_at_ms,attempt_id').all();
export const nativeState=f=>Object.fromEntries(['private_content','events','event_private_payloads','event_client_receipts',
  'experience_sponsor_intakes','experience_sponsor_resource_receipts','output_commands','output_plan_revisions','output_plan_targets']
  .map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
const counters=f=>Object.fromEntries(['budget_counters','cost_budget_counters'].map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

/** Synthetic reviewed test terms, never an activated campaign or launch default. */
export function confirmationTerms({maximumBytes=16_000_000,deadlineMs=30_000,maximumRequestsPerWindow=40}={}){
  return {version:2,windowMs:60_000,
    operations:Object.fromEntries(SPONSOR_IMAGE_INTAKE_READ_V2_OPERATIONS.map(operation=>[operation,{maximumBytes,deadlineMs}])),
    actor:{maximumRequestsPerWindow,maximumBytesPerWindow:maximumBytes*maximumRequestsPerWindow},
    campaign:{maximumRequestsPerWindow:maximumRequestsPerWindow*2,maximumBytesPerWindow:maximumBytes*maximumRequestsPerWindow*2}};
}

/** Real accounts and direct payer approvals, but initially no creative state.
 * V2 schema is provisioned into the fresh database; V1 is never upgraded. */
export async function confirmationFixture(t,{terms=confirmationTerms(),...initialOptions}={}){
  const f=await initialFixture(t,initialOptions),originalCounters=counters(f);
  for(const schema of [SPONSOR_INTAKE_READ_POLICY_SCHEMA,SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA])
    for(const sql of schema)f.sqlite.exec(sql);
  const proposal={version:1,campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy:structuredClone(terms)};
  const payerRequest=body=>requestFor(f,body,{actorUserId:f.payer,path:'/__fixture/image-confirmation-read-approval'});
  const review=await prepareSponsorIntakeReadApproval(payerRequest({action:'prepare-sponsor-intake-read-policy',proposal}),f.env);
  const readApproval=await approveSponsorIntakeReadPolicy(payerRequest({action:'approve-sponsor-intake-read-policy',
    approvalId:`confirmation-read-${f.campaignId}`,proposal,reviewedTermsDigest:review.termsDigest,
    confirmation:'APPROVE_SPONSOR_INTAKE_READ_POLICY'}),f.env);
  Object.assign(f,{readTerms:proposal.readPolicy,readReview:review,readApproval});
  f.httpRequest=(method,path,body,{actorUserId=f.actor,headers={},signal}={})=>{
    const url=new URL(path,'http://localhost');assert.equal(url.origin,'http://localhost');
    return new Request(url,{method,headers:{...f.headersFor(actorUserId),...(body===undefined?{}:{'content-type':'application/json'}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});
  };
  f.route=createSponsorImageIntakeRoute({version:1,enabled:true,audience:'canonical-principal',output:'image',freshCampaignId:f.campaignId});
  f.clientCalls=[];
  f.transport=createSponsorImageTransport({version:1,enabled:true,audience:'canonical-principal',output:'image',expectedActorUserId:f.actor},async(path,init)=>{
    assert.ok(init.signal instanceof AbortSignal);assert.equal(init.credentials,'same-origin');
    const request=new Request(new URL(path,'http://localhost'),{...init,headers:{...f.actorHeaders,...init.headers}});
    const response=await f.route(request,f.env);assert.ok(response instanceof Response);
    f.clientCalls.push({path,method:init.method,status:response.status,body:await response.clone().json()});return response;
  });
  f.confirmationRequest=(plan,options={})=>f.httpRequest('POST',`${base}/drafts/${plan.draftId}/output-confirmation`,
    {draftHash:plan.draftHash,explicitRequirementsConfirmation:true},options);
  f.readConfirmationRequest=(plan,options={})=>f.httpRequest('GET',`${base}/drafts/${plan.draftId}/output-confirmation`,undefined,options);
  f.assertNoPaidWork=()=>{
    for(const table of ['document_jobs','output_preflights','output_execution_grants','experience_sponsor_grants','experience_sponsor_consumptions',
      'experience_sponsor_active_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(count(f,table),0,table);
    assert.deepEqual(counters(f),originalCounters);assert.equal(f.media.size,0);
  };
  for(const table of ['private_content','events','event_private_payloads','event_client_receipts','experience_sponsor_intakes',
    'experience_sponsor_resource_receipts','experience_sponsor_intake_read_attempts','output_commands','output_plan_revisions'])assert.equal(count(f,table),0,table);
  f.assertNoPaidWork();return f;
}

/** Browser transport and runtime build and review the actual native plan; the
 * fixture never fabricates a plan, BlockCreated or OutputPlanConfirmed event. */
export async function commitFromEmpty(t,f){
  const {bootstrap,runtime}=await f.transport.bootstrap(undefined,{signal:new AbortController().signal});t.after(()=>runtime.dispose());
  assert.equal(bootstrap.mode,'fresh');assert.equal(bootstrap.actorUserId,f.actor);assert.equal(bootstrap.campaignId,f.campaignId);
  assert.equal(count(f,'events'),0);
  runtime.change('subject','A copper lamp beside a library window');runtime.change('ratio',{width:1,height:1});
  await runtime.prepare();assert.equal(runtime.state.phase,'review',JSON.stringify({state:runtime.state,calls:f.clientCalls}));
  const plan=runtime.preparedPlan;assert.ok(plan?.sponsor_intake);assert.equal(count(f,'events'),0);
  await runtime.submit();assert.equal(runtime.state.phase,'complete',JSON.stringify({state:runtime.state,calls:f.clientCalls}));
  assert.deepEqual(runtime.committedPlan,plan);assert.equal(runtime.receipt.documentId,plan.documentId);
  assert.deepEqual(runtime.receipt.appended.map(({type,payload})=>({type,payload})),plan.events);
  f.assertNoPaidWork();return {plan,receipt:runtime.receipt,runtime,bootstrap};
}

/** Observe SQL without substituting native statements or their return values. */
export function captureSql(f){
  const original=f.DB.prepare.bind(f.DB),records=[],wrapped=new WeakSet();let stage='intake';
  const wrap=statement=>{
    if(wrapped.has(statement))return statement;wrapped.add(statement);
    const bind=statement.bind.bind(statement),execute=statement.execute.bind(statement);
    statement.bind=(...values)=>wrap(bind(...values));
    statement.execute=kind=>{
      const entry={stage,kind,sql:statement.sql,bindings:statement.bindings,sqlBytes:Buffer.byteLength(statement.sql)};records.push(entry);
      try{return execute(kind);}catch(error){entry.error=error.message;throw error;}
    };return statement;
  };
  f.DB.prepare=sql=>wrap(original(sql));return {records,setStage(value){stage=value;},restore(){f.DB.prepare=original;}};
}
