import { html, nothing } from "lit";
import type { DocumentJob } from "../model/document-jobs";
import type { CapturedSourceOwnership } from "../state/store";
import { parseDocumentArtifactContent, type DocumentArtifactDraftItem } from "../model/document-artifacts";
import type { PresentationCandidateValidationIssue, PresentationCandidateDetail, PresentationCandidateSummary } from "../model/presentation-candidates";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import "./presentation-slide";

type CandidateComparison = "alternatives" | "requested" | "source" | "accepted";

/** Actor-private rejected drafts never enter shared projections, accepted artifacts, or presentation export viewers. */
export class PresentationRejectedDrafts extends FormaElement {
  static properties = { documentId: { type: String, attribute: "document-id" }, jobs: { attribute: false } };

  documentId = "";
  jobs: DocumentJob[] = [];
  #jobId = "";
  #open = false;
  #busy = false;
  #preserving = "";
  #candidates: PresentationCandidateSummary[] = [];
  #details = new Map<string, PresentationCandidateDetail>();
  #selected: string[] = [];
  #comparison: CandidateComparison = "alternatives";
  #preservedJobs: Array<{ jobId: string; documentId: string }> = [];
  #discoveredFor = "";
  #privateRevision=0;
  #referenceRevision=0;
  #jobDocumentId="";
  #referenceSource:CapturedSourceOwnership|null=null;
  #editingResponse="";
  #editValues=new Map<string,string>();
  #editIssues:PresentationCandidateValidationIssue[]=[];
  #revisionKey="";
  #revisionBusy=false;

  #rememberJob(jobId:string,documentId:string,source:CapturedSourceOwnership|null){
    if(!jobId||!documentId||!source||!this.store.sourceOwnershipScopeActive(source))return;
    if(this.#referenceSource&&!this.store.sourceOwnershipScopeActive(this.#referenceSource))this.#clearAuthorizedDrafts();
    this.#referenceSource=source;
    if(!this.#preservedJobs.some(job=>job.jobId===jobId&&job.documentId===documentId))this.#preservedJobs=[...this.#preservedJobs,{jobId,documentId}];
  }
  readonly #retirePrivateDrafts=(event:Event)=>{
    const source=(event as CustomEvent<{source?:CapturedSourceOwnership}>).detail?.source;
    if(!source||!this.store.sourceOwnershipScopeActive(source))return;
    this.#clearPrivateDrafts();
  };


  readonly #clearPrivateDrafts = () => {
    this.#rememberJob(this.#jobId,this.#jobDocumentId,this.#referenceSource);
    this.#privateRevision++;
    this.#jobId = "";this.#jobDocumentId="";
    this.#open = false;
    this.#busy = false;
    this.#preserving = "";
    this.#editingResponse="";this.#editValues.clear();this.#editIssues=[];this.#revisionKey="";this.#revisionBusy=false;
    this.#candidates = [];
    this.#details.clear();
    this.#selected = [];
    this.#comparison = "alternatives";
    this.querySelector<HTMLDialogElement>(".presentation-rejected-drafts-dialog")?.close();
    this.requestUpdate();
  };

  readonly #clearAuthorizedDrafts = () => {
    this.#referenceRevision++;this.#referenceSource=null;
    this.#preservedJobs = [];
    this.#discoveredFor = "";
    this.#clearPrivateDrafts();
  };

  override connectedCallback() {
    super.connectedCallback();
    if(this.#referenceSource&&!this.store.sourceOwnershipScopeActive(this.#referenceSource))this.#clearAuthorizedDrafts();
    window.addEventListener("forma-authorization-changed", this.#clearAuthorizedDrafts);
    window.addEventListener("forma-event-source-retired",this.#retirePrivateDrafts);
  }

  override disconnectedCallback() {
    window.removeEventListener("forma-authorization-changed", this.#clearAuthorizedDrafts);
    window.removeEventListener("forma-event-source-retired",this.#retirePrivateDrafts);
    this.#clearPrivateDrafts();
    super.disconnectedCallback();
  }

  protected override updated() {
    if(this.#referenceSource&&!this.store.sourceOwnershipScopeActive(this.#referenceSource))this.#clearAuthorizedDrafts();
    const dialog = this.querySelector<HTMLDialogElement>(".presentation-rejected-drafts-dialog");
    if (this.#open && dialog && !dialog.open) ensureModalDialog(dialog);
    if (this.documentId && this.#discoveredFor !== this.documentId && this.store.sourceOwnershipActive(this.store.captureSourceOwnership())) {
      if (this.#discoveredFor) {
        this.#clearPrivateDrafts();
      }
      this.#discoveredFor = this.documentId;
      void this.#discoverPreservedDrafts(this.documentId);
    }
  }

  async #discoverPreservedDrafts(documentId:string){
    const source=this.store.captureSourceOwnership(),revision=this.#referenceRevision;
    const current=()=>this.isConnected&&this.store.sourceOwnershipActive(source)&&revision===this.#referenceRevision&&this.documentId===documentId;
    if(!current())return;
    try{const listing=await this.store.loadPreservedPresentationCandidateJobs(documentId);
      if(!current())return;
      for(const {jobId} of listing.jobs)this.#rememberJob(jobId,documentId,source);
      this.requestUpdate();
    }catch{if(current())this.requestUpdate();}
  }

  async #openDrafts(jobId: string) {
    const source=this.store.captureSourceOwnership(),documentId=this.documentId;
    if(!this.isConnected||!this.store.sourceOwnershipActive(source))return;
    const known=this.jobs.some(job=>job.jobId===jobId&&job.documentId===documentId)||this.#preservedJobs.some(job=>job.jobId===jobId&&job.documentId===documentId);
    if(!known)return;
    const revision=++this.#privateRevision;
    const current=()=>this.isConnected&&this.store.sourceOwnershipActive(source)&&revision===this.#privateRevision&&this.#jobId===jobId&&this.documentId===documentId;
    this.#referenceSource=source;this.#jobDocumentId=documentId;
    this.#jobId = jobId;
    this.#open = true;
    this.#busy = true;
    this.#candidates = [];
    this.#details.clear();
    this.#selected = [];
    this.requestUpdate();
    try {
      const listing = await this.store.loadPresentationCandidates(jobId, documentId);
      if (!current()) return;
      this.#candidates = listing.candidates;
      this.#busy = false;
      this.requestUpdate();
      const preferred = [...listing.candidates].sort((left, right) =>
        Number(right.complete) - Number(left.complete)
        || left.missingContextGroupLabels.length - right.missingContextGroupLabels.length
        || left.issues.filter((issue) => !issue.overridable).length - right.issues.filter((issue) => !issue.overridable).length
        || left.issues.length - right.issues.length
        || right.providerAttempt - left.providerAttempt
        || right.capturedAt.localeCompare(left.capturedAt))[0];
      if (preferred) await this.#selectCandidate(preferred.responseId);
    } catch (error) {
      if (!current()) return;
      this.#busy = false;
      this.store.toast(error instanceof Error ? error.message : this.i18n.t("presentation.draft.loadFailed", "Private generated drafts could not be loaded."));
      this.requestUpdate();
    }
  }

  async #selectCandidate(responseId: string) {
    const source=this.store.captureSourceOwnership(),jobId=this.#jobId,documentId=this.#jobDocumentId,revision=this.#privateRevision;
    const current=()=>this.isConnected&&this.store.sourceOwnershipActive(source)&&revision===this.#privateRevision&&this.#jobId===jobId&&this.documentId===documentId;
    if(!current()||!jobId||!this.#candidates.some(candidate=>candidate.responseId===responseId))return;
    if (!this.#selected.includes(responseId)) this.#selected = [...this.#selected.slice(-1), responseId];
    if (this.#details.has(responseId)) { this.requestUpdate(); return; }
    this.#busy = true;
    this.requestUpdate();
    try {
      const detail = await this.store.loadPresentationCandidate(jobId, responseId, documentId);
      if (!current()||detail.jobId!==jobId||detail.documentId!==documentId||detail.responseId!==responseId) return;
      this.#details.set(responseId, detail);
      this.#busy = false;
      this.requestUpdate();
    } catch (error) {
      if (!current()) return;
      this.#busy = false;
      this.store.toast(error instanceof Error ? error.message : this.i18n.t("presentation.draft.inspectFailed", "The private generated draft could not be inspected."));
      this.requestUpdate();
    }
  }

  async #preserveCandidate(responseId: string) {
    const source=this.store.captureSourceOwnership(),jobId=this.#jobId,documentId=this.#jobDocumentId,revision=this.#privateRevision,referenceRevision=this.#referenceRevision;
    const current=()=>this.isConnected&&this.store.sourceOwnershipActive(source)&&revision===this.#privateRevision&&this.#jobId===jobId&&this.documentId===documentId;
    if(!current()||!jobId||this.#preserving)return;
    this.#preserving = responseId;
    this.requestUpdate();
    try {
      const preserved = await this.store.preservePresentationCandidate(jobId, responseId, documentId);
      if(referenceRevision!==this.#referenceRevision||!this.store.sourceOwnershipScopeActive(source)||preserved.jobId!==jobId||preserved.documentId!==documentId||preserved.responseId!==responseId)return;
      // This is the original server acknowledgment, not authority to publish its private body.
      this.#rememberJob(jobId,documentId,source);this.requestUpdate();
      if(!current())return;
      this.#candidates = this.#candidates.map((candidate) => candidate.responseId === responseId ? preserved : candidate);
      const detail = this.#details.get(responseId);
      if (detail) this.#details.set(responseId, { ...detail, ...preserved });
      this.store.toast(this.i18n.t("presentation.draft.preservedNotice", "Private draft preserved under your existing evidence-retention policy."));
    } catch (error) {
      if (current()) this.store.toast(error instanceof Error ? error.message : this.i18n.t("presentation.draft.preserveFailed", "The private generated draft could not be safely preserved."));
    } finally {
      if(current()){this.#preserving = "";this.requestUpdate();}
    }
  }

  #editCandidate(detail:PresentationCandidateDetail){
    if(!detail.revision||this.#revisionBusy||!this.store.sourceOwnershipActive(this.#referenceSource))return;
    this.#editingResponse=detail.responseId;
    this.#editValues=new Map(detail.revision.fields.map(field=>[field.path,field.value]));
    this.#editIssues=[];this.#revisionKey=crypto.randomUUID();this.requestUpdate();
  }

  #cancelRevision(){
    if(this.#revisionBusy)return;
    this.#editingResponse="";this.#editValues.clear();this.#editIssues=[];this.#revisionKey="";this.requestUpdate();
  }

  async #saveRevision(detail:PresentationCandidateDetail){
    if(!detail.revision||this.#revisionBusy||this.#editingResponse!==detail.responseId)return;
    const source=this.store.captureSourceOwnership(),revision=this.#privateRevision,jobId=this.#jobId,documentId=this.documentId;
    const current=()=>this.isConnected&&this.store.sourceOwnershipActive(source)&&revision===this.#privateRevision
      &&this.#jobId===jobId&&this.documentId===documentId&&this.#editingResponse===detail.responseId;
    if(!current())return;
    const edits=detail.revision.fields.filter(field=>this.#editValues.get(field.path)!==field.value)
      .map(field=>({path:field.path,value:this.#editValues.get(field.path)??field.value}));
    this.#revisionBusy=true;this.#editIssues=[];this.requestUpdate();
    try{
      const outcome=await this.store.revisePresentationCandidate(jobId,detail.responseId,{
        revisionToken:detail.revision.token,idempotencyKey:this.#revisionKey,confirmed:true,edits,
      },documentId);
      if(!current())return;
      if("issues"in outcome){this.#editIssues=outcome.issues;return;}
      this.#revisionBusy=false;this.#cancelRevision();
      this.store.toast(this.i18n.t("presentation.draft.revisionSaved", "New unapproved draft saved. The original failure and charges are unchanged."));
      // A refresh failure cannot undo or relabel an acknowledged atomic save.
      try{await this.store.refreshEvents();}catch{/* Ordinary document refresh can retry without creating another revision. */}
    }catch(error){
      if(current())this.store.toast(error instanceof Error?error.message:this.i18n.t("presentation.draft.revisionFailed", "The new draft could not be safely saved. Your edits remain private."));
    }finally{
      if(current()){this.#revisionBusy=false;this.requestUpdate();}
    }
  }

  #revisionEditor(detail:PresentationCandidateDetail){
    if(this.#editingResponse!==detail.responseId||!detail.revision||!this.store.sourceOwnershipActive(this.#referenceSource))return nothing;
    return html`<section class="presentation-candidate-revision" aria-label=${this.i18n.t("presentation.draft.revisionEditor", "Edit a private copy")}>
      <h4>${this.i18n.t("presentation.draft.revisionEditor", "Edit a private copy")}</h4>
      <p>${this.i18n.t("presentation.draft.revisionNotice", "This creates a separate unapproved draft in this document after full source validation. It makes no provider request and does not change the original failed job or its charges. Source assignments, quotes, numerical precision, slide count and layout stay fixed.")}</p>
      <div class="presentation-candidate-revision-fields">${detail.slides.map((_slide,index)=>html`<details>
        <summary>${this.i18n.t("presentation.draft.slideHeading", "Slide {slide}: {title}", {slide:this.i18n.number(index+1),title:detail.slides[index]!.title})}</summary>
        ${detail.revision!.fields.filter(field=>field.path.startsWith(`items.${index}.`)).map(field=>html`<label>
          <span>${field.path.slice(`items.${index}.`.length)}</span>
          <textarea dir="auto" rows=${field.path.endsWith(".body")?4:2} maxlength="8000" autocomplete="off" ?disabled=${this.#revisionBusy}
            .value=${this.#editValues.get(field.path)??field.value}
            @input=${(event:Event)=>{if(this.#editingResponse===detail.responseId&&this.store.sourceOwnershipActive(this.#referenceSource)&&!this.#revisionBusy)this.#editValues.set(field.path,(event.target as HTMLTextAreaElement).value);}}></textarea>
        </label>`)}
      </details>`)}</div>
      ${this.#editIssues.length?html`<section class="presentation-rejected-draft-issues" role="alert"><h5>${this.i18n.t("presentation.draft.revisionIssues", "This copy still needs correction. No new draft was created.")}</h5><ol>${this.#editIssues.map(issue=>html`<li><b>${issue.path}</b><span>${issue.message}</span></li>`)}</ol></section>`:nothing}
      <div class="presentation-rejected-draft-jobs">
        <button class="button button-primary" ?disabled=${this.#revisionBusy} @click=${()=>void this.#saveRevision(detail)}>${this.#revisionBusy?this.i18n.t("presentation.draft.revisionSaving", "Validating and saving…"):this.i18n.t("presentation.draft.revisionSave", "Validate and create new draft")}</button>
        <button class="button button-subtle" ?disabled=${this.#revisionBusy} @click=${()=>this.#cancelRevision()}>${this.i18n.t("presentation.draft.revisionCancel", "Cancel edits")}</button>
      </div>
    </section>`;
  }

  #slide(item: DocumentArtifactDraftItem, presentation: PresentationCandidateDetail["presentation"], index: number, total: number) {
    return html`<forma-presentation-slide .item=${item} .presentation=${presentation} .index=${index} .total=${total} .compact=${true} .showFooterLabel=${false}></forma-presentation-slide>`;
  }

  #citationChecks(detail: PresentationCandidateDetail) {
    const checks = detail.citationChecks ?? [];
    if (!checks.length) return nothing;
    const sourceStatus = {
      authorized: this.i18n.t("presentation.draft.citationAssigned", "Authorized for this slide"),
      unauthorized: this.i18n.t("presentation.draft.citationUnauthorized", "Not authorized for this request"),
      unassigned: this.i18n.t("presentation.draft.citationUnassigned", "Authorized source, but not assigned to this slide"),
      missing: this.i18n.t("presentation.draft.citationMissing", "No cited source reference"),
    };
    const excerptStatus = {
      grounded: this.i18n.t("presentation.draft.excerptGrounded", "Matches a contiguous source quotation"),
      ungrounded: this.i18n.t("presentation.draft.excerptUngrounded", "Does not match a contiguous source quotation"),
      empty: this.i18n.t("presentation.draft.excerptEmpty", "No quotation supplied"),
      unresolved: this.i18n.t("presentation.draft.excerptUnresolved", "Cannot check without a resolved source"),
    };
    const truncated = this.i18n.t("presentation.draft.citationTruncated", "Display shortened; validation used the complete original text.");
    const attempt = this.i18n.t("presentation.draft.attemptButton", "{stage} · attempt {attempt} · page {page}", {
      stage: detail.stage === "repair" ? this.i18n.t("presentation.draft.repair", "Repair") : this.i18n.t("presentation.draft.initial", "Initial"),
      attempt: this.i18n.number(detail.providerAttempt), page: this.i18n.number(detail.pageIndex + 1),
    });
    return html`<details class="presentation-rejected-draft-issues presentation-rejected-draft-citations">
      <summary>${this.i18n.t("presentation.draft.citationChecks", "Inspect citation grounding · {count}", { count: this.i18n.number(checks.length) })}<span> · ${attempt}</span></summary>
      <p>${this.i18n.t("presentation.draft.citationPrivacy", "Current checks use the frozen request. Private identifiers are hidden. This evidence is not included in shared diagnostics or exports.")}</p>
      <ol>${checks.map((check) => html`<li>
        <b>${this.i18n.t("presentation.draft.citationPosition", "Slide {slide} · citation {citation}", { slide: this.i18n.number(detail.globalStartIndex + check.slideIndex + 1), citation: this.i18n.number(check.citationIndex + 1) })}</b>
        ${check.sourceLabel ? html`<span dir="auto">${check.sourceLabel}</span>` : nothing}
        <dl>
          <div><dt>${this.i18n.t("presentation.draft.citationSourceCheck", "Source assignment")}</dt><dd>${sourceStatus[check.sourceStatus]}</dd></div>
          <div><dt>${this.i18n.t("presentation.draft.citationExcerptCheck", "Quotation check")}</dt><dd>${excerptStatus[check.excerptStatus]}</dd></div>
          <div><dt>${this.i18n.t("presentation.draft.citationAnchorCheck", "Slide anchor")}</dt><dd>${check.anchorStatus === "incorrect" ? this.i18n.t("presentation.draft.citationAnchorIncorrect", "Does not match the resolved evidence passage") : this.i18n.t("presentation.draft.citationAnchorValid", "No conflicting slide anchor")}</dd></div>
        </dl>
        <strong>${this.i18n.t("presentation.draft.citationExcerpt", "Submitted citation excerpt")}</strong>
        <blockquote dir="auto">${check.excerpt || this.i18n.t("presentation.draft.excerptEmpty", "No quotation supplied")}</blockquote>
        ${check.excerptTruncated ? html`<small>${truncated}</small>` : nothing}
        ${check.passages.length ? html`<details><summary>${this.i18n.t("presentation.draft.citationPassage", "Resolved frozen source passage")}<span> · ${attempt} · ${this.i18n.t("presentation.draft.citationPosition", "Slide {slide} · citation {citation}", { slide: this.i18n.number(detail.globalStartIndex + check.slideIndex + 1), citation: this.i18n.number(check.citationIndex + 1) })}</span></summary>${check.passages.map((passage) => html`<p dir="auto">${passage.content}</p>${passage.truncated ? html`<small>${truncated}</small>` : nothing}`)}</details>` : nothing}
      </li>`)}</ol>
    </details>`;
  }

  #candidate(detail: PresentationCandidateDetail) {
    const accounting = detail.accounting;
    const quantity = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    const settled = quantity(accounting?.settled_cost_microusd), reservation = quantity(accounting?.reservation_microusd);
    const attempted = quantity(accounting?.attempted_provider_call_count), confirmed = quantity(accounting?.actual_provider_call_count);
    const unresolved = quantity(accounting?.unresolved_provider_call_count);
    const reservationStatus = accounting && ["active", "executing", "settled", "released"].includes(accounting.reservation_status)
      && (!["settled", "released"].includes(accounting.reservation_status) || reservation === 0)
      ? accounting.reservation_status as "active" | "executing" | "settled" | "released" : "unknown";
    const totalKnown = attempted !== null && attempted >= detail.providerAttempt;
    const settlementComplete = accounting?.settled_cost_complete === true && settled !== null && totalKnown
      && confirmed === attempted && unresolved === 0 && accounting.provider_submission_uncertain === false
      && reservation === 0 && ["settled", "released"].includes(reservationStatus);
    const currency = (amount: number) => this.i18n.number(amount / 1_000_000, { style: "currency", currency: "USD", minimumFractionDigits: 6, maximumFractionDigits: 6 });
    const reservationLabel = {
      active: this.i18n.t("presentation.draft.reservationActive", "Reserved"),
      executing: this.i18n.t("presentation.draft.reservationExecuting", "In progress"),
      settled: this.i18n.t("presentation.draft.reservationSettled", "Settled"),
      released: this.i18n.t("presentation.draft.reservationReleased", "Released"),
      unknown: this.i18n.t("presentation.draft.reservationUnknown", "Current reservation is not yet verified"),
    }[reservationStatus];
    return html`<article class="presentation-rejected-draft-card">
      <header><div><span class="eyebrow">${detail.stage === "repair" ? this.i18n.t("presentation.draft.boundedRepair", "Bounded repair") : this.i18n.t("presentation.draft.initialResponse", "Initial response")}</span><h3>${detail.title || this.i18n.t("presentation.draft.rejectedTitle", "Rejected presentation draft")}</h3><p>${detail.summary || this.i18n.t("presentation.draft.incompleteSummary", "The response did not contain a complete presentation.")}</p></div>
        <button type="button" class="button secondary compact" ?disabled=${detail.retentionClass === "governed-evidence" || Boolean(this.#preserving)} @click=${() => void this.#preserveCandidate(detail.responseId)}>${detail.retentionClass === "governed-evidence" ? this.i18n.t("presentation.draft.preserved", "Preserved privately") : this.#preserving === detail.responseId ? this.i18n.t("presentation.draft.preserving", "Preserving…") : this.i18n.t("presentation.draft.preserve", "Preserve privately")}</button>
      </header>
      ${detail.revision?html`<button class="button button-subtle" ?disabled=${this.#revisionBusy} @click=${()=>this.#editCandidate(detail)}>${this.i18n.t("presentation.draft.revisionEditor", "Edit a private copy")}</button>`:nothing}
      ${this.#revisionEditor(detail)}
      ${detail.reviewOnlyReason === "historical-validation-rejection" ? html`<p class="presentation-rejected-draft-warning">${this.i18n.t("presentation.draft.historicalRejection", "This response was rejected under an earlier validation contract. Current checks are for private review only and cannot approve or recover it. The original receipt is unchanged.")}</p>` : nothing}
      ${detail.reviewOnlyReason === "validation-provenance-unavailable" ? html`<p class="presentation-rejected-draft-warning">${this.i18n.t("presentation.draft.provenanceUnavailable", "The original validation decision could not be verified. This saved draft remains private and review-only; current checks cannot approve or promote it.")}</p>` : nothing}
      <section class="generation-receipt-summary"><dl>
        <div><dt>${this.i18n.t("presentation.draft.providerAttempt", "Provider attempt")}</dt><dd>${totalKnown ? this.i18n.t("presentation.draft.attemptCount", "{attempt} of {total}", { attempt: this.i18n.number(detail.providerAttempt), total: this.i18n.number(attempted) }) : this.i18n.t("presentation.draft.attemptOnly", "Attempt {attempt} · total not yet verified", { attempt: this.i18n.number(detail.providerAttempt) })}</dd></div>
        <div><dt>${this.i18n.t("presentation.draft.requestedPlanned", "Requested / planned")}</dt><dd>${this.i18n.t("presentation.draft.slideCounts", "{requested} / {planned} slides", { requested: this.#requestedCountLabel(detail), planned: this.i18n.number(detail.plannedSlideCount) })}</dd></div>
        <div><dt>${this.i18n.t("presentation.draft.pageCoverage", "Page coverage")}</dt><dd>${this.i18n.t("presentation.draft.pageCounts", "Page {page} of {total} · {generated} generated", { page: this.i18n.number(detail.pageIndex + 1), total: this.i18n.number(detail.pageCount), generated: this.i18n.number(detail.generatedSlideCount) })}</dd></div>
        <div><dt>${settlementComplete ? this.i18n.t("presentation.draft.settledCost", "Settled job cost · all calls") : this.i18n.t("presentation.draft.settlement", "Job settlement")}</dt><dd>${settlementComplete ? currency(settled) : this.i18n.t("presentation.draft.settlementPending", "Settlement is not yet verified.")}</dd></div>
        ${!settlementComplete && settled !== null && settled > 0 ? html`<div><dt>${this.i18n.t("presentation.draft.settledSoFar", "Verified settled cost so far")}</dt><dd>${currency(settled)}</dd></div>` : nothing}
        <div><dt>${["active", "executing"].includes(reservationStatus) ? this.i18n.t("presentation.draft.retainedReservation", "Retained spending reservation") : this.i18n.t("presentation.draft.reservation", "Spending reservation")}</dt><dd>${reservation === null || reservationStatus === "unknown" ? this.i18n.t("presentation.draft.reservationUnknown", "Current reservation is not yet verified") : this.i18n.t("presentation.draft.reservationAmount", "{amount} · {status}", { amount: currency(reservation), status: reservationLabel })}</dd></div>
        <div><dt>${this.i18n.t("presentation.draft.confirmedCalls", "Confirmed provider calls")}</dt><dd>${confirmed === null ? this.i18n.t("presentation.draft.callsUnknown", "Not yet verified") : this.i18n.number(confirmed)}</dd></div>
        <div><dt>${this.i18n.t("presentation.draft.unresolvedCalls", "Unresolved provider calls")}</dt><dd>${unresolved === null ? this.i18n.t("presentation.draft.callsUnknown", "Not yet verified") : this.i18n.number(unresolved)}</dd></div>
        <div><dt>${this.i18n.t("presentation.draft.model", "Model")}</dt><dd>${detail.model}</dd></div>
        <div><dt>${this.i18n.t("presentation.draft.privateRetention", "Private retention")}</dt><dd>${this.i18n.date(new Date(detail.expiresAt), { dateStyle: "medium", timeStyle: "short" })}</dd></div>
      </dl></section>
      ${accounting?.provider_submission_uncertain !== false ? html`<p class="presentation-rejected-draft-warning" role="status">${this.i18n.t("presentation.draft.submissionUncertain", "Provider submission is still unconfirmed. This review does not retry or release a reservation.")}</p>` : nothing}
      ${detail.missingContextGroupLabels.length ? html`<p class="presentation-rejected-draft-warning"><b>${this.i18n.t("presentation.draft.missingSource", "Missing source chapters:")}</b> ${detail.missingContextGroupLabels.join(" · ")}</p>` : nothing}
      ${detail.issues.length ? html`<section class="presentation-rejected-draft-issues"><h4>${this.i18n.t("presentation.draft.issuesHeading", "Why this response cannot be accepted")}</h4><ol>${detail.issues.map((issue) => html`<li><b>${issue.globalSlideIndex ? this.i18n.t("presentation.draft.issueSlide", "Slide {slide} · {code}", { slide: this.i18n.number(issue.globalSlideIndex), code: issue.code }) : issue.code}</b><span>${issue.message}</span><small>${this.i18n.t("presentation.draft.issueMetadata", "{category} · {stage} attempt {attempt} · {requirement}", { category: issue.category, stage: issue.stage === "repair" ? this.i18n.t("presentation.draft.repair", "Repair") : this.i18n.t("presentation.draft.initial", "Initial"), attempt: this.i18n.number(issue.providerAttempt), requirement: issue.overridable ? this.i18n.t("presentation.draft.preference", "presentation preference; still requires explicit revision and full validation") : this.i18n.t("presentation.draft.mandatory", "mandatory validation") })}</small></li>`)}</ol></section>` : html`<p>${this.i18n.t("presentation.draft.noIssues", "No page-level validation issues were found. This draft is still private and cannot be shared or exported from review.")}</p>`}
      ${detail.normalizationChanges.length ? html`<details class="presentation-rejected-draft-normalization"><summary>${this.i18n.t("presentation.draft.normalization", "Inspect {count} local normalization changes", { count: this.i18n.number(detail.normalizationChanges.length) })}</summary><ol>${detail.normalizationChanges.map((change) => html`<li><b>${change.path}</b><span>${change.originalValue || this.i18n.t("presentation.draft.empty", "Empty")} → ${change.normalizedValue || this.i18n.t("presentation.draft.empty", "Empty")}</span><small>${change.reason}</small></li>`)}</ol></details>` : nothing}
      ${this.#citationChecks(detail)}
      ${detail.slides.length ? html`<ol class="presentation-rejected-draft-slides">${detail.slides.map((item, index) => html`<li>${this.#slide({ title: item.title, body: item.body, notes: item.notes, image_prompt: "", context_group_ids: [], slide: item.slide }, detail.presentation, index, detail.slides.length)}<p><b>${this.i18n.t("presentation.draft.slideHeading", "Slide {slide}: {title}", { slide: this.i18n.number(detail.globalStartIndex + index + 1), title: item.title })}</b>${item.groupLabels.length ? html` · ${item.groupLabels.join(" · ")}` : nothing}</p>${item.body ? html`<p>${item.body}</p>` : nothing}${item.notes ? html`<details><summary>${this.i18n.t("presentation.draft.speakerNotes", "Speaker notes")}</summary><p>${item.notes}</p></details>` : nothing}</li>`)}</ol>` : nothing}
    </article>`;
  }

  #requestedCountLabel(candidate: PresentationCandidateSummary) {
    const policy = candidate.slideCountPolicy;
    if (policy?.kind === "flexible") return `${this.i18n.number(policy.min)}–${this.i18n.number(policy.max)}`;
    return candidate.requestedSlideCount === null ? "—" : this.i18n.number(candidate.requestedSlideCount);
  }

  #comparisonPanel() {
    const selected = this.#selected.map((responseId) => this.#details.get(responseId)).filter((detail): detail is PresentationCandidateDetail => Boolean(detail));
    const current = selected.at(-1);
    if (!current) return nothing;
    if (this.#comparison === "requested") return html`<article class="presentation-rejected-draft-reference"><h3>${this.i18n.t("presentation.draft.requestedTitle", "Requested presentation")}</h3><p>${this.i18n.t("presentation.draft.requestedCounts", "{requested} requested slides · {planned} planned slides · {batches} provider batches", { requested: this.#requestedCountLabel(current), planned: this.i18n.number(current.plannedSlideCount), batches: this.i18n.number(current.providerBatchCount) })}</p><p>${current.reviewOnlyReason === "validation-provenance-unavailable" ? this.i18n.t("presentation.draft.provenanceUnavailable", "The original validation decision could not be verified. This saved draft remains private and review-only; current checks cannot approve or promote it.") : current.complete ? this.i18n.t("presentation.draft.requestComplete", "This response satisfies its page contract, but remains a private unapproved draft.") : current.issues.length && current.issues.every((issue) => issue.overridable) ? this.i18n.t("presentation.draft.preference", "presentation preference; still requires explicit revision and full validation") : this.i18n.t("presentation.draft.requestIncomplete", "This response is incomplete or failed a mandatory source, authorization, or structure requirement.")}</p>${current.missingContextGroupLabels.length ? html`<p>${this.i18n.t("presentation.draft.missingContext", "Missing Combined Context:")} ${current.missingContextGroupLabels.join(" · ")}</p>` : nothing}</article>`;
    if (this.#comparison === "source") {
      const projection = this.store.projection.get();
      const blocks = projection.libraryBlocks.filter((block) => block.documentId === this.documentId && Number(block.properties.weight ?? .5) > 0);
      return html`<article class="presentation-rejected-draft-reference"><h3>${this.i18n.t("presentation.draft.sourceTitle", "Current authorized source material")}</h3><ol>${blocks.map((block) => html`<li><b>${String(block.properties.label ?? block.handle ?? block.type)}</b><p>${String(block.properties.text ?? block.properties.instruction ?? "")}</p></li>`)}</ol><p>${this.i18n.t("presentation.draft.sourceNotice", "Current source changes do not authorize sharing, exporting, or promoting a historical draft.")}</p></article>`;
    }
    if (this.#comparison === "accepted") {
      const projection = this.store.projection.get();
      const approved = projection.libraryArtifacts.filter((artifact) => artifact.documentId === this.documentId && artifact.kind === "slides");
      return html`<article class="presentation-rejected-draft-reference"><h3>${this.i18n.t("presentation.draft.acceptedTitle", "Accepted presentations")}</h3>${approved.length ? html`<ol>${approved.map((artifact) => { const retained = parseDocumentArtifactContent(this.store.content.get()[artifact.contentRef ?? ""]); return html`<li><b>${artifact.title}</b><p>${this.i18n.t("presentation.draft.acceptedCount", "{count} accepted slides", { count: this.i18n.number(artifact.itemCount) })}${retained?.summary ? ` · ${retained.summary}` : ""}</p></li>`; })}</ol>` : html`<p>${this.i18n.t("presentation.draft.acceptedEmpty", "This document has no previously accepted presentation.")}</p>`}<p>${this.i18n.t("presentation.draft.acceptedNotice", "Accepted work remains separate from these unapproved private drafts.")}</p></article>`;
    }
    return html`<div class=${`presentation-rejected-draft-comparison${selected.length > 1 ? " presentation-rejected-draft-comparison--split" : ""}`}>${selected.map((detail) => this.#candidate(detail))}</div>`;
  }

  override render() {
    const jobs = [
      ...this.jobs.map((job) => ({ jobId: job.jobId, dismissedAt: Boolean(job.dismissedAt || job.result?.dismissedAt) })),
      ...this.#preservedJobs.filter((preserved) => preserved.documentId===this.documentId && !this.jobs.some((current) => current.jobId === preserved.jobId)).map((job) => ({ jobId: job.jobId, dismissedAt: false })),
    ];
    if (!jobs.length) return nothing;
    return html`<section class="presentation-rejected-drafts" aria-label=${this.i18n.t("presentation.draft.regionLabel", "Private rejected presentation drafts")}><header><div><span class="eyebrow">${this.i18n.t("presentation.draft.eyebrow", "Rejected drafts · private")}</span><p>${this.i18n.t("presentation.draft.description", "Inspect paid provider responses without generating, sharing, or exporting.")}</p></div><span>${this.i18n.number(jobs.length)}</span></header><div class="presentation-rejected-draft-jobs">${jobs.map((job) => html`<button type="button" class="button secondary compact" @click=${() => void this.#openDrafts(job.jobId)}>${this.i18n.t("presentation.draft.review", "Review generated drafts")}${job.dismissedAt ? ` · ${this.i18n.t("presentation.draft.dismissed", "dismissed issue")}` : ""}</button>`)}</div></section>
      ${this.#open ? html`<dialog class="document-artifact-view presentation-rejected-drafts-dialog" aria-label=${this.i18n.t("presentation.draft.dialogLabel", "Actor-private rejected presentation drafts")} @close=${this.#clearPrivateDrafts} @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#clearPrivateDrafts(); }}>
        <section class="presentation-rejected-drafts-reader"><header><div><span class="eyebrow">${this.i18n.t("presentation.draft.privateStatus", "Private draft · not approved")}</span><h2>${this.i18n.t("presentation.draft.dialogTitle", "Review generated presentation drafts")}</h2><p>${this.i18n.t("presentation.draft.privacyNotice", "Original responses stay private. A separately validated copy can become a new unapproved document draft; this does not approve release.")}</p></div><button type="button" class="icon-button" aria-label=${this.i18n.t("action.close", "Close")} @click=${this.#clearPrivateDrafts}>${icon("close")}</button></header>
          <nav class="presentation-rejected-draft-attempts" aria-label=${this.i18n.t("presentation.draft.alternativesLabel", "Generated provider alternatives")}>${this.#candidates.map((candidate) => html`<button type="button" class=${`button ${this.#selected.includes(candidate.responseId) ? "primary" : "secondary"} compact`} @click=${() => void this.#selectCandidate(candidate.responseId)}>${this.i18n.t("presentation.draft.attemptButton", "{stage} · attempt {attempt} · page {page}", { stage: candidate.stage === "repair" ? this.i18n.t("presentation.draft.repair", "Repair") : this.i18n.t("presentation.draft.initial", "Initial"), attempt: this.i18n.number(candidate.providerAttempt), page: this.i18n.number(candidate.pageIndex + 1) })}</button>`)}</nav>
          <nav class="presentation-rejected-draft-modes" aria-label=${this.i18n.t("presentation.draft.modeLabel", "Draft comparison mode")}>${([ ["alternatives", this.i18n.t("presentation.draft.compareAlternatives", "Compare alternatives")], ["requested", this.i18n.t("presentation.draft.compareRequested", "Requested output")], ["source", this.i18n.t("presentation.draft.compareSource", "Source material")], ["accepted", this.i18n.t("presentation.draft.compareAccepted", "Accepted presentation")] ] as const).map(([mode, label]) => html`<button type="button" class=${`button ${this.#comparison === mode ? "primary" : "ghost"} compact`} @click=${() => { this.#comparison = mode; this.requestUpdate(); }}>${label}</button>`)}</nav>
          ${this.#busy ? html`<p role="status">${this.i18n.t("presentation.draft.loading", "Loading your actor-private presentation evidence…")}</p>` : nothing}
          ${!this.#busy && !this.#candidates.length ? html`<p>${this.i18n.t("presentation.draft.expired", "No unexpired, authorized provider drafts remain for this generation.")}</p>` : this.#comparisonPanel()}
        </section>
      </dialog>` : nothing}`;
  }
}

if (!customElements.get("forma-presentation-rejected-drafts")) customElements.define("forma-presentation-rejected-drafts", PresentationRejectedDrafts);
declare global { interface HTMLElementTagNameMap { "forma-presentation-rejected-drafts": PresentationRejectedDrafts } }
