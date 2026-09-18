import { memoryCanonical, type MemorySqlGuard } from "./memory-sql.ts";
import { liveMemoryAuthority, liveMemoryEnrollmentGuard, type LiveMemoryAuthority, type LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { DERIVATION_JOB_COLUMNS, DERIVATION_JOB_SOURCE_COLUMNS } from "./memory-derivation-job-schema.ts";
import { DERIVATION_GRANT_COLUMNS, derivationAssertion, derivationChanged, derivationResults, derivationVerified,
  derivationRowGuard, derivationQualificationGuard, memoryDerivationBinding, memoryDerivationEnabled, memoryDerivationSchema,
  memoryDerivationGrantShape, readDerivationQualification, type MemoryDerivationGrant } from "./memory-derivation-store.ts";
import { derivationConsentId, derivationExact, derivationHash, derivationId, derivationInteger, derivationTime } from "./memory-derivation-policy.ts";
import { nativeMemoryGrantDeadline, nativeMemoryPilotDeadline, nativeMemoryPilotQuery } from "./memory-native-deadlines.ts";
import type { WorkerEnv } from "./runtime.ts";

export const DERIVATION_PARENT_COLUMNS = ["enrollment_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id", "project_id", "document_id",
  "permission_epoch", "policy_version", "revision", "learn_enabled", "recall_enabled", "background_enabled", "retention_days", "time_zone",
  "enrolled_at", "expires_at", "cursor_sequence", "cutoff_sequence", "last_local_day", "last_admitted_at", "next_due_at", "lease_token", "lease_expires_at", "attempts", "failure_code"] as const;
type Row = Record<string, unknown>;
type NativeJob = { job_id: string; consent_id: string; purpose: MemoryDerivationGrant["purpose"]; after_sequence: number; through_sequence: number;
  source_count: number; created_at: string; expires_at: string; state: "waiting" | "leased"; lease_token: string | null;
  lease_expires_at: string | null; attempts: number; not_before: string; failure_code: string | null };
type Reference = { job_id: string; enrollment_id: string; event_id: string; sequence: number; expires_at: string };
type Qualification = NonNullable<Awaited<ReturnType<typeof readDerivationQualification>>>;
/** Process-local issuance, not a serializable job DTO or provider permission. */
declare const issuedLease: unique symbol;
export type NativeDerivationLease = Readonly<{ [issuedLease]: true }>;
type Admission = { env: WorkerEnv; db: WorkerEnv["DB"]; configuration: string; until: string;
  job: NativeJob; enrollment: LiveMemoryEnrollment; grant: MemoryDerivationGrant; qualification: Qualification;
  authority: LiveMemoryAuthority; references: Reference[]; guards: MemorySqlGuard[] };
const issued = new WeakMap<NativeDerivationLease, Admission>();
const configuration = (env: WorkerEnv) => memoryCanonical([env.FORMA_MEMORY_ENABLED, env.FORMA_MEMORY_USER_IDS,
  env.FORMA_MEMORY_DERIVATION_ENABLED, env.FORMA_MEMORY_DERIVATION_USER_IDS, memoryDerivationBinding(env),
  env.FORMA_PILOT_COHORT_ID, env.FORMA_ADMIN_EMAILS]);
const fail = (): never => { throw new Error("memory-derivation-admission-unavailable"); };
const current = (admission: Admission, env: WorkerEnv) => admission.env === env && env.DB === admission.db
  && configuration(env) === admission.configuration && memoryDerivationEnabled(env, admission.grant.actor_user_id)
  && admission.until > new Date().toISOString();
const jobGuard = (job: NativeJob): MemorySqlGuard => ({
  condition: `(SELECT json_group_array(json_array(${DERIVATION_JOB_COLUMNS.join(",")})) FROM memory_derivation_jobs WHERE job_id=?)=?`,
  bindings: [job.job_id, JSON.stringify([DERIVATION_JOB_COLUMNS.map(key => job[key])])],
});
const referenceGuard = (jobId: string, references: Reference[]): MemorySqlGuard => ({
  condition: `(SELECT json_group_array(json_array(${DERIVATION_JOB_SOURCE_COLUMNS.join(",")})) FROM
    (SELECT ${DERIVATION_JOB_SOURCE_COLUMNS.join(",")} FROM memory_derivation_job_sources WHERE job_id=? ORDER BY sequence,event_id))=?
    AND NOT EXISTS(SELECT 1 FROM memory_derivation_job_sources reference LEFT JOIN memory_live_sources remembered
      ON (remembered.enrollment_id,remembered.event_id,remembered.sequence,remembered.expires_at)=
        (reference.enrollment_id,reference.event_id,reference.sequence,reference.expires_at)
      WHERE reference.job_id=? AND (remembered.event_id IS NULL OR remembered.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  bindings: [jobId, JSON.stringify(references.map(row => DERIVATION_JOB_SOURCE_COLUMNS.map(key => row[key]))), jobId],
});
function jobShape(row: unknown): row is NativeJob {
  return derivationExact(row, DERIVATION_JOB_COLUMNS) && derivationHash(row.job_id) && derivationConsentId(row.consent_id)
    && ["rolling-summary", "profile", "suggestion"].includes(String(row.purpose)) && derivationInteger(row.after_sequence)
    && derivationInteger(row.through_sequence, Number(row.after_sequence) + 1) && derivationInteger(row.source_count, 1, 128)
    && derivationInteger(row.attempts, 0, Number.MAX_SAFE_INTEGER - 1) && derivationTime(row.created_at) && derivationTime(row.expires_at)
    && derivationTime(row.not_before) && row.created_at < row.expires_at && row.not_before >= row.created_at
    && (row.failure_code === null || ["native-proof-unavailable", "provider-unavailable", "interrupted", "budget-unavailable"].includes(String(row.failure_code)))
    && (row.state === "waiting" && row.lease_token === null && row.lease_expires_at === null
      || row.state === "leased" && derivationConsentId(row.lease_token) && derivationTime(row.lease_expires_at) && row.lease_expires_at <= row.expires_at);
}
function referencesShape(rows: unknown[], job: NativeJob, grant: MemoryDerivationGrant): rows is Reference[] {
  return rows.length === job.source_count && rows.every(row => derivationExact(row, DERIVATION_JOB_SOURCE_COLUMNS)
    && row.job_id === job.job_id && row.enrollment_id === grant.enrollment_id && derivationId(row.event_id)
    && derivationInteger(row.sequence, Math.max(job.after_sequence, grant.source_after_sequence) + 1, job.through_sequence)
    && derivationTime(row.expires_at) && row.expires_at >= job.expires_at)
    && new Set(rows.map(row => (row as Reference).event_id)).size === rows.length
    && rows.every((row, index) => index === 0 || (rows[index - 1] as Reference).sequence < (row as Reference).sequence);
}

/** Claim exactly one queued reference job under native access and purpose proof.
 * No raw source text is loaded and no provider/budget is admitted. A lost ACK
 * leaves the original lease held; neither an expired lease nor a copied DTO is
 * authority to resubmit. Financial recovery must later prove non-submission.
 */
export async function claimNativeDerivationJob(env: WorkerEnv, jobId: string): Promise<NativeDerivationLease | null> {
  if (!derivationHash(jobId)) return null;
  const db = env.DB, configured = configuration(env), started = Date.now(), schema = await memoryDerivationSchema(env);
  if (!schema.jobsPresent || env.DB !== db || configured !== configuration(env)) return null;
  const read = async (sql: string, bindings: (string | number | null)[]) => {
    const result = structuredClone(await db.prepare(sql).bind(...bindings).all<Row>());
    if (env.DB !== db || configured !== configuration(env) || !derivationResults([result], 1)) fail();
    return result.results;
  };
  const jobs = await read(`SELECT ${DERIVATION_JOB_COLUMNS.join(",")} FROM memory_derivation_jobs WHERE job_id=? LIMIT 2`, [jobId]);
  if (jobs.length !== 1 || !jobShape(jobs[0])) return null;
  const job = jobs[0], now = new Date().toISOString();
  if (job.state !== "waiting" || job.expires_at <= now || job.not_before > now) return null;
  const grants = await read(`SELECT ${DERIVATION_GRANT_COLUMNS.join(",")} FROM memory_derivation_grants WHERE consent_id=? LIMIT 2`, [job.consent_id]);
  if (grants.length !== 1 || !memoryDerivationGrantShape(grants[0])) return null;
  const grant = grants[0];
  if (!memoryDerivationEnabled(env, grant.actor_user_id) || grant.revoked_at !== null || grant.background_enabled !== 1
    || grant.purpose !== job.purpose || job.after_sequence < grant.source_after_sequence || grant.expires_at < job.expires_at
    || grant.consented_at > job.created_at) return null;
  const parents = await read(`SELECT ${DERIVATION_PARENT_COLUMNS.join(",")} FROM memory_live_enrollments WHERE enrollment_id=? LIMIT 2`, [grant.enrollment_id]);
  if (parents.length !== 1 || !derivationExact(parents[0], DERIVATION_PARENT_COLUMNS)) return null;
  const e = parents[0] as unknown as LiveMemoryEnrollment;
  if (e.revision !== grant.enrollment_revision || e.actor_user_id !== grant.actor_user_id || e.owner_user_id !== grant.owner_user_id
    || e.organization_id !== grant.organization_id || e.project_access_id !== grant.project_access_id || e.project_id !== grant.project_id
    || e.document_id !== grant.document_id || e.permission_epoch !== grant.permission_epoch || e.learn_enabled !== 1 || e.background_enabled !== 1
    || !derivationInteger(e.retention_days, grant.retention_days, 365) || !derivationTime(e.enrolled_at) || !derivationTime(e.expires_at)
    || e.enrolled_at > grant.consented_at || e.expires_at < grant.expires_at) return null;
  const qualification = await readDerivationQualification(env, grant.qualification_id);
  if (!qualification || qualification.row.terms_sha256 !== grant.terms_sha256 || qualification.terms.purpose !== grant.purpose
    || qualification.terms.monthlyCapMicroUsd !== grant.monthly_cap_microusd) return null;
  const authority = await liveMemoryAuthority(env, e);
  if (!authority) return null;
  const authorityAt = Date.now(), grantDeadline = nativeMemoryGrantDeadline(authority.principal, authorityAt);
  if (grantDeadline === undefined) return null;
  const nativeDeadlines = grantDeadline === null ? [] : [grantDeadline], nativeGuards: MemorySqlGuard[] = [];
  const pilot = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
  const breakglass = (env.FORMA_ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).includes(authority.principal.email.toLowerCase());
  if (pilot && !breakglass) {
    const query = nativeMemoryPilotQuery(pilot), rows = await read(query.sql, query.bindings);
    const boundary = nativeMemoryPilotDeadline(rows, pilot, authorityAt);
    if (boundary === undefined) return null;
    if (boundary !== null) nativeDeadlines.push(boundary);
    const columns = ["cohort_id", "organization_id", "status", "starts_at", "ends_at"];
    nativeGuards.push({ condition: `(SELECT json_group_array(json_array(${columns.join(",")})) FROM (${query.sql}))=?`,
      bindings: [...query.bindings, JSON.stringify(rows.map(row => columns.map(key => row[key])))] });
  }
  const references = await read(`SELECT ${DERIVATION_JOB_SOURCE_COLUMNS.join(",")} FROM memory_derivation_job_sources WHERE job_id=? ORDER BY sequence,event_id LIMIT 129`, [jobId]);
  if (!referencesShape(references, job, grant)) return null;
  const leaseExpires = [new Date(started + 300_000).toISOString(), job.expires_at, grant.expires_at, e.expires_at, qualification.row.expires_at].sort()[0]!;
  const until = [new Date(started + 60_000).toISOString(), leaseExpires, ...nativeDeadlines].sort()[0]!;
  const next: NativeJob = { ...job, state: "leased", lease_token: crypto.randomUUID(), lease_expires_at: leaseExpires, attempts: job.attempts + 1 };
  const common = [schema.guard, { condition: "EXISTS(SELECT 1 FROM pragma_foreign_keys WHERE foreign_keys=1) AND EXISTS(SELECT 1 FROM pragma_ignore_check_constraints WHERE ignore_check_constraints=0)", bindings: [] },
    authority.guard, ...nativeGuards, liveMemoryEnrollmentGuard(e, "learn"),
    derivationRowGuard("memory_live_enrollments", DERIVATION_PARENT_COLUMNS, e),
    derivationRowGuard("memory_derivation_grants", DERIVATION_GRANT_COLUMNS, grant), derivationQualificationGuard(qualification.row),
    referenceGuard(jobId, references), { condition: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [until] }];
  const admission: Admission = { env, db, configuration: configured, until, job: next, enrollment: e, grant, qualification, authority, references,
    guards: [...common, jobGuard(next)] };
  if (!current(admission, env)) return null;
  const statements = [...common, jobGuard(job)].map(guard => derivationAssertion(env, guard));
  const mutationIndex = statements.length;
  statements.push(db.prepare(`UPDATE memory_derivation_jobs SET state='leased',lease_token=?,lease_expires_at=?,attempts=attempts+1
    WHERE job_id=? AND state='waiting' AND attempts=? AND not_before<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(next.lease_token, next.lease_expires_at, jobId, job.attempts),
  derivationAssertion(env, { condition: "changes()=1", bindings: [] }), ...admission.guards.map(guard => derivationAssertion(env, guard)));
  const result = structuredClone(await db.batch<Row>(statements));
  if (!current(admission, env) || !derivationResults(result, statements.length) || !derivationChanged(result[mutationIndex]!, 1)
    || !result.every((row, index) => index === mutationIndex || derivationVerified(row))) throw new Error("memory-derivation-claim-unconfirmed");
  const handle = Object.freeze({}) as NativeDerivationLease; issued.set(handle, admission); return handle;
}

function lookup(env: WorkerEnv, handle: NativeDerivationLease): Admission {
  const admission = issued.get(handle);
  if (!admission || !current(admission, env)) return fail();
  return admission;
}
/** Snapshot data is not authority; consumers must retain and replay the issued
 * handle, then include all final statements with their writes in one batch. */
export function nativeDerivationLeaseInputs(env: WorkerEnv, handle: NativeDerivationLease) {
  const a = lookup(env, handle);
  return structuredClone({ job: a.job, enrollment: a.enrollment, grant: a.grant, qualification: a.qualification,
    authority: a.authority, references: a.references, validUntil: a.until });
}
export function nativeDerivationLeaseStatements(env: WorkerEnv, handle: NativeDerivationLease): D1PreparedStatement[] {
  return lookup(env, handle).guards.map(guard => derivationAssertion(env, guard));
}
export async function replayNativeDerivationLease(env: WorkerEnv, handle: NativeDerivationLease): Promise<boolean> {
  try {
    const a = lookup(env, handle), statements = nativeDerivationLeaseStatements(env, handle), result = structuredClone(await a.db.batch<Row>(statements));
    return current(a, env) && derivationResults(result, statements.length) && result.every(derivationVerified);
  } catch { return false; }
}
