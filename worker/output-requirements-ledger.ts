import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, uuidV7, type EventRow, type WorkerEnv } from "./runtime.ts";
import { POLICY_VERSION } from "./pilot-policy.ts";
import { effectivePilotParticipantSql, effectivePilotReviewerSql } from "./access-policy.ts";
import { markOutputSchemaReady, outputSchemaIsReady } from "./output-schema-state.ts";
import { OUTPUT_REQUIREMENTS_SCHEMA, upgradeOutputRequirementsSchema } from "./output-requirements-schema.ts";

export type OutputSqlValue = string | number | null;
/** deadlineMs is server-only metadata for the same SQL proof; never a wire authority. */
export type OutputSqlAssertion = { sql: string; bindings?: OutputSqlValue[]; deadlineMs?: number };
export type OutputScope = {
  kind: "personal" | "project";
  key: string;
  ownerUserId: string;
  actorUserId: string;
  projectId: string;
  documentId: string;
  organizationId: string | null;
  projectAccessId: string | null;
  contextId: string | null;
};
export type OutputCommandPermission = "read" | "author" | "request" | "review";

export { OUTPUT_REQUIREMENTS_SCHEMA } from "./output-requirements-schema.ts";

const initialized = new WeakSet<object>();
export async function ensureOutputRequirementsSchema(env: WorkerEnv) {
  if (initialized.has(env.DB) || outputSchemaIsReady(env.DB)) { markOutputSchemaReady(env.DB); return; }
  await env.DB.batch(OUTPUT_REQUIREMENTS_SCHEMA.map((sql) => env.DB.prepare(sql)));
  await upgradeOutputRequirementsSchema(env.DB);
  initialized.add(env.DB);
  markOutputSchemaReady(env.DB);
}

export type OutputSourceEpoch = { head: number; sourceDigest: string };
export function outputSourceEpochAssertion(scope: OutputScope, epoch: OutputSourceEpoch): OutputSqlAssertion {
  if (!Number.isSafeInteger(epoch.head) || epoch.head < 0 || !epoch.sourceDigest) throw new OutputConflictError("output_source_epoch_required", 403);
  return { sql: `NOT EXISTS(SELECT 1 FROM events later WHERE later.stream_id=? AND later.sequence>? AND NOT(
    later.type IN('DocumentOpened','ProjectOpened') OR (
      (later.type IN('DocumentRenderRequested','DocumentRenderCompleted','DocumentRenderFailed','GenerationUsageRecorded','GenerationRequested','ContextCompiled','GenerationCompleted','GenerationFailed','BudgetReserved','BudgetReleased','BudgetExceeded')
        OR (later.type IN('ModelRegistered','AdapterVersioned','CapabilityDeclared') AND later.actor='worker:registry'))
      AND later.correlation_id IN(SELECT job.correlation_id FROM output_operation_slots slot JOIN document_jobs job ON job.job_id=slot.job_id WHERE slot.scope_key=? AND slot.source_digest=?))))`,
    bindings: [`creative:${scope.ownerUserId}`, epoch.head, scope.key, epoch.sourceDigest] };
}

export class OutputConflictError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; this.name = "OutputConflictError"; }
}

export const outputRevision = (head: number) => `output:${head}`;
export function parseOutputRevision(value: unknown) {
  const match = typeof value === "string" ? /^output:(0|[1-9]\d*)$/u.exec(value) : null;
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new OutputConflictError("expected_revision_required", 400);
  return Number(match[1]);
}

/** This table's CHECK aborts inside DB.batch, including when a guarded write matched zero rows. */
export function outputAssertionStatements(env: WorkerEnv, assertion: OutputSqlAssertion) {
  const token = uuidV7();
  return [
    env.DB.prepare(`INSERT INTO output_atomic_assertions(token,passed) VALUES(?,CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END)`)
      .bind(token, ...(assertion.bindings ?? [])),
    env.DB.prepare("DELETE FROM output_atomic_assertions WHERE token=?").bind(token),
  ];
}

/** Repeat live authority in the transaction; a pre-read principal is not a commit-time capability. */
export function outputScopeAuthority(scope: OutputScope, permission: OutputCommandPermission, now = new Date().toISOString()): OutputSqlAssertion {
  const capability = permission === "author" ? "project.author" : permission === "request" ? "project.output.request" : permission === "review" ? "project.review.approve" : "project.read";
  if (scope.kind === "personal") return {
    sql: `?=? AND EXISTS(SELECT 1 FROM users actor WHERE actor.user_id=? AND actor.consent_version=?
        AND (?=1 OR actor.role IN('admin','creator')))
      AND NOT EXISTS(SELECT 1 FROM organization_projects project WHERE project.owner_user_id=? AND project.project_id=?)`,
    bindings: [scope.actorUserId, scope.ownerUserId, scope.actorUserId, POLICY_VERSION, permission === "read" ? 1 : 0, scope.ownerUserId, scope.projectId],
  };
  return {
    sql: `EXISTS(SELECT 1 FROM organization_projects project
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.status='active'
      JOIN users actor ON actor.user_id=? AND actor.consent_version=?
      JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=actor.user_id
        AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id
        AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
      LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id
        AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id
        AND project_member.user_id=actor.user_id AND project_member.status='active' AND project_member.revoked_at IS NULL
      JOIN project_context_sessions selected ON selected.context_id=? AND selected.principal_user_id=actor.user_id
        AND selected.project_access_id=project.project_access_id AND selected.organization_id=project.organization_id
        AND selected.revoked_at IS NULL AND selected.expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND project.status='active'
        AND (project.owner_user_id=actor.user_id OR project_member.membership_id IS NOT NULL)
        AND ${effectivePilotParticipantSql("project.organization_id", "actor.user_id")}
        AND (?=1 OR NOT ${effectivePilotReviewerSql("project.organization_id", "actor.user_id")})
        AND (project.owner_user_id=actor.user_id OR ?='project.read' OR (project_member.role='editor' AND ? IN('project.author','project.output.request')) OR EXISTS(SELECT 1 FROM capability_grants granted
          WHERE granted.user_id=actor.user_id AND granted.capability=? AND granted.scope_type='project'
            AND granted.organization_id=project.organization_id AND granted.project_access_id=project.project_access_id
            AND granted.status='active' AND granted.revoked_at IS NULL AND (granted.expires_at IS NULL OR granted.expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))))))`,
    bindings: [scope.actorUserId, POLICY_VERSION, scope.contextId, now, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId,
      permission === "read" || permission === "review" ? 1 : 0, capability, capability, capability, now],
  };
}

type RetainedOutputBody = { raw: string; projectId: string | null; documentId: string | null };
const retainedBodies = new WeakMap<OutputScope, Map<string, RetainedOutputBody>>();
const privateEvidenceFail = (code: string, status = 409): never => { throw new OutputConflictError(code, status); };
export function retainedOutputBodyAssertions(scope: OutputScope): OutputSqlAssertion[] {
  const encoder = new TextEncoder(), maximumPayload = 128 * 1024, maximumEvidence = 16 * 1024 * 1024;
  const batches: string[] = []; let batch: Array<Record<string, string | number | null>> = [], batchBytes = 2, evidenceBytes = 0;
  for (const [id, { raw, projectId, documentId }] of retainedBodies.get(scope)?.entries() ?? []) {
    evidenceBytes += encoder.encode(raw).byteLength;
    if (evidenceBytes > maximumEvidence) privateEvidenceFail("output_source_proof_too_large", 413);
    // SQLite substr counts Unicode code points, not JavaScript UTF-16 units.
    const pieces: Array<{ offset: number; length: number; part: string }> = [];
    let characters: string[] = [], total = 0, offset = 1;
    for (const character of raw) {
      characters.push(character); total++;
      if (characters.length === 16000) { pieces.push({ offset, length: characters.length, part: characters.join("") }); offset += characters.length; characters = []; }
    }
    if (characters.length || !pieces.length) pieces.push({ offset, length: characters.length, part: characters.join("") });
    for (const piece of pieces) {
      const expected = { id, projectId, documentId, total, ...piece }, bytes = encoder.encode(JSON.stringify(expected)).byteLength + 1;
      if (bytes + 2 > maximumPayload) privateEvidenceFail("output_source_proof_too_large", 413);
      if (batch.length && batchBytes + bytes > maximumPayload) { batches.push(JSON.stringify(batch)); batch = []; batchBytes = 2; }
      batch.push(expected); batchBytes += bytes;
    }
  }
  if (batch.length) batches.push(JSON.stringify(batch));
  return batches.map((expected) => ({ sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN event_private_payloads body
    ON body.private_event_id=json_extract(expected.value,'$.id') AND body.owner_id=?
      AND body.project_id IS json_extract(expected.value,'$.projectId') AND body.document_id IS json_extract(expected.value,'$.documentId')
    WHERE body.private_event_id IS NULL OR body.redacted_at IS NOT NULL OR length(body.private_json)<>json_extract(expected.value,'$.total')
      OR substr(body.private_json,json_extract(expected.value,'$.offset'),json_extract(expected.value,'$.length'))<>json_extract(expected.value,'$.part'))`, bindings: [expected, scope.ownerUserId] }));
}

/** Call only with the exact scoped row, never a reconstruction of a redacted body. */
export function rememberOutputPrivateBody(scope: OutputScope, eventId: string, raw: string,
  custody: { projectId: string | null; documentId: string | null } = scope): Record<string, unknown> {
  const expected = retainedBodies.get(scope) ?? new Map<string, RetainedOutputBody>(), previous = expected.get(eventId);
  if (previous && (previous.raw !== raw || previous.projectId !== custody.projectId || previous.documentId !== custody.documentId))
    privateEvidenceFail("output_private_evidence_changed");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) privateEvidenceFail("output_private_evidence_unavailable", 410);
  expected.set(eventId, { raw, projectId: custody.projectId, documentId: custody.documentId }); retainedBodies.set(scope, expected);
  return parsed as Record<string, unknown>;
}

/** Replace only the source capture for this request; no persistent content is modified. */
export function resetRetainedOutputPrivateBodies(scope: OutputScope) { retainedBodies.delete(scope); }

/** A post-commit read must certify the very same command/source bytes, not just its new snapshot. */
export function inheritRetainedOutputPrivateBodies(from: OutputScope, into: OutputScope) {
  const identity = (scope: OutputScope) => JSON.stringify([scope.kind, scope.key, scope.ownerUserId, scope.actorUserId,
    scope.projectId, scope.documentId, scope.organizationId, scope.projectAccessId, scope.contextId]);
  if (identity(from) !== identity(into)) privateEvidenceFail("output_execution_authority_revoked", 403);
  for (const [id, evidence] of retainedBodies.get(from)?.entries() ?? [])
    rememberOutputPrivateBody(into, id, evidence.raw, evidence);
}

export type OutputCommandReceipt = { action: string; eventId: string; payload: Record<string, unknown>; createdAt: string;
  /** Server-only canonical identity; response projection never returns the digest. */
  key: string; requestDigest: string; privateUnavailable?: true;
};
export function outputCommandReceiptAssertion(scope: OutputScope, receipt: OutputCommandReceipt): OutputSqlAssertion {
  return { sql: `EXISTS(SELECT 1 FROM output_commands command JOIN events event ON event.event_id=command.event_id
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=? AND command.request_digest=?
      AND command.action=? AND command.event_id=? AND command.created_at=?
      AND event.stream_id=? AND event.actor=? AND event.client_id='server:output-requirements' AND event.correlation_id=command.command_key
      AND json_extract(event.payload,'$.project_id')=? AND json_extract(event.payload,'$.document_id')=?)`,
    bindings: [scope.key, scope.actorUserId, receipt.key, receipt.requestDigest, receipt.action, receipt.eventId, receipt.createdAt,
      `creative:${scope.ownerUserId}`, `user:${scope.actorUserId}`, scope.projectId, scope.documentId] };
}
export async function readOutputCommand(env: WorkerEnv, scope: OutputScope, key: string, digest: string, options: { allowUnavailableReceipt?: boolean } = {}): Promise<OutputCommandReceipt | null> {
  const row = await env.DB.prepare(`SELECT command.action,command.event_id,command.request_digest,command.created_at,body.private_json,
      event.stream_id,event.actor,event.client_id,event.correlation_id,
      json_extract(event.payload,'$.project_id') AS project_id,json_extract(event.payload,'$.document_id') AS document_id
    FROM output_commands command JOIN events event ON event.event_id=command.event_id
    LEFT JOIN event_private_payloads body ON body.private_event_id=command.event_id
      AND body.owner_id=? AND body.project_id=? AND body.document_id=? AND body.redacted_at IS NULL
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?`)
    .bind(scope.ownerUserId, scope.projectId, scope.documentId, scope.key, scope.actorUserId, key).first<Record<string, unknown>>();
  if (!row) return null;
  if (row.request_digest !== digest) throw new OutputConflictError("mutation_key_reused_with_different_content");
  if (row.stream_id !== `creative:${scope.ownerUserId}` || row.actor !== `user:${scope.actorUserId}`
    || row.client_id !== "server:output-requirements" || row.correlation_id !== key
    || row.project_id !== scope.projectId || row.document_id !== scope.documentId)
    throw new OutputConflictError("output_command_scope_mismatch", 403);
  const identity = { action: String(row.action), eventId: String(row.event_id), createdAt: String(row.created_at), key, requestDigest: digest };
  if (typeof row.private_json !== "string") {
    if (!options.allowUnavailableReceipt) throw new OutputConflictError("original_command_content_unavailable", 410);
    return { ...identity, payload: {}, privateUnavailable: true };
  }
  return { ...identity, payload: rememberOutputPrivateBody(scope, identity.eventId, row.private_json) };
}

export type OutputCommandWrite = {
  scope: OutputScope; permission: OutputCommandPermission; expectedHead: number; expectedProjectHead: number;
  key: string; digest: string; action: string;
  events: Array<{ type: string; payload: Record<string, unknown> }>;
  assertions?: OutputSqlAssertion[];
  sourceAssertions?: OutputSqlAssertion[];
  buildSidecars?: (events: EventRow[]) => { statements: D1PreparedStatement[]; assertions?: OutputSqlAssertion[] };
};

/** The event, private body, scoped projections, grants/slots and command receipt commit together. */
export async function commitOutputCommand(env: WorkerEnv, input: OutputCommandWrite) {
  const previous = await readOutputCommand(env, input.scope, input.key, input.digest, { allowUnavailableReceipt: true });
  if (previous) return { replayed: true, receipt: previous, events: [] as EventRow[] };
  if (!input.events.length) throw new Error("output_event_required");
  const scope = input.scope, stream = `creative:${scope.ownerUserId}`, now = new Date().toISOString();
  if (scope.kind === "personal" && (scope.actorUserId !== scope.ownerUserId || scope.organizationId || scope.projectAccessId)) throw new OutputConflictError("invalid_output_scope", 403);
  if (scope.kind === "project" && (!scope.organizationId || !scope.projectAccessId || !scope.contextId)) throw new OutputConflictError("invalid_output_scope", 403);
  const events = input.events.map((event, index) => makeEvent(stream, input.expectedHead + index + 1, `user:${scope.actorUserId}`, "server:output-requirements", input.key,
    event.type, { ...event.payload, project_id: scope.projectId, document_id: scope.documentId, actor_user_id: scope.actorUserId }));
  const guards = [outputScopeAuthority(scope, input.permission, now),
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [stream, input.expectedHead] },
    ...(scope.kind === "project" ? [{ sql: "(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?", bindings: [scope.projectAccessId, scope.organizationId, input.expectedProjectHead] }] : []),
    ...(input.sourceAssertions ?? []), ...(input.assertions ?? [])] as OutputSqlAssertion[];
  const statements = guards.flatMap((guard) => outputAssertionStatements(env, guard));
  for (const [index, event] of events.entries()) {
    statements.push(env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...eventWriteBindings(event)));
    statements.push(...outputAssertionStatements(env, { sql: "EXISTS(SELECT 1 FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.redacted_at IS NULL WHERE event.event_id=? AND body.owner_id=? AND body.document_id=?)", bindings: [event.eventId, scope.ownerUserId, scope.documentId] }));
    if (scope.kind === "project") {
      statements.push(env.DB.prepare(`INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(event.eventId, scope.projectAccessId, scope.organizationId, scope.projectId, scope.ownerUserId, stream, event.sequence, input.expectedProjectHead + index + 1, scope.actorUserId, now));
      if (event.type === "BlockCreated") statements.push(env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
        VALUES(?,'block',?,?,?,?,'collaborative_output',?,?,?)`).bind(scope.projectAccessId, String(event.payload.block_id), scope.organizationId, scope.projectId, scope.ownerUserId, event.eventId, scope.actorUserId, now));
    }
  }
  const sidecars = input.buildSidecars?.(events);
  statements.push(...(sidecars?.statements ?? []), ...(sidecars?.assertions ?? []).flatMap((guard) => outputAssertionStatements(env, guard)));
  const last = events.at(-1)!;
  statements.push(env.DB.prepare(`INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(scope.key, scope.actorUserId, input.key, input.digest, input.action, last.eventId, now));
  if (scope.kind === "project") {
    statements.push(env.DB.prepare("UPDATE project_migration_states SET last_owner_sequence=?,updated_at=? WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active'")
      .bind(last.sequence, now, scope.projectAccessId, scope.organizationId, scope.ownerUserId));
    statements.push(...outputAssertionStatements(env, { sql: "changes()=1" }));
  }
  try { await env.DB.batch(statements); }
  catch (error) {
    // A competing identical command may have committed. Its immutable digest must still agree.
    const replay = await readOutputCommand(env, scope, input.key, input.digest, { allowUnavailableReceipt: true });
    if (replay) return { replayed: true, receipt: replay, events: [] as EventRow[] };
    if (String(error).includes("CHECK constraint failed") || String(error).includes("UNIQUE constraint failed")) throw new OutputConflictError("output_revision_or_authority_changed");
    throw error;
  }
  // The acknowledged transaction wrote these exact private envelopes. Retain
  // every appended body for the final response proof, including non-last events.
  for (const event of events) {
    const values = eventWriteBindings(event);
    if (typeof values[16] !== "string") throw new Error("output_private_event_envelope_required");
    rememberOutputPrivateBody(scope, event.eventId, values[16], { projectId: values[14] as string | null, documentId: values[15] as string | null });
  }
  return { replayed: false, receipt: { action: input.action, eventId: last.eventId, payload: last.payload, createdAt: now, key: input.key, requestDigest: input.digest }, events };
}

export type OutputOperationSlot = {
  scopeKey: string; slotId: string; grantId: string; planRevisionId: string; targetId: string; targetContractDigest: string; sourceDigest: string;
  provider: string; model: string; routeDigest: string; jobId: string; costReservationId: string; tokenReservationId: string;
  maximumMicrousd: number; maximumCalls: number; maximumTokens: number; status: string;
  attemptOrdinal: number; previousSlotId: string | null;
};
export async function readOutputSlots(env: WorkerEnv, scopeKey: string, grantId: string): Promise<OutputOperationSlot[]> {
  const rows = await env.DB.prepare("SELECT * FROM output_operation_slots WHERE scope_key=? AND grant_id=? ORDER BY created_at,slot_id").bind(scopeKey, grantId).all<Record<string, unknown>>();
  return rows.results.map((row) => outputSlotFromRow(scopeKey, row));
}
export function outputSlotFromRow(scopeKey: string, row: Record<string, unknown>): OutputOperationSlot {
  return { scopeKey, slotId: String(row.slot_id), grantId: String(row.grant_id), planRevisionId: String(row.plan_revision_id), targetId: String(row.target_id),
    targetContractDigest: String(row.target_contract_digest), sourceDigest: String(row.source_digest), provider: String(row.provider), model: String(row.model), routeDigest: String(row.route_digest),
    jobId: String(row.job_id), costReservationId: String(row.cost_reservation_id), tokenReservationId: String(row.token_reservation_id), maximumMicrousd: Number(row.maximum_microusd), maximumCalls: Number(row.maximum_calls), maximumTokens: Number(row.maximum_tokens), status: String(row.status), attemptOrdinal: Number(row.attempt_ordinal), previousSlotId: typeof row.previous_slot_id === "string" ? row.previous_slot_id : null };
}

/** A durable call slot is never refunded by a failed local request, cancellation or settlement. */
export async function claimOutputProviderCall(env: WorkerEnv, input: {
  scope: OutputScope; slotId: string; jobId: string; callKey: string; clientRequestId: string; requestDigest: string;
  provider: string; model: string; maximumMicrousd: number; expectedHead: number; sourceDigest: string;
  routeDigest: string; stageKey: string; sourceEpoch?: OutputSourceEpoch;
  assertions: OutputSqlAssertion[];
}) {
  if (!input.callKey || !input.clientRequestId || !input.requestDigest || !Number.isSafeInteger(input.maximumMicrousd) || input.maximumMicrousd <= 0 || !input.assertions.length) throw new OutputConflictError("provider_call_authority_required", 403);
  if (input.sourceEpoch && (input.sourceEpoch.sourceDigest !== input.sourceDigest || input.sourceEpoch.head !== input.expectedHead)) throw new OutputConflictError("output_source_epoch_mismatch", 403);
  const now = new Date().toISOString();
  const slotAuthority: OutputSqlAssertion = {
    sql: `EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row
      ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      WHERE slot.scope_key=? AND slot.slot_id=? AND slot.job_id=? AND slot.route_digest=? AND slot.source_digest=?
        AND EXISTS(SELECT 1 FROM output_operation_routes route WHERE route.scope_key=slot.scope_key AND route.slot_id=slot.slot_id
          AND route.stage_key=? AND route.provider=? AND route.model=?
          AND (SELECT COUNT(*) FROM output_provider_calls calls WHERE calls.scope_key=route.scope_key AND calls.slot_id=route.slot_id AND calls.stage_key=route.stage_key)<route.maximum_calls)
        AND slot.status IN('queued','running') AND grant_row.status IN('authorized','active') AND grant_row.expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND grant_row.actor_user_id=?
        AND grant_row.context_id IS ?
        AND NOT EXISTS(SELECT 1 FROM output_provider_calls unresolved WHERE unresolved.scope_key=slot.scope_key AND unresolved.slot_id=slot.slot_id AND (unresolved.used_microusd IS NULL OR unresolved.status IN('pending','uncertain')))
        AND (SELECT COUNT(*) FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)<slot.maximum_calls
        AND (SELECT COALESCE(SUM(CASE WHEN calls.used_microusd IS NULL THEN calls.reserved_microusd ELSE calls.used_microusd END),0)
          FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)+?<=slot.maximum_microusd
        AND (SELECT COALESCE(SUM(CASE WHEN calls.used_microusd IS NULL THEN calls.reserved_microusd ELSE calls.used_microusd END),0)
          FROM output_provider_calls calls JOIN output_operation_slots child ON child.scope_key=calls.scope_key AND child.slot_id=calls.slot_id
          WHERE child.scope_key=grant_row.scope_key AND child.grant_id=grant_row.grant_id)+?<=grant_row.maximum_microusd)`,
    bindings: [input.scope.key, input.slotId, input.jobId, input.routeDigest, input.sourceDigest, input.stageKey, input.provider, input.model, now, input.scope.actorUserId, input.scope.contextId, input.maximumMicrousd, input.maximumMicrousd],
  };
  const guards = [outputScopeAuthority(input.scope, "request", now), slotAuthority,
    input.sourceEpoch ? outputSourceEpochAssertion(input.scope, input.sourceEpoch) : { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${input.scope.ownerUserId}`, input.expectedHead] } as OutputSqlAssertion,
    ...input.assertions];
  try {
    await env.DB.batch([
      ...guards.flatMap((guard) => outputAssertionStatements(env, guard)),
      env.DB.prepare(`INSERT INTO output_provider_calls(scope_key,slot_id,call_key,client_request_id,request_digest,stage_key,provider,model,reserved_microusd,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,'pending',?)`).bind(input.scope.key, input.slotId, input.callKey, input.clientRequestId, input.requestDigest, input.stageKey, input.provider, input.model, input.maximumMicrousd, now),
      env.DB.prepare("UPDATE output_operation_slots SET status='running',updated_at=? WHERE scope_key=? AND slot_id=?").bind(now, input.scope.key, input.slotId),
      ...outputAssertionStatements(env, { sql: "changes()=1" }),
    ]);
  } catch (error) {
    const replay = await env.DB.prepare("SELECT request_digest,status,client_request_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=?")
      .bind(input.scope.key, input.slotId, input.callKey).first<Record<string, unknown>>();
    if (replay) {
      if (replay.request_digest !== input.requestDigest) throw new OutputConflictError("provider_call_key_collision");
      return { claimed: false, status: String(replay.status), clientRequestId: String(replay.client_request_id) };
    }
    if (String(error).includes("constraint failed")) throw new OutputConflictError("output_provider_call_not_authorized", 403);
    throw error;
  }
  return { claimed: true, status: "pending", clientRequestId: input.clientRequestId };
}

/** Observes true provider cost; existing account reservations perform the only billing settlement. */
export async function settleOutputProviderCall(env: WorkerEnv, input: {
  scopeKey: string; slotId: string; callKey: string; clientRequestId: string; usedMicrousd: number | null;
  status: "settled" | "uncertain" | "rejected"; providerResponseId?: string;
  /** HTTP reconciliation supplies current caller/job authority; provider observers omit it. */
  assertions?: OutputSqlAssertion[];
}) {
  if (input.usedMicrousd !== null && (!Number.isSafeInteger(input.usedMicrousd) || input.usedMicrousd < 0)) throw new Error("invalid_provider_cost");
  if (input.status === "settled" && input.usedMicrousd === null || input.status === "uncertain" && input.usedMicrousd !== null || input.status === "rejected" && input.usedMicrousd !== 0) throw new Error("invalid_provider_settlement");
  const read = async () => {
    const statement = env.DB.prepare("SELECT used_microusd,status,provider_response_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key=? AND client_request_id=?")
      .bind(input.scopeKey, input.slotId, input.callKey, input.clientRequestId);
    if (!input.assertions?.length) return statement.first<Record<string, unknown>>();
    try {
      // A denied HTTP write cannot turn into an unauthorized canonical-receipt
      // read. Retest the caller's authority in the same transaction as replay.
      const rows = await env.DB.batch<Record<string, unknown>>([
        ...input.assertions.flatMap((assertion) => outputAssertionStatements(env, assertion)), statement,
      ]);
      return rows[rows.length - 1]?.results[0] ?? null;
    } catch (error) {
      if (String(error).includes("constraint failed")) throw new OutputConflictError("output_execution_authority_revoked", 403);
      throw error;
    }
  };
  const now = new Date().toISOString();
  try { await env.DB.batch([
    ...(input.assertions ?? []).flatMap((assertion) => outputAssertionStatements(env, assertion)),
    env.DB.prepare(`UPDATE output_provider_calls SET used_microusd=?,status=?,provider_response_id=?,settled_at=?
      WHERE scope_key=? AND slot_id=? AND call_key=? AND client_request_id=? AND status IN('pending','uncertain')`)
      .bind(input.usedMicrousd, input.status, input.providerResponseId ?? null, input.status === "uncertain" ? null : now, input.scopeKey, input.slotId, input.callKey, input.clientRequestId),
    ...outputAssertionStatements(env, { sql: "changes()=1" }),
    env.DB.prepare(`UPDATE output_execution_grants SET status='exceeded' WHERE scope_key=? AND grant_id=(SELECT grant_id FROM output_operation_slots WHERE scope_key=? AND slot_id=?)
      AND (EXISTS(SELECT 1 FROM output_operation_slots child WHERE child.scope_key=output_execution_grants.scope_key AND child.grant_id=output_execution_grants.grant_id
        AND (SELECT COALESCE(SUM(COALESCE(calls.used_microusd,calls.reserved_microusd)),0) FROM output_provider_calls calls WHERE calls.scope_key=child.scope_key AND calls.slot_id=child.slot_id)>child.maximum_microusd)
        OR (SELECT COALESCE(SUM(COALESCE(calls.used_microusd,calls.reserved_microusd)),0) FROM output_provider_calls calls JOIN output_operation_slots child ON child.scope_key=calls.scope_key AND child.slot_id=calls.slot_id
          WHERE child.scope_key=output_execution_grants.scope_key AND child.grant_id=output_execution_grants.grant_id)>maximum_microusd)`)
      .bind(input.scopeKey, input.scopeKey, input.slotId),
  ]); } catch (error) {
    // Attempt the guarded write first. A concurrent callback or lost D1
    // acknowledgement is successful only when the exact canonical receipt agrees.
    const committed = await read();
    if (committed && committed.status === input.status && committed.used_microusd === input.usedMicrousd && committed.provider_response_id === (input.providerResponseId ?? null)) return { replayed: true };
    if (committed && ["settled", "rejected"].includes(String(committed.status))) throw new OutputConflictError("provider_settlement_conflict");
    if (!committed && String(error).includes("constraint failed")) throw new OutputConflictError("output_provider_call_missing", 404);
    throw error;
  }
  return { replayed: false };
}
