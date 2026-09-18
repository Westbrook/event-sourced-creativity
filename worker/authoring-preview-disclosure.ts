import type { AuthoringPlan, RetainedAuthoringPreview } from "./authoring-commits.ts";
import { canonicalConsent, consentHash, executionAdmissionGuard, executionContentCustodyGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Final read-only disclosure for the two free future review APIs. Never changes an Apply lease. */
export async function currentAuthoringPreviewDisclosure(env: WorkerEnv, user: PilotUser, binding: ConsequentialBinding,
  previewId: string, approvalHash: string, plan: AuthoringPlan, retainedContent: string | null,
  sourceHead: number | null = null) {
  let saved: RetainedAuthoringPreview | null = null;
  try { saved = retainedContent ? JSON.parse(retainedContent) as RetainedAuthoringPreview : null; } catch { /* Not disclosure evidence. */ }
  const original = plan.binding;
  const exact = ["canvas-arrangement", "workspace-quick-edit"].includes(binding.operation)
    && plan.operation === binding.operation && original.operation === binding.operation
    && original.actorUserId === user.userId && original.streamId === binding.streamId
    && original.projectId === binding.projectId && original.documentId === binding.documentId
    && original.blockId === binding.blockId && original.canvasId === binding.canvasId
    && canonicalConsent(original.scope) === canonicalConsent(binding.scope)
    && saved?.approvalHash === approvalHash && JSON.stringify(saved.plan) === JSON.stringify(plan)
    && await consentHash(plan) === approvalHash;
  const authority = executionAdmissionGuard(user, binding, sourceHead), custody = executionContentCustodyGuard(binding, "saved");
  const row = await env.DB.prepare(`SELECT saved.content_id AS retained_id,
      CASE WHEN json_extract(CASE WHEN json_valid(saved.content) THEN saved.content ELSE '{}' END,'$.plan.expiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END AS plan_current,
      CASE WHEN json_type(CASE WHEN json_valid(saved.content) THEN saved.content ELSE '{}' END,'$.plan.expiresAt')='text'
        AND strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(CASE WHEN json_valid(saved.content) THEN saved.content ELSE '{}' END,'$.plan.expiresAt'))
          =json_extract(CASE WHEN json_valid(saved.content) THEN saved.content ELSE '{}' END,'$.plan.expiresAt')
        THEN CASE WHEN json_extract(CASE WHEN json_valid(saved.content) THEN saved.content ELSE '{}' END,'$.plan.expiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          THEN 1 ELSE 0 END ELSE NULL END AS plan_expired,
      strftime('%Y-%m-%dT%H:%M:%fZ','now') AS database_now,
      NOT EXISTS(SELECT 1 FROM authoring_commits any_receipt WHERE any_receipt.preview_id=requested.preview_id) AS receipt_absent,
      receipt.result_json,receipt.approval_hash
    FROM(SELECT ? AS preview_id) requested
    LEFT JOIN private_content saved ON saved.content_id=requested.preview_id AND saved.owner_id=? AND saved.kind='authoring-preview'
      AND saved.redacted_at IS NULL AND saved.content=? AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND ${custody.sql}
    LEFT JOIN authoring_commits receipt ON receipt.preview_id=requested.preview_id AND receipt.actor_user_id=?
      AND receipt.operation=? AND receipt.project_id=? AND receipt.document_id=? AND receipt.block_id=?
      AND receipt.canvas_id IS ? AND receipt.organization_id IS ? AND receipt.project_access_id IS ?
      AND receipt.approval_hash=? AND receipt.result_json=? AND receipt.verified=1
    WHERE ${authority.sql}`)
    .bind(previewId, user.userId, exact ? retainedContent : null, ...custody.bindings, user.userId, binding.operation,
      binding.projectId, binding.documentId, binding.blockId, binding.canvasId, binding.scope?.organizationId ?? null,
      binding.scope?.projectAccessId ?? null, exact ? approvalHash : null, exact ? JSON.stringify(plan.result) : null, ...authority.bindings)
    .first<{ retained_id: string | null; plan_current: number; plan_expired: number | null; database_now: string; receipt_absent: number; result_json: string | null; approval_hash: string | null }>();
  if (!row) return null;
  const retainedCurrent = row.retained_id === previewId, privateCurrent = retainedCurrent && Number(row.plan_current) === 1;
  const leaseExpired = retainedCurrent && Number(row.receipt_absent) === 1 && saved?.state === "applying"
    && typeof saved.leaseId === "string" && Boolean(saved.leaseId) && typeof saved.leaseExpiresAt === "string"
    && Number.isFinite(Date.parse(saved.leaseExpiresAt)) && saved.leaseExpiresAt <= row.database_now;
  return { privateCurrent, retainedCurrent, planExpired: retainedCurrent && row.plan_expired === 1,
    planExpiryValid: retainedCurrent && (row.plan_expired === 0 || row.plan_expired === 1),
    receiptAbsent: Number(row.receipt_absent) === 1, leaseExpired, committed: row.result_json && row.approval_hash
    ? { result: JSON.parse(row.result_json) as AuthoringPlan["result"], approvalHash: row.approval_hash } : null };
}
