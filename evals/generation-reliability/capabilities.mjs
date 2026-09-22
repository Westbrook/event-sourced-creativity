import { resolveExperimentImageOperation, validateImageExperimentCell, IMAGE_CAPABILITY_VERSION } from '../../worker/image-operation-capabilities.ts';
import { qualifyImageExperimentFinancials } from '../../worker/image-financial-qualification.ts';
import { assertRequestedModel } from './core.mjs';

export function capabilityInput(config) {
  return { model:config.model,endpoint:config.endpoint,referenceCount:config.references.length,
    settings:{quality:config.quality,size:config.size,outputFormat:config.outputFormat,stream:config.stream,moderation:config.moderation},
    ...(config.endpoint==='/v1/responses'?{mainlineModel:'gpt-5.6-terra',action:config.references.length?'edit':'generate'}:{}),
    ...(config.moderation==='low'?{policyExperiment:{id:'E8-benign-only-offline-design',benignCorpus:true,automaticRefusalFallback:false}}:{}),
  };
}
export function qualifyCell(cell) {
  const input=capabilityInput(cell.config), validation=validateImageExperimentCell(input);
  const plan=validation.valid?resolveExperimentImageOperation({...input,enabled:true}):null;
  if(plan) assertRequestedModel(cell,{model:plan.requestedModel});
  return {version:IMAGE_CAPABILITY_VERSION,cellId:cell.id,capability:validation,operation:plan,
    liveAdmitted:false,financialMaximumMicrousd:null,financialStatus:'unqualified',
    financial:qualifyImageExperimentFinancials(input,Buffer.byteLength(cell.config.prompt,'utf8')),
    note:'Plan-only resolution. Runtime request must assert model and full reviewed cell identity again before its paid-call checkpoint.'};
}
