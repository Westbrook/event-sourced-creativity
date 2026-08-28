import type { WorkerEnv } from "./runtime.ts";
import { outputAssertionStatements, outputScopeAuthority, OutputConflictError, type OutputScope, type OutputSqlAssertion, type OutputSqlValue } from "./output-requirements-ledger.ts";
import { outputAssetStorageCustodyMatches } from "./output-asset-storage-identity.ts";

export type OutputAssetStorageReceipt = {
  scope_key: string; asset_id: string; owner_user_id: string; actor_user_id: string;
  organization_id: string | null; project_access_id: string | null; project_id: string; document_id: string; context_id: string | null;
  command_key: string; request_digest: string; source_digest: string; storage_key: string; content_sha256: string; byte_length: number;
  status: "writing" | "written" | "cleanup_pending" | "deleted"; write_acknowledged: number; publication_event_id: string | null;
  created_at: string; updated_at: string;
};
type WriteInput = {
  scope: OutputScope; assetId: string; commandKey: string; requestDigest: string; sourceDigest: string;
  storageKey: string; sha256: string; byteLength: number; expectedHead: number; expectedProjectHead: number;
  sourceAssertions: OutputSqlAssertion[];
};
const nowIso = () => new Date().toISOString();
const receiptById = (env: WorkerEnv, scopeKey: string, assetId: string) => env.DB.prepare("SELECT * FROM output_asset_storage_writes WHERE scope_key=? AND asset_id=?").bind(scopeKey, assetId).first<OutputAssetStorageReceipt>();

/** Durable metadata precedes the first byte write; no filename, prompt or source text is stored here. */
export async function claimOutputAssetStorage(env: WorkerEnv, input: WriteInput) {
  const scope = input.scope;
  const previous = () => env.DB.prepare("SELECT * FROM output_asset_storage_writes WHERE scope_key=? AND actor_user_id=? AND command_key=?").bind(scope.key, scope.actorUserId, input.commandKey).first<OutputAssetStorageReceipt>();
  const checked = (row: OutputAssetStorageReceipt) => {
    if (row.request_digest !== input.requestDigest || row.source_digest !== input.sourceDigest || row.content_sha256 !== input.sha256 || Number(row.byte_length) !== input.byteLength || row.owner_user_id !== scope.ownerUserId || row.document_id !== scope.documentId || row.project_id !== scope.projectId || row.organization_id !== scope.organizationId || row.project_access_id !== scope.projectAccessId || row.context_id !== scope.contextId) throw new OutputConflictError("output_asset_write_identity_conflict", 409);
    return row;
  };
  const existing = await previous();
  if (existing) return { receipt: checked(existing), claimed: false };
  const now = nowIso();
  const guards: OutputSqlAssertion[] = [outputScopeAuthority(scope, "author"), ...input.sourceAssertions,
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${scope.ownerUserId}`, input.expectedHead] },
    ...(scope.kind === "project" ? [{ sql: "(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?", bindings: [scope.projectAccessId, scope.organizationId, input.expectedProjectHead] }] : [])];
  try {
    await env.DB.batch([...guards.flatMap((guard) => outputAssertionStatements(env, guard)), env.DB.prepare(`INSERT INTO output_asset_storage_writes(
      scope_key,asset_id,owner_user_id,actor_user_id,organization_id,project_access_id,project_id,document_id,context_id,command_key,request_digest,source_digest,
      storage_key,content_sha256,byte_length,status,write_acknowledged,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'writing',0,?,?)`)
      .bind(scope.key, input.assetId, scope.ownerUserId, scope.actorUserId, scope.organizationId, scope.projectAccessId, scope.projectId, scope.documentId, scope.contextId, input.commandKey, input.requestDigest, input.sourceDigest, input.storageKey, input.sha256, input.byteLength, now, now),
      ...outputAssertionStatements(env, { sql: "EXISTS(SELECT 1 FROM output_asset_storage_writes WHERE scope_key=? AND asset_id=? AND command_key=? AND request_digest=?)", bindings: [scope.key, input.assetId, input.commandKey, input.requestDigest] })]);
  } catch (error) {
    const committed = await previous();
    if (!committed) throw error;
    return { receipt: checked(committed), claimed: committed.asset_id === input.assetId };
  }
  const saved = await receiptById(env, scope.key, input.assetId);
  if (!saved) throw new OutputConflictError("output_asset_storage_receipt_missing", 409);
  return { receipt: checked(saved), claimed: true };
}

/** Record knowledge of the PUT response even when erasure already revoked publication. */
export async function acknowledgeOutputAssetStorage(env: WorkerEnv, receipt: OutputAssetStorageReceipt) {
  try {
    await env.DB.batch([env.DB.prepare(`UPDATE output_asset_storage_writes SET write_acknowledged=1,
      status=CASE WHEN status='writing' THEN 'written' ELSE status END,updated_at=?
      WHERE scope_key=? AND asset_id=? AND storage_key=? AND content_sha256=? AND publication_event_id IS NULL`)
      .bind(nowIso(), receipt.scope_key, receipt.asset_id, receipt.storage_key, receipt.content_sha256),
      ...outputAssertionStatements(env, { sql: "EXISTS(SELECT 1 FROM output_asset_storage_writes WHERE scope_key=? AND asset_id=? AND storage_key=? AND content_sha256=? AND write_acknowledged=1)", bindings: [receipt.scope_key, receipt.asset_id, receipt.storage_key, receipt.content_sha256] })]);
  } catch (error) {
    const saved = await receiptById(env, receipt.scope_key, receipt.asset_id);
    if (!saved || saved.write_acknowledged !== 1 || saved.storage_key !== receipt.storage_key || saved.content_sha256 !== receipt.content_sha256) throw error;
  }
}

export function outputAssetPublicationAssertion(scopeKey: string, assetId: string, storageKey: string, sha256: string): OutputSqlAssertion {
  return { sql: "EXISTS(SELECT 1 FROM output_asset_storage_writes WHERE scope_key=? AND asset_id=? AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1 AND publication_event_id IS NULL)", bindings: [scopeKey, assetId, storageKey, sha256] };
}

export function outputAssetPublicationStatements(env: WorkerEnv, scopeKey: string, assetId: string, eventId: string) {
  return [env.DB.prepare(`UPDATE output_asset_storage_writes SET publication_event_id=?,updated_at=? WHERE scope_key=? AND asset_id=?
      AND status='written' AND write_acknowledged=1 AND publication_event_id IS NULL
      AND EXISTS(SELECT 1 FROM output_assets asset WHERE asset.scope_key=output_asset_storage_writes.scope_key
        AND asset.asset_id=output_asset_storage_writes.asset_id AND asset.storage_key=output_asset_storage_writes.storage_key
        AND asset.content_sha256=output_asset_storage_writes.content_sha256 AND asset.created_event_id=?)`)
      .bind(eventId, nowIso(), scopeKey, assetId, eventId),
    ...outputAssertionStatements(env, { sql: "EXISTS(SELECT 1 FROM output_asset_storage_writes WHERE scope_key=? AND asset_id=? AND publication_event_id=? AND status='written' AND write_acknowledged=1)", bindings: [scopeKey, assetId, eventId] })];
}

function matchesCustody(row: OutputAssetStorageReceipt, metadata: Record<string, string> | undefined) {
  return outputAssetStorageCustodyMatches({ ownerUserId: row.owner_user_id, projectId: row.project_id, documentId: row.document_id, assetId: row.asset_id, scopeKey: row.scope_key, sha256: row.content_sha256, storageKey: row.storage_key }, metadata);
}

/** A published canonical asset wins over a lost D1 acknowledgement; cleanup can never remove it. */
export async function cleanupOutputAssetStorage(env: WorkerEnv, scopeKey: string, assetId: string, options: { personalOnly?: boolean } = {}) {
  const pending = async () => {
    try { await env.DB.prepare(`UPDATE output_asset_storage_writes SET updated_at=? WHERE scope_key=? AND asset_id=? AND publication_event_id IS NULL AND status='cleanup_pending' ${options.personalOnly ? "AND organization_id IS NULL AND project_access_id IS NULL AND context_id IS NULL" : ""}`).bind(nowIso(), scopeKey, assetId).run(); } catch { /* Retain the existing durable obligation when D1 is unavailable. */ }
    return { deleted: false, pending: true };
  };
  let row: OutputAssetStorageReceipt | null;
  try {
    await env.DB.prepare(`UPDATE output_asset_storage_writes SET status='cleanup_pending',updated_at=?
      WHERE scope_key=? AND asset_id=? AND publication_event_id IS NULL AND status IN('writing','written')
        ${options.personalOnly ? "AND organization_id IS NULL AND project_access_id IS NULL AND context_id IS NULL" : ""}
        AND NOT EXISTS(SELECT 1 FROM output_assets asset WHERE asset.scope_key=output_asset_storage_writes.scope_key
          AND asset.asset_id=output_asset_storage_writes.asset_id AND asset.storage_key=output_asset_storage_writes.storage_key AND asset.content_sha256=output_asset_storage_writes.content_sha256)`)
      .bind(nowIso(), scopeKey, assetId).run();
    row = await receiptById(env, scopeKey, assetId);
    if (!row || row.publication_event_id) return { deleted: false, pending: false };
    if (options.personalOnly && (row.organization_id !== null || row.project_access_id !== null || row.context_id !== null)) return { deleted: false, pending: false };
    const canonical = await env.DB.prepare("SELECT 1 AS present FROM output_assets WHERE scope_key=? AND asset_id=? AND storage_key=? AND content_sha256=?").bind(scopeKey, assetId, row.storage_key, row.content_sha256).first();
    if (canonical) return { deleted: false, pending: false };
    if (row.status === "deleted" && row.write_acknowledged === 1) return { deleted: true, pending: false };
    if (row.status !== "cleanup_pending") return pending();
    const object = await env.MEDIA.head(row.storage_key);
    if (object && !matchesCustody(row, object.customMetadata)) return pending();
    if (object) await env.MEDIA.delete(row.storage_key);
    const absent = !await env.MEDIA.head(row.storage_key);
    // An absent object is not proof that an unacknowledged, in-flight PUT cannot
    // arrive later. Keep its cleanup obligation until write completion is known.
    if (!absent || row.write_acknowledged !== 1) return pending();
    await env.DB.prepare("UPDATE output_asset_storage_writes SET status='deleted',updated_at=? WHERE scope_key=? AND asset_id=? AND publication_event_id IS NULL AND status='cleanup_pending' AND write_acknowledged=1")
      .bind(nowIso(), scopeKey, assetId).run();
    const current = await receiptById(env, scopeKey, assetId);
    return { deleted: current?.status === "deleted", pending: current?.status !== "deleted" };
  } catch { return pending(); }
}

/** Maintenance drains old/unpublished or explicitly revoked uploads, never adopted finished files. */
export async function reconcileOutputAssetStorage(env: WorkerEnv, options: { ownerUserId?: string; organizationId?: string; personalOnly?: boolean; limit?: number } = {}) {
  const exists = await env.DB.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='output_asset_storage_writes'").first();
  if (!exists) return { scanned: 0, deleted: 0, pending: 0 };
  const bindings: OutputSqlValue[] = [new Date(Date.now() - 5 * 60_000).toISOString()];
  const filters = ["publication_event_id IS NULL", "(status='cleanup_pending' OR status IN('writing','written') AND updated_at<?)"];
  if (options.ownerUserId) { filters.push("owner_user_id=?"); bindings.push(options.ownerUserId); }
  if (options.organizationId) { filters.push("organization_id=?"); bindings.push(options.organizationId); }
  if (options.personalOnly) filters.push("organization_id IS NULL AND project_access_id IS NULL AND context_id IS NULL");
  const limit = Number.isSafeInteger(options.limit) ? Math.max(1, Math.min(100, options.limit!)) : 50;
  bindings.push(limit);
  const rows = await env.DB.prepare(`SELECT scope_key,asset_id FROM output_asset_storage_writes WHERE ${filters.join(" AND ")} ORDER BY updated_at,storage_key LIMIT ?`).bind(...bindings).all<{ scope_key: string; asset_id: string }>();
  let deleted = 0, pending = 0;
  for (const row of rows.results) { const outcome = await cleanupOutputAssetStorage(env, row.scope_key, row.asset_id, { personalOnly: options.personalOnly }); deleted += outcome.deleted ? 1 : 0; pending += outcome.pending ? 1 : 0; }
  return { scanned: rows.results.length, deleted, pending };
}
