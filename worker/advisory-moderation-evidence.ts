import { sourceAdvisoryWitness, type SourceAdvisoryWitness } from './source-advisory-witness.ts';
import type { SourceAuthorityReceipt } from './source-authority-receipt.ts';
import type { SourceAdvisoryInput } from '../src/model/source-advisory.ts';
import type { GenerationEvidenceObserver, PrivateGenerationEvidence } from '../src/model/generation-outcome-evidence.ts';
import type { AdvisoryModerationCapture } from '../src/model/generation-readiness.ts';
import { evidenceSha256 } from './generation-evidence.ts';
import { storePrivateContent } from './private-content-storage.ts';
import { nativeMemoryAnswerExclusion } from './memory-native-boundary.ts';
import type { WorkerEnv } from './runtime.ts';

export type AdvisoryBinding = NonNullable<AdvisoryModerationCapture['origin']>;
type Principal = {userId:string;streamId:string};
export function advisoryPersonalGuard(user:Principal,documentId:string,projectId:string) {
  return {sql:`NOT EXISTS(SELECT 1 FROM project_resource_scopes s WHERE s.resource_kind='document' AND s.resource_id=?)
    AND NOT EXISTS(SELECT 1 FROM organization_projects p WHERE p.owner_user_id=? AND p.project_id=?)`,bindings:[documentId,user.userId,projectId]};
}
export async function advisoryPersonalAllowed(env:WorkerEnv,user:Principal,documentId:string,projectId:string) {
  try{const guard=advisoryPersonalGuard(user,documentId,projectId);return Boolean(await env.DB.prepare(`SELECT 1 AS allowed WHERE ${guard.sql}`).bind(...guard.bindings).first());}catch{return false;}
}
const unavailable = (reason:string):AdvisoryModerationCapture => ({status:'unavailable',reason,inspection:'unavailable-before-admission',refs:{}});

/** This observer is used only through moderateGenerationSnapshot's error boundary.
 * No raw evidence enters the preflight cache or job's financial checkpoints. */
export function advisoryModerationCapture(env:WorkerEnv,user:Principal,origin:AdvisoryBinding,source?:{authority:SourceAuthorityReceipt;createdAt:string;expiresAt:string}) {
  const capture:AdvisoryModerationCapture={status:'capture-incomplete',reason:'not-observed',inspection:'unavailable-before-admission',origin,refs:{}};
  let witness:SourceAdvisoryWitness|undefined;
  const phases=new Set<string>(),operationIds=new Set<string>();
  const observe:GenerationEvidenceObserver=async evidence=>{
    const content=JSON.stringify({...evidence,...(witness?{sourceWitness:witness}:{}),advisory:{...origin,ownerId:user.userId,streamId:user.streamId},
      operation:{...evidence.operation,entryPath:'still',settings:{...evidence.operation.settings,advisoryOperation:'snapshot'}}});
    if(new TextEncoder().encode(content).length>500_000)throw new Error('advisory_capture_capacity');
    const stored=await storePrivateContent(env,user.userId,'provider-output',content,undefined,advisoryPersonalGuard(user,origin.documentId,origin.projectId));
    capture.refs[`${evidence.evidenceId}:${evidence.phase}`]={ref:stored.contentId,expiresAt:stored.expiresAt,pipelineStage:'app_moderation',sha256:await evidenceSha256(content)};
    phases.add(evidence.phase);operationIds.add(evidence.evidenceId);
    if(phases.has('request')&&phases.has('response')&&operationIds.size===1&&capture.reason!=='storage-failed'){capture.status='retained';delete capture.reason;}
  };
  return {capture,observe,async onInputs(input:string[],mapping:SourceAdvisoryInput[]){
    if(source){witness=await sourceAdvisoryWitness(source.authority,source.createdAt,source.expiresAt,input,mapping);capture.sourceInspection='prospective-v1';capture.inspection='selected-preflight';}
  },onCaptureError:()=>{capture.status='capture-incomplete';capture.reason='storage-failed';}};
}

/** Bounded validation of server-owned cache links, never a source-history proof.
 * Any custody failure affects capture status only, not the advisory verdict. */
export async function qualifyAdvisoryCapture(env:WorkerEnv,user:Principal,value:AdvisoryModerationCapture|undefined,
  expected:{documentId:string;documentRevision:string;sourceSha256?:string;requestKey?:string;projectId?:string}) : Promise<AdvisoryModerationCapture> {
  try {
    if(!value?.origin)return unavailable(value?.reason??'legacy-summary-only');
    const origin=value.origin;
    if(!await advisoryPersonalAllowed(env,user,origin.documentId,origin.projectId))return unavailable('personal-custody-unavailable');
    if(origin.documentId!==expected.documentId||origin.documentRevision!==expected.documentRevision
      ||expected.sourceSha256!==undefined&&origin.sourceSha256!==expected.sourceSha256
      ||expected.projectId!==undefined&&origin.projectId!==expected.projectId
      ||expected.requestKey!==undefined&&origin.requestKey!==expected.requestKey)return unavailable('source-binding-mismatch');
    const entries=Object.entries({...value.unavailableRefs,...value.refs});
    if(entries.length>2||entries.some(([id,r])=>!id||typeof r?.ref!=='string'||r.ref.length>240||typeof r.sha256!=='string'
      ||!Number.isFinite(Date.parse(r.expiresAt))))return unavailable('invalid-capture');
    const db=env.DB,exclusion=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
    const read=()=>db.prepare(`SELECT content_id,content,expires_at FROM private_content
      WHERE owner_id=? AND kind='provider-output' AND content_id IN(SELECT value FROM json_each(?))
      AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=500000
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes s WHERE s.resource_kind='content' AND s.resource_id=private_content.content_id)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes s WHERE s.content_id=private_content.content_id)
      AND ${exclusion.sql}`).bind(user.userId,JSON.stringify(entries.map(([,r])=>r.ref)),...exclusion.bindings).all<{content_id:string;content:string;expires_at:string}>();
    const rows=(await read()).results,refs:AdvisoryModerationCapture['refs']={},phases=new Set<string>(),operationIds=new Set<string>();
    for(const [id,ref] of entries){
      const row=rows.find(r=>r.content_id===ref.ref);
      if(!row||row.expires_at!==ref.expiresAt||Date.parse(ref.expiresAt)<=Date.now()||await evidenceSha256(row.content)!==ref.sha256)continue;
      const evidence=JSON.parse(row.content) as PrivateGenerationEvidence & {advisory:AdvisoryBinding & {ownerId:string;streamId:string}};
      if(evidence.schemaVersion!=='forma-private-generation-evidence-v1'||`${evidence.evidenceId}:${evidence.phase}`!==id
        ||JSON.stringify(evidence.advisory)!==JSON.stringify({...origin,ownerId:user.userId,streamId:user.streamId}))continue;
      refs[id]=ref;phases.add(evidence.phase);operationIds.add(evidence.evidenceId);
    }
    if(env.DB!==db||!await advisoryPersonalAllowed(env,user,origin.documentId,origin.projectId)||JSON.stringify((await read()).results)!==JSON.stringify(rows))return unavailable('custody-changed');
    if(Object.values(refs).some(r=>Date.parse(r.expiresAt)<=Date.now()))return unavailable('receipt-expired');
    const unavailableRefs=Object.fromEntries(entries.filter(([id])=>!Object.hasOwn(refs,id)));
    return {...value,refs,unavailableRefs,status:value.status==='retained'&&Object.keys(refs).length===2&&phases.has('request')&&phases.has('response')&&operationIds.size===1?'retained':'capture-incomplete',
      ...(Object.keys(refs).length!==entries.length?{reason:'receipt-unavailable'}:{})};
  } catch {return unavailable('custody-unavailable');}
}
