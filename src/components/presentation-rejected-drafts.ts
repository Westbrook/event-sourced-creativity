import { html, nothing } from "lit";
import type { DocumentJob } from "../model/document-jobs";
import { parseDocumentArtifactContent, type DocumentArtifactDraftItem } from "../model/document-artifacts";
import type { PresentationCandidateDetail, PresentationCandidateSummary } from "../model/presentation-candidates";
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

  readonly #clearPrivateDrafts = () => {
    this.#jobId = "";
    this.#open = false;
    this.#busy = false;
    this.#preserving = "";
    this.#candidates = [];
    this.#details.clear();
    this.#selected = [];
    this.#comparison = "alternatives";
    this.querySelector<HTMLDialogElement>(".presentation-rejected-drafts-dialog")?.close();
    this.requestUpdate();
  };

  readonly #clearAuthorizedDrafts = () => {
    this.#preservedJobs = [];
    this.#discoveredFor = "";
    this.#clearPrivateDrafts();
  };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("forma-authorization-changed", this.#clearAuthorizedDrafts);
  }

  override disconnectedCallback() {
    window.removeEventListener("forma-authorization-changed", this.#clearAuthorizedDrafts);
    this.#clearAuthorizedDrafts();
    super.disconnectedCallback();
  }

  protected override updated() {
    const dialog = this.querySelector<HTMLDialogElement>(".presentation-rejected-drafts-dialog");
    if (this.#open && dialog && !dialog.open) ensureModalDialog(dialog);
    if (this.documentId && this.#discoveredFor !== this.documentId) {
      if (this.#discoveredFor) {
        this.#preservedJobs = [];
        this.#clearPrivateDrafts();
      }
      this.#discoveredFor = this.documentId;
      void this.#discoverPreservedDrafts(this.documentId);
    }
  }

  async #discoverPreservedDrafts(documentId: string) {
    const authorization = this.store.captureAuthorizationScope();
    if (!authorization) return;
    try {
      const listing = await this.store.loadPreservedPresentationCandidateJobs(documentId);
      if (!this.store.authorizationScopeActive(authorization) || this.documentId !== documentId) return;
      this.#preservedJobs = listing.jobs.map(({ jobId }) => ({ jobId, documentId }));
      this.requestUpdate();
    } catch {
      if (this.store.authorizationScopeActive(authorization) && this.documentId === documentId) {
        this.#preservedJobs = [];
        this.requestUpdate();
      }
    }
  }

  async #openDrafts(jobId: string) {
    const authorization = this.store.captureAuthorizationScope();
    if (!authorization) return;
    this.#jobId = jobId;
    this.#open = true;
    this.#busy = true;
    this.#candidates = [];
    this.#details.clear();
    this.#selected = [];
    this.requestUpdate();
    try {
      const listing = await this.store.loadPresentationCandidates(jobId, this.documentId);
      if (!this.store.authorizationScopeActive(authorization) || this.#jobId !== jobId) return;
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
      if (!this.store.authorizationScopeActive(authorization)) return;
      this.#busy = false;
      this.store.toast(error instanceof Error ? error.message : this.i18n.t("presentation.draft.loadFailed", "Private generated drafts could not be loaded."));
      this.requestUpdate();
    }
  }

  async #selectCandidate(responseId: string) {
    const authorization = this.store.captureAuthorizationScope();
    if (!authorization || !this.#jobId || !this.#candidates.some((candidate) => candidate.responseId === responseId)) return;
    if (!this.#selected.includes(responseId)) this.#selected = [...this.#selected.slice(-1), responseId];
    if (this.#details.has(responseId)) { this.requestUpdate(); return; }
    this.#busy = true;
    this.requestUpdate();
    try {
      const detail = await this.store.loadPresentationCandidate(this.#jobId, responseId, this.documentId);
      if (!this.store.authorizationScopeActive(authorization) || this.#jobId !== detail.jobId) return;
      this.#details.set(responseId, detail);
      this.#busy = false;
      this.requestUpdate();
    } catch (error) {
      if (!this.store.authorizationScopeActive(authorization)) return;
      this.#busy = false;
      this.store.toast(error instanceof Error ? error.message : this.i18n.t("presentation.draft.inspectFailed", "The private generated draft could not be inspected."));
      this.requestUpdate();
    }
  }

  async #preserveCandidate(responseId: string) {
    const authorization = this.store.captureAuthorizationScope();
    if (!authorization || !this.#jobId || this.#preserving) return;
    this.#preserving = responseId;
    this.requestUpdate();
    try {
      const preserved = await this.store.preservePresentationCandidate(this.#jobId, responseId, this.documentId);
      if (!this.store.authorizationScopeActive(authorization) || this.#jobId !== preserved.jobId) return;
      this.#candidates = this.#candidates.map((candidate) => candidate.responseId === responseId ? preserved : candidate);
      const detail = this.#details.get(responseId);
      if (detail) this.#details.set(responseId, { ...detail, ...preserved });
      this.store.toast(this.i18n.t("presentation.draft.preservedNotice", "Private draft preserved under your existing evidence-retention policy."));
    } catch (error) {
      if (this.store.authorizationScopeActive(authorization)) this.store.toast(error instanceof Error ? error.message : this.i18n.t("presentation.draft.preserveFailed", "The private generated draft could not be safely preserved."));
    } finally {
      this.#preserving = "";
      this.requestUpdate();
    }
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
      ${detail.reviewOnlyReason === "historical-validation-rejection" ? html`<p class="presentation-rejected-draft-warning">${this.i18n.t("presentation.draft.historicalRejection", "This response was rejected under an earlier validation contract. Current checks are for private review only and cannot approve or recover it. The original receipt is unchanged.")}</p>` : nothing}
      ${detail.reviewOnlyReason === "validation-provenance-unavailable" ? html`<p class="presentation-rejected-draft-warning">${this.i18n.t("presentation.draft.provenanceUnavailable", "The original validation decision could not be verified. This saved draft remains private and review-only; current checks cannot approve or promote it.")}</p>` : nothing}
      <section class="generation-receipt-summary"><dl>
        <div><dt>${this.i18n.t("presentation.draft.providerAttempt", "Provider attempt")}</dt><dd>${totalKnown ? this.i18n.t("presentation.draft.attemptCount", "{attempt} of {total}", { attempt: this.i18n.number(detail.providerAttempt), total: this.i18n.number(attempted) }) : this.i18n.t("presentation.draft.attemptOnly", "Attempt {attempt} · total not yet verified", { attempt: this.i18n.number(detail.providerAttempt) })}</dd></div>
        <div><dt>${this.i18n.t("presentation.draft.requestedPlanned", "Requested / planned")}</dt><dd>${this.i18n.t("presentation.draft.slideCounts", "{requested} / {planned} slides", { requested: this.i18n.number(detail.requestedSlideCount), planned: this.i18n.number(detail.plannedSlideCount) })}</dd></div>
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

  #comparisonPanel() {
    const selected = this.#selected.map((responseId) => this.#details.get(responseId)).filter((detail): detail is PresentationCandidateDetail => Boolean(detail));
    const current = selected.at(-1);
    if (!current) return nothing;
    if (this.#comparison === "requested") return html`<article class="presentation-rejected-draft-reference"><h3>${this.i18n.t("presentation.draft.requestedTitle", "Requested presentation")}</h3><p>${this.i18n.t("presentation.draft.requestedCounts", "{requested} requested slides · {planned} planned slides · {batches} provider batches", { requested: this.i18n.number(current.requestedSlideCount), planned: this.i18n.number(current.plannedSlideCount), batches: this.i18n.number(current.providerBatchCount) })}</p><p>${current.reviewOnlyReason === "validation-provenance-unavailable" ? this.i18n.t("presentation.draft.provenanceUnavailable", "The original validation decision could not be verified. This saved draft remains private and review-only; current checks cannot approve or promote it.") : current.complete ? this.i18n.t("presentation.draft.requestComplete", "This response satisfies its page contract, but remains a private unapproved draft.") : current.issues.length && current.issues.every((issue) => issue.overridable) ? this.i18n.t("presentation.draft.preference", "presentation preference; still requires explicit revision and full validation") : this.i18n.t("presentation.draft.requestIncomplete", "This response is incomplete or failed a mandatory source, authorization, or structure requirement.")}</p>${current.missingContextGroupLabels.length ? html`<p>${this.i18n.t("presentation.draft.missingContext", "Missing Combined Context:")} ${current.missingContextGroupLabels.join(" · ")}</p>` : nothing}</article>`;
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
      ...this.#preservedJobs.filter((preserved) => !this.jobs.some((current) => current.jobId === preserved.jobId)).map((job) => ({ jobId: job.jobId, dismissedAt: false })),
    ];
    if (!jobs.length) return nothing;
    return html`<section class="presentation-rejected-drafts" aria-label=${this.i18n.t("presentation.draft.regionLabel", "Private rejected presentation drafts")}><header><div><span class="eyebrow">${this.i18n.t("presentation.draft.eyebrow", "Rejected drafts · private")}</span><p>${this.i18n.t("presentation.draft.description", "Inspect paid provider responses without generating, sharing, or exporting.")}</p></div><span>${this.i18n.number(jobs.length)}</span></header><div class="presentation-rejected-draft-jobs">${jobs.map((job) => html`<button type="button" class="button secondary compact" @click=${() => void this.#openDrafts(job.jobId)}>${this.i18n.t("presentation.draft.review", "Review generated drafts")}${job.dismissedAt ? ` · ${this.i18n.t("presentation.draft.dismissed", "dismissed issue")}` : ""}</button>`)}</div></section>
      ${this.#open ? html`<dialog class="document-artifact-view presentation-rejected-drafts-dialog" aria-label=${this.i18n.t("presentation.draft.dialogLabel", "Actor-private rejected presentation drafts")} @close=${this.#clearPrivateDrafts} @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#clearPrivateDrafts(); }}>
        <section class="presentation-rejected-drafts-reader"><header><div><span class="eyebrow">${this.i18n.t("presentation.draft.privateStatus", "Private draft · not approved")}</span><h2>${this.i18n.t("presentation.draft.dialogTitle", "Review generated presentation drafts")}</h2><p>${this.i18n.t("presentation.draft.privacyNotice", "Only you can see this material. It cannot be shared, exported, or promoted from this review.")}</p></div><button type="button" class="icon-button" aria-label=${this.i18n.t("action.close", "Close")} @click=${this.#clearPrivateDrafts}>${icon("close")}</button></header>
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
