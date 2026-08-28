import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { scopedFormaActivity } from "../model/activity";
import { artifactSourceVersions } from "../model/context-health";
import { artifactDeliveryFor } from "../state/artifact-delivery-context";
import { documentArtifactDefinition } from "../model/document-artifacts";
import { describeOutputs, imageOutputNamingCandidate } from "../model/output-naming";
import { artifactFocusRoute, libraryFocusRoute, withProjectTaskDocumentInRoute } from "../model/routes";
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
  #follow(event:MouseEvent,path:string){if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();this.#open(path);}

  override render() {
    const session = this.store.session.get();
    const projection = this.store.projection.get();
    const currentRoute = this.store.route.get();
    const activityHref = withProjectTaskDocumentInRoute("/activity", projection.documentId, currentRoute);
    const activity = scopedFormaActivity(session, projection, [], [], []);
    const documentIds = new Set(activity.documents.map((document) => document.id));
    const documentNames = new Map(activity.documents.map((document) => [document.id, document.title]));
    const artifacts = projection.libraryArtifacts.filter((artifact) => documentIds.has(artifact.documentId));
    const outputs = projection.libraryOutputs.filter((output) => documentIds.has(output.documentId)).sort((left, right) => right.sequence - left.sequence);
    const events = this.store.events.get();
    const descriptions=describeOutputs([...artifacts,...outputs.map((output)=>imageOutputNamingCandidate(output,{},documentNames.get(output.documentId)??projection.projectName))],{events,locale:this.i18n.locale,timeZone:this.i18n.timeZone,formatTake:(take)=>this.i18n.t("output.take","Take {number}",{number:this.i18n.number(take)}),scopedLabels:{documents:activity.documents,formatDocument:(number)=>this.i18n.t("artifact.delivery.documentQualifier","Document {number}",{number:this.i18n.number(number)}),formatResult:(number)=>this.i18n.t("artifact.delivery.resultQualifier","Result {number}",{number:this.i18n.number(number)})}});
    const resultNames=new Map(descriptions.map((result)=>[result.id,result.disambiguator?`${result.disambiguator} — ${result.title}`:result.title]));
    const resultScopes=new Map(descriptions.map(result=>[result.displayScope!.key,result.displayScope!]));
    const resultScope=(documentId:string,kind:string,id:string)=>resultScopes.get(JSON.stringify([documentId,kind,id]));
    const namedAction=(action:string,name:string)=>this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action,name});
    const reviewedArtifacts = artifacts.map((artifact) => {const delivery=artifactDeliveryFor(this.store,artifact);return{artifact,review:delivery.review,delivery};}).sort((left, right) => right.artifact.sequence - left.artifact.sequence);
    const approvedArtifacts = reviewedArtifacts.filter(({ delivery }) => delivery.approved);
    const independentlyGated = ({ artifact, delivery }: typeof reviewedArtifacts[number]) => Boolean(session?.projectContext && (session.projectContext.managedPilot || artifactSourceVersions(artifact.id, events)) && !delivery.approved);
    const readyArtifacts = reviewedArtifacts.filter((entry) => !entry.delivery.approved && !independentlyGated(entry));
    const pendingArtifacts = reviewedArtifacts.filter(independentlyGated);
    const reviewed = approvedArtifacts.length;
    const exportAcknowledgments=reviewedArtifacts.filter(({delivery})=>Boolean(delivery.exportReceipt)).length;
    const artifactSection = (entries: typeof reviewedArtifacts, label: string) => entries.length ? html`<section class="forma-deliver-section"><header class="forma-activity-group-heading"><h2>${label}</h2><span>${entries.length}</span></header><div class="forma-deliver-grid">${entries.map(({ artifact, review, delivery }) => { const name=resultNames.get(artifact.id)??artifact.title,scope=resultScope(artifact.documentId,artifact.kind,artifact.id);const href = artifactFocusRoute(artifact.id,artifact.title,{expectedRevision:delivery.revision,...(delivery.contentSha256?{expectedContentSha256:delivery.contentSha256}:{}),intent:delivery.intent},currentRoute); return html`<article class="forma-deliver-card" data-forma-content="primary" aria-label=${scope?.context??name}><a class="forma-deliver-preview" href=${href} aria-label=${this.i18n.t("deliver.openNamed", "Open {name}", { name:scope?.context??name })} @click=${(event: MouseEvent) => this.#follow(event,href)}><forma-artifact-summary .artifact=${artifact} .compact=${true}></forma-artifact-summary></a><div class="forma-deliver-copy"><span class="eyebrow">${this.i18n.system(documentArtifactDefinition(artifact.kind).label)} · ${artifact.itemCount} ${this.i18n.t("deliver.items", "items")}</span><h3 dir="auto">${scope?.title??name}</h3><p dir="auto">${scope?.documentTitle??documentNames.get(artifact.documentId)??projection.projectName}${scope?.qualifier?html` · ${scope.qualifier}`:nothing}</p></div><footer><span class=${`forma-deliver-status forma-deliver-status--${review.status}`}>${session?.projectContext&&review.status==="approved"&&!delivery.approved?this.i18n.t("artifact.delivery.unverifiedApproval","Recorded approval does not match the current output."):this.i18n.t(`deliver.review.${review.status}`, review.label)}${delivery.exportReceipt?html` · ${this.i18n.t("artifact.delivery.exportRecorded","Export authorization recorded earlier for this revision")}`:nothing}${delivery.rightsBlockIds.length?html` · ${this.i18n.t("artifact.delivery.currentSourcesBlocked","Export is blocked now: the inputs changed or their rights are no longer current.")}`:delivery.review.status==="stale"?html` · ${this.i18n.t("artifact.delivery.sourcesChanged","These exact inputs changed or their rights are no longer current.")}`:nothing}</span><a class="button secondary compact" href=${href} aria-label=${namedAction(this.i18n.t(`artifact.delivery.action.${delivery.action}`),scope?.context??name)} @click=${(event: MouseEvent) => this.#follow(event,href)}>${this.i18n.t(`artifact.delivery.action.${delivery.action}`)} ${icon("arrow")}</a></footer></article>`; })}</div></section>` : nothing;

    return html`<section class="workspace-page studio-subpage forma-deliver-page"><forma-project-rail surface="studio" destination="/deliver" quiet></forma-project-rail>
      <div class="studio-main forma-deliver-main"><header class="page-header page-header--document"><div class="page-header-copy"><span class="eyebrow">${projection.projectName} / ${this.i18n.t("deliver.eyebrow", "Present and deliver")}</span><h1>${this.i18n.t("shell.navigation.deliver", "Deliver")}</h1><p>${this.i18n.t("deliver.description", "Review the real creative results produced in this project, then open the exact artifact to present, review, share, or export it when authorized.")}</p></div><a class="button secondary" href=${activityHref} @click=${(event: MouseEvent) => this.#follow(event,activityHref)}>${this.i18n.t("deliver.reviewActivity", "Review activity")} ${icon("arrow")}</a></header>
        ${repeat(activity.documents, document => document.id, document => html`<forma-output-requirements .documentId=${document.id} .documentName=${document.title} .surface=${"deliver"}></forma-output-requirements>`)}
        <section aria-label=${this.i18n.t("artifact.delivery.resultsSection", "Creative results")}>
          <div class="forma-deliver-section"><p><b>${this.i18n.t("artifact.delivery.resultsSection", "Creative results")}</b> · ${this.i18n.t("artifact.delivery.resultsScope", "Counts cover the document artifacts and visual results in this section; Output requirements track fulfillment separately.")}</p></div>
        ${artifactSection(approvedArtifacts, this.i18n.t("deliver.review.approved", "Approved"))}
        ${artifactSection(readyArtifacts, this.i18n.t("artifact.delivery.savedWork", "Saved work"))}
        ${artifactSection(pendingArtifacts, this.i18n.t("sample.review", "Needs review"))}
        ${outputs.length ? html`<section class="forma-deliver-section"><header class="forma-activity-group-heading"><h2>${this.i18n.t("deliver.visualResults", "Visual results")}</h2><span>${outputs.length}</span></header><div class="forma-deliver-grid">${outputs.map((output) => { const title=resultNames.get(output.id)??documentNames.get(output.documentId)??projection.projectName,scope=resultScope(output.documentId,"image",output.id); const href = libraryFocusRoute("output", output.id, title, currentRoute); return html`<article class="forma-deliver-card forma-deliver-card--visual" data-forma-content="primary" aria-label=${scope?.context??title}><a class="forma-deliver-preview" href=${href} aria-label=${this.i18n.t("deliver.openNamed", "Open {name}", { name: scope?.context??title })} @click=${(event: MouseEvent) => this.#follow(event,href)}><forma-output-visual .output=${output} .compact=${true} .interactive=${false}></forma-output-visual></a><div class="forma-deliver-copy"><span class="eyebrow">${this.i18n.t("deliver.visualOutput", "Visual output")}</span><h3 dir="auto">${scope?.title??title}</h3><p>${output.purpose === "final" ? this.i18n.t("deliver.finalQuality", "Final quality") : this.i18n.t("deliver.workingDirection", "Working direction")}</p>${scope?.showDocument?html`<p dir="auto">${scope.documentTitle}${scope.qualifier?html` · ${scope.qualifier}`:nothing}</p>`:nothing}</div><footer><span class="forma-deliver-status">${output.saved || output.library ? this.i18n.t("deliver.saved", "Saved to project") : this.i18n.t("deliver.available", "Available in project")}</span><a class="button secondary compact" href=${href} aria-label=${namedAction(this.i18n.t("deliver.open","Open"),scope?.context??title)} @click=${(event: MouseEvent) => this.#follow(event,href)}>${this.i18n.t("deliver.open", "Open")} ${icon("arrow")}</a></footer></article>`; })}</div></section>` : nothing}
        ${!artifacts.length && !outputs.length ? html`<div class="forma-responsive-empty" data-forma-empty-state><span aria-hidden="true">${icon("spark")}</span><h2>${this.i18n.t("artifact.delivery.resultsEmpty", "No creative results in this section")}</h2><p>${this.i18n.t("artifact.delivery.resultsEmptyDescription", "Document artifacts and visual results appear here when available.")}</p><button type="button" class="button secondary" @click=${() => this.#open("/")}>${this.i18n.t("deliver.return", "Open the current document")}</button></div>` : nothing}
        <div class="forma-deliver-summary" role="group" aria-label=${this.i18n.t("artifact.delivery.resultsSummary", "Creative result counts for this section")}><div><b>${artifacts.length}</b><span>${this.i18n.t("artifact.delivery.documentCount", "Document artifacts")}</span></div><div><b>${outputs.length}</b><span>${this.i18n.t("deliver.visuals", "Visual results")}</span></div><div><b>${reviewed}</b><span>${this.i18n.t("artifact.delivery.approvalCount","Independent approval records")}</span></div><div><b>${exportAcknowledgments}</b><span>${this.i18n.t("artifact.delivery.exportCount","Export acknowledgments")}</span></div></div><p>${this.i18n.t("artifact.delivery.notDelivered","Export authorization does not confirm download or recipient delivery.")}</p>
        </section>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-deliver")) customElements.define("forma-deliver", FormaDeliver);
declare global { interface HTMLElementTagNameMap { "forma-deliver": FormaDeliver } }
