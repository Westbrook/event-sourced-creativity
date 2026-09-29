import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import test from 'node:test';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const requireRoot=createRequire(join(root,'package.json')),requireWrangler=createRequire(requireRoot.resolve('wrangler'));
const {Miniflare,Log,LogLevel}=requireWrangler('miniflare'),{build}=requireWrangler('esbuild');
const {exportSynthetic,install,rowsSnapshot}=await import(pathToFileURL(root+'/tests/helpers/model3d-workerd-snapshot.mjs'));
async function finite(p,ms,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout:'+label)),ms);})]);}finally{clearTimeout(timer);}}
test('native local workerd Audio accepted recovery, exact replay and storage grace',{timeout:180000},async()=>{
 const {audioRecoveryFixture}=await import(pathToFileURL(root+'/tests/output-audio-recovery-fixture.mjs'));
 const f=await audioRecoveryFixture(),requests=[],reports=[];let mf,directory,closed=false;
 const originalFetch=globalThis.fetch;
 try{
  // Only fixtures and synthetic outboundService participate; no live network.
  globalThis.fetch=()=>{throw Error('node_network_forbidden');};
  f.sqlite.exec("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'");
  const exported=exportSynthetic(f.sqlite),tuple={binding:f.binding,user:f.user,jobId:f.jobId,assertions:f.assertions};
  const entry=await readFile(new URL('./helpers/audio-recovery-workerd-entry.ts',import.meta.url),'utf8');
  const built=await build({stdin:{resolveDir:root,contents:entry,loader:'ts'},absWorkingDir:root,bundle:true,write:false,metafile:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],plugins:[{name:'deny-protected',setup(b){b.onResolve({filter:/test-results/},()=>{throw Error('protected_input');});}}]});
  const bytes=new Uint8Array([0x49,0x44,0x33,4,0,0,0,0,0,0,0xff,0xfb,0x90,0x64]),asset='https://v3b.fal.media/files/original-audio.mp3';
  directory=await mkdtemp(join(tmpdir(),'forma-audio-native-smoke-'));
  const skipGrace=false;
  mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),script:built.outputFiles[0].text,d1Databases:['DB'],d1Persist:join(directory,'d1'),r2Buckets:['Media'],r2Persist:join(directory,'r2'),bindings:{FIXTURE:JSON.stringify(tuple),SKIP_GRACE:skipGrace},outboundService(request){
   requests.push({url:request.url,method:request.method});assert.equal(request.method,'GET');
   if(request.url===asset){assert.equal(request.headers.get('authorization'),null);return new Response(bytes,{headers:{'content-type':'audio/mpeg','content-length':String(bytes.length)}});}
   assert.equal(request.headers.get('authorization'),'Key synthetic-unit-test-key-not-a-credential');
   if(request.url===f.cp.providerStatusUrl+'?logs=1')return Response.json({status:'COMPLETED',request_id:f.cp.providerJobId});
   if(request.url===f.cp.providerResponseUrl)return Response.json({request_id:f.cp.providerJobId,audio:{url:asset,content_type:'audio/mpeg',file_size:bytes.length,duration:20},lyrics:''});
   throw Error('unexpected_outbound:'+request.url);
  }});
  const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('Media');await install(db,exported);
  const invoke=async action=>{const response=await finite(mf.dispatchFetch('https://qualification.invalid/'+action),40000,action);const result=await finite(response.json(),3000,'json');reports.push({action,status:response.status,...result});if(!result.ok)console.log(JSON.stringify(reports,null,2));assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.metrics.failures,[]);return result;};
  await invoke('warm');const first=await invoke('recover');assert.equal(first.value.status,'completed');assert.equal(requests.length,3);assert.equal(first.metrics.puts,1);assert.equal(first.metrics.grace,skipGrace?0:1);assert.equal(first.metrics.deletes,0);
  const job=await db.prepare('SELECT status,attempt_count,correlation_id FROM document_jobs WHERE job_id=?').bind(f.jobId).first();assert.equal(job.status,'completed');assert.equal(job.attempt_count,2);assert.equal(job.correlation_id,f.jobId+':attempt:2');
  const snapshots=await rowsSnapshot(db,exported.tables);const second=await invoke('recover');assert.equal(second.value.replayed,true);assert.equal(requests.length,3);assert.deepEqual(await rowsSnapshot(db,exported.tables),snapshots);assert.equal(second.metrics.puts,1);
  if(!skipGrace){const cleanup=await invoke('cleanup');assert.equal(cleanup.value.reconciled,0);assert.equal(cleanup.value.pending,0);assert.equal(cleanup.metrics.deletes,0);}assert.equal((await bucket.list()).objects.length,1);
  console.log(JSON.stringify({passed:true,requests,reports},null,2));
 }finally{globalThis.fetch=originalFetch;if(mf){await finite(mf.dispose(),10000,'dispose');closed=true;}f.close();if(directory&&closed)await rm(directory,{recursive:true,force:true});}
});
