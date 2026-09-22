import { ideasInDocument } from '../model/project-ideas.ts';
import { html, nothing } from "lit";
import "./forma-output-requirements";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { normalizeDocumentDuplicationTitle, documentDuplicationFolder } from "../model/document-duplication";
import { documentCopyDestination, documentCopyIssueMessage, type DocumentCopyTarget, type DocumentCopyReview } from "../model/document-copy-review";
import { renderAuthoringPreview } from "./authoring-preview";
import { navigateInApp } from "./command-departure";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import "./document-copy.css";
import { libraryBlockEditorRoute, withDocumentInRoute } from "../model/routes";
import { formaActivityAttention, scopedFormaActivity } from "../model/activity";
import { canvasRoute } from "../canvas/routes";
import { foldEvents } from "../model/events";
import "./project-rail";
import "./output-visual";
import "./artifact-summary";

type OrdinaryDocumentOpening={projectId:string;revision:number;pending:boolean;
  original:{documentId:string;title:string;revision:number;outcome:"unconfirmed"|"created";
    check?:"checking"|"found"|"absent"|"unavailable"}|null;
  current:()=>boolean;dispose:()=>void};

export class FormaProjectContents extends FormaElement {
  #query="";#newDocument=false;#title="";#pendingDeleteId="";#duplicateSourceId="";
  #duplicateProjectId="";#duplicateAuthorization="";#copyFolder="source";#copyFocus="";#copyReturnFocus:HTMLElement|null=null;#newDocumentRequest=0;
  #ordinaryDocument:OrdinaryDocumentOpening|null=null;
  override disconnectedCallback(){this.#retireOrdinaryDocument();super.disconnectedCallback();}
  protected override willUpdate(){if(this.#ordinaryDocument&&!this.#ordinaryDocument.current())this.#retireOrdinaryDocument();}
  #retireOrdinaryDocument(){
    const owner=this.#ordinaryDocument;if(!owner)return;
    this.#ordinaryDocument=null;owner.dispose();
    // Ordinary recovery never closes or clears the independently owned copy UI.
    if(!this.#duplicateSourceId){this.#title="";this.#newDocument=false;this.#newDocumentRequest++;
      this.querySelector<HTMLDialogElement>(".new-document-dialog")?.close();}
    this.requestUpdate();
  }
  #ordinaryDocumentOwner(){
    if(this.#ordinaryDocument&&!this.#ordinaryDocument.current())this.#retireOrdinaryDocument();
    if(this.#ordinaryDocument)return this.#ordinaryDocument;
    const store=this.store,source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const projectId=store.projection.get().projectId,route=store.route.get().split("#")[0];
    let retired=false,unsubscribe=()=>{};
    const owner:OrdinaryDocumentOpening={projectId,revision:0,pending:false,original:null,
      current:()=>!retired&&this.#ordinaryDocument===owner&&this.isConnected&&this.store===store
        &&Boolean(projectId)&&store.projection.get().projectId===projectId&&store.route.get().split("#")[0]===route
        &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization),
      dispose:()=>{retired=true;unsubscribe();}};
    this.#ordinaryDocument=owner;
    unsubscribe=store.subscribe(()=>{if(this.#ordinaryDocument===owner&&!owner.current())this.#retireOrdinaryDocument();});
    if(!owner.current()){this.#retireOrdinaryDocument();return null;}
    return owner;
  }
  protected override updated(){
    if(this.#duplicateSourceId&&(this.#duplicateAuthorization!==this.store.captureAuthorizationScope()?.key||
      this.#duplicateProjectId!==this.store.projection.get().projectId)){this.#closeNew(false);return;}
    this.querySelectorAll<HTMLDialogElement>(".project-document-dialog").forEach((dialog)=>ensureModalDialog(dialog));
    const state=this.#copyReview(),focus=state?[state.previewId,state.phase].join(":"):"";
    if(state?.phase==="retired"){this.#title="";this.#copyFolder="source";}
    if(this.#newDocument&&state&&!state.busy&&["review","applied"].includes(state.phase)&&focus!==this.#copyFocus){
      this.#copyFocus=focus;
      this.querySelector<HTMLElement>(state.preview?".context-change-preview h3":".document-copy-receipt")?.focus();
    }
  }
  #copyTarget():DocumentCopyTarget|null{return this.#duplicateSourceId&&this.#duplicateProjectId?{projectId:this.#duplicateProjectId,documentId:this.#duplicateSourceId}:null;}
  #copyReview(){const target=this.#copyTarget();return target?this.store.documentCopyReview(target):null;}
  #closeNew(restoreFocus=true){
    if(!this.#duplicateSourceId&&this.#ordinaryDocument){
      const owner=this.#ordinaryDocument;owner.revision++;
      // Closing presentation discards its name, not the outcome of a sent write.
      if(!owner.original){this.#ordinaryDocument=null;owner.dispose();}
    }
    const target=this.#copyTarget(),origin=this.#copyReturnFocus,request=++this.#newDocumentRequest;
    const authorization=this.store.captureAuthorizationScope(),projectId=this.store.projection.get().projectId;
    const authorizedOpening=!target||this.#duplicateAuthorization===authorization?.key;
    if(target)this.store.closeDocumentCopyDraft(target);
    this.#newDocument=false;this.#duplicateSourceId="";this.#duplicateProjectId="";this.#duplicateAuthorization="";
    this.#copyFocus="";this.#copyReturnFocus=null;this.#title="";this.#copyFolder="source";
    this.querySelector<HTMLDialogElement>(".new-document-dialog")?.close();this.requestUpdate();
    if(restoreFocus&&origin&&authorizedOpening){
      // Capture after native Close has completed its own synchronous invoker
      // restoration. Only this subsequent deferred focus remains ours to give.
      const focus=captureOutputNavigationFocus(this.ownerDocument);
      void this.updateComplete.then(()=>{
        if(request===this.#newDocumentRequest&&!this.#newDocument&&this.isConnected&&origin.isConnected&&
          this.store.authorizationScopeActive(authorization)&&this.store.projection.get().projectId===projectId&&
          (!target||this.store.documentCopyAccess(target).canRead))
          focus.run(origin,()=>{origin.focus({preventScroll:true});return true;});
      },()=>undefined).finally(()=>focus.dispose());
    }
  }
  #nativeNewDocumentClose(event:Event,request:number){
    const dialog=event.currentTarget as HTMLDialogElement|null;
    if(request===this.#newDocumentRequest&&this.#newDocument&&this.isConnected&&dialog&&!dialog.open&&
      dialog===this.querySelector(".new-document-dialog"))this.#closeNew();
  }
  #newDocumentCloseHandler(){
    const request=this.#newDocumentRequest;
    return(event:Event)=>this.#nativeNewDocumentClose(event,request);
  }
  #beginNew(){
    const owner=this.#ordinaryDocumentOwner();if(!owner)return;
    const request=++this.#newDocumentRequest,route=this.store.route.get();
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    this.#duplicateSourceId="";this.#duplicateProjectId="";this.#duplicateAuthorization="";this.#copyFocus="";
    this.#newDocument=true;this.#title="";this.requestUpdate();
    void this.updateComplete.then(()=>{
      if(request===this.#newDocumentRequest&&this.#newDocument&&!this.#duplicateSourceId&&this.isConnected&&
        owner.current()&&this.store.route.get()===route&&focus.current()){
        const target=this.querySelector<HTMLInputElement>(".new-document-dialog input");
        if(target)focus.run(target,()=>{target.focus();return true;});
      }
    }).finally(()=>focus.dispose());
  }
  async #beginDuplicate(documentId:string){
    const projection=this.store.projection.get(),authorization=this.store.captureAuthorizationScope();
    const source=projection.documents.find((document)=>document.id===documentId&&document.projectId===projection.projectId&&!document.removed);
    if(!source||!authorization)return;
    const access=this.store.documentCopyAccess({projectId:source.projectId,documentId});if(!access.canRead)return;
    const request=++this.#newDocumentRequest;
    this.#copyReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    this.#duplicateSourceId=documentId;this.#duplicateProjectId=source.projectId;this.#duplicateAuthorization=authorization.key;
    const retained=this.store.documentCopyReview({projectId:source.projectId,documentId});
    const draft=retained?.phase==="editing"?(retained.revisionDraft??retained.revisedIntent??retained.intent):null;
    this.#newDocument=true;this.#copyFolder=draft?(Object.hasOwn(draft,"collectionId")?(draft.collectionId===null?"root":"folder:"+draft.collectionId):"source"):"source";this.#copyFocus="";
    this.#title=draft?.title??(access.canAuthor&&!access.issue?Array.from(this.i18n.t("document.copy.defaultName","{title} · copy",{title:source.title})).slice(0,80).join(""):"");
    this.requestUpdate();
    const recovery=this.store.beginDocumentCopy({projectId:source.projectId,documentId});
    await this.updateComplete;
    if(request===this.#newDocumentRequest&&this.#newDocument&&this.#duplicateSourceId===documentId&&this.#duplicateProjectId===source.projectId&&
      this.store.authorizationScopeActive(authorization)&&this.isConnected&&this.store.documentCopyAccess({projectId:source.projectId,documentId}).canRead)
      this.querySelector<HTMLElement>(".new-document-dialog h2")?.focus();
    await recovery;
  }
  async #checkCopy(){
    const target=this.#copyTarget();if(!target)return;const state=this.#copyReview();
    if(!state){await this.store.beginDocumentCopy(target);return;}
    if(state.operationId&&!state.preview&&!state.intent&&!state.receipt)
      await this.store.checkDocumentCopy(target,{includeRetirement:true});
    else await this.store.checkDocumentCopy(target);
  }
  #retainCopyDraft(opening:number,operationId:string,title:string,folder:string){
    const target=this.#copyTarget();
    if(opening!==this.#newDocumentRequest||!this.#newDocument||!this.isConnected||!target)return false;
    return Boolean(this.store.updateDocumentCopyRevisionDraft(target,operationId,{title,
      ...(folder==="source"?{}:{collectionId:folder==="root"?null:folder.startsWith("folder:")?folder.slice(7):""})}));
  }
  #reviseCopy(opening:number,operationId:string){
    const target=this.#copyTarget();
    if(opening!==this.#newDocumentRequest||!this.#newDocument||!this.isConnected||!target)return;
    const state=this.store.beginDocumentCopyRevision(target,operationId);
    const intent=state?.revisionDraft??state?.revisedIntent??state?.intent;if(!state||!intent)return;
    this.#title=intent.title;
    this.#copyFolder=Object.hasOwn(intent,"collectionId")?(intent.collectionId===null?"root":"folder:"+intent.collectionId):"source";
    this.requestUpdate();
    this.querySelector<HTMLInputElement>(".new-document-dialog input")?.focus();
  }
  async #applyCopy(){
    const target=this.#copyTarget(),state=this.#copyReview();if(!target||!state)return;
    await this.store.applyDocumentCopy(target,state.previewId,state.approvalHash);
  }
  async #dismissCopy(owner?:{opening:number;route:string;review:DocumentCopyReview}){
    const request=this.#newDocumentRequest,target=this.#copyTarget(),state=this.#copyReview();if(!target||!state)return;
    if(owner&&(owner.opening!==request||owner.route!==this.store.route.get()||!this.#newDocument||!this.isConnected||
      !(state.phase==="retired"&&state.retirement||state.guardedDismissAvailable&&owner.review.guardedDismissAvailable)||owner.review.request!==state.request||
      owner.review.operationId!==state.operationId||owner.review.previewId!==state.previewId||
      owner.review.approvalHash!==state.approvalHash||owner.review.retirement!==state.retirement))return;
    const authorization=owner?this.store.captureAuthorizationScope():null,source=owner?this.store.captureSourceOwnership():null;
    const result=owner&&state.retirement?await this.store.dismissDocumentCopy(target,state.previewId,state.approvalHash,
      {operationId:state.operationId??"",request:state.request,retirement:state.retirement}):
      await this.store.dismissDocumentCopy(target,state.previewId,state.approvalHash);
    if(owner&&(!this.store.authorizationScopeActive(authorization)||!this.store.sourceOwnershipActive(source)||owner.route!==this.store.route.get()))return;
    if(request===this.#newDocumentRequest&&result?.phase==="dismissed"&&this.#duplicateSourceId===target.documentId&&this.#duplicateProjectId===target.projectId)this.#closeNew();
  }
  async #openCopy(event:MouseEvent){
    const request=this.#newDocumentRequest,state=this.#copyReview(),target=this.#copyTarget();
    const copied=state?.phase==="applied"&&state.receipt?this.store.projection.get().documents.find((document)=>
      document.id===state.receipt!.documentId&&document.projectId===target?.projectId&&!document.removed):null;
    if(!copied){event.preventDefault();return;}
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    const store=this.store,element=this.querySelector<HTMLDialogElement>(".document-copy-dialog"),trigger=event.currentTarget;
    if(!target||!state?.receipt||!element||!(trigger instanceof HTMLElement))return;
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope(),route=store.route.get(),receipt=state.receipt;
    const current=()=>{
      const review=this.#copyReview();
      return this.isConnected&&this.store===store&&request===this.#newDocumentRequest&&this.#newDocument
        &&this.#duplicateSourceId===target.documentId&&this.#duplicateProjectId===target.projectId
        &&store.route.get()===route&&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)
        &&this.querySelector(".document-copy-dialog")===element&&element.open&&trigger.isConnected
        &&review?.phase==="applied"&&!review.busy&&review.request===state.request
        &&review.previewId===state.previewId&&review.approvalHash===state.approvalHash
        &&review.receipt?.documentId===receipt.documentId&&review.receipt?.operationId===receipt.operationId
        &&store.projection.get().documents.some(document=>document.id===copied.id&&document.projectId===target.projectId&&!document.removed);
    };
    const opened=await navigateInApp(this,navigation=>store.openDocument(copied.id,"/","project-document-duplicate",{
      ...navigation,current:()=>current()&&navigation.current(),
    }),{presentation:{owner:this,element,trigger,current}});
    if(request===this.#newDocumentRequest&&opened&&this.#duplicateSourceId===target?.documentId&&this.#duplicateProjectId===target.projectId)this.#closeNew(false);
  }
  #copyNameValid(){try{return Boolean(normalizeDocumentDuplicationTitle(this.#title));}catch{return false;}}
  #copyFolders(){
    const projection=this.store.projection.get();
    return projection.collections.filter((collection)=>collection.projectId===this.#duplicateProjectId&&!collection.removed).flatMap((collection)=>{
      try{return[{id:collection.id,name:documentDuplicationFolder(projection,collection.id).map((item)=>item.handle).join(" / ")}];}
      catch{return[];}
    });
  }
  async #createDocument(event:SubmitEvent){
    event.preventDefault();const title=this.#title.trim();if(!title)return;const p=this.store.projection.get();
    if(this.#duplicateSourceId){
      const target=this.#copyTarget(),state=this.#copyReview();if(!target||!state||!["draft","editing"].includes(state.phase)||!this.store.documentCopyAccess(target).canAuthor)return;
      const folder=this.#copyFolder;
      await this.store.previewDocumentCopy(target,{title,...(folder==="source"?{}:{collectionId:folder==="root"?null:folder.startsWith("folder:")?folder.slice(7):""})});
      return;
    }
    const owner=this.#ordinaryDocument;
    if(!owner?.current()||!this.#newDocument||owner.pending||owner.original?.outcome==="unconfirmed"
      ||event.currentTarget!==this.querySelector(".new-document-dialog form"))return;
    const raw=this.#title,revision=owner.revision,opening=this.#newDocumentRequest,route=this.store.route.get();
    const documentId=crypto.randomUUID();const slug=title.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,48)||`document-${documentId.slice(0,8)}`;
    const events=[{type:"DocumentCreated",payload:{project_id:p.projectId,document_id:documentId,handle:slug,title}},
      {type:"EmptyCanvasChosen",payload:{project_id:p.projectId,document_id:documentId,source_surface:"project-contents"}}];
    const original:NonNullable<OrdinaryDocumentOpening["original"]>={documentId,title,revision,outcome:"unconfirmed"};
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    const previousOriginal=owner.original;
    owner.original=original;owner.pending=true;this.requestUpdate();
    const presentationCurrent=()=>owner.current()&&owner.original===original&&opening===this.#newDocumentRequest
      &&this.#newDocument&&!this.#duplicateSourceId&&owner.revision===revision&&this.#title===raw;
    const navigationCurrent=()=>presentationCurrent()&&this.store.route.get()===route&&focus.current();
    try{
      const result=await this.store.appendBatchWithReceipt(events);
      if(!owner.current()||owner.original!==original)return;
      const acknowledgment=result.acknowledgment;
      // Only this explicit public result certifies that this invocation was not sent.
      if(result.publication==="none"&&acknowledgment.outcome==="not-attempted"
        &&acknowledgment.privateUnavailable===false&&acknowledgment.action==="batch"&&!result.appended.length
        &&!acknowledgment.requestedClientEventIds.length&&!acknowledgment.committed.length
        &&!acknowledgment.rejectedIndices.length&&acknowledgment.observedHead===null){
        owner.original=previousOriginal;return;
      }
      const complete=result.publication==="published"&&result.acknowledgment.outcome==="observed"
        &&!result.acknowledgment.privateUnavailable&&!result.acknowledgment.rejectedIndices.length&&result.appended.length===2
        &&result.appended.some(value=>value.type==="DocumentCreated"&&value.payload.project_id===p.projectId
          &&value.payload.document_id===documentId&&value.payload.handle===slug&&value.payload.title===title)
        &&result.appended.some(value=>value.type==="EmptyCanvasChosen"&&value.payload.project_id===p.projectId
          &&value.payload.document_id===documentId&&value.payload.source_surface==="project-contents");
      if(!complete)return;
      original.outcome="created";
      // The ACK remains truthful even if this opening was closed or B replaced A.
      if(!navigationCurrent())return;
      const created=this.#originalOrdinaryDocument();
      if(!created)return;
      // Keep the original ACK even when another current owner refuses arrival.
      // Its original opening/focus predicate remains required at the commit;
      // shared admission does not turn a later gesture into the old completion.
      await navigateInApp(this,navigation=>{
        const current=()=>navigationCurrent()&&navigation.current()&&this.#originalOrdinaryDocument()?.id===created.id;
        if(!current())return false;
        this.store.toast(this.i18n.system("{title} created as a blank document.",{title}));
        return this.store.transitionWorkspace(withDocumentInRoute("/",created.id,created.title),{
          current,focus:navigation.focus,onOriginHandoff:navigation.onOriginHandoff});
      });
    }catch{/* No new UUID or resend is authorized by an unconfirmed result. */}
    finally{focus.dispose();if(this.#ordinaryDocument===owner){owner.pending=false;this.requestUpdate();}}
  }

  #originalOrdinaryDocument(){
    const owner=this.#ordinaryDocument,original=owner?.original;if(!owner?.current()||!original)return null;
    // Exact committed Document availability is not acknowledgment of the two-event batch.
    return foldEvents(this.store.events.get(),Number.POSITIVE_INFINITY,original.documentId,owner.projectId)
      .documents.find(value=>value.id===original.documentId&&value.projectId===owner.projectId&&!value.removed)??null;
  }
  #ordinaryOpenBlocked(){const owner=this.#ordinaryDocument;return Boolean(owner?.original&&this.#title!==""&&owner.revision!==owner.original.revision);}
  async #checkOrdinaryDocument(event:Event){
    const owner=this.#ordinaryDocument,original=owner?.original;
    if(event.currentTarget!==this.querySelector(".project-blank-original-check")||!owner?.current()||!original
      ||owner.pending||original.outcome!=="unconfirmed"||original.check==="checking")return;
    const current=()=>owner.current()&&owner.original===original;
    original.check="checking";this.requestUpdate();
    try{await this.store.refreshEvents({fromStart:true});if(current())original.check=this.#originalOrdinaryDocument()?"found":"absent";}
    catch{if(current())original.check="unavailable";}
    finally{if(this.#ordinaryDocument===owner&&owner.original===original){if(original.check==="checking")original.check=undefined;this.requestUpdate();}}
  }
  #openOrdinaryDocument(event:Event){
    const owner=this.#ordinaryDocument,original=owner?.original,document=this.#originalOrdinaryDocument();
    if(event.currentTarget!==this.querySelector(".project-blank-original-open")||!owner?.current()||!original||!document||owner.pending
      ||original.outcome!=="created"&&original.check!=="found"||this.#ordinaryOpenBlocked())return;
    const opening=this.#newDocumentRequest,route=this.store.route.get();
    const current=()=>owner.current()&&owner.original===original&&!owner.pending&&opening===this.#newDocumentRequest
      &&this.#newDocument&&!this.#duplicateSourceId&&this.store.route.get()===route
      &&this.#originalOrdinaryDocument()?.id===document.id&&!this.#ordinaryOpenBlocked();
    return navigateInApp(this,navigation=>this.store.transitionWorkspace(withDocumentInRoute("/",document.id,document.title),{
      current:()=>current()&&navigation.current(),focus:navigation.focus,onOriginHandoff:navigation.onOriginHandoff}));
  }
  #ordinaryDocumentNotice(){
    const owner=this.#ordinaryDocument,original=owner?.original;if(!owner?.current()||!original)return"";
    if(owner.pending)return this.i18n.t("sessions.blank.creating");
    if(original.outcome==="created")return this.i18n.t("sessions.blank.originalCreated");
    const key=original.check==="checking"?"sessions.blank.checkingOriginal":original.check==="unavailable"?"sessions.blank.checkUnavailable"
      :original.check==="found"&&this.#originalOrdinaryDocument()?"sessions.blank.originalAvailable"
      :original.check==="found"||original.check==="absent"?"sessions.blank.originalAbsent":"sessions.blank.unconfirmed";
    return this.i18n.t(key);
  }
  #ordinaryDocumentDialog(){
    const owner=this.#ordinaryDocument;if(!owner?.current())return nothing;
    const opening=this.#newDocumentRequest,original=owner.original,document=this.#originalOrdinaryDocument();
    const available=Boolean(original&&document&&(original.outcome==="created"||original.check==="found"));
    const blocked=this.#ordinaryOpenBlocked(),title=`\u2068${document?.title??original?.title??""}\u2069`;
    const openPrimary=available&&!owner.pending&&!blocked;
    return html`<dialog class="modal project-document-dialog new-document-dialog" closedby="any" aria-labelledby="new-document-title"
      @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeNew();}}
      @cancel=${(event:Event)=>{event.preventDefault();this.#closeNew();}} @close=${this.#newDocumentCloseHandler()}>
      <form class="modal-card" aria-busy=${String(owner.pending||original?.check==="checking")} @submit=${this.#createDocument}>
        <button type="button" class="icon-button modal-close" aria-label=${this.i18n.t("action.close")} @click=${()=>this.#closeNew()}>${icon("close")}</button>
        <span class="eyebrow">Blank by default</span><h2 id="new-document-title">Create a document</h2>
        <p>Name it now. No direction or other context block will be inferred.</p>
        <label>Document name<input required maxlength="80" ?autofocus=${!original} placeholder="e.g. Packaging exploration" .value=${this.#title}
          @input=${(event:InputEvent)=>{if(owner.current()&&opening===this.#newDocumentRequest&&this.#newDocument&&!this.#duplicateSourceId
            &&event.currentTarget===this.querySelector(".new-document-dialog input")){this.#title=(event.currentTarget as HTMLInputElement).value;owner.revision++;this.requestUpdate();}}}></label>
        ${original?html`<p class="project-blank-original-notice" role="status">${this.#ordinaryDocumentNotice()}</p>
          <p class="project-blank-original-lifetime">${this.i18n.t("projects.blank.recoveryLifetime")}</p>`:nothing}
        ${available&&blocked?html`<p>${this.i18n.t("projects.blank.openBlocked")}</p>`:nothing}
        <footer><button type="button" class="button ghost" @click=${()=>this.#closeNew()}>${this.i18n.t("action.close")}</button>
          ${original&&this.#title!==""?html`<button type="button" class="button ghost" @click=${()=>{if(owner.current()&&opening===this.#newDocumentRequest){this.#title="";owner.revision++;this.requestUpdate();}}}>${this.i18n.t("sessions.blank.discard")}</button>`:nothing}
          ${available?html`<button type="button" class=${`button ${openPrimary?"primary":"secondary"} project-blank-original-open`} ?disabled=${owner.pending||blocked}
            @click=${this.#openOrdinaryDocument}>${this.i18n.t("sessions.blank.openOriginal",undefined,{title})}</button>`:nothing}
          ${original?.outcome==="unconfirmed"?html`<button type="button" class=${`button ${openPrimary?"secondary":"primary"} project-blank-original-check`}
            ?disabled=${owner.pending||original.check==="checking"} @click=${this.#checkOrdinaryDocument}>${this.i18n.t("sessions.blank.checkOriginal",undefined,{title})}</button>`:
            html`<button type="submit" class=${`button ${openPrimary?"secondary":"primary"}`} ?disabled=${!this.#title.trim()||owner.pending}>${original?this.i18n.t("sessions.blank.createAnother"):this.i18n.system("Create & open")}</button>`}
        </footer>
      </form>
    </dialog>`;
  }
  #ordinaryDocumentRecovery(){
    const owner=this.#ordinaryDocument,original=owner?.original;
    if(this.#newDocument||!owner?.current()||!original)return nothing;
    return html`<section class="project-blank-original-recovery"><p role="status">${this.#ordinaryDocumentNotice()}</p>
      <p class="project-blank-original-lifetime">${this.i18n.t("projects.blank.recoveryLifetime")}</p>
      <button type="button" class="button secondary project-blank-original-review" @click=${this.#beginNew}>
        ${this.i18n.t("projects.blank.reviewOriginal",undefined,{title:`\u2068${original.title}\u2069`})}</button></section>`;
  }
  #copyDialog(){
    const state=this.#copyReview(),target=this.#copyTarget(),projection=this.store.projection.get();
    const access=target?this.store.documentCopyAccess(target):{canRead:false,canAuthor:false,issue:""};
    const draft=access.canAuthor&&Boolean(state&&["draft","editing"].includes(state.phase))&&!state?.busy;
    const displayed=state&&!state.preview&&state.revisedRequestSubmitted?state.revisedIntent??state.intent:state?.intent;
    const title=draft?this.#title:displayed?.title??this.#title;
    const folder=draft?this.#copyFolder:displayed?(Object.hasOwn(displayed,"collectionId")?(displayed.collectionId===null?"root":"folder:"+displayed.collectionId):"source"):this.#copyFolder;
    const canRevise=Boolean(access.canAuthor&&state&&!state.busy&&state.phase==="unavailable"&&
      state.issue==="document_duplicate_folder_unavailable"&&state.intent&&!state.previewId&&!state.receipt&&!state.commitSubmitted);
    const canDismiss=Boolean(state?.previewId&&state.approvalHash&&!state.busy&&
      (["review","applied"].includes(state.phase)||state.phase==="unavailable"&&!state.commitSubmitted||
        state.guardedDismissAvailable&&["uncertain","unavailable"].includes(state.phase)&&!state.intent&&!state.preview&&!state.receipt&&
        state.operationId&&this.store.sourceOwnershipActive(state.sourceOwner)));
    const opening=this.#newDocumentRequest,route=this.store.route.get();
    const copied=state?.phase==="applied"&&state.receipt?projection.documents.find((document)=>
      document.id===state.receipt!.documentId&&document.projectId===target?.projectId&&!document.removed):null;
    const pending=state&&["recovering","previewing","applying"].includes(state.phase);
    const needsCheck=!state||!state.busy&&(["uncertain","applying","unavailable"].includes(state.phase)||state.stale||Boolean(state.issue)||state.phase==="applied"&&!copied);
    const privateUnavailable=Boolean(state&&!state.preview&&state.issue==="document_copy_unavailable");
    const alertMessage=privateUnavailable&&state?.phase==="uncertain"?"document.copy.uncertain":
      privateUnavailable&&state?.phase==="unavailable"&&(!state.previewId||!state.approvalHash)?"document.copy.unavailable":
      state?documentCopyIssueMessage(state):"";
    return html`<dialog class="modal project-document-dialog new-document-dialog document-copy-dialog" closedby="any"
      aria-labelledby="new-document-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeNew();}}
      @cancel=${(event:Event)=>{event.preventDefault();this.#closeNew();}} @close=${this.#newDocumentCloseHandler()}>
      <form class="modal-card" @submit=${this.#createDocument}>
        <button type="button" class="icon-button modal-close" aria-label=${this.i18n.t("action.close")} @click=${()=>this.#closeNew()}>${icon("close")}</button>
        <h2 id="new-document-title" tabindex="-1">${access.canAuthor?this.i18n.t("document.copy.title","Copy document"):this.i18n.t("document.copy.reviewTitle","Saved copy review")}</h2>
        ${state?.sourceTitle?html`<p>${this.i18n.t("document.copy.source","Original")}: <span dir="auto">${state.sourceTitle}</span></p>`:nothing}
        ${!access.issue&&!["applied","retired"].includes(state?.phase??"")&&(access.canAuthor||state?.preview)?html`<p>${this.i18n.t("document.copy.preserved","The original stays unchanged. The copy preserves decisions, locks, typed relationships, rights information, and source evidence.")}</p>
          <p>${this.i18n.t("document.copy.excluded","Outputs, approvals, generation jobs, and review assignments stay with the original.")}</p>
          ${access.canAuthor?html`<label>${this.i18n.t("document.copy.name","Copy name")}<input required maxlength="160" dir="auto" .value=${title}
            ?readonly=${!draft} @input=${(event:InputEvent)=>{if(draft&&opening===this.#newDocumentRequest){const value=(event.currentTarget as HTMLInputElement).value;if(state?.phase==="editing"&&!this.#retainCopyDraft(opening,state.operationId??"",value,this.#copyFolder))return;this.#title=value;this.requestUpdate();}}}></label>
          <label>${this.i18n.t("document.copy.folder","Destination folder")}<select .value=${folder} ?disabled=${!draft}
            @change=${(event:Event)=>{if(draft&&opening===this.#newDocumentRequest){const value=(event.currentTarget as HTMLSelectElement).value;if(state?.phase==="editing"&&!this.#retainCopyDraft(opening,state.operationId??"",this.#title,value))return;this.#copyFolder=value;this.requestUpdate();}}}>
            <option value="source">${this.i18n.t("document.copy.sourceFolder","Same folder as original")}</option>
            <option value="root">${this.i18n.t("document.copy.rootFolder","Project root")}</option>
            ${this.#copyFolders().map((collection)=>html`<option value=${"folder:"+collection.id}>${collection.name}</option>`)}
          </select></label>`:state?.intent?html`<p>${this.i18n.t("document.copy.name","Copy name")}: <span dir="auto">${state.intent.title}</span></p>`:nothing}`:nothing}
        ${access.canRead&&!access.canAuthor&&state?.phase==="draft"?html`<p role="status">${this.i18n.t("document.copy.none","No saved copy review is available for this document.")}</p>`:nothing}
        ${access.canRead&&!access.canAuthor&&state?.previewId?html`<p>${this.i18n.t("document.copy.readOnly","Your access allows checking and dismissing saved copy reviews. Creating a copy requires author access.")}</p>`:nothing}
        ${state?.phase==="retired"&&state.retirement?html`<p class="document-copy-retired" role="status">${this.i18n.t(access.canAuthor?"document.copy.retired":"document.copy.retiredReadOnly",undefined,{done:this.i18n.t("context.changes.done"),apply:this.i18n.t("document.copy.apply")})}</p>`:nothing}
        ${state?.phase==="editing"?html`<p role="status">${this.i18n.t("document.copy.reviseHint")}</p>`:nothing}
        ${state?.reviewDisposition==="saved-original"?html`<p role="status">${this.i18n.t("document.copy.savedOriginal")}</p>`:state?.reviewDisposition==="recovered"?html`<p role="status">${this.i18n.t("document.copy.recoveredRevision")}</p>`:nothing}
        ${state?.reviewDisposition==="saved-original"&&state.revisedIntent?html`<p>${this.i18n.t("document.copy.revisedDraft")}: <span dir="auto">${state.revisedIntent.title}</span> · <span dir="auto">${Object.hasOwn(state.revisedIntent,"collectionId")?(state.revisedIntent.collectionId===null?this.i18n.t("document.copy.rootFolder"):this.#copyFolders().find(folder=>folder.id===state.revisedIntent!.collectionId)?.name??state.revisedIntent.collectionId):this.i18n.t("document.copy.sourceFolder")}</span></p>`:nothing}
        ${access.issue?html`<p role="alert">${this.i18n.t(documentCopyIssueMessage({issue:access.issue,stale:false}),"The {limit}-review limit has been reached. Close this dialog, then check a saved copy review or discard an unsubmitted preview before starting another.",{limit:this.i18n.number(32)})}</p>`:nothing}
        ${pending&&!state?.preview?html`<p role="status">${this.i18n.t(state?.phase==="previewing"?"document.copy.previewing":state?.phase==="applying"?"context.changes.applying":"document.copy.recovering")}</p>`:nothing}
        ${state?.preview?html`<p>${this.i18n.t("document.copy.folder","Destination folder")}: <span dir="auto">${state.preview.duplication!.collectionPath.join(" / ")||this.i18n.t("document.copy.rootFolder","Project root")}</span></p>
          ${renderAuthoringPreview(state.preview,this.i18n,{id:"document-copy-preview",status:state.phase==="applied"?"applied":state.phase==="applying"?"applying":"review",
            ...(state.phase==="uncertain"?{summary:this.i18n.t("document.copy.uncertain")}:!access.canAuthor&&state.phase==="review"?{summary:this.i18n.t("document.copy.reviewTitle")}:{}),
            readOnly:!access.canAuthor||["applying","uncertain"].includes(state.phase),destinationDocumentId:documentCopyDestination(state.preview)})}`:nothing}
        ${state?.phase==="applied"&&!state.preview?html`<p class="document-copy-receipt" tabindex="-1" role="status">${this.i18n.t("document.copy.applied","This copy is saved. Reopening this review does not create another copy.")}</p>`:nothing}
        ${state&&(state.issue||state.stale)&&!(access.canRead&&!access.canAuthor&&state.stale&&(!state.issue||state.issue==="document_copy_stale"))?html`<p role="alert">${this.i18n.t(alertMessage)}</p>`:nothing}
        <footer>
          <button type="button" class="button ghost" @click=${()=>this.#closeNew()}>${this.i18n.t("action.close")}</button>
          ${canDismiss&&state?html`<button type="button" class="button ghost"
            @click=${()=>void this.#dismissCopy(state.guardedDismissAvailable?{opening,route,review:state}:undefined)}>${this.i18n.t(state.phase==="applied"?"context.changes.done":"document.copy.discard")}</button>`:nothing}
          ${state?.phase==="retired"&&state.retirement&&!state.busy?html`<button type="button" class="button ghost"
            @click=${()=>void this.#dismissCopy({opening,route,review:state})}>${this.i18n.t("context.changes.done")}</button>`:nothing}
          ${canRevise?html`<button type="button" class="button secondary" @click=${()=>this.#reviseCopy(opening,state!.operationId??"")}>${this.i18n.t("document.copy.revise")}</button>`:nothing}
          ${access.canRead&&!access.issue&&needsCheck?html`<button type="button" class="button secondary" ?disabled=${Boolean(state?.busy)}
            @click=${()=>void this.#checkCopy()}>${this.i18n.t("document.copy.check","Check this copy · free")}</button>`:nothing}
          ${draft?html`<button type="submit" class="button primary" ?disabled=${!this.#copyNameValid()}>${this.i18n.t("document.copy.preview","Review copy · free")}</button>`:nothing}
          ${access.canAuthor&&state?.phase==="review"&&!state.stale?html`<button type="button" class="button primary" ?disabled=${state.busy}
            @click=${()=>void this.#applyCopy()}>${this.i18n.t("document.copy.apply","Apply copy")}</button>`:nothing}
          ${copied?html`<a class="button primary" href=${withDocumentInRoute("/",copied.id,copied.title)}
            @click=${(event:MouseEvent)=>void this.#openCopy(event)}>${this.i18n.t("document.copy.open","Open copied document")} ${icon("arrow")}</a>`:nothing}
        </footer>
      </form>
    </dialog>`;
  }

  #openRoute(path:string){
    const store=this.store;
    return navigateInApp(this,navigation=>store.transitionWorkspace(path,navigation));
  }
  #followLink(event:MouseEvent,path:string){
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();return this.#openRoute(path);
  }

  #requestDelete(id:string){if(this.store.projection.get().documents.length<=1){this.store.toast("Create another document before removing the project’s final document.");return;}this.#pendingDeleteId=id;this.requestUpdate();}
  #closeDelete(){this.querySelector<HTMLDialogElement>(".project-document-delete-dialog")?.close();this.#pendingDeleteId="";this.requestUpdate();}
  async #confirmDelete(){if(!this.#pendingDeleteId)return;const appended=await this.store.removeDocument(this.#pendingDeleteId);if(appended.length)this.#closeDelete();}
  override render(){const p=this.store.projection.get();const session=this.store.session.get();const context=session?.projectContext;const canAuthor=!context||context.permissions.includes("project.author");const canAccessCanvas=Boolean(session?.canvas.access&&(!context||context.permissions.includes("project.canvas.use")));const collection=p.collections.find((item)=>item.id===this.store.ui.focusCollectionId);const ids=collection?new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===collection.id).map(([id])=>id)):null;const query=this.#query.trim().toLowerCase();const documents=p.documents.filter((document)=>document.projectId===p.projectId&&!document.removed&&(!ids||ids.has(document.id))&&(!query||document.title.toLowerCase().includes(query)||document.handle.toLowerCase().includes(query)));const blocks=p.libraryBlocks.filter((block)=>block.scope==="library"&&(!ids||ids.has(block.id))&&(!query||block.handle.toLowerCase().includes(query)||String(block.properties.text??block.properties.label??"").toLowerCase().includes(query)));const boards=canAccessCanvas?this.store.canvasProjection.get().canvases.filter((board)=>board.projectId===p.projectId&&!board.removed&&(!ids||ids.has(board.id))&&(!query||board.name.toLowerCase().includes(query))):[];const visibleDocumentIds=new Set(p.documents.filter((document)=>document.projectId===p.projectId&&!document.removed).map((document)=>document.id));const readyResults=p.libraryOutputs.filter((output)=>visibleDocumentIds.has(output.documentId)).length+p.libraryArtifacts.filter((artifact)=>visibleDocumentIds.has(artifact.documentId)).length;const activity=scopedFormaActivity(session,p,this.store.projectNotifications.get(),this.store.reviewInbox.get(),this.store.documentJobs.get());const assignedReviews=activity.reviews.filter((review)=>review.projectId===p.projectId&&visibleDocumentIds.has(review.documentId));const needsAttention=formaActivityAttention({...activity,reviews:assignedReviews});const pending=p.documents.find((document)=>document.id===this.#pendingDeleteId);
    return html`<section class="workspace-page studio-subpage"><forma-project-rail surface="studio" destination="/studio/project"></forma-project-rail><div class="studio-main"><header class="page-header page-header--document"><div class="page-header-copy"><span class="eyebrow">${p.projectName} / Project overview</span><h1>Project contents</h1><p>See and manage the documents, canvases, and reusable blocks that inherit this project’s access and authored folders.</p></div><div class="page-header-actions">${canAccessCanvas?html`<a class="button secondary" href="/canvas" @click=${(event:MouseEvent)=>this.#followLink(event,"/canvas")}>${this.i18n.t("projects.openCanvas","Open in Canvas")}</a>`:nothing}${canAuthor?html`<a class="button secondary" href=${libraryBlockEditorRoute()} @click=${(event:MouseEvent)=>this.#followLink(event,libraryBlockEditorRoute())}>${icon("plus")} New reusable block</a><button class="button primary" @click=${this.#beginNew}>${icon("plus")} New document</button>`:nothing}</div></header>
      <div class="studio-subpage-body">${collection?html`<div class="collection-filter project-contents-filter" role="status"><div><b>Showing collection “${collection.handle}”</b><span>${documents.length} document${documents.length===1?"":"s"} · ${blocks.length} reusable block${blocks.length===1?"":"s"}</span></div><button class="button ghost compact" @click=${()=>this.store.patchUi({focusCollectionId:""})}>Clear collection filter</button></div>`:nothing}<form class="project-contents-toolbar" @submit=${(event:SubmitEvent)=>{event.preventDefault();this.requestUpdate();}}><label class="searchbox">${icon("search")}<input placeholder="Search documents, boards, and reusable blocks" .value=${this.#query} @input=${(event:InputEvent)=>{this.#query=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><span>${documents.length} document${documents.length===1?"":"s"} · ${blocks.length} reusable block${blocks.length===1?"":"s"}${collection?" " + this.i18n.system("in {handle}", { handle: collection.handle }):""}</span></form>
      ${this.#ordinaryDocumentRecovery()}
      <div class="document-library-grid">${documents.map((document)=>{const copyAccess=this.store.documentCopyAccess({projectId:document.projectId,documentId:document.id});const documentBlocks=ideasInDocument(p,document.id);const documentOutputs=p.libraryOutputs.filter((output)=>output.documentId===document.id);const documentArtifacts=p.libraryArtifacts.filter((artifact)=>artifact.documentId===document.id);const resultCount=documentOutputs.length+documentArtifacts.length;const newestArtifact=documentArtifacts[0];const showArtifact=Boolean(newestArtifact&&(!documentOutputs[0]||newestArtifact.sequence>documentOutputs[0].sequence));const membership=p.membership[document.id];const filed=p.collections.find((item)=>item.id===membership?.collectionId);return html`<article class="document-card ${document.id===p.documentId?"current":""}"><header><span>${document.id===p.documentId?this.i18n.system("Current document"):filed?this.i18n.system("Filed in {handle}", { handle: filed.handle }):this.i18n.system("Unfiled")}</span><small>${document.handle}</small></header><h3>${document.title}</h3><p>${documentBlocks.length} context block${documentBlocks.length===1?"":"s"} · ${resultCount} output${resultCount===1?"":"s"}</p><div class="document-card-preview">${showArtifact&&newestArtifact?html`<i><forma-artifact-summary .artifact=${newestArtifact} .compact=${true}></forma-artifact-summary></i>`:documentOutputs.slice(0,3).map((output,index)=>html`<i style=${`--stack:${index}`}><forma-output-visual .output=${output} .compact=${true} .interactive=${true}></forma-output-visual></i>`)}</div><forma-output-requirements .documentId=${document.id} .surface=${"project"}></forma-output-requirements><div class="document-card-actions"><button class="button ${document.id===p.documentId?"secondary":"primary"}" @click=${()=>navigateInApp(this,navigation=>this.store.openDocument(document.id,"/",undefined,navigation))}>Open ${icon("arrow")}</button>${copyAccess.canRead?html`<button type="button" class="button ghost document-duplicate-trigger" aria-label=${(copyAccess.canAuthor?this.i18n.system("Duplicate"):this.i18n.t("document.copy.check","Check this copy · free"))+" "+document.title} @click=${()=>this.#beginDuplicate(document.id)}>${icon("copy")} ${copyAccess.canAuthor?this.i18n.system("Duplicate"):this.i18n.t("document.copy.check","Check this copy · free")}</button>`:nothing}${canAuthor?html`<button class="button ghost document-delete-trigger" ?disabled=${p.documents.length<=1} @click=${()=>this.#requestDelete(document.id)}>${icon("trash")} Remove</button>`:nothing}</div></article>`;})}</div>${!documents.length?html`<div class="family-empty"><span>${icon("folder")}</span><h3>No documents match</h3><p>Clear the collection filter or search to see the whole project.</p></div>`:nothing}
      ${assignedReviews.length?html`<section class="project-review-contents"><div class="section-heading"><div><span class="eyebrow">${this.i18n.t("activity.review","Assigned review")}</span><h2>${this.i18n.t("activity.needsYou","Needs you")}</h2></div><span>${this.i18n.number(assignedReviews.length)}</span></div><ul>${assignedReviews.map((review)=>html`<li><span><b dir="auto">${review.artifactTitle}</b><small dir="auto">${review.documentTitle}</small></span><button type="button" class="button secondary compact" @click=${()=>void navigateInApp(this,navigation=>navigation.openAssignedReview(review))}>${this.i18n.t("activity.openReview","Open assigned review")}</button></li>`)}</ul></section>`:nothing}
      ${canAccessCanvas&&boards.length?html`<section class="project-board-contents"><div class="section-heading"><div><span class="eyebrow">${this.i18n.t("projects.workspaceKind","Creative workspace")}</span><h2>${this.i18n.t("canvas.projectBoardsHeading","{name} boards",{name:p.projectName})}</h2></div><span>${this.i18n.number(boards.length)}</span></div><div class="project-board-grid">${boards.map((board)=>html`<article><a href=${canvasRoute(board)} @click=${(event:MouseEvent)=>this.#followLink(event,canvasRoute(board))}><span aria-hidden="true">${icon("grid")}</span><div><h3 dir="auto">${board.name}</h3><small dir="auto">${p.projectName}</small></div>${icon("arrow")}</a></article>`)}</div></section>`:nothing}
      ${blocks.length?html`<section class="project-block-contents"><div class="section-heading"><div><span class="eyebrow">Independent project context</span><h2>${this.i18n.t("projects.reusableBlocks","Ideas")}</h2><p class="section-note">These blocks are not attached to a document. Open the Block editor to refine, fork, file, or remove them.</p></div><span>${blocks.length}</span></div><div class="project-block-grid">${blocks.map((block)=>{const filed=p.collections.find((item)=>item.id===p.membership[block.id]?.collectionId);return html`<article><span>${block.type} · ${filed?.handle??this.i18n.system("unfiled")}</span><h3>${block.handle}</h3><p>${String(block.properties.text??block.properties.label??"Reusable context")}</p><a class="button secondary compact" href=${libraryBlockEditorRoute(block.id)} @click=${(event:MouseEvent)=>this.#followLink(event,libraryBlockEditorRoute(block.id))}>Edit block ${icon("arrow")}</a></article>`;})}</div></section>`:nothing}
      <section class="project-overview-summary" aria-label=${this.i18n.t("deliver.summary","Project delivery summary")}><button type="button" @click=${()=>this.querySelector(".document-library-grid")?.scrollIntoView({behavior:"smooth",block:"start"})}><b>${this.i18n.number(documents.length)}</b><span>${this.i18n.t("workbench.documents","Documents")}</span></button>${canAccessCanvas?html`<button type="button" @click=${()=>this.#openRoute("/canvas")}><b>${this.i18n.number(boards.length)}</b><span>${this.i18n.t("canvas.board","Board")}</span></button>`:nothing}<button type="button" @click=${()=>this.#openRoute("/deliver")}><b>${this.i18n.number(readyResults)}</b><span>${this.i18n.t("workbench.creativeResults","Creative results")}</span></button><button type="button" @click=${()=>this.#openRoute("/activity")}><b>${this.i18n.number(needsAttention)}</b><span>${this.i18n.t("activity.needsYou","Needs you")}</span></button></section></div></div>
      ${this.#newDocument?this.#duplicateSourceId?this.#copyDialog():this.#ordinaryDocumentDialog():nothing}
      ${pending?html`<dialog class="modal project-document-dialog project-document-delete-dialog" closedby="any" aria-labelledby="project-delete-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeDelete();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeDelete();}} @close=${()=>{if(this.#pendingDeleteId){this.#pendingDeleteId="";this.requestUpdate();}}}><div class="modal-card document-delete-card"><button class="icon-button modal-close" aria-label="Cancel document removal" @click=${this.#closeDelete}>${icon("close")}</button><span class="eyebrow">Reversible removal</span><h2 id="project-delete-title">Remove “${pending.title}”?</h2><p>The document leaves active project views; its event history remains replayable and Undo can restore it.</p><footer><button class="button ghost" @click=${this.#closeDelete}>Cancel</button><button class="button danger" @click=${this.#confirmDelete}>Remove document</button></footer></div></dialog>`:nothing}
    </section>`;
  }
}
if (!customElements.get("forma-project-contents")) customElements.define("forma-project-contents",FormaProjectContents);
