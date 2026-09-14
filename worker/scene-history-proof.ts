import type { OutputSqlAssertion, OutputSqlValue } from "./output-command-core.ts";

/** Server-only capture port. verify must check EVERY assertion in one snapshot.
 * Its successful read is not permission to omit the same assertions at a write. */
export type SceneHistoryProofPort = {
  read(sql: string, bindings: readonly OutputSqlValue[]): Promise<Record<string, unknown>[]>;
  verify(assertions: readonly OutputSqlAssertion[]): Promise<void>;
};
export type SceneHistoryScope = Readonly<{
  streamId: string;
  expectedOwnerHead: number;
  project?: Readonly<{ projectAccessId: string; organizationId: string; projectId: string; ownerUserId: string }>;
  /** Optional existing request deadline; checked again after every awaited port. */
  deadlineMs?: number;
}>;
export const SCENE_HISTORY_PROOF_LIMITS = Object.freeze({
  rows: 40_000, rawBytes: 16 * 1024 * 1024, proofBytes: 36 * 1024 * 1024,
  assertions: 384, reads: 512, bindingBytes: 128 * 1024,
});
type Limits = { -readonly [Key in keyof typeof SCENE_HISTORY_PROOF_LIMITS]: number };
type CapacityReason = "limit_config" | "reads" | "sql_bytes" | "bindings" | "binding_bytes" | "assertions" | "proof_bytes" | "rows" | "raw_bytes";
type Cell = string | number | null;
type Row = Record<string, Cell>;
type Piece = { event_id: string; order_sequence: number; field: "public_body" | "private_body"; offset: number; bytes: number; total: number; storage: string };
// Capture processes one bounded page/batch at a time, never all row objects or
// all hex pieces together. Larger histories retain the same byte/proof limits.
const encoder = new TextEncoder(), PAGE_ROWS = 256, CHUNK_BYTES = 8192, READ_PIECES = 512;
const PIECE_RESPONSE_BYTES = 208896;
const rowFields = ["event_id", "event_present", "event_stream", "sequence", "order_sequence", "event_type", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "private_event_id", "private_owner", "private_project", "private_document", "redacted_at",
  "public_type", "public_bytes", "private_type", "private_bytes", "member_source_stream", "member_source_sequence", "member_actor", "member_created"] as const;
const textFields = ["event_id", "event_stream", "event_type", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "private_event_id", "private_owner", "private_project", "private_document", "redacted_at", "member_source_stream", "member_actor", "member_created"] as const;
export class SceneHistoryProofError extends Error {
  readonly status: number;
  readonly code: "scene_cost_history_unavailable" | "scene_cost_history_changed" | "scene_cost_history_capacity_exceeded";
  readonly capacityReason?: CapacityReason;
  constructor(code: "scene_cost_history_unavailable" | "scene_cost_history_changed" | "scene_cost_history_capacity_exceeded", capacityReason?: CapacityReason) {
    super(code); this.code = code; this.name = "SceneHistoryProofError"; this.status = code === "scene_cost_history_capacity_exceeded" ? 413 : 409;
    if (code === "scene_cost_history_capacity_exceeded" && capacityReason) this.capacityReason = capacityReason;
  }
}
function changed(): never { throw new SceneHistoryProofError("scene_cost_history_changed"); }
function unavailable(): never { throw new SceneHistoryProofError("scene_cost_history_unavailable"); }
function capacity(reason: CapacityReason): never { throw new SceneHistoryProofError("scene_cost_history_capacity_exceeded", reason); }
const bytes = (text: string) => encoder.encode(text).byteLength;
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && bytes(value) <= 160;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function binaryTextCompare(left: string, right: string) {
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}

function sourceRelation(scope: SceneHistoryScope) {
  const project = scope.project;
  const fields = `event.stream_id AS event_stream,event.sequence,event.type AS event_type,event.occurred_at,event.recorded_at,
    event.actor,event.client_id,event.correlation_id,event.causation_id,event.compensates_event_id,event.schema_version,
    event.payload AS public_body,secret.private_json AS private_body,
    secret.private_event_id,secret.owner_id AS private_owner,secret.project_id AS private_project,
    secret.document_id AS private_document,secret.redacted_at`;
  return project ? {
    sql: `SELECT membership.event_id,CASE WHEN event.event_id IS NULL THEN 0 ELSE 1 END AS event_present,${fields},membership.project_sequence AS order_sequence,
      membership.source_stream_id AS member_source_stream,membership.source_sequence AS member_source_sequence,
      membership.actor_user_id AS member_actor,membership.created_at AS member_created
      FROM project_event_scopes membership LEFT JOIN events event ON event.event_id=membership.event_id
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      WHERE membership.project_access_id=? AND membership.organization_id=? AND membership.project_id=? AND membership.owner_user_id=?`,
    bindings: [project.projectAccessId, project.organizationId, project.projectId, project.ownerUserId] as OutputSqlValue[],
  } : {
    sql: `SELECT event.event_id,1 AS event_present,${fields},event.sequence AS order_sequence,NULL AS member_source_stream,NULL AS member_source_sequence,
      NULL AS member_actor,NULL AS member_created FROM events event
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.stream_id=?`,
    bindings: [scope.streamId] as OutputSqlValue[],
  };
}

// No aggregate ever materializes a raw body. Text metadata is bounded before it
// can be returned, and an invalid sentinel is rejected rather than accepted as NULL.
const metadataSelect = `SELECT ${textFields.map(field => `CASE WHEN ${field} IS NULL OR (typeof(${field})='text' AND length(CAST(${field} AS BLOB))<=512) THEN ${field} ELSE NULL END AS ${field}`).join(",")},
  event_present,sequence,order_sequence,schema_version,member_source_sequence,typeof(public_body) AS public_type,COALESCE(length(CAST(public_body AS BLOB)),0) AS public_bytes,
  typeof(private_body) AS private_type,COALESCE(length(CAST(private_body AS BLOB)),0) AS private_bytes,
  CASE WHEN ${textFields.map(field => `(${field} IS NULL OR (typeof(${field})='text' AND length(CAST(${field} AS BLOB))<=512))`).join(" AND ")} THEN 1 ELSE 0 END AS metadata_valid FROM source`;

/** Complete original row set, including missing/redacted private rows and project
 * membership. BLOB-byte hex slices preserve Unicode boundaries, empty values and
 * embedded NULs; total byte length and SQLite storage type are separately pinned.
 *
 * Capture has finite work/evidence limits, not an unlimited-history promise. It
 * never returns a truncated proof. The original array must survive preparation,
 * atomic admission/job/budget writes and final paid dispatch unchanged. */
export async function captureSceneHistoryProof(port: SceneHistoryProofPort, input: SceneHistoryScope, lowerLimits: Partial<Limits> = {}) {
  const scope: SceneHistoryScope = Object.freeze({ streamId: input.streamId, expectedOwnerHead: input.expectedOwnerHead,
    ...(input.project ? { project: Object.freeze({ ...input.project }) } : {}), ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }) });
  if (!identifier(scope.streamId) || !integer(scope.expectedOwnerHead)
    || scope.project && (!Object.values(scope.project).every(identifier) || scope.streamId !== "creative:" + scope.project.ownerUserId)
    || scope.deadlineMs !== undefined && !Number.isFinite(scope.deadlineMs)) unavailable();
  const limits: Limits = { ...SCENE_HISTORY_PROOF_LIMITS };
  for (const key of Object.keys(lowerLimits) as Array<keyof Limits>) {
    if (!Object.hasOwn(limits, key)) capacity("limit_config");
    const value = lowerLimits[key];
    if (!integer(value) || value < 1 || value > limits[key]) capacity("limit_config");
    limits[key] = value;
  }
  const deadline = () => { if (scope.deadlineMs !== undefined && Date.now() >= scope.deadlineMs) changed(); };
  const relation = sourceRelation(scope), cte = `WITH source AS NOT MATERIALIZED (${relation.sql})`;
  let reads = 0, proofBytes = 0;
  const read = async (sql: string, bindings: OutputSqlValue[]) => {
    deadline(); if (++reads > limits.reads) capacity("reads");
    if (bytes(sql) > 99_000) capacity("sql_bytes");
    if (bindings.length > 99) capacity("bindings");
    if (bindings.some(value => typeof value === "string" && bytes(value) > limits.bindingBytes)) capacity("binding_bytes");
    const rows = await port.read(sql, bindings); deadline();
    if (!Array.isArray(rows)) unavailable();
    return rows;
  };
  const assertions: OutputSqlAssertion[] = [];
  const add = (sql: string, bindings: OutputSqlValue[]) => {
    if (bytes(sql) > 99_000) capacity("sql_bytes");
    if (bindings.length > 99) capacity("bindings");
    if (assertions.length >= limits.assertions) capacity("assertions");
    for (const value of bindings) if (typeof value === "string") {
      const size = bytes(value); if (size > limits.bindingBytes) capacity("binding_bytes"); proofBytes += size;
    }
    if (proofBytes > limits.proofBytes) capacity("proof_bytes");
    assertions.push({ sql, bindings, ...(scope.deadlineMs === undefined ? {} : { deadlineMs: scope.deadlineMs }) });
  };
  const [initial, ...extra] = await read(`${cte} SELECT (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS owner_head,
    COUNT(*) AS source_count,COALESCE(MAX(order_sequence),0) AS source_head FROM source`, [...relation.bindings, scope.streamId]);
  if (!initial || extra.length || !integer(initial.owner_head) || !integer(initial.source_count) || !integer(initial.source_head)) unavailable();
  if (initial.owner_head !== scope.expectedOwnerHead) changed();
  if (initial.source_count > limits.rows) capacity("rows");
  add(`${cte} SELECT (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
    AND COUNT(*)=? AND COALESCE(MAX(order_sequence),0)=? FROM source`,
  [...relation.bindings, scope.streamId, scope.expectedOwnerHead, initial.source_count, initial.source_head]);

  const packer = (commit: (json: string) => void) => {
    let items: string[] = [], used = 2;
    const flush = () => { if (items.length) commit("[" + items.join(",") + "]"); items = []; used = 2; };
    return {
      append(value: unknown) {
        const encoded = JSON.stringify(value), size = bytes(encoded) + 1;
        if (size + 2 > limits.bindingBytes) capacity("binding_bytes");
        if (items.length && used + size > limits.bindingBytes) flush();
        items.push(encoded); used += size;
      },
      flush,
    };
  };
  // Four individually bounded JSON bindings share one predicate, without
  // recombining them into an oversized value. This bounds later hydration and
  // atomic-verification query counts as well as capture's own reads.
  const proofPacker = (sql: (expected: string) => string) => {
    let packed: string[] = [];
    const commit = () => {
      if (packed.length) add(sql(packed.map(() => "SELECT value FROM json_each(?)").join(" UNION ALL ")), [...relation.bindings, ...packed]);
      packed = [];
    };
    const values = packer(json => { packed.push(json); if (packed.length === 4) commit(); });
    return { append: values.append, flush() { values.flush(); commit(); } };
  };
  // Fixed-position tuples avoid repeating every metadata key for every row;
  // each original field, including storage/custody/membership, remains pinned.
  const fieldPath = (field: typeof rowFields[number]) => `$[${rowFields.indexOf(field)}]`;
  const metadata = proofPacker(expected => `${cte}, metadata AS NOT MATERIALIZED (${metadataSelect}), expected AS (${expected}) SELECT NOT EXISTS(
    SELECT 1 FROM expected WHERE NOT EXISTS(SELECT 1 FROM metadata actual
      WHERE actual.event_id=json_extract(expected.value,'${fieldPath("event_id")}') AND actual.order_sequence=json_extract(expected.value,'${fieldPath("order_sequence")}')
      AND actual.metadata_valid=1 AND ${rowFields.map(field => `actual.${field} IS json_extract(expected.value,'${fieldPath(field)}')`).join(" AND ")}))`);
  const exact = proofPacker(expected => `${cte}, expected AS (${expected}) SELECT NOT EXISTS(SELECT 1 FROM expected WHERE NOT EXISTS(SELECT 1 FROM source actual
    WHERE actual.event_id=json_extract(expected.value,'$[0]') AND actual.order_sequence=json_extract(expected.value,'$[1]')
      AND typeof(CASE json_extract(expected.value,'$[2]') WHEN 'public_body' THEN actual.public_body ELSE actual.private_body END) IS json_extract(expected.value,'$[6]')
      AND COALESCE(length(CAST(CASE json_extract(expected.value,'$[2]') WHEN 'public_body' THEN actual.public_body ELSE actual.private_body END AS BLOB)),0)=json_extract(expected.value,'$[5]')
      AND hex(substr(CAST(CASE json_extract(expected.value,'$[2]') WHEN 'public_body' THEN actual.public_body ELSE actual.private_body END AS BLOB),
        json_extract(expected.value,'$[3]'),json_extract(expected.value,'$[4]')))=json_extract(expected.value,'$[7]')))`);
  const capturePieces = async (batch: Piece[]) => {
    // CROSS JOIN fixes the small expected list as the outer loop. Without it,
    // SQLite may scan the whole owner stream for every piece batch.
    const actual = await read(`${cte} SELECT expected.key AS ordinal,source.event_id,source.order_sequence,
      typeof(CASE json_extract(expected.value,'$.field') WHEN 'public_body' THEN source.public_body ELSE source.private_body END) AS storage,
      COALESCE(length(CAST(CASE json_extract(expected.value,'$.field') WHEN 'public_body' THEN source.public_body ELSE source.private_body END AS BLOB)),0) AS total,
      hex(substr(CAST(CASE json_extract(expected.value,'$.field') WHEN 'public_body' THEN source.public_body ELSE source.private_body END AS BLOB),
        json_extract(expected.value,'$.offset'),json_extract(expected.value,'$.bytes'))) AS part
      FROM json_each(?) expected CROSS JOIN source WHERE source.event_id=json_extract(expected.value,'$.event_id')
        AND source.order_sequence=json_extract(expected.value,'$.order_sequence') ORDER BY CAST(expected.key AS INTEGER)`, [...relation.bindings, JSON.stringify(batch)]);
    if (actual.length !== batch.length) changed();
    for (const [index, value] of actual.entries()) {
      const piece = batch[index]!;
      if (value.ordinal !== index || value.event_id !== piece.event_id || value.order_sequence !== piece.order_sequence
        || value.storage !== piece.storage || value.total !== piece.total || typeof value.part !== "string"
        || value.part.length !== piece.bytes * 2 || !/^[0-9A-F]+$/u.test(value.part)) changed();
      // Fixed tuple: identity, order, field, byte offset/count, total, type, hex.
      exact.append([piece.event_id, piece.order_sequence, piece.field, piece.offset, piece.bytes, piece.total, piece.storage, value.part]);
    }
  };
  let rowCount = 0, afterSequence = 0, afterId = "", rawBytes = 0;
  while (rowCount < initial.source_count) {
    const page = await read(`${cte}, metadata AS NOT MATERIALIZED (${metadataSelect}) SELECT * FROM metadata
      WHERE order_sequence>? OR (order_sequence=? AND event_id>?) ORDER BY order_sequence,event_id LIMIT ${PAGE_ROWS}`,
    [...relation.bindings, afterSequence, afterSequence, afterId]);
    if (!page.length || page.length > PAGE_ROWS) changed();
    const rows: Row[] = [];
    for (const candidate of page) {
      if (candidate.metadata_valid !== 1 || candidate.event_present !== 1 || candidate.event_stream !== scope.streamId
        || !identifier(candidate.event_id) || !integer(candidate.sequence) || candidate.sequence < 1
        || !integer(candidate.order_sequence) || candidate.order_sequence < 1
        || !integer(candidate.schema_version) || candidate.schema_version < 1
        || !integer(candidate.public_bytes) || !integer(candidate.private_bytes)
        || !["null", "text", "blob"].includes(String(candidate.public_type)) || !["null", "text", "blob"].includes(String(candidate.private_type))
        || candidate.member_source_sequence !== null && !integer(candidate.member_source_sequence)
        || scope.project && (candidate.member_source_stream !== scope.streamId || candidate.member_source_sequence !== candidate.sequence)) unavailable();
      if (candidate.order_sequence < afterSequence || candidate.order_sequence === afterSequence && binaryTextCompare(candidate.event_id, afterId) <= 0) changed();
      const row = Object.fromEntries(rowFields.map(field => {
        const value = candidate[field];
        if (value !== null && typeof value !== "string" && typeof value !== "number") unavailable();
        return [field, value];
      })) as Row;
      rows.push(row); rowCount++; afterSequence = candidate.order_sequence; afterId = candidate.event_id;
      rawBytes += candidate.public_bytes + candidate.private_bytes;
      if (rowCount > limits.rows) capacity("rows");
      if (rawBytes > limits.rawBytes) capacity("raw_bytes");
      if (rowCount > initial.source_count) changed();
      metadata.append(rowFields.map(field => row[field]));
    }
    let batch: Piece[] = [], requestBytes = 2, responseBytes = 2;
    for (const row of rows) for (const field of ["public_body", "private_body"] as const) {
      const prefix = field === "public_body" ? "public" : "private", total = Number(row[`${prefix}_bytes`]);
      // Empty and NULL fields are pinned by metadata. Generate only the next
      // piece, keeping request bytes, exact JSON response bytes and rows bounded.
      for (let offset = 1; offset <= total; offset += CHUNK_BYTES) {
        const piece: Piece = { event_id: String(row.event_id), order_sequence: Number(row.order_sequence),
          field, offset, bytes: Math.min(CHUNK_BYTES, total - offset + 1), total, storage: String(row[`${prefix}_type`]) };
        const inputBytes = bytes(JSON.stringify(piece)) + 1;
        const outputBytes = bytes(JSON.stringify({ ordinal: READ_PIECES, event_id: piece.event_id, order_sequence: piece.order_sequence,
          storage: piece.storage, total: piece.total, part: "" })) + piece.bytes * 2 + 1;
        if (inputBytes + 2 > limits.bindingBytes) capacity("binding_bytes");
        if (batch.length && (batch.length >= READ_PIECES || requestBytes + inputBytes > limits.bindingBytes || responseBytes + outputBytes > PIECE_RESPONSE_BYTES)) {
          await capturePieces(batch); batch = []; requestBytes = 2; responseBytes = 2;
        }
        batch.push(piece); requestBytes += inputBytes; responseBytes += outputBytes;
      }
    }
    if (batch.length) await capturePieces(batch);
  }
  metadata.flush(); exact.flush();
  const retained = Object.freeze(assertions.map(assertion => Object.freeze({ ...assertion, bindings: Object.freeze([...(assertion.bindings ?? [])]) }) as unknown as OutputSqlAssertion));
  deadline(); await port.verify(retained); deadline();
  // proofBytes counts UTF-8 string binding payloads, not SQL text. SQL has its
  // own per-statement cap and the assertion count supplies the aggregate bound.
  return Object.freeze({ version: "scene-history-proof-v1" as const, scope, rows: rowCount, rawBytes, proofBytes,
    captureReads: reads, assertions: retained });
}
