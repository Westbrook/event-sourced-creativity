import { canonical, hash, seal, verifySeal, validateManifest } from './core.mjs';

export const BRIDGE_VERSION = 'generation-durable-bridge-v1';
export const STAGES = ['moderation', 'image', 'storage'];
export const safetyIdentifier = ownerId => `forma_${hash(ownerId).slice(0, 32)}`;

/** Byte contract for the unchanged direct adapter. Omitted moderation/stream stay omitted. */
export function reviewedRequests(cell, user) {
  const c = cell.config;
  if (c.model !== 'gpt-image-2.5-sunburst' || c.endpoint !== '/v1/images/generations'
    || c.quality !== 'high' || c.size !== '1536x1024' || c.outputFormat !== 'png'
    || c.references.length || c.stream !== false || c.moderation !== null
    || c.planner.mode !== 'frozen' || c.checker.mode !== 'off'
    || !/^forma_[a-f0-9]{32}$/.test(user) || c.prompt !== c.prompt.trim()) throw new Error('reviewed_cell_unsupported');
  return {
    moderation: { provider: 'openai', endpoint: '/v1/moderations', method: 'POST', body: JSON.stringify({model:'omni-moderation-latest',input:[{type:'text',text:c.prompt}]}) },
    image: { provider: 'openai', endpoint: c.endpoint, method: 'POST', body: JSON.stringify({model:c.model,prompt:c.prompt,n:1,size:c.size,quality:c.quality,output_format:c.outputFormat,user}) },
    storage: { provider: 'private-custody', endpoint: 'artifact', method: 'PUT', body: JSON.stringify({cellId:cell.id,format:c.outputFormat,size:c.size}) },
  };
}

/** B's dry-run manifest is unchanged. This additive envelope binds C and F2 to its exact cells. */
export function makeExecutionPlan({manifest, candidate, financial, user, runtimeIdentity, preparation}) {
  validateManifest(manifest);
  const requests = Object.fromEntries(manifest.cells.map(c => [c.id, reviewedRequests(c, user)]));
  return seal('execution', {version:BRIDGE_VERSION,manifest,candidate,financial,user,runtimeIdentity,preparation,requests,
    inventory:{perTrial:{planner:0,moderation:1,image:1,storage:1,contextChecker:0,evaluator:0,reconciliationStatus:1,reconciliationResult:1,evidenceWrites:7},
      preparationPlanner:preparation.required?1:0,concurrency:1,generationRetries:0,reconciliationReadsPerOriginal:2},
    execution:'disabled',maximumCostMicrousd:null,authorizedCostMicrousd:0,providerEnforcedChargeCap:false});
}

export function validateExecutionPlan(plan) {
  verifySeal('execution', plan); validateManifest(plan.manifest);
  if (plan.version !== BRIDGE_VERSION || plan.execution !== 'disabled' || plan.authorizedCostMicrousd !== 0
    || plan.maximumCostMicrousd !== null || plan.providerEnforcedChargeCap !== false) throw new Error('invalid_execution_envelope');
  if (!plan.candidate?.id || !plan.financial?.version || !plan.runtimeIdentity?.adapterSha256) throw new Error('missing_candidate_financial_runtime_identity');
  for (const cell of plan.manifest.cells) {
    if (canonical(plan.requests[cell.id]) !== canonical(reviewedRequests(cell,plan.user))) throw new Error('runtime_payload_mismatch');
    const capture = plan.candidate.captures.find(c => c.cellId === cell.id);
    if (!capture || capture.sourceHash !== cell.sourceHash || capture.directionHash !== cell.plannerHash || capture.promptHash !== cell.promptHash) throw new Error('candidate_capture_mismatch');
  }
  for (const trial of plan.manifest.trials) {
    if (trial.plannedCalls.planner !== 0 || trial.plannedCalls.moderation !== 1 || trial.plannedCalls.media !== 1 || trial.plannedCalls.evaluator !== 0 || trial.plannedCalls.contextChecker !== 0) throw new Error('stage_inventory_mismatch');
  }
  return true;
}

/** Renaming a manifest/trial cannot manufacture another purchase of identical inputs. */
export function operationKey(scope, plan, trial) {
  const c = plan.manifest.cells.find(c => c.id === trial.cellId);
  return `operation:${hash({scope,source:c.sourceHash,direction:c.plannerHash,config:c.config,repeat:trial.repeat,runtime:plan.runtimeIdentity})}`;
}
