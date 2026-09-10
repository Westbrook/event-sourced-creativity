import { html, nothing } from "lit";
import { activityJobDisposition, activityJobEvidence, activityJobIssueReport } from "../model/activity-issues";
import { artifactReviewState, artifactSourceVersions } from "../model/context-health";
import { documentArtifactRevision, parseDocumentArtifactContent, type DocumentArtifact } from "../model/document-artifacts";
import { documentJobFailure, generationFailureGuidance, type DocumentJob } from "../model/document-jobs";
import { failedGenerationInputInspection } from "../model/generation-inputs";
import type { PresentationCandidateDetail, PresentationCandidateSummary } from "../model/presentation-candidates";
import type {
  ActivityIssueNote,
  AssignedReviewTask,
  CapturedAuthorizationScope,
  CapturedSourceOwnership,
  OrganizationContextBinding,
  OrganizationContextVersion,
  ProjectNotification,
} from "../state/store";
import { copyTextToClipboard, FormaElement } from "./forma-element";
import "./generation-input-dialog";

type ActivityCorrectionOwner = Readonly<{
  notificationId: string; artifactId: string; documentId: string; contentRef: string;
  projectId: string; route: string; source: CapturedSourceOwnership;
}>;

/**
 * Inspect approved failure evidence, capture actor-private notes, resolve assigned reviews, and explicitly accept scoped context changes without leaving Activity.
 * @summary Private, directly actionable activity issue interface.
 */
export class FormaActivityIssuePanel extends FormaElement {
  static properties = {
    job: { attribute: false },
    review: { attribute: false },
    reviewContext: { attribute: false },
    notification: { attribute: false },
    documentName: { type: String, attribute: "document-name" },
  };

  job: DocumentJob | null = null;
  review: AssignedReviewTask | null = null;
  reviewContext: { identity: string; name: string } | null = null;
  notification: ProjectNotification | null = null;
  documentName = "";

  #inspectionJob: DocumentJob | null = null;
  #actorContent: Record<string, string> = {};
  #candidates: PresentationCandidateSummary[] | null = null;
  #candidate: PresentationCandidateDetail | null = null;
  #notes: ActivityIssueNote[] | null = null;
  #noteDraft = "";
  #reviewNote = "";
  #editingArtifactId = "";
  #editMarkdown = "";
  #editItems: Array<{ title: string; body: string; notes: string }> = [];
  #editRevision = 0;
  #editDraftRevision = 0;
  #busy = "";
  #reviewUnavailable = false;
  #correctionOwner: ActivityCorrectionOwner | null = null;

  /** Content-free origin admission; the original note, review and correction owners stay here. */
  get navigationBlocked():boolean{
    return Boolean(this.isConnected&&(this.#busy||this.#noteDraft||this.#reviewNote||this.correctionEditorOwner));
  }

  /** Identity only: the draft itself remains owned by this connected editor. */
  get correctionEditorOwner(): Readonly<{
    notificationId: string; artifactId: string; documentId: string; phase: "loading" | "editing";
  }> | null {
    const owner = this.#correctionOwner;
    if (!owner || !this.#correctionOwnerCurrent(owner)) return null;
    if (this.#busy !== "edit" && this.#editingArtifactId !== owner.artifactId) return null;
    return { notificationId: owner.notificationId, artifactId: owner.artifactId,
      documentId: owner.documentId, phase: this.#busy === "edit" ? "loading" : "editing" };
  }

  #correctionOwnerRetained(owner: ActivityCorrectionOwner) {
    const notification = this.store.projectNotifications.get().find(row => row.id === owner.notificationId);
    const context = this.store.session.get()?.projectContext;
    const artifact = notification ? this.#notificationArtifact(notification) : null;
    return this.#correctionOwner === owner && this.isConnected
      && this.store.sourceOwnershipActive(owner.source) && this.store.route.get() === owner.route
      && this.store.projection.get().projectId === owner.projectId
      && (!context || context.permissions.includes("project.author"))
      && notification?.id === owner.notificationId && notification.kind === "changes_requested"
      && notification.artifactId === owner.artifactId && notification.documentId === owner.documentId
      && artifact?.id === owner.artifactId && artifact.documentId === owner.documentId && artifact.contentRef === owner.contentRef
      && (this.#editingArtifactId !== owner.artifactId || typeof this.store.content.get()[owner.contentRef] === "string");
  }

  #correctionOwnerCurrent(owner: ActivityCorrectionOwner) {
    const notification = this.notification;
    return this.#correctionOwnerRetained(owner) && notification?.id === owner.notificationId
      && notification.kind === "changes_requested" && notification.artifactId === owner.artifactId
      && notification.documentId === owner.documentId;
  }

  #correctionStateChanged() {
    this.dispatchEvent(new CustomEvent("forma-activity-correction-state-changed", { bubbles: true, composed: true }));
  }

  #releaseCorrectionOwner() {
    if (!this.#correctionOwner) return;
    this.#correctionOwner = null;
    this.#correctionStateChanged();
  }

  readonly #retireCorrection = () => {
    if (!this.#correctionOwner || this.#correctionOwnerRetained(this.#correctionOwner)) return;
    this.#editingArtifactId = "";
    this.#editMarkdown = "";
    this.#editItems = [];
    if (this.#busy === "edit" || this.#busy === "save-edit") this.#busy = "";
    this.#releaseCorrectionOwner();
    this.requestUpdate();
  };

  protected override willUpdate() { this.#retireCorrection(); }

  readonly #clearPrivateState = () => {
    this.#releaseCorrectionOwner();
    this.#inspectionJob = null;
    this.#actorContent = {};
    this.#candidates = null;
    this.#candidate = null;
    this.#notes = null;
    this.#noteDraft = "";
    this.#reviewNote = "";
    this.#editingArtifactId = "";
    this.#editMarkdown = "";
    this.#editItems = [];
    this.#busy = "";
    this.#reviewUnavailable = false;
    this.requestUpdate();
  };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("forma-authorization-changed", this.#clearPrivateState);
    window.addEventListener("forma-event-source-retired", this.#retireCorrection);
  }

  override disconnectedCallback() {
    window.removeEventListener("forma-authorization-changed", this.#clearPrivateState);
    window.removeEventListener("forma-event-source-retired", this.#retireCorrection);
    this.#clearPrivateState();
    super.disconnectedCallback();
  }

  #scopeActive(scope: CapturedAuthorizationScope, jobId = "") {
    return this.store.authorizationScopeActive(scope) && (!jobId || this.job?.jobId === jobId);
  }

  async #inspectInputs(job: DocumentJob) {
    const scope = this.store.captureAuthorizationScope();
    if (!scope || this.#busy) return;
    this.#busy = "receipt";
    this.#actorContent = {};
    this.requestUpdate();
    try {
      let detail: DocumentJob;
      if (scope.shared) {
        const inspected = await this.store.loadActorDocumentGenerationReceipt(job.jobId);
        if (!this.#scopeActive(scope, job.jobId)) return;
        detail = inspected.job;
        this.#actorContent = inspected.content;
      } else {
        detail = await this.store.loadDocumentJobDetail(job.jobId);
        if (!this.#scopeActive(scope, job.jobId)) return;
        if (detail.moderationPromptRef && !this.store.content.get()[detail.moderationPromptRef]) {
          await this.store.ensurePrivateContent(detail.moderationPromptRef);
          if (!this.#scopeActive(scope, job.jobId)) return;
        }
      }
      if (detail.documentId !== job.documentId || !this.#scopeActive(scope, job.jobId)) return;
      this.#inspectionJob = detail;
    } catch (error) {
      if (this.#scopeActive(scope, job.jobId)) this.#reportFailure(error);
    } finally {
      if (this.#scopeActive(scope, job.jobId)) {
        this.#busy = "";
        this.requestUpdate();
      }
    }
  }

  async #loadCandidates(job: DocumentJob) {
    const scope = this.store.captureAuthorizationScope();
    if (!scope || this.#busy) return;
    this.#busy = "candidates";
    this.#candidates = [];
    this.#candidate = null;
    this.requestUpdate();
    try {
      const listing = await this.store.loadPresentationCandidates(job.jobId, job.documentId);
      if (!this.#scopeActive(scope, job.jobId)) return;
      this.#candidates = listing.candidates;
      const preferred = [...listing.candidates].sort((left, right) =>
        Number(right.complete) - Number(left.complete)
        || left.issues.filter((issue) => !issue.overridable).length - right.issues.filter((issue) => !issue.overridable).length
        || right.providerAttempt - left.providerAttempt)[0];
      if (preferred) {
        const detail = await this.store.loadPresentationCandidate(job.jobId, preferred.responseId, job.documentId);
        if (!this.#scopeActive(scope, job.jobId)) return;
        this.#candidate = detail;
      }
    } catch (error) {
      if (this.#scopeActive(scope, job.jobId)) this.#reportFailure(error);
    } finally {
      if (this.#scopeActive(scope, job.jobId)) {
        this.#busy = "";
        this.requestUpdate();
      }
    }
  }

  async #selectCandidate(job: DocumentJob, responseId: string) {
    const scope = this.store.captureAuthorizationScope();
    if (!scope || this.#busy || !this.#candidates?.some((candidate) => candidate.responseId === responseId)) return;
    this.#busy = "candidate";
    this.requestUpdate();
    try {
      const candidate = await this.store.loadPresentationCandidate(job.jobId, responseId, job.documentId);
      if (this.#scopeActive(scope, job.jobId)) this.#candidate = candidate;
    } catch (error) {
      if (this.#scopeActive(scope, job.jobId)) this.#reportFailure(error);
    } finally {
      if (this.#scopeActive(scope, job.jobId)) {
        this.#busy = "";
        this.requestUpdate();
      }
    }
  }

  async #loadNotes(job: DocumentJob, event: Event) {
    if (!(event.currentTarget instanceof HTMLDetailsElement) || !event.currentTarget.open || this.#notes !== null) return;
    const scope = this.store.captureAuthorizationScope();
    if (!scope) return;
    this.#notes = [];
    this.#busy = "notes";
    this.requestUpdate();
    try {
      const notes = await this.store.loadActivityIssueNotes(job.jobId);
      if (this.#scopeActive(scope, job.jobId)) this.#notes = notes;
    } catch (error) {
      if (this.#scopeActive(scope, job.jobId)) {
        this.#notes = null;
        this.#reportFailure(error);
      }
    } finally {
      if (this.#scopeActive(scope, job.jobId)) {
        this.#busy = "";
        this.requestUpdate();
      }
    }
  }

  async #saveNote(job: DocumentJob, event: SubmitEvent) {
    event.preventDefault();
    const scope = this.store.captureAuthorizationScope();
    const note = this.#noteDraft.trim();
    if (!scope || !note || note.length > 2_000 || this.#busy) return;
    this.#busy = "save-note";
    this.requestUpdate();
    try {
      const saved = await this.store.saveActivityIssueNote(job.jobId, note);
      if (!this.#scopeActive(scope, job.jobId)) return;
      this.#notes = [saved, ...(this.#notes ?? []).filter((previous) => previous.id !== saved.id)];
      this.#noteDraft = "";
      this.store.toast(this.i18n.t("activity.issue.noteSaved", "Private issue note saved."));
    } catch (error) {
      if (this.#scopeActive(scope, job.jobId)) this.#reportFailure(error);
    } finally {
      if (this.#scopeActive(scope, job.jobId)) {
        this.#busy = "";
        this.requestUpdate();
      }
    }
  }

  async #copyReport(job: DocumentJob) {
    const copied = await copyTextToClipboard(activityJobIssueReport(job, this.documentName));
    this.store.toast(copied
      ? this.i18n.t("activity.issue.reportCopied", "Safe issue report copied.")
      : this.i18n.t("activity.issue.reportCopyFailed", "The issue report could not be copied."));
  }

  #reviewArtifact(task: AssignedReviewTask): DocumentArtifact | null {
    const context = this.store.session.get()?.projectContext;
    if (!context || context.organizationId !== task.organizationId
      || context.projectAccessId !== task.projectAccessId || context.projectId !== task.projectId
      || !context.permissions.includes("project.review.approve")) return null;
    return this.store.projection.get().libraryArtifacts.find((artifact) =>
      artifact.id === task.artifactId && artifact.documentId === task.documentId
      && artifact.kind === task.artifactKind) ?? null;
  }

  async #resolveReview(task: AssignedReviewTask, decision: "approved" | "changes-requested", event?: SubmitEvent) {
    event?.preventDefault();
    const scope = this.store.captureAuthorizationScope();
    const artifact = this.#reviewArtifact(task);
    const note = this.#reviewNote.trim();
    if (!scope || !artifact || this.#busy || decision === "changes-requested" && (!note || note.length > 500)) return;
    this.#busy = "review";
    this.#reviewUnavailable = false;
    this.requestUpdate();
    try {
      const retained = artifact.contentRef ? await this.store.ensurePrivateContent(artifact.contentRef) : null;
      if (!this.store.authorizationScopeActive(scope) || this.review?.id !== task.id) return;
      const history = this.store.events.get();
      const revision = history.filter((entry) => entry.type === "DocumentArtifactEdited"
        && String(entry.payload.artifact_id ?? "") === artifact.id).length;
      if (!retained || revision !== task.revision || !this.#reviewArtifact(task)) {
        this.#reviewUnavailable = true;
        return;
      }
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(retained));
      if (!this.store.authorizationScopeActive(scope) || this.review?.id !== task.id) return;
      const sha256 = Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
      if (sha256 !== task.contentSha256) {
        this.#reviewUnavailable = true;
        return;
      }
      const projection = this.store.projection.get();
      const approvedIds = new Set((artifactSourceVersions(artifact.id, history) ?? [])
        .map((source) => String(source.block_id ?? "")));
      const sourceBlocks = projection.libraryBlocks.filter((block) =>
        block.scope === "document" && block.documentId === artifact.documentId
        && block.projectId === projection.projectId && approvedIds.has(block.id));
      if (decision === "approved"
        && ["stale", "unverified"].includes(artifactReviewState(artifact, sourceBlocks, history).status)) {
        this.#reviewUnavailable = true;
        return;
      }
      const appended = await this.store.append({
        type: decision === "approved" ? "ArtifactApproved" : "ArtifactChangesRequested",
        payload: {
          artifact_id: artifact.id,
          artifact_kind: artifact.kind,
          document_id: artifact.documentId,
          project_id: projection.projectId,
          artifact_revision: task.revision,
          content_sha256: sha256,
          ...(note && decision === "changes-requested" ? { review_note: note } : {}),
          source_block_versions: sourceBlocks.map((block) => ({ block_id: block.id, version: block.sourceEvents.length })),
          source_surface: "activity-inline-review",
        },
      });
      if (!this.store.authorizationScopeActive(scope) || !appended.length) return;
      this.#reviewNote = "";
      await Promise.all([this.store.syncReviewInbox(), this.store.syncProjectNotifications()]);
      if (!this.store.authorizationScopeActive(scope)) return;
      this.store.toast(decision === "approved"
        ? this.i18n.t("activity.issue.reviewSaved", "The exact output revision was approved.")
        : this.i18n.t("activity.issue.changesSaved", "The requested changes were sent to the author."));
    } catch (error) {
      if (this.store.authorizationScopeActive(scope)) this.#reportFailure(error);
    } finally {
      if (this.store.authorizationScopeActive(scope)) {
        this.#busy = "";
        this.requestUpdate();
      }
    }
  }

  #notificationArtifact(notification: ProjectNotification): DocumentArtifact | null {
    if (!notification.artifactId || !notification.documentId) return null;
    return this.store.projection.get().libraryArtifacts.find((artifact) =>
      artifact.id === notification.artifactId && artifact.documentId === notification.documentId) ?? null;
  }

  async #startCorrection(artifact: DocumentArtifact) {
    const scope = this.store.captureAuthorizationScope();
    const context = this.store.session.get()?.projectContext;
    if (!scope || !artifact.contentRef || context && !context.permissions.includes("project.author") || this.#busy) return;
    const source = this.store.captureSourceOwnership(), notification = this.notification;
    if (!source || !this.store.sourceOwnershipActive(source) || notification?.kind !== "changes_requested"
      || notification.artifactId !== artifact.id || notification.documentId !== artifact.documentId) return;
    const owner = Object.freeze({ notificationId: notification.id, artifactId: artifact.id,
      documentId: artifact.documentId, contentRef: artifact.contentRef, source,
      projectId: this.store.projection.get().projectId, route: this.store.route.get() });
    this.#correctionOwner = owner;
    this.#busy = "edit";
    this.#correctionStateChanged();
    this.requestUpdate();
    try {
      const retained = await this.store.ensurePrivateContent(artifact.contentRef);
      if (!this.store.authorizationScopeActive(scope) || !this.#correctionOwnerCurrent(owner)
        || this.#notificationArtifact(this.notification!)?.id !== artifact.id) return;
      const draft = parseDocumentArtifactContent(retained ?? undefined);
      if (!draft) return;
      this.#editingArtifactId = artifact.id;
      this.#editMarkdown = draft.content_markdown;
      this.#editItems = draft.items.map((item) => ({ title: item.title, body: item.body, notes: item.notes }));
      this.#editRevision = this.store.events.get().filter((entry) => entry.type === "DocumentArtifactEdited"
        && String(entry.payload.artifact_id ?? "") === artifact.id).length;
    } catch (error) {
      if (this.store.authorizationScopeActive(scope) && this.#correctionOwnerCurrent(owner)) this.#reportFailure(error);
    } finally {
      if (this.#correctionOwner === owner) {
        if (!this.#correctionOwnerCurrent(owner) || this.#editingArtifactId !== owner.artifactId) {
          this.#editingArtifactId = "";
          this.#editMarkdown = "";
          this.#editItems = [];
          this.#releaseCorrectionOwner();
        }
        this.#busy = "";
        this.#correctionStateChanged();
        this.requestUpdate();
      }
    }
  }

  async #saveCorrection(artifact: DocumentArtifact, event: SubmitEvent) {
    event.preventDefault();
    const scope = this.store.captureAuthorizationScope(), owner = this.#correctionOwner;
    if (!scope || !owner || !this.#correctionOwnerCurrent(owner)
      || this.#editingArtifactId !== artifact.id || !this.#editMarkdown.trim() || this.#busy) return;
    const source = this.store.captureSourceOwnership(), notification = this.notification ? { ...this.notification } : null, notificationId = notification?.id;
    // Feed parsing may replace an equivalent row. Bind the original correction
    // target/instructions, not the object instance or its read-status metadata.
    const notificationCurrent = () => Boolean(notification && this.notification
      && this.notification.id === notification.id && this.notification.kind === notification.kind
      && this.notification.artifactId === notification.artifactId && this.notification.documentId === notification.documentId
      && this.notification.message === notification.message && this.notification.createdAt === notification.createdAt);
    const artifactId = artifact.id, documentId = artifact.documentId, contentRef = artifact.contentRef ?? "";
    const route = this.store.route.get(), projectId = this.store.projection.get().projectId;
    const editItems = this.#editItems, draftRevision = this.#editDraftRevision, retainedBefore = this.store.content.get()[contentRef];
    const input = {
      markdown: this.#editMarkdown,
      items: editItems.map((item, index) => ({ index, ...item })),
      expectedRevision: this.#editRevision,
    };
    const current = () => this.store.authorizationScopeActive(scope) && this.store.sourceOwnershipActive(source)
      && this.#correctionOwnerCurrent(owner)
      && notificationCurrent() && this.#editingArtifactId === artifactId && this.#editItems === editItems
      && this.#editRevision === input.expectedRevision && this.store.route.get() === route && this.store.projection.get().projectId === projectId
      && Boolean(notification && this.#notificationArtifact(notification)?.documentId === documentId
        && this.#notificationArtifact(notification)?.contentRef === contentRef);
    if (!current()) return;
    this.#busy = "save-edit";
    this.requestUpdate();
    try {
      const saved = await this.store.reviseDocumentArtifact(artifact.id, input);
      if (!saved || !current()) return;
      const revision = documentArtifactRevision(this.store.events.get(), artifactId);
      let matches = false;
      try {
        const retained = JSON.parse(this.store.content.get()[contentRef] ?? "") as {
          content_markdown?: unknown; items?: Array<{ title?: unknown; body?: unknown; notes?: unknown }>;
        };
        const unchanged = revision === input.expectedRevision && this.store.content.get()[contentRef] === retainedBefore;
        matches = (revision === input.expectedRevision + 1 || unchanged) && retained.content_markdown === input.markdown
          && Array.isArray(retained.items) && retained.items.length === input.items.length
          && input.items.every((item, index) => retained.items![index]?.title === item.title
            && retained.items![index]?.body === item.body && retained.items![index]?.notes === item.notes);
      } catch { /* An unverified current revision cannot rebase or dismiss a newer correction. */ }
      if (!matches) return;
      if (this.#editDraftRevision !== draftRevision) {
        this.#editRevision = revision;
        return; // B remains unsaved; A cannot move its notification out of view.
      }
      this.#editingArtifactId = "";
      this.#editMarkdown = "";
      this.#editItems = [];
      this.#releaseCorrectionOwner();
      if (notificationId && !notification?.readAt && this.notification?.readAt === notification.readAt) await this.store.acknowledgeProjectNotification(notificationId);
    } finally {
      if (this.store.authorizationScopeActive(scope) && (this.#correctionOwner === owner || !this.#correctionOwner)) {
        this.#busy = "";
        this.requestUpdate();
      }
    }
  }

  async #applyContext(binding: OrganizationContextBinding, action: "accept" | "pin", event?: SubmitEvent) {
    event?.preventDefault();
    const scope = this.store.captureAuthorizationScope();
    const current = this.#pendingBindings().find((entry) => entry.id === binding.id);
    if (!scope || !current || current.pendingVersionId !== binding.pendingVersionId || this.#busy) return;
    if (action === "accept") {
      const form = event?.currentTarget;
      if (!(form instanceof HTMLFormElement) || new FormData(form).get("confirmContext") !== "on") return;
    }
    this.#busy = `${action}:${binding.id}`;
    this.requestUpdate();
    try {
      const success = action === "accept"
        ? await this.store.acceptOrganizationContextPackageUpdate(binding.packageId, binding.id, binding.pendingVersionId!)
        : await this.store.setOrganizationContextPackageUpdateMode(binding.packageId, binding.id, "pinned");
      if (!this.store.authorizationScopeActive(scope) || !success) return;
      if (this.notification && !this.notification.readAt) await this.store.acknowledgeProjectNotification(this.notification.id);
      if (!this.store.authorizationScopeActive(scope)) return;
      this.store.toast(action === "accept"
        ? this.i18n.t("activity.issue.contextAccepted", "The reviewed context update was applied.")
        : this.i18n.t("activity.issue.contextPinned", "This document remains pinned to its current context version."));
    } finally {
      if (this.store.authorizationScopeActive(scope)) {
        this.#busy = "";
        this.requestUpdate();
      }
    }
  }

  #pendingBindings(): OrganizationContextBinding[] {
    const context = this.store.session.get()?.projectContext;
    const notification = this.notification;
    if (!context || notification?.kind !== "context_update_available" || !notification.documentId
      || !context.permissions.includes("project.author")) return [];
    return this.store.organizationContextBindings.get().filter((binding) =>
      binding.organizationId === context.organizationId && binding.projectAccessId === context.projectAccessId
      && binding.documentId === notification.documentId && Boolean(binding.pendingVersionId));
  }

  #reportFailure(error: unknown) {
    this.store.toast(error instanceof Error
      ? error.message
      : this.i18n.t("activity.issue.detailUnavailable", "The private issue details could not be loaded."));
  }

  #candidatePanel(job: DocumentJob) {
    if (this.#candidates === null) return nothing;
    const candidate = this.#candidate;
    return html`<section class="forma-activity-issue-draft" aria-label=${this.i18n.t("presentation.draft.regionLabel", "Private rejected presentation drafts")}>
      <p class="forma-activity-issue-private">${this.i18n.t("presentation.draft.privacyNotice", "Only you can see this material. It cannot be shared, exported, or promoted from this review.")}</p>
      ${this.#busy === "candidates" || this.#busy === "candidate"
        ? html`<p role="status">${this.i18n.t("presentation.draft.loading", "Loading your actor-private presentation evidence…")}</p>` : nothing}
      ${this.#candidates.length ? html`<nav class="forma-activity-issue-actions" aria-label=${this.i18n.t("presentation.draft.alternativesLabel", "Generated provider alternatives")}>
        ${this.#candidates.map((entry) => html`<button type="button" class=${`button ${candidate?.responseId === entry.responseId ? "primary" : "secondary"} compact`}
          ?disabled=${Boolean(this.#busy)} @click=${() => void this.#selectCandidate(job, entry.responseId)}>
          ${this.i18n.t("presentation.draft.attemptButton", "{stage} · attempt {attempt} · page {page}", {
            stage: entry.stage === "repair" ? this.i18n.t("presentation.draft.repair", "Repair") : this.i18n.t("presentation.draft.initial", "Initial"),
            attempt: this.i18n.number(entry.providerAttempt), page: this.i18n.number(entry.pageIndex + 1),
          })}</button>`)}
      </nav>` : !this.#busy ? html`<p>${this.i18n.t("presentation.draft.expired", "No unexpired, authorized provider drafts remain for this generation.")}</p>` : nothing}
      ${candidate ? html`<div class="forma-activity-issue-draft-preview"><b dir="auto">${candidate.title || this.i18n.t("presentation.draft.rejectedTitle", "Rejected presentation draft")}</b>
        ${candidate.reviewOnlyReason === "historical-validation-rejection" ? html`<p>${this.i18n.t("presentation.draft.historicalRejection", "This response was rejected under an earlier validation contract. Current checks are for private review only and cannot approve or recover it. The original receipt is unchanged.")}</p>` : nothing}
        ${candidate.summary ? html`<p dir="auto">${candidate.summary}</p>` : nothing}
        ${candidate.slides.length ? html`<ol>${candidate.slides.slice(0, 4).map((slide, index) => html`<li><b dir="auto">${this.i18n.t("presentation.draft.slideHeading", "Slide {slide}: {title}", {
          slide: this.i18n.number(candidate.globalStartIndex + index + 1), title: slide.title,
        })}</b>${slide.body ? html`<p dir="auto">${slide.body}</p>` : nothing}</li>`)}</ol>` : nothing}
      </div>` : nothing}
    </section>`;
  }

  #jobPanel(job: DocumentJob) {
    const evidence = activityJobEvidence(job);
    const disposition = activityJobDisposition(job);
    const detail = documentJobFailure(job);
    const guidance = generationFailureGuidance(detail, job.error ?? "", job);
    const retryableImage = guidance.retryAllowed && ["preview", "generate", "prompt_fan"].includes(job.kind)
      && this.store.projection.get().documentId === job.documentId;
    const failedInput = this.#inspectionJob
      ? failedGenerationInputInspection(this.#inspectionJob, this.store.events.get(),
        this.store.session.get()?.projectContext ? this.#actorContent : this.store.content.get())
      : null;

    return html`<section class="forma-activity-issue-panel" aria-label=${this.i18n.t("activity.issue.heading", "What needs attention")}>
      ${evidence.length ? html`<h4>${this.i18n.t("activity.issue.heading", "What needs attention")}</h4><ol class="forma-activity-issue-list">${evidence.map((issue) => html`<li>
        <b>${issue.globalSlideIndex
          ? this.i18n.t("presentation.draft.issueSlide", "Slide {slide} · {code}", { slide: this.i18n.number(issue.globalSlideIndex), code: issue.code })
          : issue.code}</b><span>${issue.message}</span><code>${this.i18n.t("activity.issue.field", "Field: {path}", { path: issue.path })}</code>
        <small>${this.i18n.t("presentation.draft.issueMetadata", "{category} · {stage} attempt {attempt} · {requirement}", {
          category: issue.category,
          stage: issue.stage === "repair" ? this.i18n.t("presentation.draft.repair", "Repair") : this.i18n.t("presentation.draft.initial", "Initial"),
          attempt: this.i18n.number(issue.providerAttempt),
          requirement: issue.overridable
            ? this.i18n.t("presentation.draft.preference", "presentation preference; still requires explicit revision and full validation")
            : this.i18n.t("presentation.draft.mandatory", "mandatory validation"),
        })}</small>
      </li>`)}</ol>` : nothing}
      <details class="forma-activity-issue-guidance"><summary>${this.i18n.t("activity.issue.nextSteps", "Recommended next step")}</summary>
        <p>${this.i18n.t(`activity.issue.step.${disposition}`, "Inspect the private generation receipt and copy a safe issue report if you need help.")}</p>
      </details>
      <div class="forma-activity-issue-actions">
        <button type="button" class="button secondary compact" ?disabled=${Boolean(this.#busy) && this.#busy !== "receipt"} aria-disabled=${this.#busy ? "true" : "false"} @click=${() => void this.#inspectInputs(job)}>${this.i18n.t("activity.issue.inspectInputs", "Inspect request and receipt")}</button>
        ${job.kind === "render_document" && job.result?.artifactKind === "slides"
          ? html`<button type="button" class="button secondary compact" ?disabled=${Boolean(this.#busy)} @click=${() => void this.#loadCandidates(job)}>${this.i18n.t("presentation.draft.review", "Review generated drafts")}</button>`
          : nothing}
        <button type="button" class="button ghost compact" @click=${() => void this.#copyReport(job)}>${this.i18n.t("activity.issue.copyReport", "Copy issue report")}</button>
        ${retryableImage ? html`<button type="button" class="button secondary compact" title=${this.i18n.t("activity.issue.tryAgainHint", "A new generation may incur provider usage.")}
          @click=${() => void this.store.retryDocumentGeneration(job)}>${this.i18n.t("activity.issue.tryAgain", "Explicitly try again")}</button>` : nothing}
      </div>
      ${this.#candidatePanel(job)}
      <details class="forma-activity-issue-notes" @toggle=${(event: Event) => void this.#loadNotes(job, event)}>
        <summary>${this.i18n.t("activity.issue.notes", "Private issue notes")}</summary>
        <p class="forma-activity-issue-private">${this.i18n.t("activity.issue.notesDescription", "Only you can see these saved notes. They are never added to shared activity.")}</p>
        ${this.#notes?.length ? html`<ol class="forma-activity-issue-note-list">${this.#notes.map((note) => html`<li><p dir="auto">${note.body}</p>
          <time datetime=${note.createdAt}>${this.i18n.date(new Date(note.createdAt), { dateStyle: "medium", timeStyle: "short" })}</time></li>`)}</ol>`
          : this.#busy !== "notes" ? html`<p>${this.i18n.t("activity.issue.notesEmpty", "No private notes yet.")}</p>` : nothing}
        <form @submit=${(event: SubmitEvent) => void this.#saveNote(job, event)}>
          <label>${this.i18n.t("activity.issue.noteLabel", "Add a private note")}<textarea required maxlength="2000" rows="3"
            placeholder=${this.i18n.t("activity.issue.notePlaceholder", "Record what happened, what you checked, or the next action…")}
            .value=${this.#noteDraft} ?readonly=${this.#busy === "save-note"} @input=${(event: Event) => { this.#noteDraft = (event.currentTarget as HTMLTextAreaElement).value; }}></textarea></label>
          <button type="submit" class="button secondary compact" ?disabled=${Boolean(this.#busy)}>${this.#busy === "save-note"
            ? this.i18n.t("activity.issue.savingNote", "Saving private note…") : this.i18n.t("activity.issue.saveNote", "Save private note")}</button>
        </form>
      </details>
      ${failedInput ? html`<forma-generation-input-dialog .open=${true} .inspection=${failedInput}
        @generation-input-close=${() => { this.#inspectionJob = null; this.#actorContent = {}; this.requestUpdate(); }}></forma-generation-input-dialog>` : nothing}
    </section>`;
  }

  #reviewPanel(task: AssignedReviewTask) {
    const artifact = this.#reviewArtifact(task);
    if (!artifact) return nothing;
    const context = this.reviewContext?.identity === JSON.stringify([task.id, task.organizationId, task.projectAccessId, task.projectId, task.documentId, task.artifactId, task.artifactKind, task.revision, task.contentSha256, task.artifactTitle, task.documentTitle, task.projectName, task.organizationName]) ? this.reviewContext.name : "";
    const named = (label: string) => context ? this.i18n.t("artifact.delivery.namedAction", "{action} — {name}", { action: label, name: context }) : label;
    return html`<section class="forma-activity-issue-panel forma-activity-issue-review" aria-label=${named(this.i18n.t("activity.issue.reviewHere", "Review this exact output here"))}>
      <h4 aria-label=${named(this.i18n.t("activity.issue.reviewHere", "Review this exact output here"))}>${this.i18n.t("activity.issue.reviewHere", "Review this exact output here")}</h4>
      ${this.#artifactPreview(artifact)}
      ${this.#reviewUnavailable ? html`<p role="alert">${this.i18n.t("activity.issue.reviewUnavailable", "This output changed or is no longer available. Open the assigned review to verify its latest version.")}</p>` : nothing}
      <button type="button" class="button primary compact" aria-label=${named(this.i18n.t("activity.issue.approve", "Approve output"))} ?disabled=${Boolean(this.#busy)} @click=${() => void this.#resolveReview(task, "approved")}>${this.i18n.t("activity.issue.approve", "Approve output")}</button>
      <form aria-label=${named(this.i18n.t("activity.issue.requestChanges", "Request changes"))} @submit=${(event: SubmitEvent) => void this.#resolveReview(task, "changes-requested", event)}>
        <label>${this.i18n.t("activity.issue.reviewNote", "Describe the required changes")}<textarea required maxlength="500" rows="2" aria-label=${named(this.i18n.t("activity.issue.reviewNote", "Describe the required changes"))}
          placeholder=${this.i18n.t("activity.issue.reviewNotePlaceholder", "Explain precisely what the author should correct…")}
          .value=${this.#reviewNote} ?readonly=${this.#busy === "review"} @input=${(event: Event) => { this.#reviewNote = (event.currentTarget as HTMLTextAreaElement).value; }}></textarea></label>
        <button type="submit" class="button secondary compact" aria-label=${named(this.i18n.t("activity.issue.requestChanges", "Request changes"))} ?disabled=${Boolean(this.#busy)}>${this.i18n.t("activity.issue.requestChanges", "Request changes")}</button>
      </form>
    </section>`;
  }

  #artifactPreview(artifact: DocumentArtifact) {
    return html`<div class="forma-activity-issue-output"><b dir="auto">${artifact.title}</b>
      ${artifact.summary ? html`<p dir="auto">${artifact.summary}</p>` : nothing}
      ${artifact.items.length ? html`<ol>${artifact.items.slice(0, 3).map((item) => html`<li dir="auto">${item.title}</li>`)}</ol>` : nothing}
    </div>`;
  }

  #contextChange(binding: OrganizationContextBinding) {
    const versions = this.store.organizationContextVersions.get();
    const current = versions[binding.versionId];
    const next = versions[binding.pendingVersionId ?? ""];
    const source = this.store.organizationContextPackages.get().find((entry) => entry.id === binding.packageId);
    if (!source || !current || !next) return nothing;
    const previous = new Map(current.blocks.map((block) => [block.sourceBlockId, block]));
    const following = new Map(next.blocks.map((block) => [block.sourceBlockId, block]));
    const added = next.blocks.filter((block) => !previous.has(block.sourceBlockId));
    const removed = current.blocks.filter((block) => !following.has(block.sourceBlockId));
    const changed = next.blocks.filter((block) => {
      const prior = previous.get(block.sourceBlockId);
      return Boolean(prior && (prior.contentSha256 !== block.contentSha256
        || prior.source?.contentSha256 !== block.source?.contentSha256));
    });
    const relations = (version: OrganizationContextVersion) => version.relations
      .map((relation) => JSON.stringify([relation.fromSourceBlockId, relation.toSourceBlockId, relation.kind, relation.properties ?? {}]))
      .sort().join("\n");
    const relationChange = relations(current) !== relations(next);
    return html`<section class="forma-activity-issue-context"><h4>${this.i18n.t("activity.issue.contextHeading", "Review this exact context update")}</h4>
      <p><b dir="auto">${source.name}</b> · ${this.i18n.t("activity.issue.contextVersion", "Version {current} → {next}", {
        current: this.i18n.number(current.version), next: this.i18n.number(next.version),
      })}</p>
      ${added.length || removed.length || changed.length || relationChange ? html`<ul>
        ${added.map((block) => html`<li dir="auto">${this.i18n.t("activity.issue.added", "Added: {name}", { name: block.handle })}</li>`)}
        ${removed.map((block) => html`<li dir="auto">${this.i18n.t("activity.issue.removed", "Removed: {name}", { name: block.handle })}</li>`)}
        ${changed.map((block) => html`<li dir="auto">${this.i18n.t("activity.issue.changed", "Changed: {name}", { name: block.handle })}</li>`)}
        ${relationChange ? html`<li>${this.i18n.t("activity.issue.relationsChanged", "Source relationships changed.")}</li>` : nothing}
      </ul>` : nothing}
      <form @submit=${(event: SubmitEvent) => void this.#applyContext(binding, "accept", event)}>
        <label class="forma-activity-issue-confirm"><input type="checkbox" name="confirmContext" required> ${this.i18n.t("activity.issue.confirmContext", "I reviewed these changes and want to apply this exact version.")}</label>
        <button type="submit" class="button primary compact" ?disabled=${Boolean(this.#busy)}>${this.i18n.t("activity.issue.acceptVersion", "Accept this version")}</button>
      </form>
      <button type="button" class="button ghost compact" title=${this.i18n.t("activity.issue.pinExplanation", "Pins this document to its current version and stops offering future automatic updates.")}
        ?disabled=${Boolean(this.#busy)} @click=${() => void this.#applyContext(binding, "pin")}>${this.i18n.t("activity.issue.pinVersion", "Keep current version")}</button>
    </section>`;
  }

  #notificationPanel(notification: ProjectNotification) {
    if (notification.kind === "context_update_available") {
      const bindings = this.#pendingBindings();
      return bindings.length ? html`<section class="forma-activity-issue-panel">${bindings.map((binding) => this.#contextChange(binding))}</section>` : nothing;
    }
    const artifact = this.#notificationArtifact(notification);
    if (!artifact || notification.kind !== "changes_requested") return nothing;
    const context = this.store.session.get()?.projectContext;
    if (context && !context.permissions.includes("project.author")) return nothing;
    return html`<section class="forma-activity-issue-panel forma-activity-issue-correction">
      ${this.#artifactPreview(artifact)}
      ${this.#editingArtifactId === artifact.id && this.#correctionOwner && this.#correctionOwnerCurrent(this.#correctionOwner) ? html`<form @submit=${(event: SubmitEvent) => void this.#saveCorrection(artifact, event)}>
        <label>${this.i18n.t("activity.issue.editLabel", "Output content")}<textarea required rows="8" .value=${this.#editMarkdown}
          @input=${(event: Event) => { this.#editMarkdown = (event.currentTarget as HTMLTextAreaElement).value; this.#editDraftRevision++; }}></textarea></label>
        ${this.#editItems.map((item, index) => html`<fieldset><legend>${this.i18n.t("presentation.draft.slideHeading", "Slide {slide}: {title}", {
          slide: this.i18n.number(index + 1), title: item.title,
        })}</legend><input aria-label=${this.i18n.t("activity.issue.itemTitle", "Item title")} .value=${item.title}
          @input=${(event: Event) => { item.title = (event.currentTarget as HTMLInputElement).value; this.#editDraftRevision++; }}>
          <textarea aria-label=${this.i18n.t("activity.issue.editLabel", "Output content")} rows="3" .value=${item.body}
            @input=${(event: Event) => { item.body = (event.currentTarget as HTMLTextAreaElement).value; this.#editDraftRevision++; }}></textarea>
          <textarea aria-label=${this.i18n.t("presentation.draft.speakerNotes", "Speaker notes")} rows="2" .value=${item.notes}
            @input=${(event: Event) => { item.notes = (event.currentTarget as HTMLTextAreaElement).value; this.#editDraftRevision++; }}></textarea></fieldset>`)}
        <div class="forma-activity-issue-actions"><button type="submit" class="button primary compact" ?disabled=${Boolean(this.#busy)}>${this.#busy === "save-edit"
          ? this.i18n.t("activity.issue.saving", "Saving…") : this.i18n.t("activity.issue.saveCorrection", "Save correction without regenerating")}</button>
          <button type="button" class="button ghost compact" @click=${() => { this.#editingArtifactId = ""; this.#editMarkdown = ""; this.#editItems = []; this.#releaseCorrectionOwner(); this.requestUpdate(); }}>${this.i18n.t("activity.issue.cancel", "Cancel")}</button></div>
      </form>` : html`<button type="button" class="button secondary compact" ?disabled=${Boolean(this.#busy)}
        @click=${() => void this.#startCorrection(artifact)}>${this.i18n.t("activity.issue.editOutput", "Correct this output here")}</button>`}
    </section>`;
  }

  override render() {
    if (this.job && ["failed", "partial"].includes(this.job.status)) return this.#jobPanel(this.job);
    if (this.review) return this.#reviewPanel(this.review);
    if (this.notification) return this.#notificationPanel(this.notification);
    return nothing;
  }
}

if (!customElements.get("forma-activity-issue-panel")) customElements.define("forma-activity-issue-panel", FormaActivityIssuePanel);
declare global { interface HTMLElementTagNameMap { "forma-activity-issue-panel": FormaActivityIssuePanel } }
