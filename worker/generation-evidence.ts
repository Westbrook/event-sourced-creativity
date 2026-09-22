import { unknownGenerationOutcome, type GenerationEvidenceObserver, type OperationEvidence, type PipelineStage, type GenerationOutcomeEvidence, type SafetyEvidence } from '../src/model/generation-outcome-evidence.ts';

export const evidenceSha256 = async (raw: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))), n=>n.toString(16).padStart(2,'0')).join('');
export function operationEvidence(provider: string, endpoint: string, model: string, settings: Record<string, unknown>, context: Partial<OperationEvidence> = {}): OperationEvidence {
  return {schemaVersion:'forma-operation-evidence-v1', entryPath:null, provider, endpoint, requestedAlias:model, effectiveModel:model, returnedModel:null,
    requestedQuality:null, routingPolicyVersion:null, capabilityVersion:null, overrideProvenance:null, deploymentVersion:null, compilerVersion:null,
    adapterVersion:null, settings, requestId:null, responseId:null, requestSha256:null, responseSha256:null, ...context};
}
/** Called and awaited before proceeding. The consumer owns existing private authorization and retention. */
export async function checkpointGenerationEvidence(observer: GenerationEvidenceObserver | undefined, evidenceId: string, phase:'request'|'response', operation:OperationEvidence,
  pipelineStage:PipelineStage, outcome:Partial<GenerationOutcomeEvidence> = {}, bodies:{requestBody?:string;responseBody?:string;revisedPrompt?:string;safety?:SafetyEvidence} = {}) {
  if (!observer) return;
  await observer({schemaVersion:'forma-private-generation-evidence-v1',evidenceId,capturedAt:new Date().toISOString(),phase,operation,
    outcome:{...unknownGenerationOutcome(pipelineStage),...outcome},...bodies});
}
