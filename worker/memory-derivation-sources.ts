import { memoryDigest } from "../src/model/scoped-memory.ts";
import { memoryEventAction, type MemoryAction } from "../src/model/memory-observations.ts";
import { AssistantContextReadWitness } from "./assistant-context-source.ts";
import { decodeRetainedSpecialistConsent, paidMemoryBatchProof, type PaidMemoryAncestryEntry } from "./assistant-specialist-consent.ts";
import { liveMemorySourceQueryParts } from "./memory-live-sources.ts";
import { liveMemoryLifetimeProjection, liveMemorySourceDeadline } from "./memory-live-source-lifetime.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { observeNativeMemoryDocumentScope } from "./memory-native-scope.ts";
import { memoryCanonical } from "./memory-sql.ts";
import { derivationExact, derivationId, derivationInteger, derivationTime } from "./memory-derivation-policy.ts";
import { derivationResults } from "./memory-derivation-store.ts";
import { nativeDerivationLeaseInputs, nativeDerivationLeaseStatements, replayNativeDerivationLease, type NativeDerivationLease } from "./memory-derivation-admission.ts";
import type { MemoryDerivationSource } from "./memory-derivation-result.ts";
import type { WorkerEnv } from "./runtime.ts";

type Row = Record<string, unknown>;
type Query = { sql: string; bindings: (string | number | null)[] };
export type NativeDerivationObservation = Readonly<{ eventId: string; sequence: number; eventType: string; action: MemoryAction;
  recordedAt: string; scopeKey: string; blockPointer: string | null; expiresAt: string; independentEvidence: false }>;
type Backing = { streamId: string; eventId: string; sequence: number; contentRef: string; contentHash: string; turnId: string };
type CaptureData = { jobId: string; purpose: MemoryDerivationSourcePurpose; scopeKey: string; checkedAt: string; validUntil: string;
  retentionCeiling: string; originals: MemoryDerivationSource[]; originalBacking: Backing[]; observations: NativeDerivationObservation[];
  coverage: { queuedReferences: number; originalPairs: number; typedObservations: number; allReferencesCaptured: true; semanticComplete: false } };
type MemoryDerivationSourcePurpose = ReturnType<typeof nativeDerivationLeaseInputs>["grant"]["purpose"];
declare const issuedCapture: unique symbol;
export type NativeDerivationSourceCapture = Readonly<{ [issuedCapture]: true }>;
type Captured = { env: WorkerEnv; db: WorkerEnv["DB"]; lease: NativeDerivationLease; validUntil: string; witness: AssistantContextReadWitness<CaptureData> };
const captures = new WeakMap<NativeDerivationSourceCapture, Captured>();
const unavailable = () => ({ status: "unavailable" } as const);
const capacity = () => ({ status: "capacity" } as const);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const clock = () => new Date().toISOString();
const sourceColumns = ["event_id", "sequence", "type", "recorded_at", "block_id", "turn_id", "user_ref", "answer_ref", "user_text", "assistant_text", "event_json", "turn_json", "lifetime_json", "public_task_id", "private_task_id"] as const;
const originalEvent = (alias: "event" | "message") => `json_array(${["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"].map(column => alias + "." + column).join(",")})`;
const clean = (payload: string) => `json_valid(${payload}) AND COALESCE(json_extract(${payload},'$.simulation'),0)=0
  AND COALESCE(json_extract(${payload},'$.synthetic'),0)=0 AND COALESCE(json_extract(${payload},'$.origin.synthetic'),0)=0
  AND json_extract(${payload},'$.mock_data_source') IS NULL AND json_extract(${payload},'$.replay_session_id') IS NULL
  AND json_extract(${payload},'$.fictional_user_id') IS NULL`;

/** Full native Creator originals, not the eight truncated display excerpts.
 * Capture is all-or-nothing for this reference job. Oversize/unsupported jobs
 * remain incomplete; nothing is sliced, acknowledged as processed or deleted.
 * Typed observations are descriptive evidence, NOT original human quotations.
 */
export async function captureNativeDerivationSources(env: WorkerEnv, lease: NativeDerivationLease) {
  try {
    const db = env.DB, input = nativeDerivationLeaseInputs(env, lease), { enrollment: e, grant: g, authority: a, job } = input;
    if (!await replayNativeDerivationLease(env, lease) || env.DB !== db) return unavailable();
    const witness = new AssistantContextReadWitness<CaptureData>(env);
    const read = async (query: Query) => {
      nativeDerivationLeaseInputs(env, lease);
      const statement = db.prepare(query.sql).bind(...query.bindings), result = structuredClone(await statement.all<Row>());
      if (env.DB !== db || !derivationResults([result], 1)) throw Error("memory-derivation-source-read");
      nativeDerivationLeaseInputs(env, lease);
      witness.observe([statement], [result], [query]); return result.results;
    };
    const q = liveMemorySourceQueryParts(e, a), joined = `${q.joins}
      JOIN memory_derivation_job_sources queued ON queued.job_id=? AND (queued.event_id,queued.sequence)=(event.event_id,event.sequence)
      JOIN memory_live_sources remembered ON (remembered.enrollment_id,remembered.event_id,remembered.sequence,remembered.expires_at)
        =(queued.enrollment_id,queued.event_id,queued.sequence,queued.expires_at)`;
    const where = `${q.condition} AND queued.enrollment_id=? AND event.sequence>? AND event.recorded_at>=?
      AND (secret.private_json IS NULL OR (${clean("secret.private_json")})
        AND (json_extract(secret.private_json,'$.actor_user_id') IS NULL OR json_extract(secret.private_json,'$.actor_user_id')=?))`;
    const bindings = [...q.joinBindings, job.job_id, ...q.conditionBindings, e.enrollment_id, g.source_after_sequence, g.consented_at, e.actor_user_id];
    const sizes = await read({ sql: `SELECT event.event_id,event.sequence,event.type,
      length(CAST(COALESCE(authored.content,'') AS BLOB)) AS user_bytes,length(CAST(COALESCE(answer.content,'') AS BLOB)) AS answer_bytes,
      length(CAST(event.payload AS BLOB)) AS event_bytes ${joined} WHERE ${where} ORDER BY event.sequence,event.event_id LIMIT 129`, bindings });
    if (sizes.length !== input.references.length || sizes.some((row, index) => row.event_id !== input.references[index]!.event_id
      || row.sequence !== input.references[index]!.sequence || ![row.user_bytes, row.answer_bytes, row.event_bytes].every(value => derivationInteger(value)))) return unavailable();
    const pairs = sizes.filter(row => row.type === "AssistantReasoned");
    // The current citation parser accepts 128 original-role sources. Larger
    // jobs need explicit processing-window progress before any partial result.
    if (pairs.length > 64 || sizes.some(row => Number(row.user_bytes) > 16384 || Number(row.answer_bytes) > 16384)
      || sizes.reduce((sum, row) => sum + Number(row.user_bytes) + Number(row.answer_bytes) + Number(row.event_bytes), 0) > 524288) return capacity();
    const rows = await read({ sql: `SELECT event.event_id,event.sequence,event.type,event.recorded_at,json_extract(event.payload,'$.block_id') AS block_id,
      turn.turn_id,authored.content_id AS user_ref,answer.content_id AS answer_ref,authored.content AS user_text,answer.content AS assistant_text,
      ${originalEvent("event")} AS event_json,
      CASE WHEN turn.turn_id IS NULL THEN NULL ELSE json_array(turn.actor_user_id,turn.scope_key,turn.turn_id,turn.organization_id,turn.project_access_id,
        turn.project_id,turn.document_id,turn.user_content_ref,turn.assistant_content_ref,turn.status,turn.created_at,turn.completed_at) END AS turn_json,
      ${liveMemoryLifetimeProjection()},json_extract(event.payload,'$.task_id') AS public_task_id,
      CASE WHEN json_extract(event.payload,'$._private_ref')=event.event_id THEN json_extract(secret.private_json,'$.task_id') ELSE NULL END AS private_task_id
      ${joined} WHERE ${where} AND EXISTS(SELECT 1 FROM json_each(?) measured
        WHERE (json_extract(measured.value,'$.event_id'),json_extract(measured.value,'$.sequence'),json_extract(measured.value,'$.type'))
          =(event.event_id,event.sequence,event.type)
          AND json_extract(measured.value,'$.user_bytes')=length(CAST(COALESCE(authored.content,'') AS BLOB))
          AND json_extract(measured.value,'$.answer_bytes')=length(CAST(COALESCE(answer.content,'') AS BLOB))
          AND json_extract(measured.value,'$.event_bytes')=length(CAST(event.payload AS BLOB)))
      ORDER BY event.sequence,event.event_id LIMIT 129`, bindings: [...bindings, JSON.stringify(sizes)] });
    if (rows.length !== sizes.length || rows.some((row, index) => !derivationExact(row, sourceColumns)
      || row.event_id !== sizes[index]!.event_id || row.sequence !== sizes[index]!.sequence || row.type !== sizes[index]!.type)) return unavailable();
    const conversations = rows.filter(row => row.type === "AssistantReasoned");
    const expected = conversations.map(row => ({ turnId: row.turn_id, userRef: row.user_ref, answerRef: row.answer_ref, sequence: row.sequence }));
    if (expected.some(row => ![row.turnId, row.userRef, row.answerRef].every(derivationId)) || new Set(expected.map(row => row.turnId)).size !== expected.length) return unavailable();
    const scope = await observeNativeMemoryDocumentScope(env, { principal: a.principal, binding: a.binding }, e, witness);
    if (!scope || env.DB !== db) return unavailable();
    const scopeKey = memoryCanonical([scope.partitionKey, scope.documentKey]);
    const custody = e.organization_id === null ? "NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=message.event_id)"
      : `EXISTS(SELECT 1 FROM project_event_scopes custody WHERE (custody.event_id,custody.source_stream_id,custody.source_sequence,
          custody.organization_id,custody.project_access_id,custody.project_id,custody.owner_user_id,custody.actor_user_id)
          =(message.event_id,message.stream_id,message.sequence,?,?,?,?,?))`;
    const messages = expected.length ? await read({ sql: `SELECT json_extract(expected.value,'$.turnId') AS turn_id,message.event_id,message.sequence,message.recorded_at,
        ${originalEvent("message")} AS event_json FROM json_each(?) expected JOIN events message
        ON message.stream_id=? AND message.type='ChatMessageSent' AND message.actor=? AND message.client_id='web:assistant'
          AND message.correlation_id=?||':'||json_extract(expected.value,'$.turnId')
          AND (json_extract(message.payload,'$.turn_id'),json_extract(message.payload,'$.content_ref'),json_extract(message.payload,'$.project_id'),json_extract(message.payload,'$.document_id'))
            =(json_extract(expected.value,'$.turnId'),json_extract(expected.value,'$.userRef'),?,?)
        LEFT JOIN event_private_payloads secret ON secret.private_event_id=message.event_id
        WHERE message.sequence>? AND message.sequence<json_extract(expected.value,'$.sequence') AND message.recorded_at>=?
          AND length(CAST(message.payload AS BLOB))<=16384
          AND message.recorded_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND message.event_id NOT LIKE 'optimistic:%'
          AND (json_extract(message.payload,'$.actor_user_id') IS NULL OR json_extract(message.payload,'$.actor_user_id')=?)
          AND (${clean("message.payload")}) AND (json_extract(message.payload,'$._private_ref') IS NULL
            OR json_extract(message.payload,'$._private_ref')=message.event_id AND (secret.owner_id,secret.project_id,secret.document_id,secret.redacted_at) IS (?,?,?,NULL)
              AND (${clean("secret.private_json")}) AND (json_extract(secret.private_json,'$.actor_user_id') IS NULL
                OR json_extract(secret.private_json,'$.actor_user_id')=?)) AND (${custody}) ORDER BY message.sequence,message.event_id LIMIT 129`,
      bindings: [JSON.stringify(expected), a.binding.streamId, "user:" + e.actor_user_id, e.actor_user_id, e.project_id, e.document_id,
        g.source_after_sequence, g.consented_at, e.actor_user_id, e.owner_user_id, e.project_id, e.document_id, e.actor_user_id,
        ...(e.organization_id === null ? [] : [e.organization_id, e.project_access_id, e.project_id, e.owner_user_id, e.actor_user_id])] }) : [];
    if (messages.length !== expected.length || expected.some(row => messages.filter(message => message.turn_id === row.turnId).length !== 1)) return unavailable();
    const paidFrom = `FROM json_each(?) expected JOIN assistant_specialist_tasks task ON (task.actor_user_id,task.scope_key,task.turn_id)=(?,?,json_extract(expected.value,'$.turnId'))
      LEFT JOIN consequential_executions execution ON execution.execution_id=task.task_id AND execution.actor_user_id=task.actor_user_id
      LEFT JOIN private_content approved ON approved.content_id=execution.consent_ref AND approved.owner_id=execution.actor_user_id`;
    const paidBindings = [JSON.stringify(expected), e.actor_user_id, a.scopeKey];
    const paidSizes = expected.length ? await read({ sql: `SELECT task.task_id,length(CAST(approved.content AS BLOB)) AS bytes ${paidFrom} ORDER BY task.task_id LIMIT 65`, bindings: paidBindings }) : [];
    if (paidSizes.length > expected.length || paidSizes.some(row => !derivationInteger(row.bytes))) return unavailable();
    if (paidSizes.reduce((sum, row) => sum + Number(row.bytes), 0) > 524288) return capacity();
    const paid = paidSizes.length ? await read({ sql: `SELECT task.task_id,task.turn_id,execution.binding_hash,execution.intent_hash,approved.content_id,approved.content,
      approved.expires_at,approved.redacted_at,approved.kind ${paidFrom}
      WHERE EXISTS(SELECT 1 FROM json_each(?) measured WHERE json_extract(measured.value,'$.task_id')=task.task_id
        AND json_extract(measured.value,'$.bytes')=length(CAST(approved.content AS BLOB)))
      ORDER BY task.task_id LIMIT 65`, bindings: [...paidBindings, JSON.stringify(paidSizes)] }) : [];
    if (paid.length !== paidSizes.length || paid.some((row, index) => row.task_id !== paidSizes[index]!.task_id || typeof row.content !== "string"
      || bytes(row.content) !== paidSizes[index]!.bytes || row.kind !== "execution-consent" || row.redacted_at !== null)) return unavailable();
    const groups: { turnId: string; entries: PaidMemoryAncestryEntry[] }[] = [];
    for (const row of paid) {
      const decoded = await decodeRetainedSpecialistConsent(String(row.content), { binding_hash: String(row.binding_hash), intent_hash: String(row.intent_hash) },
        e.actor_user_id, a.scopeKey, String(row.turn_id), String(row.task_id));
      if (!decoded || !Array.isArray(decoded.request.conversation) || decoded.binding.projectId !== e.project_id || decoded.binding.documentId !== e.document_id
        || decoded.binding.streamId !== a.binding.streamId || memoryCanonical(decoded.binding.scope) !== memoryCanonical(a.binding.scope)) return unavailable();
      const own = expected.find(item => item.turnId === row.turn_id);
      if (!own || decoded.request.turn.user_content_ref !== own.userRef || decoded.request.turn.assistant_content_ref !== own.answerRef
        || decoded.request.conversation.some(entry => !entry || ![entry.turnId, entry.userRef, entry.answerRef].every(derivationId))) return unavailable();
      groups.push({ turnId: String(row.turn_id), entries: [...decoded.request.conversation.map(entry => ({ turnId: entry.turnId, userRef: entry.userRef, answerRef: entry.answerRef })),
        { turnId: String(row.turn_id), userRef: decoded.request.turn.user_content_ref, answerRef: decoded.request.turn.assistant_content_ref }] });
    }
    if (expected.length) {
      const [authored, answer] = await Promise.all([nativeMemoryAnswerExclusion(env, { answerAlias: "authored", turnAlias: "turn" }),
        nativeMemoryAnswerExclusion(env, { answerAlias: "answer", turnAlias: "turn" })]);
      witness.require({ sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected JOIN assistant_turns turn
        ON (turn.actor_user_id,turn.scope_key,turn.turn_id)=(?,?,json_extract(expected.value,'$.turnId'))
        JOIN private_content authored ON authored.content_id=turn.user_content_ref JOIN private_content answer ON answer.content_id=turn.assistant_content_ref
        WHERE NOT (${authored.sql}) OR NOT (${answer.sql}))`, bindings: [JSON.stringify(expected), e.actor_user_id, a.scopeKey, ...authored.bindings, ...answer.bindings] });
      if (groups.length) witness.require(await paidMemoryBatchProof(env, e.actor_user_id, a.scopeKey, groups));
    }
    const checkedAt = clock(), at = Date.parse(checkedAt), originals: MemoryDerivationSource[] = [], originalBacking: Backing[] = [], observations: NativeDerivationObservation[] = [];
    const ceilings = [job.expires_at, g.expires_at, input.qualification.row.expires_at];
    for (const row of rows) {
      if (!derivationTime(row.recorded_at) || !derivationId(row.event_id) || !derivationInteger(row.sequence, 1)
        || !(row.block_id === null || derivationId(row.block_id))) return unavailable();
      const deadline = liveMemorySourceDeadline(row as unknown as Parameters<typeof liveMemorySourceDeadline>[0], e, at);
      if (!deadline) return unavailable();
      const local = [deadline, ...ceilings, new Date(Date.parse(row.recorded_at) + g.retention_days * 86400000).toISOString()];
      if (row.type === "AssistantReasoned") {
        const message = messages.find(value => value.turn_id === row.turn_id)!;
        if (!derivationTime(message.recorded_at) || !derivationId(message.event_id) || !derivationInteger(message.sequence, 1)) return unavailable();
        local.push(new Date(Date.parse(message.recorded_at) + g.retention_days * 86400000).toISOString());
        const event = JSON.parse(String(row.event_json)), userEvent = JSON.parse(String(message.event_json));
        const paidTask = paid.find(value => value.turn_id === row.turn_id);
        if (paidTask ? event[6] !== "server:assistant" || event[7] !== paidTask.task_id
          || row.public_task_id === null && row.private_task_id === null
          || row.public_task_id !== null && row.public_task_id !== paidTask.task_id || row.private_task_id !== null && row.private_task_id !== paidTask.task_id
          : event[6] !== "web:assistant" || event[8] !== message.event_id || event[7] !== userEvent[7]
            || row.public_task_id !== null || row.private_task_id !== null) return unavailable();
        const expiresAt = local.sort()[0]!, lineageId = await memoryDigest(memoryCanonical([scopeKey, row.turn_id]));
        for (const role of ["user", "assistant"] as const) {
          const text = role === "user" ? row.user_text : row.assistant_text, sourceId = role === "user" ? message.event_id : row.event_id,
            revision = role === "user" ? message.sequence : row.sequence, contentRef = role === "user" ? row.user_ref : row.answer_ref;
          if (typeof text !== "string" || !text.isWellFormed() || !derivationId(contentRef) || expiresAt <= checkedAt) return unavailable();
          const contentHash = await memoryDigest(text);
          originals.push({ sourceId, revision, contentHash, lineageId, scopeKey, text, expiresAt, role, kind: "message", authorship: role === "user" ? "original-human" : "original-assistant" });
          originalBacking.push({ streamId: a.binding.streamId, eventId: sourceId, sequence: revision, contentRef, contentHash, turnId: String(row.turn_id) });
        }
      } else {
        const action = memoryEventAction(String(row.type)), expiresAt = local.sort()[0]!;
        if (!action || action === "attention" || action === "navigate" || expiresAt <= checkedAt) return unavailable();
        observations.push({ eventId: row.event_id, sequence: row.sequence, eventType: String(row.type), action, recordedAt: row.recorded_at,
          scopeKey, blockPointer: row.block_id, expiresAt, independentEvidence: false });
      }
    }
    if (bytes(JSON.stringify(originals)) > 460000 || new Set(originals.map(source => source.sourceId)).size !== originals.length) return capacity();
    const retentionCeiling = [...ceilings, ...originals.map(row => row.expiresAt), ...observations.map(row => row.expiresAt)].sort()[0]!;
    const validUntil = [input.validUntil, retentionCeiling].sort()[0]!;
    const data: CaptureData = { jobId: job.job_id, purpose: g.purpose, scopeKey, checkedAt, validUntil, retentionCeiling, originals, originalBacking, observations,
      coverage: { queuedReferences: rows.length, originalPairs: originals.length / 2, typedObservations: observations.length, allReferencesCaptured: true, semanticComplete: false } };
    witness.before(validUntil); witness.seal(data);
    const captured: Captured = { env, db, lease, validUntil, witness }, handle = Object.freeze({}) as NativeDerivationSourceCapture;
    captures.set(handle, captured);
    if (!await replayNativeDerivationSources(env, handle)) { captures.delete(handle); return unavailable(); }
    return { status: "captured", capture: handle } as const;
  } catch { return unavailable(); }
}

function lookup(env: WorkerEnv, handle: NativeDerivationSourceCapture) {
  const captured = captures.get(handle);
  if (!captured || captured.env !== env || captured.db !== env.DB || captured.validUntil <= clock()) throw Error("memory-derivation-source-unavailable");
  nativeDerivationLeaseInputs(env, captured.lease); return captured;
}
/** Copied staging data, not permission to use a source. Keep the issued handle:
 * every publication must include source statements in its same atomic batch;
 * any provider dispatch must first replay the current source and native proof.
 */
export function nativeDerivationSourceInputs(env: WorkerEnv, handle: NativeDerivationSourceCapture) {
  return lookup(env, handle).witness.context()!;
}
export function nativeDerivationSourceStatements(env: WorkerEnv, handle: NativeDerivationSourceCapture) {
  const captured = lookup(env, handle), lease = nativeDerivationLeaseStatements(env, captured.lease), source = captured.witness.precommitStatements();
  if (lease.length + source.length > 32) throw Error("memory-derivation-source-capacity");
  return [...lease, ...source];
}
export async function replayNativeDerivationSources(env: WorkerEnv, handle: NativeDerivationSourceCapture) {
  try {
    const captured = lookup(env, handle), statements = nativeDerivationSourceStatements(env, handle), leaseCount = nativeDerivationLeaseStatements(env, captured.lease).length;
    const result = structuredClone(await captured.db.batch<Row>(statements));
    return lookup(env, handle) === captured && derivationResults(result, statements.length) && result.every((entry, index) => {
      const field = index < leaseCount ? "verified" : "context_source_asserted";
      return entry.results.length === 1 && derivationExact(entry.results[0], [field]) && entry.results[0][field] === 1;
    });
  } catch { return false; }
}
