import assert from 'node:assert/strict';
import {fixture,installImageTransport} from './sponsor-driver-fixture.mjs';

// sponsor-driver-fixture retains the real source resolver for the entire test
// lifetime, including lazy imports made during native execution.
const [{driveSponsoredImage},{readWorkspaceEvents},{captureSceneSourceVersion},{canonicalJson,digest},
  {SCENE_SOURCE_GENERATION_TABLES},{SCENE_SOURCE_GENERATION_TRIGGERS}] = await Promise.all([
  import('../worker/experience-sponsor-driver.ts'),import('../worker/runtime.ts'),
  import('../worker/scene-source-generation.ts'),import('../src/experiences/compiler.ts'),
  import('../db/scene-source-generation-tables.ts'),import('../db/scene-source-generations.ts'),
]);

const quoteIdentifier=value=>'"'+value.replaceAll('"','""')+'"';
const readTables=new Set(['experience_sponsor_read_policies','experience_sponsor_read_attempts']);

/** Real admitted native Image lineage in disposable SQLite. The sole provider
 * transport is the existing in-memory Image responder. A pending fixture stops
 * before the durable Run stage is inserted, after actual sponsored admission;
 * it never rewrites a completed job into an invented pending state.
 *
 * Source-witness preparation and optional read-policy installation are explicit
 * fixture setup. Once returned, network and every bucket operation are refused.
 * These fixtures prove local native integration, not provider or launch access. */
export async function sponsorReadFixture(t,{completed=true,prepareReadWitness=true,...nativeOptions}={}){
  const transport=installImageTransport(t),f=await fixture(t,nativeOptions);
  let driverResult=null;
  if(completed){
    driverResult=await driveSponsoredImage(f.request(),f.env,f.context);
    assert.equal(driverResult.status,'completed');
    assert.deepEqual(transport.counts(),{plannerCalls:1,imageCalls:1,safetyCalls:1});
  }else{
    const batch=f.DB.batch,pause=new Error('sponsor-read-fixture paused before Run');let paused=false;
    f.DB.batch=async statements=>{
      if(statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_driver_stages')&&statement.bindings[1]==='run')){
        paused=true;throw pause;
      }
      return batch.call(f.DB,statements);
    };
    try{await assert.rejects(driveSponsoredImage(f.request(),f.env,f.context),error=>error===pause);}
    finally{f.DB.batch=batch;}
    assert.equal(paused,true);
    assert.deepEqual(transport.counts(),{plannerCalls:0,imageCalls:0,safetyCalls:0});
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM experience_sponsor_driver_stages WHERE stage='run'").get().n,0);
  }

  const jobs=f.sqlite.prepare('SELECT * FROM document_jobs WHERE owner_id=? AND document_id=?').all(f.actor,f.documentId);
  assert.equal(jobs.length,1);const job=jobs[0],jobId=job.job_id;
  assert.equal(job.status,completed?'completed':'queued');
  const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE job_id=?').get(jobId);assert.ok(slot);
  assert.equal(slot.status,completed?'succeeded':'authorized');
  const consumption=f.sqlite.prepare('SELECT * FROM experience_sponsor_consumptions WHERE job_id=?').get(jobId);assert.ok(consumption);
  assert.equal(consumption.actor_user_id,f.actor);assert.equal(consumption.campaign_id,f.campaignId);
  const issuance=f.sqlite.prepare('SELECT * FROM experience_sponsor_issuances WHERE grant_id=?').get(consumption.grant_id);assert.ok(issuance);
  const events=await readWorkspaceEvents(f.env,f.stream);
  const completions=events.filter(event=>event.type==='GenerationCompleted'&&event.correlationId===job.correlation_id&&event.payload.document_id===f.documentId);
  assert.equal(completions.length,completed?1:0);
  const completionEvent=completions[0]??null,completedPayload=completionEvent?.payload??null;
  const completionPrivate=completionEvent?f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(completionEvent.eventId):null;
  if(completedPayload){
    assert.equal(completedPayload.simulation,false);assert.equal(typeof completedPayload.media_url,'string');
    assert.equal(slot.outcome_event_id,completionEvent.eventId);assert.ok(completionPrivate);
    assert.equal(completionPrivate.owner_id,f.actor);assert.equal(completionPrivate.document_id,f.documentId);assert.equal(completionPrivate.redacted_at,null);
  }
  if(prepareReadWitness){
    // The native driver fixture initializes its native runtime tables, while
    // witness reads require the exact migration-owned source-version schema.
    // Install those actual definitions explicitly; never bypass certification.
    for(const definition of [...SCENE_SOURCE_GENERATION_TABLES,...SCENE_SOURCE_GENERATION_TRIGGERS]){
      const retained=f.sqlite.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(definition.name);
      if(retained)assert.equal(retained.sql,definition.sql);
      else f.sqlite.exec(definition.sql);
    }
    await captureSceneSourceVersion(f.env,{streamId:f.stream});
  }

  // Only these two dormant schemas are installed here; the fixture does not
  // register a route or invent a production policy installer.
  const [{SPONSOR_READ_POLICY_SCHEMA,readSponsorReadPolicy},{SPONSOR_READ_ATTEMPT_SCHEMA}]=await Promise.all([
    import('../worker/experience-sponsor-read-policy.ts'),import('../worker/experience-sponsor-read-attempts.ts'),
  ]);
  for(const schema of [SPONSOR_READ_POLICY_SCHEMA,SPONSOR_READ_ATTEMPT_SCHEMA]){
    assert.ok(Array.isArray(schema));for(const sql of schema)f.sqlite.exec(sql);
  }
  const installReadPolicy=async policy=>{
    const checked=readSponsorReadPolicy(policy),policyJson=canonicalJson(checked),readPolicyDigest=await digest(checked);
    const sponsorPolicyDigest=issuance.policy_digest;
    // Synthetic review provenance only. This is not payer approval or a public
    // activation API; each test explicitly supplies its own resource limits.
    const reviewReceiptDigest=await digest({fixture:'sponsor-read-policy',campaignId:f.campaignId,sponsorPolicyDigest,readPolicyDigest});
    f.sqlite.prepare('INSERT INTO experience_sponsor_read_policies(campaign_id,sponsor_policy_digest,read_policy_digest,policy_json,review_receipt_digest) VALUES(?,?,?,?,?)')
      .run(f.campaignId,sponsorPolicyDigest,readPolicyDigest,policyJson,reviewReceiptDigest);
    return {policy:checked,policyJson,sponsorPolicyDigest,readPolicyDigest,reviewReceiptDigest};
  };

  const readEffects={fetch:0,mediaGet:0,mediaHead:0,mediaPut:0,mediaDelete:0,mediaList:0};
  t.mock.method(globalThis,'fetch',()=>{readEffects.fetch++;throw new Error('Sponsor read fixture forbids network');});
  for(const operation of ['get','head','put','delete','list']){
    const counter='media'+operation[0].toUpperCase()+operation.slice(1);
    t.mock.method(f.env.MEDIA,operation,()=>{readEffects[counter]++;throw new Error(`Sponsor read fixture forbids MEDIA.${operation}`);});
  }
  const snapshotNativeState=()=>({
    tables:Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .filter(row=>!readTables.has(row.name)).map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM ${quoteIdentifier(name)}`).all()
        .map(row=>canonicalJson(row)).sort()])),
    media:[...f.media].sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>({key,bytes:Buffer.from(item.bytes).toString('base64'),metadata:structuredClone(item.metadata),contentType:item.contentType})),
    providers:transport.counts(),
  });
  const initialNativeState=snapshotNativeState();
  const noReadSideEffects=(before=initialNativeState)=>{
    assert.deepEqual(readEffects,{fetch:0,mediaGet:0,mediaHead:0,mediaPut:0,mediaDelete:0,mediaList:0});
    assert.deepEqual(snapshotNativeState(),before);
  };
  const readRequest=(headerOverrides={},path=`/api/document-jobs/${encodeURIComponent(jobId)}?inspection=1`)=>{
    const headers=new Headers(f.actorHeaders);new Headers(headerOverrides).forEach((value,key)=>headers.set(key,value));
    return new Request(new URL(path,'http://localhost'),{method:'GET',headers});
  };
  return Object.assign(f,{transport,driverResult,jobId,job,slot,consumption,issuance,sponsorPolicyDigest:issuance.policy_digest,completionEvent,completedPayload,completionPrivate,
    readRequest,installReadPolicy,readEffects,snapshotNativeState,noReadSideEffects});
}
