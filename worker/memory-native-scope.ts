import type { WorkerEnv } from "./runtime.ts";
import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import type { NativeMemoryContextObserver, NativeMemoryPreparedDocument } from "./memory-live-context.ts";
import { memoryCanonical } from "./memory-sql.ts";

export type NativeMemoryDocumentScope = Readonly<{
  version: "native-document-scope-v1";
  actorUserId: string; ownerUserId: string; organizationId: string | null; projectAccessId: string | null;
  projectId: string; documentId: string; partitionKey: string; projectKey: string; documentKey: string;
  projectAncestry: "unresolved";
}>;

const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.isWellFormed() && value.trim() === value && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Canonical identity is not authority. Actor partitions are private even when
 * two actors can read the same governed resource. Ancestry never grants access. */
export function nativeMemoryDocumentIdentity(input: Pick<LiveMemoryEnrollment,
  "actor_user_id" | "owner_user_id" | "organization_id" | "project_access_id" | "project_id" | "document_id">): NativeMemoryDocumentScope | null {
  const { actor_user_id: actorUserId, owner_user_id: ownerUserId, organization_id: organizationId,
    project_access_id: projectAccessId, project_id: projectId, document_id: documentId } = input;
  if (![actorUserId, ownerUserId, projectId, documentId].every(id)
    || !(organizationId === null && projectAccessId === null && ownerUserId === actorUserId
      || id(organizationId) && id(projectAccessId))) return null;
  const custody = [ownerUserId, organizationId, projectAccessId];
  return Object.freeze({ version: "native-document-scope-v1", actorUserId, ownerUserId, organizationId, projectAccessId, projectId, documentId,
    partitionKey: JSON.stringify(["memory-partition-v1", actorUserId, ...custody]),
    projectKey: JSON.stringify(["memory-resource-v1", ...custody, "project", projectId]),
    documentKey: JSON.stringify(["memory-resource-v1", ...custody, "document", projectId, documentId]),
    projectAncestry: "unresolved" });
}

export type NativeMemoryArtifactScope = Readonly<Omit<NativeMemoryDocumentScope,'version'> & {
  version:'native-artifact-scope-v1'; artifactId:string; artifactKey:string;
}>;
/** Resource identity only. Callers must independently certify the current
 * artifact placement, revision, retained bytes and access. A matching ID or
 * parent document never authorizes a foreign/old artifact body. */
export function nativeMemoryArtifactIdentity(input: Parameters<typeof nativeMemoryDocumentIdentity>[0],artifactId:string):NativeMemoryArtifactScope|null{
  const parent=nativeMemoryDocumentIdentity(input);if(!parent||!id(artifactId))return null;
  return Object.freeze({...parent,version:'native-artifact-scope-v1',artifactId,
    artifactKey:JSON.stringify(['memory-resource-v1',parent.ownerUserId,parent.organizationId,parent.projectAccessId,
      'artifact',parent.projectId,parent.documentId,artifactId])});
}

/** Identity metadata only, never resource access or permission to read prose.
 * Consumers must validate it against their own authenticated scope and retain
 * the exact observation in their final native proof. */
export function nativeMemoryDocumentScopeQuery(ownerUserId:string,documentId:string) {
  return { sql: `SELECT
    (SELECT json_object('eventId',created.event_id,'sequence',created.sequence,'projectId',
      COALESCE(json_extract(created.payload,'$.project_id'),created_scope.project_id,
        (SELECT json_extract(previous.payload,'$.project_id') FROM events previous WHERE previous.stream_id=created.stream_id
          AND previous.sequence<=created.sequence AND previous.type IN('ProjectCreated','ProjectOpened') ORDER BY previous.sequence DESC LIMIT 1)))
      FROM events created LEFT JOIN event_private_payloads created_scope ON created_scope.private_event_id=created.event_id
        AND created_scope.owner_id=substr(created.stream_id,10)
      WHERE created.stream_id=? AND created.type IN('DocumentCreated','DocumentForked')
        AND json_extract(created.payload,'$.document_id')=? ORDER BY created.sequence DESC LIMIT 1) AS declaration,
    (SELECT json_object('eventId',boundary.event_id,'sequence',boundary.sequence,'type',boundary.type) FROM events boundary
      WHERE boundary.stream_id=? AND json_extract(boundary.payload,'$.document_id')=?
        AND boundary.type IN('DocumentCreated','DocumentForked','DocumentRemoved','DocumentRestored')
      ORDER BY boundary.sequence DESC LIMIT 1) AS lifecycle,
    (SELECT json_group_array(json_object('organizationId',organization_id,'projectAccessId',project_access_id,
      'projectId',project_id,'ownerUserId',owner_user_id,'visibility',visibility,'actorUserId',actor_user_id))
      FROM (SELECT * FROM project_resource_scopes WHERE owner_user_id=? AND resource_kind='document' AND resource_id=?
        ORDER BY organization_id,project_access_id LIMIT 3)) AS custody`,
  bindings: [`creative:${ownerUserId}`, documentId, `creative:${ownerUserId}`, documentId, ownerUserId, documentId] };
}

/** Add a narrow native identity proof to the caller's existing authenticated
 * document/enrollment witness. The caller must still enforce its original
 * principal/session/grant guards and seal/replay that witness before use.
 * No whole-stream head is pinned: an unrelated or own-answer append is not a move. */
export function prepareNativeMemoryDocumentScopeObservation(env: WorkerEnv, prepared: NativeMemoryPreparedDocument,
  expected: Pick<LiveMemoryEnrollment,"actor_user_id"|"owner_user_id"|"organization_id"|"project_access_id"|"project_id"|"document_id"|"permission_epoch">, observer: NativeMemoryContextObserver) {
  const db = env.DB, original = memoryCanonical({ prepared, expected }), e = structuredClone(expected), identity = nativeMemoryDocumentIdentity(e);
  const { principal, binding } = prepared;
  if (!identity || !observer || principal.fictional || principal.userId !== e.actor_user_id || binding.actorUserId !== e.actor_user_id
    || binding.projectId !== e.project_id || binding.documentId !== e.document_id || binding.streamId !== `creative:${e.owner_user_id}`
    || principal.access.permissionEpoch !== e.permission_epoch || binding.permissionEpoch !== e.permission_epoch
    || (binding.scope?.organizationId ?? null) !== e.organization_id || (binding.scope?.projectAccessId ?? null) !== e.project_access_id
    || (binding.scope?.ownerUserId ?? principal.userId) !== e.owner_user_id) return null;
  const query = nativeMemoryDocumentScopeQuery(e.owner_user_id,e.document_id);
  const statement = db.prepare(query.sql).bind(...query.bindings);
  const accept = (observed: D1Result<Record<string, unknown>>): NativeMemoryDocumentScope | null => {
  const result = structuredClone(observed);
  if (env.DB !== db || memoryCanonical({ prepared, expected }) !== original || result.success !== true || "error" in result && result.error !== undefined
    || !Array.isArray(result.results) || result.results.length !== 1) return null;
  const row = result.results[0];
  if (!row || Object.keys(row).sort().join(",") !== "custody,declaration,lifecycle"
    || typeof row.declaration !== "string" || typeof row.lifecycle !== "string" || typeof row.custody !== "string") return null;
  try {
    const declaration = JSON.parse(row.declaration), lifecycle = JSON.parse(row.lifecycle), custody = JSON.parse(row.custody);
    if (!declaration || !id(declaration.eventId) || !Number.isSafeInteger(declaration.sequence) || declaration.sequence < 1
      || declaration.projectId !== e.project_id || !lifecycle || !id(lifecycle.eventId) || !Number.isSafeInteger(lifecycle.sequence)
      || lifecycle.sequence < declaration.sequence || !["DocumentCreated", "DocumentForked", "DocumentRestored"].includes(lifecycle.type)
      || !Array.isArray(custody)) return null;
    if (e.organization_id === null ? custody.length !== 0 : custody.length !== 1
      || custody[0].organizationId !== e.organization_id || custody[0].projectAccessId !== e.project_access_id
      || custody[0].projectId !== e.project_id || custody[0].ownerUserId !== e.owner_user_id
      || !(custody[0].visibility === "collaborative_output" || custody[0].visibility === "actor_private" && custody[0].actorUserId === e.actor_user_id)) return null;
  } catch { return null; }
  observer.observe([statement], [result], [query]);
  return identity;
  };
  // Metadata preparation is not an authority token. The caller supplies this
  // exact statement's result and replays the observer with its own native
  // permission proof before disclosing or consuming any source.
  return {statement, query, accept};
}

export async function observeNativeMemoryDocumentScope(env: WorkerEnv, prepared: NativeMemoryPreparedDocument,
  expected: Pick<LiveMemoryEnrollment,"actor_user_id"|"owner_user_id"|"organization_id"|"project_access_id"|"project_id"|"document_id"|"permission_epoch">,
  observer: NativeMemoryContextObserver): Promise<NativeMemoryDocumentScope | null> {
  const read=prepareNativeMemoryDocumentScopeObservation(env,prepared,expected,observer);
  return read?read.accept(await read.statement.all<Record<string,unknown>>()):null;
}
