import type { AuthoringPreview } from "../../worker/authoring-commits.ts";
import type { CreativeProjection } from "./events.ts";
import { normalizeDocumentDuplicationTitle } from "./document-duplication.ts";

export type DocumentCopyTarget = { projectId: string; documentId: string };
export type DocumentCopyDetails = { title: string; collectionId?: string | null };
export type DocumentCopyIntent = DocumentCopyTarget & DocumentCopyDetails & { operationId: string };
export type DocumentCopyAction = "preview" | "revise" | "apply" | "retrieve" | "resume" | "dismiss";
export type DocumentCopyRetirement = Readonly<{
  version: "document-copy-erased-operation-v1";
  meaning: "globally-erased-unapplied";
  /** This identifies the current authorized request, not lost historical Document metadata. */
  scope: "authorized-request";
  projectId: string;
  documentId: string;
  actorUserId: string;
}>;
export type DocumentCopyPhase = "draft" | "editing" | "recovering" | "previewing" | "review" | "applying" | "uncertain" | "applied" | "unavailable" | "retired" | "dismissed";
export type DocumentCopyReview = {
  target: DocumentCopyTarget;
  scopeKey: string;
  authorityKey: string;
  sourceTitle: string;
  sourceRevision: string;
  phase: DocumentCopyPhase;
  busy: boolean;
  request: number;
  /** Exact safe recovery identity survives erasure of private intent text. */
  operationId?: string;
  intent: DocumentCopyIntent | null;
  /** A deliberate revised draft never replaces the operation or an existing saved plan. */
  revisedIntent?: DocumentCopyIntent | null;
  /** Unsubmitted field text stays raw until explicit free request normalization. */
  revisionDraft?: DocumentCopyDetails | null;
  revisedRequestSubmitted?: boolean;
  reviewDisposition?: "requested" | "saved-original" | "recovered";
  retirement?: DocumentCopyRetirement | null;
  /** May ask the exact server adjudicator; never proof that an operation is unused or cancelled. */
  guardedDismissAvailable?: boolean;
  preview: AuthoringPreview | null;
  previewId: string;
  approvalHash: string;
  receipt: { documentId: string; operationId: string } | null;
  destinationDocumentId: string;
  stale: boolean;
  issue: string;
};
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9:_-]{0,119}$/iu.test(value);
const operation = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9_-]{16,120}$/iu.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const count = (value: unknown, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
export const documentCopyKey = (target: DocumentCopyTarget) => JSON.stringify([target.projectId, target.documentId]);
export const documentCopyTargetValid = (target: DocumentCopyTarget) => identifier(target.projectId) && identifier(target.documentId);

/** A retry retains the original title and the distinction between an inherited folder and explicit root. */
export function documentCopyIntent(target: DocumentCopyTarget, details: DocumentCopyDetails, operationId: string): DocumentCopyIntent {
  if (!documentCopyTargetValid(target) || !operation(operationId)) throw new Error("document_copy_invalid_target");
  const title = normalizeDocumentDuplicationTitle(details.title);
  if (Object.hasOwn(details, "collectionId") && details.collectionId !== null && !identifier(details.collectionId))
    throw new Error("document_copy_invalid_folder");
  return Object.freeze({ ...target, operationId, title,
    ...(Object.hasOwn(details, "collectionId") ? { collectionId: details.collectionId } : {}) });
}

/** Local invalidation only. The server independently checks complete source, rights and custody at commit. */
export function documentCopySourceRevision(projection: CreativeProjection, target: DocumentCopyTarget): string {
  const source = projection.documents.find((item) => item.id === target.documentId && item.projectId === target.projectId);
  const blocks = projection.libraryBlocks.filter((item) => item.documentId === target.documentId && item.projectId === target.projectId);
  const ids = new Set(blocks.map((item) => item.id));
  return JSON.stringify({
    source, blocks: [...blocks].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    relations: projection.libraryBlockRelations.filter((item) => item.documentId === target.documentId ||
      ids.has(item.fromBlockId) || ids.has(item.toBlockId)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    collections: projection.collections, membership: projection.membership,
  });
}

/** Only server review/receipt identities travel on confirmation. No event list or caller-generated destination. */
export function documentCopyRequest(state: DocumentCopyReview, action: DocumentCopyAction, options: { includeRetirement?: boolean } = {}) {
  if (options.includeRetirement && action !== "resume") throw new Error("document_copy_invalid_target");
  if (action === "preview" || action === "revise") {
    const intent = action === "revise" ? state.revisedIntent : state.intent;
    if (!intent || action === "revise" && (!state.revisedRequestSubmitted || intent.operationId !== state.operationId))
      throw new Error("document_copy_intent_missing");
    return { action, ...intent };
  }
  if (action === "resume") {
    if (state.operationId && !operation(state.operationId)) throw new Error("document_copy_invalid_target");
    if (options.includeRetirement) {
      if (!operation(state.operationId)) throw new Error("document_copy_invalid_target");
      // A prior op-only certificate can supply an ID without recreating its erased hash.
      const known = Boolean(state.approvalHash);
      if (state.previewId && !identifier(state.previewId) || known && (!identifier(state.previewId) || !hash(state.approvalHash))) throw new Error("document_copy_receipt_missing");
      return { action, ...state.target, operationId: state.operationId, includeRetirement: true,
        ...(known ? { previewId: state.previewId, approvalHash: state.approvalHash } : {}) };
    }
    return { action, ...state.target, ...(state.operationId ? { operationId: state.operationId } : {}) };
  }
  if (!identifier(state.previewId) || !hash(state.approvalHash)) throw new Error("document_copy_receipt_missing");
  if (action === "dismiss" && !state.receipt) {
    if (!operation(state.operationId)) throw new Error("document_copy_receipt_missing");
    return { action, ...state.target, previewId: state.previewId, approvalHash: state.approvalHash,
      operationId: state.operationId, onlyIfUnapplied: true };
  }
  return { action, ...state.target, previewId: state.previewId, approvalHash: state.approvalHash };
}

export function documentCopyDestination(preview: AuthoringPreview): string {
  const created = preview.events[0];
  return created?.type === "DocumentCreated" && typeof created.payload?.document_id === "string" ? created.payload.document_id : "";
}

function readPreview(value: unknown, state: DocumentCopyReview): AuthoringPreview {
  if (!record(value) || !identifier(value.previewId) || !hash(value.approvalHash) || !hash(value.sourceHash) ||
    value.projectId !== state.target.projectId || value.documentId !== state.target.documentId ||
    value.canvasId !== null || value.blockId !== "" || !Array.isArray(value.events) ||
    !value.events.length || value.events.length > 512 || !Array.isArray(value.changes) ||
    !count(value.blockCount, 100) || !count(value.relationCount, 511) ||
    typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) ||
    !record(value.duplication)) throw new Error("document_copy_invalid_response");
  const copy = value.duplication;
  if (!operation(copy.operationId) || copy.copyMode !== "independent-snapshot" ||
    (copy.collectionMode !== "source" && copy.collectionMode !== "explicit") ||
    copy.collectionId !== null && !identifier(copy.collectionId) ||
    !Array.isArray(copy.collectionPath) || copy.collectionPath.some((part) => typeof part !== "string") ||
    typeof copy.sourceTitle !== "string" || typeof copy.title !== "string" ||
    normalizeDocumentDuplicationTitle(copy.title) !== copy.title ||
    JSON.stringify(copy.excluded) !== JSON.stringify(["outputs", "approvals", "generation-jobs", "review-assignments"]))
    throw new Error("document_copy_invalid_response");
  const preview = value as unknown as AuthoringPreview;
  const destination = documentCopyDestination(preview), allowed = new Set([
    "DocumentCreated", "BlockCreated", "BlockPropertyEdited", "BlockRelationAdded", "BlockLocked", "CollectionItemAdded",
  ]);
  const created = preview.events[0];
  if (!identifier(destination) || destination === state.target.documentId ||
    created.payload.title !== copy.title || created.payload.source_document_id !== state.target.documentId ||
    preview.events.some((event, index) => !record(event) || !allowed.has(event.type) || !record(event.payload) ||
      event.payload.project_id !== state.target.projectId || index > 0 && event.type === "DocumentCreated" ||
      event.type !== "CollectionItemAdded" && event.payload.document_id !== destination) ||
    preview.events.filter((event) => event.type === "BlockCreated").length !== preview.blockCount ||
    preview.events.filter((event) => event.type === "BlockRelationAdded").length !== preview.relationCount ||
    preview.changes.length !== preview.blockCount ||
    preview.changes.some((change) => !record(change) || change.kind !== "copy" ||
      typeof change.label !== "string" || typeof change.text !== "string" || typeof change.type !== "string"))
    throw new Error("document_copy_invalid_response");
  const folders = preview.events.filter((event) => event.type === "CollectionItemAdded");
  if (copy.collectionId === null ? folders.length !== 0 || copy.collectionPath.length !== 0 :
    folders.length !== 1 || folders[0].payload.collection_id !== copy.collectionId ||
    !record(folders[0].payload.item_ref) || folders[0].payload.item_ref.document_id !== destination)
    throw new Error("document_copy_identity_changed");
  if (state.previewId && (state.previewId !== preview.previewId || state.approvalHash !== preview.approvalHash))
    throw new Error("document_copy_identity_changed");
  if (state.operationId && state.operationId !== copy.operationId) throw new Error("document_copy_identity_changed");
  if (state.intent && (state.intent.operationId !== copy.operationId || state.intent.title !== copy.title ||
    copy.collectionMode !== (Object.hasOwn(state.intent, "collectionId") ? "explicit" : "source") ||
    copy.collectionMode === "explicit" && state.intent.collectionId !== copy.collectionId))
    throw new Error("document_copy_identity_changed");
  return preview;
}

/** A lost or malformed response can never silently become a replacement intent or an applied receipt. */
export function documentCopyOutcome(
  state: DocumentCopyReview, action: DocumentCopyAction, body: unknown, ok: boolean,
  options: { retirementActorUserId?: string } = {},
): DocumentCopyReview {
  if (!record(body)) throw new Error("document_copy_invalid_response");
  if (body.status === "retired") {
    const proof = body.retirement;
    if (!ok || action !== "resume" || !options.retirementActorUserId || state.receipt ||
      !operation(state.operationId) || body.operationId !== state.operationId ||
      typeof body.previewId !== "string" || !/^copy-preview-[a-f0-9]{64}$/u.test(body.previewId) ||
      state.previewId && state.previewId !== body.previewId ||
      Object.keys(body).some(key => !["status", "previewId", "operationId", "retirement"].includes(key)) ||
      !record(proof) || proof.version !== "document-copy-erased-operation-v1" ||
      proof.meaning !== "globally-erased-unapplied" || proof.scope !== "authorized-request" ||
      proof.projectId !== state.target.projectId || proof.documentId !== state.target.documentId ||
      proof.actorUserId !== options.retirementActorUserId ||
      Object.keys(proof).some(key => !["version", "meaning", "scope", "projectId", "documentId", "actorUserId"].includes(key)))
      throw new Error("document_copy_identity_changed");
    const retirement: DocumentCopyRetirement = Object.freeze({
      version: "document-copy-erased-operation-v1", meaning: "globally-erased-unapplied", scope: "authorized-request",
      projectId: state.target.projectId, documentId: state.target.documentId, actorUserId: options.retirementActorUserId,
    });
    // A verified terminal read is not an authoring receipt and reconstructs no private intent or hash.
    return { ...state, phase: "retired", busy: false, retirement, previewId: body.previewId,
      intent: null, revisedIntent: null, revisionDraft: null, reviewDisposition: undefined, preview: null,
      sourceTitle: "", sourceRevision: "", destinationDocumentId: "", stale: false, issue: "" };
  }
  if (ok && body.status === "none" && action === "resume" && (!state.intent || state.revisedRequestSubmitted) && !state.previewId)
    // Absence can race an already dispatched preview; never replace its sole identity.
    return state.operationId ? { ...state, phase: "unavailable", busy: false, stale: true, issue: "document_copy_unavailable" }
      : { ...state, phase: "draft", busy: false, stale: false, issue: "" };
  if (ok && body.status === "dismissed" && action === "dismiss") {
    if (!state.receipt && (body.operationId !== state.operationId || body.previewId !== state.previewId ||
      body.approvalHash !== state.approvalHash || Object.keys(body).some(key => !["status", "operationId", "previewId", "approvalHash"].includes(key))))
      throw new Error("document_copy_identity_changed");
    return { ...state, phase: "dismissed", busy: false, issue: "", preview: null };
  }
  if (state.receipt && ok && body.status !== "applied") throw new Error("document_copy_identity_changed");
  const revisedReply = state.revisedRequestSubmitted && (action === "revise" || action === "resume");
  if (revisedReply && !operation(state.operationId)) throw new Error("document_copy_identity_changed");
  if (action === "revise" && (ok || body.preview !== undefined) && (!state.revisedRequestSubmitted || !state.revisedIntent ||
    body.reviewDisposition !== "requested" && body.reviewDisposition !== "saved-original")) throw new Error("document_copy_invalid_response");
  // Only the explicit revise protocol / exact original-operation read may show
  // an earlier canonical winner. Ordinary preview identity validation is unchanged.
  const validation = revisedReply ? { ...state, intent: action === "revise" && body.reviewDisposition === "requested" ? state.revisedIntent ?? null : null } : state;
  const preview = body.preview === undefined ? (body.status === "applied" && ["retrieve", "resume"].includes(action) ? null : state.preview) : readPreview(body.preview, validation);
  const copy = preview?.duplication;
  const candidate = state.revisedIntent;
  const reviewDisposition = action === "revise" && ok ? body.reviewDisposition as "requested" | "saved-original" : revisedReply && copy ? candidate
    ? copy.title === candidate.title && copy.collectionMode === (Object.hasOwn(candidate, "collectionId") ? "explicit" : "source") &&
      (copy.collectionMode !== "explicit" || copy.collectionId === candidate.collectionId) ? "requested" : "saved-original"
    : "recovered" : state.reviewDisposition;
  const intent = copy ? documentCopyIntent(state.target, { title: copy.title,
    ...(copy.collectionMode === "explicit" ? { collectionId: copy.collectionId } : {}) }, copy.operationId) : state.intent;
  const next = { ...state, preview, intent, reviewDisposition, operationId: copy?.operationId ?? state.operationId ?? state.intent?.operationId ?? "", sourceTitle: copy?.sourceTitle ?? state.sourceTitle,
    previewId: preview?.previewId ?? state.previewId, approvalHash: preview?.approvalHash ?? state.approvalHash,
    destinationDocumentId: preview ? documentCopyDestination(preview) : state.destinationDocumentId, busy: false };
  if (ok && body.status === "applied") {
    const previewId = body.previewId, approvalHash = body.approvalHash;
    if (!identifier(previewId) || !hash(approvalHash) || !identifier(body.documentId) ||
      body.documentId === state.target.documentId || !operation(body.operationId) ||
      next.previewId && (next.previewId !== previewId || next.approvalHash !== approvalHash) ||
      next.operationId && next.operationId !== body.operationId ||
      intent && intent.operationId !== body.operationId ||
      next.destinationDocumentId && next.destinationDocumentId !== body.documentId ||
      state.receipt && (state.receipt.documentId !== body.documentId || state.receipt.operationId !== body.operationId))
      throw new Error("document_copy_identity_changed");
    return { ...next, operationId: body.operationId, previewId, approvalHash, phase: "applied", receipt: {
      documentId: body.documentId, operationId: body.operationId }, destinationDocumentId: body.documentId,
      sourceRevision: preview ? next.sourceRevision : "", stale: false, issue: "" };
  }
  if (body.status === "applying")
    return { ...next, phase: "applying", issue: "" };
  if (ok && body.status === "not-applied" && preview)
    return { ...next, phase: "review", stale: body.stale === true, issue: body.stale ? "document_copy_stale" : "" };
  if (!ok && body.status === "not-applied")
    return { ...next, phase: preview ? "review" : "unavailable", stale: true,
      issue: typeof body.error === "string" ? body.error : "document_copy_unavailable" };
  if (!ok) return { ...next, phase: state.phase === "applying" || state.receipt ? "uncertain" : "unavailable",
    stale: true, issue: typeof body.error === "string" ? body.error : "document_copy_unavailable" };
  throw new Error("document_copy_invalid_response");
}

export function documentCopyIssueMessage(state: Pick<DocumentCopyReview, "issue" | "stale">): string {
  if (state.issue === "document_copy_capacity") return "document.copy.capacity";
  if (/title_invalid|invalid_folder|invalid_target/u.test(state.issue)) return "document.copy.invalid";
  if (/too_large/u.test(state.issue)) return "document.copy.tooLarge";
  if (/governed_context/u.test(state.issue)) return "document.copy.governed";
  if (/rights|retention|custody|evidence/u.test(state.issue)) return "document.copy.rights";
  if (state.issue === "document_copy_refresh_failed") return "document.copy.refresh";
  if (state.stale) return "document.copy.stale";
  if (state.issue === "document_copy_uncertain") return "document.copy.uncertain";
  return "document.copy.unavailable";
}
