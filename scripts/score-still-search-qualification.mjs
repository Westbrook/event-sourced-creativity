import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// Offline only. Labels are read separately from observations and are never sent to a provider.
const verifiedPackets=new WeakSet(),verifiedAuthorizations=new WeakSet();
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
const uniqueStrings=v=>Array.isArray(v)&&v.every(nonempty)&&new Set(v).size===v.length;
const finite=v=>Number.isFinite(v)&&v>=0;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};
const date=v=>nonempty(v)&&Number.isFinite(Date.parse(v));
export const REQUIRED_COHORTS=[1000,10000].flatMap(size=>['cold','warm','concurrent'].map(mode=>`${size}-${mode}`));

/** Verify exact frozen bytes and review evidence; this does not authenticate a person's identity. */
export async function loadFrozenQualificationPacket(manifestPath){
 const manifestBytes=await readFile(manifestPath),manifest=JSON.parse(manifestBytes),files={};
 if(['corpus','heldoutInputs','labels','provenance'].some(k=>!manifest.files?.[k]))fail('qualification_packet_manifest_invalid');
 for(const name of Object.keys(manifest.files)){
  const item=manifest.files?.[name];if(!item||!nonempty(item.path)||!/^([a-f0-9]{64})$/.test(item.sha256??''))fail('qualification_packet_manifest_invalid');
  const bytes=await readFile(resolve(dirname(manifestPath),item.path));if(hash(bytes)!==item.sha256)fail(`qualification_packet_hash_mismatch:${name}`);files[name]=JSON.parse(bytes);
 }
 const inputs=files.heldoutInputs,labels=files.labels,p=files.provenance;
 const labelRows=labels.queries??labels.labels;
 if(!Array.isArray(inputs.queries)||!Array.isArray(labelRows))fail('qualification_packet_queries_required');
 const labelsById=new Map(labelRows.map(l=>[l.id,l]));
 if(labelsById.size!==labelRows.length||labelRows.length!==inputs.queries.length)fail('qualification_packet_labels_mismatch');
 const queries=inputs.queries.map(q=>{const l=labelsById.get(q.id);if(!l)fail('qualification_packet_label_missing');if(q.allowedIds&&JSON.stringify([...q.allowedIds].sort())!==JSON.stringify([...(l.allowed??l.allowedIds??[])].sort()))fail('qualification_label_allowlist_mismatch');return {...q,classification:l.classification??(l.kind==='negative'?'no-match':l.kind),intended:l.intended??l.intendedIds,allowed:l.allowed??l.allowedIds,intendedPartition:l.intendedPartition??l.intendedPartitionId,ambiguity:l.ambiguity};});
 const producer=p.producer??manifest.producer,reviewer=p.reviewer??manifest.reviewer;
 const tasksDistinct=nonempty(producer?.task)&&nonempty(reviewer?.task)&&producer.task!==reviewer.task;
 const decisions=p.decisions??p.adjudications;
 const reviewBound=p.reviewedCorpusSha256===manifest.files.corpus.sha256&&p.reviewedInputsSha256===manifest.files.heldoutInputs.sha256&&p.labelsSha256===manifest.files.labels.sha256;
 const everyQueryReviewed=Array.isArray(decisions)&&decisions.length===queries.length&&new Set(decisions.map(d=>d.id)).size===queries.length&&queries.every(q=>decisions.some(d=>d.id===q.id&&nonempty(d.resolution)));
 const reviewEvidence=p.reviewEvidence;
 let receiptBound=false;
 if(reviewEvidence&&nonempty(reviewEvidence.path)&&/^[a-f0-9]{64}$/.test(reviewEvidence.sha256??'')){
  const bytes=await readFile(resolve(dirname(manifestPath),reviewEvidence.path));
  if(hash(bytes)!==reviewEvidence.sha256)fail('qualification_review_evidence_hash_mismatch');
  const receipt=JSON.parse(bytes);
  receiptBound=receipt.producerTask===producer?.task&&receipt.reviewerTask===reviewer?.task&&receipt.packetId===manifest.packetId&&receipt.labelsSha256===manifest.files.labels.sha256&&receipt.kind==='independent-review-receipt'&&nonempty(receipt.recordedBy)&&receipt.recordedBy!==reviewer.task;
 }
 const frozenAt=manifest.frozenAt??labels.frozenAt;
 const provenanceVerified=manifest.heldOut===true&&manifest.tuningConsumed===false&&date(frozenAt)&&date(p.completedAt)&&Date.parse(p.completedAt)<=Date.parse(frozenAt)&&tasksDistinct&&nonempty(reviewer?.identity)&&reviewBound&&everyQueryReviewed&&receiptBound;
 const identities=Object.fromEntries(['projects','documents','ideas'].flatMap(k=>files.corpus[k]??[]).map(v=>[v.id,{partitionId:v.partitionId,custody:v.custody}]));
 for(const q of queries)if(q.allowed.some(id=>!identities[id]||!q.permittedPartitions.some(p=>p.id===identities[id].partitionId&&(p.custody??p.custodyId)===identities[id].custody)))fail('qualification_label_authority_invalid');
 for(const q of queries){const decision=Array.isArray(decisions)?decisions.find(d=>d.id===q.id):undefined;if(decision?.ambiguity===true)q.ambiguity=true;}
 const packet={packetId:manifest.packetId,manifestSha256:hash(manifestBytes),identities,queries,frozenAt,hashes:Object.fromEntries(Object.entries(manifest.files).map(([k,v])=>[k,v.sha256])),provenanceVerified,provenance:{tasksDistinct,reviewBound,everyQueryReviewed,receiptBound,identityAuthentication:'Task receipt and hash verification; operator must audit reviewer identity and actual independence.'}};
 validateQueries(packet.queries);if(provenanceVerified)verifiedPackets.add(packet);return packet;
}
/** Load the reviewed authorization rather than trusting a hash asserted by a run. */
export async function loadQualificationAuthorization(path){
 const bytes=await readFile(path),a=JSON.parse(bytes);
 if(a.status!=='approved'||a.executionKind!=='live-hosted'||a.productionActivation!==false||a.syntheticOnly!==true||!nonempty(a.approvedBy)||!date(a.expiresAt)||a.isolation?.verified!==true||a.ingress?.supported!==true||a.ingress.credentialClass!=='service-identity'||!['native-administrative-execution','documented-machine-identity'].includes(a.ingress.kind))fail('qualification_authorization_invalid');
 if(!a.totalLimit||!['cents','calls','inputTokens','outputTokens'].every(k=>Number.isInteger(a.totalLimit[k])&&a.totalLimit[k]>=0)||a.totalLimit.cents>2500)fail('qualification_authorization_budget_invalid');
 const bound=async item=>{if(!item||!nonempty(item.path)||!/^([a-f0-9]{64})$/.test(item.sha256??''))fail('qualification_authorization_receipt_required');const data=await readFile(resolve(dirname(path),item.path));if(hash(data)!==item.sha256)fail('qualification_authorization_receipt_hash_mismatch');return JSON.parse(data);};
 const approval=await bound(a.approvalReceipt);await bound(a.isolation.receipt);await bound(a.ingress.capabilityReceipt);
 if(approval.kind!=='qualification-approval'||approval.approved!==true||approval.grantedBy!==a.approvedBy||approval.environment!==a.versions?.environment||approval.source!==a.versions?.source||approval.packetManifestSha256!==a.packetManifestSha256||JSON.stringify(approval.totalLimit)!==JSON.stringify(a.totalLimit))fail('qualification_approval_scope_mismatch');
 const result={...a,sha256:hash(bytes)};verifiedAuthorizations.add(result);return result;
}
function validateQueries(queries){
 if(!Array.isArray(queries)||!queries.length)fail('qualification_cases_required');
 const ids=new Set(),texts=new Set();for(const q of queries){
  if(!nonempty(q.id)||ids.has(q.id)||!['positive','no-match'].includes(q.classification)||!uniqueStrings(q.intended)||!uniqueStrings(q.allowed)||!Array.isArray(q.permittedPartitions)||!q.permittedPartitions.length)fail('qualification_case_invalid');ids.add(q.id);const text=typeof q.query==='string'?q.query.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase():'';if(!text||texts.has(text))fail('qualification_query_duplicate_or_empty');texts.add(text);
  if(q.permittedPartitions.some(p=>!nonempty(p.id)||!nonempty(p.custody??p.custodyId))||new Set(q.permittedPartitions.map(p=>p.id)).size!==q.permittedPartitions.length)fail('qualification_partition_invalid');
  if(q.classification==='positive'&&(!q.intended.length||q.intended.some(id=>!q.allowed.includes(id))||!q.permittedPartitions.some(p=>p.id===q.intendedPartition)))fail('qualification_positive_invalid');
  if(q.classification==='no-match'&&q.intended.length)fail('qualification_negative_invalid');
 }
}
const sameVersions=(a,b)=>['source','deployment','environment','representation','embeddingModel','rerankerModel'].every(k=>nonempty(a?.[k])&&a[k]===b?.[k]);
function validateObservation(o,q,versions,identities,runStartedAt){
 const errors=[],leaks=new Set();
 if(!o||!nonempty(o.requestId)||!date(o.startedAt))return {complete:false,errors:['missing_observation'],leaks:[],semantic:[],final:[]};
 if(!date(runStartedAt)||Date.parse(o.startedAt)<Date.parse(runStartedAt))errors.push('observation_predates_run');
 const lists=(v,max,where)=>{if(!uniqueStrings(v)||v.length>max){errors.push(where+'_invalid');return [];}for(const id of v)if(!q.allowed.includes(id))leaks.add(id);return v;};
 const final=lists(o.finalTop3,3,'final'),shortlist=lists(o.preHydrationShortlist,24,'shortlist');
 const partitions=Array.isArray(o.partitions)?o.partitions:[];
 if(partitions.length!==q.permittedPartitions.length||new Set(partitions.map(p=>p.id)).size!==partitions.length)errors.push('partition_set_incomplete');
 let semantic=[];
 for(const p of partitions){
  const permitted=q.permittedPartitions.find(v=>v.id===p.id&&(v.custody??v.custodyId)===p.custody);
  if(!permitted){errors.push('forbidden_partition');leaks.add('partition:'+p.id);}
  const candidates=lists(p.semanticTop20,20,'semantic');for(const id of candidates)if(!identities?.[id]||identities[id].partitionId!==p.id||identities[id].custody!==p.custody){errors.push('candidate_partition_mismatch');leaks.add(id);}if(p.id===q.intendedPartition)semantic=candidates;
  const c=p.coverage;if(!c||c.complete!==true||!Number.isInteger(c.expected)||c.expected<0||!Number.isInteger(c.semantic)||c.semantic<c.expected||!Number.isInteger(c.lexical)||c.lexical<c.expected)errors.push('coverage_incomplete');
 }
 if(q.permittedPartitions.some(p=>!partitions.some(v=>v.id===p.id)))errors.push('partition_missing');
 if(o.timedOut!==false||o.partial!==false||!Array.isArray(o.failures)||o.failures.length)errors.push('request_incomplete');
 if(!sameVersions(o.versions,versions))errors.push('versions_unbound');
 if(!o.authorization||o.authorization.allowed!==true||!nonempty(o.authorization.receiptId)||!nonempty(o.authorization.policyEpoch))errors.push('authorization_missing');
 if(!Array.isArray(o.providerDisclosures))errors.push('disclosure_receipts_missing');
 else for(const d of o.providerDisclosures){
  if(!nonempty(d.receiptId)||![versions?.embeddingModel,versions?.rerankerModel].includes(d.model)||!nonempty(d.custody)||!uniqueStrings(d.partitionIds)||!d.partitionIds.length||!uniqueStrings(d.sourceIdentities)||!nonempty(d.provider)||!nonempty(d.model)){errors.push('disclosure_invalid');continue;}
  if(d.partitionIds.some(id=>!q.permittedPartitions.some(p=>p.id===id&&(p.custody??p.custodyId)===d.custody))){errors.push('cross_custody_disclosure');leaks.add('disclosure:'+d.receiptId);}
  for(const id of d.sourceIdentities){if(!q.allowed.includes(id)||!identities?.[id]||identities[id].custody!==d.custody||!d.partitionIds.includes(identities[id].partitionId)){errors.push('cross_custody_source_disclosure');leaks.add(id);}if(!shortlist.includes(id)){errors.push('disclosure_outside_shortlist');leaks.add('disclosure-source:'+id);}}
 }
 if(!o.stageTimingMs||!['authority','semantic','lexical','hydration','rerank'].every(k=>finite(o.stageTimingMs[k])))errors.push('timings_missing');
 if(!o.usage||!nonempty(o.usage.receiptId)||!['providerCalls','inputTokens','outputTokens','d1Reads','d1Writes','r2Reads','r2Bytes','runtimeCpuMs','runtimePeakBytes'].every(k=>finite(o.usage[k]))||o.usage.measuredBy!=='host-runtime')errors.push('usage_missing');
 if(Array.isArray(o.providerDisclosures)&&o.usage?.providerCalls!==o.providerDisclosures.length)errors.push('provider_receipts_incomplete');
 if(!finite(o.elapsedAfterDebounceMs))errors.push('elapsed_missing');
 if(final.some(id=>!shortlist.includes(id)))errors.push('final_outside_shortlist');
 if(q.classification==='no-match'&&final.length===0&&o.definitiveNoMatch!==true)errors.push('no_match_not_definitive');
 return {complete:errors.length===0,errors,leaks:[...leaks],semantic,final};
}

/** Numerical results never grant activation. Missing/failed requests stay in frozen denominators. */
export function scoreStillSearchQualification(run,packet,authorization){
 if(!packet)fail('qualification_frozen_packet_required');validateQueries(packet.queries);
 if(!Array.isArray(run.cases)||!Array.isArray(run.latencySamples))fail('qualification_observations_required');
 const byId=new Map(),requestIds=new Set();
 for(const o of run.cases){if(!nonempty(o.queryId)||byId.has(o.queryId)||!packet.queries.some(q=>q.id===o.queryId))fail('qualification_observation_duplicate_or_unknown');byId.set(o.queryId,o);if(nonempty(o.requestId)){if(requestIds.has(o.requestId))fail('qualification_request_duplicate');requestIds.add(o.requestId);}}
 let positives=0,negatives=0,topThreeHits=0,semanticHits=0,falsePositives=0,failedNegatives=0,authorizationLeaks=0,incomplete=0;const failures=[],partitionRecall={};
 for(const q of packet.queries){const v=validateObservation(byId.get(q.id),q,run.versions,packet.identities,run.runStartedAt);authorizationLeaks+=v.leaks.length;if(!v.complete){incomplete++;failures.push({queryId:q.id,errors:v.errors});}
  if(q.classification==='positive'){positives++;if(v.complete&&v.final.some(id=>q.intended.includes(id)))topThreeHits++;const semanticHit=v.complete&&v.semantic.some(id=>q.intended.includes(id));if(semanticHit)semanticHits++;const partition=partitionRecall[q.intendedPartition]??={positiveDenominator:0,hits:0};partition.positiveDenominator++;if(semanticHit)partition.hits++;}
  else{negatives++;if(v.final.length)falsePositives++;if(!v.complete)failedNegatives++;}
 }
 const timing={},latencyFailures=[],usageReceipts=new Set(run.cases.map(c=>c.usage?.receiptId).filter(Boolean)),executionReceipts=new Set();
 for(const key of REQUIRED_COHORTS){const samples=[],coldInstances=new Set();for(const s of run.latencySamples.filter(s=>`${s.corpusSize}-${s.cohort}`===key)){
   if(!nonempty(s.requestId)||requestIds.has(s.requestId))fail('qualification_request_duplicate');requestIds.add(s.requestId);
   const q=packet.queries.find(q=>q.id===s.queryId);if(!q)fail('qualification_latency_query_unknown');
   const v=validateObservation(s,q,run.versions,packet.identities,run.runStartedAt);authorizationLeaks+=v.leaks.length;
   const execution=s.execution;
   let valid=v.complete&&execution&&execution.corpusSize===s.corpusSize&&/^[a-f0-9]{64}$/.test(run.cohortCorpora?.[String(s.corpusSize)]??'')&&execution.corpusSha256===run.cohortCorpora[String(s.corpusSize)]&&nonempty(execution.receiptId)&&nonempty(execution.instanceId)&&execution.measuredBy==='host-runtime';
   if(s.cohort==='cold'){valid=valid&&execution.coldStart===true&&nonempty(execution.coldStartEvidence)&&!coldInstances.has(execution.instanceId);coldInstances.add(execution?.instanceId);}
   if(s.cohort==='warm')valid=valid&&execution.coldStart===false;
   if(s.cohort==='concurrent')valid=valid&&Number.isInteger(execution.observedConcurrency)&&execution.observedConcurrency>=2&&nonempty(execution.concurrencyGroup);
   if(usageReceipts.has(s.usage?.receiptId)||executionReceipts.has(execution?.receiptId))valid=false;usageReceipts.add(s.usage?.receiptId);executionReceipts.add(execution?.receiptId);
   samples.push(valid?s.elapsedAfterDebounceMs:Infinity);if(!valid)latencyFailures.push(s.requestId);
  }
  samples.sort((a,b)=>a-b);const q=n=>samples.length?samples[Math.ceil(samples.length*n)-1]:null;const p95=q(.95);
  const repeatRequired=Number.isFinite(p95)&&p95>1800&&p95<=2000&&samples.length<60;
  timing[key]={n:samples.length,repeatRequired,quantileMethod:'nearest-rank',samplingUncertainty:'Thirty observations provide sparse tail evidence; 1800–2000 ms p95 requires at least thirty additional observations before accepting the cohort.',failures:samples.filter(v=>!Number.isFinite(v)).length,p50Ms:Number.isFinite(q(.5))?q(.5):null,p95Ms:Number.isFinite(p95)?p95:null,pass:!repeatRequired&&samples.length>=30&&Number.isFinite(p95)&&p95<=2000&&samples.every(Number.isFinite)};
 }
 if(run.latencySamples.some(s=>!REQUIRED_COHORTS.includes(`${s.corpusSize}-${s.cohort}`)))fail('qualification_cohort_unknown');
 const topThreeRate=positives?topThreeHits/positives:null,semanticRecall20=positives?semanticHits/positives:null,falsePositiveRate=negatives?falsePositives/negatives:null;
 const unambiguousPositives=packet.queries.filter(q=>q.classification==='positive'&&q.ambiguity!==true).length;
 const numericalPass=packet.queries.length>=60&&positives>=40&&unambiguousPositives>=40&&negatives>=20&&topThreeRate>=.9&&semanticRecall20>=.95&&Object.values(partitionRecall).every(p=>p.hits/p.positiveDenominator>=.95)&&falsePositiveRate<=.1&&failedNegatives===0&&authorizationLeaks===0&&incomplete===0;
 const provenancePass=verifiedPackets.has(packet)&&packet.provenanceVerified===true&&date(run.runStartedAt)&&Date.parse(packet.frozenAt)<Date.parse(run.runStartedAt)&&run.packetId===packet.packetId&&Object.entries(packet.hashes??{}).every(([k,v])=>run.packetHashes?.[k]===v);
 const hostedEvidence=run.kind==='live-hosted'&&nonempty(run.authorizationManifestSha256)&&/^[a-f0-9]{64}$/.test(run.authorizationManifestSha256)&&sameVersions(run.versions,run.versions);
 const observedUsage=[...run.cases,...run.latencySamples].reduce((sum,o)=>({calls:sum.calls+(o.usage?.providerCalls??0),inputTokens:sum.inputTokens+(o.usage?.inputTokens??0),outputTokens:sum.outputTokens+(o.usage?.outputTokens??0)}),{calls:0,inputTokens:0,outputTokens:0});
 const authorizationPass=verifiedAuthorizations.has(authorization)&&Object.entries(observedUsage).every(([k,v])=>Number.isFinite(v)&&v<=authorization.totalLimit[k])&&authorization.sha256===run.authorizationManifestSha256&&authorization.packetManifestSha256===packet.manifestSha256&&sameVersions(authorization.versions,run.versions)&&[1000,10000].every(size=>authorization.cohortCorpora?.[size]===run.cohortCorpora?.[size])&&Date.parse(run.runStartedAt)<Date.parse(authorization.expiresAt)&&[...run.cases,...run.latencySamples].every(o=>Date.parse(o.startedAt)<Date.parse(authorization.expiresAt));
 const evidenceComplete=provenancePass&&hostedEvidence&&authorizationPass;const responsivenessPass=Object.values(timing).every(v=>v.pass);
 for(const p of Object.values(partitionRecall))p.recall20=p.hits/p.positiveDenominator;
 return {queries:packet.queries.length,partitionRecall,unambiguousPositives,positiveDenominator:positives,negativeDenominator:negatives,topThreeHits,topThreeRate,semanticHits,semanticRecall20,falsePositives,falsePositiveRate,failedNegatives,incomplete,authorizationLeaks,timing,failures,latencyFailures,metricsPass:numericalPass,provenancePass,authorizationPass,evidenceComplete,relevanceGatePass:numericalPass&&evidenceComplete,responsivenessGatePass:responsivenessPass&&evidenceComplete,qualificationPass:numericalPass&&responsivenessPass&&evidenceComplete,activationAuthorized:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [runPath,packetPath,authorizationPath]=process.argv.slice(2);if(!runPath||!packetPath||!authorizationPath)fail('Usage: node scripts/score-still-search-qualification.mjs /absolute/run.json /absolute/frozen-manifest.json /absolute/authorization.json');
 const packet=await loadFrozenQualificationPacket(packetPath),authorization=await loadQualificationAuthorization(authorizationPath),result=scoreStillSearchQualification(JSON.parse(await readFile(runPath,'utf8')),packet,authorization);console.log(JSON.stringify(result,null,2));if(!result.qualificationPass)process.exitCode=2;
}
