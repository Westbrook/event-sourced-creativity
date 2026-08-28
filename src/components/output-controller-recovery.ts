import type { DocumentJob } from "../model/document-jobs.ts";
import type { OutputGrantRow, OutputRequirementsSnapshot, OutputResultRow } from "../model/output-delivery-contract.ts";
import type { OutputPlanTarget } from "../model/output-plan.ts";


export type OutputNativeResultReference = { grantId: string; slotId: string; jobId: string; targetId: string };

/** Omission is not failure. Only the current actor's exact recorded, settled completion can be inspected here. */
export function outputMissingNativeResults(snapshot: OutputRequirementsSnapshot, jobs: readonly DocumentJob[], target: OutputPlanTarget): OutputNativeResultReference[] {
  const plan = snapshot.confirmedPlan;
  if (!plan || snapshot.sourceRevision !== plan.sourceDigest || snapshot.requirementRevision !== plan.requirementsDigest
    || !plan.targetContractDigests?.[target.id] || !plan.plan.targets.some((entry) => entry.id === target.id)
    || !["image", "slides"].includes(target.media_kind)) return [];
  const seen = new Set<string>();
  return snapshot.grants.flatMap((grant) => grant.planRevisionId !== plan.revisionId || grant.actorUserId !== snapshot.scope.actorUserId ? [] : grant.operations.flatMap((operation) => {
    if (operation.targetId !== target.id || operation.status !== "succeeded" || operation.pendingCalls !== 0 || operation.exposedMicrousd !== 0
      || !operation.jobId || seen.has(operation.jobId) || jobs.some((job) => job.jobId === operation.jobId)) return [];
    seen.add(operation.jobId);
    return [{ grantId: grant.id, slotId: operation.id, jobId: operation.jobId, targetId: target.id }];
  }));
}

/** Transient presentation identity, not a new approval, source proof, or canonical record. */
export function outputNativeResultContext(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget) {
  const plan = snapshot.confirmedPlan;
  return JSON.stringify([snapshot.documentId, snapshot.projectId, snapshot.scope, snapshot.revision,
    snapshot.sourceRevision, snapshot.requirementRevision, plan?.revisionId, plan?.sourceDigest, plan?.requirementsDigest,
    plan?.targetContractDigests?.[target.id], target, snapshot.permissions, snapshot.sourceVerification,
    snapshot.grants.filter((grant) => grant.planRevisionId === plan?.revisionId).flatMap((grant) => {
      const operations = grant.operations.filter((operation) => operation.targetId === target.id);
      return operations.length ? [[grant.id, grant.actorUserId, operations]] : [];
    })]);
}

/** UI choices are only candidates. Binding always rechecks current bytes and authority on the server. */
export function outputCompletedNativeChoices(snapshot: OutputRequirementsSnapshot, jobs: readonly DocumentJob[], target: OutputPlanTarget, inspected?: DocumentJob) {
  const plan = snapshot.confirmedPlan;
  if (!plan || snapshot.sourceRevision !== plan.sourceDigest || !plan.plan.targets.some((entry) => entry.id === target.id)) return [];
  const choices: Array<{ grant: OutputGrantRow; operation: OutputGrantRow["operations"][number]; job: DocumentJob }> = [];
  const seen = new Set<string>();
  for (const grant of snapshot.grants) {
    if (grant.planRevisionId !== plan.revisionId) continue;
    for (const operation of grant.operations) {
      if (operation.targetId !== target.id || seen.has(operation.jobId)) continue;
      const present = jobs.find((entry) => entry.jobId === operation.jobId);
      const job = present ?? (inspected?.jobId === operation.jobId ? inspected : undefined);
      if (!job || job.documentId !== snapshot.documentId || job.status !== "completed") continue;
      const matchingKind = target.media_kind === "image" ? job.kind === "generate"
        : target.media_kind === "slides" ? job.kind === "render_document" && job.result?.artifactKind === "slides" : false;
      if (!matchingKind) continue;
      seen.add(operation.jobId);
      choices.push({ grant, operation, job });
    }
  }
  return choices;
}

/** Never manufacture approval from successful generation or current plan membership. */
export function outputReusableAcceptanceChoices(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget): OutputResultRow[] {
  const plan = snapshot.confirmedPlan;
  if (!plan || !plan.targetContractDigests?.[target.id]) return [];
  const seen = new Set<string>();
  return snapshot.results.filter((result) => {
    if (!result.acceptanceId || seen.has(result.acceptanceId) || result.targetId !== target.id || result.planRevisionId === plan.revisionId
      || result.review !== "approved" || result.checksStatus !== "passed" || result.targetContractDigest !== plan.targetContractDigests[target.id]
      || result.sourceDigest !== plan.sourceDigest || snapshot.sourceRevision !== plan.sourceDigest) return false;
    const asset = snapshot.assets.find((entry) => entry.id === result.assetId);
    if (!asset || !asset.available || asset.sha256 !== result.sha256 || asset.inspection.sha256 !== result.sha256 || asset.inspection.status !== "inspected") return false;
    seen.add(result.acceptanceId);
    return true;
  });
}

type OperationWithAccounting = OutputGrantRow["operations"][number] & { usedCalls?: number; pendingCalls?: number; usedMicrousd?: number; exposedMicrousd?: number };

/** Start can admit queued work, but cannot revive a terminal or uncertain attempt. */
export function outputGrantHasQueuedOperations(grant: Pick<OutputGrantRow, "operations">): boolean {
  return Array.isArray(grant.operations) && grant.operations.some((operation) => operation?.status === "authorized" || operation?.status === "queued");
}

/** Unknown accounting is not evidence of zero exposure. Retry still requires an explicit new preflight and grant. */
export function outputOperationRecovery(operation: OperationWithAccounting, job: Pick<DocumentJob, "jobId" | "documentId" | "status"> | undefined, documentId: string) {
  const knownJob = job?.jobId === operation.jobId && job.documentId === documentId ? job : undefined;
  const terminal = ["succeeded", "failed", "cancelled", "canceled", "unavailable"].includes(operation.status);
  const knownAccounting = Number.isSafeInteger(operation.pendingCalls) && Number(operation.pendingCalls) >= 0
    && Number.isSafeInteger(operation.exposedMicrousd) && Number(operation.exposedMicrousd) >= 0;
  const pending = knownAccounting && (Number(operation.pendingCalls) > 0 || Number(operation.exposedMicrousd) > 0);
  return {
    canStop: Boolean(knownJob && ["queued", "running"].includes(knownJob.status)),
    canPrepareAlternative: terminal && knownAccounting && !pending,
    terminal,
    reason: !knownAccounting ? "accounting_unknown" : pending ? "cost_unresolved" : !terminal ? "not_terminal" : "available",
  } as const;
}
