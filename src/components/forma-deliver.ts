import { html, nothing } from "lit";
import { scopedFormaActivity } from "../model/activity";
import { artifactReviewState, artifactSourceVersions } from "../model/context-health";
import { documentArtifactDefinition } from "../model/document-artifacts";
import { describeOutputs, imageOutputNamingCandidate } from "../model/output-naming";
import { libraryFocusRoute } from "../model/routes";
import { FormaElement, icon } from "./forma-element";
import "./artifact-summary";
import "./output-visual";
import "./project-rail";
import "./forma-output-requirements";

export class FormaDeliver extends FormaElement {
  override connectedCallback() {
    super.connectedCallback();
    if (!this.store.session.get()) return;
    void this.store.refreshEvents().catch(() => undefined);
  }

  #open(path: string) { this.store.setRoute(path); }

  override render() {
    const session = this.store.session.get();
    const projection = this.store.projection.get();
    const activity = scopedFormaActivity(session, projection, [], [], []);
    const documentIds = new Set(activity.documents.map((document) => document.id));
    const documentNames = new Map(activity.documents.map((document) => [document.id, document.title]));
    const artifacts = projection.libraryArtifacts.filter((artifact) => documentIds.has(artifact.documentId));
    const outputs = projection.libraryOutputs.filter((output) => documentIds.has(output.documentId)).sort((left, right) => right.sequence - left.sequence);
    const events = this.store.events.get();
    const resultNames=new Map(describeOutputs([...artifacts,...outputs.map((output)=>imageOutputNamingCandidate(output,{},documentNames.get(output.documentId)??projection.projectName))],{events,locale:this.i18n.locale,timeZone:this.i18n.timeZone,formatTake:(take)=>this.i18n.t("output.take","Take {number}",{number:this.i18n.number(take)})}).map((result)=>[result.id,result.disambiguator?`${result.disambiguator} — ${result.title}`:result.title]));
    const reviewedArtifacts = artifacts.map((artifact) => ({ artifact, review: artifactReviewState(artifact, projection.libraryBlocks, events) })).sort((left, right) => right.artifact.sequence - left.artifact.sequence);
    const approvedArtifacts = reviewedArtifacts.filter(({ review }) => review.status === "approved");
    const independentlyGated = ({ artifact, review }: typeof reviewedArtifacts[number]) => Boolean(session?.projectContext && (session.projectContext.managedPilot || artifactSourceVersions(artifact.id, events)) && review.status !== "approved");
    const readyArtifacts = reviewedArtifacts.filter((entry) => entry.review.status !== "approved" && !independentlyGated(entry));
    const pendingArtifacts = reviewedArtifacts.filter(independentlyGated);
    const reviewed = approvedArtifacts.length;
    const artifactSection = (entries: typeof reviewedArtifacts, label: string) => entries.length ? html`<section class="forma-deliver-section"><header class="forma-activity-group-heading"><h2>${label}</h2><span>${entries.length}</span></header><div class="forma-deliver-grid">${entries.map(({ artifact, review }) => { const name=resultNames.get(artifact.id)??artifact.title;const href = libraryFocusRoute("artifact", artifact.id, artifact.title); return html`<article class="forma-deliver-card" data-forma-content="primary"><a class="forma-deliver-preview" href=${href} aria-label=${this.i18n.t("deliver.openNamed", "Open {name}", { name })} @click=${(event: MouseEvent) => { event.preventDefault(); this.#open(href); }}><forma-artifact-summary .artifact=${artifact} .compact=${true}></forma-artifact-summary></a><div class="forma-deliver-copy"><span class="eyebrow">${this.i18n.system(documentArtifactDefinition(artifact.kind).label)} · ${artifact.itemCount} ${this.i18n.t("deliver.items", "items")}</span><h3 dir="auto">${name}</h3><p>${documentNames.get(artifact.documentId) ?? projection.projectName}</p></div><footer><span class=${`forma-deliver-status forma-deliver-status--${review.status}`}>${this.i18n.t(`deliver.review.${review.status}`, review.label)}</span><a class="button secondary compact" href=${href} @click=${(event: MouseEvent) => { event.preventDefault(); this.#open(href); }}>${this.i18n.t("deliver.open", "Open")} ${icon("arrow")}</a></footer></article>`; })}</div></section>` : nothing;

    return html`<section class="workspace-page studio-subpage forma-deliver-page"><forma-project-rail surface="studio" destination="/deliver" quiet></forma-project-rail>
      <div class="studio-main forma-deliver-main"><header class="page-header page-header--document"><div class="page-header-copy"><span class="eyebrow">${projection.projectName} / ${this.i18n.t("deliver.eyebrow", "Present and deliver")}</span><h1>${this.i18n.t("shell.navigation.deliver", "Deliver")}</h1><p>${this.i18n.t("deliver.description", "Review the real creative results produced in this project, then open the exact artifact to present, review, share, or export it when authorized.")}</p></div><a class="button secondary" href="/activity" @click=${(event: MouseEvent) => { event.preventDefault(); this.#open("/activity"); }}>${this.i18n.t("deliver.reviewActivity", "Review activity")} ${icon("arrow")}</a></header>
        ${activity.documents.map((document) => html`<forma-output-requirements .documentId=${document.id} .documentName=${document.title} .surface=${"deliver"}></forma-output-requirements>`)}
        ${artifactSection(approvedArtifacts, this.i18n.t("deliver.review.approved", "Approved"))}
        ${artifactSection(readyArtifacts, this.i18n.t("deliver.presentable", "Presentable work"))}
        ${artifactSection(pendingArtifacts, this.i18n.t("sample.review", "Needs review"))}
        ${outputs.length ? html`<section class="forma-deliver-section"><header class="forma-activity-group-heading"><h2>${this.i18n.t("deliver.visualResults", "Visual results")}</h2><span>${outputs.length}</span></header><div class="forma-deliver-grid">${outputs.map((output) => { const title=resultNames.get(output.id)??documentNames.get(output.documentId)??projection.projectName; const href = libraryFocusRoute("output", output.id, title); return html`<article class="forma-deliver-card forma-deliver-card--visual" data-forma-content="primary"><a class="forma-deliver-preview" href=${href} aria-label=${this.i18n.t("deliver.openNamed", "Open {name}", { name: title })} @click=${(event: MouseEvent) => { event.preventDefault(); this.#open(href); }}><forma-output-visual .output=${output} .compact=${true} .interactive=${false}></forma-output-visual></a><div class="forma-deliver-copy"><span class="eyebrow">${this.i18n.t("deliver.visualOutput", "Visual output")}</span><h3 dir="auto">${title}</h3><p>${output.purpose === "final" ? this.i18n.t("deliver.finalQuality", "Final quality") : this.i18n.t("deliver.workingDirection", "Working direction")}</p></div><footer><span class="forma-deliver-status">${output.saved || output.library ? this.i18n.t("deliver.saved", "Saved to project") : this.i18n.t("deliver.available", "Available in project")}</span><a class="button secondary compact" href=${href} @click=${(event: MouseEvent) => { event.preventDefault(); this.#open(href); }}>${this.i18n.t("deliver.open", "Open")} ${icon("arrow")}</a></footer></article>`; })}</div></section>` : nothing}
        ${!artifacts.length && !outputs.length ? html`<div class="forma-responsive-empty" data-forma-empty-state><span aria-hidden="true">${icon("spark")}</span><h2>${this.i18n.t("deliver.emptyTitle", "Your project’s work will land here")}</h2><p>${this.i18n.t("deliver.emptyDescription", "Generate an image, presentation, story, storyboard, or another document result to prepare it for review and delivery.")}</p><button type="button" class="button secondary" @click=${() => this.#open("/")}>${this.i18n.t("deliver.return", "Open the current document")}</button></div>` : nothing}
        <div class="forma-deliver-summary" role="group" aria-label=${this.i18n.t("deliver.summary", "Project delivery summary")}><div><b>${artifacts.length}</b><span>${this.i18n.t("deliver.documents", "Document outputs")}</span></div><div><b>${outputs.length}</b><span>${this.i18n.t("deliver.visuals", "Visual results")}</span></div><div><b>${reviewed}</b><span>${session?.projectContext ? this.i18n.t("deliver.independentlyApproved", "Independently approved") : this.i18n.t("deliver.approved", "Approved")}</span></div></div>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-deliver")) customElements.define("forma-deliver", FormaDeliver);
declare global { interface HTMLElementTagNameMap { "forma-deliver": FormaDeliver } }
