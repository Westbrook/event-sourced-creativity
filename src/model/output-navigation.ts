import type { OutputRequirementsSnapshot } from "./output-delivery-contract.ts";

export type OutputNavigationKind = "requirement" | "target" | "result" | "operation";
export type OutputNavigationSection = "inspect" | "existing" | "owned" | "native" | "history";
/** A content-free navigation address, never an execution, review, or delivery permission. */
export type OutputNavigationReference = {
  kind: OutputNavigationKind; id: string; authorizationScopeKey: string;
  documentId: string; projectId: string; actorUserId: string; projectAccessId: string | null;
  revision: string; sourceRevision: string; requirementRevision: string;
  blockId: string | null; planRevisionId: string | null; targetId: string | null; targetContractDigest: string | null;
  resultId: string | null; resultRevision: string | null; assetId: string | null; assetSha256: string | null;
  grantId: string | null; operationId: string | null; jobId: string | null;
};
const unique = <T>(values: readonly T[], match: (value: T) => boolean): T | null => {
  const matches = values.filter(match); return matches.length === 1 ? matches[0] : null;
};
/** All terms come from one existing authorized Output snapshot. Nothing is persisted. */
function captureOutputNavigationUnchecked(snapshot: OutputRequirementsSnapshot, authorizationScopeKey: string,
  kind: OutputNavigationKind, id: string): OutputNavigationReference | null {
  const identity = (value: unknown) => typeof value === "string" && value.length > 0;
  if (![authorizationScopeKey, id, snapshot?.documentId, snapshot?.projectId, snapshot?.scope?.actorUserId,
    snapshot?.revision, snapshot?.sourceRevision, snapshot?.requirementRevision].every(identity)
    || snapshot.scope.projectAccessId !== null && !identity(snapshot.scope.projectAccessId)
    || !Array.isArray(snapshot.requirements) || !Array.isArray(snapshot.results) || !Array.isArray(snapshot.assets) || !Array.isArray(snapshot.grants)) return null;
  const plan = snapshot.confirmedPlan;
  const base: OutputNavigationReference = {
    kind, id, authorizationScopeKey, documentId: snapshot.documentId, projectId: snapshot.projectId,
    actorUserId: snapshot.scope.actorUserId, projectAccessId: snapshot.scope.projectAccessId,
    revision: snapshot.revision, sourceRevision: snapshot.sourceRevision, requirementRevision: snapshot.requirementRevision,
    blockId: null, planRevisionId: null, targetId: null, targetContractDigest: null,
    resultId: null, resultRevision: null, assetId: null, assetSha256: null,
    grantId: null, operationId: null, jobId: null,
  };
  if (kind === "requirement") {
    const row = unique(snapshot.requirements, value => value.blockId === id);
    return row ? { ...base, blockId: row.blockId } : null;
  }
  if (kind === "operation") {
    const entries = snapshot.grants.flatMap(grant => grant.operations.map(operation => ({ grant, operation })));
    const entry = unique(entries, value => value.operation.id === id);
    if (!entry) return null;
    const { grant, operation } = entry;
    if (![grant.id, grant.planRevisionId, operation.id, operation.targetId, operation.jobId].every(identity)) return null;
    const target = plan && grant.planRevisionId === plan.revisionId ? unique(plan.plan.targets, value => value.id === operation.targetId) : null;
    return { ...base, planRevisionId: grant.planRevisionId, targetId: operation.targetId,
      blockId: target?.requirement_id ?? null, targetContractDigest: target ? plan!.targetContractDigests[target.id] ?? null : null,
      grantId: grant.id, operationId: operation.id, jobId: operation.jobId };
  }
  if (!plan || !Array.isArray(plan.plan?.targets)) return null;
  const result = kind === "result" ? unique(snapshot.results, value => value.id === id && value.planRevisionId === plan.revisionId) : null;
  if (kind === "result" && (!result || ![result.id, result.resultRevision, result.assetId].every(identity))) return null;
  const target = unique(plan.plan.targets, value => value.id === (result?.targetId ?? id));
  if (!target || !unique(snapshot.requirements, value => value.blockId === target.requirement_id)) return null;
  const targetContractDigest = plan.targetContractDigests?.[target.id];
  if (typeof targetContractDigest !== "string" || !targetContractDigest) return null;
  if (!result) return { ...base, blockId: target.requirement_id, planRevisionId: plan.revisionId, targetId: target.id, targetContractDigest };
  const asset = unique(snapshot.assets, value => value.id === result.assetId);
  // Missing bytes are still a recorded result, but not a usable-file address.
  return { ...base, blockId: target.requirement_id, planRevisionId: plan.revisionId, targetId: target.id, targetContractDigest,
    resultId: result.id, resultRevision: result.resultRevision, assetId: result.assetId, assetSha256: asset?.sha256 ?? null };
}
export function captureOutputNavigation(snapshot: OutputRequirementsSnapshot, authorizationScopeKey: string,
  kind: OutputNavigationKind, id: string): OutputNavigationReference | null {
  try { return captureOutputNavigationUnchecked(snapshot, authorizationScopeKey, kind, id); } catch { return null; }
}
export function outputNavigationMatches(reference: OutputNavigationReference, snapshot: OutputRequirementsSnapshot | null,
  authorizationScopeKey: string): boolean {
  if (!snapshot || reference.authorizationScopeKey !== authorizationScopeKey) return false;
  try {
    const current = captureOutputNavigation(snapshot, authorizationScopeKey, reference.kind, reference.id);
    return current !== null && JSON.stringify(current) === JSON.stringify(reference);
  } catch { return false; }
}
