import type { WorkerEnv } from './runtime.ts';
import { currentIdentifier, currentObject, refuseCurrent } from './generation-current-source-proof.ts';

/** Same metadata contract as the disabled H5 resolver, without importing its
 * acquisition writer or enabling a study. No credential value is read/exported. */
export function currentSourceConfiguration(env:WorkerEnv) {
 const host=env as WorkerEnv & {FORMA_PREPARATION_CONFIG?:unknown;FORMA_PREPARATION_CREDENTIAL_BINDING?:string};
 const plannerModel=env.OPENAI_MODEL??'gpt-5.6-terra',plannerBasis=env.OPENAI_MODEL?'configured OPENAI_MODEL':'application-default';
 const current={plannerModel,imageModel:env.OPENAI_IMAGE_MODEL??'gpt-image-2.5-sunburst',plannerBasis,projectHeaderConfigured:Boolean(env.OPENAI_PROJECT)};
 if(!host.FORMA_PREPARATION_CONFIG)return {...current,evidenceClass:'current-environment-only',accountBinding:null,eligibleForDirectionReuse:false};
 const c=currentObject(host.FORMA_PREPARATION_CONFIG);
 if(c.model!==plannerModel||c.modelBasis!==plannerBasis||c.projectHeader!==(env.OPENAI_PROJECT??null)
   ||c.endpoint!=='https://api.openai.com/v1/responses'||c.serviceTier!=='standard'
   ||!['model','accountId','region','resolutionVersion','resolutionEvidenceRef','credentialBinding'].every(k=>currentIdentifier(c[k]))
   ||c.credentialBinding!==host.FORMA_PREPARATION_CREDENTIAL_BINDING||typeof c.expiresAt!=='string'||!Number.isFinite(Date.parse(c.expiresAt))
   ||new Date(c.expiresAt).toISOString()!==c.expiresAt||Date.parse(c.expiresAt)<=Date.now())refuseCurrent('configuration_binding_unavailable');
 return {...current,evidenceClass:'server-bound-h5-configuration',accountBinding:Object.fromEntries(['model','modelBasis','projectHeader','endpoint','serviceTier','accountId','region','resolutionVersion','resolutionEvidenceRef','credentialBinding','expiresAt'].map(k=>[k,c[k]])),eligibleForDirectionReuse:false};
}
