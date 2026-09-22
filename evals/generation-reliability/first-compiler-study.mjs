import { readFile } from 'node:fs/promises';
import { canonical, hash, makeCell, makeManifest, seal, verifySeal } from './core.mjs';
import { captureE2aFixture } from './e2a/capture.mjs';
import { newCurrentE2aFixture } from './e2a/fixture.mjs';
import { makeExecutionPlan, safetyIdentifier, validateExecutionPlan } from './execution-plan.mjs';

/** Local synthetic capture only. A future authorized preparation creates another immutable plan. */
export async function firstCompilerStudy() {
  const capture=JSON.parse(await readFile(new URL('./e2a/artifacts/capture.json',import.meta.url),'utf8'));
  verifySeal('e2a-capture',capture);
  if(canonical(capture)!==canonical(captureE2aFixture(newCurrentE2aFixture()))) throw new Error('C_capture_changed');
  const financial=JSON.parse(await readFile(new URL('../../docs/evidence/f2-sunburst/financial-gate.json',import.meta.url),'utf8'));
  verifySeal('f2-financial',financial);
  for(const arm of ['before','after']) {
    const bytes=await readFile(new URL(`./e2a/artifacts/${arm}.txt`,import.meta.url));
    if(hash(bytes)!==capture[arm].hash||bytes.toString()!==capture[arm].prompt) throw new Error('C_actual_bytes_mismatch');
    if(!financial.promptEvidence.some(e=>e.sha256===hash(bytes)&&e.captureId===capture.id)) throw new Error('F2_exact_prompt_not_qualified');
  }
  const config={prompt:capture.before.prompt,references:[],model:'gpt-image-2.5-sunburst',quality:'high',size:'1536x1024',outputFormat:'png',stream:false,moderation:null,
    endpoint:'/v1/images/generations',planner:{mode:'frozen'},checker:{mode:'off'},compiler:'current-production-unmodified'};
  const baseline=makeCell(capture.case,config),candidate=makeCell(capture.case,{...config,prompt:capture.after.prompt,compiler:capture.compilerVersion},baseline,['prompt','compiler']);
  const initial=makeManifest({experiment:'H-C-provenance-feasibility-v1',cases:[capture.case],cells:[baseline,candidate],repetitions:1,allowedFactors:['prompt','compiler'],
    interpretation:'Actual provenance-only compiler outputs on a newly authored synthetic current control. No historical incident coverage; no captured planner output or measured image outcomes.',
    callsPerTrial:{planner:0,moderation:1,media:1,storage:1,evaluator:0,contextChecker:0,status:1,result:1},
    gates:['current_source_and_actual_planner_direction','F2_exact_cell_available','existing_owner_and_paid_authority','trusted_production_transport_and_custody_adoption']});
  const currentBaseline=seal('baseline',{class:'CTRL',sourceRevision:capture.sourceRevision,captureId:capture.id,cellId:baseline.id,description:'current compiler on new synthetic source and authored direction',historicalReplay:false});
  const {id:_,...body}=initial;
  const manifest=seal('manifest',{...body,sourceRevision:capture.sourceRevision,baselineIds:[currentBaseline.id],currentBaseline,
    historicalIncidentCoverage:false,preparationPlannerCalls:1,
    inventoryNote:'status/result are maximum conditional original-read slots, not currently supported direct Images requests; zero such calls now'});
  const files=['evals/generation-reliability/execution-bridge.mjs','evals/generation-reliability/execution-journal.mjs','evals/generation-reliability/execution-plan.mjs','worker/generation-evidence.ts','src/model/generation-outcome-evidence.ts','evals/generation-reliability/sunburst-financial.mjs','worker/openai-adapter.ts','worker/openai-moderation.ts','worker/image-generation-policy.ts','worker/image-operation-capabilities.ts','src/model/prompt-structures.ts','src/model/prompt-provenance-e2a.ts'];
  const sourceHashes=Object.fromEntries(await Promise.all(files.map(async path=>[path,hash(await readFile(new URL(`../../${path}`,import.meta.url)))])));
  const runtimeIdentity={adapterSha256:sourceHashes['worker/openai-adapter.ts'],sourceHashes,routing:'unchanged direct high OpenAI; other routes excluded'};
  const plan=makeExecutionPlan({manifest,candidate:{id:capture.id,version:capture.compilerVersion,evidenceClass:capture.evidenceClass,
    captures:[baseline,candidate].map(cell=>({cellId:cell.id,sourceHash:cell.sourceHash,directionHash:cell.plannerHash,promptHash:cell.promptHash})),
    literalRequirements:13,visualFidelityMeasured:false,historicalReplay:false},financial,runtimeIdentity,
    user:safetyIdentifier('new-current-synthetic-control-no-live-owner'),
    preparation:{required:true,plannerCalls:1,status:'unexecuted_not_authorized',maximumCostMicrousd:null,actualDirection:null,
      instruction:'Obtain an actual lawful current source and one separately authorized planner output; freeze it across arms, recompile, requalify and review a new plan. Do not reconstruct historical Image 2 direction.'}});
  validateExecutionPlan(plan);return plan;
}
