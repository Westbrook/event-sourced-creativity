import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import { foldEvents, generationHistoryItemIsDraft, type EventInput } from "../model/events";
import { suggestedSubtype, type BlockKind } from "../model/block-types";
import { documentArtifactDefinition } from "../model/document-artifacts";
import { documentSlug, withDocumentInRoute } from "../model/routes";
import "./output-visual";
import "./prompt-fan-visual";
import "./artifact-summary";
import "./design-primitives";

type ProjectBriefDraft = {
  projectId: string;
  documentId: string;
  name: string;
  documentTitle: string;
  objective: string;
  audience: string;
  message: string;
  protectedPhrase: string;
  deliverable: string;
  boundary: string;
  source: string;
  sourceRights: boolean;
};

function projectBriefEvents(draft: ProjectBriefDraft): { events: EventInput[]; decisionCount: number; hasBrief: boolean } | null {
  const name = draft.name.trim();
  const source = draft.source.trim();
  if (!name || source && !draft.sourceRights) return null;

  const protectedPhrase = draft.protectedPhrase.trim();
  const authoredMessage = draft.message.trim();
  const protectedInstruction = protectedPhrase ? `Preserve this line exactly: ${protectedPhrase}` : "";
  const message = protectedInstruction && !authoredMessage.includes(protectedInstruction)
    ? [authoredMessage, protectedInstruction].filter(Boolean).join("\n\n")
    : authoredMessage;
  const decisions = ([
    ["direction", draft.objective.trim()],
    ["audience", draft.audience.trim()],
    ["message", message],
    ["format", draft.deliverable.trim()],
    ["exclusion", draft.boundary.trim()],
  ] as Array<[BlockKind, string]>).filter((entry) => Boolean(entry[1]));
  const hasBrief = Boolean(decisions.length || source);
  const authoredDocumentTitle = draft.documentTitle.trim();
  const title = authoredDocumentTitle || (hasBrief ? `${name} brief` : "Untitled document");
  const handle = authoredDocumentTitle
    ? documentSlug(authoredDocumentTitle) || `document-${draft.documentId.slice(0, 8)}`
    : hasBrief ? "project-brief" : "untitled";
  const events: EventInput[] = [
    { type: "ProjectCreated", payload: { project_id: draft.projectId, name, state: "active" } },
    { type: "DocumentCreated", payload: { project_id: draft.projectId, document_id: draft.documentId, handle, title } },
    { type: "EmptyCanvasChosen", payload: { project_id: draft.projectId, document_id: draft.documentId, source_surface: "projects" } },
  ];

  for (const [index, [type, text]] of decisions.entries()) {
    events.push({
      type: "BlockCreated",
      payload: {
        project_id: draft.projectId,
        block_id: crypto.randomUUID(),
        document_id: draft.documentId,
        type,
        handle: `${type}/project-brief-${index + 1}`,
        position: `z${String(index + 1).padStart(4, "0")}`,
        properties: {
          text,
          subtype: suggestedSubtype(type),
          weight: .8,
          authority: "authored",
          ...(type === "exclusion" ? { intent: "prohibit" } : {}),
          ...(type === "message" && protectedPhrase ? {
            exact_text: protectedPhrase,
            exact_placements: ["opening", "closing"],
            protected_phrases: [{ text: protectedPhrase, placement: "opening_and_closing" }],
          } : {}),
        },
      },
    });
  }

  if (source) {
    const referenceId = crypto.randomUUID();
    const sourceMetadata = {
      source_type: "pasted-text",
      source_kind: "text",
      source_mime_type: "text/plain",
      media_type: "text/plain",
    };
    events.push(
      {
        type: "ReferenceIngested",
        payload: {
          project_id: draft.projectId,
          document_id: draft.documentId,
          reference_id: referenceId,
          ...sourceMetadata,
          source_ref: "authored-project-brief",
          rights_class: "asserted",
        },
      },
      {
        type: "RightsAsserted",
        payload: {
          project_id: draft.projectId,
          document_id: draft.documentId,
          reference_id: referenceId,
          rights_class: "owned_or_licensed",
          assertion_method: "explicit-brief-confirmation",
        },
      },
      {
        type: "BlockCreated",
        payload: {
          project_id: draft.projectId,
          block_id: crypto.randomUUID(),
          document_id: draft.documentId,
          type: "reference",
          handle: "reference/project-source",
          position: `z${String(decisions.length + 1).padStart(4, "0")}`,
          properties: {
            reference_id: referenceId,
            label: "Project source excerpt",
            text: source,
            ...sourceMetadata,
            source_citation: "Pasted and explicitly licensed by the project creator",
            subtype: "Mood",
            weight: .8,
            authority: "authored",
            extraction_status: "ready",
          },
        },
      },
    );
  }

  return { events, decisionCount: decisions.length + (source ? 1 : 0), hasBrief };
}

export class FormaProjects extends FormaElement {
  #creating=false;#submitting=false;#name="";#documentTitle="";#objective="";#audience="";#message="";#protectedPhrase="";#deliverable="";#boundary="";#source="";#sourceRights=false;
  #intake:{brief:NonNullable<ReturnType<typeof projectBriefEvents>>;name:string;actorUserId:string;confirmed:boolean}|null=null;
  #intakeOpening:object|null=null;#intakeIssue=false;
  #draftScope="";#unsubscribeDraft?:()=>void;
  #inCanvas(){const route=this.store.route.get().split(/[?#]/)[0];return route==="/canvas/projects"||route.startsWith("/canvas/projects/");}
  #destination(){return this.#inCanvas()?"/canvas":"/";}
  #draftScopeKey(){
    const session=this.store.session.get(),authorization=this.store.captureAuthorizationScope(),route=this.store.route.get();
    const pathname=route.split(/[?#]/)[0],projects=pathname.startsWith("/projects")||pathname==="/creative"
      ||pathname==="/canvas/projects"||pathname.startsWith("/canvas/projects/");
    // The existing authorization key includes real/effective principal and
    // project context. A local draft is never transferable between them.
    // In-page anchors move focus, not draft custody. Keep pathname and query.
    return this.isConnected&&projects&&session&&!session.projectContext&&authorization
      ?authorization.key+"\u0000"+route.split("#")[0]:"";
  }
  #discardDraft(){
    this.#intakeOpening=null;this.#creating=false;this.#submitting=false;
    this.#intake=null;this.#intakeIssue=false;this.#draftScope="";
    this.#clearDraft();this.querySelector<HTMLDialogElement>(".project-create-dialog")?.close();this.requestUpdate();
  }
  #syncDraftOwnership=()=>{
    if(this.#draftScope&&this.#draftScope!==this.#draftScopeKey())this.#discardDraft();
    if(!this.store.sourceOwnershipActive(this.store.captureSourceOwnership())){
      const open=this.#creating||this.#intakeOpening!==null;
      if(this.#intake)this.#intakeIssue=true;
      this.#intakeOpening=null;this.#creating=false;
      if(open){this.querySelector<HTMLDialogElement>(".project-create-dialog")?.close();this.requestUpdate();}
    }
  };
  override connectedCallback(){super.connectedCallback();this.#unsubscribeDraft=this.store.subscribe(this.#syncDraftOwnership);this.#syncDraftOwnership();}
  protected override willUpdate(){this.#syncDraftOwnership();}
  protected override updated(){ensureModalDialog(this.querySelector<HTMLDialogElement>(".project-create-dialog"));}
  override disconnectedCallback(){this.#unsubscribeDraft?.();this.#unsubscribeDraft=undefined;this.#discardDraft();super.disconnectedCallback();}
  #createLabel(fallback:string){return this.#intake?this.i18n.system("Resume {title}",{title:"\u2068"+this.#intake.name+"\u2069"}):fallback;}
  #openCreate(){
    this.#syncDraftOwnership();
    const scope=this.#draftScopeKey(),source=this.store.captureSourceOwnership();
    if(!scope||!this.store.sourceOwnershipActive(source))return;
    this.#draftScope=scope;
    const opening={};this.#intakeOpening=opening;this.#creating=true;
    const focus=captureOutputNavigationFocus(this.ownerDocument);this.requestUpdate();
    void this.updateComplete.then(()=>{
      if(!this.isConnected||!this.#creating||this.#intakeOpening!==opening||this.#draftScopeKey()!==scope
        ||!this.store.sourceOwnershipActive(source))return;
      const dialog=this.querySelector<HTMLDialogElement>(".project-create-dialog");
      const target=this.#intake?dialog?.querySelector<HTMLButtonElement>(".modal-close"):dialog?.querySelector<HTMLInputElement>("input");
      if(target&&!target.disabled)focus.run(target,()=>{target.focus();return true;});
    }).finally(()=>focus.dispose());
  }
  #clearDraft(){this.#name="";this.#documentTitle="";this.#objective="";this.#audience="";this.#message="";this.#protectedPhrase="";this.#deliverable="";this.#boundary="";this.#source="";this.#sourceRights=false;}
  // Dismiss only this presentation; the original request and its write lock remain owned.
  #close(){this.#intakeOpening=null;this.querySelector<HTMLDialogElement>(".project-create-dialog")?.close();this.#creating=false;this.requestUpdate();}
  async #create(event:SubmitEvent){
    event.preventDefault();
    if(this.#submitting||!this.#creating||this.#intake?.confirmed)return;
    if(!this.#intake){
      const name=this.#name.trim(),actorUserId=this.store.session.get()?.user.userId;
      if(!actorUserId)return;
      const brief=projectBriefEvents({projectId:crypto.randomUUID(),documentId:crypto.randomUUID(),name,documentTitle:this.#documentTitle,objective:this.#objective,audience:this.#audience,message:this.#message,protectedPhrase:this.#protectedPhrase,deliverable:this.#deliverable,boundary:this.#boundary,source:this.#source,sourceRights:this.#sourceRights});
      if(!brief)return;
      this.#intake={brief,name,actorUserId,confirmed:false};
    }
    await this.#runIntake("commit");
  }
  async #checkIntake(){if(!this.#submitting&&this.#intake)await this.#runIntake("check");}
  async #runIntake(mode:"commit"|"check"){
    const attempt=this.#intake,opening=this.#intakeOpening,route=this.store.route.get(),source=this.store.captureSourceOwnership();
    if(!attempt||!opening||attempt.actorUserId!==this.store.session.get()?.user.userId||!this.store.sourceOwnershipActive(source))return;
    let owned=true;
    const current=()=>owned&&this.isConnected&&this.#creating&&this.#intake===attempt&&this.#intakeOpening===opening
      &&this.store.route.get()===route&&this.store.session.get()?.user.userId===attempt.actorUserId&&this.store.sourceOwnershipActive(source);
    const unsubscribe=this.store.subscribe(()=>{if(!current())owned=false;});
    this.#submitting=true;this.#intakeIssue=false;this.requestUpdate();
    try{
      const result=await (mode==="check"?this.store.checkProjectIntake(attempt.brief.events,{current}):this.store.commitProjectIntake(attempt.brief.events,{current}));
      if(!current())return;
      const complete=result?.publication==="published"&&result.acknowledgment.outcome==="observed"
        &&!result.acknowledgment.privateUnavailable&&!result.acknowledgment.rejectedIndices.length
        &&result.acknowledgment.committed.length===attempt.brief.events.length&&result.appended.length===attempt.brief.events.length;
      if(!complete){this.#intakeIssue=true;return;}
      attempt.confirmed=true;
      // A creation receipt is not proof that its Document is still available.
      // Use the existing current Source read and exact project/document fold.
      await this.store.refreshEvents({fromStart:true});if(!current())return;
      const created=attempt.brief.events.find(event=>event.type==="DocumentCreated");
      const projectId=String(created?.payload.project_id??""),documentId=String(created?.payload.document_id??"");
      const original=foldEvents(this.store.eventView.get(),this.store.asOf.get(),documentId,projectId);
      const target=original.documents.find(document=>document.id===documentId&&document.projectId===projectId);
      if(!target||!original.projects.some(project=>project.id===projectId)){this.#intakeIssue=true;return;}
      const destination=withDocumentInRoute("/",documentId,target.title);
      const opened=await this.store.transitionWorkspace(destination,{documentId,documentFocus:false,current});
      if(!opened){if(current())this.#intakeIssue=true;return;}
      // The guarded transition itself retires the old route. This is only
      // cleanup of that confirmed attempt, never authority for another action.
      // Store can omit the display slug when A is outside the previously
      // projected project. Only its exact ID-only default view is equivalent.
      const arrival=this.store.route.get(),projection=this.store.projection.get();
      // The exact successful transition can synchronously retire this draft
      // before Lit disconnects its owner. Empty teardown is not a new owner.
      const departed=this.#intake===null&&this.#intakeOpening===null&&!this.#creating&&this.#draftScope==="";
      if((this.#intake!==attempt&&!departed)||(arrival!==destination&&arrival!==withDocumentInRoute("/",documentId))
        ||projection.projectId!==projectId||projection.documentId!==documentId
        ||this.store.session.get()?.user.userId!==attempt.actorUserId||!this.store.sourceOwnershipActive(source)
        ||this.isConnected&&!departed&&this.#intakeOpening!==opening)return;
      this.#submitting=false;this.#intake=null;this.#draftScope="";this.#clearDraft();this.#close();
      const {brief,name}=attempt;
      this.store.toast(brief.hasBrief?brief.decisionCount===1?this.i18n.system("{name} created with {count} authored brief decision.",{name,count:this.i18n.number(brief.decisionCount)}):this.i18n.system("{name} created with {count} authored brief decisions.",{name,count:this.i18n.number(brief.decisionCount)}):this.i18n.system("{name} created with a blank document.",{name}));
    }catch{if(current())this.#intakeIssue=true;}finally{
      unsubscribe();
      if(this.#intake===attempt){this.#submitting=false;this.requestUpdate();}
    }
  }
  override render(){if(!this.store.sourceOwnershipActive(this.store.captureSourceOwnership()))return nothing;const p=this.store.projection.get();const shared=Boolean(this.store.session.get()?.projectContext);const canvas=this.#inCanvas();const destination=this.#destination();return html`<section class="projects-page page-pad">
    <header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${canvas?this.i18n.t("projects.canvasEyebrow","Canvas / All projects"):this.i18n.t("projects.creatorEyebrow","Creator Workspace / All projects")}</span><h1>${this.i18n.t("shell.navigation.projects","Projects")}</h1><p>${this.i18n.t("projects.description","Choose the project that contains your documents, collections, creative context, outputs, and boards.")}</p></div>${shared?nothing:html`<div class="page-header-actions"><forma-ui-button .label=${this.#createLabel(this.i18n.t("projects.new","New project"))} icon-name="plus" variant="primary" @forma-press=${this.#openCreate}></forma-ui-button></div>`}</header>
    <div class="projects-grid">${p.projects.map((project)=>{const current=project.id===p.projectId;const latest=project.recentGenerations[0]??null;const latestArtifact=project.recentArtifacts[0]??null;const displayArtifact=latestArtifact&&(!latest||latestArtifact.sequence>latest.sequence)?latestArtifact:null;const name=`\u2068${project.name}\u2069`;const state=this.i18n.t(`projects.state.${project.state}`,project.state);const documents=this.i18n.plural("projects.document",project.documentCount,"{count} document","{count} documents");const ideas=this.i18n.plural("projects.idea",project.outputCount,"{count} finished or in-progress idea","{count} finished or in-progress ideas");return html`<article class=${`project-card ${current?"current":""}`} aria-label=${this.i18n.t(current?"projects.cardCurrent":"projects.card",current?"{name}, {state} project, currently open":"{name}, {state} project",{name,state})}>
      <header><span class="project-card-kind">${this.i18n.t("projects.workspaceKind","Creative workspace")}</span><forma-ui-badge .label=${current?this.i18n.t("projects.stateOpen","{state} · open",{state}):state} .tone=${current?"positive":"neutral"}></forma-ui-badge></header>
      <div class="project-card-title"><h2 dir="auto">${project.name}</h2><p>${current?this.i18n.t("projects.continueHint","Continue where you left off."):this.i18n.t("projects.projectSummary","{documents} and {ideas}.",{documents,ideas})}</p></div>
      <button type="button" class=${`project-card-generation ${latest?.kind==="fan"&&!displayArtifact?"fan":"single"}`} data-forma-content=${displayArtifact||latest?"primary":nothing} aria-label=${this.i18n.t("projects.openNamed","Open project {name}",{name})} @click=${()=>{const resultDocumentId=displayArtifact?.documentId??latest?.documentId;const resultDestination=!canvas&&resultDocumentId?withDocumentInRoute("/#output-title",resultDocumentId,p.documents.find((document)=>document.id===resultDocumentId)?.title??""):destination;void this.store.openProject(project.id,resultDestination);}}>
        ${displayArtifact?html`<forma-artifact-summary .artifact=${displayArtifact} .compact=${true}></forma-artifact-summary><span><b>Latest ${documentArtifactDefinition(displayArtifact.kind).label.toLowerCase()}</b><small>${displayArtifact.title} · open project ${icon("arrow")}</small></span>`:latest?html`${latest.kind==="fan"?html`<forma-prompt-fan-visual .outputs=${latest.outputs} .compact=${true}></forma-prompt-fan-visual>`:html`<forma-output-visual .output=${latest.output} .compact=${true}></forma-output-visual>`}<span><b>${latest.kind==="fan"?this.i18n.system("Latest fan · {complete} images", { complete: this.i18n.number(latest.complete) }):this.i18n.system("Latest generation")}</b><small>${generationHistoryItemIsDraft(latest)?this.i18n.system("Draft / low quality"):this.i18n.system("Full quality")} · open project ${icon("arrow")}</small></span>`:html`<span class="project-card-generation-empty">${icon("image")}<b>${this.i18n.t("projects.noFinishedWork","No finished work yet")}</b><small>${shared&&!this.store.session.get()?.projectContext?.permissions.includes("project.output.request")?this.i18n.t("projects.viewerFirstResult","A project editor can create the first shared result."):this.i18n.t("projects.firstResult","Open the project to create its first result.")}</small></span>`}
      </button>
      <footer>${project.state==="archived"&&!shared?html`<button type="button" class="button primary" @click=${async()=>{const restored=await this.store.append({type:"ProjectStateChanged",payload:{project_id:project.id,state:"active",previous_state:"archived"}});if(restored.length)this.store.toast(this.i18n.system("{name} restored with its complete history and finished work.",{name:project.name}));}}>Restore project</button>`:html`<button class=${`button ${current?"secondary":"primary"}`} aria-label=${this.i18n.t(current?"projects.continueNamed":"projects.openNamed",current?"Continue working on {name}":"Open project {name}",{name:`\u2068${project.name}\u2069`})} @click=${()=>this.store.openProject(project.id,destination)}>${current?this.i18n.t("projects.continue","Continue working"):this.i18n.t("projects.open","Open project")} ${icon("arrow")}</button>`}${canvas?html`<button class="button ghost" aria-label=${this.i18n.t("projects.openLibraryNamed","Open project library for {name}",{name:`\u2068${project.name}\u2069`})} @click=${async()=>{await this.store.openProject(project.id,"/canvas/library");}}>${this.i18n.t("projects.openLibrary","Open project library")}</button>`:html`<button class="button ghost" @click=${async()=>{await this.store.openProject(project.id,"/studio/project");}}>View project contents</button>`}${!canvas&&this.store.session.get()?.canvas.access&&(!shared||project.id===this.store.session.get()?.projectContext?.projectId&&Boolean(this.store.session.get()?.projectContext?.permissions.includes("project.canvas.use")))?html`<button class="button ghost" aria-label=${this.i18n.t("projects.openCanvasNamed","Open in Canvas: {name}",{name:`\u2068${project.name}\u2069`})} @click=${async()=>{await this.store.openProject(project.id,"/canvas");}}>${this.i18n.t("projects.openCanvas","Open in Canvas")}</button>`:nothing}</footer>
      <div class="project-card-summary"><span><strong>${project.documentCount}</strong><small>document${project.documentCount===1?"":"s"}</small></span><p><b>${project.blockCount}</b> creative decision${project.blockCount===1?"":"s"}, <b>${project.outputCount}</b> output${project.outputCount===1?"":"s"}${project.artifactCount?(project.artifactCount===1 ? " " + this.i18n.system("including {artifactCount} narrative, presentation, or motion result", { artifactCount: this.i18n.number(project.artifactCount) }) : " " + this.i18n.system("including {artifactCount} narrative, presentation, or motion results", { artifactCount: this.i18n.number(project.artifactCount) })):""}, and <b>${project.collectionCount}</b> collection${project.collectionCount===1?"":"s"}.</p></div>
    </article>`;})}${!p.projects.length?html`<forma-ui-empty-state .heading=${this.i18n.t("projects.emptyHeading","Give your next idea a home")} .detail=${this.i18n.t("projects.emptyDetail","A project keeps its documents, references, reusable decisions, and finished work together.")} .action=${this.#createLabel(this.i18n.t("projects.emptyAction","Create your first project"))} @forma-action=${this.#openCreate}></forma-ui-empty-state>`:""}</div>
    ${this.#creating?html`<dialog class="modal project-create-dialog" closedby="any" aria-labelledby="new-project-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}} @close=${()=>{if(this.#creating){this.#creating=false;this.requestUpdate();}}}>
      <form class="modal-card wide" aria-busy=${String(this.#submitting)} @submit=${this.#create}>
        <button type="button" class="icon-button modal-close" aria-label=${this.i18n.t("action.close","Close")} @click=${this.#close}>${icon("close")}</button>
        <span class="eyebrow">${this.i18n.t("projects.createEyebrow","New replayable workspace")}</span>
        <h2 id="new-project-title">${this.i18n.t("projects.createHeading","Start with a useful project brief")}</h2>
        <p>${this.i18n.t("projects.createDescription","Capture the decisions you already know, or leave every optional field empty for a genuinely blank document.")}</p>
        <forma-ui-field .disabled=${Boolean(this.#intake)} .label=${this.i18n.t("projects.projectName","Project name")} .placeholder=${this.i18n.t("projects.projectNamePlaceholder","e.g. Autumn campaign")} max-length="80" required .value=${this.#name} @forma-input=${(event:CustomEvent<{value:string}>)=>{this.#name=event.detail.value;this.requestUpdate();}}></forma-ui-field>
        <forma-ui-field .disabled=${Boolean(this.#intake)} .label=${this.i18n.system("Document name")} .placeholder=${this.i18n.system("New document")} .help=${this.i18n.system("Optional—Forma can derive one.")} max-length="80" .value=${this.#documentTitle} @forma-input=${(event:CustomEvent<{value:string}>)=>{this.#documentTitle=event.detail.value;this.requestUpdate();}}></forma-ui-field>
        <label>${this.i18n.system("What should this work accomplish?")} <span>${this.i18n.system("optional")}</span><textarea ?disabled=${Boolean(this.#intake)} rows="2" maxlength="1200" placeholder=${this.i18n.system("The outcome, decision, or change this project should create")} .value=${this.#objective} @input=${(event:InputEvent)=>{this.#objective=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea></label>
        <label>${this.i18n.system("Who needs to use or approve it?")} <span>${this.i18n.system("optional")}</span><input ?disabled=${Boolean(this.#intake)} maxlength="240" placeholder=${this.i18n.system("Audience, stakeholders, or decision makers")} .value=${this.#audience} @input=${(event:InputEvent)=>{this.#audience=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label>
        <label>${this.i18n.system("What should remain with them?")} <span>${this.i18n.system("optional")}</span><textarea ?disabled=${Boolean(this.#intake)} rows="4" maxlength="12000" placeholder=${this.i18n.system("The idea or narrative the audience should retain")} .value=${this.#message} @input=${(event:InputEvent)=>{this.#message=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea></label>
        <forma-ui-field .disabled=${Boolean(this.#intake)} .label=${`${this.i18n.system("Message")} · ${this.i18n.system("Exact value")}`} .placeholder=${this.i18n.system("Single proposition")} max-length="500" .value=${this.#protectedPhrase} @forma-input=${(event:CustomEvent<{value:string}>)=>{this.#protectedPhrase=event.detail.value;this.requestUpdate();}}></forma-ui-field>
        <label>${this.i18n.system("What needs to be delivered?")} <span>${this.i18n.system("optional")}</span><input ?disabled=${Boolean(this.#intake)} maxlength="240" placeholder=${this.i18n.system("A campaign, presentation, written brief, or other finished output")} .value=${this.#deliverable} @input=${(event:InputEvent)=>{this.#deliverable=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label>
        <label>${this.i18n.system("What must never appear?")} <span>${this.i18n.system("optional")}</span><input ?disabled=${Boolean(this.#intake)} maxlength="400" placeholder=${this.i18n.system("Safety, brand, legal, or accuracy boundaries")} .value=${this.#boundary} @input=${(event:InputEvent)=>{this.#boundary=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label>
        <label>${this.i18n.system("Owned or licensed source excerpt")} <span>${this.i18n.system("optional")}</span><textarea ?disabled=${Boolean(this.#intake)} rows="3" maxlength="5000" placeholder=${this.i18n.system("Paste a source passage that should ground every output")} .value=${this.#source} @input=${(event:InputEvent)=>{this.#source=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea></label>
        ${this.#source.trim()?html`<label class="rights-check"><input type="checkbox" ?disabled=${Boolean(this.#intake)} .checked=${this.#sourceRights} @change=${(event:Event)=>{this.#sourceRights=(event.target as HTMLInputElement).checked;this.requestUpdate();}}><span>${this.i18n.system("I own this passage or have permission to use it.")}</span></label>`:nothing}
        ${this.#intakeIssue?html`<p role="status">${this.#intake?.confirmed?this.i18n.t("projects.originalConfirmedUnavailable","Creation confirmed. The original document cannot currently be opened. Check its availability; no new project will be created."):this.i18n.t("projects.originalUnconfirmed","The original creation is unresolved. Check it or retry the same creation; no replacement will be created.")}</p>`:nothing}
        <footer><button type="button" class="button ghost" @click=${this.#close}>${this.#intake?this.i18n.t("action.close","Close"):this.i18n.t("action.cancel","Cancel")}</button>${this.#intake?html`<button type="button" class="button secondary" ?disabled=${this.#submitting} @click=${this.#checkIntake}>${this.#intake?.confirmed?this.i18n.t("projects.checkOriginalAvailability","Check original availability"):this.i18n.t("projects.checkOriginal","Check original")}</button>`:nothing}${this.#intake?.confirmed?nothing:html`<button class="button primary" ?disabled=${this.#submitting||!this.#name.trim()||Boolean(this.#source.trim()&&!this.#sourceRights)}>${this.#intake?this.i18n.t("projects.retryOriginal","Retry same creation"):this.i18n.t("projects.createAction","Create project")}</button>`}</footer>
      </form>
    </dialog>`:""}
  </section>`;}
}
if (!customElements.get("forma-projects")) customElements.define("forma-projects",FormaProjects);
