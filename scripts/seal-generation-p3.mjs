// Bounded local refusal packet, not a grant issuer or a production installer.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {hash,seal} from '../evals/generation-reliability/core.mjs';
import {makeSuppliedPlan} from '../evals/generation-reliability/p2/contract.mjs';
import {operationKey} from '../evals/generation-reliability/execution-plan.mjs';
const previous='docs/evidence/generation-p2/',out='docs/evidence/generation-p3/';
const read=p=>readFileSync(p,'utf8'),json=p=>JSON.parse(read(p));
const base='1e13b771e5af1f3907113c1ebf242fd11f06959b';
const old=json(previous+'release-envelope.json'),oldPlan=json(previous+'execution-proposal.json'),built=json(previous+'built-host.json');
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','worker','evals/generation-reliability','scripts'],{encoding:'utf8'}).trim().split('\n').filter(p=>/\.(?:ts|mjs|js)$/.test(p));
const tables=['generation_study_grants','generation_study_supplied_reviews','generation_study_financial_grants'];
const usages=Object.fromEntries(tables.map(table=>[table,files.flatMap(path=>read(path).split('\n').flatMap((line,index)=>line.includes(table)?[{path,line:index+1,insertion:/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+/i.test(line)}]:[]))]));
for(const table of tables)assert.equal(usages[table].filter(x=>x.insertion).length,0,`Producer appeared for ${table}; reassess this refusal packet`);
const changed=Object.entries(old.sourceHashes).filter(([p,h])=>hash(readFileSync(p))!==h).map(([p])=>p);
assert.deepEqual(changed,['tests/generation-p2-fixture.mjs']);
for(const [p,h] of Object.entries(built.sourceHashes))assert.equal(hash(readFileSync(p)),h,`Runtime changed: ${p}`);
// Every historical I/P1/P2/C2 byte remains in its original location, including old seals.
const historicalPaths=['docs/evidence/generation-p1','docs/evidence/generation-p2','docs/evidence/f2-sunburst/c2-v2','evals/generation-reliability/e2a/artifacts','evals/generation-reliability/bridge-artifacts/v6-c2'];
const history=execFileSync('git',['ls-tree','-r','--name-only',base,'--',...historicalPaths],{encoding:'utf8'}).trim().split('\n');
for(const p of history)assert.equal(hash(readFileSync(p)),hash(execFileSync('git',['show',`${base}:${p}`],{maxBuffer:20*1024*1024})),`Historical artifact changed: ${p}`);
const anchors={
 'worker/authoring-commits.ts':['export type AuthoringPlan=','export async function storeAuthoringPreview','export async function commitAuthoringPlan','if(!plan.events.length','INSERT INTO authoring_commits'],
 'worker/context-application-api.ts':['export async function handleContextApplication','saved.plan.operation!=="context-proposal"'],
 'worker/experience-sponsor-approval.ts':['export type SponsorApprovalProposal','export async function compileSponsorApprovalProposal','export async function approveSponsorCampaign','INSERT INTO experience_sponsor_approvals'],
 'worker/experience-sponsor-policy.ts':['export function readSponsorPolicy'],
 'worker/pilot-policy.ts':['export async function requireExistingHoldAdministrator'],
 'worker/principal-request-core.ts':['function identityFromRequest'],
 'evals/generation-reliability/native-host/supplied-authority.mjs':['export const reviewBinding','export async function retainSuppliedStudyInputs','export async function suppliedStudyInputs','export async function observeSuppliedArm'],
 'evals/generation-reliability/native-host/authority.mjs':['export async function checkedBatch','export async function authenticateStudy'],
 'evals/generation-reliability/native-host/financial-policy.mjs':['export function validateFinancialPolicy','export async function resolveFinancialPolicy'],
 'evals/generation-reliability/native-host/financial-reconciliation.mjs':['export async function appendVerifiedReconciliation'],
 'evals/generation-reliability/native-host/host.mjs':['async function cleanup'],
};
const sourceAnchors=Object.entries(anchors).flatMap(([path,needles])=>needles.map(needle=>{
 const line=read(path).split('\n').findIndex(s=>s.includes(needle))+1;assert.ok(line,`${path}: ${needle}`);return{path,line,symbol:needle};
}));
const trace={version:'p3-producer-trace-v1',baseCommit:base,scope:'Tracked worker, generation-reliability and scripts TS/JS/MJS; exact study-table references plus manually traced authoring/sponsor/F3 contracts. This is not a semantic whole-program proof.',scannedFiles:files.length,usages,sourceAnchors,unsupported:'Authenticated F3 exact-operation financial approval producer feeding generation_study_financial_grants',nonTestInsertions:0,unmodifiedRuntimeFiles:Object.keys(built.sourceHashes).length,preservedHistoricalFiles:history.length,p2EnvelopeMatches: Object.keys(old.sourceHashes).length-changed.length,p2ChangedSourceFiles:changed,ready:false};
const extra=['scripts/seal-generation-p3.mjs','tests/generation-p3-producer-boundary.test.mjs','worker/experience-sponsor-approval.ts','worker/experience-sponsor-policy.ts','worker/authoring-commits.ts'];
const sourceHashes=Object.fromEntries([...new Set([...Object.keys(old.sourceHashes),...extra])].sort().map(p=>[p,hash(readFileSync(p))]));
const runtimeIdentity={...oldPlan.runtimeIdentity,version:'p3-local-refusal-runtime-v1',adapterSha256:hash(sourceHashes),sourceHashes};
const plan=makeSuppliedPlan({packet:oldPlan.packet,user:oldPlan.user,runtimeIdentity,binding:{...oldPlan.candidate.suppliedInputs,reviewId:'UNREVIEWED-P3-PROPOSAL',authorityVersion:'UNAPPROVED-P3-v1'}});
// The two moderation/image bodies are unchanged; only proposal identities are resealed.
assert.deepEqual(plan.requests,oldPlan.requests);
function artifact(name,value){const bytes=JSON.stringify(value,null,2)+'\n',path=out+name;
 if(existsSync(path))assert.equal(read(path),bytes,`Immutable artifact differs: ${path}`);
 else if(process.argv.includes('--write'))writeFileSync(path,bytes);else throw Error(`Missing artifact: ${path}`);
}
artifact('producer-trace.json',trace);artifact('execution-proposal.json',plan);
const artifactHashes=Object.fromEntries(readdirSync(out).filter(p=>p.endsWith('.log')||['result.md','index.html','target.json','producer-trace.json','execution-proposal.json','verification.json','minimum-extension.md'].includes(p)).sort().map(p=>[p,hash(readFileSync(out+p))]));
const envelope=seal('p3-local-refusal',{version:'p3-local-refusal-v1',baseCommit:base,mainAncestor:old.baseCommit,previousEnvelope:old.id,previousEnvelopeSha256:hash(readFileSync(previous+'release-envelope.json')),sourceHashes,artifactHashes,packetId:plan.packet.id,proposalPlanId:plan.id,operationIdentities:plan.manifest.trials.map(t=>({arm:t.id,operationId:operationKey('OFFLINE-P2-NOT-A-PRODUCTION-PRINCIPAL',plan,t)})),builtHost:{reusedUnchanged:true,sha256:built.sha256,artifacts:built.artifacts,verifiedRuntimeFiles:Object.keys(built.sourceHashes).length,qualification:'Existing Node bundled-host check only; no hosted qualification'},ready:false,liveAuthorized:false,userReviewed:false,producerConnected:false,execution:'disabled',providerCalls:0,installedSchema:false,installedGrant:false,unsupported:trace.unsupported});
artifact('release-envelope.json',envelope);
console.log(JSON.stringify({envelopeId:envelope.id,planId:plan.id,sourceFiles:Object.keys(sourceHashes).length,preservedHistoricalFiles:history.length,unchangedRuntimeFiles:Object.keys(built.sourceHashes).length,producerConnected:false,ready:false},null,2));
