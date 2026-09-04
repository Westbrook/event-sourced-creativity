import { html, noChange, nothing } from "lit";
import { navigateInApp, performOperationInApp, type CommandDeparture, type CommandOperation, type OwnOperationAdmission } from "./command-departure";
import { creativeNextActions, type CreativeNextAction } from "../model/workspace-intelligence";
import { nextActionFacts } from "../state/next-action-context";
import { renderLifecycleNextActionCards } from "./next-action-cards";
import { openCreativeNextActionDestination } from "./creative-next-action-navigation";

import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import { projectIntakeMessage, type ProjectIntakeMessage } from "./design-system/locales/project-intake-messages";
import { OUTCOME_RECIPE_IDS, outcomeRecipe, outcomeRecipeFileChoices, type OutcomeRecipeId, type OutcomeRecipeInput } from "../model/outcome-recipes";
import { OUTCOME_RECIPE_MESSAGES } from "./design-system/locales/outcome-recipe-messages";
import { outcomeRecipeDraftLabels, outcomeRecipeDraftMessage } from "./design-system/locales/outcome-recipe-draft-messages";
import { handoffIntakeRecipe } from "./intake-recipe-handoff";
import "./forma-project-intake.css";
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
  #intakePosture:"intent"|"review"="intent";#intakeChoice:"brief"|"blank"="brief";
  #intakeDetailsOpen=false;#intakeSourceOpen=false;#intakeComposing=false;
  #intakeOutcomeCorrectionId=`project-intake-outcome-${crypto.randomUUID()}`;
  #intakeRecipeId:OutcomeRecipeId|""="";#intakeRecipeChoices=new Set<string>();#intakeRecipeOpen=false;
  #intakeRecipeCatalog(){const family=this.i18n.locale.toLowerCase().split(/[-_]/)[0];return OUTCOME_RECIPE_MESSAGES[family==="fr"?"fr":family==="ar"?"ar":family==="ja"?"ja":"en"];}
  #intakeRecipeValid(){return !this.#intakeRecipeId||Boolean(this.#intakeRecipeChoices.size)&&[...this.#intakeRecipeChoices].every(key=>outcomeRecipeFileChoices(this.#intakeRecipeId as OutcomeRecipeId).some(choice=>choice.key===key));}
  #intakeRecipeInput():OutcomeRecipeInput|null{
    if(this.#intakeChoice!=="brief"||!this.#intakeRecipeId||!this.#intakeRecipeValid())return null;
    return{recipeId:this.#intakeRecipeId,originalText:this.#deliverable.trim()?this.#deliverable:this.#objective,selectedChoices:[...this.#intakeRecipeChoices]};
  }
  #recipePicker(){
    const catalog=this.#intakeRecipeCatalog(),labels=outcomeRecipeDraftLabels(this.i18n.locale,"");
    return html`<details data-intake-recipe .open=${this.#intakeRecipeOpen} @toggle=${(event:Event)=>{this.#intakeRecipeOpen=(event.currentTarget as HTMLDetailsElement).open;}}><summary>${this.#intakeCopy("recipe")}</summary>
      <p>${this.#intakeCopy("recipeHint")}</p><label>${catalog.recipes}<select data-intake-recipe-choice ?disabled=${!this.#intakeEditable()} .value=${this.#intakeRecipeId} @change=${(event:Event)=>{
        if(!this.#intakeEditable()||this.#intakeComposing)return;
        this.#intakeRecipeId=outcomeRecipe((event.target as HTMLSelectElement).value)?.id??"";this.#intakeRecipeChoices.clear();this.requestUpdate();
      }}><option value="" ?selected=${this.#intakeRecipeId===""}>${catalog.noRecipe}</option>${OUTCOME_RECIPE_IDS.map(id=>html`<option value=${id} ?selected=${id===this.#intakeRecipeId}>${catalog.recipesById[id].title}</option>`)}</select></label>
      ${this.#intakeRecipeId?html`<fieldset ?disabled=${!this.#intakeEditable()}><legend>${outcomeRecipeDraftMessage(this.i18n.locale,"choices")}</legend>${outcomeRecipeFileChoices(this.#intakeRecipeId).map(choice=>html`<label class="ui-choice"><input type="checkbox" data-intake-recipe-file=${choice.key} .checked=${this.#intakeRecipeChoices.has(choice.key)} @change=${(event:Event)=>{
        if(!this.#intakeEditable()||this.#intakeComposing)return;
        if((event.target as HTMLInputElement).checked)this.#intakeRecipeChoices.add(choice.key);else this.#intakeRecipeChoices.delete(choice.key);this.requestUpdate();
      }}><span>${labels.choices[choice.key]}</span></label>`)}</fieldset><p>${outcomeRecipeDraftMessage(this.i18n.locale,"limitation")}</p>${!this.#intakeRecipeValid()?html`<p role="status">${this.#intakeCopy("chooseFiles")}</p>`:nothing}`:nothing}
    </details>`;
  }
  #intakeCopy(key:ProjectIntakeMessage){return projectIntakeMessage(this.i18n.locale,key);}
  #intakeEditable(){return this.#creating&&!this.#intake&&!this.#submitting&&Boolean(this.#draftScope)&&this.#draftScope===this.#draftScopeKey()&&this.store.sourceOwnershipActive(this.store.captureSourceOwnership());}
  #reviewOutcomeMissing(){return !this.#intake&&this.#intakePosture==="review"&&this.#intakeChoice==="brief"&&!this.#intakeComposing&&!this.#objective.trim();}
  #briefValues():Omit<ProjectBriefDraft,"projectId"|"documentId">{
    const blank=this.#intakeChoice==="blank";
    return{name:this.#name,documentTitle:this.#documentTitle,objective:blank?"":this.#objective,audience:blank?"":this.#audience,
      message:blank?"":this.#message,protectedPhrase:blank?"":this.#protectedPhrase,deliverable:blank?"":this.#deliverable,
      boundary:blank?"":this.#boundary,source:blank?"":this.#source,sourceRights:blank?false:this.#sourceRights};
  }
  #canReviewIntake(){return this.#intakeEditable()&&!this.#intakeComposing&&Boolean(this.#objective.trim())&&(!this.#source.trim()||this.#sourceRights)&&this.#intakeRecipeValid();}
  #reviewIntake(blank=false){
    if(!this.#intakeEditable()||this.#intakeComposing||!blank&&!this.#canReviewIntake())return;
    this.#intakeChoice=blank?"blank":"brief";this.#intakePosture="review";this.requestUpdate();this.#focusIntake(false);
  }
  #backIntake(){if(!this.#intakeEditable()||this.#intakeComposing)return;this.#intakePosture="intent";this.requestUpdate();this.#focusIntake(false);}
  #focusIntake(preventScroll=true){
    const opening=this.#intakeOpening,scope=this.#draftScopeKey(),source=this.store.captureSourceOwnership(),posture=this.#intakePosture;
    const current=()=>this.isConnected&&this.#creating&&opening!==null&&this.#intakeOpening===opening&&this.#intakePosture===posture
      &&Boolean(scope)&&this.#draftScope===scope&&this.#draftScopeKey()===scope&&this.store.sourceOwnershipActive(source);
    const focus=captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>{
      const dialog=this.querySelector<HTMLDialogElement>(".project-create-dialog");
      const form=dialog?.querySelector<HTMLFormElement>("form.project-intake");
      return current()&&Boolean(dialog?.contains(element))&&(element.matches(".modal-close")||element.matches("[data-intake-outcome]")
        ||element===form&&element.closest("dialog")===dialog&&element.closest("forma-projects")===this);
    }});
    void this.updateComplete.then(()=>{
      if(!current()||!focus.current())return;
      const target=this.querySelector<HTMLElement>(this.#intake?".modal-close":posture==="intent"?"[data-intake-outcome]":"[data-intake-name] input");
      if(target&&!target.matches(":disabled"))focus.run(target,()=>{target.focus({preventScroll});return true;});
    }).finally(()=>focus.dispose());
  }
  #revealIntakeFocus(event: FocusEvent) {
    const path = event.composedPath(), target = path[0], form = event.currentTarget;
    const dialog = this.querySelector<HTMLDialogElement>(".project-create-dialog");
    if (!this.isConnected || !this.#creating || !this.#intakeOpening
      || !this.#draftScope || this.#draftScope !== this.#draftScopeKey()
      || !(form instanceof HTMLFormElement) || !(target instanceof HTMLElement)
      || form.ownerDocument !== this.ownerDocument || target.ownerDocument !== this.ownerDocument
      || !form.isConnected || !target.isConnected || !dialog?.isConnected || !dialog.matches(":modal")
      || form !== dialog.querySelector("form.project-intake") || form.closest("forma-projects") !== this
      || path.find(element => element instanceof HTMLFormElement) !== form
      || path.find(element => element instanceof HTMLDialogElement) !== dialog
      || !target.matches("button,input,select,textarea,summary")
      || !target.matches(":focus-visible") || target.matches(":disabled")) return;
    const root = target.getRootNode() as Document | ShadowRoot;
    if (root.activeElement !== target) return;
    // Keep the native focus destination; reveal its complete box and focus ring.
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }
  #submitIntake(event:SubmitEvent){
    event.preventDefault();if(this.#intakeComposing)return;
    if(this.#intakePosture==="intent"&&!this.#intake){this.#reviewIntake();return;}
    if(!this.#intake&&this.#intakeChoice==="brief"&&(!this.#objective.trim()||!this.#intakeRecipeValid()))return;
    return this.#create(event);
  }
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
    this.#intakeComposing=false;this.#draftScope=scope;
    const opening={};this.#intakeOpening=opening;this.#creating=true;
    this.requestUpdate();this.#focusIntake(false);
  }
  #clearDraft(){this.#name="";this.#documentTitle="";this.#objective="";this.#audience="";this.#message="";this.#protectedPhrase="";this.#deliverable="";this.#boundary="";this.#source="";this.#sourceRights=false;this.#intakePosture="intent";this.#intakeChoice="brief";this.#intakeDetailsOpen=false;this.#intakeSourceOpen=false;this.#intakeComposing=false;this.#intakeRecipeId="";this.#intakeRecipeChoices.clear();this.#intakeRecipeOpen=false;}
  #hasIntakeDraftInput(){return Boolean(this.#name||this.#documentTitle||this.#objective||this.#audience||this.#message
    ||this.#protectedPhrase||this.#deliverable||this.#boundary||this.#source||this.#sourceRights||this.#intakeRecipeId||this.#intakeRecipeChoices.size);}
  #discardIntakeControl(){
    if(this.#intake||!this.#hasIntakeDraftInput())return nothing;
    const store=this.store,opening=this.#intakeOpening,scope=this.#draftScope,source=store.captureSourceOwnership();
    return html`<button data-intake-discard type="button" class="button ghost" ?disabled=${!this.#intakeEditable()||this.#intakeComposing}
      @click=${(event:MouseEvent)=>{
        const button=event.currentTarget as HTMLButtonElement|null,form=this.querySelector<HTMLFormElement>("form.project-intake"),
          dialog=this.querySelector<HTMLDialogElement>(".project-create-dialog");
        if(event.type!=="click"||!button?.isConnected||!form?.isConnected||!dialog?.isConnected||!dialog.open
          ||button!==form.querySelector("[data-intake-discard]")||button.closest("form")!==form||form.closest("dialog")!==dialog
          ||form.closest("forma-projects")!==this||button.ownerDocument!==this.ownerDocument||form.ownerDocument!==this.ownerDocument
          ||dialog.ownerDocument!==this.ownerDocument||!event.target||!button.contains(event.target as Node)
          ||button.matches(":disabled")||button.getAttribute("aria-disabled")==="true"||button.closest("[hidden],[inert]")
          ||!opening||this.#intakeOpening!==opening||this.store!==store||this.#draftScope!==scope
          ||!store.sourceOwnershipActive(source)||!this.#intakeEditable()||this.#intakeComposing||!this.#hasIntakeDraftInput())return;
        // Only unsent local input is discarded. Native close keeps its own
        // opener restoration; there is no request, automatic route or new focus owner.
        this.#discardDraft();
      }}>${this.#intakeCopy("discardDraft")}</button>`;
  }
  // Dismiss only this presentation; the original request and its write lock remain owned.
  #close(){this.#intakeOpening=null;this.querySelector<HTMLDialogElement>(".project-create-dialog")?.close();this.#creating=false;this.requestUpdate();}
  async #create(event:SubmitEvent){
    event.preventDefault();
    if(this.#submitting||!this.#creating||this.#intake?.confirmed)return;
    await performOperationInApp(this,"project-intake-commit",event);
  }
  async #checkIntake(event:MouseEvent){
    if(!this.#submitting&&this.#intake)await performOperationInApp(this,"project-intake-check",event);
  }
  captureCommandOperation(operation:string,event:Event):CommandOperation|null{
    const mode=operation==="project-intake-commit"?"commit":operation==="project-intake-check"?"check":null;
    if(!mode||!event)return null;
    const form=this.querySelector<HTMLFormElement>("form.project-intake"),dialog=this.querySelector<HTMLDialogElement>(".project-create-dialog");
    if(!form?.isConnected||!dialog?.isConnected||!dialog.open||!dialog.contains(form)
      ||form.closest("dialog")!==dialog||form.closest("forma-projects")!==this
      ||form.ownerDocument!==this.ownerDocument||dialog.ownerDocument!==this.ownerDocument)return null;
    let trigger:HTMLElement;
    if(mode==="commit"){
      if(event.type!=="submit"||event.currentTarget!==form||event.target!==form)return null;
      const submitter=(event as SubmitEvent).submitter;
      if(submitter&&(!form.contains(submitter)||submitter.getAttribute("type")!=="submit"))return null;
      trigger=submitter??form;
    }else{
      const check=this.querySelector<HTMLButtonElement>("[data-intake-original]");
      if(!check||event.type!=="click"||event.currentTarget!==check||!form.contains(check)
        ||!event.target||!check.contains(event.target as Node))return null;
      trigger=check;
    }
    const visible=(element:HTMLElement)=>{
      const style=element.ownerDocument.defaultView?.getComputedStyle(element);
      if(!style)return false;
      return element.isConnected&&element.getClientRects().length>0&&!element.closest("[hidden],[inert]")
        &&style.display!=="none"&&style.visibility!=="hidden"
        &&style.visibility!=="collapse"&&style.contentVisibility!=="hidden";
    };
    if(!visible(form)||!visible(trigger)||trigger.matches(":disabled")||trigger.getAttribute("aria-disabled")==="true")return null;
    const store=this.store,scope=this.#draftScope,opening=this.#intakeOpening,source=store.captureSourceOwnership();
    const posture=this.#intakePosture,choice=this.#intakeChoice;
    let attempt=this.#intake,started=false;
    // Native event/form admission above is synchronous. The subsequent owner
    // is this original logical opening and attempt, not a fresh DOM/focus grant.
    const current=()=>this.isConnected&&this.store===store&&this.#creating&&opening!==null&&this.#intakeOpening===opening
      &&Boolean(scope)&&this.#draftScope===scope&&this.#draftScopeKey()===scope&&store.sourceOwnershipActive(source)
      &&this.#intakePosture===posture&&this.#intakeChoice===choice&&this.#intake===attempt
      &&Boolean(this.querySelector<HTMLDialogElement>(".project-create-dialog")?.open);
    const canStart=()=>{
      if(this.#submitting||this.#intakeComposing)return false;
      if(mode==="check")return Boolean(attempt);
      if(attempt)return !attempt.confirmed;
      const values=this.#briefValues();
      return this.#intakePosture==="review"&&this.#intakeEditable()&&Boolean(values.name.trim())
        &&(!values.source.trim()||values.sourceRights)
        &&(this.#intakeChoice==="blank"||!this.#reviewOutcomeMissing()&&this.#intakeRecipeValid());
    };
    if(!current()||!canStart())return null;
    return {element:this,current,blocked:()=>!started&&!canStart(),reason:()=>"next.lifecycle.currentWorkOpen",start:admission=>{
      if(started||!current()||!canStart()||!admission.current())return;
      if(!attempt){
        const name=this.#name.trim(),actorUserId=store.session.get()?.user.userId;
        if(!actorUserId)return;
        const brief=projectBriefEvents({projectId:crypto.randomUUID(),documentId:crypto.randomUUID(),...this.#briefValues()});
        if(!brief)return;
        this.#intake={brief,name,actorUserId,confirmed:false};attempt=this.#intake;
      }
      started=true;
      return this.#runIntake(mode,admission);
    }};
  }
  async #runIntake(mode:"commit"|"check",admission:OwnOperationAdmission){
    const attempt=this.#intake,opening=this.#intakeOpening,route=this.store.route.get(),source=this.store.captureSourceOwnership();
    if(!attempt||!opening||attempt.actorUserId!==this.store.session.get()?.user.userId||!this.store.sourceOwnershipActive(source))return;
    let owned=true;
    const current=()=>owned&&this.isConnected&&this.#creating&&this.#intake===attempt&&this.#intakeOpening===opening
      &&this.store.route.get()===route&&this.store.session.get()?.user.userId===attempt.actorUserId&&this.store.sourceOwnershipActive(source);
    const unsubscribe=this.store.subscribe(()=>{if(!current())owned=false;});
    const recipe=this.#intakeRecipeInput(),recipeDocument=attempt.brief.events.find(event=>event.type==="DocumentCreated");
    const recipeDocumentId=String(recipeDocument?.payload.document_id??""),recipeProjectId=String(recipeDocument?.payload.project_id??"");
    const recipeFocus=recipe?captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>{
      const projection=this.store.projection.get(),arrival=this.store.route.get();
      const destination=withDocumentInRoute("/",recipeDocumentId,projection.documents.find(document=>document.id===recipeDocumentId&&document.projectId===recipeProjectId)?.title??"");
      return (arrival===destination||arrival===withDocumentInRoute("/",recipeDocumentId))
        &&projection.documentId===recipeDocumentId&&projection.projectId===recipeProjectId
        &&this.store.sourceOwnershipActive(source)&&this.store.session.get()?.user.userId===attempt.actorUserId
        &&element.matches("#main-content")&&element.closest("forma-shell")!==null;
    }}):null;
    this.#submitting=true;this.#intakeIssue=false;this.requestUpdate();
    try{
      const controls={current:()=>current()&&admission.current()};
      const result=await (mode==="check"?this.store.checkProjectIntake(attempt.brief.events,controls):this.store.commitProjectIntake(attempt.brief.events,controls))
        .finally(()=>admission.dispose());
      // Publication may legitimately replace the old sibling scope. Only the
      // exact receipt and this original attempt own refresh/arrival from here.
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
      const opened=await this.store.transitionWorkspace(destination,{documentId,documentFocus:false,current,...(recipeFocus?{focus:recipeFocus}:{})});
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
      if(recipe&&recipeFocus){
        // The receipt and exact Document transition above are already confirmed.
        // Transfer authored choices only; a failure must never retry creation.
        const arrived=()=>this.store.route.get()===arrival&&this.store.sourceOwnershipActive(source)
          &&this.store.projection.get().projectId===projectId&&this.store.projection.get().documentId===documentId
          &&this.store.session.get()?.user.userId===attempt.actorUserId;
        const staged=await handoffIntakeRecipe(this.store,this.ownerDocument,recipe,{projectId,documentId,actorUserId:attempt.actorUserId,route:arrival},{current:arrived,focus:recipeFocus});
        if(arrived()&&["existing-draft","forbidden","unavailable"].includes(staged))this.store.toast(outcomeRecipeDraftMessage(this.i18n.locale,"intakeUnavailable"));
      }
    }catch{if(current())this.#intakeIssue=true;}finally{
      unsubscribe();recipeFocus?.dispose();
      if(this.#intake===attempt){this.#submitting=false;this.requestUpdate();}
    }
  }
  #lifecycleOpening=0;
  #nextContext(){
    const projection=this.store.projection.get();
    const document=projection.documents.find(value=>value.id===projection.documentId&&value.projectId===projection.projectId&&!value.removed);
    if(!document||!this.store.routeDataReady())return null;
    const facts=nextActionFacts(this.store,document.id,null,{lifecycle:true});
    return facts.canRead?{facts,document,projectName:projection.projectName}:null;
  }
  #navigationBlocked(){
    return Boolean(this.#creating||this.#submitting||this.#intake||this.#intakeOpening||this.#hasIntakeDraftInput());
  }
  captureCommandDeparture():CommandDeparture {
    const scope=this.#draftScope;
    return {element:this,current:()=>this.isConnected&&this.#draftScope===scope,
      // A settled original is not an unsent draft or server cancellation.
      // Its locked submitted fields cannot become a newer editable B here.
      blocked:()=>this.#intake?Boolean(this.#creating||this.#submitting||this.#intakeOpening):this.#navigationBlocked(),
      reason:()=>"next.lifecycle.currentWorkOpen"};
  }
  async #followLifecycleAction(action:CreativeNextAction){
    const next=this.#nextContext(),route=this.store.route.get();
    if(!next||action.target.documentId!==next.document.id)return false;
    if(this.#navigationBlocked()){
      this.store.toast(this.i18n.t("next.lifecycle.currentWorkOpen","Save or discard local edits, clear unsent text, or check the current request before continuing. Closing a panel may retain work; wait if the request is running."));return false;
    }
    const request=++this.#lifecycleOpening;
    const originCurrent=()=>this.isConnected&&request===this.#lifecycleOpening&&this.store.route.get()===route
      &&this.store.projection.get().projectId===action.target.projectId&&this.store.projection.get().documentId===action.target.documentId
      &&!this.#navigationBlocked();
    let navigationRefusal="";
    const opened=await openCreativeNextActionDestination(this.store,this.ownerDocument,action,{
      origin:this,originCurrent,navigationCurrent:()=>request===this.#lifecycleOpening,
      onRefusal:reason=>{navigationRefusal=reason;},
    });
    if(!opened&&navigationRefusal!=="current-work"&&originCurrent())this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));
    return opened;
  }
  #openProject(projectId:string,destination:string){
    return navigateInApp(this,navigation=>this.store.openProject(projectId,destination,navigation));
  }
  override render(){if(!this.store.sourceOwnershipActive(this.store.captureSourceOwnership()))return nothing;const next=this.#nextContext();const p=this.store.projection.get();const shared=Boolean(this.store.session.get()?.projectContext);const canvas=this.#inCanvas();const destination=this.#destination();return html`<section class="projects-page page-pad">
    <header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${canvas?this.i18n.t("projects.canvasEyebrow","Canvas / All projects"):this.i18n.t("projects.creatorEyebrow","Creator Workspace / All projects")}</span><h1>${this.i18n.t("shell.navigation.projects","Projects")}</h1><p>${this.#intake?this.i18n.t("next.projects.recoveryLifetime","You can close and resume here. Leaving this Projects page removes the local recovery controls; it does not cancel the creation."):this.i18n.t("projects.description","Choose the project that contains your documents, collections, creative context, outputs, and boards.")}</p></div>${shared?nothing:html`<div class="page-header-actions"><forma-ui-button .label=${this.#createLabel(this.i18n.t("projects.new","New project"))} icon-name="plus" variant="primary" @forma-press=${this.#openCreate}></forma-ui-button></div>`}</header>
    <div class="projects-grid">${p.projects.map((project)=>{const current=project.id===p.projectId;const latest=project.recentGenerations[0]??null;const latestArtifact=project.recentArtifacts[0]??null;const displayArtifact=latestArtifact&&(!latest||latestArtifact.sequence>latest.sequence)?latestArtifact:null;const name=`\u2068${project.name}\u2069`;const state=this.i18n.t(`projects.state.${project.state}`,project.state);const documents=this.i18n.plural("projects.document",project.documentCount,"{count} document","{count} documents");const ideas=this.i18n.plural("projects.idea",project.outputCount,"{count} finished or in-progress idea","{count} finished or in-progress ideas");return html`<article class=${`project-card ${current?"current":""}`} aria-label=${this.i18n.t(current?"projects.cardCurrent":"projects.card",current?"{name}, {state} project, currently open":"{name}, {state} project",{name,state})}>
      <header><span class="project-card-kind">${this.i18n.t("projects.workspaceKind","Creative workspace")}</span><forma-ui-badge .label=${current?this.i18n.t("projects.stateOpen","{state} · open",{state}):state} .tone=${current?"positive":"neutral"}></forma-ui-badge></header>
      <div class="project-card-title"><h2 dir="auto">${project.name}</h2><p>${current?this.i18n.t("projects.continueHint","Continue where you left off."):this.i18n.t("projects.projectSummary","{documents} and {ideas}.",{documents,ideas})}</p></div>
      ${current&&next?renderLifecycleNextActionCards(creativeNextActions(next.facts),this.i18n,action=>void this.#followLifecycleAction(action),{projectName:next.projectName,documentTitle:next.document.title,scopeUnknown:next.facts.lifecycle?.output.scopeKnown!==true,creatorHandoff:canvas}):nothing}
      <button type="button" class=${`project-card-generation ${latest?.kind==="fan"&&!displayArtifact?"fan":"single"}`} data-forma-content=${displayArtifact||latest?"primary":nothing} aria-label=${this.i18n.t("projects.openNamed","Open project {name}",{name})} @click=${()=>{const resultDocumentId=displayArtifact?.documentId??latest?.documentId;const resultDestination=!canvas&&resultDocumentId?withDocumentInRoute("/#output-title",resultDocumentId,p.documents.find((document)=>document.id===resultDocumentId)?.title??""):destination;void this.#openProject(project.id,resultDestination);}}>
        ${displayArtifact?html`<forma-artifact-summary .artifact=${displayArtifact} .compact=${true}></forma-artifact-summary><span><b>Latest ${documentArtifactDefinition(displayArtifact.kind).label.toLowerCase()}</b><small>${displayArtifact.title} · open project ${icon("arrow")}</small></span>`:latest?html`${latest.kind==="fan"?html`<forma-prompt-fan-visual .outputs=${latest.outputs} .compact=${true}></forma-prompt-fan-visual>`:html`<forma-output-visual .output=${latest.output} .compact=${true}></forma-output-visual>`}<span><b>${latest.kind==="fan"?this.i18n.system("Latest fan · {complete} images", { complete: this.i18n.number(latest.complete) }):this.i18n.system("Latest generation")}</b><small>${generationHistoryItemIsDraft(latest)?this.i18n.system("Draft / low quality"):this.i18n.system("Full quality")} · open project ${icon("arrow")}</small></span>`:html`<span class="project-card-generation-empty">${icon("image")}<b>${this.i18n.t("projects.noFinishedWork","No finished work yet")}</b><small>${shared&&!this.store.session.get()?.projectContext?.permissions.includes("project.output.request")?this.i18n.t("projects.viewerFirstResult","A project editor can create the first shared result."):this.i18n.t("projects.firstResult","Open the project to create its first result.")}</small></span>`}
      </button>
      <footer>${project.state==="archived"&&!shared?html`<button type="button" class="button primary" @click=${async()=>{const restored=await this.store.append({type:"ProjectStateChanged",payload:{project_id:project.id,state:"active",previous_state:"archived"}});if(restored.length)this.store.toast(this.i18n.system("{name} restored with its complete history and finished work.",{name:project.name}));}}>Restore project</button>`:html`<button class=${`button ${current?"secondary":"primary"}`} aria-label=${this.i18n.t(current?"projects.continueNamed":"projects.openNamed",current?"Continue working on {name}":"Open project {name}",{name:`\u2068${project.name}\u2069`})} @click=${()=>this.#openProject(project.id,destination)}>${current?this.i18n.t("projects.continue","Continue working"):this.i18n.t("projects.open","Open project")} ${icon("arrow")}</button>`}${canvas?html`<button class="button ghost" aria-label=${this.i18n.t("projects.openLibraryNamed","Open project library for {name}",{name:`\u2068${project.name}\u2069`})} @click=${async()=>{await this.#openProject(project.id,"/canvas/library");}}>${this.i18n.t("projects.openLibrary","Open project library")}</button>`:html`<button class="button ghost" @click=${async()=>{await this.#openProject(project.id,"/studio/project");}}>View project contents</button>`}${!canvas&&this.store.session.get()?.canvas.access&&(!shared||project.id===this.store.session.get()?.projectContext?.projectId&&Boolean(this.store.session.get()?.projectContext?.permissions.includes("project.canvas.use")))?html`<button class="button ghost" aria-label=${this.i18n.t("projects.openCanvasNamed","Open in Canvas: {name}",{name:`\u2068${project.name}\u2069`})} @click=${async()=>{await this.#openProject(project.id,"/canvas");}}>${this.i18n.t("projects.openCanvas","Open in Canvas")}</button>`:nothing}</footer>
      <div class="project-card-summary"><span><strong>${project.documentCount}</strong><small>${this.i18n.plural("projects.summary.documentNoun",project.documentCount,"document","documents")}</small></span><p><b>${project.blockCount}</b> ${this.i18n.plural("projects.summary.decisionNoun",project.blockCount,"creative decision","creative decisions")}, <b>${project.outputCount}</b> ${this.i18n.plural("projects.summary.outputNoun",project.outputCount,"output","outputs")}${project.artifactCount?(project.artifactCount===1 ? " " + this.i18n.system("including {artifactCount} narrative, presentation, or motion result", { artifactCount: this.i18n.number(project.artifactCount) }) : " " + this.i18n.system("including {artifactCount} narrative, presentation, or motion results", { artifactCount: this.i18n.number(project.artifactCount) })):""}${this.i18n.system(", and")} <b>${project.collectionCount}</b> ${this.i18n.plural("projects.summary.collectionNoun",project.collectionCount,"collection","collections")}.</p></div>
    </article>`;})}${!p.projects.length?html`<forma-ui-empty-state .heading=${this.i18n.t("projects.emptyHeading","Give your next idea a home")} .detail=${this.i18n.t("projects.emptyDetail","A project keeps its documents, references, reusable decisions, and finished work together.")} .action=${this.#createLabel(this.i18n.t("projects.emptyAction","Create your first project"))} @forma-action=${this.#openCreate}></forma-ui-empty-state>`:""}</div>
    ${this.#creating?html`<dialog class="modal project-create-dialog" closedby="any" aria-labelledby="new-project-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}} @close=${()=>{if(this.#creating){this.#creating=false;this.requestUpdate();}}}>
      <form class="modal-card wide project-intake" aria-busy=${String(this.#submitting)} @submit=${this.#submitIntake} @focusin=${this.#revealIntakeFocus}
        @compositionstart=${()=>{this.#intakeComposing=true;}} @compositionend=${()=>{this.#intakeComposing=false;this.requestUpdate();}}>
        <button type="button" class="icon-button modal-close" aria-label=${this.i18n.t("action.close","Close")} @click=${this.#close}>${icon("close")}</button>
        <span class="eyebrow">${this.i18n.t("projects.createEyebrow","New replayable workspace")}</span>
        <h2 id="new-project-title">${this.#intakeCopy(this.#intakePosture==="intent"&&!this.#intake?"outcome":"review")}</h2>
        ${this.#intakePosture==="intent"&&!this.#intake?html`
          <label>${this.#intakeCopy("outcome")}<textarea data-intake-outcome rows="3" maxlength="1200" placeholder=${this.i18n.system("The outcome, decision, or change this project should create")} .value=${this.#intakeComposing?noChange:this.#objective} @input=${(event:InputEvent)=>{if(this.#intakeEditable()){this.#objective=(event.target as HTMLTextAreaElement).value;if(!this.#intakeComposing)this.requestUpdate();}}}></textarea></label>
          <details .open=${this.#intakeSourceOpen} @toggle=${(event:Event)=>{this.#intakeSourceOpen=(event.target as HTMLDetailsElement).open;}}><summary>${this.#intakeCopy("addSource")}</summary>
            <label>${this.i18n.system("Owned or licensed source excerpt")} <span>${this.i18n.system("optional")}</span><textarea rows="3" maxlength="5000" placeholder=${this.i18n.system("Paste a source passage that should ground every output")} .value=${this.#intakeComposing?noChange:this.#source} @input=${(event:InputEvent)=>{if(this.#intakeEditable()){this.#source=(event.target as HTMLTextAreaElement).value;if(!this.#intakeComposing)this.requestUpdate();}}}></textarea></label>
            ${this.#source.trim()?html`<label class="rights-check"><input type="checkbox" .checked=${this.#sourceRights} @change=${(event:Event)=>{if(this.#intakeEditable()){this.#sourceRights=(event.target as HTMLInputElement).checked;this.requestUpdate();}}}><span>${this.i18n.system("I own this passage or have permission to use it.")}</span></label>${!this.#sourceRights?html`<p role="status">${this.#intakeCopy("rights")}</p>`:nothing}`:nothing}
          </details>${this.#recipePicker()}<p>${this.#intakeCopy("free")}</p>
        `:html`
          <p>${this.#intakeCopy(this.#intakeChoice==="blank"?"blankDescription":"reviewDescription")}</p>
          ${this.#intakeChoice==="brief"&&this.#intakeRecipeId?html`<section data-intake-recipe-review><h3>${this.#intakeRecipeCatalog().recipesById[this.#intakeRecipeId].title}</h3><p>${this.#intakeCopy("recipeHint")}</p><ul>${[...this.#intakeRecipeChoices].map(key=>html`<li>${outcomeRecipeDraftLabels(this.i18n.locale,"").choices[key]}</li>`)}</ul>${this.#intakeRecipeInput()?.originalText===this.#objective?nothing:html`<p dir="auto">${this.#intakeRecipeInput()?.originalText}</p>`}</section>`:nothing}
          ${this.#intakeChoice==="brief"?html`<dl class="project-intake-summary"><dt>${this.#intakeCopy("outcome")}</dt><dd data-intake-outcome-review dir="auto">${this.#objective}</dd>${this.#source.trim()?html`<dt>${this.i18n.system("Owned or licensed source excerpt")}</dt><dd dir="auto">${this.#source}</dd><dt>${this.#intakeCopy("sourceRights")}</dt><dd>${this.#sourceRights?this.#intakeCopy("rightsAsserted"):this.#intakeCopy("rights")}</dd>`:nothing}</dl>`:nothing}
          ${this.#reviewOutcomeMissing()?html`<p id=${this.#intakeOutcomeCorrectionId} role="status">${this.#intakeCopy("outcomeRequired")}</p>`:nothing}
          <forma-ui-field data-intake-name .disabled=${Boolean(this.#intake)||this.#submitting} .label=${this.i18n.t("projects.projectName","Project name")} .placeholder=${this.i18n.t("projects.projectNamePlaceholder","e.g. Autumn campaign")} max-length="80" required .value=${this.#intakeComposing?noChange:this.#name} @forma-input=${(event:CustomEvent<{value:string}>)=>{if(this.#intakeEditable()){this.#name=event.detail.value;if(!this.#intakeComposing)this.requestUpdate();}}}></forma-ui-field>
          <details .open=${this.#intakeDetailsOpen} @toggle=${(event:Event)=>{this.#intakeDetailsOpen=(event.target as HTMLDetailsElement).open;}}><summary>${this.#intakeCopy("details")}</summary>
            <fieldset ?disabled=${Boolean(this.#intake)||this.#submitting}><legend class="sr-only">${this.#intakeCopy("details")}</legend>
              <forma-ui-field .disabled=${Boolean(this.#intake)||this.#submitting} .label=${this.i18n.system("Document name")} .placeholder=${this.i18n.system("New document")} .help=${this.i18n.system("Optional—Forma can derive one.")} max-length="80" .value=${this.#intakeComposing?noChange:this.#documentTitle} @forma-input=${(event:CustomEvent<{value:string}>)=>{if(this.#intakeEditable()){this.#documentTitle=event.detail.value;if(!this.#intakeComposing)this.requestUpdate();}}}></forma-ui-field>
              ${this.#intakeChoice==="brief"?html`
                <label>${this.#intakeCopy("outcome")}<textarea data-intake-outcome-edit rows="3" maxlength="1200" aria-required="true" aria-invalid=${this.#reviewOutcomeMissing()?"true":nothing} aria-describedby=${this.#reviewOutcomeMissing()?this.#intakeOutcomeCorrectionId:nothing} .value=${this.#intakeComposing?noChange:this.#objective} @input=${(event:InputEvent)=>{if(this.#intakeEditable()){this.#objective=(event.target as HTMLTextAreaElement).value;if(!this.#intakeComposing)this.requestUpdate();}}}></textarea></label>
                <label>${this.i18n.system("Owned or licensed source excerpt")} <span>${this.i18n.system("optional")}</span><textarea rows="3" maxlength="5000" placeholder=${this.i18n.system("Paste a source passage that should ground every output")} .value=${this.#intakeComposing?noChange:this.#source} @input=${(event:InputEvent)=>{if(this.#intakeEditable()){this.#source=(event.target as HTMLTextAreaElement).value;if(!this.#intakeComposing)this.requestUpdate();}}}></textarea></label>
                ${this.#source.trim()?html`<label class="rights-check"><input type="checkbox" .checked=${this.#sourceRights} @change=${(event:Event)=>{if(this.#intakeEditable()){this.#sourceRights=(event.target as HTMLInputElement).checked;this.requestUpdate();}}}><span>${this.i18n.system("I own this passage or have permission to use it.")}</span></label>${!this.#sourceRights?html`<p role="status">${this.#intakeCopy("rights")}</p>`:nothing}`:nothing}
                <label>${this.i18n.system("Who needs to use or approve it?")} <span>${this.i18n.system("optional")}</span><input maxlength="240" placeholder=${this.i18n.system("Audience, stakeholders, or decision makers")} .value=${this.#intakeComposing?noChange:this.#audience} @input=${(event:InputEvent)=>{if(this.#intakeEditable()){this.#audience=(event.target as HTMLInputElement).value;if(!this.#intakeComposing)this.requestUpdate();}}}></label>
                <label>${this.i18n.system("What should remain with them?")} <span>${this.i18n.system("optional")}</span><textarea rows="4" maxlength="12000" placeholder=${this.i18n.system("The idea or narrative the audience should retain")} .value=${this.#intakeComposing?noChange:this.#message} @input=${(event:InputEvent)=>{if(this.#intakeEditable()){this.#message=(event.target as HTMLTextAreaElement).value;if(!this.#intakeComposing)this.requestUpdate();}}}></textarea></label>
                <forma-ui-field .disabled=${Boolean(this.#intake)||this.#submitting} .label=${`${this.i18n.system("Message")} · ${this.i18n.system("Exact value")}`} .placeholder=${this.i18n.system("Single proposition")} max-length="500" .value=${this.#intakeComposing?noChange:this.#protectedPhrase} @forma-input=${(event:CustomEvent<{value:string}>)=>{if(this.#intakeEditable()){this.#protectedPhrase=event.detail.value;if(!this.#intakeComposing)this.requestUpdate();}}}></forma-ui-field>
                <label>${this.i18n.system("What needs to be delivered?")} <span>${this.i18n.system("optional")}</span><input maxlength="240" placeholder=${this.i18n.system("A campaign, presentation, written brief, or other finished output")} .value=${this.#intakeComposing?noChange:this.#deliverable} @input=${(event:InputEvent)=>{if(this.#intakeEditable()){this.#deliverable=(event.target as HTMLInputElement).value;if(!this.#intakeComposing)this.requestUpdate();}}}></label>
                <label>${this.i18n.system("What must never appear?")} <span>${this.i18n.system("optional")}</span><input maxlength="400" placeholder=${this.i18n.system("Safety, brand, legal, or accuracy boundaries")} .value=${this.#intakeComposing?noChange:this.#boundary} @input=${(event:InputEvent)=>{if(this.#intakeEditable()){this.#boundary=(event.target as HTMLInputElement).value;if(!this.#intakeComposing)this.requestUpdate();}}}></label>
              `:nothing}
            </fieldset>
          </details>
        `}
        ${this.#intakeIssue?html`<p role="status">${this.#intake?.confirmed?this.i18n.t("projects.originalConfirmedUnavailable","Creation confirmed. The original document cannot currently be opened. Check its availability; no new project will be created."):this.i18n.t("projects.originalUnconfirmed","The original creation is unresolved. Check it or retry the same creation; no replacement will be created.")}</p>`:nothing}
        <footer><button type="button" class="button ghost" @click=${this.#close}>${this.#intake?this.i18n.t("action.close","Close"):this.i18n.t("action.cancel","Cancel")}</button>
          ${this.#discardIntakeControl()}
          ${this.#intakePosture==="intent"&&!this.#intake?html`<button type="button" class="button secondary" ?disabled=${!this.#intakeEditable()||this.#intakeComposing} @click=${()=>this.#reviewIntake(true)}>${this.#intakeCopy("blank")}</button><button type="submit" class="button primary" ?disabled=${!this.#canReviewIntake()}>${this.#intakeCopy("continue")}</button>`:html`
            ${!this.#intake?html`<button type="button" class="button ghost" ?disabled=${!this.#intakeEditable()||this.#intakeComposing} @click=${this.#backIntake}>${this.#intakeCopy("back")}</button>`:nothing}
            ${this.#intake?html`<button data-intake-original type="button" class="button secondary" ?disabled=${this.#submitting} @click=${this.#checkIntake}>${this.#intake.confirmed?this.i18n.t("projects.checkOriginalAvailability","Check original availability"):this.i18n.t("projects.checkOriginal","Check original")}</button>`:nothing}
            ${this.#intake?.confirmed?nothing:html`<button type="submit" class="button primary" ?disabled=${this.#submitting||this.#intakeComposing||this.#reviewOutcomeMissing()||!this.#intake&&(!this.#name.trim()||Boolean(this.#briefValues().source.trim()&&!this.#briefValues().sourceRights))}>${this.#intake?this.i18n.t("projects.retryOriginal","Retry same creation"):this.#intakeChoice==="blank"?this.#intakeCopy("createBlank"):this.i18n.t("projects.createAction","Create project")}</button>`}
          `}
        </footer>
      </form>
    </dialog>`:""}
  </section>`;}
}
if (!customElements.get("forma-projects")) customElements.define("forma-projects",FormaProjects);
