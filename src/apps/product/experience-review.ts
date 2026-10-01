import { html, nothing, render } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import type { CommandDeparture } from "../../components/command-departure";
import { FormaPresentationalElement } from "../../components/presentational-element";
import type { DeliveryDecision } from "../../components/forma-role-dashboard";
import { platformSession } from "../../platform/session-controller";
import { canonicalDeliveryStatus, DELIVERY_DECISION_STATUSES, deliveryTransitionAllowed, deliveryNeedsEvidence,
  deliveryNeedsReleaseAuthority, type DeliveryDecisionStatus } from "../../platform/delivery-lifecycle";
import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../../experiences/compiler";
import {
  EXPERIENCE_RELEASE_PROTOCOL, experienceBindingDigest, experienceEventId, experienceId, experienceReleaseHash, experienceRequestId, experienceTimestamp, experienceTransitionEventId,
  readExperienceMaterialInventory, readExperienceMaterialDetail, readExperienceMaterialPreview,
  readExperienceOperationReceipt, readExperienceProposal, readExperiencePublication, readExperienceTransition, readExperienceReleaseBinding, validExperienceDecisionId,
  type ExperienceMaterialInventory, type ExperienceMaterialDetail, type ExperienceMaterialSummary,
  type ExperienceMaterialSelection, type ExperienceMaterialPreview, type ExperienceProposalIntent,
  type ExperienceReleaseBinding, type ExperienceTransitionIntent, type ExperiencePublicationIntent,
} from "../../experiences/release-contract";
import type { ExperiencePatch } from "../../experiences/patches";
import { readExperienceMaintenanceReview, readExperienceMaintenancePreviewRequest, readExperienceMaintenancePreview,
  type ExperienceMaintenanceReview, type ExperienceMaintenancePreview, type ExperienceMaintenanceChanges } from "../../experiences/maintenance-review-contract";
import type { ExperienceMaintenanceRequest } from "../../experiences/maintenance-proposal";
import { readMaintenanceAdoptionProposal, readMaintenanceAdoptionTransition, readMaintenanceAdoptionIntent,
  validMaintenanceDecisionId, type MaintenanceBinding, type MaintenanceProposalIntent,
  type MaintenanceTransitionIntent, type MaintenanceAdoptionIntent } from "../../experiences/maintenance-adoption-contract";
import { readMaintenanceAdoptionNominations, readMaintenanceAdoptionDecision, readMaintenanceAdoptionAcknowledgment,
  maintenanceBindingMatchesHead, type MaintenanceAdoptionDecision, type MaintenanceAdoptionNominations,
  type MaintenanceHeadState } from "../../experiences/maintenance-adoption-review-contract";

import "./experience-review.css";

const endpoint = "/api/portfolio/product/experiences";
type Head = ExperienceReleaseBinding["expectedHead"];
type Departure = Omit<CommandDeparture, "element"> & { readonly element: HTMLElement };
export type ExperienceReviewContext = Readonly<{
  available: boolean; writable: boolean; approvalAuthority?: boolean;
  owners: readonly Readonly<{ userId: string; displayName: string }>[];
}>;
export type ExperienceOperationSavedDetail = Readonly<{
  registerDeliveryRefresh: (completion: Promise<unknown>) => void;
}>;
type DecisionResult = Readonly<{ decision: DeliveryDecision; binding: ExperienceReleaseBinding; bindingHash: string }>;
type DecisionRead = DecisionResult & Readonly<{ approvalEventId: string | null; approvalEligible: boolean }>;
type PublicationResult = Readonly<{ decisionId: string; binding: ExperienceReleaseBinding; bindingHash: string;
  head: Readonly<{ experienceId: string; channel: "managed-fixture"; revision: number; publicationEventId: string;
    decisionId: string; bindingHash: string; releaseHash: string }> }>;
type HeadRead = Readonly<{ expectedHead: Head; eligible: boolean }>;
type ReviewedDecision = DecisionRead | MaintenanceAdoptionDecision;
const isMaintenanceReviewDecision = (value: ReviewedDecision): value is MaintenanceAdoptionDecision => value.binding.operation === "adopt-baseline";
const reviewSelection = (value: ReviewedDecision): ExperienceMaterialSelection => isMaintenanceReviewDecision(value) ? value.binding.material : selectionOf(value.binding);
const acknowledgmentLabels = {
  proposal: "Proposed", transition: "Recorded", publication: "Test fixture published",
  "maintenance-proposal": "Proposed", "maintenance-transition": "Recorded", "maintenance-adoption": "Baseline adopted",
} as const;
type HistoricalPublication = Readonly<{ eventId: string; result: PublicationResult }>;
type Original = Readonly<({ operation: "proposal"; intent: ExperienceProposalIntent }
  | { operation: "transition"; intent: ExperienceTransitionIntent; previous: DecisionRead }
  | { operation: "publication"; intent: ExperiencePublicationIntent }
  | { operation: "maintenance-proposal"; intent: MaintenanceProposalIntent }
  | { operation: "maintenance-transition"; intent: MaintenanceTransitionIntent; previous: MaintenanceAdoptionDecision }
  | { operation: "maintenance-adoption"; intent: MaintenanceAdoptionIntent }) & { actorUserId: string; scope: string;
  session: ReturnType<typeof platformSession.get>; fields: string }>;
const cancelBody = async (response: Response) => { try { await response.body?.cancel(); } catch { /* Retirement never publishes body or cancellation failures. */ } };
const selectionKey = (selection: ExperienceMaterialSelection) => canonicalJson(selection);
const selectionOf = (binding: ExperienceReleaseBinding): ExperienceMaterialSelection => ({
  releaseHash: binding.releaseHash, sourceHash: binding.sourceHash,
  buildHash: binding.buildHash, evaluationHash: binding.evaluationHash,
});

/** A head is a compare-and-swap witness, never an approval for the current actor. */
export function readExperienceReviewHead(value: unknown, id: string): Head | null {
  if (!experienceId(id) || jsonIssues(value).length || !record(value) || !exactKeys(value, ["head", "eligible", "qualification", "generationAvailable"])
    || typeof value.eligible !== "boolean" || value.qualification !== "fixture" || value.generationAvailable !== false) return null;
  if (value.head === null) return value.eligible === false ? Object.freeze({ revision: 0, eventId: null }) : null;
  const head = value.head;
  if (!record(head) || !exactKeys(head, ["experienceId", "channel", "revision", "publicationEventId", "decisionId", "bindingHash", "releaseHash"])
    || head.experienceId !== id || head.channel !== "managed-fixture" || !Number.isSafeInteger(head.revision)
    || Number(head.revision) < 1 || !experienceEventId(head.publicationEventId) || !validExperienceDecisionId(head.decisionId)
    || !experienceReleaseHash(head.bindingHash) || !experienceReleaseHash(head.releaseHash)) return null;
  return Object.freeze({ revision: Number(head.revision), eventId: head.publicationEventId });
}

/** Dedicated read projection; approvalEligible is deliberately not an actor capability. */
export async function readExperienceReviewDecision(value: unknown, decisionId: string): Promise<DecisionRead | null> {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["decision", "binding", "bindingHash", "approvalEventId", "approvalEligible", "canPublish", "qualification", "generationAvailable"])
    || typeof value.approvalEligible !== "boolean" || value.canPublish !== false || value.qualification !== "fixture"
    || value.generationAvailable !== false || value.approvalEventId !== null && !experienceEventId(value.approvalEventId)) return null;
  const binding = readExperienceReleaseBinding(value.binding), decision = readDecisionFields(value.decision);
  if (!binding || !experienceReleaseHash(value.bindingHash) || !decision || decision.decisionId !== decisionId) return null;
  if (decision.status !== "approved" && (value.approvalEventId !== null || value.approvalEligible !== false)
    || value.approvalEligible && value.approvalEventId === null) return null;
  const snapshot = structuredClone({ decision, binding, bindingHash: value.bindingHash,
    approvalEventId: value.approvalEventId, approvalEligible: value.approvalEligible });
  if (snapshot.bindingHash !== await experienceBindingDigest(binding)) return null;
  return freeze(snapshot) as DecisionRead;
}

function readDecisionFields(decision: unknown): DeliveryDecision | null {
  if (jsonIssues(decision).length || !record(decision)
    || !exactKeys(decision, ["decisionId", "title", "audience", "status", "ownerUserId", "owner", "evidence", "dependencyIds", "createdAt", "updatedAt"])
    || !validExperienceDecisionId(decision.decisionId) || decision.audience !== "product"
    || typeof decision.status !== "string" || canonicalDeliveryStatus(decision.status) !== decision.status
    || typeof decision.title !== "string" || !decision.title.trim() || decision.title.length > 160
    || typeof decision.ownerUserId !== "string" || !decision.ownerUserId.trim() || decision.ownerUserId.length > 240
    || typeof decision.owner !== "string" || decision.owner.length > 8192
    || typeof decision.evidence !== "string" || decision.evidence.length > 800
    || !experienceTimestamp(decision.createdAt) || !experienceTimestamp(decision.updatedAt)
    || !Array.isArray(decision.dependencyIds) || decision.dependencyIds.length > 10
    || decision.dependencyIds.some(id => typeof id !== "string" || !id.trim() || id.length > 240)
    || new Set(decision.dependencyIds).size !== decision.dependencyIds.length) return null;
  return freeze(structuredClone(decision)) as DeliveryDecision;
}

/** An acknowledgment's payload must describe this proposal, not just carry a valid JSON digest. */
export async function readExperienceReviewProposalResult(value: unknown, intent: ExperienceProposalIntent): Promise<DecisionResult | null> {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["decision", "binding", "bindingHash", "qualification", "generationAvailable"])
    || value.qualification !== "fixture" || value.generationAvailable !== false) return null;
  const expected = readExperienceProposal(intent), decision = readDecisionFields(value.decision), binding = readExperienceReleaseBinding(value.binding);
  if (!expected || !decision || !binding || !experienceReleaseHash(value.bindingHash)
    || canonicalJson(binding) !== canonicalJson(expected.binding)
    || decision.status !== "planned" || decision.title !== expected.title || decision.ownerUserId !== expected.ownerUserId
    || decision.evidence !== expected.evidence || canonicalJson(decision.dependencyIds) !== canonicalJson(expected.dependencyIds)
    || decision.createdAt !== decision.updatedAt) return null;
  const snapshot = freeze(structuredClone({ decision, binding, bindingHash: value.bindingHash }));
  return snapshot.bindingHash === await experienceBindingDigest(binding) ? snapshot : null;
}

/** Current head eligibility is distinct from an original publication receipt. */
export function readExperienceReviewHeadState(value: unknown, id: string): HeadRead | null {
  const expectedHead = readExperienceReviewHead(value, id);
  return expectedHead && record(value) ? freeze({ expectedHead, eligible: value.eligible as boolean }) : null;
}

export async function readExperienceReviewTransitionResult(value: unknown, intent: ExperienceTransitionIntent,
  previous: DecisionRead, eventId: string): Promise<DecisionResult | null> {
  if (jsonIssues(value).length || jsonIssues(previous).length || !record(previous)
    || !exactKeys(previous, ["decision", "binding", "bindingHash", "approvalEventId", "approvalEligible"])
    || !readDecisionFields(previous.decision) || !readExperienceReleaseBinding(previous.binding)
    || !experienceReleaseHash(previous.bindingHash) || typeof previous.approvalEligible !== "boolean"
    || previous.approvalEventId !== null && !experienceEventId(previous.approvalEventId)) return null;
  const expected = readExperienceTransition(intent), prior = structuredClone(previous);
  if (!expected || !record(value) || !exactKeys(value, ["decision", "binding", "bindingHash", "qualification", "generationAvailable"])
    || value.qualification !== "fixture" || value.generationAvailable !== false) return null;
  const decision = readDecisionFields(value.decision), binding = readExperienceReleaseBinding(value.binding);
  if (!decision || !binding || !experienceReleaseHash(value.bindingHash) || expected.decisionId !== prior.decision.decisionId
    || expected.expectedUpdatedAt !== prior.decision.updatedAt || !deliveryTransitionAllowed(prior.decision.status, expected.status)
    || canonicalJson(expected.experienceRelease) !== canonicalJson(prior.binding) || canonicalJson(binding) !== canonicalJson(prior.binding)
    || value.bindingHash !== prior.bindingHash
    || decision.decisionId !== expected.decisionId || decision.title !== expected.title || decision.ownerUserId !== expected.ownerUserId
    || decision.evidence !== expected.evidence || decision.status !== expected.status
    || decision.createdAt !== prior.decision.createdAt || decision.updatedAt <= expected.expectedUpdatedAt
    || eventId !== experienceTransitionEventId(expected.decisionId, decision.updatedAt)
    || canonicalJson(decision.dependencyIds) !== canonicalJson(prior.decision.dependencyIds)) return null;
  const result = freeze(structuredClone({ decision, binding, bindingHash: value.bindingHash }));
  return result.bindingHash === await experienceBindingDigest(binding) ? result : null;
}

async function publicationResult(value: unknown): Promise<PublicationResult | null> {
  if (jsonIssues(value).length || !record(value)
    || !exactKeys(value, ["decisionId", "binding", "bindingHash", "head", "qualification", "generationAvailable"])
    || value.qualification !== "fixture" || value.generationAvailable !== false || !validExperienceDecisionId(value.decisionId)
    || !experienceReleaseHash(value.bindingHash)) return null;
  const binding = readExperienceReleaseBinding(value.binding), head = value.head;
  if (!binding || !record(head) || !readExperienceReviewHead({ head, eligible: false, qualification: "fixture", generationAvailable: false }, binding.experienceId)
    || head.revision !== binding.expectedHead.revision + 1 || head.decisionId !== value.decisionId
    || head.bindingHash !== value.bindingHash || head.releaseHash !== binding.releaseHash) return null;
  const result = freeze(structuredClone({ decisionId: value.decisionId, binding, bindingHash: value.bindingHash, head })) as PublicationResult;
  return result.bindingHash === await experienceBindingDigest(binding) ? result : null;
}

export async function readExperienceReviewPublicationResult(value: unknown, intent: ExperiencePublicationIntent,
  eventId: string): Promise<PublicationResult | null> {
  const expected = readExperiencePublication(intent);
  if (!expected || !experienceEventId(eventId)) return null;
  const result = await publicationResult(value);
  return result && result.decisionId === expected.decisionId && result.head.publicationEventId === eventId
    && canonicalJson(result.binding) === canonicalJson(expected.binding) ? result : null;
}

/** Exact historical read: the server proves retained intent custody. This client
 * checks the event/result identity and acknowledgment bytes, not an absent intent. */
export async function readExperienceReviewHistoricalPublication(value: unknown, eventId: string): Promise<HistoricalPublication | null> {
  if (!experienceEventId(eventId) || jsonIssues(value).length || !record(value)
    || !exactKeys(value, ["receipt", "result"]) || !record(value.receipt)) return null;
  const snapshot = freeze(structuredClone(value)), receipt = snapshot.receipt as Record<string, unknown>;
  if (!exactKeys(receipt, ["version", "protocol", "operation", "requestId", "actorUserId", "intentDigest", "eventId", "sequence", "acknowledgmentDigest"])
    || receipt.version !== 1 || receipt.protocol !== EXPERIENCE_RELEASE_PROTOCOL || receipt.operation !== "publication"
    || !experienceRequestId(receipt.requestId) || typeof receipt.actorUserId !== "string" || !receipt.actorUserId.trim()
    || receipt.actorUserId !== receipt.actorUserId.trim() || receipt.actorUserId.length > 240
    || receipt.eventId !== eventId || !Number.isSafeInteger(receipt.sequence) || Number(receipt.sequence) < 1
    || !experienceReleaseHash(receipt.intentDigest) || !experienceReleaseHash(receipt.acknowledgmentDigest)) return null;
  const result = await publicationResult(snapshot.result);
  return result && result.head.publicationEventId === eventId && receipt.acknowledgmentDigest === await digest(snapshot.result)
    ? freeze({ eventId, result }) : null;
}

/** Capture only a retained read pair and the current typed patch. This does not
 * infer a baseline, register a candidate, or alter a governance command intent. */
export function captureExperienceReviewMaintenanceRequest(base: ExperienceMaterialSelection,
  review: ExperienceMaintenanceReview, patch: ExperiencePatch | null): ExperienceMaintenanceRequest | null {
  const retained = readExperienceMaintenanceReview(review, base);
  if (!retained?.review || patch === null) return null;
  return readExperienceMaintenancePreviewRequest({ version: 1, base: retained.base,
    baselineObservationHash: retained.review.baselineObservationHash, currentObservationHash: retained.review.currentObservationHash, patch });
}
const maintenanceSourceLabels = {
  "model3d-contract": "3D contract", "model3d-prompt-adapter": "Prompt adapter", "model3d-viewer": "Viewer",
} as const satisfies Record<ExperienceMaintenanceChanges["sources"][number], string>;
const maintenanceFieldLabels = {
  adapterVersion: "Adapter version", promptAdapterVersion: "Prompt adapter version", textModel: "Text model", imageModel: "Image model",
  promptMaxChars: "Prompt limit", maxImageReferences: "Image reference limit", privateTransferMaxBytes: "Private transfer limit",
  formats: "Formats", formatMimeTypes: "Format MIME types", tiers: "Tiers", materials: "Materials", qualityMeshOptions: "Mesh quality",
  textureModes: "Texture modes", imageMimeTypes: "Image MIME types", settingsDefaults: "Default settings", viewer: "Viewer",
} as const satisfies Record<ExperienceMaintenanceChanges["contracts"][number], string>;

export class FormaExperienceReview extends FormaPresentationalElement {
  #context: ExperienceReviewContext = { available: false, writable: false, owners: [] };
  #lifetime = 0;
  #readVersion = 0;
  #certifiedRead = 0;
  #busy = false;
  #saving = false;
  #operation: object | null = null;
  #inventory: ExperienceMaterialInventory | null = null;
  #detail: ExperienceMaterialDetail | null = null;
  #head: Head | null = null;
  #latestHead: Head | null = null;
  #decision: ReviewedDecision | null = null;
  #latestDecision: ReviewedDecision | null = null;
  #decisionHead: HeadRead | null = null;
  #historical: HistoricalPublication | null = null;
  #actionEpoch = 0;
  #governanceReady = false;
  #acknowledgment: Readonly<{ operation: Original["operation"]; eventId: string }> | null = null;
  #selected: ExperienceMaterialSummary | null = null;
  #order: string[] = [];
  #preview: ExperienceMaterialPreview | null = null;
  #maintenance: Readonly<{ detail: ExperienceMaterialDetail; value: ExperienceMaintenanceReview }> | null = null;
  #maintenancePreview: Readonly<{ detail: ExperienceMaterialDetail; value: ExperienceMaintenancePreview }> | null = null;
  #maintenanceVersion = 0;
  #maintenancePatchVersion = 0;
  #maintenanceNotice = false;
  #adoptionEpoch = 0;
  #nominations: Readonly<{ detail: ExperienceMaterialDetail; value: MaintenanceAdoptionNominations }> | null = null;
  #latestNominations: MaintenanceAdoptionNominations | null = null;

  #original: Original | null = null;
  #uncertain = false;
  #notice = "";
  #denied = false;
  #unsubscribe?: () => void;
  #route = "";
  #proposalEpoch = 0;
  #composing: HTMLFormElement | null = null;
  #cancelFocusClearance: (() => void) | null = null;

  set reviewContext(value: ExperienceReviewContext) {
    const previously = this.#context.available;
    this.#context = value;
    if (!value.available && previously) this.retireAccess();
    else if (value.available && !previously) void this.updateComplete.then(() => this.refresh());
    this.requestUpdate();
  }
  get reviewContext() { return this.#context; }

  override connectedCallback() {
    super.connectedCallback();
    this.#route = location.pathname + location.search;
    this.#unsubscribe = platformSession.subscribe(() => this.retireAccess(false));
    window.addEventListener("popstate", this.#routeChanged);
    this.addEventListener("focusin", this.#nativeFocus);
  }
  override disconnectedCallback() {
    this.retireAccess(false); this.#unsubscribe?.(); this.#unsubscribe = undefined;
    window.removeEventListener("popstate", this.#routeChanged); this.removeEventListener("focusin", this.#nativeFocus); super.disconnectedCallback();
  }
  #routeChanged = () => {
    if (this.#route !== location.pathname + location.search) this.retireAccess(false);
  };
  #scope() {
    const session = platformSession.get();
    return session?.audience === "product" && session.capabilities.includes("product.delivery.manage")
      && location.pathname.replace(/\/+$/, "") === "/product/delivery"
      ? JSON.stringify([location.pathname, location.search, session.user, session.audience,
        session.permissionEpoch, [...session.capabilities].sort()]) : "";
  }
  #capture(requireAccess = true) {
    const lifetime = this.#lifetime, scope = this.#scope(), session = platformSession.get();
    return () => Boolean(scope) && this.isConnected && (!requireAccess || this.#context.available)
      && lifetime === this.#lifetime && scope === this.#scope() && session === platformSession.get();
  }
  #nativeFocus = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !this.contains(target) || document.activeElement !== target
      || !target.matches("input, textarea, select, button") || !target.matches(":focus-visible")) return;
    const form = target.closest("form"), current = this.#capture();
    if (!form || !this.contains(form)) return;
    const clear = this.#prepareFocusClearance(target, () => current() && form.isConnected
      && form === target.closest("form") && this.contains(form) && target.matches(":focus-visible"));
    void clear(this.updateComplete);
  };
  #prepareFocusClearance(target: HTMLElement, current: () => boolean) {
    this.#cancelFocusClearance?.();
    const focus = this.#captureFocusRecovery(target);
    const dispose = () => {
      focus.dispose();
      if (this.#cancelFocusClearance === dispose) this.#cancelFocusClearance = null;
    };
    this.#cancelFocusClearance = dispose;
    return async (settled: Promise<unknown>) => {
      try { await settled; if (current()) await focus.afterFrame(() => focus.clear(target, current)); }
      catch { /* A failed owned render or measurement cannot move current focus. */ }
      finally { dispose(); }
    };
  }
  #captureFocusRecovery(origin: EventTarget | null) {
    const focusedOrigin = origin instanceof HTMLElement && this.contains(origin)
      && document.activeElement === origin ? origin : null;
    let superseded = !focusedOrigin, disposed = false, recoveryTarget: HTMLElement | null = null;
    let frame: number | null = null, finishFrame: (() => void) | null = null;
    const stopFrame = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null; const finish = finishFrame; finishFrame = null; finish?.();
    };
    const newerFocus = (event: FocusEvent) => {
      if (event.target !== focusedOrigin && event.target !== document.body && event.target !== recoveryTarget) { superseded = true; stopFrame(); }
    };
    const newerInput = () => { superseded = true; stopFrame(); };
    const hidden = () => { if (document.visibilityState === "hidden") newerInput(); };
    const inputs = ["pointerdown", "keydown", "beforeinput", "input", "change", "compositionstart", "wheel", "touchstart"] as const;
    document.addEventListener("focusin", newerFocus, true);
    for (const type of inputs) document.addEventListener(type, newerInput, { capture: true, passive: true });
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", newerInput);
    return {
      restore: (target: HTMLElement, current: () => boolean) => {
        const owns = () => !disposed && !superseded && document.hasFocus() && document.visibilityState !== "hidden"
          && current() && target.isConnected && this.contains(target) && !target.closest("[hidden], [inert], details:not([open])")
          && !(target instanceof HTMLButtonElement && target.disabled);
        if (!owns() || document.activeElement !== document.body && document.activeElement !== focusedOrigin) return;
        const style = getComputedStyle(target), rect = target.getBoundingClientRect();
        if (style.visibility !== "visible" || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) return;
        // This one native focus is our recovery, not newer user focus. Events
        // redirected elsewhere by a focus handler still retire the lease.
        recoveryTarget = target;
        target.focus();
        if (owns() && document.activeElement === target) this.#revealFocus(target, () => owns() && document.activeElement === target);
      },
      clear: (target: HTMLElement, current: () => boolean) => {
        const owns = () => !disposed && !superseded && target === focusedOrigin && document.activeElement === target
          && document.hasFocus() && document.visibilityState !== "hidden" && current() && target.isConnected
          && this.contains(target) && !target.closest("[hidden], [inert], details:not([open])")
          && !(target instanceof HTMLButtonElement && target.disabled);
        if (owns()) this.#clearFocus(target, owns);
      },
      afterFrame: (run: () => void) => new Promise<void>((resolve, reject) => {
        if (disposed || superseded) { resolve(); return; }
        finishFrame = resolve;
        frame = requestAnimationFrame(() => {
          frame = null; finishFrame = null;
          try { if (!disposed && !superseded) run(); resolve(); } catch (error) { reject(error); }
        });
      }),
      dispose: () => {
        disposed = true; stopFrame();
        document.removeEventListener("focusin", newerFocus, true);
        for (const type of inputs) document.removeEventListener(type, newerInput, true);
        document.removeEventListener("visibilitychange", hidden);
        window.removeEventListener("blur", newerInput);
      },
    };
  }
  #revealFocus(target: HTMLElement, current: () => boolean) {
    if (!current()) return;
    // Native scrolling handles the target's actual scrolling ancestors. The
    // subsequent adjustment uses CSS pixels and the currently painted shell,
    // rather than a fixed header height or a second device-pixel conversion.
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    this.#clearFocus(target, current);
  }
  #clearFocus(target: HTMLElement, current: () => boolean) {
    if (!current()) return;
    const scroller = document.scrollingElement;
    if (!(scroller instanceof HTMLElement)) return;
    const viewport = window.visualViewport;
    const left = Math.max(0, viewport?.offsetLeft ?? 0), top = Math.max(0, viewport?.offsetTop ?? 0);
    const right = Math.min(window.innerWidth, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth));
    const bottom = Math.min(window.innerHeight, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
    if (right <= left || bottom <= top) return;
    const header = this.closest("forma-platform-shell")?.querySelector<HTMLElement>(":scope > .forma-platform-shell > .platform-topbar");
    const headerRect = header?.getBoundingClientRect(), headerStyle = header ? getComputedStyle(header) : null;
    const clearTop = headerRect && headerStyle && ["sticky", "fixed"].includes(headerStyle.position)
      && headerStyle.visibility === "visible" && Number(headerStyle.opacity) !== 0
      && headerRect.right > left && headerRect.left < right && headerRect.bottom > top && headerRect.top < bottom
      ? Math.min(bottom, Math.max(top, headerRect.bottom)) : top;
    const style = getComputedStyle(target), rect = target.getBoundingClientRect();
    if (style.visibility !== "visible" || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) return;
    const outline = style.outlineStyle === "none" ? 0 : Math.max(0, (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0));
    const shift = (start: number, end: number, low: number, high: number) => start < low ? Math.floor(start - low) : end > high ? Math.ceil(end - high) : 0;
    const x = shift(rect.left - outline, rect.right + outline, left, right);
    const y = shift(rect.top - outline, rect.bottom + outline, clearTop, bottom);
    if (current() && (x || y)) scroller.scrollBy({ left: x, top: y, behavior: "instant" });
  }
  #writable() {
    return this.#context.writable && !this.#denied && Boolean(this.#scope())
      && Boolean(platformSession.get()?.capabilities.includes("product.delivery.manage"));
  }

  /** Withdraw private content now, not at Lit's next microtask. Keep only a dispatched original on read denial. */
  retireAccess(keepOriginal = true) {
    this.#cancelFocusClearance?.();
    this.#lifetime++; this.#readVersion++; this.#certifiedRead = this.#readVersion;
    this.#operation = null; this.#busy = false; this.#saving = false;
    this.#clearMaintenance(); this.#clearAdoption();
    this.#inventory = null; this.#detail = null; this.#selected = null; this.#decision = null;
    this.#latestDecision = null; this.#decisionHead = null; this.#historical = null; this.#actionEpoch++;
    this.#governanceReady = false; this.#acknowledgment = null;
    this.#proposalEpoch++;
    this.#composing = null;
    this.#head = null; this.#latestHead = null; this.#order = []; this.#preview = null;
    if (!keepOriginal || !this.#uncertain) { this.#original = null; this.#uncertain = false; }
    this.#notice = ""; this.#denied = true;
    const mount = this.querySelector<HTMLElement>("[data-experience-review-mount]");
    if (mount) render(nothing, mount);
    this.requestUpdate();
  }
  #form() { return this.querySelector<HTMLFormElement>(`form[data-experience-proposal][data-experience-proposal-owner="${this.#proposalEpoch}"]`); }
  #adoptionForm() { return this.querySelector<HTMLFormElement>(`form[data-experience-adoption-proposal][data-experience-adoption-owner="${this.#adoptionEpoch}"]`); }
  #adoptionFields() {
    const form = this.#adoptionForm(), fields = this.#fields(form);
    return form && fields ? { ...fields, nomination: (form.elements.namedItem("nomination") as HTMLSelectElement | null)?.value ?? "" } : null;
  }
  #patchForm() { return this.querySelector<HTMLFormElement>("form[data-experience-patch]"); }
  #actionForm() { return this.querySelector<HTMLFormElement>(`form[data-experience-action][data-experience-action-owner="${this.#actionEpoch}"]`); }
  #lookupForm() { return this.querySelector<HTMLFormElement>("form[data-experience-publication-lookup]"); }
  #actionFields() {
    const form = this.#actionForm(); if (!form) return null;
    return { evidence: (form.elements.namedItem("evidence") as HTMLTextAreaElement | null)?.value ?? "",
      status: (form.elements.namedItem("status") as HTMLSelectElement | null)?.value ?? this.#decision?.decision.status ?? "" };
  }
  #fields(form = this.#form()) {
    if (!form) return null;
    const values = new FormData(form);
    return { title: String(values.get("title") ?? ""), evidence: String(values.get("evidence") ?? ""),
      // A withdrawn selected option is disabled but remains the user's native draft.
      ownerUserId: (form.elements.namedItem("ownerUserId") as HTMLSelectElement | null)?.value ?? "" };
  }
  #dirty(includeLookup = true) {
    if (this.#denied || !this.#context.available) return false;
    if (this.#composing?.isConnected) return true;
    const fields = this.#fields(), actor = platformSession.get()?.user.userId ?? "";
    const originalMatches = this.#uncertain && this.#original?.operation === "proposal" && this.#original.fields === JSON.stringify(fields);
    const proposalDirty = fields && !originalMatches && (fields.title !== "" || fields.evidence !== "" || fields.ownerUserId !== actor);
    const action = this.#actionFields(), decision = this.#decision?.decision;
    const actionOriginalMatches = this.#uncertain && (this.#original?.operation === "transition" || this.#original?.operation === "maintenance-transition") && this.#original.fields === JSON.stringify(action);
    const actionDirty = action && decision && !actionOriginalMatches && (action.evidence !== decision.evidence || action.status !== decision.status);
    const adoption = this.#adoptionFields();
    const adoptionOriginalMatches = this.#uncertain && this.#original?.operation === "maintenance-proposal" && this.#original.fields === JSON.stringify(adoption);
    const adoptionDirty = adoption && !adoptionOriginalMatches && (adoption.title !== "" || adoption.evidence !== "" || adoption.ownerUserId !== actor || adoption.nomination !== "");
    const lookup = this.#lookupForm();
    const lookupDirty = includeLookup && lookup && String(new FormData(lookup).get("publicationId") ?? "") !== "";
    return Boolean(proposalDirty || adoptionDirty || actionDirty || lookupDirty || this.#patchForm()?.getAttribute("data-experience-dirty") === "true");
  }
  captureCommandDeparture(): Departure {
    const currentOwner = this.#capture(false), form = this.#form(), patchForm = this.#patchForm(), actionForm = this.#actionForm(), lookupForm = this.#lookupForm(), adoptionForm = this.#adoptionForm();
    let retired = false;
    return { element: this, current: () => {
      if (!currentOwner() || form !== this.#form() || patchForm !== this.#patchForm()
        || actionForm !== this.#actionForm() || lookupForm !== this.#lookupForm() || adoptionForm !== this.#adoptionForm()) retired = true;
      return !retired;
    }, blocked: () => this.#saving || this.#busy && this.#dirty() || this.#dirty(), reason: () => "next.lifecycle.currentWorkOpen" };
  }
  #canSwitch() { return !this.#saving && !this.#dirty() && !this.#uncertain; }

  async #json(path: string, current: () => boolean, version: number, init?: RequestInit, authorityCurrent = current) {
    if (!current() || version !== this.#readVersion) throw new Error("retired");
    const response = await fetch(endpoint + path, { credentials: "same-origin", cache: "no-store", ...init });
    if (!authorityCurrent()) { await cancelBody(response); throw new Error("retired"); }
    if ([401, 403, 404].includes(response.status)) {
      if (version > this.#certifiedRead) this.retireAccess();
      await cancelBody(response);
      throw new Error("denied");
    }
    if (!current()) { await cancelBody(response); throw new Error("retired"); }
    if (!response.ok) { await cancelBody(response); throw new Error("unavailable"); }
    if (version !== this.#readVersion) { await cancelBody(response); throw new Error("retired"); }
    const value: unknown = await response.json();
    if (!current()) throw new Error("retired");
    return value;
  }

  async refresh() {
    if (!this.#context.available || !this.#scope() || !this.isConnected || this.#saving) return;
    this.#clearMaintenance();
    const current = this.#capture(), version = ++this.#readVersion, selected = this.#selected, decisionId = this.#decision?.decision.decisionId;
    this.#busy = true; this.#governanceReady = false; this.#latestNominations = null; this.#notice = ""; this.requestUpdate();
    try {
      const inventory = readExperienceMaterialInventory(await this.#json("/materials", current, version));
      if (!inventory) throw new Error("unavailable");
      let detail: ExperienceMaterialDetail | null = null, head: Head | null = null, decision = this.#decision, decisionHead: HeadRead | null = null;
      if (decisionId) {
        if (validMaintenanceDecisionId(decisionId)) {
          decision = await readMaintenanceAdoptionDecision(await this.#json("/maintenance/adoption-decisions/" + encodeURIComponent(decisionId), current, version), decisionId);
          if (!decision) throw new Error("unavailable");
        } else {
          decision = await readExperienceReviewDecision(await this.#json("/decisions/" + encodeURIComponent(decisionId), current, version), decisionId);
          if (!decision) throw new Error("unavailable");
          decisionHead = readExperienceReviewHeadState(await this.#json("/heads/" + encodeURIComponent(decision.binding.experienceId)
            + "?channel=managed-fixture", current, version), decision.binding.experienceId);
          if (!decisionHead) throw new Error("unavailable");
        }
      }
      if (selected) {
        if (!inventory.materials.some(row => selectionKey(row.selection) === selectionKey(selected.selection))) {
          if (current() && version === this.#readVersion) this.retireAccess();
          return;
        }
        const params = new URLSearchParams(selected.selection);
        detail = await readExperienceMaterialDetail(await this.#json("/materials/detail?" + params, current, version));
        if (!detail || canonicalJson(detail.material) !== canonicalJson(selected)) throw new Error("unavailable");
        head = readExperienceReviewHead(await this.#json("/heads/" + encodeURIComponent(selected.experienceId)
          + "?channel=managed-fixture", current, version), selected.experienceId);
        if (!head) throw new Error("unavailable");
      }
      let nominations: MaintenanceAdoptionNominations | null = null;
      if (detail && this.#nominations?.detail === this.#detail) {
        nominations = await readMaintenanceAdoptionNominations(await this.#json("/maintenance/adoption-nominations?" + new URLSearchParams(detail.material.selection), current, version),
          { base: detail.material.selection, experienceId: detail.material.experienceId });
        if (!nominations) throw new Error("unavailable");
      }
      if (!current() || version !== this.#readVersion) return;
      this.#certifiedRead = version; this.#inventory = inventory; this.#denied = false;
      this.#latestNominations = nominations;
      this.#latestDecision = decision; this.#decisionHead = decisionHead;
      this.#governanceReady = Boolean(decision && (isMaintenanceReviewDecision(decision) || decisionHead));
      this.#latestHead = head;
      if (!this.#detail && detail) {
        this.#detail = detail; this.#head = head;
        this.#order = detail.release.definition.decisions.map(decision => decision.id);
      }
    } catch {
      if (current() && version === this.#readVersion) this.#notice = "unavailable";
    } finally {
      if (current() && version === this.#readVersion) { this.#busy = false; this.requestUpdate(); }
    }
  }

  async selectMaterial(material: ExperienceMaterialSummary) {
    if (this.#busy || !this.#canSwitch() || !this.#inventory?.materials.some(row => canonicalJson(row) === canonicalJson(material))) return;
    this.#clearMaintenance(); this.#clearAdoption();
    this.#selected = material; this.#detail = null; this.#head = null; this.#latestHead = null;
    this.#historical = null; this.#latestDecision = null; this.#decisionHead = null; this.#actionEpoch++;
    this.#governanceReady = false;
    this.#proposalEpoch++;
    this.#decision = null; this.#preview = null; this.requestUpdate();
    await this.refresh();
  }

  async openDecision(decisionId: string) {
    if (!this.#canSwitch()) { this.#notice = this.#uncertain ? "uncertain" : "draft"; this.requestUpdate(); return; }
    if (this.#busy || !(validExperienceDecisionId(decisionId) || validMaintenanceDecisionId(decisionId)) || !this.#context.available || !this.#scope()) return;
    const current = this.#capture(), version = ++this.#readVersion;
    const originalForm = this.#form(), originalAdoptionForm = this.#adoptionForm(), originalDetail = this.#detail;
    this.#busy = true; this.#governanceReady = false; this.#notice = ""; this.requestUpdate();
    try {
      const maintenance = validMaintenanceDecisionId(decisionId);
      const decision: ReviewedDecision | null = maintenance
        ? await readMaintenanceAdoptionDecision(await this.#json("/maintenance/adoption-decisions/" + encodeURIComponent(decisionId), current, version), decisionId)
        : await readExperienceReviewDecision(await this.#json("/decisions/" + encodeURIComponent(decisionId), current, version), decisionId);
      if (!decision) throw new Error("unavailable");
      const decisionHead = maintenance ? null : readExperienceReviewHeadState(await this.#json("/heads/" + encodeURIComponent(decision.binding.experienceId)
        + "?channel=managed-fixture", current, version), decision.binding.experienceId);
      if (!maintenance && !decisionHead) throw new Error("unavailable");
      if (!current() || version !== this.#readVersion) return;
      if (!this.#canSwitch() || originalForm !== this.#form() || originalAdoptionForm !== this.#adoptionForm() || originalDetail !== this.#detail) {
        this.#notice = "draft"; return;
      }
      this.#certifiedRead = version; this.#denied = false; this.#decision = decision;
      this.#latestDecision = decision; this.#decisionHead = decisionHead; this.#historical = null; this.#actionEpoch++;
      this.#governanceReady = true;
      this.#clearMaintenance(); this.#clearAdoption();
      this.#selected = null; this.#detail = null; this.#head = null; this.#latestHead = null;
      this.#proposalEpoch++;
      this.#preview = null;
    } catch { if (current() && version === this.#readVersion) this.#notice = "unavailable"; }
    finally { if (current() && version === this.#readVersion) { this.#busy = false; this.requestUpdate(); } }
  }

  #patch(): ExperiencePatch | null {
    const form = this.#patchForm(), detail = this.#detail;
    if (!form || !detail) return null;
    const layout = new FormData(form).get("layout");
    if (layout !== "stage-and-controls" && layout !== "stacked-stage") return null;
    return { schemaVersion: 1, baseReleaseHash: detail.release.releaseHash,
      operations: [{ kind: "set-layout", layout }, { kind: "reorder-decisions", ids: [...this.#order] }] };
  }
  #ownsControl(event: Event, detail?: ExperienceMaterialDetail, allowDenied = false) {
    const control = event.currentTarget;
    return this.#capture()() && (allowDenied || !this.#denied) && control instanceof HTMLElement && control.isConnected
      && this.contains(control) && (!detail || detail === this.#detail);
  }
  #patchChanged(event?: Event, detail?: ExperienceMaterialDetail) {
    if (event && (!this.#ownsControl(event, detail) || event.currentTarget !== this.#patchForm())) return;
    this.#patchForm()?.setAttribute("data-experience-dirty", "true");
    this.#clearMaintenance(true);
    this.#preview = null; this.requestUpdate();
  }
  #composition(event: CompositionEvent, active: boolean) {
    const form = event.currentTarget;
    if (![this.#form(), this.#adoptionForm(), this.#actionForm(), this.#lookupForm()].includes(form as HTMLFormElement)
      || !(form instanceof HTMLFormElement) || !form.isConnected || !this.contains(form)) return;
    if (active) this.#composing = form;
    else if (this.#composing === form) this.#composing = null;
    this.requestUpdate();
  }
  #move(event: Event, detail: ExperienceMaterialDetail, id: string, offset: -1 | 1) {
    if (!this.#ownsControl(event, detail) || !this.#patchForm()?.contains(event.currentTarget as Node)
      || this.#saving || this.#busy || !this.#detail || this.#denied) return;
    const index = this.#order.indexOf(id), next = index + offset;
    if (index < 0 || next < 0 || next >= this.#order.length) return;
    const order = [...this.#order]; [order[index], order[next]] = [order[next], order[index]];
    this.#order = order; this.#patchChanged();
    const button = event.currentTarget as HTMLButtonElement;
    if (document.activeElement === button && (next === 0 && offset === -1 || next === order.length - 1 && offset === 1)) {
      // Native disabling and moving a keyed row can each blur focus. Yield to intervening user input/focus.
      const peer = button.parentElement?.querySelector<HTMLButtonElement>(`button[data-experience-move="${-offset}"]`);
      if (peer?.isConnected) {
        peer.disabled = false; peer.focus({ preventScroll: true });
        const current = this.#capture(), form = this.#patchForm();
        let newerFocus = false;
        const focusChanged = (event: FocusEvent) => { if (event.target !== peer) newerFocus = true; };
        const userInput = () => { newerFocus = true; };
        document.addEventListener("focusin", focusChanged, true);
        document.addEventListener("pointerdown", userInput, true);
        document.addEventListener("keydown", userInput, true);
        const cleanup = () => {
          document.removeEventListener("focusin", focusChanged, true);
          document.removeEventListener("pointerdown", userInput, true);
          document.removeEventListener("keydown", userInput, true);
        };
        void this.updateComplete.then(() => {
          try {
            if (!newerFocus && current() && this.#detail === detail && this.#order === order && form === this.#patchForm()
              && peer.isConnected && !peer.disabled && (document.activeElement === peer || document.activeElement === document.body)) {
              peer.focus({ preventScroll: true });
            }
          } finally { cleanup(); }
        }).catch(cleanup);
      }
    }
  }
  async #previewSubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = this.#patchForm(), detail = this.#detail, patch = this.#patch();
    if (event.currentTarget !== form || !form?.isConnected || !detail || !patch || this.#saving || this.#busy || this.#denied) return;
    const currentOwner = this.#capture(), version = ++this.#readVersion;
    const current = () => currentOwner() && form === this.#patchForm() && detail === this.#detail;
    this.#busy = true; this.#notice = ""; this.requestUpdate();
    try {
      const value = await this.#json("/preview", current, version, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, base: detail.material.selection, patch }) });
      const preview = await readExperienceMaterialPreview(value, { detail, patch });
      if (!preview) throw new Error("unavailable");
      if (!current() || version !== this.#readVersion || canonicalJson(patch) !== canonicalJson(this.#patch())) return;
      this.#certifiedRead = version; this.#preview = preview;
    } catch { if (current() && version === this.#readVersion) this.#notice = "unavailable"; }
    finally { if (current() && version === this.#readVersion) { this.#busy = false; this.requestUpdate(); } }
  }
  #resetDraft(event: Event, detail: ExperienceMaterialDetail) {
    if (!this.#ownsControl(event, detail) || this.#saving || this.#busy || this.#uncertain || this.#composing?.isConnected || !this.#detail || this.#denied) return;
    this.#clearMaintenance(true);
    this.#adoptionEpoch++;
    this.#nominations = this.#latestNominations ? Object.freeze({ detail, value: this.#latestNominations }) : null;
    // Only this explicit discard remounts proposal controls with the actor default.
    this.#proposalEpoch++; this.#patchForm()?.reset(); this.#patchForm()?.removeAttribute("data-experience-dirty");
    this.#order = this.#detail.release.definition.decisions.map(decision => decision.id);
    this.#head = this.#latestHead; this.#preview = null; this.#notice = ""; this.requestUpdate();
  }
  #headChanged() { return canonicalJson(this.#head) !== canonicalJson(this.#latestHead); }
  async #propose(event?: SubmitEvent) {
    event?.preventDefault();
    const form = this.#form();
    if (event && event.currentTarget !== form || !this.#writable() || this.#saving || this.#busy
      || this.#composing && this.#composing === form) return;
    if (this.#uncertain) { if (this.#original?.operation === "proposal") await this.#runOriginal(); return; }
    const fields = this.#fields(), detail = this.#detail, session = platformSession.get()!;
    if (!fields || !form?.isConnected || !detail || !this.#head || this.#headChanged()
      || !this.#context.owners.some(owner => owner.userId === fields.ownerUserId) || !form.reportValidity()) return;
    const historical = this.#historical;
    const intent = readExperienceProposal({ version: 1, requestId: crypto.randomUUID(), title: fields.title.trim(),
      ownerUserId: fields.ownerUserId, evidence: fields.evidence.trim(), dependencyIds: [],
      binding: { version: 1, operation: historical ? "rollback" : "publish", channel: "managed-fixture", experienceId: detail.material.experienceId,
        ...detail.material.selection, expectedHead: this.#head, rollbackPublicationEventId: historical?.eventId ?? null } });
    if (!intent || historical && canonicalJson(selectionOf(historical.result.binding)) !== canonicalJson(detail.material.selection)) {
      this.#notice = "invalid"; this.requestUpdate(); return;
    }
    this.#original = Object.freeze({ operation: "proposal", intent, actorUserId: session.user.userId,
      scope: this.#scope(), session, fields: JSON.stringify(fields) });
    await this.#runOriginal();
  }
  #decisionChanged() {
    const selected = this.#decision, latest = this.#latestDecision;
    if (!selected || !latest) return true;
    if (isMaintenanceReviewDecision(selected)) {
      // Head eligibility may change without changing this decision. Preserve
      // explicit revocation of a stale adoption; only Approve/Adopt need its head.
      return !isMaintenanceReviewDecision(latest) || canonicalJson({ decision: selected.decision, binding: selected.binding, bindingHash: selected.bindingHash })
        !== canonicalJson({ decision: latest.decision, binding: latest.binding, bindingHash: latest.bindingHash });
    }
    return canonicalJson(selected) !== canonicalJson(latest);
  }
  #decisionHeadMatches(selected: ReviewedDecision) {
    if (isMaintenanceReviewDecision(selected)) {
      const latest = this.#latestDecision;
      return Boolean(latest && isMaintenanceReviewDecision(latest)
        && maintenanceBindingMatchesHead(selected.binding, latest.headState, latest));
    }
    return Boolean(this.#decisionHead && canonicalJson(this.#decisionHead.expectedHead) === canonicalJson(selected.binding.expectedHead));
  }
  #approvalEligible(selected: ReviewedDecision) {
    return isMaintenanceReviewDecision(selected) ? Boolean(this.#latestDecision && isMaintenanceReviewDecision(this.#latestDecision)
      && this.#latestDecision.eligible && this.#latestDecision.approvalEventId === selected.approvalEventId) : selected.approvalEligible;
  }
  #releaseAuthority() { return this.#writable() && this.#context.approvalAuthority === true; }
  #canTransition(status: DeliveryDecisionStatus) {
    const row = this.#decision?.decision;
    if (!row || !this.#writable() || !this.#governanceReady || this.#decisionChanged() || !deliveryTransitionAllowed(row.status, status)
      || !this.#context.owners.some(owner => owner.userId === row.ownerUserId)) return false;
    if ((deliveryNeedsReleaseAuthority(status) || ["approved", "revoked"].includes(row.status)) && !this.#releaseAuthority()) return false;
    // The read DTO does not expose the original creator. The server also excludes
    // that creator and re-proves the approver and both owner identities at commit.
    return status !== "approved" || row.ownerUserId !== platformSession.get()?.user.userId
      && Boolean(this.#decision && this.#decisionHeadMatches(this.#decision));
  }
  async #transition(event: SubmitEvent) {
    event.preventDefault();
    const form = this.#actionForm(), selected = this.#decision, fields = this.#actionFields();
    if (!this.#ownsControl(event) || event.currentTarget !== form || !form?.isConnected || !selected || !fields
      || this.#busy || this.#saving || this.#uncertain || this.#composing === form) return;
    const submitter = event.submitter;
    if (!(submitter instanceof HTMLButtonElement) || !form.contains(submitter) || submitter.disabled) return;
    const action = submitter.getAttribute("data-experience-transition");
    const status = action === "record" ? canonicalDeliveryStatus(fields.status) : action === "approved" || action === "revoked" ? action : null;
    if (!status || action === "record" && (status === selected.decision.status || status === "approved" || status === "revoked") || !this.#canTransition(status)) return;
    const evidence = form.elements.namedItem("evidence") as HTMLTextAreaElement | null;
    if (!evidence) return;
    evidence.setCustomValidity(deliveryNeedsEvidence(status) && !fields.evidence.trim() ? this.#label("Evidence required") : "");
    if (!form.reportValidity()) return;
    const session = platformSession.get()!;
    const common = { version: 1, requestId: crypto.randomUUID(), decisionId: selected.decision.decisionId,
      expectedUpdatedAt: selected.decision.updatedAt, title: selected.decision.title, ownerUserId: selected.decision.ownerUserId,
      evidence: fields.evidence.trim(), status };
    if (isMaintenanceReviewDecision(selected)) {
      const intent = readMaintenanceAdoptionTransition({ ...common, maintenanceAdoption: selected.binding });
      if (!intent) { this.#notice = "invalid"; this.requestUpdate(); return; }
      this.#original = Object.freeze({ operation: "maintenance-transition", intent, previous: selected, actorUserId: session.user.userId,
        session, scope: this.#scope(), fields: JSON.stringify(fields) });
    } else {
      const intent = readExperienceTransition({ ...common, experienceRelease: selected.binding });
      if (!intent) { this.#notice = "invalid"; this.requestUpdate(); return; }
      this.#original = Object.freeze({ operation: "transition", intent, previous: selected, actorUserId: session.user.userId,
        session, scope: this.#scope(), fields: JSON.stringify(fields) });
    }
    await this.#runOriginal();
  }
  async #adopt(event: Event, selected: MaintenanceAdoptionDecision) {
    if (!this.#ownsControl(event) || selected !== this.#decision || !this.#releaseAuthority()
      || this.#busy || this.#saving || this.#uncertain || this.#dirty() || !this.#governanceReady || this.#decisionChanged()
      || selected.decision.status !== "approved" || !this.#approvalEligible(selected) || !selected.approvalEventId
      || !this.#decisionHeadMatches(selected)) return;
    const intent = readMaintenanceAdoptionIntent({ version: 1, requestId: crypto.randomUUID(), decisionId: selected.decision.decisionId,
      expectedDecisionUpdatedAt: selected.decision.updatedAt, approvalEventId: selected.approvalEventId, binding: selected.binding });
    if (!intent) return;
    const session = platformSession.get()!;
    this.#original = Object.freeze({ operation: "maintenance-adoption", intent, actorUserId: session.user.userId,
      session, scope: this.#scope(), fields: JSON.stringify(this.#actionFields()) });
    await this.#runOriginal();
  }
  async #publish(event: Event, selected: DecisionRead) {
    if (!this.#ownsControl(event) || selected !== this.#decision || !this.#releaseAuthority()
      || this.#busy || this.#saving || this.#uncertain || this.#dirty() || !this.#governanceReady || this.#decisionChanged()
      || selected.decision.status !== "approved" || !selected.approvalEligible || !selected.approvalEventId
      || !this.#decisionHead || canonicalJson(this.#decisionHead.expectedHead) !== canonicalJson(selected.binding.expectedHead)) return;
    const intent = readExperiencePublication({ version: 1, requestId: crypto.randomUUID(), decisionId: selected.decision.decisionId,
      expectedDecisionUpdatedAt: selected.decision.updatedAt, approvalEventId: selected.approvalEventId, binding: selected.binding });
    if (!intent) return;
    const session = platformSession.get()!;
    this.#original = Object.freeze({ operation: "publication", intent, actorUserId: session.user.userId,
      session, scope: this.#scope(), fields: JSON.stringify(this.#actionFields()) });
    await this.#runOriginal();
  }
  async #runOriginal(checkOnly = false) {
    const submitted = this.#original, session = platformSession.get();
    if (!submitted || !session || !this.#writable() || this.#saving || this.#busy
      || submitted.actorUserId !== session.user.userId || submitted.scope !== this.#scope() || submitted.session !== session) return;
    const currentOwner = this.#capture(), operation = {}, form = this.#form(), adoptionForm = this.#adoptionForm();
    const actionForm = this.#actionForm();
    const focusOrigin = document.activeElement, focusOwned = focusOrigin instanceof HTMLElement && this.contains(focusOrigin);
    const focus = this.#captureFocusRecovery(focusOrigin);
    let refreshOpen = false, refreshRegistered = false, refreshValid = true;
    let refreshed: Promise<boolean> = Promise.resolve(true);
    const registerDeliveryRefresh = (completion: Promise<unknown>) => {
      // Only the existing synchronous parent listener may add one completion.
      // Late/duplicate registration never extends the barrier or grants focus.
      const settled = Promise.resolve(completion).then(() => true, () => false);
      if (!refreshOpen || refreshRegistered) { refreshValid = false; return; }
      refreshRegistered = true; refreshed = settled;
    };
    const current = () => currentOwner() && this.#operation === operation && this.#original === submitted;
    let reopen: string | null = null, retainActionDraft = false;
    let acknowledgment: Readonly<{ operation: Original["operation"]; eventId: string }> | null = null;
    let clearDraft: (() => Promise<void>) | null = null;
    try {
      this.#operation = operation; this.#saving = true; this.#notice = ""; this.requestUpdate();
      this.#uncertain = true;
      let url: string, method: "POST" | "PATCH";
      switch (submitted.operation) {
        case "proposal": url = endpoint + "/decisions"; method = "POST"; break;
        case "transition": url = endpoint + "/decisions/" + encodeURIComponent(submitted.intent.decisionId); method = "PATCH"; break;
        case "publication": url = endpoint + "/publications"; method = "POST"; break;
        case "maintenance-proposal": url = endpoint + "/maintenance/adoption-proposals"; method = "POST"; break;
        case "maintenance-transition": url = "/api/portfolio/product/delivery"; method = "PATCH"; break;
        case "maintenance-adoption": url = endpoint + "/maintenance/adoptions"; method = "POST"; break;
      }
      if (checkOnly) {
        switch (submitted.operation) {
          case "proposal": case "transition": case "publication":
            url = endpoint + "/requests/" + submitted.intent.requestId + "?operation=" + submitted.operation; break;
          case "maintenance-proposal": case "maintenance-transition": case "maintenance-adoption":
            url = endpoint + "/maintenance/adoption-operations/" + submitted.operation + "/" + submitted.intent.requestId; break;
        }
      }
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store",
        ...(checkOnly ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(submitted.intent) }) });
      if (!current()) { await cancelBody(response); return; }
      if ([401, 403].includes(response.status) || response.status === 404 && !checkOnly) {
        this.retireAccess(); await cancelBody(response); return;
      }
      if (!response.ok) { await cancelBody(response); this.#notice = "uncertain"; return; }
      const value: unknown = await response.json();
      if (!current()) return;
      let acknowledged: Readonly<{ receipt: Readonly<{ eventId: string }>; result: unknown }> | null = null;
      switch (submitted.operation) {
        case "proposal": {
          const receipt = await readExperienceOperationReceipt(value, { operation: submitted.operation, actorUserId: submitted.actorUserId, intent: submitted.intent });
          if (receipt && await readExperienceReviewProposalResult(receipt.result, submitted.intent)) acknowledged = receipt;
          break;
        }
        case "transition": {
          const receipt = await readExperienceOperationReceipt(value, { operation: submitted.operation, actorUserId: submitted.actorUserId, intent: submitted.intent });
          if (receipt && await readExperienceReviewTransitionResult(receipt.result, submitted.intent, submitted.previous, receipt.receipt.eventId)) acknowledged = receipt;
          break;
        }
        case "publication": {
          const receipt = await readExperienceOperationReceipt(value, { operation: submitted.operation, actorUserId: submitted.actorUserId, intent: submitted.intent });
          if (receipt && await readExperienceReviewPublicationResult(receipt.result, submitted.intent, receipt.receipt.eventId)) acknowledged = receipt;
          break;
        }
        case "maintenance-proposal": case "maintenance-adoption":
          acknowledged = await readMaintenanceAdoptionAcknowledgment(value, { operation: submitted.operation, actorUserId: submitted.actorUserId, intent: submitted.intent }); break;
        case "maintenance-transition":
          acknowledged = await readMaintenanceAdoptionAcknowledgment(value, { operation: submitted.operation, actorUserId: submitted.actorUserId, intent: submitted.intent, priorDecision: submitted.previous.decision }); break;
      }
      if (!current()) return;
      if (!acknowledged) { this.#notice = "uncertain"; return; }
      this.#uncertain = false; this.#original = null;
      this.#acknowledgment = acknowledgment = Object.freeze({ operation: submitted.operation, eventId: acknowledged.receipt.eventId });
      this.#notice = "acknowledged";
      const active = document.activeElement;
      const retainedForm = submitted.operation === "proposal" ? form : submitted.operation === "maintenance-proposal" ? adoptionForm : null;
      if (active instanceof HTMLElement && retainedForm?.contains(active)) {
        let refreshedDraft = false;
        const clear = this.#prepareFocusClearance(active, () => currentOwner() && refreshedDraft && refreshValid && refreshRegistered
          && this.#acknowledgment === acknowledgment && document.activeElement === active && retainedForm.isConnected
          && active.closest("form") === retainedForm
          && retainedForm === (submitted.operation === "proposal" ? this.#form() : this.#adoptionForm())
          && !this.#operation && !this.#busy && !this.#saving && !this.#uncertain && !this.#denied);
        clearDraft = () => clear(Promise.all([this.updateComplete, refreshed]).then(async ([, succeeded]) => {
          refreshedDraft = refreshValid && refreshRegistered && succeeded;
          await this.updateComplete;
        }));
      }
      if (submitted.operation === "proposal") {
        if (form && form === this.#form() && this.#composing !== form && submitted.fields === JSON.stringify(this.#fields(form))) this.#proposalEpoch++;
      } else if (submitted.operation === "maintenance-proposal") {
        if (adoptionForm && adoptionForm === this.#adoptionForm() && this.#composing !== adoptionForm
          && submitted.fields === JSON.stringify(this.#adoptionFields())) this.#adoptionEpoch++;
      } else {
        retainActionDraft = Boolean(actionForm && actionForm === this.#actionForm()
          && (this.#composing === actionForm || submitted.fields !== JSON.stringify(this.#actionFields())));
        this.#governanceReady = false;
        if (!retainActionDraft) {
          reopen = submitted.intent.decisionId;
          this.#decision = null; this.#latestDecision = null; this.#decisionHead = null; this.#actionEpoch++;
        }
      }
      refreshOpen = true;
      try {
        this.dispatchEvent(new CustomEvent<ExperienceOperationSavedDetail>(
          submitted.operation === "proposal" || submitted.operation === "maintenance-proposal"
            ? "experience-proposal-saved" : "experience-operation-saved",
          { bubbles: true, composed: true, detail: { registerDeliveryRefresh } }));
      } finally { refreshOpen = false; }
    } catch { if (current()) this.#notice = "uncertain"; }
    finally {
      try {
        if (this.#operation === operation) {
          this.#operation = null; this.#saving = false; this.requestUpdate();
          // A positive original cannot consume newer native fields or an IME
          // draft. Refresh only the latest witness; explicit Reset owns rebasing.
          if (retainActionDraft && currentOwner()) await this.refresh();
          if (reopen && currentOwner()) {
            try {
              await this.updateComplete;
              if (currentOwner() && this.#acknowledgment === acknowledgment) {
                const expectedRead = this.#readVersion + 1;
                await this.openDecision(reopen);
                const refreshSucceeded = await refreshed;
                const readVersion = this.#readVersion, actionEpoch = this.#actionEpoch, context = this.#context, decision = this.#decision;
                await this.updateComplete;
                const target = this.querySelector<HTMLElement>("[data-experience-acknowledgment]");
                const ownsFocus = () => currentOwner() && refreshValid && refreshSucceeded && this.#acknowledgment === acknowledgment
                  && readVersion === expectedRead && readVersion === this.#readVersion && actionEpoch === this.#actionEpoch
                  && context === this.#context && decision === this.#decision && decision?.decision.decisionId === reopen
                  && !this.#operation && !this.#busy && !this.#saving && !this.#uncertain && !this.#denied && !this.#composing?.isConnected
                  && focusOwned && focusOrigin instanceof HTMLElement && !this.contains(focusOrigin)
                  && target === this.querySelector("[data-experience-acknowledgment]");
                if (target && ownsFocus()) focus.restore(target, ownsFocus);
              }
            } catch { /* A failed refresh/render suppresses focus recovery, never the already validated acknowledgment. */ }
          }
        }
      } finally {
        try { if (clearDraft) await clearDraft(); } finally { focus.dispose(); }
      }
    }
  }
  #retry(event: Event, original: Original | null, checkOnly = false) {
    if (!this.#ownsControl(event) || !original || original !== this.#original || !this.#uncertain) return;
    void this.#runOriginal(checkOnly);
  }
  async #resetDecision(event: Event, selected: ReviewedDecision) {
    const form = this.#actionForm(), control = event.currentTarget;
    if (!this.#ownsControl(event) || selected !== this.#decision || !form?.isConnected
      || !(control instanceof HTMLButtonElement) || control.disabled || !form.contains(control)
      || control !== this.querySelector("button.experience-review-action-reset")
      || this.#saving || this.#busy || this.#uncertain || this.#composing?.isConnected) return;
    const currentOwner = this.#capture(), context = this.#context, detail = this.#detail, version = this.#readVersion;
    const decision = this.#latestDecision, focus = this.#captureFocusRecovery(control), epoch = ++this.#actionEpoch;
    this.#decision = decision;
    try {
      this.#notice = ""; this.requestUpdate();
      await this.updateComplete;
      const successor = this.#actionForm(), target = this.querySelector<HTMLButtonElement>("button.experience-review-action-reset");
      if (!successor || !target) return;
      focus.restore(target, () => currentOwner() && context === this.#context && detail === this.#detail && version === this.#readVersion
        && epoch === this.#actionEpoch && decision === this.#decision && decision === this.#latestDecision
        && decision?.decision.decisionId === selected.decision.decisionId
        && successor === this.#actionForm() && successor !== form && successor.isConnected && !form.isConnected
        && target !== control && !control.isConnected && successor.contains(target)
        && target === this.querySelector("button.experience-review-action-reset")
        && !this.#busy && !this.#saving && !this.#uncertain && !this.#denied && !this.#composing?.isConnected);
    } catch { /* A reset or render failure never grants a new focus owner. */ }
    finally { focus.dispose(); }
  }
  async #loadPublication(event: SubmitEvent) {
    event.preventDefault();
    const form = this.#lookupForm();
    if (!this.#ownsControl(event) || event.currentTarget !== form || !form?.isConnected || this.#busy || this.#saving
      || this.#uncertain || this.#dirty(false) || this.#composing === form || !form.reportValidity()) return;
    const id = String(new FormData(form).get("publicationId") ?? "");
    if (!experienceEventId(id)) { this.#notice = "invalid"; this.requestUpdate(); return; }
    const currentOwner = this.#capture(), version = ++this.#readVersion;
    const current = () => currentOwner() && this.#lookupForm() === form
      && String(new FormData(form).get("publicationId") ?? "") === id && !this.#dirty(false);
    this.#busy = true; this.#notice = ""; this.requestUpdate();
    try {
      const historical = await readExperienceReviewHistoricalPublication(await this.#json("/publications/" + encodeURIComponent(id), current, version, undefined, currentOwner), id);
      if (!historical) throw new Error("unavailable");
      const target = historical.result;
      const decision = await readExperienceReviewDecision(await this.#json("/decisions/" + encodeURIComponent(target.decisionId), current, version, undefined, currentOwner), target.decisionId);
      if (!decision || !decision.approvalEligible
        || canonicalJson(decision.binding) !== canonicalJson(target.binding)) throw new Error("unavailable");
      const detail = await readExperienceMaterialDetail(await this.#json("/materials/detail?" + new URLSearchParams(selectionOf(target.binding)), current, version, undefined, currentOwner));
      if (!detail || canonicalJson(detail.material.selection) !== canonicalJson(selectionOf(target.binding))
        || detail.material.experienceId !== target.binding.experienceId) throw new Error("unavailable");
      const head = readExperienceReviewHead(await this.#json("/heads/" + encodeURIComponent(target.binding.experienceId)
        + "?channel=managed-fixture", current, version, undefined, currentOwner), target.binding.experienceId);
      if (!head) throw new Error("unavailable");
      if (!current() || version !== this.#readVersion) return;
      this.#certifiedRead = version; this.#denied = false; this.#historical = historical;
      this.#clearMaintenance(); this.#clearAdoption();
      this.#selected = detail.material; this.#detail = detail; this.#head = head; this.#latestHead = head;
      this.#decision = null; this.#latestDecision = null; this.#decisionHead = null; this.#actionEpoch++; this.#proposalEpoch++;
      this.#governanceReady = false;
      this.#preview = null; this.#order = detail.release.definition.decisions.map(row => row.id); form.reset();
    } catch { if (currentOwner() && version === this.#readVersion) this.#notice = "unavailable"; }
    finally { if (currentOwner() && version === this.#readVersion) { this.#busy = false; this.requestUpdate(); } }
  }

  #clearAdoption() {
    this.#adoptionEpoch++; this.#nominations = null; this.#latestNominations = null;
  }
  #hasAdoptionDraft() {
    const fields = this.#adoptionFields(), actor = platformSession.get()?.user.userId ?? "";
    return Boolean(fields && (fields.title !== "" || fields.evidence !== "" || fields.ownerUserId !== actor || fields.nomination !== ""));
  }
  #nomination() {
    const id = this.#adoptionFields()?.nomination;
    return this.#nominations?.value.nominations.find(row => row.bindingHash === id) ?? null;
  }
  #nominationCurrent() {
    const nomination = this.#nomination(), latest = this.#latestNominations;
    return Boolean(nomination && latest && latest.nominations.some(row => canonicalJson(row) === canonicalJson(nomination))
      && maintenanceBindingMatchesHead(nomination.binding, latest.headState, latest));
  }
  async #loadNominations(event: Event, detail: ExperienceMaterialDetail) {
    const section = this.#maintenanceSection(), form = this.#adoptionForm(), fields = JSON.stringify(this.#adoptionFields());
    if (!this.#ownsMaintenanceControl(event, detail) || !section || this.#busy || this.#saving
      || this.#uncertain || this.#composing?.isConnected || this.#hasAdoptionDraft()) return;
    const currentOwner = this.#capture(), version = ++this.#readVersion, epoch = this.#adoptionEpoch;
    const current = () => currentOwner() && detail === this.#detail && section === this.#maintenanceSection() && section.isConnected
      && epoch === this.#adoptionEpoch && form === this.#adoptionForm() && fields === JSON.stringify(this.#adoptionFields()) && !this.#historical;
    const control = event.currentTarget as HTMLButtonElement, focus = this.#captureFocusRecovery(control);
    this.#busy = true; this.#notice = ""; this.#latestNominations = null; this.requestUpdate();
    try {
      const nominations = await readMaintenanceAdoptionNominations(await this.#json("/maintenance/adoption-nominations?" + new URLSearchParams(detail.material.selection), current, version, undefined, currentOwner),
        { base: detail.material.selection, experienceId: detail.material.experienceId });
      if (!nominations) throw new Error("unavailable");
      if (!current() || version !== this.#readVersion || this.#composing?.isConnected) return;
      this.#certifiedRead = version;
      this.#nominations = Object.freeze({ detail, value: nominations }); this.#latestNominations = nominations;
    } catch { if (current() && version === this.#readVersion) this.#notice = "unavailable"; }
    finally {
      try {
        if (currentOwner() && version === this.#readVersion) {
          this.#busy = false; this.requestUpdate();
          try {
            await this.updateComplete;
            focus.restore(control, () => currentOwner() && version === this.#readVersion && detail === this.#detail
              && epoch === this.#adoptionEpoch && section === this.#maintenanceSection()
              && control === section.querySelector("[data-experience-adoption-load]")
              && !this.#busy && !this.#saving && !this.#uncertain && !this.#composing?.isConnected && !this.#hasAdoptionDraft());
          } catch { /* Loading nominations never grants a new focus owner. */ }
        }
      } finally { focus.dispose(); }
    }
  }
  async #resetAdoption(event: Event, detail: ExperienceMaterialDetail) {
    const form = this.#adoptionForm(), section = this.#maintenanceSection(), control = event.currentTarget;
    if (!this.#ownsControl(event, detail) || !form?.isConnected || !section?.contains(form)
      || !(control instanceof HTMLButtonElement) || control.disabled || control !== form.querySelector("[data-experience-adoption-reset]")
      || this.#busy || this.#saving || this.#uncertain || this.#composing?.isConnected) return;
    const currentOwner = this.#capture(), context = this.#context, version = this.#readVersion;
    const load = section.querySelector<HTMLButtonElement>("[data-experience-adoption-load]");
    const focus = this.#captureFocusRecovery(control), epoch = ++this.#adoptionEpoch;
    this.#nominations = this.#latestNominations ? Object.freeze({ detail, value: this.#latestNominations }) : null;
    const nominations = this.#nominations;
    try {
      this.#notice = ""; this.requestUpdate();
      await this.updateComplete;
      const successorForm = this.#adoptionForm();
      const target = successorForm ? successorForm.querySelector<HTMLButtonElement>("[data-experience-adoption-reset]") : load;
      if (!target) return;
      focus.restore(target, () => currentOwner() && context === this.#context && version === this.#readVersion
        && detail === this.#detail && epoch === this.#adoptionEpoch && nominations === this.#nominations
        && section === this.#maintenanceSection() && section.isConnected && !form.isConnected
        && successorForm === this.#adoptionForm() && successorForm !== form
        && (successorForm ? successorForm.isConnected && section.contains(successorForm)
          && target === successorForm.querySelector("[data-experience-adoption-reset]")
          : target === load && load === section.querySelector("[data-experience-adoption-load]"))
        && !this.#busy && !this.#saving && !this.#uncertain && !this.#composing?.isConnected);
    } catch { /* A reset or render failure never grants a new focus owner. */ }
    finally { focus.dispose(); }
  }
  async #proposeAdoption(event: SubmitEvent) {
    event.preventDefault();
    const form = this.#adoptionForm();
    if (!this.#ownsControl(event) || event.currentTarget !== form || !form?.isConnected || !this.#writable()
      || this.#saving || this.#busy || this.#composing === form) return;
    if (this.#uncertain) { if (this.#original?.operation === "maintenance-proposal") await this.#runOriginal(); return; }
    const fields = this.#adoptionFields(), nomination = this.#nomination(), detail = this.#detail;
    if (!fields || !nomination || !detail || this.#nominations?.detail !== detail || !this.#nominationCurrent()
      || !this.#context.owners.some(owner => owner.userId === fields.ownerUserId) || !form.reportValidity()) return;
    // Capture exactly one retained server nomination. Preview observations and
    // native fields never author a baseline, profile, head or eligibility hash.
    const intent = readMaintenanceAdoptionProposal({ version: 1, requestId: crypto.randomUUID(), title: fields.title.trim(),
      ownerUserId: fields.ownerUserId, evidence: fields.evidence.trim(), dependencyIds: [], binding: nomination.binding });
    if (!intent) { this.#notice = "invalid"; this.requestUpdate(); return; }
    const session = platformSession.get()!;
    this.#original = Object.freeze({ operation: "maintenance-proposal", intent, actorUserId: session.user.userId,
      scope: this.#scope(), session, fields: JSON.stringify(fields) });
    await this.#runOriginal();
  }
  #adoptionHeadView(state: MaintenanceHeadState | null) {
    const head = state?.head;
    return html`<dl class="experience-review-facts">
      <div><dt>${this.#label("Head revision")}</dt><dd>${head ? this.i18n.number(head.revision) : state?.status === "absent" ? this.i18n.number(0) : this.#label("Unavailable")}</dd></div>
      <div><dt>${this.#label("Head event")}</dt><dd><code dir="ltr">${head?.adoptionEventId ?? "—"}</code></dd></div>
      <div><dt>${this.#label("Head eligibility")}</dt><dd>${this.#label(state?.status === "eligible" ? "Eligible" : "Ineligible")}</dd></div>
      <div><dt>${this.#label("Current baseline")}</dt><dd><code dir="ltr">${head?.baselineObservationHash ?? "—"}</code></dd></div>
      <div><dt>${this.#label("Current profile")}</dt><dd><code dir="ltr">${head?.profileRef ?? "—"}</code></dd></div>
      <div><dt>${this.#label("Current profile hash")}</dt><dd><code dir="ltr">${head?.profileHash ?? "—"}</code></dd></div>
    </dl>`;
  }
  #adoptionBindingView(binding: MaintenanceBinding) {
    return html`<details class="experience-review-hashes"><summary>${this.#label("Baseline adoption")}</summary><dl>
      <div><dt>${this.#label("Target observation")}</dt><dd><code dir="ltr">${binding.target.observationHash}</code></dd></div>
      <div><dt>${this.#label("Capture profile")}</dt><dd><code dir="ltr">${binding.target.profileRef}</code></dd></div>
      <div><dt>${this.#label("Profile hash")}</dt><dd><code dir="ltr">${binding.target.profileHash}</code></dd></div>
      <div><dt>${this.#label("Inventory hash")}</dt><dd><code dir="ltr">${binding.target.inventoryHash}</code></dd></div>
      <div><dt>${this.#label("Baseline observation")}</dt><dd><code dir="ltr">${binding.reviewed.baselineObservationHash}</code></dd></div>
      <div><dt>${this.#label("Current observation")}</dt><dd><code dir="ltr">${binding.reviewed.currentObservationHash}</code></dd></div>
      <div><dt>${this.#label("Head revision")}</dt><dd>${this.i18n.number(binding.expectedAdoption.revision)}</dd></div>
      <div><dt>${this.#label("Head event")}</dt><dd><code dir="ltr">${binding.expectedAdoption.eventId ?? "—"}</code></dd></div>
      <div><dt>${this.#label("Expected baseline")}</dt><dd><code dir="ltr">${binding.expectedAdoption.baselineObservationHash ?? "—"}</code></dd></div>
      <div><dt>${this.#label("Expected profile")}</dt><dd><code dir="ltr">${binding.expectedAdoption.profileRef ?? "—"}</code></dd></div>
      <div><dt>${this.#label("Expected profile hash")}</dt><dd><code dir="ltr">${binding.expectedAdoption.profileHash ?? "—"}</code></dd></div>
    </dl></details>`;
  }
  #adoptionView(detail: ExperienceMaterialDetail) {
    const retained = this.#nominations?.detail === detail ? this.#nominations.value : null;
    const fields = this.#adoptionFields(), actor = platformSession.get()?.user.userId ?? "", owner = fields?.ownerUserId ?? actor;
    const ownerUnavailable = !this.#context.owners.some(row => row.userId === owner), nomination = this.#nomination();
    const selected = fields?.nomination ?? "", unavailable = selected !== "" && !retained?.nominations.some(row => row.bindingHash === selected);
    const locked = this.#busy || this.#saving || this.#uncertain || Boolean(this.#composing?.isConnected);
    return html`<section class="experience-review-proposal" data-experience-adoption>
      <h4>${this.#label("Adoption nominations")}</h4>
      <button type="button" data-experience-adoption-load ?disabled=${locked || this.#hasAdoptionDraft()}
        @click=${(event: Event) => this.#loadNominations(event, detail)}>${this.#label("Load nominations")}</button>
      ${retained ? html`${this.#adoptionHeadView(this.#latestNominations?.headState ?? null)}
        ${!retained.nominations.length ? html`<p>${this.#label("No nominations")}</p>` : nothing}
        ${retained.nominations.length || fields ? keyed(this.#adoptionEpoch, html`<form data-experience-adoption-proposal data-experience-adoption-owner=${String(this.#adoptionEpoch)}
          @submit=${(event: SubmitEvent) => this.#proposeAdoption(event)} @input=${() => this.requestUpdate()} @change=${() => this.requestUpdate()}
          @compositionstart=${(event: CompositionEvent) => this.#composition(event, true)} @compositionend=${(event: CompositionEvent) => this.#composition(event, false)}>
          <label>${this.#label("Select nomination")}<select name="nomination" required dir="ltr">
            <option value="" .selected=${selected === ""}>${this.#label("Select nomination")}</option>
            ${unavailable ? html`<option value=${selected} .selected=${true} disabled>${this.#label("Unavailable")} · ${selected}</option>` : nothing}
            ${repeat(retained.nominations, row => row.bindingHash, row => html`<option value=${row.bindingHash} .selected=${selected === row.bindingHash}>${row.bindingHash}</option>`)}
          </select></label>
          <label>${this.#label("Title")}<input name="title" required maxlength="160" dir="auto"></label>
          <label>${this.#label("Owner")}<select name="ownerUserId" required>
            ${ownerUnavailable ? html`<option value=${owner} .selected=${true} disabled>${this.#label("Unavailable")} · ${owner}</option>` : nothing}
            ${repeat(this.#context.owners, row => row.userId, row => html`<option value=${row.userId} .selected=${row.userId === owner}>${row.displayName} · ${row.userId}</option>`)}
          </select></label>
          <label>${this.#label("Evidence")}<textarea name="evidence" maxlength="800" dir="auto"></textarea></label>
          ${nomination ? this.#adoptionBindingView(nomination.binding) : nothing}
          ${selected && !this.#nominationCurrent() ? html`<p role="status">${this.#label("Nomination changed")}</p>` : nothing}
          <div class="experience-review-actions">
            <button type="submit" data-experience-adoption-propose ?formnovalidate=${this.#uncertain}
              ?disabled=${this.#saving || this.#busy || !this.#writable() || Boolean(this.#composing?.isConnected)
                || this.#uncertain && this.#original?.operation !== "maintenance-proposal"
                || !this.#uncertain && (ownerUnavailable || unavailable || !this.#nominationCurrent())}>${this.#label(this.#saving ? "Saving" : this.#uncertain ? "Retry original" : "Propose adoption")}</button>
            <button type="button" data-experience-adoption-reset ?disabled=${locked} @click=${(event: Event) => this.#resetAdoption(event, detail)}>${this.#label("Reset draft")}</button>
          </div>
        </form>`) : nothing}` : nothing}
    </section>`;
  }

  #clearMaintenance(previewOnly = false) {
    this.#maintenancePatchVersion++; this.#maintenancePreview = null; this.#maintenanceNotice = false;
    if (!previewOnly) { this.#maintenanceVersion++; this.#maintenance = null; }
  }
  #maintenanceSection() { return this.querySelector<HTMLElement>("[data-experience-maintenance]"); }
  #ownsMaintenanceControl(event: Event, detail: ExperienceMaterialDetail) {
    const section = this.#maintenanceSection(), control = event.currentTarget;
    return this.#ownsControl(event, detail) && detail.material.output === "model3d" && !this.#historical
      && control instanceof HTMLButtonElement && !control.disabled && Boolean(section?.isConnected && section.contains(control))
      && Boolean(this.#selected && selectionKey(this.#selected.selection) === selectionKey(detail.material.selection));
  }
  async #loadMaintenance(event: Event, detail: ExperienceMaterialDetail) {
    const form = this.#patchForm(), section = this.#maintenanceSection(), selected = this.#selected;
    if (!this.#ownsMaintenanceControl(event, detail) || !form?.isConnected || !section || this.#busy || this.#saving
      || this.#uncertain || this.#composing?.isConnected) return;
    this.#clearMaintenance();
    const currentOwner = this.#capture(), version = ++this.#readVersion, maintenanceVersion = this.#maintenanceVersion;
    const current = () => currentOwner() && maintenanceVersion === this.#maintenanceVersion && detail === this.#detail
      && selected === this.#selected && form === this.#patchForm() && form.isConnected
      && section === this.#maintenanceSection() && section.isConnected && !this.#historical;
    const control = event.currentTarget as HTMLButtonElement, focusPatchVersion = this.#maintenancePatchVersion;
    const focus = this.#captureFocusRecovery(control);
    try {
      this.#busy = true; this.requestUpdate();
      const value = await this.#json("/materials/maintenance?" + new URLSearchParams(detail.material.selection), current, version, undefined, currentOwner);
      const review = readExperienceMaintenanceReview(value, detail.material.selection);
      if (!review) throw new Error("unavailable");
      if (!current() || version !== this.#readVersion) return;
      this.#certifiedRead = version; this.#maintenance = Object.freeze({ detail, value: review });
    } catch { if (current() && version === this.#readVersion) this.#maintenanceNotice = true; }
    finally {
      try {
        if (currentOwner() && version === this.#readVersion) {
          this.#busy = false; this.requestUpdate();
          try {
            await this.updateComplete;
            focus.restore(control, () => current() && version === this.#readVersion && focusPatchVersion === this.#maintenancePatchVersion
              && control === section.querySelector("[data-experience-maintenance-load]") && section.contains(control)
              && !this.#busy && !this.#saving && !this.#uncertain && !this.#composing?.isConnected);
          } catch { /* Focus recovery does not change the observation's already determined outcome. */ }
        }
      } finally { focus.dispose(); }
    }
  }
  async #previewMaintenance(event: Event, detail: ExperienceMaterialDetail) {
    const form = this.#patchForm(), section = this.#maintenanceSection(), retained = this.#maintenance, selected = this.#selected;
    if (!this.#ownsMaintenanceControl(event, detail) || !form?.isConnected || !section || retained?.detail !== detail
      || this.#busy || this.#saving || this.#uncertain || this.#composing?.isConnected) return;
    const patch = this.#patch();
    const request = captureExperienceReviewMaintenanceRequest(detail.material.selection, retained.value, patch);
    if (!request) return;
    const currentOwner = this.#capture(), version = ++this.#readVersion, maintenanceVersion = ++this.#maintenanceVersion;
    const patchVersion = this.#maintenancePatchVersion;
    const current = () => currentOwner() && maintenanceVersion === this.#maintenanceVersion && patchVersion === this.#maintenancePatchVersion
      && retained === this.#maintenance && selected === this.#selected && detail === this.#detail
      && form === this.#patchForm() && form.isConnected && section === this.#maintenanceSection() && section.isConnected && !this.#historical;
    const control = event.currentTarget as HTMLButtonElement;
    const focus = this.#captureFocusRecovery(control);
    try {
      this.#maintenancePreview = null; this.#maintenanceNotice = false; this.#busy = true; this.requestUpdate();
      const value = await this.#json("/maintenance/preview", current, version, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request) }, currentOwner);
      const preview = await readExperienceMaintenancePreview(value, { detail, request, review: retained.value });
      if (!preview) throw new Error("unavailable");
      if (!current() || version !== this.#readVersion || canonicalJson(patch) !== canonicalJson(this.#patch())) return;
      this.#certifiedRead = version; this.#maintenancePreview = Object.freeze({ detail, value: preview });
    } catch {
      if (current() && version === this.#readVersion) {
        // A stale pair or invalid response needs another explicit retained-pair read.
        this.#clearMaintenance(); this.#maintenanceNotice = true;
      }
    } finally {
      // A patch edit may retire the preview without retiring the owning request's cleanup.
      try {
        if (currentOwner() && version === this.#readVersion) {
          this.#busy = false; this.requestUpdate();
          try {
            await this.updateComplete;
            // Rejected previews invalidate the retained pair and stay disabled;
            // they deliberately do not transfer focus to another control.
            focus.restore(control, () => current() && version === this.#readVersion
              && control === section.querySelector("[data-experience-maintenance-preview]") && section.contains(control)
              && !this.#busy && !this.#saving && !this.#uncertain && !this.#composing?.isConnected);
          } catch { /* Focus recovery does not change the preview's already determined outcome. */ }
        }
      } finally { focus.dispose(); }
    }
  }
  #maintenanceView(detail: ExperienceMaterialDetail) {
    if (detail.material.output !== "model3d" || this.#historical) return nothing;
    const retained = this.#maintenance?.detail === detail ? this.#maintenance.value : null;
    const review = retained?.review, preview = this.#maintenancePreview?.detail === detail ? this.#maintenancePreview.value : null;
    const locked = this.#busy || this.#saving || this.#uncertain || Boolean(this.#composing?.isConnected);
    const candidate = preview?.preview?.ok ? preview.preview.candidate : null;
    return html`<details class="experience-review-maintenance" data-experience-maintenance><summary>${this.#label("Maintenance")}</summary>
      <div class="experience-review-actions">
        <button type="button" data-experience-maintenance-load ?disabled=${locked} @click=${(event: Event) => this.#loadMaintenance(event, detail)}>${this.#label("Load observations")}</button>
        <button type="button" data-experience-maintenance-preview ?disabled=${locked || !review} @click=${(event: Event) => this.#previewMaintenance(event, detail)}>${this.#label("Preview maintenance")}</button>
      </div>
      <p data-experience-maintenance-status role="status" aria-live="polite">${this.#maintenanceNotice || retained && !review ? this.#label("Unavailable")
        : review ? this.#label(review.status === "unchanged" ? "Unchanged" : "Compatibility review") : nothing}</p>
      ${review ? html`<details class="experience-review-hashes"><summary>${this.#label("Retained observations")}</summary><dl>
        <div><dt>${this.#label("Baseline observation")}</dt><dd><code dir="ltr">${review.baselineObservationHash}</code></dd></div>
        <div><dt>${this.#label("Current observation")}</dt><dd><code dir="ltr">${review.currentObservationHash}</code></dd></div>
      </dl></details>
      ${review.changes.sources.length ? html`<h4>${this.#label("Source changes")}</h4><ul>${review.changes.sources.map(source => html`<li>${this.#label(maintenanceSourceLabels[source])}</li>`)}</ul>` : nothing}
      ${review.changes.contracts.length ? html`<h4>${this.#label("Contract changes")}</h4><ul>${review.changes.contracts.map(field => html`<li>${this.#label(maintenanceFieldLabels[field])}</li>`)}</ul>` : nothing}` : nothing}
      ${preview ? html`<section class="experience-review-preview" data-experience-maintenance-result aria-label=${this.#label("Preview maintenance")}>
        <h4>${this.#label("Preview maintenance")}</h4><p>${this.#label("Not registered")}</p>
        ${candidate ? html`<dl><div><dt>${this.#label("Revision")}</dt><dd>${this.i18n.number(candidate.definition.revision)}</dd></div>
          <div><dt>${this.#label("Layout")}</dt><dd>${this.#label(candidate.definition.layout)}</dd></div></dl>
          <ol>${candidate.definition.decisions.map(decision => html`<li><bdi>${this.i18n.system(candidate.copy[decision.labelKey])}</bdi></li>`)}</ol>`
          : html`<p role="status">${this.#label(preview.review.status === "unchanged" ? "Unchanged" : "Compatibility review")}</p>`}
      </section>` : nothing}
      ${this.#adoptionView(detail)}
    </details>`;
  }

  #label(key: string) { return this.i18n.t("experience.review." + key, key); }
  #hashes(selection: ExperienceMaterialSelection) {
    return html`<details class="experience-review-hashes"><summary>${this.#label("Hashes")}</summary><dl>
      ${Object.entries(selection).map(([name, value]) => html`<div><dt>${this.#label(name)}</dt><dd><code dir="ltr">${value}</code></dd></div>`)}
    </dl></details>`;
  }
  #decisionView(selected: ReviewedDecision) {
    const row = selected.decision, fields = this.#actionFields(), statusValue = fields?.status ?? row.status;
    const statuses = DELIVERY_DECISION_STATUSES.filter(status => status === row.status
      || status !== "approved" && status !== "revoked" && this.#canTransition(status));
    const unavailable = !statuses.includes(statusValue as DeliveryDecisionStatus);
    const locked = this.#busy || this.#saving || this.#uncertain || !this.#writable();
    const maintenance = isMaintenanceReviewDecision(selected), headMatches = this.#decisionHeadMatches(selected);
    const currentAdoption = this.#latestDecision && isMaintenanceReviewDecision(this.#latestDecision) ? this.#latestDecision.headState : null;
    return html`<article class="experience-review-decision" data-experience-private>
      <h3><bdi>${row.title}</bdi></h3>
      <dl class="experience-review-facts">
        <div><dt>${this.#label("Status")}</dt><dd>${this.#label(row.status)}</dd></div>
        <div><dt>${this.#label("Operation")}</dt><dd>${this.#label(maintenance ? "Baseline adoption" : selected.binding.operation === "rollback" ? "Rollback" : "Publication")}</dd></div>
        <div><dt>${this.#label("Owner")}</dt><dd><bdi>${row.owner}</bdi></dd></div>
        <div><dt>${this.#label("Definition")}</dt><dd><bdi>${selected.binding.experienceId}</bdi></dd></div>
        <div><dt>${this.#label("Channel")}</dt><dd>${this.#label("Private test fixture")}</dd></div>
        <div><dt>${this.#label("Generation")}</dt><dd>${this.#label("Unavailable")}</dd></div>
        <div><dt>${this.#label("Approval event")}</dt><dd><code dir="ltr">${selected.approvalEventId ?? "—"}</code></dd></div>
        <div><dt>${this.#label("Approval eligibility")}</dt><dd>${this.#label(this.#approvalEligible(selected) ? "Eligible" : "Ineligible")}</dd></div>
        ${!maintenance ? html`<div><dt>${this.#label("Head revision")}</dt><dd>${this.#decisionHead ? this.i18n.number(this.#decisionHead.expectedHead.revision) : this.#label("Unavailable")}</dd></div>
        <div><dt>${this.#label("Head event")}</dt><dd><code dir="ltr">${this.#decisionHead?.expectedHead.eventId ?? "—"}</code></dd></div>
        <div><dt>${this.#label("Head eligibility")}</dt><dd>${this.#label(this.#decisionHead?.eligible ? "Eligible" : "Ineligible")}</dd></div>` : nothing}
      </dl>
      ${this.#hashes(reviewSelection(selected))}
      ${isMaintenanceReviewDecision(selected) ? html`${this.#adoptionHeadView(currentAdoption)}${this.#adoptionBindingView(selected.binding)}`
        : selected.binding.rollbackPublicationEventId ? html`<dl><div><dt>${this.#label("Rollback target")}</dt><dd><code dir="ltr">${selected.binding.rollbackPublicationEventId}</code></dd></div></dl>` : nothing}
      ${this.#decisionChanged() ? html`<p role="status">${this.#label("Decision changed")}</p>` : nothing}
      ${(maintenance || this.#decisionHead) && !headMatches ? html`<p role="status">${this.#label("Head changed")}</p>` : nothing}
      ${keyed(this.#actionEpoch, html`<form novalidate data-experience-action data-experience-action-owner=${String(this.#actionEpoch)}
        @submit=${(event: SubmitEvent) => this.#transition(event)} @input=${(event: Event) => {
          if (!this.#ownsControl(event) || event.currentTarget !== this.#actionForm()) return;
          if (event.target instanceof HTMLTextAreaElement) event.target.setCustomValidity(""); this.requestUpdate();
        }} @change=${() => this.requestUpdate()}
        @compositionstart=${(event: CompositionEvent) => this.#composition(event, true)} @compositionend=${(event: CompositionEvent) => this.#composition(event, false)}>
        <label>${this.#label("Evidence")}<textarea name="evidence" maxlength="800" dir="auto" .value=${row.evidence} ?disabled=${this.#saving || this.#uncertain}></textarea></label>
        <label>${this.#label("Recorded status")}<select name="status" ?disabled=${this.#saving || this.#uncertain}>
          ${unavailable ? html`<option .selected=${true} value=${statusValue} disabled>${this.#label("Unavailable")} · ${this.#label(statusValue)}</option>` : nothing}
          ${repeat(statuses, status => status, status => html`<option value=${status} .selected=${status === statusValue}>${this.#label(status)}</option>`)}
        </select></label>
        <div class="experience-review-actions">
          <button type="submit" data-experience-transition="record" ?disabled=${locked || unavailable || statusValue === row.status || !this.#canTransition(statusValue as DeliveryDecisionStatus)}>${this.#label("Record status")}</button>
          ${row.status === "approval_required" ? html`<button type="submit" data-experience-transition="approved"
            ?disabled=${locked || !this.#canTransition("approved")}>${this.#label("Approve")}</button>` : nothing}
          ${row.status === "approved" ? html`<button type="submit" data-experience-transition="revoked"
            ?disabled=${locked || !this.#canTransition("revoked")}>${this.#label("Revoke")}</button>` : nothing}
          <button type="button" class="experience-review-action-reset" ?disabled=${locked || Boolean(this.#composing?.isConnected)} @click=${(event: Event) => this.#resetDecision(event, selected)}>${this.#label("Reset draft")}</button>
        </div>
        ${row.status === "approval_required" ? html`<p>${this.#label("Independent approver required")}</p>` : nothing}
      </form>`)}
      ${row.status === "approved" ? html`<section class="experience-review-publication" aria-label=${this.#label("Private test fixture")}>
        <h4>${this.#label("Private test fixture")}</h4>
        ${isMaintenanceReviewDecision(selected) ? html`<button type="button" data-experience-adopt
          ?disabled=${locked || !this.#releaseAuthority() || !this.#governanceReady || this.#decisionChanged()
            || !this.#approvalEligible(selected) || !selected.approvalEventId || !headMatches || this.#dirty()}
          @click=${(event: Event) => this.#adopt(event, selected)}>${this.#label("Adopt baseline")}</button>`
          : html`<button type="button" ?disabled=${locked || !this.#releaseAuthority() || !this.#governanceReady || this.#decisionChanged()
            || !selected.approvalEligible || !selected.approvalEventId || !headMatches || this.#dirty()}
            @click=${(event: Event) => this.#publish(event, selected)}>${this.#label(selected.binding.operation === "rollback" ? "Roll back test fixture" : "Publish test fixture")}</button>`}
      </section>` : nothing}
      ${this.#inventory?.materials.filter(material => selectionKey(material.selection) === selectionKey(reviewSelection(selected)))
        .map(material => html`<button type="button" ?disabled=${this.#busy || !this.#canSwitch()}
          @click=${(event: Event) => { if (this.#ownsControl(event)) void this.selectMaterial(material); }}>${this.#label("Review candidate")}</button>`)}
    </article>`;
  }

  #detailView(detail: ExperienceMaterialDetail) {
    const actor = platformSession.get()?.user.userId ?? "", fields = this.#fields();
    const owner = fields?.ownerUserId ?? actor, ownerUnavailable = !this.#context.owners.some(row => row.userId === owner);
    const decisions = new Map(detail.release.definition.decisions.map(decision => [decision.id, decision]));
    return html`<article class="experience-review-selected" data-experience-private>
      <h3><bdi>${detail.material.experienceId}</bdi></h3>
      <dl class="experience-review-facts"><div><dt>${this.#label("Revision")}</dt><dd>${this.i18n.number(detail.material.definitionRevision)}</dd></div>
        <div><dt>${this.#label("Output")}</dt><dd>${this.#label(detail.material.output)}</dd></div>
        <div><dt>${this.#label("Fixture")}</dt><dd>${this.#label("Passed")} · ${this.i18n.number(detail.material.evaluation.caseCount)} ${this.#label("Cases")}</dd></div>
        <div><dt>${this.#label("Generation")}</dt><dd>${this.#label("Unavailable")}</dd></div></dl>
      ${this.#hashes(detail.material.selection)}
      <details><summary>${this.#label("Definition")}</summary><pre class="experience-review-definition" dir="ltr">${JSON.stringify(detail.release.definition, null, 2)}</pre></details>
      ${!this.#historical ? html`<details class="experience-review-patch"><summary>${this.#label("Layout and order")}</summary>
        <form data-experience-patch @submit=${(event: SubmitEvent) => this.#previewSubmit(event)} @change=${(event: Event) => this.#patchChanged(event, detail)}>
          <label>${this.#label("Layout")}<select name="layout" ?disabled=${this.#saving}>
            ${detail.descriptor.patch.operations.shapes[1].layoutValues.map(layout => html`<option value=${layout}
              ?selected=${layout === detail.release.definition.layout}>${this.#label(layout)}</option>`)}
          </select></label>
          <ol class="experience-review-order">${repeat(this.#order, id => id, (id, index) => html`<li>
            <span><bdi>${this.i18n.system(detail.release.copy[decisions.get(id)!.labelKey])}</bdi></span>
            <div class="experience-review-order-actions"><button type="button" ?disabled=${index === 0 || this.#busy || this.#saving}
              data-experience-move="-1" @click=${(event: Event) => this.#move(event, detail, id, -1)} aria-label=${this.#label("Move up") + " · " + id}>${this.#label("Move up")}</button>
              <button type="button" ?disabled=${index === this.#order.length - 1 || this.#busy || this.#saving}
                data-experience-move="1" @click=${(event: Event) => this.#move(event, detail, id, 1)} aria-label=${this.#label("Move down") + " · " + id}>${this.#label("Move down")}</button></div></li>`)}</ol>
          <button type="submit" ?disabled=${this.#busy || this.#saving}>${this.#label("Preview")}</button>
        </form>
        ${this.#preview ? html`<section class="experience-review-preview" aria-label=${this.#label("Preview")}>
          <h4>${this.#label("Preview")}</h4><p>${this.#label("Not registered")}</p>
          ${this.#preview.ok ? html`<dl><div><dt>${this.#label("Revision")}</dt><dd>${this.i18n.number(this.#preview.candidate.definition.revision)}</dd></div>
            <div><dt>${this.#label("Layout")}</dt><dd>${this.#label(this.#preview.candidate.definition.layout)}</dd></div></dl>
            <ol>${this.#preview.candidate.definition.decisions.map(decision => html`<li><bdi>${this.#preview!.ok ? this.i18n.system(this.#preview!.candidate.copy[decision.labelKey]) : ""}</bdi></li>`)}</ol>`
            : html`<p role="status">${this.#label("Invalid patch")}</p>`}
        </section>` : nothing}
      </details>` : nothing}
      ${this.#maintenanceView(detail)}
      ${this.#historical ? html`<dl><div><dt>${this.#label("Rollback target")}</dt><dd><code dir="ltr">${this.#historical.eventId}</code></dd></div>
        <div><dt>${this.#label("Channel")}</dt><dd>${this.#label("Private test fixture")}</dd></div></dl>` : nothing}
      <section class="experience-review-proposal"><h4>${this.#label("Registered candidate")}</h4>
        ${keyed(this.#proposalEpoch, html`<form data-experience-proposal data-experience-proposal-owner=${String(this.#proposalEpoch)}
          @submit=${(event: SubmitEvent) => this.#propose(event)} @input=${() => this.requestUpdate()} @change=${() => this.requestUpdate()}
          @compositionstart=${(event: CompositionEvent) => this.#composition(event, true)} @compositionend=${(event: CompositionEvent) => this.#composition(event, false)}>
          <label>${this.#label("Title")}<input name="title" required maxlength="160" dir="auto"></label>
          <label>${this.#label("Owner")}<select name="ownerUserId" required>
            ${ownerUnavailable ? html`<option value=${owner} .selected=${true} disabled>${this.#label("Unavailable")} · ${owner}</option>` : nothing}
            ${repeat(this.#context.owners, row => row.userId, row => html`<option value=${row.userId} .selected=${row.userId === owner}>${row.displayName} · ${row.userId}</option>`)}
          </select></label>
          <label>${this.#label("Evidence")}<textarea name="evidence" maxlength="800" dir="auto"></textarea></label>
          ${this.#headChanged() ? html`<p role="status">${this.#label("Head changed")}</p>` : nothing}
          <dl><div><dt>${this.#label("Head revision")}</dt><dd>${this.#head ? this.i18n.number(this.#head.revision) : this.#label("Unavailable")}</dd></div>
            <div><dt>${this.#label("Head event")}</dt><dd><code dir="ltr">${this.#head?.eventId ?? "—"}</code></dd></div></dl>
          <button type="submit" ?formnovalidate=${this.#uncertain}
            ?disabled=${this.#saving || this.#busy || !this.#writable() || this.#uncertain && this.#original?.operation !== "proposal"
              || !this.#uncertain && (ownerUnavailable || this.#headChanged())}>
            ${this.#label(this.#saving ? "Saving" : this.#uncertain && this.#original?.operation === "proposal" ? "Retry original" : this.#historical ? "Propose rollback" : "Propose")}</button>
        </form>`)}
      </section>
      <button type="button" ?disabled=${this.#saving || this.#busy || this.#uncertain} @click=${(event: Event) => this.#resetDraft(event, detail)}>${this.#label("Reset draft")}</button>
    </article>`;
  }

  override render() { return html`<div data-experience-review-mount></div>`; }
  protected override updated() {
    const mount = this.querySelector<HTMLElement>("[data-experience-review-mount]");
    if (mount) render(this.#view(), mount, { host: this });
  }
  #view() {
    if (!this.#context.available || !this.#scope()) return nothing;
    const original = this.#original;
    return html`<section class="experience-review" aria-labelledby="experience-review-heading" dir=${this.i18n.direction}>
      <header><h2 id="experience-review-heading">${this.#label("Experiences")}</h2>
        <button type="button" ?disabled=${this.#busy || this.#saving} @click=${(event: Event) => { if (this.#ownsControl(event, undefined, true)) void this.refresh(); }}>${this.#label("Refresh")}</button></header>
      ${this.#busy ? html`<p role="status">${this.#label("Loading")}</p>` : nothing}
      ${this.#denied ? html`<p role="alert">${this.#label("Unavailable")}</p>` : nothing}
      ${this.#notice && !["saved", "recorded", "published", "acknowledged", "uncertain"].includes(this.#notice) ? html`<p role="alert">${this.#label(this.#notice === "saved" ? "Proposed" : this.#notice === "recorded" ? "Recorded" : this.#notice === "published" ? "Test fixture published" : this.#notice === "uncertain" ? "Unconfirmed" : this.#notice === "invalid" ? "Invalid fields" : this.#notice === "draft" ? "Reset draft" : "Unavailable")}</p>` : nothing}
      ${this.#uncertain && !this.#denied ? html`<p role="status">${this.#label("Unconfirmed")}</p>
        <div class="experience-review-actions">
          ${!this.#detail || original?.operation !== "proposal" && (original?.operation !== "maintenance-proposal" || !this.#adoptionForm()) ? html`<button type="button" ?disabled=${this.#saving || this.#busy || !this.#writable()} @click=${(event: Event) => this.#retry(event, original)}>${this.#label("Retry original")}</button>` : nothing}
          <button type="button" ?disabled=${this.#saving || this.#busy || !this.#writable()} @click=${(event: Event) => this.#retry(event, original, true)}>${this.#label("Check original")}</button>
        </div>` : nothing}
      ${!this.#denied ? html`<div data-experience-acknowledgment data-experience-private tabindex="-1" role="status" aria-atomic="true"
        aria-label=${this.#label("Original acknowledgment")}>${this.#acknowledgment ? html`<dl>
        <div><dt>${this.#label("Original acknowledgment")}</dt><dd>${this.#label(acknowledgmentLabels[this.#acknowledgment.operation])}</dd></div>
        <div><dt>${this.#label("Event")}</dt><dd><code dir="ltr">${this.#acknowledgment.eventId}</code></dd></div></dl>` : nothing}</div>` : nothing}
      ${!this.#denied ? html`<details class="experience-review-rollback"><summary>${this.#label("Rollback")}</summary>
        <form data-experience-publication-lookup @submit=${(event: SubmitEvent) => this.#loadPublication(event)} @input=${() => this.requestUpdate()}
          @compositionstart=${(event: CompositionEvent) => this.#composition(event, true)} @compositionend=${(event: CompositionEvent) => this.#composition(event, false)}>
          <label>${this.#label("Publication ID")}<input name="publicationId" maxlength="200" required dir="ltr" autocomplete="off" ?disabled=${this.#saving || this.#uncertain}></label>
          <button type="submit" ?disabled=${this.#busy || this.#saving || this.#uncertain || this.#dirty(false)}>${this.#label("Load")}</button>
        </form></details>` : nothing}
      ${!this.#denied && this.#inventory ? html`<div data-experience-private><h3>${this.#label("Candidates")}</h3>
        ${this.#inventory.materials.length ? html`<ul class="experience-review-candidates">${repeat(this.#inventory.materials, row => selectionKey(row.selection), row => html`<li>
          <button type="button" ?disabled=${!this.#canSwitch() || this.#busy} aria-pressed=${this.#selected && selectionKey(this.#selected.selection) === selectionKey(row.selection) ? "true" : "false"}
            @click=${(event: Event) => { if (this.#ownsControl(event)) void this.selectMaterial(row); }}><bdi>${row.experienceId}</bdi><span>${this.#label("Revision")} ${this.i18n.number(row.definitionRevision)} · ${this.#label(row.output)}</span></button>
        </li>`)}</ul>` : html`<p>${this.#label("No candidates")}</p>`}</div>` : nothing}
      ${!this.#denied && this.#decision ? this.#decisionView(this.#decision) : nothing}
      ${repeat(!this.#denied && this.#detail ? [this.#detail] : [], detail => selectionKey(detail.material.selection), detail => this.#detailView(detail))}
    </section>`;
  }
}
if (!customElements.get("forma-experience-review")) customElements.define("forma-experience-review", FormaExperienceReview);
