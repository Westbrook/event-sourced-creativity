import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import { digest, jsonIssues, record } from "../src/experiences/compiler.ts";
import { guestFail } from "./experience-guest-session.ts";
import { eventWriteBindings, type EventRow, type makeEvent } from "./event-write-primitives.ts";
import { publicEventPayload } from "./event-privacy.ts";

/** Value construction and incomplete SQL components only. These ordinary DTOs
 * carry neither principal authority nor a genuine inventory/claim capability.
 * Native UUID/time creation, digest/current checkpoints and transactions stay
 * with the caller. Historical content never becomes execution authority. */
export type GuestImageCopyProof = { sql: string; bindings: (string | number | null)[] };
type Proof = GuestImageCopyProof;
export type GuestImageCopyRow = { session_id: string; destination_user_id: string; lease_id: string; request_id: string; manifest_digest: string;
  context_lineage_digest: string; lineage_json: string; lineage_digest: string; created_at_ms: number };
export type GuestImageCopyCommand = { scope_key: string; actor_user_id: string; command_key: string; request_digest: string; action: string; event_id: string; created_at: string };
export type GuestImageCopyResource = { resource_id: string; campaign_id: string; policy_digest: string; limits_digest: string; actor_user_id: string;
  session_digest: string; operation: string; intent_key: string; payload_digest: string; text_bytes: number; issued_grant_id: null; recorded_at_ms: number };
type EventIdentity = { id: string; sequence: number; occurred: string; recorded: string; public: string; privateDigest: string };
export type GuestImageClaimLineage = Readonly<{
  version: 1; kind: "first-image-save"; sessionId: string; guestSubject: string; destinationUserId: string; projectId: string;
  documentId: string; draftId: string; draftHash: string; manifestDigest: string; origin: string; contextLineageDigest: string;
  source: { head: number; eventIds: string[]; expiresAt: string; sessionPolicyId: string; sessionTermsDigest: string; sessionExpiresAtMs: number;
    sourcePolicyId: string; sourcePolicyDigest: string; requestDigest: string; contentDigest: string; releaseHash: string;
    save: EventIdentity; command: GuestImageCopyCommand; resource: GuestImageCopyResource };
  target: EventIdentity & { commandKey: string; requestDigest: string; requirementId: string; contextHead: number };
}>;
export type GuestImageCopyLease = { session_id: string; lease_id: string; destination_user_id: string; manifest_digest: string; request_id: string;
  request_ids_json: string; acquisitions: number; created_at_ms: number; expires_at_ms: number };
export type GuestImageCopyPrefixTarget = { id: string; sequence: number; occurred: string; recorded: string; type: string; public: string;
  privateDigest: string; project: string | null; document: string | null; key: string };
export type GuestImageCopyPrefixLineage = { version: 1; sessionId: string; guestSubject: string; projectId: string; documentId: string; draftHash: string;
  manifestDigest: string; sourceEventIds: readonly string[]; sourceHead: number; destinationUserId: string; origin: string;
  targetStart: number; targetHead: number; events: readonly GuestImageCopyPrefixTarget[]; lease: GuestImageCopyLease };
export type GuestImageCopyIdentity = Pick<GuestImageCopyPrefixLineage,
  "sessionId" | "guestSubject" | "projectId" | "documentId" | "draftHash" | "manifestDigest" | "sourceHead">;
export function guestImageCopyPrefixEventInput(input: { sessionId: string; destinationStreamId: string; head: number },
  event: Pick<EventRow, "type" | "payload">, index: number): Parameters<typeof makeEvent> {
  return [input.destinationStreamId, input.head + index + 1, "user", "server:guest-context-adoption",
    `guest-context-adoption:${input.sessionId}`, event.type, { ...structuredClone(event.payload), client_event_id: prefixKey(input.sessionId, index) }];
}
export function guestImageCopyPrefixLineage(input: GuestImageCopyIdentity & { sourceEventIds: readonly string[]; destinationUserId: string; origin: string; head: number },
  prefixEvents: readonly EventRow[], hashes: readonly string[], lease: GuestImageCopyLease): GuestImageCopyPrefixLineage {
  const targets = prefixEvents.map((event, i) => { const values = eventWriteBindings(event); return { id: event.eventId, sequence: event.sequence,
    occurred: event.occurredAt, recorded: event.recordedAt, type: event.type, public: String(values[12]), privateDigest: hashes[i],
    project: values[14] as string | null, document: values[15] as string | null, key: prefixKey(input.sessionId, i) }; });
  return { version: 1, sessionId: input.sessionId, guestSubject: input.guestSubject, projectId: input.projectId,
    documentId: input.documentId, draftHash: input.draftHash, manifestDigest: input.manifestDigest, sourceEventIds: [...input.sourceEventIds],
    sourceHead: input.sourceHead, destinationUserId: input.destinationUserId, origin: input.origin, targetStart: input.head + 1,
    targetHead: input.head + prefixEvents.length, events: targets, lease };
}
export function guestImageCopyOriginalSource(input: Pick<GuestImageClaimLineage["source"],
  "head" | "eventIds" | "expiresAt" | "sessionPolicyId" | "sessionTermsDigest" | "sessionExpiresAtMs" | "releaseHash">,
  save: { event: Pick<EventRow, "eventId" | "sequence" | "occurredAt" | "recordedAt">; command: GuestImageCopyCommand; resource: GuestImageCopyResource },
  sourcePayload: Record<string, unknown>, original: Record<string, unknown>, privateDigest: string): GuestImageClaimLineage["source"] {
  return { head: input.head, eventIds: [...input.eventIds], expiresAt: input.expiresAt,
    sessionPolicyId: input.sessionPolicyId, sessionTermsDigest: input.sessionTermsDigest, sessionExpiresAtMs: input.sessionExpiresAtMs,
    sourcePolicyId: String(original.sourcePolicyId), sourcePolicyDigest: String(original.sourcePolicyDigest), requestDigest: String(original.requestDigest),
    contentDigest: String(original.contentDigest), releaseHash: input.releaseHash,
    save: { id: save.event.eventId, sequence: save.event.sequence, occurred: save.event.occurredAt, recorded: save.event.recordedAt,
      public: JSON.stringify(publicEventPayload(save.event.eventId, sourcePayload, true).payload), privateDigest },
    command: structuredClone(save.command), resource: structuredClone(save.resource) };
}
export function guestImageCopySaveEnvelope(input: Pick<GuestImageClaimLineage, "sessionId" | "manifestDigest" | "guestSubject" | "documentId" | "source"> &
  { contextHead: number; commandKey: string; requirementId: string }, originalEnvelope: Pick<Record<string, unknown>, "spec" | "planSuggestions">) {
  return { action: "save", documentId: input.documentId, expectedRevision: `output:${input.contextHead}`, clientMutationId: input.commandKey,
    blockId: input.requirementId, spec: structuredClone(originalEnvelope.spec), planSuggestions: structuredClone(originalEnvelope.planSuggestions),
    guestImageClaim: guestImageCopyClaimProvenance(input) };
}
export function guestImageCopySaveEventInput(input: { destinationStreamId: string; destinationUserId: string; contextHead: number; commandKey: string },
  sourcePayload: Record<string, unknown>, envelope: Record<string, unknown>): Parameters<typeof makeEvent> {
  return [input.destinationStreamId, input.contextHead + 1, `user:${input.destinationUserId}`, "server:output-requirements", input.commandKey, "BlockCreated",
    { ...structuredClone(sourcePayload), actor_user_id: input.destinationUserId, output_command_envelope: envelope }];
}
export function guestImageCopyLineage(input: Pick<GuestImageClaimLineage,
  "sessionId" | "guestSubject" | "destinationUserId" | "projectId" | "documentId" | "draftId" | "draftHash" | "manifestDigest" | "origin" | "contextLineageDigest" | "source"> &
  { commandKey: string; requestDigest: string; requirementId: string; contextHead: number }, tail: EventRow, privateDigest: string): GuestImageClaimLineage {
  return { version: 1, kind: "first-image-save", sessionId: input.sessionId, guestSubject: input.guestSubject,
    destinationUserId: input.destinationUserId, projectId: input.projectId, documentId: input.documentId, draftId: input.draftId, draftHash: input.draftHash,
    manifestDigest: input.manifestDigest, origin: input.origin, contextLineageDigest: input.contextLineageDigest, source: input.source,
    target: { id: tail.eventId, sequence: tail.sequence, occurred: tail.occurredAt, recorded: tail.recordedAt,
      public: String(eventWriteBindings(tail)[12]), privateDigest, commandKey: input.commandKey, requestDigest: input.requestDigest,
      requirementId: input.requirementId, contextHead: input.contextHead } };
}
const rowColumns = "session_id,destination_user_id,lease_id,request_id,manifest_digest,context_lineage_digest,lineage_json,lineage_digest,created_at_ms";
const commandColumns = "scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at";
const resourceColumns = "resource_id,campaign_id,policy_digest,limits_digest,actor_user_id,session_digest,operation,intent_key,payload_digest,text_bytes,issued_grant_id,recorded_at_ms";
const fail = (): never => guestFail("image_claim_unavailable");
const tuple = (row: object, columns: string) => JSON.stringify(columns.split(",").map(key => (row as Record<string, unknown>)[key]));
const arraySql = (columns: string, alias: string) => `json_array(${columns.split(",").map(key => `${alias}.${key}`).join(",")})`;
const prefixKey = (session: string, index: number) => `guest-context-adoption:v1:${session}:${index}`;
const parsed = (value: string): Record<string, unknown> => {
  let result: unknown; try { result = JSON.parse(value); } catch { return fail(); }
  if (!record(result) || jsonIssues(result).length) return fail();
  return result;
};

export async function guestImageCopyCommandKey(sessionId: string, destinationUserId: string, manifestDigest: string) {
  return `guest-image-save-claim-v1:${(await digest({ domain: "forma-guest-image-save-claim@1", sessionId, destinationUserId, manifestDigest })).slice(7)}`;
}

export function guestImageCopyClaimRowProof(row: GuestImageCopyRow): Proof {
  return { sql: `EXISTS(SELECT 1 FROM experience_guest_image_claims claim WHERE ${arraySql(rowColumns, "claim")}=?)`, bindings: [tuple(row, rowColumns)] };
}

export function guestImageCopyEventMeta(lineage: Pick<GuestImageClaimLineage, "destinationUserId" | "guestSubject" | "projectId" | "documentId"> & {
  target: EventIdentity & { commandKey: string }; source: { save: EventIdentity; command: Pick<GuestImageCopyCommand, "command_key"> };
}, target: boolean): Proof {
  const event = target ? lineage.target : lineage.source.save, owner = target ? lineage.destinationUserId : lineage.guestSubject;
  return { sql: `EXISTS(SELECT 1 FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id
    WHERE json_array(e.event_id,e.stream_id,e.sequence,e.occurred_at,e.recorded_at,e.actor,e.client_id,e.correlation_id,e.causation_id,e.compensates_event_id,e.schema_version,e.type,e.payload,
      body.owner_id,body.project_id,body.document_id,body.created_at)=?)`, bindings: [JSON.stringify([event.id, `creative:${owner}`, event.sequence, event.occurred, event.recorded,
    target ? `user:${owner}` : owner, target ? "server:output-requirements" : "server:guest-output", target ? lineage.target.commandKey : lineage.source.command.command_key,
    null, null, 1, "BlockCreated", event.public, owner, lineage.projectId, lineage.documentId, event.recorded])] };
}

export function guestImageCopyCommandProof(lineage: Pick<GuestImageClaimLineage, "destinationUserId" | "projectId"> & {
  source: Pick<GuestImageClaimLineage["source"], "command" | "resource">;
  target: Pick<GuestImageClaimLineage["target"], "commandKey" | "requestDigest" | "id" | "recorded">;
}): Proof {
  return { sql: `EXISTS(SELECT 1 FROM output_commands command WHERE ${arraySql(commandColumns, "command")}=?)
    AND EXISTS(SELECT 1 FROM output_commands command WHERE ${arraySql(commandColumns, "command")}=?)
    AND EXISTS(SELECT 1 FROM experience_sponsor_resource_receipts resource WHERE ${arraySql(resourceColumns, "resource")}=?)`, bindings: [
    tuple(lineage.source.command, commandColumns), JSON.stringify([`personal:${lineage.destinationUserId}:${lineage.projectId}`, lineage.destinationUserId,
      lineage.target.commandKey, lineage.target.requestDigest, "save", lineage.target.id, lineage.target.recorded]), tuple(lineage.source.resource, resourceColumns)] };
}

export function guestImageCopyTargetCustody(lineage: Pick<GuestImageClaimLineage, "destinationUserId"> & {
  target: Pick<GuestImageClaimLineage["target"], "id" | "requirementId" | "sequence">;
}, prefix: { events: readonly Pick<GuestImageCopyPrefixTarget, "type" | "public">[] }): Proof {
  const blocks = prefix.events.flatMap(event => {
    const block = parsed(event.public).block_id; return event.type === "BlockCreated" && typeof block === "string" ? [block] : [];
  });
  blocks.push(lineage.target.requirementId);
  return { sql: `NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='block' AND resource_id IN(SELECT value FROM json_each(?)))
    AND (SELECT COUNT(*) FROM events WHERE stream_id=? AND type='BlockCreated' AND json_extract(payload,'$.block_id')=?)=1
    AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND sequence>? AND type IN('BlockRemoved','BlockRehomed') AND json_extract(payload,'$.block_id')=?)`,
  bindings: [lineage.target.id, JSON.stringify([...new Set(blocks)]), `creative:${lineage.destinationUserId}`, lineage.target.requirementId,
    `creative:${lineage.destinationUserId}`, lineage.target.sequence, lineage.target.requirementId] };
}

export function guestImageCopyTargetBody(lineage: Pick<GuestImageClaimLineage, "destinationUserId" | "projectId" | "documentId"> & {
  target: Pick<GuestImageClaimLineage["target"], "id" | "recorded">;
}, content: string): Proof {
  return { sql: `EXISTS(SELECT 1 FROM event_private_payloads body WHERE private_event_id=? AND owner_id=? AND project_id=? AND document_id=?
    AND created_at=? AND private_json=? AND redacted_at IS NULL)`, bindings: [lineage.target.id, lineage.destinationUserId, lineage.projectId, lineage.documentId, lineage.target.recorded, content] };
}

export function guestImageCopyPrefixTargets(lineage: Pick<GuestImageCopyPrefixLineage, "events" | "destinationUserId" | "sessionId">, bodies: readonly string[]): Proof {
  const values = lineage.events.map((event, index) => ({ ...event, private: bodies[index] }));
  return { sql: `(SELECT COUNT(*) FROM json_each(?) expected
    JOIN events event ON event.event_id=json_extract(expected.value,'$.id') AND event.stream_id=? AND event.sequence=json_extract(expected.value,'$.sequence')
      AND event.occurred_at=json_extract(expected.value,'$.occurred') AND event.recorded_at=json_extract(expected.value,'$.recorded')
      AND event.actor='user' AND event.client_id='server:guest-context-adoption' AND event.correlation_id=? AND event.schema_version=1
      AND event.causation_id IS NULL AND event.compensates_event_id IS NULL AND event.type=json_extract(expected.value,'$.type') AND event.payload=json_extract(expected.value,'$.public')
    JOIN event_private_payloads body ON body.private_event_id=event.event_id AND body.owner_id=? AND body.redacted_at IS NULL
      AND body.project_id IS json_extract(expected.value,'$.project') AND body.document_id IS json_extract(expected.value,'$.document')
      AND body.private_json=json_extract(expected.value,'$.private') AND body.created_at=event.recorded_at
    JOIN event_client_receipts receipt ON receipt.stream_id=event.stream_id AND receipt.event_id=event.event_id AND receipt.sequence=event.sequence
      AND receipt.client_event_id=json_extract(expected.value,'$.key') AND receipt.created_at=event.recorded_at)=?`,
  bindings: [JSON.stringify(values), `creative:${lineage.destinationUserId}`, `guest-context-adoption:${lineage.sessionId}`, lineage.destinationUserId, values.length] };
}

export function guestImageCopyClaimProvenance(lineage: Pick<GuestImageClaimLineage, "sessionId" | "manifestDigest" | "guestSubject"> & {
  source: { command: Pick<GuestImageCopyCommand, "command_key" | "request_digest">; save: Pick<EventIdentity, "id"> };
}) {
  return { version: 1, sessionId: lineage.sessionId, manifestDigest: lineage.manifestDigest, sourceCommandKey: lineage.source.command.command_key,
    sourceRequestDigest: lineage.source.command.request_digest, sourceEventId: lineage.source.save.id, guestSubject: lineage.guestSubject };
}

// This registry records only immutable proof construction, never authority.
// Flattening our own conjunctions avoids nesting packed parameter subqueries
// past D1's expression-depth limit. Foreign predicates remain untouched leaves.
const constructedProofs = new WeakMap<Proof, readonly Proof[]>();
/** Pure parameter transport for complete trusted custody predicates. Every
 * original predicate remains in one joined snapshot; the qualified native
 * packer preserves binding affinity, nulls and quoted/commented SQL tokens. */
export function guestImageCopyProof(parts: readonly Proof[]): Proof {
  if (!parts.length) return fail();
  const leaves = parts.flatMap(part => constructedProofs.get(part) ?? [part]).map(part => {
    const captured = { sql: part.sql, bindings: [...part.bindings] }; Object.freeze(captured.bindings); return Object.freeze(captured);
  });
  let name = "guest_image_copy", suffix = 0;
  while (leaves.some(part => part.sql.toLowerCase().includes(name))) name = `guest_image_copy_${++suffix}`;
  const groups = Array.from({ length: Math.ceil(leaves.length / 16) }, (_, index) => leaves.slice(index * 16, index * 16 + 16));
  if (groups.length > 64) return fail();
  const sql = `SELECT 1 AS current WHERE EXISTS(WITH ${leaves.map((part, i) => `${name}_p${i} AS MATERIALIZED(SELECT 1 WHERE ${part.sql})`).join(",")},
    ${groups.map((group, i) => `${name}_group${i} AS MATERIALIZED(SELECT 1 FROM ${group.map((_, j) => `${name}_p${i * 16 + j}`).join(",")})`).join(",")}
    SELECT 1 FROM ${groups.map((_, i) => `${name}_group${i}`).join(",")})`;
  const packed = packSponsorIntakeReadQuery(sql, leaves.flatMap(part => part.bindings));
  const proof = { sql: `EXISTS(${packed.sql})`, bindings: [...packed.bindings] };
  Object.freeze(proof.bindings); Object.freeze(proof); constructedProofs.set(proof, Object.freeze(leaves)); return proof;
}
