import { foldEvents } from "../model/events.ts";
import { foldCanvasEvents } from "../canvas/model.ts";
import {
  acceptOutcomeArrangementPreview, outcomeArrangementRevisions, prepareOutcomeArrangement,
  previewOutcomeArrangement, previewOutcomeArrangementUndo,
  type OutcomeArrangementContext, type OutcomeArrangementDraft, type OutcomeArrangementIssue,
  type OutcomeArrangementPreview, type OutcomeArrangementPreviewRequest, type OutcomeArrangementReview,
} from "../canvas/outcome-arrangements.ts";
import type { OutcomeRecipeId } from "../model/outcome-recipes.ts";
import type { FormaStore } from "./store.ts";
import { canvasIdFromRoute } from "../canvas/routes.ts";

export const OUTCOME_ARRANGEMENT_ENDPOINT = "/api/canvas/arrangements";
export type OutcomeArrangementIdentity = Pick<OutcomeArrangementPreviewRequest, "operationId" | "projectId" | "canvasId">;
export type OutcomeArrangementScope = Omit<OutcomeArrangementIdentity, "operationId"> & { authorityKey: string; actorId: string };
export type OutcomeArrangementHttp = { ok: boolean; status: number; body: Record<string, unknown> };
export type OutcomeArrangementDisposition = Readonly<OutcomeArrangementIdentity & { previewId: string; approvalHash: string }>;
type RecoveryOwnership = { current: () => boolean; dispose: () => void };
export type OutcomeArrangementCommand = OutcomeArrangementIdentity & {
  action: "preview" | "undo-preview" | "apply" | "retrieve" | "dismiss";
  [key: string]: unknown;
};
type Status = "idle" | "requesting" | "review" | "applying" | "uncertain" | "applied" | "dismissed" | "not-applied" | "unavailable";
export type OutcomeArrangementState = {
  identity: OutcomeArrangementIdentity | null; status: Status; preview: OutcomeArrangementPreview | null;
  issue: OutcomeArrangementIssue | null; submitted: boolean; busy: boolean;
};
export type OutcomeArrangementPorts = {
  scope: () => OutcomeArrangementScope | null;
  /** Includes current authority/selection/events/online state; only used for invalidation, not stored proof. */
  stamp: () => string;
  context: () => Promise<OutcomeArrangementContext | null>;
  post: (command: OutcomeArrangementCommand, controls?: { current?: () => boolean; onDispatch?: () => void; onNotDispatchedAtConfirmation?: () => void }) => Promise<OutcomeArrangementHttp>;
  remember: (identity: OutcomeArrangementIdentity) => void;
  refresh: () => Promise<unknown>;
  changed: () => void;
  operationId: () => string;
  /** Reloads keep the existing URL handle unresolved until an explicit retrieval. */
  recoveryIdentity?: () => OutcomeArrangementIdentity | null;
  /** Optional host capability: never infer current opening/source ownership from a receipt. */
  captureRecoveryOwnership?: (invalidated: () => void) => RecoveryOwnership | null;
  /** Original source/actor/route witness; ordinary source refresh is not retirement. */
  captureRefusalOwnership?: (invalidated: () => void) => RecoveryOwnership | null;
  now: () => number;
};
const sameScope = (left: OutcomeArrangementScope | null, right: OutcomeArrangementScope | null) =>
  Boolean(left && right && left.authorityKey === right.authorityKey && left.actorId === right.actorId
    && left.projectId === right.projectId && left.canvasId === right.canvasId);
const identityMatches = (left: OutcomeArrangementIdentity, right: Record<string, unknown>) =>
  right.operationId === left.operationId && right.projectId === left.projectId && right.canvasId === left.canvasId;
const safeOperation = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/u.test(value);

/** URL contains an opaque recovery handle only, never a copied plan, preview or private source. */
export function outcomeArrangementOperationFromRoute(route: string): string {
  if (!canvasIdFromRoute(route)) return "";
  try { const id = new URL(route, "https://canvas.local").searchParams.get("arrangement"); return safeOperation(id) ? id : ""; } catch { return ""; }
}
export function withOutcomeArrangementOperation(route: string, operationId: string): string {
  if (!canvasIdFromRoute(route) || !safeOperation(operationId)) return route;
  const url = new URL(route, "https://canvas.local");
  url.searchParams.set("arrangement", operationId);
  return url.pathname + url.search + url.hash;
}

/** Current canonical projection only. Pending generic writes cannot join an atomic confirmation. */
export async function currentOutcomeArrangementContext(
  store: FormaStore, selectedItemIds: readonly string[], siteId: string, queueClear: boolean,
): Promise<OutcomeArrangementContext | null> {
  const authorization = store.captureAuthorizationScope(), session = store.session.get();
  const projectId = store.projection.get().projectId, canvasId = canvasIdFromRoute(store.route.get());
  const permissions = session?.projectContext?.permissions ?? session?.capabilities ?? [];
  const events = store.events.get(), selected = [...selectedItemIds];
  if (!authorization || !session || !projectId || !canvasId || !permissions.includes("project.read")
    || !permissions.includes("project.canvas.use") || store.asOf.get() !== Number.POSITIVE_INFINITY
    || session.projectContext && session.projectContext.projectId !== projectId) return null;
  const canvas = foldCanvasEvents(events, projectId, canvasId);
  const revisions = await outcomeArrangementRevisions(foldEvents(events, Number.POSITIVE_INFINITY, "", projectId), canvas, selected);
  if (!revisions.ok || !store.authorizationScopeActive(authorization) || store.events.get() !== events
    || canvasIdFromRoute(store.route.get()) !== canvasId || store.projection.get().projectId !== projectId) return null;
  return { canvas, authorityKey: authorization.key, actorId: session.user.userId, siteId,
    canRead: true, canArrange: permissions.includes("project.author")
      && (!session.projectContext || ["owner", "editor"].includes(session.projectContext.role)),
    atomicTransportAvailable: queueClear && navigator.onLine && !store.optimisticEvents.get().length,
    selectedItemIds: selected, events, ...revisions.value };
}


type Continuation = { readonly version: number; readonly scope: OutcomeArrangementScope | null; readonly current?: () => boolean };
type PreviewCheck = { readonly owner: Continuation; readonly preview: OutcomeArrangementPreview; readonly stamp: string };
type RefusedPreparation = {
  readonly owner: Continuation; readonly request: OutcomeArrangementPreviewRequest; readonly ownership: RecoveryOwnership;
  readonly corrective: boolean;
  notDispatchedAtConfirmation: boolean;
};
type ReceiptFingerprint = OutcomeArrangementIdentity & {
  readonly actorId: string; readonly previewId: string; readonly approvalHash: string; readonly arrangementId: string;
  readonly itemCount: number; readonly digest: string;
};
type DispositionTerms = {
  readonly identity: OutcomeArrangementIdentity; readonly actorId: string;
  value: OutcomeArrangementDisposition | null; readonly receipt: ReceiptFingerprint | null;
  requested: boolean;
};
type ActiveDisposition = DispositionTerms & {
  owner: Continuation; readonly stamp: string; readonly ownership: RecoveryOwnership;
  phase: "reading" | "ready" | "sending";
  preparation?: OutcomeArrangementPreviewRequest;
};
/** Retired data is an opaque original tuple, never a read capability or receipt. */
type ExpiredDisposition = ActiveDisposition | (DispositionTerms & { phase: "retained" });
const sameActorBoard = (left: OutcomeArrangementScope | null, right: OutcomeArrangementScope | null) =>
  Boolean(left && right && left.actorId === right.actorId && left.projectId === right.projectId && left.canvasId === right.canvasId);
/** Compare all retained server terms, not just an opaque ID or a display name. */
const receiptTerms = (preview: OutcomeArrangementPreview) => JSON.stringify([
  preview.operationId, preview.projectId, preview.canvasId, preview.recipeId, preview.name,
  preview.selectedItemIds, preview.expectedLayoutRevision, preview.expectedSourceRevision, preview.undoOperationId ?? null,
  preview.before.map(frame => [frame.itemId, frame.x, frame.y, frame.w, frame.h]),
  preview.after.map(frame => [frame.itemId, frame.x, frame.y, frame.w, frame.h]),
  preview.previewId, preview.approvalHash, preview.arrangementId, preview.expiresAt,
  preview.maximumEvents, preview.providerCalls, preview.maximumMicrousd, preview.changesSemantics,
]);
/** A transient identity digest, never visible private content or current Apply authority. */
const receiptDigest = async (preview: OutcomeArrangementPreview) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(receiptTerms(preview)))),
  byte => byte.toString(16).padStart(2, "0"),
).join("");
const contextMatches = (current: OutcomeArrangementContext, scope: OutcomeArrangementScope | null) => Boolean(scope
  && current.authorityKey === scope.authorityKey && current.actorId === scope.actorId
  && current.canvas.projectId === scope.projectId && current.canvas.selectedCanvasId === scope.canvasId);

/**
 * Ephemeral dialog/recovery state, not an object store or offline queue. Only the
 * server authoring ledger may report applied. Continuations own a single request
 * generation; a late refresh/check cannot change a newer operation or request.
 * Uncertain submissions never permit another Apply. A current exact read may
 * qualify an explicit request to adjudicate the original, not a terminal claim.
 */
export class OutcomeArrangementController {
  #state: OutcomeArrangementState = { identity: null, status: "idle", preview: null, issue: null, submitted: false, busy: false };
  #scope: OutcomeArrangementScope | null = null;
  #review: OutcomeArrangementReview | null = null;
  #draft: OutcomeArrangementDraft | null = null;
  #checkedStamp = "";
  #version = 0;
  #checking: PreviewCheck | null = null;
  #receipt: ReceiptFingerprint | null = null;
  #disposition: ExpiredDisposition | null = null;
  #refusedPreparation: RefusedPreparation | null = null;
  readonly ports: OutcomeArrangementPorts;
  constructor(ports: OutcomeArrangementPorts) { this.ports = ports; }
  get state(): OutcomeArrangementState {
    if (this.#state.identity && !sameScope(this.#scope, this.ports.scope()))
      return { ...this.#state, preview: null, issue: "unavailable", status: "unavailable" };
    return { ...this.#state, issue: this.#state.issue
      ?? (this.#review && this.#checkedStamp !== this.ports.stamp() ? "changed" : null) };
  }
  /** A local normal-request label only; never a server review or current grant. */
  get pendingLocalName(): string | null {
    const request = this.#draft?.request, identity = this.#state.identity;
    return request && !request.undoOperationId && identity && sameScope(this.#scope, this.ports.scope())
      && identityMatches(identity, request) && !this.#state.preview && !this.#receipt && !this.#state.submitted
      ? request.name : null;
  }
  /** Only a fresh exact read can expose a request to adjudicate the retained intent. */
  get disposition(): OutcomeArrangementDisposition | null {
    const value = this.#disposition;
    if (!value || value.phase !== "ready" || !value.value || this.#state.busy) return null;
    if (!this.#dispositionCurrent(value)) { this.retireRecovery(); return null; }
    return value.value;
  }
  /** Only this Check’s current request view can expose the local attempt’s outcome. */
  get preparationNotDispatched(): boolean {
    return Boolean(this.refusedPreparation && this.#refusedPreparation?.notDispatchedAtConfirmation);
  }
  /** Historical refusal alone is not current permission, cancellation, or a receipt. */
  get refusedPreparation(): OutcomeArrangementPreviewRequest | null {
    const refused = this.#refusedPreparation, read = this.#disposition;
    if (!refused || this.#state.busy || !read || read.phase !== "ready" || read.value || read.receipt || read.requested) return null;
    if (!this.#preparationCurrent(refused)) { this.#dropRefusedPreparation(true); return null; }
    if (!this.#dispositionCurrent(read)) { this.retireRecovery(); return null; }
    return identityMatches(refused.request, read.identity) ? read.preparation ?? null : null;
  }
  #preparationCurrent(value: RefusedPreparation) {
    return value.ownership.current() && sameScope(value.owner.scope, this.#scope)
      && sameScope(value.owner.scope, this.ports.scope())
      && Boolean(this.#state.identity && identityMatches(value.request, this.#state.identity))
      && !this.#state.preview && !this.#receipt && !this.#state.submitted;
  }
  #dropRefusedPreparation(forgetDraft = false) {
    const value = this.#refusedPreparation;
    this.#refusedPreparation = null; value?.ownership.dispose();
    if (forgetDraft && !this.#state.preview && !this.#receipt) {
      this.#draft = null; this.#review = null; this.#checkedStamp = "";
    }
  }
  #capturePreparation(owner: Continuation, draft: OutcomeArrangementDraft, corrective = false): RefusedPreparation | null {
    if (!this.ports.captureRefusalOwnership || !this.ports.captureRecoveryOwnership) return null;
    let value: RefusedPreparation | null = null;
    const ownership = this.ports.captureRefusalOwnership(() => {
      if (value && this.#refusedPreparation === value) { this.#dropRefusedPreparation(true); this.ports.changed(); }
    });
    if (!ownership) return null;
    value = { owner, request: draft.request, ownership, corrective, notDispatchedAtConfirmation: false };
    if (!this.#preparationCurrent(value)) { ownership.dispose(); return null; }
    return value;
  }
  #dispositionCurrent(value: ActiveDisposition) {
    return this.#disposition === value && this.#active(value.owner) && value.ownership.current()
      && value.stamp === this.ports.stamp() && value.actorId === value.owner.scope?.actorId
      && (!value.receipt || value.receipt === this.#receipt)
      && Boolean(this.#state.identity && identityMatches(value.identity, this.#state.identity))
      && (!value.value || !this.#state.preview || this.#state.preview.previewId === value.value.previewId
        && this.#state.preview.approvalHash === value.value.approvalHash);
  }
  #retainRecovery(value: ActiveDisposition): ExpiredDisposition | null {
    return value.value ? { identity: value.identity, actorId: value.actorId, value: value.value,
      receipt: value.receipt, requested: value.requested, phase: "retained" } : null;
  }
  /** Local retirement preserves unknown outcome/identity, but disposes every read capability. */
  retireRecovery() {
    const value = this.#disposition;
    if (!value || value.phase === "retained") return;
    this.#disposition = this.#retainRecovery(value); value.ownership.dispose();
    if (value.phase !== "ready" && this.#owns(value.owner) && this.#state.busy) {
      ++this.#version;
      this.#change({ busy: false, status: this.#state.status === "applied" ? "applied" : "uncertain" });
    }
  }
  #releaseRecovery(value: ActiveDisposition | null) {
    if (!value) return;
    value.ownership.dispose();
    if (this.#disposition === value) this.#disposition = ["uncertain", "applying", "unavailable"].includes(this.#state.status)
      ? this.#retainRecovery(value) : null;
  }
  #captureRecovery(owner: Continuation): ActiveDisposition | null | false {
    const receipt = this.#receipt, preview = this.#state.preview, identity = this.#state.identity;
    if (!identity || !this.#active(owner) || ["applied", "dismissed", "not-applied"].includes(this.#state.status)
      || !this.#state.submitted && preview) return null;
    const prior = this.#disposition;
    const retained = prior?.phase === "retained" && prior.actorId === owner.scope?.actorId
      && identityMatches(identity, prior.identity) ? prior : null;
    if (receipt && (!identityMatches(identity, receipt) || receipt.actorId !== owner.scope?.actorId
      || preview && (receipt.previewId !== preview.previewId || receipt.approvalHash !== preview.approvalHash))) return null;
    if (!this.ports.captureRecoveryOwnership) return null;
    const ownership = this.ports.captureRecoveryOwnership(() => this.retireRecovery());
    if (!ownership) return false;
    const value: ActiveDisposition = { owner, identity: { ...identity }, actorId: owner.scope!.actorId, receipt, ownership,
      stamp: this.ports.stamp(), phase: "reading", requested: retained?.requested ?? false,
      value: retained?.value ?? (receipt ? Object.freeze({ ...identity, previewId: receipt.previewId, approvalHash: receipt.approvalHash }) : null) };
    this.#disposition = value;
    if (!this.#dispositionCurrent(value)) { this.#releaseRecovery(value); return false; }
    return value;
  }
  #serverDisposition(body: Record<string, unknown>, value: ActiveDisposition): OutcomeArrangementDisposition | null {
    const descriptor = body.disposition;
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return null;
    const candidate = descriptor as Record<string, unknown>;
    if (Object.keys(candidate).sort().join("|") !== "actorUserId|approvalHash|canvasId|operationId|previewId|projectId|version"
      || candidate.version !== 1 || candidate.actorUserId !== value.actorId || !identityMatches(value.identity, candidate)
      || typeof candidate.previewId !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,127}$/iu.test(candidate.previewId)
      || typeof candidate.approvalHash !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.approvalHash)
      || value.value && (value.value.previewId !== candidate.previewId || value.value.approvalHash !== candidate.approvalHash)) return null;
    return Object.freeze({ ...value.identity, previewId: candidate.previewId, approvalHash: candidate.approvalHash });
  }
  #change(patch: Partial<OutcomeArrangementState>) { this.#state = { ...this.#state, ...patch }; this.ports.changed(); }
  #begin(scope: OutcomeArrangementScope | null): Continuation {
    this.retireRecovery();
    this.#checking = null;
    return { version: ++this.#version, scope };
  }
  #owns(owner: Continuation) { return owner.version === this.#version; }
  #active(owner?: Continuation) { return (!owner || this.#owns(owner) && (!owner.current || owner.current())) && sameScope(owner ? owner.scope : this.#scope, this.ports.scope()); }
  #build(current: OutcomeArrangementContext, request: OutcomeArrangementPreviewRequest) {
    return request.undoOperationId ? previewOutcomeArrangementUndo(current, { ...request, undoOperationId: request.undoOperationId })
      : previewOutcomeArrangement(current, request);
  }
  async start(choice: { recipeId: OutcomeRecipeId; name: string; undoOperationId?: string }): Promise<boolean> {
    if (this.#state.busy || this.#state.identity && !["applied", "dismissed", "not-applied"].includes(this.#state.status)) return false;
    const scope = this.ports.scope(), recovery = this.ports.recoveryIdentity?.();
    if (recovery && (!this.#state.identity || !identityMatches(this.#state.identity, recovery) || !sameScope(this.#scope, scope))) {
      if (!scope || !safeOperation(recovery.operationId) || recovery.projectId !== scope.projectId || recovery.canvasId !== scope.canvasId) return false;
      const keepReceipt = sameActorBoard(this.#scope, scope) && Boolean(this.#state.identity && identityMatches(this.#state.identity, recovery));
      this.#begin(scope); this.#scope = scope; this.#draft = null; this.#review = null;
      if (!keepReceipt) this.#receipt = null;
      this.#change({ identity: { ...recovery }, status: "uncertain", preview: null, submitted: false, issue: null, busy: false });
      return false;
    }
    const owner = this.#begin(scope), stamp = this.ports.stamp(), requested = { ...choice };
    this.#change({ busy: true });
    let context: OutcomeArrangementContext | null;
    try { context = await this.ports.context(); } catch { context = null; }
    if (!this.#owns(owner)) return false;
    if (!scope || !context || !this.#active(owner) || !contextMatches(context, scope) || stamp !== this.ports.stamp()) {
      this.#change({ busy: false, issue: "changed" }); return false;
    }
    if (!context.canArrange || !context.atomicTransportAvailable) { this.#change({ busy: false, issue: context.canArrange ? "atomic-unavailable" : "unavailable" }); return false; }
    const operationId = this.ports.operationId();
    const draft = requested.undoOperationId ? previewOutcomeArrangementUndo(context, { ...requested, operationId, undoOperationId: requested.undoOperationId })
      : previewOutcomeArrangement(context, { ...requested, operationId });
    if (!draft.ok) { this.#change({ busy: false, issue: draft.issue }); return false; }
    this.#dropRefusedPreparation();
    this.#scope = scope; this.#draft = draft.value; this.#review = null; this.#checkedStamp = ""; this.#receipt = null; this.#disposition = null;
    const identity = { operationId, projectId: scope.projectId, canvasId: scope.canvasId };
    this.#state = { identity, status: "requesting", preview: null, issue: null, submitted: false, busy: true };
    this.ports.remember(identity); this.ports.changed();
    const attempt = this.#capturePreparation(owner, draft.value);
    if (this.ports.captureRefusalOwnership && !attempt) {
      this.#change({ status: "uncertain", busy: false, issue: "unavailable" }); return false;
    }
    try { await this.#send({ ...draft.value.request, action: requested.undoOperationId ? "undo-preview" : "preview" }, owner, null, attempt); }
    finally { if (attempt && this.#refusedPreparation !== attempt) attempt.ownership.dispose(); }
    return this.#active(owner) && this.#state.status === "review";
  }
  /** Explicit current re-review, never a new operation or a retry of an unknown dispatch. */
  async reviewRefusedPreparation(expected: OutcomeArrangementPreviewRequest): Promise<boolean> {
    const refused = this.#refusedPreparation;
    if (!refused || expected !== this.refusedPreparation || JSON.stringify(expected) !== JSON.stringify(refused.request)) return false;
    const scope = this.#scope, owner = this.#begin(scope), stamp = this.ports.stamp();
    this.#change({ busy: true, issue: null });
    let context: OutcomeArrangementContext | null;
    try { context = await this.ports.context(); } catch { context = null; }
    if (!this.#owns(owner)) return false;
    if (!context || !this.#active(owner) || !this.#preparationCurrent(refused) || this.#refusedPreparation !== refused
      || !contextMatches(context, scope) || stamp !== this.ports.stamp()
      || JSON.stringify([...context.selectedItemIds].sort()) !== JSON.stringify([...expected.selectedItemIds].sort())) {
      this.#change({ busy: false, issue: "changed" }); return false;
    }
    if (!context.canArrange || !context.atomicTransportAvailable) {
      this.#change({ busy: false, issue: context.canArrange ? "atomic-unavailable" : "unavailable" }); return false;
    }
    const draft = this.#build(context, expected);
    if (!draft.ok) { this.#change({ busy: false, issue: draft.issue }); return false; }
    this.#draft = draft.value; this.#review = null; this.#checkedStamp = "";
    const attempt = this.#capturePreparation(owner, draft.value, true);
    if (!attempt) { this.#change({ busy: false, issue: "unavailable" }); return false; }
    // The old witness cannot survive an unknown new dispatch. Only this request's
    // own exact refusal or positive local non-dispatch may establish new provenance.
    this.#dropRefusedPreparation();
    this.#change({ status: "requesting", busy: true, issue: null });
    try { await this.#send({ ...draft.value.request, action: expected.undoOperationId ? "undo-preview" : "preview" }, owner, null, attempt); }
    finally {
      if (this.#refusedPreparation !== attempt) attempt.ownership.dispose();
      // An unconfirmed corrective candidate is not the server's original plan.
      // Keep its operation and any newly proven refusal, but let a later exact
      // Check rebuild the genuine winner through the unchanged receipt checks.
      if (this.#owns(owner) && !this.#state.preview && !this.#receipt && this.#draft?.request === attempt.request) {
        this.#draft = null; this.#review = null; this.#checkedStamp = "";
      }
    }
    return this.#active(owner) && this.#state.status === "review";
  }
  async #send(command: OutcomeArrangementCommand, owner: Continuation, recovery: ActiveDisposition | null = null,
    preparation: RefusedPreparation | null = null) {
    if (!this.#active(owner)) { if (this.#owns(owner)) this.#change({ busy: false, issue: "unavailable" }); return; }
    const dispatchOwner = preparation ? this.ports.captureRecoveryOwnership?.(() => {}) : null;
    // Only the existing transport's actual dispatch signal can end the opening
    // gate. A late response may then establish history, never an old read grant.
    let dispatched = false, notDispatchedAtConfirmation = false;
    const current = recovery ? () => this.#dispositionCurrent(recovery) : preparation
      ? () => this.#active(owner) && this.#preparationCurrent(preparation)
        && (dispatched || Boolean(dispatchOwner?.current())) : undefined;
    try {
      if (current && !current()) { this.#change({ status: "uncertain", busy: false, issue: "unavailable" }); return; }
      const response = await this.ports.post(command, current ? { current,
        ...(preparation ? { onDispatch: () => { dispatched = true; },
          onNotDispatchedAtConfirmation: () => { if (!dispatched && current?.()) notDispatchedAtConfirmation = true; },
        } : {}) } : undefined);
      if (!this.#owns(owner)) return;
      if (recovery && !this.#dispositionCurrent(recovery)) { this.retireRecovery(); return; }
      if (preparation && !current?.()) { this.#change({ status: "uncertain", busy: false, issue: "unavailable" }); return; }
      if (!this.#active(owner)) { this.#change({ busy: false, issue: "unavailable" }); return; }
      if (!response.ok) {
        const error = String(response.body.error ?? "");
        if ([401, 403, 410].includes(response.status)) this.#dropRefusedPreparation(true);
        if (preparation && command.action === (preparation.request.undoOperationId ? "undo-preview" : "preview")
          && command.undoOperationId === preparation.request.undoOperationId && response.status === 409
          && (notDispatchedAtConfirmation && !dispatched
            || dispatched && response.body.error === "canvas_arrangement_source_changed" && response.body.providerCalls === 0
              && response.body.maximumMicrousd === 0 && Object.keys(response.body).sort().join("|") === "error|maximumMicrousd|providerCalls")
          && this.#preparationCurrent(preparation) && this.#draft?.request === preparation.request
          && identityMatches(preparation.request, command)) {
          // Positive local transport evidence describes this attempt, not global absence or cancellation.
          preparation.notDispatchedAtConfirmation = notDispatchedAtConfirmation && !dispatched;
          this.#refusedPreparation = preparation; this.#draft = null; this.#review = null; this.#checkedStamp = "";
        }
        // A missing read does not mint a witness or prove absence. It may only
        // requalify this owner's existing exact refusal for a separate free ask.
        if (recovery?.phase === "reading" && command.action === "retrieve" && command.includeDisposition === true
          && response.status === 409 && error === "canvas_arrangement_operation_unavailable"
          && response.body.providerCalls === 0 && response.body.maximumMicrousd === 0
          && Object.keys(response.body).sort().join("|") === "error|maximumMicrousd|providerCalls"
          && this.#refusedPreparation && this.#preparationCurrent(this.#refusedPreparation)
          && identityMatches(this.#refusedPreparation.request, command) && this.#dispositionCurrent(recovery)
          && !recovery.value && !recovery.receipt && !recovery.requested) {
          // This view belongs to this exact Check; an old rendered action must
          // not borrow another read's grant from the same historical witness.
          recovery.preparation = Object.freeze({ ...this.#refusedPreparation.request });
          recovery.phase = "ready";
        }
        if (recovery?.phase === "reading" && command.action === "retrieve" && command.includeDisposition === true && response.status === 409
          && error === "canvas_arrangement_preview_expired" && response.body.providerCalls === 0 && response.body.maximumMicrousd === 0
          && Object.keys(response.body).sort().join("|") === "disposition|error|maximumMicrousd|providerCalls"
          && this.#dispositionCurrent(recovery)) {
          const value = this.#serverDisposition(response.body, recovery);
          if (value) { recovery.value = value; recovery.phase = "ready"; }
        }
        const issue: OutcomeArrangementIssue | null = preparation && this.#refusedPreparation === preparation
          && preparation.notDispatchedAtConfirmation ? null : response.status === 403 ? "unavailable" : /lock/u.test(error) ? "locked"
          : /expired/u.test(error) ? "expired" : /geometry/u.test(error) ? "geometry" : "changed";
        // Failed retrieval never disproves a retained applied receipt.
        this.#change({ status: this.#state.status === "applied" ? "applied"
          : this.#state.submitted ? "uncertain" : this.#state.preview ? "review" : "uncertain", issue, busy: false });
        return;
      }
      if (recovery) {
        const body = response.body, status = body.status;
        if (status === "applied" || status === "review" && command.action === "retrieve" && !recovery.requested) {
          const terms = status === "review" ? body.preview as Record<string, unknown> | undefined : body;
          if (response.status !== 200 || recovery.value && (!terms || terms.previewId !== recovery.value.previewId
            || terms.approvalHash !== recovery.value.approvalHash)) throw new Error("outcome_arrangement_disposition_mismatch");
        } else if (command.action === "retrieve" && command.includeDisposition !== true) {
          // A normal known-live read keeps its established payload. Its legacy
          // applying reply is nonterminal; no absent/ambiguous reply can release
          // the original or qualify a disposition without an opted-in Check.
          if (response.status !== 202 || status !== "applying"
            || Object.keys(body).sort().join("|") !== "canvasId|operationId|previewId|projectId|status"
            || !identityMatches(recovery.identity, body) || !recovery.value
            || body.previewId !== recovery.value.previewId) throw new Error("outcome_arrangement_disposition_mismatch");
        } else {
          if (!(response.status === 200 && status === "dismissed" || response.status === 202 && status === "applying")
            || Object.keys(body).sort().join("|") !== "approvalHash|canvasId|operationId|previewId|projectId|status"
            || !identityMatches(recovery.identity, body)
            || typeof body.previewId !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,127}$/iu.test(body.previewId)
            || typeof body.approvalHash !== "string" || !/^[a-f0-9]{64}$/u.test(body.approvalHash)
            || recovery.value && (body.previewId !== recovery.value.previewId || body.approvalHash !== recovery.value.approvalHash))
            throw new Error("outcome_arrangement_disposition_mismatch");
          recovery.value ??= Object.freeze({ ...recovery.identity, previewId: body.previewId, approvalHash: body.approvalHash });
        }
      }
      // Reading a late exact refusal is not permission to publish a late plan.
      // Carry the opening through receipt hashing and current-context awaits.
      const responseOwner = preparation ? { ...owner, current: () => Boolean(dispatchOwner?.current()) } : owner;
      if (!this.#active(responseOwner)) { this.#change({ status: "uncertain", busy: false, issue: "unavailable" }); return; }
      await this.#receive(response.body, command, responseOwner);
    } catch {
      if (!this.#owns(owner)) return;
      this.#change({ status: this.#state.status === "applied" ? "applied" : "uncertain", busy: false,
        issue: this.#active(owner) ? this.#state.status === "applied" ? "changed" : null : "unavailable" });
    } finally {
      dispatchOwner?.dispose();
      if (recovery?.phase !== "ready") this.#releaseRecovery(recovery);
    }
  }
  async #receive(body: Record<string, unknown>, command: OutcomeArrangementCommand, owner: Continuation) {
    if (!this.#active(owner)) return;
    const identity: OutcomeArrangementIdentity = command;
    if (this.#state.status === "applied" && body.status !== "applied") throw new Error("outcome_arrangement_applied_cannot_regress");
    if (body.status === "review") {
      const preview = body.preview as OutcomeArrangementPreview | undefined, retained = this.#state.preview;
      if (!preview || !Array.isArray(preview.before) || !Array.isArray(preview.after) || !Array.isArray(preview.selectedItemIds)
        || preview.before.length < 2 || preview.before.length > 100 || preview.after.length !== preview.before.length
        || preview.selectedItemIds.length !== preview.before.length
        || preview.before.some((frame, index) => !frame || frame.itemId !== preview.after[index]?.itemId
          || frame.itemId !== preview.selectedItemIds[index] || ![frame.x, frame.y, frame.w, frame.h, preview.after[index]?.x, preview.after[index]?.y, preview.after[index]?.w, preview.after[index]?.h].every(Number.isFinite))
        || typeof preview.name !== "string" || typeof preview.recipeId !== "string"
        || typeof preview.previewId !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,127}$/iu.test(preview.previewId)
        || typeof preview.approvalHash !== "string" || !/^[a-f0-9]{64}$/u.test(preview.approvalHash)
        || typeof preview.arrangementId !== "string" || !/^outcome-arrangement:[a-f0-9]{64}$/u.test(preview.arrangementId)
        || preview.providerCalls !== 0 || preview.maximumMicrousd !== 0 || preview.changesSemantics !== false || preview.maximumEvents !== 201
        || !Number.isFinite(Date.parse(preview.expiresAt))
        || !identityMatches(identity, preview as unknown as Record<string, unknown>)
        || retained && receiptTerms(preview) !== receiptTerms(retained))
        throw new Error("outcome_arrangement_receipt_mismatch");
      const digest = await receiptDigest(preview);
      if (!this.#active(owner)) { if (this.#owns(owner)) this.#change({ busy: false, issue: "unavailable" }); return; }
      const original = this.#receipt;
      if (original && (original.actorId !== owner.scope?.actorId || !identityMatches(identity, original) || original.digest !== digest))
        throw new Error("outcome_arrangement_receipt_mismatch");
      if (command.action === "retrieve" && this.#refusedPreparation) {
        // A real original winner supersedes the refused candidate; rebuild only
        // against its returned terms and today's context, never candidate terms.
        this.#dropRefusedPreparation(true);
      }
      const recoverSubmission = this.#state.submitted && command.action === "retrieve";
      if (this.#state.submitted && !recoverSubmission) throw new Error("outcome_arrangement_retrieve_required");
      // A server-proven return to the original validated review is sufficient
      // for human Cancel, even if today's selection/source prevents Apply.
      // An unknown handle has no prior proof: its full current validation below
      // must succeed before it can release the submitted guard.
      const originalVerified = recoverSubmission && Boolean(original);
      this.#change({ preview, status: "review", busy: true, issue: "changed", ...(originalVerified ? { submitted: false } : {}) });
      await this.#validatePreview(owner, preview, recoverSubmission);
      if (this.#owns(owner)) this.#change({ busy: false });
      return;
    }
    if (!identityMatches(identity, body)) throw new Error("outcome_arrangement_receipt_mismatch");
    if (body.status === "applied") {
      if (body.providerCalls !== 0 || body.maximumMicrousd !== 0 || body.changesSemantics !== false
        || typeof body.arrangementId !== "string" || !/^outcome-arrangement:[a-f0-9]{64}$/u.test(body.arrangementId)
        || typeof body.requestHash !== "string" || !/^[a-f0-9]{64}$/u.test(body.requestHash)
        || typeof body.previewId !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,127}$/iu.test(body.previewId)
        || typeof body.approvalHash !== "string" || !/^[a-f0-9]{64}$/u.test(body.approvalHash)
        || !Number.isSafeInteger(body.itemCount) || Number(body.itemCount)<2 || Number(body.itemCount)>100
        || !Array.isArray(body.blockIds) || body.blockIds.length!==0 || body.relationCount!==0
        || this.#state.preview && body.itemCount!==this.#state.preview.selectedItemIds.length
        || this.#state.preview && (body.previewId !== this.#state.preview.previewId
          || body.approvalHash !== this.#state.preview.approvalHash || body.arrangementId !== this.#state.preview.arrangementId)
        || this.#receipt && (this.#receipt.actorId !== owner.scope?.actorId || !identityMatches(identity, this.#receipt)
          || body.previewId !== this.#receipt.previewId || body.approvalHash !== this.#receipt.approvalHash
          || body.arrangementId !== this.#receipt.arrangementId || body.itemCount !== this.#receipt.itemCount))
        throw new Error("outcome_arrangement_receipt_mismatch");
      this.#dropRefusedPreparation(true);
      this.#review = null;
      this.#change({ status: "applied", submitted: true, busy: false, issue: null });
      if (!this.#active(owner)) return;
      try { await this.ports.refresh(); } catch {
        if (this.#active(owner)) this.#change({ issue: "changed" });
      }
    } else if (body.status === "applying") {
      this.#dropRefusedPreparation(true);
      this.#change({ status: "applying", submitted: true, busy: false, issue: null });
    } else if (body.status === "dismissed" || body.status === "not-applied") {
      this.#dropRefusedPreparation(true);
      this.#review = null;
      this.#change({ status: body.status, preview: null, submitted: false, busy: false, issue: null });
    } else throw new Error("outcome_arrangement_receipt_invalid");
  }
  /** Local revalidation only; never refreshes, recovers a submission, or sends an intent. */
  async revalidate(): Promise<boolean> {
    if (this.#state.busy || this.#state.submitted || !this.#state.preview || !this.#active()) return false;
    return this.#validatePreview({ version: this.#version, scope: this.#scope }, this.#state.preview);
  }
  async #validatePreview(owner: Continuation, preview: OutcomeArrangementPreview, recoverSubmission = false): Promise<boolean> {
    const stamp = this.ports.stamp(), pending = this.#checking;
    if (!this.#active(owner) || this.#state.preview !== preview || this.#state.submitted && !recoverSubmission
      || pending?.owner.version === owner.version && pending.preview === preview && pending.stamp === stamp) return false;
    const check: PreviewCheck = { owner, preview, stamp }, retainedDraft = this.#draft;
    this.#checking = check;
    const ownsCheck = () => this.#checking === check && this.#owns(owner) && this.#state.preview === preview;
    try {
      const context = await this.ports.context();
      // Superseded work has no right to clear another preview or check, including
      // when it finishes with a rejection instead of a usable context.
      if (!ownsCheck() || !this.#active(owner)) return false;
      if (!context || !contextMatches(context, owner.scope) || stamp !== this.ports.stamp()) {
        this.#review = null; this.#change({ issue: "changed" }); return false;
      }
      const draft = retainedDraft ?? this.#build(context, preview);
      const candidate = "ok" in draft ? draft : { ok: true as const, value: draft };
      if (!candidate.ok) { this.#review = null; this.#change({ issue: candidate.issue }); return false; }
      const accepted = acceptOutcomeArrangementPreview(candidate.value, context, preview, this.ports.now());
      if (!accepted.ok) { this.#checkedStamp = stamp; this.#review = null; this.#change({ issue: accepted.issue }); return false; }
      const digest = await receiptDigest(accepted.value.preview);
      if (!ownsCheck() || !this.#active(owner)) return false;
      if (stamp !== this.ports.stamp()) { this.#review = null; this.#change({ issue: "changed" }); return false; }
      if (this.#receipt && (this.#receipt.actorId !== context.actorId || !identityMatches(preview, this.#receipt) || this.#receipt.digest !== digest)) {
        this.#review = null; this.#change({ issue: "changed" }); return false;
      }
      this.#receipt = { operationId: preview.operationId, projectId: preview.projectId, canvasId: preview.canvasId, actorId: context.actorId,
        previewId: preview.previewId, approvalHash: preview.approvalHash, arrangementId: preview.arrangementId,
        itemCount: preview.selectedItemIds.length, digest };
      this.#checkedStamp = stamp;
      if (!context.canArrange || !context.atomicTransportAvailable) {
        this.#review = null; this.#change({ issue: context.canArrange ? "atomic-unavailable" : "unavailable",
          ...(recoverSubmission ? { submitted: false } : {}) }); return false;
      }
      this.#draft = candidate.value; this.#review = accepted.value;
      this.#change({ issue: null, ...(recoverSubmission ? { submitted: false } : {}) }); return true;
    } catch {
      if (ownsCheck() && this.#active(owner)) { this.#review = null; this.#change({ issue: "unavailable" }); }
      return false;
    } finally { if (this.#checking === check) this.#checking = null; }
  }
  async apply(confirmation: { operationId: string; previewId: string; approvalHash: string; confirmed: true }): Promise<boolean> {
    if (this.#state.busy || this.#state.submitted || !this.#review || !this.#active()) return false;
    const review = this.#review, stamp = this.ports.stamp(), owner = this.#begin(this.#scope);
    let current: OutcomeArrangementContext | null;
    try { current = await this.ports.context(); } catch {
      if (this.#active(owner)) this.#change({ issue: "unavailable" }); return false;
    }
    if (!this.#active(owner) || !current || !contextMatches(current, owner.scope) || stamp !== this.ports.stamp()
      || this.#review !== review || this.#state.submitted) return false;
    const command = prepareOutcomeArrangement(review, current, confirmation, this.ports.now());
    if (!command.ok) { this.#change({ issue: command.issue }); return false; }
    this.#change({ submitted: true, status: "applying", busy: true, issue: null });
    await this.#send({ ...command.value, action: "apply" }, owner);
    return this.#active(owner) && this.#state.status === "applied";
  }
  async retrieve(identity: OutcomeArrangementIdentity = this.#state.identity!): Promise<boolean> {
    if (!identity || this.#state.busy || !safeOperation(identity.operationId)) return false;
    const scope = this.ports.scope();
    if (!scope || identity.projectId !== scope.projectId || identity.canvasId !== scope.canvasId) return false;
    const sameOperation = Boolean(this.#state.identity && identityMatches(this.#state.identity, identity));
    const keepReceipt = sameActorBoard(this.#scope, scope) && sameOperation;
    // The opt-in is recovery only, not a change to ordinary known-live reads.
    // A bare expired/ambiguous reply retains identity; only another explicit
    // Check can request the stronger current server disposition evidence.
    const includeDisposition = !keepReceipt || !this.#receipt || this.#state.issue === "expired" || Boolean(this.#disposition)
      || Boolean(this.#state.preview && Date.parse(this.#state.preview.expiresAt) <= this.ports.now());
    const retain = sameScope(this.#scope, scope) && sameOperation;
    if (this.#state.submitted && ["uncertain", "applying"].includes(this.#state.status) && !keepReceipt) return false;
    const owner = this.#begin(scope);
    // Renewed read access may inspect this actor's exact original intent. It
    // carries no old visible payload or current Apply certification into that
    // authority. Only opaque identity/count and a digest survive for comparison.
    if (!retain) { this.#draft = null; this.#review = null; this.#checkedStamp = ""; }
    if (!keepReceipt) this.#receipt = null;
    this.#scope = scope;
    const exact = { ...identity };
    this.#state = { ...this.#state, identity: exact, status: keepReceipt ? this.#state.status : "uncertain",
      preview: retain ? this.#state.preview : null, submitted: keepReceipt && this.#state.submitted, busy: true, issue: null };
    this.ports.remember(exact); this.ports.changed();
    const recovery = this.#captureRecovery(owner);
    if (recovery === false) {
      if (this.#owns(owner)) this.#change({ busy: false, issue: "unavailable" });
      return false;
    }
    await this.#send({ ...exact, action: "retrieve", ...(recovery && includeDisposition ? { includeDisposition: true } : {}) }, owner, recovery);
    return this.#active(owner) && ["review", "applied", "dismissed", "not-applied"].includes(this.#state.status);
  }
  async dismiss(expected?: OutcomeArrangementDisposition): Promise<boolean> {
    if (expected) {
      const value = this.#disposition;
      if (!value || value.phase === "retained" || value.value !== expected || this.disposition !== expected) return false;
      // Transfer this one read owner to the explicit disposition request. Do not
      // mistake permission to ask for a terminal outcome or a new Apply grant.
      this.#disposition = null;
      const owner = this.#begin(this.#scope);
      value.owner = owner; value.phase = "sending"; this.#disposition = value;
      value.requested = true;
      this.#change({ busy: true, issue: null });
      await this.#send({ ...expected, action: "dismiss", onlyIfUnapplied: true }, owner, value);
      return this.#active(owner) && this.#state.status === "dismissed";
    }
    if (!this.#state.identity || this.#state.busy || this.#state.submitted || !this.#state.preview || !this.#active()) return false;
    const preview = this.#state.preview, identity = this.#state.identity, owner = this.#begin(this.#scope);
    this.#change({ busy: true });
    await this.#send({ ...identity, action: "dismiss", previewId: preview.previewId, approvalHash: preview.approvalHash }, owner);
    return this.#active(owner) && this.#state.status === "dismissed";
  }
}
