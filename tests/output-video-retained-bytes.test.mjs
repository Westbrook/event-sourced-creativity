import assert from 'node:assert/strict';
import test from 'node:test';
import {videoRetainedFixture} from './output-video-retained-fixture.mjs';
const {readRetainedOutputVideo,copyRetainedOutputVideoBytes:copy}=await import('../worker/output-video-retained.ts');
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('network forbidden');};
test.after(()=>{globalThis.fetch=originalFetch;});

async function fixture(){
 const f=await videoRetainedFixture(),stats={gets:0,queries:0};
 const env={...f.env,DB:{
  prepare(sql){assert.match(sql,/^\s*(SELECT|WITH)\b/u);stats.queries++;return f.env.DB.prepare(sql);},
  batch(){throw Error('retained write forbidden');},
 },MEDIA:{...f.env.MEDIA,
  async get(key){stats.gets++;return f.env.MEDIA.get(key);},
  put(){throw Error('retained storage write forbidden');},
  delete(){throw Error('retained storage deletion forbidden');},
 }};
 return {...f,env,stats,read:()=>readRetainedOutputVideo(env,f.input)};
}

test('original retained bytes reuse one physical read and preserve response shape and final witness',async()=>{
 const f=await fixture();try{
  const before=f.sqlite.prepare('SELECT total_changes() n').get().n,result=await f.read();
  assert.deepEqual(Reflect.ownKeys(result),['assertions','expiresAt','witness']);
  assert.equal(f.stats.gets,1);
  const queries=f.stats.queries;
  assert.deepEqual(copy(result,f.env),f.bytes);
  assert.deepEqual(copy(result,f.env),f.bytes);
  assert.equal(f.stats.gets,1);assert.equal(f.stats.queries,queries);
  assert(f.sqlite.prepare('WITH video_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+result.witness.sql).get(result.witness.json));
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
  assert.equal(result.expiresAt,f.job.expires_at);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(result))),['assertions','expiresAt','witness']);
 }finally{f.sqlite.close();}
});

test('copied, inherited, serialized and proxy results cannot impersonate the exact native result',async()=>{
 const f=await fixture();try{
  const result=await f.read();let traps=0;
  const revoked=Proxy.revocable(result,{});revoked.revoke();
  const proxy=new Proxy(result,{get(){traps++;throw Error('getter');},getPrototypeOf(){traps++;throw Error('prototype');},ownKeys(){traps++;throw Error('keys');}});
  for(const value of [null,undefined,0,'result',{},[],()=>{}, {...result},structuredClone(result),JSON.parse(JSON.stringify(result)),Object.create(result),proxy,revoked.proxy])assert.equal(copy(value,f.env),null);
  assert.equal(traps,0);assert.deepEqual(copy(result,f.env),f.bytes);
 }finally{f.sqlite.close();}
});

test('owned retained bytes are isolated from storage mutation and every returned copy',async()=>{
 const f=await fixture();try{
  const result=await f.read(),expected=f.bytes.slice(),first=copy(result,f.env),second=copy(result,f.env);
  assert(first.buffer instanceof ArrayBuffer);assert(second.buffer instanceof ArrayBuffer);
  assert.notEqual(first.buffer,second.buffer);first.fill(0);
  f.media.get(f.stored.key).bytes.fill(1);f.bytes.fill(2);
  assert.deepEqual(second,expected);assert.deepEqual(copy(result,f.env),expected);assert.equal(f.stats.gets,1);
 }finally{f.sqlite.close();}
});

for(const binding of ['identity','DB','MEDIA','FORMA_PILOT_COHORT_ID','FORMA_ADMIN_EMAILS'])test('retained bytes refuse changed '+binding+' after read',async()=>{
 const f=await fixture();try{
  const result=await f.read();
  if(binding==='identity')assert.equal(copy(result,{...f.env}),null);
  else{f.env[binding]=binding==='DB'||binding==='MEDIA'?{...f.env[binding]}:'changed';assert.equal(copy(result,f.env),null);}
  assert.equal(f.stats.gets,1);
 }finally{f.sqlite.close();}
});

for(const binding of ['DB','MEDIA','FORMA_PILOT_COHORT_ID','FORMA_ADMIN_EMAILS'])test('binding change during native media read prevents mint: '+binding,async()=>{
 const f=await fixture();try{
  const get=f.env.MEDIA.get;
  f.env.MEDIA.get=async key=>{const value=await get(key);f.env[binding]=binding==='DB'||binding==='MEDIA'?{...f.env[binding]}:'changed';return value;};
  const result=await f.read();
  assert.deepEqual(Reflect.ownKeys(result),['assertions','expiresAt','witness']);
  assert.equal(copy(result,f.env),null);assert.equal(f.stats.gets,1);
 }finally{f.sqlite.close();}
});

test('captured earliest private expiry cannot be extended by mutating returned fields',async()=>{
 const f=await fixture(),now=Date.now;try{
  const expiry=new Date(now()+10000).toISOString();
  f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE kind='provider-response'").run(expiry);
  const result=await f.read();assert.equal(result.expiresAt,expiry);assert.deepEqual(copy(result,f.env),f.bytes);
  result.expiresAt='2999-01-01T00:00:00.000Z';
  Date.now=()=>Date.parse(expiry);
  assert.equal(copy(result,f.env),null);
 }finally{Date.now=now;f.sqlite.close();}
});

test('the original abort signal remains authoritative after replacing the input signal',async()=>{
 const f=await fixture(),controller=new AbortController();try{
  f.input.signal=controller.signal;const result=await f.read();
  f.input.signal=new AbortController().signal;controller.abort();
  assert.equal(copy(result,f.env),null);
 }finally{f.sqlite.close();}
});

test('signal replacement during the last native storage await cannot create a usable capability',async()=>{
 const f=await fixture(),controller=new AbortController();try{
  f.input.signal=controller.signal;const prepare=f.env.DB.prepare;
  f.env.DB.prepare=sql=>{const statement=prepare(sql);if(!sql.startsWith('SELECT 1 WHERE EXISTS(SELECT 1 FROM output_native_storage_writes'))return statement;
   const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),first=bound.first.bind(bound);bound.first=async()=>{const row=await first();f.input.signal=new AbortController().signal;controller.abort();return row;};return bound;};return statement;
  };
  const result=await f.read();assert.equal(copy(result,f.env),null);
 }finally{f.sqlite.close();}
});

test('failed storage acknowledgment still refuses the original retained read',async()=>{
 const f=await fixture();try{
  f.sqlite.exec('UPDATE output_native_storage_writes SET write_acknowledged=0');
  await assert.rejects(f.read(),/output_video_retained_unavailable/);assert.equal(f.stats.gets,1);
 }finally{f.sqlite.close();}
});

test('recovery-finalization results preserve their witness but never mint retained byte capability',async()=>{
 const f=await fixture();try{
  const lease={token:'12345678-1234-1234-1234-123456789abc',expiresAt:f.job.expires_at};
  const checkpoint=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json);
  checkpoint.outputVideoRecovery={version:'output-video-recovery-v1',...lease,status:'active',evidenceMode:'original',
   clientRequestId:f.mediaAttempt.clientRequestId,requestDigest:f.mediaAttempt.requestDigest,providerRequestId:'video_original'};
  f.sqlite.prepare("UPDATE document_jobs SET status='failed',lease_expires_at=NULL,result_json=?").run(JSON.stringify(checkpoint));
  f.sqlite.exec("UPDATE output_operation_slots SET status='failed'");
  const result=await readRetainedOutputVideo(f.env,{...f.input,recoveryLease:lease});
  assert(f.sqlite.prepare('WITH video_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+result.witness.sql).get(result.witness.json));
  assert.equal(copy(result,f.env),null);assert.equal(f.stats.gets,1);
 }finally{f.sqlite.close();}
});

test('cached byte identity does not replace executing the final custody witness',async()=>{
 const f=await fixture();try{
  const result=await f.read();
  f.sqlite.exec("UPDATE private_content SET redacted_at='now' WHERE content_id='input'");
  assert.equal(f.sqlite.prepare('WITH video_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+result.witness.sql).get(result.witness.json),undefined);
  assert.deepEqual(copy(result,f.env),f.bytes);
  await assert.rejects(f.read());
 }finally{f.sqlite.close();}
});
