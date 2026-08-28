import type { WorkerEnv } from "./runtime.ts";
import { OutputConflictError, type OutputSqlAssertion } from "./output-requirements-ledger.ts";

declare const outputGovernanceWitness: unique symbol;
/** In-memory evidence of a completed server read; it has no wire representation. */
export type OutputGovernanceWitness = Readonly<{ [outputGovernanceWitness]: true }>;
export type OutputGovernanceWitnessIdentity = {
  request: Request;
  env: WorkerEnv;
  actorUserId: string;
  ownerUserId: string;
  organizationId: string;
  projectAccessId: string;
  projectId: string;
  documentId: string;
  contextId: string;
  sourceDigest: string;
  contextSnapshotDigest: string;
};

const identities = ["actorUserId", "ownerUserId", "organizationId", "projectAccessId", "projectId", "documentId", "contextId", "sourceDigest", "contextSnapshotDigest"] as const;
type WitnessState = OutputGovernanceWitnessIdentity & { database: WorkerEnv["DB"]; assertions: OutputSqlAssertion[] };
const witnesses = new WeakMap<OutputGovernanceWitness, WitnessState>();
function invalid(): never { throw new OutputConflictError("output_source_governance_unavailable", 409); }
function validIdentity(identity: OutputGovernanceWitnessIdentity) {
  if (!(identity.request instanceof Request) || !identity.env?.DB || identities.some(key => typeof identity[key] !== "string" || !identity[key])) invalid();
}

/** Called only by the trusted Output loader AFTER its final source/head batch
 * has checked every supplied governance assertion. This does not replace that
 * check, authorize a write, or allow a caller to omit the eventual SQL guards. */
export function issueOutputGovernanceWitness(identity: OutputGovernanceWitnessIdentity, checkedAssertions: readonly OutputSqlAssertion[]): OutputGovernanceWitness {
  validIdentity(identity);
  if (!Array.isArray(checkedAssertions) || checkedAssertions.some(assertion => !assertion || typeof assertion.sql !== "string" || !assertion.sql
    || assertion.bindings !== undefined && (!Array.isArray(assertion.bindings) || assertion.bindings.some((value: unknown) => value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value)))))) invalid();
  const witness = Object.freeze(Object.create(null)) as OutputGovernanceWitness;
  witnesses.set(witness, { ...identity, database: identity.env.DB, assertions: structuredClone(checkedAssertions) as OutputSqlAssertion[] });
  return witness;
}

/** Exact request/source identity and a retained, complete proof are necessary
 * before preparation may reuse the result of the server's governance check. */
export function readOutputGovernanceWitness(witness: OutputGovernanceWitness, identity: OutputGovernanceWitnessIdentity): OutputSqlAssertion[] {
  validIdentity(identity);
  const stored = witness && typeof witness === "object" ? witnesses.get(witness) : undefined;
  if (!stored || stored.request !== identity.request || stored.env !== identity.env || stored.database !== identity.env.DB
    || identities.some(key => stored[key] !== identity[key])) invalid();
  // Proof values can contain private source bodies. Never return them over HTTP,
  // put them in a receipt, or expose references that mutate the stored witness.
  return structuredClone(stored.assertions);
}
