import type {WorkerEnv} from './runtime.ts';
import {PLATFORM_PRINCIPAL_WITH_ACCESS_SQL,principalAccessFromRow} from './access-policy.ts';
import {requireConsent,type PilotUser} from './pilot-policy.ts';
import {livePartitionAllowed,type Partition} from './creation-search-api.ts';
import {creationProviderPermitted} from './creation-search-providers.ts';
import {CreationProviderError} from './creation-provider-http.ts';
/** Registered custody allowlist + current canonical owner authority. This is a background
 * purpose check, not a retained search actor or fabricated authenticated HTTP session. */
export async function indexAuthority(env:WorkerEnv,key:string,inference=true):Promise<{partition:Partition;owner:PilotUser;guard:{sql:string;bindings:Array<string|number>}}>{
 const row=await env.DB.prepare(`SELECT p.*,o.organization_id FROM creation_search_partitions p LEFT JOIN organization_projects o ON o.project_access_id=p.project_access_id WHERE p.partition_key=?`).bind(key).first<Record<string,unknown>>();if(!row)throw new CreationProviderError('index_partition_missing',0,true);
 const actor=await env.DB.prepare(PLATFORM_PRINCIPAL_WITH_ACCESS_SQL).bind(row.owner_id).first<Record<string,unknown>>();if(!actor)throw new CreationProviderError('index_authority_missing',0,true);
 const access=await principalAccessFromRow(actor,String(actor.role));
 const owner={userId:String(actor.user_id),email:String(actor.email),displayName:String(actor.display_name),role:actor.role,consentVersion:actor.consent_version,consentedAt:actor.consented_at,streamId:'creative:'+actor.user_id,access} as PilotUser;
 const partition:Partition={projectId:String(row.project_id),ownerId:String(row.owner_id),custody:String(row.custody),projectAccessId:row.project_access_id?String(row.project_access_id):undefined,organizationId:row.organization_id?String(row.organization_id):undefined,permissionEpoch:access.permissionEpoch,contentVersion:String(row.content_version),indexVersion:String(row.index_version),providerPolicy:creationProviderPermitted(env,{custody:String(row.custody)})?'allowed':'local-only',invalidated:!!row.invalidated,backfillComplete:!!row.backfill_complete};
 if(access.identityPolicyDeniedCustody||requireConsent(owner)||!await livePartitionAllowed(env,owner,partition))throw new CreationProviderError('index_authority_revoked',0,true);
 if(inference&&(env.STILL_CREATION_INDEX_ENABLED!=='true'||!creationProviderPermitted(env,partition)))throw new CreationProviderError('index_inference_not_enrolled',0,true);
 const columns=['permission_epoch','grants_json','organizations_json','projects_json','identity_policies_json','consent_version','role'];
 const enrollment=inference?await env.DB.prepare('SELECT policy_epoch,expires FROM creation_index_enrollments WHERE custody=? AND enabled=1 AND expires>unixepoch()').bind(partition.custody).first<{policy_epoch:string;expires:number}>():null;
 if(inference&&!enrollment)throw new CreationProviderError('index_enrollment_required',0,true);
 const guard:{sql:string;bindings:Array<string|number>}={sql:`EXISTS(SELECT 1 FROM(${PLATFORM_PRINCIPAL_WITH_ACCESS_SQL}) principal WHERE ${columns.map(c=>`COALESCE(principal.${c},'')=?`).join(' AND ')})`,bindings:[owner.userId,...columns.map(c=>String(actor[c]??''))]};
 if(inference){guard.sql+=` AND EXISTS(SELECT 1 FROM creation_index_enrollments WHERE custody=? AND policy_epoch=? AND expires=? AND enabled=1 AND expires>unixepoch())`;guard.bindings.push(partition.custody,enrollment!.policy_epoch,enrollment!.expires);}
 return {partition,owner,guard};
}

export function indexAuthorityFence(env:WorkerEnv,guard:{sql:string;bindings:Array<string|number>}){return env.DB.prepare(`INSERT INTO creation_index_fences(id) VALUES(CASE WHEN ${guard.sql} THEN 1 ELSE NULL END)`).bind(...guard.bindings);}
