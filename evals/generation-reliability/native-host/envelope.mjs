/** Offline, immutable H3 envelope. No network, credentials, product DB or paid grant. */
import { readFile,readdir,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { firstCompilerStudy } from '../first-compiler-study.mjs';
import { seal,hash,canonical,verifySeal } from '../core.mjs';
import { validateExecutionPlan } from '../execution-plan.mjs';
const root=new URL('../../../',import.meta.url),out=new URL('docs/evidence/generation-h3/',root);
const version=JSON.parse(await readFile(new URL('version.json',out),'utf8'));
execFileSync('git',['merge-base','--is-ancestor',version.integratedSource,'HEAD'],{cwd:fileURLToPath(root)});
const read=p=>readFile(new URL(p,root));
async function files(dir){const found=[];for(const e of await readdir(new URL(dir,root),{withFileTypes:true})){const path=`${dir}/${e.name}`;if(e.isDirectory())found.push(...await files(path));else if(/\.(?:ts|mjs|sql)$/.test(path))found.push(path);}return found;}
const seed=await firstCompilerStudy();
const inputs=[...new Set([...Object.keys(seed.runtimeIdentity.sourceHashes),...await files('worker'),...await files('src/model'),...await files('drizzle'),...await files('evals/generation-reliability/native-host'),
 'db/schema.ts','db/generation-study.pending.sql','package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','docs/evidence/generation-h3/preparation-proposal.json','docs/evidence/generation-h3/version.json'])].sort();
const sourceHashes=Object.fromEntries(await Promise.all(inputs.map(async p=>[p,hash(await read(p))])));
const runtimeIdentity={...seed.runtimeIdentity,sourceHashes,nativeHost:'disabled-native-study-v1',deployment:'not-installed',authorityDomain:'existing trusted authenticated personal owner and sole production D1 binding; no request-selected database'};
const {id:seedId,...seedBody}=seed;
const plan=seal('execution',{...seedBody,runtimeIdentity,
 inventory:{perTrial:{planner:0,moderation:1,image:1,storage:1,contextChecker:0,evaluator:0,providerStatusReads:0,providerResultReads:0,evidenceWrites:7},preparationPlanner:1,concurrency:1,maximumUnreconciled:1,generationRetries:0,artifactReadsPerOriginal:2,cleanupAttemptsPerOriginal:1,privateRetentionDaysAtMost:30,unpriced:['host and D1 row/scan accounting','evidence and financial retention','deletion','account-specific egress','human review','original-charge reconciliation']},
 nativeReadiness:{sourceCapture:'synthetic-reference-only-not-an-actual-input-capture',actualSource:null,actualDirection:null,hostInstalled:false,financialAvailable:false,maximumCostMicrousd:null,liveAuthorized:false},
 foundation:{...version,syntheticReferenceEnvelope:seedId,immutableHistoricalEnvelopes:'preserved; this does not renew C or F2',f2CurrentRuntimeQualified:false}});
validateExecutionPlan(plan);
const archivePaths=[...version.previousEnvelopes,'evals/generation-reliability/e2a/artifacts/capture.json','evals/generation-reliability/e2a/artifacts/before.txt','evals/generation-reliability/e2a/artifacts/after.txt','evals/generation-reliability/e2a/artifacts/exact-diff.json','evals/generation-reliability/e2a/artifacts/semantic-ledger.json','docs/evidence/f2-sunburst/financial-gate.json'];
const capture=seal('h3-binding-capture',{version:'h3-disabled-bindings-v1',integratedSource:version.integratedSource,e2Source:version.e2Source,executionPlanId:plan.id,runtimeHash:hash(runtimeIdentity),
 proposalSha256:sourceHashes['docs/evidence/generation-h3/preparation-proposal.json'],sourceDiscovery:{authority:'existing authenticated owner-facing UI',completeFrozenSource:null,retainedPlannerDirection:null,originalAttempt:'retained prompt unavailable; frozen source and private request/response not recorded; planner response ID not recorded',privateBytesCopied:0},
 cSyntheticCapture:seed.candidate.id,financialReference:seed.financial.id,financialReferenceRenewed:false,actualCapture:null,providerCallsMade:0,completedLiveStudies:0,
 immutableEvidenceSha256:Object.fromEntries(await Promise.all(archivePaths.map(async p=>[p,hash(await read(p))])))});
for(const [name,value,kind] of [['execution-envelope.json',plan,'execution'],['binding-capture.json',capture,'h3-binding-capture']]){
 const target=new URL(name,out);verifySeal(kind,value);
 if(process.argv.includes('--write'))await writeFile(target,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 else{const saved=JSON.parse(await readFile(target,'utf8'));verifySeal(kind,saved);if(canonical(saved)!==canonical(value))throw Error('Relevant source changed: mint a NEW version; never rewrite the archived envelope.');}
}
console.log(JSON.stringify({execution:plan.id,capture:capture.id,runtimeFiles:inputs.length,liveAuthorized:false}));
