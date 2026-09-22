import { unknownGenerationOutcome } from '../../../src/model/generation-outcome-evidence.ts';
import { mockCompleted, COST_STAGES } from '../results.mjs';

/** Synthetic stage receipts consume A's public outcome vocabulary; no private envelope. */
export function outcomeFixtures(c) {
  const failure=(status,stage,kind,dispatched,charge,content='unknown')=>({status,dispatched,artifactHash:null,judgment:null,maximumCostMicrousd:1000,
    callCounts:Object.fromEntries(COST_STAGES.map(s=>[s,s==='planner'||s==='media'&&dispatched?1:0])),
    costs:[{stage:'planner',costMicrousd:50},...(dispatched?[{stage:'media',costMicrousd:charge}]:[])],
    outcome:{...unknownGenerationOutcome(stage),failureKind:kind,contentOutcome:content,dispatchState:dispatched?'response_received':'not_dispatched',accountingState:charge===null?'unknown':'usage_recorded'}});
  return {
    completed:mockCompleted(c),
    plannerRefusal:failure('blocked','planner','safety',false,0,'refused'),
    localPreflightBlock:failure('blocked','app_moderation','safety',false,0,'refused'),
    malformedModeration:failure('blocked','app_moderation','validation',false,0),
    providerSafety:failure('blocked','media_result','safety',true,100,'refused'),
    noTool:failure('no_tool','media_result','incomplete',true,100),
    transportUncertain:{...failure('uncertain','media_submission','transport',true,null),outcome:{...unknownGenerationOutcome('media_submission'),failureKind:'transport',dispatchState:'dispatch_unknown'}},
    storageFailure:failure('failed','storage','storage',true,700,'invalid'),
    accessFailure:{...failure('failed','media_submission','access',true,0),stopCause:'access'},
    usableUnknownBilling:mockCompleted(c,{costs:[{stage:'media',costMicrousd:null},{stage:'evaluator',costMicrousd:200},{stage:'moderation',costMicrousd:0}],outcome:{...unknownGenerationOutcome('media_result'),contentOutcome:'usable',dispatchState:'response_received',accountingState:'unknown'}}),
  };
}
