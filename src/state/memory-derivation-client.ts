/** Explicit consent transport only. No storage, enrollment, processing or retry. */
import { parseMemoryCustody, type MemoryCustody } from "../model/memory-custody.ts";
import { memoryDigest } from "../model/scoped-memory.ts";
import { MEMORY_DERIVATION_CONTROL, MEMORY_DERIVATION_POLICY, MEMORY_DERIVATION_PURPOSES, derivationExact,
  derivationHash, derivationConsentId, derivationId, derivationInteger, derivationTime, derivationCanonical,
  parseMemoryDerivationTerms, type MemoryDerivationTerms, type MemoryDerivationPurpose } from "../model/memory-derivation-policy.ts";
export { MEMORY_DERIVATION_CONTROL, MEMORY_DERIVATION_POLICY } from "../model/memory-derivation-policy.ts";
export type DerivationScope = { projectId: string; documentId: string; custody: MemoryCustody };
export type DerivationScopeRequest = { projectId: string; documentId: string; expectedCustody: MemoryCustody; enrollmentId: string; enrollmentRevision: number };
export type DerivationGrant = { scope: DerivationScope; grantId: string; revision: number; consentId: string; purpose: MemoryDerivationPurpose;
  enrollmentId: string; enrollmentRevision: number; qualificationId: string; termsSha256: string; monthlyCapMicroUsd: number;
  sourceAfterSequence: number; background: boolean; retentionDays: number; consentedAt: string; expiresAt: string; revokedAt: string | null };
export type DerivationOffer = { qualificationId: string; termsSha256: string; expiresAt: string; terms: MemoryDerivationTerms };
export type DerivationSettings = { enabled: boolean; available: boolean; processingImplemented: boolean; grants: readonly DerivationGrant[]; qualifications: readonly DerivationOffer[] };
export type DerivationEnable = { version: typeof MEMORY_DERIVATION_CONTROL; policyVersion: typeof MEMORY_DERIVATION_POLICY;
  purpose: MemoryDerivationPurpose; qualificationId: string; termsSha256: string; projectId: string; documentId: string;
  enrollmentId: string; enrollmentRevision: number; revision: number; expectedConsentId: string | null; expectedCustody: MemoryCustody;
  monthlyCapMicroUsd: number; background: boolean; retentionDays: number; expiresAt: string; sourceWindow: "future-originals";
  chargeMyAiAllowance: true; confirmation: "ENABLE_DERIVED_MEMORY" };
export class MemoryDerivationClientError extends Error {
  constructor(readonly mutationUnknown = false, readonly status: number | null = null) {
    super(mutationUnknown ? "The change is unconfirmed. Reload before trying again." : "Memory purpose controls are unavailable. Reload to check.");
    this.name = "MemoryDerivationClientError";
  }
}
const PATH = "/api/memory/derivation/settings", CAP_SCOPE = "payer-utc-calendar-month-all-memory-purposes";
const GRANT_KEYS = ["scope", "grantId", "revision", "consentId", "purpose", "enrollmentId", "enrollmentRevision", "qualificationId", "termsSha256", "monthlyCapMicroUsd", "sourceAfterSequence", "background", "retentionDays", "consentedAt", "expiresAt", "revokedAt"];
function check(value: unknown): asserts value { if (!value) throw new Error("invalid-memory-derivation-contract"); }
function own(value: unknown, keys: readonly string[]): Record<string, unknown> { check(derivationExact(value, keys)); return value; }
function frozen<T>(value: T): T { if (value && typeof value === "object") { for (const item of Object.values(value)) frozen(item); Object.freeze(value); } return value; }
function sameScope(a: DerivationScope, b: DerivationScope): boolean { return derivationCanonical(a) === derivationCanonical(b); }
function scope(value: unknown): DerivationScope {
  const row = own(value, ["projectId", "documentId", "custody"]), custody = parseMemoryCustody(row.custody);
  check(derivationId(row.projectId) && row.projectId.length <= 120 && derivationId(row.documentId) && row.documentId.length <= 120 && custody);
  return { projectId: row.projectId, documentId: row.documentId, custody };
}
function requestScope(value: unknown): DerivationScopeRequest {
  const row = own(value, ["projectId", "documentId", "expectedCustody", "enrollmentId", "enrollmentRevision"]);
  const result = scope({ projectId: row.projectId, documentId: row.documentId, custody: row.expectedCustody });
  check(derivationId(row.enrollmentId) && derivationInteger(row.enrollmentRevision, 1));
  return frozen({ projectId: result.projectId, documentId: result.documentId, expectedCustody: result.custody, enrollmentId: row.enrollmentId, enrollmentRevision: row.enrollmentRevision });
}
function grant(value: unknown): DerivationGrant {
  const row = own(value, GRANT_KEYS), selected = scope(row.scope);
  check(derivationHash(row.grantId) && derivationConsentId(row.consentId) && derivationInteger(row.revision, 1)
    && MEMORY_DERIVATION_PURPOSES.some(p => p === row.purpose) && derivationId(row.enrollmentId) && derivationInteger(row.enrollmentRevision, 1)
    && derivationId(row.qualificationId) && derivationHash(row.termsSha256) && derivationInteger(row.monthlyCapMicroUsd, 1, 1000000000)
    && derivationInteger(row.sourceAfterSequence) && typeof row.background === "boolean" && derivationInteger(row.retentionDays, 1, 365)
    && derivationTime(row.consentedAt) && derivationTime(row.expiresAt) && row.expiresAt > row.consentedAt
    && (row.revokedAt === null || derivationTime(row.revokedAt) && row.revokedAt >= row.consentedAt));
  return frozen({ ...structuredClone(row), scope: selected } as DerivationGrant);
}
async function settings(raw: unknown, expected: DerivationScopeRequest): Promise<DerivationSettings> {
  if (derivationExact(raw, ["version", "enabled", "available", "reason", "grants", "qualifications"])) {
    check(raw.version === MEMORY_DERIVATION_CONTROL && raw.enabled === false && raw.available === false && raw.reason === "schema-unavailable"
      && Array.isArray(raw.grants) && raw.grants.length === 0 && Array.isArray(raw.qualifications) && raw.qualifications.length === 0);
    return frozen({ enabled: false, available: false, processingImplemented: false, grants: [], qualifications: [] });
  }
  const row = own(raw, ["version", "enabled", "available", "reason", "policyVersion", "scope", "enrollmentId", "enrollmentRevision", "grants", "qualifications", "capScope", "sourceWindow", "processingImplemented"]);
  check(row.version === MEMORY_DERIVATION_CONTROL && row.policyVersion === MEMORY_DERIVATION_POLICY && typeof row.enabled === "boolean"
    && typeof row.available === "boolean" && typeof row.processingImplemented === "boolean" && row.capScope === CAP_SCOPE && row.sourceWindow === "future-originals"
    && row.enrollmentId === expected.enrollmentId && row.enrollmentRevision === expected.enrollmentRevision
    && [null, "disabled", "qualification-required"].includes(row.reason as string | null)
    && sameScope(scope(row.scope), { projectId: expected.projectId, documentId: expected.documentId, custody: expected.expectedCustody })
    && Array.isArray(row.grants) && row.grants.length <= 192 && Array.isArray(row.qualifications) && row.qualifications.length <= 16);
  const grants = Array.from(row.grants).map(grant), ids = new Set<string>(), active = new Set<string>();
  for (const item of grants) {
    const key = item.grantId + ":" + item.revision;
    check(!ids.has(key) && sameScope(item.scope, scope(row.scope)) && item.enrollmentId === expected.enrollmentId && item.enrollmentRevision <= expected.enrollmentRevision);
    ids.add(key); if (item.revokedAt === null) { check(!active.has(item.purpose)); active.add(item.purpose); }
  }
  const qualifications: DerivationOffer[] = [], qualifiedIds = new Set<string>();
  for (const value of Array.from(row.qualifications)) {
    const item = own(value, ["qualificationId", "termsSha256", "expiresAt", "terms"]), terms = parseMemoryDerivationTerms(item.terms);
    check(terms && derivationId(item.qualificationId) && !qualifiedIds.has(item.qualificationId) && derivationHash(item.termsSha256)
      && derivationTime(item.expiresAt) && Date.parse(item.expiresAt) > Date.now()
      && await memoryDigest(derivationCanonical(terms)) === item.termsSha256);
    qualifiedIds.add(item.qualificationId); qualifications.push({ qualificationId: item.qualificationId, termsSha256: item.termsSha256, expiresAt: item.expiresAt, terms });
  }
  check(qualifications.every(item => Date.parse(item.expiresAt) > Date.now()));
  check(row.available === (qualifications.length > 0) && (row.enabled || !row.available));
  return frozen({ enabled: row.enabled, available: row.available, processingImplemented: row.processingImplemented, grants, qualifications });
}
function enable(value: unknown): DerivationEnable {
  const row = own(value, ["version", "policyVersion", "purpose", "qualificationId", "termsSha256", "projectId", "documentId", "enrollmentId", "enrollmentRevision", "revision", "expectedConsentId", "expectedCustody", "monthlyCapMicroUsd", "background", "retentionDays", "expiresAt", "sourceWindow", "chargeMyAiAllowance", "confirmation"]);
  const selected = requestScope(Object.fromEntries(["projectId", "documentId", "expectedCustody", "enrollmentId", "enrollmentRevision"].map(k => [k, row[k]])));
  check(row.version === MEMORY_DERIVATION_CONTROL && row.policyVersion === MEMORY_DERIVATION_POLICY && MEMORY_DERIVATION_PURPOSES.some(p => p === row.purpose)
    && derivationId(row.qualificationId) && derivationHash(row.termsSha256) && derivationInteger(row.revision, 0, Number.MAX_SAFE_INTEGER - 1)
    && (row.revision === 0 ? row.expectedConsentId === null : derivationConsentId(row.expectedConsentId))
    && derivationInteger(row.monthlyCapMicroUsd, 1, 1000000000) && typeof row.background === "boolean" && derivationInteger(row.retentionDays, 1, 365)
    && derivationTime(row.expiresAt) && Date.parse(row.expiresAt) > Date.now() && Date.parse(row.expiresAt) <= Date.now() + 365 * 86400000
    && row.sourceWindow === "future-originals" && row.chargeMyAiAllowance === true && row.confirmation === "ENABLE_DERIVED_MEMORY");
  const result = frozen({ ...structuredClone(row), ...selected } as DerivationEnable);
  check(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 4096); return result;
}
function cancel(body: Pick<ReadableStream<Uint8Array>, "cancel"> | null) { try { void body?.cancel().catch(() => undefined); } catch { /* best effort */ } }
async function read(response: Response, signal?: AbortSignal): Promise<unknown> {
  check(/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "") && response.body);
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
  let reject: (reason: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, no) => { reject = no; }); void interrupted.catch(() => undefined);
  const abort = () => { cancel(reader); reject(new Error("cancelled")); };
  signal?.addEventListener("abort", abort, { once: true });
  try { check(!signal?.aborted); for (;;) { const value = await Promise.race([reader.read(), interrupted]); check(!signal?.aborted);
      if (value.done) break; bytes += value.value.byteLength; check(bytes <= 524288); text += decoder.decode(value.value, { stream: true }); }
    return JSON.parse(text + decoder.decode());
  } catch (error) { cancel(reader); throw error; }
  finally { signal?.removeEventListener("abort", abort); try { reader.releaseLock(); } catch { /* cancelled read may settle */ } }
}
export function createMemoryDerivationClient(transport: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch) {
  let epoch = 0;
  async function request<T>(method: "GET" | "PUT" | "DELETE", query: string, body: unknown, parse: (raw: unknown) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new MemoryDerivationClientError();
    const revision = ++epoch, mutation = method !== "GET"; let dispatched = false, response: Response | undefined;
    let reject: (error: Error) => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, no) => { reject = no; }); void interrupted.catch(() => undefined);
    const abort = () => reject(new Error("cancelled")); signal?.addEventListener("abort", abort, { once: true });
    try {
      dispatched = true;
      const pending = transport(PATH + query, { method, signal, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
        headers: { accept: "application/json", ...(mutation ? { "content-type": "application/json" } : {}) }, ...(mutation ? { body: JSON.stringify(body) } : {}) });
      response = await Promise.race([pending.then(value => { if (signal?.aborted) cancel(value.body); return value; }), interrupted]);
      if (response.status !== 200) { cancel(response.body); throw new MemoryDerivationClientError(mutation && (response.status < 400 || response.status >= 500), response.status); }
      const raw = await read(response, signal), value = await Promise.race([Promise.resolve(parse(raw)), interrupted]); check(revision === epoch && !signal?.aborted); return value;
    } catch (error) { if (error instanceof MemoryDerivationClientError) throw error; cancel(response?.body ?? null); throw new MemoryDerivationClientError(mutation && dispatched, response?.status ?? null); }
    finally { signal?.removeEventListener("abort", abort); }
  }
  return {
    async settings(value: DerivationScopeRequest, signal?: AbortSignal) {
      let expected: DerivationScopeRequest; try { expected = requestScope(value); } catch { throw new MemoryDerivationClientError(); }
      return request("GET", "?projectId=" + encodeURIComponent(expected.projectId) + "&documentId=" + encodeURIComponent(expected.documentId), undefined, raw => settings(raw, expected), signal);
    },
    async enable(value: DerivationEnable, signal?: AbortSignal): Promise<DerivationGrant> {
      let expected: DerivationEnable; try { expected = enable(value); } catch { throw new MemoryDerivationClientError(); }
      return request("PUT", "", expected, raw => {
        const row = own(raw, ["version", "grant", "capScope", "processingImplemented"]), result = grant(row.grant);
        check(row.version === MEMORY_DERIVATION_CONTROL && row.capScope === CAP_SCOPE && typeof row.processingImplemented === "boolean"
          && result.revision === expected.revision + 1 && result.consentId !== expected.expectedConsentId && result.revokedAt === null
          && result.enrollmentId === expected.enrollmentId && result.enrollmentRevision === expected.enrollmentRevision
          && result.purpose === expected.purpose && result.qualificationId === expected.qualificationId && result.termsSha256 === expected.termsSha256
          && result.monthlyCapMicroUsd === expected.monthlyCapMicroUsd && result.background === expected.background && result.retentionDays === expected.retentionDays
          && result.expiresAt === expected.expiresAt && Date.parse(result.expiresAt) > Date.now()
          && sameScope(result.scope, { projectId: expected.projectId, documentId: expected.documentId, custody: expected.expectedCustody })); return result;
      }, signal);
    },
    async revoke(value: DerivationGrant, signal?: AbortSignal): Promise<void> {
      let expected: DerivationGrant; try { expected = grant(value); } catch { throw new MemoryDerivationClientError(); }
      return request("DELETE", "?grantId=" + encodeURIComponent(expected.grantId), { version: MEMORY_DERIVATION_CONTROL, revision: expected.revision, consentId: expected.consentId, confirmation: "REVOKE_DERIVED_MEMORY" }, raw => {
        const row = own(raw, ["version", "revoked", "grantId", "revision", "consentId", "reEnrollmentRequired"]);
        check(row.version === MEMORY_DERIVATION_CONTROL && row.revoked === true && row.grantId === expected.grantId && row.revision === expected.revision && row.consentId === expected.consentId && row.reEnrollmentRequired === true);
      }, signal);
    },
  };
}
