import {memoryAuthoredImageMediaAllowed} from './memory-authored-image-custody.ts';
import { preserveMemoryAuthoredCopies } from '../src/model/memory-authorship.ts';
import { audioRightsAllowed } from "../src/model/audio.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import {
  buildDocumentDuplicationPlan, documentDuplicationFolder, normalizeDocumentDuplicationTitle,
} from "../src/model/document-duplication.ts";
import { foldEvents } from "../src/model/events.ts";
import { outputAuthoringBlocksFromEvents, prepareOutputRequirementClientEvents } from "./output-requirement-event-guards.ts";
import { AUTHORING_EVENT_COLUMNS, AUTHORING_SIDECAR_COLUMNS, authoringEventRowsProof, authoringSidecarProof } from "./authoring-event-proof.ts";
import { mediaKeyMatchesOwnerNamespace } from "../src/model/media-ownership.ts";
import {
  authoringPreview, commitAuthoringPlan, dismissAuthoringPreview, documentCopyPreviewId, latestAuthoringPreview,
  readAuthoringState, storeAuthoringPreview, type AuthoringPlan, type AuthoringCommitProof, type RetainedAuthoringPreview,
} from "./authoring-commits.ts";
import {
  canonicalConsent, consentHash, executionAdmissionGuard, executionAuthorityCurrent, executionContentCustodyGuard,
  type ConsequentialBinding,
} from "./consequential-consent.ts";
import { contextSourceHash, prepareDocumentAuthority } from "./context-authoring-authority.ts";
import { verifyModel3dBlockAssets, verifySourceDocumentEvidence } from "./media-api.ts";
import { assertDerivedReferenceProvenance } from "./derived-reference-guard.ts";
import { normalizeReferenceComposition } from "../src/model/reference-composition.ts";
import { hasCapability, type BudgetReservationGuard, type PilotUser } from "./pilot-policy.ts";
import { readProjectSourceEvents } from "./project-access.ts";
import { serializeEvent, type EventRow, type WorkerEnv } from "./runtime.ts";

const headers = { "cache-control": "private, no-store", vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const privateJson = "CASE WHEN redacted_at IS NULL AND json_valid(content) THEN content ELSE '{}' END";
const folderTypes = ["CollectionCreated", "CollectionRenamed", "CollectionRemoved", "CollectionRestored", "CollectionItemAdded", "CollectionItemRemoved", "CollectionItemMoved"];
type Prepared = Exclude<Awaited<ReturnType<typeof prepareDocumentAuthority>>, Response>;
type CopyIntent = { operationId: string; title: string; collectionId: string | null; collectionMode: "source" | "explicit" };

/** Human copy authority includes folder history, which the assistant's semantic read intentionally omits. */
async function prepareCopy(request: Request, env: WorkerEnv, body: Record<string, unknown>, authority: "read" | "author") {
  const prepared = await prepareDocumentAuthority(request, env, body, authority);
  if (prepared instanceof Response) return prepared;
  const events = prepared.scope ? await readProjectSourceEvents(env, prepared.scope)
    : [...prepared.events, ...(await env.DB.prepare(`SELECT event.*,secret.private_json FROM events event
        LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
        WHERE event.stream_id=? AND event.type IN(${folderTypes.map((type) => "'" + type + "'").join(",")}) ORDER BY event.sequence`)
      .bind(prepared.principal.userId, prepared.binding.streamId).all<Record<string, unknown>>()).results.map(serializeEvent)]
      .sort((left, right) => left.sequence - right.sequence);
  const projection = foldEvents(events, Infinity, prepared.binding.documentId, prepared.binding.projectId);
  const sourceHash = await consentHash({
    context: await contextSourceHash(prepared.binding.projectId, prepared.binding.documentId, undefined, projection, events),
    collections: projection.collections, membership: projection.membership,
  });
  const binding: ConsequentialBinding = {
    ...prepared.binding, version: "human-document-duplicate-v1", operation: "document-duplicate",
    blockId: "", canvasId: null, sourceHash, intentHash: sourceHash,
  };
  return { ...prepared, projection, events, binding };
}

async function bindIntent(binding: ConsequentialBinding, intent: CopyIntent): Promise<ConsequentialBinding> {
  const request = { ...intent };
  const intentHash = await consentHash({
    actor: binding.actorUserId, operation: binding.operation, stream: binding.streamId,
    project: binding.projectId, document: binding.documentId, scope: binding.scope,
    sourceHash: binding.sourceHash, request,
  });
  return { ...binding, intentHash, request };
}

function sameSavedScope(saved: RetainedAuthoringPreview, principal: PilotUser, binding: ConsequentialBinding) {
  const original = saved.plan.binding;
  return saved.plan.operation === "document-duplicate" && original.operation === binding.operation
    && original.actorUserId === principal.userId && original.projectId === binding.projectId
    && original.documentId === binding.documentId && original.blockId === "" && original.canvasId === null
    && original.streamId === binding.streamId && canonicalConsent(original.scope) === canonicalConsent(binding.scope);
}

/** Last asynchronous boundary before private disclosure: authority and the exact retained bytes share one snapshot. */
async function currentCopyDisclosure(env: WorkerEnv, principal: PilotUser, binding: ConsequentialBinding,
  previewId: string, retainedContent: string | null, sourceHead: number | null = null) {
  const authority = executionAdmissionGuard(principal, binding, sourceHead);
  const custody = executionContentCustodyGuard(binding, "saved");
  return env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM private_content saved
      WHERE (saved.content_id,saved.owner_id,saved.kind,saved.content) IS (?,?, 'authoring-preview',?)
        AND saved.redacted_at IS NULL AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql}) AS retained
    WHERE ${authority.sql}`)
    .bind(previewId, principal.userId, retainedContent, ...custody.bindings, ...authority.bindings)
    .first<{ retained: number }>();
}

/** A competing explicit Apply may advance only the retained wrapper after our snapshot.
 * Recheck its exact original plan and canonical receipt; disclose no private body here. */
async function currentCopyCommitProgress(env: WorkerEnv, principal: PilotUser, binding: ConsequentialBinding,
  previewId: string, saved: RetainedAuthoringPreview) {
  const authority = executionAdmissionGuard(principal, binding, null);
  const custody = executionContentCustodyGuard(binding, "saved");
  const retained = "CASE WHEN saved.redacted_at IS NULL AND json_valid(saved.content) THEN saved.content ELSE '{}' END";
  return env.DB.prepare(`SELECT 1 AS consistent WHERE EXISTS(
    SELECT 1 FROM private_content saved JOIN authoring_commits receipt ON receipt.preview_id=saved.content_id
    WHERE (saved.content_id,saved.owner_id,saved.kind) IS (?,?, 'authoring-preview')
      AND saved.redacted_at IS NULL AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql}
      AND json_extract(${retained},'$.state')='applied' AND json_extract(${retained},'$.approvalHash')=?
      AND json_extract(${retained},'$.plan')=json(?)
      AND (receipt.actor_user_id,receipt.operation,receipt.project_id,receipt.document_id,receipt.block_id,
        receipt.canvas_id,receipt.organization_id,receipt.project_access_id,receipt.approval_hash,receipt.result_json,receipt.verified)
        IS (?,?,?,?,?,?,?,?,?,json(?),1)) AND ${authority.sql}`)
    .bind(previewId, principal.userId, ...custody.bindings, saved.approvalHash, JSON.stringify(saved.plan),
      principal.userId, binding.operation, binding.projectId, binding.documentId, binding.blockId, binding.canvasId,
      binding.scope?.organizationId ?? null, binding.scope?.projectAccessId ?? null, saved.approvalHash,
      JSON.stringify(saved.plan.result), ...authority.bindings).first<{ consistent: number }>();
}

/** Exact-original Discard adjudicates outcome without annotating a committed receipt. */
async function dismissCopyIfUnapplied(env: WorkerEnv, principal: PilotUser, binding: ConsequentialBinding,
  previewId: string, approvalHash: string, operationId: string) {
  const authority = executionAdmissionGuard(principal, binding, null);
  const custody = executionContentCustodyGuard(binding);
  // An expired but unerased review may be explicitly discarded. No private bytes are returned,
  // and neither its retention deadline nor a live Apply lease is extended or reset.
  const row = await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=?
    AND kind='authoring-preview' AND redacted_at IS NULL AND json_valid(content) AND ${custody.sql} AND ${authority.sql}`)
    .bind(previewId, principal.userId, ...custody.bindings, ...authority.bindings).first<{ content: string }>();
  let retainedContent: string | null = null, retainedPlan: string | null = null;
  if (row) {
    const saved = JSON.parse(row.content) as RetainedAuthoringPreview;
    if (saved.plan?.binding && sameSavedScope(saved, principal, binding) && saved.approvalHash === approvalHash
      && saved.plan.duplication?.operationId === operationId && saved.plan.result.operationId === operationId
      && await consentHash(saved.plan) === approvalHash) {
      retainedContent = row.content; retainedPlan = JSON.stringify(saved.plan);
    }
  }
  const discard = env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','dismissed')
    WHERE content_id=? AND owner_id=? AND kind='authoring-preview' AND content IS ? AND redacted_at IS NULL
      AND json_valid(content) AND json_extract(${privateJson},'$.approvalHash')=?
      AND COALESCE(json_extract(${privateJson},'$.state'),'review') IN('review','dismissed')
      AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?) AND ${custody.sql} AND ${authority.sql}`)
    .bind(previewId, principal.userId, retainedContent, approvalHash, previewId, ...custody.bindings, ...authority.bindings);
  const currentCustody = executionContentCustodyGuard(binding, "saved");
  const currentJson = "CASE WHEN saved.redacted_at IS NULL AND json_valid(saved.content) THEN saved.content ELSE '{}' END";
  // The terminal read shares the discard transaction. A prior winner is returned as its real
  // receipt, while a newly claimed Apply remains applying; absence is never a cancellation receipt.
  const outcome = env.DB.prepare(`SELECT receipt.result_json,receipt.approval_hash,
      CASE WHEN json_extract(${currentJson},'$.plan')=json(?) AND json_extract(${currentJson},'$.approvalHash')=?
        THEN COALESCE(json_extract(${currentJson},'$.state'),'review') ELSE NULL END AS preview_state,
      CASE WHEN saved.content=json_set(?,'$.state','dismissed')
        AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?) THEN 1 ELSE 0 END AS dismissed
    FROM(SELECT ? AS preview_id) requested
    LEFT JOIN private_content saved ON saved.content_id=requested.preview_id AND saved.owner_id=? AND saved.kind='authoring-preview'
      AND saved.redacted_at IS NULL AND json_valid(saved.content) AND ${currentCustody.sql}
    LEFT JOIN authoring_commits receipt ON receipt.preview_id=requested.preview_id AND receipt.actor_user_id=?
      AND receipt.operation=? AND receipt.project_id=? AND receipt.document_id=? AND receipt.block_id=?
      AND receipt.canvas_id IS ? AND receipt.organization_id IS ? AND receipt.project_access_id IS ?
      AND receipt.approval_hash=? AND json_extract(receipt.result_json,'$.operationId')=? AND receipt.verified=1
    WHERE ${authority.sql}`)
    .bind(retainedPlan, approvalHash, retainedContent, previewId, previewId, principal.userId, ...currentCustody.bindings,
      principal.userId, binding.operation, binding.projectId, binding.documentId, binding.blockId, binding.canvasId,
      binding.scope?.organizationId ?? null, binding.scope?.projectAccessId ?? null, approvalHash, operationId, ...authority.bindings);
  const results = await env.DB.batch([discard, outcome]);
  const current = results[1]?.results?.[0] as { result_json: string | null; approval_hash: string | null; preview_state: string | null; dismissed: number } | undefined;
  if (!current) return response({ error: "context_authorization_changed" }, 403);
  if (current.result_json && current.approval_hash === approvalHash)
    return response({ status: "applied", previewId, approvalHash, ...JSON.parse(current.result_json) as AuthoringPlan["result"], idempotent: true });
  if (current.preview_state === "applying" || current.preview_state === "applied")
    return response({ status: "applying", previewId, approvalHash, operationId }, current.preview_state === "applied" ? 503 : 202);
  if (current.preview_state === "dismissed" && current.dismissed === 1)
    return response({ status: "dismissed", previewId, approvalHash, operationId });
  return response({ error: "authoring_preview_unavailable" }, 403);
}

/** A prospective erased operation can be completed explicitly without reconstructing its intent. */
async function erasedCopyOperation(env: WorkerEnv, principal: PilotUser, binding: ConsequentialBinding,
  previewId: string, approvalHash: string, operationId: string) {
  // Already-erased legacy random IDs have no recoverable operation mapping.
  if (previewId !== await documentCopyPreviewId(principal.userId, operationId)) return null;
  const authority = executionAdmissionGuard(principal, binding, null);
  const custody = executionContentCustodyGuard(binding, "saved");
  const current = await env.DB.prepare(`SELECT receipt.result_json,receipt.approval_hash,
      CASE WHEN EXISTS(SELECT 1 FROM private_content saved WHERE saved.content_id=requested.preview_id
        AND saved.owner_id=? AND saved.kind='authoring-preview' AND saved.content=''
        AND saved.redacted_at IS NOT NULL AND julianday(saved.redacted_at)<=julianday('now') AND ${custody.sql})
        AND NOT EXISTS(SELECT 1 FROM authoring_commits any_scope WHERE any_scope.preview_id=requested.preview_id)
      THEN 1 ELSE 0 END AS retired
    FROM(SELECT ? AS preview_id) requested
    LEFT JOIN authoring_commits receipt ON receipt.preview_id=requested.preview_id AND receipt.actor_user_id=?
      AND receipt.operation=? AND receipt.project_id=? AND receipt.document_id=? AND receipt.block_id=?
      AND receipt.canvas_id IS ? AND receipt.organization_id IS ? AND receipt.project_access_id IS ?
      AND json_extract(receipt.result_json,'$.operationId')=? AND receipt.verified=1
    WHERE ${authority.sql}`)
    .bind(principal.userId, ...custody.bindings, previewId, principal.userId, binding.operation, binding.projectId,
      binding.documentId, binding.blockId, binding.canvasId, binding.scope?.organizationId ?? null,
      binding.scope?.projectAccessId ?? null, operationId, ...authority.bindings)
    .first<{ result_json: string | null; approval_hash: string | null; retired: number }>();
  if (!current) return response({ error: "context_authorization_changed" }, 403);
  if (current.result_json && current.approval_hash) {
    if (approvalHash && current.approval_hash !== approvalHash) return response({ error: "authoring_approval_changed" }, 409);
    return response({ status: "applied", previewId, approvalHash: current.approval_hash,
      ...JSON.parse(current.result_json) as AuthoringPlan["result"], idempotent: true });
  }
  if (current.retired !== 1) return null;
  // This is a global operation fence, not an authoring receipt or recovered Document metadata.
  // Scope names the currently authorized request only; no private intent or approval is recreated.
  return response({ status: "retired", previewId, operationId, retirement: {
    version: "document-copy-erased-operation-v1", meaning: "globally-erased-unapplied", scope: "authorized-request",
    projectId: binding.projectId, documentId: binding.documentId, actorUserId: principal.userId,
  } });
}

/** The operation identity outlives its private preview through the existing canonical receipt. */
async function operationPreviewId(env: WorkerEnv, principal: PilotUser, binding: ConsequentialBinding, operationId: string) {
  const guard = executionAdmissionGuard(principal, binding, null);
  const stableId = await documentCopyPreviewId(principal.userId, operationId);
  const found = await env.DB.prepare(`SELECT preview_id FROM(
      SELECT content_id AS preview_id FROM private_content WHERE content_id=? AND owner_id=? AND kind='authoring-preview'
      UNION ALL
      SELECT content_id AS preview_id FROM private_content WHERE owner_id=? AND kind='authoring-preview'
        AND json_extract(${privateJson},'$.plan.operation')='document-duplicate'
        AND json_extract(${privateJson},'$.plan.result.operationId')=?
      UNION ALL
      SELECT preview_id FROM authoring_commits WHERE actor_user_id=? AND operation='document-duplicate'
        AND json_extract(result_json,'$.operationId')=?
    ) WHERE ${guard.sql} LIMIT 1`)
    .bind(stableId, principal.userId, principal.userId, operationId, principal.userId, operationId, ...guard.bindings).first<{ preview_id: string }>();
  return found?.preview_id ?? null;
}

async function latestReceiptId(env: WorkerEnv, principal: PilotUser, binding: ConsequentialBinding) {
  const guard = executionAdmissionGuard(principal, binding, null);
  const found = await env.DB.prepare(`SELECT receipt.preview_id FROM authoring_commits receipt
    WHERE receipt.actor_user_id=? AND receipt.operation='document-duplicate' AND receipt.project_id=? AND receipt.document_id=?
      AND COALESCE(json_extract(receipt.result_json,'$.dismissed'),0)<>1
      AND receipt.block_id='' AND receipt.canvas_id IS NULL AND COALESCE(receipt.organization_id,'')=?
      AND COALESCE(receipt.project_access_id,'')=? AND NOT EXISTS(
        SELECT 1 FROM private_content WHERE content_id=receipt.preview_id AND owner_id=receipt.actor_user_id
          AND json_extract(${privateJson},'$.state')='dismissed') AND ${guard.sql}
    ORDER BY receipt.created_at DESC,receipt.rowid DESC LIMIT 1`)
    .bind(principal.userId, binding.projectId, binding.documentId, binding.scope?.organizationId ?? "",
      binding.scope?.projectAccessId ?? "", ...guard.bindings).first<{ preview_id: string }>();
  return found?.preview_id ?? null;
}

/** SQLite serializes the guarded private insertion, so two preview requests cannot publish two plans for one intent. */
function operationAvailable(principal: PilotUser, operationId: string, stableId: string): BudgetReservationGuard {
  return {
    sql: `NOT EXISTS(SELECT 1 FROM private_content WHERE owner_id=? AND kind='authoring-preview'
      AND (content_id=? OR (json_extract(${privateJson},'$.plan.operation')='document-duplicate'
        AND json_extract(${privateJson},'$.plan.result.operationId')=?)))
      AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE actor_user_id=? AND operation='document-duplicate'
        AND json_extract(result_json,'$.operationId')=?)`,
    bindings: [principal.userId, stableId, operationId, principal.userId, operationId],
  };
}

// Factor complete guards in the same SQL statement. No preflight substitutes for its final proof.
const mergeGuards = (...guards: BudgetReservationGuard[]): BudgetReservationGuard => {
  const join = (first: number, end: number): string => {
    if (end - first === 1) return "(" + guards[first]!.sql + ")";
    const middle = first + Math.floor((end - first) / 2);
    return "(" + join(first, middle) + " AND " + join(middle, end) + ")";
  };
  return { sql: guards.length ? join(0, guards.length) : "1", bindings: guards.flatMap((guard) => guard.bindings) };
};
/** Preserve complete private source bytes and live custody through the final SQL receipt, not just the read. */
async function sourceAdmission(env: WorkerEnv, prepared: Prepared, intent: CopyIntent) {
  const { projection, events, binding } = prepared;
  const owner = binding.scope?.ownerUserId ?? prepared.principal.userId;
  const blocks = projection.libraryBlocks.filter((block) =>
    !block.removed && block.scope === "document" && block.projectId === binding.projectId && block.documentId === binding.documentId);
  const dependencyTypes = new Set(["ProjectCreated", "ProjectOpened", "ProjectRenamed", "ProjectStateChanged",
    "DocumentCreated", "DocumentForked", "DocumentRenamed", "DocumentOpened", "DocumentRemoved", "DocumentRestored",
    "BlockCreated", "BlockRenamed", "BlockPropertyEdited", "BlockWeightSet", "BlockLocked", "BlockUnlocked", "BlockRemoved", "BlockRestored", "BlockRehomed",
    "BlockRelationAdded", "BlockRelationRemoved", "ChipEdited", "ExtractionRequested", "ExtractionCompleted", "ExtractionFailed",
    "ImageFocalPointCalculated", "ReferenceIngested", "RightsAsserted", "CanvasCreated", "CanvasRemoved", "CanvasRestored", ...folderTypes]);
  const dependencies = events.filter((event) => dependencyTypes.has(event.type));
  const rebuilt = foldEvents(dependencies, Infinity, binding.documentId, binding.projectId);
  const rebuiltHash = await consentHash({
    context: await contextSourceHash(binding.projectId, binding.documentId, undefined, rebuilt, dependencies),
    collections: rebuilt.collections, membership: rebuilt.membership,
  });
  if (rebuiltHash !== binding.sourceHash) throw new Error("document_duplicate_source_changed");
  // Hash parity proves that omitted Output ledger/generation bodies are not creative-copy dependencies.
  const ids = new Set(dependencies.map((event) => event.eventId)), resources = new Map<string, { kind: string; id: string }>();
  const addResource = (kind: string, id: string) => { resources.set(kind + ":" + id, { kind, id }); };
  for (const item of projection.documents) addResource("document", item.id);
  for (const block of projection.libraryBlocks) {
    addResource("block", block.id);
    if (block.documentId) addResource("document", block.documentId);
    if (block.canvasId) addResource("canvas", block.canvasId);
    for (const key of ["reference_id", "model_reference_id"] as const) {
      if (typeof block.properties[key] === "string" && block.properties[key]) addResource("reference", block.properties[key]);
    }
  }
  for (const relation of projection.libraryBlockRelations) addResource("relation", relation.id);
  for (const collection of projection.collections) addResource("collection", collection.id);
  const document = projection.documents.find((item) => item.id === binding.documentId && !item.removed);
  if (!document) throw new Error("document_duplicate_source_unavailable");
  document.sourceEvents.forEach((id) => ids.add(id));
  addResource("document", document.id);
  const relevantBlocks = new Set(blocks.map((block) => block.id));
  for (const block of blocks) {
    block.sourceEvents.forEach((id) => ids.add(id)); addResource("block", block.id);
  }
  for (const relation of projection.libraryBlockRelations.filter((item) =>
    !item.removed && (relevantBlocks.has(item.fromBlockId) || relevantBlocks.has(item.toBlockId)))) {
    relation.sourceEvents.forEach((id) => ids.add(id)); addResource("relation", relation.id);
  }
  const folderIds = new Set([
    ...documentDuplicationFolder(projection, projection.membership[document.id]?.collectionId ?? null),
    ...documentDuplicationFolder(projection, intent.collectionId),
  ].map((item) => item.id));
  folderIds.forEach((id) => addResource("collection", id));
  for (const event of events) if (folderTypes.includes(event.type)
    && (folderIds.has(String(event.payload.collection_id ?? event.payload.to_collection_id ?? ""))
      || String(record(event.payload.item_ref).document_id ?? "") === document.id)) ids.add(event.eventId);

  const copiedMediaKeys = new Set<string>();
  let expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const considerRights = (properties: Record<string, unknown>) => {
    const rights = creativeContextRightsValidity(properties);
    if (rights.issue) throw new Error("document_duplicate_source_rights_" + rights.issue);
    if (rights.validUntil && rights.validUntil < expiresAt) expiresAt = rights.validUntil;
  };
  const copiedBlockIds = new Set(blocks.map((block) => block.id));
  const assetBlocks = new Map(blocks.map((block) => [block.id, block]));
  for (const block of assetBlocks.values()) {
    if (!block.properties.reference_composition) continue;
    try {
      await assertDerivedReferenceProvenance({ env, ownerId: owner, properties: block.properties, blockId: block.id,
        sourceEvents: events, projectScope: binding.scope ?? undefined });
    } catch { throw new Error("document_duplicate_source_evidence_unavailable"); }
    const recipe = normalizeReferenceComposition(block.properties.reference_composition);
    if (!recipe) throw new Error("document_duplicate_source_evidence_unavailable");
    for (const retained of recipe.sources) {
      const original = projection.libraryBlocks.find((candidate) => candidate.id === retained.blockId && !candidate.removed);
      if (!original) throw new Error("document_duplicate_source_evidence_unavailable");
      assetBlocks.set(original.id, original);
    }
  }
  for (const block of assetBlocks.values()) {
    considerRights(block.properties);
    const referenceIds = new Set([block.properties.reference_id, block.properties.model_reference_id].filter((value): value is string => typeof value === "string" && Boolean(value)));
    for (const referenceId of referenceIds) {
      const receipts = events.filter((event) => ["ReferenceIngested", "RightsAsserted"].includes(event.type)
        && String(event.payload.reference_id ?? "") === referenceId);
      const latest = receipts.at(-1);
      if (!latest) throw new Error("document_duplicate_source_rights_unavailable");
      const allowed = block.type === "audio" ? audioRightsAllowed(latest.payload.rights_class)
        : ["owned", "owned_or_licensed", "account-generated"].includes(String(latest.payload.rights_class ?? ""));
      if (!allowed) throw new Error("document_duplicate_source_rights_unavailable");
      considerRights(latest.payload);
      receipts.forEach((event) => ids.add(event.eventId)); addResource("reference", referenceId);
    }
    if (block.type === "model3d" && (block.properties.model_url || block.properties.media_url)
      && !await verifyModel3dBlockAssets(env, owner, block.properties, binding.scope?.projectAccessId)) {
      throw new Error("document_duplicate_source_evidence_unavailable");
    }
    for (const [mediaProperty, referenceProperty] of [["media_url", "reference_id"], ["model_url", "model_reference_id"]] as const) {
      const mediaUrl = block.properties[mediaProperty];
      if (!mediaUrl) continue;
      let key = "";
      try { if (typeof mediaUrl === "string" && mediaUrl.startsWith("/api/media/")) key = decodeURIComponent(mediaUrl.slice("/api/media/".length)); } catch { /* rejected below */ }
      if (!key || !mediaKeyMatchesOwnerNamespace(key, owner) || !referenceIds.has(String(block.properties[referenceProperty] ?? ""))) throw new Error("document_duplicate_source_media_unavailable");
      if (block.type === "model3d") {
        const receipt = events.findLast((event) => event.type === "ReferenceIngested"
          && event.payload.reference_id === block.properties[referenceProperty]);
        const hashProperty = mediaProperty === "model_url" ? "model_content_hash" : "source_content_hash";
        if (!receipt || (receipt.payload.source_ref ?? receipt.payload.media_url) !== mediaUrl || receipt.payload.content_hash !== block.properties[hashProperty]) {
          throw new Error("document_duplicate_source_evidence_unavailable");
        }
      }
      const object = typeof env.MEDIA.head === "function" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
      if (!object || object.customMetadata?.ownerId !== owner || !await memoryAuthoredImageMediaAllowed(env,owner,key)) throw new Error("document_duplicate_source_media_unavailable");
      if (block.type === "reference" && !await verifySourceDocumentEvidence(env, owner, mediaUrl, block.properties)) {
        throw new Error("document_duplicate_source_evidence_unavailable");
      }
      addResource("media", key);
      if (copiedBlockIds.has(block.id)) copiedMediaKeys.add(key);
    }
    for (const [key, kind, candidates] of [
      ["source_document_id", "document", projection.documents],
      ["source_block_id", "block", projection.libraryBlocks],
      ["source_output_id", "output", projection.libraryOutputs],
      ["source_artifact_id", "artifact", projection.libraryArtifacts],
    ] as const) {
      const id = block.properties[key];
      if (typeof id === "string" && id) {
        if (!candidates.some((item) => item.id === id && !("removed" in item && item.removed))) {
          throw new Error("document_duplicate_source_provenance_unavailable");
        }
        addResource(kind, id);
      }
    }
  }
  const expected = new Map(events.map((event) => [event.eventId, event])), idsJson = JSON.stringify([...ids]);
  type Row = Record<string, string | number | null>;
  const rows = (await env.DB.prepare(`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.redacted_at
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?))`)
    .bind(binding.streamId, idsJson).all<Row>()).results;
  if (rows.length !== ids.size) throw new Error("document_duplicate_source_unavailable");
  for (const row of rows) {
    if (row.redacted_at !== null || row.private_json !== null && row.owner_id !== owner) throw new Error("document_duplicate_source_retention_changed");
    let payload: unknown;
    try { payload = JSON.parse(String(row.private_json ?? row.payload)); } catch { throw new Error("document_duplicate_source_retention_changed"); }
    if (payload && typeof payload === "object" && "_private_ref" in payload
      || canonicalConsent(payload) !== canonicalConsent(expected.get(String(row.event_id))?.payload)) {
      throw new Error("document_duplicate_source_retention_changed");
    }
  }
  const proofs: BudgetReservationGuard[] = [];
  const expectedRows = rows.map((row) => [
    ...AUTHORING_EVENT_COLUMNS.map((column) => row[column] ?? null), row.owner_id ?? null,
    row.project_id ?? null, row.document_id ?? null, row.private_json ?? null,
  ]);
  // The same complete predicates page source history by value bytes, not by write-batch row count.
  // Repeated legitimate copies must not consume another SQL binding for every 128 historical rows.
  proofs.push(authoringEventRowsProof(expectedRows, true, { byteBoundedOnly: true }));
  const scope = binding.scope, required = JSON.stringify([...resources.values()]);
  let scopedResources: Row[] = [];
  if (scope) {
    const custody = (await env.DB.prepare(`SELECT * FROM project_event_scopes
      WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=?
        AND event_id IN(SELECT value FROM json_each(?))`)
      .bind(scope.projectAccessId, scope.organizationId, scope.projectId, owner, idsJson).all<Row>()).results;
    const visibleIds = new Set([...projection.documents, ...projection.libraryBlocks, ...projection.libraryBlockRelations].flatMap((item) => item.sourceEvents));
    const needed = dependencies.filter((event) => visibleIds.has(event.eventId) || event.payload.project_id === binding.projectId);
    const retained = new Set(custody.map((row) => String(row.event_id)));
    if (needed.some((event) => !retained.has(event.eventId))) throw new Error("document_duplicate_source_custody_changed");
    const custodyRows = custody.map((row) => AUTHORING_SIDECAR_COLUMNS.project_event_scopes.map((column) => row[column] ?? null));
    proofs.push(authoringSidecarProof("project_event_scopes", custodyRows, { byteBoundedOnly: true }));
    scopedResources = (await env.DB.prepare(`SELECT resource.* FROM project_resource_scopes resource JOIN json_each(?) required
      ON(resource.resource_kind,resource.resource_id)=(json_extract(required.value,'$.kind'),json_extract(required.value,'$.id'))
      WHERE(resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.visibility)=(?,?,?,?,'collaborative_output')`)
      .bind(required, scope.projectAccessId, scope.organizationId, scope.projectId, owner).all<Row>()).results;
    if (scopedResources.length !== resources.size) throw new Error("document_duplicate_source_custody_changed");

  } else proofs.push({
    sql: `NOT EXISTS(SELECT 1 FROM json_each(?) required JOIN project_resource_scopes resource
      ON(resource.resource_kind,resource.resource_id)=(json_extract(required.value,'$.kind'),json_extract(required.value,'$.id')) WHERE resource.owner_user_id=?)`,
    bindings: [required, owner],
  });
  const resourceProofs = (rows: readonly Row[]) => {
    const values = rows.map((row) => AUTHORING_SIDECAR_COLUMNS.project_resource_scopes.map((column) => row[column] ?? null));
    return values.length ? [authoringSidecarProof("project_resource_scopes", values, { byteBoundedOnly: true })] : [];
  };
  const guard = mergeGuards(...proofs, ...resourceProofs(scopedResources));
  const current = await env.DB.prepare(`SELECT 1 AS valid WHERE ${guard.sql}`).bind(...guard.bindings).first();
  if (!current) throw new Error("document_duplicate_source_custody_changed");
  const copiedMediaRows = scopedResources.filter((row) => row.resource_kind === "media" && copiedMediaKeys.has(String(row.resource_id)));
  const commitGuard: AuthoringCommitProof = !copiedMediaRows.length ? guard : Object.assign((allocatedEvents: readonly EventRow[]) => {
    const latest = new Map<string, string>();
    for (const event of allocatedEvents) if (event.type === "BlockCreated") {
      const source = blocks.find((block) => block.id === event.payload.copied_from_block_id);
      for (const mediaProperty of ["media_url", "model_url"] as const) {
        const mediaUrl = record(event.payload.properties)[mediaProperty];
        if (typeof mediaUrl !== "string" || !mediaUrl.startsWith("/api/media/")) continue;
        let key = ""; try { key = decodeURIComponent(mediaUrl.slice("/api/media/".length)); } catch { throw new Error("document_duplicate_source_media_unavailable"); }
        if (!copiedMediaKeys.has(key) || source?.properties[mediaProperty] !== mediaUrl) throw new Error("authoring_write_proof_required");
        latest.set(key, event.eventId);
      }
    }
    if (copiedMediaRows.some((row) => !latest.has(String(row.resource_id)))) throw new Error("authoring_write_proof_required");
    const expected = scopedResources.map((row) => row.resource_kind === "media" && latest.has(String(row.resource_id))
      ? { ...row, source_event_id: latest.get(String(row.resource_id))! } : row);
    return mergeGuards(...proofs, ...resourceProofs(expected));
  }, { beforeWrite: mergeGuards(...resourceProofs(copiedMediaRows)) });
  return { guard, commitGuard, expiresAt };
}

/** No provider, purchase, queue, or client event batch is involved in explicit duplication. */
export async function handleDocumentDuplication(request: Request, env: WorkerEnv) {
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = record(await request.json()); } catch { return response({ error: "invalid_request" }, 400); }
  const action = String(body.action ?? "");
  if (!["preview", "revise", "apply", "retrieve", "resume", "dismiss"].includes(action)) return response({ error: "authoring_action_required" }, 400);
  const guardedDismiss = action === "dismiss" && body.onlyIfUnapplied === true;
  const includeRetirement = body.includeRetirement === true;
  if (Object.hasOwn(body, "includeRetirement") && (!includeRetirement || action !== "resume"))
    return response({ error: "document_duplicate_invalid_request" }, 400);
  if (action === "dismiss" && (Object.hasOwn(body, "onlyIfUnapplied") || Object.hasOwn(body, "operationId")) && !guardedDismiss)
    return response({ error: "document_duplicate_invalid_request" }, 400);
  const allowed = action === "preview" || action === "revise"
    ? ["action", "projectId", "documentId", "operationId", "title", "collectionId"]
    : ["action", "projectId", "documentId", "previewId", "approvalHash", ...(action === "resume" ? ["operationId", ...(includeRetirement ? ["includeRetirement"] : [])] : []), ...(guardedDismiss ? ["operationId", "onlyIfUnapplied"] : [])];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return response({ error: "document_duplicate_invalid_request" }, 400);
  const exactOperation = (action === "resume" || action === "revise" || guardedDismiss) && Object.hasOwn(body, "operationId") ? body.operationId : null;
  if (exactOperation !== null && (typeof exactOperation !== "string" || !/^[a-zA-Z0-9_-]{16,120}$/u.test(exactOperation))
    || action === "resume" && Object.hasOwn(body, "operationId") && exactOperation === null || guardedDismiss && exactOperation === null)
    return response({ error: "document_duplicate_intent_required" }, 400);
  if (includeRetirement && typeof exactOperation !== "string") return response({ error: "document_duplicate_intent_required" }, 400);
  if (includeRetirement && (Object.hasOwn(body, "previewId") || Object.hasOwn(body, "approvalHash"))
    && (typeof body.previewId !== "string" || !/^[a-zA-Z0-9_-]{16,120}$/u.test(body.previewId)
      || typeof body.approvalHash !== "string" || !/^[a-f0-9]{64}$/u.test(body.approvalHash)))
    return response({ error: "authoring_approval_required" }, 428);
  const prepared = await prepareCopy(request, env, body, "read");
  if (prepared instanceof Response) return prepared;
  const { principal, binding } = prepared;
  let previewId = typeof body.previewId === "string" ? body.previewId : "";
  let approvalHash = typeof body.approvalHash === "string" ? body.approvalHash : "";
  let requested: { operationId: string; title: string; collectionId?: string | null } | null = null;
  if (action === "preview" || action === "revise") {
    if (typeof body.operationId !== "string" || !/^[a-zA-Z0-9_-]{16,120}$/u.test(body.operationId)
      || body.collectionId !== undefined && body.collectionId !== null
        && (typeof body.collectionId !== "string" || !body.collectionId || body.collectionId.length > 120)) {
      return response({ error: "document_duplicate_intent_required" }, 400);
    }
    let title: string;
    try { title = normalizeDocumentDuplicationTitle(body.title); } catch { return response({ error: "document_duplicate_title_invalid" }, 400); }
    requested = { operationId: body.operationId, title, ...(Object.hasOwn(body, "collectionId") ? { collectionId: body.collectionId as string | null } : {}) };
    previewId = await operationPreviewId(env, principal, binding, requested.operationId) ?? "";
  } else if (action === "resume") {
    const requestedPreviewId = previewId;
    if (typeof exactOperation === "string") {
      previewId = await operationPreviewId(env, principal, binding, exactOperation) ?? "";
      if (includeRetirement && requestedPreviewId && previewId && requestedPreviewId !== previewId)
        return response({ error: "document_duplicate_intent_changed" }, 409);
    } else {
      const latest = await latestAuthoringPreview(env, principal, binding);
      previewId = latest?.previewId ?? await latestReceiptId(env, principal, binding) ?? "";
      approvalHash = latest?.saved.approvalHash ?? "";
    }
    if (!previewId) {
      if (!await executionAuthorityCurrent(env, principal, binding, null)) return response({ error: "context_authorization_changed" }, 403);
      return response({ status: "none" });
    }
  } else if (!previewId || previewId.length > 120 || !/^[a-f0-9]{64}$/u.test(approvalHash)) {
    return response({ error: "authoring_approval_required" }, 428);
  }

  const readExisting = async (id: string) => {
    const state = await readAuthoringState(env, principal, binding, id,
      typeof exactOperation === "string" ? { readOnly: true } : undefined);
    if (!state) return response({ error: "context_authorization_changed" }, 403);
    const { committed, saved } = state;
    if (includeRetirement && typeof exactOperation === "string" && !saved && !committed) {
      const retired = await erasedCopyOperation(env, principal, binding, id, approvalHash, exactOperation);
      if (retired) return retired;
    }
    if (saved && (!sameSavedScope(saved, principal, binding) || await consentHash(saved.plan) !== saved.approvalHash)) {
      return response({ error: "authoring_preview_unavailable" }, 403);
    }
    if (typeof exactOperation === "string" && (committed && committed.result.operationId !== exactOperation
      || saved && (saved.plan.duplication?.operationId !== exactOperation || saved.plan.result.operationId !== exactOperation)))
      return response({ error: "document_duplicate_intent_changed" }, 409);
    if (state.receiptPending) return response({ error: "authoring_receipt_unavailable", status: "applying" }, 503);
    if (action !== "revise" && requested && committed && committed.result.requestHash !== await consentHash(requested)) return response({ error: "document_duplicate_intent_changed", previewId: id }, 409);
    if (action !== "revise" && requested && saved) {
      const copy = saved.plan.duplication;
      if (!copy || copy.operationId !== requested.operationId || copy.title !== requested.title
        || copy.collectionMode !== (Object.hasOwn(requested, "collectionId") ? "explicit" : "source")
        || copy.collectionMode === "explicit" && copy.collectionId !== requested.collectionId) {
        return response({ error: "document_duplicate_intent_changed", previewId: id }, 409);
      }
    }
    if (!approvalHash) approvalHash = saved?.approvalHash ?? committed?.approvalHash ?? "";
    if (committed && committed.approvalHash !== approvalHash || saved && saved.approvalHash !== approvalHash) {
      return response({ error: "authoring_approval_changed" }, 409);
    }
    const disposition = action === "revise" && requested ? {
      reviewDisposition: (committed?.result.requestHash ?? saved?.plan.result.requestHash) === await consentHash(requested)
        ? "requested" as const : "saved-original" as const,
    } : {};
    if (committed && action !== "dismiss") {
      const disclosure = await currentCopyDisclosure(env, principal, binding, id, state.retainedContent);
      if (!disclosure) return response({ error: "context_authorization_changed" }, 403);
      return response({ status: "applied", previewId: id, approvalHash, ...committed.result, idempotent: true, ...disposition,
        ...(saved && disclosure.retained === 1 ? { preview: authoringPreview(id, approvalHash, saved.plan) } : {}) });
    }
    if (guardedDismiss && typeof exactOperation === "string") return dismissCopyIfUnapplied(env, principal, binding, id, approvalHash, exactOperation);
    if (action === "dismiss") return await dismissAuthoringPreview(env, principal, binding, id, approvalHash)
      ? response({ status: "dismissed" }) : response({ error: "authoring_save_in_progress", status: "applying" }, 409);
    if (!saved) return response({ error: "authoring_preview_unavailable" }, 403);
    if (saved.state === "dismissed") return response({ error: "authoring_preview_dismissed", status: "not-applied" }, 409);
    const copy = saved.plan.duplication;
    if (!copy) return response({ error: "authoring_preview_unavailable" }, 403);
    const canAuthor = binding.scope ? hasCapability(principal, "project.author", binding.scope) : principal.access.capabilities.includes("project.author");
    const stale = !canAuthor || saved.plan.binding.sourceHash !== binding.sourceHash
      || saved.plan.binding.permissionEpoch !== binding.permissionEpoch || saved.plan.binding.contextSessionId !== binding.contextSessionId
      || saved.plan.expiresAt <= new Date().toISOString()
      || !prepared.projection.documents.some((item) => item.id === binding.documentId && !item.removed);
    if (action !== "apply" || saved.state === "applying") {
      const disclosure = await currentCopyDisclosure(env, principal, binding, id, state.retainedContent);
      if (!disclosure) return response({ error: "context_authorization_changed" }, 403);
      if (disclosure.retained !== 1) {
        if (saved.state === "applying" && await currentCopyCommitProgress(env, principal, binding, id, saved))
          return response({ status: "applying", previewId: id, approvalHash, operationId: copy.operationId, ...disposition }, 202);
        return response({ error: "authoring_preview_unavailable" }, 403);
      }
      return response({ status: state.status, preview: authoringPreview(id, approvalHash, saved.plan), stale, ...disposition },
        action === "apply" && state.status === "applying" ? 202 : 200);
    }
    const author = await prepareCopy(request, env, body, "author");
    if (author instanceof Response) return author;
    const intent: CopyIntent = { operationId: copy.operationId, title: copy.title, collectionId: copy.collectionId, collectionMode: copy.collectionMode };
    const current = await bindIntent(author.binding, intent);
    try {
      if (saved.plan.binding.sourceHash !== current.sourceHash || saved.plan.expiresAt <= new Date().toISOString()) throw new Error("authoring_preview_stale");
      const checked = prepareOutputRequirementClientEvents(saved.plan.events, outputAuthoringBlocksFromEvents(author.events));
      if (!checked.ok) return response({ error: checked.error, message: checked.message, status: "not-applied", ...(checked.blockId ? { blockId: checked.blockId } : {}) }, checked.status);
      if (JSON.stringify(preserveMemoryAuthoredCopies(checked.events,author.projection.libraryBlocks,author.events)) !== JSON.stringify(saved.plan.events)) throw new Error("authoring_preview_stale");
      const source = await sourceAdmission(env, author, intent);
      const result = await commitAuthoringPlan(env, author.principal, current, author.shared, id, approvalHash, saved.plan, author.sourceHead, source.commitGuard);
      if (!await executionAuthorityCurrent(env, author.principal, current, null)) return response({ error: "authoring_result_read_unavailable", previewId: id }, 403);
      return response({ status: "applied", previewId: id, approvalHash, ...result });
    } catch (error) {
      const outcome = await readAuthoringState(env, principal, binding, id);
      if (!outcome) return response({ error: "context_authorization_changed" }, 403);
      if (outcome.committed) return outcome.committed.approvalHash === approvalHash
        ? response({ status: "applied", previewId: id, approvalHash, ...outcome.committed.result, idempotent: true })
        : response({ error: "authoring_approval_changed" }, 409);
      if (outcome.status === "applying") return response({ status: "applying", previewId: id }, outcome.receiptPending ? 503 : 202);
      const code = error instanceof Error && /^(?:authoring_|context_|project_|document_duplicate_|stale_sequence)/u.test(error.message) ? error.message : "authoring_not_applied";
      return response({ error: code, status: "not-applied", previewId: id }, 409);
    }
  };
  if (previewId) return readExisting(previewId);
  if (!requested) return response({ error: "authoring_preview_unavailable" }, 403);

  const author = await prepareCopy(request, env, body, "author");
  if (author instanceof Response) return author;
  try {
    const planned = buildDocumentDuplicationPlan({
      projection: author.projection, sourceDocumentId: author.binding.documentId, title: requested.title,
      sourceStreamId: author.binding.streamId, sourceSequence: author.sourceHead,
      ...(Object.hasOwn(requested, "collectionId") ? { collectionId: requested.collectionId } : {}),
    });
    const checked = prepareOutputRequirementClientEvents(planned.events, outputAuthoringBlocksFromEvents(author.events));
    if (!checked.ok) return response({ error: checked.error, message: checked.message, status: "not-applied", ...(checked.blockId ? { blockId: checked.blockId } : {}) }, checked.status);
    planned.events = preserveMemoryAuthoredCopies(checked.events,author.projection.libraryBlocks,author.events);
    const intent: CopyIntent = { operationId: requested.operationId, title: planned.title, collectionId: planned.collectionId,
      collectionMode: Object.hasOwn(requested, "collectionId") ? "explicit" : "source" };
    const current = await bindIntent(author.binding, intent);
    const source = await sourceAdmission(env, author, intent);
    const created = planned.events.filter((event) => event.type === "BlockCreated");
    const plan: AuthoringPlan = {
      operation: "document-duplicate", binding: current, sourceHead: author.sourceHead, events: planned.events,
      changes: created.map((event) => ({ kind: "copy", type: String(event.payload.type),
        label: String(record(event.payload.properties).label ?? event.payload.handle ?? event.payload.type),
        text: String(record(event.payload.properties).text ?? ""), sourceId: String(event.payload.copied_from_block_id),
        targetId: String(event.payload.block_id) })),
      duplication: { ...intent, collectionPath: documentDuplicationFolder(author.projection, planned.collectionId).map((item) => item.handle),
        sourceTitle: author.projection.documents.find((item) => item.id === current.documentId)!.title,
        copyMode: "independent-snapshot", excluded: ["outputs", "approvals", "generation-jobs", "review-assignments"] },
      result: { documentId: planned.documentId, operationId: requested.operationId, requestHash: await consentHash(requested), blockIds: created.map((event) => String(event.payload.block_id)), relationCount: planned.relationCount },
      expiresAt: source.expiresAt,
    };
    const stableId = await documentCopyPreviewId(principal.userId, requested.operationId);
    const guard = mergeGuards(executionAdmissionGuard(author.principal, current, author.sourceHead), source.guard, operationAvailable(principal, requested.operationId, stableId));
    const preview = await storeAuthoringPreview(env, author.principal, plan, guard);
    const retainedContent = JSON.stringify({ plan, approvalHash: preview.approvalHash, state: "review" });
    const disclosure = await currentCopyDisclosure(env, author.principal, current, preview.previewId, retainedContent, author.sourceHead);
    if (!disclosure) return response({ error: "context_authorization_changed" }, 403);
    if (disclosure.retained !== 1) return response({ error: "authoring_preview_unavailable" }, 403);
    return response({ status: "not-applied", preview, ...(action === "revise" ? { reviewDisposition: "requested" } : {}) });
  } catch (error) {
    // The competing insert may have won, or its successful response may have been lost.
    const existing = await operationPreviewId(env, principal, binding, requested.operationId);
    if (existing) return readExisting(existing);
    const code = error instanceof Error && error.message.startsWith("Published organization context")
      ? "document_duplicate_governed_context"
      : error instanceof Error && /^(?:document_duplicate_|context_|project_)/u.test(error.message) ? error.message : "document_duplicate_unavailable";
    return response({ error: code, status: "not-applied" }, 409);
  }
}
