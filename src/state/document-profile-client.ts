/** Browser HTTP boundary only: explicit calls, no enrollment, persistence, retries or background work. */
import { parseMemoryCustody, type MemoryCustody } from "../model/memory-custody.ts";
import { createMemoryElapsed, memoryTimestamp, MEMORY_RECALL_MAX_AGE_MS, type MemoryClockSample } from "../model/memory-lifetime.ts";
import { DOCUMENT_PROFILE_POLICY, NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, MEMORY_DOCUMENT_PROFILE_MAX_BYTES,
  parseMemoryDocumentProfile, type MemoryDocumentProfile } from "../model/memory-document-profile.ts";
export { DOCUMENT_PROFILE_POLICY, NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE } from "../model/memory-document-profile.ts";
export type { MemoryDocumentProfile } from "../model/memory-document-profile.ts";

export const DOCUMENT_PROFILE_CONTROL_VERSION = "document-profile-control-v1" as const;
export type DocumentProfileParent = {
  enrollmentId: string; enrollmentRevision: number; expiresAt: string; retentionDays: number;
};
export type DocumentProfileScopeRequest = {
  projectId: string; documentId: string; expectedCustody: MemoryCustody;
  /** An explicit selected-parent snapshot, never inferred from a response. Present undefined is invalid. */
  expectedParent?: DocumentProfileParent | null;
};
export type DocumentProfileGrant = {
  grantId: string; revision: number; organizationId: string | null; projectAccessId: string | null; ownerUserId: string;
  projectId: string; documentId: string; enrollmentId: string; enrollmentRevision: number;
  policyVersion: typeof DOCUMENT_PROFILE_POLICY; recipeVersion: typeof NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE;
  infer: boolean; inspect: boolean; background: false; sourceAfterSequence: number;
  consentedAt: string; expiresAt: string; retentionDays: number; revokedAt: string | null;
};
export type DocumentProfileSettings = {
  version: typeof DOCUMENT_PROFILE_CONTROL_VERSION; enabled: boolean; policyVersion: typeof DOCUMENT_PROFILE_POLICY;
  recipeVersion: typeof NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE; purpose: "authored-palette-organization"; backgroundSupported: false;
  scope: { projectId: string; documentId: string; custody: MemoryCustody };
  parent: DocumentProfileParent | null; grant: DocumentProfileGrant | null; grantCurrent: boolean;
};
export type DocumentProfileEnableRequest = {
  version: typeof DOCUMENT_PROFILE_CONTROL_VERSION; policyVersion: typeof DOCUMENT_PROFILE_POLICY;
  recipeVersion: typeof NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE; projectId: string; documentId: string;
  enrollmentId: string; enrollmentRevision: number; revision: number; expectedCustody: MemoryCustody;
  infer: true; inspect: true; background: false; retentionDays: number; expiresAt: string;
  confirmation: "ENABLE_DOCUMENT_PALETTE_PROFILE";
};
export type DocumentProfileEnableResult = {
  version: typeof DOCUMENT_PROFILE_CONTROL_VERSION; grant: DocumentProfileGrant; historyStartsAfterSequence: number;
};
export type DocumentProfileSaveResult = DocumentProfileEnableResult;
export type DocumentProfileRevokeResult = {
  version: typeof DOCUMENT_PROFILE_CONTROL_VERSION; revoked: true; grantId: string; revision: number; reEnrollmentRequired: true;
};
export type DocumentProfileSuppression = {
  grantId: string; grantRevision: number; claimKey: string; revision: number; state: "active"; createdAt: string; expiresAt: string;
};
export type DocumentProfileSuppressResult = { version: typeof DOCUMENT_PROFILE_CONTROL_VERSION; suppression: DocumentProfileSuppression };
/** A short display lease, not authorization. Remote revocation still requires fresh server checks. */
export type DocumentProfileLease = Readonly<{
  value: MemoryDocumentProfile; current: () => MemoryDocumentProfile | null; remaining: () => number; retire: () => void;
}>;

export class DocumentProfileClientError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly mutationUnknown: boolean;
  constructor(code: string, status: number | null = null, mutationUnknown = false) {
    super(mutationUnknown ? "The document profile change could not be confirmed. Reload before trying again."
      : code === "document_profile_request_cancelled" ? "The document profile request was canceled."
        : "The document profile request could not be completed. Reload before trying again.");
    this.name = "DocumentProfileClientError";
    this.code = code; this.status = status; this.mutationUnknown = mutationUnknown;
  }
}

type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Row = Record<string, unknown>;
const PATH = "/api/memory/document-profile/";
const RESPONSE_BYTE_LIMIT = MEMORY_DOCUMENT_PROFILE_MAX_BYTES + 128;
const DAY_MS = 86_400_000;
const GRANT_KEYS = ["grantId", "revision", "organizationId", "projectAccessId", "ownerUserId", "projectId", "documentId", "enrollmentId",
  "enrollmentRevision", "policyVersion", "recipeVersion", "infer", "inspect", "background", "sourceAfterSequence", "consentedAt", "expiresAt", "retentionDays", "revokedAt"];
const ENABLE_KEYS = ["version", "policyVersion", "recipeVersion", "projectId", "documentId", "enrollmentId", "enrollmentRevision", "revision",
  "expectedCustody", "infer", "inspect", "background", "retentionDays", "expiresAt", "confirmation"];
const ERROR_CODES = new Set(["authentication_required", "principal_account_required", "consent_required", "pilot_consent_required",
  "same_origin_required", "method_not_allowed", "context_scope_required", "context_project_denied", "context_document_denied",
  "context_project_history_unavailable", "context_custody_unavailable", "memory_disabled", "memory_schema_unavailable",
  "memory_custody_changed", "memory_authority_or_revision_changed", "memory_revision_changed", "memory_not_found",
  "document_profile_disabled", "document_profile_unavailable", "document_profile_schema_unavailable", "document_profile_not_found",
  "document_profile_revision_changed", "document_profile_custody_changed", "document_profile_parent_changed",
  "document_profile_authority_or_revision_changed", "document_profile_request_too_large", "invalid_document_profile_request",
  "invalid_document_profile_expiry", "document_profile_grant_required", "document_profile_grant_invalid",
  "document_profile_revision_required", "document_profile_version_required", "document_profile_claim_unavailable",
  "document_profile_request_invalid", "document_profile_authority_changed", "document_profile_scope_required",
  "document_profile_custody_required", "document_profile_parent_unavailable", "document_profile_identity_unavailable",
  "document_profile_revision_exhausted", "document_profile_suppression_invalid", "document_profile_suppression_revision_changed",
  "document_profile_response_too_large",
  "document_profile_commit_delivery_unconfirmed",
  "explicit_document_profile_consent_required", "explicit_document_profile_revocation_required", "explicit_document_profile_suppression_required"]);

function check(condition: unknown): asserts condition { if (!condition) throw new Error("invalid-document-profile-contract"); }
/** Reject accessors/symbols/non-enumerable fields without evaluating them; copy once before awaiting. */
function row(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Row {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value); check(prototype === Object.prototype || prototype === null);
  const result: Row = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    check(typeof key === "string" && allowed.includes(key));
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor?.enumerable && Object.hasOwn(descriptor, "value"));
    result[key] = descriptor.value;
  }
  check(required.every(key => Object.hasOwn(result, key)));
  return result;
}
function identifier(value: unknown): string {
  check(typeof value === "string" && value.length > 0 && value.length <= 240 && value.trim() === value && value.isWellFormed()
    && !Array.from(value).some(character => { const code = character.codePointAt(0)!; return code < 32 || code === 127; })); return value;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  check(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max); return value;
}
function bool(value: unknown): boolean { check(typeof value === "boolean"); return value; }
function date(value: unknown): string { check(memoryTimestamp(value) !== null); return value as string; }
function claim(value: unknown): string { check(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)); return value; }
function custody(value: unknown): MemoryCustody { const result = parseMemoryCustody(value); check(result !== null); return result; }
function sameCustody(a: MemoryCustody, b: MemoryCustody): boolean {
  return a.kind === "personal" ? b.kind === "personal" : b.kind === "organization" && a.organizationId === b.organizationId
    && a.projectAccessId === b.projectAccessId && a.ownerUserId === b.ownerUserId;
}
function grantCustody(item: DocumentProfileGrant, expected: MemoryCustody) {
  check(expected.kind === "personal" ? item.organizationId === null && item.projectAccessId === null
    : item.organizationId === expected.organizationId && item.projectAccessId === expected.projectAccessId && item.ownerUserId === expected.ownerUserId);
}
function parent(value: unknown): DocumentProfileParent {
  const item = row(value, ["enrollmentId", "enrollmentRevision", "expiresAt", "retentionDays"]);
  return { enrollmentId: identifier(item.enrollmentId), enrollmentRevision: integer(item.enrollmentRevision, 1),
    expiresAt: date(item.expiresAt), retentionDays: integer(item.retentionDays, 1, 365) };
}
function sameParent(a: DocumentProfileParent | null, b: DocumentProfileParent | null): boolean {
  return a === null ? b === null : b !== null && a.enrollmentId === b.enrollmentId && a.enrollmentRevision === b.enrollmentRevision
    && a.expiresAt === b.expiresAt && a.retentionDays === b.retentionDays;
}
function grant(value: unknown): DocumentProfileGrant {
  const item = row(value, GRANT_KEYS);
  check(item.policyVersion === DOCUMENT_PROFILE_POLICY && item.recipeVersion === NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE && item.background === false);
  const organizationId = item.organizationId === null ? null : identifier(item.organizationId);
  const projectAccessId = item.projectAccessId === null ? null : identifier(item.projectAccessId);
  check((organizationId === null) === (projectAccessId === null));
  const consentedAt = date(item.consentedAt), expiresAt = date(item.expiresAt), revokedAt = item.revokedAt === null ? null : date(item.revokedAt);
  check((revokedAt === null ? expiresAt > consentedAt : expiresAt >= consentedAt && revokedAt >= consentedAt));
  return { grantId: identifier(item.grantId), revision: integer(item.revision, 1), organizationId, projectAccessId,
    ownerUserId: identifier(item.ownerUserId), projectId: identifier(item.projectId), documentId: identifier(item.documentId),
    enrollmentId: identifier(item.enrollmentId), enrollmentRevision: integer(item.enrollmentRevision, 1),
    policyVersion: DOCUMENT_PROFILE_POLICY, recipeVersion: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE,
    infer: bool(item.infer), inspect: bool(item.inspect), background: false, sourceAfterSequence: integer(item.sourceAfterSequence),
    consentedAt, expiresAt, retentionDays: integer(item.retentionDays, 1, 365), revokedAt };
}
function scopeRequest(value: unknown): DocumentProfileScopeRequest {
  const item = row(value, ["projectId", "documentId", "expectedCustody", "expectedParent"], ["projectId", "documentId", "expectedCustody"]);
  return { projectId: identifier(item.projectId), documentId: identifier(item.documentId), expectedCustody: custody(item.expectedCustody),
    ...(Object.hasOwn(item, "expectedParent") ? { expectedParent: item.expectedParent === null ? null : parent(item.expectedParent) } : {}) };
}
function enabledRequest(value: unknown, now: number): DocumentProfileEnableRequest {
  const item = row(value, ENABLE_KEYS);
  check(item.version === DOCUMENT_PROFILE_CONTROL_VERSION && item.policyVersion === DOCUMENT_PROFILE_POLICY
    && item.recipeVersion === NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE && item.infer === true && item.inspect === true
    && item.background === false && item.confirmation === "ENABLE_DOCUMENT_PALETTE_PROFILE");
  const expiresAt = date(item.expiresAt), expiry = memoryTimestamp(expiresAt)!;
  check(Number.isFinite(now) && expiry > now && expiry <= now + 365 * DAY_MS);
  const result: DocumentProfileEnableRequest = { version: DOCUMENT_PROFILE_CONTROL_VERSION, policyVersion: DOCUMENT_PROFILE_POLICY,
    recipeVersion: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, projectId: identifier(item.projectId), documentId: identifier(item.documentId),
    enrollmentId: identifier(item.enrollmentId), enrollmentRevision: integer(item.enrollmentRevision, 1),
    revision: integer(item.revision, 0, Number.MAX_SAFE_INTEGER - 1), expectedCustody: custody(item.expectedCustody),
    infer: true, inspect: true, background: false, retentionDays: integer(item.retentionDays, 1, 365), expiresAt,
    confirmation: "ENABLE_DOCUMENT_PALETTE_PROFILE" };
  check(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 4096);
  return result;
}
function settings(value: unknown, expected: DocumentProfileScopeRequest, now: number): DocumentProfileSettings {
  const item = row(value, ["version", "enabled", "policyVersion", "recipeVersion", "purpose", "backgroundSupported", "scope", "parent", "grant", "grantCurrent"]);
  check(item.version === DOCUMENT_PROFILE_CONTROL_VERSION && item.policyVersion === DOCUMENT_PROFILE_POLICY
    && item.recipeVersion === NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE && item.purpose === "authored-palette-organization" && item.backgroundSupported === false);
  const scope = row(item.scope, ["projectId", "documentId", "custody"]), resolved = custody(scope.custody);
  check(scope.projectId === expected.projectId && scope.documentId === expected.documentId && sameCustody(resolved, expected.expectedCustody));
  const selectedParent = item.parent === null ? null : parent(item.parent), selectedGrant = item.grant === null ? null : grant(item.grant);
  const enabled = bool(item.enabled), grantCurrent = bool(item.grantCurrent);
  check(!grantCurrent || selectedGrant !== null && selectedParent !== null && enabled);
  if (Object.hasOwn(expected, "expectedParent")) check(sameParent(selectedParent, expected.expectedParent!));
  if (selectedGrant) {
    check(selectedGrant.projectId === expected.projectId && selectedGrant.documentId === expected.documentId);
    grantCustody(selectedGrant, expected.expectedCustody);
    if (selectedParent) check(selectedGrant.enrollmentId === selectedParent.enrollmentId && selectedGrant.enrollmentRevision <= selectedParent.enrollmentRevision);
    if (grantCurrent) check(selectedParent !== null && selectedGrant.enrollmentRevision === selectedParent.enrollmentRevision
      && selectedGrant.expiresAt <= selectedParent.expiresAt && selectedGrant.retentionDays <= selectedParent.retentionDays
      && selectedGrant.infer && selectedGrant.inspect && selectedGrant.revokedAt === null
      && memoryTimestamp(selectedGrant.consentedAt)! <= now && memoryTimestamp(selectedGrant.expiresAt)! > now);
  }
  return { version: DOCUMENT_PROFILE_CONTROL_VERSION, enabled, policyVersion: DOCUMENT_PROFILE_POLICY,
    recipeVersion: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, purpose: "authored-palette-organization", backgroundSupported: false,
    scope: { projectId: expected.projectId, documentId: expected.documentId, custody: resolved }, parent: selectedParent, grant: selectedGrant, grantCurrent };
}
function enabled(value: unknown, expected: DocumentProfileEnableRequest): DocumentProfileEnableResult {
  const item = row(value, ["version", "grant", "historyStartsAfterSequence"]), result = grant(item.grant);
  check(item.version === DOCUMENT_PROFILE_CONTROL_VERSION && result.revision === expected.revision + 1 && result.projectId === expected.projectId
    && result.documentId === expected.documentId && result.enrollmentId === expected.enrollmentId && result.enrollmentRevision === expected.enrollmentRevision
    && result.infer === true && result.inspect === true && result.revokedAt === null && result.retentionDays === expected.retentionDays
    && result.expiresAt === expected.expiresAt && item.historyStartsAfterSequence === result.sourceAfterSequence);
  grantCustody(result, expected.expectedCustody);
  return { version: DOCUMENT_PROFILE_CONTROL_VERSION, grant: result, historyStartsAfterSequence: result.sourceAfterSequence };
}
function revoked(value: unknown, expected: DocumentProfileGrant): DocumentProfileRevokeResult {
  const item = row(value, ["version", "revoked", "grantId", "revision", "reEnrollmentRequired"]);
  const revision = expected.revision + Number(expected.revokedAt === null);
  check(item.version === DOCUMENT_PROFILE_CONTROL_VERSION && item.revoked === true && item.grantId === expected.grantId
    && item.revision === revision && item.reEnrollmentRequired === true);
  return { version: DOCUMENT_PROFILE_CONTROL_VERSION, revoked: true, grantId: expected.grantId, revision, reEnrollmentRequired: true };
}
function suppressed(value: unknown, expected: DocumentProfileGrant, claimKey: string, revision: number): DocumentProfileSuppressResult {
  const item = row(value, ["version", "suppression"]), result = row(item.suppression, ["grantId", "grantRevision", "claimKey", "revision", "state", "createdAt", "expiresAt"]);
  check(item.version === DOCUMENT_PROFILE_CONTROL_VERSION && result.grantId === expected.grantId && result.grantRevision === expected.revision
    && result.claimKey === claimKey && result.revision === revision + 1 && result.state === "active");
  const createdAt = date(result.createdAt), expiresAt = date(result.expiresAt);
  check(createdAt >= expected.consentedAt && expiresAt > createdAt && expiresAt <= expected.expiresAt
    && memoryTimestamp(expiresAt)! <= memoryTimestamp(createdAt)! + expected.retentionDays * DAY_MS);
  return { version: DOCUMENT_PROFILE_CONTROL_VERSION, suppression: { grantId: expected.grantId, grantRevision: expected.revision,
    claimKey, revision: revision + 1, state: "active", createdAt, expiresAt } };
}
function profile(value: unknown, expected: DocumentProfileGrant, now: number): MemoryDocumentProfile {
  const item = row(value, ["version", "profile"]); check(item.version === DOCUMENT_PROFILE_CONTROL_VERSION);
  const result = parseMemoryDocumentProfile(item.profile, now); check(result !== null);
  check(result.scope.projectId === expected.projectId && result.scope.documentId === expected.documentId
    && result.scope.organizationId === expected.organizationId && result.scope.projectAccessId === expected.projectAccessId
    && result.grant.id === expected.grantId && result.grant.revision === expected.revision && result.lifetime.validUntil <= expected.expiresAt
    && result.lifetime.checkedAt >= expected.consentedAt);
  const checkedAt = memoryTimestamp(result.lifetime.checkedAt)!;
  for (const choice of result.choices) for (const evidence of [...choice.supports, ...choice.counterevidence]) for (const source of evidence.sources) {
    const recordedAt = memoryTimestamp(source.recordedAt)!;
    check(source.sequence > expected.sourceAfterSequence && source.recordedAt >= expected.consentedAt
      && recordedAt >= checkedAt - expected.retentionDays * DAY_MS && memoryTimestamp(result.lifetime.validUntil)! <= recordedAt + expected.retentionDays * DAY_MS);
  }
  return result;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function input<T>(parse: () => T): T { try { return parse(); } catch { throw new DocumentProfileClientError("invalid_document_profile_request"); } }
/** Never wait for a hostile or stalled cancellation promise. */
function cancelBody(body: Pick<ReadableStream<Uint8Array>, "cancel"> | null) {
  try { void body?.cancel().catch(() => undefined); } catch { /* Best-effort cleanup; no raw transport errors. */ }
}
async function readJson(response: Response, signal?: AbortSignal, observe?: () => void): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null, cancelled = false;
  const cancel = () => { if (!cancelled) { cancelled = true; cancelBody(reader ?? response.body); } };
  let rejectAbort: (error: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; }); void interrupted.catch(() => undefined);
  const abort = () => { cancel(); rejectAbort(new Error("document-profile-request-cancelled")); };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, result = "";
  try {
    check(!signal?.aborted); observe?.();
    check(/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "") && response.body !== null);
    reader = response.body.getReader();
    for (;;) {
      const reading = reader.read(), chunk = await (signal ? Promise.race([reading, interrupted]) : reading);
      check(!signal?.aborted); observe?.(); if (chunk.done) break;
      bytes += chunk.value.byteLength; check(bytes <= RESPONSE_BYTE_LIMIT); result += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(result + decoder.decode());
  } catch (error) { cancel(); throw error; }
  finally { signal?.removeEventListener("abort", abort); try { reader?.releaseLock(); } catch { /* A canceled read may still settle. */ } }
}

/** Every public action issues at most one fresh, same-origin request. No activation occurs on construction. */
export function createDocumentProfileClient(transport: Transport = fetch,
  clock: () => MemoryClockSample = () => ({ monotonic: performance.now(), wall: Date.now() })) {
  const noncurrent = new Set<string>(), leases = new Map<string, Set<() => void>>(), knownGrants = new Map<string, DocumentProfileGrant>();
  const epochs = new Map<string, number>();
  const controlEpochs = new Map<string, symbol>();
  const keyFor = (item: DocumentProfileGrant) => JSON.stringify([item.grantId, item.revision]);
  /** A late control response must not rewrite the newer scope's permanent retirement ledger. */
  const beginControl = (scope: { projectId: string; documentId: string }, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DocumentProfileClientError("document_profile_request_cancelled");
    const key = JSON.stringify([scope.projectId, scope.documentId]), epoch = Symbol();
    controlEpochs.set(key, epoch);
    return () => check(controlEpochs.get(key) === epoch);
  };
  const retire = (item: DocumentProfileGrant, markNoncurrent = false) => {
    const key = keyFor(item); if (markNoncurrent) noncurrent.add(key);
    epochs.set(key, (epochs.get(key) ?? 0) + 1);
    for (const end of leases.get(key) ?? []) end(); leases.delete(key);
  };
  const retireScope = (scope: { projectId: string; documentId: string }) => {
    for (const item of knownGrants.values()) if (item.projectId === scope.projectId && item.documentId === scope.documentId) retire(item);
  };
  const record = (scope: { projectId: string; documentId: string }, selected: DocumentProfileGrant | null, current: boolean) => {
    for (const item of knownGrants.values()) if (item.projectId === scope.projectId && item.documentId === scope.documentId
      && (!current || !selected || keyFor(item) !== keyFor(selected))) retire(item, true);
    if (selected) {
      knownGrants.set(keyFor(selected), grant(selected));
      if (!current) retire(selected, true);
    }
  };
  const sample = (): MemoryClockSample => {
    try { const value = clock(); return { monotonic: value.monotonic, wall: value.wall }; }
    catch { return { monotonic: NaN, wall: NaN }; }
  };
  async function request<T>(path: string, method: "GET" | "PUT" | "DELETE", body: unknown, signal: AbortSignal | undefined,
    parse: (value: unknown) => T, observe?: () => void): Promise<T> {
    if (signal?.aborted) throw new DocumentProfileClientError("document_profile_request_cancelled");
    const mutation = method !== "GET"; let response: Response;
    let rejectAbort: (error: Error) => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; }); void interrupted.catch(() => undefined);
    const abort = () => rejectAbort(new Error("document-profile-request-cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const pending = transport(path, { method, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", signal,
        headers: { accept: "application/json", ...(mutation ? { "content-type": "application/json" } : {}) },
        ...(mutation ? { body: JSON.stringify(body) } : {}) });
      const arriving = pending.then(result => { if (signal?.aborted) cancelBody(result.body); return result; });
      response = await (signal ? Promise.race([arriving, interrupted]) : arriving);
    } catch { throw new DocumentProfileClientError(signal?.aborted ? "document_profile_request_cancelled" : "document_profile_request_failed", null, mutation); }
    finally { signal?.removeEventListener("abort", abort); }
    if (!response.ok) {
      let code = "document_profile_request_rejected";
      try {
        const value = await readJson(response, signal);
        if (value !== null && typeof value === "object" && !Array.isArray(value)
          && typeof (value as Row).error === "string" && ERROR_CODES.has((value as Row).error as string)) code = (value as Row).error as string;
      } catch { /* An untrusted error body is never shown to the caller. */ }
      if (signal?.aborted) throw new DocumentProfileClientError("document_profile_request_cancelled", response.status, mutation);
      throw new DocumentProfileClientError(code, response.status, mutation && (response.status < 400 || response.status >= 500));
    }
    try {
      if (response.status !== 200) { cancelBody(response.body); throw new Error("document-profile-status-invalid"); }
      const raw = await readJson(response, signal, observe); check(!signal?.aborted);
      const result = parse(raw); observe?.(); check(!signal?.aborted); return result;
    } catch { throw new DocumentProfileClientError(signal?.aborted ? "document_profile_request_cancelled" : "document_profile_response_invalid", response.status, mutation); }
  }
  return {
    async settings(value: DocumentProfileScopeRequest, signal?: AbortSignal): Promise<DocumentProfileSettings> {
      const expected = input(() => scopeRequest(value)), current = beginControl(expected, signal);
      retireScope(expected);
      return request(`${PATH}settings?projectId=${encodeURIComponent(expected.projectId)}&documentId=${encodeURIComponent(expected.documentId)}`,
        "GET", undefined, signal, raw => {
          const result = settings(raw, expected, sample().wall);
          current();
          record(expected, result.grant, result.grantCurrent);
          return result;
        });
    },
    async enable(value: DocumentProfileEnableRequest, signal?: AbortSignal): Promise<DocumentProfileEnableResult> {
      const expected = input(() => enabledRequest(value, sample().wall)), current = beginControl(expected, signal);
      retireScope(expected);
      return request(`${PATH}settings`, "PUT", expected, signal, raw => {
        const result = enabled(raw, expected); current(); record(expected, result.grant, true); return result;
      });
    },
    async revoke(value: DocumentProfileGrant, signal?: AbortSignal): Promise<DocumentProfileRevokeResult> {
      // Original-actor revocation remains available for disabled, expired and already-revoked grants.
      const expected = input(() => { const result = grant(value);
        integer(result.revision, 1, Number.MAX_SAFE_INTEGER - Number(result.revokedAt === null)); return result; });
      beginControl(expected, signal); retire(expected);
      return request(`${PATH}settings?grantId=${encodeURIComponent(expected.grantId)}`, "DELETE",
        { version: DOCUMENT_PROFILE_CONTROL_VERSION, revision: expected.revision, confirmation: "REVOKE_DOCUMENT_PALETTE_PROFILE" },
        signal, raw => { const result = revoked(raw, expected); retire(expected, true); return result; });
    },
    async inspect(value: DocumentProfileGrant, signal?: AbortSignal): Promise<DocumentProfileLease> {
      const expected = input(() => { const result = grant(value); check(result.infer && result.inspect && result.revokedAt === null
        && !noncurrent.has(keyFor(result))); return result; });
      retire(expected); knownGrants.set(keyFor(expected), expected);
      const requestEpoch = epochs.get(keyFor(expected));
      if (signal?.aborted) throw new DocumentProfileClientError("document_profile_request_cancelled");
      const start = sample(), elapsed = createMemoryElapsed(start), expiry = memoryTimestamp(expected.expiresAt)!;
      let leaseDeadline = Infinity, leaseBudget = MEMORY_RECALL_MAX_AGE_MS;
      const observe = () => {
        const current = sample(), duration = elapsed.elapsed(current);
        check(epochs.get(keyFor(expected)) === requestEpoch && !noncurrent.has(keyFor(expected)) && Number.isFinite(duration) && current.wall < expiry
          && duration < expiry - start.wall && duration < leaseBudget && current.wall < leaseDeadline);
      };
      input(observe);
      return request(`${PATH}inspect?grantId=${encodeURIComponent(expected.grantId)}&version=${DOCUMENT_PROFILE_CONTROL_VERSION}`,
        "GET", undefined, signal, raw => {
          const current = sample(), result = profile(raw, expected, current.wall);
          check(Number.isFinite(elapsed.elapsed(current)));
          const checked = memoryTimestamp(result.lifetime.checkedAt)!, until = memoryTimestamp(result.lifetime.validUntil)!;
          // Capture numbers separately from the returned data. Network time and absolute age both consume this budget.
          const budget = Math.min(MEMORY_RECALL_MAX_AGE_MS, until - checked, until - start.wall, expiry - start.wall);
          leaseDeadline = until; leaseBudget = budget;
          const remaining = () => {
            if (signal?.aborted || epochs.get(keyFor(expected)) !== requestEpoch) { elapsed.retire(); return 0; }
            const moment = sample(), duration = elapsed.elapsed(moment);
            const available = Math.max(0, Math.min(budget - duration, until - moment.wall, expiry - moment.wall));
            if (!(available > 0)) { elapsed.retire(); return 0; } return available;
          };
          check(remaining() > 0);
          const value = freeze(result);
          const key = keyFor(expected), existing = leases.get(key) ?? new Set<() => void>();
          existing.add(elapsed.retire); leases.set(key, existing);
          return Object.freeze({ value, current: () => remaining() > 0 ? value : null, remaining, retire: elapsed.retire });
        }, observe).catch(error => { elapsed.retire(); throw error; });
    },
    async suppress(value: DocumentProfileGrant, claimKey: string, revision: number, signal?: AbortSignal): Promise<DocumentProfileSuppressResult> {
      const expected = input(() => { const result = grant(value); check(result.infer && result.inspect && result.revokedAt === null
        && !noncurrent.has(keyFor(result)) && memoryTimestamp(result.expiresAt)! > sample().wall); return result; });
      const key = input(() => claim(claimKey)), expectedRevision = input(() => integer(revision, 0, Number.MAX_SAFE_INTEGER - 1));
      beginControl(expected, signal); retire(expected);
      return request(`${PATH}suppress`, "PUT", { version: DOCUMENT_PROFILE_CONTROL_VERSION, grantId: expected.grantId,
        grantRevision: expected.revision, claimKey: key, revision: expectedRevision, confirmation: "SUPPRESS_DOCUMENT_PALETTE_CLAIM" },
      signal, raw => { const result = suppressed(raw, expected, key, expectedRevision); retire(expected); return result; });
    },
  };
}
