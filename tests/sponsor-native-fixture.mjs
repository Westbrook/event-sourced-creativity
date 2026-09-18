import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {outputTestDatabase, registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent,streamHead},{parseOutputRequirement},
  {handleOutputRequirements,loadOutputTrustedContext,outputExperienceCommands},{outputDocumentExecutionBridge},
  {describeSponsorImageAdmission,createSponsorAdmissionAuthority},{compileSponsorEnvelope},{SPONSOR_ENTITLEMENT_SCHEMA}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),import('../src/model/output-requirements.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),import('../worker/experience-sponsor-admission.ts'),
  import('../worker/experience-sponsor-policy.ts'),import('../worker/experience-sponsor-entitlement.ts'),
]);
// Shared source-based fixture: real disposable SQLite, synthetic identities and
// candidate policy only. Call installImageTransport before exercising execution;
// it handles the three expected requests entirely in memory and rejects others.
const BASE='/api/output-requirements',actor='dev-local-creative',payer='fixture-sponsor',stream=`creative:${actor}`;
const context={waitUntil(){throw Error('No detached work permitted');}};
const init=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const tables=['events','event_private_payloads','output_commands','output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters','experience_sponsor_consumptions','experience_sponsor_active_jobs','output_provider_calls','output_native_storage_writes'];
function rows(f){return Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
async function fixture(t,{documentId='sponsor-native-image',kind='image',actorUserId=actor,database}={}){
  const actor=actorUserId,stream=`creative:${actor}`,actorHeaders=actor=== 'dev-local-creative'?{}:{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`};
  const actorInit=body=>({...init(body),headers:{...init(body).headers,...actorHeaders}});
  const f=database??outputTestDatabase();if(!database)t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:actorHeaders}),f.env)).status,200);
  const sponsorHeaders={'oai-authenticated-user-id':payer,'oai-authenticated-user-email':'fixture-sponsor@example.invalid'};
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:sponsorHeaders}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events',{headers:actorHeaders}),f.env)).status,200);
  await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Dormant sponsor fixture'});
  await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:'source-1',type:'subject',handle:'source-1',position:'0',properties:{text:'A pear orchard beside a stone wall',weight:1}});
  let sequence=0;
  const send=async body=>handleOutputRequirements(new Request(`http://localhost${BASE}`,actorInit({documentId,expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`setup-${++sequence}`,...body})),f.env,BASE,context,outputDocumentExecutionBridge);
  const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const parsed=parseOutputRequirement({id:'output-fixture',type:'Output',subtype:kind==='image'?'Social media image':'Executive summary',content:kind==='image'?'1 image at aspect ratio "1:1"':'1 slideshow with 5 slides'});
  assert.ok(parsed.spec);
  const deliverable=parsed.spec.deliverables.find(d=>d.media_kind===kind);assert.ok(deliverable);
  if(kind==='image') {deliverable.quantity={kind:'exact',unit:'image',value:1};deliverable.coverage={kind:'document_outline'};deliverable.format_variants.forEach(v=>{v.quantity={kind:'exact',unit:'image',value:1};v.required=true;});}
  await ok(await send({action:'save',blockId:parsed.spec.id,spec:parsed.spec}));
  const confirmed=await ok(await send({action:'confirm'}));assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length,1);
  const preflight=await ok(await send({action:'preflight',planRevisionId:confirmed.command.planRevisionId,targetIds:confirmed.snapshot.confirmedPlan.plan.targets.map(target=>target.id)}));
  const terms=preflight.command.preflight;assert.ok(terms.targets.every(target=>target.available),JSON.stringify(terms));
  const command={documentId,action:'authorize',expectedRevision:preflight.snapshot.revision,clientMutationId:'sponsor-authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const request=new Request(`http://localhost${BASE}`,actorInit(command));
  const trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  if(!f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='experience_sponsor_campaigns'").get())for(const sql of SPONSOR_ENTITLEMENT_SCHEMA)f.sqlite.exec(sql);
  const result={...f,documentId,terms,command,request,trusted,send,ok,actor,stream,actorHeaders};
  result.sponsor=async({campaignId='fixture-campaign',payerUserId=payer,changes={},envelopeChanges={},command:cmd=command,trusted:tr=trusted,existingPolicy}={})=>{
    const description=await describeSponsorImageAdmission(tr,cmd),{preflightExpiresAtMs,...native}=description,now=Date.now();
    const policy=existingPolicy??{version:1,mode:'candidate',campaignId,policyVersion:'fixture@1',payerUserId,audience:'canonical-principal',approvalReceiptDigest:`sha256:${'a'.repeat(64)}`,
      startsAtMs:now-60_000,expiresAtMs:now+3_600_000,maximumGrantLifetimeMs:900_000,maximumAdmissions:10,maximumMicrousd:Math.max(1_000_000,native.recipe.maximumMicrousd*10),maximumAdmissionsPerActor:5,
      windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,recipes:[native.recipe],...changes};
    const envelope={version:1,campaignId,policyVersion:policy.policyVersion,consumptionId:`consume-${campaignId}-${actor}-${cmd.clientMutationId}`,intentKey:cmd.clientMutationId,payerUserId,...native,
      issuedAtMs:now-1000,expiresAtMs:Math.min(now+600_000,preflightExpiresAtMs),...envelopeChanges};
    const compiled=await compileSponsorEnvelope(policy,envelope),grantId=`issued-${campaignId}-${actor}-${cmd.clientMutationId}`;
    if(!existingPolicy)f.sqlite.prepare('INSERT INTO experience_sponsor_campaigns(campaign_id,policy_digest,policy_json,enabled) VALUES(?,?,?,1)').run(campaignId,compiled.policyDigest,compiled.policyJson);
    f.sqlite.prepare('INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)').run(grantId,campaignId,compiled.policyDigest,actor,native.sessionDigest,cmd.clientMutationId,compiled.envelopeDigest,envelope.issuedAtMs,envelope.expiresAtMs);
    const authority=await createSponsorAdmissionAuthority({trusted:tr,command:cmd,policy,envelope,grantId});
    return {authority,policy,envelope,grantId,compiled};
  };
  result.execute=(authority,cmd=command,tr=trusted)=>outputExperienceCommands.executeSponsored(tr,cmd,authority,outputDocumentExecutionBridge,context);
  return result;
}

const [{createSponsorExecutionAuthority},{runDocumentJob,handleDocumentJobs},{readWorkspaceEvents}] = await Promise.all([
  import('../worker/experience-sponsor-execution.ts'),import('../worker/document-jobs-api.ts'),import('../worker/runtime.ts'),
]);

async function freshRun(f, {command, clientMutationId='sponsor-run'}={}) {
  const grant=f.sqlite.prepare('SELECT execution.* FROM output_execution_grants execution JOIN output_plan_revisions plan ON plan.scope_key=execution.scope_key AND plan.plan_revision_id=execution.plan_revision_id WHERE plan.document_id=? AND execution.actor_user_id=?').get(f.documentId,f.actor??actor);assert.ok(grant);
  const rawCommand=command??{documentId:f.documentId,action:'run',expectedRevision:`output:${await streamHead(f.env,f.stream??stream)}`,clientMutationId,grantId:grant.grant_id};
  const request=new Request(`http://localhost${BASE}`,{...init(rawCommand),headers:{...init(rawCommand).headers,...f.actorHeaders}});
  const trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  const authority=await createSponsorExecutionAuthority(trusted,rawCommand);
  const job=f.sqlite.prepare('SELECT j.* FROM document_jobs j JOIN output_operation_slots s ON s.job_id=j.job_id WHERE s.grant_id=?').get(grant.grant_id);assert.ok(job);
  return {command:rawCommand,request,trusted,authority,grantId:grant.grant_id,jobId:job.job_id,
    queue:()=>outputExperienceCommands.executeSponsoredRun(trusted,rawCommand,authority,outputDocumentExecutionBridge,context),
    drive:()=>runDocumentJob(f.env,trusted.principal,job.job_id,undefined,authority)};
}

function png(width,height,red=36){
  const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let bit=0;bit<8;bit++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0};
  const chunk=(name,data)=>{const type=Buffer.from(name),body=Buffer.concat([type,data]),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE(crc(body));return Buffer.concat([size,body,check]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*(width*4+1)+1+x*4;pixels[p]=red;pixels[p+1]=120;pixels[p+2]=80;pixels[p+3]=255;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

function installImageTransport(t) {
  const calls=[];let plannerCalls=0,imageCalls=0,safetyCalls=0;
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    const endpoint=String(url);
    assert.ok(['https://api.openai.com/v1/responses','https://api.openai.com/v1/moderations','https://api.openai.com/v1/images/generations'].includes(endpoint),`Unexpected network endpoint: ${endpoint}`);
    const body=JSON.parse(request.body);calls.push({path:new URL(endpoint).pathname,body,signal:request.signal});
    if(endpoint==='https://api.openai.com/v1/responses')return Response.json({id:`direction-${++plannerCalls}`,model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Sheltered orchard',rationale:'Protect mature roots',scene:'Pear trees beside a sheltered orchard path',palette:['green','ochre'],next_moves:['Review tree spacing']}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
    if(endpoint==='https://api.openai.com/v1/moderations')return Response.json({id:`safety-${++safetyCalls}`,model:'omni-moderation-latest',results:[{flagged:false,categories:{}}]});
    const[width,height]=body.size.split('x').map(Number);++imageCalls;
    return Response.json({created:1,data:[{b64_json:png(width,height).toString('base64')}],usage:{input_tokens:120,output_tokens:80,total_tokens:200,input_tokens_details:{text_tokens:120,image_tokens:0}}},{headers:{'x-request-id':`image-${imageCalls}`}});
  });
  return {calls,counts:()=>({plannerCalls,imageCalls,safetyCalls})};
}

export {fixture,rows,actor,payer,stream,context,init,BASE,freshRun,installImageTransport,png,
  outputExperienceCommands,outputDocumentExecutionBridge,loadOutputTrustedContext,streamHead,
  runDocumentJob,handleDocumentJobs,createSponsorExecutionAuthority,readWorkspaceEvents};
