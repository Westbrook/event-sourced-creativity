import assert from 'node:assert/strict';
import test from 'node:test';
import {outputReadModelFixture,outputReadModelDocument,outputReadModelBase} from './output-read-model-fixture.mjs';
const {handleOutputRequirements}=await import('../worker/output-requirements-api.ts');
const {outputDocumentExecutionBridge}=await import('../worker/output-document-execution.ts');

// Actual HTTP handler + native admission bridge + fresh SQLite. Providers are
// forbidden; every catalog file is an inspected, accepted owned-file fixture.
for(const catalog of[65,1000])for(const shared of[false,true])test(
  `${shared?'shared':'personal'} native admission retains ${catalog} accepted files within 50 bindings, including cold schema and lost commit acknowledgment`,
  async context=>{
    let network=0;
    context.mock.method(globalThis,'fetch',async()=>{network++;throw new Error('admission_network_forbidden');});
    const f=await outputReadModelFixture(catalog,{grants:false,shared,sourceReferences:1,sourceClaimsPerObject:4,pageSize:Math.ceil(catalog/8)});
    context.after(()=>f.sqlite.close());
    Object.assign(f.env,{OPENAI_API_KEY:'transport-test-only',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
    assert.equal([...f.media.keys()].filter(key=>key.includes('/read-model-source-')).length,1,'four source claims refer to one retained file');
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.type')='reference'").get().n,4);

    const execution={waitUntil(){throw new Error('admission_background_dispatch_forbidden');}};
    const send=async body=>handleOutputRequirements(new Request(`http://localhost${outputReadModelBase}`,{
      method:'POST',headers:{'content-type':'application/json',...f.requestHeaders},body:JSON.stringify(body),
    }),f.env,outputReadModelBase,execution,outputDocumentExecutionBridge);
    const revision=()=>`output:${f.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id='creative:dev-local-creative'").get().n}`;
    // A new binding identity exercises the actual schema initialization path;
    // no schema-ready marker is installed by the test.
    const coldBinding=()=>{const previous=f.env.DB;f.env.DB={prepare:sql=>previous.prepare(sql),batch:statements=>previous.batch(statements)};};
    const reset=()=>{f.counters.reset();network=0;};
    const evidence=(count,phase,status)=>{
      const result={catalog,shared,count,phase,status,db:f.counters.db,r2List:f.counters.r2List,r2Head:f.counters.r2Head,r2Get:f.counters.r2Get,network,total:f.counters.total+network};
      console.log(JSON.stringify(result));
      assert.equal(network,0);assert.ok(result.total<=50,JSON.stringify(result));
      return result;
    };
    const durableState=()=>Object.fromEntries([
      ...['document_jobs','output_execution_grants','output_operation_slots','budget_reservations','cost_budget_reservations','private_content','output_commands']
        .map(table=>[table,f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]),
      ['reserved_tokens',f.sqlite.prepare('SELECT COALESCE(SUM(reserved_tokens),0) AS n FROM budget_counters').get().n],
      ['reserved_microusd',f.sqlite.prepare('SELECT COALESCE(SUM(reserved_microusd),0) AS n FROM cost_budget_counters').get().n],
    ]);
    let cursor=0,sequence=0;
    const grantInput=async count=>{
      const targets=f.plan.plan.targets.slice(cursor,cursor+count);assert.equal(targets.length,count);
      const response=await send({documentId:outputReadModelDocument,expectedRevision:revision(),clientMutationId:`catalog-preflight-${++sequence}`,action:'preflight',planRevisionId:f.plan.revisionId,targetIds:targets.map(target=>target.id)});
      const preflight=await response.json();assert.equal(response.status,200,JSON.stringify(preflight));
      const terms=preflight.command.preflight;assert.ok(terms.targets.every(target=>target.available),JSON.stringify(terms));
      return {targets,body:{documentId:outputReadModelDocument,expectedRevision:preflight.snapshot.revision,clientMutationId:`catalog-authorize-${sequence}`,action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true}};
    };
    const assertCompleteSnapshot=value=>{
      assert.equal(value.snapshot.confirmedPlan.plan.targets.length,catalog);
      assert.equal(value.snapshot.assets.length,catalog,'the response retains the complete accepted catalog');
      assert.equal(value.snapshot.confirmedPlan.revisionId,f.plan.revisionId);
    };
    let loseGrantCommitAcknowledgment=false,loseStartCommitAcknowledgment=false;
    const batch=f.DB.batch.bind(f.DB);
    f.DB.batch=async statements=>{
      const loseGrant=loseGrantCommitAcknowledgment&&statements.some(statement=>/^INSERT INTO output_execution_grants/u.test(statement.sql));
      const loseStart=loseStartCommitAcknowledgment&&statements.some(statement=>statement.sql.startsWith("UPDATE output_operation_slots SET status='queued'"));
      const result=await batch(statements);
      if(loseGrant){loseGrantCommitAcknowledgment=false;throw new Error('injected_admission_commit_acknowledgment_lost');}
      if(loseStart){loseStartCommitAcknowledgment=false;throw new Error('injected_start_commit_acknowledgment_lost');}
      return result;
    };

    for(const cold of[false,true])for(const count of[1,2,4,16]){
      const {targets,body}=await grantInput(count);
      if(cold)coldBinding();
      loseGrantCommitAcknowledgment=cold;
      reset();
      const response=await send(body),value=await response.json();
      const measured=evidence(count,cold?'cold-commit-ack-lost':'warm',response.status);
      assert.equal(response.status,200,JSON.stringify(value));
      assert.equal(loseGrantCommitAcknowledgment,false);
      assert.equal(value.replayed,cold);
      assertCompleteSnapshot(value);
      assert.equal(measured.r2List,8);assert.equal(measured.r2Head,2);
      const slots=f.sqlite.prepare('SELECT target_id,job_id,cost_reservation_id,token_reservation_id FROM output_operation_slots WHERE grant_id=?').all(value.command.grantId);
      assert.deepEqual(slots.map(slot=>slot.target_id).sort(),targets.map(target=>target.id).sort());
      assert.equal(new Set(slots.map(slot=>slot.job_id)).size,count);
      cursor+=count;
      const before=durableState();
      assert.equal(before.document_jobs,cursor);assert.equal(before.output_operation_slots,cursor);
      assert.equal(before.budget_reservations,cursor);assert.equal(before.cost_budget_reservations,cursor);
      reset();
      const replay=await send(body),repeated=await replay.json();
      evidence(count,'identical-replay',replay.status);
      assert.equal(replay.status,200,JSON.stringify(repeated));assert.equal(repeated.replayed,true);
      assert.equal(repeated.command.grantId,value.command.grantId);assertCompleteSnapshot(repeated);
      assert.deepEqual(durableState(),before,'replay does not duplicate jobs, grants, private receipts or reservations');

      const runBody={documentId:outputReadModelDocument,expectedRevision:revision(),clientMutationId:`catalog-start-${sequence}`,action:'run',grantId:value.command.grantId};
      if(cold)coldBinding();loseStartCommitAcknowledgment=cold;reset();
      const started=await send(runBody),queued=await started.json();evidence(count,cold?'start-cold-commit-ack-lost':'start-warm',started.status);
      assert.equal(started.status,200,JSON.stringify(queued));assert.equal(loseStartCommitAcknowledgment,false);assert.equal(queued.replayed,cold);assertCompleteSnapshot(queued);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_operation_slots WHERE grant_id=? AND status='queued'").get(value.command.grantId).n,count);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_provider_calls").get().n,0,'Start only queues existing jobs');
      const afterStart=durableState();for(const key of Object.keys(before).filter(key=>key!=='output_commands'))assert.equal(afterStart[key],before[key],key);
      reset();const runReplay=await send(runBody),runAgain=await runReplay.json();evidence(count,'start-identical-replay',runReplay.status);
      assert.equal(runReplay.status,200,JSON.stringify(runAgain));assert.equal(runAgain.replayed,true);assertCompleteSnapshot(runAgain);
      assert.deepEqual(durableState(),afterStart,'Start replay cannot create another job, grant, reservation or receipt');
    }

    // Fail the fourth of sixteen prepared children after earlier children have
    // run in the same transaction. All prior grants and files must survive.
    const {body}=await grantInput(16),before=durableState();
    f.sqlite.exec(`CREATE TRIGGER fail_catalog_child BEFORE INSERT ON document_jobs WHEN (SELECT COUNT(*) FROM document_jobs)=${before.document_jobs+3} BEGIN SELECT RAISE(ABORT,'injected_late_catalog_child_failure'); END;`);
    coldBinding();reset();
    const failed=await send(body);evidence(16,'cold-late-child-failure',failed.status);
    assert.equal(failed.status,500);assert.deepEqual(durableState(),before);
    f.sqlite.exec('DROP TRIGGER fail_catalog_child');
    reset();
    const retry=await send(body),retried=await retry.json();evidence(16,'same-command-after-rolled-back-failure',retry.status);
    assert.equal(retry.status,200,JSON.stringify(retried));assert.equal(retried.replayed,false);assertCompleteSnapshot(retried);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,cursor+16);
  },
);
