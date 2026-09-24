import type { WorkerEnv } from './runtime.ts';
import type { BudgetReservationGuard, ProjectExecutionScope } from './pilot-policy.ts';
import { preparePrivateContent } from './private-content-storage.ts';
import { executionContentCustodyGuard } from './consequential-consent.ts';
import { uuidV7 } from './event-write-primitives.ts';

export const CREATION_PAYLOAD_MAX_BYTES = 1_000_000;
export type CreationDestination = { entryKind: 'project' | 'document' | 'idea'; projectId?: string; documentId?: string };
/** This guard is resolved by the server caller, never accepted from a request body. */
export type CreationStoreAuthority = { actorUserId: string; scopeKey: string; destination: CreationDestination; projectScope?: ProjectExecutionScope; guard: BudgetReservationGuard };
export type StoredCreationDraft<T = Record<string, unknown>> = {
  contentId: string; draftId: string; revision: number; state: 'active' | 'discarded' | 'applied'; scopeKey: string;
  destination: CreationDestination; expiresAt: string; operationId: string | null; receiptId: string | null; payload: T;
};
export class CreationStoreError extends Error {
  constructor(public code: 'creation_draft_unavailable' | 'creation_revision_conflict' | 'creation_payload_too_large' | 'creation_payload_invalid' | 'creation_scope_invalid', public revision?: number) { super(code); }
}

export const CREATION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS creation_drafts (
    draft_id TEXT PRIMARY KEY NOT NULL, actor_user_id TEXT NOT NULL, scope_key TEXT NOT NULL,
    destination_json TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1),
    state TEXT NOT NULL CHECK(state IN('active','discarded','applied')), content_id TEXT,
    expires_at TEXT NOT NULL, operation_id TEXT, receipt_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 1 CHECK(verified=1), CHECK(state<>'active' OR content_id IS NOT NULL))`,
  `CREATE TABLE IF NOT EXISTS creation_draft_content_versions (draft_id TEXT NOT NULL, revision INTEGER NOT NULL, content_id TEXT UNIQUE NOT NULL, actor_user_id TEXT NOT NULL, PRIMARY KEY(draft_id,revision))`,
  `CREATE INDEX IF NOT EXISTS creation_drafts_actor_scope ON creation_drafts(actor_user_id,scope_key,expires_at)`,
  `CREATE TABLE IF NOT EXISTS creation_operations (
    operation_id TEXT PRIMARY KEY NOT NULL, draft_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, scope_key TEXT NOT NULL,
    draft_revision INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN('interpretation','commit')),
    state TEXT NOT NULL CHECK(state IN('prepared','executing','review','applied','failed')),
    request_hash TEXT NOT NULL, content_id TEXT, approval_hash TEXT, receipt_json TEXT, error_code TEXT,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 1 CHECK(verified=1))`,
  `CREATE INDEX IF NOT EXISTS creation_operations_draft ON creation_operations(actor_user_id,scope_key,draft_id,draft_revision)`,
  `CREATE TABLE IF NOT EXISTS creation_write_assertions (assertion_id TEXT PRIMARY KEY NOT NULL, verified INTEGER NOT NULL CHECK(verified=1))`,
] as const;

/** Dedicated feature initialization: this does not release or repair held Memory migrations. */
export async function ensureCreationSchema(env: WorkerEnv) { await env.DB.batch(CREATION_SCHEMA_STATEMENTS.map(sql => env.DB.prepare(sql))); }

/** Place assertion and cleanup in the SAME atomic D1 batch as the mutation. */
export function creationWriteAssertion(env: WorkerEnv, guard: BudgetReservationGuard) {
  const id = uuidV7();
  return {
    assert: env.DB.prepare(`INSERT INTO creation_write_assertions(assertion_id,verified) VALUES (?,CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END)`).bind(id, ...guard.bindings),
    cleanup: env.DB.prepare('DELETE FROM creation_write_assertions WHERE assertion_id=?').bind(id),
  };
}

export function serializeCreationPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new CreationStoreError('creation_payload_invalid');
  let value: string;
  try { value = JSON.stringify(payload); } catch { throw new CreationStoreError('creation_payload_invalid'); }
  if (!value || !value.isWellFormed()) throw new CreationStoreError('creation_payload_invalid');
  if (new TextEncoder().encode(value).byteLength > CREATION_PAYLOAD_MAX_BYTES) throw new CreationStoreError('creation_payload_too_large');
  return value;
}

function destinationKey(authority: CreationStoreAuthority) {
  const { actorUserId, scopeKey, destination: d, projectScope, guard } = authority;
  if (!actorUserId || !scopeKey || !guard?.sql || !Array.isArray(guard.bindings) || !['project','document','idea'].includes(d?.entryKind)
    || (d.entryKind !== 'project' && !d.projectId) || (d.entryKind === 'project' && (d.projectId || d.documentId || projectScope))
    || (d.documentId && d.entryKind !== 'idea') || (projectScope && (projectScope.actorUserId !== actorUserId || projectScope.projectId !== d.projectId)))
    throw new CreationStoreError('creation_scope_invalid');
  return JSON.stringify({ entryKind: d.entryKind, ...(d.projectId ? { projectId: d.projectId } : {}), ...(d.documentId ? { documentId: d.documentId } : {}) });
}
export function creationDraftGuard(authority: CreationStoreAuthority, draftId: string, revision?: number, contentId?: string): BudgetReservationGuard {
  const custody = executionContentCustodyGuard({ actorUserId: authority.actorUserId, scope: authority.projectScope ?? null }, 'content');
  return { sql: `(${authority.guard.sql}) AND EXISTS(SELECT 1 FROM creation_drafts d JOIN private_content content ON content.content_id=d.content_id AND content.owner_id=d.actor_user_id WHERE d.draft_id=? AND d.actor_user_id=? AND d.scope_key=? AND d.destination_json=? AND d.state='active' AND content.kind='creation-draft' AND content.redacted_at IS NULL AND (${custody.sql}) AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')${revision === undefined ? '' : ' AND d.revision=?'}${contentId === undefined ? '' : ' AND d.content_id=?'})`,
    bindings: [...authority.guard.bindings, draftId, authority.actorUserId, authority.scopeKey, destinationKey(authority), ...custody.bindings, ...(revision === undefined ? [] : [revision]), ...(contentId === undefined ? [] : [contentId])] };
}
type DraftRow = { content_id:string; draft_id: string; revision: number; state: StoredCreationDraft['state']; scope_key: string; destination_json: string; expires_at: string; operation_id: string | null; receipt_id: string | null; content: string };
export async function readCreationDraft<T = Record<string, unknown>>(env: WorkerEnv, authority: CreationStoreAuthority, draftId: string): Promise<StoredCreationDraft<T>> {
  const destination = destinationKey(authority), custody = executionContentCustodyGuard({ actorUserId: authority.actorUserId, scope: authority.projectScope ?? null }, 'content');
  const row = await env.DB.prepare(`SELECT d.*,content.content FROM creation_drafts d JOIN private_content content ON content.content_id=d.content_id AND content.owner_id=d.actor_user_id
    WHERE d.draft_id=? AND d.actor_user_id=? AND d.scope_key=? AND d.destination_json=? AND d.state='active'
    AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND content.redacted_at IS NULL AND content.kind='creation-draft' AND (${custody.sql}) AND (${authority.guard.sql})`)
    .bind(draftId, authority.actorUserId, authority.scopeKey, destination, ...custody.bindings, ...authority.guard.bindings).first<DraftRow>();
  if (!row) throw new CreationStoreError('creation_draft_unavailable');
  let payload: T;
  try { payload = JSON.parse(row.content) as T; } catch { throw new CreationStoreError('creation_draft_unavailable'); }
  return { contentId: row.content_id, draftId: row.draft_id, revision: row.revision, state: row.state, scopeKey: row.scope_key, destination: JSON.parse(row.destination_json), expiresAt: row.expires_at, operationId: row.operation_id, receiptId: row.receipt_id, payload };
}

export async function createCreationDraft<T extends Record<string, unknown>>(env: WorkerEnv, authority: CreationStoreAuthority, payload: T): Promise<StoredCreationDraft<T>> {
  const destination = destinationKey(authority), serialized = serializeCreationPayload(payload);
  const requestedId = payload.id;
  if (requestedId !== undefined && (typeof requestedId !== 'string' || requestedId.length === 0 || requestedId.length > 120 || [...requestedId].some(character => character.charCodeAt(0) < 32))) throw new CreationStoreError('creation_payload_invalid');
  const draftId = typeof requestedId === 'string' ? requestedId : uuidV7();
  const replay = async () => {
    const existing = await readCreationDraft<T>(env, authority, draftId);
    if (existing.revision !== 1 || JSON.stringify(existing.payload) !== serialized) throw new CreationStoreError('creation_revision_conflict', existing.revision);
    return existing;
  };
  if (await env.DB.prepare('SELECT 1 AS present FROM creation_drafts WHERE draft_id=?').bind(draftId).first()) return replay();
  const prepared = await preparePrivateContent(env, authority.actorUserId, 'creation-draft', serialized, authority.projectScope, undefined, authority.guard, { contentId: 'creation-draft-' + uuidV7() });
  const proof = creationWriteAssertion(env, authority.guard), custody = executionContentCustodyGuard({ actorUserId: authority.actorUserId, scope: authority.projectScope ?? null });
  try { await env.DB.batch([proof.assert, ...prepared.statements,
    env.DB.prepare(`INSERT INTO creation_drafts(draft_id,actor_user_id,scope_key,destination_json,revision,state,content_id,expires_at,created_at,updated_at,verified)
      VALUES (?,?,?,?,1,'active',?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='creation-draft' AND redacted_at IS NULL AND (${custody.sql})) THEN 1 ELSE 0 END)`)
      .bind(draftId, authority.actorUserId, authority.scopeKey, destination, prepared.contentId, prepared.expiresAt, prepared.createdAt, prepared.createdAt, prepared.contentId, authority.actorUserId, ...custody.bindings),
    env.DB.prepare('INSERT INTO creation_draft_content_versions(draft_id,revision,content_id,actor_user_id) VALUES (?,1,?,?)').bind(draftId, prepared.contentId, authority.actorUserId), proof.cleanup]);
  } catch (error) {
    if (await env.DB.prepare('SELECT 1 AS present FROM creation_drafts WHERE draft_id=?').bind(draftId).first()) return replay();
    throw error;
  }
  return { contentId: prepared.contentId, draftId, revision: 1, state: 'active', scopeKey: authority.scopeKey, destination: JSON.parse(destination), expiresAt: prepared.expiresAt, operationId: null, receiptId: null, payload: JSON.parse(serialized) as T };
}

export async function updateCreationDraft<T extends Record<string, unknown>>(env: WorkerEnv, authority: CreationStoreAuthority, draftId: string, expectedRevision: number, payload: T): Promise<StoredCreationDraft<T>> {
  const serialized = serializeCreationPayload(payload);
  const current = await readCreationDraft(env, authority, draftId);
  if (!Number.isSafeInteger(expectedRevision) || current.revision !== expectedRevision) throw new CreationStoreError('creation_revision_conflict', current.revision);
  const guard = creationDraftGuard(authority, draftId, expectedRevision);
  const prepared = await preparePrivateContent(env, authority.actorUserId, 'creation-draft', serialized, authority.projectScope, undefined, guard, { contentId: 'creation-draft-' + uuidV7() }, current.expiresAt);
  const proof = creationWriteAssertion(env, guard);
  try {
    await env.DB.batch([proof.assert, ...prepared.statements,
      env.DB.prepare(`UPDATE creation_drafts SET revision=revision+1,content_id=?,expires_at=?,updated_at=?,operation_id=NULL,receipt_id=NULL
        WHERE draft_id=? AND actor_user_id=? AND scope_key=? AND revision=? AND state='active'`)
        .bind(prepared.contentId, prepared.expiresAt, prepared.createdAt, draftId, authority.actorUserId, authority.scopeKey, expectedRevision),
      env.DB.prepare('INSERT INTO creation_draft_content_versions(draft_id,revision,content_id,actor_user_id) VALUES (?,?,?,?)').bind(draftId, expectedRevision + 1, prepared.contentId, authority.actorUserId),
      proof.cleanup]);
  } catch (error) {
    const latest = await readCreationDraft(env, authority, draftId);
    if (latest.revision !== expectedRevision) throw new CreationStoreError('creation_revision_conflict', latest.revision);
    throw error;
  }
  return { ...current, contentId: prepared.contentId, revision: expectedRevision + 1, expiresAt: prepared.expiresAt, operationId: null, receiptId: null, payload: JSON.parse(serialized) as T };
}

export async function discardCreationDraft(env: WorkerEnv, authority: CreationStoreAuthority, draftId: string, expectedRevision: number) {
  const current = await readCreationDraft(env, authority, draftId);
  if (!Number.isSafeInteger(expectedRevision) || current.revision !== expectedRevision) throw new CreationStoreError('creation_revision_conflict', current.revision);
  const proof = creationWriteAssertion(env, creationDraftGuard(authority, draftId, expectedRevision)), now = new Date().toISOString();
  const custody = executionContentCustodyGuard({ actorUserId: authority.actorUserId, scope: authority.projectScope ?? null });
  try {
    await env.DB.batch([proof.assert,
      env.DB.prepare(`UPDATE private_content SET content='',redacted_at=? WHERE (content_id IN(SELECT content_id FROM creation_draft_content_versions WHERE draft_id=? AND actor_user_id=?) OR content_id IN(SELECT content_id FROM creation_operations WHERE draft_id=? AND actor_user_id=? AND scope_key=?)) AND owner_id=? AND kind='creation-draft' AND (${custody.sql})`)
        .bind(now, draftId, authority.actorUserId, draftId, authority.actorUserId, authority.scopeKey, authority.actorUserId, ...custody.bindings),
      env.DB.prepare(`UPDATE creation_operations SET state='failed',error_code='creation_draft_discarded',content_id=NULL,updated_at=? WHERE draft_id=? AND actor_user_id=? AND state<>'applied'`).bind(now,draftId,authority.actorUserId),
      env.DB.prepare(`UPDATE creation_drafts SET state='discarded',content_id=NULL,revision=revision+1,updated_at=? WHERE draft_id=? AND actor_user_id=? AND scope_key=? AND revision=?`)
        .bind(now, draftId, authority.actorUserId, authority.scopeKey, expectedRevision), proof.cleanup]);
  } catch (error) {
    const latest = await readCreationDraft(env, authority, draftId);
    if (latest.revision !== expectedRevision) throw new CreationStoreError('creation_revision_conflict', latest.revision);
    throw error;
  }
  return { draftId, revision: expectedRevision + 1, state: 'discarded' as const, scopeKey: authority.scopeKey, expiresAt: current.expiresAt };
}
