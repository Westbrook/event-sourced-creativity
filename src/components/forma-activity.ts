import { html, nothing } from "lit";
import { formaActivityUnread, scopedFormaActivity } from "../model/activity";
import { documentArtifactDefinition, isDocumentArtifactKind } from "../model/document-artifacts";
import {
  authorizedGenerationFailureRemediation,
  documentJobCanRecoverPresentation,
  documentJobCanRecoverProviderRender,
  documentJobFailure,
  documentJobProgress,
  generationFailureGuidance,
  type DocumentJob,
} from "../model/document-jobs";
import { libraryFocusRoute } from "../model/routes";
import type { AssignedReviewTask, ProjectNotification } from "../state/store";
import {
  localizedDocumentJobProgress,
  localizedDocumentJobProgressDetail,
  localizedGenerationFailureGuidance,
} from "./design-system/localized-runtime-copy";
import { FormaElement, icon } from "./forma-element";
import "./forma-activity-issue-panel";
import "./project-rail";

const jobLabels: Record<string, string> = {
  preview: "Image preview",
  generate: "Image generation",
  prompt_fan: "Creative directions",
  chat: "Creative conversation",
  structure_adaptive: "Adaptive structure",
  extract_reference: "Reference analysis",
  render_document: "Document rendering",
};

export class FormaActivity extends FormaElement {
  override connectedCallback() {
    super.connectedCallback();
    const session = this.store.session.get();
    if (!session) return;
    void this.store.syncReviewInbox();
    if (session.projectContext) {
      void this.store.syncProjectNotifications();
      void this.store.syncOrganizationContextPackages();
    }
    void this.store.syncDocumentJobs();
  }

  #open(path: string) { this.store.setRoute(path); }

  #review(task: AssignedReviewTask) {
    return html`<article class="forma-activity-card forma-activity-card--attention">
      <div class="forma-activity-card-icon" aria-hidden="true">${icon("check")}</div>
      <div class="forma-activity-card-copy"><span class="eyebrow">${this.i18n.t("activity.review", "Assigned review")}</span><h3 dir="auto">${task.artifactTitle||this.i18n.system("Finished output")} · ${this.i18n.t("activity.reviewRevision", "Review revision {revision}", { revision: String(task.revision) })}</h3><p dir="auto">${[task.projectName,task.documentTitle].filter(Boolean).join(" · ")||task.organizationName}</p><p>${this.i18n.t("activity.requestedBy", "Requested by {name}", { name: task.requestedByName })}</p>${task.dueAt ? html`<small>${this.i18n.t("activity.due", "Due {date}", { date: new Date(task.dueAt).toLocaleDateString(this.i18n.locale) })}</small>` : nothing}<forma-activity-issue-panel .review=${task}></forma-activity-issue-panel></div>
      <button type="button" class="button primary" @click=${() => void this.store.openAssignedReview(task)}>${this.i18n.t("activity.openReview", "Open assigned review")} ${icon("arrow")}</button>
    </article>`;
  }

  #notification(notification: ProjectNotification, documentName: string) {
    const projection = this.store.projection.get();
    const artifact = notification.artifactId ? projection.libraryArtifacts.find((entry) => entry.id === notification.artifactId) : undefined;
    const document = notification.documentId ? projection.documents.find((entry) => entry.id === notification.documentId) : undefined;
    return html`<article class=${`forma-activity-card ${notification.readAt ? "" : "forma-activity-card--unread"}`}>
      <div class="forma-activity-card-icon" aria-hidden="true">${icon("spark")}</div>
      <div class="forma-activity-card-copy"><span class="eyebrow">${this.i18n.t("activity.projectUpdate", "Project update")}</span><h3>${notification.kind==="changes_requested"&&notification.message?notification.message:this.i18n.t(`notifications.${notification.kind}.detail`,this.i18n.system(notification.message))}</h3><p>${documentName} · ${new Date(notification.createdAt).toLocaleString(this.i18n.locale)}</p><forma-activity-issue-panel .notification=${notification}></forma-activity-issue-panel></div>
      <div class="forma-activity-card-actions">${artifact ? html`<button type="button" class="button secondary" @click=${() => this.#open(libraryFocusRoute("artifact", artifact.id, artifact.title))}>${this.i18n.t("activity.openResult", "Open result")}</button>` : document ? html`<button type="button" class="button secondary" @click=${() => void this.store.openDocument(document.id, "/")}>${this.i18n.t("activity.openDocument", "Open document")}</button>` : nothing}${!notification.readAt ? html`<button type="button" class="button ghost" @click=${() => void this.store.acknowledgeProjectNotification(notification.id)}>${this.i18n.t("activity.markRead", "Mark as read")}</button>` : nothing}</div>
    </article>`;
  }

  #job(job: DocumentJob, documentName: string) {
    const failed = ["failed", "partial"].includes(job.status);
    const active = ["queued", "running", "committing"].includes(job.status);
    const artifactKind = isDocumentArtifactKind(job.result?.artifactKind) ? job.result.artifactKind : null;
    const operation = artifactKind
      ? this.i18n.t(`artifact.${artifactKind}.label`, documentArtifactDefinition(artifactKind).label)
      : this.i18n.t(`activity.kind.${job.kind}`, jobLabels[job.kind] ?? this.i18n.t("activity.documentOperation", "Document operation"));
    const failure = failed ? documentJobFailure(job) : null;
    const guidance = failed
      ? localizedGenerationFailureGuidance(generationFailureGuidance(failure, job.error ?? "", job), failure, job.error ?? "", this.i18n)
      : null;
    const presentationRecoverable = documentJobCanRecoverPresentation(job);
    const providerRecoverable = Boolean(guidance?.retryAllowed && documentJobCanRecoverProviderRender(job));
    const recoverable = presentationRecoverable || providerRecoverable;
    const remediation = guidance && !recoverable ? authorizedGenerationFailureRemediation(guidance, this.store.session.get()) : null;
    const progress = active ? documentJobProgress(job) : null;
    const progressMessage = active ? localizedDocumentJobProgress(job, this.i18n) : "";
    const progressDetail = progress?.detail ? localizedDocumentJobProgressDetail(progress.detail, job, this.i18n) : null;
    const timestamp = new Date(job.completedAt ?? job.updatedAt ?? job.requestedAt);
    const updatedAt = Number.isNaN(timestamp.getTime()) ? null : timestamp;
    const attention = failed ? " forma-activity-card--attention" : "";
    const terminal = failed && !recoverable && !guidance?.retryAllowed ? " forma-activity-card--terminal" : "";
    return html`<article class=${`forma-activity-card forma-activity-card--job${attention}${terminal}`} data-activity-status=${job.status}>
      <div class="forma-activity-card-icon" aria-hidden="true">${icon(failed ? "info" : active ? "clock" : "check")}</div>
      <div class="forma-activity-card-copy">
        <span class="eyebrow">${this.i18n.t("activity.privateOperation", "Your private operation")}${failed ? html` · ${operation}` : nothing}</span>
        <h3>${guidance?.title ?? operation}</h3>
        <p class="forma-activity-card-metadata"><span dir="auto">${documentName}</span><span class="forma-activity-card-status">${this.i18n.t(`activity.status.${job.status}`, job.status)}</span>${updatedAt ? html`<time datetime=${updatedAt.toISOString()}>${this.i18n.date(updatedAt, { dateStyle: "medium", timeStyle: "short" })}</time>` : nothing}</p>
        ${guidance ? html`<p class="forma-activity-card-explanation">${guidance.summary}</p>` : progressMessage ? html`<p class="forma-activity-card-progress">${progressMessage}${progressDetail && progressDetail !== progressMessage ? html`<span>${progressDetail}</span>` : nothing}</p>` : nothing}
        ${recoverable ? html`<small class="forma-activity-card-recovery-note">${this.i18n.system("Paid once · replay without another provider call")}</small>` : nothing}
        ${failed ? html`<forma-activity-issue-panel .job=${job} .documentName=${documentName}></forma-activity-issue-panel>` : nothing}
      </div>
      <div class="forma-activity-card-actions">
        ${recoverable ? html`<button type="button" class="button primary" @click=${() => void (presentationRecoverable ? this.store.recoverDocumentPresentation(job.jobId) : this.store.recoverDocumentRender(job.jobId))}>${this.i18n.system("Recover saved render")}</button>` : remediation ? html`<a class="button primary" href=${remediation.href} target=${remediation.external ? "_blank" : "_self"} rel=${remediation.external ? "noopener noreferrer" : nothing}>${remediation.label}</a>` : nothing}
        <button type="button" class="button secondary" @click=${() => void this.store.openDocument(job.documentId, job.kind === "chat" ? "/studio/chat" : job.kind === "structure_adaptive" ? "/studio/adaptive" : "/")}>${this.i18n.t("activity.openDocument", "Open document")} ${icon("arrow")}</button>
        ${failed ? html`<button type="button" class="button ghost" aria-label=${this.i18n.system("Dismiss this generation issue")} @click=${() => void this.store.dismissDocumentJobFailure(job.jobId)}>${this.i18n.system("Dismiss notice")}</button>` : nothing}
      </div>
    </article>`;
  }

  override render() {
    const session = this.store.session.get();
    const projection = this.store.projection.get();
    const activity = scopedFormaActivity(session, projection, this.store.projectNotifications.get(), this.store.reviewInbox.get(), this.store.documentJobs.get());
    const documentNames = new Map(activity.documents.map((document) => [document.id, document.title]));
    const activeJobs = activity.jobs.filter((job) => ["queued", "running", "committing"].includes(job.status));
    const failedJobs = activity.jobs.filter((job) => ["failed", "partial"].includes(job.status) && !job.dismissedAt);
    const completedJobs = activity.jobs.filter((job) => job.status === "completed");
    const unread = formaActivityUnread(activity);
    const read = activity.notifications.filter((notification) => notification.readAt);
    const documentIds = new Set(activity.documents.map((document) => document.id));
    const readyArtifacts = projection.libraryArtifacts.filter((artifact) => documentIds.has(artifact.documentId)).slice(0, 6);
    const readyOutputs = projection.libraryOutputs.filter((output) => documentIds.has(output.documentId)).slice(0, 6);

    return html`<section class="workspace-page studio-subpage forma-activity-page"><forma-project-rail surface="studio" destination="/activity" quiet></forma-project-rail>
      <div class="studio-main forma-activity-main"><header class="page-header page-header--document"><div class="page-header-copy"><span class="eyebrow">${projection.projectName ? `${projection.projectName} / ` : ""}${this.i18n.t("activity.inbox", "Activity · inbox")}</span><h1>${this.i18n.t("shell.navigation.activity", "Activity")}</h1><p>${this.i18n.t("activity.description", "Keep track of assigned reviews, authorized project updates, and your own background operations.")}</p></div><div class="forma-activity-header-actions">${session?.projectContext ? html`<button type="button" class="button ghost" @click=${async () => { if (await this.store.leaveProjectContext()) this.store.setRoute("/activity"); }}>${this.i18n.t("activity.viewAllAssignments", "View all my assigned reviews")}</button>` : nothing}<a class="button secondary" href="/deliver" @click=${(event: MouseEvent) => { event.preventDefault(); this.#open("/deliver"); }}>${this.i18n.t("activity.openDeliverables", "View deliverables")} ${icon("arrow")}</a></div></header>
        <div class="forma-activity-sections">
          ${activity.reviews.length || unread.length || failedJobs.length ? html`<section class="forma-activity-group"><header class="forma-activity-group-heading"><h2>${this.i18n.t("activity.needsYou", "Needs you")}</h2><span>${activity.reviews.length + unread.length + failedJobs.length}</span></header><div class="forma-activity-list">${activity.reviews.map((task) => this.#review(task))}${failedJobs.map((job) => this.#job(job, documentNames.get(job.documentId) ?? projection.projectName))}${unread.map((notification) => this.#notification(notification, documentNames.get(notification.documentId ?? "") ?? projection.projectName))}</div></section>` : nothing}
          ${activeJobs.length ? html`<section class="forma-activity-group"><header class="forma-activity-group-heading"><h2>${this.i18n.t("activity.inProgress", "In progress")}</h2><span>${activeJobs.length}</span></header><div class="forma-activity-list">${activeJobs.map((job) => this.#job(job, documentNames.get(job.documentId) ?? projection.projectName))}</div></section>` : nothing}
          ${readyArtifacts.length || readyOutputs.length || completedJobs.length ? html`<section class="forma-activity-group"><header class="forma-activity-group-heading"><h2>${this.i18n.t("activity.ready", "Ready to continue")}</h2><span>${readyArtifacts.length + readyOutputs.length + completedJobs.length}</span></header><div class="forma-activity-list">${readyArtifacts.map((artifact) => html`<article class="forma-activity-card"><div class="forma-activity-card-icon" aria-hidden="true">${icon("check")}</div><div class="forma-activity-card-copy"><span class="eyebrow">${this.i18n.system(documentArtifactDefinition(artifact.kind).label)}</span><h3>${artifact.title}</h3><p>${documentNames.get(artifact.documentId) ?? projection.projectName}</p></div><button type="button" class="button secondary" @click=${() => this.#open(libraryFocusRoute("artifact", artifact.id, artifact.title))}>${this.i18n.t("activity.openResult", "Open result")} ${icon("arrow")}</button></article>`)}${readyOutputs.map((output) => html`<article class="forma-activity-card"><div class="forma-activity-card-icon" aria-hidden="true">${icon("image")}</div><div class="forma-activity-card-copy"><span class="eyebrow">${this.i18n.t("deliver.visualOutput", "Visual output")}</span><h3>${documentNames.get(output.documentId) ?? projection.projectName}</h3><p>${output.purpose === "final" ? this.i18n.t("deliver.finalQuality", "Final quality") : this.i18n.t("deliver.workingDirection", "Working direction")}</p></div><button type="button" class="button secondary" @click=${() => this.#open(libraryFocusRoute("output", output.id, documentNames.get(output.documentId) ?? projection.projectName))}>${this.i18n.t("activity.openResult", "Open result")} ${icon("arrow")}</button></article>`)}${completedJobs.map((job) => this.#job(job, documentNames.get(job.documentId) ?? projection.projectName))}</div></section>` : nothing}
          ${read.length ? html`<section class="forma-activity-group"><header class="forma-activity-group-heading"><h2>${this.i18n.t("activity.recent", "Recent project updates")}</h2></header><div class="forma-activity-list">${read.map((notification) => this.#notification(notification, documentNames.get(notification.documentId ?? "") ?? projection.projectName))}</div></section>` : nothing}
          ${!activity.reviews.length && !activity.notifications.length && !activity.jobs.length && !readyArtifacts.length && !readyOutputs.length ? html`<div class="forma-responsive-empty"><span aria-hidden="true">${icon("check")}</span><h2>${this.i18n.t("activity.emptyTitle", "You’re all caught up")}</h2><p>${this.i18n.t("activity.emptyDescription", "Assigned reviews, shared project updates, and your own background work will appear here when they need you.")}</p><button type="button" class="button secondary" @click=${() => this.#open("/")}>${this.i18n.t("activity.continueWorking", "Continue working")}</button></div>` : nothing}
        </div>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-activity")) customElements.define("forma-activity", FormaActivity);
declare global { interface HTMLElementTagNameMap { "forma-activity": FormaActivity } }
