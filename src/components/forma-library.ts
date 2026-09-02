import { copyOutputRequirementCreationEvents } from "../model/output-requirement-copy.ts";
import { html, nothing } from "lit";
import { hasBlockingNavigationDialog, navigateInApp, navigationPresentationMatches, type CommandDeparture, type LocalNavigation, type NavigationPresentationContext } from "./command-departure";
import { creativeNextActions, type CreativeNextAction } from "../model/workspace-intelligence";
import { nextActionFacts } from "../state/next-action-context";
import { renderLifecycleNextActionCards } from "./next-action-cards";
import { openCreativeNextActionDestination } from "./creative-next-action-navigation";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";
import type { FormaShell } from "./forma-shell";
import { reuseManualOutput, type ManualOutputReuse } from "./manual-output-reuse";

import { cache } from "lit/directives/cache.js";
import { localizeTemplateResult } from "./design-system/localized-template";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { BLOCK_INTENTS, blockIntentFor, blockTypeDefinition } from "../model/block-types";
import "./context-block";
import { contextControlName } from "./context-controls";
import { FormaElement, icon, downloadJson } from "./forma-element";
import { blockIconName } from "./icon-semantics";
import { ensureModalDialog } from "./modal-dialog";
import { exportProjectArchive, importArchive, type FormaArchive } from "../model/archive";
import { foldEvents, generationHistoryItems, outputQualityLabel, type CreativeBlock, type CreativeOutput, type GenerationHistoryItem } from "../model/events";
import { phase7IndexStatus, retrieveFewShotExemplars } from "../model/indexing";
import { documentArtifactDefinition, documentArtifactRevision, type DocumentArtifact } from "../model/document-artifacts";
import { scopedFormaActivity } from "../model/activity";
import { promptTechniqueDefinition } from "../model/prompt-structures";
import { describeOutput, imageOutputNamingCandidate, qualifyDisplayCollisions } from "../model/output-naming";
import { isContextCompositionRelation } from "../model/combined-context";
import { isImageReference, referenceMedium } from "../model/reference-media";
import { artifactFocusOptionsFromRoute, isProjectTaskRoute, libraryBaseRoute, libraryBlockEditorFromRoute, libraryBlockEditorRoute, libraryFocusFromRoute, libraryFocusRoute as buildLibraryFocusRoute, libraryRootRoute, withDocumentInRoute, type LibraryFocusKind } from "../model/routes";
import "./output-card";
import "./prompt-fan-visual";
import "./prompt-fan-review";
import "./project-rail";
import "./reference-image";
import type { LibraryBlockEditor } from "./library-block-editor";
import "./library-block-editor";
import "./document-artifacts";
import "./artifact-summary";
import "./design-system/forms";
import "./design-system/navigation";
import "./design-system/layout";

type LibraryView = "all"|"blocks"|"outputs"|"families";
type OutputScope = "recent"|"kept";
type LibraryImportOriginal = {
  readonly selectionId:number;readonly documentId:string;readonly projectId:string;readonly title:string;
  state:"pending"|"unconfirmed";check?:"checking"|"found"|"absent"|"unavailable";
};
const records=(value:unknown):Array<Record<string,unknown>>=>Array.isArray(value)?value.filter((item):item is Record<string,unknown>=>Boolean(item)&&typeof item==="object"&&!Array.isArray(item)):[];

export class FormaLibrary extends FormaElement {
  #query="";#corpusQuery="warm palette";#collectionFilter="";#view:LibraryView="all";#outputScope:OutputScope="recent";#imported?:FormaArchive;#openedArtifactId="";#artifactOpenIssue="";#focusOrigin:HTMLElement|null=null;#focusOriginHref="";
  // Joins the existing route-open operation; never starts a duplicate viewer read.
  #artifactOpening:{route:string;artifactId:string;documentId:string;revision:number|undefined;contentSha256:string|undefined;
    focus:OutputNavigationFocusLease|null;current:()=>boolean;disposeFocus:()=>void;promise:Promise<boolean>}|null=null;
  // Same keyed target lifetime; references do not copy any editor fields.
  #editorTargets=new Map<string,LibraryBlockEditor|undefined>();
  #editorScope="";
  #lastEditorId="";
  #cancelLibraryReturnFocus:(()=>void)|null=null;
  #cancelPublisherCompletion:(()=>void)|null=null;
  #outputReuse:ManualOutputReuse={cancel:null};
  #importRequest=0;
  #importOwner:{id:number;pending:boolean;original?:LibraryImportOriginal;current:()=>boolean;close:()=>void;
    dismiss:(event?:Event)=>void;show:(dialog:HTMLDialogElement)=>void}|null=null;

  override disconnectedCallback(){this.#outputReuse.cancel?.();this.#cancelPublisherCompletion?.();this.#importOwner?.close();this.#cancelLibraryReturnFocus?.();this.#artifactOpening?.disposeFocus();this.#artifactOpening=null;this.#openedArtifactId="";super.disconnectedCallback();}

  protected override willUpdate(){
    if(this.#importOwner&&!this.#importOwner.current())this.#importOwner.close();
    if(this.#artifactOpening&&!this.#artifactOpening.current())this.#artifactOpening.disposeFocus();
    const projection=this.store.projection.get();
    const scope=JSON.stringify([this.store.captureAuthorizationScope()?.key??"",projection.projectId,this.#canAuthor()]);
    const target=libraryBlockEditorFromRoute(this.store.route.get());
    if(target||scope!==this.#editorScope)for(const dialog of this.querySelectorAll<HTMLDialogElement>("dialog.library-focus-dialog,dialog.family-lightbox"))if(dialog.open)dialog.close();
    for(const editor of this.querySelectorAll("forma-library-block-editor")){
      const id=editor.blockId??"__new__";
      // Capture the actual child before the existing cache detaches it on Back.
      if(scope===this.#editorScope&&this.#editorTargets.has(id)&&editor.closest("forma-library")===this
        &&FormaElement.hasStoreIdentity(editor,this.store))this.#editorTargets.set(id,editor);
      if(scope!==this.#editorScope||!target||editor.blockId!==target.blockId)editor.suspendControls();
    }
    if(scope!==this.#editorScope){this.#editorTargets.clear();this.#focusOrigin=null;this.#focusOriginHref="";this.#lastEditorId="";}
    for(const id of this.#editorTargets.keys())if(id!=="__new__"&&id!==target?.blockId
      &&!projection.libraryBlocks.some(block=>block.id===id))this.#editorTargets.delete(id);
    this.#editorScope=scope;
  }

  #canAuthor(){const session=this.store.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];return Boolean(this.store.captureAuthorizationScope())&&permissions.includes("project.read")&&permissions.includes("project.author");}
  #namedValue(name:string){return{name:`\u2068${name}\u2069`};}
  #libraryAction(kept:boolean,name:string){return this.i18n.t(kept?"projects.removeKeptNamed":"projects.keepReuseNamed",kept?"Remove from kept: {name}":"Keep for reuse: {name}",this.#namedValue(name));}
  #inputLabel(adopted:boolean){
    const canvasLibrary=libraryBaseRoute(this.store.route.get())==="/canvas/library";
    return this.i18n.t(
      canvasLibrary?(adopted?"projects.editCreator":"projects.useEditCreator"):(adopted?"projects.editInput":"projects.useEdit"),
      canvasLibrary?(adopted?"Edit in Creator Workspace":"Use & edit in Creator Workspace"):(adopted?"Edit input":"Use & edit"),
    );
  }
  #inputAction(adopted:boolean,name:string){
    if(libraryBaseRoute(this.store.route.get())==="/canvas/library")return`${this.#inputLabel(adopted)}: ${this.#namedValue(name).name}`;
    return this.i18n.t(adopted?"projects.editInputNamed":"projects.useEditNamed",adopted?"Edit input: {name}":"Use & edit: {name}",this.#namedValue(name));
  }

  override connectedCallback(){super.connectedCallback();const view=String(this.store.ui.libraryView);if(["all","blocks","outputs","families"].includes(view))this.#view=view as LibraryView;this.#outputScope=this.store.ui.libraryOutputScope==="kept"?"kept":"recent";const focus=libraryFocusFromRoute(this.store.route.get());if(focus)this.#view=focus.kind==="block"?"blocks":focus.kind==="family"?"families":"outputs";}
  async #restoreLibraryFocus(resolve:()=>HTMLElement|null){
    this.#cancelLibraryReturnFocus?.();
    const route=this.store.route.get(),scope=this.#editorScope,projectId=this.store.projection.get().projectId;
    const source=this.store.captureSourceOwnership(),authorization=this.store.captureAuthorizationScope();
    const shell=this.closest<FormaElement>("forma-shell");
    const scopeCurrent=()=>this.isConnected&&this.store.route.get()===route&&this.#editorScope===scope
      &&this.store.projection.get().projectId===projectId&&this.store.sourceOwnershipActive(source)
      &&this.store.authorizationScopeActive(authorization)&&!libraryBlockEditorFromRoute(route)&&!libraryFocusFromRoute(route)
      &&!this.ownerDocument.querySelector("dialog[open]");
    const focus=captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>scopeCurrent()
      &&Boolean(shell?.isConnected&&FormaElement.hasStoreIdentity(shell,this.store)&&element===shell.querySelector("#main-content"))});
    const dispose=()=>{unsubscribe();focus.dispose();if(this.#cancelLibraryReturnFocus===dispose)this.#cancelLibraryReturnFocus=null;};
    const current=()=>this.#cancelLibraryReturnFocus===dispose&&scopeCurrent()&&focus.current();
    const unsubscribe=this.store.subscribe(()=>{if(!current())dispose();});
    this.#cancelLibraryReturnFocus=dispose;
    try{
      if(!current())return;
      await this.updateComplete;
      if(!current())return;
      const target=resolve();
      if(target?.isConnected)focus.run(target,()=>{if(!current())return false;target.focus({preventScroll:true});return current();});
    }finally{dispose();}
  }

  protected override updated(){const editor=libraryBlockEditorFromRoute(this.store.route.get());if(editor)this.#lastEditorId=editor.blockId??"__new__";else if(this.#lastEditorId){const id=this.#lastEditorId;this.#lastEditorId="";void this.#restoreLibraryFocus(()=>this.querySelector<HTMLElement>(`[data-context-controls-id="${CSS.escape(id)}"]`)??this.querySelector<HTMLElement>(".library-toolbar input")??this.querySelector<HTMLElement>(".page-header--library h1"));}this.querySelectorAll<HTMLDialogElement>("dialog.library-focus-dialog,dialog.family-lightbox").forEach((dialog)=>ensureModalDialog(dialog));for(const dialog of this.querySelectorAll<HTMLDialogElement>("dialog.library-import-dialog"))this.#importOwner?.show(dialog);const focus=libraryFocusFromRoute(this.store.route.get());if(focus){const view=focus.kind==="block"?"blocks":focus.kind==="family"?"families":"outputs";if(this.store.ui.libraryView!==view)this.store.patchUi({libraryView:view});}if(!this.store.loading.get()&&focus&&!this.#focusAvailable(focus.kind,focus.id)){this.store.setRoute(libraryRootRoute(this.store.route.get()),{replace:true});this.store.toast("That library item is no longer available.");return;}if(focus?.kind==="artifact"&&this.#focusAvailable(focus.kind,focus.id)){
      const route=this.store.route.get(),key=route;
      if(key!==this.#openedArtifactId){
        this.#artifactOpening?.disposeFocus();
        this.#openedArtifactId=key;this.#artifactOpenIssue="";
        const options=artifactFocusOptionsFromRoute(route),viewer=this.querySelector("forma-document-artifacts");
        const source=this.store.captureSourceOwnership(),authorization=this.store.captureAuthorizationScope();
        const navigation=this.store.captureWorkspaceNavigationFocus(route);
        const artifact=this.store.projection.get().libraryArtifacts.find(value=>value.id===focus.id);
        const opening={route,artifactId:focus.id,documentId:artifact?.documentId??"",
          revision:options==="invalid"?undefined:options?.expectedRevision,
          contentSha256:options==="invalid"?undefined:options?.expectedContentSha256,
          focus:navigation?.focus??null,current:()=>false,disposeFocus:()=>{},promise:Promise.resolve(false)};
        opening.current=()=>this.isConnected&&this.store.route.get()===route&&this.#openedArtifactId===key
          &&this.#artifactOpening===opening&&viewer===this.querySelector("forma-document-artifacts")
          &&this.store.sourceOwnershipActive(source)&&this.store.authorizationScopeActive(authorization);
        this.#artifactOpening=opening;
        // Reuse a transferred opening lease even when it is already stale.
        // Only an opening without a Store route lease owns a local fallback.
        const shell=this.closest<FormaShell>("forma-shell");
        const focusOwner=shell&&FormaElement.hasStoreIdentity(shell,this.store)?shell:null;
        const localFocus=navigation?null:captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>{
          if(!opening.current())return false;
          if(shell?.isConnected&&FormaElement.hasStoreIdentity(shell,this.store)
            &&element===shell.querySelector("#main-content"))return true;
          const dialog=element.closest<HTMLDialogElement>("dialog");
          return Boolean(viewer?.isConnected&&viewer.documentId===opening.documentId&&dialog?.open
            &&dialog===viewer.querySelector(".document-artifact-view")&&dialog.closest("forma-document-artifacts")===viewer);
        }});
        const openingFocusCurrent=()=>navigation?navigation.current():localFocus!.current();
        opening.disposeFocus=()=>{
          localFocus?.dispose();
          if(navigation)focusOwner?.releaseExactRetainedArtifactFocus(route,navigation.focus);
        };
        opening.promise=(async()=>{
          const opened=options==="invalid"?false:await viewer?.openArtifactById(focus.id,{...(options??{}),
            current:stage=>opening.current()&&(stage==="editing"||openingFocusCurrent())});
          if(!opening.current()||!openingFocusCurrent())return false;
          if(!opened){this.#artifactOpenIssue=focus.id;this.requestUpdate();}
          return Boolean(opened);
        })().catch(()=>{if(opening.current()&&openingFocusCurrent()){this.#artifactOpenIssue=focus.id;this.requestUpdate();}return false;}).finally(opening.disposeFocus);
      }
    }else if(focus?.kind!=="artifact"){this.#openedArtifactId="";this.#artifactOpenIssue="";this.#artifactOpening?.disposeFocus();this.#artifactOpening=null;}}

  // Cleanup joins the existing Promise; it neither starts nor certifies an opening.
  artifactRouteOpeningCompletion(route:string,focus:OutputNavigationFocusLease):Promise<boolean>|null{
    const opening=this.#artifactOpening;
    return opening?.route===route&&opening.focus===focus?opening.promise:null;
  }

  /** Await the same exact route opening; a successful Store route is not viewer-arrival evidence. */
  async awaitArtifactRouteOpening(target:{artifactId:string;documentId:string;revision:number;contentSha256:string},
    options:{current:()=>boolean}):Promise<boolean>{
    if(!options.current()||!Number.isSafeInteger(target.revision)||target.revision<0||!/^[a-f0-9]{64}$/.test(target.contentSha256))return false;
    await this.updateComplete;if(!options.current())return false;
    const opening=this.#artifactOpening,viewer=this.querySelector("forma-document-artifacts");
    if(!opening||opening.artifactId!==target.artifactId||opening.documentId!==target.documentId
      ||opening.revision!==target.revision||opening.contentSha256!==target.contentSha256||!opening.current())return false;
    if(!await opening.promise||!options.current()||!opening.current())return false;
    return Boolean(viewer?.isConnected&&viewer===this.querySelector("forma-document-artifacts")
      &&viewer.documentId===target.documentId&&viewer.querySelector<HTMLDialogElement>(".document-artifact-view")?.open
      &&documentArtifactRevision(this.store.events.get(),target.artifactId)===target.revision);
  }
  #lifecycleOpening=0;
  #nextContext(){
    const projection=this.store.projection.get();
    const document=projection.documents.find(value=>value.id===projection.documentId&&value.projectId===projection.projectId&&!value.removed);
    if(!document||!this.store.routeDataReady())return null;
    const facts=nextActionFacts(this.store,document.id,null,{lifecycle:true});
    return facts.canRead?{facts,document,projectName:projection.projectName}:null;
  }
  #publisherDraftChanged(){
    return [...this.querySelectorAll<HTMLInputElement>(".library-organization-context form.workspace-settings-form input")]
      .some(input=>input.getAttribute("type")==="checkbox"
        ?input.checked!==input.defaultChecked:input.value!==input.defaultValue);
  }
  #unretainedNavigationBlocked(context?:NavigationPresentationContext,departure=false){
    const importOwner=this.#importOwner;
    // Only the exact recovered original's readonly preview is this gesture's presentation.
    const originalPreview=departure&&Boolean(this.#imported&&importOwner?.current()&&!importOwner.pending
      &&importOwner.original?.state==="unconfirmed"&&importOwner.original.check==="found"
      &&importOwner.id===importOwner.original.selectionId&&this.#importRequest===importOwner.id
      &&context?.presentation?.trigger===this.querySelector(".library-import-open-original")
      &&navigationPresentationMatches(context,this,this.querySelector(".library-import-dialog")));
    return Boolean(!originalPreview&&(this.#imported||importOwner&&(importOwner.pending||importOwner.original?.state==="pending"
      ||this.#importRequest===importOwner.id||!departure&&importOwner.original))||this.#cancelPublisherCompletion
      ||hasBlockingNavigationDialog(this.ownerDocument,context)||this.#publisherDraftChanged());
  }
  #navigationBlocked(context?:NavigationPresentationContext,departure=false){
    const target=libraryBlockEditorFromRoute(this.store.route.get());
    const inspection=target?[...this.querySelectorAll("forma-library-block-editor")].find(editor=>
      editor.isConnected&&editor.blockId===target.blockId&&editor.closest("forma-library")===this
      &&FormaElement.hasStoreIdentity(editor,this.store)):undefined;
    return Boolean(target&&!inspection?.allowsNavigationPresentation(context)
      ||[...this.#editorTargets.values()].some(editor=>editor?.navigationBlocked)||this.#unretainedNavigationBlocked(context,departure));
  }
  /** Content-free admission; the caller still owns Source, route and native focus. */
  captureCommandDeparture():CommandDeparture {
    // A dismissed settled original is recoverable metadata, not a new unsent draft.
    // Preparation still checks it; deliberate departure never cancels its write.
    return {element:this,current:()=>this.isConnected,blocked:context=>this.#navigationBlocked(context,true),
      reason:()=>this.#cancelPublisherCompletion?"next.library.publisherPending"
        :this.#publisherDraftChanged()?"next.library.publisherDraft":"next.lifecycle.currentWorkOpen"};
  }
  captureLocalNavigation(path:string):LocalNavigation|null {
    const store=this.store,route=store.route.get(),scope=this.#editorScope,projection=store.projection.get();
    const projectId=projection.projectId,documentId=projection.documentId,canAuthor=this.#canAuthor();
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope(),base=libraryBaseRoute(route);
    const target=libraryBlockEditorFromRoute(path),focus=libraryFocusFromRoute(path);
    const root=path===base||path===libraryRootRoute(route);
    if(!path.startsWith("/")||path.startsWith("//")||!isProjectTaskRoute(path)||libraryBaseRoute(path)!==base
      ||!root&&(!target&&!focus||target&&path!==libraryBlockEditorRoute(target.blockId??"",route)
        ||focus&&(new URL(path,location.origin).search!==new URL(buildLibraryFocusRoute(focus.kind,focus.id,"",route),location.origin).search
          ||new URL(path,location.origin).hash)))return null;
    const available=()=>root||Boolean(target&&canAuthor&&(!target.blockId||store.projection.get().libraryBlocks.some(block=>
      block.id===target.blockId&&block.projectId===projectId&&!block.removed&&!block.properties.organization_context_package_binding_id)))
      ||Boolean(focus&&this.#focusAvailable(focus.kind,focus.id));
    const retained=[...this.#editorTargets],owned=()=>[...this.querySelectorAll<LibraryBlockEditor>("forma-library-block-editor")]
      .filter(editor=>editor.isConnected&&editor.closest("forma-library")===this&&FormaElement.hasStoreIdentity(editor,store));
    const editors=owned(),active=this.ownerDocument.activeElement instanceof HTMLElement?this.ownerDocument.activeElement:null;
    const editorGesture=editors.some(editor=>active&&editor.contains(active));
    const current=()=>{
      const targets=[...this.#editorTargets],mounted=owned();
      return this.isConnected&&this.store===store&&store.route.get()===route&&this.#editorScope===scope
        &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)&&this.#canAuthor()===canAuthor
        &&store.projection.get().projectId===projectId&&store.projection.get().documentId===documentId&&available()
        &&targets.length===retained.length&&retained.every(([id,editor],index)=>targets[index]?.[0]===id&&targets[index]?.[1]===editor
          &&(!editor||FormaElement.hasStoreIdentity(editor,store)))
        &&mounted.length===editors.length&&editors.every((editor,index)=>mounted[index]===editor);
    };
    if(!current())return null;
    return {element:this,current,blocked:context=>this.#unretainedNavigationBlocked(context,true),
      reason:()=>this.captureCommandDeparture().reason(),prepare:()=>{
        if(!current())return false;
        // The existing keyed cache survives only these same-Library routes.
        // Prepare original local UI only after every sibling admitted departure.
        if(target){store.patchUi({libraryView:"blocks"});if(editorGesture)window.scrollTo({top:0});}
        if(root&&libraryBlockEditorFromRoute(route)){for(const editor of editors)editor.suspendControls();store.patchUi({libraryView:"blocks"});}
        if(focus){
          if(active&&!active.closest("dialog")){this.#focusOrigin=active;this.#focusOriginHref=active.closest("a")?.getAttribute("href")??"";}
          if(focus.kind==="artifact"){this.#artifactOpening?.disposeFocus();this.#artifactOpening=null;this.#openedArtifactId="";this.#artifactOpenIssue="";}
        }
        return true;
      }};
  }
  async #followLifecycleAction(action:CreativeNextAction){
    const next=this.#nextContext(),route=this.store.route.get();
    if(!next||action.target.documentId!==next.document.id)return false;
    if(this.#navigationBlocked()){
      this.store.toast(this.i18n.t(this.#cancelPublisherCompletion?"next.library.publisherPending"
        :this.#publisherDraftChanged()?"next.library.publisherDraft":"next.lifecycle.currentWorkOpen"));return false;
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
  #setView(view:LibraryView){this.#view=view;this.store.patchUi({libraryView:view});this.requestUpdate();}
  #setOutputScope(scope:OutputScope){this.#outputScope=scope;this.store.patchUi({libraryOutputScope:scope});this.requestUpdate();}
  #focusAvailable(kind:LibraryFocusKind,id:string){const projection=this.store.projection.get();return kind==="block"?projection.libraryBlocks.some((block)=>block.id===id):kind==="output"?projection.libraryOutputs.some((output)=>output.id===id):kind==="artifact"?projection.libraryArtifacts.some((artifact)=>artifact.id===id):projection.families.some((family)=>!family.superseded&&String(family.family_id)===id);}
  #openFocus(kind:LibraryFocusKind,id:string,label="",event?:MouseEvent){
    const store=this.store,route=store.route.get(),trigger=event?.currentTarget;
    const dialog=trigger instanceof HTMLElement?trigger.closest<HTMLDialogElement>("dialog.library-focus-dialog,dialog.family-lightbox"):null;
    const context:NavigationPresentationContext|undefined=trigger instanceof HTMLElement&&dialog
      &&dialog===this.querySelector("dialog.library-focus-dialog,dialog.family-lightbox")&&dialog.closest("forma-library")===this
      ?{presentation:{owner:this,element:dialog,trigger,current:()=>this.isConnected&&this.store===store&&store.route.get()===route
        &&dialog===this.querySelector("dialog.library-focus-dialog,dialog.family-lightbox")}}:undefined;
    return navigateInApp(this,{localRoute:buildLibraryFocusRoute(kind,id,label,route)},context);
  }
  #navigate(event:MouseEvent,kind:LibraryFocusKind,id:string,label=""){if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();return this.#openFocus(kind,id,label,event);}
  #blockPreviewPresentation(blockId:string,event:MouseEvent|undefined,current:()=>boolean):NavigationPresentationContext|undefined{
    const trigger=event?.currentTarget;
    const dialog=trigger instanceof HTMLElement?trigger.closest<HTMLDialogElement>("dialog.library-focus-dialog"):null;
    const focused=libraryFocusFromRoute(this.store.route.get());
    if(trigger instanceof HTMLElement&&dialog&&focused?.kind==="block"&&focused.id===blockId
      &&dialog===this.querySelector("dialog.library-focus-dialog")&&dialog.closest("forma-library")===this
      &&dialog.getAttribute("aria-labelledby")==="block-focus-title"){
      return{presentation:{owner:this,element:dialog,trigger,current:()=>current()
        &&dialog===this.querySelector("dialog.library-focus-dialog")}};
    }
    return undefined;
  }
  #openEditor(blockId="",event?:MouseEvent){
    const store=this.store,route=store.route.get(),projectId=store.projection.get().projectId;
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const current=()=>this.isConnected&&this.store===store&&store.route.get()===route
      &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)&&this.#canAuthor()
      &&store.projection.get().projectId===projectId&&(!blockId||store.projection.get().libraryBlocks.some(block=>
        block.id===blockId&&block.projectId===projectId&&!block.removed));
    if(!current())return;
    if(blockId&&store.projection.get().libraryBlocks.find(block=>block.id===blockId)?.properties.organization_context_package_binding_id){
      store.toast(this.i18n.system("Organization context"));return;
    }
    const context=this.#blockPreviewPresentation(blockId,event,current);
    // Editor-to-editor/Back transitions retain the existing keyed child owners.
    // Protect only work this local route actually removes; external departure
    // continues to check every retained editor through #navigationBlocked.
    if(this.#unretainedNavigationBlocked(context)){
      store.toast(this.i18n.t(this.captureCommandDeparture().reason()));return;
    }
    return navigateInApp(this,{localRoute:libraryBlockEditorRoute(blockId,route)},context);
  }
  #artifactViewerClosed(event:Event){
    const viewer=this.querySelector("forma-document-artifacts");
    if(!viewer?.isConnected||event.target!==viewer||event.currentTarget!==viewer
      ||viewer.closest("forma-library")!==this||!FormaElement.hasStoreIdentity(viewer,this.store)
      ||!viewer.launcherOnly||viewer.source!=="library")return;
    if(libraryFocusFromRoute(this.store.route.get())?.kind==="artifact")
      this.#closeFocus((event as CustomEvent<{preserveFocus?:boolean}>).detail?.preserveFocus===true);
  }
  #closeFocus(preserveFocus:boolean|Event=false){const preserve=preserveFocus===true,origin=this.#focusOrigin,href=this.#focusOriginHref;this.#focusOrigin=null;this.#focusOriginHref="";for(const dialog of this.querySelectorAll<HTMLDialogElement>("dialog.library-focus-dialog,dialog.family-lightbox"))if(dialog.open)dialog.close();this.store.setRoute(libraryRootRoute(this.store.route.get()),{replace:true,...(preserve?{preserveFocus:true}:{})});if(!preserve)void this.#restoreLibraryFocus(()=>{const fallback=href?[...this.querySelectorAll<HTMLAnchorElement>("a[href]")].find((link)=>link.getAttribute("href")===href):undefined;return(origin?.isConnected?origin:fallback)??null;});}
  async #promote(family:Record<string,unknown>){if(!this.#canAuthor())return;const id=crypto.randomUUID();const familyId=String(family.family_id);const label=String(family.label??"kept-family").normalize("NFC").trim();const ascii=label.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");const handle=/\P{ASCII}/u.test(label)?label:ascii||label||`family-${id.slice(0,8)}`;const appended=await this.store.append({type:"CollectionCreated",payload:{collection_id:id,handle,parent_collection_id:null,position:`z${this.store.head.get()}`,source_claim_ref:`family:${familyId}`}});if(appended.length)this.store.toast("This visual family was saved as a project collection.");}
  async #correct(family:Record<string,unknown>){if(!this.#canAuthor()||this.store.session.get()?.projectContext)return;const member=records(family.members).at(-1);if(!member)return;const appended=await this.store.append({type:"ClaimSuperseded",payload:{claim_ref:String(member.claim_ref??`family-membership:${family.family_id}:${member.object_id}`),previous_event_id:member.event_id??null,new_event_id:null,reason:"user-corrected-family-membership"}});if(appended.length)this.store.toast("That image was removed from the suggested visual family.");}
  #captureLibraryContinuation(){
    this.#cancelLibraryReturnFocus?.();
    const store=this.store,route=store.route.get(),scope=this.#editorScope;
    const projectId=store.projection.get().projectId,documentId=store.projection.get().documentId;
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    const scopeCurrent=()=>this.isConnected&&this.store===store&&store.route.get()===route&&this.#editorScope===scope
      &&store.projection.get().projectId===projectId&&store.projection.get().documentId===documentId
      &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization);
    const dispose=()=>{unsubscribe();focus.dispose();if(this.#cancelLibraryReturnFocus===dispose)this.#cancelLibraryReturnFocus=null;};
    const current=()=>this.#cancelLibraryReturnFocus===dispose&&scopeCurrent()&&focus.current();
    const unsubscribe=store.subscribe(()=>{if(!current())dispose();});
    this.#cancelLibraryReturnFocus=dispose;
    if(!current())dispose();
    return{current,focus,dispose};
  }
  async #useCopy(block:CreativeBlock,event?:MouseEvent){
    const sourceOwner=this.store.captureSourceOwnership();
    if(!this.store.sourceOwnershipActive(sourceOwner)||!this.#canAuthor())return;
    if(block.properties.organization_context_package_binding_id){this.store.toast(this.i18n.system("Organization context"));return;}
    const continuation=this.#captureLibraryContinuation();
    try{
      if(!continuation.current())return;
      const context=this.#blockPreviewPresentation(block.id,event,continuation.current);
      // Canvas Copy stays here; ordinary Library Copy discards this whole owner.
      // Read the actual current and cached editors, never a copied raw baseline.
      if(libraryBaseRoute(this.store.route.get())!=="/canvas/library"
        &&([...this.#editorTargets.values()].some(editor=>editor?.navigationBlocked)
          ||[...this.querySelectorAll("forma-library-block-editor")].some(editor=>editor.isConnected
            &&editor.closest("forma-library")===this&&FormaElement.hasStoreIdentity(editor,this.store)&&editor.navigationBlocked)
          ||this.#unretainedNavigationBlocked(context))){
        this.store.toast(this.i18n.t(this.captureCommandDeparture().reason()));return;
      }
      const copied=await this.store.copyLibraryBlockSet(block.id,undefined,"library");
      if(copied&&!("publication"in copied)&&this.store.sourceOwnershipActive(sourceOwner)&&continuation.current()){
        if(libraryBaseRoute(this.store.route.get())==="/canvas/library")this.store.toast(this.i18n.t("projects.contextAdded","The context was added to your current document."));
        else this.store.setRoute("/");
      }
    }finally{continuation.dispose();}
  }
  async #useArtifactInput(artifact:DocumentArtifact,event:MouseEvent){
    const destination=this.store.projection.get().documentId;
    await reuseManualOutput(this,this.store,this.#outputReuse,event,{
      destinationDocumentId:destination,
      current:()=>this.store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id
        &&value.documentId===artifact.documentId&&value.sequence===artifact.sequence
        &&value.sourceEventId===artifact.sourceEventId&&value.contentRef===artifact.contentRef),
      copy:()=>this.store.addArtifactAsContext(artifact.id,destination,"library",{reveal:false}),
    });
  }
  #relatedReferenceCount(blockId:string){const projection=this.store.projection.get();return projection.libraryBlockRelations.filter((relation)=>relation.fromBlockId===blockId&&projection.libraryBlocks.some((block)=>block.id===relation.toBlockId&&block.type==="reference"&&isImageReference(block.properties))).length;}
  async #toggleLibrary(output:CreativeOutput|DocumentArtifact){
    if(!this.#canAuthor())return;
    const removing=output.library,restoreFocus=removing&&this.#outputScope==="kept";
    const active=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const cards=[...this.querySelectorAll<HTMLElement>(".library-output")],current=active?.closest<HTMLElement>(".library-output");
    const index=current?cards.indexOf(current):-1,next=cards[index+1]??cards[index-1]??null;
    const continuation=restoreFocus?this.#captureLibraryContinuation():null;
    try{
      if(continuation&&!continuation.current())return;
      const appended=await this.store.append({type:removing?"RemovedFromLibrary":"AddedToLibrary",payload:{object_id:output.id,item_id:output.id,document_id:output.documentId,meaning:"personal-reusable-output"}});
      if(appended.length){
        if(continuation&&!continuation.current())return;
        this.store.toast(removing?"Output removed from your kept set.":"Output kept for reuse in your personal library.");
        if(continuation){
          await this.updateComplete;
          if(!continuation.current())return;
          const target=next?.isConnected?next.querySelector<HTMLElement>('button[aria-pressed], button, a')
            :this.querySelector<HTMLElement>('.compact-segmented button[aria-pressed="true"]');
          if(target?.isConnected&&target.closest("forma-library")===this)continuation.focus.run(target,()=>{
            if(!continuation.current())return false;
            target.focus({preventScroll:true});return continuation.current();
          });
        }
      }
    }finally{continuation?.dispose();}
  }
  async #import(event:Event){
    const input=event.target as HTMLInputElement,file=input.files?.[0];
    if(!file||!input.isConnected||!this.isConnected||!this.#canAuthor()||this.store.session.get()?.projectContext
      ||![...this.querySelectorAll<HTMLInputElement>('input[type="file"]')].includes(input))return;
    // Transfer only this same current original; the new file never replaces its command.
    const original=this.#importOwner?.current()?this.#importOwner.original:undefined;
    this.#importOwner?.close();
    const id=++this.#importRequest,route=this.store.route.get(),resource=route.split("#",1)[0],projectId=this.store.projection.get().projectId;
    const source=this.store.captureSourceOwnership(),authorization=this.store.captureAuthorizationScope();
    let shown=false,shownDialog:HTMLDialogElement|null=null;
    const current=()=>this.#importOwner?.id===id&&this.isConnected&&this.#canAuthor()&&!this.store.session.get()?.projectContext
      &&this.store.route.get().split("#",1)[0]===resource&&this.store.projection.get().projectId===projectId
      &&this.store.sourceOwnershipActive(source)&&this.store.authorizationScopeActive(authorization);
    // The initial preview owns the file gesture's focus, not a fresh lease after parsing.
    const focus=captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>{
      const dialog=this.querySelector<HTMLDialogElement>(".library-import-dialog");
      return current()&&Boolean(dialog?.open&&(element===dialog||element.closest("dialog")===dialog));
    }});
    const close=()=>{
      unsubscribe();focus.dispose();
      if(this.#importOwner?.id!==id)return;
      ++this.#importRequest;
      this.#importOwner=null;this.#imported=undefined;this.requestUpdate();
    };
    const dismiss=(event?:Event)=>{
      if(this.#importOwner?.id!==id)return;
      if(!this.#importOwner.original){
        const trigger=event?.currentTarget;
        const dialog=trigger instanceof HTMLElement?trigger.closest<HTMLDialogElement>("dialog.library-import-dialog"):null;
        // Only the current ordinary user dismissal invokes native restoration.
        // Retirement and original/newer recovery keep their existing cleanup;
        // a queued close event never gains a new focus handoff.
        if((event?.type==="click"||event?.type==="cancel")&&current()&&this.#importRequest===id
          &&this.store.route.get()===route&&dialog===shownDialog&&dialog?.isConnected&&dialog.open
          &&dialog===this.querySelector(".library-import-dialog")&&dialog.closest("forma-library")===this
          &&dialog.contains(this.ownerDocument.activeElement)
          &&![...this.ownerDocument.querySelectorAll("dialog[open]")].some(other=>other!==dialog))dialog.close();
        close();return;
      }
      ++this.#importRequest;focus.dispose();this.#imported=undefined;this.requestUpdate();
    };
    const unsubscribe=this.store.subscribe(()=>{
      if(!current())close();
      else if(!shown&&this.store.route.get()!==route)focus.dispose();
    });
    this.#importOwner={id,pending:false,original,current,close,dismiss,show:dialog=>{
      if(!current()){close();return;}
      if(this.#importRequest!==id)return;
      if(shown){ensureModalDialog(dialog);return;}
      const other=this.ownerDocument.querySelector("dialog[open]");
      if(this.store.route.get()!==route||other&&other!==dialog||!focus.current()){dismiss();return;}
      shown=focus.run(dialog,()=>ensureModalDialog(dialog));
      if(shown)shownDialog=dialog;
      focus.dispose();
      if(!shown)dismiss();
    }};
    this.requestUpdate();
    try{
      if(!current()){close();return;}
      const text=await file.text();
      if(!current()){close();return;}
      if(this.#importRequest!==id)return;
      if(!focus.current()){dismiss();return;}
      this.#imported=importArchive(JSON.parse(text));this.requestUpdate();
    }catch(error){
      const notify=current()&&this.#importRequest===id&&focus.current();
      if(current())dismiss();else close();
      if(notify)this.store.toast(error instanceof Error?error.message:"Import failed");
    }
  }
  async #forkImport(owner=this.#importOwner){
    const imported=this.#imported;
    if(!owner?.current()||owner.pending||owner.original||!this.#canAuthor()||!imported)return;
    const projection=foldEvents(imported.events);
    const restricted=projection.blocks.filter((block)=>["reference","audio","model3d"].includes(block.type)
      ||Object.entries(block.properties).some(([key,value])=>Boolean(value)&&(key.startsWith("organization_context_")
        ||["media_url","reference_id","model_url","model_reference_id","model_content_hash","source_ref","source_evidence_hash","source_artifact_id","source_output_id","source_block_id"].includes(key))));
    if(restricted.length){this.store.toast(this.i18n.t("library.archive.unsafe"));return;}
    const source=this.store.captureSourceOwnership(),authorization=this.store.captureAuthorizationScope();
    let original:LibraryImportOriginal|undefined;
    const originalCurrent=()=>{
      const activeOwner=this.#importOwner;
      return Boolean(original&&activeOwner&&activeOwner.original===original&&activeOwner.current()
        &&this.store.sourceOwnershipActive(source)&&this.store.authorizationScopeActive(authorization));
    };
    owner.pending=true;this.requestUpdate();
    try{
      const documentId=crypto.randomUUID(),title=`Imported · ${projection.documentTitle}`;
      const copiedIds=new Map(projection.blocks.map((block)=>[block.id,crypto.randomUUID()]));
      const events=[{type:"DocumentForked",payload:{document_id:documentId,title,source_stream_id:imported.streamId,source_sequence:imported.events.at(-1)?.sequence??0,carried_block_ids:projection.blocks.map((block)=>block.id)}},...projection.blocks.map((block,index)=>({type:"BlockCreated",payload:{block_id:copiedIds.get(block.id)!,document_id:documentId,type:block.type,handle:`${block.handle}-import`,position:`z${index}`,properties:block.properties}}))];
      const command=copyOutputRequirementCreationEvents(events,copiedIds);
      original={selectionId:owner.id,documentId,projectId:this.store.projection.get().projectId,
        title,state:"pending"};
      owner.original=original;
      const result=await this.store.appendBatchWithReceipt(command);
      if(!originalCurrent())return;
      const activeOwner=this.#importOwner!;
      const complete=result.publication==="published"&&result.acknowledgment.outcome==="observed"
        &&!result.acknowledgment.privateUnavailable&&!result.acknowledgment.rejectedIndices.length
        &&result.acknowledgment.committed.length===command.length&&result.appended.length===command.length
        &&result.appended.some(event=>event.type==="DocumentForked"&&event.payload.document_id===documentId);
      const notSent=result.acknowledgment.action===(command.length>1?"batch":"append")
        &&result.acknowledgment.requestedClientEventIds.length===0
        &&result.acknowledgment.outcome==="not-attempted"&&!result.acknowledgment.privateUnavailable
        &&result.publication==="none"&&result.appended.length===0&&result.acknowledgment.committed.length===0
        &&result.acknowledgment.rejectedIndices.length===0&&result.acknowledgment.observedHead===null;
      if(!complete&&!notSent){original.state="unconfirmed";return;}
      activeOwner.original=undefined;
      if(complete&&activeOwner===owner&&this.#importRequest===owner.id&&this.#imported===imported){
        owner.close();this.store.toast(this.i18n.t("library.archive.imported"));
      }else{
        // Bookkeeping for A may finish while B is current; never consume B.
        this.store.toast(this.i18n.t(complete?"library.archive.originalImported":"library.archive.notSent","",
          {title:`\u2068${original.title}\u2069`}));
        if(this.#importRequest!==activeOwner.id)activeOwner.close();else this.requestUpdate();
      }
    }catch(error){
      if(!original)throw error;
      if(originalCurrent())original.state="unconfirmed";
    }finally{
      owner.pending=false;
      if(this.#importOwner===owner||originalCurrent())this.requestUpdate();
    }
  }
  #originalImportedDocument(owner=this.#importOwner){
    const original=owner?.original;
    if(!owner?.current()||!original||original.state!=="unconfirmed")return null;
    // This is committed Document availability, never an acknowledgment of the whole import.
    return foldEvents(this.store.events.get(),Number.POSITIVE_INFINITY,original.documentId,original.projectId)
      .documents.find(document=>document.id===original.documentId&&document.projectId===original.projectId&&!document.removed)??null;
  }
  #newerImportSelected(owner=this.#importOwner){
    return Boolean(owner?.original&&owner.id!==owner.original.selectionId&&this.#importRequest===owner.id);
  }
  async #checkOriginalImport(event:Event,owner=this.#importOwner){
    const original=owner?.original;
    if(event.currentTarget!==this.querySelector(".library-import-check-original")||!owner?.current()
      ||!original||original.state!=="unconfirmed"||original.check==="checking")return;
    const current=()=>{const activeOwner=this.#importOwner;return Boolean(activeOwner&&activeOwner.original===original&&activeOwner.current());};
    original.check="checking";this.requestUpdate();
    try{
      await this.store.refreshEvents({fromStart:true});
      if(current())original.check=this.#originalImportedDocument()?"found":"absent";
    }catch{if(current())original.check="unavailable";}
    finally{if(current()){if(original.check==="checking")original.check=undefined;this.requestUpdate();}}
  }
  async #openOriginalImport(event:Event,owner=this.#importOwner){
    const original=owner?.original,document=this.#originalImportedDocument(owner),trigger=event.currentTarget;
    if(!(trigger instanceof HTMLElement)||trigger!==this.querySelector(".library-import-open-original")||!owner?.current()
      ||!original||original.check!=="found"||!document||this.#newerImportSelected(owner))return;
    const selection=this.#importRequest,continuation=this.#captureLibraryContinuation();
    const current=()=>continuation.current()&&this.#importRequest===selection&&this.#importOwner===owner&&owner.current()&&owner.original===original
      &&original.check==="found"&&!this.#newerImportSelected(owner)&&this.#originalImportedDocument(owner)?.id===document.id;
    const dialog=trigger.closest<HTMLDialogElement>("dialog.library-import-dialog");
    const context:NavigationPresentationContext|undefined=dialog&&dialog===this.querySelector(".library-import-dialog")
      &&dialog.closest("forma-library")===this?{presentation:{owner:this,element:dialog,trigger,
        current:()=>current()&&dialog===this.querySelector(".library-import-dialog")}}:undefined;
    try{
      if(current())await navigateInApp(this,navigation=>{
        let handedOff=false;
        return this.store.transitionWorkspace(withDocumentInRoute("/",document.id,document.title),{
          ...navigation,documentId:document.id,documentFocus:false,
          current:()=>navigation.current()&&(handedOff||current()),
          onOriginHandoff:()=>{
            if(!current()||!navigation.onOriginHandoff())return false;
            handedOff=true;return true;
          },
        });
      },context);
    }finally{continuation.dispose();}
  }
  #importRecovery(owner=this.#importOwner){
    const original=owner?.current()?owner.original:undefined;
    if(!owner||!original)return nothing;
    const newer=this.#newerImportSelected(owner),available=original.check==="found"&&Boolean(this.#originalImportedDocument(owner));
    const status=original.state==="pending"?"library.archive.originalPending"
      :original.check==="checking"?"library.archive.checkingOriginal"
      :original.check==="found"?available?"library.archive.originalAvailable":"library.archive.originalAbsent"
      :original.check==="absent"?"library.archive.originalAbsent"
      :original.check==="unavailable"?"library.archive.checkUnavailable":"library.archive.unconfirmed";
    const title=`\u2068${original.title}\u2069`;
    return html`<aside class="library-import-recovery" aria-labelledby="library-import-original-title"><p id="library-import-original-title"><strong>${this.i18n.t("library.archive.original","",{title})}</strong></p>
      <p role="status">${this.i18n.t(status)}</p>
      <p class="library-import-recovery-lifetime">${this.i18n.t("library.archive.recoveryLifetime")}</p>
      ${newer?html`<p>${this.i18n.t("library.archive.newerPreview")}</p>`:nothing}
      <div class="family-actions">
        ${original.state==="unconfirmed"?html`
          <button type="button" class="button secondary library-import-check-original" ?disabled=${original.check==="checking"}
            aria-busy=${String(original.check==="checking")} @click=${(event:Event)=>this.#checkOriginalImport(event,owner)}>${this.i18n.t("library.archive.checkOriginal","",{title})}</button>
          ${available?html`<button type="button" class="button primary library-import-open-original" ?disabled=${newer}
            @click=${(event:Event)=>this.#openOriginalImport(event,owner)}>${this.i18n.t("library.archive.openOriginal","",{title})}</button>`:nothing}`:nothing}
        ${newer?html`<button type="button" class="button ghost library-import-discard-newer" @click=${()=>owner.dismiss()}>${this.i18n.t("library.archive.discardNewer")}</button>`:nothing}
      </div></aside>`;
  }
  #blockName(block:CreativeBlock){const named=String(block.properties.label??"").trim();if(named)return named;const authored=String(block.properties.text??"").normalize("NFC").trim();if(authored&&/(?:^|\/)(?:document|decision)-[a-f\d]{8}(?:-copy)?$/i.test(block.handle))return authored;const slug=String(block.handle.split("/").at(-1)??block.handle).replace(/-canvas-[a-f\d]{6,}$/i,"").replace(/-(?:copy|import)(?:-\d+)?$/i,"").replace(/[-_]+/g," ").trim();return slug?`${slug.charAt(0).toLocaleUpperCase()}${slug.slice(1)}`:"Untitled decision";}
  #blockSearchText(block:CreativeBlock){
    const projection=this.store.projection.get(),blocks=new Map(projection.libraryBlocks.map((item)=>[item.id,item])),visited=new Set<string>(),pending=[block.id],values:string[]=[];
    while(pending.length){const id=pending.pop()!;if(visited.has(id))continue;visited.add(id);const item=blocks.get(id);if(!item)continue;values.push(item.handle,String(item.properties.label??""),String(item.properties.text??""),String(item.properties.character_trait_value??""));for(const relation of projection.libraryBlockRelations)if(isContextCompositionRelation(relation.kind)&&relation.fromBlockId===id)pending.push(relation.toBlockId);}
    return values.join(" ").toLocaleLowerCase(this.i18n.locale);
  }
  #outputName(output:CreativeOutput){const projection=this.store.projection.get(),document=projection.documents.find((item)=>item.id===output.documentId),content=this.store.content.get();const candidate=imageOutputNamingCandidate(output,content,document?.title??"Project document"),peers=projection.libraryOutputs.filter((item)=>item.documentId===output.documentId).map((item)=>imageOutputNamingCandidate(item,content,document?.title??"Project document"));const presentation=describeOutput(candidate,peers,{events:this.store.events.get(),locale:this.i18n.locale,timeZone:this.i18n.timeZone,formatTake:(take)=>this.i18n.t("output.take","Take {number}",{number:this.i18n.number(take)})});const technique=output.promptFanId?` · ${promptTechniqueDefinition(output.promptTechnique).shortLabel}`:"";return `${presentation.disambiguator?`${presentation.disambiguator} — `:""}${presentation.title}${technique}`;}
  #outputSearchText(output:CreativeOutput){
    const projection=this.store.projection.get();const document=projection.documents.find((item)=>item.id===output.documentId);const source=this.store.events.get().find((event)=>event.eventId===output.sourceEventId);const compiled=this.store.events.get().findLast((event)=>event.type==="ContextCompiled"&&event.payload.generation_id===output.generationId);const snapshot=compiled?.payload.compiled_snapshot as Record<string,unknown>|undefined;const brief=source?.payload.output_brief as Record<string,unknown>|undefined;const technique=promptTechniqueDefinition(output.promptTechnique);
    const facts=records(snapshot?.facts).flatMap((fact)=>{const properties=fact.properties as Record<string,unknown>|undefined;return[fact.type,fact.handle,properties?.text,properties?.label,properties?.description,Array.isArray(properties?.colors)?properties.colors.join(" "):""];});
    const relatedBlocks=this.#outputBlocks(output,projection.libraryBlocks).flatMap((block)=>[this.#blockName(block),block.type,block.properties.text,block.properties.label]);
    return[this.#outputName(output),document?.title,document?.handle,outputQualityLabel(output),output.quality,output.purpose,technique.label,technique.shortLabel,output.modelId,output.plannerModelId,output.provider,source?.payload.title,source?.payload.summary,source?.payload.rationale,brief?.title,brief?.purpose,brief?.audience,brief?.content_direction,...facts,...relatedBlocks].filter((value):value is string=>typeof value==="string"&&Boolean(value.trim())).join(" ").toLocaleLowerCase();
  }
  #blockOutputs(block:CreativeBlock,outputs:CreativeOutput[]){const generationIds=new Set(this.store.events.get().filter((event)=>event.type==="ContextCompiled"&&(records(event.payload.source_block_versions).some((item)=>item.block_id===block.id)||records((event.payload.compiled_snapshot as Record<string,unknown>|undefined)?.facts).some((item)=>item.handle===block.handle))).map((event)=>String(event.payload.generation_id)));return outputs.filter((output)=>generationIds.has(output.generationId));}
  #outputBlocks(output:CreativeOutput,blocks:CreativeBlock[]){const compiled=this.store.events.get().findLast((event)=>event.type==="ContextCompiled"&&event.payload.generation_id===output.generationId);const ids=new Set(records(compiled?.payload.source_block_versions).map((item)=>String(item.block_id)));return blocks.filter((block)=>ids.has(block.id));}
  #art(output:CreativeOutput|undefined,index=0){return html`<div class="output-art" data-placeholder-index=${index}><forma-output-visual .output=${output} .compact=${true}></forma-output-visual></div>`;}
  #blockVisual(block:CreativeBlock,large=false){
    if(block.type==="reference"&&isImageReference(block.properties)&&block.properties.media_url)return html`<forma-reference-image .src=${String(block.properties.media_url)} .alt=${String(block.properties.label??block.handle)} .compact=${!large} .targetId=${block.id} .referenceId=${String(block.properties.reference_id??"")} .focalPoint=${block.properties.focal_point}></forma-reference-image>`;
    if(block.type==="palette"&&Array.isArray(block.properties.colors))return html`<div class="asset-preview palette ${large?"large":""}">${(block.properties.colors as string[]).map((color)=>html`<i style=${`background:${color}`}></i>`)}</div>`;
    const medium=block.type==="reference"?referenceMedium(block.properties):"unknown";
    const glyph=medium==="audio"?"audio":medium==="video"?"video":medium==="text"||medium==="document"?"document":blockIconName(block.type);
    return html`<div class="asset-preview ${block.type} ${large?"large":""}" data-reference-medium=${medium}><span>${icon(glyph)}</span><blockquote>${String(block.properties.text??block.properties.artifact_markdown??block.properties.source_excerpt??block.properties.description??block.properties.label??"Reusable context primitive")}</blockquote></div>`;
  }

  // A positive original result does not authorize consuming a newer native form.
  #capturePublisherCompletion(form:HTMLFormElement,data:FormData){
    this.#cancelPublisherCompletion?.();
    const store=this.store,route=store.route.get().split("#")[0],projection=store.projection.get();
    const projectId=projection.projectId,documentId=projection.documentId;
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const original=[...data.entries()];
    let retired=false;
    const scopeCurrent=()=>this.isConnected&&this.store===store&&form.isConnected&&this.contains(form)
      &&store.route.get().split("#")[0]===route&&store.projection.get().projectId===projectId
      &&store.projection.get().documentId===documentId&&this.#canAuthor()
      &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization);
    const dispose=()=>{
      retired=true;unsubscribe();
      if(this.#cancelPublisherCompletion===dispose)this.#cancelPublisherCompletion=null;
    };
    const current=()=>!retired&&this.#cancelPublisherCompletion===dispose&&scopeCurrent();
    const unsubscribe=store.subscribe(()=>{if(!current())dispose();});
    this.#cancelPublisherCompletion=dispose;
    if(!current()){dispose();return null;}
    return{dispose,unchanged:()=>{
      if(!current())return false;
      const fields=[...new FormData(form).entries()];
      return original.length===fields.length&&original.every(([name,value],index)=>
        fields[index][0]===name&&fields[index][1]===value);
    }};
  }

  #renderLibrary(){
    const importOwner=this.#importOwner,imported=importOwner?.current()?this.#imported:undefined;
    const next=this.#nextContext(),nextActions=next?creativeNextActions(next.facts):[];
    const requestedView=String(this.store.ui.libraryView);if(["all","blocks","outputs","families"].includes(requestedView)&&requestedView!==this.#view)this.#view=requestedView as LibraryView;
    const currentRoute=this.store.route.get();
    const libraryFocusRoute=(kind:LibraryFocusKind,id:string,label="")=>buildLibraryFocusRoute(kind,id,label,currentRoute);
    const canAuthor=this.#canAuthor();const context=this.store.session.get()?.projectContext;
    const organizationPackages=context?this.store.organizationContextPackages.get():[];
    const organizationBindings=context?this.store.organizationContextBindings.get().filter((binding)=>binding.projectAccessId===context.projectAccessId):[];
    const organizationVersions=context?this.store.organizationContextVersions.get():{};
    const assignedReviews=context?scopedFormaActivity(this.store.session.get(),this.store.projection.get(),[],this.store.reviewInbox.get(),[]).reviews:[];
    // Suppress only the redundant promotion, never the complete assigned list.
    // This is a current-render identity comparison, not another action policy.
    const firstReview=assignedReviews[0],firstReviewPromoted=Boolean(firstReview&&nextActions.some(({target})=>
      target.kind==="assigned-review"&&target.reviewId===firstReview.id
      &&target.projectId===firstReview.projectId&&target.documentId===firstReview.documentId
      &&target.organizationId===firstReview.organizationId&&target.projectAccessId===firstReview.projectAccessId
      &&target.artifactId===firstReview.artifactId&&target.revision===firstReview.revision
      &&target.contentSha256===firstReview.contentSha256));
    const packagePublisher=Boolean(context&&this.store.session.get()?.organizations?.some((organization)=>organization.organizationId===context.organizationId&&["owner","administrator"].includes(organization.role)));
    const projection=this.store.projection.get();const events=this.store.events.get();const editor=libraryBlockEditorFromRoute(currentRoute);if(editor){const selected=editor.blockId??"__new__";if(!this.#editorTargets.has(selected))this.#editorTargets.set(selected,undefined);return html`<section class="library-page"><forma-project-rail surface="library"></forma-project-rail><div class="library-main" @library-use-copy=${(event:CustomEvent<{blockId:string}>)=>{const block=this.store.projection.get().libraryBlocks.find((item)=>item.id===event.detail.blockId);if(block)void this.#useCopy(block);}}>${repeat([...this.#editorTargets.keys()].filter((id)=>id===selected||id==="__new__"||projection.libraryBlocks.some((block)=>block.id===id)),(id)=>id,(id)=>html`${cache(id===selected?html`<forma-library-block-editor .blockId=${id==="__new__"?null:id}></forma-library-block-editor>`:nothing)}`)}</div></section>`;}const query=this.#query.toLowerCase();const selectedCollection=projection.collections.find((collection)=>collection.id===this.store.ui.focusCollectionId);const collectionItemIds=selectedCollection?new Set(Object.entries(projection.membership).filter(([,membership])=>membership.collectionId===selectedCollection.id).map(([id])=>id)):null;
    const publisherNames=qualifyDisplayCollisions([
      {key:"new:"+projection.documentId,label:this.i18n.system("Publish decisions from the current document")+" · "+projection.documentTitle},
      ...organizationPackages.filter(item=>item.versionId).map(item=>({key:"package:"+item.id,label:item.name})),
    ],number=>this.i18n.number(number),value=>encodeURIComponent(value));
    const discardName=(key:string)=>this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{
      action:this.i18n.t("output.requirement.discard"),name:this.#namedValue(publisherNames.get(key)!.label).name,
    });
    const documents=projection.documents.filter((document)=>(!collectionItemIds||collectionItemIds.has(document.id))&&(!query||document.title.toLowerCase().includes(query)||document.handle.toLowerCase().includes(query)));
    const blocks=projection.libraryBlocks.filter((block)=>(!collectionItemIds||collectionItemIds.has(block.id)||collectionItemIds.has(block.documentId))&&(!query||this.#blockSearchText(block).includes(query)));
    const allOutputs=projection.libraryOutputs.filter((output)=>(!collectionItemIds||collectionItemIds.has(output.id)||collectionItemIds.has(output.documentId))&&(!query||this.#outputSearchText(output).includes(query)));const outputItems:GenerationHistoryItem[]=this.#outputScope==="kept"?allOutputs.filter((output)=>output.library&&output.standalone).map((output)=>({kind:"output",id:output.id,documentId:output.documentId,output,sequence:output.standaloneSequence??output.sequence})):generationHistoryItems(allOutputs);const recentOutputItems=generationHistoryItems(allOutputs);const allArtifacts=projection.libraryArtifacts.filter((artifact)=>(!collectionItemIds||collectionItemIds.has(artifact.id)||collectionItemIds.has(artifact.documentId))&&(!query||`${artifact.title} ${artifact.summary} ${documentArtifactDefinition(artifact.kind).label}`.toLocaleLowerCase().includes(query)));const artifactItems=this.#outputScope==="kept"?allArtifacts.filter((artifact)=>artifact.library):allArtifacts;const keptCount=allOutputs.filter((output)=>output.library&&output.standalone).length+allArtifacts.filter((artifact)=>artifact.library).length;
    // A four-image fan remains one result until a creator explicitly promotes one of its members.
    const status=phase7IndexStatus(events,this.store.content.get());const families=projection.families.filter((family)=>!family.superseded&&(!query||String(family.label??family.family_id).toLowerCase().includes(query)));const corpus=retrieveFewShotExemplars(events,this.#corpusQuery,this.store.content.get(),{limit:4,projectId:projection.projectId,collectionId:this.#collectionFilter||undefined});const promoted=new Set(projection.collections.map((collection)=>collection.sourceClaimRef));
    const focus=libraryFocusFromRoute(this.store.route.get());if(focus)this.#view=focus.kind==="block"?"blocks":focus.kind==="family"?"families":"outputs";const focusedBlock=focus?.kind==="block"?projection.libraryBlocks.find((block)=>block.id===focus.id):undefined;const focusedOutput=focus?.kind==="output"?projection.libraryOutputs.find((output)=>output.id===focus.id):undefined;const focusedFamily=focus?.kind==="family"?projection.families.find((family)=>!family.superseded&&String(family.family_id)===focus.id):undefined;
    const creativeResults:Array<{kind:"history";item:GenerationHistoryItem;sequence:number}|{kind:"artifact";artifact:DocumentArtifact;sequence:number}>=[...outputItems.map((item)=>({kind:"history" as const,item,sequence:item.sequence})),...artifactItems.map((artifact)=>({kind:"artifact" as const,artifact,sequence:artifact.sequence}))].sort((left,right)=>right.sequence-left.sequence);
    const renderCreativeResult=(entry:typeof creativeResults[number])=>{
      if(entry.kind==="artifact"){
        const artifact=entry.artifact;const definition=documentArtifactDefinition(artifact.kind),href=libraryFocusRoute("artifact",artifact.id,artifact.title),document=projection.documents.find((item)=>item.id===artifact.documentId),created=events.find((event)=>event.eventId===artifact.sourceEventId)?.occurredAt,adopted=projection.libraryBlocks.some((block)=>block.documentId===projection.documentId&&block.properties.source_artifact_id===artifact.id&&!block.properties.source_artifact_item_id);
        const presentation=describeOutput(artifact,projection.libraryArtifacts,{events,locale:this.i18n.locale,timeZone:this.i18n.timeZone,formatTake:(take)=>this.i18n.t("output.take","Take {number}",{number:this.i18n.number(take)})});
        const name=presentation.disambiguator?`${presentation.disambiguator} — ${presentation.title}`:presentation.title;
        return html`<article class="library-output library-artifact-output" data-forma-content="primary"><a href=${href} class="library-artifact-open" aria-label=${this.i18n.t("projects.openPreviewNamed","Open focused preview of {name}",this.#namedValue(name))} @click=${(event:MouseEvent)=>this.#navigate(event,"artifact",artifact.id,artifact.title)}><forma-artifact-summary .artifact=${artifact}></forma-artifact-summary><div><span>${this.i18n.system(definition.label)}</span><h3 dir="auto">${name}</h3><p>${artifact.summary}</p><small>${document?.title??this.i18n.system("Project document")}${created?` · ${new Intl.DateTimeFormat(this.i18n.locale,{dateStyle:"medium"}).format(new Date(created))}`:""}</small></div></a>${canAuthor?html`<forma-ui-cluster class="library-output-actions" alignment="stretch"><button type="button" class="button secondary compact" aria-label=${this.#inputAction(adopted,artifact.title)} @click=${(event:MouseEvent)=>this.#useArtifactInput(artifact,event)}>${this.#inputLabel(adopted)}</button><button type="button" class="button ghost compact" aria-label=${this.#libraryAction(artifact.library,name)} aria-pressed=${artifact.library} @click=${()=>this.#toggleLibrary(artifact)}>${artifact.library?this.i18n.t("projects.removeKept","Remove from kept"):this.i18n.t("projects.keepReuse","Keep for reuse")}</button></forma-ui-cluster>`:nothing}</article>`;
      }
      const item=entry.item;
      if(item.kind==="fan")return html`<article class="library-output library-prompt-fan" data-forma-content="primary"><forma-prompt-fan-visual .outputs=${item.outputs}></forma-prompt-fan-visual><div class="library-prompt-fan-copy"><span class="output-quality ${item.purpose==="ideate"?"draft":"full"}">${item.purpose==="ideate"?this.i18n.system("Draft fan"):this.i18n.system("Full-quality fan")}</span><h3>One generation · four prompt processes</h3><p>${item.complete} of 4 ready · ${item.standaloneCount} promoted to stand alone</p></div><forma-prompt-fan-review .fanId=${item.id}></forma-prompt-fan-review></article>`;
      const output=item.output;const href=libraryFocusRoute("output",output.id),name=this.#outputName(output);
      return html`<article class="library-output" data-forma-content="primary"><forma-output-card .output=${output}></forma-output-card><forma-ui-cluster class="library-output-actions" alignment="stretch"><a href=${href} class="button secondary compact" aria-label=${this.i18n.t("projects.openPreviewNamed","Open focused preview of {name}",{name:`\u2068${name}\u2069`})} @click=${(event:MouseEvent)=>this.#navigate(event,"output",output.id)}>${this.i18n.t("projects.openPreview","Open focused preview")}</a>${canAuthor?html`<button type="button" class="button ghost compact" aria-label=${this.#libraryAction(output.library,name)} aria-pressed=${output.library} @click=${()=>this.#toggleLibrary(output)}>${output.library?this.i18n.t("projects.removeKept","Remove from kept"):this.i18n.t("projects.keepReuse","Keep for reuse")}</button>`:nothing}</forma-ui-cluster></article>`;
    };
    const resultsSection=this.#view==="all"||this.#view==="outputs"?html`<section><div class="section-heading"><div><span class="eyebrow">All creative results</span><h2>${this.#outputScope==="kept"?this.i18n.t("projects.keptOutputs","Kept outputs"):this.i18n.t("projects.recentOutputs","Recent outputs")}</h2><p class="section-note">${this.i18n.system("Images, stories, presentations & motion")} · ${this.i18n.t("artifact.audio.label","Audio")}</p></div><forma-ui-segmented-control class="compact-segmented" .label=${this.i18n.t("projects.outputHistory","Output history")} .value=${this.#outputScope} .options=${[{value:"recent",label:`${this.i18n.t("projects.recent","Recent")} ${recentOutputItems.length+allArtifacts.length}`},{value:"kept",label:`${this.i18n.t("projects.kept","Kept")} ${keptCount}`}]} @forma-change=${(event:CustomEvent<{value:string}>)=>{const value=event.detail.value;if(value==="recent"||value==="kept")this.#setOutputScope(value);}}></forma-ui-segmented-control></div><div class="library-output-grid">${creativeResults.map(renderCreativeResult)}</div>${!creativeResults.length?html`<div class="family-empty" data-forma-empty-state><span>${icon("image")}</span><h3>No ${this.#outputScope} outputs match</h3><p>${this.#outputScope==="kept"?this.i18n.system("Keep an image, story, scene, presentation, storyboard, or video to find it here."):this.i18n.system("Create an image, story, scene, presentation, storyboard, or video to build your project collection.")}</p></div>`:nothing}</section>`:nothing;
    return html`<section class="library-page"><forma-project-rail surface="library"></forma-project-rail><div class="library-main"><header class="page-header page-header--library"><div class="page-header-copy"><span class="eyebrow" dir="auto">${projection.projectName} / ${this.i18n.t("shell.navigation.library","Library")}</span><h1 tabindex="-1">${this.i18n.t("projects.libraryHeading","Project library")}</h1><p>${this.i18n.t("projects.libraryDescription","Find every reusable idea, finished image, story, scene, presentation, storyboard, and video in this project.")}</p></div>${canAuthor?html`<div class="page-header-actions"><button type="button" class="button primary" data-context-controls-id="__new__" @click=${()=>this.#openEditor()}>${icon("plus")} ${this.i18n.t("projects.newReusableBlock","New reusable block")}</button>${!context?html`<form @submit=${(event:SubmitEvent)=>event.preventDefault()}><label class="button secondary file-button">${icon("download")} ${this.i18n.t("projects.importDocument","Import as document")}<input type="file" accept="application/json" @change=${this.#import}></label></form><button class="button secondary" @click=${async()=>{const authorization=this.store.captureAuthorizationScope();if(!authorization)return;const receipt={type:"ObjectExported",payload:{object_id:projection.documentId||projection.projectId,project_id:projection.projectId,destination_class:"download",format:"application/json",source_surface:"project-library-archive"}};if(!await this.store.authorizeProjectExport(receipt,authorization)||!this.store.authorizationScopeActive(authorization))return;downloadJson(`forma-${projection.projectName.normalize("NFC").toLocaleLowerCase(this.i18n.locale).replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/g,"")||"project"}.json`,exportProjectArchive(events,projection.projectId));}}>${icon("share")} ${this.i18n.t("projects.exportProject","Export this project")}</button>`:nothing}</div>`:nothing}</header><div class="library-body">
      ${!imported?this.#importRecovery(importOwner):nothing}
      <form class="library-toolbar" @submit=${(event:SubmitEvent)=>{event.preventDefault();this.requestUpdate();}}><forma-ui-search class="searchbox" .label=${this.i18n.t("projects.searchLibrary","Search project library")} .placeholder=${this.i18n.t("projects.searchAllWork","Search all project work")} .value=${this.#query} @forma-input=${(event:CustomEvent<{value:string}>)=>{this.#query=event.detail.value;this.requestUpdate();}}></forma-ui-search><forma-ui-segmented-control class="segmented" .label=${this.i18n.t("projects.libraryContent","Library content")} .value=${this.#view} .options=${[["all",this.i18n.t("projects.filter.all","All")],["blocks",this.i18n.t("projects.filter.blocks","Blocks")],["outputs",this.i18n.t("projects.filter.outputs","Outputs")],["families",this.i18n.t("projects.filter.families","Families")]].map(([value,label])=>({value,label}))} @forma-change=${(event:CustomEvent<{value:string}>)=>this.#setView(event.detail.value as LibraryView)}></forma-ui-segmented-control></form>
      ${selectedCollection?html`<div class="collection-filter"><span>${icon("folder")}</span><div><b>Showing ${selectedCollection.handle}</b><small>${documents.length} filed document${documents.length===1?"":"s"}; related blocks and outputs inherit this filter.</small></div><button @click=${()=>this.store.patchUi({focusCollectionId:""})}>Clear filter</button></div>`:nothing}
      ${next?renderLifecycleNextActionCards(nextActions,this.i18n,action=>void this.#followLifecycleAction(action),{projectName:next.projectName,documentTitle:next.document.title,scopeUnknown:next.facts.lifecycle?.output.scopeKnown!==true,creatorHandoff:libraryBaseRoute(currentRoute)==="/canvas/library"}):nothing}
      ${assignedReviews.length&&!firstReviewPromoted?html`<aside class="library-review-priority" role="status"><b>${this.i18n.t("activity.needsYou","Needs you")} · ${this.i18n.number(assignedReviews.length)}</b><button type="button" class="button secondary compact" @click=${()=>void navigateInApp(this,navigation=>navigation.openAssignedReview(assignedReviews[0]!))}>${this.i18n.t("activity.openReview","Open assigned review")}</button></aside>`:nothing}
      ${this.#artifactOpenIssue?html`<div class="library-review-priority"><p role="alert">${this.i18n.t("artifact.delivery.exactChanged","This exact output revision is no longer available. No review or export was performed.")}</p><a class="button secondary" href=${buildLibraryFocusRoute("artifact",this.#artifactOpenIssue,"",this.store.route.get())} @click=${(event:MouseEvent)=>this.#navigate(event,"artifact",this.#artifactOpenIssue)}>${this.i18n.t("artifact.delivery.openCurrent","Open current output")}</a></div>`:nothing}<div class="library-content">
        ${this.#view==="all"&&creativeResults.length?resultsSection:nothing}
        ${this.#view==="all"||this.#view==="blocks"?html`<section><div class="section-heading"><div><span class="eyebrow">Portable context</span><h2>${this.i18n.t("projects.reusableBlocks","Reusable blocks")}</h2><p class="section-note">${canAuthor?this.i18n.system("Independent project blocks can be edited here. Document-owned blocks can be forked before reuse."):this.i18n.t("projects.readOnlyLibrary","You can inspect shared project decisions and creative results.")}</p></div>${canAuthor?html`<button class="button secondary compact" @click=${()=>this.#openEditor()}>${this.i18n.t("projects.openBlockEditor","Open Block editor")}</button>`:nothing}</div><div class="asset-grid">${blocks.map((block)=>{const influenced=this.#blockOutputs(block,projection.libraryOutputs);const related=this.#relatedReferenceCount(block.id);const name=this.#blockName(block);const href=libraryFocusRoute("block",block.id,name);return html`<article class="asset-card"><a href=${href} class="asset-focus-trigger" aria-label=${this.i18n.t("projects.openPreviewNamed","Open focused preview of {name}",{name:`\u2068${name}\u2069`})} @click=${(event:MouseEvent)=>this.#navigate(event,"block",block.id,name)}>${this.#blockVisual(block)}<span>Focused preview · ${influenced.length} linked result${influenced.length===1?"":"s"}</span></a><span class="block-type">${this.i18n.system(blockTypeDefinition(block.type)?.label??block.type)} · ${block.scope==="library"?this.i18n.system("project decision"):this.i18n.system("document decision")}</span><span class="context-library-state">${this.i18n.system(BLOCK_INTENTS.find((item)=>item.id===blockIntentFor(block.type,block.properties))?.label??blockIntentFor(block.type,block.properties))} · ${this.i18n.t(block.locked?"context.controls.locked":"context.controls.unlocked",block.locked?"Locked":"Unlocked")}</span><h3 dir="auto">${name}</h3><p dir="auto">${String(block.properties.artifact_markdown??block.properties.text??block.properties.source_excerpt??block.properties.description??block.properties.label??"Reusable creative decision")}</p><div><span class="asset-card-receipts"><small class=${`authority ${String(block.properties.authority??"authored")}`}>${String(block.properties.authority??"authored")}</small>${related?html`<small>${related} related image${related===1?"":"s"}</small>`:nothing}</span>${canAuthor&&!block.properties.organization_context_package_binding_id?html`<span class="asset-card-actions"><button type="button" data-context-controls-id=${block.id} @click=${()=>this.#openEditor(block.id)} aria-label=${contextControlName(candidate=>this.i18n.t("context.controls.named","Controls for {name}",this.#namedValue(this.#blockName(candidate))),block,projection.libraryBlocks,this.i18n)}>${this.i18n.t("context.controls.named","Controls for {name}",this.#namedValue(name))}</button></span>`:block.properties.organization_context_package_binding_id?html`<span class="asset-card-actions">${this.i18n.system("Organization context")}</span>`:nothing}</div></article>`;})}</div></section>`:nothing}
        ${this.#view==="all"&&creativeResults.length?nothing:resultsSection}
        ${this.#view==="all"||this.#view==="families"?html`<section><div class="section-heading"><div><span class="eyebrow">Similar work, grouped for you</span><h2>${this.i18n.t("projects.visualFamilies","Aesthetic families")}</h2></div><span>${families.length}</span></div>${families.length?families.map((family)=>{const familyId=String(family.family_id);const familyLabel=String(family.label??"Related creative work");const familyHref=libraryFocusRoute("family",familyId,familyLabel);const members=records(family.members);const sourceRef=`family:${family.family_id}`;const familyOutputs=members.map((member)=>projection.libraryOutputs.find((item)=>item.id===String(member.object_id))).filter((item):item is CreativeOutput=>Boolean(item));return html`<article class="family-card"><a href=${familyHref} class="family-collage" aria-label=${this.i18n.t("projects.openFamilyNamed","Open all work in {name}",this.#namedValue(familyLabel))} @click=${(event:MouseEvent)=>this.#navigate(event,"family",familyId,familyLabel)}>${[0,1,2].map((tile)=>html`<i>${familyOutputs[tile]?html`<forma-output-visual .output=${familyOutputs[tile]} .compact=${true}></forma-output-visual>`:nothing}</i>`)}<span>Open family lightbox · ${members.length} image${members.length===1?"":"s"}</span></a><div><span class="authority inferred">Suggested · ${Math.round(Number(family.confidence??0)*100)}% match</span><h3 dir="auto">${familyLabel}</h3><p>${members.length} related image${members.length===1?"":"s"}.${canAuthor?" " + this.i18n.system("You can remove a suggestion or keep the whole group as a collection."):""}</p><div class="family-members">${members.map((member)=>{const output=projection.libraryOutputs.find((item)=>item.id===String(member.object_id));const outputHref=output?libraryFocusRoute("output",output.id):"";return output?html`<a href=${outputHref} title="Open this family member" @click=${(event:MouseEvent)=>this.#navigate(event,"output",output.id)}>${this.#outputName(output)} <small>${Math.round(Number(member.confidence??0)*100)}% match</small></a>`:html`<span aria-disabled="true" title="This image is no longer available">Image unavailable <small>${Math.round(Number(member.confidence??0)*100)}% match</small></span>`;})}</div><div class="family-actions">${canAuthor?html`<button class="button primary" ?disabled=${promoted.has(sourceRef)} @click=${()=>this.#promote(family)}>${promoted.has(sourceRef)?this.i18n.system("Kept as collection"):this.i18n.system("Keep as collection")}</button>`:nothing}<a href=${familyHref} class="button secondary" @click=${(event:MouseEvent)=>this.#navigate(event,"family",familyId,familyLabel)}>${this.i18n.t("projects.openLightbox","Open lightbox")}</a>${canAuthor&&!context?html`<button class="button ghost" ?disabled=${!members.length} @click=${()=>this.#correct(family)}>${this.i18n.t("projects.correctGrouping","Correct grouping")}</button>`:nothing}</div></div></article>`;}):html`<div class="family-empty"><span>${icon("branch")}</span><h3>No visual families yet</h3><p>Related work appears here after you create at least two images. Nothing is filed or changed automatically.</p></div>`}
          <div class="corpus-lab"><div><span class="eyebrow">Learn from what already worked</span><h3>Find a useful precedent</h3><p>Search accepted creative decisions, corrections, and saved results. Relevant matches can inform new work without changing anything.</p></div><form class="corpus-filters" @submit=${(event:SubmitEvent)=>{event.preventDefault();this.requestUpdate();}}><label>Search your work<div class="searchbox">${icon("search")}<input .value=${this.#corpusQuery} @input=${(event:InputEvent)=>{this.#corpusQuery=(event.target as HTMLInputElement).value;this.requestUpdate();}}></div></label><label>Collection<select .value=${this.#collectionFilter} @change=${(event:Event)=>{this.#collectionFilter=(event.target as HTMLSelectElement).value;this.requestUpdate();}}><option value="">All collections</option>${projection.collections.map((collection)=>html`<option value=${collection.id}>${collection.handle}</option>`)}</select></label></form><div class="corpus-results">${corpus.length?corpus.map((item)=>html`<article><span>${item.kind.replaceAll("-"," ")}</span><b>${item.label}</b><p>${item.summary}</p><small>${Math.round(item.score*100)}% related · ${item.citations.length} supporting decision${item.citations.length===1?"":"s"}</small></article>`):html`<p class="corpus-empty">No previous decisions match this search and collection.</p>`}</div></div>
        </section>`:nothing}
      </div>
      ${assignedReviews.length?html`<section class="library-assigned-reviews" aria-labelledby="library-assigned-reviews-heading"><div class="section-heading"><div><span class="eyebrow">Independent approval</span><h2 id="library-assigned-reviews-heading">Needs my review</h2></div><span>${assignedReviews.length}</span></div><ul class="workspace-settings-list">${assignedReviews.map((task)=>html`<li><div><b dir="auto">${task.artifactTitle||this.i18n.system("Finished output")} · revision ${task.revision}</b><span dir="auto">${[task.projectName,task.documentTitle].filter(Boolean).join(" · ")}</span><span>Requested by ${task.requestedByName}${task.dueAt?" " + this.i18n.system("· due {value}", { value: this.i18n.date(new Date(task.dueAt),{dateStyle:"medium",timeStyle:"short"}) }):""}</span></div><button type="button" class="button secondary compact" @click=${()=>void navigateInApp(this,navigation=>navigation.openAssignedReview(task))}>Open assigned output</button></li>`)}</ul></section>`:nothing}
      ${context?html`<section class="library-organization-context" aria-labelledby="library-organization-context-heading">
        <div class="section-heading"><div><span class="eyebrow">${this.i18n.system("Shared across this organization")}</span><h2 id="library-organization-context-heading">${this.i18n.system("Organization context")}</h2><p>${this.i18n.system("Published package versions are immutable, tenant-owned, and applied only after you explicitly choose a document.")}</p></div><span>${this.i18n.number(organizationPackages.filter((item)=>item.versionId).length)}</span></div>
        ${repeat(organizationPackages.filter((item)=>item.pendingDraftVersionId),(item)=>JSON.stringify([item.id,item.pendingDraftVersionId]),(item)=>localizeTemplateResult(html`<article class="library-organization-context-card library-context-pending-review"><span class="eyebrow">${this.i18n.t("workspace.context.awaiting")}</span><h3 dir="auto">${item.name}</h3><details><summary>${this.i18n.t("workspace.context.review")}</summary><ul class="workspace-settings-list">${(item.draftPreview??[]).map((decision)=>html`<li><div><b dir="auto">${decision.handle}</b><small>${this.i18n.t(`workspace.context.intent.${decision.intent}`)} · ${this.i18n.t(decision.active?"workspace.context.active":"workspace.context.inactive")}${decision.locked?` · ${this.i18n.system("Locked")}`:""}</small>${decision.text?html`<pre dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${decision.text}</pre>`:nothing}${decision.exactText?html`<small>${this.i18n.t("workspace.context.exact")}</small><pre dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${decision.exactText}</pre>`:nothing}${decision.exactPlacements.length?html`<small>${this.i18n.t("workspace.context.placements")}: ${decision.exactPlacements.map((placement)=>this.i18n.t(`workspace.context.placement.${placement}`,placement)).join(", ")}</small>`:nothing}${decision.protectedPhrases.map((phrase)=>html`<small>${this.i18n.t("workspace.context.exact")}${phrase.placement?` · ${this.i18n.t(`workspace.context.placement.${phrase.placement}`,phrase.placement)}`:""}</small><pre dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${phrase.text}</pre>`)}${decision.relations.map((relation)=>html`<small>${this.i18n.t("workspace.context.relationship")}: ${this.i18n.t(`workspace.context.relation.${relation.kind}`,relation.kind)} → ${relation.targetHandle}</small>`)}${decision.sourceName?html`<small dir="auto">${decision.sourceName}${decision.rightsExpiresAt?` · ${decision.rightsExpiresAt}`:""}</small>`:nothing}</div></li>`)}</ul>${item.canApprove?html`<form @submit=${(event:SubmitEvent)=>{event.preventDefault();void this.store.approveOrganizationContextPackage(item.id,item.pendingDraftVersionId!);}}><label><input type="checkbox" required> ${this.i18n.system("I reviewed these decisions, sources, and changes to finished outputs.")}</label><button type="submit" class="button primary compact">${this.i18n.t("workspace.context.approve")}</button></form>`:nothing}</details></article>`,this.i18n))}
        ${organizationPackages.some((item)=>item.versionId)?html`<div class="library-organization-context-grid">${repeat(organizationPackages.filter((item)=>item.versionId),(item)=>item.id,(item)=>{
          const binding=organizationBindings.find((candidate)=>candidate.packageId===item.id&&candidate.documentId===projection.documentId);
          const latest=item.versionId?organizationVersions[item.versionId]:undefined;
          const applied=binding?organizationVersions[binding.versionId]:undefined;
          const pending=binding?.pendingVersionId?organizationVersions[binding.pendingVersionId]:undefined;
          const previousBlocks=new Map((applied?.blocks??[]).map((block)=>[block.sourceBlockId,block]));
          const nextBlocks=new Map((pending?.blocks??[]).map((block)=>[block.sourceBlockId,block]));
          const added=(pending?.blocks??[]).filter((block)=>!previousBlocks.has(block.sourceBlockId));
          const removed=(applied?.blocks??[]).filter((block)=>!nextBlocks.has(block.sourceBlockId));
          const changed=(pending?.blocks??[]).filter((block)=>{const prior=previousBlocks.get(block.sourceBlockId);return Boolean(prior&&(prior.contentSha256!==block.contentSha256||prior.source?.contentSha256!==block.source?.contentSha256));});
          const relationId=(relation:{fromSourceBlockId:string;toSourceBlockId:string;kind:string;properties?:Record<string,unknown>})=>JSON.stringify([relation.fromSourceBlockId,relation.toSourceBlockId,relation.kind,relation.properties??{}]);
          const previousRelations=new Map((applied?.relations??[]).map((relation)=>[relationId(relation),relation]));
          const nextRelations=new Map((pending?.relations??[]).map((relation)=>[relationId(relation),relation]));
          const removedRelations=[...previousRelations.entries()].filter(([id])=>!nextRelations.has(id)).map(([,relation])=>relation);
          const addedRelations=[...nextRelations.entries()].filter(([id])=>!previousRelations.has(id)).map(([,relation])=>relation);
          const relationName=(relation:{fromSourceBlockId:string;toSourceBlockId:string;kind:string})=>`${nextBlocks.get(relation.fromSourceBlockId)?.handle??previousBlocks.get(relation.fromSourceBlockId)?.handle??relation.fromSourceBlockId} → ${nextBlocks.get(relation.toSourceBlockId)?.handle??previousBlocks.get(relation.toSourceBlockId)?.handle??relation.toSourceBlockId} · ${relation.kind}`;
          const sourceIds=new Set((latest?.blocks??[]).map((block)=>block.sourceBlockId));
          const originalSource=Boolean(latest&&latest.sourceProjectAccessId===context?.projectAccessId&&latest.sourceDocumentId===projection.documentId);
          return localizeTemplateResult(html`<article class="library-organization-context-card"><span class="eyebrow">${this.i18n.system("Latest published version")} ${this.i18n.number(item.version??0)}</span><h3 dir="auto">${publisherNames.get("package:"+item.id)!.label}</h3><p>${item.description||this.i18n.system("{blockCount} reusable creative decisions", { blockCount: this.i18n.number(item.blockCount) })}</p><small>${this.i18n.system("{blockCount} reusable creative decisions",{blockCount:this.i18n.number(item.blockCount)})} · ${this.i18n.number(item.bindingCount)} ${this.i18n.system("bound document")}</small>
            ${binding?html`<p><b>${this.i18n.system("This document uses version")} ${applied?.version??"…"} · ${binding.updateMode==="pinned"?this.i18n.system("Pinned version"):this.i18n.system("Offers published updates")}</b>${pending?html` · <span role="status">${this.i18n.system("Version {version}",{version:this.i18n.number(pending.version)})} · ${this.i18n.t("workspace.context.review")}</span>`:nothing}</p>`:nothing}
            ${canAuthor&&projection.documentId?html`<div class="family-actions">
              ${!binding?html`<button type="button" class="button primary compact" @click=${()=>void this.store.adoptOrganizationContextPackage(item.id,item.versionId!,"pinned")}>${this.i18n.system("Use pinned version")}</button><button type="button" class="button secondary compact" @click=${()=>void this.store.adoptOrganizationContextPackage(item.id,item.versionId!,"follow-approved")}>${this.i18n.system("Offer published updates")}</button>`:html`
                ${pending?keyed(JSON.stringify([binding.id,pending.id]),localizeTemplateResult(html`<details class="library-context-version-review"><summary>${this.i18n.t("workspace.context.review")} · ${this.i18n.system("Version {version}",{version:this.i18n.number(pending.version)})}</summary><p>${added.length} added · ${removed.length} removed · ${changed.length} changed · ${addedRelations.length+removedRelations.length} relationship changes</p>${[...added,...removed,...changed,...addedRelations,...removedRelations].length?html`<ul>${added.map((block)=>html`<li>Add: ${block.handle}${block.source?" " + this.i18n.system("· original licensed source"):""}</li>`)}${removed.map((block)=>html`<li>Remove: ${block.handle}${block.source?" " + this.i18n.system("· licensed source and citations"):""}</li>`)}${changed.map((block)=>html`<li>Change: ${block.handle}${block.source?" " + this.i18n.system("· verified source evidence"):""}</li>`)}${addedRelations.map((relation)=>html`<li>${relationName(relation)} (+)</li>`)}${removedRelations.map((relation)=>html`<li>${relationName(relation)} (−)</li>`)}</ul>`:nothing}<form @submit=${(event:SubmitEvent)=>{event.preventDefault();void this.store.acceptOrganizationContextPackageUpdate(item.id,binding.id,pending.id);}}><label><input type="checkbox" required> ${this.i18n.system("I reviewed these decisions, sources, and changes to finished outputs.")}</label><button type="submit" class="button primary compact">${this.i18n.t("workspace.context.approve")} · ${this.i18n.number(pending.version)}</button></form></details>`,this.i18n)):nothing}
                <button type="button" class="button secondary compact" @click=${()=>void this.store.setOrganizationContextPackageUpdateMode(item.id,binding.id,binding.updateMode==="pinned"?"follow-approved":"pinned")}>${binding.updateMode==="pinned"?this.i18n.system("Offer future updates"):this.i18n.system("Pin this version")}</button>`}
              ${packagePublisher&&originalSource?html`<details class="library-context-next-version"><summary>${this.i18n.system("Choose decisions for the next published version")}</summary><form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;const values=new FormData(form);const selected=values.getAll("packageBlock").map(String);const confirmed=values.get("sourceRightsConfirmed")==="on";const completion=this.#capturePublisherCompletion(form,values);if(!completion)return;void this.store.publishOrganizationContextPackageVersion(item.id,selected,confirmed,confirmed).then(async(success)=>{if(!success)return;await this.updateComplete;if(completion.unchanged())(form.closest("details") as HTMLDetailsElement|null)?.removeAttribute("open");}).finally(completion.dispose);}}><fieldset class="library-context-block-selection"><legend>${this.i18n.system("Review every included decision and source; previous selections are preserved")}</legend>${repeat(projection.blocks,(block)=>block.id,(block)=>localizeTemplateResult(html`<label><input type="checkbox" name="packageBlock" value=${block.id} ?checked=${sourceIds.has(block.id)}> <span dir="auto">${block.handle}</span> <small>${block.type}${block.type==="reference"?" " + this.i18n.system("· original file, verified citations and rights"):""}</small></label>`,this.i18n))}</fieldset>${projection.blocks.some((block)=>block.type==="reference")?html`<label><input type="checkbox" name="sourceRightsConfirmed"> ${this.i18n.system("I confirm every selected original source is licensed, non-sensitive, and approved for independent organizational custody.")}</label>`:nothing}<small>${this.i18n.system("Removing a previously selected decision also removes it from documents that explicitly accept this update.")}</small><div class="family-actions"><button type="submit" class="button secondary compact">${context?.managedPilot?this.i18n.t("workspace.context.submit"):this.i18n.system("Publish the selected next version")}</button><button type="reset" class="button ghost compact" aria-label=${discardName("package:"+item.id)}>${this.i18n.t("output.requirement.discard")}</button></div></form></details>`:packagePublisher?html`<small>${this.i18n.system("Open this package’s original source document to publish its next version.")}</small>`:nothing}
            </div>`:nothing}</article>`,this.i18n);
        })}</div>`:html`<p>${this.i18n.system("No organization context has been published yet.")}</p>`}
        ${packagePublisher&&canAuthor&&projection.documentId?html`<form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;const values=new FormData(form);const name=String(values.get("packageName")??"").trim();const selected=values.getAll("packageBlock").map(String);const confirmed=values.get("sourceRightsConfirmed")==="on";const completion=this.#capturePublisherCompletion(form,values);if(!completion)return;void this.store.createOrganizationContextPackage(name,"",selected,confirmed,confirmed).then(async(success)=>{if(!success)return;await this.updateComplete;if(completion.unchanged())form.reset();}).finally(completion.dispose);}}>
          <label>${this.i18n.system("Publish decisions from the current document")}<input name="packageName" required maxlength="120" placeholder=${this.i18n.system("Brand and audience foundations")}></label>
          <fieldset class="library-context-block-selection"><legend>${this.i18n.t("workspace.context.selectionLimit","",{count:this.i18n.number(128)})}</legend>${repeat(projection.blocks,(block)=>block.id,(block,index)=>localizeTemplateResult(html`<label><input type="checkbox" name="packageBlock" value=${block.id} ?checked=${index<20}> <span dir="auto">${block.handle}</span> <small>${block.type}${block.type==="reference"?" " + this.i18n.system("· original file, citations and rights"):""}</small></label>`,this.i18n))}</fieldset>
          ${projection.blocks.some((block)=>block.type==="reference")?html`<label><input type="checkbox" name="sourceRightsConfirmed"> ${this.i18n.system("I confirm selected original source files are licensed, non-sensitive, and may be copied into this organization's independent custody.")}</label>`:nothing}
          <div class="family-actions"><button type="submit" class="button secondary compact">${context?.managedPilot?this.i18n.t("workspace.context.submit"):this.i18n.system("Publish selected organization context")}</button><button type="reset" class="button ghost compact" aria-label=${discardName("new:"+projection.documentId)}>${this.i18n.t("output.requirement.discard")}</button></div>
        </form>`:nothing}
        <small>${this.i18n.system("Explicitly confirmed original references are copied into organization-owned storage with their verified SHA-256 evidence, citations, license, and source classification.")}</small>
      </section>`:nothing}
      ${!context&&this.store.session.get()?.user.role==="admin"?html`<details class="library-index-disclosure"><summary>Search and indexing health</summary><section class="index-health" aria-labelledby="index-health-title"><div><span class="eyebrow">Administrative diagnostics</span><h2 id="index-health-title">Vector, family, and corpus index</h2><p>Every row records <code>${status.embeddingModelId}</code> v${status.embeddingVersion}; collection membership remains a search filter, never an inferred filing action.</p></div><div class="index-metrics"><span><b>${status.items.length}</b> indexed objects</span><span><b>${status.exemplars.length}</b> cited exemplars</span><span class=${status.fresh?"fresh":"stale"}><b>${status.fresh?this.i18n.system("fresh"):this.i18n.system("{staleBy} seq behind", { staleBy: this.i18n.number(status.staleBy) })}</b> embedding freshness</span></div><button class="button secondary" ?disabled=${this.store.busy.get()==="phase7-index"} title="Rebuild the derived index and append inferred family claims" @click=${()=>this.store.rebuildIndex()}>${icon("replay")} ${this.store.busy.get()==="phase7-index"?this.i18n.system("Rebuilding…"):this.i18n.system("Rebuild index")}</button></section></details>`:nothing}
    </div></div>
      <forma-document-artifacts class="library-artifact-viewer" .launcherOnly=${true} .documentId=${projection.documentId} source="library" @document-artifact-close=${(event:Event)=>this.#artifactViewerClosed(event)}></forma-document-artifacts>
      ${focusedBlock?html`<dialog class="modal library-focus-dialog" closedby="any" aria-labelledby="block-focus-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeFocus();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeFocus();}} @close=${()=>{if(libraryFocusFromRoute(this.store.route.get()))this.#closeFocus();}}><div class="modal-card wide focus-preview-card"><button class="icon-button modal-close" aria-label=${this.i18n.t("projects.closePreview","Close preview")} @click=${this.#closeFocus}>${icon("close")}</button><span class="eyebrow">${focusedBlock.type} · ${focusedBlock.scope==="library"?this.i18n.system("reusable project decision"):this.i18n.system("from a project document")}</span><h2 id="block-focus-title" dir="auto">${this.#blockName(focusedBlock)}</h2><div class="block-focus-layout"><div><forma-context-block .block=${focusedBlock} .readOnly=${true} surface="library"></forma-context-block>${canAuthor&&!focusedBlock.properties.organization_context_package_binding_id?html`<div class="focus-preview-actions"><button class="button primary" @click=${(event:MouseEvent)=>this.#useCopy(focusedBlock,event)}>${this.#relatedReferenceCount(focusedBlock.id)?this.i18n.system("Use complete context set ({count})", { count: this.i18n.number(this.#relatedReferenceCount(focusedBlock.id)+1) }):this.i18n.system("Use a copy in the open document")}</button><button class="button secondary" @click=${(event:MouseEvent)=>this.#openEditor(focusedBlock.id,event)}>${this.i18n.t("context.controls.named","Controls for {name}",this.#namedValue(this.#blockName(focusedBlock)))}</button></div>`:focusedBlock.properties.organization_context_package_binding_id?html`<p>${this.i18n.system("Organization context")}</p>`:nothing}</div><div><span class="eyebrow">Created using this decision</span>${this.#blockOutputs(focusedBlock,projection.libraryOutputs).length?html`<div class="linked-output-grid">${this.#blockOutputs(focusedBlock,projection.libraryOutputs).map((output)=>{const href=libraryFocusRoute("output",output.id);return html`<a href=${href} @click=${(event:MouseEvent)=>this.#navigate(event,"output",output.id)}>${this.#art(output)}<b>${this.#outputName(output)}</b></a>`;})}</div>`:html`<div class="linked-empty">No images have used this decision yet.</div>`}</div></div></div></dialog>`:nothing}
      ${focusedOutput?html`<dialog class="modal library-focus-dialog" closedby="any" aria-labelledby="output-focus-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeFocus();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeFocus();}} @close=${()=>{if(libraryFocusFromRoute(this.store.route.get()))this.#closeFocus();}}><div class="modal-card wide focus-preview-card"><button class="icon-button modal-close" aria-label=${this.i18n.t("projects.closePreview","Close preview")} @click=${this.#closeFocus}>${icon("close")}</button><span class="eyebrow">Generated image</span><h2 id="output-focus-title" dir="auto">${this.#outputName(focusedOutput)}</h2><div class="output-focus-layout"><forma-output-card .output=${focusedOutput} .primary=${true}></forma-output-card><aside><span class="eyebrow">What shaped this result</span><h3>${this.#outputBlocks(focusedOutput,projection.libraryBlocks).length} creative decision${this.#outputBlocks(focusedOutput,projection.libraryBlocks).length===1?"":"s"}</h3>${this.#outputBlocks(focusedOutput,projection.libraryBlocks).map((block)=>{const name=this.#blockName(block);const href=libraryFocusRoute("block",block.id,name);return html`<a href=${href} @click=${(event:MouseEvent)=>this.#navigate(event,"block",block.id,name)}><span>${block.type}</span><b>${name}</b></a>`;})}${canAuthor?html`<button class="button secondary" @click=${()=>this.#toggleLibrary(focusedOutput)}>${focusedOutput.library?this.i18n.t("projects.removeKept","Remove from kept"):this.i18n.t("projects.keepReuse","Keep for reuse")}</button>`:nothing}</aside></div></div></dialog>`:nothing}
      ${focusedFamily?html`<dialog class="modal family-lightbox" closedby="any" aria-labelledby="family-lightbox-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeFocus();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeFocus();}} @close=${()=>{if(libraryFocusFromRoute(this.store.route.get()))this.#closeFocus();}}><div class="modal-card wide family-lightbox-card"><button class="icon-button modal-close" aria-label=${this.i18n.t("projects.closePreview","Close preview")} @click=${this.#closeFocus}>${icon("close")}</button><span class="eyebrow">Suggested visual family</span><h2 id="family-lightbox-title">${String(focusedFamily.label??"Related creative work")}</h2><p>Open any image to review the creative decisions that shaped it.</p><div class="family-lightbox-grid">${records(focusedFamily.members).map((member,index)=>{const output=projection.libraryOutputs.find((item)=>item.id===String(member.object_id));if(!output)return html`<span class="unavailable-family-member">${this.#art(undefined,index)}<b>Image unavailable</b><small>This result is no longer in the project</small></span>`;const href=libraryFocusRoute("output",output.id);return html`<a href=${href} @click=${(event:MouseEvent)=>this.#navigate(event,"output",output.id)}>${this.#art(output,index)}<b>${this.#outputName(output)}</b><small>${Math.round(Number(member.confidence??0)*100)}% visual match</small></a>`;})}</div></div></dialog>`:nothing}
      ${imported&&importOwner?keyed(importOwner.id,localizeTemplateResult(html`<dialog class="modal library-import-dialog" closedby="any" aria-labelledby="import-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)importOwner.dismiss(event);}} @cancel=${(event:Event)=>{event.preventDefault();importOwner.dismiss(event);}} @close=${()=>{importOwner.dismiss();}}><div class="modal-card"><button class="icon-button modal-close" aria-label=${this.i18n.t("projects.closePreview","Close preview")} @click=${(event:MouseEvent)=>{importOwner.dismiss(event);}}>${icon("close")}</button><span class="eyebrow">Project archive inspected</span><h2 id="import-title">Import one document as a copy?</h2><p>${imported.events.length} archived events passed validation. Only the current document and its context blocks will be copied into this project. Other documents, generated outputs, uploaded media, collections, relationships, and history will not be restored.</p><div class="metric-grid"><div><b>${foldEvents(imported.events).blocks.length}</b><span>context blocks copied</span></div><div><b>${foldEvents(imported.events).outputs.length}</b><span>outputs not copied</span></div><div><b>${imported.mediaManifest.length}</b><span>media files not copied</span></div></div>${this.#importRecovery(importOwner)}<button class="button primary" ?disabled=${importOwner.pending||Boolean(importOwner.original)} aria-busy=${String(importOwner.pending)} @click=${()=>this.#forkImport(importOwner)}>Import document copy</button></div></dialog>`,this.i18n)):nothing}
    </section>`;
  }
  override render(){return keyed(this.#editorScope,html`${cache(localizeTemplateResult(this.#renderLibrary(),this.i18n))}`);}
}
if (!customElements.get("forma-library")) customElements.define("forma-library",FormaLibrary);
