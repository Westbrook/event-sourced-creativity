/** Client readiness only. Server authorization, current evidence, and atomic release remain authoritative. */
export type OutputSourceReadinessInput = { sourceVerification?: unknown };
export type OutputDeliveryReadinessInput = OutputSourceReadinessInput & {
  documentId: string;
  sourceRevision: string;
  requirementRevision: string;
  confirmedPlan: { revisionId: string; sourceDigest: string; requirementsDigest: string } | null;
  summary: { scope_known: boolean } | null;
  capabilities?: { limitationCodes?: readonly string[] };
};
export type OutputReadinessGate = {
  allowed: boolean;
  reason: "ready" | "source_unknown" | "source_unavailable" | "plan_unconfirmed" | "plan_stale" | "scope_unknown" | "capacity_unknown" | "native_capacity" | "history_unverified";
  reasonCodes: string[];
  values?: Record<string, number>;
};
const denied = (reason: OutputReadinessGate["reason"], reasonCodes: string[] = []): OutputReadinessGate => ({ allowed: false, reason, reasonCodes });
const ready = (): OutputReadinessGate => ({ allowed: true, reason: "ready", reasonCodes: [] });

/** Equal digests never establish that source access, rights, or private evidence were verified. */
export function outputSourceReadiness(snapshot: OutputSourceReadinessInput | null | undefined): OutputReadinessGate {
  const value = snapshot?.sourceVerification;
  if (!value || typeof value !== "object" || Array.isArray(value)) return denied("source_unknown");
  const verification = value as { status?: unknown; reasonCodes?: unknown };
  if (!["verified", "unavailable"].includes(String(verification.status)) || !Array.isArray(verification.reasonCodes)
    || verification.reasonCodes.some((code) => typeof code !== "string" || !code.trim())) return denied("source_unknown");
  const codes = [...new Set(verification.reasonCodes as string[])];
  return verification.status === "verified" && codes.length === 0 ? ready() : denied("source_unavailable", codes);
}

export function outputDeliveryReadiness(snapshot: OutputDeliveryReadinessInput | null | undefined): OutputReadinessGate {
  const source = outputSourceReadiness(snapshot);
  if (!source.allowed || !snapshot) return source;
  const plan = snapshot.confirmedPlan;
  if (!plan) return denied("plan_unconfirmed");
  // Model/custody capacity is not repaired by reconfirming an otherwise identifiable plan.
  const modelReasons = (snapshot.capabilities?.limitationCodes ?? []).filter((code) => code.startsWith("output_read_model_") || code.startsWith("output_custody_"));
  if (snapshot.summary?.scope_known !== true && modelReasons.length) return denied("scope_unknown", [...new Set(modelReasons)]);
  if (plan.sourceDigest !== snapshot.sourceRevision || plan.requirementsDigest !== snapshot.requirementRevision) return denied("plan_stale");
  if (snapshot.summary?.scope_known !== true) return denied("scope_unknown");
  // Known unresolved obligations may still be planned or worked on. They are not complete.
  return ready();
}

/** Immutable manifest history affects package release only, not source access or exact-file review. */
export function outputPackageReadiness(snapshot: OutputDeliveryReadinessInput | null | undefined): OutputReadinessGate {
  const delivery = outputDeliveryReadiness(snapshot);
  if (!delivery.allowed) return delivery;
  return snapshot?.capabilities?.limitationCodes?.includes("output_scope_history_reason_unverified")
    ? denied("history_unverified", ["output_scope_history_reason_unverified"]) : ready();
}

export type OutputSourceCapacityView = {
  referenceCount: number | null;
  distinctObjectCount: number | null;
  ownedReadLimit: number | null;
  nativeLimit: number | null;
  countsComplete: boolean;
  sources: Array<{ blockId: string; label: string }>;
  sourcesComplete: boolean;
};
/** Missing or malformed counts stay unknown; zero is accepted only when the server actually supplied it. */
export function outputSourceCapacity(snapshot: OutputSourceReadinessInput | null | undefined): OutputSourceCapacityView | null {
  const verification = snapshot?.sourceVerification;
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) return null;
  const capacity = (verification as Record<string, unknown>).capacity;
  if (!capacity || typeof capacity !== "object" || Array.isArray(capacity)) return null;
  const value = capacity as Record<string, unknown>;
  const count = (number: unknown) => typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : null;
  const rows = Array.isArray(value.sources) ? value.sources : [];
  const sources = rows.flatMap((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const candidate = row as Record<string, unknown>;
    return typeof candidate.blockId === "string" && candidate.blockId.trim() && typeof candidate.label === "string" && candidate.label.trim()
      ? [{ blockId: candidate.blockId, label: candidate.label }] : [];
  });
  return { referenceCount: count(value.referenceCount), distinctObjectCount: count(value.distinctObjectCount), ownedReadLimit: count(value.ownedReadLimit), nativeLimit: count(value.nativeLimit),
    countsComplete: value.countsComplete === true, sources, sourcesComplete: value.sourcesComplete === true && Array.isArray(value.sources) && sources.length === rows.length };
}

export type OutputSourceGovernanceView = {
  captureBatchLimit: number | null;
  sources: Array<{ blockId: string; label: string }>;
  sourcesComplete: boolean;
};
/** Optional display metadata only. Source status/reason codes remain the sole verification authority. */
export function outputSourceGovernance(snapshot: OutputSourceReadinessInput | null | undefined): OutputSourceGovernanceView | null {
  const verification = snapshot?.sourceVerification;
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) return null;
  const governance = (verification as Record<string, unknown>).governance;
  if (!governance || typeof governance !== "object" || Array.isArray(governance)) return null;
  const value = governance as Record<string, unknown>;
  const rows = Array.isArray(value.sources) ? value.sources : [];
  // Match the server's Unicode code-point display bound, not UTF-16 units or private-evidence bytes.
  // Dropped/malformed labels make this list incomplete, never empty scope.
  const sources = rows.slice(0, 32).flatMap((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const candidate = row as Record<string, unknown>;
    return typeof candidate.blockId === "string" && candidate.blockId.trim() && typeof candidate.label === "string" && candidate.label.trim() && [...candidate.label].length <= 120
      ? [{ blockId: candidate.blockId, label: candidate.label }] : [];
  });
  const limit = value.captureBatchLimit;
  return { captureBatchLimit: typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0 ? limit : null,
    sources, sourcesComplete: value.sourcesComplete === true && Array.isArray(value.sources) && sources.length === rows.length };
}

export function outputNativeReadiness(snapshot: OutputDeliveryReadinessInput | null | undefined): OutputReadinessGate {
  const gate = outputDeliveryReadiness(snapshot);
  if (!gate.allowed) return gate;
  const capacity = outputSourceCapacity(snapshot);
  if (!capacity || !capacity.countsComplete || capacity.referenceCount === null || capacity.distinctObjectCount === null || capacity.nativeLimit === null || capacity.ownedReadLimit === null) return denied("capacity_unknown");
  if (capacity.distinctObjectCount > capacity.nativeLimit) return { ...denied("native_capacity", ["context_source_evidence_capacity_exceeded"]), values: { count: capacity.distinctObjectCount, limit: capacity.nativeLimit } };
  // A bounded display-name list is not a new source-capacity restriction.
  return ready();
}

export type OutputReleaseCapture = {
  kind: "file" | "package";
  documentId: string;
  sourceRevision: string;
  requirementRevision: string;
  planRevisionId: string | null;
};
export function captureOutputRelease(snapshot: OutputDeliveryReadinessInput, kind: OutputReleaseCapture["kind"]): OutputReleaseCapture | null {
  if (!(kind === "package" ? outputPackageReadiness(snapshot) : outputSourceReadiness(snapshot)).allowed) return null;
  return { kind, documentId: snapshot.documentId, sourceRevision: snapshot.sourceRevision, requirementRevision: snapshot.requirementRevision,
    planRevisionId: kind === "package" ? snapshot.confirmedPlan?.revisionId ?? null : null };
}
/** Call again after awaited bytes, before creating a Blob URL or triggering a download. */
export function outputReleaseStillAllowed(captured: OutputReleaseCapture, snapshot: OutputDeliveryReadinessInput | null | undefined): boolean {
  if (!snapshot || snapshot.documentId !== captured.documentId || snapshot.sourceRevision !== captured.sourceRevision || snapshot.requirementRevision !== captured.requirementRevision) return false;
  if (captured.kind === "package" && snapshot.confirmedPlan?.revisionId !== captured.planRevisionId) return false;
  return (captured.kind === "package" ? outputPackageReadiness(snapshot) : outputSourceReadiness(snapshot)).allowed;
}

export type OutputUploadFailure = { kind: "revision" | "authority" | "rejected" | "uncertain"; code: string | null };
/** A generic HTTP 409 does not mean the file should be restaged against a new revision. */
export function classifyOutputUploadFailure(result: { status: string; body?: unknown }): OutputUploadFailure | null {
  if (result.status === "saved") return null;
  const body = result.body && typeof result.body === "object" && !Array.isArray(result.body) ? result.body as Record<string, unknown> : {};
  const code = typeof body.error === "string" ? body.error : null;
  if (result.status === "conflict" && code === "output_revision_conflict") return { kind: "revision", code };
  if (result.status === "conflict" && code === "output_revision_or_authority_changed") return { kind: "authority", code };
  return { kind: result.status === "unavailable" ? "uncertain" : "rejected", code };
}
export function outputUploadNeedsRestage(failure: OutputUploadFailure | null): boolean {
  return failure?.kind === "revision" || failure?.kind === "authority";
}
export function outputUploadCanRestage(failure: OutputUploadFailure | null, attemptedRevision: string,
  fresh: OutputSourceReadinessInput & { revision: string; permissions: { canAuthor: boolean } }, freshReadCompleted: boolean): boolean {
  if (!freshReadCompleted || !outputUploadNeedsRestage(failure) || !fresh.permissions.canAuthor || !outputSourceReadiness(fresh).allowed) return false;
  // A pure CAS rejection needs an actually newer head. An authority guard may change without it.
  return failure?.kind === "authority" || fresh.revision !== attemptedRevision;
}
