import {readFile,mkdir,open,rename,unlink,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {REQUIRED_COHORTS} from './score-still-search-qualification.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,code)=>{if(!value)throw Error(code);};
const str=v=>typeof v==='string'&&v.trim().length>0;
const amounts=v=>v&&['cents','calls','inputTokens','outputTokens'].every(k=>Number.isInteger(v[k])&&v[k]>=0);
const versionKeys=['environment','source','deployment','representation','embeddingModel','rerankerModel'];
async function boundFile(base,item){need(item&&str(item.path)&&/^[a-f0-9]{64}$/.test(item.sha256),'capture_bound_file_required');const path=resolve(base,item.path),bytes=await readFile(path);need(sha(bytes)===item.sha256,'capture_file_hash_mismatch');return {path,bytes};}
const boundedIdentity=v=>typeof v==='string'?v.slice(0,512):v;
/** Explicit content-free allowlist; never persist provider bodies, query text or unknown receipt fields. */
export function contentFreeObservation(value={}){
 const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
 return {...pick(value,['timedOut','partial','definitiveNoMatch','elapsedAfterDebounceMs']),
  partitions:Array.isArray(value.partitions)?value.partitions.map(p=>({id:boundedIdentity(p.id),custody:boundedIdentity(p.custody),semanticTop20:Array.isArray(p.semanticTop20)?p.semanticTop20.map(boundedIdentity):[],coverage:pick(p.coverage,['complete','expected','semantic','lexical'])})):[],
  preHydrationShortlist:Array.isArray(value.preHydrationShortlist)?value.preHydrationShortlist.map(boundedIdentity):[],finalTop3:Array.isArray(value.finalTop3)?value.finalTop3.map(boundedIdentity):[],
  failures:Array.isArray(value.failures)?value.failures.map(f=>({code:typeof f?.code==='string'&&/^[a-z0-9_.-]{1,80}$/i.test(f.code)?f.code:'unclassified_failure'})):[],
  versions:pick(value.versions,versionKeys),authorization:pick(value.authorization,['allowed','receiptId','policyEpoch']),
  providerDisclosures:Array.isArray(value.providerDisclosures)?value.providerDisclosures.map(d=>pick(d,['receiptId','custody','partitionIds','sourceIdentities','provider','model'])):undefined,
  stageTimingMs:pick(value.stageTimingMs,['authority','semantic','lexical','hydration','rerank']),
  usage:pick(value.usage,['receiptId','providerCalls','inputTokens','outputTokens','d1Reads','d1Writes','r2Reads','r2Bytes','runtimeCpuMs','runtimePeakBytes','measuredBy']),
  execution:pick(value.execution,['receiptId','instanceId','measuredBy','coldStart','coldStartEvidence','observedConcurrency','concurrencyGroup','corpusSize','corpusSha256'])};
}

/** A supported transport adapter is deliberately not supplied until platform ingress exists. */
export async function captureStillQualification({authorizationPath,manifestPath,adapterPath,outputPath,ledgerPath,now=()=>new Date(),timeoutMs=10000}){
 const authorizationBytes=await readFile(authorizationPath),authorization=JSON.parse(authorizationBytes),base=dirname(authorizationPath);
 need(['injected','live-hosted'].includes(authorization.executionKind),'capture_execution_kind_required');
 need(authorization.status==='approved'&&str(authorization.approvedBy)&&Date.parse(authorization.expiresAt)>+now(),'capture_authorization_required');
 need(authorization.productionActivation===false&&authorization.syntheticOnly===true,'capture_scope_invalid');
 need(authorization.isolation?.verified===true&&['environment','database','storage'].every(k=>str(authorization.isolation[k])),'capture_isolation_required');
 need(versionKeys.every(k=>str(authorization.versions?.[k]))&&authorization.versions.environment===authorization.isolation.environment,'capture_versions_required');
 need(authorization.ingress?.supported===true&&['native-administrative-execution','documented-machine-identity'].includes(authorization.ingress.kind)&&str(authorization.ingress.identity)&&str(authorization.ingress.operation),'capture_supported_ingress_required');
 need(!/browser|cookie|session|bypass|public|shared.?token/i.test(authorization.ingress.credentialClass??'')&&authorization.ingress.credentialClass==='service-identity','capture_service_identity_required');
 const approvalFile=await boundFile(base,authorization.approvalReceipt);
 if(authorization.executionKind==='live-hosted'){const approval=JSON.parse(approvalFile.bytes);need(approval.kind==='qualification-approval'&&approval.approved===true&&approval.grantedBy===authorization.approvedBy&&approval.environment===authorization.versions.environment&&approval.source===authorization.versions.source&&approval.packetManifestSha256===authorization.packetManifestSha256&&JSON.stringify(approval.totalLimit)===JSON.stringify(authorization.totalLimit),'capture_live_approval_receipt_invalid');}
 await boundFile(base,authorization.ingress.capabilityReceipt);await boundFile(base,authorization.isolation.receipt);
 const adapterBytes=await readFile(adapterPath);need(sha(adapterBytes)===authorization.adapterSha256,'capture_adapter_hash_mismatch');
 const manifestBytes=await readFile(manifestPath),manifest=JSON.parse(manifestBytes);need(sha(manifestBytes)===authorization.packetManifestSha256,'capture_packet_hash_mismatch');
 const inputFile=await boundFile(dirname(manifestPath),manifest.files?.heldoutInputs),inputs=JSON.parse(inputFile.bytes);
 need(['canary','full'].includes(authorization.phase),'capture_phase_required');
 need(inputs.queries?.length>=(authorization.phase==='canary'?5:60)&&new Set(inputs.queries.map(q=>q.id)).size===inputs.queries.length,'capture_queries_required');
 need(Date.parse(manifest.frozenAt)<+now()&&(authorization.phase==='canary'?manifest.heldOut===false:manifest.heldOut===true&&manifest.tuningConsumed===false),'capture_frozen_packet_required');
 need(amounts(authorization.totalLimit)&&amounts(authorization.perRequestReservation)&&authorization.perRequestReservation.cents>0&&authorization.perRequestReservation.calls>0&&authorization.perRequestReservation.inputTokens>0&&authorization.totalLimit.cents<=2500&&authorization.totalLimit.cents>0,'capture_budget_required');
 need([1000,10000].every(size=>/^[a-f0-9]{64}$/.test(authorization.cohortCorpora?.[String(size)]??'')),'capture_cohort_corpora_required');
 need(['canary','full'].includes(authorization.phase),'capture_phase_required');
 if(authorization.phase==='canary')need(authorization.totalLimit.cents<=500,'capture_canary_cap_exceeded');
 else{const canaryFile=await boundFile(base,authorization.canaryPassReceipt);if(authorization.executionKind==='live-hosted'){const canary=JSON.parse(canaryFile.bytes);need(canary.kind==='qualification-canary'&&canary.status==='passed'&&canary.environment===authorization.versions.environment&&versionKeys.every(k=>canary.versions?.[k]===authorization.versions[k])&&canary.accountingVerified===true&&canary.cleanupVerified===true,'capture_canary_receipt_invalid');}}
 need(Number.isInteger(authorization.samplesPerCohort)&&authorization.samplesPerCohort>=30&&authorization.samplesPerCohort<=1000,'capture_sample_count_required');
 need(Number.isInteger(authorization.concurrency)&&authorization.concurrency>=2&&authorization.concurrency<=8,'capture_concurrency_required');
 await mkdir(dirname(outputPath),{recursive:true});await mkdir(dirname(ledgerPath),{recursive:true});
 // One process owns this allowance. Uncertain reservations remain charged after a crash.
 try{await access(outputPath);throw Error('capture_output_already_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 const lock=await open(ledgerPath+'.lock','wx',0o600);let ledger;
 try{
  try{ledger=JSON.parse(await readFile(ledgerPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;ledger={authorizationSha256:sha(authorizationBytes),reservations:[]};}
  need(ledger.authorizationSha256===sha(authorizationBytes),'capture_ledger_authorization_mismatch');
  const persist=async(path,value)=>{const temp=path+'.'+randomUUID()+'.tmp';const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temp,path);const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}};
  const adapter=await import(pathToFileURL(resolve(adapterPath)).href);
  need(typeof adapter.inspectEnvironment==='function'&&typeof adapter.invokeSearch==='function','capture_adapter_contract_invalid');
  const inspected=await adapter.inspectEnvironment({authorization});
  need((authorization.executionKind==='injected'||inspected?.runtime==='hosted'&&inspected?.providerMode==='live')&&inspected?.isolationVerified===true&&versionKeys.every(k=>inspected.versions?.[k]===authorization.versions[k])&&inspected.database===authorization.isolation.database&&inspected.storage===authorization.isolation.storage,'capture_environment_mismatch');
  const run={schemaVersion:2,kind:authorization.executionKind==='injected'?'injected':'live-hosted',packetId:manifest.packetId,packetHashes:Object.fromEntries(Object.entries(manifest.files).map(([k,v])=>[k,v.sha256])),authorizationManifestSha256:sha(authorizationBytes),versions:authorization.versions,cohortCorpora:authorization.cohortCorpora,runStartedAt:now().toISOString(),cases:[],latencySamples:[]};
  const reserve=async requestId=>{
   need(Date.parse(authorization.expiresAt)>+now(),'capture_authorization_expired');
   const used=Object.fromEntries(Object.keys(authorization.totalLimit).map(k=>[k,ledger.reservations.reduce((n,r)=>n+r.amounts[k],0)]));
   need(Object.keys(authorization.totalLimit).every(k=>used[k]+authorization.perRequestReservation[k]<=authorization.totalLimit[k]),'capture_allowance_exhausted');
   const reservation={requestId,at:now().toISOString(),amounts:authorization.perRequestReservation,status:'reserved'};ledger.reservations.push(reservation);await persist(ledgerPath,ledger);return reservation;
  };
  // Serialized reservations prevent concurrent workers observing the same remaining allowance.
  let serial=Promise.resolve();const locked=fn=>{const next=serial.then(fn);serial=next.catch(()=>{});return next;};
  let uncertain=false;
  const invoke=async(q,cohort)=>{
   need(!uncertain,'capture_uncertain_request_stop');
   const requestId=randomUUID(),reservation=await locked(()=>reserve(requestId)),startedAt=now().toISOString(),start=performance.now();let timer,observation;
   const controller=new AbortController();try{
    const pending=Promise.resolve(adapter.invokeSearch({requestId,query:q.query,scope:q.scope,permittedPartitions:q.permittedPartitions,...cohort},{authorization,reservation,signal:controller.signal}));
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('capture_timeout'));},timeoutMs);});
    const value=await Promise.race([pending,timeout]);observation=contentFreeObservation(value);
    const usage=observation.usage;const withinReservation=[['providerCalls','calls'],['inputTokens','inputTokens'],['outputTokens','outputTokens']].every(([observed,reserved])=>Number.isInteger(usage?.[observed])&&usage[observed]>=0&&usage[observed]<=reservation.amounts[reserved]);
    reservation.status=withinReservation?'returned':'uncertain';if(!withinReservation){uncertain=true;observation.partial=true;observation.failures=[...(observation.failures??[]),{code:'capture_usage_exceeds_or_omits_reservation'}];}
   }catch{observation={partitions:[],preHydrationShortlist:[],finalTop3:[],partial:true,timedOut:controller.signal.aborted,definitiveNoMatch:false,failures:[{code:controller.signal.aborted?'capture_timeout':'capture_transport_failure'}],elapsedAfterDebounceMs:performance.now()-start};reservation.status='uncertain';uncertain=true;}
   finally{clearTimeout(timer);}
   const result={...observation,elapsedAfterDebounceMs:performance.now()-start,queryId:q.id,requestId,startedAt,...cohort};
   await locked(async()=>{(cohort?run.latencySamples:run.cases).push(result);await persist(ledgerPath,ledger);await persist(outputPath,run);});return result;
  };
  const queries=authorization.phase==='canary'?inputs.queries.slice(0,Math.min(5,inputs.queries.length)):inputs.queries;
  for(const q of queries)await invoke(q);
  if(authorization.phase==='full')for(const key of REQUIRED_COHORTS){const [size,cohort]=key.split('-');for(let i=0;i<authorization.samplesPerCohort;){const count=cohort==='concurrent'?Math.min(authorization.concurrency,authorization.samplesPerCohort-i):1;const group=randomUUID();await Promise.all(Array.from({length:count},(_,n)=>invoke(inputs.queries[(i+n)%inputs.queries.length],{corpusSize:Number(size),cohort,...(cohort==='concurrent'?{concurrencyGroup:group}: {})})));i+=count;}}
  run.runCompletedAt=now().toISOString();run.accounting={reserved:ledger.reservations.reduce((v,r)=>Object.fromEntries(Object.keys(v).map(k=>[k,v[k]+r.amounts[k]])),{cents:0,calls:0,inputTokens:0,outputTokens:0}),reservations:ledger.reservations.length,uncertain:ledger.reservations.filter(r=>r.status!=='returned').length};await persist(outputPath,run);return run;
 }finally{await lock.close();await unlink(ledgerPath+'.lock');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [authorizationPath,manifestPath,adapterPath,outputPath,ledgerPath]=process.argv.slice(2);need([authorizationPath,manifestPath,adapterPath,outputPath,ledgerPath].every(str),'Usage: node scripts/still-qualification-capture.mjs AUTHORIZATION.json FROZEN-MANIFEST.json REVIEWED-ADAPTER.mjs PRIVATE-RUN.json DURABLE-ALLOWANCE.json');
 const run=await captureStillQualification({authorizationPath,manifestPath,adapterPath,outputPath,ledgerPath});console.log(JSON.stringify({kind:run.kind,queries:run.cases.length,latencySamples:run.latencySamples.length,accounting:run.accounting,activationAuthorized:false}));
}
