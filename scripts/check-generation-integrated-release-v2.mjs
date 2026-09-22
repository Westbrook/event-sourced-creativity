/** Offline release identity only. This does not create an actual-input study or execution authority. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonical,hash,seal,verifySeal} from '../evals/generation-reliability/core.mjs';
import {firstCompilerStudy} from '../evals/generation-reliability/first-compiler-study.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const target='docs/evidence/generation-integrated-release-v2/envelope.json';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const tracked=()=>git('ls-files').split('\n').filter(p=>!p.startsWith('docs/')&&!p.startsWith('.progress-report/')).sort();
const digests=paths=>Object.fromEntries(paths.map(p=>[p,hash(read(p))]));
const args=process.argv.slice(2);
assert(args.length===1&&['--write','--check'].includes(args[0]),'offline_only_use_write_or_check');

// Prove the historical v5 incompatibility is exactly the shared-builder source
// change, without changing either the historical record or its strict checker.
const oldPath='evals/generation-reliability/bridge-artifacts/v5/first-study.json';
const old=JSON.parse(read(oldPath));verifySeal('execution',old);
const fresh=await firstCompilerStudy();
const {id:oldId,...oldBody}=old,{id:freshId,...freshBody}=structuredClone(fresh);
assert.notEqual(oldId,freshId);
const oldHashes=old.runtimeIdentity.sourceHashes,newHashes=fresh.runtimeIdentity.sourceHashes;
const changed=Object.keys(oldHashes).filter(p=>oldHashes[p]!==newHashes[p]);
assert.deepEqual(changed,['worker/openai-adapter.ts']);
assert.equal(freshBody.runtimeIdentity.adapterSha256,newHashes['worker/openai-adapter.ts']);
assert.equal(oldBody.runtimeIdentity.adapterSha256,oldHashes['worker/openai-adapter.ts']);
freshBody.runtimeIdentity.sourceHashes=oldHashes;
freshBody.runtimeIdentity.adapterSha256=oldBody.runtimeIdentity.adapterSha256;
assert(canonical(freshBody)===canonical(oldBody),'unexpected_historical_study_difference');
git('merge-base','--is-ancestor','262d78acad739efc70ba80db7d3ad45fc965cd96','HEAD');
assert.equal(hash(read('build/memory-migration-release.json')),hash(execFileSync('git',['show','fd714354d3b2f5a963ca6e104bc3ea0d69a7176d:build/memory-migration-release.json'],{cwd:root})),'migration_allowlist_changed');
const historicalChecks=[
 ['scripts/check-generation-integrated-release.mjs','--check','integrated_release_source_changed_create_new_version'],
 ['scripts/check-generation-execution-bridge.mjs','--check','immutable_study_changed_create_new_reviewed_version'],
 ['evals/generation-reliability/native-host/envelope.mjs',null,'Relevant source changed: mint a NEW version; never rewrite the archived envelope.'],
];
for(const [script,arg,reason] of historicalChecks){
 const result=spawnSync(process.execPath,['--import','tsx',script,...(arg?[arg]:[])],{cwd:root,encoding:'utf8'});
 assert.equal(result.status,1,'historical_checker_must_reject_current_source');
 assert(result.stderr.includes(reason),'unexpected_historical_checker_failure');
}
const historicalPaths=[...JSON.parse(read('docs/evidence/generation-h3/version.json')).previousEnvelopes,
 ...git('ls-files','docs/evidence/generation-h3','docs/evidence/generation-h4','docs/evidence/generation-f3','docs/evidence/generation-e3','docs/evidence/generation-integrated-release-v1','docs/evidence/generation-h5','docs/evidence/generation-f4','docs/evidence/generation-e4','evals/generation-reliability/e2a/artifacts','docs/evidence/f2-sunburst/financial-gate.json').split('\n')].sort();
const constraints={classification:'offline-release-source-identity',actualInputStudyCapture:null,actualSource:null,actualRequest:null,actualPlannerOutput:null,financialPolicySelected:false,liveAuthorized:false,providerCalls:0,executionEnabled:false,sourceFreezeEnabled:false,financialAdapterEnabled:false,actualSourceConfigurationBindingEstablished:false,authenticBillingEvidenceEstablished:false,acquisitionDeletionLifecycleQualified:false,studySchemaInstalled:false,preparationSchemaInstalled:false,grantsProvisioned:false,memoryAndReplayRestrictions:'unchanged',historicalEnvelopes:'preserved; source mismatch required'};
if(args[0]==='--write'){
 const implementationCommit=git('rev-parse','HEAD');
 assert.equal(git('status','--porcelain','--untracked-files=no'),'','commit_source_before_sealing');
 const envelope=seal('offline-release',{
  version:'h5-f4-e4-offline-release-v2',implementationCommit,implementationTree:git('rev-parse','HEAD^{tree}'),
  integratedE4:'262d78acad739efc70ba80db7d3ad45fc965cd96',predecessorProduction:519,sourceScope:'all tracked files except docs and independent progress-report locator; historical evidence bound separately',
  sourceHashes:digests(tracked()),historicalEvidenceSha256:digests(historicalPaths),constraints,
  historicalChecks:historicalChecks.map(([script,,reason])=>({script,expected:'source-mismatch',reason})),
 });
 mkdirSync(new URL('../docs/evidence/generation-integrated-release-v2/',import.meta.url),{recursive:true});
 writeFileSync(new URL('../'+target,import.meta.url),JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});
}
const saved=JSON.parse(read(target));verifySeal('offline-release',saved);
git('merge-base','--is-ancestor',saved.implementationCommit,'HEAD');
assert.equal(git('rev-parse',saved.implementationCommit+'^{tree}'),saved.implementationTree);
assert.equal(canonical(saved.constraints),canonical(constraints));
assert.equal(canonical(saved.sourceHashes),canonical(digests(tracked())),'integrated_release_source_changed_create_new_version');
assert.equal(canonical(saved.historicalEvidenceSha256),canonical(digests(historicalPaths)),'historical_evidence_changed');
console.log(JSON.stringify({id:saved.id,implementationCommit:saved.implementationCommit,sourceFiles:Object.keys(saved.sourceHashes).length,historicalFiles:historicalPaths.length,historicalMismatchVerified:true,...constraints}));
