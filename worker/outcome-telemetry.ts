import type { OutcomeLedgerPeriod, OutcomeTelemetryLiveEvidence } from "../src/model/outcome-telemetry.ts";
import { PRINCIPAL_WITH_ACCESS_SQL, principalHasCapability } from "./access-policy.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const MAX_LEDGER_PERIODS = 1_200;
type OutcomeTelemetryReadResult = { ok: true; evidence: OutcomeTelemetryLiveEvidence } | { ok: false; code: "analytics_access_changed" | "outcome_telemetry_unavailable" };
type Guard = { sql: string; bindings: Array<string | number | null> };

/** Reuse the principal's exact existing access snapshot; this grants no new capability. */
function principalReadGuard(user: PilotUser): Guard | null {
  const snapshot = user.authorizationSnapshot;
  if (!snapshot || user.role !== "admin" || user.fictional || user.projectExecution
    || user.streamId !== `creative:${user.userId}` || user.access.identityPolicyDeniedCustody) return null;
  return {
    sql: `EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) current
      WHERE current.user_id=? AND current.role=? AND current.updated_at=?
        AND COALESCE(current.permission_epoch,'')=? AND COALESCE(current.grants_json,'[]')=?
        AND COALESCE(current.organizations_json,'[]')=? AND COALESCE(current.projects_json,'[]')=?
        AND COALESCE(current.identity_policies_json,'[]')=? AND COALESCE(current.approved_canvas_requirements,0)=?)`,
    bindings: [user.userId, user.userId, user.role, snapshot.updatedAt, snapshot.rawEpoch,
      snapshot.grants, snapshot.organizations, snapshot.projects, snapshot.identityPolicies, snapshot.canvasRequirements],
  };
}

const validMoneySql = (column: string) => `typeof(${column})='integer' AND ${column} BETWEEN 0 AND 9007199254740991`;
const numeric = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const count = (row: Record<string, unknown>, field: string) => {
  const value = numeric(row[field]);
  if (value === null) throw new Error("outcome_telemetry_invalid_count");
  return value;
};
const total = (rows: OutcomeLedgerPeriod[], field: "heldMicrousd" | "settledMicrousd") => {
  let amount = 0;
  for (const row of rows) {
    const value = row[field];
    if (value === null || !Number.isSafeInteger(amount + value)) return null;
    amount += value;
  }
  return amount;
};

/**
 * Current, content-free metadata for /api/analytics only. The caller must already
 * have passed requireUser(admin, principal). No provider, reconciliation, queue,
 * event, retention sweep or budget-counter writes are performed here.
 *
 * Finance is the actor's account across original reservation periods, including
 * their own charges in shared streams. Jobs are only the actor's currently
 * readable active/unexpired records, not all jobs in cross-user event analytics.
 */
export function prepareOutcomeTelemetryLiveEvidence(
  env: WorkerEnv,
  user: PilotUser,
  now = Date.now(),
): { statements: D1PreparedStatement[]; finish: (rows: D1Result<Record<string, unknown>>[]) => Promise<OutcomeTelemetryReadResult> } | null {
  const guard = principalReadGuard(user);
  if (!guard || !Number.isFinite(now)) return null;
  const asOf = new Date(now).toISOString();
  const projects = user.access.projects.filter((project) => principalHasCapability(user.access, "project.read", project)).map((project) => ({
    projectAccessId: project.projectAccessId, organizationId: project.organizationId, projectId: project.projectId,
    outputRead: principalHasCapability(user.access, "project.output.request", project),
    canvasRead: principalHasCapability(user.access, "project.canvas.use", project),
  }));
  // JSON values here are server-issued capabilities, never caller-supplied scope.
  const projectJson = JSON.stringify(projects);
  const requestObject = "CASE WHEN json_valid(job.request_json) THEN json_type(job.request_json)='object' ELSE 0 END";
  const request = "CASE WHEN json_valid(job.request_json) THEN job.request_json ELSE '{}' END";
  const result = "CASE WHEN json_valid(job.result_json) THEN job.result_json ELSE '{}' END";
  const personal = `(
    job.stream_id=?
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes custody WHERE
      (custody.resource_kind='job' AND custody.resource_id=job.job_id)
      OR (custody.resource_kind='document' AND custody.resource_id=job.document_id))
    AND EXISTS(SELECT 1 FROM events created
      WHERE created.stream_id=job.stream_id AND created.type IN('DocumentCreated','DocumentForked')
        AND json_extract(created.payload,'$.document_id')=job.document_id
        AND json_type(created.payload,'$.project_id')='text' AND json_extract(created.payload,'$.project_id')!='')
    AND NOT EXISTS(SELECT 1 FROM events created JOIN organization_projects governed
      ON governed.owner_user_id=job.owner_id AND governed.project_id=json_extract(created.payload,'$.project_id')
      WHERE created.stream_id=job.stream_id AND created.type IN('DocumentCreated','DocumentForked')
        AND json_extract(created.payload,'$.document_id')=job.document_id)
    AND (?=1 OR job.kind!='structure_adaptive' OR COALESCE(json_extract(${request},'$.canvasId'),'')='')
  )`;
  const shared = `EXISTS(
    SELECT 1 FROM json_each(?) permitted
      JOIN organization_projects project ON project.project_access_id=json_extract(permitted.value,'$.projectAccessId')
        AND project.organization_id=json_extract(permitted.value,'$.organizationId')
        AND project.project_id=json_extract(permitted.value,'$.projectId') AND project.status='active'
      JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id
        AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status='active'
      JOIN project_resource_scopes resource ON resource.resource_kind='job' AND resource.resource_id=job.job_id
        AND resource.project_access_id=project.project_access_id AND resource.organization_id=project.organization_id
        AND resource.project_id=project.project_id AND resource.owner_user_id=project.owner_user_id
        AND resource.actor_user_id=job.owner_id AND resource.visibility='actor_private'
      JOIN project_resource_scopes document ON document.resource_kind='document' AND document.resource_id=job.document_id
        AND document.project_access_id=resource.project_access_id AND document.organization_id=resource.organization_id
        AND document.project_id=resource.project_id AND document.owner_user_id=resource.owner_user_id
      JOIN events anchor ON anchor.event_id=resource.source_event_id AND anchor.stream_id=job.stream_id
        AND anchor.type='ProjectDocumentJobQueued' AND anchor.actor='user:'||resource.actor_user_id
        AND json_extract(anchor.payload,'$.job_id')=job.job_id AND json_extract(anchor.payload,'$.document_id')=job.document_id
        AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id
        AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id
        AND json_extract(anchor.payload,'$.project_id')=resource.project_id
        AND json_extract(anchor.payload,'$.history_owner_user_id')=resource.owner_user_id
        AND json_extract(anchor.payload,'$.actor_user_id')=resource.actor_user_id
    WHERE job.stream_id='creative:'||project.owner_user_id
      AND (json_extract(permitted.value,'$.outputRead')=1 OR job.kind='structure_adaptive'
        AND json_extract(${request},'$.adaptiveConsentVersion')=1)
      AND (job.kind!='structure_adaptive' OR COALESCE(json_extract(${request},'$.canvasId'),'')=''
        OR json_extract(permitted.value,'$.canvasRead')=1)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes ambiguous WHERE ambiguous.resource_kind='job'
        AND ambiguous.resource_id=job.job_id AND (ambiguous.project_access_id!=resource.project_access_id
          OR ambiguous.organization_id!=resource.organization_id OR ambiguous.project_id!=resource.project_id
          OR ambiguous.owner_user_id!=resource.owner_user_id OR ambiguous.actor_user_id!=resource.actor_user_id))
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes ambiguous_document WHERE ambiguous_document.resource_kind='document'
        AND ambiguous_document.resource_id=job.document_id AND (ambiguous_document.project_access_id!=document.project_access_id
          OR ambiguous_document.organization_id!=document.organization_id OR ambiguous_document.project_id!=document.project_id
          OR ambiguous_document.owner_user_id!=document.owner_user_id))
  )`;
  const statements = [
      env.DB.prepare(`SELECT 1 AS authorized WHERE ${guard.sql}`).bind(...guard.bindings),
      env.DB.prepare(`SELECT period,COUNT(*) AS reservation_count,
        SUM(status='active') AS active_count,SUM(status='executing') AS executing_count,
        SUM(status='settled') AS settled_count,SUM(status='released') AS released_count,
        SUM(status NOT IN('active','executing','settled','released')) AS unclassified_count,
        SUM(CASE WHEN (${validMoneySql("reserved_microusd")}) AND (${validMoneySql("used_microusd")}) THEN 0 ELSE 1 END) AS invalid_amount_count,
        TOTAL(CASE WHEN status IN('active','executing') THEN reserved_microusd ELSE 0 END) AS held_microusd,
        TOTAL(CASE WHEN status='settled' THEN used_microusd ELSE 0 END) AS settled_microusd
        FROM cost_budget_reservations WHERE owner_id=? AND ${guard.sql}
        GROUP BY period ORDER BY period LIMIT ?`).bind(user.userId, ...guard.bindings, MAX_LEDGER_PERIODS + 1),
      env.DB.prepare(`WITH visible AS (
        SELECT job.status,
          CASE WHEN job.expires_at>? AND json_valid(job.result_json)
            THEN CASE WHEN json_type(${result})='object' THEN 1 ELSE 0 END ELSE 0 END AS checkpoint_retained,
          CASE WHEN job.expires_at>? AND json_type(${result},'$.resultUnavailable')='true' THEN 1 ELSE 0 END AS explicitly_unavailable
        FROM document_jobs job WHERE job.owner_id=? AND (${requestObject})
          AND (job.status IN('queued','running','committing') OR job.expires_at>?)
          AND (${personal} OR ${shared}) AND ${guard.sql}
      ) SELECT COUNT(*) AS total,
        COALESCE(SUM(status='queued'),0) AS queued,COALESCE(SUM(status='running'),0) AS running,
        COALESCE(SUM(status='committing'),0) AS committing,COALESCE(SUM(status='completed'),0) AS completed,
        COALESCE(SUM(status='partial'),0) AS partial,COALESCE(SUM(status='failed'),0) AS failed,
        COALESCE(SUM(status='canceled'),0) AS canceled,
        COALESCE(SUM(status NOT IN('queued','running','committing','completed','partial','failed','canceled')),0) AS unclassified,
        COALESCE(SUM(status='completed' AND explicitly_unavailable=1),0) AS completed_unavailable,
        COALESCE(SUM(checkpoint_retained),0) AS retained_checkpoints
      FROM visible`).bind(asOf, asOf, user.userId, asOf, user.streamId, Number(user.access.canvasAccess), projectJson, ...guard.bindings),
  ];
  return { statements, async finish(rows) {
    try {
    if (rows.some((row) => row.success === false)) return { ok: false, code: "outcome_telemetry_unavailable" };
    // A revocation while the snapshot was returning must not release its metadata.
    if (rows[0]?.results[0]?.authorized !== 1
      || !await env.DB.prepare(`SELECT 1 AS authorized WHERE ${guard.sql}`).bind(...guard.bindings).first()) {
      return { ok: false, code: "analytics_access_changed" };
    }
    const periodRows = rows[1]?.results, jobs = rows[2]?.results[0];
    if (!periodRows || !jobs) return { ok: false, code: "outcome_telemetry_unavailable" };
    const truncated = periodRows.length > MAX_LEDGER_PERIODS;
    const periods: OutcomeLedgerPeriod[] = periodRows.slice(0, MAX_LEDGER_PERIODS).map((row) => {
      const invalidAmountCount = count(row, "invalid_amount_count"), unclassifiedCount = count(row, "unclassified_count");
      if (typeof row.period !== "string" || !row.period) throw new Error("outcome_telemetry_invalid_period");
      return {
        period: row.period, reservationCount: count(row, "reservation_count"), activeCount: count(row, "active_count"),
        executingCount: count(row, "executing_count"), settledCount: count(row, "settled_count"), releasedCount: count(row, "released_count"),
        unclassifiedCount, invalidAmountCount,
        heldMicrousd: invalidAmountCount || unclassifiedCount ? null : numeric(row.held_microusd),
        settledMicrousd: invalidAmountCount || unclassifiedCount ? null : numeric(row.settled_microusd),
      };
    });
    const completed = count(jobs, "completed"), unavailable = count(jobs, "completed_unavailable");
    const totalJobs = count(jobs, "total"), retained = count(jobs, "retained_checkpoints");
    if (unavailable > completed || retained > totalJobs) return { ok: false, code: "outcome_telemetry_unavailable" };
    return {
      ok: true,
      evidence: {
        asOf,
        finance: {
          scope: "actor-account", window: "all-reservation-periods", currency: "USD", source: "cost_budget_reservations",
          periods, truncated, heldMicrousd: truncated ? null : total(periods, "heldMicrousd"),
          settledMicrousd: truncated ? null : total(periods, "settledMicrousd"), providerInvoiceReconciled: null,
        },
        jobs: {
          scope: "actor-owned-currently-readable-jobs", window: "active-or-unexpired", source: "document_jobs",
          total: totalJobs, queued: count(jobs, "queued"), running: count(jobs, "running"), committing: count(jobs, "committing"),
          completed, partial: count(jobs, "partial"), failed: count(jobs, "failed"), canceled: count(jobs, "canceled"),
          unclassified: count(jobs, "unclassified"), completedExplicitlyUnavailable: unavailable,
          completedAvailabilityUnknown: completed - unavailable,
          retainedCheckpointCount: retained, missingOrInvalidCheckpointCount: totalJobs - retained,
          usableResultCount: null, mediaAvailability: "not-checked",
        },
      },
    };
    } catch {
      return { ok: false, code: "outcome_telemetry_unavailable" };
    }
  } };
}

/** Standalone callers retain the same snapshot plus separate final-access proof. */
export async function readOutcomeTelemetryLiveEvidence(
  env: WorkerEnv,
  user: PilotUser,
  now = Date.now(),
): Promise<OutcomeTelemetryReadResult> {
  try {
    const read = prepareOutcomeTelemetryLiveEvidence(env, user, now);
    if (!read) return { ok: false, code: "analytics_access_changed" };
    return await read.finish(await env.DB.batch<Record<string, unknown>>(read.statements));
  } catch {
    return { ok: false, code: "outcome_telemetry_unavailable" };
  }
}
