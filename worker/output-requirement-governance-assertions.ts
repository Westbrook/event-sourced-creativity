import { OUTPUT_REQUIREMENT_EVENT_TYPES } from "../src/model/output-requirement-events.ts";
import { creativeContextRightsIssue } from "../src/model/context-health.ts";
import { foldEvents, type CreativeBlock, type CreativeEvent } from "../src/model/events.ts";
import { licensedPackageSourceBlocks } from "./context-package-rights.ts";
import { serializeEvent, type WorkerEnv } from "./runtime.ts";
import { OutputConflictError, type OutputSqlAssertion, type OutputSqlValue } from "./output-requirements-ledger.ts";

type GovernedBlock = Pick<CreativeBlock, "id" | "projectId" | "documentId" | "properties">;
type Row = Record<string, string | number | null>;
type SnapshotBlock = {
  sourceBlockId: string; type: string; properties: Record<string, unknown>;
  contentSha256: string; rightsExpiresAt: string | null; source?: unknown;
};
type Snapshot = { schema: 1; organizationId: string; sourceProjectAccessId: string; sourceDocumentId: string; blocks: SnapshotBlock[] };
type Origin = { row: Row; events: CreativeEvent[]; rows: Row[] };
type ProofRead = { select: string; orderBy: string; columns: readonly string[]; bindings: OutputSqlValue[]; maximum: number };
export type OutputGovernanceCaptureOptions = {
  /** The caller must validate EVERY returned assertion in its existing final read batch. */
  deferValidation?: boolean;
  /** Reject before another capture batch; never substitute a partial source assignment. */
  maximumCaptureBatches?: number;
};
const MAX_PROOF_BYTES = 2_000_000;
const MAX_PACKAGE_BLOCKS = 128;
const MAX_SOURCE_EVENTS = 10_000;
const MAX_PACKAGES = 16;
const MAX_BINDINGS = 64;
const MAX_DEPTH = 8;
const provenanceFields = ["organization_context_package_id", "organization_context_package_version_id", "organization_context_package_binding_id", "organization_context_source_block_id"] as const;
const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const present = (value: unknown) => value !== undefined && value !== null && value !== "";
const packageKey = (packageId: string, versionId: string) => JSON.stringify([packageId, versionId]);
function unavailable(code = "output_source_governance_unavailable"): never { throw new OutputConflictError(code, 409); }
function textId(value: unknown): string { return typeof value === "string" && value.length > 0 && value.length <= 160 ? value : unavailable(); }
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Capture a complete, ordered row set, not just the rows which happened to exist.
 * The returned SQL is an assertion for the caller's write batch. Its bindings may
 * contain retained private bodies and must never be persisted, logged or returned.
 */
class GovernanceProof {
  readonly assertions: OutputSqlAssertion[] = [];
  readonly env: WorkerEnv;
  private bytes = 0;
  private deadline: number | null = null;
  private captureBatches = 0;
  private readonly maximumCaptureBatches: number;
  private readonly deferValidation: boolean;
  constructor(env: WorkerEnv, options: OutputGovernanceCaptureOptions) {
    this.env = env;
    this.maximumCaptureBatches = options.maximumCaptureBatches ?? MAX_PACKAGES * 2 + 1;
    this.deferValidation = options.deferValidation === true;
    if (!Number.isSafeInteger(this.maximumCaptureBatches) || this.maximumCaptureBatches < 1 || this.maximumCaptureBatches > MAX_PACKAGES * 2 + 1)
      unavailable("output_source_governance_capacity_exceeded");
  }

  async batch(reads: readonly ProofRead[]): Promise<Row[][]> {
    if (!reads.length) return [];
    if (this.captureBatches >= this.maximumCaptureBatches) unavailable("output_source_governance_capacity_exceeded");
    if (this.assertions.length + reads.length > 256) unavailable("output_source_governance_proof_too_large");
    // Leave room for SQLite's single-column record header as well as its value.
    // Every read uses the remaining complete-proof budget, never a truncated set.
    const maximumJsonBytes = Math.min(MAX_PROOF_BYTES - this.bytes, MAX_PROOF_BYTES - 64);
    if (maximumJsonBytes < 2) unavailable("output_source_governance_proof_too_large");
    const queries = reads.map(({ select, orderBy, columns, maximum }) => {
      // D1 permits 32 function arguments. json_set preserves null-valued keys;
      // json_patch would delete them and weaken exact retained-body assertions.
      const first = columns.slice(0, 16).map(column => `'${column}',proof.${column}`).join(",");
      let rowJson = `json_object(${first})`;
      for (let offset = 16; offset < columns.length; offset += 15) {
        const next = columns.slice(offset, offset + 15).map(column => `'$.${column}',proof.${column}`).join(",");
        rowJson = `json_set(${rowJson},${next})`;
      }
      const rowOverhead = 2 + Math.max(0, columns.length - 1)
        + columns.reduce((sum, column) => sum + encoder.encode(JSON.stringify(column)).byteLength + 1, 0);
      const minimumRowBytes = [rowOverhead, ...columns.map(column => `COALESCE(length(CAST(proof.${column} AS BLOB)),0)`)].join("+");
      const exactRowBytes = [rowOverhead, ...columns.map(column => {
        const value = `proof.${column}`, bytes = `length(CAST(${value} AS BLOB))`;
        // JSON escapes ASCII bytes but keeps UTF-8 bytes, even across a slice
        // boundary. Blob slices retain embedded NULs, unlike text substr(). Each
        // json_quote sees at most 4 KiB (24 KiB after worst-case escaping).
        return `CASE WHEN typeof(${value})='text' AND ${bytes}>4096
          THEN 2+(SELECT SUM(length(CAST(json_quote(CAST(substr(CAST(${value} AS BLOB),part.offset,4096) AS TEXT)) AS BLOB))-2)
            FROM proof_parts part WHERE part.offset<=${bytes})
          ELSE length(CAST(json_quote(${value}) AS BLOB)) END`;
      })].join("+");
      const arrayBytes = (rowBytes: string) => `2+COALESCE(SUM(1+${rowBytes}),0)-CASE WHEN COUNT(*)>0 THEN 1 ELSE 0 END`;
      // An outer CASE around the aggregate itself is too late: SQLite evaluates
      // it first. These scalar subqueries are lazy CASE branches. Count and raw
      // bytes bound the work before measuring escapes; only a complete, fitting
      // set can construct json_object/json_group_array. The initial size-only
      // projection has no ordering, so it cannot sort oversized joined raw rows.
      // It retains all rows when count<=maximum and otherwise always refuses.
      // The returned/compared proof keeps the separately declared original order.
      // The same guard is reused unchanged in read/decision assertions, including
      // size races; no oversized set is filtered down into an accepted proof.
      return `(WITH RECURSIVE proof_parts(offset) AS (
          VALUES(1) UNION ALL SELECT offset+4096 FROM proof_parts WHERE offset+4096<=${MAX_PROOF_BYTES}
        ), proof_source AS NOT MATERIALIZED (${select}), proof_sizes AS MATERIALIZED (
          SELECT ${minimumRowBytes} AS raw_bytes FROM proof_source proof LIMIT ${maximum + 1}
        ), proof_rows AS NOT MATERIALIZED (SELECT * FROM proof_source ORDER BY ${orderBy} LIMIT ${maximum + 1})
        SELECT CASE
          WHEN (SELECT COUNT(*)>${maximum} OR ${arrayBytes("raw_bytes")}>${maximumJsonBytes} FROM proof_sizes) THEN NULL
          WHEN (SELECT ${arrayBytes(exactRowBytes)}>${maximumJsonBytes} FROM proof_rows proof) THEN NULL
          ELSE (SELECT json_group_array(${rowJson}) FROM proof_rows proof)
        END)`;
    });
    if (queries.some((sql, index) => encoder.encode(sql).byteLength > 99_000 || reads[index]!.bindings.length > 99)) unavailable("output_source_governance_proof_too_large");
    this.captureBatches++;
    const results = await this.env.DB.batch<{ proof_json: string | null }>(queries.map((sql, index) => this.env.DB.prepare(`SELECT ${sql} AS proof_json`).bind(...reads[index]!.bindings)));
    if (results.length !== reads.length) unavailable();
    let capturedBytes = this.bytes;
    const captured = results.map((result, index) => {
      const json = result.results[0]?.proof_json, read = reads[index]!;
      if (result.success === false) unavailable();
      if (json === null) unavailable("output_source_governance_proof_too_large");
      if (typeof json !== "string") unavailable();
      capturedBytes += encoder.encode(json).byteLength;
      if (capturedBytes > MAX_PROOF_BYTES) unavailable("output_source_governance_proof_too_large");
      const rows = JSON.parse(json) as Row[];
      if (!Array.isArray(rows)) unavailable();
      if (rows.length > read.maximum) unavailable("output_source_governance_proof_too_large");
      return { rows, assertion: { sql: `${queries[index]}=?`, bindings: [...read.bindings, json] } };
    });
    // A sentinel anywhere in this batch must not retain partial read witnesses.
    this.bytes = capturedBytes;
    this.assertions.push(...captured.map(item => item.assertion));
    return captured.map(item => item.rows);
  }

  expires(value: unknown) {
    if (!present(value)) return;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) unavailable();
    const deadline = Date.parse(value);
    if (deadline <= Date.now()) unavailable("context_source_rights_expired");
    this.deadline = this.deadline === null ? deadline : Math.min(this.deadline, deadline);
  }

  rights(properties: Record<string, unknown>) {
    if (creativeContextRightsIssue(properties)) unavailable("context_source_rights_expired");
    for (const field of ["source_expires_at", "license_expires_at", "rights_expires_at"]) this.expires(properties[field]);
  }

  async finish() {
    // A source license is evaluated against the database's commit clock, including
    // while retained bytes are under a legal hold. Retention is not a license.
    if (this.deadline !== null) this.assertions.push({ sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [new Date(this.deadline).toISOString()] });
    if (!this.deferValidation && this.assertions.length) {
      const checked = await this.env.DB.batch<{ current: number }>(this.assertions.map((assertion) =>
        this.env.DB.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).bind(...(assertion.bindings ?? []))));
      if (checked.length !== this.assertions.length || checked.some((result) => result.success === false || Number(result.results[0]?.current) !== 1)) unavailable("output_source_changed_during_read");
    }
    return this.assertions;
  }
}

/**
 * Bind Output decisions to the effective immutable package and current licensed
 * origins. Use EVERY returned assertion in the same transaction as the decision.
 * No grant, acceptance, provider authority or private body is written here.
 * Pure organization-owned decisions retain their existing independence from a
 * departed origin owner; only licensed members require the live origin chain.
 */
export async function captureOutputGovernanceAssertions(env: WorkerEnv, organizationId: string, blocks: readonly GovernedBlock[], options: OutputGovernanceCaptureOptions = {}): Promise<OutputSqlAssertion[]> {
  try { return await capture(env, textId(organizationId), blocks, options); }
  catch (error) { if (error instanceof OutputConflictError) throw error; return unavailable(); }
}

async function capture(env: WorkerEnv, organizationId: string, blocks: readonly GovernedBlock[], options: OutputGovernanceCaptureOptions) {
  const proof = new GovernanceProof(env, options);
  const packages = new Map<string, Snapshot>();
  const bindings = new Map<string, { row: Row; members: Row[] }>();
  const origins = new Map<string, Origin>();
  const assigned = new Map<string, Row | null>();
  const completed = new Set<string>();
  const assignmentRows = new Map<string, Row[]>(), bindingRows = new Map<string, Row[]>(), memberRows = new Map<string, Row[]>();
  const packageRows = new Map<string, Row[]>(), sourceRows = new Map<string, Row[]>();
  const authorityRows = new Map<string, Row[]>(), originRows = new Map<string, Row[]>(), tailRows = new Map<string, Row[]>();
  const capturedOwnerHeads = new Map<string, number>();

  function distribute(cache: Map<string, Row[]>, keys: readonly string[], rows: Row[], key: (row: Row) => string, maximum: number) {
    const requested = new Set(keys);
    for (const id of keys) cache.set(id, []);
    for (const row of rows) {
      const id = key(row);
      if (!requested.has(id)) unavailable();
      const group = cache.get(id)!; group.push(row);
      if (group.length > maximum) unavailable(maximum === 1 ? "output_source_governance_unavailable" : "output_source_governance_proof_too_large");
    }
  }

  const assignmentRead = (ids: readonly string[]): ProofRead => ({ select: `SELECT binding_id,organization_id,source_block_id,target_block_id,content_sha256
    FROM project_context_package_members WHERE target_block_id IN(SELECT value FROM json_each(?))
    `, orderBy: "target_block_id,binding_id,source_block_id", columns: ["binding_id", "organization_id", "source_block_id", "target_block_id", "content_sha256"],
    bindings: [JSON.stringify(ids)], maximum: 4096 });

  /** One capture batch for every independent immutable/current binding row set. */
  async function loadCandidateRows(candidates: readonly GovernedBlock[]) {
    if (candidates.length > 4096) unavailable("output_source_governance_proof_too_large");
    if (new Set(candidates.map(block => block.id)).size !== candidates.length) unavailable();
    const targets = candidates.map(block => textId(block.id)).filter(id => !assignmentRows.has(id));
    const requestedBindings = new Set<string>(), requestedPackages = new Map<string, { packageId: string; versionId: string }>();
    for (const block of candidates) if (provenanceFields.some(field => present(block.properties[field]))) {
      const packageId = textId(block.properties.organization_context_package_id), versionId = textId(block.properties.organization_context_package_version_id);
      const bindingId = textId(block.properties.organization_context_package_binding_id); textId(block.properties.organization_context_source_block_id);
      if (!bindingRows.has(bindingId)) requestedBindings.add(bindingId);
      if (!packageRows.has(packageKey(packageId, versionId))) requestedPackages.set(packageKey(packageId, versionId), { packageId, versionId });
    }
    const bindingIds = [...requestedBindings].sort(), pairs = [...requestedPackages.values()];
    const pairKeys = pairs.map(pair => packageKey(pair.packageId, pair.versionId));
    const versions = [...new Set(pairs.map(pair => pair.versionId))].filter(id => !sourceRows.has(id)).sort();
    if (bindingRows.size + bindingIds.length > MAX_BINDINGS || packageRows.size + pairKeys.length > MAX_PACKAGES) unavailable("output_source_governance_proof_too_large");
    const reads: ProofRead[] = [], consume: Array<(rows: Row[]) => void> = [];
    const add = (read: ProofRead, apply: (rows: Row[]) => void) => { reads.push(read); consume.push(apply); };
    if (targets.length) add(assignmentRead(targets), rows => distribute(assignmentRows, targets, rows, row => String(row.target_block_id), 4096));
    if (bindingIds.length) {
      add({ select: `SELECT binding.binding_id,binding.organization_id,binding.project_access_id,binding.project_id,binding.document_id,
        binding.package_id,binding.version_id,binding.update_mode,binding.status,binding.pending_version_id,project.owner_user_id,project.status AS project_status
        FROM project_context_package_bindings binding JOIN organization_projects project
          ON project.project_access_id=binding.project_access_id AND project.organization_id=binding.organization_id AND project.project_id=binding.project_id
        WHERE binding.binding_id IN(SELECT value FROM json_each(?))`, orderBy: "binding_id",
        columns: ["binding_id", "organization_id", "project_access_id", "project_id", "document_id", "package_id", "version_id", "update_mode", "status", "pending_version_id", "owner_user_id", "project_status"],
        bindings: [JSON.stringify(bindingIds)], maximum: bindingIds.length }, rows => distribute(bindingRows, bindingIds, rows, row => String(row.binding_id), 1));
      add({ select: `SELECT binding_id,organization_id,source_block_id,target_block_id,content_sha256 FROM project_context_package_members
        WHERE binding_id IN(SELECT value FROM json_each(?))`, orderBy: "binding_id,source_block_id",
        columns: ["binding_id", "organization_id", "source_block_id", "target_block_id", "content_sha256"], bindings: [JSON.stringify(bindingIds)], maximum: MAX_PACKAGE_BLOCKS * bindingIds.length },
      rows => distribute(memberRows, bindingIds, rows, row => String(row.binding_id), MAX_PACKAGE_BLOCKS));
    }
    if (pairs.length) add({ select: `SELECT package.package_id,package.organization_id,package.status AS package_status,
      version.version_id,version.version,version.content_sha256,version.source_project_access_id,version.source_document_id,
      version.status AS version_status,version.redacted_at AS version_redacted_at,version.approved_by_user_id,version.published_at,
      content.content_json,content.redacted_at AS content_redacted_at,organization.status AS organization_status
      FROM organization_context_packages package JOIN organization_context_package_versions version
        ON version.package_id=package.package_id AND version.organization_id=package.organization_id
      JOIN organization_context_package_contents content ON content.version_id=version.version_id AND content.organization_id=version.organization_id
      JOIN organizations organization ON organization.organization_id=package.organization_id
      WHERE package.organization_id=? AND EXISTS(SELECT 1 FROM json_each(?) requested
        WHERE json_extract(requested.value,'$.packageId')=package.package_id AND json_extract(requested.value,'$.versionId')=version.version_id)
      `, orderBy: "package_id,version_id",
      columns: ["package_id", "organization_id", "package_status", "version_id", "version", "content_sha256", "source_project_access_id", "source_document_id", "version_status", "version_redacted_at", "approved_by_user_id", "published_at", "content_json", "content_redacted_at", "organization_status"],
      bindings: [organizationId, JSON.stringify(pairs)], maximum: pairs.length },
    rows => distribute(packageRows, pairKeys, rows, row => packageKey(String(row.package_id), String(row.version_id)), 1));
    if (versions.length) add({ select: `SELECT version_id,organization_id,source_project_access_id,source_block_id,source_kind,content_sha256,rights_expires_at,position
      FROM organization_context_package_sources WHERE version_id IN(SELECT value FROM json_each(?))`, orderBy: "version_id,position,source_block_id",
      columns: ["version_id", "organization_id", "source_project_access_id", "source_block_id", "source_kind", "content_sha256", "rights_expires_at", "position"],
      bindings: [JSON.stringify(versions)], maximum: MAX_PACKAGE_BLOCKS * versions.length }, rows => distribute(sourceRows, versions, rows, row => String(row.version_id), MAX_PACKAGE_BLOCKS));
    const captured = await proof.batch(reads); captured.forEach((rows, index) => consume[index]!(rows));
  }

  const actualOwnerHead = `(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id='creative:'||project.owner_user_id)`;
  const fixedHead = `CASE WHEN captured.heads IS NULL THEN ${actualOwnerHead} ELSE json_extract(pinned.value,'$.head') END`;
  const fixedCursor = `CASE WHEN captured.heads IS NULL THEN migration.last_owner_sequence ELSE json_extract(pinned.value,'$.cursor') END`;
  const prefix = (event: string) => `(${event}.stream_id<>'creative:'||project.owner_user_id OR ${event}.sequence<=(${fixedHead}))`;
  const capturedJoin = `CROSS JOIN captured LEFT JOIN json_each(captured.heads) pinned ON json_extract(pinned.value,'$.projectAccessId')=project.project_access_id`;
  const nativeActors: Record<string, string> = {
    DocumentRenderRequested: "user", GenerationRequested: "user", ContextCompiled: "worker:compiler",
    DocumentRenderCompleted: "worker:renderer", DocumentRenderFailed: "worker:renderer", GenerationCompleted: "worker:generator", GenerationFailed: "worker:generator",
    GenerationUsageRecorded: "worker:policy", BudgetReserved: "worker:policy", BudgetReleased: "worker:policy", BudgetExceeded: "worker:policy",
    ModelRegistered: "worker:registry", AdapterVersioned: "worker:registry", CapabilityDeclared: "worker:registry",
    ProjectDocumentJobQueued: "user",
  };
  const packageAuditKinds: Record<string, string> = {
    OrganizationContextPackageCreated: "context-package", OrganizationContextPackageVersionDrafted: "context-package-version",
    OrganizationContextPackageVersionPublished: "context-package-version", OrganizationContextPackageAdopted: "context-package-binding",
  };
  const ordinaryTailTypes = new Set([
    "ProjectCreated", "ProjectRenamed", "ProjectStateChanged", "DocumentCreated", "DocumentForked", "DocumentRenamed", "DocumentProductionWorkflowConfigured",
    "BlockCreated", "BlockRenamed", "BlockPropertyEdited", "BlockWeightSet", "BlockLocked", "BlockUnlocked", "BlockRemoved", "BlockRestored",
    "BlockRelationAdded", "ReferenceIngested", "RightsAsserted", ...OUTPUT_REQUIREMENT_EVENT_TYPES,
  ]);
  const targetFields: Record<string, string> = { document_id: "document", block_id: "block", target_block_id: "block", subject_block_id: "block", from_block_id: "block", to_block_id: "block", reference_id: "reference", relation_id: "relation", artifact_id: "artifact", object_id: "output" };
  const nativeTypesSql = Object.keys(nativeActors).filter(type => type !== "ProjectDocumentJobQueued").map(type => `'${type}'`).join(",");
  const privatePayload = `CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END`;
  const queuePayload = `CASE WHEN json_valid(queue_body.private_json) THEN queue_body.private_json ELSE '{}' END`;
  // This is the native admission writer's complete queue grammar. Slot/grant
  // authority stays in the private body; the other eight fields are public IDs.
  const queuePublicFields = ["job_id", "document_id", "kind", "organization_id", "project_access_id", "project_id", "history_owner_user_id", "actor_user_id"];
  const queuePrivateFields = [...queuePublicFields, "output_slot_id", "output_grant_id"];
  const queueIdentity = queuePublicFields.map(field => `json_extract(${queuePayload},'$.${field}') IS json_extract(queue_event.payload,'$.${field}')`).join(" AND ");
  const identityFields = [...Object.keys(targetFields), "project_id", "type", "kind", "property_path", "actor_user_id", "object_ids", "job_id", "organization_id", "resource_kind", "resource_id"];
  const matchingPrivateIdentity = identityFields.map(field => `json_extract(${privatePayload},'$.${field}') IS json_extract(event.payload,'$.${field}')`).join(" AND ");
  const affectedIds = `SELECT value FROM json_each(json_array(COALESCE(json_extract(event.payload,'$.document_id'),plan.document_id),${Object.keys(targetFields).filter(field => field !== "document_id").map(field => `json_extract(event.payload,'$.${field}')`).join(",")}))
    UNION ALL SELECT value FROM json_each(COALESCE(json_extract(event.payload,'$.object_ids'),'[]'))`;

  // SQLite reads the first duplicate key; JSON.parse/foldEvents reads the last.
  // Reject ambiguity at every object whose identity is interpreted here, without
  // recursively scanning unrelated editorial content or normalizing its meaning.
  const unambiguousObject = (value: string, path = "$") => `(json_type(${value},'${path}')='object'
    AND NOT EXISTS(SELECT 1 FROM json_each(${value},'${path}') identity GROUP BY identity.key HAVING COUNT(*)>1))`;
  const retainedOtherIdentity = (body: string, event: string, fields: readonly string[]) => `${event}.schema_version=1 AND ${event}.compensates_event_id IS NULL
    AND ${body}.owner_id=project.owner_user_id AND ${body}.redacted_at IS NULL AND json_valid(${body}.private_json)
    AND ${unambiguousObject(`CASE WHEN json_valid(${body}.private_json) THEN ${body}.private_json ELSE '{}' END`)}
    AND ${unambiguousObject(`${event}.payload`)}
    AND json_extract(${event}.payload,'$._private_ref')=${event}.event_id
    AND ${body}.project_id=other.project_id AND ${body}.document_id=json_extract(${event}.payload,'$.document_id')
    AND ${fields.map(field => `json_extract(CASE WHEN json_valid(${body}.private_json) THEN ${body}.private_json ELSE '{}' END,'$.${field}') IS json_extract(${event}.payload,'$.${field}')`).join(" AND ")}`;
  const historicalBlockCustody = (blockId: string) => `EXISTS(SELECT 1 FROM events created
    JOIN project_event_scopes created_scope ON created_scope.event_id=created.event_id
    JOIN event_private_payloads created_body ON created_body.private_event_id=created.event_id
    JOIN events removed ON removed.event_id=(SELECT lifecycle.event_id FROM events lifecycle WHERE lifecycle.stream_id=event.stream_id
      AND lifecycle.type IN('BlockRemoved','BlockRestored') AND json_extract(lifecycle.payload,'$.block_id')=${blockId}
      AND lifecycle.sequence<=(${fixedHead}) ORDER BY lifecycle.sequence DESC LIMIT 1)
    JOIN project_event_scopes removed_scope ON removed_scope.event_id=removed.event_id
    JOIN event_private_payloads removed_body ON removed_body.private_event_id=removed.event_id
    WHERE created.stream_id=event.stream_id AND created.type='BlockCreated' AND created.sequence<=(${fixedHead})
      AND json_extract(created.payload,'$.block_id')=${blockId} AND json_extract(created.payload,'$.project_id')=other.project_id
      AND json_extract(created.payload,'$.document_id')=json_extract(event.payload,'$.document_id')
      AND (SELECT COUNT(*) FROM events identity_event WHERE identity_event.stream_id=event.stream_id AND identity_event.type='BlockCreated'
        AND json_extract(identity_event.payload,'$.block_id')=${blockId} AND identity_event.sequence<=(${fixedHead}))=1
      AND removed.type='BlockRemoved' AND removed.sequence>created.sequence AND removed.stream_id=event.stream_id
      AND json_extract(removed.payload,'$.project_id')=other.project_id AND json_extract(removed.payload,'$.document_id')=json_extract(created.payload,'$.document_id')
      AND created.actor='user:'||created_scope.actor_user_id AND removed.actor='user:'||removed_scope.actor_user_id
      AND created_scope.project_access_id=other.project_access_id AND created_scope.organization_id=other.organization_id
      AND created_scope.project_id=other.project_id AND created_scope.owner_user_id=other.owner_user_id
      AND created_scope.source_stream_id=created.stream_id AND created_scope.source_sequence=created.sequence
      AND removed_scope.project_access_id=other.project_access_id AND removed_scope.organization_id=other.organization_id
      AND removed_scope.project_id=other.project_id AND removed_scope.owner_user_id=other.owner_user_id
      AND removed_scope.source_stream_id=removed.stream_id AND removed_scope.source_sequence=removed.sequence
      AND ${retainedOtherIdentity("created_body", "created", ["project_id", "document_id", "block_id", "type"])}
      AND ${retainedOtherIdentity("removed_body", "removed", ["project_id", "document_id", "block_id"])})`;
  const historicalReferenceCustody = (referenceId: string) => `EXISTS(SELECT 1 FROM events ingested
    JOIN project_event_scopes ingested_scope ON ingested_scope.event_id=ingested.event_id
    JOIN event_private_payloads ingested_body ON ingested_body.private_event_id=ingested.event_id
    WHERE ingested.stream_id=event.stream_id AND ingested.type='ReferenceIngested' AND ingested.sequence<=(${fixedHead})
      AND json_extract(ingested.payload,'$.reference_id')=${referenceId} AND json_extract(ingested.payload,'$.project_id')=other.project_id
      AND json_extract(ingested.payload,'$.document_id')=json_extract(event.payload,'$.document_id')
      AND (SELECT COUNT(*) FROM events identity_event WHERE identity_event.stream_id=event.stream_id AND identity_event.type='ReferenceIngested'
        AND json_extract(identity_event.payload,'$.reference_id')=${referenceId} AND identity_event.sequence<=(${fixedHead}))=1
      AND ingested.actor='user:'||ingested_scope.actor_user_id AND ingested_scope.project_access_id=other.project_access_id
      AND ingested_scope.organization_id=other.organization_id AND ingested_scope.project_id=other.project_id AND ingested_scope.owner_user_id=other.owner_user_id
      AND ingested_scope.source_stream_id=ingested.stream_id AND ingested_scope.source_sequence=ingested.sequence
      AND ${retainedOtherIdentity("ingested_body", "ingested", ["project_id", "document_id", "reference_id"])}
      AND EXISTS(SELECT 1 FROM events reference_block JOIN event_private_payloads reference_body ON reference_body.private_event_id=reference_block.event_id
        WHERE reference_block.stream_id=event.stream_id AND reference_block.type='BlockCreated' AND reference_block.sequence<=(${fixedHead})
          AND ${unambiguousObject("CASE WHEN json_valid(reference_body.private_json) THEN reference_body.private_json ELSE '{}' END")}
          AND ${unambiguousObject("CASE WHEN json_valid(reference_body.private_json) THEN reference_body.private_json ELSE '{}' END", "$.properties")}
          AND json_extract(CASE WHEN json_valid(reference_body.private_json) THEN reference_body.private_json ELSE '{}' END,'$.properties.reference_id')=${referenceId}
          AND ${historicalBlockCustody("json_extract(reference_block.payload,'$.block_id')")}))`;
  const plannedNativeArtifactCustody = `job.kind='render_document'
    AND event.type IN('DocumentRenderRequested','DocumentRenderFailed','GenerationUsageRecorded','BudgetReserved','BudgetReleased','BudgetExceeded')
    AND EXISTS(SELECT 1 FROM events requested JOIN event_private_payloads requested_body ON requested_body.private_event_id=requested.event_id
      WHERE requested.stream_id=job.stream_id AND requested.type='DocumentRenderRequested'
        AND requested.sequence<=event.sequence AND requested.sequence<=(${fixedHead})
        AND requested.correlation_id=job.correlation_id AND requested.client_id='server:document-job:render_document'
        AND requested.actor='user:'||job.owner_id AND json_extract(requested.payload,'$.artifact_id')=target.id
        AND json_extract(requested.payload,'$.artifact_kind')='slides'
        AND json_extract(requested.payload,'$.project_id')=plan.project_id AND json_extract(requested.payload,'$.document_id')=plan.document_id
        AND ${retainedOtherIdentity("requested_body", "requested", ["project_id", "document_id", "artifact_id", "artifact_kind"])})`;

  /** Only licensed members cause live origin reads; institutional snapshots do not. */
  async function loadOriginRows(snapshots: readonly Snapshot[]) {
    const projects = [...new Set(snapshots.map(snapshot => textId(snapshot.sourceProjectAccessId)))].filter(id => !authorityRows.has(id)).sort();
    const targets = [...new Set(snapshots.flatMap(snapshot => licensedPackageSourceBlocks(snapshot.blocks).map(member => textId(member.sourceBlockId))))].filter(id => !assignmentRows.has(id)).sort();
    if (authorityRows.size + projects.length > MAX_PACKAGES || targets.length > 4096) unavailable("output_source_governance_proof_too_large");
    const reads: ProofRead[] = [], consume: Array<(rows: Row[]) => void> = [], pinReads: number[] = [];
    const add = (read: ProofRead, apply: (rows: Row[]) => void, pin = false) => { if (pin) pinReads.push(reads.length); reads.push(read); consume.push(apply); };
    if (projects.length) {
      add({ select: `WITH captured AS(SELECT ? AS heads) SELECT project.project_access_id,project.organization_id,project.project_id,project.owner_user_id,project.status,
        organization.status AS organization_status,migration.status AS migration_status,migration.owner_user_id AS migration_owner,
        CASE WHEN captured.heads IS NULL THEN migration.last_owner_sequence
          WHEN migration.last_owner_sequence>=json_extract(pinned.value,'$.cursor') AND migration.last_owner_sequence<=${actualOwnerHead}
          THEN json_extract(pinned.value,'$.cursor') ELSE -1 END AS last_owner_sequence,
        owner.membership_id,owner.status AS membership_status,owner.accepted_at,owner.revoked_at,(${fixedHead}) AS owner_head,
        (SELECT COALESCE(MAX(project_scope.project_sequence),0) FROM project_event_scopes project_scope JOIN events scoped_event ON scoped_event.event_id=project_scope.event_id
          WHERE project_scope.project_access_id=project.project_access_id AND ${prefix("scoped_event")}) AS project_head,
        (SELECT COUNT(*) FROM project_event_scopes project_scope JOIN events scoped_event ON scoped_event.event_id=project_scope.event_id
          WHERE project_scope.project_access_id=project.project_access_id AND ${prefix("scoped_event")}) AS event_count
        FROM organization_projects project JOIN organizations organization ON organization.organization_id=project.organization_id
        JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id
        JOIN organization_memberships owner ON owner.organization_id=project.organization_id AND owner.user_id=project.owner_user_id
        ${capturedJoin}
        WHERE project.project_access_id IN(SELECT value FROM json_each(?)) AND project.organization_id=?`, orderBy: "project_access_id,membership_id",
        columns: ["project_access_id", "organization_id", "project_id", "owner_user_id", "status", "organization_status", "migration_status", "migration_owner", "last_owner_sequence", "membership_id", "membership_status", "accepted_at", "revoked_at", "owner_head", "project_head", "event_count"],
        bindings: [null, JSON.stringify(projects), organizationId], maximum: projects.length }, rows => distribute(authorityRows, projects, rows, row => String(row.project_access_id), 1), true);
      add({ select: `WITH captured AS(SELECT ? AS heads) SELECT event.*,scope.project_access_id,scope.organization_id,scope.project_id,scope.owner_user_id,
        scope.source_stream_id,scope.source_sequence,scope.project_sequence,scope.actor_user_id,
        body.owner_id AS private_owner_id,body.private_json,body.redacted_at AS private_redacted_at,
        body.project_id AS private_project_id,body.document_id AS private_document_id
        FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
        JOIN organization_projects project ON project.project_access_id=scope.project_access_id
        LEFT JOIN event_private_payloads body ON body.private_event_id=event.event_id
        ${capturedJoin}
        WHERE scope.project_access_id IN(SELECT value FROM json_each(?)) AND ${prefix("event")}
        `, orderBy: "project_access_id,project_sequence,event_id",
        columns: ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload", "project_access_id", "organization_id", "project_id", "owner_user_id", "source_stream_id", "source_sequence", "project_sequence", "actor_user_id", "private_owner_id", "private_json", "private_redacted_at", "private_project_id", "private_document_id"],
        bindings: [null, JSON.stringify(projects)], maximum: MAX_SOURCE_EVENTS }, rows => distribute(originRows, projects, rows, row => String(row.project_access_id), MAX_SOURCE_EVENTS), true);
      // Read only metadata from other projects. Retained private bodies are
      // checked inside SQL; their text never enters this row set or its binding.
      add({ select: `WITH captured AS(SELECT ? AS heads) SELECT project.project_access_id AS origin_project_access_id,
        event.event_id,event.stream_id,event.sequence,event.actor,event.client_id,event.correlation_id,event.type,event.payload,event.schema_version,event.compensates_event_id,
        (SELECT COUNT(*) FROM organization_audit_events audit WHERE audit.organization_id=project.organization_id
          AND audit.actor_user_id=project.owner_user_id AND event.actor='user:'||audit.actor_user_id AND audit.action=event.type
          AND audit.resource_kind=json_extract(event.payload,'$.resource_kind') AND audit.resource_id=json_extract(event.payload,'$.resource_id')) AS audit_count,
        (SELECT audit.audit_id FROM organization_audit_events audit WHERE audit.organization_id=project.organization_id
          AND audit.actor_user_id=project.owner_user_id AND event.actor='user:'||audit.actor_user_id AND audit.action=event.type
          AND audit.resource_kind=json_extract(event.payload,'$.resource_kind') AND audit.resource_id=json_extract(event.payload,'$.resource_id') ORDER BY audit.audit_id LIMIT 1) AS audit_id,
        CASE event.type
          WHEN 'OrganizationContextPackageCreated' THEN EXISTS(SELECT 1 FROM organization_context_packages package WHERE package.package_id=json_extract(event.payload,'$.resource_id') AND package.organization_id=project.organization_id AND package.created_by_user_id=project.owner_user_id)
          WHEN 'OrganizationContextPackageVersionDrafted' THEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=json_extract(event.payload,'$.resource_id') AND version.organization_id=project.organization_id AND version.created_by_user_id=project.owner_user_id)
          WHEN 'OrganizationContextPackageVersionPublished' THEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=json_extract(event.payload,'$.resource_id') AND version.organization_id=project.organization_id AND version.approved_by_user_id=project.owner_user_id AND version.status='published')
          WHEN 'OrganizationContextPackageAdopted' THEN EXISTS(SELECT 1 FROM project_context_package_bindings binding WHERE binding.binding_id=json_extract(event.payload,'$.resource_id') AND binding.organization_id=project.organization_id AND binding.created_by_user_id=project.owner_user_id)
          ELSE 0 END AS audit_resource_current,
        scope.project_access_id AS scoped_project_access_id,scope.organization_id AS scoped_organization_id,scope.project_id AS scoped_project_id,
        scope.owner_user_id AS scoped_owner_user_id,scope.source_stream_id,scope.source_sequence,scope.actor_user_id,
        other.project_access_id,other.project_id,other.organization_id,other.owner_user_id,other.status AS project_status,
        other_migration.status AS migration_status,other_migration.owner_user_id AS migration_owner,
        body.owner_id AS private_owner_id,body.project_id AS private_project_id,body.document_id AS private_document_id,body.redacted_at AS private_redacted_at,
        CASE WHEN body.private_event_id=event.event_id AND body.owner_id=project.owner_user_id AND body.redacted_at IS NULL
          AND json_valid(body.private_json) AND json_extract(event.payload,'$._private_ref')=event.event_id
          AND ${unambiguousObject(privatePayload)} AND ${unambiguousObject("event.payload")}
          AND body.project_id IS json_extract(event.payload,'$.project_id') AND body.document_id IS json_extract(event.payload,'$.document_id')
          AND ${matchingPrivateIdentity}
          AND(event.type NOT IN('OrganizationContextPackageCreated','OrganizationContextPackageVersionDrafted','OrganizationContextPackageVersionPublished','OrganizationContextPackageAdopted')
            OR NOT EXISTS(SELECT 1 FROM json_each(${privatePayload}) property WHERE property.key NOT IN('organization_id','resource_kind','resource_id')))
          THEN 1 ELSE 0 END AS private_current,
        job.job_id,job.owner_id AS job_owner_id,job.kind AS job_kind,plan.document_id AS job_document_id,slot.slot_id,plan.scope_key,
        plan.plan_revision_id,slot.grant_id,queue_event.event_id AS queue_event_id,
        CASE WHEN job.job_id IS NOT NULL AND slot.slot_id IS NOT NULL AND plan.scope_kind='project'
          AND plan.owner_user_id=project.owner_user_id AND plan.organization_id=project.organization_id
          AND grant_row.actor_user_id=job.owner_id AND grant_row.plan_revision_id=slot.plan_revision_id
          AND job.stream_id=event.stream_id AND job.document_id=plan.document_id AND job.source_surface='outputs'
          AND custody.visibility='actor_private' AND custody.actor_user_id=job.owner_id
          AND custody.organization_id=plan.organization_id AND custody.project_access_id=plan.project_access_id
          AND custody.project_id=plan.project_id AND custody.owner_user_id=plan.owner_user_id
          AND queue_event.stream_id=event.stream_id AND queue_event.type='ProjectDocumentJobQueued' AND queue_event.actor='user:'||job.owner_id
          AND queue_event.sequence=job.requested_sequence AND queue_event.sequence<=event.sequence AND queue_event.sequence<=(${fixedHead})
          AND queue_event.schema_version=1 AND queue_event.compensates_event_id IS NULL AND queue_event.client_id='server:output-requirements'
          AND json_extract(queue_event.payload,'$._private_ref')=queue_event.event_id
          AND queue_body.owner_id=project.owner_user_id AND queue_body.redacted_at IS NULL AND json_valid(queue_body.private_json)
          AND queue_body.project_id=plan.project_id AND queue_body.document_id=plan.document_id
          AND ${queueIdentity}
          AND (SELECT COUNT(*) FROM json_each(${queuePayload}))=${queuePrivateFields.length}
          AND NOT EXISTS(SELECT 1 FROM json_each(${queuePayload}) property WHERE property.key NOT IN(${queuePrivateFields.map(field => `'${field}'`).join(",")}))
          AND (SELECT COUNT(*) FROM json_each(queue_event.payload))=${queuePublicFields.length + 1}
          AND NOT EXISTS(SELECT 1 FROM json_each(queue_event.payload) property WHERE property.key NOT IN(${[...queuePublicFields, "_private_ref"].map(field => `'${field}'`).join(",")}))
          AND json_extract(${queuePayload},'$.history_owner_user_id')=project.owner_user_id
          AND json_extract(${queuePayload},'$.job_id')=job.job_id AND json_extract(${queuePayload},'$.kind')=job.kind AND json_extract(${queuePayload},'$.document_id')=plan.document_id
          AND json_extract(${queuePayload},'$.project_id')=plan.project_id AND json_extract(${queuePayload},'$.project_access_id')=plan.project_access_id
          AND json_extract(${queuePayload},'$.organization_id')=plan.organization_id AND json_extract(${queuePayload},'$.actor_user_id')=job.owner_id
          AND json_extract(${queuePayload},'$.output_slot_id')=slot.slot_id AND json_extract(${queuePayload},'$.output_grant_id')=slot.grant_id
          AND(other.project_access_id=plan.project_access_id AND other.project_id=plan.project_id AND other.owner_user_id=plan.owner_user_id)
          THEN 1 ELSE 0 END AS native_custody,
        NOT EXISTS(SELECT 1 FROM(
          SELECT 'document' AS kind,COALESCE(json_extract(event.payload,'$.document_id'),plan.document_id) AS id
          ${Object.entries(targetFields).filter(([field])=>field!=='document_id').map(([field,kind])=>`UNION ALL SELECT '${kind}',json_extract(event.payload,'$.${field}')`).join(" ")}
          UNION ALL SELECT 'output',value FROM json_each(COALESCE(json_extract(event.payload,'$.object_ids'),'[]'))
        ) target WHERE target.id IS NOT NULL AND target.id<>'' AND NOT(
          EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.project_access_id=other.project_access_id AND resource.organization_id=other.organization_id
            AND resource.project_id=other.project_id AND resource.owner_user_id=other.owner_user_id
            AND resource.resource_kind=target.kind AND resource.resource_id=target.id AND resource.visibility='collaborative_output')
          OR(target.kind='artifact' AND ${plannedNativeArtifactCustody})
          OR(target.kind='block' AND ${historicalBlockCustody("target.id")})
          OR(target.kind='reference' AND ${historicalReferenceCustody("target.id")})
          OR(target.kind='relation' AND event.type='BlockRelationAdded' AND target.id=json_extract(event.payload,'$.relation_id')
            AND(SELECT COUNT(*) FROM events relation_identity WHERE relation_identity.stream_id=event.stream_id AND relation_identity.type='BlockRelationAdded'
              AND json_extract(relation_identity.payload,'$.relation_id')=target.id AND relation_identity.sequence<=(${fixedHead}))=1)
        )) AS resources_current,
        EXISTS(SELECT 1 FROM project_resource_scopes protected WHERE protected.project_access_id=project.project_access_id
          AND protected.organization_id=project.organization_id AND protected.project_id=project.project_id AND protected.owner_user_id=project.owner_user_id
          AND protected.resource_id IN(${affectedIds})) AS origin_resource_conflict
        FROM organization_projects project JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id
        ${capturedJoin}
        JOIN events event ON event.stream_id='creative:'||project.owner_user_id AND event.sequence>(${fixedCursor}) AND event.sequence<=(${fixedHead})
        LEFT JOIN event_private_payloads body ON body.private_event_id=event.event_id
        LEFT JOIN project_event_scopes scope ON scope.event_id=event.event_id
        LEFT JOIN document_jobs job ON job.stream_id=event.stream_id AND((event.type IN(${nativeTypesSql}) AND job.correlation_id=event.correlation_id)
          OR(event.type='ProjectDocumentJobQueued' AND job.job_id=json_extract(event.payload,'$.job_id')))
        LEFT JOIN output_operation_slots slot ON slot.job_id=job.job_id
        LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
        LEFT JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
        LEFT JOIN project_resource_scopes custody ON custody.resource_kind='job' AND custody.resource_id=job.job_id AND custody.project_access_id=plan.project_access_id
        LEFT JOIN events queue_event ON queue_event.event_id=custody.source_event_id
        LEFT JOIN event_private_payloads queue_body ON queue_body.private_event_id=queue_event.event_id
        LEFT JOIN organization_projects other ON other.project_access_id=COALESCE(scope.project_access_id,plan.project_access_id)
        LEFT JOIN project_migration_states other_migration ON other_migration.project_access_id=other.project_access_id AND other_migration.organization_id=other.organization_id
        WHERE project.project_access_id IN(SELECT value FROM json_each(?)) AND project.organization_id=?
        `, orderBy: "origin_project_access_id,sequence,scoped_project_access_id,job_id,slot_id",
        columns: ["origin_project_access_id", "event_id", "stream_id", "sequence", "actor", "client_id", "correlation_id", "type", "payload", "schema_version", "compensates_event_id", "audit_count", "audit_id", "audit_resource_current", "scoped_project_access_id", "scoped_organization_id", "scoped_project_id", "scoped_owner_user_id", "source_stream_id", "source_sequence", "actor_user_id", "project_access_id", "project_id", "organization_id", "owner_user_id", "project_status", "migration_status", "migration_owner", "private_owner_id", "private_project_id", "private_document_id", "private_redacted_at", "private_current", "job_id", "job_owner_id", "job_kind", "job_document_id", "slot_id", "scope_key", "plan_revision_id", "grant_id", "queue_event_id", "native_custody", "resources_current", "origin_resource_conflict"],
        bindings: [null, JSON.stringify(projects), organizationId], maximum: MAX_SOURCE_EVENTS }, rows => distribute(tailRows, projects, rows, row => String(row.origin_project_access_id), MAX_SOURCE_EVENTS), true);
    }
    if (targets.length) add(assignmentRead(targets), rows => distribute(assignmentRows, targets, rows, row => String(row.target_block_id), 4096));
    const firstAssertion = proof.assertions.length;
    const captured = await proof.batch(reads); captured.forEach((rows, index) => consume[index]!(rows));
    if (projects.length) {
      const pins = projects.map(projectAccessId => {
        const rows = authorityRows.get(projectAccessId) ?? unavailable();
        if (rows.length !== 1) unavailable("context_source_rights_expired");
        const row = rows[0]!, head = Number(row.owner_head), cursor = Number(row.last_owner_sequence), owner = textId(row.owner_user_id);
        if (!Number.isSafeInteger(head) || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > head) unavailable("output_source_projection_stale");
        const previous = capturedOwnerHeads.get(owner);
        if (previous !== undefined && previous !== head) unavailable("output_source_changed_during_read");
        if (previous === undefined) {
          capturedOwnerHeads.set(owner, head);
          // Native execution may replace ONLY its own matching owner/head guard
          // with its existing exact job/source epoch. External owners stay exact.
          proof.assertions.push({ sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${owner}`, head] });
        }
        return { projectAccessId, head, cursor };
      });
      const pinned = JSON.stringify(pins);
      for (const offset of pinReads) {
        const assertion = proof.assertions[firstAssertion + offset]!;
        if (assertion.bindings?.[0] !== null) unavailable();
        // Both bounds are fixed. Advancing a migration cannot hide an old tail
        // row, an erasure or a new scope association inside the captured prefix.
        assertion.bindings[0] = pinned;
      }
    }
  }

  function verifyUnrelatedTail(row: Row, events: readonly CreativeEvent[]) {
    const tail = tailRows.get(String(row.project_access_id)) ?? unavailable();
    const cursor = Number(row.last_owner_sequence), head = Number(row.owner_head);
    if (tail.some(event => Number(event.sequence) > head)) unavailable("output_source_changed_during_read");
    if (tail.length !== head - cursor) unavailable("output_source_projection_stale");
    const protectedIds = new Set<string>();
    for (const event of events) {
      for (const field of Object.keys(targetFields)) if (present(event.payload[field])) protectedIds.add(String(event.payload[field]));
      if (Array.isArray(event.payload.object_ids)) event.payload.object_ids.forEach(value => protectedIds.add(String(value)));
    }
    for (const [index, event] of tail.entries()) {
      if (event.sequence !== cursor + index + 1 || event.stream_id !== `creative:${row.owner_user_id}` || event.origin_project_access_id !== row.project_access_id
        || event.private_current !== 1 || event.schema_version !== 1 || event.compensates_event_id !== null) unavailable("output_source_projection_stale");
      const payload: Record<string, unknown> = JSON.parse(String(event.payload));
      const auditKind = packageAuditKinds[String(event.type)];
      if (auditKind) {
        if (event.actor !== `user:${row.owner_user_id}` || event.client_id !== "server:workspace" || event.scoped_project_access_id !== null
          || Object.keys(payload).some(key => !["organization_id", "resource_kind", "resource_id", "_private_ref"].includes(key))
          || payload.organization_id !== organizationId || payload.resource_kind !== auditKind || !present(payload.resource_id)
          || present(payload.project_id) || present(payload.document_id) || Object.keys(targetFields).some(field => present(payload[field]))
          || event.audit_count !== 1 || !present(event.audit_id) || event.audit_resource_current !== 1) unavailable("output_source_projection_stale");
        // These four exact audit actions do not mutate creative source state.
        // The actual writer has no event-id foreign key, so pin its complete
        // immutable actor/action/resource tuple, never invent a timestamp join.
        continue;
      }
      if (event.project_id === row.project_id || event.organization_id !== organizationId || event.owner_user_id !== row.owner_user_id
        || event.project_status !== "active" || event.migration_status !== "active" || event.migration_owner !== row.owner_user_id
        || event.origin_resource_conflict !== 0) unavailable("output_source_projection_stale");
      const nativeActor = nativeActors[String(event.type)];
      const native = Boolean(nativeActor);
      const scoped = event.scoped_project_access_id !== null;
      if (scoped && (event.scoped_project_access_id !== event.project_access_id || event.scoped_organization_id !== organizationId
        || event.scoped_project_id !== event.project_id || event.scoped_owner_user_id !== row.owner_user_id
        || event.source_stream_id !== event.stream_id || event.source_sequence !== event.sequence)) unavailable("output_source_projection_stale");
      if (native) {
        if (event.native_custody !== 1 || !["generate", "render_document"].includes(String(event.job_kind))
          || event.actor !== (nativeActor === "user" ? `user:${event.job_owner_id}` : nativeActor)
          || event.client_id !== (event.type === "ProjectDocumentJobQueued" ? "server:output-requirements" : `server:document-job:${event.job_kind}`)
          || event.type === "ProjectDocumentJobQueued" && !scoped) unavailable("output_source_projection_stale");
      } else if (!ordinaryTailTypes.has(String(event.type)) || !scoped || event.actor !== `user:${event.actor_user_id}`
        || OUTPUT_REQUIREMENT_EVENT_TYPES.includes(event.type as typeof OUTPUT_REQUIREMENT_EVENT_TYPES[number]) && event.client_id !== "server:output-requirements") unavailable("output_source_projection_stale");
      const documentId = native ? event.job_document_id : payload.document_id;
      if (present(payload.project_id) && payload.project_id !== event.project_id || present(payload.document_id) && payload.document_id !== documentId
        || !native && payload.project_id !== event.project_id) unavailable("output_source_projection_stale");
      const needs = Object.entries(targetFields).flatMap(([field, kind]) => present(payload[field]) ? [{ kind, id: textId(payload[field]) }] : []);
      if (present(documentId)) needs.push({ kind: "document", id: textId(documentId) });
      else if (!String(event.type).startsWith("Project")) unavailable("output_source_projection_stale");
      if (Array.isArray(payload.object_ids)) needs.push(...payload.object_ids.map(id => ({ kind: "output", id: textId(id) })));
      if (event.resources_current !== 1 || needs.some(target => protectedIds.has(target.id))) unavailable("output_source_projection_stale");
      if (["BlockCreated", "BlockRenamed", "BlockPropertyEdited", "BlockWeightSet", "BlockLocked", "BlockUnlocked", "BlockRemoved", "BlockRestored"].includes(String(event.type)) && !present(payload.block_id)
        || ["ReferenceIngested", "RightsAsserted"].includes(String(event.type)) && !present(payload.reference_id)
        || event.type === "BlockRelationAdded" && (!present(payload.relation_id) || !present(payload.from_block_id) || !present(payload.to_block_id))) unavailable("output_source_projection_stale");
    }
  }

  async function assignments(candidates: readonly GovernedBlock[]) {
    await loadCandidateRows(candidates);
    const fresh = candidates.filter((block) => !assigned.has(block.id));
    if (!fresh.length) return;
    if (fresh.length > 4096) unavailable("output_source_governance_proof_too_large");
    if (new Set(fresh.map((block) => block.id)).size !== fresh.length) unavailable();
    for (const block of fresh) {
      const matches = assignmentRows.get(block.id) ?? unavailable();
      const governed = provenanceFields.some((field) => present(block.properties[field]));
      if (!governed && matches.length || governed && matches.length !== 1) unavailable();
      if (governed) {
        for (const field of provenanceFields) textId(block.properties[field]);
        if (matches[0].organization_id !== organizationId || matches[0].binding_id !== block.properties.organization_context_package_binding_id
          || matches[0].source_block_id !== block.properties.organization_context_source_block_id) unavailable();
      }
      assigned.set(block.id, matches[0] ?? null);
    }
  }

  async function packageSnapshot(packageId: string, versionId: string): Promise<Snapshot> {
    const key = packageKey(packageId, versionId);
    const existing = packages.get(key); if (existing) return existing;
    if (packages.size >= MAX_PACKAGES) unavailable("output_source_governance_proof_too_large");
    const rows = packageRows.get(key) ?? unavailable();
    const row = rows[0];
    if (rows.length !== 1 || row.package_status !== "active" || row.organization_status !== "active" || row.version_status !== "published"
      || row.version_redacted_at !== null || row.content_redacted_at !== null || typeof row.content_json !== "string"
      || await digest(row.content_json) !== row.content_sha256) unavailable();
    const parsed: unknown = JSON.parse(row.content_json);
    if (!object(parsed) || parsed.schema !== 1 || parsed.organizationId !== organizationId
      || parsed.sourceProjectAccessId !== row.source_project_access_id || parsed.sourceDocumentId !== row.source_document_id
      || !Array.isArray(parsed.blocks)) unavailable();
    if (parsed.blocks.length > MAX_PACKAGE_BLOCKS) unavailable("output_source_governance_proof_too_large");
    const snapshot = parsed as Snapshot;
    const ids = new Set<string>();
    for (const member of snapshot.blocks) {
      if (!object(member) || !object(member.properties) || typeof member.type !== "string" || typeof member.contentSha256 !== "string"
        || !/^[a-f0-9]{64}$/u.test(member.contentSha256)) unavailable();
      const id = textId(member.sourceBlockId); if (ids.has(id)) unavailable(); ids.add(id);
      proof.expires(member.rightsExpiresAt); proof.rights(member.properties);
    }
    const sources = sourceRows.get(versionId) ?? unavailable();
    if (sources.length !== snapshot.blocks.length) unavailable();
    for (const [position, member] of snapshot.blocks.entries()) {
      const source = sources[position];
      if (source.organization_id !== organizationId || source.source_project_access_id !== snapshot.sourceProjectAccessId
        || source.source_block_id !== member.sourceBlockId || source.source_kind !== member.type || source.content_sha256 !== member.contentSha256
        || source.rights_expires_at !== (member.rightsExpiresAt ?? null) || source.position !== position) unavailable();
      proof.expires(source.rights_expires_at);
    }
    packages.set(key, snapshot); return snapshot;
  }

  async function binding(bindingId: string) {
    const existing = bindings.get(bindingId); if (existing) return existing;
    if (bindings.size >= MAX_BINDINGS) unavailable("output_source_governance_proof_too_large");
    const rows = bindingRows.get(bindingId) ?? unavailable();
    if (rows.length !== 1 || rows[0].organization_id !== organizationId || rows[0].status !== "active" || rows[0].project_status !== "active") unavailable();
    const members = memberRows.get(bindingId) ?? unavailable();
    const result = { row: rows[0], members }; bindings.set(bindingId, result); return result;
  }

  async function origin(projectAccessId: string): Promise<Origin> {
    const existing = origins.get(projectAccessId); if (existing) return existing;
    if (origins.size >= MAX_PACKAGES) unavailable("output_source_governance_proof_too_large");
    const active = (row: Row | null) => row && row.status === "active" && row.organization_status === "active" && row.migration_status === "active"
      && row.migration_owner === row.owner_user_id && row.membership_status === "active" && row.accepted_at !== null && row.revoked_at === null;
    // This decision must not repair or reactivate a source migration. Only a
    // separate, normally authorized source refresh may synchronize its indexes.
    // In particular, a source quarantined during capture must remain quarantined.
    const authority = authorityRows.get(projectAccessId) ?? unavailable();
    const row = authority[0];
    if (authority.length !== 1 || !active(row)) unavailable("context_source_rights_expired");
    const eventRows = originRows.get(projectAccessId) ?? unavailable();
    if (eventRows.length !== row.event_count || Number(eventRows.at(-1)?.project_sequence ?? 0) !== row.project_head) unavailable();
    for (const event of eventRows) if (event.organization_id !== organizationId || event.project_id !== row.project_id || event.owner_user_id !== row.owner_user_id
      || event.stream_id !== `creative:${row.owner_user_id}` || event.source_stream_id !== event.stream_id || event.source_sequence !== event.sequence) unavailable();
    const events = eventRows.map((event) => serializeEvent({ ...event, private_json: event.private_redacted_at === null && event.private_owner_id === row.owner_user_id ? event.private_json : null })) as CreativeEvent[];
    verifyUnrelatedTail(row, events);
    const result = { row, rows: eventRows, events }; origins.set(projectAccessId, result); return result;
  }

  async function visit(candidates: readonly GovernedBlock[], path: ReadonlySet<string>) {
    if (path.size > MAX_DEPTH) unavailable("output_source_governance_cycle");
    await assignments(candidates);
    const pending: Array<{ bindingId: string; key: string; snapshot: Snapshot; licensed: SnapshotBlock[] }> = [];
    for (const block of candidates) {
      const membership = assigned.get(block.id); if (!membership) continue;
      const packageId = textId(block.properties.organization_context_package_id), versionId = textId(block.properties.organization_context_package_version_id);
      const bindingId = textId(block.properties.organization_context_package_binding_id), sourceBlockId = textId(block.properties.organization_context_source_block_id);
      const effective = await binding(bindingId), row = effective.row;
      if (row.project_id !== block.projectId || row.document_id !== block.documentId || row.package_id !== packageId || row.version_id !== versionId) unavailable();
      const key = packageKey(packageId, versionId);
      if (path.has(key)) unavailable("output_source_governance_cycle");
      const snapshot = await packageSnapshot(packageId, versionId);
      const member = snapshot.blocks.find((item) => item.sourceBlockId === sourceBlockId);
      if (!member || member.contentSha256 !== membership.content_sha256 || effective.members.length !== snapshot.blocks.length
        || new Set(effective.members.map((item) => item.target_block_id)).size !== effective.members.length
        || effective.members.some((item) => item.organization_id !== organizationId
          || snapshot.blocks.find((source) => source.sourceBlockId === item.source_block_id)?.contentSha256 !== item.content_sha256)) unavailable();
      if (completed.has(bindingId)) continue;
      const licensed = licensedPackageSourceBlocks(snapshot.blocks);
      pending.push({ bindingId, key, snapshot, licensed });
    }
    // Capture every independent origin at this frontier together, not once per
    // package. An additional governed origin requires another bounded frontier.
    await loadOriginRows(pending.filter(item => item.licensed.length).map(item => item.snapshot));
    for (const { bindingId, key, snapshot, licensed } of pending) {
      if (completed.has(bindingId)) continue;
      if (licensed.length) {
        const source = await origin(snapshot.sourceProjectAccessId);
        const projection = foldEvents(source.events, Number.POSITIVE_INFINITY, snapshot.sourceDocumentId, textId(source.row.project_id));
        const document = projection.documents.find((item) => item.id === snapshot.sourceDocumentId && item.projectId === source.row.project_id && !item.removed);
        if (!document) unavailable("context_source_rights_expired");
        const required = new Set(document.sourceEvents);
        const originals: CreativeBlock[] = [];
        for (const licensedMember of licensed) {
          const original = projection.blocks.find((item) => item.id === licensedMember.sourceBlockId && item.documentId === snapshot.sourceDocumentId && !item.removed);
          if (!original) unavailable("context_source_rights_expired");
          proof.rights(original.properties); original.sourceEvents.forEach((id) => required.add(id)); originals.push(original);
          if (licensedMember.source || licensedMember.type === "reference") {
            // Reference snapshots without a frozen source identity cannot prove
            // which original media their present license is meant to cover.
            if (!object(licensedMember.source)) unavailable();
            const referenceId = textId(original.properties.reference_id);
            const receipt = [...source.events].reverse().find((event) => ["RightsAsserted", "ReferenceIngested"].includes(event.type) && event.payload.reference_id === referenceId);
            if (!receipt || !["owned", "owned_or_licensed"].includes(String(receipt.payload.rights_class ?? ""))) unavailable("context_source_rights_expired");
            proof.rights(receipt.payload); required.add(receipt.eventId);
            if (licensedMember.source) {
              // A newly licensed replacement reference must not license the old
              // immutable package bytes. This is the asset hash, not the block
              // JSON digest in member.contentSha256. Renewal for the same bytes
              // may remain valid, with all retained identity evidence guarded.
              const frozen = licensedMember.source;
              if (!object(frozen) || typeof frozen.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(frozen.contentSha256)) unavailable();
              const ingested = [...source.events].reverse().find((event) => event.type === "ReferenceIngested" && event.payload.reference_id === referenceId);
              if (!ingested || ingested.payload.content_hash !== frozen.contentSha256) unavailable();
              if (present(original.properties.source_content_hash) && original.properties.source_content_hash !== frozen.contentSha256) unavailable();
              if (present(original.properties.media_url) && present(ingested.payload.source_ref) && original.properties.media_url !== ingested.payload.source_ref) unavailable();
              if (present(frozen.sourceEvidenceSha256) && (typeof frozen.sourceEvidenceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(frozen.sourceEvidenceSha256)
                || original.properties.source_evidence_hash !== frozen.sourceEvidenceSha256
                || present(ingested.payload.source_evidence_hash) && ingested.payload.source_evidence_hash !== frozen.sourceEvidenceSha256)) unavailable();
              // The latest receipt above governs current rights; a historical
              // ingest proves byte identity, not an additional obsolete license.
              required.add(ingested.eventId);
            }
          }
        }
        for (const id of required) {
          const evidence = source.rows.find((item) => item.event_id === id);
          if (!evidence || evidence.private_owner_id !== source.row.owner_user_id || evidence.private_redacted_at !== null || typeof evidence.private_json !== "string") unavailable("output_source_private_evidence_unavailable");
        }
        await visit(originals, new Set([...path, key]));
      }
      completed.add(bindingId);
    }
  }

  await visit(blocks, new Set());
  return proof.finish();
}
