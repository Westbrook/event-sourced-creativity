import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { formaActivityJobNeedsAttention, formaActivityUnread, scopedFormaActivity } from "../model/activity";
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
import { artifactFocusRoute, libraryFocusRoute, withProjectTaskDocumentInRoute } from "../model/routes";
import { artifactDeliveryFor } from "../state/artifact-delivery-context";
import { describeOutputs, imageOutputNamingCandidate, type OutputPresentation } from "../model/output-naming";
import type { AssignedReviewTask, PlanningRecoveryIdentity, ProjectNotification } from "../state/store";
import {
  localizedDocumentJobProgress,
  localizedDocumentJobProgressDetail,
  localizedGenerationFailureGuidance,
} from "./design-system/localized-runtime-copy";
import { FormaElement, icon } from "./forma-element";
import type { FormaActivityIssuePanel } from "./forma-activity-issue-panel";
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

  #review(task: AssignedReviewTask, presentation: OutputPresentation) {
    const scope = presentation.displayScope!;
    const context = scope.context + " · " + this.i18n.t("activity.reviewRevision", "Review revision {revision}", { revision: String(task.revision) });
    const reviewContext = { identity: JSON.stringify([task.id, task.organizationId, task.projectAccessId, task.projectId, task.documentId, task.artifactId, task.artifactKind, task.revision, task.contentSha256, task.artifactTitle, task.documentTitle, task.projectName, task.organizationName]), name: context };
    return html`<article class="forma-activity-card forma-activity-card--attention" aria-label=${context}>
      <div class="forma-activity-card-icon" aria-hidden="true">${icon("check")}</div>
      <div class="forma-activity-card-copy"><span class="eyebrow">${this.i18n.t("activity.review", "Assigned review")}</span><h3 dir="auto">${task.artifactTitle||this.i18n.system("Finished output")} · ${this.i18n.t("activity.reviewRevision", "Review revision {revision}", { revision: String(task.revision) })}</h3><p dir="auto">${scope.documentTitle}${presentation.disambiguator?html` · ${presentation.disambiguator}`:nothing}${scope.qualifier?html` · ${scope.qualifier}`:nothing}</p><p>${this.i18n.t("activity.requestedBy", "Requested by {name}", { name: task.requestedByName })}</p>${task.dueAt ? html`<small>${this.i18n.t("activity.due", "Due {date}", { date: new Date(task.dueAt).toLocaleDateString(this.i18n.locale) })}</small>` : nothing}<forma-activity-issue-panel .review=${task} .reviewContext=${reviewContext}></forma-activity-issue-panel></div>
      <button type="button" class="button primary" aria-label=${this.i18n.t("artifact.delivery.namedAction", "{action} — {name}", { action: this.i18n.t("activity.openReview", "Open assigned review"), name: context })} @click=${() => void this.store.openAssignedReview(task)}>${this.i18n.t("activity.openReview", "Open assigned review")} ${icon("arrow")}</button>
    </article>`;
  }

  #notification(notification: ProjectNotification, documentName: string, scopes: ReadonlyMap<string, NonNullable<OutputPresentation["displayScope"]>>, group: "needs-you" | "recent") {
    const projection = this.store.projection.get();
    const artifact = notification.artifactId ? projection.libraryArtifacts.find((entry) => entry.id === notification.artifactId) : undefined;
    const delivery=artifact?artifactDeliveryFor(this.store,artifact):null;
    const artifactHref=artifact&&delivery?artifactFocusRoute(artifact.id,artifact.title,{expectedRevision:delivery.revision,...(delivery.contentSha256?{expectedContentSha256:delivery.contentSha256}:{}),intent:delivery.intent}):"";
    const document = notification.documentId ? projection.documents.find((entry) => entry.id === notification.documentId) : undefined;
    const scope = artifact ? scopes.get(JSON.stringify([artifact.documentId, artifact.kind, artifact.id])) : undefined;
    const namedAction = (action: string) => scope ? this.i18n.t("artifact.delivery.namedAction", "{action} — {name}", { action, name: scope.context }) : action;
    return html`<article class=${`forma-activity-card ${notification.readAt ? "" : "forma-activity-card--unread"}`} aria-label=${scope?.context ?? nothing}>
      <div class="forma-activity-card-icon" aria-hidden="true">${icon("spark")}</div>
      <div class="forma-activity-card-copy"><span class="eyebrow">${this.i18n.t("activity.projectUpdate", "Project update")}</span><h3>${notification.kind==="changes_requested"&&notification.message?notification.message:this.i18n.t(`notifications.${notification.kind}.detail`,this.i18n.system(notification.message))}</h3><p dir="auto">${scope?.context ?? documentName} · ${new Date(notification.createdAt).toLocaleString(this.i18n.locale)}</p><forma-activity-issue-panel .notification=${notification} data-activity-notification-group=${group} @forma-activity-correction-state-changed=${() => this.requestUpdate()}></forma-activity-issue-panel></div>
      <div class="forma-activity-card-actions">${artifact ? html`<button type="button" class="button secondary" aria-label=${namedAction(this.i18n.t(`artifact.delivery.action.${delivery!.action}`))} @click=${() => this.#open(artifactHref)}>${this.i18n.t(`artifact.delivery.action.${delivery!.action}`)}</button>` : document ? html`<button type="button" class="button secondary" @click=${() => void this.store.openDocument(document.id, "/")}>${this.i18n.t("activity.openDocument", "Open document")}</button>` : nothing}${!notification.readAt ? html`<button type="button" class="button ghost" aria-label=${namedAction(this.i18n.t("activity.markRead", "Mark as read"))} @click=${() => void this.store.acknowledgeProjectNotification(notification.id)}>${this.i18n.t("activity.markRead", "Mark as read")}</button>` : nothing}</div>
    </article>`;
  }

  #planningRecovery(identity:PlanningRecoveryIdentity,documentName:string){
    const action=this.i18n.t("planning.consent.retrieveExisting","Retrieve existing plan");
    return html`<article class="forma-activity-card" data-activity-status="recovery">
      <div class="forma-activity-card-icon" aria-hidden="true">${icon("info")}</div>
      <div class="forma-activity-card-copy"><span class="eyebrow">${this.i18n.t("activity.privateOperation","Your private operation")}</span><h3 dir="auto">${documentName}</h3><p>${this.i18n.t("planning.recovery.outsideFeed","This request is outside the current Activity list. Retrieve checks the original request without generating again.")}</p></div>
      <div class="forma-activity-card-actions"><button type="button" class="button primary" data-planning-recovery-id=${identity.jobId} aria-label=${this.i18n.t("planning.consent.retrieveNamed","{action} — {document} — request {request}",{action,document:"\u2068"+documentName+"\u2069",request:"\u2068"+identity.jobId+"\u2069"})} @click=${()=>void this.store.reviewPlanningJob(identity.jobId)}>${action}</button></div>
    </article>`;
  }

  #job(job: DocumentJob, documentName: string) {
    const planningRecovery=job.kind==="structure_adaptive"&&job.planningExecutionId===job.jobId;
    const planningRecoveryAction=planningRecovery?this.i18n.t("planning.consent.retrieveExisting","Retrieve existing plan"):"";
    const outputPermission=!this.store.session.get()?.projectContext||this.store.session.get()!.projectContext!.permissions.includes("project.output.request");
    const failed = ["failed", "partial"].includes(job.status);
    const stoppedPlanning=job.kind==="structure_adaptive"&&job.status==="canceled"&&["adaptive_canceled","adaptive_force_failed"].includes(job.errorDetail?.code??job.error??"");
    const active = ["queued", "running", "committing"].includes(job.status);
    const artifactKind = isDocumentArtifactKind(job.result?.artifactKind) ? job.result.artifactKind : null;
    const operation = artifactKind
      ? this.i18n.t(`artifact.${artifactKind}.label`, documentArtifactDefinition(artifactKind).label)
      : this.i18n.t(`activity.kind.${job.kind}`, jobLabels[job.kind] ?? this.i18n.t("activity.documentOperation", "Document operation"));
    const failure = failed||stoppedPlanning ? documentJobFailure(job) : null;
    const guidance = failed||stoppedPlanning
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
      <div class="forma-activity-card-icon" aria-hidden="true">${icon(failed||stoppedPlanning ? "info" : active ? "clock" : "check")}</div>
      <div class="forma-activity-card-copy">
        <span class="eyebrow">${this.i18n.t("activity.privateOperation", "Your private operation")}${failed ? html` · ${operation}` : nothing}</span>
        <h3>${guidance?.title ?? operation}</h3>
        <p class="forma-activity-card-metadata"><span dir="auto">${documentName}</span><span class="forma-activity-card-status">${this.i18n.t(`activity.status.${job.status}`, job.status)}</span>${updatedAt ? html`<time datetime=${updatedAt.toISOString()}>${this.i18n.date(updatedAt, { dateStyle: "medium", timeStyle: "short" })}</time>` : nothing}</p>
        ${guidance ? html`<p class="forma-activity-card-explanation">${guidance.summary}</p>` : progressMessage ? html`<p class="forma-activity-card-progress">${progressMessage}${progressDetail && progressDetail !== progressMessage ? html`<span>${progressDetail}</span>` : nothing}</p>` : nothing}
        ${recoverable ? html`<small class="forma-activity-card-recovery-note">${this.i18n.system("Paid once · replay without another provider call")}</small>` : nothing}
        ${failed ? html`<forma-activity-issue-panel .job=${job} .documentName=${documentName}></forma-activity-issue-panel>` : nothing}
      </div>
      <div class="forma-activity-card-actions">
        ${planningRecovery?html`<button type="button" class="button primary" data-planning-recovery-id=${job.jobId} aria-label=${this.i18n.t("planning.consent.retrieveNamed","{action} — {document} — request {request}",{action:planningRecoveryAction,document:"\u2068"+documentName+"\u2069",request:"\u2068"+job.jobId+"\u2069"})} @click=${()=>void this.store.reviewPlanningJob(job.jobId)}>${planningRecoveryAction}</button>`:nothing}
        ${recoverable ? html`<button type="button" class="button primary" @click=${() => void (presentationRecoverable ? this.store.recoverDocumentPresentation(job.jobId) : this.store.recoverDocumentRender(job.jobId))}>${this.i18n.system("Recover saved render")}</button>` : remediation ? html`<a class="button primary" href=${remediation.href} target=${remediation.external ? "_blank" : "_self"} rel=${remediation.external ? "noopener noreferrer" : nothing}>${remediation.label}</a>` : nothing}
        <button type="button" class="button secondary" @click=${() => void this.store.openDocument(job.documentId, job.kind === "chat" ? "/studio/chat" : job.kind === "structure_adaptive" ? "/studio/adaptive" : "/")}>${this.i18n.t("activity.openDocument", "Open document")} ${icon("arrow")}</button>
        ${failed&&outputPermission ? html`<button type="button" class="button ghost" aria-label=${this.i18n.system("Dismiss this generation issue")} @click=${() => void this.store.dismissDocumentJobFailure(job.jobId)}>${this.i18n.system("Dismiss notice")}</button>` : nothing}
      </div>
    </article>`;
  }

  override render() {
    const session = this.store.session.get();
    const projection = this.store.projection.get();
    const activity = scopedFormaActivity(session, projection, this.store.projectNotifications.get(), this.store.reviewInbox.get(), this.store.documentJobs.get());
    const documentNames = new Map(activity.documents.map((document) => [document.id, document.title]));
    // Assigned-task labels use only the already-authorized envelope, not inferred generation history.
    const reviewDocumentKey = (task: AssignedReviewTask) => JSON.stringify([task.organizationId, task.projectAccessId, task.projectId, task.documentId]);
    const reviewDescriptions = describeOutputs(activity.reviews.map(task => ({
      id: task.id, documentId: reviewDocumentKey(task), sequence: 0,
      ...(isDocumentArtifactKind(task.artifactKind) ? { kind: task.artifactKind } : {}),
      title: task.artifactTitle || this.i18n.system("Finished output"),
    })), {
      locale: this.i18n.locale,
      formatTake: number => this.i18n.t("artifact.delivery.resultQualifier", "Result {number}", { number: this.i18n.number(number) }),
      scopedLabels: {
        documents: activity.reviews.map(task => ({ id: reviewDocumentKey(task), title: [task.organizationName, task.projectName, task.documentTitle].filter(Boolean).join(" · ") })),
        formatDocument: number => this.i18n.t("artifact.delivery.documentQualifier", "Document {number}", { number: this.i18n.number(number) }),
        formatResult: number => this.i18n.t("artifact.delivery.resultQualifier", "Result {number}", { number: this.i18n.number(number) }),
      },
    });
    const activeJobs = activity.jobs.filter((job) => ["queued", "running", "committing"].includes(job.status));
    const failedJobs = activity.jobs.filter(formaActivityJobNeedsAttention);
    const completedJobs = activity.jobs.filter((job) => job.status === "completed");
    const unreadIds = new Set(formaActivityUnread(activity).map(notification => notification.id));
    const heldGroups = new Map<string, "needs-you" | "recent">();
    // The connected child is the only draft owner. Preserve its current region
    // across read-status refreshes, using the latest authorized notification row.
    for (const panel of this.querySelectorAll<FormaActivityIssuePanel>("forma-activity-issue-panel")) {
      if (panel.closest("forma-activity") !== this) continue;
      const owner = panel.correctionEditorOwner, group = panel.getAttribute("data-activity-notification-group");
      if (!owner || group !== "needs-you" && group !== "recent") continue;
      const current = activity.notifications.find(notification => notification.id === owner.notificationId
        && notification.kind === "changes_requested" && notification.artifactId === owner.artifactId
        && notification.documentId === owner.documentId);
      if (current) heldGroups.set(current.id, group);
    }
    const notificationGroup = (notification: ProjectNotification) => heldGroups.get(notification.id)
      ?? (unreadIds.has(notification.id) ? "needs-you" : notification.readAt ? "recent" : null);
    const unread = activity.notifications.filter(notification => notificationGroup(notification) === "needs-you");
    const read = activity.notifications.filter(notification => notificationGroup(notification) === "recent");
    const source = this.store.captureSourceOwnership();
    const activityRowScope = [source?.authorization.key, source?.generation, this.store.route.get()];
    const notificationKey = (notification: ProjectNotification) => JSON.stringify([
      ...activityRowScope,
      notification.id, notification.kind, notification.artifactId, notification.documentId,
    ]);
    const reviewKey = (task: AssignedReviewTask) => JSON.stringify([
      ...activityRowScope, task.organizationId, task.projectAccessId, task.projectId, task.id,
      task.documentId, task.artifactId, task.artifactKind, task.revision, task.contentSha256,
    ]);
    const failedJobKey = (job: DocumentJob) => JSON.stringify([
      ...activityRowScope, job.jobId, job.documentId, job.kind,
    ]);
    const documentIds = new Set(activity.documents.map((document) => document.id));
    const planningRecovery=this.store.planningRecoveryEntries().filter(identity=>documentIds.has(identity.documentId));
    const scopedArtifacts = projection.libraryArtifacts.filter((artifact) => documentIds.has(artifact.documentId));
    const readyArtifacts = scopedArtifacts.slice(0, 6);
    const readyOutputs = projection.libraryOutputs.filter((output) => documentIds.has(output.documentId)).slice(0, 6);
    const imageCandidate=(output:typeof projection.libraryOutputs[number])=>imageOutputNamingCandidate(output,{},documentNames.get(output.documentId)??projection.projectName);
    const descriptions=describeOutputs([...scopedArtifacts,...readyOutputs.map(imageCandidate)],{peers:[...projection.libraryArtifacts,...projection.libraryOutputs.map(imageCandidate)],events:this.store.events.get(),locale:this.i18n.locale,timeZone:this.i18n.timeZone,formatTake:(take)=>this.i18n.t("output.take","Take {number}",{number:this.i18n.number(take)}),scopedLabels:{documents:activity.documents,formatDocument:(number)=>this.i18n.t("artifact.delivery.documentQualifier","Document {number}",{number:this.i18n.number(number)}),formatResult:(number)=>this.i18n.t("artifact.delivery.resultQualifier","Result {number}",{number:this.i18n.number(number)})}});
    const resultNames=new Map(descriptions.map((result)=>[result.id,result.disambiguator?`${result.disambiguator} — ${result.title}`:result.title]));
    const resultScopes=new Map(descriptions.map(result=>[result.displayScope!.key,result.displayScope!]));
    const resultScope=(documentId:string,kind:string,id:string)=>resultScopes.get(JSON.stringify([documentId,kind,id]));
    const namedAction=(action:string,name:string)=>this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action,name});

    return html`<section class="workspace-page studio-subpage forma-activity-page"><forma-project-rail surface="studio" destination="/activity" quiet></forma-project-rail>
      <div class="studio-main forma-activity-main"><header class="page-header page-header--document"><div class="page-header-copy"><span class="eyebrow">${projection.projectName ? `${projection.projectName} / ` : ""}${this.i18n.t("activity.inbox", "Activity · inbox")}</span><h1>${this.i18n.t("shell.navigation.activity", "Activity")}</h1><p>${this.i18n.t("activity.description", "Keep track of assigned reviews, authorized project updates, and your own background operations.")}</p></div><div class="forma-activity-header-actions">${session?.projectContext ? html`<button type="button" class="button ghost" @click=${async () => { if (await this.store.leaveProjectContext()) this.store.setRoute("/activity"); }}>${this.i18n.t("activity.viewAllAssignments", "View all my assigned reviews")}</button>` : nothing}<a class="button secondary" href=${withProjectTaskDocumentInRoute("/deliver",projection.documentId, this.store.route.get())} @click=${(event: MouseEvent) => { if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault(); this.#open(withProjectTaskDocumentInRoute("/deliver",projection.documentId, this.store.route.get())); }}>${this.i18n.t("activity.openDeliverables", "View deliverables")} ${icon("arrow")}</a></div></header>
        <div class="forma-activity-sections">
          ${planningRecovery.length?html`<section class="forma-activity-group"><header class="forma-activity-group-heading"><h2>${this.i18n.t("planning.recovery.heading","Earlier planning requests")}</h2><span>${this.i18n.number(planningRecovery.length)}</span></header><div class="forma-activity-list">${planningRecovery.map(identity=>this.#planningRecovery(identity,documentNames.get(identity.documentId)??projection.projectName))}</div></section>`:nothing}
          ${activity.reviews.length || unread.length || failedJobs.length ? html`<section class="forma-activity-group"><header class="forma-activity-group-heading"><h2>${this.i18n.t("activity.needsYou", "Needs you")}</h2><span>${activity.reviews.length + unread.length + failedJobs.length}</span></header><div class="forma-activity-list">${repeat(activity.reviews, reviewKey, (task, index) => this.#review(task, reviewDescriptions[index]!))}${repeat(failedJobs, failedJobKey, job => this.#job(job, documentNames.get(job.documentId) ?? projection.projectName))}${repeat(unread, notificationKey, notification => this.#notification(notification, documentNames.get(notification.documentId ?? "") ?? projection.projectName, resultScopes, "needs-you"))}</div></section>` : nothing}
          ${activeJobs.length ? html`<section class="forma-activity-group"><header class="forma-activity-group-heading"><h2>${this.i18n.t("activity.inProgress", "In progress")}</h2><span>${activeJobs.length}</span></header><div class="forma-activity-list">${activeJobs.map((job) => this.#job(job, documentNames.get(job.documentId) ?? projection.projectName))}</div></section>` : nothing}
          ${readyArtifacts.length || readyOutputs.length || completedJobs.length ? html`<section class="forma-activity-group"><header class="forma-activity-group-heading"><h2>${this.i18n.t("activity.ready", "Ready to continue")}</h2><span>${readyArtifacts.length + readyOutputs.length + completedJobs.length}</span></header><div class="forma-activity-list">${readyArtifacts.map((artifact) => {const delivery=artifactDeliveryFor(this.store,artifact),scope=resultScope(artifact.documentId,artifact.kind,artifact.id),href=artifactFocusRoute(artifact.id,artifact.title,{expectedRevision:delivery.revision,...(delivery.contentSha256?{expectedContentSha256:delivery.contentSha256}:{}),intent:delivery.intent},this.store.route.get());return html`<article class="forma-activity-card" aria-label=${scope?.context??artifact.title}><div class="forma-activity-card-icon" aria-hidden="true">${icon("check")}</div><div class="forma-activity-card-copy"><span class="eyebrow">${this.i18n.system(documentArtifactDefinition(artifact.kind).label)}</span><h3 dir="auto">${scope?.title??resultNames.get(artifact.id)??artifact.title}</h3><p dir="auto">${scope?.documentTitle??documentNames.get(artifact.documentId)??projection.projectName}${scope?.qualifier?html` · ${scope.qualifier}`:nothing} · ${this.i18n.t(`deliver.review.${delivery.review.status}`,delivery.review.label)}</p></div><a class="button secondary" href=${href} aria-label=${namedAction(this.i18n.t(`artifact.delivery.action.${delivery.action}`),scope?.context??artifact.title)} @click=${(event:MouseEvent)=>{if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();this.#open(href);}}>${this.i18n.t(`artifact.delivery.action.${delivery.action}`)} ${icon("arrow")}</a></article>`;})}${readyOutputs.map((output) => {const title=resultNames.get(output.id)??documentNames.get(output.documentId)??projection.projectName,scope=resultScope(output.documentId,"image",output.id);return html`<article class="forma-activity-card" aria-label=${scope?.context??title}><div class="forma-activity-card-icon" aria-hidden="true">${icon("image")}</div><div class="forma-activity-card-copy"><span class="eyebrow">${this.i18n.t("deliver.visualOutput", "Visual output")}</span><h3 dir="auto">${scope?.title??title}</h3><p>${output.purpose === "final" ? this.i18n.t("deliver.finalQuality", "Final quality") : this.i18n.t("deliver.workingDirection", "Working direction")}</p>${scope?.showDocument?html`<p dir="auto">${scope.documentTitle}${scope.qualifier?html` · ${scope.qualifier}`:nothing}</p>`:nothing}</div><button type="button" class="button secondary" aria-label=${namedAction(this.i18n.t("activity.openResult","Open result"),scope?.context??title)} @click=${() => this.#open(libraryFocusRoute("output", output.id,title))}>${this.i18n.t("activity.openResult", "Open result")} ${icon("arrow")}</button></article>`;})}${completedJobs.map((job) => this.#job(job, documentNames.get(job.documentId) ?? projection.projectName))}</div></section>` : nothing}
          ${read.length ? html`<section class="forma-activity-group"><header class="forma-activity-group-heading"><h2>${this.i18n.t("activity.recent", "Recent project updates")}</h2></header><div class="forma-activity-list">${repeat(read, notificationKey, notification => this.#notification(notification, documentNames.get(notification.documentId ?? "") ?? projection.projectName, resultScopes, "recent"))}</div></section>` : nothing}
          ${!activity.reviews.length && !activity.notifications.length && !activity.jobs.length && !planningRecovery.length && !readyArtifacts.length && !readyOutputs.length ? html`<div class="forma-responsive-empty"><span aria-hidden="true">${icon("check")}</span><h2>${this.i18n.t("activity.emptyTitle", "You’re all caught up")}</h2><p>${this.i18n.t("activity.emptyDescription", "Assigned reviews, shared project updates, and your own background work will appear here when they need you.")}</p><button type="button" class="button secondary" @click=${() => this.#open("/")}>${this.i18n.t("activity.continueWorking", "Continue working")}</button></div>` : nothing}
        </div>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-activity")) customElements.define("forma-activity", FormaActivity);
declare global { interface HTMLElementTagNameMap { "forma-activity": FormaActivity } }
