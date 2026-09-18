import { html, nothing } from "lit";
import { navigateInApp, type CommandDeparture } from "./command-departure";
import { briefEligibility, phase6GateMetrics, sessionContinuityDelta, type BriefDestination, type BriefItem } from "../model/brief";
import { FormaElement, icon } from "./forma-element";
import { documentIdFromRoute, isDocumentViewRoute, libraryFocusFromRoute, withDocumentInRoute } from "../model/routes";
import { foldEvents } from "../model/events";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";
import type { ContextBlock } from "./context-block";
import type { CapturedAuthorizationScope, CapturedSourceOwnership } from "../state/store";
import "./icons-history";
import { DOCUMENT_VIEW_LABELS } from "../model/document-view-signals";
import "./area-navigation";

const duration = (milliseconds: number | null) => milliseconds === null ? "pending" : milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;

export class FormaSessions extends FormaElement {
  #intent = "";
  #blankName: string | null = null;
  #intentRevision = 0;
  #blankRevision = 0;
  #blankDraft: { briefId: string; sessionId: string | null; mode: "brief" | "ordinary" | "unconfirmed"; pending: boolean;
    original?: { documentId: string; projectId: string; title: string; revision: number };
    check?: "checking" | "found" | "absent" | "unavailable" } | null = null;
  #interactionOwner: { source: CapturedSourceOwnership | null; authorization: CapturedAuthorizationScope | null;
    route: string; projectId: string; current: () => boolean } | null = null;
  #interactionRouteRevision = 0;
  #interactionChanged = (event?: Event) => {
    if (event?.type === "forma-route-changed") this.#interactionRouteRevision++;
    if (this.#interactionOwner && !this.#interactionOwner.current()) {
      this.#retireDrafts(); this.requestUpdate();
    }
  };

  override connectedCallback() {
    super.connectedCallback();
    for (const name of ["forma-route-changed", "forma-authorization-changed", "forma-event-source-retired"])
      window.addEventListener(name, this.#interactionChanged);
  }

  override disconnectedCallback() {
    for (const name of ["forma-route-changed", "forma-authorization-changed", "forma-event-source-retired"])
      window.removeEventListener(name, this.#interactionChanged);
    this.#retireDrafts(); super.disconnectedCallback();
  }

  #retireDrafts() {
    this.#interactionOwner = null; this.#blankDraft = null; this.#blankName = null; this.#intent = "";
    this.#blankRevision++; this.#intentRevision++;
  }

  #currentInteraction() {
    this.#interactionChanged();
    if (!this.#interactionOwner) {
      const source = this.store.captureSourceOwnership(), authorization = this.store.captureAuthorizationScope();
      const route = this.store.route.get().split("#")[0], projectId = this.store.projection.get().projectId;
      const owner = { source, authorization, route, projectId, current: (): boolean => this.#interactionOwner === owner
        && this.isConnected && this.store.sourceOwnershipActive(source)
        && this.store.authorizationScopeActive(authorization) && this.store.route.get().split("#")[0] === route
        && this.store.projection.get().projectId === projectId };
      this.#interactionOwner = owner;
      if (!owner.current()) { this.#interactionOwner = null; return null; }
    }
    const owner = this.#interactionOwner, route = this.store.route.get(), revision = this.#interactionRouteRevision;
    return { ...owner, route, draftCurrent: owner.current, current: () => owner.current()
      && this.#interactionRouteRevision === revision && this.store.route.get() === route };
  }

  async #recordIntent(event: SubmitEvent) {
    event.preventDefault();
    if (event.currentTarget !== this.querySelector(".intent-card")) return;
    const current = this.#currentInteraction()?.draftCurrent, raw = this.#intent, revision = this.#intentRevision;
    if (!current || !raw.trim() || this.store.busy.get() === "declare-intent") return;
    const acknowledged = await this.store.declareIntent(raw.trim());
    if (acknowledged && current() && this.#intentRevision === revision && this.#intent === raw) {
      this.#intent = ""; this.requestUpdate();
    }
  }

  #destination(item: BriefItem): BriefDestination {
    if (item.destination?.view && item.destination?.ref_id) return item.destination;
    const projection = this.store.projection.get();
    if (item.item_type === "thread") {
      const block = projection.libraryBlocks.find((value) => value.id === item.ref_id || value.handle === item.ref_id);
      return { route: "/", view: "context-block", ref_id: block?.id ?? item.ref_id, document_id: block?.documentId ?? projection.documentId, document_view: "document" };
    }
    if (item.item_type === "collection") {
      const collection = projection.collections.find((value) => value.id === item.ref_id || value.handle === item.ref_id);
      return { route: "/library", view: "collection", ref_id: collection?.id ?? item.ref_id };
    }
    const sourceId = item.rationale_ref.startsWith("event:") ? item.rationale_ref.slice(6) : "";
    const source = this.store.events.get().find((event) => event.eventId === sourceId);
    const objectIds = Array.isArray(source?.payload.object_ids) ? source.payload.object_ids.map(String) : [item.ref_id];
    return { route: "/", view: "comparison", ref_id: objectIds[0] ?? item.ref_id, object_ids: objectIds, document_id: projection.documentId, document_view: "document" };
  }

  #destinationAvailable(destination: BriefDestination) {
    if (destination.view === "collection") return this.store.projection.get().collections.some(value => value.id === destination.ref_id);
    const documentId = destination.document_id;
    if (!documentId) return false;
    const projection = foldEvents(this.store.eventView.get(), this.store.asOf.get(), documentId);
    if (projection.documentId !== documentId || !projection.documents.some(value => value.id === documentId && !value.removed)) return false;
    const routedDocument = documentIdFromRoute(destination.route);
    if (routedDocument && routedDocument !== documentId) return false;
    if (destination.view === "context-block") return projection.blocks.some(value => value.id === destination.ref_id && !value.removed);
    if (destination.view === "comparison") {
      const ids = destination.object_ids ?? [destination.ref_id];
      return ids.length > 0 && ids.every(id => projection.outputs.some(value => value.id === id && !value.discarded));
    }
    if (destination.ref_id !== documentId) return false;
    const linked = libraryFocusFromRoute(destination.route);
    return linked ? linked.kind === "artifact" && projection.libraryArtifacts.some(value => value.id === linked.id && value.documentId === documentId)
      : isDocumentViewRoute(destination.route);
  }

  #destinationFocusTarget(destination: BriefDestination): HTMLElement | null {
    const projection = this.store.projection.get();
    if (destination.document_id && projection.documentId !== destination.document_id) return null;
    const own = (element: FormaElement) => element.isConnected && FormaElement.hasStoreIdentity(element, this.store);
    if (destination.view === "context-block") {
      if (this.store.ui.focusBlockId !== destination.ref_id) return null;
      const owners = [...this.ownerDocument.querySelectorAll<ContextBlock>("forma-context-block")].filter(element => own(element)
        && element.surface === "document" && element.block.id === destination.ref_id
        && element.block.documentId === projection.documentId && !element.block.removed);
      if (owners.length !== 1) return null;
      const targets = [...owners[0].querySelectorAll<HTMLElement>("[data-block-id]")].filter(element => element.isConnected
        && element.tagName === "ARTICLE" && element.getAttribute("data-block-id") === destination.ref_id
        && element.closest("forma-context-block") === owners[0]);
      return targets.length === 1 ? targets[0] : null;
    }
    if (destination.view === "collection") {
      if (this.store.ui.focusCollectionId !== destination.ref_id || !projection.collections.some(value => value.id === destination.ref_id)) return null;
      const rows = [...this.ownerDocument.querySelectorAll<FormaElement>("forma-collection-tree")].filter(own)
        .flatMap(owner => [...owner.querySelectorAll<HTMLElement>("[data-collection-id]")].filter(element => element.isConnected
          && element.tagName === "LI" && element.getAttribute("data-collection-id") === destination.ref_id
          && element.closest("forma-collection-tree") === owner));
      if (rows.length !== 1) return null;
      const row = rows[0], owner = row.closest("forma-collection-tree");
      const targets = [...row.querySelectorAll<HTMLButtonElement>("button.tree-name")].filter(element => element.isConnected
        && element.tagName === "BUTTON" && !element.matches(":disabled")
        && element.closest("[data-collection-id]") === row && element.closest("forma-collection-tree") === owner);
      return targets.length === 1 ? targets[0] : null;
    }
    if (destination.view !== "comparison" || !this.store.ui.compareOpen
      || this.store.ui.comparisonOutputIds !== (destination.object_ids ?? [destination.ref_id]).join("|")) return null;
    const owners = [...this.ownerDocument.querySelectorAll<FormaElement>("forma-workspace")].filter(own);
    if (owners.length !== 1) return null;
    const targets = [...owners[0].querySelectorAll<HTMLDialogElement>(".comparison-modal")].filter(element => element.isConnected
      && element.open && element.closest("forma-workspace") === owners[0]);
    return targets.length === 1 ? targets[0] : null;
  }

  #openDestination(destination: BriefDestination, current: () => boolean, scopeCurrent: () => boolean, focus: OutputNavigationFocusLease) {
    if (!current()) return false;
    if (destination.view === "comparison") this.store.patchUi({ selectedOutputId: destination.ref_id, comparisonOutputIds: (destination.object_ids ?? [destination.ref_id]).join("|"), compareOpen: true, focusBlockId: "", focusCollectionId: "" });
    else if (destination.view === "collection") this.store.patchUi({ focusCollectionId: destination.ref_id, focusBlockId: "", compareOpen: false });
    else if (destination.view === "document") this.store.patchUi({ focusBlockId: "", focusCollectionId: "", compareOpen: false });
    else this.store.patchUi({ focusBlockId: destination.ref_id, focusCollectionId: "", compareOpen: false });
    if (!current()) return false;
    // A document destination may be an exact Library artifact route. Its existing
    // destination owner retains presentation; do not lend it a short-lived lease.
    this.store.setRoute(destination.route, destination.view === "document" ? { current } : { current, focus });
    if (destination.view === "document") return false;
    const route = this.store.route.get(), navigation = this.store.captureWorkspaceNavigationFocus(route, focus);
    if (!navigation || !scopeCurrent()) return false;
    // This Store identity survives our intended unmount, but not route A→B→A.
    window.setTimeout(() => {
      try {
        if (!scopeCurrent() || !navigation.current()) return;
        const target = this.#destinationFocusTarget(destination);
        if (!target) return;
        const destinationCurrent = () => scopeCurrent() && navigation.current() && this.#destinationFocusTarget(destination) === target;
        focus.run(target, () => {
          if (!destinationCurrent()) return false;
          target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
          if (!destinationCurrent()) return false;
          target.focus({ preventScroll: true });
          return destinationCurrent();
        });
      } finally { focus.dispose(); }
    }, 0);
    return true;
  }

  async #respond(type: "BriefItemAccepted" | "BriefItemIgnored", item: BriefItem, briefId: string) {
    const interaction = this.#currentInteraction();
    if (!interaction) return;
    const destination = this.#destination(item), shell = this.closest<FormaElement>("forma-shell");
    const scopeCurrent = () => this.store.sourceOwnershipActive(interaction.source)
      && this.store.authorizationScopeActive(interaction.authorization)
      && (type === "BriefItemIgnored" || this.#destinationAvailable(destination));
    const focus: OutputNavigationFocusLease = captureOutputNavigationFocus(this.ownerDocument, { ownedRouteFocus: element => {
      if (!scopeCurrent() || !this.store.captureWorkspaceNavigationFocus(this.store.route.get(), focus)) return false;
      if (shell?.isConnected && FormaElement.hasStoreIdentity(shell, this.store) && element === shell.querySelector("#main-content")) return true;
      const target = this.#destinationFocusTarget(destination);
      return element === target || Boolean(destination.view === "comparison" && target?.contains(element));
    } });
    const current = () => interaction.current() && scopeCurrent() && focus.current();
    let queued = false;
    try {
      if (!current()) return;
      const appended = await this.store.append({ type, payload: { brief_id: briefId, item_id: item.item_id, rank: item.rank, brief_size: this.#items().length, destination } });
      if (type === "BriefItemAccepted" && appended.some(event => event.type === type
        && event.payload.brief_id === briefId && event.payload.item_id === item.item_id) && current())
        queued = this.#openDestination(destination, current, scopeCurrent, focus);
    } finally { if (!queued) focus.dispose(); }
  }

  #prepareBlank(event: Event) {
    if (event.currentTarget !== this.querySelector(".blank-choice")) return;
    const current = this.#currentInteraction()?.current, briefId = String(this.#brief()?.brief_id ?? "");
    if (!current || !briefId || !this.#items().length || this.#blankDraft) return;
    const draft = { briefId, sessionId: this.store.projection.get().currentSessionId, mode: "brief" as const, pending: false };
    const focus = captureOutputNavigationFocus(this.ownerDocument);
    this.#blankDraft = draft; this.#blankName = "Untitled study"; const revision = ++this.#blankRevision; this.requestUpdate();
    void this.updateComplete.then(() => {
      const selectionCurrent = () => current() && focus.current() && this.#blankDraft === draft
        && this.#blankRevision === revision && this.#blankName !== null;
      if (!selectionCurrent()) return;
      const input = this.querySelector<HTMLInputElement>(".blank-document-form input");
      if (!input) return;
      const inputCurrent = () => selectionCurrent() && input.isConnected
        && this.querySelector<HTMLInputElement>(".blank-document-form input") === input;
      focus.run(input, () => {
        if (!inputCurrent()) return false;
        input.focus();
        if (!inputCurrent() || this.ownerDocument.activeElement !== input) return false;
        input.select();
        if (!inputCurrent() || this.ownerDocument.activeElement !== input) return false;
        input.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        return inputCurrent() && this.ownerDocument.activeElement === input;
      });
    }).finally(() => focus.dispose());
  }

  #discardBlank(event: Event) {
    if (event.currentTarget !== this.querySelector(".blank-document-discard") || !this.#currentInteraction()) return;
    this.#blankName = null; this.#blankRevision++;
    if (this.#blankDraft && !this.#blankDraft.pending && this.#blankDraft.mode !== "unconfirmed") this.#blankDraft = null;
    this.requestUpdate();
  }

  async #startBlank(event: SubmitEvent) {
    event.preventDefault();
    if (event.currentTarget !== this.querySelector(".blank-document-form")) return;
    const interaction = this.#currentInteraction(), current = interaction?.draftCurrent, navigationCurrent = interaction?.current;
    const draft = this.#blankDraft, raw = this.#blankName;
    const title = raw?.trim(), revision = this.#blankRevision, projection = this.store.projection.get();
    if (!current || !navigationCurrent || !draft || draft.pending || draft.mode === "unconfirmed" || !title || !projection.projectId) return;
    if (draft.mode === "brief" && (this.#brief()?.brief_id !== draft.briefId
      || projection.currentSessionId !== draft.sessionId || !this.#items().length)) return;
    const documentId = crypto.randomUUID(), document = { type: "DocumentCreated", payload: {
      document_id: documentId, handle: `document-${documentId.slice(0, 8)}`, title,
      ...(draft.mode === "brief" ? { entry_surface: "blank-canvas" } : { project_id: projection.projectId }),
    } };
    const events = draft.mode === "brief" ? [
      { type: "EmptyCanvasChosen", payload: { session_id: draft.sessionId, brief_id: draft.briefId, new_document_id: documentId } }, document,
    ] : [document, { type: "EmptyCanvasChosen", payload: {
      project_id: projection.projectId, document_id: documentId, source_surface: "sessions",
    } }];
    const focus = captureOutputNavigationFocus(this.ownerDocument);
    draft.original = { documentId, projectId: projection.projectId, title, revision }; draft.check = undefined;
    draft.pending = true; this.requestUpdate();
    try {
      const result = await this.store.appendBatchWithReceipt(events);
      if (!current() || this.#blankDraft !== draft) return;
      const complete = result.publication === "published" && result.acknowledgment.outcome === "observed"
        && !result.acknowledgment.rejectedIndices.length && result.appended.length === events.length
        && result.appended.some(value => value.type === "DocumentCreated" && value.payload.document_id === documentId);
      if (!complete) { draft.mode = "unconfirmed"; return; }
      draft.mode = "ordinary";
      if (this.#blankName === null) { this.#blankDraft = null; return; }
      if (this.#blankRevision !== revision || this.#blankName !== raw) return;
      this.#blankName = null; this.#blankDraft = null;
      if (!focus.current() || !navigationCurrent() || this.captureCommandDeparture().blocked()) {
        this.store.toast(this.i18n.system("{title} created as a blank document.", { title }));
        return;
      }
      if (!this.store.projection.get().documents.some(value => value.id === documentId
        && value.projectId === projection.projectId && !value.removed)) {
        this.store.toast(this.i18n.system("{title} created as a blank document.", { title })
          + " " + this.i18n.system("That document is no longer available."));
        return;
      }
      this.store.patchUi({ focusBlockId: "", focusCollectionId: "", compareOpen: false });
      this.store.setRoute(withDocumentInRoute("/", documentId, title), { current: navigationCurrent, focus });
    } catch {
      if (current() && this.#blankDraft === draft) draft.mode = "unconfirmed";
    } finally {
      focus.dispose();
      if (this.#blankDraft === draft) { draft.pending = false; this.requestUpdate(); }
    }
  }

  #originalBlankDocument() {
    const draft = this.#blankDraft, original = draft?.original;
    if (draft?.mode !== "unconfirmed" || !original || !this.#interactionOwner?.current()) return null;
    // A full read can find this Document without acknowledging the original
    // batch. Use committed history, never optimistic rows or a folded fallback.
    return foldEvents(this.store.events.get(), Number.POSITIVE_INFINITY, original.documentId, original.projectId)
      .documents.find(value => value.id === original.documentId && value.projectId === original.projectId && !value.removed) ?? null;
  }

  #originalBlankOpenBlocked() {
    return Boolean(this.#intent || this.#blankName !== null && this.#blankRevision !== this.#blankDraft?.original?.revision);
  }

  captureCommandDeparture():CommandDeparture {
    const interaction=this.#interactionOwner,routeRevision=this.#interactionRouteRevision;
    const intentRevision=this.#intentRevision,blankRevision=this.#blankRevision;
    return {element:this,current:()=>this.isConnected&&this.#interactionOwner===interaction
      &&this.#interactionRouteRevision===routeRevision&&this.#intentRevision===intentRevision&&this.#blankRevision===blankRevision,
      // Read the original owner; never turn absent/failed Check or retained
      // uncertainty into acknowledgment, cancellation or permission to resend.
      blocked:()=>Boolean(this.#intent||this.store.busy.get()==="declare-intent"||this.#blankDraft?.pending
        ||this.#blankDraft?.check==="checking"||(this.#blankDraft?.original?this.#originalBlankOpenBlocked():this.#blankName)),
      reason:()=>"next.lifecycle.currentWorkOpen"};
  }

  async #checkOriginalBlank(event: Event) {
    if (event.currentTarget !== this.querySelector(".blank-original-check")) return;
    const interaction = this.#currentInteraction(), draft = this.#blankDraft;
    if (!interaction || draft?.mode !== "unconfirmed" || !draft.original || draft.pending || draft.check === "checking") return;
    const original = draft.original;
    const current = () => interaction.current() && this.#blankDraft === draft && draft.original === original;
    draft.check = "checking"; this.requestUpdate();
    try {
      await this.store.refreshEvents({ fromStart: true });
      if (current()) draft.check = this.#originalBlankDocument() ? "found" : "absent";
    } catch {
      if (current()) draft.check = "unavailable";
    } finally {
      // Reads are serialized on this existing draft. A stale gesture can clear
      // its busy presentation, never publish availability into another owner.
      if (this.#blankDraft === draft) {
        if (draft.check === "checking") draft.check = undefined;
        this.requestUpdate();
      }
    }
  }

  #openOriginalBlank(event: Event) {
    if (event.currentTarget !== this.querySelector(".blank-original-open")) return;
    const interaction = this.#currentInteraction(), draft = this.#blankDraft, document = this.#originalBlankDocument();
    if (!interaction || !draft || draft.check !== "found" || !document || this.#originalBlankOpenBlocked()) return;
    const current = () => interaction.current() && this.#blankDraft === draft && draft.check === "found"
      && this.#originalBlankDocument()?.id === document.id && !this.#originalBlankOpenBlocked();
    // Availability is not a batch ACK. Shared admission protects sibling work;
    // the same-app commit keeps this exact predicate and creates no DocumentOpened.
    return navigateInApp(this, navigation => this.store.transitionWorkspace(
      withDocumentInRoute("/", document.id, document.title), {
        current: () => current() && navigation.current(), focus: navigation.focus,
        onOriginHandoff: navigation.onOriginHandoff,
      }));
  }

  #blankForm() {
    const draft = this.#blankDraft, name = this.#blankName;
    const original = draft?.mode === "unconfirmed" ? draft.original : null;
    const document = original ? this.#originalBlankDocument() : null;
    const available = Boolean(original && draft?.check === "found" && document);
    const blocked = available && this.#originalBlankOpenBlocked();
    const statusKey = draft?.check === "checking" ? "sessions.blank.checkingOriginal"
      : draft?.check === "found" ? available ? blocked ? "sessions.blank.openBlocked" : "sessions.blank.originalAvailable" : "sessions.blank.originalAbsent"
      : draft?.check === "absent" ? "sessions.blank.originalAbsent"
      : draft?.check === "unavailable" ? "sessions.blank.checkUnavailable" : "sessions.blank.unconfirmed";
    const notice = draft?.pending ? "" : draft?.mode === "ordinary" ? this.i18n.t("sessions.blank.originalCreated", "The original document was created. This name has not been used to create another document.")
      : draft?.mode === "unconfirmed" ? this.i18n.t(statusKey) : "";
    const title = "\u2068" + (document?.title ?? original?.title ?? "") + "\u2069";
    const originalActions = original ? html`
      ${available ? html`<button type="button" class="button primary blank-original-open" ?disabled=${blocked} @click=${this.#openOriginalBlank}>
        ${this.i18n.t("sessions.blank.openOriginal", "Open original: {title}", { title })}</button>` : nothing}
      <button type="button" class=${"button blank-original-check " + (available ? "secondary" : "primary")}
        ?disabled=${draft?.check === "checking"} aria-busy=${String(draft?.check === "checking")} @click=${this.#checkOriginalBlank}>
        ${this.i18n.t("sessions.blank.checkOriginal", "Check original: {title}", { title })}</button>` : nothing;
    if (name === null && !original) return notice ? html`<p role="status">${notice}</p>` : nothing;
    return html`<form class="blank-document-form" aria-busy=${String(Boolean(draft?.pending) || draft?.check === "checking")} @submit=${this.#startBlank}>
      ${name !== null ? html`<label for="blank-document-name"><span class="eyebrow">${this.i18n.system("Blank document")}</span><b>${this.i18n.system("Give your new document a name")}</b></label>
      <input id="blank-document-name" maxlength="80" .value=${name} @input=${(event: InputEvent) => {
        if (event.currentTarget !== this.querySelector("#blank-document-name") || !this.#currentInteraction()) return;
        this.#blankName = (event.target as HTMLInputElement).value; this.#blankRevision++; this.requestUpdate();
      }}>` : nothing}
      <div>${name !== null ? html`<button type="button" class="button ghost blank-document-discard" @click=${this.#discardBlank}>${draft && (draft.pending || draft.mode !== "brief") ? this.i18n.t("sessions.blank.discard", "Discard name") : this.i18n.system("Cancel")}</button>` : nothing}
        ${draft?.mode === "unconfirmed" ? originalActions : html`<button type="submit" class="button primary" ?disabled=${!name?.trim() || !draft || draft.pending}>
          ${draft?.pending ? this.i18n.t("sessions.blank.creating", "Creating the original document…") : draft?.mode === "ordinary"
            ? this.i18n.t("sessions.blank.createAnother", "Create another blank document") : this.i18n.system("Create blank document")}</button>`}</div>
      ${notice ? html`<p role="status">${notice}${original ? " " + this.i18n.t("next.sessions.recoveryLifetime", "Leaving this Sessions page removes the local Check and Open controls; it does not cancel the creation or confirm its result.") : ""}</p>` : nothing}
    </form>`;
  }

  #brief() {
    const brief = this.store.projection.get().brief;
    return brief && brief.input_receipt && brief.composition ? brief : null;
  }

  #items() { const items = this.#brief()?.items; return Array.isArray(items) ? items as BriefItem[] : []; }

  async #reviewPhase6(decision: "advance" | "continue" | "stop") {
    const events = this.store.events.get(); const metrics = phase6GateMetrics(events);
    if (!metrics.evidenceReady) return;
    await this.store.append({ type: "PhaseGateReviewed", payload: {
      phase: 6,
      decision,
      review_mode: decision === "advance" ? "advance-with-monitoring" : decision,
      continue_evidence_collection: decision === "advance" || decision === "continue",
      evidence_sequence: this.store.head.get(),
      evidence_snapshot: {
        impressions: metrics.impressions,
        acceptances: metrics.acceptances,
        acceptance_rate: metrics.acceptanceRate,
        cost_per_acceptance_usd: metrics.costPerAcceptance,
        blank_choices: metrics.blankChoices,
        dosage_curve: metrics.dosageCurve,
        document_view_coverage: metrics.viewCoverage,
        document_view_breakdown: metrics.viewBreakdown,
        top_accepted_document_view: metrics.topAcceptedView,
      },
    } });
  }

  override render() {
    this.#interactionChanged();
    const p = this.store.projection.get(); const events = this.store.events.get(); const eligibility = briefEligibility(events); const metrics = phase6GateMetrics(events); const delta = sessionContinuityDelta(events); const brief = this.#brief(); const items = this.#items(); const briefId = String(brief?.brief_id ?? ""); const busy = this.store.busy.get();
    const phase6Review = events.findLast((event) => event.type === "PhaseGateReviewed" && Number(event.payload.phase) === 6); const phase6Decision = String(phase6Review?.payload.decision ?? ""); const terminalPhase6Decision = phase6Decision === "advance" || phase6Decision === "stop";
    return html`<section class="sessions-page page-pad"><forma-area-navigation area="intelligence" active="sessions"></forma-area-navigation><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">Creative intelligence / Re-entry</span><h1>Sessions & re-entry</h1><p>Return to the ideas, comparisons, and decisions that matter most without reconstructing where you left off.</p></div><div class="page-header-actions"><span class="session-state ${p.sessionOpen?"open":"closed"}">${p.sessionOpen?this.i18n.system("Session open"):this.i18n.system("Session closed")}</span>${p.sessionOpen?html`<button class="button secondary" ?disabled=${busy==="close-session"} @click=${()=>this.store.closeSession()}>${busy==="close-session"?this.i18n.system("Saving your place…"):this.i18n.system("Finish this session")}</button>`:html`<button class="button primary" ?disabled=${busy==="open-session"} @click=${()=>this.store.openSession()}>${busy==="open-session"?this.i18n.system("Opening…"):this.i18n.system("Start a new session")}</button>`}</div></header>
      <div class="session-grid"><main><section class="brief-card"><header><div><span class="eyebrow">Ready to resume · ${items.length} idea${items.length===1?"":"s"}</span><h2>${items.length?this.i18n.system("Pick up where you left off"):this.i18n.system("Find the right place to restart")}</h2></div><span class="health-pill ${items.length?"":"waiting"}"><i></i> ${items.length?this.i18n.system("ready to resume"):eligibility.eligible?this.i18n.system("ready to prepare"):this.i18n.system("gathering context")}</span></header><p class="brief-lead">Forma revisits actual decisions, unfinished comparisons, and nearby work. You decide what to reopen; nothing is changed automatically.</p>
        ${items.length?html`<div class="brief-blocks">${items.map((item,index)=>{const destination=this.#destination(item);const label=item.item_type==="intent"?item.title.startsWith("Review your ready")?"Review result":"Continue work":item.item_type==="comparison"?"Open comparison":item.item_type==="collection"?"Open collection":"Open thread";const documentView=destination.document_view?DOCUMENT_VIEW_LABELS[destination.document_view]:null;return html`<article class="brief-block" tabindex="0"><div class="brief-index">${String(index+1).padStart(2,"0")}</div><div><span class="block-type">${item.item_type==="intent"?this.i18n.system("Your unfinished work"):this.i18n.system("{item_type} · suggested", { item_type: this.i18n.system(item.item_type) })}</span><h3>${item.title}</h3><p>${item.summary}</p>${documentView?html`<span class="brief-view-path">Resume in ${documentView}</span>`:nothing}<small>${item.item_type==="intent"?this.i18n.system("Based on"):this.i18n.system("Suggested from")} ${item.source_event_refs.length} recent creative action${item.source_event_refs.length===1?"":"s"}</small></div><div class="brief-actions"><button class="button primary" data-destination-view=${destination.view} data-target-ref=${destination.ref_id} title=${this.i18n.system("Resume {title}", { title: item.title })} @click=${()=>navigateInApp(this,()=>this.#respond("BriefItemAccepted",item,briefId))}>${this.i18n.system(label)}</button><button class="button ghost" @click=${()=>this.#respond("BriefItemIgnored",item,briefId)}>Not now</button></div></article>`;})}</div><footer><button class="button ghost" @click=${()=>this.store.append({type:"BriefDismissed",payload:{brief_id:briefId,brief_size:items.length}})}>Dismiss suggestions</button>${this.#blankName===null&&!this.#blankDraft?html`<button class="blank-choice" @click=${this.#prepareBlank}>Start with a blank document ${icon("arrow")}</button>`:nothing}</footer>`:html`<div class="brief-empty"><span>${icon(eligibility.eligible?"spark":"clock")}</span><div><h3>${eligibility.eligible?this.i18n.system("Your recent work is ready to revisit"):this.i18n.system("A little more history will help")}</h3><p>${eligibility.eligible?this.i18n.system("Review a small set of promising places to continue without changing your document."):this.i18n.system("Keep creating until Forma has enough completed sessions and unfinished work to make useful suggestions.")}</p></div><button class="button primary" ?disabled=${!eligibility.eligible||!p.sessionOpen||busy==="compose-brief"} @click=${()=>this.store.composeBrief()}>${busy==="compose-brief"?this.i18n.system("Finding your place…"):this.i18n.system("Find where to continue")}</button></div>`}
        ${this.#blankForm()}
        <div class="continuity-receipt"><span>${icon("replay")}</span><div><b>Since your last session</b><small>${delta.eventCount} meaningful creative action${delta.eventCount===1?"":"s"} ${delta.eventCount===1?this.i18n.system("has"):this.i18n.system("have")} been saved${delta.snapshotHead?" " + this.i18n.system("since you last stopped"):""}.</small>${delta.lastDocumentView?html`<small>You last worked in ${DOCUMENT_VIEW_LABELS[delta.lastDocumentView]}${delta.viewTransitions?(delta.viewTransitions===1 ? " " + this.i18n.system("and switched working modes once") : " " + this.i18n.system("and switched working modes {viewTransitions} times", { viewTransitions: this.i18n.number(delta.viewTransitions) })):""}.</small>`:nothing}${delta.eventTypes.length?html`<details class="creative-diagnostics"><summary>See the kinds of work included</summary><p>${delta.eventTypes.slice(0,8).map((type)=>type.replace(/([a-z])([A-Z])/g,"$1 $2").toLocaleLowerCase()).join(" · ")}${delta.eventTypes.length>8?" " + this.i18n.system("· {count} more", { count: this.i18n.number(delta.eventTypes.length-8) }):""}</p></details>`:nothing}</div></div>
        ${metrics.viewBreakdown.length?html`<div class="reentry-view-evidence"><span class="eyebrow">Working-mode acceptance</span>${metrics.viewBreakdown.map((row)=>html`<div><b>${row.label}</b><span>${row.impressions} impression${row.impressions===1?"":"s"}</span><em>${Math.round(row.acceptanceRate*100)}% accepted</em></div>`)}</div>`:nothing}
      </section>
        <section class="time-section"><div class="section-heading"><div><span class="eyebrow">Return at the right moment</span><h2>Reminders & resurfacing</h2></div><button class="button secondary compact" @click=${()=>void navigateInApp(this,navigation=>navigation.route("/memory"))}>Manage reminders</button></div><div class="condition-row"><div><span>${icon("clock")}</span><div><b>${p.conditions.filter((condition)=>!condition.fired).length} active reminder${p.conditions.filter((condition)=>!condition.fired).length===1?"":"s"}</b><small>Relevant work reappears when the timing or creative activity you chose is reached.</small></div></div><button @click=${()=>this.store.checkConditions()}>Check now</button></div></section>
      </main><aside><details class="creative-diagnostics creative-diagnostics--panel"><summary>Review suggestion quality and safeguards</summary><section class="gate-card"><span class="gate-label">Phase 6 gate · ${terminalPhase6Decision?phase6Decision:metrics.evidenceReady?this.i18n.system("human review"):this.i18n.system("collecting")}</span><h2>Are these suggestions helping?</h2><div class="gate-metrics"><div><b>${Math.round(metrics.acceptanceRate*100)}%</b><span>accepted / shown</span></div><div><b>${metrics.costPerAcceptance===null?"—":metrics.costPerAcceptance===0?"$0":`$${metrics.costPerAcceptance.toFixed(3)}`}</b><span>cost / accepted</span></div><div><b>${metrics.impressions}/${metrics.requiredImpressions}</b><span>reviewed suggestions</span></div></div><p>Additional automated suggestions stay unavailable until there is enough evidence that re-entry is useful, understandable, and appropriately bounded.</p><div class="threshold ${eligibility.eligible?"ready":""}"><span>${icon(eligibility.eligible?"check":"lock")}</span><div><b>${eligibility.closedSessions}/${eligibility.requiredClosedSessions} previous sessions · ${eligibility.unresolvedThreads+eligibility.dormantProjects} unfinished creative thread${eligibility.unresolvedThreads+eligibility.dormantProjects===1?"":"s"}</b><small>${eligibility.eligible?this.i18n.system("Enough context is available."):eligibility.reasons.join(" · ")}</small></div></div><dl class="gate-details"><div><dt>Blank document choices</dt><dd>${metrics.blankChoices}</dd></div><div><dt>Average time to accept a suggestion</dt><dd>${duration(metrics.averageTimeToFirstAcceptMs)}</dd></div><div><dt>Suggestion cost</dt><dd>${metrics.totalCost===0?"$0":`$${metrics.totalCost.toFixed(3)}`}</dd></div></dl>${metrics.dosageCurve.length?html`<div class="dosage-curve"><span class="eyebrow">Dosage curve</span>${metrics.dosageCurve.map(point=>html`<div><b>${point.size} item${point.size===1?"":"s"}</b><span>${point.impressions} impressions</span><em>${Math.round(point.acceptanceRate*100)}% accepted</em></div>`)}</div>`:nothing}
        ${metrics.evidenceReady ? terminalPhase6Decision ? html`<div class="gate-review recorded"><b>Decision recorded: ${phase6Decision === "advance" ? this.i18n.system("advance Phases 8 & 9 with monitoring") : this.i18n.system("stop downstream work")}</b><small>${phase6Decision === "advance" ? this.i18n.system("Brief impressions, acceptance, cost, and dosage evidence keep accruing after the gate.") : this.i18n.system("Downstream work remains stopped.")} Receipt sequence ${String(phase6Review?.payload.evidence_sequence ?? "—")} is available in Event admin.</small>${phase6Decision === "advance" ? html`<div><button class="button gate-advance compact" @click=${()=>void navigateInApp(this,navigation=>navigation.route("/scout"))}>Open Scout</button><button class="button gate-continue compact" @click=${()=>void navigateInApp(this,navigation=>navigation.route("/memory"))}>Open Memory</button></div>` : nothing}</div>` : html`<div class="gate-review"><b>${phase6Decision === "continue" ? this.i18n.system("More evidence was requested") : this.i18n.system("The evidence floor is complete")}</b><small>Review all three views together. This is a human go/no-go decision, not an automatic score threshold.</small><div><button class="button gate-advance compact" @click=${()=>this.#reviewPhase6("advance")}>Advance + monitor</button><button class="button gate-continue compact" @click=${()=>this.#reviewPhase6("continue")}>Collect more</button><button class="button gate-stop compact" @click=${()=>this.#reviewPhase6("stop")}>Stop downstream</button></div></div>` : nothing}
      </section></details>
        <form class="intent-card" @submit=${this.#recordIntent}><span class="eyebrow">Optional, never gating</span><h3>Declare an intent</h3><label class="sr-only" for="session-intent-statement">${this.i18n.system("Declare an intent")}</label><textarea id="session-intent-statement" maxlength="500" placeholder="What are you trying to move toward?" .value=${this.#intent} @input=${(event:InputEvent)=>{if(event.currentTarget!==this.querySelector("#session-intent-statement")||!this.#currentInteraction())return;this.#intent=(event.target as HTMLTextAreaElement).value;this.#intentRevision++;this.requestUpdate();}}></textarea><button type="submit" class="button secondary" ?disabled=${!this.#intent.trim()||busy==="declare-intent"}>${busy==="declare-intent"?this.i18n.system("Recording privately…"):this.i18n.system("Record intent")}</button><small>Statement content expires under the 30-day policy; the event retains only its reference.</small></form>
        <section class="scout-gate"><div><span>${icon("spark")}</span><b>Discover a useful next move</b></div><p>${phase6Decision === "advance" ? this.i18n.system("Scout can review your progress and suggest directions without changing your work.") : this.i18n.system("Scout becomes available after a reviewer confirms that suggestions are useful and safe.")}</p><button ?disabled=${phase6Decision!=="advance"} title=${phase6Decision==="advance"?this.i18n.system("Explore creative suggestions"):this.i18n.system("Suggestions are awaiting approval")} @click=${()=>void navigateInApp(this,navigation=>navigation.route("/scout"))}>${phase6Decision==="advance"?this.i18n.system("Explore suggestions"):this.i18n.system("Awaiting approval")}</button></section></aside></div>
    </section>`;
  }
}
if (!customElements.get("forma-sessions")) customElements.define("forma-sessions", FormaSessions);
