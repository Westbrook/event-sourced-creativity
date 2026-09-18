import type { PilotUser, BudgetReservationGuard } from './pilot-policy.ts';

export const STILL_GENERATION_CLOSED = 'StillGenerationRequestClosed';
export function isStillGenerationKey(documentId: string, key: unknown): key is string {
  return typeof key === 'string' && key.length <= 512 && key.startsWith(`still:${documentId}:`) && key.length > documentId.length + 8;
}
export function stillGenerationMatch(user: PilotUser, documentId: string, requestKey: string): BudgetReservationGuard {
  const scope=user.projectExecution;
  const custody=scope?"EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.resource_kind='job' AND r.resource_id=document_jobs.job_id AND r.project_access_id=? AND r.organization_id=? AND r.actor_user_id=?)":"NOT EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.resource_kind='job' AND r.resource_id=document_jobs.job_id)";
  return { sql: `owner_id=? AND stream_id=? AND document_id=? AND source_surface='still' AND json_extract(request_json,'$.requestKey')=? AND ${custody}`, bindings: [user.userId,user.streamId,documentId,requestKey,...(scope?[scope.projectAccessId,scope.organizationId,scope.actorUserId]:[])] };
}
export async function stillGenerationOpen(user: PilotUser, documentId: string, requestKey: string): Promise<BudgetReservationGuard> {
  return { sql: "NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND actor=? AND type=? AND json_extract(payload,'$.document_id')=? AND json_extract(payload,'$.request_digest')=? AND COALESCE(json_extract(payload,'$.project_access_id'),'')=? AND COALESCE(json_extract(payload,'$.organization_id'),'')=?)", bindings: [user.streamId,`user:${user.userId}`,STILL_GENERATION_CLOSED,documentId,await stillGenerationDigest(requestKey),user.projectExecution?.projectAccessId??'',user.projectExecution?.organizationId??''] };
}
/** The close and duplicate exclusions must run in the admission INSERT itself. */
export async function stillGenerationAdmission(user: PilotUser, documentId: string, requestKey: string, guard?: BudgetReservationGuard): Promise<BudgetReservationGuard> {
  const open=await stillGenerationOpen(user,documentId,requestKey),match=stillGenerationMatch(user,documentId,requestKey);
  return { sql: `(${open.sql}) AND NOT EXISTS(SELECT 1 FROM document_jobs WHERE ${match.sql})${guard?` AND (${guard.sql})`:''}`, bindings: [...open.bindings,...match.bindings,...(guard?.bindings??[])] };
}

export async function stillGenerationDigest(key: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),byte=>byte.toString(16).padStart(2,'0')).join('');
}
