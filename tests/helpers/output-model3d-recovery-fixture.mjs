import assert from "node:assert/strict";
import { registerOutputSourceImports, outputTestDatabase } from "../output-execution-test-helpers.mjs";
import { fixture as preparedFixture } from "./model3d-native-execution-fixture.mjs";
registerOutputSourceImports();
const { ensureSchema, appendAuditEvent } = await import("../../worker/runtime.ts");
const { ensureOutputRequirementsSchema, outputSlotFromRow } = await import("../../worker/output-requirements-ledger.ts");
const { prepareBudgetReservation, prepareCostBudgetReservation } = await import("../../worker/pilot-policy.ts");
const { claimOutputModel3dRecoveryLease } = await import("../../worker/output-model3d-recovery-lease.ts");
const { outputModel3dRecoveryAvailable } = await import("../../worker/output-model3d-recovery-availability.ts");

/** Actual current runtime/output SQLite schema. Admission rows are explicit
 * synthetic fixtures, not HTTP admission or any live/original database. */
export async function model3dRecoveryFixture() {
  const f = outputTestDatabase();
  try {
    await ensureSchema(f.env); await ensureOutputRequirementsSchema(f.env);
    const prepareStatement = f.DB.prepare.bind(f.DB);
    f.DB.prepare = sql => {
      const statement = prepareStatement(sql), bind = statement.bind;
      statement.bind = function (...bindings) { assert(bindings.length <= 100, `D1 binding limit: ${bindings.length}`); assert(!bindings.includes(undefined)); return bind.apply(this, bindings); };
      return statement;
    };
    const original = await preparedFixture(), now = new Date().toISOString(), expiry = new Date(Date.now() + 600000).toISOString();
    const insert = (table, row) => { const entries = Object.entries(row); return f.sqlite.prepare(`INSERT INTO ${table}(${entries.map(([key]) => key).join(",")}) VALUES(${entries.map(() => "?").join(",")})`).run(...entries.map(([, value]) => value)); };
    insert("users", { user_id: "owner", email: "owner@example.test", display_name: "Owner", role: "creator", created_at: now, updated_at: now });
    const anchor = await appendAuditEvent(f.env, "creative:owner", "user", "DocumentCreated", { document_id: "document", project_id: "project", title: "Synthetic kettle" });
    const scope = { kind: "personal", key: "scope", actorUserId: "owner", ownerUserId: "owner", projectId: "project", documentId: "document", organizationId: null, projectAccessId: null, contextId: null };
    const execution = { scopeKey: "scope", grantId: "grant", slotId: "slot", planRevisionId: "plan", targetId: "target", targetContractDigest: "a".repeat(64), sourceDigest: original.preview.sourceDigest };
    const request = { ...original.payload, outputExecution: execution, model3dCostConsent: { ...original.preview, confirmed: true, providerTransferConfirmed: true } };
    const provider = { clientRequestId: "forma-model3d-test-original", provider: "fal", operation: "model3d", model: original.preview.model, status: "accepted", providerRequestId: "provider-test-original" };
    const checkpoint = { artifactId: "artifact", artifactKind: "model3d", outputExecution: execution, model3dInputReceipt: original.receipt,
      providerSubmissions: { [provider.clientRequestId]: provider }, reservationId: "token:model3d", costReservationId: "cost:model3d", costReservationPeriod: now.slice(0, 7) };
    const job = { job_id: original.preview.requestId, owner_id: "owner", stream_id: "creative:owner", document_id: "document", kind: "render_document", status: "failed", source_surface: "outputs",
      correlation_id: original.preview.requestId, requested_sequence: anchor.sequence, request_json: JSON.stringify(request), result_json: JSON.stringify(checkpoint),
      error_message: "local_persistence_failed", attempt_count: 1, requested_at: now, started_at: now, completed_at: now, notified_at: null, lease_expires_at: null, expires_at: expiry, updated_at: now };
    insert("document_jobs", job);
    const budgetContext = { streamId: job.stream_id, correlationId: job.correlation_id, operation: "document-render:model3d", period: now.slice(0, 7) };
    const token = await prepareBudgetReservation(f.env, "owner", 1, { ...budgetContext, reservationId: checkpoint.reservationId });
    const cost = await prepareCostBudgetReservation(f.env, "owner", 400000, { ...budgetContext, reservationId: checkpoint.costReservationId, maximumMicrousd: 400000, allowUserOverage: false });
    assert(token.ok && cost.ok); await f.env.DB.batch([...token.statements, ...cost.statements]);
    f.sqlite.prepare("UPDATE cost_budget_reservations SET status='executing' WHERE reservation_id=?").run(cost.reservationId);
    insert("output_plan_revisions", { scope_key: "scope", scope_kind: "personal", owner_user_id: "owner", project_id: "project", document_id: "document", plan_revision_id: "plan", plan_id: "plan", revision: 1,
      confirmed_event_id: anchor.eventId, requirements_digest: original.preview.requirementsDigest, source_digest: original.preview.sourceDigest, resolver_version: "synthetic-fixture", source_head: anchor.sequence, target_count: 1, created_at: now });
    insert("output_plan_targets", { scope_key: "scope", plan_revision_id: "plan", target_id: "target", target_contract_digest: "a".repeat(64), media_kind: "model3d", required: 1, selected: 1, ordinal: 0 });
    insert("output_preflights", { scope_key: "scope", preflight_id: "preflight", plan_revision_id: "plan", actor_user_id: "owner", terms_digest: "terms", event_id: anchor.eventId, expires_at: expiry, created_at: now });
    insert("output_execution_grants", { scope_key: "scope", grant_id: "grant", plan_revision_id: "plan", actor_user_id: "owner", payer_user_id: "owner", preflight_id: "preflight", authorization_event_id: anchor.eventId,
      maximum_microusd: 400000, maximum_calls: 1, status: "active", expires_at: expiry, created_at: now });
    insert("output_operation_slots", { scope_key: "scope", slot_id: "slot", grant_id: "grant", plan_revision_id: "plan", target_id: "target", target_contract_digest: "a".repeat(64), source_digest: original.preview.sourceDigest,
      provider: "fal", model: original.preview.model, route_digest: "route", job_id: job.job_id, cost_reservation_id: cost.reservationId, token_reservation_id: token.reservationId, maximum_microusd: 400000,
      maximum_calls: 1, maximum_tokens: 1, status: "uncertain", created_at: now, updated_at: now });
    insert("output_operation_routes", { scope_key: "scope", slot_id: "slot", stage_key: "model3d:initial", provider: "fal", model: provider.model, maximum_calls: 1 });
    insert("output_provider_calls", { scope_key: "scope", slot_id: "slot", call_key: "model3d:initial", stage_key: "model3d:initial", client_request_id: provider.clientRequestId,
      request_digest: original.receipt.requestDigest, provider: "fal", model: provider.model, status: "uncertain", reserved_microusd: 400000, used_microusd: null, provider_response_id: provider.providerRequestId, created_at: now });
    f.sqlite.exec("CREATE TABLE recovery_test_source(current INTEGER NOT NULL); INSERT INTO recovery_test_source VALUES(1)");
    const slot = outputSlotFromRow("scope", f.sqlite.prepare("SELECT * FROM output_operation_slots").get());
    const current = { sourceDigest: original.preview.sourceDigest, requirementsDigest: original.preview.requirementsDigest, retentionExpiresAt: expiry };
    const assertions = [{ sql: "(SELECT current FROM recovery_test_source)=1", bindings: [], deadlineMs: Date.parse(expiry) }];
    const readJob = () => ({ ...f.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(job.job_id), output_slot_id: "slot" });
    const claim = extra => claimOutputModel3dRecoveryLease(f.env, scope, slot, readJob(), { assertions, current, ...extra });
    const available = () => outputModel3dRecoveryAvailable(f.env, scope, slot, readJob());
    const user = { userId: "owner", billingUserId: "owner", streamId: "creative:owner" };
    return { ...f, mediaMap: f.media, original, job, scope, slot, current, assertions, provider, user, readJob, claim, available, close: () => f.sqlite.close() };
  } catch (error) { f.sqlite.close(); throw error; }
}

export function model3dRecoverySnapshot(f) {
  const schema = f.sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  const tables = {};
  for (const { name } of schema.filter(row => row.type === "table")) tables[name] = f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all();
  // Normalize node:sqlite's null-prototype row objects on both sides while
  // preserving every field, SQL value, empty table, and schema entry.
  return structuredClone({ schema, tables, media: [...f.media].map(([key, value]) => [key, { bytes: [...value.bytes], metadata: structuredClone(value.metadata), contentType: value.contentType }]) });
}
export function withoutModel3dRecovery(value) {
  const copy = structuredClone(value);
  for (const job of copy.tables.document_jobs) { const result = JSON.parse(job.result_json); delete result.outputModel3dRecovery; delete result.outputModel3dRecoveryHistory; job.result_json = JSON.stringify(result); }
  return copy;
}
export function model3dRecoveryBudgets(f) { return ["budget_reservations", "cost_budget_reservations", "output_provider_calls"].map(table => f.sqlite.prepare(`SELECT * FROM ${table}`).all()); }
