import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, uuidV7, type EventRow } from "./event-write-primitives.ts";
import type { WorkerEnv } from "./runtime.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { effectivePilotParticipantSql, effectivePilotReviewerSql } from "./access-policy.ts";
import { recordOutputProofCapacity } from "./output-proof-capacity-diagnostic.ts";
import { prepareSceneSourceTransition, type SceneSourceVersion } from "./scene-source-generation.ts";
import { prepareSceneJobSourceTransition } from "./scene-job-source-witness.ts";
import type { OutputOperationSlot } from "./output-requirements-ledger.ts";

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

export class OutputConflictError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; this.name = "OutputConflictError"; }
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
    if (evidenceBytes > maximumEvidence) throw recordOutputProofCapacity(new OutputConflictError("output_source_proof_too_large", 413), "private_source_raw_bytes");
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
      if (bytes + 2 > maximumPayload) throw recordOutputProofCapacity(new OutputConflictError("output_source_proof_too_large", 413), "private_source_binding_bytes");
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
  /** Server-only predecessor for a verified Scene operational write plan.
   * A replay has no new transition receipt and must not recapture one. */
  sceneSourceVersion?: SceneSourceVersion;
  /** Private admission receipt initialized after every command sidecar. Never
   * accepted from serialized command input or included in its public response. */
  sceneJobAdmissions?: Array<{slot:OutputOperationSlot;version:SceneSourceVersion}>;
  sceneJobRuns?: Array<{slot:OutputOperationSlot;version:SceneSourceVersion;previousRaw:string}>;
  /** Server-owned exact command envelope; committed on the same private last event. */
  retainedEnvelope?: Record<string, unknown>;
  buildSidecars?: (events: EventRow[]) => { statements: D1PreparedStatement[]; assertions?: OutputSqlAssertion[];
    /** Final same-transaction proof may join the immutable command receipt. */
    receiptAssertions?: OutputSqlAssertion[] };
};

/** The event, private body, scoped projections, grants/slots and command receipt commit together. */
export async function commitOutputCommand(env: WorkerEnv, input: OutputCommandWrite):Promise<{
  replayed:boolean;receipt:OutputCommandReceipt;events:EventRow[];sceneSourceVersion?:SceneSourceVersion;
}> {
  const previous = await readOutputCommand(env, input.scope, input.key, input.digest, { allowUnavailableReceipt: true });
  if (previous) return { replayed: true, receipt: previous, events: [] as EventRow[] };
  if (!input.events.length) throw new Error("output_event_required");
  const scope = input.scope, stream = `creative:${scope.ownerUserId}`, now = new Date().toISOString();
  if (scope.kind === "personal" && (scope.actorUserId !== scope.ownerUserId || scope.organizationId || scope.projectAccessId)) throw new OutputConflictError("invalid_output_scope", 403);
  if (scope.kind === "project" && (!scope.organizationId || !scope.projectAccessId || !scope.contextId)) throw new OutputConflictError("invalid_output_scope", 403);
  if(input.sceneSourceVersion&&(input.sceneSourceVersion.streamId!==stream
    ||(input.sceneSourceVersion.projectAccessId??null)!==scope.projectAccessId))
    throw new OutputConflictError("output_scene_source_changed",403);
  const sourceTransition=input.sceneSourceVersion?prepareSceneSourceTransition(env,input.sceneSourceVersion):null;
  const events = input.events.map((event, index) => makeEvent(stream, input.expectedHead + index + 1, `user:${scope.actorUserId}`, "server:output-requirements", input.key,
    event.type, { ...event.payload, ...(input.retainedEnvelope && index === input.events.length - 1 ? { output_command_envelope: input.retainedEnvelope } : {}), project_id: scope.projectId, document_id: scope.documentId, actor_user_id: scope.actorUserId }));
  const sceneJobInputs=[...(input.sceneJobAdmissions??[]).map(item=>({...item,phase:'admission' as const,previousRaw:null})),
    ...(input.sceneJobRuns??[]).map(item=>({...item,phase:'run' as const}))];
  if(sceneJobInputs.length>8||new Set(sceneJobInputs.map(item=>item.slot.jobId)).size!==sceneJobInputs.length)
    throw new OutputConflictError('output_scene_source_witness_unavailable',409);
  const sceneJobs=sceneJobInputs.map(item=>prepareSceneJobSourceTransition(env,{scope,slot:item.slot,
    correlationId:item.slot.jobId,predecessor:item.version,previousRaw:item.previousRaw,phase:item.phase,events}));
  const guards = [outputScopeAuthority(scope, input.permission, now),
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [stream, input.expectedHead] },
    ...(scope.kind === "project" ? [{ sql: "(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?", bindings: [scope.projectAccessId, scope.organizationId, input.expectedProjectHead] }] : []),
    ...(input.sourceAssertions ?? []), ...(input.assertions ?? []),...(sourceTransition?.before??[]),...sceneJobs.flatMap(item=>item.before)] as OutputSqlAssertion[];
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
  statements.push(...(sidecars?.receiptAssertions ?? []).flatMap(guard => outputAssertionStatements(env, guard)));
  if (scope.kind === "project") {
    statements.push(env.DB.prepare("UPDATE project_migration_states SET last_owner_sequence=?,updated_at=? WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active'")
      .bind(last.sequence, now, scope.projectAccessId, scope.organizationId, scope.ownerUserId));
    statements.push(...outputAssertionStatements(env, { sql: "changes()=1" }));
  }
  const sceneJobOffsets=sceneJobs.map(item=>{const offset=statements.length;statements.push(...item.after);return offset;});
  if(sourceTransition)statements.push(sourceTransition.after);
  let acknowledged: D1Result[];
  try { acknowledged = await env.DB.batch(statements); }
  catch (error) {
    // A competing identical command may have committed. Its immutable digest must still agree.
    const replay = await readOutputCommand(env, scope, input.key, input.digest, { allowUnavailableReceipt: true });
    if (replay) return { replayed: true, receipt: replay, events: [] as EventRow[] };
    if (String(error).includes("CHECK constraint failed") || String(error).includes("UNIQUE constraint failed")) throw new OutputConflictError("output_revision_or_authority_changed");
    throw error;
  }
  // Replayed commands have their separate immutable receipt path above. An
  // incomplete returned batch cannot certify this newly written event range.
  if (!Array.isArray(acknowledged) || acknowledged.length !== statements.length
    || Array.from({length:acknowledged.length},(_,index)=>index).some(index=>acknowledged[index]?.success !== true))
    throw new OutputConflictError("output_write_acknowledgment_invalid",409);
  const sceneSourceVersion=sourceTransition?.acknowledge(acknowledged,statements.length,statements.length-1);
  sceneJobs.forEach((item,index)=>item.acknowledge(acknowledged.slice(sceneJobOffsets[index],sceneJobOffsets[index]!+item.after.length)));
  // The acknowledged transaction wrote these exact private envelopes. Retain
  // every appended body for the final response proof, including non-last events.
  for (const event of events) {
    const values = eventWriteBindings(event);
    if (typeof values[16] !== "string") throw new Error("output_private_event_envelope_required");
    rememberOutputPrivateBody(scope, event.eventId, values[16], { projectId: values[14] as string | null, documentId: values[15] as string | null });
  }
  return { replayed: false, receipt: { action: input.action, eventId: last.eventId, payload: last.payload, createdAt: now, key: input.key, requestDigest: input.digest }, events,
    ...(sceneSourceVersion?{sceneSourceVersion}:{}) };
}
