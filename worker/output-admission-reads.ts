import type { WorkerEnv } from "./runtime.ts";
import { readOutputGovernanceWitness, type OutputGovernanceWitness, type OutputGovernanceWitnessIdentity } from "./output-governance-witness.ts";
import type { OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { sponsorAdmissionPayer, type SponsorAdmissionAuthority } from "./experience-sponsor-admission.ts";

declare const outputAdmissionReads: unique symbol;
/** Server-only preparation data, valid for one incoming authorization request. */
export type OutputAdmissionReads = Readonly<{ [outputAdmissionReads]: true }>;
export type OutputAdmissionReadKey =
  | "principal" | "project-selection" | "project-execution" | "source-events"
  | "governed-source-rights" | "budget-scopes" | "project-retention"
  | "pilot-allowance" | "sponsor-actor-pilot-allowance" | "pilot-source-classification" | "pilot-budget-counters"
  | "account-budgets" | "cost-budgets" | "token-budgets"
  | "previous-image-preflight" | "provider-health" | "source-head"
  | "project-budget-policy" | "budget-counter-initialization" | "private-retention-policy";

type AdmissionIdentity = {
  request: Request;
  env: WorkerEnv;
  documentId: string;
  actorUserId: string;
  billingUserId: string;
  sponsorAdmission?: SponsorAdmissionAuthority;
  organizationId: string | null;
  projectAccessId: string | null;
};
export type OutputAdmissionGovernance = {
  witness: OutputGovernanceWitness;
  source: Pick<OutputGovernanceWitnessIdentity, "ownerUserId" | "projectId" | "contextId" | "sourceDigest" | "contextSnapshotDigest">;
};
type AdmissionState = AdmissionIdentity & { database: WorkerEnv["DB"]; period: string; reads: Map<OutputAdmissionReadKey, Promise<unknown>>; governanceAssertions: OutputSqlAssertion[] };
const states = new WeakMap<OutputAdmissionReads, AdmissionState>();

export function createOutputAdmissionReads(identity: AdmissionIdentity, governance?: OutputAdmissionGovernance): OutputAdmissionReads {
  if (!identity.documentId || !identity.actorUserId || !identity.billingUserId
    || Boolean(identity.organizationId) !== Boolean(identity.projectAccessId)) throw new Error("output_admission_read_scope_required");
  const sponsor = identity.sponsorAdmission ? sponsorAdmissionPayer(identity.sponsorAdmission, identity) : null;
  if (sponsor && (identity.organizationId || identity.projectAccessId || identity.billingUserId !== identity.actorUserId))
    throw new Error("sponsor_personal_principal_required");
  if (sponsor && !sponsor.assertions.length) throw new Error("sponsor_authority_assertions_required");
  const scope = Object.freeze({}) as OutputAdmissionReads;
  const state: AdmissionState = { ...identity, billingUserId: sponsor?.payerUserId ?? identity.billingUserId, database: identity.env.DB, period: new Date().toISOString().slice(0, 7), reads: new Map(), governanceAssertions: [] };
  if (governance) {
    state.governanceAssertions = readOutputGovernanceWitness(governance.witness, {
      request: identity.request, env: identity.env, actorUserId: identity.actorUserId, documentId: identity.documentId,
      organizationId: identity.organizationId ?? "", projectAccessId: identity.projectAccessId ?? "",
      ownerUserId: governance.source?.ownerUserId ?? "", projectId: governance.source?.projectId ?? "", contextId: governance.source?.contextId ?? "",
      sourceDigest: governance.source?.sourceDigest ?? "", contextSnapshotDigest: governance.source?.contextSnapshotDigest ?? "",
    });
    // The API already checked the stronger complete package/origin proof. Only
    // that non-serializable exact-source witness can replace this one read.
    state.reads.set("governed-source-rights", Promise.resolve(true));
  }
  states.set(scope, state);
  return scope;
}

function stateFor(scope: OutputAdmissionReads): AdmissionState {
  const state = states.get(scope);
  if (!state) throw new Error("output_admission_read_scope_invalid");
  if (state.database !== state.env.DB) throw new Error("output_admission_read_scope_mismatch");
  if (state.sponsorAdmission && sponsorAdmissionPayer(state.sponsorAdmission, state).payerUserId !== state.billingUserId)
    throw new Error("output_admission_read_scope_mismatch");
  return state;
}

/** Financial identity comes only from the sealed admission. It never changes the
 * creative principal used for source rights, job ownership or private storage. */
export function outputAdmissionBudgetOwner(scope: OutputAdmissionReads | undefined, env: WorkerEnv, actorUserId: string, ordinaryPayerUserId: string) {
  if (!scope) return ordinaryPayerUserId;
  const state = stateFor(scope);
  if (state.env !== env || state.actorUserId !== actorUserId
    || (state.sponsorAdmission ? ordinaryPayerUserId !== actorUserId : state.billingUserId !== ordinaryPayerUserId))
    throw new Error("output_admission_read_scope_mismatch");
  return state.billingUserId;
}

export function outputAdmissionSponsor(scope: OutputAdmissionReads | undefined) {
  if (!scope) return null;
  const state = stateFor(scope);
  return state.sponsorAdmission ? sponsorAdmissionPayer(state.sponsorAdmission, state) : null;
}

/** Check once before audit events, in the same grant/job/reservation transaction. */
export function outputAdmissionGovernanceAssertions(scope: OutputAdmissionReads): OutputSqlAssertion[] {
  return structuredClone(stateFor(scope).governanceAssertions);
}

export function assertOutputAdmissionRequest(scope: OutputAdmissionReads | undefined, request: Request, env: WorkerEnv, documentId: string) {
  if (!scope) return;
  const state = stateFor(scope);
  if (state.request !== request || state.env !== env || state.documentId !== documentId) throw new Error("output_admission_read_scope_mismatch");
}

export function assertOutputAdmissionActor(scope: OutputAdmissionReads | undefined, env: WorkerEnv, actorUserId: string, organizationId: string | null, projectAccessId: string | null, documentId?: string) {
  if (!scope) return;
  const state = stateFor(scope);
  if (state.env !== env || state.actorUserId !== actorUserId || state.organizationId !== organizationId || state.projectAccessId !== projectAccessId || documentId !== undefined && state.documentId !== documentId) throw new Error("output_admission_read_scope_mismatch");
}

export function assertOutputAdmissionBudget(scope: OutputAdmissionReads | undefined, env: WorkerEnv, userId: string, period: string, project?: { organizationId: string; projectAccessId: string; actorUserId: string }) {
  if (!scope) return;
  const state = stateFor(scope);
  if (state.env !== env || state.billingUserId !== userId || state.period !== period
    || state.organizationId !== (project?.organizationId ?? null) || state.projectAccessId !== (project?.projectAccessId ?? null)
    || project && project.actorUserId !== state.actorUserId) throw new Error("output_admission_read_scope_mismatch");
}

/** Explicit preparation reads only. No SQL interception, runtime permission cache,
 * transaction guard, provider call, job insert or reservation is memoized here. */
export function readOutputAdmissionValue<T>(scope: OutputAdmissionReads | undefined, key: OutputAdmissionReadKey, read: () => Promise<T>): Promise<T> {
  if (!scope) return read();
  const state = stateFor(scope);
  const previous = state.reads.get(key);
  if (previous) return previous as Promise<T>;
  const pending = read();
  state.reads.set(key, pending);
  return pending;
}
