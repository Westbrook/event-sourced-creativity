import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,realpathSync,existsSync,openSync,writeSync,closeSync,renameSync,readdirSync} from 'node:fs';
import {isAbsolute,resolve,relative,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {fixture as intakeFixture,responseBody,bytes,count,rows,snapshot,observeDatabase as observeNativeDatabase,headersFor,requestFor,databaseClock,queryLimits}
  from './experience-sponsor-audio-intake-native-fixture.mjs';
import {compileSqliteExpressionDepth} from './helpers/d1-expression-depth.mjs';
const [{prepareSponsorAudioDraft,commitSponsorAudioDraft},{canonicalJson},{receiptPrefix},policy,approval,attempts,{SPONSOR_DRIVER_SCHEMA},{SPONSOR_ISSUER_SCHEMA},transport]=await Promise.all([
  import('../worker/experience-sponsor-audio-intake.ts'),import('../src/experiences/compiler.ts'),import('../src/experiences/intake.ts'),
  import('../worker/experience-sponsor-audio-output-policy.ts'),import('../worker/experience-sponsor-audio-output-approval.ts'),
  import('../worker/experience-sponsor-audio-output-attempts.ts'),import('../worker/experience-sponsor-driver.ts'),
  import('../worker/experience-sponsor-issuer.ts'),import('../src/experiences/sponsor-audio-review-transport.ts')]);
export {responseBody,bytes,count,rows,snapshot,headersFor,canonicalJson,transport,attempts};
const sourcePaths=[
  'worker/experience-sponsor-audio-output-reads.ts','worker/experience-sponsor-audio-output-native.ts','worker/experience-sponsor-audio-output.ts',
  'worker/experience-output-api.ts','worker/output-document-execution.ts','worker/output-audio-source.ts','worker/output-audio-sponsored-handoff.ts',
  'worker/experience-sponsor-audio-actor-evidence.ts','worker/experience-sponsor-audio-evidence.ts','worker/experience-sponsor-audio-authorize.ts',
  'worker/experience-sponsor-approval.ts','tests/helpers/d1-expression-depth.mjs','tests/output-execution-test-helpers.mjs','tests/experience-sponsor-audio-intake-native-fixture.mjs',
  'tests/experience-sponsor-audio-output-review-authorize-fixture.mjs','tests/experience-sponsor-audio-output-review-authorize.test.mjs'];
const sourcePins=()=>Object.fromEntries(sourcePaths.map(path=>{const value=readFileSync(new URL(`../${path}`,import.meta.url));
  return [path,{sha256:createHash('sha256').update(value).digest('hex'),bytes:value.byteLength}];}));
function evidenceDirectory(){
  const directory=process.env.FORMA_AUDIO_REVIEW_AUTHORIZE_EVIDENCE_DIR;
  if(!directory)return null;
  const root=process.env.FORMA_AUDIO_REVIEW_AUTHORIZE_EVIDENCE_ROOT;
  assert.ok(root&&isAbsolute(root)&&isAbsolute(directory),'Evidence requires an explicitly supplied absolute report root and run directory');
  const inside=(parent,child)=>{const part=relative(parent,child);return part!==''&&!part.startsWith('..')&&!isAbsolute(part);};
  assert.ok(inside(resolve(root),resolve(directory)),'Evidence directory must be inside the explicitly supplied report root');
  const actualRoot=realpathSync(root);let ancestor=resolve(directory);
  while(!existsSync(ancestor)){const parent=dirname(ancestor);assert.notEqual(parent,ancestor);ancestor=parent;}
  const actualAncestor=realpathSync(ancestor);assert.ok(actualAncestor===actualRoot||inside(actualRoot,actualAncestor),'Existing directory symlinks cannot escape the report root');
  mkdirSync(directory,{recursive:true});const actualDirectory=realpathSync(directory);
  assert.ok(inside(actualRoot,actualDirectory),'Evidence symlinks cannot escape the supplied report root');return actualDirectory;
}
export function evidence(f,name,value){
  if(!f.evidenceDirectory)return;
  const label=`${f.testName}-${name}`.replace(/[^a-z0-9]+/giu,'-').slice(0,100);
  const suffix=createHash('sha256').update(`${f.testName}:${name}`).digest('hex').slice(0,12);
  writeFileSync(join(f.evidenceDirectory,`${label}-${suffix}-${process.hrtime.bigint()}.json`),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}

// This fixture-only format streams the recorded SQL, typed bindings and ACKs.
// A completion manifest proves capture completeness, never native acceptance.
export function persistActualTrace(f,sourceAfter,{write=writeSync,chunkBytes=65536}={}){
  const stable=()=>assert.deepEqual(sourceAfter,f.sourceBefore,'Source and helper postimages did not change during this native case');
  if(!f.evidenceDirectory){stable();return;}
  const format='forma-audio-actual-trace@1',handles=new Set(),active=new WeakSet();
  const counts={traces:0,entries:0,statements:0,acknowledgements:0,nodes:0,blobs:0,blobBytes:0};
  let directory,indexFd,indexBytes=0,nodeId=0,blobId=0,address={phase:'setup'};
  const indexHash=createHash('sha256');
  const open=path=>{const fd=openSync(path,'wx');handles.add(fd);return fd;};
  const close=fd=>{closeSync(fd);handles.delete(fd);};
  const writeBytes=(fd,buffer,accepted)=>{
    for(let offset=0;offset<buffer.length;){
      const length=Math.min(chunkBytes,buffer.length-offset),written=write(fd,buffer,offset,length);
      assert.ok(Number.isInteger(written)&&written>0&&written<=length,'Evidence write must make finite progress');
      accepted?.(buffer.subarray(offset,offset+written));offset+=written;
    }
  };
  const index=record=>{
    const previous=address;address={...address,phase:'index-write'};
    // Every value-bearing string is a separate piece. Only small fixed metadata
    // and property keys of at most 1024 code units enter these JSON records.
    const buffer=Buffer.from(JSON.stringify(record)+'\n');
    assert.ok(buffer.length<=16384,'Evidence index record must remain small');
    writeBytes(indexFd,buffer,part=>{indexHash.update(part);indexBytes+=part.length;});address=previous;
  };
  const blob=(value,encoding)=>{
    const id=`b${++blobId}`,path=`pieces/${id}.bin`,previous=address;
    address={...address,phase:'blob-open',blobId:id};const fd=open(join(directory,path)),hash=createHash('sha256');let total=0;
    if(encoding==='utf16le'){
      for(let offset=0;offset<value.length;offset+=chunkBytes/2){
        address={...previous,phase:'blob-write',blobId:id,chunkOffset:offset*2};
        const buffer=Buffer.from(value.slice(offset,offset+chunkBytes/2),'utf16le');
        writeBytes(fd,buffer,part=>{hash.update(part);total+=part.length;});
      }
    }else{
      for(let offset=0;offset<value.byteLength;offset+=chunkBytes){
        address={...previous,phase:'blob-write',blobId:id,chunkOffset:offset};
        const buffer=Buffer.from(value.buffer,value.byteOffset+offset,Math.min(chunkBytes,value.byteLength-offset));
        writeBytes(fd,buffer,part=>{hash.update(part);total+=part.length;});
      }
    }
    address={...previous,phase:'blob-close',blobId:id};close(fd);
    index({kind:'blob',id,path,encoding,bytes:total,sha256:hash.digest('hex')});counts.blobs++;counts.blobBytes+=total;address=previous;return id;
  };
  const field=(value,key)=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    assert.ok(descriptor&&Object.hasOwn(descriptor,'value'),'Evidence fields must be own data properties');return descriptor.value;
  };
  const plain=value=>assert.ok(value!==null&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),
    'Evidence records must be ordinary objects');
  const keys=value=>{
    const result=Reflect.ownKeys(value);assert.ok(result.every(key=>typeof key==='string'),'Evidence cannot omit symbol fields');return result;
  };
  const shape=(value,expected)=>{plain(value);assert.deepEqual(keys(value).sort(),[...expected].sort(),'Unexpected evidence record fields');};
  const list=value=>{
    assert.ok(Array.isArray(value),'Evidence sequence must be an array');
    assert.equal(keys(value).length,value.length+1,'Evidence sequences must be dense without extra fields');
    for(let position=0;position<value.length;position++)field(value,String(position));return value;
  };
  const property=(key,descriptor)=>({key:key.length<=1024?key:{blob:blob(key,'utf16le')},
    descriptor:{enumerable:descriptor.enumerable,configurable:descriptor.configurable,writable:descriptor.writable}});
  const valueNode=(value,edge={})=>{
    const id=`n${++nodeId}`,node={kind:'node',id,...edge};
    if(value===null)node.type='null';
    else if(value===undefined)node.type='undefined';
    else if(typeof value==='string'){node.type='string';node.blob=blob(value,'utf16le');}
    else if(typeof value==='number'){assert.ok(Number.isFinite(value),'Evidence numbers must be finite');node.type='number';node.value=Object.is(value,-0)?'-0':String(value);}
    else if(typeof value==='boolean'){node.type='boolean';node.value=value;}
    else if(value instanceof Uint8Array){
      assert.equal(Object.getPrototypeOf(value),Uint8Array.prototype,'ACK byte arrays must be ordinary Uint8Array values');
      assert.equal(keys(value).length,value.byteLength,'Evidence cannot omit byte-array properties');node.type='blob';node.blob=blob(value,'bytes');
    }
    else{
      assert.equal(typeof value,'object','Evidence cannot coerce unsupported values');
      assert.ok(!active.has(value),'Evidence cannot omit a cyclic value');
      if(Array.isArray(value)){
        assert.equal(Object.getPrototypeOf(value),Array.prototype,'Evidence arrays must use the ordinary prototype');
        node.type='array';node.length=value.length;
      }else{plain(value);node.type='object';node.prototype=Object.getPrototypeOf(value)===null?'null':'object';}
      index(node);counts.nodes++;active.add(value);
      try{
        for(const key of keys(value)){
          if(node.type==='array'&&key==='length')continue;
          const descriptor=Object.getOwnPropertyDescriptor(value,key);
          assert.ok(descriptor&&Object.hasOwn(descriptor,'value'),'Evidence cannot invoke accessors');
          valueNode(descriptor.value,{parent:id,...property(key,descriptor)});
        }
      }finally{active.delete(value);}
      return id;
    }
    index(node);counts.nodes++;return id;
  };
  const root=(name,value,context={})=>{
    address={phase:'encode',root:name,...context};const id=valueNode(value);index({kind:'root',name,context,id});return id;
  };
  const bindingsRoot=(values,context)=>{
    address={phase:'encode',root:'typedBindings',...context};list(values);
    const id=`n${++nodeId}`;index({kind:'node',id,type:'array',length:values.length});counts.nodes++;
    for(let position=0;position<values.length;position++){
      address={phase:'encode',root:'typedBindings',...context,bindingIndex:position};
      valueNode(capturedBinding(field(values,String(position))),{parent:id,key:String(position),descriptor:{enumerable:true,configurable:true,writable:true}});
    }
    index({kind:'root',name:'typedBindings',context,id});
  };
  try{
    assert.ok(Number.isInteger(chunkBytes)&&chunkBytes>=2&&chunkBytes<=65536&&chunkBytes%2===0,'Evidence chunks must be even and at most 64 KiB');
    assert.equal(typeof write,'function');assert.ok(isAbsolute(f.evidenceDirectory),'Evidence directory must be absolute');
    assert.ok(typeof f.testName==='string'&&f.testName.length<=1024,'Evidence test name must remain bounded');
    const label=f.testName.replace(/[^a-z0-9]+/giu,'-').slice(0,80);
    directory=join(f.evidenceDirectory,`${label}-actual-trace-${process.hrtime.bigint()}`);mkdirSync(directory);mkdirSync(join(directory,'pieces'));
    indexFd=open(join(directory,'index.jsonl'));
    root('sourceBefore',f.sourceBefore);root('sourceAfter',sourceAfter);root('schema',f.evidenceSchema);root('original',f.evidenceOriginal);
    list(f.traces);
    for(let traceIndex=0;traceIndex<f.traces.length;traceIndex++){
      const trace=field(f.traces,String(traceIndex));shape(trace,['application','records']);
      const application=field(trace,'application'),records=list(field(trace,'records'));
      assert.ok(typeof application==='string'&&application.length<=1024,'Evidence application label must remain bounded');
      address={phase:'trace',traceIndex};index({kind:'trace',traceIndex,application});counts.traces++;
      for(let entryIndex=0;entryIndex<records.length;entryIndex++){
        const entry=field(records,String(entryIndex)),context={traceIndex,entryIndex};plain(entry);
        const metadata=Object.create(Object.getPrototypeOf(entry));
        for(const key of keys(entry))if(key!=='statements'&&key!=='result'){
          const descriptor=Object.getOwnPropertyDescriptor(entry,key);assert.ok(Object.hasOwn(descriptor,'value'),'Evidence cannot invoke entry accessors');
          Object.defineProperty(metadata,key,descriptor);
        }
        root('entry',metadata,context);counts.entries++;
        const statements=list(field(entry,'statements'));
        for(let statementIndex=0;statementIndex<statements.length;statementIndex++){
          const part=field(statements,String(statementIndex)),location={...context,statementIndex};shape(part,['sql','bindings']);
          const sql=field(part,'sql');assert.equal(typeof sql,'string');address={phase:'statement',...location};index({kind:'statement',...location});
          root('sql',sql,location);bindingsRoot(field(part,'bindings'),location);counts.statements++;
        }
        if(Object.hasOwn(entry,'result')){
          const ack=field(entry,'result');root('ack',ack,context);counts.acknowledgements+=Array.isArray(ack)?ack.length:1;
        }
      }
    }
    address={phase:'index-close'};close(indexFd);
    address={phase:'source-assertion'};stable();
    const completion={version:1,format,captureComplete:true,qualificationVerdict:false,testName:f.testName,
      index:{path:'index.jsonl',bytes:indexBytes,sha256:indexHash.digest('hex')},counts};
    address={phase:'completion-write'};const partial=join(directory,'completion.json.partial'),fd=open(partial);
    writeBytes(fd,Buffer.from(JSON.stringify(completion,null,2)+'\n'));address={phase:'completion-close'};close(fd);
    address={phase:'completion-rename'};const path=join(directory,'completion.json');renameSync(partial,path);return {directory,completion:path};
  }catch(error){
    // Native after-hooks can suppress their error when the body already failed.
    // Keep a separate failure receipt and stderr message, then rethrow identity.
    for(const fd of handles)try{closeSync(fd);}catch{ /* Keep the original persistence failure. */ }
    try{
      const receipt={format,captureComplete:false,testName:typeof f.testName==='string'?f.testName.slice(0,1024):'<invalid>',directory,
        address,error:tracePersistenceError(error),completed:{counts,indexBytes}};
      let failureReceiptWritten=false;
      try{if(directory){writeFileSync(join(directory,'failure.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});failureReceiptWritten=true;}}catch{ /* Keep the original persistence failure. */ }
      try{writeSync(2,`FORMA_AUDIO_TRACE_PERSISTENCE_FAILURE ${JSON.stringify({...receipt,failureReceiptWritten})}\n`);}catch{ /* Keep the original persistence failure. */ }
    }catch{
      try{writeSync(2,'FORMA_AUDIO_TRACE_PERSISTENCE_FAILURE failure reporting also failed; original error is rethrown\n');}catch{ /* Keep the original persistence failure. */ }
    }
    throw error;
  }
}
function tracePersistenceError(error){
  // Errors originate in this writer, assert or the native filesystem. Read only
  // own data properties; reporting cannot call an accessor or mask the cause.
  const result={name:error instanceof Error?'Error':typeof error,message:'<unavailable own error message>'};
  if(error instanceof Error){
    const prototype=Object.getPrototypeOf(error),descriptor=prototype&&Object.getOwnPropertyDescriptor(prototype,'name');
    if(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string')result.name=descriptor.value.slice(0,4096);
  }
  for(const key of ['name','message','code']){
    const descriptor=error!==null&&(typeof error==='object'||typeof error==='function')?Object.getOwnPropertyDescriptor(error,key):undefined;
    if(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'){
      result[key]=descriptor.value.slice(0,4096);if(descriptor.value.length>4096)result[`${key}Truncated`]=true;
    }
  }
  return result;
}

export function observeDatabase(f,options={}){
  const observed=observeNativeDatabase(f,options);f.traces.push({application:'Node-hosted native SQLite application',records:observed.records});return observed;
}
export const outputIO='experience_sponsor_audio_output_read_attempts';
export const authorizationTables=['experience_sponsor_driver_intents','experience_sponsor_driver_stages','experience_sponsor_grants',
  'experience_sponsor_issuances','experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs',
  'output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters'];
export const businessSnapshot=f=>snapshot(f,{exclude:[outputIO]});
export function readPolicy(now){
  const allowance={maximumRequestsPerWindow:100,maximumBytesPerWindow:800_000_000,maximumQueriesPerWindow:1_000_000,maximumRowsPerWindow:10_000_000};
  return {version:1,family:'canonical-audio-output-read@1',purpose:'native-output-continuation',startsAtMs:now-60000,expiresAtMs:now+3600000,windowMs:60000,
    operations:Object.fromEntries(['audio-output-state','audio-output-prepare','audio-output-review','audio-output-authorize']
      .map(operation=>[operation,{maximumBytes:8_000_000,deadlineMs:30000,maximumQueries:10000,maximumRows:100000}])),actor:{...allowance},campaign:{...allowance}};
}
export function assertNoRun(f){
  assert.equal(count(f,'output_provider_calls'),0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='run'").get().n,0);
  for(const job of rows(f,'document_jobs')){assert.equal(job.status,'queued');assert.equal(job.attempt_count,0);}
  assert.deepEqual(f.effects,{media:0,assets:0});assert.equal(f.detached,0);assert.equal(f.media.size,0);assert.deepEqual(f.network,[]);
}
export function originalEvents(f){
  return f.sqlite.prepare(`SELECT receipt.client_event_id,event.type,event.event_id,event.sequence,secret.private_json
    FROM event_client_receipts receipt JOIN events event ON event.event_id=receipt.event_id
    JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE receipt.stream_id=? AND substr(receipt.client_event_id,1,?)=? ORDER BY event.sequence`)
    .all(f.stream,receiptPrefix(f.plan.draftId).length,receiptPrefix(f.plan.draftId)).map(row=>({...row}));
}
export function assertOriginalIntake(f){
  const actual=originalEvents(f);assert.equal(actual.length,f.plan.events.length);
  for(const [index,event]of f.plan.events.entries()){
    assert.equal(actual[index].type,event.type);assert.equal(actual[index].client_event_id,event.payload.client_event_id);
    assert.equal(actual[index].private_json,JSON.stringify(event.payload));
  }
  const draft=f.sqlite.prepare('SELECT content,expires_at FROM private_content WHERE content_id=?').get(f.plan.draftId);
  assert.equal(draft.content,canonicalJson(f.plan));assert.equal(draft.expires_at,f.intake.expiresAt);return actual;
}
export function assertOneAuthorization(f,ack){
  for(const table of authorizationTables.slice(0,12))assert.equal(count(f,table),1,table);
  for(const table of ['budget_reservations','cost_budget_reservations'])assert.equal(rows(f,table)[0].owner_id,f.payer,table);
  if(f.actorFinancialBefore)assert.deepEqual(actorCounters(f),f.actorFinancialBefore,'Actor budget counters remain unchanged');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='authorize'").get().n,1);
  const grant=f.sqlite.prepare('SELECT * FROM output_execution_grants').get(),job=f.sqlite.prepare('SELECT * FROM document_jobs').get();
  assert.equal(grant.payer_user_id,f.payer);assert.equal(grant.status,'authorized');assert.equal(job.status,'queued');
  const command=f.sqlite.prepare("SELECT * FROM output_commands WHERE action='authorize'").get();
  const event=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(command.event_id).private_json);
  if(ack){assert.equal(ack.receipt.eventId,command.event_id);assert.equal(ack.receipt.key,command.command_key);assert.equal(ack.grantId,grant.grant_id);
    assert.equal(ack.jobId,job.job_id);assert.equal(ack.grantId,event.grant_id);assert.equal(grant.authorization_event_id,command.event_id);}
  assertNoRun(f);return {grant,job,command,event};
}
export const actorCounters=f=>Object.fromEntries(['budget_counters','cost_budget_counters'].map(table=>[table,rows(f,table).filter(row=>row.scope==='user'&&row.scope_id===f.actor)]));
export async function refused(action){
  let result;try{result=await action();}catch(error){if(error?.code==='ERR_ASSERTION')throw error;assert.ok(error instanceof Error);return error;}
  assert.ok(result instanceof Response);assert.ok(result.status>=400,`Unexpected successful response: ${await result.text()}`);return result;
}
// One real test after-hook owns the reviewed fixture callbacks and any D1 runtime.
// Node's after hooks are FIFO and stop at the first failed hook. Preserve every
// callback and its order, but complete all callbacks before the runtime finalizer.
const fixtureLifecycles=new WeakMap();
function cleanupFailure(testName,phase,error){
  try{writeSync(2,`FORMA_AUDIO_FIXTURE_CLEANUP_FAILURE ${JSON.stringify({testName,phase,error:tracePersistenceError(error)})}\n`);}catch{ /* The original cleanup error remains in the thrown aggregate. */ }
}
function fixtureLifecycle(t){
  const callbacks=[];let finalizer,restoreFetch;
  t.after(async()=>{
    const failures=[];
    for(const [index,callback]of callbacks.entries()){
      try{await callback();}catch(error){failures.push(error);cleanupFailure(t.name,`fixture-callback-${index}`,error);}
    }
    if(finalizer)try{await finalizer();}catch(error){failures.push(error);cleanupFailure(t.name,'runtime-finalizer',error);}
    // Node resets its MockTracker after this hook, even when the body failed.
    // Own this fetch trap here so that automatic reset cannot unwrap a retained
    // host guard. Restore the borrowed descriptor only after that guard released.
    if(restoreFetch&&!activeHostGuard)try{restoreFetch();}catch(error){failures.push(error);cleanupFailure(t.name,'fixture-fetch-restore',error);}
    if(failures.length)throw new AggregateError(failures,'Audio fixture callbacks or owned runtime cleanup failed');
  });
  return {after(callback){assert.equal(typeof callback,'function');callbacks.push(callback);},
    ownFetch(handler){
      assert.equal(restoreFetch,undefined);const descriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');
      assert.ok(descriptor&&Object.hasOwn(descriptor,'value'),'Fixture fetch is a borrowed data property');
      Object.defineProperty(globalThis,'fetch',{...descriptor,value:handler});
      restoreFetch=()=>Object.defineProperty(globalThis,'fetch',descriptor);
    },
    ownRuntime(callback){assert.equal(finalizer,undefined,'One D1 runtime owner per fixture');assert.equal(typeof callback,'function');finalizer=callback;}};
}
/** Synthetic native accounts, explicit native campaign/intake/C approvals, actual
 * registered Context intake and actual initial SAVE/confirm/preflight. Nothing
 * seeds a quote, principal, receipt, grant, sponsor intent or admission row. */
export async function preparedFixture(t,{detail='',configurePolicy,prepare=true}={}){
  assert.equal(activeHostGuard,false,'An unclosed D1 runtime forbids another prepared fixture in this process');
  const lifecycle=fixtureLifecycle(t);
  // The frozen intake fixture uses only after(callback) from this argument.
  // Its setup, application, SQLite database and original callback bodies remain native.
  const f=await intakeFixture({after:lifecycle.after},{detail,strict:false});fixtureLifecycles.set(f,lifecycle);
  Object.assign(f,{testName:t.name,evidenceDirectory:evidenceDirectory(),traces:[],sourceBefore:sourcePins()});
  lifecycle.after(()=>{
    let sourceAfter;
    try{sourceAfter=sourcePins();}catch(error){
      try{writeSync(2,`FORMA_AUDIO_TRACE_PERSISTENCE_FAILURE ${JSON.stringify({phase:'source-pins',testName:f.testName,error:tracePersistenceError(error)})}\n`);}catch{ /* Keep the original persistence failure. */ }
      throw error;
    }
    persistActualTrace(f,sourceAfter);
  });
  f.network=[];lifecycle.ownFetch(async(...args)=>{f.network.push(args);throw Error('Audio review/authorize has no network authorization');});
  f.intake=await responseBody(await prepareSponsorAudioDraft(f.prepareRequest(),f.env));f.plan=f.intake.plan;
  assert.equal(f.plan.events.length,detail?6:5);assert.equal(f.intake.status,'prepared');
  f.committed=await responseBody(await commitSponsorAudioDraft(f.commitRequest(f.plan),f.env));assert.equal(f.committed.status,'complete');
  assert.equal(f.committed.appended.length,f.plan.events.length);
  for(const schema of [policy.SPONSOR_AUDIO_OUTPUT_READ_POLICY_SCHEMA,approval.SPONSOR_AUDIO_OUTPUT_READ_APPROVAL_SCHEMA,
    attempts.SPONSOR_AUDIO_OUTPUT_READ_ATTEMPTS_SCHEMA,SPONSOR_DRIVER_SCHEMA,SPONSOR_ISSUER_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  const now=Number(f.sqlite.prepare(`SELECT ${databaseClock} AS now`).get().now);f.outputPolicy=readPolicy(now);configurePolicy?.(f.outputPolicy);
  const proposal={version:1,family:'canonical-audio-output-read@1',campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy:f.outputPolicy};
  const review=await approval.prepareSponsorAudioOutputReadApproval(requestFor(f,{action:'prepare-sponsor-audio-output-read-policy',proposal},{actorUserId:f.payer}),f.env);
  f.outputApproval=await approval.approveSponsorAudioOutputReadPolicy(requestFor(f,{action:'approve-sponsor-audio-output-read-policy',
    approvalId:'fixture-review-authorize-audio-read',proposal,reviewedTermsDigest:review.termsDigest,confirmation:'APPROVE_SPONSOR_AUDIO_OUTPUT_READ_POLICY'},{actorUserId:f.payer}),f.env);
  f.detached=0;f.executionContext={waitUntil(){f.detached++;throw Error('Audio review/authorize cannot detach work');}};
  f.outputRequest=(operation='review',{body,rawBody,signal,headers={},draftId=f.plan.draftId,url}={})=>{
    const get=operation==='review'||operation==='state';
    const path=operation==='review'?`/api/experiences/sponsor/audio/drafts/${draftId}/review`:
      `/api/experiences/drafts/${draftId}/output${operation==='state'?'':`/${operation}`}`;
    const actual=rawBody??(get?undefined:JSON.stringify(body??{draftHash:f.plan.draftHash,explicitRequirementsConfirmation:true}));
    return new Request(url??`http://localhost${path}`,{method:get?'GET':'POST',headers:{...headersFor(f.actor),...(get?{}:{'content-type':'application/json'}),...headers},
      ...(signal?{signal}:{}),...(get?{}:{body:actual,...(actual instanceof ReadableStream?{duplex:'half'}:{})})});
  };
  f.original=assertOriginalIntake(f);f.evidenceOriginal={plan:f.plan,intake:f.intake,committed:f.committed,events:f.original};
  f.evidenceSchema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all().map(row=>({...row}));lifecycle.after(()=>{assert.deepEqual(f.effects,{media:0,assets:0});assert.equal(f.detached,0);assert.deepEqual(f.network,[]);});
  if(prepare)await prepareInitial(f);f.actorFinancialBefore=actorCounters(f);return f;
}
export async function prepareInitial(f){
  const {handleSponsorAudioOutputInitial}=await import('../worker/experience-sponsor-audio-output.ts');
  f.prepared=await responseBody(await handleSponsorAudioOutputInitial(f.outputRequest('prepare'),f.env,f.executionContext));
  assert.equal(f.prepared.status,'review');assert.equal(f.prepared.stage,'preflight');assert.equal(f.prepared.grant,null);
  assert.equal(f.prepared.preflight.planRevisionId,f.prepared.plan.revisionId);return f.prepared;
}
export async function continuation(f,{operation='review',request,...options}={}){
  const {handleSponsorAudioOutputReviewAuthorize}=await import('../worker/experience-sponsor-audio-output.ts');
  return handleSponsorAudioOutputReviewAuthorize(request??f.outputRequest(operation,options),f.env,f.executionContext);
}
/** Explicit synthetic actor input is constructed only when an authorization
 * test calls this operation. Passive review never implies a consent gesture. */
export async function actorMessage(f,shown){
  const body={draftHash:f.plan.draftHash,termsDigest:shown.review.termsDigest,maximumMicrousd:shown.review.preview.maximumMicrousd,explicitAuthorization:true,
    audioCostConsent:{...structuredClone(shown.review.preview),confirmed:true,providerTransferConfirmed:true},
    sponsorReview:{campaignId:shown.review.campaignId,reviewDigest:shown.reviewDigest}};
  const message=await transport.prepareSponsorAudioAuthorize(shown,body);return {body,message};
}
export async function readyActor(f){
  const shown=await responseBody(await continuation(f));const {body,message}=await actorMessage(f,shown);
  return {shown,body,message,request:f.outputRequest('authorize',{rawBody:message.body})};
}
/** Real reserve/take/open permits inspection while the actual owner is live.
 * Both continuations and final disclosure are the genuine native functions. */
export async function ownedContinuation(t,f,request,operation){
  const attempt=await attempts.reserveSponsorAudioOutputReadAttempt(request,f.env,{operation:`audio-output-${operation}`,draftId:f.plan.draftId});
  const budget=await attempts.takeSponsorAudioOutputReadAttempt(attempt,request,f.env),view=attempts.requireSponsorAudioOutputReadBudget(budget,request,f.env);
  const reads=await import('../worker/experience-sponsor-audio-output-reads.ts'),api=await import('../worker/experience-output-api.ts');
  const owner=await reads.openSponsorAudioOutputReads(request,f.env,budget);t.after(()=>reads.closeSponsorAudioOutputReads(owner));
  return {request,attempt,budget,view,owner,reads,run:()=>api.continueSponsorAudioOutputReviewAuthorize(owner,f.executionContext),
    disclose:response=>reads.discloseSponsorAudioOutputResponse(owner,response)};
}
/** Observe only readers acquired from native clones of this original Request.
 * Every wrapper calls its original method and returns the original object/result;
 * no stream chunk, parser, Request, native DTO or successful ACK is fabricated. */
export function observeBodyPasses(t,raw,{request,view,onChunk,onRead}={}){
  assert.ok(request instanceof Request);
  const clone=Request.prototype.clone,getReader=ReadableStream.prototype.getReader,read=ReadableStreamDefaultReader.prototype.read;
  const requests=new WeakSet([request]),bodies=new WeakSet(),readers=new WeakMap(),parts=[],readerStates=[];
  const bodyOf=value=>Object.getOwnPropertyDescriptor(Request.prototype,'body').get.call(value);
  const originalBody=bodyOf(request);if(originalBody)bodies.add(originalBody);
  t.mock.method(Request.prototype,'clone',function(...args){
    const result=clone.apply(this,args);if(requests.has(this)){requests.add(result);const body=bodyOf(result);if(body)bodies.add(body);}return result;
  });
  t.mock.method(ReadableStream.prototype,'getReader',function(...args){
    const result=getReader.apply(this,args);if(bodies.has(this)){const state={reader:result,chunks:[],accounted:[],reads:0};readers.set(result,state);readerStates.push(state);}return result;
  });
  t.mock.method(ReadableStreamDefaultReader.prototype,'read',function(...args){
    const state=readers.get(this);
    if(state?.pendingCharge&&view){
      const current=view.usage,previous=state.pendingCharge;
      assert.equal(current.bytes-previous.usageBefore.bytes,previous.bytes,'Each actual raw parser chunk is charged exactly before its next read');
      assert.equal(current.queries,previous.usageBefore.queries);assert.equal(current.rows,previous.usageBefore.rows);
      state.accounted.push(previous);state.pendingCharge=null;
    }
    const pending=read.apply(this,args);
    if(state){state.reads++;onRead?.(state,pending);}
    return pending.then(result=>{
      if(state&&!result.done){
        assert.ok(result.value instanceof Uint8Array);
        if(raw!==undefined)assert.ok(Buffer.from(result.value).equals(Buffer.from(raw)),'This fixture delivers one complete actual raw body chunk per parser pass');
        const entry={bytes:result.value.byteLength,reader:state};parts.push(entry);state.chunks.push(entry);onChunk?.(entry,parts.length);
        if(view){entry.usageBefore={...view.usage};state.pendingCharge=entry;}
      }
      return result;
    });
  });
  Object.defineProperty(parts,'readers',{value:readerStates});return parts;
}

const sha=value=>createHash('sha256').update(value).digest('hex');
// Parent host guard derived from the independently reviewed standalone source
// a15a6a33740bc53d6148975c13a0ff8d6cf50f4777ad6df5d70308686d5d4b23.
// This adaptation adds reversible ownership and the exact pinned synchronous
// binding-proxy Worker. It does not claim arbitrary Worker/subprocess/OS isolation.
let activeHostGuard = false;
function installHostNetworkGuard(miniflareEntry) {
  assert.equal(activeHostGuard, false, 'a previous owned runtime must finish cleanup before another starts');
  activeHostGuard = true;
  const require = createRequire(import.meta.url), mfRequire = createRequire(miniflareEntry);
  const net = require('node:net'), tls = require('node:tls'), http = require('node:http'), https = require('node:https');
  const dns = require('node:dns'), dgram = require('node:dgram'), workerThreads = require('node:worker_threads');
  const patches = [], events = [], allowed = {}, proxyWorkers = [], state = { phase: 'setup', restored: false };
  const hadCfFlag = Object.hasOwn(process.env, 'CLOUDFLARE_CF_FETCH_ENABLED'), previousCfFlag = process.env.CLOUDFLARE_CF_FETCH_ENABLED;
  let undici, previousDispatcher, installedDispatcher, identity, controls;
  function patch(object, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    assert.ok(!descriptor || Object.hasOwn(descriptor, 'value'), `guard replacement requires a data property: ${name}`);
    Object.defineProperty(object, name, descriptor ? { ...descriptor, value } : { value, writable: true, configurable: true });
    patches.push(() => { if (descriptor) Object.defineProperty(object, name, descriptor); else delete object[name]; });
  }
  function restore() {
    if (state.restored) return;
    const failures = [];
    if (undici && previousDispatcher) {
      try { undici.setGlobalDispatcher(previousDispatcher); } catch (error) { failures.push(error); }
    }
    // Restore the borrowed dispatcher by identity; never close or destroy it.
    for (const undo of [...patches].reverse()) { try { undo(); } catch (error) { failures.push(error); } }
    try { syncBuiltinESMExports(); } catch (error) { failures.push(error); }
    try { if (hadCfFlag) process.env.CLOUDFLARE_CF_FETCH_ENABLED = previousCfFlag; else delete process.env.CLOUDFLARE_CF_FETCH_ENABLED; }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'host guard restoration failed');
    state.restored = true; activeHostGuard = false;
  }
  function deny(transport, target) {
    const error = new Error(`FORMA_HOST_EGRESS_DENIED ${transport} ${String(target)}`); error.code = 'FORMA_HOST_EGRESS_DENIED';
    events.push({ phase: state.phase, transport, target: String(target) }); throw error;
  }
  function host(transport, value) {
    const hostname = String(value ?? 'localhost').toLowerCase();
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) deny(transport, hostname);
    allowed[transport] = (allowed[transport] ?? 0) + 1; return hostname;
  }
  function origin(transport, value) {
    let url; try { url = new URL(String(value)); } catch { deny(transport, 'invalid origin'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) deny(transport, 'invalid origin');
    host(transport, url.hostname);
  }
  function socket(transport, args) {
    let values = args; if (Array.isArray(values[0])) values = values[0]; const first = values[0]; let options;
    if (first && typeof first === 'object') options = first;
    else if (typeof first === 'number' || typeof first === 'string' && /^\d+$/u.test(first)) {
      options = { port: first, host: typeof values[1] === 'string' ? values[1] : 'localhost' };
    } else deny(transport, 'unsupported socket arguments');
    if (options.path !== undefined || options.socketPath !== undefined || options.fd !== undefined
      || options.lookup !== undefined || options.socket !== undefined) deny(transport, 'unreviewed socket path/fd/lookup/socket');
    if (!Number.isInteger(Number(options.port)) || Number(options.port) < 1 || Number(options.port) > 65535) deny(transport, 'invalid port');
    host(transport, options.host ?? options.hostname ?? 'localhost');
  }
  function request(transport, args) {
    const first = args[0]; let options = {};
    if (typeof first === 'string' || first instanceof URL) { origin(transport, first); if (args[1] && typeof args[1] === 'object') options = args[1]; }
    else if (first && typeof first === 'object') options = first;
    else deny(transport, 'invalid request arguments');
    if (options.socketPath !== undefined) deny(transport, 'unreviewed socket path');
    if (options.hostname !== undefined) host(transport, options.hostname);
    else if (options.host !== undefined) {
      let url; try { url = new URL('http://' + options.host); } catch { deny(transport, 'invalid host'); } host(transport, url.hostname);
    } else if (typeof first !== 'string' && !(first instanceof URL)) host(transport, 'localhost');
  }
  function lookupValue(name, options) {
    const hostname = host('dns.lookup', name), family = typeof options === 'number' ? options : options?.family;
    const ipv6 = hostname === '::1' || hostname === '[::1]' || hostname === 'localhost' && family === 6;
    const value = { address: ipv6 ? '::1' : '127.0.0.1', family: ipv6 ? 6 : 4 }; return options?.all ? [value] : value;
  }
  try {
    process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
    for (const name of ['connect', 'createConnection']) {
      const original = net[name]; patch(net, name, function (...args) { socket('net.' + name, args); return original.apply(this, args); });
    }
    const socketConnect = net.Socket.prototype.connect;
    patch(net.Socket.prototype, 'connect', function (...args) { socket('net.Socket.connect', args); return socketConnect.apply(this, args); });
    const tlsConnect = tls.connect; patch(tls, 'connect', function (...args) { socket('tls.connect', args); return tlsConnect.apply(this, args); });
    for (const [label, module] of [['http', http], ['https', https]]) for (const name of ['request', 'get']) {
      const original = module[name]; patch(module, name, function (...args) { request(label + '.' + name, args); return original.apply(this, args); });
    }
    patch(dns, 'lookup', function (name, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      if (typeof callback !== 'function') throw new TypeError('lookup callback required');
      let value; try { value = lookupValue(name, options); } catch (error) { queueMicrotask(() => callback(error)); return; }
      queueMicrotask(() => Array.isArray(value) ? callback(null, value) : callback(null, value.address, value.family));
    });
    patch(dns.promises, 'lookup', async (name, options) => lookupValue(name, options));
    // Audio-only delta: native getnameinfo can bypass the JS socket guards.
    // Neither callback nor promise service lookup is needed by this fixture.
    patch(dns, 'lookupService', (...args) => deny('dns.lookupService', args[0] ?? ''));
    patch(dns.promises, 'lookupService', async (...args) => deny('dns.promises.lookupService', args[0] ?? ''));
    for (const object of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
      for (const name of Object.getOwnPropertyNames(object)) if ((name === 'reverse' || name.startsWith('resolve')) && typeof object[name] === 'function') {
        patch(object, name, (...args) => deny('dns.' + name, args[0] ?? ''));
      }
    }
    for (const name of ['send', 'connect']) patch(dgram.Socket.prototype, name, () => deny('dgram.' + name, 'UDP is unnecessary for this fixture'));
    const nativeFetch = globalThis.fetch;
    patch(globalThis, 'fetch', function (input, ...args) {
      origin('global.fetch', typeof input === 'string' || input instanceof URL ? input : input.url); return nativeFetch.call(this, input, ...args);
    });
    syncBuiltinESMExports();
    const undiciEntry = mfRequire.resolve('undici'); undici = mfRequire('undici'); previousDispatcher = undici.getGlobalDispatcher();
    class LoopbackDispatcher extends undici.Dispatcher {
      dispatch(options, handler) { origin('miniflare.undici.dispatch', options.origin); return previousDispatcher.dispatch(options, handler); }
      close() { return deny('miniflare.undici.close', 'borrowed dispatcher cannot be closed by fixture'); }
      destroy() { return deny('miniflare.undici.destroy', 'borrowed dispatcher cannot be destroyed by fixture'); }
    }
    installedDispatcher = new LoopbackDispatcher(); undici.setGlobalDispatcher(installedDispatcher);

    // The lazy binding proxy runs in another Node realm. Match its complete
    // installed script and filename, then guard its own Pool/fetch boundary.
    // URL parsing must yield exactly numeric loopback; this permits equivalent
    // spellings that URL canonically normalizes to the same loopback address.
    // Decode only the pinned literal's one Unicode escape and two known header
    // substitutions. Never eval, compile, rewrite vendor files or substitute its
    // message, id, port, response or Atomics protocol.
    const entryBytes = readFileSync(miniflareEntry), entrySource = entryBytes.toString('utf8');
    assert.equal(sha(entryBytes), '9584409d464f6c21d720b20da3c5dc6e5bdab0393f9cb19b36cb960beaf0958b');
    const start = entrySource.indexOf('var WORKER_SCRIPT = ('), end = entrySource.indexOf('\n);\nvar SynchronousFetcher', start);
    assert.ok(start >= 0 && end > start); const section = entrySource.slice(start, end);
    let expectedScript = section.slice(section.indexOf('`') + 1, section.lastIndexOf('`'));
    assert.equal(expectedScript.split('\\').length - 1, 1); assert.equal(expectedScript.split('\\u2014').length - 1, 1);
    for (const [placeholder, value] of [['${CoreHeaders.OP_SYNC}', 'MF-Op-Sync'], ['${CoreHeaders.OP_RESULT_TYPE}', 'MF-Op-Result-Type']]) {
      assert.equal(expectedScript.split(placeholder).length - 1, 1); expectedScript = expectedScript.replace(placeholder, value);
    }
    expectedScript = expectedScript.replace('\\u2014', '—');
    assert.equal(sha(expectedScript), '4d25b5d205de6b409af1c5138b4b6f8277b532f70eea92767b2b85f821e735ad');
    const guardInsertion = `    const __formaCounts = new Int32Array(workerData.__formaHostNetworkCounts);
    try {
      const __formaUrl = new URL(url);
      if (!["http:", "https:"].includes(__formaUrl.protocol) || __formaUrl.username || __formaUrl.password
        || !["127.0.0.1", "[::1]"].includes(__formaUrl.hostname)) throw new Error("non-loopback proxy URL");
    } catch (__formaError) {
      Atomics.add(__formaCounts, 0, 1);
      throw new Error("FORMA_PROXY_WORKER_EGRESS_DENIED " + String(__formaError));
    }
    Atomics.add(__formaCounts, 1, 1);
`;
    const boundary = '  try {\n    if (dispatcherUrl !== url) {';
    const nativeFetchCall = 'const response = await fetch(url, { method, headers, body, dispatcher });';
    assert.equal(expectedScript.split(boundary).length - 1, 1); assert.equal(expectedScript.split(nativeFetchCall).length - 1, 1);
    const guardedScript = expectedScript.replace(boundary, '  try {\n' + guardInsertion + '    if (dispatcherUrl !== url) {')
      .replace(nativeFetchCall, 'const response = await fetch(url, { method, headers, body, dispatcher, redirect: "error" });');
    const OriginalWorker = workerThreads.Worker;
    patch(workerThreads, 'Worker', class GuardedBindingProxyWorker extends OriginalWorker {
      constructor(script, options) {
        const exactData = (value, names) => !!value && typeof value === 'object' && !Array.isArray(value)
          && Reflect.ownKeys(value).length === names.length && names.every(name => {
            const descriptor = Object.getOwnPropertyDescriptor(value, name); return descriptor && Object.hasOwn(descriptor, 'value');
          });
        if (script !== expectedScript || !exactData(options, ['eval', 'workerData', 'transferList']) || options.eval !== true
          || !exactData(options.workerData, ['notifyHandle', 'port', 'filename']) || options.workerData.filename !== miniflareEntry
          || !(options.workerData.notifyHandle instanceof Int32Array) || options.workerData.notifyHandle.length !== 1
          || !(options.workerData.notifyHandle.buffer instanceof SharedArrayBuffer)
          || !(options.workerData.port instanceof workerThreads.MessagePort)
          || !Array.isArray(options.transferList) || options.transferList.length !== 1
          || options.transferList[0] !== options.workerData.port) deny('worker_threads.Worker', 'unknown script, filename or bridge construction');
        const counters = new Int32Array(new SharedArrayBuffer(8));
        const recorded = { expectedScriptSha256: sha(expectedScript), guardedScriptSha256: sha(guardedScript), counters };
        proxyWorkers.push(recorded);
        super(guardedScript, { ...options, workerData: { ...options.workerData, __formaHostNetworkCounts: counters.buffer } });
      }
    });
    syncBuiltinESMExports();
    identity = { miniflareEntry, miniflareEntrySha256: sha(entryBytes), undiciEntry, undiciEntrySha256: sha(readFileSync(undiciEntry)),
      undiciVersion: mfRequire('undici/package.json').version, proxyScriptSha256: sha(expectedScript), guardedProxyScriptSha256: sha(guardedScript) };
  } catch (error) {
    try { restore(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'partial host guard install failed'); }
    throw error;
  }
  return {
    identity, restore, setPhase(value) { state.phase = value; },
    snapshot() { return { identity, phase: state.phase, restored: state.restored, denials: structuredClone(events), allowed: structuredClone(allowed),
      proxyWorkers: proxyWorkers.map(row => ({ expectedScriptSha256: row.expectedScriptSha256, guardedScriptSha256: row.guardedScriptSha256,
        deniedRequests: Atomics.load(row.counters, 0), allowedRequests: Atomics.load(row.counters, 1) })) }; },
    async verifyGuards() {
      state.phase = 'guard-selfcheck'; const expected = [];
      async function rejected(name, action) {
        const before = events.length; let refused = false;
        try { await action(); } catch { refused = true; }
        assert.ok(refused && events.length === before + 1, `host guard selfcheck: ${name}`); expected.push(name);
      }
      await rejected('actual Miniflare undici global dispatcher', () => undici.fetch('https://forbidden.invalid/guard'));
      await rejected('Node global fetch', () => globalThis.fetch('https://forbidden.invalid/guard'));
      await rejected('Node http request', () => http.request('http://forbidden.invalid/guard'));
      await rejected('Node https request', () => https.request('https://forbidden.invalid/guard'));
      await rejected('Node net connector', () => net.connect({ host: 'forbidden.invalid', port: 443 }));
      await rejected('Node TLS connector', () => tls.connect({ host: 'forbidden.invalid', port: 443 }));
      await rejected('Node DNS lookup', () => dns.promises.lookup('forbidden.invalid'));
      await rejected('Node DNS callback lookupService', () => dns.lookupService('192.0.2.1', 443, () => assert.fail('Denied lookupService callback must not run')));
      await rejected('Node DNS promise lookupService', () => dns.promises.lookupService('192.0.2.1', 443));
      controls = expected; state.phase = 'runtime'; return { expectedBlockedControls: [...expected], denials: structuredClone(events) };
    },
    assertContained() {
      assert.equal(controls?.length, 9); assert.equal(events.length, 9);
      assert.ok(events.every(row => row.phase === 'guard-selfcheck'), 'no unexpected setup, runtime or disposal host denial');
      assert.ok(proxyWorkers.length > 0, 'the actual lazy binding proxy used the reviewed Worker guard');
      for (const row of proxyWorkers) {
        assert.equal(Atomics.load(row.counters, 0), 0, 'no denied proxy Worker URL, including swallowed failures');
        assert.ok(Atomics.load(row.counters, 1) > 0, 'observed real proxy requests passed the in-worker loopback gate');
      }
    },
  };
}

// Local-only actual workerd D1 adapter; no imported test module registers suites.
const sqlName=name=>'"'+name.replaceAll('"','""')+'"';
function exportAudioSynthetic(sqlite){
  const schema=sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all().map(row=>({...row}));
  assert.ok(schema.length<=1024);assert.ok(schema.every(row=>!row.name.startsWith('sqlite_')||row.sql===null));
  const tables=schema.filter(row=>row.type==='table'),data={},inserts=[],queries={};
  for(const table of tables){
    const columns=sqlite.prepare(`PRAGMA table_info(${sqlName(table.name)})`).all();
    const without=/\bWITHOUT\s+ROWID\b/iu.test(table.sql),keys=columns.filter(column=>column.pk).sort((a,b)=>a.pk-b.pk).map(column=>column.name);
    assert.ok(!without||keys.length>0);
    const select=[...(without?[]:['CAST(rowid AS TEXT) AS original_rowid']),...columns.map((column,index)=>`quote(${sqlName(column.name)}) AS c${index}`)];
    const sql=`SELECT ${select.join(',')} FROM ${sqlName(table.name)} ORDER BY ${without?keys.map(sqlName).join(','):'rowid'}`;
    queries[table.name]=sql;data[table.name]=sqlite.prepare(sql).all().map(row=>({...row}));
    for(const row of data[table.name]){
      if(!without)assert.match(row.original_rowid,/^[0-9]+$/u);
      const names=[...(without?[]:['rowid']),...columns.map(column=>sqlName(column.name))];
      const values=[...(without?[]:[row.original_rowid]),...columns.map((_,index)=>row[`c${index}`])];
      const insert=`INSERT INTO ${sqlName(table.name)}(${names.join(',')}) VALUES(${values.join(',')})`;
      assert.ok(bytes(insert)<90000);inserts.push(insert);
    }
  }
  assert.ok(inserts.length<=2048);return {schema,data,inserts,queries};
}
export async function d1Rows(db,table){
  return (await db.prepare(`SELECT * FROM ${sqlName(table)}`).all()).results.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export async function d1Snapshot(db,tables){return Object.fromEntries(await Promise.all(tables.map(async table=>[table,await d1Rows(db,table)])));}
// Opt-in lifecycle markers diagnose real local D1 awaits only. They do not
// change application SQL, deadlines, schema, acknowledgements or test oracles.
function d1Phase(phase){
  if(process.env.FORMA_AUDIO_REVIEW_AUTHORIZE_D1_TRACE==='1')process.stderr.write(JSON.stringify({audioReviewAuthorizeD1Phase:phase,time:new Date().toISOString()})+'\n');
}
async function boundedD1Disposal(pending){
  let timer;
  try{return await Promise.race([pending,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('Audio D1 fixture disposal did not settle within 10000 ms')),10000);
  })]);}finally{clearTimeout(timer);}
}
export async function actualD1(t,f,{before,after,transform}={}){
  const lifecycle=fixtureLifecycles.get(f);assert.ok(lifecycle,'D1 requires the prepared fixture cleanup owner');
  assert.equal(f.testName,t.name,'D1 runtime belongs to this prepared test');
  const wranglerRequire=createRequire(import.meta.resolve('wrangler')),miniflareEntry=wranglerRequire.resolve('miniflare');
  let guard,mf,constructionAttempted=false,outbound=0;
  // Register ownership before installing the guard, checking it, loading Miniflare
  // or attempting construction. Earlier callback failures cannot skip this owner.
  lifecycle.ownRuntime(async()=>{
    if(!guard)return;
    const failures=[];let disposed=!constructionAttempted,observed;
    const failed=(phase,error)=>{failures.push(error);cleanupFailure(f.testName,phase,error);};
    guard.setPhase('dispose');
    if(mf){
      try{d1Phase('miniflare-dispose:before');}catch(error){failed('dispose-marker-before',error);}
      try{await boundedD1Disposal(mf.dispose());disposed=true;}catch(error){failed('miniflare-dispose',error);}
      if(disposed)try{d1Phase('miniflare-dispose:after');}catch(error){failed('dispose-marker-after',error);}
    }
    try{observed=guard.snapshot();}catch(error){failed('host-snapshot',error);}
    try{guard.assertContained();}catch(error){failed('host-containment',error);}
    try{assert.equal(outbound,0,'No caught or uncaught workerd outbound attempt is allowed');}catch(error){failed('workerd-outbound',error);}
    if(disposed){
      try{guard.restore();}catch(error){failed('host-restore',error);}
    }else{
      // Rejection, a constructor throw without a handle, or an unresolved disposal
      // is never shutdown. Retain guards; the bounded isolated runner must end it.
      failed('host-guard-retained',Error('Owned Miniflare disposal is unconfirmed; process must not be reused'));
    }
    try{evidence(f,'actual-d1-host-containment',{status:'synthetic-host-containment-observation-not-a-qualification-verdict',
      beforeRestore:observed,afterCleanup:guard.snapshot(),constructionAttempted,runtimeHandleAcquired:!!mf,
      ownedRuntimeDisposed:disposed,workerdOutboundAttempts:outbound,cleanupFailures:failures.map(tracePersistenceError)});
    }catch(error){failed('host-evidence',error);}
    if(failures.length)throw new AggregateError(failures,'Audio D1 host containment or cleanup failed');
  });
  guard=installHostNetworkGuard(miniflareEntry);
  const controls=await guard.verifyGuards();
  evidence(f,'actual-d1-host-guard-ready',{status:'guard-controls-only-not-d1-acceptance',identity:guard.identity,controls});
  guard.setPhase('setup');
  d1Phase('miniflare-import:before');
  const {Miniflare,Log,LogLevel}=wranglerRequire('miniflare');d1Phase('miniflare-import:after');
  const {inheritRuntimeSchemaReadiness}=await import('../worker/runtime.ts');
  const exported=exportAudioSynthetic(f.sqlite);d1Phase('miniflare-create:before');
  constructionAttempted=true;
  mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.NONE),d1Databases:['DB'],
    script:'export default {fetch(){return new Response("Synthetic Audio review authorize D1 qualification")}}',
    outboundService(){outbound++;throw Error('Synthetic Audio D1 forbids outbound traffic');}});
  d1Phase('miniflare-create:after');
  d1Phase('miniflare-getDB:before');const db=await mf.getD1Database('DB');d1Phase('miniflare-getDB:after');
  d1Phase('schema-tables:before');
  await db.batch(exported.schema.filter(row=>row.type==='table').map(row=>db.prepare(row.sql)));
  d1Phase('schema-tables:after');d1Phase('data-copy:before');
  await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'),...exported.inserts.map(sql=>db.prepare(sql))]);
  d1Phase('data-copy:after');d1Phase('schema-other:before');
  await db.batch(exported.schema.filter(row=>row.sql&&row.type!=='table').map(row=>db.prepare(row.sql)));
  d1Phase('schema-other:after');d1Phase('fixture-qualification:before');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  for(const [table,sql]of Object.entries(exported.queries))assert.deepEqual((await db.prepare(sql).all()).results,exported.data[table],table);
  const names=new Set(exported.schema.map(row=>row.name));
  assert.deepEqual((await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results.filter(row=>names.has(row.name)),exported.schema);
  d1Phase('fixture-qualification:after');
  const records=[],statements=new WeakMap();f.traces.push({application:'Node-hosted native application against actual local workerd D1',records});
  evidence(f,'actual-d1-initial-state',{schema:exported.schema,data:exported.data,queries:exported.queries});
  const capture=async(kind,parts,execute)=>{
    const entry={kind,statements:parts.map(({sql,bindings})=>({sql,bindings:[...bindings]}))};records.push(entry);
    for(const part of parts){assert.ok(bytes(part.sql)<=queryLimits.sqlBytes);assert.ok(part.bindings.length<=queryLimits.parameters);}
    await before?.(entry,db);
    try{const result=await execute();entry.result=structuredClone(result);entry.returnedBytes=bytes(result);await after?.(entry,result,db);return transform?await transform(entry,result,db):result;}
    catch(error){entry.error=String(error);throw error;}
  };
  const wrap=(sql,bindings=[])=>{
    const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
    const part={sql,bindings,original};statements.set(statement,part);
    for(const kind of ['first','all','run'])statement[kind]=(...args)=>capture(kind,[part],()=>original[kind](...args));
    return statement;
  };
  const database={prepare:sql=>wrap(sql),batch(items){const parts=items.map(item=>{const part=statements.get(item);assert.ok(part);return part;});
    return capture('batch',parts,()=>db.batch(parts.map(part=>part.original)));}};
  inheritRuntimeSchemaReadiness(f.env.DB,database);f.env.DB=database;f.DB=database;
  const schemaBefore=(await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
  guard.setPhase('application');
  return {db,records,tables:Object.keys(exported.data),exported,schemaBefore};
}

const COMPILE_AUDIO_STATEMENTS=String.raw`
import hashlib,json,sqlite3,sys
length=int(sys.argv[1]);payload=sys.stdin.buffer.read(length)
assert len(payload)==length
data=json.loads(payload)
db=sqlite3.connect(':memory:',cached_statements=0)
class Aggregate:
    def step(self,*args): pass
    def finalize(self): return 1
class Window(Aggregate):
    def value(self): return 1
    def inverse(self,*args): pass
for function in data['functions']:
    if function['type']=='a': db.create_aggregate(function['name'],function['narg'],Aggregate)
    elif function['type']=='w': db.create_window_function(function['name'],function['narg'],Window)
    else: db.create_function(function['name'],function['narg'],lambda *args:1,deterministic=bool(function['flags']&2048))
for statement in data['schema']: db.executescript(statement+';')
limits=[(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100),(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32),
        (sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100),(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000+len('EXPLAIN ')),
        (sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)]
for category,value in limits:
    db.setlimit(category,value);assert db.getlimit(category)==value
def binding(item):
    kind,value=item
    if kind=='null': return None
    if kind=='text': return value
    if kind=='real': return float(value)
    if kind=='blob': return bytes.fromhex(value)
    raise ValueError('Unsupported captured binding')
maximum_bytes=0;maximum_parameters=0
for index,part in enumerate(data['statements']):
    sql=part['sql'];values=[binding(item) for item in part['bindings']]
    size=len(sql.encode('utf-8'));assert size<=100000;assert len(values)<=100
    maximum_bytes=max(maximum_bytes,size);maximum_parameters=max(maximum_parameters,len(values))
    try: db.execute('EXPLAIN '+sql,values).fetchall()
    except sqlite3.Error as error:
        print(json.dumps({'ok':False,'index':index,'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'error':str(error)}))
        sys.exit(1)
print(json.dumps({'ok':True,'compiled':len(data['statements']),'maximumBytes':maximum_bytes,'maximumParameters':maximum_parameters,
                  'qualifiedDepth':100,'functionArguments':32,'compoundSelect':5,'sqlBytes':100000,'sqliteVersion':sqlite3.sqlite_version}))
`;
function capturedBinding(value){
  if(value===null)return ['null',null];
  if(typeof value==='string')return ['text',value];
  if(typeof value==='number'){
    assert.ok(Number.isFinite(value));
    return ['real',Object.is(value,-0)?'-0.0':String(value)];
  }
  if(value instanceof Uint8Array)return ['blob',Buffer.from(value).toString('hex')];
  assert.fail('Unsupported actual SQL binding');
}
export function qualifyStatements(f,records,t,{actualD1=false,mode,application}={}){
  const helperPath=new URL('./helpers/d1-expression-depth.mjs',import.meta.url);
  const helperSha256=createHash('sha256').update(readFileSync(helperPath)).digest('hex');
  assert.equal(helperSha256,'da2ad0af104367360de832a309346c12ebea3b8941d9c376876aaa57b5ac8ef3');
  // Supplementary fixed shared-helper check. Exact typed vectors are compiled
  // by the batch compiler below; this structural check does not claim to retain
  // SQLite REAL/-0/BLOB transport types through the helper's JSON protocol.
  const structural=compileSqliteExpressionDepth(f.sqlite,'SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5',{queryLimits});
  assert.equal(structural.ok,true);assert.equal(structural.limit,100);
  const overCompound=compileSqliteExpressionDepth(f.sqlite,'SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6',{queryLimits});
  assert.equal(overCompound.ok,false);assert.match(overCompound.error,/too many terms in compound SELECT/u);
  const schema=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name").all().map(row=>row.sql);
  const functions=f.sqlite.prepare('PRAGMA function_list').all().filter(row=>!row.builtin).map(({name,narg,type,flags})=>({name,narg,type,flags}));
  const all=records.flatMap(entry=>entry.statements).map(({sql,bindings})=>({sql,bindings:bindings.map(capturedBinding)}));
  // Identical SQL with different actual bindings remains a separate compile.
  const statements=[...new Map(all.map(part=>[JSON.stringify(part),part])).values()];assert.ok(statements.length>0);
  const input=JSON.stringify({schema,functions,statements});
  const compiled=spawnSync(process.env.FORMA_SQLITE_PYTHON??'python3',['-I','-S','-B','-c',COMPILE_AUDIO_STATEMENTS,String(bytes(input))],{
    input,encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000,
  });
  evidence(f,'strict-sql-typed-vectors',{sourcePins:f.sourceBefore,helperSha256,actualD1,mode,...(application?{application}:{}),schema,functions,statements,
    process:{status:compiled.status,signal:compiled.signal,stdout:compiled.stdout,stderr:compiled.stderr,error:compiled.error?.message??null}});
  assert.equal(compiled.status,0,compiled.error?.message??compiled.stderr+compiled.stdout);
  const result=JSON.parse(compiled.stdout);assert.equal(result.ok,true);assert.equal(result.compiled,statements.length);
  t.diagnostic(JSON.stringify({actualD1,application:application??(actualD1?'Node-hosted native application against workerd D1':'native SQLite application with post-flow strict compilation'),
    mode,helperSha256,statements:all.length,uniqueSqlAndBindingVectors:statements.length,...result}));
  return result;
}

// Separate execution context: actual handlers, native brands and D1 binding all
// run in one local Worker. The older Node-to-proxy cases remain unchanged.
const DIRECT_AUDIO_WORKER_ENTRY=String.raw`import {handleSponsorAudioOutputInitial,handleSponsorAudioOutputReviewAuthorize} from '../worker/experience-sponsor-audio-output.ts';
import {ensureSchema,inheritRuntimeSchemaReadiness} from '../worker/runtime.ts';
import {ensureOutputRequirementsSchema} from '../worker/output-requirements-ledger.ts';
import {handleSession} from '../worker/pilot-policy.ts';

// Closed synthetic entry. Every native brand stays in this one bundled graph.
const encoder=new TextEncoder(),clock=performance.now.bind(performance),completed=new Map(),exportsByOrdinal=new Map();
let initialized=false,configuration,busy=false,nextOrdinal=0,raceApplied=false;
const tokenHeader='x-forma-audio-fixture-token',catalog='WITH audio_later_manifest AS (SELECT ',IO='experience_sponsor_audio_output_read_attempts';
const effects={media:0,assets:0,detached:0};
const own=(value,key)=>{const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))throw Error('fixture_observation_data');return d.value;};
const fail=code=>{throw Error(code);};
function errorCode(error){
  for(let level=0;error&&typeof error==='object'&&level<3;level++){
    const message=Object.getOwnPropertyDescriptor(error,'message'),code=Object.getOwnPropertyDescriptor(error,'code');
    if(message&&Object.hasOwn(message,'value')&&typeof message.value==='string'&&/CHECK constraint failed: passed\s*=\s*1/u.test(message.value))return 'native-check-passed';
    if(code&&Object.hasOwn(code,'value')&&['sponsor_audio_output_authority_changed','sponsor_audio_output_read_authority_changed','sponsor_audio_output_read_limit_reached','sponsor_audio_output_native_unavailable','sponsor_audio_output_native_proof_changed'].includes(code.value))return code.value;
    const cause=Object.getOwnPropertyDescriptor(error,'cause');error=cause&&Object.hasOwn(cause,'value')?cause.value:null;
  }
  return 'unknown-error-payload-omitted';
}
function observe(record,work){if(record.sealed)return;try{work();}catch{record.observerErrors++;}}
function event(record,phase,fields={}){
  const value={ordinal:++record.sequence,phase,observerMonotonicMs:clock(),...fields};
  if(record.events.length===512){record.events.shift();record.overwrittenEvents++;}record.events.push(value);
}
function errorEvent(record,phase,error,fields={}){
  const value={phase,code:errorCode(error),...fields};record.errorCount++;
  if(record.firstErrors.length<8)record.firstErrors.push(value);else{if(record.lastErrors.length===8)record.lastErrors.shift();record.lastErrors.push(value);}
  event(record,phase,{...fields,code:value.code});
}
// Measure actual ordinary D1 JSON without serializing an aggregate response.
// Unknown shapes fail only this observation; they never replace the native ACK.
function jsonBytes(value){
  let nodes=0,total=0;const seen=new Set();
  const add=n=>{total+=n;if(total>8000000)fail('fixture_ack_measurement_bound');};
  const string=value=>{if(value.length>8000000)fail('fixture_ack_measurement_bound');add(encoder.encode(JSON.stringify(value)).length);};
  const visit=(value,depth)=>{
    if(++nodes>1000000||depth>64)fail('fixture_ack_measurement_bound');
    if(value===null){add(4);return;}if(typeof value==='string'){string(value);return;}
    if(typeof value==='boolean'){add(value?4:5);return;}if(typeof value==='number'&&Number.isFinite(value)){add(JSON.stringify(value).length);return;}
    if(!value||typeof value!=='object'||seen.has(value))fail('fixture_ack_measurement_shape');
    seen.add(value);
    if(Array.isArray(value)){
      if(value.length>100000||Reflect.ownKeys(value).length!==value.length+1)fail('fixture_ack_measurement_shape');
      add(2+Math.max(0,value.length-1));for(let at=0;at<value.length;at++){const item=own(value,String(at));if(item===undefined)add(4);else visit(item,depth+1);}
    }else{
      if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('fixture_ack_measurement_shape');
      const keys=Reflect.ownKeys(value);if(keys.length>128)fail('fixture_ack_measurement_shape');add(2);let count=0;
      for(const key of keys){if(typeof key!=='string')fail('fixture_ack_measurement_shape');const d=Object.getOwnPropertyDescriptor(value,key);
        if(!d||!Object.hasOwn(d,'value'))fail('fixture_ack_measurement_shape');if(!d.enumerable||d.value===undefined)continue;
        if(count++)add(1);string(key);add(1);visit(d.value,depth+1);}
    }
    seen.delete(value);
  };visit(value,0);return total;
}
// Typed bounded representative encoding only; never a whole-query-trace claim.
function capture(value,limit){
  let remaining=limit,nodes=0;const seen=new Set();
  const debit=n=>{remaining-=n;if(remaining<0)fail('fixture_sample_cap');};
  const string=value=>{if(value.length>remaining)fail('fixture_sample_cap');debit(encoder.encode(JSON.stringify(value)).length+32);return value;};
  const visit=(value,depth)=>{
    if(++nodes>100000||depth>64)fail('fixture_sample_cap');debit(64);
    if(value===null)return ['null'];if(value===undefined)return ['undefined'];
    if(typeof value==='string')return ['string',string(value)];if(typeof value==='boolean')return ['boolean',value];
    if(typeof value==='number'&&Number.isFinite(value))return ['number',Object.is(value,-0)?'-0':String(value)];
    if(!value||typeof value!=='object'||seen.has(value))fail('fixture_sample_shape');
    if(value instanceof Uint8Array||value instanceof ArrayBuffer){const data=value instanceof Uint8Array?value:new Uint8Array(value);debit(data.byteLength*2);let raw='';for(const byte of data)raw+=String.fromCharCode(byte);return ['bytes',btoa(raw)];}
    seen.add(value);let result;
    if(Array.isArray(value)){
      if(value.length>100000||Reflect.ownKeys(value).length!==value.length+1)fail('fixture_sample_shape');
      result=['array',Array.from({length:value.length},(_,at)=>visit(own(value,String(at)),depth+1))];
    }else{
      const prototype=Object.getPrototypeOf(value);if(![Object.prototype,null].includes(prototype))fail('fixture_sample_shape');
      const keys=Reflect.ownKeys(value);if(keys.length>1024)fail('fixture_sample_shape');
      result=['object',prototype===null?'null':'object',keys.map(key=>{
        if(typeof key!=='string')fail('fixture_sample_shape');const d=Object.getOwnPropertyDescriptor(value,key);
        if(!d||!Object.hasOwn(d,'value'))fail('fixture_sample_shape');
        return [string(key),[!!d.enumerable,!!d.writable,!!d.configurable],visit(d.value,depth+1)];
      })];
    }
    seen.delete(value);return result;
  };
  try{const typed=visit(value,0);if(encoder.encode(JSON.stringify(typed)).length>limit)fail('fixture_sample_cap');return {complete:true,typed};}
  catch(error){return {complete:false,reason:error instanceof Error&&error.message==='fixture_sample_cap'?'cap':'unsupported-shape'};}
}
// One transient native value, never a truth cache or an emitted full trace.
// References are replaced on completion and released at the handler boundary.
const lastCompletedNativeResults=new WeakMap();
function diagnosticDescriptor(descriptor){
  if(!descriptor)return {present:false};
  const data=Object.hasOwn(descriptor,'value'),value=data?descriptor.value:undefined;
  return {present:true,kind:data?'data':'accessor',enumerable:!!descriptor.enumerable,configurable:!!descriptor.configurable,
    ...(data?{writable:!!descriptor.writable,valueType:value===null?'null':typeof value,valueUndefined:value===undefined,
      ...(typeof value==='number'?{finite:Number.isFinite(value)}:{}),...(typeof value==='string'?{stringLength:value.length}:{})}
      :{getter:typeof descriptor.get==='function',setter:typeof descriptor.set==='function'})};
}
function diagnosticPrototype(value){
  if(value===null)return 'null';if(value===Object.prototype)return 'Object.prototype';if(value===Array.prototype)return 'Array.prototype';
  if(value===Request.prototype)return 'Request.prototype';if(value===Response.prototype)return 'Response.prototype';
  return 'other-prototype';
}
function diagnosticResultShape(value){
  let remainingKeys=48;
  const shape=value=>{
    if(value===null||typeof value!=='object')return {valueType:value===null?'null':typeof value};
    const keys=Reflect.ownKeys(value),selected=keys.slice(0,Math.min(16,remainingKeys));remainingKeys-=selected.length;
    return {valueType:Array.isArray(value)?'array':'object',prototype:diagnosticPrototype(Object.getPrototypeOf(value)),ownKeyCount:keys.length,
      keysTruncated:selected.length!==keys.length,keys:selected.map(key=>({key:typeof key==='string'?key.slice(0,128):'<symbol-description-omitted>',
        keyKind:typeof key,keyTruncated:typeof key==='string'&&key.length>128,...diagnosticDescriptor(Object.getOwnPropertyDescriptor(value,key))}))};
  };
  const field=(value,key)=>{if(value===null||typeof value!=='object')return {available:false,reason:'non-object'};
    const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor)return {available:false,reason:'absent'};
    if(!Object.hasOwn(descriptor,'value'))return {available:false,reason:'accessor-not-invoked'};return {available:true,value:descriptor.value};};
  const root=shape(value),ack=Array.isArray(value)?field(value,'0'):{available:true,value};
  const results=ack.available?field(ack.value,'results'):{available:false,reason:'ack-unavailable'};
  const firstRow=results.available?field(results.value,'0'):{available:false,reason:'results-unavailable'};
  const meta=ack.available?field(ack.value,'meta'):{available:false,reason:'ack-unavailable'};
  const selected=entry=>entry.available?{available:true,shape:shape(entry.value)}:entry;
  return {root,firstAck:selected(ack),results:selected(results),firstRow:selected(firstRow),meta:selected(meta),
    scope:'root-and-first-batch-ack-and-first-result-row-only',maximumRecordedKeys:48,maximumKeysPerObject:16};
}
function diagnosticBodyLocations(request){
  const chain=start=>{const levels=[];let current=start,nativeRequestDepth=null;
    for(let depth=0;current!==null&&depth<4;depth++){
      if(current===Request.prototype)nativeRequestDepth=depth;
      levels.push({depth,prototype:diagnosticPrototype(current),body:diagnosticDescriptor(Object.getOwnPropertyDescriptor(current,'body')),
        bodyUsed:diagnosticDescriptor(Object.getOwnPropertyDescriptor(current,'bodyUsed'))});
      current=Object.getPrototypeOf(current);
    }
    return {levels,ended:current===null,truncated:current!==null,requestNativePrototypeDepth:nativeRequestDepth};
  };
  return {requestOwnBody:diagnosticDescriptor(Object.getOwnPropertyDescriptor(request,'body')),
    requestOwnBodyUsed:diagnosticDescriptor(Object.getOwnPropertyDescriptor(request,'bodyUsed')),
    actualRequestPrototypeChain:chain(Object.getPrototypeOf(request)),requestIntrinsicPrototypeChain:chain(Request.prototype),
    responseIntrinsicPrototypeChain:chain(Response.prototype),gettersInvoked:false,maximumPrototypeLevels:4};
}
function handlerFailureRepresentative(record,request){
  const completed=lastCompletedNativeResults.get(record);
  const summary={attribution:'handler-error-time-observation-not-first-cause',lastCompletedBoundary:completed?.boundary??null,
    method:completed?.method??null,statementCount:completed?.parts.length??0};
  try{summary.resultShape=completed?{complete:true,value:diagnosticResultShape(completed.result)}:{complete:false,reason:'no-completed-native-result'};}
  catch{summary.resultShape={complete:false,reason:'descriptor-inspection-threw'};}
  try{summary.bodyLocations={complete:true,value:diagnosticBodyLocations(request)};}
  catch{summary.bodyLocations={complete:false,reason:'intrinsic-descriptor-inspection-threw'};}
  // This is a closed DTO of labels built above, not the native result graph.
  // Its actual JSON bytes are bounded separately; typed descriptor expansion
  // would spend the sample estimate on describing these descriptions again.
  let descriptorSummary;
  try{const json=JSON.stringify(summary);descriptorSummary=encoder.encode(json).length<=32768
    ?{complete:true,json}:{complete:false,reason:'cap'};}
  catch{descriptorSummary={complete:false,reason:'descriptor-json-failed'};}
  const nativeValue=completed?capture({boundary:completed.boundary,method:completed.method,
    statements:completed.parts,result:completed.result},524288):{complete:false,reason:'no-completed-native-result'};
  const diagnostic={complete:descriptorSummary.complete&&nativeValue.complete&&summary.resultShape.complete&&summary.bodyLocations.complete,kind:'last-completed-native-result-at-handler-error',descriptorSummary,nativeValue};
  if(!diagnostic.complete)diagnostic.reason=nativeValue.reason??descriptorSummary.reason??summary.resultShape.reason??summary.bodyLocations.reason;
  // The complete role, including independent shape metadata, retains the same
  // 512 KiB slot. A cap cannot silently turn an omitted value into full evidence.
  if(encoder.encode(JSON.stringify(diagnostic)).length>524288){diagnostic.nativeValue={complete:false,reason:'cap'};diagnostic.complete=false;diagnostic.reason='cap';}
  return diagnostic;
}
function newRecord(operation){return {format:'forma-audio-direct-worker-observation@1',runId:configuration.runId,requestOrdinal:++nextOrdinal,operation,
  fullQueryTrace:false,pendingOperations:0,pendingAtHandlerEnd:null,physicalObservationComplete:false,events:[],firstErrors:[],lastErrors:[],sequence:0,errorCount:0,overwrittenEvents:0,observerErrors:0,
  counters:{prepare:0,bind:0,dispatch:0,queries:0,batchStatements:0,batchAcks:0,ackCardinalityErrors:0,acks:0,successfulAcks:0,resultRows:0,returnedJsonBytes:0,unsupportedMethods:0,maximumSqlBytes:0,maximumBindings:0,sqlCapViolations:0,bindingCapViolations:0},
  representatives:{carrier:null,noncarrier:null,failure:null},race:null,sealed:false};}
const quote=name=>'"'+name.replaceAll('"','""')+'"';
async function raceBoundary(record,parts,native,boundary){
  if(configuration.scenario!=='original-body-drift'||raceApplied||!parts.some(part=>/INSERT INTO (?:main\.)?output_commands\b/u.test(part.sql)))return;
  const issuance=await native.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_issuances').first();
  if(issuance.n!==1)return;
  raceApplied=true;const race={boundary,applied:false,fixtureQueries:2,nativeCheckFailure:false};observe(record,()=>record.race={...race});
  const mutation=await native.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').bind('{}',configuration.originalEventId).run();
  if(mutation.meta.changes!==1)fail('fixture_race_mutation_count');race.applied=true;observe(record,()=>record.race={...race});
  const baseline={},tables=configuration.tables.filter(name=>name!==IO);
  for(let at=0;at<tables.length;at+=128){const group=tables.slice(at,at+128),results=await native.batch(group.map(name=>native.prepare('SELECT * FROM '+quote(name))));
    race.fixtureQueries+=group.length;observe(record,()=>record.race={...race});if(results.length!==group.length)fail('fixture_race_snapshot_ack');
    for(let index=0;index<group.length;index++){if(results[index].success!==true||!Array.isArray(results[index].results))fail('fixture_race_snapshot_ack');baseline[group[index]]=results[index].results;}
    // Stop accumulating at the same bound; no incomplete rollback comparison can pass.
    if(!capture(baseline,4194304).complete)fail('fixture_race_snapshot_cap');
  }
  race.baseline=capture(baseline,4194304);if(!race.baseline.complete)fail('fixture_race_snapshot_cap');observe(record,()=>record.race={...race});
}
function observedDatabase(native,record){
  const statements=new WeakMap();let boundary=0;
  const limits=parts=>{for(const part of parts){const size=encoder.encode(part.sql).length;
    record.counters.maximumSqlBytes=Math.max(record.counters.maximumSqlBytes,size);record.counters.maximumBindings=Math.max(record.counters.maximumBindings,part.bindings.length);
    if(size>100000)record.counters.sqlCapViolations++;if(part.bindings.length>100)record.counters.bindingCapViolations++;}};
  const call=async(method,parts,execute)=>{
    const id=++boundary;observe(record,()=>{limits(parts);record.pendingOperations++;record.counters.dispatch++;record.counters.queries+=parts.length;if(method==='batch')record.counters.batchStatements+=parts.length;event(record,'db.dispatch',{boundary:id,method,statements:parts.length});});
    try{
      if(method==='batch')await raceBoundary(record,parts,native,id);
      const result=await execute();
      observe(record,()=>lastCompletedNativeResults.set(record,{boundary:id,method,parts,result}));
      observe(record,()=>{
        const acknowledgements=method==='batch'?result:['all','run'].includes(method)?[result]:[];
        if(!Array.isArray(acknowledgements))fail('fixture_ack_array');record.counters.acks+=acknowledgements.length;
        if(method==='batch'){record.counters.batchAcks+=acknowledgements.length;if(acknowledgements.length!==parts.length)record.counters.ackCardinalityErrors++;}
        for(const ack of acknowledgements){if(ack.success===true)record.counters.successfulAcks++;if(Array.isArray(ack.results))record.counters.resultRows+=ack.results.length;}
        if(method==='first'&&result!==null)record.counters.resultRows++;
        record.counters.returnedJsonBytes+=jsonBytes(result);
        event(record,'db.received',{boundary:id,method,statements:parts.length,ackCount:acknowledgements.length});
        const carrier=method==='batch'&&parts.length>1&&parts[0].sql.includes(catalog)&&parts.slice(1).every(part=>!part.sql.includes(catalog));
        if(carrier&&!record.representatives.carrier){
          record.representatives.carrier=capture({boundary:id,slot:0,sql:parts[0].sql,bindings:parts[0].bindings,ack:result[0]},524288);
          const at=parts.length-1;record.representatives.noncarrier=capture({boundary:id,slot:at,sql:parts[at].sql,bindings:parts[at].bindings,ack:result[at]},524288);
        }
      });
      return result;
    }catch(error){
      observe(record,()=>{errorEvent(record,'db.error',error,{boundary:id,method,statements:parts.length});
        if(!record.representatives.failure)record.representatives.failure=capture({boundary:id,statements:parts},524288);
        if(record.race?.boundary===id)record.race.nativeCheckFailure=errorCode(error)==='native-check-passed';});
      throw error;
    }finally{observe(record,()=>record.pendingOperations--);}
  };
  const wrap=(statement,sql,bindings=[])=>{
    const part={sql,bindings:[...bindings]},proxy=new Proxy(statement,{get(target,key){
      if(key==='bind')return (...values)=>{observe(record,()=>record.counters.bind++);return wrap(target.bind(...values),sql,values);};
      if(['first','all','run','raw'].includes(key))return (...args)=>{if(key==='raw')observe(record,()=>record.counters.unsupportedMethods++);return call(key,[part],()=>target[key](...args));};
      const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{observe(record,()=>record.counters.unsupportedMethods++);return Reflect.apply(value,target,args);};
    }});statements.set(proxy,{part,statement});return proxy;
  };
  const database=new Proxy(native,{get(target,key){
    if(key==='prepare')return sql=>{observe(record,()=>record.counters.prepare++);return wrap(target.prepare(sql),sql);};
    if(key==='batch')return items=>{const captured=items.map(item=>{const value=statements.get(item);if(!value)fail('fixture_statement_unknown');return value;});
      return call('batch',captured.map(item=>item.part),()=>target.batch(captured.map(item=>item.statement)));};
    const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
    return (...args)=>{observe(record,()=>record.counters.unsupportedMethods++);return Reflect.apply(value,target,args);};
  }});
  // The wrapper registry above is private to this request and retains native
  // prepared-statement identity through every eager bind.
  return database;
}
async function exportedRecord(id){
  if(exportsByOrdinal.has(id))return exportsByOrdinal.get(id);
  const record=completed.get(id);if(!record?.sealed)fail('fixture_record_unavailable');
  const body=encoder.encode(JSON.stringify(record));if(body.byteLength>8388608)fail('fixture_record_cap');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const value={body,manifest:{format:record.format,runId:record.runId,requestOrdinal:id,bytes:body.byteLength,sha256:digest,
    chunks:Math.ceil(body.byteLength/65536),chunkBytes:65536,boundedRecordComplete:true,fullQueryTrace:false}};
  exportsByOrdinal.set(id,value);return value;
}
export default {async fetch(request,env){
  const url=new URL(request.url),control=url.pathname.startsWith('/__fixture/audio-');
  if(control){
    if(request.headers.get(tokenHeader)!==env.AUDIO_FIXTURE_TOKEN||url.search||url.hash)return new Response('Unavailable',{status:404});
    if(url.pathname==='/__fixture/audio-initialize'&&request.method==='POST'){
      if(initialized||busy)return new Response('Already initialized',{status:409});
      const value=JSON.parse(env.AUDIO_FIXTURE_CONFIG);
      if(!value||JSON.stringify(Object.keys(value).sort())!==JSON.stringify(['actor','originalEventId','runId','scenario','tables'])
        ||!['positive','original-body-drift'].includes(value.scenario)||typeof value.runId!=='string'||value.runId.length>100
        ||typeof value.actor!=='string'||value.actor.length>100||typeof value.originalEventId!=='string'||value.originalEventId.length>100
        ||!Array.isArray(value.tables)||!value.tables.length||value.tables.length>1024||new Set(value.tables).size!==value.tables.length
        ||value.tables.some(name=>typeof name!=='string'||!/^[_a-z][_a-z0-9]*$/u.test(name)))fail('fixture_configuration');
      configuration=Object.freeze({...value,tables:Object.freeze([...value.tables])});
      const setupEnv={...env,MEDIA:new Proxy({},{get:()=>()=>{effects.media++;fail('fixture_media');}}),ASSETS:{fetch(){effects.assets++;fail('fixture_assets');}}};
      await ensureSchema(setupEnv);await ensureOutputRequirementsSchema(setupEnv);
      const sessionRequest=new Request('http://localhost/api/session',{headers:{'oai-authenticated-user-id':value.actor,'oai-authenticated-user-email':value.actor+'@example.invalid'}});
      const session=await handleSession(sessionRequest,setupEnv,{waitUntil(){effects.detached++;fail('fixture_detached');}});
      if(session.status!==200)fail('fixture_session_refused');await session.arrayBuffer();initialized=true;
      return Response.json({initialized:true,runId:value.runId,effects});
    }
    const match=/^\/__fixture\/audio-evidence\/([1-9][0-9]*)(?:\/([0-9]+))?$/u.exec(url.pathname);
    if(match&&request.method==='GET'){
      if(busy)return new Response('Request pending',{status:409});
      const id=Number(match[1]);if(!Number.isSafeInteger(id)||id>4||!completed.has(id))return new Response('No record',{status:404});
      const saved=await exportedRecord(id);if(match[2]===undefined)return Response.json(saved.manifest);
      const index=Number(match[2]);if(!Number.isSafeInteger(index)||index>=saved.manifest.chunks)return new Response('No chunk',{status:404});
      return new Response(saved.body.slice(index*65536,(index+1)*65536),{headers:{'content-type':'application/octet-stream'}});
    }
    return new Response('Unavailable',{status:404});
  }
  if(!initialized||busy||nextOrdinal>=4)return new Response('Unavailable',{status:409});
  const initial=/^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output(?:\/prepare)?$/u.test(url.pathname);
  const review=/^\/api\/experiences\/sponsor\/audio\/drafts\/experience-draft-[a-f0-9]{64}\/review$/u.test(url.pathname);
  const authorize=/^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output\/authorize$/u.test(url.pathname);
  if(!initial&&!review&&!authorize)return new Response('Unavailable',{status:404});
  busy=true;const record=newRecord(initial?'prepare':review?'review':'authorize');completed.set(record.requestOrdinal,record);
  const database=observedDatabase(env.DB,record);inheritRuntimeSchemaReadiness(env.DB,database);
  const applicationEnv={...env,DB:database,MEDIA:new Proxy({},{get:()=>()=>{effects.media++;fail('fixture_media');}}),ASSETS:{fetch(){effects.assets++;fail('fixture_assets');}}};
  observe(record,()=>event(record,'request.begin',{bodyUsed:request.bodyUsed}));
  try{
    const response=await (initial?handleSponsorAudioOutputInitial:handleSponsorAudioOutputReviewAuthorize)(request,applicationEnv,
      {waitUntil(){effects.detached++;fail('fixture_detached');}});
    record.responseStatus=response.status;return response;
  }catch(error){observe(record,()=>{errorEvent(record,'request.error',error);
    if(!record.representatives.failure)record.representatives.failure=handlerFailureRepresentative(record,request);});throw error;}
  finally{observe(record,()=>{record.bodyUsed=request.bodyUsed;record.effects={...effects};record.pendingAtHandlerEnd=record.pendingOperations;record.physicalObservationComplete=record.pendingOperations===0;event(record,'request.end');});lastCompletedNativeResults.delete(record);record.sealed=true;busy=false;}
}};
`;
const DIRECT_AUDIO_COMPILER_PINS={
  tsconfig:'81c41f37a15c8b0f691c91421b113d70fa454783a2f6881c0dbdd0954a59c096',
  api:'b090fe57c79c677256a242703ea07bb2191eced357bece2f9a25539443da070c',
  binary:'79fffbb53be7306c1505f97281b63a01902f53ac56682c61f673c78011c5dd14',
};
async function finiteWorkerWait(promise,milliseconds,label){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>{const error=Error(`${label} did not settle within ${milliseconds} ms`);error.code='FORMA_FIXTURE_WAIT_TIMEOUT';reject(error);},milliseconds);
  })]);}finally{clearTimeout(timer);}
}
function directWorkerSourceInventory(repository){
  const files=new Map(),visited=new Set();
  const visit=directory=>{
    const actual=realpathSync(directory);if(visited.has(actual))return;visited.add(actual);
    for(const entry of readdirSync(actual,{withFileTypes:true})){
      if(entry.name==='node_modules')continue;
      const path=join(actual,entry.name);
      if(entry.isDirectory())visit(path);
      else if(entry.isFile()&&/\.(?:[cm]?[jt]sx?|json)$/u.test(entry.name))files.set(realpathSync(path),sha(readFileSync(path)));
    }
  };
  for(const directory of ['worker','src','db'])visit(join(repository,directory));
  // These are actual native adapter dependencies, bundled without replacements.
  // Capture their ordinary files before build; reject any unrecorded input.
  const require=createRequire(import.meta.url),falEntry=require.resolve('@fal-ai/client'),falRequire=createRequire(falEntry);
  const packageRoot=(entry,name)=>{let directory=dirname(entry);while(true){
    const file=join(directory,'package.json');if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).name===name)return directory;
    const parent=dirname(directory);assert.notEqual(parent,directory);directory=parent;}};
  for(const [name,entry]of [['@fal-ai/client',falEntry],...['@msgpack/msgpack','eventsource-parser','robot3'].map(name=>[name,falRequire.resolve(name)])])visit(packageRoot(entry,name));
  return files;
}
async function buildDirectAudioWorker(f,owner){
  assert.ok(f.evidenceDirectory,'Direct Worker qualification requires its explicit B-owned evidence directory');
  assert.equal(process.env.ESBUILD_BINARY_PATH,undefined,'An ambient esbuild executable override is not reviewed');
  const repository=fileURLToPath(new URL('../',import.meta.url)),testsDirectory=fileURLToPath(new URL('./',import.meta.url)),hostBefore=sourcePins();
  const wranglerRequire=createRequire(import.meta.resolve('wrangler')),entry=wranglerRequire.resolve('esbuild'),require=createRequire(entry);
  const binary=require.resolve('@esbuild/darwin-arm64/bin/esbuild'),config=join(repository,'tsconfig.json');
  assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
  assert.equal(sha(readFileSync(entry)),DIRECT_AUDIO_COMPILER_PINS.api);assert.equal(sha(readFileSync(binary)),DIRECT_AUDIO_COMPILER_PINS.binary);
  assert.equal(sha(readFileSync(config)),DIRECT_AUDIO_COMPILER_PINS.tsconfig);
  const compilerOptions=JSON.parse(readFileSync(config,'utf8'));assert.equal(compilerOptions.extends,undefined);
  assert.equal(compilerOptions.compilerOptions.useDefineForClassFields,false);assert.equal(compilerOptions.compilerOptions.experimentalDecorators,true);
  const directory=join(f.evidenceDirectory,'direct-worker-build-'+randomUUID());mkdirSync(directory,{recursive:false});
  const outfile=join(directory,'worker.js'),mapfile=outfile+'.map',before=directWorkerSourceInventory(repository);
  const options={absWorkingDir:repository,stdin:{contents:DIRECT_AUDIO_WORKER_ENTRY,resolveDir:testsDirectory,
    sourcefile:join(testsDirectory,'experience-sponsor-audio-output-review-authorize-worker-entry.ts'),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',
    target:'es2022',splitting:false,sourcemap:'external',metafile:true,conditions:['workerd','worker','browser'],external:['node:crypto'],tsconfig:config,outfile};
  writeFileSync(join(directory,'entry.ts'),DIRECT_AUDIO_WORKER_ENTRY,{flag:'wx'});
  writeFileSync(join(directory,'options.json'),JSON.stringify({...options,stdin:{...options.stdin,contents:{sha256:sha(DIRECT_AUDIO_WORKER_ENTRY),bytes:bytes(DIRECT_AUDIO_WORKER_ENTRY)}}},null,2)+'\n',{flag:'wx'});
  const childProcess=createRequire(import.meta.url)('node:child_process'),spawn=childProcess.spawn;
  let compiler,result,buildError,exitPromise,exitResult,spawnCount=0;
  childProcess.spawn=function(command,args,spawnOptions){
    assert.equal(realpathSync(command),realpathSync(binary),'Only the pinned native compiler is permitted during build');
    assert.deepEqual(args,['--service=0.27.3','--ping']);assert.equal(++spawnCount,1);
    assert.deepEqual(spawnOptions.stdio,['pipe','pipe','inherit']);
    const child=Reflect.apply(spawn,this,[command,args,spawnOptions]);owner.compilerStarted=true;owner.compilerExited=false;
    exitPromise=new Promise(resolveExit=>{child.once('exit',(code,signal)=>{exitResult={pid:child.pid,code,signal};owner.compilerExited=true;resolveExit(exitResult);});
      child.once('error',error=>{owner.compilerError=tracePersistenceError(error);});});
    return child;
  };
  try{compiler=wranglerRequire('esbuild');assert.equal(compiler.version,'0.27.3');result=await finiteWorkerWait(compiler.build(options),60000,'Owned async esbuild');}
  catch(error){buildError=error;}
  finally{
    childProcess.spawn=spawn;
    try{compiler?.stop();if(exitPromise)await finiteWorkerWait(exitPromise,10000,'Owned esbuild child exit');}
    catch(error){if(buildError)buildError=new AggregateError([buildError,error],'Build and owned child shutdown failed');else buildError=error;}
    evidence(f,'direct-worker-build-lifecycle',{compilerEntry:entry,binary,compilerPins:DIRECT_AUDIO_COMPILER_PINS,spawnCount,
      childStarted:owner.compilerStarted,childExited:owner.compilerExited,exit:exitResult??null,childError:owner.compilerError??null,buildError:buildError?tracePersistenceError(buildError):null});
  }
  if(buildError)throw buildError;assert.equal(spawnCount,1);assert.equal(owner.compilerExited,true);
  assert.equal(result.warnings.length,0,'Bundle warnings require source review');assert.equal(result.outputFiles.length,2);
  assert.deepEqual(result.outputFiles.map(file=>file.path).sort(),[outfile,mapfile].sort());
  for(const file of result.outputFiles)writeFileSync(file.path,file.contents,{flag:'wx'});
  writeFileSync(join(directory,'metafile.json'),JSON.stringify(result.metafile,null,2)+'\n',{flag:'wx'});
  const after=directWorkerSourceInventory(repository),inputs=[],seen=new Set();
  for(const [name,metadata]of Object.entries(result.metafile.inputs)){
    if(name==='tests/experience-sponsor-audio-output-review-authorize-worker-entry.ts'){
      assert.equal(metadata.bytes,bytes(DIRECT_AUDIO_WORKER_ENTRY));continue;
    }
    const path=resolve(repository,name),actual=realpathSync(path);assert.ok(before.has(actual),'Unreviewed bundle input: '+name);
    assert.ok(!seen.has(actual),'Duplicate real-source copy in one Worker graph: '+name);seen.add(actual);
    assert.equal(after.get(actual),before.get(actual),'Source changed while bundle was built');inputs.push({path,realPath:actual,sha256:before.get(actual),bytes:metadata.bytes});
  }
  const nativeRequired=['worker/experience-sponsor-audio-output.ts','worker/experience-sponsor-audio-output-reads.ts','worker/experience-sponsor-audio-output-approval.ts',
    'worker/experience-sponsor-approval.ts','worker/output-document-execution.ts','worker/experience-sponsor-audio-authorize.ts'];
  for(const name of nativeRequired)assert.equal(inputs.filter(input=>input.realPath===realpathSync(join(repository,name))).length,1,name);
  for(const metadata of Object.values(result.metafile.outputs))for(const imported of metadata.imports){
    assert.equal(imported.external,true,'Splitting or a second runtime module is not permitted');assert.equal(imported.path,'node:crypto');
  }
  assert.equal(sha(readFileSync(config)),DIRECT_AUDIO_COMPILER_PINS.tsconfig);assert.equal(sha(readFileSync(entry)),DIRECT_AUDIO_COMPILER_PINS.api);
  assert.equal(sha(readFileSync(binary)),DIRECT_AUDIO_COMPILER_PINS.binary);
  const script=result.outputFiles.find(file=>file.path===outfile).text;
  const descriptor=path=>{const value=readFileSync(path);return {path,realPath:realpathSync(path),sha256:sha(value),bytes:value.byteLength};};
  const manifest={format:'forma-audio-direct-worker-build@1',directory,entry:descriptor(join(directory,'entry.ts')),
    options:descriptor(join(directory,'options.json')),metafile:descriptor(join(directory,'metafile.json')),
    compiler:{config:descriptor(config),api:descriptor(entry),binary:descriptor(binary)},
    hostSources:sourcePaths.map(path=>descriptor(fileURLToPath(new URL('../'+path,import.meta.url)))),
    outputs:result.outputFiles.map(file=>({path:file.path,sha256:sha(file.contents),bytes:file.contents.byteLength})),inputs,compilerPins:DIRECT_AUDIO_COMPILER_PINS,
    oneModuleGraph:true,sourceReplacement:false,externalAllowlist:['node:crypto'],childExit:exitResult};
  assert.deepEqual(sourcePins(),hostBefore,'Host, test and helper sources remain unchanged during bundle preparation');
  writeFileSync(join(directory,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  evidence(f,'direct-worker-bundle',manifest);return {script,manifest,assertStable(){
    for(const item of [manifest.entry,manifest.options,manifest.metafile,...Object.values(manifest.compiler),...manifest.hostSources,...inputs,...manifest.outputs]){
      const value=readFileSync(item.path);assert.equal(sha(value),item.sha256,item.path);assert.equal(value.byteLength,item.bytes,item.path);
      if(item.realPath)assert.equal(realpathSync(item.path),item.realPath);
    }
  }};
}
function decodeDirectWorkerCapture(capture){
  assert.equal(capture?.complete,true,'Required Worker representative is complete');
  const visit=value=>{
    assert.ok(Array.isArray(value));const [kind,item,fields]=value;
    if(kind==='null')return null;if(kind==='undefined')return undefined;if(kind==='string'||kind==='boolean')return item;
    if(kind==='number'){const number=item==='-0'?-0:Number(item);assert.ok(Number.isFinite(number));return number;}
    if(kind==='bytes')return Uint8Array.from(Buffer.from(item,'base64'));
    if(kind==='array')return item.map(visit);
    assert.equal(kind,'object');const object=item==='null'?Object.create(null):{};
    for(const [key,flags,child]of fields)Object.defineProperty(object,key,{value:visit(child),enumerable:flags[0],writable:flags[1],configurable:flags[2]});return object;
  };return visit(capture.typed);
}
// Host-only refusal reporting, after the Worker request has settled. Accepted
// JSON responses retain their original decoder and have no new payload limit.
async function boundedWorkerErrorWire(response){
  const maximum=16384,pieces=[];let retained=0,observed=0,complete=response.body===null,streamError=null,cancelError=null;
  const reader=response.body?.getReader();
  if(reader){
    try{while(retained<maximum){const part=await finiteWorkerWait(reader.read(),10000,'Worker error response body');
      if(part.done){complete=true;break;}assert.ok(part.value instanceof Uint8Array);observed+=part.value.byteLength;
      const keep=Math.min(maximum-retained,part.value.byteLength);pieces.push(Buffer.from(part.value.subarray(0,keep)));retained+=keep;
      if(keep!==part.value.byteLength)break;
    }}catch(error){streamError=tracePersistenceError(error);}
    finally{if(!complete)try{await finiteWorkerWait(reader.cancel(),10000,'Worker error response cancellation');}catch(error){cancelError=tracePersistenceError(error);}
      try{reader.releaseLock();}catch(error){if(!cancelError)cancelError=tracePersistenceError(error);}}
  }
  const prefix=Buffer.concat(pieces);
  return {status:response.status,statusText:response.statusText.slice(0,256),contentType:(response.headers.get('content-type')??'').slice(0,256),
    maximumRetainedBytes:maximum,retainedBytes:prefix.byteLength,observedBytes:observed,complete,truncated:!complete,
    prefixBase64:prefix.toString('base64'),prefixUtf8:prefix.toString('utf8'),utf8Attribution:'decoded-prefix; base64 retains exact bytes',streamError,cancelError};
}
export async function actualWorkerD1(t,f,{scenario='positive'}={}){
  assert.ok(['positive','original-body-drift'].includes(scenario));assert.equal(f.testName,t.name);
  const lifecycle=fixtureLifecycles.get(f);assert.ok(lifecycle);
  const wranglerRequire=createRequire(import.meta.resolve('wrangler')),miniflareEntry=wranglerRequire.resolve('miniflare');
  const records=[],collectionFailures=[];
  let guard,mf,build,constructionAttempted=false,outbound=0,requested=0,db;
  const token=randomUUID(),runId=randomUUID(),controlHeaders={'x-forma-audio-fixture-token':token};
  lifecycle.ownRuntime(async()=>{
    const failures=[],failed=(phase,error)=>{failures.push(error);cleanupFailure(f.testName,phase,error);};
    let disposed=!constructionAttempted,beforeRestore;
    if(!guard)return;guard.setPhase('dispose');
    if(mf)try{await boundedD1Disposal(mf.dispose());disposed=true;}catch(error){failed('direct-worker-dispose',error);}
    try{beforeRestore=guard.snapshot();guard.assertContained();assert.equal(outbound,0);build?.assertStable();}catch(error){failed('direct-worker-containment-source',error);}
    for(const error of collectionFailures)failed('direct-worker-evidence-collection',error);
    if(disposed)try{guard.restore();}catch(error){failed('direct-worker-host-restore',error);}
    else failed('direct-worker-guard-retained',Error('Owned Worker shutdown is unconfirmed; process must not be reused'));
    try{evidence(f,'direct-worker-lifecycle',{executionContext:'local-bundled-Worker-handler-and-native-D1',constructionAttempted,
      ownedRuntimeDisposed:disposed,compilerStartedInAcceptanceCase:false,workerdOutboundAttempts:outbound,beforeRestore,afterCleanup:guard.snapshot(),
      requestCount:requested,collectedRecords:records.length,cleanupFailures:failures.map(tracePersistenceError)});}catch(error){failed('direct-worker-cleanup-evidence',error);}
    if(failures.length)throw new AggregateError(failures,'Direct Worker fixture cleanup or observation failed');
  });
  build=loadReviewedDirectAudioWorker(f);
  guard=installHostNetworkGuard(miniflareEntry);const controls=await guard.verifyGuards();
  evidence(f,'direct-worker-host-guard-ready',{identity:guard.identity,controls});
  const exported=exportAudioSynthetic(f.sqlite),tables=Object.keys(exported.data),{Miniflare,Log,LogLevel,Response:WorkerResponse}=wranglerRequire('miniflare');
  const body=async(response,status=200)=>{
    assert.ok(response instanceof WorkerResponse);
    if(!response.ok&&response.status!==status){
      const wire=await boundedWorkerErrorWire(response);
      try{evidence(f,'direct-worker-refused-wire',wire);}catch(error){collectionFailures.push(error);cleanupFailure(f.testName,'direct-worker-refused-wire-evidence',error);}
      assert.equal(response.status,status,'Original Worker refusal wire: '+JSON.stringify(wire));
    }
    const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;
  };
  for(const name of ['OPENAI_API_KEY','FAL_KEY'])assert.equal(f.env[name],'synthetic-presence-no-egress');assert.equal(f.env.OPENAI_MODEL,'gpt-5.6-terra');
  guard.setPhase('setup');constructionAttempted=true;
  mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:0,cf:false,
    log:new Log(LogLevel.NONE),d1Databases:['DB'],script:build.script,bindings:{AUDIO_FIXTURE_TOKEN:token,
      AUDIO_FIXTURE_CONFIG:JSON.stringify({actor:f.actor,originalEventId:f.original[0].event_id,runId,scenario,tables}),
      OPENAI_API_KEY:f.env.OPENAI_API_KEY,FAL_KEY:f.env.FAL_KEY,OPENAI_MODEL:f.env.OPENAI_MODEL},
    outboundService(){outbound++;throw Error('Synthetic direct Audio Worker forbids outbound traffic');}});
  db=await mf.getD1Database('DB');
  await db.batch(exported.schema.filter(row=>row.type==='table').map(row=>db.prepare(row.sql)));
  await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'),...exported.inserts.map(sql=>db.prepare(sql))]);
  await db.batch(exported.schema.filter(row=>row.sql&&row.type!=='table').map(row=>db.prepare(row.sql)));
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  for(const [table,sql]of Object.entries(exported.queries))assert.deepEqual((await db.prepare(sql).all()).results,exported.data[table],table);
  const schema=async()=>(await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
  const copiedSchema=await schema(),names=new Set(exported.schema.map(row=>row.name));
  assert.deepEqual(copiedSchema.filter(row=>names.has(row.name)),exported.schema);
  const beforeInitialize=await d1Snapshot(db,tables);
  const initialized=await body(await finiteWorkerWait(mf.dispatchFetch('http://localhost/__fixture/audio-initialize',{method:'POST',headers:controlHeaders}),45000,'Worker readiness initialization'));
  assert.deepEqual(initialized,{initialized:true,runId,effects:{media:0,assets:0,detached:0}});
  assert.deepEqual(await schema(),copiedSchema,'Native realm-local readiness must preserve the complete copied schema');
  assert.deepEqual(await d1Snapshot(db,tables),beforeInitialize,'Native session/readiness initialization must preserve every copied business row');
  evidence(f,'direct-worker-initial-state',{executionContext:'local-bundled-Worker-handler-and-native-D1',schema:copiedSchema,data:exported.data,
    queries:exported.queries,readinessSchemaAndDataUnchanged:true,runId});
  const collect=async()=>{
    guard.setPhase('collection');
    for(let ordinal=records.length+1;ordinal<=requested;ordinal++){
      const url=`http://localhost/__fixture/audio-evidence/${ordinal}`;
      const manifest=await body(await finiteWorkerWait(mf.dispatchFetch(url,{headers:controlHeaders}),10000,'Worker evidence manifest'));
      assert.equal(manifest.runId,runId);assert.equal(manifest.requestOrdinal,ordinal);assert.equal(manifest.boundedRecordComplete,true);assert.equal(manifest.fullQueryTrace,false);
      assert.equal(manifest.chunkBytes,65536);assert.ok(Number.isSafeInteger(manifest.bytes)&&manifest.bytes>0&&manifest.bytes<=8388608);
      assert.equal(manifest.chunks,Math.ceil(manifest.bytes/65536));assert.match(manifest.sha256,/^[a-f0-9]{64}$/u);
      const chunks=[];
      for(let index=0;index<manifest.chunks;index++){
        const response=await finiteWorkerWait(mf.dispatchFetch(url+'/'+index,{headers:controlHeaders}),10000,'Worker evidence chunk');assert.equal(response.status,200);
        const part=Buffer.from(await response.arrayBuffer());assert.equal(part.length,Math.min(65536,manifest.bytes-index*65536));chunks.push(part);
      }
      const payload=Buffer.concat(chunks);assert.equal(payload.length,manifest.bytes);assert.equal(sha(payload),manifest.sha256);
      const record=JSON.parse(payload.toString('utf8'));assert.equal(record.runId,runId);assert.equal(record.requestOrdinal,ordinal);assert.equal(record.sealed,true);
      evidence(f,'direct-worker-observation-'+ordinal,{manifest,record});records.push(record);
    }
  };
  async function collectSafely(){try{await collect();}catch(error){collectionFailures.push(error);cleanupFailure(f.testName,'direct-worker-evidence-collection',error);}}
  async function request(operation,options={}){
    assert.ok(['prepare','review','authorize'].includes(operation));assert.ok(requested<4);assert.equal(records.length,requested,'A prior incomplete record stops this case');
    assert.ok(records.every(record=>record.physicalObservationComplete),'An outstanding native operation stops this case');
    const wire=f.outputRequest(operation,options),init={method:wire.method,headers:[...wire.headers]};
    if(wire.body!==null)init.body=new Uint8Array(await wire.arrayBuffer());
    // Transfer the unchanged HTTP wire into Miniflare's actual Request realm.
    // The host Request is consumed here; only the incoming Worker bodyUsed is an oracle.
    guard.setPhase('application');requested++;
    let response,applicationError;
    try{response=await finiteWorkerWait(mf.dispatchFetch(wire.url,init),45000,'Direct Worker '+operation);}
    catch(error){applicationError=error;}
    // The application promise is settled before any evidence endpoint is called.
    // A host timeout is an unknown in-flight result: leave it to owned disposal.
    // Miniflare wraps an undici response around the same transport stream. Hold
    // that stream unread while collecting evidence so an unreachable original
    // response's finalizer cannot cancel it during this unrelated async work.
    const transportReader=response?.body?.getReader();
    try{if(!applicationError||applicationError.code!=='FORMA_FIXTURE_WAIT_TIMEOUT')await collectSafely();}
    finally{transportReader?.releaseLock();}
    if(applicationError)throw applicationError;
    if(collectionFailures.length)throw new AggregateError(collectionFailures,'Direct Worker observation is incomplete');return response;
  }
  async function qualify({expectedRequests,race=false}={}){
    await collectSafely();assert.deepEqual(collectionFailures,[]);assert.equal(records.length,expectedRequests);
    const all=[];
    for(const record of records){assert.equal(record.observerErrors,0);assert.equal(record.pendingAtHandlerEnd,0);assert.equal(record.physicalObservationComplete,true);assert.equal(record.bodyUsed,record.operation==='prepare','Prepare consumes its actual original body; review and cloned authorization preserve it');
      assert.deepEqual(record.effects,{media:0,assets:0,detached:0});assert.equal(record.fullQueryTrace,false);
      for(const field of ['unsupportedMethods','sqlCapViolations','bindingCapViolations','ackCardinalityErrors'])assert.equal(record.counters[field],0,field);
      assert.ok(record.counters.maximumSqlBytes<=100000);assert.ok(record.counters.maximumBindings<=100);
      assert.ok(record.counters.dispatch>0);assert.ok(record.counters.returnedJsonBytes>0);
      const expectedRace=race&&record.operation==='authorize'&&record.race?.applied===true&&record.race.nativeCheckFailure===true;
      if(!expectedRace){assert.equal(record.errorCount,0,'Unaffected request has no observed database/application error');
        assert.equal(record.counters.batchAcks,record.counters.batchStatements);assert.equal(record.counters.successfulAcks,record.counters.acks);}
      if(record.representatives.carrier){const carrier=decodeDirectWorkerCapture(record.representatives.carrier),noncarrier=decodeDirectWorkerCapture(record.representatives.noncarrier);
        assert.equal(carrier.boundary,noncarrier.boundary);assert.equal(carrier.slot,0);assert.ok(noncarrier.slot>0);
        assert.ok(carrier.sql.includes('WITH audio_later_manifest AS (SELECT '));assert.ok(!noncarrier.sql.includes('WITH audio_later_manifest AS (SELECT '));
        for(const sample of [carrier,noncarrier]){assert.equal(sample.ack.success,true);assert.equal(sample.ack.results.length,1);
          const row=sample.ack.results[0];assert.deepEqual(Object.keys(row).sort(),['authorized','body','count']);assert.equal(row.authorized,1);assert.equal(row.count,1);assert.deepEqual(JSON.parse(row.body),[[1]]);}all.push([carrier,noncarrier]);
      }
    }
    assert.ok(all.length>0,'At least one complete genuine same-batch carrier/noncarrier pair is required');
    const representatives=all[0].map(({sql,bindings})=>({sql,bindings}));
    const qualification=qualifyStatements(f,[{statements:representatives}],t,{actualD1:true,application:'Bundled local Worker handlers against the same native workerd D1 binding',mode:'direct-Worker-two-genuine-emitted-representatives'});
    assert.equal(qualification.compiled,2);build.assertStable();assert.equal(outbound,0);assert.deepEqual(await schema(),copiedSchema);
    evidence(f,'direct-worker-qualification',{executionContext:'local-bundled-Worker-handler-and-native-D1',expectedRequests,race,
      observedCounters:records.map(({operation,counters})=>({operation,counters})),privateInMemoryCDebitsExported:false,offlineStrictRepresentativeCount:2,
      fullQueryTrace:false,workerdLimitsUnmodified:true,qualification});
  }
  return {db,tables,schemaBefore:copiedSchema,records,request,body,qualify,collect:collectSafely,
    async refused(action){let response;try{response=await action();}catch(error){if(error?.code==='ERR_ASSERTION')throw error;assert.ok(error instanceof Error);return error;}
      assert.ok(response instanceof WorkerResponse);assert.ok(response.status>=400,'Native refusal is required');await response.arrayBuffer();return response;},
    raceBaseline(){const record=records.find(item=>item.race?.applied);assert.ok(record);assert.equal(record.race.nativeCheckFailure,true);
      const baseline=decodeDirectWorkerCapture(record.race.baseline);
      for(const values of Object.values(baseline))values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));return {record,baseline};}};
}

// Build is an explicit separate operation. It performs no prepared fixture,
// application request, D1 setup or Miniflare construction. Root reviews these
// exact B artifacts before supplying their manifest SHA to an acceptance case.
export async function prepareDirectAudioWorkerBundle(){
  const directory=evidenceDirectory();assert.ok(directory,'Bundle preparation requires the explicit B-owned evidence directory');
  const f={testName:'Audio direct Worker bundle preparation',evidenceDirectory:directory};
  const owner={compilerStarted:false,compilerExited:true},wranglerRequire=createRequire(import.meta.resolve('wrangler'));
  let guard,build,originalError;const failures=[];
  try{
    guard=installHostNetworkGuard(wranglerRequire.resolve('miniflare'));const controls=await guard.verifyGuards();
    evidence(f,'build-only-host-controls',{identity:guard.identity,controls});guard.setPhase('build');
    build=await buildDirectAudioWorker(f,owner);build.assertStable();
  }catch(error){originalError=error;}
  finally{
    if(guard){let beforeRestore;
      try{beforeRestore=guard.snapshot();assert.equal(beforeRestore.denials.length,9);
        assert.ok(beforeRestore.denials.every(row=>row.phase==='guard-selfcheck'));assert.deepEqual(beforeRestore.proxyWorkers,[],
          'Build-only preparation never constructs the lazy D1 binding proxy');}catch(error){failures.push(error);}
      if(owner.compilerExited)try{guard.restore();}catch(error){failures.push(error);}
      else failures.push(Error('Owned build child exit is unconfirmed; retained guard requires isolated process termination'));
      try{evidence(f,'build-only-cleanup',{beforeRestore,afterCleanup:guard.snapshot(),compiler:owner,applicationInvocations:0,
        miniflareConstructions:0,databaseInvocations:0,originalError:originalError?tracePersistenceError(originalError):null,
        cleanupFailures:failures.map(tracePersistenceError)});}catch(error){failures.push(error);}
    }
  }
  if(originalError){if(failures.length)throw new AggregateError([originalError,...failures],'Bundle preparation and cleanup failed');throw originalError;}
  if(failures.length)throw new AggregateError(failures,'Bundle preparation cleanup failed');
  const manifestPath=join(build.manifest.directory,'source-manifest.json');
  return {manifestPath,manifestSha256:sha(readFileSync(manifestPath)),entrySha256:build.manifest.entry.sha256,
    status:'bundle-prepared-awaiting-explicit-graph-review-no-Worker-runtime'};
}
function loadReviewedDirectAudioWorker(f){
  const supplied=process.env.FORMA_AUDIO_REVIEW_AUTHORIZE_WORKER_MANIFEST,expected=process.env.FORMA_AUDIO_REVIEW_AUTHORIZE_WORKER_MANIFEST_SHA256;
  const root=process.env.FORMA_AUDIO_REVIEW_AUTHORIZE_EVIDENCE_ROOT;
  assert.ok(supplied&&isAbsolute(supplied)&&root&&isAbsolute(root),'A separately reviewed absolute B-owned Worker manifest is required');
  assert.match(expected??'',/^[a-f0-9]{64}$/u,'The exact reviewed manifest SHA is required');
  const actualRoot=realpathSync(root),actualPath=realpathSync(supplied),inside=relative(actualRoot,actualPath);
  assert.ok(inside!==''&&!inside.startsWith('..')&&!isAbsolute(inside),'Reviewed manifest must remain inside the supplied report root');
  const raw=readFileSync(actualPath);assert.equal(sha(raw),expected,'The supplied manifest is the reviewed immutable artifact');
  const manifest=JSON.parse(raw.toString('utf8')),repository=fileURLToPath(new URL('../',import.meta.url));
  assert.equal(manifest.format,'forma-audio-direct-worker-build@1');assert.equal(realpathSync(manifest.directory),dirname(actualPath));
  assert.equal(actualPath,join(realpathSync(manifest.directory),'source-manifest.json'));
  assert.deepEqual(manifest.compilerPins,DIRECT_AUDIO_COMPILER_PINS);assert.equal(manifest.oneModuleGraph,true);assert.equal(manifest.sourceReplacement,false);
  assert.deepEqual(manifest.externalAllowlist,['node:crypto']);assert.equal(manifest.entry.sha256,sha(DIRECT_AUDIO_WORKER_ENTRY));
  assert.equal(manifest.entry.bytes,bytes(DIRECT_AUDIO_WORKER_ENTRY));assert.equal(manifest.entry.path,join(manifest.directory,'entry.ts'));
  assert.equal(manifest.options.path,join(manifest.directory,'options.json'));assert.equal(manifest.metafile.path,join(manifest.directory,'metafile.json'));
  assert.equal(manifest.compiler.config.path,join(repository,'tsconfig.json'));
  assert.equal(manifest.compiler.config.sha256,DIRECT_AUDIO_COMPILER_PINS.tsconfig);
  assert.equal(manifest.compiler.api.sha256,DIRECT_AUDIO_COMPILER_PINS.api);assert.equal(manifest.compiler.binary.sha256,DIRECT_AUDIO_COMPILER_PINS.binary);
  assert.ok(Array.isArray(manifest.inputs)&&manifest.inputs.length>0&&manifest.inputs.length<10000);
  assert.ok(Array.isArray(manifest.hostSources)&&manifest.hostSources.length===sourcePaths.length);
  assert.equal(manifest.outputs.length,2);assert.deepEqual(manifest.outputs.map(item=>item.path).sort(),[join(manifest.directory,'worker.js'),join(manifest.directory,'worker.js.map')].sort());
  const files=[manifest.entry,manifest.options,manifest.metafile,...Object.values(manifest.compiler),...manifest.outputs,...manifest.inputs,...manifest.hostSources];
  const assertStable=()=>{
    assert.equal(sha(readFileSync(actualPath)),expected);
    for(const item of files){assert.ok(isAbsolute(item.path));if(item.realPath)assert.equal(realpathSync(item.path),item.realPath);
      const content=readFileSync(item.path);assert.equal(sha(content),item.sha256,item.path);assert.equal(content.byteLength,item.bytes,item.path);}
  };
  assertStable();
  // The manifest pins actual options and the actual compiler metafile, not only
  // a claimed list. Recheck correspondence before any native runtime exists.
  const options=JSON.parse(readFileSync(manifest.options.path,'utf8')),metafile=JSON.parse(readFileSync(manifest.metafile.path,'utf8'));
  assert.equal(options.tsconfig,manifest.compiler.config.path);assert.equal(options.outfile,join(manifest.directory,'worker.js'));
  assert.equal(options.bundle,true);assert.equal(options.write,false);assert.equal(options.splitting,false);assert.equal(options.metafile,true);
  assert.equal(options.format,'esm');assert.equal(options.platform,'browser');assert.equal(options.target,'es2022');assert.equal(options.sourcemap,'external');
  assert.deepEqual(options.conditions,['workerd','worker','browser']);assert.deepEqual(options.external,['node:crypto']);
  assert.deepEqual(options.stdin.contents,{sha256:sha(DIRECT_AUDIO_WORKER_ENTRY),bytes:bytes(DIRECT_AUDIO_WORKER_ENTRY)});
  const observedInputs=[],virtual='tests/experience-sponsor-audio-output-review-authorize-worker-entry.ts';let entryCount=0;
  for(const [name,item]of Object.entries(metafile.inputs)){
    if(name===virtual){entryCount++;assert.equal(item.bytes,bytes(DIRECT_AUDIO_WORKER_ENTRY));continue;}
    const path=resolve(repository,name),input=manifest.inputs.find(value=>value.path===path);assert.ok(input,'Every actual metafile input is pinned');
    assert.equal(input.bytes,item.bytes);observedInputs.push(input.realPath);
  }
  assert.equal(entryCount,1);assert.equal(observedInputs.length,manifest.inputs.length);assert.equal(new Set(observedInputs).size,observedInputs.length);
  for(const metadata of Object.values(metafile.outputs))for(const imported of metadata.imports){assert.equal(imported.external,true);assert.equal(imported.path,'node:crypto');}
  for(const path of sourcePaths){const absolute=fileURLToPath(new URL('../'+path,import.meta.url));
    assert.equal(manifest.hostSources.filter(item=>item.path===absolute).length,1,'Exact current host/test/helper source correspondence');}
  const script=readFileSync(join(manifest.directory,'worker.js'),'utf8');
  evidence(f,'reviewed-direct-worker-bundle',{manifestPath:actualPath,manifestSha256:expected,manifest,
    buildPerformedInAcceptanceCase:false,executionContext:'local-bundled-Worker-handler-and-native-D1'});
  return {script,manifest,assertStable};
}
