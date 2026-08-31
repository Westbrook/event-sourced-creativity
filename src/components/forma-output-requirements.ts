import { outputNavigationMatches, type OutputNavigationReference, type OutputNavigationSection } from "../model/output-navigation";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";
import { html, nothing, type PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { FormaElement } from "./forma-element";
import { copyInterfaceText } from "./design-system/clipboard";
import { outputOperationSupportReceipt } from "./output-operation-support-receipt";
import { compileOutputPlan, type OutputPlanSummary, type OutputPlanTarget } from "../model/output-plan";
import type { OutputCountPolicy, OutputQuantity, OutputRequirementSpec } from "../model/output-requirements";
import { readOutputNativeExecutionPolicy } from "../model/output-execution-policy";
import { OUTPUT_PREFLIGHT_TARGET_MAX_COUNT } from "../model/output-delivery-contract";
import { OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH, outputScopeAmendmentReasonIssue } from "../model/output-scope-amendment";
import type { OutputCommandResponse, OutputConfirmationOptions, OutputPreflight, OutputNativeTargetPreflight, OutputRequirementCommand, OutputRequirementRow, OutputRequirementsSnapshot, OutputResultRow } from "../model/output-delivery-contract";
import type { FormaOutputRequirementCard, OutputCardEditorState, OutputCardPlanSuggestions, OutputRequirementCardSnapshot } from "./forma-output-requirement-card";
import type { CapturedAuthorizationScope, CapturedSourceOwnership } from "../state/store";
import type { OutputCommittedReceipt, OutputMutationResult } from "../state/output-requirements-client";
import type { DocumentJob } from "../model/document-jobs";
import { FORMA_OUTPUT_DELIVERY_MESSAGES, outputDeliveryLabelKey, outputDeliveryProblemKey, type OutputDeliveryLabelCategory } from "./design-system/locales/output-delivery-messages";
import "./forma-output-requirement-card";
import "./forma-output-requirements.css";
import { OutputDirectActivationLatch, outputPaidDecisionKey, type OutputPaidDecision } from "./output-direct-activation";
import { outputCompletedNativeChoices, outputGrantHasQueuedOperations, outputOperationRecovery, outputReusableAcceptanceChoices, outputMissingNativeResults, outputNativeResultContext, type OutputNativeResultReference } from "./output-controller-recovery";
import { outputDeliveryMessageDescriptor, FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES } from "./design-system/locales/output-delivery-runtime-messages";
import { captureOutputRelease, classifyOutputUploadFailure, outputDeliveryReadiness, outputNativeReadiness, outputPackageReadiness, outputReleaseStillAllowed, outputSourceCapacity, outputSourceGovernance, outputSourceReadiness, outputUploadCanRestage, outputUploadNeedsRestage, type OutputReadinessGate, type OutputReleaseCapture, type OutputUploadFailure } from "./output-source-readiness";
import { acknowledgeOutputPlanProposal, captureOutputPlanConfirmation, captureOutputPlanProposalBase, discardOutputPlanProposal, editOutputPlanCountField, editOutputPlanOptionalChoice, editOutputPlanProposal, includeOutputPlanCommittedTargets, observeOutputPlanProposal, outputPlanConfirmationCanClose, outputPlanCountField, outputPlanFocusMayRestore, outputPlanOptionalChoice, outputPlanProposalCanReapply, outputPlanProposalConflicts, outputPlanProposalHasInvalidFields, outputSavedPlanningOptions, readOutputPlanCountField, reapplyOutputPlanProposal, type OutputPlanConfirmationCapture, type OutputPlanCountField, type OutputPlanProposalBase, type OutputPlanProposalState } from "./output-plan-proposal-state";

type OutputSourceRefreshIntent = {
  authorization: CapturedAuthorizationScope | null; documentId: string; projectId: string; currentDocumentId: string; route: string;
  organizationId: string | null; projectAccessId: string | null; epoch: number;
};

type SaveIntent = { scope: { authorizationScopeKey: string; documentId: string }; requirementId: string; expectedRevision: string | number | null; clientMutationId: string; draft: OutputRequirementSpec; planSuggestions: OutputCardPlanSuggestions };
type PlanIntent = { scope: { authorizationScopeKey: string; documentId: string }; requirementId: string; planSuggestions: OutputCardPlanSuggestions };
type Command = OutputRequirementCommand extends infer C ? C extends OutputRequirementCommand ? Omit<C, "documentId" | "expectedRevision" | "clientMutationId"> : never : never;
type OutputPrivateView = { authorization: CapturedAuthorizationScope | null; source: CapturedSourceOwnership | null; documentId: string; epoch: number };
type OutputNativeIntent = OutputPrivateView & {
  requestEpoch: number;
  targetIds: string[]; targetScopeKey: string; selectionKey: string; alternativeOfSlotId: string | null;
};


type OutputNativeInspection = {
  id: number; view: OutputPrivateView;
  reference: OutputNativeResultReference; context: string; viewEpoch: number;
  status: "loading" | "ready" | "unavailable"; job: DocumentJob | null; current: (() => boolean) | null;
};

/** Owns the authenticated Output interaction. The card itself has no store or network access. */
export class FormaOutputRequirements extends FormaElement {
  static override properties = { documentId: { attribute: false }, documentName: { attribute: false }, blockId: { attribute: false }, surface: { attribute: false }, inspectionOnly: { attribute: false } };
  declare documentId: string;
  declare documentName: string;
  declare blockId: string;
  declare surface: "document" | "project" | "deliver";
  declare inspectionOnly: boolean;
  #loading = false;
  #sourceRefreshing = false;
  #sourceRefreshEpoch = 0;
  #sourceRefreshScope = "";
  #busy = "";
  #notice = "";
  #noticeKind: "status" | "alert" = "status";
  #editors = new Map<string, OutputCardEditorState & { sourceRetired?: true; receipt?: OutputCommittedReceipt }>();
  #planning: OutputPlanProposalState | null = null;
  #planOpener: { element: HTMLElement | null; viewKey: string } | null = null;
  #reviewPlan = false;
  #selectedTargets = new Set<string>();
  #runSelectionCleared = false;
  #planRevision = "";
  #preflight: OutputPreflight | null = null;
  #preflightIntent: OutputNativeIntent | null = null;
  #nativeRequestEpoch = 0;
  #nativeViewEpoch = 0;
  #lastNativeView = "";
  #nativeInspection: OutputNativeInspection | null = null;
  #nativeInspectionSerial = 0;
  #authorizationAcknowledged = false;
  #allowPartial = false;
  #packageParts: string[] = [];
  #packageRelease: OutputReleaseCapture | null = null;
  #file: File | null = null;
  #rightsConfirmed = false;
  #uploadCommandId = "";
  #uploadRevision = "";
  #uploadSourceRetired = false;
  #uploadReceipt: OutputCommittedReceipt | null = null;
  #removeId = "";
  #lastScope = "";
  #lastSourceContract = "";
  #lastNativeIntentContract = "";
  #viewEpoch = 0;
  #paidActivation = new OutputDirectActivationLatch();
  #uploadFailure: OutputUploadFailure | null = null;
  #downloadUrls = new Set<string>();
  #uncertainCommand: { signature: string; id: string; expectedRevision: string; sourceRetired?: true; receipt?: OutputCommittedReceipt } | null = null;
  #planRequest = (event: Event) => {
    const detail = (event as CustomEvent<PlanIntent>).detail;
    if (this.blockId || !detail || !this.#intentScopeCurrent(detail.scope)) return;
    this.#openPlan();
  };

  #sourceRetired = (event: Event) => {
    const detail = (event as CustomEvent<{ source: CapturedSourceOwnership; generation: number; status: number }>).detail;
    const source = this.store.captureSourceOwnership();
    if (!this.isConnected || !detail || ![401, 403, 404].includes(detail.status)
      || !this.store.sourceOwnershipScopeActive(detail.source) || !source || source.generation !== detail.generation
      || this.store.sourceOwnershipActive(source)) return;
    // Retire private material, not this controller or its sole original operation owners.
    this.#viewEpoch += 1; this.#sourceRefreshEpoch += 1;
    this.#loading = false; this.#sourceRefreshing = false; this.#busy = "";
    this.#nativeViewEpoch += 1; this.#nativeRequestEpoch += 1; this.#nativeInspection = null;
    this.#lastSourceContract = ""; this.#lastNativeIntentContract = ""; this.#lastNativeView = "";
    this.#retirePreflight(); this.#planning = null; this.#planOpener = null; this.#reviewPlan = false;
    this.#selectedTargets.clear(); this.#planRevision = ""; this.#allowPartial = false; this.#removeId = "";
    this.#packageParts = []; this.#packageRelease = null;
    this.#file = null; this.#rightsConfirmed = false;
    if (this.#uploadCommandId) { this.#uploadSourceRetired = true; if (!this.#uploadReceipt) this.#uploadFailure = { kind: "uncertain", code: null }; }
    if (this.#uncertainCommand) this.#uncertainCommand = { ...this.#uncertainCommand, sourceRetired: true };
    this.#editors = new Map([...this.#editors].map(([id, editor]) => [id, { status: editor.receipt ? "saved" : "unavailable",
      ...(editor.clientMutationId ? { clientMutationId: editor.clientMutationId } : {}), sourceRetired: true,
      ...(editor.receipt ? { receipt: editor.receipt } : {}) }]));
    for (const card of this.querySelectorAll<FormaOutputRequirementCard>("forma-output-requirement-card")) {
      const previous = card.snapshot; card.snapshot = null; card.resourceState = "unavailable";
      card.editorState = { status: "unavailable", ...(card.editorState.clientMutationId ? { clientMutationId: card.editorState.clientMutationId } : {}) };
      card.requestUpdate("snapshot", previous);
    }
    for (const field of this.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) field.value = "";
    for (const url of this.#downloadUrls) URL.revokeObjectURL(url);
    this.#downloadUrls.clear();
    this.#notice = this.#message("output_client_scope_changed"); this.#noticeKind = "alert";
    this.requestUpdate();
  };

  constructor() { super(); this.documentId = ""; this.documentName = ""; this.blockId = ""; this.surface = "document"; this.inspectionOnly = false; }
  override connectedCallback() { super.connectedCallback(); window.addEventListener("forma-output-show-plan", this.#planRequest); window.addEventListener("forma-event-source-retired", this.#sourceRetired); this.requestUpdate(); }
  override disconnectedCallback() {
    this.#viewEpoch += 1;
    this.#sourceRefreshEpoch += 1; this.#sourceRefreshing = false; this.#sourceRefreshScope = "";
    this.#nativeViewEpoch += 1; this.#nativeInspection = null; this.#lastNativeView = "";
    this.#lastScope = "";
    this.#loading = false; this.#busy = ""; this.#editors.clear();
    this.#preflight = null; this.#authorizationAcknowledged = false; this.#runSelectionCleared = false;
    this.#paidActivation.clear();
    this.#uncertainCommand = null; this.#planning = null; this.#planOpener = null; this.#packageRelease = null;
    this.#file = null; this.#rightsConfirmed = false; this.#packageParts = []; this.#removeId = ""; this.#notice = "";
    this.#lastSourceContract = ""; this.#lastNativeIntentContract = ""; this.#selectedTargets.clear();
    // In-flight identifiers and validated acknowledgments belong to the existing
    // Store transport. A detached view retains no upload bytes or private editor.
    this.#uploadCommandId = ""; this.#uploadRevision = ""; this.#uploadReceipt = null; this.#uploadFailure = null;
    window.removeEventListener("forma-output-show-plan", this.#planRequest);
    window.removeEventListener("forma-event-source-retired", this.#sourceRetired);
    for (const url of this.#downloadUrls) URL.revokeObjectURL(url);
    this.#downloadUrls.clear();
    super.disconnectedCallback();
  }

  protected override willUpdate(_changed: PropertyValues) {
    const sourceScope = this.#sourceRefreshScopeKey();
    if (sourceScope !== this.#sourceRefreshScope) {
      this.#sourceRefreshScope = sourceScope; this.#sourceRefreshEpoch += 1; this.#sourceRefreshing = false;
    }
    const key = `${this.store.captureAuthorizationScope()?.key ?? ""}\u0000${this.documentId}`;
    if (key !== this.#lastScope) {
      this.#viewEpoch += 1; this.#loading = false;
      this.#lastScope = key; this.#busy = ""; this.#notice = ""; this.#editors.clear();
      this.#lastSourceContract = "";
      this.#lastNativeIntentContract = "";
      this.#preflight = null; this.#file = null; this.#rightsConfirmed = false;
      this.#uploadFailure = null; this.#uploadSourceRetired = false; this.#uploadReceipt = null; this.#paidActivation.clear();
      this.#authorizationAcknowledged = false; this.#uploadCommandId = ""; this.#removeId = "";
      this.#reviewPlan = false; this.#allowPartial = false; this.#planRevision = "";
      this.#planning = null; this.#planOpener = null;
      this.#packageParts = []; this.#packageRelease = null;
      this.#uncertainCommand = null;
      this.#selectedTargets.clear(); this.#runSelectionCleared = false;
      for (const url of this.#downloadUrls) URL.revokeObjectURL(url);
      this.#downloadUrls.clear();
    }
    const snapshot = this.#snapshot();
    // A successful command refreshes its cache through ready → refreshing → ready.
    // That transport phase gates current clicks, but cannot retire an unchanged pending offer.
    const nativeIntentContract = snapshot ? JSON.stringify([snapshot.documentId, snapshot.confirmedPlan?.revisionId,
      snapshot.sourceRevision, snapshot.requirementRevision, snapshot.permissions.canRequest,
      outputSourceReadiness(snapshot), outputNativeReadiness(snapshot), snapshot.summary?.scope_known === true,
      snapshot.confirmedPlan?.plan.targets.map((target) => [target.id, target.selected, snapshot.confirmedPlan?.targetContractDigests?.[target.id], target.blocking_issues])]) : "";
    const nativeView = JSON.stringify([key, this.#viewEpoch, this.store.route?.get() ?? "", this.surface, this.blockId, this.inspectionOnly,
      this.store.outputRequirements.resource(this.documentId).privateRevision]);
    if (nativeView !== this.#lastNativeView) { this.#lastNativeView = nativeView; this.#nativeViewEpoch += 1; this.#nativeInspection = null; }
    if (nativeIntentContract !== this.#lastNativeIntentContract) {
      this.#lastNativeIntentContract = nativeIntentContract; this.#nativeRequestEpoch += 1; this.#retirePreflight();
    }
    const sourceContract = snapshot ? `${snapshot.sourceRevision}\u0000${snapshot.requirementRevision}\u0000${snapshot.permissions.canRequest}\u0000${this.store.outputRequirements.resource(this.documentId).state}\u0000${JSON.stringify(outputSourceReadiness(snapshot))}\u0000${JSON.stringify(outputNativeReadiness(snapshot))}\u0000${snapshot.summary?.scope_known === true}` : "";
    if (sourceContract !== this.#lastSourceContract) {
      this.#lastSourceContract = sourceContract;
      this.#preflight = null; this.#authorizationAcknowledged = false; this.#paidActivation.clear();
    }
    if (snapshot?.confirmedPlan && this.#planRevision !== snapshot.confirmedPlan.revisionId) {
      const plan = snapshot.confirmedPlan;
      this.#planRevision = plan.revisionId;
      this.#selectedTargets = new Set(plan.plan.targets.filter((target) => target.selected && !target.blocking_issues.length).map((target) => target.id));
      this.#preflight = null;
      this.#paidActivation.clear();
    }
    if (this.#preflight && !this.#currentPreflight(snapshot)) this.#retirePreflight();
    if (this.#nativeInspection && (!this.#nativeInspectionOwned(this.#nativeInspection) || this.#nativeInspection.current && !this.#nativeInspection.current())) this.#nativeInspection = null;
    if (snapshot) this.#observePlanning(snapshot);
  }

  #observePlanning(snapshot: OutputRequirementsSnapshot) {
    const previous = this.#planning;
    this.#planning = observeOutputPlanProposal(previous, snapshot, this.#lastScope);
    if (this.#reviewPlan && previous && !previous.dirty && snapshot.permissions.canAuthor && previous.base.semanticKey !== this.#planning.base.semanticKey) {
      this.#notice = this.#t("planLoadedLatest", "Newer saved planning choices are shown. Review them before confirming."); this.#noticeKind = "status";
    }
  }

  #planViewKey() { return `${this.#lastScope}\u0000${this.#viewEpoch}`; }
  #planEditingAllowed() {
    const resource = this.store.outputRequirements.resource(this.documentId), snapshot = resource.snapshot;
    return this.isConnected && !this.inspectionOnly && !this.#busy && resource.state === "ready"
      && snapshot?.documentId === this.documentId && snapshot.permissions.canAuthor === true
      && this.#planning?.base.documentId === this.documentId
      && this.#lastScope === `${this.store.captureAuthorizationScope()?.key ?? ""}\u0000${this.documentId}`;
  }
  #openPlan(opener: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null) {
    const snapshot = this.#snapshot();
    if (!snapshot || !snapshot.permissions.canAuthor || this.inspectionOnly) return;
    this.#observePlanning(snapshot);
    if (!this.#reviewPlan) this.#planOpener = { element: opener, viewKey: this.#planViewKey() };
    this.#reviewPlan = true; this.requestUpdate();
    const view = this.#captureView(), route = this.store.route.get(), focus = captureOutputNavigationFocus(this.ownerDocument);
    void this.updateComplete.then(() => {
      if (!this.#viewCurrent(view) || !this.#reviewPlan || this.store.route.get() !== route) return;
      const target = this.querySelector<HTMLElement>(".output-plan-review");
      if (target) focus.run(target, () => { target.focus(); return true; });
    }, () => undefined).finally(() => focus.dispose());
  }
  #closePlan() {
    const opener = this.#planOpener, view = this.#captureView(), route = this.store.route.get();
    const focus = captureOutputNavigationFocus(this.ownerDocument);
    this.#reviewPlan = false; this.#planOpener = null; this.requestUpdate();
    void this.updateComplete.then(() => {
      if (!this.#viewCurrent(view) || this.#reviewPlan || this.store.route.get() !== route
        || !opener || !outputPlanFocusMayRestore(opener.viewKey, this.#planViewKey(), true)) return;
      const target = opener.element?.isConnected && !(opener.element as HTMLButtonElement).disabled ? opener.element
        : this.querySelector<HTMLElement>("[data-output-plan-focus-return]");
      if (target) focus.run(target, () => { target.focus(); return true; });
    }, () => undefined).finally(() => focus.dispose());
  }

  protected override updated() {
    if (!this.documentId || this.#loading || this.#sourceRefreshing) return;
    const resource = this.store.outputRequirements.resource(this.documentId);
    if (resource.state === "loading" || resource.state === "refreshing") void this.#refresh();
  }

  #t(key: string, fallback: string, values?: Record<string, string | number>) { return this.i18n.t(`output.delivery.${key}`, fallback, values); }
  #label(category: OutputDeliveryLabelCategory, value: unknown) {
    const key = outputDeliveryLabelKey(category, value);
    return this.#t(key, FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${key}`]);
  }
  #problem(problem: string) {
    const key = outputDeliveryProblemKey(problem);
    return key ? this.#t(key, FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${key}`]) : this.#message(problem);
  }
  #message(code: unknown, values?: unknown) {
    const descriptor = outputDeliveryMessageDescriptor(code, values);
    return this.i18n.t(descriptor.id, FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en[descriptor.id], descriptor.values);
  }
  #failure(result: { body?: unknown; error: string; status?: string }) {
    if (result.status === "not-attempted") return this.#message("output_client_write_not_attempted");
    const body = result.body && typeof result.body === "object" ? result.body as Record<string, unknown> : {};
    return this.#message(typeof body.error === "string" ? body.error : result.status === "unavailable" ? "output_client_response_lost" : result.status === "forbidden" ? "output_client_scope_changed" : "output_client_write_unconfirmed", body);
  }
  #preflightReason(target: OutputNativeTargetPreflight) {
    const entry = target as OutputNativeTargetPreflight & { reasonCode?: string; reasonValues?: Record<string, string | number> };
    return this.#message(entry.reasonCode, entry.reasonValues);
  }
  #sourceTransfer(target: OutputNativeTargetPreflight) {
    return this.#message((target as OutputNativeTargetPreflight & { transferCode?: string }).transferCode);
  }
  #preflightAvailable(preflight: OutputPreflight) {
    return Array.isArray(preflight.targets) && preflight.targets.length > 0 && preflight.targets.every((target) => {
      const entry = target as OutputNativeTargetPreflight & { reasonCode?: string; reasonValues?: Record<string, string | number>; transferCode?: string };
      return target?.available === true && Boolean(readOutputNativeExecutionPolicy(target.settings?.executionPolicy)) && outputDeliveryMessageDescriptor(entry.reasonCode, entry.reasonValues).known && outputDeliveryMessageDescriptor(entry.transferCode).known;
    });
  }
  #executionWindow(target: OutputNativeTargetPreflight) {
    const policy = readOutputNativeExecutionPolicy(target.settings?.executionPolicy);
    return policy ? this.#message("output_native_execution_window", { maximumExecutionSeconds: policy.maximumMilliseconds / 1000 }) : this.#message("output_native_execution_window_unknown");
  }
  #model3dDisclosure(target: OutputNativeTargetPreflight) {
    const payload = target.settings?.payload as Record<string, unknown> | undefined;
    if (payload?.artifactKind !== "model3d") return nothing;
    const settings = payload.model3dSettings as Record<string, unknown> | undefined;
    const references = Array.isArray(target.settings.model3dReferences) ? target.settings.model3dReferences as Array<{ blockId: string; label: string }> : [];
    return html`<div class="output-model3d-disclosure"><p><b>${this.#t("model3dExactPrompt", "Exact prompt sent to Rodin")}</b></p><pre dir="auto">${String(payload.model3dPrompt ?? "")}</pre>
      <p>${this.#t("model3dSettings", "3D settings: {format}; {tier}; materials {material}; mesh {mesh}.", { format: String(settings?.geometry_file_format ?? "").toUpperCase(), tier: String(settings?.tier ?? ""), material: String(settings?.material ?? ""), mesh: String(settings?.quality_mesh_option ?? "") })}</p>
      <p>${this.#t("model3dDefaults", "Automatic texture detail, random seed, no paid add-ons. Review each mesh and its materials; generated models may need cleanup before production use.")}</p>
      <p><b>${this.#t("model3dReferences", "Ordered reference images ({count})", { count: references.length })}</b></p>${references.length ? html`<ol>${references.map(reference => html`<li dir="auto">${reference.label}</li>`)}</ol>` : html`<p>${this.#t("model3dNoReferences", "Text-to-3D: no reference images are sent.")}</p>`}
    </div>`;
  }
  #snapshot() { return this.store.outputRequirements.resource(this.documentId).snapshot; }
  #unresolvedWrite() {
    const write = this.store.outputRequirements.retainedWrite(this.documentId);
    return write && write.status !== "acknowledged" ? write : null;
  }
  #writeNotAttempted() { this.#announce(this.#message("output_client_write_not_attempted")); }
  /** Local work only. A false value is not current Source, read, route, or authoring permission. */
  get navigationBlocked(): boolean {
    return Boolean(!this.isConnected || this.#busy || this.#reviewPlan || this.#planning?.dirty || this.#file
      || this.#uncertainCommand || this.#unresolvedWrite() || this.#preflight || this.#preflightIntent || this.#removeId
      || [...this.querySelectorAll<FormaOutputRequirementCard>("forma-output-requirement-card")]
        .some(card => card.isConnected && card.hasOpenDraft));
  }
  /** Departure protects local edits/in-flight work, not settled original metadata alone. */
  get commandDepartureBlocked():boolean {
    return Boolean(!this.isConnected || this.#busy || this.#reviewPlan || this.#planning?.dirty || this.#file
      || this.#unresolvedWrite()?.status === "pending" || this.#preflight || this.#preflightIntent || this.#removeId
      || [...this.querySelectorAll<FormaOutputRequirementCard>("forma-output-requirement-card")]
        .some(card => card.isConnected && card.hasOpenDraft));
  }
  #transportReceipt() {
    const write = this.store.outputRequirements.retainedWrite(this.documentId);
    if (!write || write.status === "acknowledged" && !write.sourceRetired) return nothing;
    const receipt = JSON.stringify({ documentId: this.documentId, ...write }, null, 2);
    return html`<details class="output-transport-receipt" open><summary aria-label=${this.#controlName(this.#t("operationReceiptIds", "Operation receipt identifiers"))}>${this.#t("operationReceiptIds", "Operation receipt identifiers")}</summary>
      ${write.status !== "acknowledged" ? html`<p role="status">${this.#message(write.sourceRetired ? "original_command_content_unavailable" : "output_client_write_unconfirmed")} ${this.i18n.t("next.output.recoveryLifetime", "Copy the technical receipt before leaving this view. Returning may not restore its local retry controls. Leaving does not cancel the request, confirm success, or release reserved budget.")}</p>` : nothing}
      <button type="button" class="button secondary compact" aria-label=${this.#controlName(this.#t("copyOperationReceipt", "Copy technical receipt"))} @click=${() => this.#copyTransportReceipt(write.clientMutationId, write.digest)}>${this.#t("copyOperationReceipt", "Copy technical receipt")}</button>
      <label>${this.#t("operationReceiptText", "Technical receipt for manual copying")}<textarea aria-label=${this.#controlName(this.#t("operationReceiptText", "Technical receipt for manual copying"))} readonly rows="8" spellcheck="false" lang="en" dir="ltr" .value=${receipt}></textarea></label>
    </details>`;
  }
  async #copyTransportReceipt(clientMutationId: string, digest: string) {
    const view = this.#captureView(), write = this.store.outputRequirements.retainedWrite(view.documentId);
    if (!this.#viewScopeCurrent(view) || !write || write.clientMutationId !== clientMutationId || write.digest !== digest) return;
    const receipt = JSON.stringify({ documentId: view.documentId, ...write }, null, 2), copied = await copyInterfaceText(receipt);
    const current = this.store.outputRequirements.retainedWrite(view.documentId);
    if (!this.#viewScopeCurrent(view) || !current || JSON.stringify({ documentId: view.documentId, ...current }, null, 2) !== receipt) return;
    this.#announce(copied ? this.#t("operationReceiptCopied", "Technical receipt copied. It was not sent to anyone. Share it only with an authorized Forma operator or workspace administrator.")
      : this.#t("operationReceiptCopyFailed", "Automatic copying was unavailable. Select the technical receipt below and copy it manually."), !copied);
  }
  #captureView(): OutputPrivateView { return { authorization: this.store.captureAuthorizationScope(), source: this.store.captureSourceOwnership(), documentId: this.documentId, epoch: this.#viewEpoch }; }
  #viewScopeCurrent(view: OutputPrivateView) { return this.isConnected && view.documentId === this.documentId && this.store.authorizationScopeActive(view.authorization) && this.store.sourceOwnershipScopeActive(view.source); }
  #viewCurrent(view: OutputPrivateView) { return this.#viewScopeCurrent(view) && view.epoch === this.#viewEpoch && this.store.sourceOwnershipActive(view.source); }
  #originalAcknowledgment(view: OutputPrivateView, result: OutputMutationResult<OutputCommandResponse>, clientMutationId: string, action: string) {
    return this.#viewScopeCurrent(view) ? this.store.outputRequirements.withholdCommandBody(view.documentId, result, { clientMutationId, action }).receipt : undefined;
  }
  #intentScopeCurrent(scope: { authorizationScopeKey: string; documentId: string }) { return scope.documentId === this.documentId && scope.authorizationScopeKey === this.store.captureAuthorizationScope()?.key; }
  #announce(message: string, error = false) { this.#notice = message; this.#noticeKind = error ? "alert" : "status"; this.requestUpdate(); }

  #retirePreflight() { this.#preflight = null; this.#preflightIntent = null; this.#authorizationAcknowledged = false; this.#runSelectionCleared = false; this.#paidActivation.clear(); }
  #selectedTargetsKey() { return JSON.stringify([...this.#selectedTargets].sort()); }
  #runSelectionScope(snapshot: OutputRequirementsSnapshot) {
    return JSON.stringify([this.#lastScope, this.#viewEpoch, snapshot.documentId, snapshot.confirmedPlan?.revisionId,
      snapshot.sourceRevision, snapshot.requirementRevision, snapshot.confirmedPlan?.targetContractDigests,
      outputSourceReadiness(snapshot), outputNativeReadiness(snapshot),
      snapshot.confirmedPlan?.plan.targets.map((target) => [target.id, target.selected, target.blocking_issues])]);
  }
  /** UI intent identity only. The server still verifies source evidence, authorization, and spending. */
  #nativeScopeKey(snapshot: OutputRequirementsSnapshot | null | undefined, targetIds: string[]) {
    const plan = snapshot?.confirmedPlan;
    if (!snapshot || snapshot.documentId !== this.documentId || !plan || !targetIds.length || targetIds.length > OUTPUT_PREFLIGHT_TARGET_MAX_COUNT
      || new Set(targetIds).size !== targetIds.length || plan.sourceDigest !== snapshot.sourceRevision || plan.requirementsDigest !== snapshot.requirementRevision) return null;
    const targets = new Map(plan.plan.targets.map((target) => [target.id, target]));
    const identities = [...targetIds].sort().map((id) => {
      const target = targets.get(id), digest = plan.targetContractDigests?.[id];
      return target?.selected === true && !target.blocking_issues.length && typeof digest === "string" && digest.trim() ? [id, digest] : null;
    });
    return identities.some((identity) => !identity) ? null : JSON.stringify([snapshot.documentId, plan.revisionId, snapshot.sourceRevision, snapshot.requirementRevision, identities]);
  }
  #preflightMatchesScope(snapshot: OutputRequirementsSnapshot, preflight: OutputPreflight, targetIds: string[]) {
    if (!this.#nativeScopeKey(snapshot, targetIds) || preflight.planRevisionId !== snapshot.confirmedPlan?.revisionId
      || preflight.sourceDigest !== snapshot.sourceRevision || preflight.requirementsDigest !== snapshot.requirementRevision || !Array.isArray(preflight.targets)
      || preflight.targets.some((target) => !target || typeof target.targetId !== "string")) return false;
    const offered = preflight.targets.map((target) => target.targetId);
    return offered.length === targetIds.length && new Set(offered).size === offered.length
      && JSON.stringify([...offered].sort()) === JSON.stringify([...targetIds].sort());
  }
  #alternativeAvailable(snapshot: OutputRequirementsSnapshot, slotId: string, targetId: string) {
    const operation = snapshot.grants.filter((grant) => grant.planRevisionId === snapshot.confirmedPlan?.revisionId)
      .flatMap((grant) => grant.operations).find((entry) => entry.id === slotId && entry.targetId === targetId);
    const job = this.store.documentJobs.get().find((entry) => entry.jobId === operation?.jobId && entry.documentId === this.documentId);
    return Boolean(operation && outputOperationRecovery(operation, job, this.documentId).canPrepareAlternative);
  }
  #captureNativeIntent(targetIds: string[], alternativeOfSlotId: string | null = null): OutputNativeIntent | null {
    const snapshot = this.#snapshot(), view = this.#captureView(), targetScopeKey = this.#nativeScopeKey(snapshot, targetIds);
    if (!snapshot || !targetScopeKey || this.inspectionOnly || this.#busy || !this.#viewCurrent(view) || !snapshot.permissions.canRequest
      || this.#lastScope !== `${view.authorization?.key ?? ""}\u0000${this.documentId}`
      || this.store.outputRequirements.resource(this.documentId).state !== "ready" || !outputNativeReadiness(snapshot).allowed
      || (alternativeOfSlotId && (targetIds.length !== 1 || !this.#alternativeAvailable(snapshot, alternativeOfSlotId, targetIds[0])))) return null;
    return { ...view, requestEpoch: this.#nativeRequestEpoch, targetIds: [...targetIds].sort(), targetScopeKey,
      selectionKey: this.#selectedTargetsKey(), alternativeOfSlotId };
  }
  #nativeIntentCurrent(intent: OutputNativeIntent, snapshot: OutputRequirementsSnapshot | null | undefined) {
    return Boolean(snapshot && this.#viewCurrent(intent) && intent.requestEpoch === this.#nativeRequestEpoch && !this.inspectionOnly
      && snapshot.permissions.canRequest && this.store.outputRequirements.resource(this.documentId).state === "ready"
      && outputNativeReadiness(snapshot).allowed && intent.targetScopeKey === this.#nativeScopeKey(snapshot, intent.targetIds)
      && intent.selectionKey === this.#selectedTargetsKey()
      && (!intent.alternativeOfSlotId || this.#alternativeAvailable(snapshot, intent.alternativeOfSlotId, intent.targetIds[0])));
  }
  #currentPreflight(snapshot: OutputRequirementsSnapshot | null | undefined) {
    const preflight = this.#preflight, intent = this.#preflightIntent;
    return snapshot && preflight && intent && this.#nativeIntentCurrent(intent, snapshot)
      && this.#preflightMatchesScope(snapshot, preflight, intent.targetIds) ? preflight : null;
  }
  #adoptPreflight(preflight: OutputPreflight, intent: OutputNativeIntent) {
    const snapshot = this.#snapshot();
    const attemptsMatch = intent.targetIds.every((id) => {
      const attempt = preflight.operationAttempts?.[id];
      return attempt && Number.isSafeInteger(attempt.ordinal) && attempt.ordinal >= 0 && attempt.previousSlotId === intent.alternativeOfSlotId;
    });
    if (!snapshot || !this.#nativeIntentCurrent(intent, snapshot) || !this.#preflightMatchesScope(snapshot, preflight, intent.targetIds) || !attemptsMatch) {
      if (this.#viewCurrent(intent)) { this.#retirePreflight(); this.#announce(this.#t("preflightRetired", "This offer no longer matches the current plan, source, or selected work. Check availability and cost again before authorizing work. Nothing new was authorized or started."), true); }
      return false;
    }
    this.#preflight = preflight; this.#preflightIntent = intent; this.#authorizationAcknowledged = false; this.#paidActivation.clear();
    return true;
  }
  #runSelectionEditingAllowed(snapshot: OutputRequirementsSnapshot | null | undefined, shownScope: string) {
    return Boolean(snapshot && snapshot.documentId === this.documentId && this.isConnected && !this.inspectionOnly && !this.#busy && snapshot.permissions.canRequest
      && this.store.outputRequirements.resource(this.documentId).state === "ready"
      && this.#lastScope === `${this.store.captureAuthorizationScope()?.key ?? ""}\u0000${this.documentId}`
      && shownScope === this.#runSelectionScope(snapshot));
  }
  #changeRunSelection(event: Event, targetId: string, shownScope: string) {
    const snapshot = this.#snapshot();
    const target = snapshot?.confirmedPlan?.plan.targets.find((entry) => entry.id === targetId);
    if (!this.#runSelectionEditingAllowed(snapshot, shownScope) || !target?.selected || target.blocking_issues.length) return;
    (event.target as HTMLInputElement).checked ? this.#selectedTargets.add(targetId) : this.#selectedTargets.delete(targetId);
    this.#nativeRequestEpoch += 1; this.#retirePreflight(); this.requestUpdate();
  }
  #clearRunSelection(shownScope: string) {
    if (!this.#runSelectionEditingAllowed(this.#snapshot(), shownScope)) return;
    this.#selectedTargets.clear(); this.#nativeRequestEpoch += 1; this.#retirePreflight();
    this.#runSelectionCleared = true; this.requestUpdate();
  }
  #selectionLimitMessage() {
    return this.#t("preflightSelectionOverLimit", "{count} targets are selected, exceeding the per-check limit of {limit}. Deselect targets for this check. The full delivery assignment remains unchanged.",
      { count: this.i18n.number(this.#selectedTargets.size), limit: this.i18n.number(OUTPUT_PREFLIGHT_TARGET_MAX_COUNT) });
  }
  #excludedTargetMessage(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget) {
    const owed = target.required || snapshot.confirmedPlan?.plan.obligations?.some((obligation) => obligation.id === target.obligation_id && obligation.selected);
    if (owed) return snapshot.permissions.canAuthor
      ? this.#t("owedTargetNeedsPlan", "This target is still owed, but it is excluded from this plan’s generation selection. Use Review delivery plan to include it before checking generation.")
      : this.#t("owedTargetNeedsAuthor", "This target is still owed, but it is excluded from this plan’s generation selection. Ask someone with permission to edit this Document to include it before checking generation.");
    return snapshot.permissions.canAuthor
      ? this.#t("optionalTargetNeedsPlan", "This optional target is not selected in the confirmed delivery plan. Use Review delivery plan to select it before checking generation.")
      : this.#t("optionalTargetNeedsAuthor", "This optional target is not selected in the confirmed delivery plan. Ask someone with permission to edit this Document to select it before checking generation.");
  }
  #amendmentReasonCorrection() {
    return this.#t("amendmentReasonInvalid", "Use at most {limit} characters and remove invisible control or formatting characters from the reason. Tabs and line breaks are allowed. Your text is retained for correction; confirmation is blocked until it is valid.",
      { limit: this.i18n.number(OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH) });
  }

  async #refresh(force = false) {
    if (this.#loading) return;
    this.#loading = true;
    const view = this.#captureView();
    try { await this.store.outputRequirements.ensure(view.documentId, { force }); }
    finally { if (view.epoch === this.#viewEpoch && view.documentId === this.documentId) { this.#loading = false; this.requestUpdate(); } }
  }

  #sourceRefreshScopeKey() {
    const session = this.store.session.get(), context = session?.projectContext, projection = this.store.projection.get();
    return JSON.stringify([this.store.captureAuthorizationScope()?.key ?? "", this.documentId, projection.projectId, projection.documentId,
      this.store.route.get(), context?.organizationId ?? null, context?.projectAccessId ?? null,
      (context?.permissions ?? session?.capabilities ?? []).includes("project.read"), this.store.outputRequirements.resource(this.documentId).privateRevision ?? 0]);
  }
  #captureSourceRefresh(): OutputSourceRefreshIntent {
    const projection = this.store.projection.get(), context = this.store.session.get()?.projectContext;
    return { authorization: this.store.captureAuthorizationScope(), documentId: this.documentId, projectId: projection.projectId,
      currentDocumentId: projection.documentId, route: this.store.route.get(), organizationId: context?.organizationId ?? null,
      projectAccessId: context?.projectAccessId ?? null, epoch: this.#sourceRefreshEpoch };
  }
  #sourceRefreshCurrent(intent: OutputSourceRefreshIntent) {
    const projection = this.store.projection.get(), session = this.store.session.get(), context = session?.projectContext;
    return this.isConnected && intent.epoch === this.#sourceRefreshEpoch && this.#sourceRefreshScope === this.#sourceRefreshScopeKey()
      && intent.documentId === this.documentId && intent.projectId === projection.projectId && intent.currentDocumentId === projection.documentId
      && intent.route === this.store.route.get() && this.store.authorizationScopeActive(intent.authorization)
      && intent.organizationId === (context?.organizationId ?? null) && intent.projectAccessId === (context?.projectAccessId ?? null)
      && (context?.permissions ?? session?.capabilities ?? []).includes("project.read")
      && projection.documents.some(document => document.id === intent.documentId && document.projectId === intent.projectId && !document.removed);
  }
  async #refreshSource(intent: OutputSourceRefreshIntent) {
    if (!this.#sourceRefreshCurrent(intent) || this.#loading || this.#sourceRefreshing || this.#busy
      || this.store.outputRequirements.resource(intent.documentId).errorCode !== "output_target_source_projection_stale") return;
    this.#sourceRefreshing = true; this.requestUpdate();
    try {
      const result = await this.store.refreshOutputSource(intent, { current: () => this.#sourceRefreshCurrent(intent) });
      if (!this.#sourceRefreshCurrent(intent)) return;
      if (result.status === "refreshed") this.#announce(this.#message("output_target_source_refresh_done"));
      else if (result.status === "unavailable") this.#announce(this.#message("output_target_source_refresh_failed"), true);
    } finally {
      if (this.#sourceRefreshCurrent(intent)) { this.#sourceRefreshing = false; this.requestUpdate(); }
    }
  }
  #refreshControl(classes: string) {
    const resource = this.store.outputRequirements.resource(this.documentId);
    const needsProject = resource.errorCode === "project_context_required" && !this.store.session.get()?.projectContext;
    if (resource.errorCode !== "output_target_source_projection_stale" && !needsProject) return html`<button aria-label=${this.#controlName(this.#t("refresh", "Refresh outputs"))} type="button" class=${classes} ?disabled=${this.#loading || this.#sourceRefreshing} @click=${() => this.#refresh(true)}>${this.#t("refresh", "Refresh outputs")}</button>`;
    const intent = this.#captureSourceRefresh(), current = this.#sourceRefreshCurrent(intent);
    const documents = this.store.projection.get().documents.filter(document => document.projectId === intent.projectId && !document.removed), index = documents.findIndex(document => document.id === intent.documentId);
    const name = index < 0 ? "" : this.#message("output_target_source_document_context", { number: this.i18n.number(index + 1), name: "\u2068" + documents[index]!.title + "\u2069" });
    if (!intent.organizationId || !intent.projectAccessId) return html`<div class="output-source-refresh"><p>${this.#message("output_target_source_refresh_needs_project")}</p><a href="/settings/workspaces" class="button secondary" data-output-source-open-projects aria-label=${this.#message("output_target_source_open_projects") + (name ? " · " + name : "")} @click=${(event: MouseEvent) => { if (!current || !this.#sourceRefreshCurrent(intent)) event.preventDefault(); }}>${this.#message("output_target_source_open_projects")}</a></div>`;
    return html`<button type="button" class=${classes} data-output-source-refresh aria-label=${this.#message("output_target_source_refresh") + (name ? " · " + name : "")} ?disabled=${!current || this.#loading || this.#sourceRefreshing || Boolean(this.#busy)} @click=${() => this.#refreshSource(intent)}>${this.#message("output_target_source_refresh")}</button>`;
  }

  #readinessMessage(gate: OutputReadinessGate) {
    if (gate.reason === "history_unverified") return this.#message("output_scope_history_reason_unverified");
    const governedCapacity = gate.reason === "source_unavailable" && gate.reasonCodes.includes("output_source_governance_capacity_exceeded");
    const message = governedCapacity ? this.#message("output_source_governance_capacity_exceeded") : gate.reason === "capacity_unknown"
      ? this.#t("sourceCapacityUnknown", "Current imported-source counts or route limits are unavailable. Native generation stays blocked until these values are verified.")
      : gate.reason === "native_capacity"
        ? this.#t("nativeCapacityExceeded", "Distinct imported source files in this Document: {count}. The current native route limit is {limit}. Owned uploads and reads have their own limit. Reconfirming the plan does not change either limit.", { count: gate.values?.count === undefined ? this.#t("sourceValueUnknown", "Unknown") : this.i18n.number(gate.values.count), limit: gate.values?.limit === undefined ? this.#t("sourceValueUnknown", "Unknown") : this.i18n.number(gate.values.limit) })
        : gate.reason === "source_unknown"
      ? this.#t("sourceChecksUnknown", "Current source checks are unknown. Refresh outputs to obtain their status.")
      : gate.reason === "source_unavailable"
        ? this.#t("sourceChecksUnavailable", "Current source access, rights, or evidence checks did not complete. Resolve the reported issues; refreshing only rechecks their status.")
        : gate.reason === "scope_unknown"
          ? this.#t("deliveryScopeUnavailable", "The complete delivery state could not be verified. Refresh to recheck its records and evidence. Reconfirming a plan does not repair missing evidence or capacity limits.")
          : gate.reason === "plan_stale"
            ? this.#t("reconfirmGuidance", "Refreshing cannot make an earlier plan current. Review and confirm the new scope, then recheck retained files. Previous approvals and charges stay in history; no new work starts automatically.")
            : this.#t("notConfirmedShort", "Delivery plan not yet confirmed.");
    return [message, ...gate.reasonCodes.filter((code) => !governedCapacity || code !== "output_source_governance_capacity_exceeded").map((code) => this.#message(code))].join(" ");
  }

  #sourceNotice(snapshot: OutputRequirementsSnapshot) {
    const gate = outputSourceReadiness(snapshot);
    if (gate.allowed) return nothing;
    return html`<section class="output-attention" role="status"><h3>${snapshot.confirmedPlan ? this.#t("savedPlanSourcesUnverified", "Saved plan; source checks are not verified") : this.#t("sourceChecksTitle", "Source checks need attention")}</h3>
      <p>${this.#readinessMessage(gate)}</p><p>${this.#t("sourceChecksMeaning", "These checks cover current source access, rights, and evidence integrity; they do not fact-check or approve content. Authors may edit and confirm structure while uploads, file use, generation, and delivery remain blocked.")}</p>
      ${gate.reasonCodes.includes("output_source_governance_capacity_exceeded") ? this.#governedSourceDisclosure(snapshot) : nothing}</section>`;
  }

  #governedSourceDisclosure(snapshot: OutputRequirementsSnapshot) {
    const governance = outputSourceGovernance(snapshot);
    return html`<section class="output-governed-source-disclosure" aria-label=${this.#t("governedSourcesTitle", "Governed sources in this Document")}>
      <h4>${this.#t("governedSourcesTitle", "Governed sources in this Document")}</h4>
      ${governance?.sources.length ? html`<ul>${governance.sources.map((source) => html`<li dir="auto">${source.label}</li>`)}</ul>` : html`<p>${this.#t("governedSourcesUnavailable", "The authorized governed-source list is unavailable. Inspect this Document’s source blocks and ask a workspace administrator to investigate.")}</p>`}
      ${governance && !governance.sourcesComplete ? html`<p>${this.#t("governedSourcesIncomplete", "This is a partial list of authorized source labels. It is not the complete governed-source inventory.")}</p>` : nothing}
      <p>${this.#t("governedVerificationActions", "Matching, content review, exports, and exact-file downloads also require these source checks. Owned uploads do not bypass them.")}</p>
      <p>${this.#t("governedVerificationRetained", "The full assignment, saved plans, previous results, and spending history remain. Confirming structure does not verify sources or make delivery ready.")}</p>
      <p>${this.#t("governedVerificationRemedy", "Refresh only rechecks the state; it does not increase capacity. Preserve source and origin records. Ask a workspace administrator to inspect the governed-source chain; flattening or deleting origin records is not a valid workaround.")}</p>
      <details><summary aria-label=${this.#controlName(this.#t("governedCaptureDetails", "Technical verification limit"))}>${this.#t("governedCaptureDetails", "Technical verification limit")}</summary><p>${governance?.captureBatchLimit === null || governance?.captureBatchLimit === undefined ? this.#t("governedCaptureUnknown", "The database capture-batch limit was not supplied.") : this.#t("governedCaptureLimit", "Database capture batches allowed for this verification: {limit}. This is a database-work limit, not a package count or nesting-depth limit.", { limit: this.i18n.number(governance.captureBatchLimit) })}</p></details>
    </section>`;
  }

  #sourceCapacityNotice(snapshot: OutputRequirementsSnapshot) {
    const capacity = outputSourceCapacity(snapshot);
    if (!capacity) return html`<section class="output-attention"><h3>${this.#t("sourceCapacityTitle", "Imported sources and route limits")}</h3><p>${this.#t("sourceCapacityUnknown", "Current imported-source counts or route limits are unavailable. Native generation stays blocked until these values are verified.")}</p></section>`;
    const limit = (value: number | null) => value === null ? this.#t("sourceLimitUnknown", "Limit not verified") : this.#t("sourceRouteLimit", "Limit for distinct imported source files: {count}", { count: this.i18n.number(value) });
    const missingNames = capacity.referenceCount === null ? null : Math.max(0, capacity.referenceCount - capacity.sources.length);
    const native = outputNativeReadiness(snapshot);
    return html`<section class="output-source-capacity output-attention"><h3>${this.#t("sourceCapacityTitle", "Imported sources and route limits")}</h3>
      ${capacity.referenceCount === null ? nothing : html`<p>${this.#t("sourceReferenceCount", "Imported-source references: {count}.", { count: this.i18n.number(capacity.referenceCount) })}</p>`}
      <p>${capacity.countsComplete && capacity.distinctObjectCount !== null ? this.#t("sourceDistinctCount", "Distinct stored source files: {count}.", { count: this.i18n.number(capacity.distinctObjectCount) }) : this.#t("sourceDistinctUnknown", "The distinct source total is unknown; it is not assumed to be zero.")}</p>
      <dl><dt>${this.#t("sourceOwnedRoute", "Owned uploads and file reads")}</dt><dd>${limit(capacity.ownedReadLimit)}</dd><dt>${this.#t("sourceNativeRoute", "Native generation")}</dt><dd>${limit(capacity.nativeLimit)}</dd></dl>
      <p>${this.#t("sourceLimitsMeaning", "Route limits describe bounded evidence checks, not source removal or permission to use a file. Current source checks and the route’s own preflight must still pass.")}</p>
      ${capacity.sources.length ? html`<h4>${this.#t("sourceAuthorizedNames", "Authorized imported sources")}</h4><ul>${capacity.sources.map((source) => html`<li dir="auto">${source.label}</li>`)}</ul>` : capacity.countsComplete && capacity.referenceCount === 0 ? html`<p>${this.#t("sourceNoImports", "No imported-source references are reported.")}</p>` : nothing}
      ${!capacity.sourcesComplete ? html`<p>${missingNames === null ? this.#t("sourceNamesUnknown", "The authorized source-name list is incomplete or contains shortened names.") : this.#t("sourceNamesIncomplete", "The source-name list is incomplete or contains shortened names. {count} reference names are not shown.", { count: this.i18n.number(missingNames) })}</p>` : nothing}
      ${native.reason === "capacity_unknown" || native.reason === "native_capacity" ? html`<p role="status">${this.#readinessMessage(native)}</p>` : nothing}
    </section>`;
  }

  #summary(summary: OutputPlanSummary | null | undefined, unconfirmed = false, historyUnverified = false) {
    if (historyUnverified) return this.#message("output_scope_history_reason_unverified");
    if (!summary && unconfirmed) return this.#t("notConfirmedShort", "Delivery plan not yet confirmed.");
    if (!summary || !summary.scope_known || summary.completion === "unknown") return this.#t("scopeUnknown", "Delivery scope is unknown. Refresh before acting.");
    if (summary.completion === "not_requested") return this.#t("noneRequested", "No deliverables requested.");
    if (summary.completion === "complete") return this.#t("completeScope", "All {required} required groups and {optional} selected optional obligations have accepted, current files.", { required: summary.required_groups, optional: summary.selected_optional_obligations });
    return this.#t("progressScope", "{done} of {total} required groups ready · {optional} selected optional obligations remain · {unresolved} decisions unresolved", { done: summary.fulfilled_required_groups, total: summary.required_groups, optional: summary.selected_optional_obligations - summary.fulfilled_selected_optional_obligations, unresolved: summary.unresolved_required_groups + summary.unresolved_selected_optional_groups });
  }

  #isolate(value: string) { return "\u2068" + value + "\u2069"; }
  #documentDisplayContext(documentId = this.documentId, projectId = this.store.outputRequirements.resource(this.documentId).snapshot?.projectId) {
    const projection = this.store.projection.get();
    if (!projectId || projectId !== projection.projectId) return undefined;
    const documents = (projection.documents ?? []).filter(document => document.projectId === projectId && !document.removed);
    const index = documents.findIndex(document => document.id === documentId);
    return index < 0 ? undefined : { projectId, documentId, title: documents[index].title, ordinal: index + 1 };
  }
  #documentContext() {
    const context = this.#documentDisplayContext();
    return context
      ? this.#message("output_target_source_document_context", { number: this.i18n.number(context.ordinal), name: this.#isolate(context.title) })
      : this.#t("contextDocumentIdentity", "Document {identity}", { identity: this.#isolate(this.documentId) });
  }
  #controlName(label: string, context = "") { return [label, this.#documentContext(), context].filter(Boolean).join(" · "); }
  #requirementContext(snapshot: Pick<OutputRequirementsSnapshot, "requirements">, requirementId: string) {
    const position = snapshot.requirements.findIndex(row => row.blockId === requirementId);
    const row = snapshot.requirements[position], name = this.#isolate(row?.spec?.label || row?.subtype || this.#t("title", "Outputs"));
    return position >= 0
      ? this.#t("contextRequirement", "Requirement {number}: {name}", { number: this.i18n.number(position + 1), name })
      : this.#t("contextRequirementIdentity", "Requirement: {name} ({identity})", { name, identity: this.#isolate(requirementId) });
  }
  #targetContext(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget, targets = snapshot.confirmedPlan?.plan.targets ?? []) {
    const position = targets.findIndex(row => row.id === target.id);
    const name = this.#isolate(target.label);
    const targetName = position >= 0
      ? this.#t("contextTarget", "Target {number}: {name}", { number: this.i18n.number(position + 1), name })
      : this.#t("contextTargetIdentity", "Target: {name} ({identity})", { name, identity: this.#isolate(target.id) });
    return this.#requirementContext(snapshot, target.requirement_id) + " · " + targetName;
  }
  #resultContext(snapshot: OutputRequirementsSnapshot, result: OutputResultRow) {
    const position = snapshot.results.findIndex(row => row.id === result.id);
    const asset = snapshot.assets.find(row => row.id === result.assetId);
    const target = snapshot.confirmedPlan?.plan.targets.find(row => row.id === result.targetId);
    const name = this.#t("contextResult", "Result {number}: {name}", { number: this.i18n.number(position + 1), name: this.#isolate(asset?.name ?? this.#t("file", "File")) });
    return target ? this.#targetContext(snapshot, target) + " · " + name : name;
  }
  #planOwnerContext(snapshot: Pick<OutputRequirementsSnapshot, "requirements">, ownerId: string) {
    for (const row of snapshot.requirements) {
      for (const [position, deliverable] of (row.spec?.deliverables ?? []).entries()) {
        const parent = this.#requirementContext(snapshot, row.blockId) + " · " + this.#t("contextDeliverable", "Deliverable {number}: {name}", { number: this.i18n.number(position + 1), name: this.#isolate(deliverable.label) });
        if (deliverable.id === ownerId) return parent;
        const variant = deliverable.format_variants?.findIndex(value => value.id === ownerId) ?? -1;
        if (variant >= 0) return parent + " · " + this.#t("contextFormat", "Format {number}: {name}", { number: this.i18n.number(variant + 1), name: this.#isolate(deliverable.format_variants![variant].label) });
        const member = deliverable.series?.members.findIndex(value => value.id === ownerId) ?? -1;
        if (member >= 0) return parent + " · " + this.#t("contextMember", "Series member {number}: {name}", { number: this.i18n.number(member + 1), name: this.#isolate(deliverable.series!.members[member].label) });
      }
    }
    return this.#t("contextRequirementIdentity", "Requirement: {name} ({identity})", { name: this.#isolate(this.documentName || this.#t("title", "Outputs")), identity: this.#isolate(ownerId) });
  }
  #authorizationContext(snapshot: OutputRequirementsSnapshot, grant: OutputRequirementsSnapshot["grants"][number]) {
    return this.#t("contextAuthorization", "Authorization {number}", { number: this.i18n.number(snapshot.grants.findIndex(row => row.id === grant.id) + 1) });
  }
  #attemptContext(snapshot: OutputRequirementsSnapshot, grant: OutputRequirementsSnapshot["grants"][number], operation: OutputRequirementsSnapshot["grants"][number]["operations"][number]) {
    const target = snapshot.confirmedPlan?.plan.targets.find(row => row.id === operation.targetId);
    const label = target ? this.#targetContext(snapshot, target) : this.#isolate((operation as { targetLabel?: string }).targetLabel || this.#t("previousPlanTarget", "Target from an earlier plan"));
    return label + " · " + this.#authorizationContext(snapshot, grant) + " · " + this.#t("contextAttempt", "Attempt {number}", { number: this.i18n.number(grant.operations.findIndex(row => row.id === operation.id) + 1) });
  }
  #cardSnapshot(snapshot: OutputRequirementsSnapshot, row: OutputRequirementRow): OutputRequirementCardSnapshot {
    const savedOptions = outputSavedPlanningOptions(snapshot);
    const sourceReady = outputSourceReadiness(snapshot).allowed;
    const summaries = (snapshot as OutputRequirementsSnapshot & { requirementSummaries?: Record<string, OutputPlanSummary> }).requirementSummaries;
    const summary = summaries?.[row.blockId];
    const results = snapshot.results.filter((result) => snapshot.confirmedPlan?.plan.targets.some((target) => target.requirement_id === row.blockId && target.id === result.targetId) && result.planRevisionId === snapshot.confirmedPlan?.revisionId);
    return {
      scope: { projectId: snapshot.projectId, documentId: snapshot.documentId, authorizationScopeKey: this.store.captureAuthorizationScope()?.key ?? "" },
      requirementId: row.blockId, requirementOrdinal: snapshot.requirements.findIndex((candidate) => candidate.blockId === row.blockId) + 1, revision: snapshot.revision,
      documentContext: this.#documentDisplayContext(snapshot.documentId, snapshot.projectId),
      label: row.spec?.label || row.subtype, originalText: row.content, spec: row.spec ?? row.preserved,
      canEdit: !this.inspectionOnly && snapshot.permissions.canAuthor && !row.locked && row.status !== "unsupported",
      canReviewPlan: !this.inspectionOnly && snapshot.permissions.canAuthor,
      summary: {
        headline: sourceReady ? this.#summary(summary, !snapshot.confirmedPlan && this.store.outputRequirements.resource(this.documentId).state === "ready", snapshot.capabilities.limitationCodes?.includes("output_scope_history_reason_unverified")) : this.#t("sourceReadinessUnknown", "Source checks are unavailable; delivery readiness is unknown."),
        detail: !sourceReady ? this.#readinessMessage(outputSourceReadiness(snapshot)) : summary ? this.#t("cardScope", "This requirement’s entire scope, including work outside the selected run.") : this.#t("notConfirmed", "Review and confirm requirements to establish the delivery scope. This does not generate files."),
        overall: !sourceReady || !summary?.scope_known || summary.completion === "unknown" ? "unknown" : summary.completion === "complete" ? "complete" : summary.completion === "partial" ? "partial" : summary.completion === "unresolved" ? "unresolved" : "planned",
        requiredRemaining: sourceReady && summary?.scope_known ? summary.required_obligations - summary.fulfilled_required_obligations : null,
        unresolvedGroups: sourceReady && summary?.scope_known ? summary.unresolved_required_groups : null,
        selectedResultFiles: sourceReady && summary?.scope_known ? (snapshot as OutputRequirementsSnapshot & { requirementFileCounts?: Record<string, number | null> }).requirementFileCounts?.[row.blockId] ?? null : null,
      },
      sourceOptions: this.store.projection.get().libraryBlocks.filter((block) => block.documentId === snapshot.documentId && !block.removed && block.type.toLowerCase() !== "output").map((block) => ({ id: block.id, label: String(block.properties.label ?? block.handle) })),
      planSuggestions: { countPolicies: { ...savedOptions.count_policies }, suggestedCounts: { ...savedOptions.suggested_counts } },
      results: results.map((result) => ({ targetId: result.targetId, artifactId: result.assetId, revision: result.resultRevision, title: snapshot.assets.find((asset) => asset.id === result.assetId)?.name ?? this.#t("file", "File"), stateLabel: this.#resultLabel(result), canOpen: sourceReady && snapshot.permissions.canDownload && snapshot.assets.some((asset) => asset.id === result.assetId && asset.available) })),
    };
  }

  async #save(event: CustomEvent<SaveIntent>) {
    event.stopPropagation();
    const detail = event.detail;
    if (!this.#intentScopeCurrent(detail.scope) || detail.expectedRevision === null || this.#busy) return;
    const view = this.#captureView(), route = this.store.route.get(), previous = this.#editors.get(detail.requirementId);
    if (!this.#viewCurrent(view) || previous?.sourceRetired && !previous.receipt && previous.clientMutationId !== detail.clientMutationId) return;
    const original = this.#unresolvedWrite();
    if (original && (original.status === "pending" || original.sourceRetired || original.clientMutationId !== detail.clientMutationId)) {
      this.#editors.set(detail.requirementId, { status: "not-attempted", clientMutationId: detail.clientMutationId }); this.#writeNotAttempted(); return;
    }
    this.#editors.set(detail.requirementId, { status: "saving", clientMutationId: detail.clientMutationId });
    this.#busy = `save:${detail.requirementId}`; this.requestUpdate();
    try {
      const result = await this.store.outputRequirementCommand({ action: "save", documentId: view.documentId, expectedRevision: String(detail.expectedRevision), clientMutationId: detail.clientMutationId, blockId: detail.requirementId, spec: detail.draft, planSuggestions: { count_policies: detail.planSuggestions.countPolicies, suggested_counts: detail.planSuggestions.suggestedCounts } } as OutputRequirementCommand, {
        current: () => this.#viewCurrent(view) && this.store.route.get() === route && this.#editors.get(detail.requirementId)?.clientMutationId === detail.clientMutationId,
      });
      if (!this.#viewCurrent(view)) {
        const receipt = this.#originalAcknowledgment(view, result, detail.clientMutationId, "save");
        if (receipt && this.#editors.get(detail.requirementId)?.clientMutationId === detail.clientMutationId) {
          this.#editors.set(detail.requirementId, { status: "saved", clientMutationId: detail.clientMutationId, sourceRetired: true, receipt }); this.requestUpdate();
        }
        return;
      }
      if (result.status === "not-attempted") {
        this.#editors.set(detail.requirementId, { status: "not-attempted", clientMutationId: detail.clientMutationId }); this.#writeNotAttempted(); return;
      }
      const current = this.#snapshot();
      if (current) this.#observePlanning(current);
      const row = current?.requirements.find((candidate) => candidate.blockId === detail.requirementId);
      this.#editors.set(detail.requirementId, { status: result.status, clientMutationId: detail.clientMutationId, ...(current && row ? { latest: this.#cardSnapshot(current, row) } : {}), ...(result.status === "saved" ? {} : { issues: [{ path: "", message: this.#failure(result) }] }) });
      this.#announce(result.status === "saved" ? this.#t("saved", "Requirements saved. No generation was started.") : this.#failure(result), result.status !== "saved");
      this.#preflight = null;
    } finally { if (this.#viewCurrent(view)) { this.#busy = ""; this.requestUpdate(); } }
  }

  async #command(command: Command, planCapture?: OutputPlanConfirmationCapture) {
    const snapshot = this.#snapshot();
    if (!snapshot || this.#busy || this.store.outputRequirements.resource(this.documentId).state !== "ready") return null;
    if (["preflight", "authorize", "run", "bind", "review", "export"].includes(command.action)) {
      const gate = ["preflight", "authorize", "run"].includes(command.action) ? outputNativeReadiness(snapshot) : command.action === "export" ? outputPackageReadiness(snapshot) : outputDeliveryReadiness(snapshot);
      if (!gate.allowed) { this.#preflight = null; this.#authorizationAcknowledged = false; this.#paidActivation.clear(); this.#announce(this.#readinessMessage(gate), true); return null; }
      if (command.action === "preflight") { this.#preflight = null; this.#authorizationAcknowledged = false; this.#paidActivation.clear(); }
    }
    const view = this.#captureView(), route = this.store.route.get();
    if (!this.#viewCurrent(view)) return null;
    const original = this.#unresolvedWrite();
    if (original && (original.status === "pending" || original.sourceRetired || original.clientMutationId !== this.#uncertainCommand?.id)) { this.#writeNotAttempted(); return null; }
    if (planCapture && captureOutputPlanProposalBase(snapshot, this.#lastScope).semanticKey !== planCapture.semanticKey) {
      this.#observePlanning(snapshot);
      this.#announce(this.#t("planReviewUpdated", "The planning base changed. Review the updated comparison before confirming."), true);
      return null;
    }
    const expectedRevision = planCapture?.expectedRevision ?? snapshot.revision;
    this.#busy = command.action; this.requestUpdate();
    try {
      // Retain a complete binding digest, never command prose, in the existing uncertain owner.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
        command, documentId: view.documentId, expectedRevision, sourceRevision: snapshot.sourceRevision,
        requirementRevision: snapshot.requirementRevision, ...(planCapture ? { semanticKey: planCapture.semanticKey } : {}),
      })));
      if (!this.#viewCurrent(view) || this.#snapshot() !== snapshot) return null;
      const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (original && this.#uncertainCommand?.signature !== signature) { this.#writeNotAttempted(); return null; }
      const previousReceipt = this.#uncertainCommand;
      const receipt = this.#uncertainCommand?.signature === signature && !this.#uncertainCommand.receipt
        ? this.#uncertainCommand : { signature, id: crypto.randomUUID(), expectedRevision };
      this.#uncertainCommand = receipt;
      const result = await this.store.outputRequirementCommand({ ...command, documentId: view.documentId, expectedRevision: receipt.expectedRevision, clientMutationId: receipt.id } as OutputRequirementCommand, {
        current: () => this.#viewCurrent(view) && this.store.route.get() === route && this.#snapshot() === snapshot
          && (!planCapture || Boolean(this.#reviewPlan && this.#planning && outputPlanConfirmationCanClose(this.#planning, planCapture))),
      });
      if (!this.#viewCurrent(view)) {
        const acknowledged = this.#originalAcknowledgment(view, result, receipt.id, command.action);
        if (acknowledged && this.#uncertainCommand?.id === receipt.id) {
          this.#uncertainCommand = { ...this.#uncertainCommand, sourceRetired: true, receipt: acknowledged }; this.requestUpdate();
        }
        return null;
      }
      if (result.status === "not-attempted") {
        if (this.#uncertainCommand?.id === receipt.id) this.#uncertainCommand = previousReceipt;
        this.#writeNotAttempted(); return null;
      }
      if (result.status !== "unavailable") this.#uncertainCommand = null;
      if (result.status !== "saved") { this.#announce(this.#failure(result), true); return null; }
      return result.body;
    } finally { if (this.#viewCurrent(view)) { this.#busy = ""; this.requestUpdate(); } }
  }

  async #confirm(event: SubmitEvent) {
    event.preventDefault();
    const snapshot = this.#snapshot();
    if (!snapshot || !this.#planning || !this.#planEditingAllowed() || snapshot.requirements.some((row) => !row.spec || row.status !== "valid")) return;
    if (outputScopeAmendmentReasonIssue(this.#planning.draft.amendmentReason)) { this.#announce(this.#amendmentReasonCorrection(), true); return; }
    if (outputPlanProposalHasInvalidFields(this.#planning)) {
      this.#announce(this.#t("planInvalidCount", "Enter valid positive counts within the authored bounds, or keep the rule undecided. Blank exact counts are not zero and cannot be confirmed."), true); return;
    }
    const captured = captureOutputPlanConfirmation(this.#planning, snapshot, this.#lastScope);
    if (!captured) {
      this.#observePlanning(snapshot);
      this.#announce(this.#t("planReviewUpdated", "The planning base changed. Review the updated comparison before confirming."), true);
      return;
    }
    const proposal = compileOutputPlan(snapshot.requirements.flatMap((row) => row.spec ? [row.spec] : []), { document_id: snapshot.documentId, source_revision: snapshot.sourceRevision, requirement_revision: snapshot.requirementRevision, ...captured.options });
    if (proposal.issues.length) { this.#announce(proposal.issues.map((issue) => this.#problem(issue.code)).join(" "), true); return; }
    const response = await this.#command({ action: "confirm", options: captured.options, ...(captured.amendmentReason ? { amendmentReason: captured.amendmentReason } : {}) } as Command, captured);
    if (response) {
      if (this.#planning && outputPlanConfirmationCanClose(this.#planning, captured)) {
        this.#planning = observeOutputPlanProposal(null, response.snapshot, this.#lastScope);
        this.#closePlan();
      }
      this.#preflight = null; this.#paidActivation.clear();
      this.#announce(this.#t("confirmed", "Requirements confirmed. No generation was started."));
    }
  }

  #reviewIntent(event: CustomEvent<PlanIntent>) {
    event.stopPropagation();
    if (!this.#intentScopeCurrent(event.detail.scope)) return;
    // Navigation never replays a stale card's proposal over the authoritative saved snapshot.
    if (this.blockId) window.dispatchEvent(new CustomEvent("forma-output-show-plan", { detail: event.detail }));
    else this.#openPlan();
  }

  async #inspectRun(event: SubmitEvent) {
    event.preventDefault();
    const plan = this.#snapshot()?.confirmedPlan;
    if (!plan || !this.#selectedTargets.size) return;
    if (this.#selectedTargets.size > OUTPUT_PREFLIGHT_TARGET_MAX_COUNT) { this.#announce(this.#selectionLimitMessage(), true); return; }
    const intent = this.#captureNativeIntent([...this.#selectedTargets]);
    if (!intent) return;
    const response = await this.#command({ action: "preflight", planRevisionId: plan.revisionId, targetIds: intent.targetIds });
    if (response?.command.preflight && this.#adoptPreflight(response.command.preflight, intent)) this.#announce(this.#t("preflightReady", "Review the provider, source transfer, and maximum cost. Nothing has been generated."));
  }

  #grantDisclosureCurrent(snapshot: OutputRequirementsSnapshot, grant: OutputRequirementsSnapshot["grants"][number]) {
    const disclosure = grant.disclosure;
    const targets = [...new Set(grant.operations.map((operation) => operation.targetId))];
    return Boolean(disclosure && grant.planRevisionId === snapshot.confirmedPlan?.revisionId && this.#preflightMatchesScope(snapshot, disclosure, targets));
  }
  #paidDecision(action: "authorize" | "run", grantId = ""): OutputPaidDecision | null {
    const snapshot = this.#snapshot();
    const authorization = this.store.captureAuthorizationScope();
    if (!snapshot?.confirmedPlan || !authorization || !this.isConnected || this.inspectionOnly || this.#busy
      || snapshot.documentId !== this.documentId || !snapshot.permissions.canRequest || !outputNativeReadiness(snapshot).allowed || this.store.outputRequirements.resource(this.documentId).state !== "ready") return null;
    const base = { authorizationScopeKey: authorization.key, documentId: this.documentId, viewEpoch: this.#viewEpoch, planRevisionId: snapshot.confirmedPlan.revisionId };
    if (action === "authorize") {
      const preflight = this.#currentPreflight(snapshot), intent = this.#preflightIntent;
      if (!preflight || !intent || !this.#preflightAvailable(preflight) || !Number.isFinite(Date.parse(preflight.expiresAt)) || Date.parse(preflight.expiresAt) <= Date.now()) return null;
      return { ...base, action, preflightId: preflight.id, termsDigest: preflight.termsDigest,
        executionScopeKey: JSON.stringify([intent.targetScopeKey, intent.selectionKey, intent.alternativeOfSlotId, preflight]) };
    }
    const grant = snapshot.grants.find((entry) => entry.id === grantId);
    if (!grant || !this.#grantDisclosureCurrent(snapshot, grant) || grant.actorUserId !== snapshot.scope.actorUserId
      || (grant.status !== "authorized" && grant.status !== "active") || !outputGrantHasQueuedOperations(grant) || !grant.disclosure || !this.#preflightAvailable(grant.disclosure)
      || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.now()) return null;
    return { ...base, action, grantId, executionScopeKey: JSON.stringify([
      this.#nativeScopeKey(snapshot, grant.disclosure.targets.map((target) => target.targetId)), grant.disclosure,
      grant.actorUserId, grant.payerUserId, grant.maximumMicrousd, grant.maximumCalls, grant.expiresAt,
      grant.operations.map((operation) => [operation.id, operation.targetId, operation.jobId, operation.status]).sort((a, b) => a[0].localeCompare(b[0])),
    ]) };
  }

  #armPaidAction(event: MouseEvent, shownDecision: OutputPaidDecision | null) {
    const decision = shownDecision && this.#paidDecision(shownDecision.action, shownDecision.action === "run" ? shownDecision.grantId : "");
    if (!decision || !shownDecision || outputPaidDecisionKey(decision) !== outputPaidDecisionKey(shownDecision) || !(event.currentTarget instanceof HTMLButtonElement)) { this.#paidActivation.clear(); return; }
    const token = this.#paidActivation.arm(event, event.currentTarget, decision, navigator.userActivation?.isActive === true);
    if (token !== null) setTimeout(() => this.#paidActivation.expire(token), 0);
  }

  #directPaidSubmit(event: SubmitEvent, action: "authorize" | "run", grantId = "") {
    const decision = this.#paidDecision(action, grantId);
    if (!decision) { this.#paidActivation.clear(); return false; }
    return this.#paidActivation.consume(event, decision, navigator.userActivation?.isActive === true);
  }

  async #authorize(event: SubmitEvent) {
    event.preventDefault();
    if (!this.#directPaidSubmit(event, "authorize") || !this.#authorizationAcknowledged || !this.#preflight) return;
    const preflight = this.#preflight;
    if (!this.#preflightAvailable(preflight) || Date.parse(preflight.expiresAt) <= Date.now()) return;
    const response = await this.#command({ action: "authorize", preflightId: preflight.id, termsDigest: preflight.termsDigest, maximumMicrousd: preflight.maximumMicrousd, explicitAuthorization: true });
    if (response) { this.#preflight = null; this.#announce(this.#t("authorized", "The selected work is authorized within the disclosed limits. Start it when ready.")); }
  }

  async #run(event: SubmitEvent, grantId: string) {
    event.preventDefault();
    if (!this.#directPaidSubmit(event, "run", grantId)) return;
    const response = await this.#command({ action: "run", grantId });
    if (response) { this.#announce(this.#t("started", "The existing operations were queued. Repeating this action recovers the same operations.")); await this.store.syncDocumentJobs(); }
  }

  #setFile(event: Event) {
    if (!this.store.sourceOwnershipActive(this.store.captureSourceOwnership()) || this.#uploadSourceRetired && !this.#uploadReceipt) return;
    if (this.#unresolvedWrite()?.sourceRetired) { this.#writeNotAttempted(); return; }
    this.#uploadSourceRetired = false; this.#uploadReceipt = null;
    this.#file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.#uploadFailure = null;
    this.#rightsConfirmed = false; this.#uploadCommandId = crypto.randomUUID();
    this.#uploadRevision = this.#snapshot()?.revision ?? "";
    this.requestUpdate();
  }

  async #upload(event: SubmitEvent) {
    event.preventDefault();
    const resource = this.store.outputRequirements.resource(this.documentId);
    if (!this.#file || !this.#rightsConfirmed || this.#busy || outputUploadNeedsRestage(this.#uploadFailure) || resource.state !== "ready" || !resource.snapshot?.permissions.canAuthor || !resource.snapshot.capabilities.ownedFileAdoption) return;
    const gate = outputSourceReadiness(resource.snapshot);
    if (!gate.allowed) { this.#announce(this.#readinessMessage(gate), true); return; }
    const view = this.#captureView(), route = this.store.route.get(), file = this.#file, mutationId = this.#uploadCommandId;
    if (!this.#viewCurrent(view) || this.#uploadSourceRetired) return;
    const original = this.#unresolvedWrite();
    if (original && (original.status === "pending" || original.sourceRetired || original.clientMutationId !== mutationId)) { this.#writeNotAttempted(); return; }
    this.#busy = "upload"; this.requestUpdate();
    try {
      const result = await this.store.uploadOutputAsset(view.documentId, file, this.#uploadRevision, mutationId, true, {
        current: () => this.#viewCurrent(view) && this.store.route.get() === route && this.#file === file && this.#uploadCommandId === mutationId && this.#rightsConfirmed,
      });
      if (!this.#viewCurrent(view)) {
        const receipt = this.#originalAcknowledgment(view, result, mutationId, "adopt");
        if (receipt && this.#uploadCommandId === mutationId) { this.#uploadReceipt = receipt; this.#uploadFailure = null; this.requestUpdate(); }
        return;
      }
      if (result.status === "not-attempted") { this.#writeNotAttempted(); return; }
      const sameSelection = this.#file === file && this.#uploadCommandId === mutationId;
      if (result.status === "saved") {
        if (sameSelection) {
          this.#file = null; this.#rightsConfirmed = false; this.#uploadFailure = null;
          this.querySelector<HTMLInputElement>('.output-file-upload input[type="file"]')?.form?.reset();
        }
        this.#announce(this.#t("uploaded", "The file was inspected. Match it to a target, then review it; it is not accepted yet."));
      } else {
        if (sameSelection) this.#uploadFailure = classifyOutputUploadFailure(result);
        this.#announce(this.#failure(result), true);
      }
    } catch {
      if (this.#viewCurrent(view)) {
        if (this.#file === file && this.#uploadCommandId === mutationId) this.#uploadFailure = { kind: "uncertain", code: null };
        this.#announce(this.#message("output_client_response_lost"), true);
      }
    } finally { if (this.#viewCurrent(view)) { this.#busy = ""; this.requestUpdate(); } }
  }

  async #restageUpload() {
    if (!this.#file || !outputUploadNeedsRestage(this.#uploadFailure) || this.#busy) return;
    const view = this.#captureView(), file = this.#file, mutationId = this.#uploadCommandId, failure = this.#uploadFailure;
    this.#busy = "restage-upload"; this.requestUpdate();
    try {
      const resource = await this.store.outputRequirements.ensure(view.documentId, { force: true });
      if (!this.#viewCurrent(view) || this.#file !== file || this.#uploadCommandId !== mutationId) return;
      const snapshot = resource.snapshot;
      if (resource.state !== "ready" || !snapshot) {
        this.#announce(this.#message(resource.errorCode ?? "output_client_load_failed", resource.errorValues), true); return;
      }
      const gate = outputSourceReadiness(snapshot);
      if (!gate.allowed) { this.#announce(this.#readinessMessage(gate), true); return; }
      if (!outputUploadCanRestage(failure, this.#uploadRevision, snapshot, true)) {
        this.#announce(this.#t("uploadRevisionNotRefreshed", "A newer authorized revision could not be verified. Your selected file is retained; no upload or revision change was attempted."), true); return;
      }
      this.#uploadCommandId = crypto.randomUUID(); this.#uploadRevision = snapshot.revision;
      this.#uploadFailure = null; this.#rightsConfirmed = false;
      this.#announce(this.#t("uploadRestaged", "The selected file is ready against the latest revision. Confirm its rights again, then upload. No file was uploaded automatically."));
    } finally { if (this.#viewCurrent(view)) { this.#busy = ""; this.requestUpdate(); } }
  }

  async #bind(event: SubmitEvent, target: OutputPlanTarget) {
    event.preventDefault();
    const plan = this.#snapshot()?.confirmedPlan;
    const assetId = new FormData(event.currentTarget as HTMLFormElement).get("assetId");
    if (!plan || typeof assetId !== "string" || !assetId) return;
    const response = await this.#command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId });
    if (response) this.#announce(this.#t("bound", "The exact file is matched to this target. Checks and human review determine whether it can be delivered."));
  }


  #nativeInspectionAllowed() {
    const context = this.store.session.get()?.projectContext;
    return !context || context.permissions.includes("project.output.request");
  }
  #nativeResultScope(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget) {
    return JSON.stringify([this.#nativeViewEpoch, this.#nativeRequestEpoch, this.#lastScope, this.store.route?.get() ?? "", this.surface, this.blockId,
      this.inspectionOnly, outputNativeResultContext(snapshot, target)]);
  }
  #nativeInspectionOwned(read: OutputNativeInspection) {
    const resource = this.store.outputRequirements.resource(read.view.documentId), snapshot = resource.snapshot;
    const target = snapshot?.confirmedPlan?.plan.targets.find((entry) => entry.id === read.reference.targetId);
    return Boolean(this.#nativeInspectionAllowed() && this.#nativeInspection === read && this.#viewCurrent(read.view) && read.viewEpoch === this.#nativeViewEpoch
      && resource.state === "ready" && snapshot && target && read.context === this.#nativeResultScope(snapshot, target)
      && outputMissingNativeResults(snapshot, this.store.documentJobs.get(), target).some((entry) => JSON.stringify(entry) === JSON.stringify(read.reference)));
  }
  #nativeChoices(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget) {
    const read = this.#nativeInspection;
    const inspected = read?.status === "ready" && read.reference.targetId === target.id && this.#nativeInspectionOwned(read) && read.current?.() ? read.job ?? undefined : undefined;
    return outputCompletedNativeChoices(snapshot, this.store.documentJobs.get(), target, inspected);
  }
  #nativeBindingScope(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget) {
    return JSON.stringify([this.#nativeResultScope(snapshot, target), this.#nativeInspection?.id,
      this.#nativeChoices(snapshot, target).map(({ job }) => [job.jobId, job.documentId, job.status, job.updatedAt])]);
  }
  async #inspectNativeResult(reference: OutputNativeResultReference, shownContext: string) {
    const snapshot = this.#snapshot(), target = snapshot?.confirmedPlan?.plan.targets.find((entry) => entry.id === reference.targetId);
    if (!snapshot || !target || !this.#nativeInspectionAllowed() || this.#busy || this.store.outputRequirements.resource(this.documentId).state !== "ready"
      || !this.#viewCurrent(this.#captureView()) || shownContext !== this.#nativeResultScope(snapshot, target)
      || !outputMissingNativeResults(snapshot, this.store.documentJobs.get(), target).some((entry) => JSON.stringify(entry) === JSON.stringify(reference))) return;
    const read: OutputNativeInspection = { id: ++this.#nativeInspectionSerial, view: this.#captureView(), reference, context: shownContext, viewEpoch: this.#nativeViewEpoch,
      status: "loading", job: null, current: null };
    this.#nativeInspection = read; this.requestUpdate();
    try {
      const result = await this.store.inspectOutputNativeJob(this.documentId, reference.jobId, () => this.#nativeInspectionOwned(read));
      if (this.#nativeInspection !== read || !this.#viewCurrent(read.view)) return;
      if (!this.#nativeInspectionOwned(read)) { this.#nativeInspection = null; return; }
      if (result.status === "found" && result.current() && outputCompletedNativeChoices(this.#snapshot()!, this.store.documentJobs.get(), target, result.job).some(({ job }) => job.jobId === reference.jobId)) {
        read.status = "ready"; read.job = result.job; read.current = result.current;
      } else { read.status = "unavailable"; read.job = null; read.current = null; }
    } catch {
      if (this.#nativeInspection === read && this.#viewCurrent(read.view)) { read.status = "unavailable"; read.job = null; read.current = null; }
    } finally { if (this.#viewCurrent(read.view)) this.requestUpdate(); }
  }
  #nativeRecoveryControls(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget, ready: boolean) {
    const missing = outputMissingNativeResults(snapshot, this.store.documentJobs.get(), target);
    if (!missing.length) return nothing;
    const context = this.#nativeResultScope(snapshot, target), read = this.#nativeInspection, canInspect = this.#nativeInspectionAllowed();
    const owned = read && read.reference.targetId === target.id && this.#nativeInspectionOwned(read);
    return html`<div class="output-native-recovery">
      <p>${canInspect ? this.#t("nativeHistoryOmitted", "A completed attempt is recorded outside the recent generation list. Retrieve its original result before matching it; no new work will start.") : this.#t("nativeInspectionReadOnly", "Your current shared-project role can read Outputs but cannot retrieve your original generation job. Ask a project owner to restore generation-request permission. The recorded attempt is unchanged.")}</p>
      ${missing.map((reference, index) => html`<button aria-label=${this.#controlName(this.#t("inspectNativeAttempt", "Retrieve attempt {attempt} for {target} · no generation", { attempt: this.i18n.number(index + 1), target: this.#isolate(target.label) }), this.#targetContext(snapshot, target))} type="button" class="button secondary compact" data-output-native-inspect=${reference.jobId}
        ?disabled=${!ready || !canInspect || Boolean(this.#busy) || Boolean(owned && read.status === "loading" && read.reference.jobId === reference.jobId)}
        @click=${() => this.#inspectNativeResult(reference, context)}>${this.#t("inspectNativeAttempt", "Retrieve attempt {attempt} for {target} · no generation", { attempt: this.i18n.number(index + 1), target: this.#isolate(target.label) })}</button>`)}
      ${owned ? html`<p role="status">${read.status === "loading" ? this.#t("nativeInspecting", "Checking the original completed result…")
        : read.status === "ready" && read.current?.() ? this.#t("nativeInspected", "The original completed result is available to match. Matching and human review remain separate decisions.")
        : this.#t("nativeInspectionUnavailable", "The original completed result is unavailable. Refresh Outputs and retrieve the same attempt again; no replacement was started.")}</p>` : nothing}
    </div>`;
  }

  async #bindNative(event: SubmitEvent, target: OutputPlanTarget, shownScope: string) {
    event.preventDefault();
    const snapshot = this.#snapshot();
    const current = snapshot?.confirmedPlan?.plan.targets.find((entry) => entry.id === target.id);
    const jobId = new FormData(event.currentTarget as HTMLFormElement).get("nativeJobId");
    if (!snapshot?.confirmedPlan || !current || !snapshot.permissions.canAuthor || this.inspectionOnly || shownScope !== this.#nativeBindingScope(snapshot, current)
      || typeof jobId !== "string" || !this.#nativeChoices(snapshot, current).some((choice) => choice.job.jobId === jobId)) return;
    const view = this.#captureView(), viewEpoch = this.#nativeViewEpoch, route = this.store.route?.get() ?? "";
    const response = await this.#command({ action: "bind", planRevisionId: snapshot.confirmedPlan.revisionId, targetId: current.id, nativeJobId: jobId });
    if (response && this.#viewCurrent(view) && viewEpoch === this.#nativeViewEpoch && route === (this.store.route?.get() ?? "")) this.#announce(this.#t("nativeBound", "The completed result was matched and checked. Review the exact file before accepting it; no generation was started."));
  }

  async #reuseAcceptance(acceptanceId: string, target: OutputPlanTarget) {
    const snapshot = this.#snapshot();
    const current = snapshot?.confirmedPlan?.plan.targets.find((entry) => entry.id === target.id);
    if (!snapshot?.confirmedPlan || !current || !snapshot.permissions.canAuthor || !outputReusableAcceptanceChoices(snapshot, current).some((result) => result.acceptanceId === acceptanceId)) return;
    const response = await this.#command({ action: "bind", planRevisionId: snapshot.confirmedPlan.revisionId, targetId: current.id, acceptanceId } as Command);
    if (response) this.#announce(this.#t("acceptanceReused", "The server verified the earlier exact acceptance for this plan. Its original review is retained; no new approval or generation was created."));
  }

  async #alternative(slotId: string, target: OutputPlanTarget) {
    const snapshot = this.#snapshot();
    const plan = snapshot?.confirmedPlan;
    const current = plan?.plan.targets.find((entry) => entry.id === target.id);
    if (!snapshot || !plan || !current) return;
    const intent = this.#captureNativeIntent([current.id], slotId);
    if (!intent) return;
    const response = await this.#command({ action: "preflight", planRevisionId: plan.revisionId, targetIds: intent.targetIds, alternativeOfSlotId: slotId });
    if (response?.command.preflight && this.#adoptPreflight(response.command.preflight, intent)) {
      this.#announce(this.#t("alternativePrepared", "Review the new alternative’s source transfer and spending limit. Earlier charges remain recorded. Nothing new has been authorized or started."));
    }
  }

  async #stop(jobId: string) {
    const snapshot = this.#snapshot();
    const operation = snapshot?.grants.flatMap((grant) => grant.operations).find((entry) => entry.jobId === jobId);
    const job = this.store.documentJobs.get().find((entry) => entry.jobId === jobId && entry.documentId === this.documentId);
    if (!snapshot || !operation || !snapshot.permissions.canRequest || this.#busy || !outputOperationRecovery(operation, job, this.documentId).canStop) return;
    const view = this.#captureView();
    this.#busy = "stop"; this.#paidActivation.clear(); this.requestUpdate();
    try {
      const stopped = await this.store.stopDocumentJob(jobId);
      if (!this.#viewCurrent(view)) return;
      await this.#refresh(true);
      if (this.#viewCurrent(view)) this.#announce(stopped ? this.#t("attemptStopped", "The stop request was recorded. The target remains owed, and submitted provider work or charges may remain.") : this.#t("stopUnconfirmed", "Stopping was not confirmed. Refresh the existing operation before preparing any alternative."), !stopped);
    } finally { if (this.#viewCurrent(view)) { this.#busy = ""; this.requestUpdate(); } }
  }

  async #review(event: SubmitEvent, result: OutputResultRow) {
    event.preventDefault();
    const snapshot = this.#snapshot();
    const latest = snapshot?.results.find((candidate) => candidate.id === result.id);
    if (!snapshot?.permissions.canReview || !latest || (latest as OutputResultRow & { reviewAllowed?: boolean }).reviewAllowed !== true || latest.resultRevision !== result.resultRevision || latest.sha256 !== result.sha256) return;
    const form = event.currentTarget as HTMLFormElement;
    const fields = new FormData(form);
    const approve = (event.submitter as HTMLButtonElement | null)?.value === "approve";
    const response = await this.#command({ action: "review", resultId: result.id, decision: approve ? "approve" : "changes_requested", reviewedCoverage: fields.get("coverage") === "on", reviewedRights: fields.get("rights") === "on", note: String(fields.get("note") ?? "") });
    if (response) this.#announce(approve ? this.#t("accepted", "This exact result was accepted for this target. Other work remains unchanged.") : this.#t("changesRequested", "Changes requested. This file does not fulfill the target."));
  }

  async #download(path: string, kind: OutputReleaseCapture["kind"] = "file") {
    const resource = this.store.outputRequirements.resource(this.documentId), snapshot = resource.snapshot;
    if (resource.state !== "ready" || !snapshot?.permissions.canDownload) return;
    const gate = kind === "package" ? outputPackageReadiness(snapshot) : outputSourceReadiness(snapshot);
    if (!gate.allowed) { this.#announce(this.#readinessMessage(gate), true); return; }
    const captured = kind === "package" ? this.#packageRelease : captureOutputRelease(snapshot, kind);
    const asset = kind === "file" ? snapshot.assets.find((entry) => entry.downloadUrl === path && entry.available) : null;
    if (!captured || !outputReleaseStillAllowed(captured, snapshot) || kind === "file" && !asset || kind === "package" && !this.#packageParts.includes(path)) {
      this.#announce(this.#t("releaseChanged", "The source, exact file, or package plan changed. Refresh and request the current file or package again."), true); return;
    }
    const view = this.#captureView();
    const result = await this.store.outputRequirements.download(view.documentId, path);
    if (!this.#viewCurrent(view)) return;
    if (result.status !== "saved") { this.#announce(this.#failure(result), true); return; }
    const currentResource = this.store.outputRequirements.resource(view.documentId), current = currentResource.snapshot;
    if (currentResource.state !== "ready" || !current?.permissions.canDownload || !outputReleaseStillAllowed(captured, current)
      || asset && !current.assets.some((entry) => entry.id === asset.id && entry.sha256 === asset.sha256 && entry.available && entry.downloadUrl === path)) {
      const currentGate = kind === "package" ? outputPackageReadiness(current) : outputSourceReadiness(current);
      this.#announce(!currentGate.allowed ? this.#readinessMessage(currentGate) : this.#t("releaseChanged", "The source, exact file, or package plan changed. Refresh and request the current file or package again."), true); return;
    }
    const url = URL.createObjectURL(result.body.blob); this.#downloadUrls.add(url);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.body.filename;
    anchor.hidden = true; this.append(anchor); anchor.click(); anchor.remove();
    // Bytes are released only after the current source and exact resource are checked again.
  }

  async #export(event: SubmitEvent) {
    event.preventDefault();
    const snapshot = this.#snapshot();
    if (!snapshot?.confirmedPlan || !snapshot.permissions.canDownload) return;
    const capture = captureOutputRelease(snapshot, "package");
    if (!capture) { this.#announce(this.#readinessMessage(outputPackageReadiness(snapshot)), true); return; }
    if (!snapshot.summary?.delivery_ready && !this.#allowPartial) return;
    const response = await this.#command({ action: "export", planRevisionId: snapshot.confirmedPlan.revisionId, allowPartial: this.#allowPartial });
    if (!response) return;
    if (!outputReleaseStillAllowed(capture, this.#snapshot())) {
      const gate = outputPackageReadiness(this.#snapshot());
      this.#announce(gate.allowed ? this.#t("releaseChanged", "The source, exact file, or package plan changed. Refresh and request the current file or package again.") : this.#readinessMessage(gate), true); return;
    }
    const command = response.command as typeof response.command & { downloadUrls?: string[] };
    this.#packageParts = command.downloadUrls ?? (command.downloadUrl ? [command.downloadUrl] : []);
    this.#packageRelease = capture;
    if (this.#packageParts.length === 1) await this.#download(this.#packageParts[0], "package");
    else if (this.#packageParts.length > 1) this.#announce(this.#t("packageParts", "The checked package has {count} parts. Download every part below; each manifest records the whole assignment and the contents of that part.", { count: this.#packageParts.length }));
    this.requestUpdate();
  }

  async #remove(event: SubmitEvent) {
    event.preventDefault();
    if (!this.#removeId) return;
    const response = await this.#command({ action: "remove", blockId: this.#removeId } as Command);
    if (response) { this.#removeId = ""; this.#preflight = null; this.#announce(this.#t("removed", "Requirement removed. Previous results and plan history remain. Review the new scope before delivery.")); }
  }

  async #toggleLock(row: OutputRequirementRow) {
    const snapshot = this.#snapshot();
    const current = snapshot?.requirements.find((entry) => entry.blockId === row.blockId);
    if (this.inspectionOnly || !current || !snapshot?.permissions.canAuthor || this.#busy || this.store.outputRequirements.resource(this.documentId).state !== "ready") return;
    const view = this.#captureView();
    this.#busy = "lock"; this.requestUpdate();
    try {
      await this.store.append({ type: current.locked ? "BlockUnlocked" : "BlockLocked", payload: { block_id: current.blockId, locked_by: "user", source_surface: "output-requirements" } });
      if (this.#viewCurrent(view)) await this.#refresh(true);
    } finally { if (this.#viewCurrent(view)) { this.#busy = ""; this.requestUpdate(); } }
  }

  #resultLabel(result: OutputResultRow) {
    return result.checksStatus !== "passed" ? this.#t("checksFailed", "Checks need attention") : result.review === "approved" ? this.#t("resultAccepted", "Accepted for the recorded target revision") : result.review === "changes_requested" ? this.#t("resultRejected", "Changes requested") : this.#t("awaitingReview", "Checks passed · awaiting human review");
  }

  #planOutdated(snapshot: OutputRequirementsSnapshot) {
    const plan = snapshot.confirmedPlan;
    return Boolean(plan && (plan.sourceDigest !== snapshot.sourceRevision || plan.requirementsDigest !== snapshot.requirementRevision));
  }


  #navigationRequest = 0;
  /** Reveal one current authored Output's existing status only; never create a snapshot or action grant. */
  async revealAuthoredRequirement(target: { projectId: string; documentId: string; blockId: string }, options: {
    current: () => boolean; focus?: OutputNavigationFocusLease;
  }): Promise<boolean> {
    const { projectId, documentId, blockId } = target, request = ++this.#navigationRequest;
    const view = this.#captureView(), route = this.store.route.get();
    const identityCurrent = () => {
      const projection = this.store.projection.get(), session = this.store.session.get(), context = session?.projectContext;
      const permissions = context?.permissions ?? session?.capabilities ?? [];
      const resource = this.store.outputRequirements.resource(documentId);
      return Boolean(blockId && options.current() && request === this.#navigationRequest && this.#viewCurrent(view)
        && this.store.route.get() === route && this.surface === "document" && this.documentId === documentId && this.blockId === blockId
        && session && permissions.includes("project.read") && (!context || context.projectId === projectId)
        && projection.projectId === projectId && projection.documentId === documentId
        && projection.documents.some(value => value.id === documentId && value.projectId === projectId && !value.removed)
        && projection.blocks.filter(value => value.id === blockId && value.documentId === documentId && value.projectId === projectId
          && value.type === "output" && !value.removed).length === 1
        && !this.#busy && !this.#reviewPlan && !this.#planning?.dirty && !this.#file && !this.#uncertainCommand
        && !this.#unresolvedWrite() && !this.#preflight && !this.#preflightIntent
        && !document.querySelector("dialog[open]") && !document.querySelector(".output-requirement-form")
        && !document.querySelector(".output-plan-review") && !document.querySelector(".output-recipe-draft")
        && !document.querySelector(".output-recipe-entry[open]")
        // A withheld Output may expose its existing content-free status, never a retained private card.
        && (!(resource.accessLost || resource.privateUnavailable) || resource.snapshot === null));
    };
    if (!identityCurrent()) return false;
    const focus = options.focus ?? captureOutputNavigationFocus(this.ownerDocument, {
      ownedRouteFocus: outputNavigationOwnedRouteFocus(this.ownerDocument, this.store, { documentId, blockId }, identityCurrent),
    });
    const current = () => focus.current() && identityCurrent();
    try {
      if (!current()) return false;
      await this.updateComplete;
      if (!current()) return false;
      const panel = this.closest<HTMLElement>("#document-context-panel");
      if (panel?.hidden) {
        const workspace = this.closest("forma-workspace") as (HTMLElement & { revealOutputNavigation?: (documentId: string, current: () => boolean) => boolean; updateComplete?: Promise<unknown> }) | null;
        if (!workspace?.revealOutputNavigation?.(documentId, current)) return false;
        await workspace.updateComplete;
        if (!current() || this.closest<HTMLElement>("#document-context-panel")?.hidden) return false;
      }
      const resource = this.store.outputRequirements.resource(documentId), statusOnly = resource.snapshot === null;
      const elements = statusOnly
        ? [...this.querySelectorAll<HTMLElement>(".output-requirements")]
        : [...this.querySelectorAll<HTMLElement>("[data-output-requirement]")].filter(element => element.getAttribute("data-output-requirement") === blockId);
      const element = elements.length === 1 ? elements[0] : null;
      const presentedCurrent = () => {
        const shown = this.store.outputRequirements.resource(documentId);
        return current() && (statusOnly ? shown.snapshot === null
          : !shown.accessLost && !shown.privateUnavailable && shown.snapshot === resource.snapshot);
      };
      if (!element?.isConnected || !element.getClientRects().length || !presentedCurrent()) return false;
      return focus.run(element, () => {
        if (!presentedCurrent() || !element.isConnected) return false;
        if (statusOnly) element.tabIndex = -1;
        element.focus({ preventScroll: true });
        if (!presentedCurrent() || !element.isConnected) return false;
        element.scrollIntoView({ block: "nearest" });
        return presentedCurrent();
      });
    } finally { if (!options.focus) focus.dispose(); }
  }

  /** Exact navigation only. Never changes a run selection, draft, offer, or authored decision. */
  async focusOutputReference(reference: OutputNavigationReference, options: {
    section?: OutputNavigationSection; current: () => boolean; focus?: OutputNavigationFocusLease;
  }): Promise<boolean> {
    const request = ++this.#navigationRequest, view = this.#captureView(), section = options.section ?? "inspect";
    const identityCurrent = () => {
      const resource = this.store.outputRequirements.resource(this.documentId), snapshot = resource.snapshot;
      const session = this.store.session.get(), permissions = session?.projectContext?.permissions ?? session?.capabilities ?? [];
      if (!permissions.includes("project.read") || request !== this.#navigationRequest || !options.current() || !this.#viewCurrent(view)
        || this.#busy || this.#loading || this.#reviewPlan || this.#planning?.dirty || this.#file || this.#uncertainCommand || this.#preflight || this.#preflightIntent
        || resource.state !== "ready" || resource.accessLost || resource.privateUnavailable || !snapshot
        || document.querySelector("dialog[open]") || document.querySelector(".output-requirement-form") || document.querySelector(".output-plan-review")
        || snapshot.scope.actorUserId !== this.store.session.get()?.user.userId
        || snapshot.scope.projectAccessId !== (this.store.session.get()?.projectContext?.projectAccessId ?? null)
        || !outputNavigationMatches(reference, snapshot, this.store.captureAuthorizationScope()?.key ?? "")
        || reference.documentId !== this.documentId || (this.blockId && (reference.kind !== "requirement" || reference.blockId !== this.blockId))) return false;
      if (section === "inspect") return true;
      if (reference.kind !== "target" || this.blockId || this.inspectionOnly) return false;
      const target = snapshot.confirmedPlan?.plan.targets.find(value => value.id === reference.targetId);
      if (!target) return false;
      if (section === "history") return snapshot.grants.some(grant => grant.operations.some(operation => operation.targetId === reference.targetId));
      if (section === "owned") return snapshot.permissions.canAuthor && snapshot.capabilities.ownedFileAdoption && outputSourceReadiness(snapshot).allowed;
      if (section === "existing") return snapshot.permissions.canAuthor && outputDeliveryReadiness(snapshot).allowed && !target.blocking_issues.length;
      return section === "native" && snapshot.permissions.canRequest && snapshot.capabilities.nativeGeneration
        && outputNativeReadiness(snapshot).allowed && target.selected && !target.blocking_issues.length && ["image", "slides", "model3d"].includes(target.media_kind);
    };
    const focus = options.focus ?? captureOutputNavigationFocus(this.ownerDocument, {
      ownedRouteFocus: outputNavigationOwnedRouteFocus(this.ownerDocument, this.store, reference, identityCurrent),
    });
    const current = () => focus.current() && identityCurrent();
    try {
    if (!current()) return false;
    await this.updateComplete;
    if (!current()) return false;
    const panel = this.closest<HTMLElement>("#document-context-panel");
    if (panel?.hidden) {
      const workspace = this.closest("forma-workspace") as (HTMLElement & { revealOutputNavigation?: (documentId: string, current: () => boolean) => boolean; updateComplete?: Promise<unknown> }) | null;
      if (!workspace?.revealOutputNavigation?.(reference.documentId, current)) return false;
      await workspace.updateComplete;
      if (!current() || this.closest<HTMLElement>("#document-context-panel")?.hidden) return false;
    }
    const unique = (selector: string, matches: (element: HTMLElement) => boolean = () => true) => {
      const rows = [...this.querySelectorAll<HTMLElement>(selector)].filter(matches);
      return rows.length === 1 ? rows[0] : null;
    };
    const target = reference.targetId ? unique("[data-output-target]", element => element.getAttribute("data-output-target") === reference.targetId) : null;
    let element: HTMLElement | null = reference.kind === "requirement"
      ? unique("[data-output-requirement]", value => value.getAttribute("data-output-requirement") === reference.blockId)
      : reference.kind === "result" ? unique("[data-output-result]", value => value.getAttribute("data-output-result") === reference.resultId)
      : reference.kind === "operation" ? unique("[data-output-operation]", value => value.getAttribute("data-output-operation") === reference.operationId && value.getAttribute("data-output-grant") === reference.grantId)
      : target;
    let details: HTMLDetailsElement | null = null;
    if (section === "existing") { details = target?.querySelector<HTMLDetailsElement>(".output-existing-work") ?? null; element = details?.querySelector<HTMLElement>("summary") ?? null; }
    else if (section === "owned") element = unique(".output-adoption");
    else if (section === "native") element = unique("input[data-output-run-target]", value => value.getAttribute("data-output-run-target") === reference.targetId);
    else if (section === "history") element = unique(".output-execution");
    if (!element?.isConnected || !element.getClientRects().length || !current()) return false;
    return focus.run(element, () => {
      if (!current()) return false;
      if (details) details.open = true;
      if (!current() || !element.isConnected) return false;
      element.focus({ preventScroll: true });
      if (!current() || !element.isConnected) return false;
      element.scrollIntoView({ block: "nearest" });
      return current();
    });
    } finally { if (!options.focus) focus.dispose(); }
  }

  #focusWork(targetId?: string) {
    if (!targetId) { this.#openPlan(); return; }
    const target = [...this.querySelectorAll<HTMLElement>("[data-output-target]")].find((entry) => entry.dataset.outputTarget === targetId);
    target?.focus(); target?.scrollIntoView({ block: "nearest" });
  }

  #attention(snapshot: OutputRequirementsSnapshot, ready: boolean) {
    const gate = outputDeliveryReadiness(snapshot);
    if (!outputSourceReadiness(snapshot).allowed) return nothing;
    if (gate.reason === "scope_unknown") return html`<section class="output-attention" role="status"><h3>${this.#t("scopeChecksTitle", "Complete delivery state is unavailable")}</h3><p>${this.#readinessMessage(gate)}</p></section>`;
    if (this.#planOutdated(snapshot)) return html`<section class="output-attention" role="status"><h3>${this.#t("planChanged", "The source or requirements changed")}</h3><p>${this.#readinessMessage(gate)}</p>${snapshot.permissions.canAuthor ? html`<button aria-label=${this.#controlName(this.#t("reviewCurrentScope", "Review current scope"))} type="button" class="button secondary" ?disabled=${!ready || Boolean(this.#busy)} @click=${() => this.#focusWork()}>${this.#t("reviewCurrentScope", "Review current scope")}</button>` : nothing}</section>`;
    const actions = snapshot.summary?.next_actions ?? [];
    if (!actions.length) return nothing;
    const labels = {
      resolve: this.#t("actionResolve", "Resolve the requirement or choose a fulfillment route"),
      refresh: this.#t("actionRefresh", "Refresh the complete delivery state"),
      recover: this.#t("actionRecover", "Review the previous attempt and recovery options"),
      check: this.#t("actionCheck", "Check retained work and current requirements"),
      review: this.#t("actionReview", "Review the exact file"),
      create: this.#t("actionCreate", "Review how to create this output"),
      download: this.#t("actionDownload", "Review accepted work for delivery"),
    };
    const actionRow = (action: OutputPlanSummary["next_actions"][number]) => {
      const target = snapshot.confirmedPlan?.plan.targets.find((entry) => entry.id === action.target_id);
      const group = snapshot.confirmedPlan?.plan.unresolved_groups.find((entry) => entry.id === action.group_id);
      return html`<li>${target || group ? html`<b dir="auto">${target?.label ?? group?.label}</b> ` : nothing}<button aria-label=${this.#controlName(labels[action.kind], (target ? this.#targetContext(snapshot, target) : this.#isolate(group?.label || this.documentName)) + " · " + this.#t("contextAction", "Action {number}", { number: this.i18n.number(actions.indexOf(action) + 1) }))} type="button" class="button ghost compact" ?disabled=${!ready || Boolean(this.#busy)} @click=${() => action.kind === "refresh" ? this.#refresh(true) : this.#focusWork(action.target_id)}>${labels[action.kind]}</button></li>`;
    };
    return html`<section class="output-attention"><h3>${this.#t("needsAttention", "What needs your attention")}</h3><ol>${actions.slice(0, 6).map(actionRow)}</ol>${actions.length > 6 ? html`<details><summary aria-label=${this.#controlName(this.#t("remainingActions", "Show {count} remaining actions, including unresolved groups", { count: actions.length - 6 }))}>${this.#t("remainingActions", "Show {count} remaining actions, including unresolved groups", { count: actions.length - 6 })}</summary><ol start="7">${actions.slice(6).map(actionRow)}</ol></details>` : nothing}</section>`;
  }

  #scopeHistory(snapshot: OutputRequirementsSnapshot) {
    const amendments = snapshot.scopeAmendments ?? [];
    if (!amendments.length) return nothing;
    return html`<section class="output-scope-history"><h3>${this.#t("amendedScope", "Delivery scope was amended")}</h3><p>${this.#t("amendedScopeQualification", "Completion below applies to the current agreed scope. Withdrawn work is not completed work; earlier commitments, approvals, and charges remain recorded.")}</p><details><summary aria-label=${this.#controlName(this.#t("scopeAmendmentHistory", "Review scope changes and reasons"))}>${this.#t("scopeAmendmentHistory", "Review scope changes and reasons")}</summary><ol>${amendments.map((amendment) => html`<li><p>${this.#t("scopeWithdrawal", "{date}: {targets} file targets and {obligations} obligations withdrawn from the next plan.", { date: this.#when(amendment.occurredAt), targets: amendment.withdrawnTargetIds.length, obligations: amendment.withdrawnObligationIds.length })}</p><p dir="auto">${amendment.reason}</p><dl><dt>${this.#t("scopeChangedBy", "Recorded actor")}</dt><dd><code dir="ltr">${amendment.actorUserId}</code></dd><dt>${this.#t("previousPlan", "Previous plan")}</dt><dd><code dir="ltr">${amendment.previousPlanRevisionId}</code></dd></dl></li>`)}</ol></details></section>`;
  }

  #card(snapshot: OutputRequirementsSnapshot, row: OutputRequirementRow, ready: boolean) {
    const resource = this.store.outputRequirements.resource(this.documentId), original = this.#unresolvedWrite();
    // An unrelated or retired unresolved write blocks only submission; the card's
    // existing authoring fields and newer human draft remain editable.
    const submissionBlocked = original && (original.sourceRetired || original.clientMutationId !== this.#editors.get(row.blockId)?.clientMutationId);

    return html`<div class="output-card-host" tabindex="-1" data-output-requirement=${row.blockId}>
      ${!this.inspectionOnly && snapshot.grants.some((grant) => grant.status === "authorized" || grant.status === "active" || grant.pendingCalls > 0 || grant.exposedMicrousd > 0) ? html`<p>${this.#t("editingActiveWork", "Saving requirement changes can pause further provider calls until the source and plan are checked again. Existing work and charges remain recorded; uncertain submissions cannot be withdrawn silently.")}</p>` : nothing}
      <forma-output-requirement-card .snapshot=${this.#cardSnapshot(snapshot, row)} .resourceState=${submissionBlocked ? "unavailable" : resource.state} .presentation=${this.surface === "project" ? "compact" : "full"} .editorState=${this.#editors.get(row.blockId) ?? { status: "idle" }} .readOnlyReason=${row.locked ? this.#t("locked", "This Output requirement is locked.") : ""}
        @forma-output-save=${this.#save} @forma-output-review-plan=${this.#reviewIntent}
        @forma-output-open-result=${(event: CustomEvent<{ scope: { authorizationScopeKey: string; documentId: string }; targetId: string; artifactId: string; artifactRevision: string | number }>) => {
          const detail = event.detail;
          if (!this.#intentScopeCurrent(detail.scope) || !ready || !snapshot.permissions.canDownload) return;
          const current = this.#snapshot();
          const result = current?.results.find((candidate) => candidate.targetId === detail.targetId && candidate.assetId === detail.artifactId && candidate.resultRevision === detail.artifactRevision && candidate.planRevisionId === current.confirmedPlan?.revisionId);
          const asset = result && current?.assets.find((entry) => entry.id === result.assetId);
          if (asset?.available && outputSourceReadiness(current).allowed) void this.#download(asset.downloadUrl);
        }}></forma-output-requirement-card>
      ${!this.inspectionOnly && snapshot.permissions.canAuthor ? html`<button aria-label=${this.#controlName(row.locked ? this.#t("unlockRequirement", "Unlock requirement") : this.#t("lockRequirement", "Lock requirement"), this.#requirementContext(snapshot, row.blockId))} type="button" class="button ghost compact" ?disabled=${!ready || Boolean(this.#busy)} @click=${() => this.#toggleLock(row)}>${row.locked ? this.#t("unlockRequirement", "Unlock requirement") : this.#t("lockRequirement", "Lock requirement")}</button>` : nothing}
      ${!this.inspectionOnly && snapshot.permissions.canAuthor && !row.locked ? html`<button aria-label=${this.#controlName(this.#t("remove", "Remove requirement"), this.#requirementContext(snapshot, row.blockId))} type="button" class="button ghost compact" ?disabled=${!ready || Boolean(this.#busy)} @click=${() => { this.#removeId = row.blockId; this.requestUpdate(); }}>${this.#t("remove", "Remove requirement")}</button>` : nothing}
      <details class="output-requirement-provenance"><summary aria-label=${this.#controlName(this.#t("requirementHistory", "Authored requirement and identity"), this.#requirementContext(snapshot, row.blockId))}>${this.#t("requirementHistory", "Authored requirement and identity")}</summary><p dir="auto">${row.content}</p><p>${this.#t("requirementIdentity", "Requirement identity:")} <code dir="ltr">${row.blockId}</code></p><p>${this.#t("currentRevision", "Current saved revision:")} <code dir="ltr">${snapshot.revision}</code></p></details>
      ${this.#removeId === row.blockId ? html`<form class="output-remove-confirm" @submit=${this.#remove}><p>${this.#t("removeImpact", "Remove this obligation from the next plan? Existing files and earlier approvals remain in history; the new scope must be confirmed.")}</p><button aria-label=${this.#controlName(this.#t("cancel", "Cancel"), this.#requirementContext(snapshot, row.blockId))} type="button" class="button ghost" @click=${() => { this.#removeId = ""; this.requestUpdate(); }}>${this.#t("cancel", "Cancel")}</button><button aria-label=${this.#controlName(this.#t("confirmRemove", "Remove obligation"), this.#requirementContext(snapshot, row.blockId))} type="submit" class="button danger" ?disabled=${Boolean(this.#busy)}>${this.#t("confirmRemove", "Remove obligation")}</button></form>` : nothing}
    </div>`;
  }

  #planPolicyText(policy: OutputCountPolicy | null | undefined, quantity: OutputQuantity | null | undefined) {
    if (policy?.kind === "exact") return this.#t("acceptCountExact", "Accept exactly {value} {unit}.", { value: this.i18n.number(policy.value), unit: this.#label("unit", policy.unit) });
    if (policy?.kind === "flexible") return this.#t("acceptCountFlexible", "Accept any count from {min} to {max} {unit}.", { min: this.i18n.number(policy.min), max: this.i18n.number(policy.max), unit: this.#label("unit", policy.unit) });
    if (quantity?.kind === "exact") return this.#t("acceptCountExact", "Accept exactly {value} {unit}.", { value: this.i18n.number(quantity.value), unit: this.#label("unit", quantity.unit) });
    return this.#t("acceptCountUnresolved", "The content count acceptance rule still needs a decision.");
  }

  #planningContract(base: OutputPlanProposalBase, options: OutputConfirmationOptions, snapshot: OutputRequirementsSnapshot, context: string) {
    const specs = base.requirements.flatMap((row) => row.spec ? [row.spec] : []);
    const plan = compileOutputPlan(specs, { document_id: base.documentId, source_revision: base.sourceRevision, requirement_revision: base.requirementRevision, ...options });
    return html`<div class="output-planning-contract">
      ${base.requirements.map((row) => html`<div><h5 dir="auto">${row.spec?.label || row.subtype}</h5><p dir="auto">${row.content}</p></div>`)}
      <ul>${plan.obligations.map((obligation) => html`<li><b dir="auto">${obligation.label}</b> · ${obligation.required ? this.#t("required", "Required") : this.#t("optional", "Optional")} · ${obligation.selected ? this.#t("planIncluded", "Included in this plan") : this.#t("planNotIncluded", "Not included")}<p>${this.#planPolicyText(obligation.quantity_policy, obligation.quantity)}</p></li>`)}</ul>
      ${plan.targets.map((target) => html`<details><summary dir="auto" aria-label=${this.#controlName(this.#isolate(target.label) + (target.content_quantity ? " · " + this.#planPolicyText(target.count_policy, target.content_quantity) : ""), this.#targetContext({ ...snapshot, requirements: base.requirements }, target, plan.targets) + " · " + context)}>${target.label}${target.content_quantity ? html` · ${this.#planPolicyText(target.count_policy, target.content_quantity)}` : nothing}</summary><p>${target.selected ? this.#t("planTargetIncludedForChecks", "Included for generation checks.") : this.#t("planTargetExcludedFromChecks", "Excluded from generation checks; any agreed work is still owed.")}</p>${this.#acceptanceContract(snapshot, target)}<p dir="auto">${target.instruction_text}</p></details>`)}
      ${plan.unresolved_groups.length ? html`<ul class="output-unresolved">${plan.unresolved_groups.map((group) => html`<li><b dir="auto">${group.label}</b><span>${group.issues.map((issue) => this.#problem(issue.code)).join(" ")}</span></li>`)}</ul>` : nothing}
      ${plan.issues.length ? html`<ul class="output-unresolved">${plan.issues.map((issue) => html`<li>${this.#problem(issue.code)}</li>`)}</ul>` : nothing}
    </div>`;
  }

  #resolvePlanConflict(reapply: boolean) {
    const snapshot = this.#snapshot();
    if (!snapshot || !this.#planning || !this.#planEditingAllowed()) return;
    this.#planning = observeOutputPlanProposal(this.#planning, snapshot, this.#lastScope);
    const next = reapply ? reapplyOutputPlanProposal(this.#planning) : discardOutputPlanProposal(this.#planning);
    if (!next) { this.#announce(this.#t("planReviewUpdated", "The planning base changed. Review the updated comparison before confirming."), true); return; }
    this.#planning = next;
    this.#announce(reapply ? this.#t("planRetained", "Your reviewed choices are staged on the latest source and requirements. Review the resulting plan, then confirm separately.") : this.#t("planLoadedLatest", "Newer saved planning choices are shown. Review them before confirming."));
    this.#openPlan();
  }

  #includeCommittedPlanTargets() {
    const snapshot = this.#snapshot(), state = this.#planning;
    if (!snapshot || !state || !this.#planEditingAllowed() || outputPlanProposalConflicts(state)) return;
    if (captureOutputPlanProposalBase(snapshot, this.#lastScope).semanticKey !== state.base.semanticKey) {
      this.#observePlanning(snapshot); this.#announce(this.#t("planReviewUpdated", "The planning base changed. Review the updated comparison before confirming."), true); return;
    }
    const next = includeOutputPlanCommittedTargets(state);
    if (!next) return;
    const view = this.#captureView(), opener = this.#planOpener, editVersion = next.editVersion;
    this.#planning = next;
    this.#announce(this.#t("planTargetFilterStaged", "The local preview now includes all required and already selected optional targets for generation checks. The work owed is unchanged. Review it and confirm separately; no work was authorized or started."));
    void this.updateComplete.then(() => {
      if (this.#viewCurrent(view) && this.#reviewPlan && this.#planOpener === opener && !this.#busy && this.#planning?.editVersion === editVersion) {
        this.querySelector<HTMLElement>("[data-output-selection-preview]")?.focus();
      }
    });
  }

  #planComparison(state: OutputPlanProposalState, snapshot: OutputRequirementsSnapshot, ready: boolean) {
    if (!outputPlanProposalConflicts(state)) return nothing;
    const blocked = !ready || !this.#planEditingAllowed();
    return html`<section class="output-plan-comparison" aria-label=${this.#controlName(this.#t("planProposalChanged", "Saved planning choices or their source changed"))}>
      <h4>${this.#t("planProposalChanged", "Saved planning choices or their source changed")}</h4>
      <p role="alert">${this.#t("planComparisonHelp", "Your local choices are retained. Confirmation is blocked until you discard them or review their effect on the latest requirements and explicitly stage them again. No work starts from this comparison.")}</p>
      ${state.base.sourceRevision !== state.latest.sourceRevision ? html`<p>${this.#t("planSourceChanged", "The Document source changed since this review began. Review the updated source before keeping these planning choices.")}</p>` : nothing}
      ${state.base.requirementRevision !== state.latest.requirementRevision ? html`<p>${this.#t("planSpecChanged", "Saved requirements or planning proposals changed. Counts, members, formats, source scope, and coverage below may differ.")}</p>` : nothing}
      <details><summary aria-label=${this.#controlName(this.#t("planPreviouslyReviewed", "Previously reviewed requirements and local choices"))}>${this.#t("planPreviouslyReviewed", "Previously reviewed requirements and local choices")}</summary>${this.#planningContract(state.base, state.draft.options, snapshot, this.#t("planPreviouslyReviewed", "Previously reviewed requirements and local choices"))}</details>
      <h5>${this.#t("planLatest", "Latest saved requirements and choices")}</h5>${this.#planningContract(state.latest, state.latest.options, snapshot, this.#t("planLatest", "Latest saved requirements and choices"))}
      <h5>${this.#t("planLocal", "Your choices applied to the latest requirements")}</h5>${this.#planningContract(state.latest, state.draft.options, snapshot, this.#t("planLocal", "Your choices applied to the latest requirements"))}
      <p>${this.#t("planRawDraft", "Any unfinished numeric fields remain in the editor below and must be corrected before confirmation.")}</p>
      <label><input aria-label=${this.#controlName(this.#t("planAcknowledge", "I reviewed the latest source, requirements, and saved choices, and choose my displayed planning decisions instead."))} type="checkbox" .checked=${outputPlanProposalCanReapply(state)} ?disabled=${blocked} @change=${(event: Event) => { if (!this.#planning || !this.#planEditingAllowed()) return; this.#planning = acknowledgeOutputPlanProposal(this.#planning, (event.target as HTMLInputElement).checked); this.requestUpdate(); }}>${this.#t("planAcknowledge", "I reviewed the latest source, requirements, and saved choices, and choose my displayed planning decisions instead.")}</label>
      <div class="output-actions"><button aria-label=${this.#controlName(this.#t("planDiscard", "Discard local choices and use latest"))} type="button" class="button secondary" ?disabled=${blocked} @click=${() => this.#resolvePlanConflict(false)}>${this.#t("planDiscard", "Discard local choices and use latest")}</button><button aria-label=${this.#controlName(this.#t("planReapply", "Stage my reviewed choices on latest"))} type="button" class="button secondary" ?disabled=${blocked || !outputPlanProposalCanReapply(state)} @click=${() => this.#resolvePlanConflict(true)}>${this.#t("planReapply", "Stage my reviewed choices on latest")}</button></div>
    </section>`;
  }

  #planCountEditor(id: string, label: string, quantity: OutputQuantity, state: OutputPlanProposalState, ready: boolean) {
    const key = `${id}:${quantity.unit}`;
    const field = state.draft.countFields[key]?.field ?? outputPlanCountField(state.draft.options, id, id, quantity);
    const invalid = readOutputPlanCountField(quantity, field).invalid;
    const update = (patch: Partial<OutputPlanCountField>) => {
      if (!this.#planning || !this.#planEditingAllowed()) return;
      this.#planning = editOutputPlanCountField(this.#planning, id, quantity, { ...field, ...patch });
      this.requestUpdate();
    };
    const blocked = !ready || !this.#planEditingAllowed();
    const errorId = `output-plan-count-${this.documentId}-${key}`;
    const context = this.#planOwnerContext(state.base, id);
    return html`<fieldset ?disabled=${blocked} aria-label=${this.#controlName(this.#isolate(label), context)}><legend dir="auto">${label}</legend>
      ${quantity.kind === "range" ? html`<p>${this.#t("authoredRange", "Authored range: {min}–{max} {unit}. A suggested aim does not change that range.", { min: quantity.min, max: quantity.max, unit: this.#label("unit", quantity.unit) })}</p>` : nothing}
      <label>${this.#t("planMode", "Content count acceptance rule")}<select .value=${field.kind} aria-label=${this.#controlName(this.#t("planMode", "Content count acceptance rule"), context)} @change=${(event: Event) => update({ kind: (event.target as HTMLSelectElement).value as OutputPlanCountField["kind"] })}>
        <option value="unresolved">${this.#t("planModeUnresolved", "Not decided")}</option><option value="exact">${this.#t("planModeExact", "Accept an exact count")}</option><option value="flexible">${this.#t("planModeFlexible", "Accept a bounded range")}</option>
      </select></label>
      ${field.kind === "exact" ? html`<label>${this.#t("planExactCount", "Exact accepted count")}<input aria-label=${this.#controlName(this.#t("planExactCount", "Exact accepted count"), context)} type="text" inputmode=${quantity.unit === "second" ? "decimal" : "numeric"} .value=${field.exact} aria-invalid=${String(invalid)} aria-describedby=${errorId} @input=${(event: InputEvent) => update({ exact: (event.target as HTMLInputElement).value })}></label>` : nothing}
      ${field.kind === "flexible" ? html`<label>${this.#t("planMinimum", "Minimum accepted count")}<input aria-label=${this.#controlName(this.#t("planMinimum", "Minimum accepted count"), context)} type="text" inputmode=${quantity.unit === "second" ? "decimal" : "numeric"} .value=${field.min} aria-invalid=${String(invalid)} aria-describedby=${errorId} @input=${(event: InputEvent) => update({ min: (event.target as HTMLInputElement).value })}></label><label>${this.#t("planMaximum", "Maximum accepted count")}<input aria-label=${this.#controlName(this.#t("planMaximum", "Maximum accepted count"), context)} type="text" inputmode=${quantity.unit === "second" ? "decimal" : "numeric"} .value=${field.max} aria-invalid=${String(invalid)} aria-describedby=${errorId} @input=${(event: InputEvent) => update({ max: (event.target as HTMLInputElement).value })}></label>` : nothing}
      <label>${this.#t("suggestedAim", "Suggested aim for the attempt")}<input aria-label=${this.#controlName(this.#t("suggestedAim", "Suggested aim for the attempt"), context)} type="text" inputmode=${quantity.unit === "second" ? "decimal" : "numeric"} .value=${field.aim} aria-invalid=${String(invalid)} aria-describedby=${errorId} @input=${(event: InputEvent) => update({ aim: (event.target as HTMLInputElement).value })}></label>
      <p id=${errorId}>${invalid ? this.#t("planInvalidCount", "Enter valid positive counts within the authored bounds, or keep the rule undecided. Blank exact counts are not zero and cannot be confirmed.") : this.#t("planNumericHelp", "Use digits 0–9; use a period for fractional seconds. A blank aim means no attempt aim, not zero.")}</p>
    </fieldset>`;
  }

  #planReview(snapshot: OutputRequirementsSnapshot, ready: boolean) {
    const state = this.#planning;
    if (!state) return nothing;
    const base = state.base;
    const specs = base.requirements.flatMap((row) => row.spec ? [row.spec] : []);
    const preview = compileOutputPlan(specs, { document_id: base.documentId, source_revision: base.sourceRevision, requirement_revision: base.requirementRevision, ...state.draft.options });
    const optional = specs.flatMap((spec) => spec.deliverables.flatMap((deliverable) => [
      ...(!deliverable.required ? [{ id: deliverable.id, label: deliverable.label }] : []),
      ...(deliverable.format_variants ?? []).filter((variant) => !variant.required).map((variant) => ({ id: variant.id, label: `${deliverable.label} · ${variant.label}` })),
      ...(deliverable.series?.members ?? []).filter((member) => !member.required).map((member) => ({ id: member.id, label: `${deliverable.label} · ${member.label}` })),
    ]));
    const invalid = outputPlanProposalHasInvalidFields(state);
    const reasonInvalid = outputScopeAmendmentReasonIssue(state.draft.amendmentReason) !== null;
    const privacyId = `output-amendment-privacy-${this.documentId}`, reasonErrorId = `output-amendment-error-${this.documentId}`;
    const targetFilterActive = state.draft.options.selected_target_ids !== undefined;
    const reviewTargetSelection = targetFilterActive || state.base.options.selected_target_ids !== undefined;
    const blocked = !ready || !this.#planEditingAllowed();
    return html`<section class="output-plan-review" tabindex="-1" aria-label=${this.#controlName(this.#t("reviewPlan", "Review delivery plan"))}><h3>${this.#t("reviewPlan", "Review delivery plan")}</h3>
      ${!snapshot.permissions.canAuthor ? html`<p class="output-plan-author-permission" role="status">${this.#t("planAuthorPermissionLost", "You no longer have permission to edit this delivery plan. Your local choices are retained for inspection; editing and confirmation are disabled. You can close this review with Cancel.")}</p>` : nothing}
      <p>${this.#t("confirmationFree", "Confirming defines the work owed. It never authorizes payment or starts generation.")}</p>${snapshot.requirements.some((row) => !row.spec || row.status !== "valid") ? html`<p role="status">${this.#t("saveBeforeConfirm", "Edit each draft Output block and save its requirements before confirming this plan. Saving and confirming do not generate files.")}</p>` : nothing}
      <form @submit=${this.#confirm}>
        ${this.#planComparison(state, snapshot, ready)}
        <ul>${preview.groups.map((group) => html`<li><b dir="auto">${group.label}</b> · ${group.required ? this.#t("required", "Required") : this.#t("optional", "Optional")}</li>`)}</ul>
        ${optional.length ? html`<fieldset ?disabled=${blocked || targetFilterActive}><legend>${this.#t("optionalSelection", "Optional deliverables (off until selected)")}</legend>${targetFilterActive ? html`<p>${this.#t("optionalTargetFilterLocked", "Optional controls show the work already owed under this target filter. Remove the filter using the action below before changing optional choices.")}</p>` : nothing}${optional.map((option) => {
          const choice = outputPlanOptionalChoice(preview, option.id);
          return html`<label><input type="checkbox" aria-label=${this.#controlName(this.#isolate(option.label), this.#planOwnerContext(state.base, option.id))} .checked=${choice.checked} .indeterminate=${choice.mixed} @change=${(event: Event) => {
          if (!this.#planning || !this.#planEditingAllowed()) return;
          const next = editOutputPlanOptionalChoice(this.#planning, option.id, (event.target as HTMLInputElement).checked);
          if (next) { this.#planning = next; this.requestUpdate(); }
        }}><span dir="auto">${option.label}</span></label>`; })}</fieldset>` : nothing}
        ${reviewTargetSelection ? html`<section class="output-plan-target-selection">
          <p>${targetFilterActive ? this.#t("planTargetFilterHelp", "An explicit target selection is active. Required work and already selected optional work remain owed. The action below removes this filter only in the local preview; optional work that is not owed stays off. Review the preview and confirm separately.") : this.#t("planTargetFilterStaged", "The local preview now includes all required and already selected optional targets for generation checks. The work owed is unchanged. Review it and confirm separately; no work was authorized or started.")}</p>
          ${targetFilterActive ? html`<button aria-label=${this.#controlName(this.#t("planIncludeCommittedTargets", "Include all required and already selected optional targets in this plan"))} type="button" class="button secondary" ?disabled=${blocked || outputPlanProposalConflicts(state)} @click=${() => this.#includeCommittedPlanTargets()}>${this.#t("planIncludeCommittedTargets", "Include all required and already selected optional targets in this plan")}</button>` : nothing}
          <details><summary aria-label=${this.#controlName(this.#t("planGenerationSelectionPreview", "Targets included for generation checks in this preview: {selected} of {total}.", { selected: this.i18n.number(preview.targets.filter((target) => target.selected).length), total: this.i18n.number(preview.targets.length) }))} data-output-selection-preview>${this.#t("planGenerationSelectionPreview", "Targets included for generation checks in this preview: {selected} of {total}.", { selected: this.i18n.number(preview.targets.filter((target) => target.selected).length), total: this.i18n.number(preview.targets.length) })}</summary><ul>${preview.targets.map((target) => html`<li><b dir="auto">${target.label}</b><p>${target.selected ? this.#t("planTargetIncludedForChecks", "Included for generation checks.") : this.#t("planTargetExcludedFromChecks", "Excluded from generation checks; any agreed work is still owed.")}</p></li>`)}</ul></details>
        </section>` : nothing}
        ${specs.flatMap((spec) => spec.deliverables.filter((deliverable) => deliverable.content_quantity?.kind === "range").map((deliverable) => this.#planCountEditor(deliverable.id, deliverable.label, deliverable.content_quantity!, state, ready)))}
        ${preview.targets.some((target) => target.content_quantity) ? html`<h4>${this.#t("planResolvedRules", "Proposed acceptance rules and separate attempt aims")}</h4>` : nothing}
        ${preview.targets.filter((target) => target.content_quantity).map((target) => {
          const aim = target.suggested_count ?? (target.count_policy?.kind === "flexible" ? target.count_policy.aim : undefined);
          return html`<div><b dir="auto">${target.label}</b><p>${this.#planPolicyText(target.count_policy, target.content_quantity)}</p><p>${aim === null || aim === undefined ? this.#t("planAimNone", "No separate attempt aim is set.") : this.#t("attemptAimOnly", "Attempt aim: {aim}. This suggestion does not replace the acceptance rule above.", { aim: this.i18n.number(aim) })}</p></div>`;
        })}
        ${invalid ? html`<p role="alert">${this.#t("planPreviewInvalid", "The preview retains your last parsed count choices. Correct values that are invalid for the current requirements before confirming.")}</p>` : nothing}
        <p>${this.#t("finitePreview", "Preview: {targets} defined file targets; {unresolved} unresolved groups remain visible.", { targets: preview.targets.length, unresolved: preview.unresolved_groups.length })}</p>
        ${snapshot.confirmedPlan ? html`<label>${this.#t("amendmentReason", "Reason for changing the agreed scope")}<textarea rows="2" aria-label=${this.#controlName(this.#t("amendmentReason", "Reason for changing the agreed scope"))} maxlength=${OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH} aria-invalid=${String(reasonInvalid)} aria-describedby=${reasonInvalid ? `${privacyId} ${reasonErrorId}` : privacyId} ?disabled=${blocked} .value=${state.draft.amendmentReason} @input=${(event: InputEvent) => { if (!this.#planning || !this.#planEditingAllowed()) return; this.#planning = editOutputPlanProposal(this.#planning, { amendmentReason: (event.target as HTMLTextAreaElement).value }); this.requestUpdate(); }}></textarea><span>${this.#t("amendmentHelp", "Required when withdrawing agreed work. Previous obligations, approvals, and charges remain in history. Work with unresolved provider acceptance or cost must be stopped or reconciled before withdrawal.")}</span><span id=${privacyId}>${this.#t("amendmentReasonPrivacy", "This exact reason appears in every downloaded JSON and CSV manifest. Use only text that is safe to share with the recipients.")}</span>${reasonInvalid ? html`<span id=${reasonErrorId} role="alert">${this.#amendmentReasonCorrection()}</span>` : nothing}</label>` : nothing}
        ${preview.unresolved_groups.length ? html`<ul class="output-unresolved">${preview.unresolved_groups.map((group) => html`<li><b dir="auto">${group.label}</b><span>${group.issues.map((issue) => this.#problem(issue.code)).join(" ")}</span></li>`)}</ul>` : nothing}
        ${preview.issues.length ? html`<ul class="output-unresolved">${preview.issues.map((issue) => html`<li>${this.#problem(issue.code)}</li>`)}</ul>` : nothing}
        <div class="output-actions"><button aria-label=${this.#controlName(this.#t("cancel", "Cancel"))} type="button" class="button ghost" @click=${() => this.#closePlan()}>${this.#t("cancel", "Cancel")}</button>${state.dirty && !outputPlanProposalConflicts(state) ? html`<button aria-label=${this.#controlName(this.#t("planDiscard", "Discard local choices and use latest"))} type="button" class="button ghost" ?disabled=${blocked} @click=${() => this.#resolvePlanConflict(false)}>${this.#t("planDiscard", "Discard local choices and use latest")}</button>` : nothing}<button aria-label=${this.#controlName(this.#t("confirm", "Confirm requirements · no generation"))} type="submit" class="button primary" ?disabled=${blocked || invalid || reasonInvalid || outputPlanProposalConflicts(state) || preview.issues.length > 0 || snapshot.requirements.some((row) => !row.spec || row.status !== "valid")}>${this.#t("confirm", "Confirm requirements · no generation")}</button></div>
      </form></section>`;
  }

  #operationReceiptControls(snapshot: OutputRequirementsSnapshot, grant: OutputRequirementsSnapshot["grants"][number], operation: OutputRequirementsSnapshot["grants"][number]["operations"][number], job: { status: string; errorDetail?: { code: string } | null } | undefined, ready: boolean, recovery: ReturnType<typeof outputOperationRecovery>) {
    const receipt = outputOperationSupportReceipt(snapshot, grant.id, operation.id, this.store.documentJobs.get());
    const timedOut = job?.errorDetail?.code === "output_execution_time_limit";
    const unsettled = recovery.reason === "cost_unresolved" || recovery.reason === "accounting_unknown" || operation.status === "uncertain";
    const needsRecovery = timedOut || unsettled && (recovery.terminal || operation.status === "uncertain" || job?.status === "failed" || job?.status === "canceled");
    const ownAttempt = grant.actorUserId === snapshot.scope.actorUserId;
    const jobActive = Boolean(job && ["queued", "running", "committing"].includes(job.status));
    return html`${timedOut ? html`<p>${this.#t("operationTimeLimit", "This native attempt reached its execution time limit, including planning and repairs. A request already sent may still incur charges. No replacement is submitted automatically.")}</p>` : nothing}
      ${unsettled ? html`<p>${this.#t("receiptUncertainHeld", "Provider acceptance or cost is unresolved. The spending reservation stays held; do not authorize a replacement while this remains unknown.")}</p>` : nothing}
      ${needsRecovery ? html`<section class="output-receipt-help" aria-label=${this.#controlName(this.#t("operationReceiptHelp", "Investigate this saved attempt"), this.#attemptContext(snapshot, grant, operation))}>
        <p>${this.#t("receiptCheckExplanation", "Check saved receipt uses only evidence already stored by Forma. It does not contact a provider, generate work, release an unknown charge, or alter the required output.")}</p>
        ${ownAttempt ? html`<button aria-label=${this.#controlName(this.#t("checkSavedReceipt", "Check saved receipt · no generation"), this.#attemptContext(snapshot, grant, operation))} type="button" class="button secondary compact" ?disabled=${!ready || Boolean(this.#busy) || jobActive} @click=${() => this.#checkOperationReceipt(grant.id, operation.id)}>${this.#t("checkSavedReceipt", "Check saved receipt · no generation")}</button>` : html`<p>${this.#t("receiptActorOnly", "Only the person who authorized this attempt can check its saved receipt. An authorized operator can investigate using the technical receipt below.")}</p>`}
        ${jobActive ? html`<p>${this.#t("receiptStillActive", "This attempt is still active. Check its saved receipt after it stops; no replacement is authorized by this control.")}</p>` : nothing}
        <p>${this.#t("receiptEscalation", "If the saved receipt still cannot establish acceptance or cost, give the technical receipt to a Forma operator or your workspace administrator. Ask them to investigate the existing attempt before considering a release or replacement. This interface has no self-service override for an unknown charge.")}</p>
      </section>` : nothing}
      <details class="output-operation-receipt" ?open=${needsRecovery}><summary aria-label=${this.#controlName(this.#t("operationReceiptIds", "Operation receipt identifiers"), this.#attemptContext(snapshot, grant, operation))}>${this.#t("operationReceiptIds", "Operation receipt identifiers")}</summary>
        <p>${this.#t("operationReceiptPrivacy", "This receipt contains technical identifiers and recorded accounting, not source text or generation inputs. Copying does not send it anywhere; share it only with an authorized operator.")}</p>
        ${receipt ? html`<button aria-label=${this.#controlName(this.#t("copyOperationReceipt", "Copy technical receipt"), this.#attemptContext(snapshot, grant, operation))} type="button" class="button secondary compact" ?disabled=${!ready} @click=${() => this.#copyOperationReceipt(grant.id, operation.id)}>${this.#t("copyOperationReceipt", "Copy technical receipt")}</button><label>${this.#t("operationReceiptText", "Technical receipt for manual copying")}<textarea aria-label=${this.#controlName(this.#t("operationReceiptText", "Technical receipt for manual copying"), this.#attemptContext(snapshot, grant, operation))} readonly rows="12" spellcheck="false" lang="en" dir="ltr" .value=${receipt}></textarea></label>` : html`<p>${this.#t("operationReceiptUnavailable", "A complete technical receipt is unavailable in this scope. Refresh before copying identifiers.")}</p>`}
      </details>`;
  }

  async #copyOperationReceipt(grantId: string, slotId: string) {
    const view = this.#captureView();
    const resource = this.store.outputRequirements.resource(view.documentId);
    if (!this.#viewCurrent(view) || resource.state !== "ready" || !resource.snapshot) return;
    const receipt = outputOperationSupportReceipt(resource.snapshot, grantId, slotId, this.store.documentJobs.get());
    if (!receipt) return;
    const copied = await copyInterfaceText(receipt);
    if (this.#viewCurrent(view)) this.#announce(copied
      ? this.#t("operationReceiptCopied", "Technical receipt copied. It was not sent to anyone. Share it only with an authorized Forma operator or workspace administrator.")
      : this.#t("operationReceiptCopyFailed", "Automatic copying was unavailable. Select the technical receipt below and copy it manually."), !copied);
  }

  async #checkOperationReceipt(grantId: string, slotId: string) {
    const view = this.#captureView();
    const resource = this.store.outputRequirements.resource(view.documentId);
    const grant = resource.snapshot?.grants.find((candidate) => candidate.id === grantId);
    const operation = grant?.operations.find((candidate) => candidate.id === slotId);
    if (!this.#viewCurrent(view) || this.#busy || resource.state !== "ready" || !grant || !operation || grant.actorUserId !== resource.snapshot?.scope.actorUserId) return;
    this.#busy = `receipt:${slotId}`; this.requestUpdate();
    try {
      const result = await this.store.reconcileOutputOperationReceipt(view.documentId, grantId, slotId, operation.jobId);
      if (!this.#viewCurrent(view)) return;
      if ("errorCode" in result) this.#announce(result.status === "forbidden"
        ? this.#t("operationReceiptAccessChanged", "The operation receipt is no longer available in this scope. No result from the previous scope was shown.")
        : this.#t("operationReceiptCheckFailed", "The receipt check could not be confirmed. No new provider request was submitted. Refresh the saved state or give the technical receipt to an authorized operator."), true);
      else if (!result.refreshed) this.#announce(this.#t("operationReceiptRefreshFailed", "The saved receipt was checked, but current Output state could not be loaded. Refresh before acting; no new provider request was submitted."), true);
      else if (result.status === "uncertain") this.#announce(this.#t("operationReceiptStillUnknown", "The original receipt check could not establish provider acceptance or cost. Review the refreshed operation and accounting for the current state. If acceptance or cost remains unknown, do not submit a replacement; copy the technical receipt and ask an authorized operator to investigate."), true);
      else this.#announce(result.reconciled
        ? this.#t("operationReceiptKnown", "Persisted provider evidence was reconciled. No provider request was sent. Review the updated operation and spending before considering further work.")
        : this.#t("operationReceiptNoChange", "The saved receipt needs no further financial reconciliation. No provider request was sent and no new work was started."));
    } finally { if (this.#viewCurrent(view)) { this.#busy = ""; this.requestUpdate(); } }
  }

  #money(value: number) {
    return Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat(this.i18n.locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value / 1_000_000) : this.#t("accountingValueUnknown", "Unknown");
  }

  #when(value: string) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(this.i18n.locale, { dateStyle: "medium", timeStyle: "short" }).format(date) : this.#t("dateUnknown", "Date unavailable");
  }

  #acceptanceContract(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget) {
    const quantity = target.content_quantity;
    const policy = target.count_policy;
    const count = policy?.kind === "exact"
      ? this.#t("acceptCountExact", "Accept exactly {value} {unit}.", { value: this.i18n.number(policy.value), unit: this.#label("unit", policy.unit) })
      : policy?.kind === "flexible"
        ? this.#t("acceptCountFlexible", "Accept any count from {min} to {max} {unit}.", { min: this.i18n.number(policy.min), max: this.i18n.number(policy.max), unit: this.#label("unit", policy.unit) })
        : quantity?.kind === "exact"
          ? this.#t("acceptCountExact", "Accept exactly {value} {unit}.", { value: this.i18n.number(quantity.value), unit: this.#label("unit", quantity.unit) })
          : quantity ? this.#t("acceptCountUnresolved", "The content count acceptance rule still needs a decision.") : "";
    const aim = target.suggested_count ?? (policy?.kind === "flexible" ? policy.aim : undefined);
    const sourceBlocks = this.store.projection.get().libraryBlocks.filter((block) => block.documentId === snapshot.documentId && !block.removed && block.type.toLowerCase() !== "output");
    const source = target.source_scope.kind === "document"
      ? html`<span dir="auto">${this.documentName || this.#t("sourceWholeDocument", "This Document’s source context")}</span>`
      : target.source_scope.kind === "blocks"
        ? html`<ul>${target.source_scope.block_ids.map((id) => {
            const block = sourceBlocks.find((candidate) => candidate.id === id);
            return html`<li dir="auto">${block ? String(block.properties.label ?? block.handle) : this.#t("sourceUnavailable", "A selected source is unavailable; refresh and review the scope.")}</li>`;
          })}</ul>`
        : html`<span>${this.#t("sourceUnresolved", "Source scope remains unresolved.")}</span><p dir="auto">${target.source_scope.reason}</p>`;
    const coverage = target.coverage.kind === "document_context"
      ? html`<span>${this.#t("coverageContext", "Use the Document’s creative context; an exhaustive outline is not required.")}</span>`
      : target.coverage.kind === "document_outline"
        ? html`<span>${this.#t("coverageOutline", "Outline the Document’s source material.")}</span>`
        : target.coverage.kind === "topics"
          ? html`<ul>${target.coverage.topics.map((topic) => html`<li dir="auto">${topic}</li>`)}</ul>`
          : html`<span>${this.#t("coverageUnresolved", "Coverage remains unresolved.")}</span><p dir="auto">${target.coverage.description}</p>`;
    return html`<section class="output-acceptance-contract" aria-label=${this.#t("acceptanceContract", "What this file must satisfy")}>
      <p>${this.#t("oneTargetFile", "One physical file is owed for this target; format counts and slide counts do not create additional files.")}</p>
      ${quantity?.kind === "range" ? html`<p>${this.#t("authoredRange", "Authored range: {min}–{max} {unit}. A suggested aim does not change that range.", { min: quantity.min, max: quantity.max, unit: this.#label("unit", quantity.unit) })}</p>` : nothing}
      ${count ? html`<p><b>${count}</b></p>` : nothing}
      ${aim !== undefined && aim !== null ? html`<p>${this.#t("attemptAimOnly", "Attempt aim: {aim}. This suggestion does not replace the acceptance rule above.", { aim: this.i18n.number(aim) })}</p>` : nothing}
      ${target.aspect_ratio ? html`<p>${this.#t("ratio", "Aspect ratio: {width}:{height}", { width: target.aspect_ratio.width, height: target.aspect_ratio.height })}</p>` : nothing}
      <dl><dt>${this.#t("sourceContract", "Source scope")}</dt><dd>${source}</dd><dt>${this.#t("coverageContract", "Required coverage")}</dt><dd>${coverage}</dd></dl>
    </section>`;
  }

  #assetFacts(asset: OutputRequirementsSnapshot["assets"][number], context: string) {
    const facts = asset.inspection.facts;
    return html`<div class="output-file-facts">
      <p>${asset.mimeType} · ${this.i18n.number(asset.byteLength)} B</p>
      <ul>
        ${facts.width !== undefined && facts.height !== undefined ? html`<li>${this.#t("measuredDimensions", "Measured display dimensions: {width} × {height} pixels.", { width: this.i18n.number(facts.width), height: this.i18n.number(facts.height) })}</li>` : nothing}
        ${facts.durationSeconds !== undefined ? html`<li>${this.#t("measuredDuration", "Measured duration: {seconds} seconds.", { seconds: this.i18n.number(facts.durationSeconds) })}</li>` : nothing}
        ${facts.slideCount !== undefined ? html`<li>${this.#t("measuredSlides", "Measured slide count: {count}.", { count: this.i18n.number(facts.slideCount) })}</li>` : nothing}
        ${facts.hiddenSlideCount !== undefined ? html`<li>${this.#t("measuredHiddenSlides", "Measured hidden slides: {count}.", { count: this.i18n.number(facts.hiddenSlideCount) })}</li>` : nothing}
        ${facts.slideWidthEmu !== undefined && facts.slideHeightEmu !== undefined ? html`<li>${this.#t("measuredSlideSize", "Measured slide geometry: {width} × {height} EMU.", { width: this.i18n.number(facts.slideWidthEmu), height: this.i18n.number(facts.slideHeightEmu) })}</li>` : nothing}
      </ul>
      <p>${this.#t("inspectionCaveat", "These are bounded structural and header checks, not proof of decoding, playback, meaningful content, source coverage, accessibility, or rights. Review the exact file before accepting it.")}</p>
      <details><summary aria-label=${this.#controlName(this.#t("fileFingerprint", "Exact file fingerprint"), context)}>${this.#t("fileFingerprint", "Exact file fingerprint")}</summary><code dir="ltr">SHA-256 ${asset.sha256}</code></details>
    </div>`;
  }

  #target(snapshot: OutputRequirementsSnapshot, target: OutputPlanTarget, ready: boolean) {
    const state = snapshot.targetStates.find((candidate) => candidate.target_id === target.id);
    const plan = snapshot.confirmedPlan;
    const results = snapshot.results.filter((result) => result.targetId === target.id && result.planRevisionId === plan?.revisionId);
    const assets = snapshot.assets.filter((asset) => asset.available && asset.inspection.status === "inspected" && asset.mediaKind === target.media_kind);
    const native = this.#nativeChoices(snapshot, target), nativeScope = this.#nativeBindingScope(snapshot, target);
    const reusable = outputReusableAcceptanceChoices(snapshot, target);
    const blocked = !ready || !outputDeliveryReadiness(snapshot).allowed || Boolean(this.#busy) || Boolean(target.blocking_issues.length);
    return html`<article class="output-target" tabindex="-1" data-output-target=${target.id} aria-labelledby=${`output-target-${this.documentId}-${target.id}`}><header><h4 id=${`output-target-${this.documentId}-${target.id}`} aria-label=${this.#controlName(this.#isolate(target.label), this.#targetContext(snapshot, target))} dir="auto">${target.label}</h4><span>${target.required ? this.#t("required", "Required") : this.#t("optional", "Optional")}</span></header>
      <p>${state ? this.#t("targetDimensions", "Execution: {execution} · Checks: {checks} · Review: {review} · Freshness: {freshness}", { execution: this.#label("execution", state.execution), checks: this.#label("checks", state.checks), review: this.#label("review", state.review), freshness: this.#label("freshness", state.freshness) }) : this.#t("scopeUnknown", "Delivery scope is unknown. Refresh before acting.")}</p>
      ${this.#acceptanceContract(snapshot, target)}
      ${target.blocking_issues.length ? html`<ul>${target.blocking_issues.map((issue) => html`<li>${this.#problem(issue.code)}</li>`)}</ul>` : nothing}
      ${this.#nativeRecoveryControls(snapshot, target, ready)}
      ${native.length ? html`<p>${this.#t("nativeReadyToMatch", "A completed native result is available. Match and check it below; completed generation does not accept the file.")}</p>` : nothing}
      ${snapshot.permissions.canAuthor ? html`<details class="output-existing-work" ?open=${Boolean(native.length || reusable.length)}><summary aria-label=${this.#controlName(this.#t("useExistingWork", "Use a completed result or an owned file"), this.#targetContext(snapshot, target))}>${this.#t("useExistingWork", "Use a completed result or an owned file")}</summary>
        ${native.length ? html`<form class="output-native-bind-form" @submit=${(event: SubmitEvent) => this.#bindNative(event, target, nativeScope)}>
          <label>${this.#t("chooseNativeResult", "Completed native result")}<select aria-label=${this.#controlName(this.#t("chooseNativeResult", "Completed native result"), this.#targetContext(snapshot, target))} name="nativeJobId" required ?disabled=${blocked}><option value="">${this.#t("chooseNativePlaceholder", "Choose a completed attempt")}</option>${native.map(({ job }, index) => html`<option value=${job.jobId}>${this.#t("completedAttempt", "Completed attempt {attempt} · {date}", { attempt: index + 1, date: this.#when(job.completedAt ?? job.updatedAt) })}</option>`)}</select></label>
          <button aria-label=${this.#controlName(this.#t("checkNativeResult", "Match and check completed result · no generation"), this.#targetContext(snapshot, target))} type="submit" class="button secondary compact" ?disabled=${blocked}>${this.#t("checkNativeResult", "Match and check completed result · no generation")}</button>
        </form>` : html`<p>${this.#t("noCompletedNative", "No completed native result for this target and plan is available to match. Failed drafts cannot be adopted from the generation history.")}</p>`}
        <form class="output-bind-form" @submit=${(event: SubmitEvent) => this.#bind(event, target)}><label>${this.#t("matchFile", "Match an inspected file to this target")}<select aria-label=${this.#controlName(this.#t("matchFile", "Match an inspected file to this target"), this.#targetContext(snapshot, target))} name="assetId" required ?disabled=${blocked || !assets.length}><option value="">${this.#t("chooseFile", "Choose a file")}</option>${assets.map((asset, index) => html`<option value=${asset.id}>${this.#t("contextFile", "File {number}: {name}", { number: this.i18n.number(index + 1), name: this.#isolate(asset.name) })}</option>`)}</select></label><button aria-label=${this.#controlName(this.#t("checkFile", "Check file against target"), this.#targetContext(snapshot, target))} type="submit" class="button secondary compact" ?disabled=${blocked || !assets.length}>${this.#t("checkFile", "Check file against target")}</button></form>
        ${!assets.length ? html`<p>${this.#t("uploadBeforeMatch", "Upload a supported file you have rights to use in the owned-file section. Matching it never starts paid generation.")}</p>` : nothing}
        ${reusable.length ? html`<section class="output-reuse-acceptance"><h5>${this.#t("reusePriorReview", "Reuse an earlier acceptance")}</h5><p>${this.#t("reusePriorReviewCaveat", "This is a separate decision to include a previously accepted exact file in the current plan. The server rechecks its source, contract, bytes, rights, and approval; it does not create a new approval.")}</p>${reusable.map((result) => html`<p><span dir="auto">${snapshot.assets.find((asset) => asset.id === result.assetId)?.name ?? this.#t("file", "File")}</span> <button aria-label=${this.#controlName(this.#t("reuseExactAcceptance", "Verify and reuse this exact acceptance"), this.#resultContext(snapshot, result))} type="button" class="button secondary compact" ?disabled=${blocked} @click=${() => this.#reuseAcceptance(result.acceptanceId!, target)}>${this.#t("reuseExactAcceptance", "Verify and reuse this exact acceptance")}</button></p>`)}</section>` : nothing}
      </details>` : nothing}
      ${results.map((result) => this.#result(snapshot, result, ready))}
    </article>`;
  }

  #result(snapshot: OutputRequirementsSnapshot, result: OutputResultRow, ready: boolean) {
    const asset = snapshot.assets.find((candidate) => candidate.id === result.assetId);
    const target = snapshot.confirmedPlan?.plan.targets.find((candidate) => candidate.id === result.targetId);
    const eligibility = result as OutputResultRow & { reviewAllowed?: boolean; independentReviewBlocked?: boolean };
    const independent = snapshot.permissions.independentReview && (result.createdByUserId === this.store.session.get()?.user.userId || asset?.createdByUserId === this.store.session.get()?.user.userId || (result as OutputResultRow & { independentReviewBlocked?: boolean }).independentReviewBlocked === true);
    const reviewAllowed = snapshot.permissions.canReview && eligibility.reviewAllowed === true && !independent;
    const targetContract = snapshot.confirmedPlan?.targetContractDigests?.[result.targetId];
    const current = Boolean(outputDeliveryReadiness(snapshot).allowed && target && typeof targetContract === "string" && targetContract.trim() && result.planRevisionId === snapshot.confirmedPlan?.revisionId && result.targetContractDigest === targetContract && result.sourceDigest === snapshot.sourceRevision && asset?.sha256 === result.sha256 && asset.available && asset.inspection.status === "inspected" && !target?.blocking_issues.length);
    return html`<section class="output-result" tabindex="-1" data-output-result=${result.id} aria-labelledby=${`output-result-${this.documentId}-${result.id} output-result-context-${this.documentId}-${result.id}`}><b id=${`output-result-${this.documentId}-${result.id}`} dir="auto">${asset?.name ?? this.#t("file", "File")}</b><span class="sr-only" id=${`output-result-context-${this.documentId}-${result.id}`}>${this.#documentContext()} · ${this.#resultContext(snapshot, result)}</span><p>${this.#resultLabel(result)}</p>
      ${!current ? html`<p>${this.#t("resultNotCurrent", "This result is not verified as current and available for this target. Recheck the plan and file before accepting or delivering it.")}</p>` : nothing}
      ${result.problems.length ? html`<ul>${result.problems.map((problem) => html`<li>${this.#problem(problem)}</li>`)}</ul>` : nothing}
      ${asset ? html`${this.#assetFacts(asset, this.#resultContext(snapshot, result))}<button aria-label=${this.#controlName(this.#t("downloadReview", "Download exact file for review"), this.#resultContext(snapshot, result))} type="button" class="button secondary compact" ?disabled=${!ready || !outputSourceReadiness(snapshot).allowed || !snapshot.permissions.canDownload || !asset.available} @click=${() => this.#download(asset.downloadUrl)}>${this.#t("downloadReview", "Download exact file for review")}</button>` : nothing}
      ${target ? html`<details><summary aria-label=${this.#controlName(this.#t("reviewAcceptanceContract", "Review the acceptance contract again"), this.#resultContext(snapshot, result))}>${this.#t("reviewAcceptanceContract", "Review the acceptance contract again")}</summary>${this.#acceptanceContract(snapshot, target)}</details>` : nothing}
      ${snapshot.permissions.canReview && typeof eligibility.reviewAllowed !== "boolean" ? html`<p>${this.#t("reviewEligibilityUnknown", "Review eligibility for this exact result is unavailable. Refresh outputs before reviewing it.")}</p>` : nothing}
      ${independent ? html`<p>${this.#t("independentReview", "An independent authorized reviewer must accept this result.")}</p>` : reviewAllowed && result.review !== "approved" ? html`<form class="output-result-review" @submit=${(event: SubmitEvent) => this.#review(event, result)}>
        <label><input type="checkbox" aria-label=${this.#controlName(this.#t("reviewCoverage", "I reviewed content, source coverage, layout or playback, and accessibility for this exact file."), this.#resultContext(snapshot, result))} name="coverage" required>${this.#t("reviewCoverage", "I reviewed content, source coverage, layout or playback, and accessibility for this exact file.")}</label>
        <label><input type="checkbox" aria-label=${this.#controlName(this.#t("reviewRights", "I confirmed current rights to use this file and its sources."), this.#resultContext(snapshot, result))} name="rights" required>${this.#t("reviewRights", "I confirmed current rights to use this file and its sources.")}</label>
        <label>${this.#t("reviewNote", "Review note")}<textarea aria-label=${this.#controlName(this.#t("reviewNote", "Review note"), this.#resultContext(snapshot, result))} name="note" rows="2" maxlength="4000"></textarea></label>
        <div class="output-actions"><button aria-label=${this.#controlName(this.#t("requestChanges", "Request changes"), this.#resultContext(snapshot, result))} type="submit" value="changes_requested" formnovalidate class="button secondary" ?disabled=${!ready || Boolean(this.#busy) || !current}>${this.#t("requestChanges", "Request changes")}</button><button aria-label=${this.#controlName(this.#t("acceptExact", "Accept this exact result"), this.#resultContext(snapshot, result))} type="submit" value="approve" class="button primary" ?disabled=${!ready || Boolean(this.#busy) || !current || result.checksStatus !== "passed"}>${this.#t("acceptExact", "Accept this exact result")}</button></div>
      </form>` : nothing}
    </section>`;
  }

  #execution(snapshot: OutputRequirementsSnapshot, ready: boolean) {
    const plan = snapshot.confirmedPlan;
    if (!plan) return nothing;
    const preflight = this.#currentPreflight(snapshot), authorizeDecision = this.#paidDecision("authorize");
    const selectionScope = this.#runSelectionScope(snapshot), overLimit = this.#selectedTargets.size > OUTPUT_PREFLIGHT_TARGET_MAX_COUNT;
    const selectedIds = [...this.#selectedTargets];
    const contractsKnown = Boolean(plan.targetContractDigests) && selectedIds.every((id) => typeof plan.targetContractDigests?.[id] === "string" && plan.targetContractDigests[id].trim());
    const selectionCurrent = Boolean(this.#nativeScopeKey(snapshot, selectedIds));
    return html`<section class="output-execution" tabindex="-1" aria-label=${this.#controlName(this.#t("nextRun", "Choose work for the next run"))}><h3>${this.#t("nextRun", "Choose work for the next run")}</h3><p>${this.#t("runDoesNotChangeScope", "This selection controls the next run. It does not remove any required work from the delivery plan.")}</p>
      <p>${this.#t("preflightSelectionLimit", "Availability and cost checks support at most {limit} targets at a time. Checking a smaller selection does not remove any work from the delivery plan.", { limit: this.i18n.number(OUTPUT_PREFLIGHT_TARGET_MAX_COUNT) })}</p>
      <form @submit=${this.#inspectRun}>${html`<div class="output-run-selection-controls"><button aria-label=${this.#controlName(this.#t("clearRunSelection", "Clear selection for this check"))} type="button" class="button ghost" ?disabled=${!this.#runSelectionEditingAllowed(snapshot, selectionScope)} @click=${() => this.#clearRunSelection(selectionScope)}>${this.#t("clearRunSelection", "Clear selection for this check")}</button><p role="status">${this.#runSelectionCleared ? this.#t("runSelectionCleared", "Selection cleared for this check; the delivery plan is unchanged.") : ""}</p></div>`}<fieldset><legend>${this.#t("selectedTargets", "Targets to check for generation")}</legend>${plan.plan.targets.map((target) => html`<label><input class="output-run-target" data-output-run-target=${target.id} type="checkbox" .checked=${target.selected && this.#selectedTargets.has(target.id)} ?disabled=${!ready || Boolean(this.#busy) || !snapshot.permissions.canRequest || !target.selected || Boolean(target.blocking_issues.length)} @change=${(event: Event) => this.#changeRunSelection(event, target.id, selectionScope)} aria-label=${this.#controlName(this.#isolate(target.label), this.#targetContext(snapshot, target))} aria-describedby=${!target.selected ? `output-run-help-${this.documentId}-${target.id}` : nothing}><span dir="auto">${target.label}</span>${!target.selected ? html`<span id=${`output-run-help-${this.documentId}-${target.id}`}>${this.#excludedTargetMessage(snapshot, target)}</span>` : nothing}</label>`)}</fieldset>
        ${plan.plan.targets.some((target) => !target.selected) && snapshot.permissions.canAuthor ? html`<button aria-label=${this.#controlName(this.#t("reviewPlan", "Review delivery plan"), this.#t("nextRun", "Choose work for the next run"))} type="button" class="button secondary" ?disabled=${!ready || Boolean(this.#busy)} @click=${(event: Event) => this.#openPlan(event.currentTarget as HTMLElement)}>${this.#t("reviewPlan", "Review delivery plan")}</button>` : nothing}
        ${overLimit ? html`<p role="alert">${this.#selectionLimitMessage()}</p>` : nothing}
        ${!contractsKnown ? html`<p role="status">${this.#t("targetContractsUnavailable", "The current target contracts are unavailable. Refresh outputs to check them before requesting availability or authorizing work.")}</p>` : nothing}
        <button aria-label=${this.#controlName(this.#t("checkRun", "Check availability and cost · no generation"))} type="submit" class="button secondary" ?disabled=${!ready || !outputNativeReadiness(snapshot).allowed || !snapshot.permissions.canRequest || !this.#selectedTargets.size || overLimit || !selectionCurrent || Boolean(this.#busy)}>${this.#t("checkRun", "Check availability and cost · no generation")}</button></form>
      ${preflight ? html`<section class="output-provider-disclosure"><h4>${this.#t("paidDisclosure", "Provider, source transfer, and maximum cost")}</h4>
        <p>${this.#t("costCeiling", "Maximum {amount} across at most {calls} generation calls, including bounded repairs. Charges may remain even when validation fails.", { amount: this.#money(preflight.maximumMicrousd), calls: preflight.maximumCalls })}</p>
        <p>${this.#t("preflightExpires", "Offer and execution authorization deadline: {date}.", { date: this.#when(preflight.expiresAt) })}</p>
        <ul>${preflight.targets.map((offered) => html`<li><b dir="auto">${plan.plan.targets.find((target) => target.id === offered.targetId)?.label ?? this.#t("targetUnavailable", "Target unavailable")}</b><p>${offered.provider ?? this.#t("unavailable", "Unavailable")} ${offered.model ?? ""}</p><p>${this.#preflightReason(offered)}</p><p>${this.#sourceTransfer(offered)}</p>${this.#model3dDisclosure(offered)}<p>${this.#executionWindow(offered)}</p><p>${this.#t("targetCostLimit", "Target limit: {amount} across at most {calls} generation calls.", { amount: this.#money(offered.maximumMicrousd), calls: offered.maximumCalls })}</p></li>`)}</ul>
        <form id=${`output-authorize-settings-${this.documentId}`} @submit=${(event: SubmitEvent) => event.preventDefault()}><label><input aria-label=${this.#controlName(this.#t("authorizeAcknowledgment", "I approve this source transfer and the disclosed aggregate spending limit for these targets."))} type="checkbox" .checked=${this.#authorizationAcknowledged} @change=${(event: Event) => { const current = this.#paidDecision("authorize"); if (!authorizeDecision || !current || outputPaidDecisionKey(authorizeDecision) !== outputPaidDecisionKey(current)) return; this.#authorizationAcknowledged = (event.target as HTMLInputElement).checked; this.#paidActivation.clear(); this.requestUpdate(); }}>${this.#t("authorizeAcknowledgment", "I approve this source transfer and the disclosed aggregate spending limit for these targets.")}</label></form>
        <form @submit=${this.#authorize}><button aria-label=${this.#controlName(this.#t("authorize", "Authorize selected work"))} type="submit" data-output-paid-action="true" class="button primary" @click=${(event: MouseEvent) => this.#armPaidAction(event, authorizeDecision)} ?disabled=${!ready || !outputNativeReadiness(snapshot).allowed || !snapshot.permissions.canRequest || Boolean(this.#busy) || !this.#authorizationAcknowledged || !authorizeDecision || (!Number.isFinite(Date.parse(preflight.expiresAt)) || Date.parse(preflight.expiresAt) <= Date.now())}>${this.#t("authorize", "Authorize selected work")}</button></form>
      </section>` : nothing}
      ${snapshot.grants.map((grant) => {
        const currentPlan = grant.planRevisionId === plan.revisionId;
        const expired = !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.now();
        const disclosure = grant.disclosure;
        const runDecision = this.#paidDecision("run", grant.id);
        const canStart = Boolean(runDecision);
        return html`<section class="output-grant" aria-labelledby=${`output-grant-${this.documentId}-${grant.id}`}><h4 id=${`output-grant-${this.documentId}-${grant.id}`} aria-label=${this.#controlName(this.#t("retainedAuthorization", "Recorded authorization and attempts"), this.#authorizationContext(snapshot, grant))}>${this.#t("retainedAuthorization", "Recorded authorization and attempts")}</h4><p>${this.#t("grantStatus", "Authorization: {status} · {count} recorded operations", { status: this.#label("grant", grant.status), count: grant.operations.length })}</p>
          ${!currentPlan ? html`<p>${this.#t("previousPlanReceipt", "This receipt belongs to an earlier plan. Its charges and history remain; it cannot start work for the current plan.")}</p>` : nothing}
          ${currentPlan && disclosure && !this.#grantDisclosureCurrent(snapshot, grant) ? html`<p>${this.#t("recordedDisclosureChanged", "This recorded authorization does not match the current plan, source, or target scope. Its history and charges remain, but it cannot start work for the current scope.")}</p>` : nothing}
          <p>${this.#t("retainedCost", "Recorded spend: {used}. Unresolved exposure: {exposed}. Authorized ceiling: {maximum}.", { used: this.#money(grant.usedMicrousd), exposed: this.#money(grant.exposedMicrousd), maximum: this.#money(grant.maximumMicrousd) })}</p>
          <p>${this.#t("retainedCalls", "Recorded generation calls: {used}; unresolved generation calls: {pending}; authorized maximum: {maximum}.", { used: grant.usedCalls, pending: grant.pendingCalls, maximum: grant.maximumCalls })}</p>
          <p>${this.#t("authorizationExpiry", "Execution authorization deadline: {date}.", { date: this.#when(grant.expiresAt) })} ${expired ? this.#t("authorizationExpired", "This deadline has passed. New provider calls, including repairs, are forbidden. Existing submissions and their costs remain recorded.") : ""}</p>
          ${disclosure ? html`<details class="output-retained-disclosure"><summary aria-label=${this.#controlName(this.#t("retainedProviderDisclosure", "Review the recorded provider and source transfer"), this.#authorizationContext(snapshot, grant))}>${this.#t("retainedProviderDisclosure", "Review the recorded provider and source transfer")}</summary><ul>${disclosure.targets.map((offered) => html`<li><b dir="auto">${plan.plan.targets.find((target) => target.id === offered.targetId)?.label ?? this.#t("previousPlanTarget", "Target from an earlier plan")}</b><p>${offered.provider ?? this.#t("unavailable", "Unavailable")} ${offered.model ?? ""}</p><p>${this.#preflightReason(offered)}</p><p>${this.#sourceTransfer(offered)}</p>${this.#model3dDisclosure(offered)}<p>${this.#executionWindow(offered)}</p><p>${this.#t("targetCostLimit", "Target limit: {amount} across at most {calls} generation calls.", { amount: this.#money(offered.maximumMicrousd), calls: offered.maximumCalls })}</p></li>`)}</ul></details>` : html`<p>${this.#t("disclosureUnavailable", "The recorded source-transfer disclosure is unavailable. Starting paid work is blocked; refresh to recover the complete authorization.")}</p>`}
          <ul>${grant.operations.map((operation, index) => {
            const target = currentPlan ? plan.plan.targets.find((candidate) => candidate.id === operation.targetId) : undefined;
            const job = this.store.documentJobs.get().find((candidate) => candidate.jobId === operation.jobId && candidate.documentId === snapshot.documentId);
            const recovery = outputOperationRecovery(operation, job, snapshot.documentId);
            return html`<li class="output-operation" tabindex="-1" data-output-operation=${operation.id} data-output-grant=${grant.id} aria-labelledby=${`output-operation-${this.documentId}-${operation.id}`}><span class="sr-only" id=${`output-operation-${this.documentId}-${operation.id}`}>${this.#documentContext()} · ${this.#attemptContext(snapshot, grant, operation)}</span><b dir="auto">${target?.label || (operation as { targetLabel?: string }).targetLabel || this.#t("previousPlanTarget", "Target from an earlier plan")}</b><p>${this.#t("namedOperationStatus", "Attempt {attempt}: {operation}. Job: {job}.", { attempt: index + 1, operation: this.#label("operation", operation.status), job: this.#label("job", job?.status) })}</p>
              <p>${this.#t("retainedCost", "Recorded spend: {used}. Unresolved exposure: {exposed}. Authorized ceiling: {maximum}.", { used: this.#money(operation.usedMicrousd), exposed: this.#money(operation.exposedMicrousd), maximum: this.#money(operation.maximumMicrousd) })}</p>
              <p>${this.#t("retainedCalls", "Recorded generation calls: {used}; unresolved generation calls: {pending}; authorized maximum: {maximum}.", { used: operation.usedCalls, pending: operation.pendingCalls, maximum: operation.maximumCalls })}</p>
              ${this.#operationReceiptControls(snapshot, grant, operation, job, ready, recovery)}
              ${recovery.canStop && snapshot.permissions.canRequest ? html`<p>${this.#t("stopDoesNotErase", "Stopping does not remove the target or erase provider charges already incurred.")}</p><button aria-label=${this.#controlName(this.#t("stopAttempt", "Stop this attempt"), this.#attemptContext(snapshot, grant, operation))} type="button" class="button secondary compact" ?disabled=${!ready || Boolean(this.#busy)} @click=${() => this.#stop(operation.jobId)}>${this.#t("stopAttempt", "Stop this attempt")}</button>` : nothing}
              ${currentPlan && target && recovery.terminal ? html`<button aria-label=${this.#controlName(this.#t("prepareAlternative", "Review a new alternative · no generation"), this.#attemptContext(snapshot, grant, operation))} type="button" class="button secondary compact" ?disabled=${!ready || !outputNativeReadiness(snapshot).allowed || Boolean(this.#busy) || !snapshot.permissions.canRequest || !recovery.canPrepareAlternative || Boolean(target.blocking_issues.length)} @click=${() => this.#alternative(operation.id, target)}>${this.#t("prepareAlternative", "Review a new alternative · no generation")}</button>` : nothing}

            </li>`;
          })}</ul>
          ${currentPlan && (grant.status === "authorized" || grant.status === "active") ? html`<form @submit=${(event: SubmitEvent) => this.#run(event, grant.id)}><button aria-label=${this.#controlName(grant.status === "authorized" ? this.#t("startAuthorized", "Start authorized work") : this.#t("recoverAuthorized", "Recover recorded operations"), this.#authorizationContext(snapshot, grant))} type="submit" data-output-paid-action="true" class="button primary" @click=${(event: MouseEvent) => this.#armPaidAction(event, runDecision)} ?disabled=${!ready || Boolean(this.#busy) || !snapshot.permissions.canRequest || !canStart}>${grant.status === "authorized" ? this.#t("startAuthorized", "Start authorized work") : this.#t("recoverAuthorized", "Recover recorded operations")}</button></form>` : nothing}
        </section>`;
      })}
    </section>`;
  }

  protected override render() {
    if (!this.documentId) return html`<p>${this.#t("chooseDocument", "Add this Output requirement to a Document to plan its deliverables.")}</p>`;
    const resource = this.store.outputRequirements.resource(this.documentId);
    const snapshot = resource.snapshot;
    const ready = resource.state === "ready";
    if (!snapshot) return html`${this.#transportReceipt()}<section class="output-requirements" aria-busy=${resource.state === "loading" || this.#sourceRefreshing ? "true" : "false"}><h2>${this.#t("title", "Outputs")}</h2><p role="status">${resource.state === "loading" ? this.#t("loading", "Loading the complete delivery scope…") : this.#t("scopeUnknown", "Delivery scope is unknown. Refresh before acting.")}</p>${resource.error ? html`<p role="alert">${this.#message(resource.errorCode ?? "output_client_load_failed", resource.errorValues)}</p>` : nothing}${this.#notice ? html`<p role=${this.#noticeKind}>${this.#notice}</p>` : nothing}${this.#refreshControl("button secondary")}</section>`;
    const rows = this.blockId ? snapshot.requirements.filter((row) => row.blockId === this.blockId) : snapshot.requirements;
    const packageGate = outputPackageReadiness(snapshot), historyUnverified = snapshot.capabilities.limitationCodes?.includes("output_scope_history_reason_unverified") === true;
    if (this.blockId) return html`${this.#transportReceipt()}${rows.map((row) => this.#card(snapshot, row, ready))}${resource.error ? html`<p role="alert">${this.#message(resource.errorCode ?? "output_client_load_failed", resource.errorValues)}</p>${this.#refreshControl("button secondary")}` : nothing}${this.#notice ? html`<p role=${this.#noticeKind}>${this.#notice}</p>` : nothing}`;
    if (!rows.length && !snapshot.confirmedPlan) return this.#transportReceipt();
    return html`<section class="output-requirements" aria-busy=${resource.state === "refreshing" || this.#sourceRefreshing || Boolean(this.#busy) ? "true" : "false"} data-document-id=${this.documentId}>
      <header class="output-requirements-heading"><div>${this.documentName ? html`<span class="eyebrow" dir="auto">${this.documentName}</span>` : nothing}<h2 aria-label=${this.#controlName(this.#t("title", "Outputs"))} tabindex="-1" data-output-plan-focus-return>${this.#t("title", "Outputs")}</h2><p>${ready ? outputSourceReadiness(snapshot).allowed ? this.#summary(snapshot.summary, !snapshot.confirmedPlan, historyUnverified) : this.#t("sourceReadinessUnknown", "Source checks are unavailable; delivery readiness is unknown.") : this.#t("scopeUnknown", "Delivery scope is unknown. Refresh before acting.")}</p></div>${this.#refreshControl("button ghost compact")}</header>
      ${this.#transportReceipt()}
      <p>${this.#t("wholeScope", "Progress covers the entire confirmed plan, including unselected, unresolved, and currently unavailable work.")}</p>
      ${this.#sourceNotice(snapshot)}
      ${this.#sourceCapacityNotice(snapshot)}
      ${this.#scopeHistory(snapshot)}
      ${snapshot.requirements.some((row) => row.status !== "valid") ? html`<p>${this.#t("saveBeforeConfirm", "Edit each draft Output block and save its requirements before confirming this plan. Saving and confirming do not generate files.")}</p>` : nothing}
      ${resource.error ? html`<p role="alert">${this.#message(resource.errorCode ?? "output_client_load_failed", resource.errorValues)}</p>` : nothing}
      ${this.#notice ? html`<p class="output-notice" role=${this.#noticeKind}>${this.#notice}</p>` : nothing}
      ${this.surface === "project" ? html`<p>${this.#t("projectScope", "Open the Document to change requirements or review exact files.")}</p>` : html`
        ${this.#attention(snapshot, ready)}
        ${snapshot.permissions.canAuthor ? html`<button aria-label=${this.#controlName(this.#t("reviewPlan", "Review delivery plan"))} type="button" class="button secondary" ?disabled=${!ready || Boolean(this.#busy)} @click=${(event: MouseEvent) => this.#reviewPlan ? this.#closePlan() : this.#openPlan(event.currentTarget as HTMLElement)}>${this.#t("reviewPlan", "Review delivery plan")}</button>` : nothing}
        ${this.#reviewPlan ? this.#planReview(snapshot, ready) : nothing}
        ${this.surface === "deliver" ? repeat(rows, (row) => row.blockId, (row) => this.#card(snapshot, row, ready)) : nothing}
        ${snapshot.confirmedPlan ? html`<div class="output-targets">${repeat(snapshot.confirmedPlan.plan.targets, (target) => target.id, (target) => this.#target(snapshot, target, ready))}</div>` : html`<p>${this.#t("notConfirmed", "Review and confirm requirements to establish the delivery scope. This does not generate files.")}</p>`}
        ${snapshot.permissions.canAuthor && (snapshot.capabilities.ownedFileAdoption || this.#file) ? html`<section class="output-adoption" tabindex="-1" aria-label=${this.#controlName(this.#t("adoptTitle", "Use a file you own"))}><h3>${this.#t("adoptTitle", "Use a file you own")}</h3><p>${this.#t("adoptDetail", "Upload a finished file. Forma inspects the bytes; matching, content review, current rights, and acceptance are separate steps.")}</p><p>${snapshot.capabilities.supportedFileExtensions.join(", ")}</p><form class="output-file-upload" @submit=${this.#upload}><label>${this.#t("file", "File")}<input aria-label=${this.#controlName(this.#t("file", "File"))} type="file" ?required=${!this.#file} accept=${snapshot.capabilities.supportedFileExtensions.map((extension) => extension.startsWith(".") ? extension : `.${extension}`).join(",")} @change=${this.#setFile}></label><label><input aria-label=${this.#controlName(this.#t("ownedRights", "I own or have permission to use this file and its contents."))} type="checkbox" required .checked=${this.#rightsConfirmed} @change=${(event: Event) => { this.#rightsConfirmed = (event.target as HTMLInputElement).checked; this.requestUpdate(); }}>${this.#t("ownedRights", "I own or have permission to use this file and its contents.")}</label><button aria-label=${this.#controlName(this.#t("uploadInspect", "Upload and inspect · no generation"))} type="submit" class="button secondary" ?disabled=${!ready || !snapshot.capabilities.ownedFileAdoption || !outputSourceReadiness(snapshot).allowed || Boolean(this.#busy) || outputUploadNeedsRestage(this.#uploadFailure) || !this.#file || !this.#rightsConfirmed}>${this.#t("uploadInspect", "Upload and inspect · no generation")}</button></form>${this.#file ? html`<p><b>${this.#t("file", "File")}:</b> <span dir="auto">${this.#file.name}</span></p>` : nothing}${this.#uploadFailure ? html`<p role="status">${this.#uploadFailure.kind === "revision" ? this.#t("uploadRevisionConflict", "The saved Document revision changed before this upload. Your selected file is retained; refresh and review the current source before restaging it.") : this.#uploadFailure.kind === "authority" ? this.#t("uploadAuthorityChanged", "The upload’s source or authorization checks changed. Your selected file is retained; recheck current access and source evidence before restaging it.") : this.#t("uploadFileRetained", "Your selected file is retained. Resolve the reported issue before uploading again. Changing the revision alone does not resolve capacity, rights, evidence, or inspection failures.")}</p>${outputUploadNeedsRestage(this.#uploadFailure) ? html`<button aria-label=${this.#controlName(this.#t("recheckUpload", "Refresh checks before restaging this file"))} type="button" class="button secondary" ?disabled=${Boolean(this.#busy) || !snapshot.permissions.canAuthor} @click=${this.#restageUpload}>${this.#t("recheckUpload", "Refresh checks before restaging this file")}</button>` : nothing}` : nothing}<ul>${(snapshot.capabilities.limitationCodes ?? ["output_client_load_failed"]).map((limitation) => html`<li>${this.#message(limitation)}</li>`)}</ul></section>` : nothing}
        ${this.#execution(snapshot, ready)}
        ${snapshot.confirmedPlan ? html`<form class="output-export" aria-label=${this.#controlName(this.#t("downloadPackage", "Download checked deliverables"))} @submit=${this.#export}><h3>${this.#t("downloadPackage", "Download checked deliverables")}</h3>${historyUnverified ? html`<p class="output-package-history-warning" role="status">${this.#message("output_scope_history_reason_unverified")}</p>` : nothing}${!historyUnverified && !snapshot.summary?.delivery_ready ? html`<label><input aria-label=${this.#controlName(this.#t("partialExplicit", "Download a partial package with its missing-work manifest. This does not complete the assignment."))} type="checkbox" .checked=${this.#allowPartial} @change=${(event: Event) => { if (this.#snapshot()?.capabilities.limitationCodes?.includes("output_scope_history_reason_unverified")) return; this.#allowPartial = (event.target as HTMLInputElement).checked; this.requestUpdate(); }}>${this.#t("partialExplicit", "Download a partial package with its missing-work manifest. This does not complete the assignment.")}</label>` : nothing}<button aria-label=${this.#controlName(this.#t("downloadFiles", "Download files and manifest"))} type="submit" class="button primary" ?disabled=${!ready || !packageGate.allowed || !snapshot.permissions.canDownload || Boolean(this.#busy) || !snapshot.summary?.delivery_ready && !this.#allowPartial}>${this.#t("downloadFiles", "Download files and manifest")}</button></form>${this.#packageParts.length > 1 ? html`<ol class="output-package-parts">${this.#packageParts.map((path, index) => html`<li><button aria-label=${this.#controlName(this.#t("downloadPart", "Download part {part} of {total}", { part: index + 1, total: this.#packageParts.length }))} type="button" class="button secondary" ?disabled=${!ready || !packageGate.allowed || !snapshot.permissions.canDownload || !this.#packageRelease || !outputReleaseStillAllowed(this.#packageRelease, snapshot)} @click=${() => this.#download(path, "package")}>${this.#t("downloadPart", "Download part {part} of {total}", { part: index + 1, total: this.#packageParts.length })}</button></li>`)}</ol>` : nothing}` : nothing}
      `}
    </section>`;
  }
}

if (!customElements.get("forma-output-requirements")) customElements.define("forma-output-requirements", FormaOutputRequirements);
declare global { interface HTMLElementTagNameMap { "forma-output-requirements": FormaOutputRequirements } }
