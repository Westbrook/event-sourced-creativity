import type { WorkerEnv } from "./runtime.ts";
import { outputAssetStorageCustodyMatches } from "./output-asset-storage-identity.ts";

type Row = Record<string, unknown>;
const tableNames = ["output_commands", "output_plan_revisions", "output_plan_targets", "output_preflights", "output_execution_grants", "output_operation_slots", "output_operation_routes", "output_provider_calls", "output_native_storage_writes", "output_asset_storage_writes", "output_assets", "output_results", "output_target_acceptances", "output_plan_fulfillments", "output_delivery_manifests"] as const;

/** Old installations have no Output ledger; an interrupted partial installation must fail closed. */
async function available(env: WorkerEnv) {
  const rows = await env.DB.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name IN(${tableNames.map(() => "?").join(",")})`).bind(...tableNames).all<{ name: string }>();
  if (!rows.results.length) return false;
  if (rows.results.length !== tableNames.length) throw new Error("output_requirements_schema_incomplete");
  return true;
}

const scopedEvent = (eventId: string) => `EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=${eventId} AND custody.organization_id=?)`;
const organizationPlans = `SELECT plan.scope_key,plan.plan_revision_id FROM output_plan_revisions plan WHERE ${scopedEvent("plan.confirmed_event_id")}`;
const organizationSlots = `SELECT slot.scope_key,slot.slot_id FROM output_operation_slots slot JOIN output_execution_grants grant_row
  ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id WHERE ${scopedEvent("grant_row.authorization_event_id")}`;
const personalScopes = `SELECT DISTINCT plan.scope_key FROM output_plan_revisions plan
  WHERE plan.owner_user_id=? AND plan.scope_kind='personal' AND plan.organization_id IS NULL AND plan.project_access_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=plan.confirmed_event_id)
    AND NOT EXISTS(SELECT 1 FROM organization_projects custody WHERE custody.owner_user_id=plan.owner_user_id
      AND custody.project_id=plan.project_id AND custody.status='active')`;
const unsettledStorageRow = (row: string) => `${row}.status IN('writing','cleanup_pending') OR ${row}.write_acknowledged<>1
  OR ${row}.status='written' AND ${row}.publication_event_id IS NULL`;
const unsettledStorage = (slot: string) => `EXISTS(SELECT 1 FROM output_native_storage_writes stored
  WHERE stored.scope_key=${slot}.scope_key AND stored.slot_id=${slot}.slot_id
    AND(${unsettledStorageRow("stored")}))`;
const personalAssetWrites = `owner_user_id=? AND organization_id IS NULL AND project_access_id IS NULL AND context_id IS NULL`;

const recoveryQueries = [
  ["outputCommands", `SELECT row.* FROM output_commands row WHERE ${scopedEvent("row.event_id")}`],
  ["outputPlans", `SELECT row.* FROM output_plan_revisions row WHERE ${scopedEvent("row.confirmed_event_id")}`],
  ["outputTargets", `SELECT row.* FROM output_plan_targets row WHERE (row.scope_key,row.plan_revision_id) IN(${organizationPlans})`],
  ["outputPreflights", `SELECT row.* FROM output_preflights row WHERE ${scopedEvent("row.event_id")}`],
  ["outputGrants", `SELECT row.* FROM output_execution_grants row WHERE ${scopedEvent("row.authorization_event_id")}`],
  ["outputSlots", `SELECT row.* FROM output_operation_slots row WHERE (row.scope_key,row.slot_id) IN(${organizationSlots})`],
  ["outputRoutes", `SELECT row.* FROM output_operation_routes row WHERE (row.scope_key,row.slot_id) IN(${organizationSlots})`],
  ["outputCalls", `SELECT row.* FROM output_provider_calls row WHERE (row.scope_key,row.slot_id) IN(${organizationSlots})`],
  ["outputStorageWrites", `SELECT row.* FROM output_native_storage_writes row WHERE (row.scope_key,row.slot_id) IN(${organizationSlots})`],
  ["outputAssetStorageWrites", `SELECT row.* FROM output_asset_storage_writes row WHERE row.organization_id=?`],
  ["outputAssets", `SELECT row.* FROM output_assets row WHERE row.redacted_at IS NULL AND ${scopedEvent("row.created_event_id")}`],
  ["outputResults", `SELECT row.* FROM output_results row WHERE ${scopedEvent("row.bound_event_id")}`],
  ["outputAcceptances", `SELECT row.* FROM output_target_acceptances row WHERE ${scopedEvent("row.approval_event_id")}`],
  ["outputFulfillments", `SELECT row.* FROM output_plan_fulfillments row WHERE ${scopedEvent("row.eligibility_event_id")}`],
  ["outputDeliveries", `SELECT row.* FROM output_delivery_manifests row WHERE ${scopedEvent("row.event_id")}`],
] as const;

/** Snapshot rows are historical evidence, never restored permission to submit another provider call. */
export function inertOutputRecoveryRecord(kind: string, row: Row): Row {
  if (kind === "outputPreflights") return { ...row, historical_expires_at: row.expires_at, expires_at: "1970-01-01T00:00:00.000Z", recovery_inert: true };
  if (kind === "outputGrants") return { ...row, historical_status: row.status, status: "revoked", recovery_inert: true };
  if (kind === "outputSlots") {
    const status = ["authorized", "queued"].includes(String(row.status)) ? "cancelled" : row.status === "running" ? "uncertain" : row.status;
    return { ...row, historical_status: row.status, status, recovery_inert: true };
  }
  if (kind === "outputCalls") return { ...row, historical_status: row.status, status: row.status === "pending" ? "uncertain" : row.status, recovery_inert: true };
  if (kind === "outputStorageWrites" || kind === "outputAssetStorageWrites") return { ...row, historical_status: row.status,
    status: row.status === "deleted" && row.write_acknowledged === 1 ? "deleted"
      : row.status === "written" && row.write_acknowledged === 1 && typeof row.publication_event_id === "string" && row.publication_event_id ? "written" : "cleanup_pending", recovery_inert: true };
  return row;
}

export function outputRecoveryRecordIsInert(kind: string, row: Row) {
  if (kind === "outputPreflights") return row.recovery_inert === true && row.expires_at === "1970-01-01T00:00:00.000Z";
  if (kind === "outputGrants") return row.recovery_inert === true && row.status === "revoked";
  if (kind === "outputSlots") return row.recovery_inert === true && ["succeeded", "failed", "cancelled", "unavailable", "uncertain"].includes(String(row.status));
  if (kind === "outputCalls") return row.recovery_inert === true && ["uncertain", "settled", "rejected"].includes(String(row.status));
  if (kind === "outputStorageWrites" || kind === "outputAssetStorageWrites") return row.recovery_inert === true && (row.status === "cleanup_pending"
    || row.write_acknowledged === 1 && (row.status === "deleted" || row.status === "written" && typeof row.publication_event_id === "string" && Boolean(row.publication_event_id)));
  return true;
}

export async function outputRequirementRecoveryRecords(env: WorkerEnv, organizationId: string): Promise<Record<string, Row[]>> {
  if (!await available(env)) return {};
  const results = await env.DB.batch<Row>(recoveryQueries.map(([, sql]) => env.DB.prepare(sql).bind(organizationId)));
  return Object.fromEntries(results.map((result, index) => [recoveryQueries[index]![0], result.results.map((row) => inertOutputRecoveryRecord(recoveryQueries[index]![0], row))]));
}

/** Asset custody is anchored to its adoption event, including uploads made before a plan existed. */
export async function organizationOutputAssetInventory(env: WorkerEnv, organizationId: string): Promise<Row[]> {
  if (!await available(env)) return [];
  const rows = await env.DB.prepare(`SELECT custody.project_access_id,custody.project_id,asset.storage_key AS resource_id,asset.owner_user_id,
    'output-requirement' AS custody_kind,'asset' AS storage_kind,1 AS owner_count,asset.scope_key,asset.asset_id,asset.document_id,asset.content_sha256
    FROM output_assets asset JOIN project_event_scopes custody ON custody.event_id=asset.created_event_id
      AND custody.owner_user_id=asset.owner_user_id
    WHERE custody.organization_id=? AND asset.redacted_at IS NULL ORDER BY asset.storage_key`).bind(organizationId).all<Row>();
  const native = await env.DB.prepare(`SELECT custody.project_access_id,stored.storage_key AS resource_id,stored.storage_key,plan.owner_user_id,
    'output-requirement' AS custody_kind,'native' AS storage_kind,1 AS owner_count,stored.scope_key,stored.slot_id,plan.project_id,plan.document_id,stored.content_sha256,stored.publication_event_id
    FROM output_native_storage_writes stored JOIN output_operation_slots slot ON slot.scope_key=stored.scope_key AND slot.slot_id=stored.slot_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN project_event_scopes custody ON custody.event_id=grant_row.authorization_event_id AND custody.owner_user_id=plan.owner_user_id
    WHERE custody.organization_id=? AND stored.status<>'deleted' ORDER BY stored.storage_key`).bind(organizationId).all<Row>();
  const staged = await env.DB.prepare(`SELECT project_access_id,project_id,storage_key AS resource_id,owner_user_id,
    'output-requirement' AS custody_kind,'asset' AS storage_kind,1 AS owner_count,scope_key,asset_id,document_id,content_sha256,publication_event_id
    FROM output_asset_storage_writes WHERE organization_id=? AND status<>'deleted' ORDER BY storage_key`).bind(organizationId).all<Row>();
  return [...new Map([...rows.results, ...native.results, ...staged.results].map((row) => [String(row.resource_id), row])).values()];
}

export function outputAssetCustodyMatches(resource: Row, metadata: Record<string, string> | undefined) {
  const owner = String(resource.owner_user_id ?? ""), asset = String(resource.asset_id ?? ""), digest = String(resource.content_sha256 ?? "");
  if (resource.storage_kind === "native") return Boolean(owner && resource.slot_id && resource.document_id && resource.scope_key
    && /^[a-f0-9]{64}$/u.test(digest) && resource.resource_id === resource.storage_key && metadata
    && metadata.outputNativeStorage === "1" && metadata.outputOwnerId === owner && metadata.outputScopeKey === resource.scope_key
    && metadata.outputSlotId === resource.slot_id && metadata.outputDocumentId === resource.document_id && metadata.outputSha256 === digest);
  return outputAssetStorageCustodyMatches({ ownerUserId: owner, projectId: String(resource.project_id ?? ""), documentId: String(resource.document_id ?? ""),
    assetId: asset, scopeKey: String(resource.scope_key ?? ""), sha256: digest, storageKey: String(resource.resource_id ?? "") }, metadata);
}

export async function organizationOutputSubmissionBlockers(env: WorkerEnv, organizationId: string) {
  if (!await available(env)) return [];
  const rows = await env.DB.prepare(`SELECT slot.slot_id,slot.job_id,slot.status,${unsettledStorage("slot")} AS storage_pending FROM output_operation_slots slot
    WHERE (slot.scope_key,slot.slot_id) IN(${organizationSlots}) AND(
      slot.status='uncertain'
      OR ${unsettledStorage("slot")}
      OR EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND call.status IN('pending','uncertain'))
      OR EXISTS(SELECT 1 FROM output_execution_grants grant_row JOIN cost_budget_reservations cost
        ON cost.reservation_id=slot.cost_reservation_id AND cost.owner_id=grant_row.payer_user_id AND cost.status='executing'
        WHERE grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id)
    ) LIMIT 100`).bind(organizationId).all<Row>();
  const staged = await env.DB.prepare(`SELECT asset_id,status FROM output_asset_storage_writes stored WHERE organization_id=? AND(${unsettledStorageRow("stored")}) LIMIT 100`)
    .bind(organizationId).all<Row>();
  return [...rows.results.map((row) => ({ slotId: String(row.slot_id), jobId: String(row.job_id), status: String(row.status), storageCleanupPending: Boolean(row.storage_pending) })),
    ...staged.results.map((row) => ({ slotId: "", jobId: "", assetId: String(row.asset_id), status: String(row.status), storageCleanupPending: true }))];
}

/** SQL guard for the organization deletion admission transaction, not a postcommit row-count check. */
export async function outputOrganizationDeletionGuard(env: WorkerEnv, organizationId: string): Promise<{ sql: string; bindings: string[] }> {
  if (!await available(env)) return { sql: "1=1", bindings: [] };
  return {
    sql: `NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE (slot.scope_key,slot.slot_id) IN(${organizationSlots}) AND(
      slot.status='uncertain' OR ${unsettledStorage("slot")} OR EXISTS(SELECT 1 FROM output_provider_calls call
        WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND call.status IN('pending','uncertain'))
      OR EXISTS(SELECT 1 FROM output_execution_grants grant_row JOIN cost_budget_reservations cost
        ON cost.reservation_id=slot.cost_reservation_id AND cost.owner_id=grant_row.payer_user_id AND cost.status='executing'
        WHERE grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id)))
      AND NOT EXISTS(SELECT 1 FROM output_asset_storage_writes stored WHERE organization_id=? AND(${unsettledStorageRow("stored")}))`,
    bindings: [organizationId, organizationId],
  };
}

/** Revoke operational authority in the same batch as erasure; do not release uncertain money. */
export async function personalOutputErasureStatements(env: WorkerEnv, ownerUserId: string, now: string, jobRedactionSql: string) {
  if (!await available(env)) return [];
  const protectedCall = `EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=output_operation_slots.scope_key
    AND call.slot_id=output_operation_slots.slot_id)`;
  const executingCost = `EXISTS(SELECT 1 FROM output_execution_grants grant_row JOIN cost_budget_reservations cost
    ON cost.reservation_id=output_operation_slots.cost_reservation_id AND cost.owner_id=grant_row.payer_user_id AND cost.status='executing'
    WHERE grant_row.scope_key=output_operation_slots.scope_key AND grant_row.grant_id=output_operation_slots.grant_id)`;
  return [
    env.DB.prepare(`UPDATE output_execution_grants SET status='revoked' WHERE scope_key IN(${personalScopes}) AND status IN('authorized','active')`).bind(ownerUserId),
    env.DB.prepare(`UPDATE output_operation_slots SET status='cancelled',updated_at=? WHERE scope_key IN(${personalScopes})
      AND status IN('authorized','queued') AND NOT ${protectedCall} AND NOT ${executingCost}`).bind(now, ownerUserId),
    env.DB.prepare(`UPDATE output_operation_slots SET status='uncertain',updated_at=? WHERE scope_key IN(${personalScopes})
      AND status IN('authorized','queued','running') AND(status='running' OR ${protectedCall} OR ${executingCost})`).bind(now, ownerUserId),
    // A publication pointer was set in the successful native event batch. Finished
    // outputs remain; a file which may still be arriving must keep a cleanup receipt.
    env.DB.prepare(`UPDATE output_native_storage_writes SET status='cleanup_pending',updated_at=? WHERE scope_key IN(${personalScopes})
      AND publication_event_id IS NULL AND status IN('writing','written')`).bind(now, ownerUserId),
    env.DB.prepare(`UPDATE output_asset_storage_writes SET status='cleanup_pending',updated_at=? WHERE ${personalAssetWrites}
      AND publication_event_id IS NULL AND status IN('writing','written')`).bind(now, ownerUserId),
    env.DB.prepare(`UPDATE document_jobs SET status='canceled',completed_at=?,lease_expires_at=NULL,updated_at=?
      WHERE attempt_count=0 AND status IN('queued','running') AND job_id IN(
        SELECT slot.job_id FROM output_operation_slots slot WHERE slot.scope_key IN(${personalScopes}) AND slot.status='cancelled'
          AND NOT EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id))`).bind(now, now, ownerUserId),
    // The existing sanitizer preserves only identifiers/accounting needed to reconcile uncertain submissions.
    env.DB.prepare(`UPDATE document_jobs SET ${jobRedactionSql},error_message=NULL,updated_at=? WHERE job_id IN(
      SELECT slot.job_id FROM output_operation_slots slot WHERE slot.scope_key IN(${personalScopes}))`).bind(now, ownerUserId),
  ];
}

/** Report unresolved work instead of claiming that an in-flight R2 write or charge disappeared. */
export async function personalOutputErasureProgress(env: WorkerEnv, ownerUserId: string) {
  if (!await available(env)) return { providerReconciliationPending: 0, storageCleanupPending: 0 };
  const [providers, storage, staged] = await env.DB.batch<{ count: number }>([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM output_operation_slots slot WHERE slot.scope_key IN(${personalScopes}) AND(
      slot.status='uncertain' OR EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND call.status IN('pending','uncertain'))
      OR EXISTS(SELECT 1 FROM output_execution_grants grant_row JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
        AND cost.owner_id=grant_row.payer_user_id AND cost.status='executing' WHERE grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id))`).bind(ownerUserId),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM output_native_storage_writes stored WHERE stored.scope_key IN(${personalScopes})
      AND(${unsettledStorageRow("stored")})`).bind(ownerUserId),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM output_asset_storage_writes stored WHERE ${personalAssetWrites} AND(${unsettledStorageRow("stored")})`).bind(ownerUserId),
  ]);
  return { providerReconciliationPending: Number(providers.results[0]?.count ?? 0), storageCleanupPending: Number(storage.results[0]?.count ?? 0) + Number(staged.results[0]?.count ?? 0) };
}

/** Call before deleting event/project scope rows; operational tombstones remain but no private bytes or grant can revive. */
export async function organizationOutputDeletionStatements(env: WorkerEnv, organizationId: string, now: string, deletionJobId = "") {
  if (!await available(env)) return [];
  const guard = await outputOrganizationDeletionGuard(env, organizationId);
  return [
    env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE json('output provider submission in flight') END AS output_deletion_guard`).bind(...guard.bindings),
    env.DB.prepare(`UPDATE output_execution_grants SET status='revoked' WHERE ${scopedEvent("output_execution_grants.authorization_event_id")} AND status IN('authorized','active')`).bind(organizationId),
    env.DB.prepare(`UPDATE output_operation_slots SET status='cancelled',updated_at=? WHERE(scope_key,slot_id) IN(${organizationSlots}) AND status IN('authorized','queued')`).bind(now, organizationId),
    env.DB.prepare(`UPDATE output_assets SET redacted_at=? WHERE ${scopedEvent("output_assets.created_event_id")} AND redacted_at IS NULL`).bind(now, organizationId),
    env.DB.prepare(`UPDATE output_native_storage_writes SET status='deleted',updated_at=? WHERE(scope_key,slot_id) IN(${organizationSlots})
      AND status='written' AND write_acknowledged=1 AND publication_event_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM organization_deletion_items deleted WHERE deleted.job_id=? AND deleted.organization_id=?
        AND deleted.resource_kind='media' AND deleted.resource_id=output_native_storage_writes.storage_key AND deleted.status='deleted')`).bind(now, organizationId, deletionJobId, organizationId),
    env.DB.prepare(`UPDATE output_asset_storage_writes SET status='deleted',updated_at=? WHERE organization_id=?
      AND status='written' AND write_acknowledged=1 AND publication_event_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM organization_deletion_items deleted WHERE deleted.job_id=? AND deleted.organization_id=?
        AND deleted.resource_kind='media' AND deleted.resource_id=output_asset_storage_writes.storage_key AND deleted.status='deleted')`).bind(now, organizationId, deletionJobId, organizationId),
  ];
}
