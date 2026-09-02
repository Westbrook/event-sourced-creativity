import type { CreativeEvent } from "../src/model/events.ts";
import {
  createMemoryScopeGraph, memoryDigest, memoryKey, memoryScopeGrant, memorySourceEligible, memorySourceRef, memoryTime,
  type MemoryAccess, type MemoryOrigin, type MemoryPurpose, type MemoryScope, type MemoryScopeGraph, type MemorySource,
} from "../src/model/scoped-memory.ts";
import {
  memoryEventAction, normalizeMemoryObservation, type MemoryAttentionGrant, type MemoryObservation, type MemoryTarget,
} from "../src/model/memory-observations.ts";
import type { MemoryConversationInventory } from "../src/model/memory-conversation.ts";
import type { MemoryCursor, MemoryReviewInventory } from "./memory-shadow.ts";
import { MemoryBoundaryError, memoryAssert, memoryGuardsCurrent, type MemoryDatabase, type MemorySqlGuard } from "./memory-sql.ts";

export type MemoryIdentity = { actorUserId: string; custodianId: string; targetScopeId: string };
export type MemoryAuthoritySnapshot = {
  access: MemoryAccess; scopes: readonly MemoryScope[];
  /** Canonical owner streams, NEVER presentation-local project sequences. */
  streams: readonly { streamId: string; ownerUserId: string }[];
  guard: MemorySqlGuard; attention?: MemoryAttentionGrant;
};
export type MemoryEventHeader = {
  event_id: string; stream_id: string; sequence: number; occurred_at: string; recorded_at: string;
  actor: string; client_id: string; correlation_id: string; causation_id: string | null;
  compensates_event_id: string | null; schema_version: number; type: string;
};
type AvailableBinding = {
  status: "available"; guard: MemorySqlGuard;
  actorUserId: string; custodianId: string; scopeId: string; scopeVersion: number; revision: string;
  projectId: string; documentId: string; organizationId: string | null; projectAccessId: string | null;
  visibility: "actor" | "shared";
  expiresAt: string; origin: MemoryOrigin; lineageId: string; independentEvidence: boolean;
  synthetic: boolean; lineageResolved: boolean; outcomeId: string; episodeId: string;
  targets: readonly MemoryTarget[];
  conversation?: { conversationId: string; scopeKey: string; turnId: string };
};
export type MemoryEventBinding = AvailableBinding | { status: "outside-scope"; guard: MemorySqlGuard }
  | { status: "unavailable"; guard: MemorySqlGuard };

/**
 * A trusted in-process server port, not a request-body contract. Its guards must
 * prove CURRENT identity/custody, exact resource versions, origin/lineage and
 * policy in this same database. There is intentionally no production resolver.
 */
export interface MemoryAuthorityPort {
  authorize(identity: MemoryIdentity, now: string): Promise<MemoryAuthoritySnapshot>;
  resolveEvent(header: Readonly<MemoryEventHeader>, authority: Readonly<MemoryAuthoritySnapshot>): Promise<MemoryEventBinding>;
}
export type MemorySourceEvidence = {
  access: MemoryAccess; graph: MemoryScopeGraph; sources: Map<string, MemorySource>;
  observations: MemoryObservation[]; conversations: MemoryConversationInventory[];
  inventory: MemoryReviewInventory; attention?: MemoryAttentionGrant;
  scannedRows: number; unavailableRows: number;
};
/** Opaque provenance: callers cannot forge a complete interval by passing true. */
export type MemorySourceCapture = Readonly<{ kind: "issued-memory-source-capture" }>;
type CaptureState = { evidence: MemorySourceEvidence; guards: MemorySqlGuard[] };
const HEADER_COLUMNS = "event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type";
const parseObject = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text);
    memoryAssert(value && typeof value === "object" && !Array.isArray(value), "invalid-memory-source-envelope");
    return value as Record<string, unknown>;
  } catch { throw new MemoryBoundaryError("invalid-memory-source-envelope"); }
};
const textBytes = (text: string) => new TextEncoder().encode(text).byteLength;

/** Read-only, bounded document adapter. No runtime initialization, tracking or providers. */
export class MemorySourceAdapter {
  readonly database: MemoryDatabase;
  readonly mode: "off" | "synthetic-shadow";
  private readonly authority: MemoryAuthorityPort;
  private readonly clock: () => string;
  private readonly databaseClock: string;
  private readonly pageSize: number;
  private readonly issued = new WeakMap<MemorySourceCapture, CaptureState>();

  constructor(database: MemoryDatabase, authority: MemoryAuthorityPort, options: {
    mode?: "off" | "synthetic-shadow"; clock?: () => string; pageSize?: number;
    /** Trusted SQL Julian-date expression. Tests may inject a DB-side clock, never a browser value. */
    databaseClock?: string;
  } = {}) {
    this.database = database; this.authority = authority; this.mode = options.mode ?? "off";
    memoryAssert(this.mode === "off" || this.mode === "synthetic-shadow", "unsupported-memory-source-mode");
    this.clock = options.clock ?? (() => new Date().toISOString()); this.pageSize = options.pageSize ?? 64;
    this.databaseClock = options.databaseClock ?? "julianday('now')";
    memoryAssert(this.databaseClock.length > 0 && this.databaseClock.length <= 256
      && !/[;?]/u.test(this.databaseClock), "invalid-memory-database-clock");
    memoryAssert(Number.isSafeInteger(this.pageSize) && this.pageSize > 0 && this.pageSize <= 256, "invalid-memory-page-size");
  }

  now(): string {
    const now = this.clock(); memoryAssert(Number.isFinite(memoryTime(now)), "invalid-memory-clock");
    return new Date(now).toISOString();
  }

  /** Evaluated by the database DURING publication, not a timestamp bound before an await. */
  transactionTimeGuard(notBefore: string, before: string): MemorySqlGuard {
    memoryAssert(Number.isFinite(memoryTime(notBefore)) && memoryTime(before) > memoryTime(notBefore), "invalid-memory-publication-deadline");
    return { condition: `(${this.databaseClock}) >= julianday(?) AND (${this.databaseClock}) < julianday(?)`, bindings: [notBefore,before] };
  }

  evidence(capture: MemorySourceCapture): MemorySourceEvidence {
    const state = this.issued.get(capture); memoryAssert(state, "unissued-memory-capture");
    return structuredClone(state!.evidence);
  }
  guards(capture: MemorySourceCapture): MemorySqlGuard[] {
    const state = this.issued.get(capture); memoryAssert(state, "unissued-memory-capture");
    return structuredClone(state!.guards);
  }

  /** Metadata-only authority lookup for cleanup after opt-out, revocation or expiry. */
  async policySnapshot(identity: MemoryIdentity): Promise<MemoryAuthoritySnapshot | null> {
    if (this.mode === "off") return null;
    const request = structuredClone(identity), now = this.now();
    const authority = structuredClone(await this.authority.authorize(request,now)), access = authority.access;
    memoryAssert(access.environment === "synthetic" && access.now === now && access.actorUserId === request.actorUserId
      && access.custodianId === request.custodianId && access.targetScopeId === request.targetScopeId, "memory-source-access-denied");
    memoryAssert(await memoryGuardsCurrent(this.database,[authority.guard]), "stale-memory-policy");
    return authority;
  }

  async capture(identity: MemoryIdentity, from: MemoryCursor = {}, purpose: MemoryPurpose = "learn"): Promise<MemorySourceCapture | null> {
    if (this.mode === "off") return null;
    const request = structuredClone(identity), processed = structuredClone(from), now = this.now();
    const authority = structuredClone(await this.authority.authorize(request, now));
    const access = authority.access, graph = createMemoryScopeGraph(authority.scopes);
    memoryAssert(access.environment === "synthetic" && access.now === now && access.actorUserId === request.actorUserId
      && access.custodianId === request.custodianId && access.targetScopeId === request.targetScopeId
      && graph.get(memoryKey(access.custodianId, access.targetScopeId))?.kind === "document"
      && memoryScopeGrant(access, graph, access.targetScopeId, purpose), "memory-source-access-denied");
    memoryAssert(authority.streams.length > 0 && authority.streams.length <= 8
      && new Set(authority.streams.map((stream) => stream.streamId)).size === authority.streams.length
      && authority.streams.every((stream) => stream.ownerUserId && stream.streamId === `creative:${stream.ownerUserId}`)
      && Object.entries(processed).every(([stream, sequence]) => authority.streams.some((candidate) => candidate.streamId === stream)
        && Number.isSafeInteger(sequence) && sequence >= 0), "invalid-canonical-memory-stream");
    const db = this.database, guards: MemorySqlGuard[] = [authority.guard];
    const heads = await db.batch<{ head: number }>(authority.streams.map((stream) => db.prepare(
      "SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(stream.streamId)));
    memoryAssert(heads.length === authority.streams.length, "incomplete-memory-heads");
    const through: Record<string, number> = {}, headers: MemoryEventHeader[] = [];
    for (const [index, stream] of authority.streams.entries()) {
      const head = heads[index]?.results[0]?.head;
      memoryAssert(Number.isSafeInteger(head) && head >= (processed[stream.streamId] ?? 0) && head <= 512, "memory-interval-limit-or-rewind");
      through[stream.streamId] = head;
      let after = 0;
      while (after < head) {
        const page = await db.prepare(`SELECT ${HEADER_COLUMNS} FROM events WHERE stream_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?`)
          .bind(stream.streamId, after, head, this.pageSize).all<MemoryEventHeader>();
        memoryAssert(page.results.length > 0 && page.results.length <= this.pageSize, "incomplete-memory-page");
        for (const row of page.results) {
          memoryAssert(row.stream_id === stream.streamId && row.sequence === after + 1 && row.sequence <= head
            && row.event_id && !row.event_id.startsWith("optimistic:") && !row.client_id.includes("optimistic")
            && Number.isFinite(memoryTime(row.recorded_at)) && memoryTime(row.recorded_at) <= memoryTime(now), "noncanonical-memory-event");
          after = row.sequence; headers.push(row);
          memoryAssert(headers.length <= 512, "memory-interval-limit-or-rewind");
          guards.push({ condition: `EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=? AND type=?
            AND actor=? AND client_id=? AND correlation_id=? AND causation_id IS ? AND compensates_event_id IS ?
            AND occurred_at=? AND recorded_at=? AND schema_version=?)`,
          bindings: [row.event_id,row.stream_id,row.sequence,row.type,row.actor,row.client_id,row.correlation_id,
            row.causation_id,row.compensates_event_id,row.occurred_at,row.recorded_at,row.schema_version] });
        }
      }
      guards.push({ condition: "(SELECT COUNT(*) FROM events WHERE stream_id=? AND sequence<=?)=?", bindings: [stream.streamId, head, head] });
    }
    const sources = new Map<string, MemorySource>(), observations: MemoryObservation[] = [];
    const conversations = new Map<string, MemoryConversationInventory>();
    let unavailableRows = 0, unavailableChat = false;
    for (const header of headers) {
      if (!memoryEventAction(header.type) && header.type !== "AssistantReasoned") continue;
      const binding = structuredClone(await this.authority.resolveEvent(Object.freeze({ ...header }), structuredClone(authority)));
      guards.push(binding.guard);
      if (binding.status === "outside-scope") continue;
      if (binding.status === "unavailable") {
        unavailableRows += 1; unavailableChat ||= header.type === "ChatMessageSent" || header.type === "AssistantReasoned"; continue;
      }
      memoryAssert(binding.actorUserId === access.actorUserId && binding.custodianId === access.custodianId
        && binding.synthetic === true && binding.documentId === access.targetScopeId
        && header.actor === `user:${access.actorUserId}`
        && binding.targets.length > 0 && binding.targets.length <= 8, "unresolved-memory-event-authority");
      if (memoryScopeGrant(access,graph,binding.scopeId,purpose)?.scopeVersion !== binding.scopeVersion
        || binding.targets.some((target) => !memoryScopeGrant(access,graph,target.scopeId,purpose))
        || memoryTime(binding.expiresAt) <= memoryTime(now) || memoryTime(header.recorded_at) + access.retentionDays * 86_400_000 <= memoryTime(now)) {
        unavailableRows += 1; unavailableChat ||= Boolean(binding.conversation); continue;
      }
      let conversation: MemoryConversationInventory | undefined;
      if (binding.conversation) {
        conversation = conversations.get(binding.conversation.conversationId) ?? {
          conversationId: binding.conversation.conversationId, scopeId: access.targetScopeId, completeFromStart: true, turns: [],
        };
        conversations.set(conversation.conversationId, conversation);
      }
      const envelope = await this.envelope(header, binding, authority, guards);
      if (!envelope) { unavailableRows += 1; if (conversation) conversation.completeFromStart = false; continue; }
      let text = envelope.serialized, expiresAt = binding.expiresAt, speaker: MemorySource["speaker"] = null;
      if (header.type === "ChatMessageSent" || header.type === "AssistantReasoned") {
        memoryAssert(binding.conversation && binding.scopeId === access.targetScopeId && binding.visibility === "actor", "unresolved-private-conversation");
        const chat = await this.finalChat(header, binding, envelope.payload, through, access, guards);
        if (chat === "superseded") continue;
        if (!chat) { unavailableRows += 1; conversation!.completeFromStart = false; continue; }
        text = chat.text; expiresAt = new Date(Math.min(memoryTime(expiresAt), memoryTime(chat.expiresAt))).toISOString(); speaker = chat.speaker;
      }
      const source: MemorySource = {
        id: header.event_id, custodianId: binding.custodianId, scopeId: binding.scopeId, scopeVersion: binding.scopeVersion,
        streamId: header.stream_id, sequence: header.sequence, revision: binding.revision, contentHash: await memoryDigest(text),
        actorUserId: binding.actorUserId, visibility: binding.visibility, speaker, state: "active", happenedAt: header.recorded_at,
        expiresAt, origin: speaker === "assistant" ? "assistant" : binding.origin, lineageId: binding.lineageId,
        synthetic: true, independentEvidence: speaker === "assistant" ? false : binding.independentEvidence,
      };
      if (!memorySourceEligible(source, access, graph, purpose)) { unavailableRows += 1; if (conversation) conversation.completeFromStart = false; continue; }
      const event: CreativeEvent = { eventId: header.event_id, streamId: header.stream_id, sequence: header.sequence,
        occurredAt: header.occurred_at, recordedAt: header.recorded_at, actor: header.actor, clientId: header.client_id,
        correlationId: header.correlation_id, causationId: header.causation_id, compensatesEventId: header.compensates_event_id,
        schemaVersion: header.schema_version, type: header.type, payload: envelope.payload };
      const observation = normalizeMemoryObservation({ event, source, targets: binding.targets, outcomeId: binding.outcomeId,
        episodeId: binding.episodeId, lineageResolved: binding.lineageResolved }, access, graph, authority.attention, purpose);
      if (!observation && header.type !== "AssistantReasoned") {
        memoryAssert(header.type === "AttentionEpisodeObserved", "unusable-memory-observation"); continue;
      }
      const normalized = observation?.evidenceSource ?? source;
      if (observation) observations.push(observation);
      sources.set(memoryKey(normalized.custodianId, normalized.id), normalized);
      memoryAssert(sources.size <= 128, "memory-evidence-limit");
      if (conversation && speaker) conversation.turns = [...conversation.turns, {
        turnId: binding.conversation!.turnId, conversationId: conversation.conversationId, role: speaker,
        status: "final", text, source: memorySourceRef(normalized),
      }];
    }
    if (unavailableChat) for (const conversation of conversations.values()) conversation.completeFromStart = false;
    memoryAssert(await memoryGuardsCurrent(db, guards), "stale-memory-source-snapshot");
    const capture: MemorySourceCapture = Object.freeze({ kind: "issued-memory-source-capture" });
    const evidence: MemorySourceEvidence = { access, graph, sources, observations, conversations: [...conversations.values()],
      inventory: { complete: true, from: processed, through,
        observationSources: observations.filter((row) => row.sequence > (processed[row.streamId] ?? 0)).map((row) => row.source) },
      attention: authority.attention, scannedRows: headers.length, unavailableRows };
    this.issued.set(capture, { evidence: structuredClone(evidence), guards: structuredClone(guards) });
    return capture;
  }

  private async envelope(header: MemoryEventHeader, binding: AvailableBinding, authority: MemoryAuthoritySnapshot,
    guards: MemorySqlGuard[]): Promise<{ payload: Record<string, unknown>; serialized: string } | null> {
    const owner = authority.streams.find((stream) => stream.streamId === header.stream_id)!.ownerUserId;
    memoryAssert(Boolean(binding.organizationId) === Boolean(binding.projectAccessId), "ambiguous-memory-custodian");
    const custody: MemorySqlGuard = binding.organizationId ? {
      condition: `EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id=? AND project_access_id=? AND organization_id=?
        AND project_id=? AND owner_user_id=? AND source_stream_id=? AND source_sequence=? AND actor_user_id=?)`,
      bindings: [header.event_id,binding.projectAccessId,binding.organizationId,binding.projectId,owner,header.stream_id,header.sequence,binding.actorUserId],
    } : { condition: "NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id=?)", bindings: [header.event_id] };
    memoryAssert(await memoryGuardsCurrent(this.database,[custody]), "memory-event-custody-mismatch"); guards.push(custody);
    const row = await this.database.prepare(`SELECT event.payload,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.redacted_at
      FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      AND secret.owner_id=? AND secret.project_id=? AND secret.document_id=? WHERE event.event_id=? AND (${custody.condition})`)
      .bind(owner,binding.projectId,binding.documentId,header.event_id,...custody.bindings)
      .first<{ payload: string; owner_id: string; project_id: string; document_id: string; private_json: string | null; redacted_at: string | null }>();
    memoryAssert(row && parseObject(row.payload)._private_ref === header.event_id, "unmigrated-memory-source-envelope");
    if (!row!.private_json || row!.redacted_at !== null) {
      guards.push({ condition: "NOT EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND redacted_at IS NULL AND private_json!='')", bindings: [header.event_id] });
      return null;
    }
    memoryAssert(row!.owner_id === owner && row!.project_id === binding.projectId && row!.document_id === binding.documentId
      && textBytes(row!.private_json!) <= 65_536, "memory-private-envelope-custody");
    const payload = parseObject(row!.private_json!);
    memoryAssert((payload.actor_user_id === undefined || payload.actor_user_id === binding.actorUserId)
      && (payload.project_id === undefined || payload.project_id === binding.projectId)
      && (payload.document_id === undefined || payload.document_id === binding.documentId), "contradictory-memory-source-scope");
    guards.push({ condition: `EXISTS(SELECT 1 FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      WHERE event.event_id=? AND event.payload=? AND secret.owner_id=? AND secret.project_id=? AND secret.document_id=?
      AND secret.private_json=? AND secret.redacted_at IS NULL)`,
    bindings: [header.event_id,row!.payload,owner,binding.projectId,binding.documentId,row!.private_json!] });
    return { payload, serialized: row!.private_json! };
  }

  private async finalChat(header: MemoryEventHeader, binding: AvailableBinding, payload: Record<string, unknown>, through: MemoryCursor,
    access: MemoryAccess, guards: MemorySqlGuard[]): Promise<{ text: string; expiresAt: string; speaker: "user" | "assistant" } | "superseded" | null> {
    const db = this.database, chat = binding.conversation!;
    memoryAssert(payload.turn_id === chat.turnId && typeof payload.content_ref === "string", "unresolved-private-conversation");
    const turn = await db.prepare(`SELECT user_content_ref,assistant_content_ref,status,project_id,document_id FROM assistant_turns
      WHERE actor_user_id=? AND scope_key=? AND turn_id=?`).bind(access.actorUserId,chat.scopeKey,chat.turnId)
      .first<{ user_content_ref: string; assistant_content_ref: string; status: string; project_id: string; document_id: string }>();
    memoryAssert(turn?.status === "completed" && turn.project_id === binding.projectId && turn.document_id === binding.documentId, "unresolved-final-memory-turn");
    guards.push({ condition: `EXISTS(SELECT 1 FROM assistant_turns WHERE actor_user_id=? AND scope_key=? AND turn_id=? AND status='completed'
      AND user_content_ref=? AND assistant_content_ref=? AND project_id=? AND document_id=?)`,
    bindings: [access.actorUserId,chat.scopeKey,chat.turnId,turn!.user_content_ref,turn!.assistant_content_ref,binding.projectId,binding.documentId] });
    const tasks = await db.prepare("SELECT task_id,status FROM assistant_specialist_tasks WHERE actor_user_id=? AND scope_key=? AND turn_id=? ORDER BY task_id LIMIT 2")
      .bind(access.actorUserId,chat.scopeKey,chat.turnId).all<{ task_id: string; status: string }>();
    memoryAssert(tasks.results.length <= 1 && tasks.results.every((task) => task.status === "completed"), "pending-or-ambiguous-memory-turn");
    guards.push({ condition: "(SELECT COUNT(*) FROM assistant_specialist_tasks WHERE actor_user_id=? AND scope_key=? AND turn_id=?)=?",
      bindings: [access.actorUserId,chat.scopeKey,chat.turnId,tasks.results.length] });
    const messages = await db.prepare(`SELECT ${HEADER_COLUMNS} FROM events WHERE stream_id=? AND actor=? AND type='ChatMessageSent'
      AND json_extract(payload,'$.content_ref')=? AND json_extract(payload,'$.turn_id')=? AND json_extract(payload,'$.document_id')=? LIMIT 2`)
      .bind(header.stream_id,`user:${access.actorUserId}`,turn!.user_content_ref,chat.turnId,binding.documentId).all<MemoryEventHeader>();
    const answer = await db.prepare(`SELECT ${HEADER_COLUMNS} FROM events WHERE stream_id=? AND actor=? AND type='AssistantReasoned'
      AND json_extract(payload,'$.operation')='creative-chat' AND json_extract(payload,'$.content_ref')=?
      AND json_extract(payload,'$.turn_id')=? AND json_extract(payload,'$.document_id')=? ORDER BY sequence DESC LIMIT 1`)
      .bind(header.stream_id,`user:${access.actorUserId}`,turn!.assistant_content_ref,chat.turnId,binding.documentId).first<MemoryEventHeader>();
    memoryAssert(messages.results.length === 1 && answer && answer.sequence <= through[header.stream_id]
      && messages.results[0].sequence <= through[header.stream_id], "unresolved-or-future-memory-answer");
    const message = messages.results[0], final = answer!;
    if (tasks.results.length) {
      const task = tasks.results[0];
      const guard: MemorySqlGuard = { condition: `EXISTS(SELECT 1 FROM assistant_specialist_tasks task
        JOIN assistant_action_commits committed ON committed.commit_id=? AND committed.verified=1
        JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=? AND receipt.event_id=? AND receipt.sequence=?
        WHERE task.task_id=? AND task.actor_user_id=? AND task.scope_key=? AND task.turn_id=? AND task.status='completed')`,
      bindings: [`task:${task.task_id}`,header.stream_id,`assistant-specialist:${access.actorUserId}:${task.task_id}:0`,final.event_id,final.sequence,
        task.task_id,access.actorUserId,chat.scopeKey,chat.turnId] };
      memoryAssert(await memoryGuardsCurrent(db, [guard]), "unverified-specialist-memory-answer"); guards.push(guard);
    } else memoryAssert(final.correlation_id === message.correlation_id && final.causation_id === message.event_id, "unbound-memory-answer");
    guards.push({ condition: `NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND actor=? AND type='AssistantReasoned'
      AND json_extract(payload,'$.content_ref')=? AND json_extract(payload,'$.turn_id')=? AND sequence>?)`,
    bindings: [header.stream_id,`user:${access.actorUserId}`,turn!.assistant_content_ref,chat.turnId,final.sequence] });
    const speaker = header.type === "ChatMessageSent" ? "user" : "assistant";
    if (speaker === "assistant" && header.event_id !== final.event_id) return "superseded";
    memoryAssert(speaker !== "user" || header.event_id === message.event_id, "ambiguous-memory-user-message");
    const contentId = speaker === "user" ? turn!.user_content_ref : turn!.assistant_content_ref;
    memoryAssert(payload.content_ref === contentId && (speaker !== "assistant" || payload.operation === "creative-chat"), "memory-chat-reference-mismatch");
    const contentCustody: MemorySqlGuard = binding.organizationId ? {
      condition: `EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN private_content_retention_scopes retention
        ON retention.content_id=resource.resource_id AND retention.organization_id=resource.organization_id
        AND retention.project_access_id=resource.project_access_id AND retention.project_id=resource.project_id AND retention.actor_user_id=resource.actor_user_id
        WHERE resource.resource_kind='content' AND resource.resource_id=? AND resource.project_access_id=? AND resource.organization_id=?
        AND resource.project_id=? AND resource.owner_user_id=? AND resource.visibility='actor_private' AND resource.actor_user_id=?)`,
      bindings: [contentId,binding.projectAccessId,binding.organizationId,binding.projectId,header.stream_id.slice("creative:".length),access.actorUserId],
    } : { condition: `NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?)`, bindings: [contentId,contentId] };
    memoryAssert(await memoryGuardsCurrent(db,[contentCustody]), "memory-chat-tenant-custody"); guards.push(contentCustody);
    const privateMetadata = await db.prepare("SELECT owner_id,kind FROM private_content WHERE content_id=?").bind(contentId).first<{ owner_id: string; kind: string }>();
    memoryAssert(!privateMetadata || privateMetadata.owner_id === access.actorUserId && privateMetadata.kind === `chat-${speaker}`, "memory-chat-content-custody");
    const eligibleContent = `content_id=? AND owner_id=? AND kind=? AND redacted_at IS NULL AND expires_at>?
      AND COALESCE((SELECT MIN(assigned_expires_at) FROM private_content_retention_scopes WHERE content_id=private_content.content_id),expires_at)>?
      AND (${contentCustody.condition})`;
    const eligibleBindings = [contentId,access.actorUserId,`chat-${speaker}`,access.now,access.now,...contentCustody.bindings];
    const content = await db.prepare(`SELECT owner_id,kind,content,expires_at,redacted_at,
      (SELECT MIN(assigned_expires_at) FROM private_content_retention_scopes WHERE content_id=private_content.content_id) AS assigned_expires_at
      FROM private_content WHERE ${eligibleContent}`)
      .bind(...eligibleBindings)
      .first<{ owner_id: string; kind: string; content: string; expires_at: string; assigned_expires_at: string | null; redacted_at: string | null }>();
    if (!content || content.redacted_at !== null || memoryTime(content.expires_at) <= memoryTime(access.now)) {
      guards.push({ condition: `NOT EXISTS(SELECT 1 FROM private_content WHERE ${eligibleContent})`, bindings: eligibleBindings });
      return null;
    }
    memoryAssert(content.owner_id === access.actorUserId && content.kind === `chat-${speaker}` && content.content.trim()
      && textBytes(content.content) <= 16_384, "memory-chat-content-custody");
    guards.push({ condition: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=?
      AND expires_at=? AND redacted_at IS NULL)
      AND (SELECT MIN(assigned_expires_at) FROM private_content_retention_scopes WHERE content_id=?) IS ?`,
      bindings: [contentId,access.actorUserId,`chat-${speaker}`,content.content,content.expires_at,contentId,content.assigned_expires_at] });
    return { text: content.content, expiresAt: new Date(Math.min(memoryTime(content.expires_at),
      content.assigned_expires_at ? memoryTime(content.assigned_expires_at) : Infinity)).toISOString(), speaker };
  }
}
