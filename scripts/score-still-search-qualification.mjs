import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
// Offline only: this command never dispatches providers or grants activation authority.
export function scoreStillSearchQualification(run){
 const cases=run.cases;if(!Array.isArray(cases)||!cases.length)throw Error('qualification_cases_required');
 const identities=new Set();let positives=0,negatives=0,topThreeHits=0,semanticHits=0,falsePositives=0,authorizationLeaks=0;const latencies=new Map();
 for(const c of cases){if(typeof c.id!=='string'||identities.has(c.id)||!['positive','no-match'].includes(c.classification)||!Array.isArray(c.intended)||!Array.isArray(c.allowed)||!Array.isArray(c.semanticTop20)||!Array.isArray(c.finalTop3)||c.semanticTop20.length>20||c.finalTop3.length>3||!Number.isFinite(c.elapsedAfterDebounceMs)||c.elapsedAfterDebounceMs<0||typeof c.cohort!=='string')throw Error('qualification_case_invalid');identities.add(c.id);
  const lists=[c.intended,c.allowed,c.semanticTop20,c.finalTop3];if(lists.some(list=>list.some(id=>typeof id!=='string'||!id)||new Set(list).size!==list.length))throw Error('qualification_identity_invalid');
  if(c.classification==='positive'){if(!c.intended.length||c.intended.some(id=>!c.allowed.includes(id)))throw Error('qualification_positive_invalid');positives++;if(c.finalTop3.some(id=>c.intended.includes(id)))topThreeHits++;if(c.semanticTop20.some(id=>c.intended.includes(id)))semanticHits++;}
  else{if(c.intended.length)throw Error('qualification_negative_invalid');negatives++;if(c.finalTop3.length)falsePositives++;}
  authorizationLeaks+=new Set([...c.semanticTop20,...c.finalTop3].filter(id=>!c.allowed.includes(id))).size;
  const cohort=latencies.get(c.cohort)??[];cohort.push(c.elapsedAfterDebounceMs);latencies.set(c.cohort,cohort);
 }
 const topThreeRate=positives?topThreeHits/positives:null,semanticRecall20=positives?semanticHits/positives:null,falsePositiveRate=negatives?falsePositives/negatives:null;
 const timing=Object.fromEntries([...latencies].map(([k,v])=>{v.sort((a,b)=>a-b);return[k,{n:v.length,p50Ms:v[Math.ceil(v.length*.5)-1],p95Ms:v[Math.ceil(v.length*.95)-1]}];}));
 const independent=typeof run.independentLabeler==='string'&&run.independentLabeler.trim().length>0&&Number.isFinite(Date.parse(run.labelsFrozenAt))&&Date.parse(run.labelsFrozenAt)<Date.parse(run.runStartedAt);
 const metricsPass=cases.length>=50&&positives>0&&negatives>0&&topThreeRate>=.9&&semanticRecall20>=.95&&falsePositiveRate<=.1&&authorizationLeaks===0;
 const evidenceComplete=independent&&run.kind==='live-hosted'&&typeof run.deployment==='string'&&!!run.deployment&&typeof run.representation==='string'&&!!run.representation;
 return {queries:cases.length,positiveDenominator:positives,negativeDenominator:negatives,topThreeHits,topThreeRate,semanticHits,semanticRecall20,falsePositives,falsePositiveRate,authorizationLeaks,timing,metricsPass,evidenceComplete,relevanceGatePass:metricsPass&&evidenceComplete,activationAuthorized:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const path=process.argv[2];if(!path)throw Error('Usage: node scripts/score-still-search-qualification.mjs /absolute/run.json');const result=scoreStillSearchQualification(JSON.parse(await readFile(path,'utf8')));console.log(JSON.stringify(result,null,2));if(!result.relevanceGatePass)process.exitCode=2;}
