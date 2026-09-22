import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { firstCompilerStudy } from '../evals/generation-reliability/first-compiler-study.mjs';
import { ExecutionJournal } from '../evals/generation-reliability/execution-journal.mjs';
import { DurableExecutionBridge } from '../evals/generation-reliability/execution-bridge.mjs';
import { executionSummary } from '../evals/generation-reliability/execution-summary.mjs';
import { mockPlan, mockHost, MOCK_RUNTIME } from '../evals/generation-reliability/bridge-fixtures/mock-host.mjs';

// This command never enables any provider transport and reads no credentials.
const args=process.argv.slice(2);
if(args.length>1||args.some(a=>!['--check','--write','--mock'].includes(a))) throw new Error('offline_only_use_check_write_or_mock');
const mode=args[0]??'--check';
if(mode==='--mock') {
  const directory=await mkdtemp(join(tmpdir(),'forma-H-offline-')),journal=new ExecutionJournal(join(directory,'journal.sqlite'));
  try {
    const plan=mockPlan(),host=mockHost(plan,{journalId:journal.identity}),bridge=new DurableExecutionBridge({journal,...host,runtimeIdentity:MOCK_RUNTIME,enabled:true,now:()=>1000});
    const request={plan,trialId:plan.manifest.trials[0].id,context:{mock:true}};
    const first=await bridge.run(request),reuse=await bridge.run(request);
    console.log(JSON.stringify({mode:'MOCK_ONLY',first:first.action,rerun:reuse.action,realProviderCalls:0,...executionSummary(plan,journal)},null,2));
  }finally{journal.close();await rm(directory,{recursive:true,force:true});}
}else{
  const plan=await firstCompilerStudy(),bytes=JSON.stringify(plan,null,2)+'\n',path=new URL('../evals/generation-reliability/bridge-artifacts/v3/first-study.json',import.meta.url);
  if(mode==='--write') {
    await mkdir(new URL('.',path),{recursive:true});
    try {await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  }
  if(await readFile(path,'utf8')!==bytes) throw new Error('immutable_study_changed_create_new_reviewed_version');
  console.log(JSON.stringify({mode:'dry-run',executionPlanId:plan.id,manifestId:plan.manifest.id,candidateId:plan.candidate.id,financialId:plan.financial.id,
    counts:plan.manifest.counts,preparation:plan.preparation,inventory:plan.inventory,maximumCostMicrousd:null,authorizedCostMicrousd:0,
    liveAdmitted:false,realProviderCalls:0},null,2));
}
