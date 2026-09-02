/**
 * Additive memory contracts. Callers must supply server-resolved scopes, grants and
 * source receipts; these pure functions do not authenticate client-supplied data.
 * No production request path imports this module during the shadow rollout.
 */
export type MemoryScopeKind = "personal" | "organization" | "team" | "portfolio" | "project"
  | "collection" | "canvas" | "document" | "artifact" | "section" | "block";
export type MemoryPurpose = "recall" | "learn";
export type MemoryOrigin = "user" | "assistant" | "autocomplete" | "import" | "copy" | "system";
export type MemoryScope = {
  id: string; custodianId: string; kind: MemoryScopeKind; parentId: string | null; version: number;
};
export type MemoryScopeGraph = ReadonlyMap<string, Readonly<MemoryScope>>;
export type MemoryFence = { permission: number; erasure: number; ancestry: number; policy: number };
export type MemoryScopeGrant = {
  custodianId: string; scopeId: string; scopeVersion: number; canRead: boolean;
  purposes: readonly MemoryPurpose[]; expiresAt: string;
};
export type MemoryAccess = {
  actorUserId: string; custodianId: string; targetScopeId: string;
  enabled: boolean; environment: "production" | "synthetic"; now: string;
  enrollmentExpiresAt: string; retentionDays: number; fence: MemoryFence;
  grants: readonly MemoryScopeGrant[];
};
export type MemorySource = {
  id: string; custodianId: string; scopeId: string; scopeVersion: number;
  streamId: string; sequence: number; revision: string; contentHash: string;
  actorUserId: string; visibility: "actor" | "shared";
  /** Authenticated conversation speaker, distinct from assisted/copied content origin. */
  speaker: "user" | "assistant" | null;
  state: "active" | "erased" | "revoked" | "redacted" | "held-only";
  happenedAt: string; expiresAt: string; origin: MemoryOrigin; lineageId: string;
  synthetic: boolean; independentEvidence: boolean;
};
export type MemorySourceRef = Pick<MemorySource,
  "id" | "custodianId" | "scopeId" | "scopeVersion" | "streamId" | "sequence" | "revision" | "contentHash" | "lineageId" | "origin" | "synthetic" | "independentEvidence" | "actorUserId" | "visibility" | "happenedAt" | "speaker">;
export type MemoryRecord = {
  id: string; version: number; actorUserId: string; custodianId: string; scopeId: string;
  kind: "episode" | "workflow-pattern" | "conversation-summary";
  authority: "historical" | "inferred"; body: string; claimKey: string;
  sources: readonly MemorySourceRef[]; fence: MemoryFence;
  createdAt: string; expiresAt: string; lastIndependentEvidenceAt: string | null;
  confidence: number; synthetic: boolean; state: "active" | "superseded" | "erased";
};
export type MemorySuppression = {
  actorUserId: string; custodianId: string; scopeId: string;
  claimKey: string; lineageIds: readonly string[]; state: "active" | "revoked";
};

const SCOPE_KINDS: readonly string[] = ["personal", "organization", "team", "portfolio", "project", "collection", "canvas", "document", "artifact", "section", "block"];
const ORIGINS: readonly string[] = ["user", "assistant", "autocomplete", "import", "copy", "system"];
export const memoryKey = (custodianId: string, id: string) => JSON.stringify([custodianId, id]);
export const memoryTime = (value: unknown) => typeof value === "string" ? Date.parse(value) : Number.NaN;
export async function memoryDigest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const named = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
const versioned = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export const validMemoryFence = (fence: MemoryFence) => Boolean(fence)
  && [fence.permission, fence.erasure, fence.ancestry, fence.policy].every((value) => Number.isSafeInteger(value) && value >= 0);
export const sameMemoryFence = (left: MemoryFence, right: MemoryFence) => validMemoryFence(left) && validMemoryFence(right)
  && left.permission === right.permission && left.erasure === right.erasure && left.ancestry === right.ancestry && left.policy === right.policy;

/** Containment never grants access; reuse/reference edges must be resolved separately. */
export function createMemoryScopeGraph(scopes: readonly MemoryScope[]): MemoryScopeGraph {
  const graph = new Map<string, Readonly<MemoryScope>>();
  for (const scope of scopes) {
    if (!named(scope.id) || !named(scope.custodianId) || !versioned(scope.version) || !SCOPE_KINDS.includes(scope.kind)
      || scope.parentId !== null && !named(scope.parentId)) throw new Error("Invalid memory scope");
    const key = memoryKey(scope.custodianId, scope.id);
    if (graph.has(key)) throw new Error("Duplicate memory scope");
    if ((scope.kind === "personal" || scope.kind === "organization") !== (scope.parentId === null)) throw new Error("Invalid memory root");
    graph.set(key, Object.freeze({ ...scope }));
  }
  for (const scope of graph.values()) memoryScopePath(graph, scope.custodianId, scope.id);
  return graph;
}

export function memoryScopePath(graph: MemoryScopeGraph, custodianId: string, scopeId: string): readonly Readonly<MemoryScope>[] {
  const path: Readonly<MemoryScope>[] = [];
  const visited = new Set<string>();
  let id: string | null = scopeId;
  while (id !== null) {
    if (visited.has(id) || path.length >= 32) throw new Error("Cyclic or excessive memory ancestry");
    visited.add(id);
    const scope = graph.get(memoryKey(custodianId, id));
    if (!scope) throw new Error("Missing or cross-custodian memory parent");
    path.push(scope);
    id = scope.parentId;
  }
  return path;
}

export function memoryAccessValid(access: MemoryAccess, graph: MemoryScopeGraph): boolean {
  const now = memoryTime(access.now);
  return access.enabled === true && named(access.actorUserId) && named(access.custodianId)
    && (access.environment === "production" || access.environment === "synthetic")
    && Number.isFinite(now) && memoryTime(access.enrollmentExpiresAt) > now
    && Number.isFinite(access.retentionDays) && access.retentionDays > 0 && access.retentionDays <= 365
    && validMemoryFence(access.fence) && graph.has(memoryKey(access.custodianId, access.targetScopeId));
}

export function memoryScopeGrant(access: MemoryAccess, graph: MemoryScopeGraph, scopeId: string, purpose: MemoryPurpose): MemoryScopeGrant | undefined {
  if (!memoryAccessValid(access, graph)) return undefined;
  const scope = graph.get(memoryKey(access.custodianId, scopeId));
  // Reject ambiguous grants rather than treating one stale or revoked duplicate as sufficient.
  const grants = access.grants.filter((grant) => grant.custodianId === access.custodianId && grant.scopeId === scopeId);
  if (!scope || grants.length !== 1) return undefined;
  const grant = grants[0];
  return grant.canRead === true && grant.scopeVersion === scope.version && grant.purposes.includes(purpose)
    && memoryTime(grant.expiresAt) > memoryTime(access.now) ? grant : undefined;
}

export function memorySourceEligible(source: MemorySource, access: MemoryAccess, graph: MemoryScopeGraph, purpose: MemoryPurpose): boolean {
  if (!memoryScopeGrant(access, graph, access.targetScopeId, purpose) || source.custodianId !== access.custodianId) return false;
  const grant = memoryScopeGrant(access, graph, source.scopeId, purpose);
  const happened = memoryTime(source.happenedAt), now = memoryTime(access.now);
  return Boolean(grant && grant.scopeVersion === source.scopeVersion && named(source.id) && named(source.streamId)
    && named(source.actorUserId) && named(source.revision) && named(source.lineageId)
    && /^[a-f0-9]{64}$/u.test(source.contentHash) && Number.isSafeInteger(source.sequence) && source.sequence > 0
    && source.state === "active" && ORIGINS.includes(source.origin)
    && (source.visibility === "shared" || source.visibility === "actor" && source.actorUserId === access.actorUserId)
    && (source.speaker === null || source.speaker === "user" || source.speaker === "assistant")
    && typeof source.synthetic === "boolean" && typeof source.independentEvidence === "boolean" && (!source.synthetic || access.environment === "synthetic")
    && Number.isFinite(happened) && happened <= now && memoryTime(source.expiresAt) > now
    && happened + access.retentionDays * 86_400_000 > now);
}

export function memorySourceRef(source: MemorySource): MemorySourceRef {
  const { id, custodianId, scopeId, scopeVersion, streamId, sequence, revision, contentHash, lineageId, origin, synthetic, independentEvidence, actorUserId, visibility, happenedAt, speaker } = source;
  return { id, custodianId, scopeId, scopeVersion, streamId, sequence, revision, contentHash, lineageId, origin, synthetic, independentEvidence, actorUserId, visibility, happenedAt, speaker };
}

export function memorySourceMatches(ref: MemorySourceRef, source: MemorySourceRef): boolean {
  return ref.id === source.id && ref.custodianId === source.custodianId && ref.scopeId === source.scopeId
    && ref.scopeVersion === source.scopeVersion && ref.revision === source.revision
    && ref.contentHash === source.contentHash && ref.lineageId === source.lineageId
    && ref.streamId === source.streamId && ref.sequence === source.sequence && ref.origin === source.origin
    && ref.synthetic === source.synthetic && ref.independentEvidence === source.independentEvidence
    && ref.actorUserId === source.actorUserId && ref.visibility === source.visibility && ref.happenedAt === source.happenedAt && ref.speaker === source.speaker;
}

/** Earliest source, policy and grant deadline wins. Reads/rephrasing never renew it. */
export function memoryExpiry(sources: readonly MemorySource[], access: MemoryAccess, graph: MemoryScopeGraph, scopeId: string): string | null {
  if (sources.length === 0 || sources.length > 128) return null;
  const grant = memoryScopeGrant(access, graph, scopeId, "learn");
  if (!grant || sources.length === 0 || sources.some((source) => !memorySourceEligible(source, access, graph, "learn"))) return null;
  const deadline = Math.min(memoryTime(access.enrollmentExpiresAt), memoryTime(grant.expiresAt), ...sources.flatMap((source) => [
    memoryTime(source.expiresAt), memoryTime(source.happenedAt) + access.retentionDays * 86_400_000,
    memoryTime(memoryScopeGrant(access, graph, source.scopeId, "learn")!.expiresAt),
  ]));
  return Number.isFinite(deadline) && deadline > memoryTime(access.now) ? new Date(deadline).toISOString() : null;
}

export function createMemoryRecord(input: {
  id: string; version: number; scopeId: string; kind: MemoryRecord["kind"]; body: string; claimKey: string;
  confidence?: number; sources: readonly MemorySource[];
}, access: MemoryAccess, graph: MemoryScopeGraph): MemoryRecord | null {
  if (input.sources.length === 0 || input.sources.length > 128) return null;
  const expiresAt = memoryExpiry(input.sources, access, graph, input.scopeId);
  if (!expiresAt || !named(input.id) || !named(input.claimKey) || !versioned(input.version)
    || typeof input.body !== "string" || !input.body.trim() || new TextEncoder().encode(input.body).byteLength > 8_192
    || !["episode", "workflow-pattern", "conversation-summary"].includes(input.kind)
    || input.sources.length > 128 || new Set(input.sources.map((source) => memoryKey(source.custodianId, source.id))).size !== input.sources.length) return null;
  const confidence = input.confidence ?? 0;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const independent = input.sources.filter((source) => source.independentEvidence && source.origin === "user" && source.actorUserId === access.actorUserId);
  return {
    id: input.id, version: input.version, actorUserId: access.actorUserId, custodianId: access.custodianId,
    scopeId: input.scopeId, kind: input.kind, authority: input.kind === "workflow-pattern" ? "inferred" : "historical",
    body: input.body, claimKey: input.claimKey, confidence, sources: input.sources.map(memorySourceRef),
    fence: { ...access.fence }, createdAt: access.now, expiresAt,
    lastIndependentEvidenceAt: independent.length ? new Date(Math.max(...independent.map((source) => memoryTime(source.happenedAt)))).toISOString() : null,
    synthetic: input.sources.some((source) => source.synthetic), state: "active",
  };
}

export function memorySuppressed(record: MemoryRecord, suppressions: readonly MemorySuppression[], graph: MemoryScopeGraph, targetScopeId = record.scopeId): boolean {
  const ancestors = new Set([...memoryScopePath(graph, record.custodianId, record.scopeId),
    ...memoryScopePath(graph, record.custodianId, targetScopeId), ...record.sources.flatMap((source) =>
      graph.has(memoryKey(source.custodianId, source.scopeId)) ? memoryScopePath(graph, source.custodianId, source.scopeId) : []),
  ].filter((scope) => scope.custodianId === record.custodianId).map((scope) => scope.id));
  return suppressions.some((suppression) => suppression.state === "active" && suppression.actorUserId === record.actorUserId
    && suppression.custodianId === record.custodianId
    && (ancestors.has(suppression.scopeId) && suppression.claimKey === record.claimKey
      || record.sources.some((source) => suppression.lineageIds.includes(source.lineageId))));
}

/** Eligibility precedes ranking/body use; a stale external vector is never authority. */
export function memoryRecordEligible(record: MemoryRecord, sources: ReadonlyMap<string, MemorySource>, access: MemoryAccess,
  graph: MemoryScopeGraph, suppressions: readonly MemorySuppression[] = [], purpose: MemoryPurpose = "recall"): boolean {
  if (record.actorUserId !== access.actorUserId || record.custodianId !== access.custodianId || record.state !== "active"
    || !versioned(record.version) || !named(record.id) || !named(record.claimKey)
    || !["episode", "workflow-pattern", "conversation-summary"].includes(record.kind)
    || record.authority !== (record.kind === "workflow-pattern" ? "inferred" : "historical")
    || !Number.isFinite(memoryTime(record.createdAt)) || memoryTime(record.createdAt) > memoryTime(access.now)
    || !sameMemoryFence(record.fence, access.fence) || !memoryScopeGrant(access, graph, record.scopeId, purpose)
    || !memoryScopeGrant(access, graph, access.targetScopeId, purpose) || !(memoryTime(record.expiresAt) > memoryTime(access.now))
    || typeof record.synthetic !== "boolean" || record.synthetic && access.environment !== "synthetic"
    || record.sources.length === 0 || record.sources.length > 128 || memorySuppressed(record, suppressions, graph, access.targetScopeId)) return false;
  const eligible = record.sources.every((ref) => {
    const source = sources.get(memoryKey(ref.custodianId, ref.id));
    return Boolean(source && memorySourceMatches(ref, source) && memorySourceEligible(source, access, graph, purpose));
  });
  return eligible && typeof record.body === "string" && Boolean(record.body.trim()) && new TextEncoder().encode(record.body).byteLength <= 8_192;
}

/** Returned tombstones/suppressions must be durably committed by the future storage adapter. */
export function forgetMemory(record: MemoryRecord): { record: MemoryRecord; suppression: MemorySuppression } {
  return {
    record: { ...record, body: "", state: "erased" },
    suppression: { actorUserId: record.actorUserId, custodianId: record.custodianId, scopeId: record.scopeId,
      claimKey: record.claimKey, lineageIds: [...new Set(record.sources.map((source) => source.lineageId))], state: "active" },
  };
}

export function memoryLocality(graph: MemoryScopeGraph, custodianId: string, currentScopeId: string, candidateScopeId: string): "local" | "project" | "broad" {
  const current = memoryScopePath(graph, custodianId, currentScopeId), candidate = memoryScopePath(graph, custodianId, candidateScopeId);
  const currentProject = current.find((scope) => scope.kind === "project"), candidateProject = candidate.find((scope) => scope.kind === "project");
  const local = current.slice(0, currentProject ? current.indexOf(currentProject) : 1);
  const currentDocuments = current.filter((scope) => scope.kind === "document" || scope.kind === "artifact");
  if (currentScopeId === candidateScopeId || local.some((scope) => scope.id === candidateScopeId)
    || currentDocuments.some((document) => candidate.some((scope) => scope.id === document.id))) return "local";
  if (currentProject && candidateProject && currentProject.id === candidateProject.id
    || currentProject && candidate.some((scope) => scope.id === currentProject.id)
    || candidate[0].kind === "project" && current.some((scope) => scope.id === candidateScopeId)) return "project";
  return "broad";
}
