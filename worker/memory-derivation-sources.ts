import { observeNativeMemoryRelationBindings, type NativeMemoryRelationBindings } from './memory-native-relations.ts';
import { observeNativeMemoryBlockBindings, type NativeMemoryBlockBindings } from './memory-native-blocks.ts';
import { captureLegacyConversationOriginalWindows, replayLegacyConversationOriginals, prepareLegacyConversationOriginalsCommit, type LegacyConversationOriginalsCommit } from "./events-api.ts";
import { nativeDerivationRequestBody, nativeDerivationRequestFits } from './memory-derivation-request.ts';
import { captureNativeArtifactConsumption } from './memory-native-artifact-consumption.ts';
import { memoryDigest } from "../src/model/scoped-memory.ts";
import { memoryEventAction, type MemoryAction } from "../src/model/memory-observations.ts";
import { AssistantContextReadWitness } from "./assistant-context-source.ts";
import { decodeRetainedSpecialistConsent, paidMemoryBatchProof, type PaidMemoryAncestryEntry } from "./assistant-specialist-consent.ts";
import { liveMemorySourceQueryParts } from "./memory-live-sources.ts";
import { liveMemoryLifetimeProjection, liveMemorySourceDeadline } from "./memory-live-source-lifetime.ts";
import { captureNativeMemoryTurnExclusions, nativeMemoryTurnExclusionInputs } from "./memory-native-boundary.ts";
import { observeNativeMemoryDocumentScope, nativeMemoryDocumentIdentity, nativeMemoryArtifactIdentity, type NativeMemoryDocumentScope } from "./memory-native-scope.ts";
import { memoryCanonical } from "./memory-sql.ts";
import { derivationExact, derivationHash, derivationId, derivationInteger, derivationTime } from "./memory-derivation-policy.ts";
import { derivationResults } from "./memory-derivation-store.ts";
import { nativeDerivationEvidenceInputs, nativeDerivationEvidenceStatements, replayNativeDerivationEvidence, observeNativeDerivationHistoryJob, type NativeDerivationEvidence } from "./memory-derivation-admission.ts";
import type { MemoryDerivationSource } from "./memory-derivation-result.ts";
import type { WorkerEnv } from "./runtime.ts";

type Row = Record<string, unknown>;
type Query = { sql: string; bindings: (string | number | null)[] };
export type NativeDerivationObservation = Readonly<{ eventId: string; sequence: number; eventType: string; action: MemoryAction;
  recordedAt: string; scopeKey: string; blockPointer: string | null; expiresAt: string; independentEvidence: false }>;
type Backing = { streamId: string; eventId: string; sequence: number; contentRef: string; contentHash: string; turnId: string };
export type NativeDerivationProvenance = {
  /** Hashes and private inverse keys, never a persisted access grant. */
  events: { streamId: string; eventId: string; sequence: number; sha256: string }[];
  turns: { actorUserId: string; scopeKey: string; turnId: string; sha256: string }[];
  paid: { taskId: string; turnId: string; consentRef: string; consentSha256: string; resultRef: string;
    bindingHash: string; intentHash: string; ancestry: PaidMemoryAncestryEntry[] }[];
  artifacts?: { eventId:string; contentRef:string; eventIds:string[] }[];
  blockBindings?: NativeMemoryBlockBindings;
  relationBindings?: NativeMemoryRelationBindings;
  sourceRowsSha256: string;
};
export type NativeDerivationHistory = { version: 1; windowJobIds: string[]; afterSequence: number; throughSequence: number; boundary: "consent" | "bounded" | "capacity"; originalPairs: number };
type CaptureData = { jobId: string; purpose: MemoryDerivationSourcePurpose; scopeKey: string; checkedAt: string; validUntil: string;
  binding: { actorUserId: string; consentId: string; grantId: string; grantRevision: number; enrollmentId: string;
    enrollmentRevision: number; termsSha256: string; afterSequence: number; throughSequence: number };
  retentionCeiling: string; originals: MemoryDerivationSource[]; originalBacking: Backing[]; observations: NativeDerivationObservation[];
  provenance: NativeDerivationProvenance; history?: NativeDerivationHistory;
  coverage: { queuedReferences: number; originalPairs: number; typedObservations: number; excludedByUserControls?: number; allReferencesCaptured: true; semanticComplete: false } };
type MemoryDerivationSourcePurpose = ReturnType<typeof nativeDerivationEvidenceInputs>["grant"]["purpose"];
declare const issuedCapture: unique symbol;
export type NativeDerivationSourceCapture = Readonly<{ [issuedCapture]: true }>;
type Captured = { env: WorkerEnv; db: WorkerEnv["DB"]; lease: NativeDerivationEvidence; validUntil: string; witness: AssistantContextReadWitness<CaptureData>; parts?: NativeDerivationSourceCapture[]; legacy?: LegacyConversationOriginalsCommit; evidences?: NativeDerivationEvidence[]; documentScope?:NativeMemoryDocumentScope; relationObservations?:Parameters<typeof observeNativeMemoryRelationBindings>[2] };
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
async function captureNativeDerivationWindow(env: WorkerEnv, lease: NativeDerivationEvidence, bindBlocks = true, bindRelations?:boolean, deferReplay=false, parentScope?:NativeMemoryDocumentScope) {
  try {
    if(nativeDerivationEvidenceInputs(env,lease).producer==='chat-studio')return await captureChatStudioDerivationWindow(env,lease);
    const db = env.DB, input = nativeDerivationEvidenceInputs(env, lease), { enrollment: e, grant: g, authority: a, job } = input;
    if(bindRelations===true&&(!input.relationsPresent||!input.lifecyclePresent))return unavailable();
    if (!await replayNativeDerivationEvidence(env, lease) || env.DB !== db) return unavailable();
    const witness = new AssistantContextReadWitness<CaptureData>(env);
    const read = async (query: Query) => {
      nativeDerivationEvidenceInputs(env, lease);
      const statement = db.prepare(query.sql).bind(...query.bindings), result = structuredClone(await statement.all<Row>());
      if (env.DB !== db || !derivationResults([result], 1)) throw Error("memory-derivation-source-read");
      nativeDerivationEvidenceInputs(env, lease);
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
    // The queue includes separately certified artifact observations. They must
    // not be silently dropped or admitted through the assistant-only predicate.
    // Both descriptor/size selections depend only on the issued job. Their
    // independent full snapshots are retained in one native binding call.
    const queries:Query[]=[{sql:`SELECT queued.event_id,queued.sequence,event.type,event.recorded_at
      FROM memory_derivation_job_sources queued JOIN events event ON (event.event_id,event.sequence)=(queued.event_id,queued.sequence)
      WHERE queued.job_id=? AND event.stream_id=? ORDER BY event.sequence,event.event_id LIMIT 129`,bindings:[job.job_id,a.binding.streamId]},{ sql: `SELECT event.event_id,event.sequence,event.type,
      length(CAST(COALESCE(authored.content,'') AS BLOB)) AS user_bytes,length(CAST(COALESCE(answer.content,'') AS BLOB)) AS answer_bytes,
      length(CAST(event.payload AS BLOB)) AS event_bytes ${joined} WHERE ${where} ORDER BY event.sequence,event.event_id LIMIT 129`, bindings }];
    const statements=queries.map(query=>db.prepare(query.sql).bind(...query.bindings));
    const measured=structuredClone(await db.batch<Row>(statements));
    if(env.DB!==db||!derivationResults(measured,queries.length))return unavailable();
    nativeDerivationEvidenceInputs(env,lease);witness.observe(statements,measured,queries);
    const inventory=measured[0]!.results,sizes=measured[1]!.results;
    if(inventory.length!==input.references.length||inventory.some((row,i)=>!derivationExact(row,['event_id','sequence','type','recorded_at'])
      ||row.event_id!==input.references[i]!.event_id||row.sequence!==input.references[i]!.sequence))return unavailable();
    const artifactRefs=inventory.filter(row=>row.type==='DocumentArtifactViewed');
    if(artifactRefs.length&&!input.lifecyclePresent)return unavailable();
    const regularRefs=input.references.filter(ref=>!artifactRefs.some(row=>row.event_id===ref.event_id));
    const artifactCapture=artifactRefs.length?await captureNativeArtifactConsumption(env,e,a,
      {after:job.after_sequence,through:job.through_sequence,remembered:true,historical:true},witness):null;
    if(artifactCapture&&(artifactCapture.truncated||artifactCapture.sources.length!==artifactRefs.length
      ||artifactCapture.sources.some(source=>!artifactRefs.some(ref=>ref.event_id===source.eventId&&ref.sequence===source.sequence)
        ||source.recordedAt<g.consented_at)))return unavailable();
    if (sizes.length !== regularRefs.length || sizes.some((row, index) => row.event_id !== regularRefs[index]!.event_id
      || row.sequence !== regularRefs[index]!.sequence || ![row.user_bytes, row.answer_bytes, row.event_bytes].every(value => derivationInteger(value)))) return unavailable();
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
    const scope = parentScope?nativeMemoryDocumentIdentity(e):await observeNativeMemoryDocumentScope(env, { principal: a.principal, binding: a.binding }, e, witness);
    if(parentScope&&memoryCanonical(parentScope)!==memoryCanonical(scope))return unavailable();
    if (!scope || env.DB !== db) return unavailable();
    const scopeKey = memoryCanonical([scope.partitionKey, scope.documentKey]);
    const custody = e.organization_id === null ? "NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=message.event_id)"
      : `EXISTS(SELECT 1 FROM project_event_scopes custody WHERE (custody.event_id,custody.source_stream_id,custody.source_sequence,
          custody.organization_id,custody.project_access_id,custody.project_id,custody.owner_user_id,custody.actor_user_id)
          =(message.event_id,message.stream_id,message.sequence,?,?,?,?,?))`;
    const paidFrom = `FROM json_each(?) expected JOIN assistant_specialist_tasks task ON (task.actor_user_id,task.scope_key,task.turn_id)=(?,?,json_extract(expected.value,'$.turnId'))
      LEFT JOIN consequential_executions execution ON execution.execution_id=task.task_id AND execution.actor_user_id=task.actor_user_id
      LEFT JOIN private_content approved ON approved.content_id=execution.consent_ref AND approved.owner_id=execution.actor_user_id`;
    const paidBindings = [JSON.stringify(expected), e.actor_user_id, a.scopeKey];
    let messages:Row[]=[],paidSizes:Row[]=[];
    if(expected.length){
      const queries:Query[]=[{ sql: `SELECT json_extract(expected.value,'$.turnId') AS turn_id,message.event_id,message.sequence,message.recorded_at,
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
        ...(e.organization_id === null ? [] : [e.organization_id, e.project_access_id, e.project_id, e.owner_user_id, e.actor_user_id])] },{ sql: `SELECT task.task_id,length(CAST(approved.content AS BLOB)) AS bytes ${paidFrom} ORDER BY task.task_id LIMIT 65`, bindings: paidBindings }];
      const statements=queries.map(query=>db.prepare(query.sql).bind(...query.bindings)),result=structuredClone(await db.batch<Row>(statements));
      if(env.DB!==db||!derivationResults(result,2))return unavailable();
      nativeDerivationEvidenceInputs(env,lease);witness.observe(statements,result,queries);
      messages=result[0]!.results;paidSizes=result[1]!.results;
    }
    if (messages.length !== expected.length || expected.some(row => messages.filter(message => message.turn_id === row.turnId).length !== 1)) return unavailable();
    if (paidSizes.length > expected.length || paidSizes.some(row => !derivationInteger(row.bytes))) return unavailable();
    if (paidSizes.reduce((sum, row) => sum + Number(row.bytes), 0) > 524288) return capacity();
    const paid = paidSizes.length ? await read({ sql: `SELECT task.task_id,task.turn_id,execution.binding_hash,execution.intent_hash,execution.result_ref,approved.content_id,approved.content,
      approved.expires_at,approved.redacted_at,approved.kind ${paidFrom}
      WHERE EXISTS(SELECT 1 FROM json_each(?) measured WHERE json_extract(measured.value,'$.task_id')=task.task_id
        AND json_extract(measured.value,'$.bytes')=length(CAST(approved.content AS BLOB)))
      ORDER BY task.task_id LIMIT 65`, bindings: [...paidBindings, JSON.stringify(paidSizes)] }) : [];
    if (paid.length !== paidSizes.length || paid.some((row, index) => row.task_id !== paidSizes[index]!.task_id || typeof row.content !== "string"
      || bytes(row.content) !== paidSizes[index]!.bytes || row.kind !== "execution-consent" || row.redacted_at !== null || !derivationId(row.result_ref))) return unavailable();
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
      const exclusions=await captureNativeMemoryTurnExclusions(env);
      const {authored,answer}=nativeMemoryTurnExclusionInputs(env,exclusions);
      witness.require({ sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected JOIN assistant_turns turn
        ON (turn.actor_user_id,turn.scope_key,turn.turn_id)=(?,?,json_extract(expected.value,'$.turnId'))
        JOIN private_content authored ON authored.content_id=turn.user_content_ref JOIN private_content answer ON answer.content_id=turn.assistant_content_ref
        WHERE NOT (${authored.sql}) OR NOT (${answer.sql}))`, bindings: [JSON.stringify(expected), e.actor_user_id, a.scopeKey, ...authored.bindings, ...answer.bindings] });
      if (groups.length) witness.require(await paidMemoryBatchProof(env, e.actor_user_id, a.scopeKey, groups, exclusions));
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
    for(const artifact of artifactCapture?.sources??[]){
      const expiresAt=[artifact.validUntil,...ceilings,new Date(Date.parse(artifact.recordedAt)+g.retention_days*86400000).toISOString()].sort()[0]!;
      if(expiresAt<=checkedAt)return unavailable();
      const artifactScope=nativeMemoryArtifactIdentity(e,artifact.target.artifactId);if(!artifactScope)return unavailable();
      observations.push({eventId:artifact.eventId,sequence:artifact.sequence,eventType:'DocumentArtifactViewed',action:'inspect',recordedAt:artifact.recordedAt,
        scopeKey:memoryCanonical([artifactScope.partitionKey,artifactScope.artifactKey]),blockPointer:null,expiresAt,independentEvidence:false});
    }
    observations.sort((left,right)=>left.sequence-right.sequence);
    const blockBindings=bindBlocks?await observeNativeMemoryBlockBindings(env,e,observations,witness):undefined;
    const relationObservations=rows.map(row=>({eventId:String(row.event_id),sequence:Number(row.sequence),eventType:String(row.type),relationId:JSON.parse(String(JSON.parse(String(row.event_json))[12])).relation_id??null}));
    const relationBindings=bindRelations!==false&&input.relationsPresent&&input.lifecyclePresent?await observeNativeMemoryRelationBindings(env,e,relationObservations,witness):undefined;
    const retentionCeiling = [...ceilings, ...originals.map(row => row.expiresAt), ...observations.map(row => row.expiresAt)].sort()[0]!;
    let excludedByUserControls = 0;
    if (input.userControlsPresent && originals.length) {
      // Native read witness includes both presence and absence. A concurrent
      // correction/release invalidates provider and publication proofs.
      const controls = await read({ sql: `SELECT lineage_id,revision,action,expires_at FROM memory_derivation_user_controls
        WHERE enrollment_id=? AND actor_user_id=? AND purpose=? AND scope_key=? AND lineage_id IN(SELECT value FROM json_each(?))
        ORDER BY lineage_id LIMIT 65`, bindings: [e.enrollment_id,e.actor_user_id,g.purpose,scopeKey,JSON.stringify([...new Set(originals.map(row=>row.lineageId))])] });
      if (controls.length>64 || controls.some(row=>!derivationExact(row,['lineage_id','revision','action','expires_at'])
        || !derivationHash(row.lineage_id) || !derivationInteger(row.revision,1) || !['suppressed','corrected','released'].includes(String(row.action))
        || !derivationTime(row.expires_at))) return unavailable();
      const blocked = new Set(controls.filter(row=>row.action!=='released' && String(row.expires_at)>checkedAt).map(row=>row.lineage_id));
      const kept = originals.filter(row=>!blocked.has(row.lineageId));excludedByUserControls=(originals.length-kept.length)/2;
      originals.splice(0,originals.length,...kept);
      for(const row of controls)if(String(row.expires_at)>checkedAt)witness.before(String(row.expires_at));
    }
    const validUntil = [input.validUntil, retentionCeiling].sort()[0]!;
    // Keep every input, including uncited originals and observations. These
    // descriptors enable later exact manifest comparison and targeted erasure;
    // they do not replace fresh native custody, access or negative-ancestry proofs.
    const provenance: NativeDerivationProvenance = {
      events: await Promise.all([...rows, ...messages].map(async row => ({ streamId: a.binding.streamId,
        eventId: String(row.event_id), sequence: Number(row.sequence), sha256: await memoryDigest(String(row.event_json)) }))),
      turns: await Promise.all(conversations.map(async row => ({ actorUserId: e.actor_user_id, scopeKey: a.scopeKey,
        turnId: String(row.turn_id), sha256: await memoryDigest(String(row.turn_json)) }))),
      paid: await Promise.all(paid.map(async row => ({ taskId: String(row.task_id), turnId: String(row.turn_id),
        consentRef: String(row.content_id), consentSha256: await memoryDigest(String(row.content)), resultRef: String(row.result_ref),
        bindingHash: String(row.binding_hash), intentHash: String(row.intent_hash), ancestry: groups.find(group => group.turnId === row.turn_id)!.entries }))),
      ...(artifactCapture?{artifacts:artifactCapture.provenance}:{}),
      ...(blockBindings?{blockBindings}:{}),
      ...(relationBindings?{relationBindings}:{}),
      sourceRowsSha256: await memoryDigest(memoryCanonical({ rows, messages, paid, ...(artifactCapture?{artifacts:artifactCapture.sources,artifactProvenance:artifactCapture.provenance}:{}) })),
    };
    const data: CaptureData = { jobId: job.job_id, purpose: g.purpose, scopeKey, checkedAt, validUntil, retentionCeiling, originals, originalBacking, observations, provenance,
      binding: { actorUserId: e.actor_user_id, consentId: g.consent_id, grantId: g.grant_id, grantRevision: g.revision,
        enrollmentId: e.enrollment_id, enrollmentRevision: g.enrollment_revision, termsSha256: g.terms_sha256,
        afterSequence: job.after_sequence, throughSequence: job.through_sequence },
      coverage: { queuedReferences: inventory.length, originalPairs: originals.length / 2, typedObservations: observations.length, ...(excludedByUserControls?{excludedByUserControls}:{}), allReferencesCaptured: true, semanticComplete: false } };
    witness.before(validUntil); witness.seal(data);
    const captured: Captured = { env, db, lease, validUntil, witness,documentScope:scope,relationObservations }, handle = Object.freeze({}) as NativeDerivationSourceCapture;
    captures.set(handle, captured);
    if (!deferReplay&&!await replayNativeDerivationSources(env, handle)) { captures.delete(handle); return unavailable(); }
    return { status: "captured", capture: handle } as const;
  } catch { return unavailable(); }
}

/** A single native legacy capture proves the complete selected original window
 * union. Historical jobs retain separate read-only consent/reference assertions;
 * batching source custody does not cache authority or reuse model prose. */
async function captureChatStudioDerivationWindow(env: WorkerEnv, lease: NativeDerivationEvidence,
  history?:{evidence:NativeDerivationEvidence[];query:Query;result:D1Result<Row>;boundary:NativeDerivationHistory['boundary']}) {
  try {
    const db=env.DB,input=nativeDerivationEvidenceInputs(env,lease),{enrollment:e,grant:g,authority:a,job}=input;
    const evidences=[...(history?.evidence??[]),lease],inputs=evidences.map(value=>nativeDerivationEvidenceInputs(env,value));
    if(inputs.some(value=>value.producer!=='chat-studio'||value.references.length!==1||value.grant.consent_id!==g.consent_id)
      ||!await replayNativeDerivationEvidence(env,lease))return unavailable();
    const witness=new AssistantContextReadWitness<CaptureData>(env);
    if(history)witness.observe([db.prepare(history.query.sql).bind(...history.query.bindings)],[history.result],[history.query]);
    const read=async(query:Query)=>{
      const statement=db.prepare(query.sql).bind(...query.bindings),result=structuredClone(await statement.all<Row>());
      for(const evidence of evidences)nativeDerivationEvidenceInputs(env,evidence);
      if(env.DB!==db||!derivationResults([result],1))throw Error('memory-chat-source-unavailable');
      witness.observe([statement],[result],[query]);return result.results;
    };
    const expected=inputs.map(value=>({eventId:value.references[0]!.event_id,sequence:value.references[0]!.sequence}));
    const rows=await read({sql:`SELECT answer.event_id,answer.sequence,message.sequence AS user_sequence,
      (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=answer.stream_id) AS head
      FROM json_each(?) expected JOIN events answer ON (answer.event_id,answer.sequence)=(json_extract(expected.value,'$.eventId'),json_extract(expected.value,'$.sequence'))
      JOIN events message ON message.event_id=answer.causation_id AND message.stream_id=answer.stream_id
      WHERE answer.stream_id=? AND answer.type='AssistantReasoned' AND answer.actor='model:forma-chat' AND message.type='ChatMessageSent'
      ORDER BY answer.sequence LIMIT 4`,bindings:[JSON.stringify(expected),a.binding.streamId]});
    if(rows.length!==inputs.length||rows.some((row,index)=>row.event_id!==expected[index]!.eventId||row.sequence!==expected[index]!.sequence
      ||!derivationInteger(row.user_sequence,g.source_after_sequence+1,Number(row.sequence)-1)||!derivationInteger(row.head,job.through_sequence)))return unavailable();
    const prepared={principal:a.principal,binding:a.binding,sourceHead:Number(rows[0]!.head)};
    const capture=await captureLegacyConversationOriginalWindows(env,prepared,rows.map(row=>({afterSequence:Number(row.user_sequence)-1,throughSequence:Number(row.sequence)})));
    const receipt=capture&&await replayLegacyConversationOriginals(env,prepared,capture);
    if(!capture||!receipt||receipt.originals.length!==rows.length*2)return unavailable();
    const originals=receipt.originals,users=originals.filter(value=>value.role==='user'),answers=originals.filter(value=>value.role==='assistant');
    if(users.length!==rows.length||answers.length!==rows.length||rows.some((row,index)=>answers[index]!.eventId!==row.event_id
      ||answers[index]!.sequence!==row.sequence||users[index]!.sequence!==row.user_sequence)
      ||originals.some(value=>value.recordedAt<g.consented_at||value.sequence<=g.source_after_sequence))return unavailable();
    const scope=await observeNativeMemoryDocumentScope(env,prepared,e,witness);if(!scope)return unavailable();
    const scopeKey=memoryCanonical([scope.partitionKey,scope.documentKey]);
    const lineages=new Map(await Promise.all(users.map(async value=>[value.turnId,await memoryDigest(memoryCanonical([scopeKey,value.turnId]))] as const)));
    const events=await read({sql:`SELECT event_id,sequence,${originalEvent('event')} AS event_json FROM events event
      WHERE stream_id=? AND event_id IN(SELECT value FROM json_each(?)) AND length(CAST(payload AS BLOB))<=16384 ORDER BY sequence`,
      bindings:[a.binding.streamId,JSON.stringify([...originals.map(value=>value.eventId),...users.map(value=>value.causationId)])]});
    if(events.length!==rows.length*3)return unavailable();
    const checkedAt=clock(),retentionCeiling=[...inputs.map(value=>value.job.expires_at),g.expires_at,input.qualification.row.expires_at,
      ...originals.flatMap(value=>[value.expiresAt,new Date(Date.parse(value.recordedAt)+g.retention_days*86400000).toISOString()])].sort()[0]!;
    const blocked=new Set<string>();
    if(input.userControlsPresent){
      const controls=await read({sql:`SELECT lineage_id,revision,action,expires_at FROM memory_derivation_user_controls
        WHERE enrollment_id=? AND actor_user_id=? AND purpose=? AND scope_key=? AND lineage_id IN(SELECT value FROM json_each(?)) ORDER BY lineage_id LIMIT 4`,
        bindings:[e.enrollment_id,e.actor_user_id,g.purpose,scopeKey,JSON.stringify([...lineages.values()])]});
      if(controls.length>users.length||controls.some(value=>!derivationExact(value,['lineage_id','revision','action','expires_at'])
        ||![...lineages.values()].includes(String(value.lineage_id))||!derivationInteger(value.revision,1)||!derivationTime(value.expires_at)
        ||!['suppressed','corrected','released'].includes(String(value.action))))return unavailable();
      for(const value of controls)if(String(value.expires_at)>checkedAt){witness.before(String(value.expires_at));if(value.action!=='released')blocked.add(String(value.lineage_id));}
    }
    const validUntil=[...inputs.map(value=>value.validUntil),receipt.validUntil,retentionCeiling].sort()[0]!;
    const selected=originals.filter(value=>!blocked.has(lineages.get(value.turnId)!));
    const data:CaptureData={jobId:job.job_id,purpose:g.purpose,scopeKey,checkedAt,validUntil,retentionCeiling,
      binding:{actorUserId:e.actor_user_id,consentId:g.consent_id,grantId:g.grant_id,grantRevision:g.revision,enrollmentId:e.enrollment_id,
        enrollmentRevision:g.enrollment_revision,termsSha256:g.terms_sha256,afterSequence:job.after_sequence,throughSequence:job.through_sequence},
      originals:selected.map(value=>({sourceId:value.eventId,revision:value.sequence,contentHash:value.contentHash,lineageId:lineages.get(value.turnId)!,scopeKey,
        text:value.text,expiresAt:retentionCeiling,role:value.role,kind:'message',authorship:value.role==='user'?'original-human':'original-assistant'})),
      originalBacking:originals.map(value=>({streamId:a.binding.streamId,eventId:value.eventId,sequence:value.sequence,contentRef:value.contentRef,
        contentHash:value.contentHash,turnId:value.turnId})),observations:[],
      provenance:{events:await Promise.all(events.map(async value=>({streamId:a.binding.streamId,eventId:String(value.event_id),sequence:Number(value.sequence),sha256:await memoryDigest(String(value.event_json))}))),
        turns:[],paid:[],sourceRowsSha256:await memoryDigest(memoryCanonical({originals,events}))},
      coverage:{queuedReferences:1,originalPairs:selected.length/2,typedObservations:0,...(blocked.size?{excludedByUserControls:blocked.size}:{}),allReferencesCaptured:true,semanticComplete:false}};
    if(history){
      const boundary=history.boundary==='consent'&&(inputs[0]!.job.after_sequence>g.source_after_sequence
        ||inputs.some((value,index)=>index>0&&value.job.after_sequence!==inputs[index-1]!.job.through_sequence))?'bounded':history.boundary;
      data.history={version:1,windowJobIds:inputs.slice(0,-1).map(value=>value.job.job_id),afterSequence:inputs[0]!.job.after_sequence,
        throughSequence:job.through_sequence,boundary,originalPairs:selected.length/2};
      if(!nativeDerivationRequestFits(input.qualification.terms,nativeDerivationRequestBody(input.qualification.terms,data.originals,[])))return capacity();
    }
    witness.before(validUntil);witness.seal(data);
    // Actual additional captured reads, including history and deadline rows.
    const statements=witness.statements(),results=structuredClone(await db.batch<Row>(statements));
    if(!statements.length||!derivationResults(results,statements.length)||!witness.matches(results))return unavailable();
    const budget={statements:statements.length,rows:results.reduce((n,result)=>n+result.results.length,0),
      bytes:results.reduce((n,result)=>n+result.results.reduce((total,value)=>total+bytes(memoryCanonical(value)),0),0)};
    const legacy=await prepareLegacyConversationOriginalsCommit(env,prepared,[capture],budget);
    if(!legacy||!legacy.isCurrent()||env.DB!==db)return unavailable();
    const handle=Object.freeze({}) as NativeDerivationSourceCapture;
    captures.set(handle,{env,db,lease,validUntil,witness,legacy,evidences});
    if(!await replayNativeDerivationSources(env,handle)){captures.delete(handle);return unavailable();}
    return {status:'captured',capture:handle} as const;
  }catch{return unavailable();}
}

async function captureChatStudioDerivationHistory(env:WorkerEnv,lease:NativeDerivationEvidence){
  try{
    const db=env.DB,input=nativeDerivationEvidenceInputs(env,lease),query:Query={sql:`SELECT j.job_id,j.after_sequence,j.through_sequence
      FROM memory_derivation_jobs j JOIN memory_derivation_producer_jobs producer ON producer.job_id=j.job_id
      JOIN memory_derivation_completions done ON done.job_id=j.job_id
      JOIN memory_derivation_results retained ON retained.job_id=j.job_id AND retained.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE j.consent_id=? AND j.through_sequence<=? AND j.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      ORDER BY j.through_sequence DESC,j.job_id LIMIT 3`,bindings:[input.grant.consent_id,input.job.after_sequence]};
    const result=structuredClone(await db.prepare(query.sql).bind(...query.bindings).all<Row>());
    if(env.DB!==db||!derivationResults([result],1)||result.results.length>3||result.results.some(row=>!derivationExact(row,['job_id','after_sequence','through_sequence'])
      ||!derivationHash(row.job_id)||!derivationInteger(row.after_sequence)||!derivationInteger(row.through_sequence,Number(row.after_sequence)+1,input.job.after_sequence)))return unavailable();
    if(!result.results.length)return captureChatStudioDerivationWindow(env,lease);
    const evidence:NativeDerivationEvidence[]=[];let boundary:NativeDerivationHistory['boundary']=result.results.length>2?'bounded':'consent';
    for(const row of result.results.slice(0,2)){
      const previous=await observeNativeDerivationHistoryJob(env,lease,String(row.job_id));
      if(!previous){boundary='bounded';break;}evidence.unshift(previous);
    }
    // A disappeared historical input can narrow a NEW proposal with an explicit
    // boundary; an old stored manifest will fail exact comparison, never renew.
    for(;;){
      const captured=await captureChatStudioDerivationWindow(env,lease,{evidence,query,result,boundary});
      if(captured.status==='captured'||!evidence.length)return captured;
      boundary=captured.status==='capacity'?'capacity':'bounded';evidence.shift();
    }
  }catch{return unavailable();}
}

/** Rebase from recent ORIGINAL windows, never from earlier model claims. Each
 * historical window uses separate fresh read-only proof under the same consent.
 * Bounds are explicit: no source truncation, hidden gap skipping, or claim of a
 * complete lifetime history. Legacy result reads may request their exact original
 * single-window contract; this option cannot grant spending or widen access. */
export async function captureNativeDerivationSources(env: WorkerEnv, lease: NativeDerivationEvidence, options: { history?: boolean; blockBindings?: boolean; relationBindings?:boolean } = {}) {
  try{const input=nativeDerivationEvidenceInputs(env,lease);if(input.producer==='chat-studio'&&input.historyPresent&&options.history!==false)return await captureChatStudioDerivationHistory(env,lease);}catch{return unavailable();}
  let deferred=false;try{deferred=nativeDerivationEvidenceInputs(env,lease).historyPresent&&options.history!==false;}catch{return unavailable();}
  const own = await captureNativeDerivationWindow(env, lease, deferred?false:options.blockBindings!==false,deferred?false:options.relationBindings,deferred);
  if (own.status !== 'captured' || options.history === false) return own;
  try {
    const db=env.DB, input=nativeDerivationEvidenceInputs(env,lease);
    if (!input.historyPresent) return own;
    const current=nativeDerivationSourceInputs(env,own.capture), witness=new AssistantContextReadWitness<CaptureData>(env);
    const query={sql:`SELECT j.job_id,j.after_sequence,j.through_sequence FROM memory_derivation_jobs j
      JOIN memory_derivation_completions done ON done.job_id=j.job_id
      JOIN memory_derivation_results retained ON retained.job_id=j.job_id AND retained.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE j.consent_id=? ${input.producersPresent?'AND NOT EXISTS(SELECT 1 FROM memory_derivation_producer_jobs producer WHERE producer.job_id=j.job_id)':''} AND j.through_sequence<=? AND j.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      ORDER BY j.through_sequence DESC,j.job_id LIMIT 3`,bindings:[input.grant.consent_id,input.job.after_sequence]};
    const statement=db.prepare(query.sql).bind(...query.bindings), result=await statement.all<Row>();
    if(env.DB!==db||!derivationResults([result],1)||result.results.length>3
      ||result.results.some(row=>!derivationExact(row,['job_id','after_sequence','through_sequence'])||!derivationHash(row.job_id)
        ||!derivationInteger(row.after_sequence)||!derivationInteger(row.through_sequence,Number(row.after_sequence)+1,input.job.after_sequence)))return unavailable();
    // Keep zero-history manifests byte-compatible with previous single windows.
    witness.observe([statement],[result],[query]);
    if(!result.results.length)return finalizeResourceHistory(env,lease,[own.capture],current,witness,options);
    const parts=[own.capture], data=[current];
    let boundary:NativeDerivationHistory['boundary']=result.results.length>2?'bounded':'consent';
    let merged=current;
    for(const row of result.results.slice(0,2)) {
      const evidence=await observeNativeDerivationHistoryJob(env,lease,String(row.job_id));
      if(!evidence){boundary='bounded';break;}
      const previous=await captureNativeDerivationWindow(env,evidence,false,false,true,captures.get(own.capture)!.documentScope);
      if(previous.status!=='captured'){boundary=previous.status==='capacity'?'capacity':'bounded';break;}
      const source=nativeDerivationSourceInputs(env,previous.capture);
      if(source.scopeKey!==current.scopeKey||source.purpose!==current.purpose||source.binding.consentId!==current.binding.consentId
        ||source.binding.throughSequence>current.binding.afterSequence)return unavailable();
      const windows=[source,...data];
      const originals=windows.flatMap(value=>value.originals),observations=windows.flatMap(value=>value.observations);
      if(originals.length>128||observations.length>128||bytes(JSON.stringify(originals))>460000
        ||!nativeDerivationRequestFits(input.qualification.terms,nativeDerivationRequestBody(input.qualification.terms,originals,observations))){boundary='capacity';break;}
      if(new Set(originals.map(value=>value.sourceId)).size!==originals.length)return unavailable();
      parts.unshift(previous.capture);data.unshift(source);
      const unique=<T>(values:T[])=>[...new Map(values.map(value=>[memoryCanonical(value),value])).values()];
      merged={...current,originals,observations,originalBacking:unique(data.flatMap(value=>value.originalBacking)),
        checkedAt:data.map(value=>value.checkedAt).sort().at(-1)!,validUntil:data.map(value=>value.validUntil).sort()[0]!,
        retentionCeiling:data.map(value=>value.retentionCeiling).sort()[0]!,
        provenance:{events:unique(data.flatMap(value=>value.provenance.events)),turns:unique(data.flatMap(value=>value.provenance.turns)),
          paid:unique(data.flatMap(value=>value.provenance.paid)),
          ...(data.some(value=>value.provenance.artifacts)?{artifacts:unique(data.flatMap(value=>value.provenance.artifacts??[]))}:{}),
          ...(current.provenance.relationBindings?{relationBindings:{version:1 as const,entries:unique(data.flatMap(value=>value.provenance.relationBindings?.entries??[])),unresolved:data.reduce((sum,value)=>sum+(value.provenance.relationBindings?.unresolved??0),0)}}:{}),
          ...(current.provenance.blockBindings?{blockBindings:{version:1 as const,entries:unique(data.flatMap(value=>value.provenance.blockBindings?.entries??[])),unresolved:data.reduce((sum,value)=>sum+(value.provenance.blockBindings?.unresolved??0),0)}}:{}),
          sourceRowsSha256:await memoryDigest(memoryCanonical(data.map(value=>[value.jobId,value.provenance.sourceRowsSha256])))},
        coverage:{...current.coverage,originalPairs:originals.length/2,typedObservations:observations.length,
          ...(data.some(value=>value.coverage.excludedByUserControls)?{excludedByUserControls:data.reduce((n,value)=>n+(value.coverage.excludedByUserControls??0),0)}:{})}};
    }
    // Completion gaps, erased/expired windows and the fixed lookback cap are
    // never represented as consent-to-present semantic coverage.
    if((data[0]!.binding.afterSequence>input.grant.source_after_sequence||data.some((value,index)=>index>0&&value.binding.afterSequence!==data[index-1]!.binding.throughSequence))&&boundary==='consent')boundary='bounded';
    merged={...merged,history:{version:1,windowJobIds:data.slice(0,-1).map(value=>value.jobId),afterSequence:data[0]!.binding.afterSequence,
      throughSequence:current.binding.throughSequence,boundary,originalPairs:merged.originals.length/2}};
    return finalizeResourceHistory(env,lease,parts,merged,witness,options);
  }catch{return unavailable();}
}

/** Private parts never escape before this aggregate replay. Their independent
 * native grant/source witnesses remain in the final atomic proof. Document
 * identity is read once for the identical enrollment, and resource versions are
 * certified in one bounded union instead of once per historical window. */
async function finalizeResourceHistory(env:WorkerEnv,lease:NativeDerivationEvidence,parts:NativeDerivationSourceCapture[],data:CaptureData,
  witness:AssistantContextReadWitness<CaptureData>,options:{blockBindings?:boolean;relationBindings?:boolean}){
  try{
    const db=env.DB,input=nativeDerivationEvidenceInputs(env,lease);
    if(options.relationBindings===true&&(!input.relationsPresent||!input.lifecyclePresent))return unavailable();
    const blockBindings=options.blockBindings!==false?await observeNativeMemoryBlockBindings(env,input.enrollment,data.observations,witness):undefined;
    const relationBindings=options.relationBindings!==false&&input.relationsPresent&&input.lifecyclePresent?await observeNativeMemoryRelationBindings(env,input.enrollment,
      parts.flatMap(part=>captures.get(part)?.relationObservations??[]),witness):undefined;
    const merged={...data,provenance:{...data.provenance,...(blockBindings?{blockBindings}:{}),...(relationBindings?{relationBindings}:{})}};
    witness.before(merged.validUntil);witness.seal(merged);
    const handle=Object.freeze({}) as NativeDerivationSourceCapture;
    captures.set(handle,{env,db,lease,validUntil:merged.validUntil,witness,parts});
    if(!await replayNativeDerivationSources(env,handle)){captures.delete(handle);return unavailable();}
    return {status:'captured',capture:handle} as const;
  }catch{return unavailable();}
}

function lookup(env: WorkerEnv, handle: NativeDerivationSourceCapture) {
  const captured = captures.get(handle);
  if (!captured || captured.env !== env || captured.db !== env.DB || captured.validUntil <= clock()) throw Error("memory-derivation-source-unavailable");
  nativeDerivationEvidenceInputs(env, captured.lease); for(const evidence of captured.evidences??[])nativeDerivationEvidenceInputs(env,evidence); if(captured.legacy&&!captured.legacy.isCurrent())throw Error("memory-chat-source-expired"); return captured;
}
/** Copied staging data, not permission to use a source. Keep the issued handle:
 * every publication must include source statements in its same atomic batch;
 * any provider dispatch must first replay the current source and native proof.
 */
export function nativeDerivationSourceInputs(env: WorkerEnv, handle: NativeDerivationSourceCapture) {
  return lookup(env, handle).witness.context()!;
}
export function nativeDerivationSourceStatements(env: WorkerEnv, handle: NativeDerivationSourceCapture): D1PreparedStatement[] {
  const captured = lookup(env, handle), lease = captured.parts ? captured.parts.flatMap(part=>nativeDerivationSourceStatements(env,part)) : (captured.evidences??[captured.lease]).flatMap(evidence=>nativeDerivationEvidenceStatements(env,evidence)), source = [...captured.witness.precommitStatements(),...(captured.legacy?.precommitStatements()??[])];
  if (lease.length + source.length > (captured.parts||captured.legacy ? 100 : 32)) throw Error("memory-derivation-source-capacity");
  return [...lease, ...source];
}
export async function replayNativeDerivationSources(env: WorkerEnv, handle: NativeDerivationSourceCapture) {
  try {
    const captured = lookup(env, handle), statements = nativeDerivationSourceStatements(env, handle), leaseCount = nativeDerivationEvidenceStatements(env, captured.lease).length;
    const result = structuredClone(await captured.db.batch<Row>(statements));
    return lookup(env, handle) === captured && derivationResults(result, statements.length) && result.every((entry, index) => {
      const field = captured.parts||captured.evidences ? (Object.hasOwn(entry.results[0]??{},"verified")?"verified":"context_source_asserted") : index < leaseCount ? "verified" : "context_source_asserted";
      return entry.results.length === 1 && derivationExact(entry.results[0], [field]) && entry.results[0][field] === 1;
    });
  } catch { return false; }
}

/** Execution requires the exact original handle, not another read capability
 * for the same job. This closes read-to-spend capability substitution. */
export function nativeDerivationSourceForEvidence(env: WorkerEnv, handle: NativeDerivationSourceCapture, evidence: NativeDerivationEvidence) {
  if (lookup(env, handle).lease !== evidence) throw Error("memory-derivation-source-authority-mismatch");
  return nativeDerivationSourceInputs(env, handle);
}
