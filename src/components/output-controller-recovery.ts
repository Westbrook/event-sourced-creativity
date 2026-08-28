import type { DocumentJob } from "../model/document-jobs.ts";
import type { OutputGrantRow, OutputRequirementsSnapshot, OutputResultRow } from "../model/output-delivery-contract.ts";
import type { OutputPlanTarget } from "../model/output-plan.ts";

/** UI choices are only candidates. Binding always rechecks current bytes and authority on the server. */
export function outputCompletedNativeChoices(snapshot: OutputRequirementsSnapshot, jobs: readonly DocumentJob[], target: OutputPlanTarget) {
  const plan = snapshot.confirmedPlan;
  if (!plan || snapshot.sourceRevision !== plan.sourceDigest || !plan.plan.targets.some((entry) => entry.id === target.id)) return [];
  const choices: Array<{ grant: OutputGrantRow; operation: OutputGrantRow["operations"][number]; job: DocumentJob }> = [];
  const seen = new Set<string>();
  for (const grant of snapshot.grants) {
    if (grant.planRevisionId !== plan.revisionId) continue;
    for (const operation of grant.operations) {
      if (operation.targetId !== target.id || seen.has(operation.jobId)) continue;
      const job = jobs.find((entry) => entry.jobId === operation.jobId && entry.documentId === snapshot.documentId && entry.status === "completed");
      if (!job) continue;
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
