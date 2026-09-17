import { isStandaloneExperienceRoute } from "../experiences/host-route.ts";
import { html, noChange, nothing } from "lit";
import { isSelectedOutputSharePagePath, selectedOutputSharePageToken } from "../model/selected-output-share-routes.ts";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { FormaElement, icon, downloadJson, copyTextToClipboard } from "./forma-element";
import { loadRouteComponent } from "../route-loader";
import { hasExperienceHostSelector } from "../experiences/host-route";
import { experienceShellShortcut } from "../experiences/shell-shortcut";
import "../experiences/shell.css";
import { artifactFocusOptionsFromRoute, artifactFocusRoute, documentContextBlockFromRoute, documentContextBlockRoute, documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, libraryFocusFromRoute, libraryFocusRoute, libraryRootRoute, withDocumentInRoute, withProjectTaskDocumentInRoute } from "../model/routes";
import { commandDiscoveryTargetAvailable, commandMatchScore, commandReviewIdentity, commandReviewMatches, projectCommandDiscovery, type CommandDiscoveryInput, type CommandDiscoveryRow } from "../model/command-discovery";
import { commandDiscoveryCopy } from "./design-system/locales/command-discovery-messages";
import { documentArtifactDefinition } from "../model/document-artifacts";
import { creativePreparationTargetAvailable, type CreativePreparationStage } from "../model/workspace-intelligence";
import { nextActionFacts } from "../state/next-action-context";
import type { AssignedReviewTask, CapturedSourceOwnership, EventSourceRetirement, NativeImageWorkspaceStartup } from "../state/store";
import type { FormaLibrary } from "./forma-library";
import { joinNativeDialogClose, navigationPresentationClosing, navigationPresentationCurrent, type CommandDeparture, type CommandDepartureOwner, type InAppNavigationAction, type LocalNavigation, type NavigationClosingPresentation, type NavigationPresentationContext, type NavigationRefusal } from "./command-departure";
import type { FormaWorkspace } from "./forma-workspace";
import { NativeImageHost, type NativeImageHostPresentation, type NativeImageShellNavigationReceipt } from "./native-image-host";
import type { NativeImageEditTarget } from "./native-image-controller";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";
import { APPLICATIONS, applicationAccessible, applicationDefinition, applicationIdFromRoute, authorizedApplicationHome, creativeCreationHref, navigationItemAccessible, navigationItemActive } from "../platform/applications";
import { formaActivityAttention, scopedFormaActivity } from "../model/activity";
import { canvasFocusFromRoute } from "../canvas/routes";
import { ensureModalDialog } from "./modal-dialog";
import { consequentialPreview } from "./consequential-preview";
import { contextConsentAction } from "../model/context-consent-state";
import "./context-intelligence.css";
import { beginRoutePopulation, completeRoutePopulation, recordPopulationSource } from "../performance";
import { FORMA_SUPPORTED_LOCALES, formaLocaleFamily, setFormaLocale } from "./design-system/localization";
import "./design-system/navigation";
import "./design-system/language-picker";
import "./icons-navigation";
import "./forma-attention-observer";
import "./forma-creative-assistant.ts";

type CommandOpening = {
  epoch:number; source:CapturedSourceOwnership|null; sourceReadable:boolean; authorityKey:string; route:string; locale:string; localeRequest:number;
  actorId:string; principalId:string; impersonationId:string|null; opener:HTMLElement|null; origins:readonly CommandDeparture[];
};
type CommandChoice = { id:string; key:string; label:string; hint:string; terms:readonly string[]; row?:CommandDiscoveryRow; route?:string; run?:()=>unknown };
type ShellFocus = { focus:OutputNavigationFocusLease; scopeCurrent():boolean; dispose():void };
type CommandNavigation = {
  focus:OutputNavigationFocusLease; current():boolean; handoff():boolean; retain():void;
  adoptSource(source:CapturedSourceOwnership):boolean;
  bind(focus:OutputNavigationFocusLease,ownedRouteFocus:(element:Element)=>boolean):void;
};
type NativeImageNavigationAttempt = {
  current:()=>boolean;
  scopeCurrent:()=>boolean;
  retire:()=>PromiseSettledResult<void>;
  startup:NativeImageWorkspaceStartup;
  accepted:boolean;
  navigation:PromiseSettledResult<boolean>|null;
  reporting:PromiseSettledResult<void>[];
  cleanups:NativeImageShellNavigationReceipt["cleanups"][number][];
  cleanup:(()=>void)|null;
};
type ShellRouteDetail = {
  path?:string;
  preserveFocus?:boolean;
  nativeImageStartup?:NativeImageWorkspaceStartup;
  nativeImageCommit?:Parameters<NativeImageWorkspaceStartup["commit"]>[0];
};
type NativeImageLocaleBinding = {
  readonly document:Document;
  readonly host:NativeImageHost;
  readonly listener:(event:Event)=>void;
  phase:"installing"|"active"|"failed";
};

export class FormaShell extends FormaElement {
  // The controller and its terminal receipts outlive permission-dependent
  // children, hidden mobile panes and replacement Workspace elements.
  #nativeImageHostInstance:NativeImageHost|null=null;
  #nativeImageLocaleBinding:NativeImageLocaleBinding|null=null;
  #reportNativeImageLocaleFailures(host:NativeImageHost,errors:unknown[]){
    if(!errors.length)return;
    // Shell is not a Workspace presentation origin. This records the listener
    // failure without letting late A cleanup retire a successor B presentation.
    host.retire(this,undefined,()=>{
      if(errors.length===1)throw errors[0];
      throw new AggregateError(errors,"native_image_locale_listener_failed",{cause:errors[0]});
    });
  }
  #takeNativeImageLocaleBinding(){
    const binding=this.#nativeImageLocaleBinding;
    this.#nativeImageLocaleBinding=null;
    if(binding)binding.phase="failed";
    return binding;
  }
  #removeNativeImageLocaleBinding(binding:NativeImageLocaleBinding|null){
    if(!binding)return;
    try{binding.document.removeEventListener("forma-locale-change",binding.listener);}
    catch(reason){this.#reportNativeImageLocaleFailures(binding.host,[reason]);}
  }
  #detachNativeImageLocaleDocument(){this.#removeNativeImageLocaleBinding(this.#takeNativeImageLocaleBinding());}
  #syncNativeImageLocaleDocument(){
    const host=this.#nativeImageHostInstance;
    if(!host)return;
    const requested=this.isConnected?this.ownerDocument:null;
    if(this.#nativeImageLocaleBinding?.document===requested)return;
    this.#detachNativeImageLocaleDocument();
    // Removal and error reporting may reenter. Never overwrite their successor.
    if(this.#nativeImageLocaleBinding)return;
    const document=this.isConnected?this.ownerDocument:null;
    if(!document)return;
    const binding:NativeImageLocaleBinding={document,host,phase:"installing",listener:event=>{
      if(binding.phase!=="active"||this.#nativeImageLocaleBinding!==binding||this.#nativeImageHostInstance!==host
        ||!this.isConnected||this.ownerDocument!==document||event.currentTarget!==document)return;
      host.refreshLocale();
    }};
    this.#nativeImageLocaleBinding=binding;
    const errors:unknown[]=[];
    try{
      document.addEventListener("forma-locale-change",binding.listener);
      if(this.#nativeImageLocaleBinding===binding&&this.isConnected&&this.ownerDocument===document){binding.phase="active";return;}
    }catch(reason){errors.push(reason);}
    // A throwing installation may already have attached the callback; even a
    // successful add can finish after a reentrant detach. Roll back only A. A
    // failed live A stays inactive until detach/adoption, never a render retry.
    binding.phase="failed";
    try{document.removeEventListener("forma-locale-change",binding.listener);}
    catch(reason){errors.push(reason);}
    this.#reportNativeImageLocaleFailures(host,errors);
  }
  get #nativeImageHost():NativeImageHost{
    const host=this.#nativeImageHostInstance??=new NativeImageHost({
      store:()=>this.store,
      changed:()=>{
        // Capacity belongs to this Shell, including after the old Image pane
        // closes. Its current Workspace must read the new availability too.
        const errors:unknown[]=[];
        try{this.requestUpdate();}catch(reason){errors.push(reason);}
        try{
          const store=this.store,workspace=this.querySelector<FormaElement>("forma-workspace");
          if(this.isConnected&&workspace?.isConnected&&workspace.closest("forma-shell")===this
            &&FormaElement.hasStoreIdentity(workspace,store)&&this.store===store
            &&this.querySelector("forma-workspace")===workspace)workspace.requestUpdate();
        }catch(reason){errors.push(reason);}
        if(errors.length===1)throw errors[0];
        if(errors.length>1)throw new AggregateError(errors,"native_image_notification_failed",{cause:errors[0]});
      },
      text:(key,fallback)=>this.i18n.t(key,fallback),
      locale:()=>{const i18n=this.i18n;return{locale:i18n.locale,messages:i18n.messages,direction:i18n.direction};},
      navigate:(origin,target,current,retire,startup)=>this.#navigateNativeImageFrom(origin,target,current,retire,startup),
    });
    // Publish the concrete error owner before any listener installation.
    this.#syncNativeImageLocaleDocument();
    // Scoped providers do not emit an initial change event. Refresh the same
    // effective controller on entry too; failure remains owned by the Host.
    host.refreshLocale();
    return host;
  }
  #nativeImageLocaleReady(host:NativeImageHost):boolean{
    const binding=this.#nativeImageLocaleBinding;
    return this.isConnected&&binding?.phase==="active"&&binding.document===this.ownerDocument
      &&binding.host===host&&this.#nativeImageHostInstance===host;
  }
  get nativeImageAvailable():boolean{
    const host=this.#nativeImageHost;
    return this.#nativeImageLocaleReady(host)&&host.available;
  }
  openNativeImage(origin:FormaElement,setup:Parameters<NativeImageHost["open"]>[1],presentation:NativeImageHostPresentation):ReturnType<NativeImageHost["open"]>{
    const store=this.store,document=this.ownerDocument;
    if(!this.isConnected||!origin.isConnected||!this.contains(origin)
      ||origin.closest("forma-shell")!==this||!FormaElement.hasStoreIdentity(origin,store))return null;
    const host=this.#nativeImageHost;
    // Dismissing an error does not repair a failed listener. Getter callbacks
    // may also retire the original origin or replace its Store/document.
    if(this.store!==store||this.ownerDocument!==document||!origin.isConnected||!this.contains(origin)
      ||origin.closest("forma-shell")!==this||!FormaElement.hasStoreIdentity(origin,store)
      ||!this.#nativeImageLocaleReady(host))return null;
    return host.open(origin,setup,presentation);
  }
  renderNativeImage(origin:FormaElement){
    if(!this.isConnected||!origin.isConnected||!this.contains(origin)
      ||origin.closest("forma-shell")!==this||!FormaElement.hasStoreIdentity(origin,this.store))return nothing;
    return this.#nativeImageHost.render(origin);
  }
  retireNativeImage(origin:FormaElement,presentation?:NativeImageHostPresentation,notify?:()=>void):PromiseSettledResult<void>{
    // Retirement is identity-scoped inside the stable owner; a detached origin
    // must still be able to release its original presentation.
    return this.#nativeImageHost.retire(origin,presentation,notify);
  }
  #commandActiveKey:string|null=null;
  #commandChooseFirst=true;
  #commandSelectionChanged=false;
  #commandEpoch=0;
  #contextOpening=0;
  #commandOpening:CommandOpening|null=null;
  #commandRouteFocus:{route:string;focus:OutputNavigationFocusLease;current:()=>boolean}|null=null;
  #commandComposing = false;
  #shareHours=24;#freshShareUrl="";#freshShareScope="";#freshShareCopied:boolean|null=null;#termsOwnership=false;#termsProvider=false;
  #dialogObserver?: MutationObserver;
  #lastObservedDocumentView = "";
  #lastObservedApplicationView = "";
  #revealedApplication = "";
  #localeAnnouncement = "";
  #accessibleRoute = "";
  #routeAnnouncement = "";
  #focusNextRoute: boolean | "native-image" = false;
  #routeFocus:ShellFocus|null=null;
  #sourceRetirementFocus:ShellFocus|null=null;
  #sourceRetirementSeen:CapturedSourceOwnership|null=null;
  #accountFocus:{panel:HTMLElement;open:boolean;owner:ShellFocus}|null=null;
  #accountReturnFocus=false;
  #localeRequest = 0;
  #layoutObserver?: ResizeObserver;
  #layoutFrame = 0;
  #layoutPosture: "compact" | "rail" | "expanded" = "expanded";
  #shortHeight = false;
  #syncLayout = () => {
    cancelAnimationFrame(this.#layoutFrame);
    this.#layoutFrame = requestAnimationFrame(() => {
      const inline = this.getBoundingClientRect().width || document.documentElement.clientWidth;
      const viewport = window.visualViewport;
      const block = document.documentElement.clientHeight || window.innerHeight;
      const short = block <= 600;
      const posture = short && inline > block ? "rail" : inline < 768 ? "compact" : inline < 1200 ? "rail" : "expanded";
      const keyboardOffset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      this.style.setProperty("--forma-keyboard-offset", `${Math.round(keyboardOffset)}px`);
      if (posture !== this.#layoutPosture || short !== this.#shortHeight) {
        this.#layoutPosture = posture;
        this.#shortHeight = short;
        this.requestUpdate();
      }
    });
  };
  #shareScope(){const session=this.store.session.get(),context=session?.projectContext,projection=this.store.projection.get();return[session?.user.userId??"",context?.organizationId??"personal",context?.projectAccessId??"personal",projection.projectId,projection.documentId,session?.permissionEpoch??""].join("\u0000");}
  #clearShareSecret=()=>{this.#retireSourceRetirementFocus();this.#retireAccountFocus();this.#accountReturnFocus=false;this.#retireRouteFocus();this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;if(this.store.ui.shareOpen)this.store.patchUi({shareOpen:false});};
  // A malformed experience selector stays restricted; the host shows unavailable.
  #experienceMode(){return hasExperienceHostSelector(this.store.route.get());}
  #openShare(closeAccount=false){if(this.#experienceMode()||!this.store.canManageProjectShares())return;this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;void this.store.loadShares();this.store.patchUi({...closeAccount?{accountOpen:false}:{},shareOpen:true});}
  #closeShare(){this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;this.store.patchUi({shareOpen:false});}
  // A one-shot presentation lease, separate from navigation or action authority.
  #captureShellFocus(current:()=>boolean,ownedRouteFocus?:(element:Element)=>boolean):ShellFocus{
    const store=this.store,document=this.ownerDocument,route=store.route.get(),epoch=this.#commandEpoch;
    const authorization=store.captureAuthorizationScope(),source=store.captureSourceOwnership();
    const sourceReadable=store.sourceOwnershipActive(source),locale=this.i18n.locale,localeRequest=this.#localeRequest;
    let retired=false,unsubscribe=()=>{};
    const dispose=()=>{if(retired)return;retired=true;unsubscribe();focus.dispose();};
    const scopeCurrent=()=>{
      if(retired)return false;
      if(!this.isConnected||this.store!==store||this.ownerDocument!==document||this.#commandEpoch!==epoch
        ||store.route.get()!==route||this.i18n.locale!==locale||this.#localeRequest!==localeRequest
        ||!store.authorizationScopeActive(authorization)||sourceReadable&&!store.sourceOwnershipActive(source)||!current()){
        dispose();return false;
      }
      return true;
    };
    const focus=captureOutputNavigationFocus(document,{ownedRouteFocus:element=>scopeCurrent()&&Boolean(ownedRouteFocus?.(element))});
    unsubscribe=store.subscribe(()=>{scopeCurrent();});
    return{focus,scopeCurrent,dispose};
  }
  #retireSourceRetirementFocus(){this.#sourceRetirementFocus?.dispose();}
  #sourceRetired=(event:Event)=>{
    const detail=(event as CustomEvent<EventSourceRetirement>).detail,store=this.store,document=this.ownerDocument;
    const source=store.captureSourceOwnership();
    if(!this.isConnected||!detail||![401,403,404].includes(detail.status)||!source
      ||!store.sourceOwnershipScopeActive(detail.source)||source.generation!==detail.generation
      ||detail.source.generation+1!==detail.generation||store.sourceOwnershipActive(source)
      ||store.documentRouteState()!=="unavailable"||store.routeDataReady())return;
    // A repeated notification cannot renew a handoff after newer user intent.
    if(this.#sourceRetirementSeen?.generation===source.generation
      &&store.sourceOwnershipScopeActive(this.#sourceRetirementSeen))return;
    this.#sourceRetirementSeen=source;this.#retireSourceRetirementFocus();
    const main=this.querySelector<HTMLElement>("#main-content"),origin=document.activeElement,view=document.defaultView;
    const visible=(element:HTMLElement)=>{
      if(!element.isConnected||!element.getClientRects().length||element.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
      for(let at:HTMLElement|null=element;at;at=at.parentElement){
        const style=view?.getComputedStyle(at);
        if(!style||style.display==="none"||style.visibility==="hidden"||style.visibility==="collapse"||style.opacity==="0")return false;
      }
      return true;
    };
    if(!main?.isConnected||!(origin instanceof HTMLElement)||origin===main||!main.contains(origin)||!visible(origin)
      ||origin.closest(".application-loading")||origin.closest(".projects-source-owner")
      ||document.visibilityState!=="visible"||!document.hasFocus()||document.querySelector("dialog[open]"))return;
    const route=store.route.get(),locale=this.i18n.locale,messages=this.i18n.messages,localeRequest=this.#localeRequest,epoch=this.#commandEpoch;
    let retired=false,unsubscribe=()=>{};
    const dispose=()=>{
      if(retired)return;retired=true;unsubscribe();focus.dispose();
      document.removeEventListener("visibilitychange",pageChanged,true);
      view?.removeEventListener("blur",pageBlur,true);view?.removeEventListener("pagehide",dispose,true);
      if(this.#sourceRetirementFocus===owner)this.#sourceRetirementFocus=null;
    };
    const scopeCurrent=()=>{
      if(retired)return false;
      const current=store.captureSourceOwnership();
      if(this.#sourceRetirementFocus!==owner||!this.isConnected||this.store!==store||this.ownerDocument!==document
        ||store.route.get()!==route||this.i18n.locale!==locale||this.i18n.messages!==messages
        ||this.#localeRequest!==localeRequest||this.#commandEpoch!==epoch||!store.sourceOwnershipScopeActive(detail.source)
        ||!current||current.generation!==detail.generation||store.sourceOwnershipActive(current)
        ||store.loading.get()||store.routeDataReady(route)||store.documentRouteState(route)!=="unavailable"
        ||document.visibilityState!=="visible"||!document.hasFocus()||document.querySelector("dialog[open]")){
        dispose();return false;
      }
      return true;
    };
    const pageChanged=()=>{if(document.visibilityState!=="visible"||!document.hasFocus())dispose();};
    const pageBlur=(event:Event)=>{if(event.target===view)dispose();};
    const focus=captureOutputNavigationFocus(document),owner:ShellFocus={focus,scopeCurrent,dispose};
    this.#sourceRetirementFocus=owner;
    document.addEventListener("visibilitychange",pageChanged,true);
    view?.addEventListener("blur",pageBlur,true);view?.addEventListener("pagehide",dispose,true);
    unsubscribe=store.subscribe(()=>{scopeCurrent();});
    const retry=()=>{
      const mains=[...this.querySelectorAll<HTMLElement>('main[id="main-content"]')];
      if(mains.length!==1||mains[0].getAttribute("aria-busy")!=="false")return null;
      const currentMain=mains[0],statuses=[...currentMain.querySelectorAll<HTMLElement>(".application-loading")]
        .filter(element=>element.tagName==="SECTION"&&element.getAttribute("role")==="status");
      if(statuses.length!==1)return null;
      const status=statuses[0],buttons=[...status.querySelectorAll<HTMLButtonElement>("button")];
      if(buttons.length!==1)return null;
      const button=buttons[0],tabIndex=button.getAttribute("tabindex");
      return button.getAttribute("type")==="button"&&!button.disabled&&!button.matches(":disabled")
        &&(tabIndex===null||!(Number(tabIndex)<0))&&button.closest("#main-content")===currentMain
        &&button.closest(".application-loading")===status&&visible(currentMain)&&visible(status)&&visible(button)?button:null;
    };
    // Capture was before descendant withdrawal; inspect the committed replacement
    // only after the actual Shell update, without recapturing focus ownership.
    this.requestUpdate();
    void this.updateComplete.then(()=>{
      try{
        if(!scopeCurrent()||!focus.current()||origin.isConnected)return;
        const target=retry();if(!target)return;
        focus.run(target,()=>{
          if(!scopeCurrent()||origin.isConnected||retry()!==target)return false;
          target.focus();return document.activeElement===target&&scopeCurrent();
        });
      }finally{dispose();}
    },()=>{dispose();});
  };
  #retireAccountFocus(){this.#accountFocus?.owner.dispose();this.#accountFocus=null;}
  #retireRouteFocus(){this.#routeFocus?.dispose();this.#routeFocus=null;this.#focusNextRoute=false;}
  #accountBeforeToggle=(event:ToggleEvent)=>{
    const panel=event.currentTarget as HTMLElement|null;
    if(!this.isConnected||!panel?.isConnected||panel!==this.querySelector("#account-popover"))return;
    this.#retireAccountFocus();
    const open=event.newState==="open",trigger=this.querySelector<HTMLButtonElement>(".avatar");
    if(open)this.#accountReturnFocus=false;
    const owner=this.#captureShellFocus(
      ()=>panel.isConnected&&panel===this.querySelector("#account-popover"),
      element=>!open&&element===trigger&&Boolean(trigger?.isConnected
        &&trigger===this.querySelector(".avatar")&&trigger.getAttribute("popovertarget")===panel.getAttribute("id")));
    const focus=this.#accountFocus={panel,open,owner};
    // A native beforetoggle callback may reach a microtask checkpoint before
    // the UA commits its new state. Check cancellation in the next task,
    // retaining this exact opening's focus owner and interruption guards.
    setTimeout(()=>{if(this.#accountFocus===focus&&panel.matches(":popover-open")!==open)this.#retireAccountFocus();},0);
  };
  #accountToggle = (event: ToggleEvent) => {
    const open = event.newState === "open",panel=event.currentTarget as HTMLElement|null;
    if(!this.isConnected||!panel?.isConnected||panel!==this.querySelector("#account-popover")
      ||panel.matches(":popover-open")!==open)return;
    const focus=this.#accountFocus;
    const scoped=focus?.panel===panel&&focus.open===open&&focus.owner.scopeCurrent();
    try{
      // A newer pointer may retire focus without changing this native state.
      if(open&&!scoped)return;
      if(this.store.ui.accountOpen!==open)this.store.patchUi({ accountOpen: open });
      if(!scoped||!focus||!focus.owner.scopeCurrent())return;
      const target=open?panel.querySelector<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])")
        :this.#accountReturnFocus?this.querySelector<HTMLButtonElement>(".avatar"):null;
      if(target)focus.owner.focus.run(target,()=>{target.focus();return true;});
    }finally{
      if(this.#accountFocus===focus){this.#retireAccountFocus();this.#accountReturnFocus=false;}
    }
  };
  #keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.key === "Process" || this.#commandComposing && this.store.ui.commandOpen) return;
    const target = event.composedPath()[0];
    const editingField = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const shortcut=experienceShellShortcut(this.#experienceMode(),event.key,event.metaKey||event.ctrlKey,editingField,event.shiftKey);
    if(shortcut==="suppress")event.preventDefault();
    else if(shortcut==="commands"){event.preventDefault();this.#openCommands();}
    const projectContext=this.store.session.get()?.projectContext;
    if ((shortcut==="undo"||shortcut==="redo") && (!projectContext||projectContext.permissions.includes("project.author")) && ["creative","canvas"].includes(applicationIdFromRoute(this.store.route.get()))) { event.preventDefault(); if (shortcut==="redo") void this.store.redo(); else void this.store.undo(); }
    if (event.key === "Escape") {
      if(this.store.ui.commandOpen){event.preventDefault();void this.#closeCommands();return;}
      if(this.store.ui.impersonationConfirmOpen)this.store.resolveImpersonatedInteraction(false);
      else { this.#accountReturnFocus=Boolean(this.querySelector<HTMLElement>("#account-popover")?.matches(":popover-open"));this.#commandComposing=false;this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;this.store.patchUi({commandOpen:false,accountOpen:false,shareOpen:false,compareOpen:false}); }
    }
  };
  #routeChanged = (event: Event) => {
    const detail=(event as CustomEvent<ShellRouteDetail>).detail;
    const startup=detail?.nativeImageStartup,commit=detail?.nativeImageCommit,host=this.#nativeImageHostInstance;
    if(startup||commit){
      // An old or another Shell's ticket cannot fall through into unobserved
      // ordinary startup work after its fixed Image owner has withdrawn.
      if(!startup||!commit||!host?.ownsStartup(startup,commit))return;
      try{
        const store=this.store,path=detail?.path??`${location.pathname}${location.search}${location.hash}`;
        // Capture before focus preparation can invoke an owner callback. The
        // exact arrival cannot revive after an intervening A-to-B-to-A route.
        const arrival=store.captureWorkspaceNavigationFocus(path);
        const current=()=>this.isConnected&&this.store===store&&Boolean(arrival?.routeCurrent()&&arrival.current());
        this.#applyRouteChanged(detail,startup,current);
      }catch(reason){host.routeEventFailed(startup,reason);}
      return;
    }
    this.#applyRouteChanged(detail);
  };
  #applyRouteChanged(detail:ShellRouteDetail|undefined,startup?:NativeImageWorkspaceStartup,startupCurrent:()=>boolean=()=>false){
    if(startup&&!startupCurrent()){
      startup.superseded("component-load");startup.superseded("document-sync");return;
    }
    this.#retireSourceRetirementFocus();
    if(this.store.ui.commandOpen)void this.#closeCommands(false);
    if(this.#commandRouteFocus&&this.#commandRouteFocus.route!==this.store.route.get()){this.#commandRouteFocus.focus.dispose();this.#commandRouteFocus=null;}
    this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;
    const path = detail?.path ?? `${location.pathname}${location.search}${location.hash}`;
    this.#retireAccountFocus();this.#accountReturnFocus=false;this.#retireRouteFocus();
    if(detail?.preserveFocus!==true&&path===this.store.route.get()&&!path.includes("#")){
      const arrival=this.store.captureWorkspaceNavigationFocus(path);
      // Capture at the committed route event, before render or a newer gesture.
      // A disposed original gesture cannot seed a replacement presentation lease.
      if(!arrival||arrival.routeCurrent()&&arrival.current()){
        const popover=this.ownerDocument.activeElement?.closest<HTMLElement>("[popover]:popover-open");
        const id=popover?.getAttribute("id"),invokers=id?[...this.querySelectorAll<HTMLElement>("[popovertarget]")]
          .filter(element=>element.getAttribute("popovertarget")===id):[];
        const invoker=invokers.length===1?invokers[0]:null;
        this.#routeFocus=this.#captureShellFocus(()=>!arrival||arrival.routeCurrent(),
          element=>element===invoker&&Boolean(invoker?.isConnected&&popover?.isConnected
            &&!popover.matches(":popover-open")));
        this.#focusNextRoute=startup?"native-image":true;
      }
    }
    if(startup){
      // Start observes the original invocation and promise. Route commitment
      // alone is not an acknowledgment from either startup operation.
      if(startupCurrent())startup.start("component-load",()=>loadRouteComponent(path));
      else startup.superseded("component-load");
      if(!startupCurrent())startup.superseded("document-sync");
      else{
        const loading=this.store.loading.get();
        if(!startupCurrent())startup.superseded("document-sync");
        else if(loading)startup.unnecessary("document-sync","document-loading");
        else startup.start("document-sync",()=>this.store.syncDocumentFromRoute(path));
      }
    }else{
      void loadRouteComponent(path);
      if(!this.store.loading.get())void this.store.syncDocumentFromRoute(path);
    }
  }
  #populated = () => {
    const path = this.store.route.get();
    window.setTimeout(() => {
      if (!this.isConnected || this.store.route.get() !== path || document.documentElement.dataset.formaPhase !== "populated") return;
      this.#observeApplicationView(path);
      this.#observeDocumentView(path);
    }, 0);
  };
  #pop = () => { this.#focusNextRoute=true;this.store.setRoute(`${location.pathname}${location.search}${location.hash}`); };
  #changeLocale = async (event: Event) => {
    this.#retireSourceRetirementFocus();
    const picker = event.currentTarget as HTMLElementTagNameMap["forma-ui-language-picker"];
    const requested = (event as CustomEvent<{ value: string }>).detail.value;
    const revision = ++this.#localeRequest;
    const result = await setFormaLocale(requested);
    if (revision !== this.#localeRequest) return;
    const resolved = formaLocaleFamily(result.locale);
    if (resolved !== requested) {
      picker.value = resolved;
      this.#localeAnnouncement = this.i18n.t("language.failed", "The selected language could not be loaded. Please try again.");
    } else {
      const choice = FORMA_SUPPORTED_LOCALES.find((item) => item.locale === resolved);
      this.#localeAnnouncement = this.i18n.t("language.changed", "", { language: choice?.label || resolved });
    }
    this.requestUpdate();
  };

  #localePicker() {
    return html`<form class="locale-picker-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-language-picker .label=${this.i18n.t("language.label")} .value=${formaLocaleFamily(this.i18n.locale)} @forma-change=${this.#changeLocale}></forma-ui-language-picker></form>`;
  }

  override connectedCallback() {
    super.connectedCallback();this.#syncNativeImageLocaleDocument();this.#nativeImageHostInstance?.refreshLocale();window.addEventListener("keydown",this.#keydown);window.addEventListener("popstate",this.#pop);window.addEventListener("forma-route-changed",this.#routeChanged);window.addEventListener("forma-performance",this.#populated);window.addEventListener("forma-authorization-changed",this.#clearShareSecret);
    window.addEventListener("forma-event-source-retired",this.#sourceRetired,true);
    window.visualViewport?.addEventListener("resize", this.#syncLayout);
    window.visualViewport?.addEventListener("scroll", this.#syncLayout);
    if (typeof ResizeObserver !== "undefined") { this.#layoutObserver = new ResizeObserver(this.#syncLayout); this.#layoutObserver.observe(this); }
    this.#syncLayout();
    this.#dialogObserver = new MutationObserver((records) => {
      const dialogChanged = records.some((record) => record.type === "attributes" || [...record.addedNodes].some((node) => node instanceof Element && (node.matches("dialog") || node.querySelector("dialog"))));
      if (dialogChanged) queueMicrotask(() => this.#raiseToast());
    });
    this.#dialogObserver.observe(this, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    void loadRouteComponent(this.store.route.get());
    const shared=location.pathname==="/share"||location.pathname.startsWith("/share/");
    if(shared){beginRoutePopulation(location.pathname);recordPopulationSource("miss",0);}
    else if(!this.store.events.get().length)void this.store.load();
  }
  override disconnectedCallback(){
    const localeBinding=this.#takeNativeImageLocaleBinding();
    try{this.#nativeImageHostInstance?.disconnect();this.#retireSourceRetirementFocus();window.removeEventListener("forma-event-source-retired",this.#sourceRetired,true);this.#retireAccountFocus();this.#accountReturnFocus=false;this.#retireRouteFocus();this.#commandEpoch++;this.#commandOpening=null;this.#commandRouteFocus?.focus.dispose();this.#commandRouteFocus=null;this.#dialogObserver?.disconnect();this.#layoutObserver?.disconnect();cancelAnimationFrame(this.#layoutFrame);window.visualViewport?.removeEventListener("resize",this.#syncLayout);window.visualViewport?.removeEventListener("scroll",this.#syncLayout);window.removeEventListener("keydown",this.#keydown);window.removeEventListener("popstate",this.#pop);window.removeEventListener("forma-route-changed",this.#routeChanged);window.removeEventListener("forma-performance",this.#populated);window.removeEventListener("forma-authorization-changed",this.#clearShareSecret);this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;super.disconnectedCallback();}
    finally{this.#removeNativeImageLocaleBinding(localeBinding);}
  }
  adoptedCallback(){
    this.#detachNativeImageLocaleDocument();
    this.#syncNativeImageLocaleDocument();
    this.#nativeImageHostInstance?.refreshLocale();
  }

  #raiseToast() {
    const toast = this.querySelector<HTMLElement>(".toast[popover]");
    if (!toast || typeof toast.showPopover !== "function") return;
    try {
      if (toast.matches(":popover-open")) toast.hidePopover();
      toast.showPopover();
    } catch { /* The toast remains a fixed fallback when popovers are unavailable. */ }
  }

  protected override updated() {
    if(this.#experienceMode()){
      if(this.store.ui.commandOpen)void this.#closeCommands(false);
      if(this.store.ui.accountOpen||this.store.ui.shareOpen||this.store.ui.compareOpen){
        this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;
        this.store.patchUi({accountOpen:false,shareOpen:false,compareOpen:false});
      }
    }
    if(this.#routeFocus&&(!this.#routeFocus.scopeCurrent()||!this.#routeFocus.focus.current()))this.#retireRouteFocus();
    if(this.#accountFocus&&!this.#accountFocus.owner.scopeCurrent()){this.#retireAccountFocus();this.#accountReturnFocus=false;}
    if(this.#commandRouteFocus&&!this.#commandRouteFocus.current()){this.#commandRouteFocus.focus.dispose();this.#commandRouteFocus=null;}
    if(this.#commandOpening&&(!this.store.ui.commandOpen||!this.#commandContextCurrent(this.#commandOpening)||this.#commandOpening.route!==this.store.route.get()
      ||this.#commandOpening.sourceReadable&&!this.store.sourceOwnershipActive(this.#commandOpening.source))){
      if(this.store.ui.commandOpen)void this.#closeCommands(false);
      else{this.#commandOpening=null;this.#commandActiveKey=null;this.#commandComposing=false;}
    }
    const accountPopover=this.querySelector<HTMLElement>("#account-popover");
    if(!this.store.ui.accountOpen&&accountPopover?.matches(":popover-open"))accountPopover.hidePopover();
    for(const dialog of this.querySelectorAll<HTMLDialogElement>(".command-dialog,.consent-modal,.impersonation-confirm-dialog,dialog[data-shell-modal]"))ensureModalDialog(dialog);
    this.#raiseToast();
    if(!this.store.loading.get()&&this.store.session.get()&&this.store.routeDataReady()){
      const path=this.store.route.get(),pathname=path.split(/[?#]/)[0]??"",parts=pathname.split("/").filter(Boolean);
      const organization=parts[0]==="settings"&&parts[1]==="workspaces"&&parts[2]!=="invitations"?this.store.session.get()?.organizations?.find((item)=>item.organizationId===parts[2]):undefined;
      const key=`${path}:${this.i18n.locale}:${organization?.name??""}`;
      const routeChanged=this.#accessibleRoute!==key;
      if(routeChanged){
        this.#accessibleRoute=key;
        const id=applicationIdFromRoute(path),application=applicationDefinition(id),task=application.navigation.find((item)=>navigationItemActive(id,item.id,path));
        const workspaceSection=parts[0]==="settings"&&parts[1]==="workspaces"?(parts[2]==="invitations"?this.i18n.t("workspace.admin.invitations","Your invitations"):parts[2]?this.i18n.t(`workspace.admin.section.${parts[3]??"overview"}`,parts[3]??"Overview"):this.i18n.t("workspace.admin.heading","Workspaces & collaboration")):"";
        const page=workspaceSection?organization?`${workspaceSection} — \u2068${organization.name}\u2069`:workspaceSection:documentIdFromRoute(path)&&this.store.projection.get().documentTitle?this.store.projection.get().documentTitle:task?this.i18n.t(`shell.navigation.${task.id}`,task.label):this.i18n.t(`shell.${id}`,application.label);
        const workspace=this.i18n.t(`shell.${id}`,application.label);
        document.title=page===workspace?`${workspace} — Forma`:`${page} — ${workspace} — Forma`;
        this.#routeAnnouncement=document.title.replace(/\s— Forma$/,"");
      }
      // An admitted Image Edit returns to its already-open Document. Its exact
      // route event still owns main focus even when the accessible key is unchanged.
      if(routeChanged||this.#focusNextRoute==="native-image"){
        if(this.#focusNextRoute&&!path.includes("#")){
          this.#focusNextRoute=false;
          const focus=this.#routeFocus;
          if(focus)void this.updateComplete.then(()=>{
            try{
              const target=this.querySelector<HTMLElement>("#main-content");
              if(this.#routeFocus!==focus||!focus.scopeCurrent()||this.#accessibleRoute!==key
                ||this.store.loading.get()||!this.store.session.get()||!this.store.routeDataReady()||!target?.isConnected)return;
              focus.focus.run(target,()=>{target.focus({preventScroll:true});return true;});
            }finally{focus.dispose();if(this.#routeFocus===focus)this.#routeFocus=null;}
          });
        }
      }else if(this.#focusNextRoute)this.#retireRouteFocus();
      completeRoutePopulation(path);
    }
    this.#revealApplication();
  }

  #revealApplication() {
    const application = `${applicationIdFromRoute(this.store.route.get())}:${this.i18n.locale}:${this.matches(":dir(rtl)")}`;
    if (application === this.#revealedApplication) return;
    const scroller = this.querySelector<HTMLElement>(".application-switcher");
    const current = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !current) return;
    this.#revealedApplication = application;
    const viewport = scroller.getBoundingClientRect();
    const target = current.getBoundingClientRect();
    if (target.right > viewport.right) scroller.scrollLeft += target.right - viewport.right;
    else if (target.left < viewport.left) scroller.scrollLeft -= viewport.left - target.left;
  }

  #observeApplicationView(path:string){
    if(document.documentElement.dataset.formaPhase!=="populated"||this.store.loading.get()||!this.store.events.get().length||this.store.session.get()?.projectContext)return;
    const pathname=path.split(/[?#]/)[0]||"/";const application=applicationIdFromRoute(pathname);const projection=this.store.projection.get();const documentId=documentIdFromRoute(pathname)??"";
    const routeFamily=documentId?"document":pathname.startsWith("/operations/events")?"operations-events":pathname.startsWith("/operations/analytics")?"operations-analytics":pathname.startsWith("/operations")?"operations-system":pathname.startsWith("/laboratory/replay")?"laboratory-replay":pathname.startsWith("/laboratory")?"laboratory-home":pathname.startsWith("/canvas/")?"canvas-workspace":pathname==="/canvas"?"canvas-home":pathname.startsWith("/library")?"library":pathname.startsWith("/sessions")?"sessions":pathname.startsWith("/scout")?"scout":pathname.startsWith("/memory")?"memory":pathname.startsWith("/projects")?"projects":"creative-workspace";
    const focused=documentId?documentFocusFromRoute(pathname):application==="canvas"?canvasFocusFromRoute(pathname):undefined;const visitKey=`${routeFamily}:${documentId}:${documentViewFromRoute(pathname)??""}:${focused===true?"focus":"standard"}`;if(visitKey===this.#lastObservedApplicationView)return;this.#lastObservedApplicationView=visitKey;
    void this.store.hot({type:"ApplicationViewVisited",payload:{application,surface:routeFamily,route_family:routeFamily,project_id:documentId||application==="canvas"?projection.projectId:undefined,document_id:documentId||undefined,document_view:documentId?documentViewFromRoute(pathname):undefined,focused}});
  }

  #observeDocumentView(path: string) {
    const view = documentViewFromRoute(path);
    if (!view) { this.#lastObservedDocumentView = ""; return; }
    if (document.documentElement.dataset.formaPhase !== "populated" || this.store.loading.get() || !this.store.events.get().length || this.store.session.get()?.projectContext) return;
    const projection = this.store.projection.get();
    const documentId = documentIdFromRoute(path) ?? projection.documentId;
    if (!documentId) return;
    const focused = documentFocusFromRoute(path);
    const visitKey = `${documentId}:${view}:${focused ? "focus" : "standard"}`;
    if (visitKey === this.#lastObservedDocumentView) return;
    this.#lastObservedDocumentView = visitKey;
    void this.store.hot({ type: "DocumentViewVisited", payload: { document_id: documentId, project_id: projection.projectId, view, focused, route_family: "document", source_surface: "document-view-navigation" } });
  }

  #route(path:string,options?:{current:()=>boolean;focus:OutputNavigationFocusLease;onOriginHandoff?:()=>boolean;onDestinationSource?:(source:CapturedSourceOwnership)=>boolean;documentFocus?:boolean;replace?:boolean},reveal=true):boolean|Promise<boolean> {
    if(!options){
      if(path===this.store.route.get())return true;
      return this.navigateFrom(this,navigation=>this.#route(path,navigation));
    }
    if(options&&(!options.current()||!options.focus.current()))return false;
    this.#commandComposing=false;this.store.patchUi({commandOpen:false,accountOpen:false});
    const finish=()=>{
      const route=this.store.route.get();
      const current=()=>!options||options.current()&&options.focus.current()&&this.store.route.get()===route;
      if(!current())return false;
      if(!reveal)return true;
      const hash=path.includes("#")?path.slice(path.indexOf("#")+1):"";
      if(hash)return new Promise<boolean>(resolve=>window.setTimeout(()=>{
        if(!current()){resolve(false);return;}
        const target=document.getElementById(hash),reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const reveal=()=>{target?.scrollIntoView({behavior:reduced?"auto":"smooth",block:"center"});target?.focus({preventScroll:true});return true;};
        if(target&&options)resolve(options.focus.run(target,reveal));else{if(!options)reveal();resolve(!options);}
      },0));
      window.scrollTo({top:0});
      return true;
    };
    if(options&&(isStandaloneExperienceRoute(path)||applicationIdFromRoute(this.store.route.get())!==applicationIdFromRoute(path))){
      return this.store.transitionWorkspace(path,options).then(opened=>opened&&
        (isStandaloneExperienceRoute(path)?true:applicationIdFromRoute(this.store.route.get())===applicationIdFromRoute(path)?finish():true));
    }
    this.store.setRoute(path,options);return finish();
  }
  #leaveProjectContext(){
    return this.navigateFrom(this,navigation=>this.store.leaveProjectContext(navigation));
  }
  #page() {
    const path=this.store.route.get(),application=applicationIdFromRoute(path);
    if(application==="creative"&&this.store.session.get()?.projectContext&&/^\/(?:sessions|scout|memory)(?:\/|[?#]|$)/.test(path))return html`<section class="page-pad"><header class="page-header page-header--hero"><div class="page-header-copy"><h1>${this.i18n.t("workspace.personalOnly.heading","This is part of your personal creative account")}</h1><p>${this.i18n.t("workspace.personalOnly.description","Sessions, personal suggestions, and creative memory stay private and are not shared with a project.")}</p></div><div class="page-header-actions"><button type="button" class="button secondary" @click=${()=>void this.#leaveProjectContext()}>${this.i18n.t("workspace.admin.leaveSharedProject","Return to my projects")}</button></div></header></section>`;
    if(application==="canvas")return html`<forma-canvas-application></forma-canvas-application>`;
    if(application==="operations")return html`<forma-operations-application></forma-operations-application>`;
    if(application==="product")return html`<forma-product-application></forma-product-application>`;
    if(application==="knowledge")return html`<forma-knowledge-application></forma-knowledge-application>`;
    if(application==="engineering")return html`<forma-engineering-application></forma-engineering-application>`;
    return html`<forma-creative-application></forma-creative-application>`;
  }
  #share() {
    const p = this.store.projection.get();
    const latestImage=p.outputs[0];const latestArtifact=p.artifacts[0];
    const latestResult=latestArtifact&&(!latestImage||latestArtifact.sequence>latestImage.sequence)?latestArtifact:latestImage;
    const downloads = [
      { id: "creative-plan", name: this.i18n.t("share.plan", "Creative plan"), description: this.i18n.t("share.planDetail", "Every decision, relationship, influence, and creative boundary shaping this document.") },
      { id: "latest-result-+-plan", name: this.i18n.t("share.result", "Latest result + plan"), description: this.i18n.t("share.resultDetail", "The newest image, story, scene, presentation, storyboard, or video together with its source context.") },
      { id: "complete-document", name: this.i18n.t("share.document", "Complete document"), description: this.i18n.t("share.documentDetail", "A restorable structured copy containing this document, its results, and their history.") },
    ];
    return html`<dialog class="modal" data-shell-modal open closedby="any" aria-labelledby="share-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeShare();}} @close=${()=>{this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;}}>
      <div class="modal-card">
        <button class="icon-button modal-close" aria-label=${this.i18n.t("share.close", "Close share dialog")} @click=${()=>this.#closeShare()}>${icon("close")}</button>
        <span class="eyebrow">${this.i18n.t("share.eyebrow", "Private handoff")}</span><h2 id="share-title">${this.i18n.t("share.heading", "Export or share this work")}</h2>
        <p>${this.i18n.t("share.description", "Create a private, view-only link or download a complete copy of this work. Links expire automatically and can be closed at any time.")}</p>
        <form class="share-link-builder" @submit=${async(event:SubmitEvent)=>{event.preventDefault();const scope=this.#shareScope(),share=await this.store.createShare(this.#shareHours);if(share?.token&&scope===this.#shareScope()&&this.store.ui.shareOpen){this.#freshShareScope=scope;this.#freshShareUrl=`${location.origin}/share/${share.token}`;this.#freshShareCopied=null;this.requestUpdate();const copied=await copyTextToClipboard(this.#freshShareUrl);if(scope===this.#shareScope()&&this.store.ui.shareOpen&&this.#freshShareScope===scope){this.#freshShareCopied=copied;this.requestUpdate();}}}}><label>${this.i18n.t("share.lifetime", "Link lifetime")}<select .value=${String(this.#shareHours)} @change=${(e:Event)=>{this.#shareHours=Number((e.target as HTMLSelectElement).value);}}><option value="1">${this.i18n.plural("share.hour", 1, "{count} hour", "{count} hours")}</option><option value="24">${this.i18n.plural("share.hour", 24, "{count} hour", "{count} hours")}</option><option value="72">${this.i18n.plural("share.day", 3, "{count} day", "{count} days")}</option><option value="168">${this.i18n.plural("share.day", 7, "{count} day", "{count} days")}</option></select></label><button type="submit" class="button primary">${icon("share")} ${this.i18n.t("share.create", "Create & copy link")}</button></form>
        ${this.#freshShareUrl&&this.#freshShareScope===this.#shareScope()?html`<div class="fresh-share"><b aria-live="polite">${this.#freshShareCopied===true?this.i18n.t("share.copied", "Copied"):this.#freshShareCopied===false?this.i18n.t("clipboard.failure", "Could not copy. Select the text and copy it manually."):this.i18n.t("share.link", "Private sharing link")}</b><input readonly dir="ltr" aria-label=${this.i18n.t("share.link", "Private sharing link")} .value=${this.#freshShareUrl}><small>${this.i18n.t("share.once", "This private link is shown once and expires automatically.")}</small></div>` : nothing}
        ${this.store.shares.get().some((share)=>share.resourceId===p.documentId) ? html`<div class="share-list"><h3>${this.i18n.t("share.links", "Links to this document")}</h3>${this.store.shares.get().filter((share)=>share.resourceId===p.documentId).slice(0,4).map((share)=>html`<div><span><b>${share.active ? this.i18n.t("share.active", "Active") : this.i18n.t("share.closed", "Closed")}</b><small>${this.i18n.t("share.expires", "Expires {date}", { date: this.i18n.date(new Date(share.expiresAt), { dateStyle: "medium", timeStyle: "short" }) })}</small></span>${share.active?html`<button @click=${async()=>{this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;this.requestUpdate();await this.store.revokeShare(share.shareId);}}>${this.i18n.t("share.revoke", "Revoke")}</button>`:nothing}</div>`)}</div>` : nothing}
        <div class="choice-grid">
          ${downloads.map((item, i) => html`<button class="choice-card" @click=${async()=>{const receipt={type:"ObjectExported",payload:{object_id:latestResult?.id??p.documentId,destination_class:"download",format:"application/json"}},authorization=this.store.captureAuthorizationScope();if(!authorization||!await this.store.authorizeProjectExport(receipt,authorization)||!this.store.authorizationScopeActive(authorization))return;const scopedEventIds=new Set([...p.blocks.flatMap((block)=>block.sourceEvents),...p.outputs.map((output)=>output.sourceEventId),...p.artifacts.map((artifact)=>artifact.sourceEventId)]);const scopedEvents=this.store.events.get().filter((event)=>event.payload.document_id===p.documentId||event.payload.project_id===p.projectId&&event.type==="ProjectCreated"||scopedEventIds.has(event.eventId));downloadJson(`forma-${item.name.normalize("NFKC").toLocaleLowerCase(this.i18n.locale).replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/g,"")||"forma"}.json`, i === 0 ? { documentId:p.documentId,title:p.documentTitle,blocks:p.blocks,blockRelations:p.blockRelations,compile:p.latestCompile } : i === 1 ? {documentId:p.documentId,title:p.documentTitle,result:latestResult??null,blocks:p.blocks,blockRelations:p.blockRelations,compile:p.latestCompile,clearance:"owned"} : {documentId:p.documentId,projectId:p.projectId,events:scopedEvents,projection:{projectId:p.projectId,projectName:p.projectName,documentId:p.documentId,documentTitle:p.documentTitle,blocks:p.blocks,blockRelations:p.blockRelations,outputs:p.outputs,artifacts:p.artifacts}});this.#closeShare();}}><b>${item.name}</b><span>${item.description}</span><small>${icon("download")} ${this.i18n.t("share.download", "Download JSON")}</small></button>`) }
        </div>
        <div class="gate-note"><span>${icon("lock")}</span><div><b>${this.i18n.t("share.private", "Private and view only")}</b><p>${this.i18n.t("share.privateDetail", "A link grants access to this document and its currently approved media only. It cannot change your work, expose another document, or remain active for more than seven days.")}</p></div></div>
      </div>
    </dialog>`;
  }
  #terms() {
    return html`<dialog class="modal consent-modal" open closedby="none" aria-labelledby="consent-title"><div class="modal-card"><div class="consent-locale-switcher">${this.#localePicker()}</div><span class="eyebrow">${this.i18n.t("consent.governance", "Pilot governance · {version}", { version: this.store.session.get()?.policy.version || "" })}</span><h2 id="consent-title">${this.i18n.t("consent.heading", "Set the rules before creating")}</h2><p>${this.i18n.t("consent.description", "Forma keeps prompts and provider outputs private for {days} days. Optional attention signals remain off until you enable them separately in privacy settings.", { days: this.i18n.number(this.store.session.get()?.policy.retentionDays ?? 30) })}</p><form class="consent-form" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(this.#termsOwnership&&this.#termsProvider&&!this.store.busy.get())void this.store.acceptTerms();}}><label class="consent-check"><input type="checkbox" .checked=${this.#termsOwnership} @change=${(e:Event)=>{this.#termsOwnership=(e.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>${this.i18n.t("consent.ownership", "I control the work I submit")}</b><small>${this.i18n.t("consent.ownershipDetail", "I own it or have permission to use it; external assets require a separate assertion at upload.")}</small></span></label><label class="consent-check"><input type="checkbox" .checked=${this.#termsProvider} @change=${(e:Event)=>{this.#termsProvider=(e.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>${this.i18n.t("consent.provider", "I approve private provider processing")}</b><small>${this.i18n.t("consent.providerDetail", "Relevant creative context may be securely sent to the configured and approved text, image, or video providers.")}</small></span></label><button type="submit" class="button primary consent-action" ?disabled=${!this.#termsOwnership||!this.#termsProvider||!!this.store.busy.get()}>${this.store.busy.get()==="consent" ? this.i18n.t("consent.recording", "Recording…") : this.i18n.t("consent.accept", "Accept pilot terms")}</button></form></div></dialog>`;
  }
  #impersonationWarning(){
    const session=this.store.session.get();const impersonation=session?.impersonation;if(!impersonation)return nothing;const action=this.store.ui.impersonationAction||this.i18n.t("impersonation.defaultAction", "change this fictional account");
    return html`<dialog class="modal impersonation-confirm-dialog" open closedby="any" aria-labelledby="impersonation-confirm-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.resolveImpersonatedInteraction(false);}} @cancel=${(event:Event)=>{event.preventDefault();this.store.resolveImpersonatedInteraction(false);}} @close=${()=>{if(this.store.ui.impersonationConfirmOpen)this.store.resolveImpersonatedInteraction(false);}}><div class="modal-card impersonation-confirm-card"><button class="icon-button modal-close" aria-label=${this.i18n.t("impersonation.cancelInteraction", "Cancel this interaction")} @click=${()=>this.store.resolveImpersonatedInteraction(false)}>${icon("close")}</button><span class="eyebrow">${this.i18n.t("impersonation.safeguard", "Fictional account safeguard")}</span><h2 id="impersonation-confirm-title">${this.i18n.t("impersonation.heading", "You’re acting as {name}", { name: "\u2068" + impersonation.fictionalUser.displayName + "\u2069" })}</h2><p>${this.i18n.t("impersonation.description", "You are about to {action}. This will change the saved mock account and become part of its durable history; it will not change {actor}’s regular account.", { action: "\u2068" + action + "\u2069", actor: "\u2068" + impersonation.actor.displayName + "\u2069" })}</p><div class="impersonation-confirm-note"><span>${icon("lock")}</span><div><b>${this.i18n.t("impersonation.confirmOnly", "Confirm this interaction only")}</b><p>${this.i18n.t("impersonation.confirmDetail", "Canceling, pressing Escape, closing the dialog, or clicking its backdrop prevents the interaction entirely.")}</p></div></div><footer><button class="button ghost" @click=${()=>this.store.resolveImpersonatedInteraction(false)}>${this.i18n.t("impersonation.cancel", "Cancel — do nothing")}</button><button class="button primary" @click=${()=>this.store.resolveImpersonatedInteraction(true)}>${this.i18n.t("impersonation.continue", "I understand, continue")}</button></footer></div></dialog>`;
  }
  #planningConsent(){
    const state=this.store.planningConsent.get();if(!state)return nothing;
    const approved=state.submitted||Boolean(state.recoveryExecutionId)||Boolean(state.quote&&state.quote.status!=="quoted");
    const action=state.quote?(state.submitted||state.recoveryExecutionId?{action:"retrieve",label:"context.consent.reuse",disabled:false}:contextConsentAction(state.quote.status,state.quote.providerAvailable,state.quote.canExecute)):null;
    const canStartNew=state.quote?.status==="completed"&&state.quote.canPrepareNew&&this.store.canPreparePlanning();
    const needsReceipt=Boolean(state.recoveredPlan&&(!state.quote||state.quote.status!=="completed"));
    const close=async()=>{
      if(this.store.planningConsent.get()?.id!==state.id)return;
      const executionId=state.recoveryExecutionId??state.quote?.executionId,authorization=approved?this.store.captureAuthorizationScope():null,route=this.store.route.get();
      // Capture this Close before its own dismissal or any deferred render.
      // An equal route later cannot revive a retired interaction lifetime.
      const returnFocus=approved&&executionId&&authorization?this.#captureShellFocus(()=>{
        const current=this.store.planningConsent.get();return !current||current.id===state.id;
      }):null;
      try{
        this.querySelector<HTMLDialogElement>(".planning-consent-dialog")?.close();this.store.closePlanningConsent();
        if(!approved||!executionId||!authorization||!returnFocus)return;
        await this.updateComplete;
        await Promise.all([...this.querySelectorAll<HTMLElement&{updateComplete?:Promise<unknown>}>("forma-activity")].map(element=>element.updateComplete));
        if(!this.isConnected||!this.store.authorizationScopeActive(authorization)||this.store.route.get()!==route||this.store.planningConsent.get()
          ||!returnFocus.scopeCurrent()||!returnFocus.focus.current())return;
        const owner=this.ownerDocument,active=owner.activeElement as HTMLElement|null;
        if(owner.querySelector?.("dialog:modal"))return;
        // Native return already handles a still-connected opener, including free previews.
        if(active&&active!==owner.body&&active.tagName!=="HTML"&&active.isConnected&&active.getClientRects().length)return;
        const visible=(element:HTMLElement)=>element.isConnected&&!element.hidden&&!element.matches(":disabled")&&!element.closest("[inert],[hidden]")&&element.getClientRects().length>0;
        const target=[...this.querySelectorAll<HTMLElement>("[data-planning-recovery-id]")].find(element=>element.getAttribute("data-planning-recovery-id")===executionId&&visible(element));
        if(target){returnFocus.focus.run(target,()=>{if(!returnFocus.scopeCurrent())return false;target.focus({preventScroll:true});return true;});return;}
        const heading=this.querySelector<HTMLElement>("#main-content h1,main h1,[role='main'] h1")??this.querySelector<HTMLElement>("#main-content");
        if(!heading||!visible(heading))return;
        returnFocus.focus.run(heading,()=>{
          if(!returnFocus.scopeCurrent())return false;
          if(!heading.hasAttribute("tabindex")){heading.setAttribute("tabindex","-1");heading.addEventListener("blur",()=>heading.removeAttribute("tabindex"),{once:true});}
          heading.focus({preventScroll:true});return true;
        });
      }finally{returnFocus?.dispose();}
    };
    return html`<dialog class="modal planning-consent-dialog" data-shell-modal open closedby="any" aria-labelledby="planning-consent-title" aria-describedby="planning-consent-description" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)close();}} @keydown=${(event:KeyboardEvent)=>{if(event.key==="Escape"&&!event.isComposing){event.preventDefault();event.stopPropagation();close();}}} @cancel=${(event:Event)=>{event.preventDefault();close();}} @close=${(event:Event)=>{if(!(event.currentTarget as HTMLDialogElement).open&&this.store.planningConsent.get()?.id===state.id)void close();}}><section class="modal-card context-consent">
      <button type="button" class="icon-button modal-close" aria-label=${this.i18n.t("action.close")} @click=${close}>${icon("close")}</button>
      <h2 id="planning-consent-title">${this.i18n.t("planning.consent.title")}</h2><p id="planning-consent-description">${this.i18n.t("context.consent.description")}</p>
      <blockquote dir="auto">${state.request.prompt}</blockquote>
      ${state.recoveredPlan?html`<section aria-label=${this.i18n.t("planning.consent.recoveredTitle")}><h3>${this.i18n.t("planning.consent.recoveredTitle")}</h3><p role="status">${this.i18n.t("planning.consent.recoveredHint")}</p><p dir="auto">${state.recoveredPlan.interpretation}</p>${state.recoveredPlan.active_decision?html`<h4 dir="auto">${state.recoveredPlan.active_decision.label}</h4><p dir="auto">${state.recoveredPlan.active_decision.prompt}</p><p dir="auto">${state.recoveredPlan.active_decision.why}</p>`:nothing}<ol>${(state.recoveredPlan.suggested_blocks??[]).map((block)=>html`<li><strong dir="auto">${block.label}</strong><p dir="auto">${block.instruction}</p><p dir="auto">${block.reason}</p></li>`)}</ol>${state.recoveredPlan.hidden_until_later?.length?html`<details><summary>${this.i18n.t("planning.consent.later")}</summary><ul>${state.recoveredPlan.hidden_until_later.map((item)=>html`<li dir="auto">${item}</li>`)}</ul></details>`:nothing}</section>`:nothing}
      ${state.quote?consequentialPreview(state.quote,this.i18n):nothing}
      ${state.working?html`<p role="status">${this.i18n.t(approved?"planning.consent.checking":"planning.consent.preparing")}</p>`:nothing}
      ${state.notice?html`<p role="alert">${this.i18n.t(state.notice==="uncertain"?"context.consent.uncertain":state.notice==="refresh"?"context.consent.refresh":state.notice==="not-submitted"?"context.consent.notSubmitted":"planning.consent.failed")}</p>`:nothing}
      ${approved?html`<p>${this.i18n.t("planning.consent.closeHint")}</p>`:nothing}
      <footer><button type="button" class="button ghost" @click=${close}>${this.i18n.t(approved?"planning.consent.closeReview":"action.cancel")}</button>
        ${state.recoveredPlan&&!needsReceipt?nothing:state.quote&&action?html`<button type="button" class="button primary" ?disabled=${state.working||action.disabled} @click=${()=>void this.store.approvePlanningConsent()}>${this.i18n.t(action.action==="execute"?"planning.consent.approve":action.label)}</button>`:html`<button type="button" class="button primary" ?disabled=${state.working} @click=${()=>void this.store.previewPlanningConsent()}>${this.i18n.t(state.recoveryExecutionId?"planning.consent.retrieveExisting":"context.consent.preview")}</button>`}
        ${canStartNew?html`<button type="button" class="button secondary" ?disabled=${state.working} @click=${()=>void this.store.newPlanningPreview()}>${this.i18n.t("planning.consent.newPreview")}</button>`:nothing}
      </footer></section></dialog>`;
  }
  #commandIntentCurrent(owner:CommandOpening){
    const session=this.store.session.get();
    return this.isConnected&&this.#commandEpoch===owner.epoch&&this.i18n.locale===owner.locale&&this.#localeRequest===owner.localeRequest
      &&session?.user.userId===owner.actorId&&(session.impersonation?.actor.userId??session.user.userId)===owner.principalId
      &&(session.impersonation?.impersonationId??null)===owner.impersonationId;
  }
  #commandContextCurrent(owner:CommandOpening){
    return this.#commandIntentCurrent(owner)&&this.store.captureAuthorizationScope()?.key===owner.authorityKey;
  }
  #commandOriginElements(){
    return [...this.querySelectorAll<CommandDepartureOwner>("forma-experience-host,forma-library,forma-projects,forma-activity,forma-workspace,forma-workspace-settings,forma-creative-assistant,forma-sessions,forma-memory,forma-deliver,forma-chat-studio,forma-canvas-surface,forma-creative-editor,forma-context-board,forma-guided-brief,forma-reality-layers,forma-adaptive-path,forma-image-format-editor,forma-output-card")]
      .filter(element=>element.isConnected&&FormaElement.hasStoreIdentity(element,this.store));
  }
  #commandOriginsCurrent(owner:CommandOpening,context?:NavigationPresentationContext){
    const current=this.#commandOriginElements();
    return current.length===owner.origins.length&&owner.origins.every((origin,index)=>
      origin.element===current[index]&&origin.element.isConnected&&FormaElement.hasStoreIdentity(origin.element,this.store)&&origin.current(context));
  }
  #commandReplacesOrigin(choice:CommandChoice,owner:CommandOpening){
    if(!choice.row){
      if(choice.id==="undo"||choice.id==="share"||choice.route===owner.route)return false;
      if(choice.id==="add-context"&&documentViewFromRoute(owner.route)==="document"){
        const workspaces=[...this.querySelectorAll<FormaWorkspace>("forma-workspace")]
          .filter(value=>value.isConnected&&FormaElement.hasStoreIdentity(value,this.store));
        if(workspaces.length===1)return false;
      }
    }
    return true;
  }
  async #restoreCommandOpener(owner:CommandOpening,focus:OutputNavigationFocusLease,current:()=>boolean){
    await this.updateComplete;
    if(!current()||this.store.ui.commandOpen||!focus.current())return;
    const target=owner.opener?.isConnected&&owner.opener.getClientRects().length?owner.opener:this.querySelector<HTMLElement>(".command-trigger");
    if(target)focus.run(target,()=>{target.focus({preventScroll:true});return true;});
  }
  #captureNavigationOpening():CommandOpening|null{
    const session=this.store.session.get(),authorization=this.store.captureAuthorizationScope();if(!session||!authorization)return null;
    const active=this.ownerDocument.activeElement,source=this.store.captureSourceOwnership();
    return {epoch:++this.#commandEpoch,source,sourceReadable:this.store.sourceOwnershipActive(source),authorityKey:authorization.key,
      route:this.store.route.get(),locale:this.i18n.locale,localeRequest:this.#localeRequest,actorId:session.user.userId,
      principalId:session.impersonation?.actor.userId??session.user.userId,impersonationId:session.impersonation?.impersonationId??null,
      opener:active instanceof HTMLElement?active:null,origins:this.#commandOriginElements().map(element=>element.captureCommandDeparture())};
  }
  #openCommands(){
    if(this.#experienceMode())return;
    if(this.store.ui.commandOpen){void this.#closeCommands();return;}
    if(this.ownerDocument.querySelector("dialog[open],.output-requirement-form,.output-plan-review"))return;
    this.#commandRouteFocus?.focus.dispose();this.#commandRouteFocus=null;
    const owner=this.#captureNavigationOpening();if(!owner)return;
    this.#commandOpening=owner;
    this.#commandActiveKey=null;this.#commandChooseFirst=true;this.#commandSelectionChanged=false;this.#commandComposing=false;
    this.store.patchUi({commandOpen:true});
  }
  async #closeCommands(restoreFocus=true,invalidate=true){
    const owner=this.#commandOpening;if(invalidate)this.#commandEpoch++;
    const epoch=this.#commandEpoch;
    this.querySelector<HTMLDialogElement>(".command-dialog")?.close();
    this.#commandOpening=null;this.#commandActiveKey=null;this.#commandComposing=false;this.#commandSelectionChanged=false;
    this.store.patchUi({commandOpen:false,search:""});
    if(!restoreFocus||!owner)return;
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    try{
      await this.#restoreCommandOpener(owner,focus,()=>this.isConnected&&epoch===this.#commandEpoch
        &&this.store.route.get()===owner.route&&this.store.captureAuthorizationScope()?.key===owner.authorityKey);
    }finally{focus.dispose();}
  }
  #commandInputFacts(owner:CommandOpening):CommandDiscoveryInput{
    const projection=this.store.projection.get(),session=this.store.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];
    const readable=["creative","canvas"].includes(applicationIdFromRoute(this.store.route.get()))&&this.#commandContextCurrent(owner)
      &&this.store.sourceOwnershipActive(owner.source)&&permissions.includes("project.read");
    const activity=scopedFormaActivity(session,projection,this.store.projectNotifications.get(),this.store.reviewInbox.get(),this.store.documentJobs.get());
    return{readable,authorityKey:owner.authorityKey,projection,events:this.store.eventView.get(),
      reviews:session?.impersonation?[]:activity.reviews,locale:this.i18n.locale,copy:commandDiscoveryCopy(this.i18n.locale),
      formatLabel:kind=>kind==="image"?this.i18n.t("artifact.image.label","Image"):this.i18n.system(documentArtifactDefinition(kind).label),
      // C1 never borrows a Canvas's private selection or reinterprets board-only source.
      preparation:readable&&applicationIdFromRoute(this.store.route.get())==="creative"&&projection.documentId
        ?nextActionFacts(this.store,projection.documentId,null):null};
  }
  #filteredCommandChoices(owner:CommandOpening){
    const query=this.store.ui.search;
    return this.#commandChoices(owner).map((choice,index)=>({choice,index,score:commandMatchScore(choice,query,this.i18n.locale)}))
      .filter(value=>value.score>=0&&(query.trim()||!value.choice.row||value.choice.id==="generate"))
      .sort((left,right)=>left.score-right.score||left.index-right.index).slice(0,40).map(value=>value.choice);
  }
  #moveCommandSelection(owner:CommandOpening,delta:number){
    if(this.#commandOpening!==owner||!this.#commandContextCurrent(owner))return;
    const choices=this.#filteredCommandChoices(owner),index=choices.findIndex(choice=>choice.key===this.#commandActiveKey);
    const next=index<0?(delta>0?0:choices.length-1):Math.min(choices.length-1,Math.max(0,index+delta));
    this.#commandActiveKey=choices[next]?.key??null;this.#commandChooseFirst=false;this.#commandSelectionChanged=false;this.requestUpdate();
  }
  #captureNavigation(owner:CommandOpening,replaces:boolean,context?:NavigationPresentationContext,presentationCurrent:()=>boolean=()=>true,originRoute:()=>string=()=>owner.route,setupFailureCleanup?:(work:()=>void)=>void,scopeCurrent?:()=>boolean){
    let allowedRouteFocus:(element:Element)=>boolean=()=>false;
    const focus=captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>allowedRouteFocus(element)});
    let expectedFocus=focus,retired:"blocked"|"identity"|null=null,handedOff=false,retained=false;
    let destinationSource:CapturedSourceOwnership|null=null,destinationRoute:{routeCurrent():boolean}|null=null;
    const originScope=()=>this.#commandContextCurrent(owner)&&this.store.route.get()===originRoute()
      &&(!owner.sourceReadable||this.store.sourceOwnershipActive(owner.source));
    const blocked=()=>replaces&&this.#commandOriginsCurrent(owner,context)?owner.origins.find(origin=>origin.blocked(context)):undefined;
    const navigation:CommandNavigation={focus,
      current:()=>{
        if(scopeCurrent&&!scopeCurrent()){retired="identity";return false;}
        const routeHandoff=!handedOff&&Boolean(this.store.captureWorkspaceNavigationFocus(this.store.route.get(),expectedFocus));
        // Keep observing identity even after a dirty refusal. Equality after an
        // intervening route/owner change must not revive its toast or focus.
        if(!this.#commandIntentCurrent(owner)||!handedOff&&!routeHandoff
          &&(!originScope()||replaces&&!this.#commandOriginsCurrent(owner,context)||!presentationCurrent()))retired="identity";
        if(destinationSource){
          if(!this.store.sourceOwnershipActive(destinationSource))retired="identity";
          destinationRoute??=this.store.captureWorkspaceNavigationFocus(this.store.route.get(),expectedFocus);
          if(destinationRoute?!destinationRoute.routeCurrent():this.store.route.get()!==originRoute())retired="identity";
        }
        if(retired)return false;
        if(routeHandoff)handedOff=true;
        if(!handedOff&&blocked())retired="blocked";
        return !retired;
      },
      // Store calls this at its first positive publication/adoption boundary.
      handoff:()=>{if(!navigation.current()||!focus.current())return false;handedOff=true;return true;},
      adoptSource:source=>{
        if(!handedOff||destinationSource||!navigation.current()||!focus.current()||this.store.route.get()!==originRoute()
          ||!this.store.sourceOwnershipActive(source))return false;
        destinationSource=source;return navigation.current()&&focus.current();
      },
      bind:(lease,allowed)=>{expectedFocus=lease;allowedRouteFocus=allowed;},
      retain:()=>{retained=true;},
    };
    let unsubscribe:()=>void;
    try{unsubscribe=this.store.subscribe(()=>{navigation.current();});}
    catch(reason){if(setupFailureCleanup)setupFailureCleanup(()=>focus.dispose());throw reason;}
    const reportUnavailable=():NavigationRefusal|undefined=>{
      if(retired==="identity"||!this.#commandContextCurrent(owner))return;
      const refusal=originScope()?blocked():undefined;
      this.store.toast(refusal?this.i18n.t(refusal.reason()):commandDiscoveryCopy(this.i18n.locale).unavailable);
      return refusal?"current-work":"unavailable";
    };
    return {navigation,originScope,blocked,reportUnavailable,
      sourceCurrent:()=>navigation.current()&&(destinationSource!==null||this.#commandContextCurrent(owner)),
      destinationSourceCurrent:()=>navigation.current()&&this.store.sourceOwnershipActive(destinationSource??owner.source),
      refusalCurrent:()=>retired!=="identity"&&originScope(),
      dispose:(observe?:(work:()=>void)=>void)=>{
        if(observe){observe(unsubscribe);if(!retained)observe(()=>focus.dispose());}
        else{unsubscribe();if(!retained)focus.dispose();}
      }};
  }
  // Only this retained route owner releases the exact supplied lease.
  // Assigned-review borrowers keep their caller's post-arrival validation.
  releaseExactRetainedArtifactFocus(route:string,focus:OutputNavigationFocusLease){
    const retained=this.#commandRouteFocus;
    if(!retained||retained.route!==route||retained.focus!==focus
      ||libraryFocusFromRoute(route)?.kind!=="artifact")return;
    this.#commandRouteFocus=null;retained.focus.dispose();
  }
  #joinRetainedArtifactOpening(route:string,focus:OutputNavigationFocusLease){
    const retained=this.#commandRouteFocus;
    if(!retained||retained.route!==route||retained.focus!==focus
      ||libraryFocusFromRoute(route)?.kind!=="artifact")return;
    const library=this.querySelector<FormaLibrary>("forma-library");
    if(!library?.isConnected||library.closest("forma-shell")!==this
      ||!FormaElement.hasStoreIdentity(library,this.store))return;
    const opening=library.artifactRouteOpeningCompletion(route,focus);
    if(!opening)return;
    // Completion may precede retain registration. Joining the already-settled
    // original Promise complements Library's later settlement notification.
    const release=()=>{if(this.#commandRouteFocus===retained)this.releaseExactRetainedArtifactFocus(route,focus);};
    void opening.then(release,release);
  }
  /** One registered owner's exact consumed-form operation; no route or focus lease is acquired. */
  async performOperationFrom(origin:FormaElement,operation:string,event:Event):Promise<void>{
    if(!this.isConnected||!origin.isConnected||!this.contains(origin)||origin.closest("forma-shell")!==this
      ||!FormaElement.hasStoreIdentity(origin,this.store)||this.store.ui.commandOpen)return;
    const registered=this.#commandOriginElements().find(element=>element===origin),capture=registered?.captureCommandOperation;
    if(!registered||typeof capture!=="function")return;
    const consumed=capture.call(registered,operation,event);
    if(!consumed||consumed.element!==origin||typeof consumed.start!=="function")return;
    const owner=this.#captureNavigationOpening(),store=this.store;
    const original=owner?.origins.find(value=>value.element===origin);
    if(!owner||!original)return;
    // Substitute only the operation consumed by this actual owner. Later
    // captures still see its pending work; every sibling capture stays exact.
    owner.origins=owner.origins.map(value=>value===original?{
      element:origin,current:()=>original.current()&&consumed.current(),
      blocked:()=>consumed.blocked(),reason:()=>consumed.reason(),
    }:value);
    let disposed=false,retired:"identity"|"blocked"|null=null,unsubscribe=()=>{};
    const identityCurrent=()=>this.store===store&&this.#commandContextCurrent(owner)
      &&store.route.get()===owner.route&&store.sourceOwnershipActive(owner.source)
      &&this.#commandOriginsCurrent(owner);
    const blocked=()=>owner.origins.find(value=>value.blocked());
    const current=()=>{
      if(disposed)return false;
      if(!identityCurrent())retired="identity";
      if(retired)return false;
      if(blocked())retired="blocked";
      return !retired;
    };
    const dispose=()=>{if(disposed)return;disposed=true;unsubscribe();};
    const reportRefusal=()=>{
      if(retired==="identity"||!identityCurrent())return;
      const refusal=blocked();
      if(refusal)store.toast(this.i18n.t(refusal.reason()));
    };
    if(!current()){reportRefusal();dispose();return;}
    unsubscribe=store.subscribe(()=>{current();});
    try{
      // Start is synchronous up to the owner's first await. Its original
      // Store call alone consumes current(); never recheck it after publication.
      await consumed.start({current,dispose});
    }finally{dispose();}
  }

  /** Deliberate UI navigation only; internal save, recovery and permission retirement do not call this. */
  async navigateFrom(origin:FormaElement,run:InAppNavigationAction,preferences:NavigationPresentationContext={}):Promise<boolean>{
    return this.#navigateFrom(origin,run,preferences);
  }
  #recordNativeImageCleanup(image:NativeImageNavigationAttempt,phase:NativeImageShellNavigationReceipt["cleanups"][number]["phase"],work:()=>void){
    let outcome:PromiseSettledResult<void>;
    try{work();outcome=Object.freeze({status:"fulfilled",value:undefined});}
    catch(reason){outcome=Object.freeze({status:"rejected",reason});}
    image.cleanups.push(Object.freeze({phase,outcome}));
  }
  async #navigateNativeImageFrom(origin:FormaElement,target:NativeImageEditTarget,current:()=>boolean,
    retire:()=>PromiseSettledResult<void>,startup:NativeImageWorkspaceStartup):Promise<NativeImageShellNavigationReceipt>{
    const image:NativeImageNavigationAttempt={current,scopeCurrent:()=>false,retire,startup,accepted:false,navigation:null,reporting:[],cleanups:[],cleanup:null};
    try{
      const store=this.store,document=this.ownerDocument;
      let scopeRetired=false;
      image.scopeCurrent=()=>{
        if(!this.isConnected||this.store!==store||this.ownerDocument!==document)scopeRetired=true;
        return !scopeRetired;
      };
      const opened=await this.#navigateFrom(origin,options=>{
        return store.openDocument(target.documentId,withDocumentInRoute("/",target.documentId,store.projection.get().documentTitle),
          "native-image",{...options,nativeImageStartup:startup});
      },{},image);
      // The shared core may have converted a thrown original to its legacy
      // boolean. Keep that original rejection, including a reason of undefined.
      image.navigation??=Object.freeze({status:"fulfilled",value:opened});
    }catch(reason){image.navigation??=Object.freeze({status:"rejected",reason});}
    finally{image.cleanup?.();}
    return Object.freeze({navigation:image.navigation!,reporting:Object.freeze(image.reporting),cleanups:Object.freeze(image.cleanups)});
  }
  async #navigateFrom(origin:FormaElement,run:InAppNavigationAction,preferences:NavigationPresentationContext={},image?:NativeImageNavigationAttempt):Promise<boolean>{
    if(!this.isConnected||!origin.isConnected||!this.contains(origin)||!FormaElement.hasStoreIdentity(origin,this.store)
      ||this.store.ui.commandOpen)return false;
    const presentation=preferences.presentation,opener=presentation?.opener;
    let presentationClosed=false,nativeClosed=false,nativeCloseEvent=false;
    let nativeClosing:NavigationClosingPresentation|null=null,cancelNativeClose:(()=>void)|null=null;
    let nativeAfterCloseRoute:string|undefined,nativeDestination:string|undefined;
    const presentationCurrent=()=>(!image||image.scopeCurrent()&&(image.accepted||image.current()))&&(!presentation||presentation.owner===origin&&origin.isConnected
      &&origin.closest("forma-shell")===this&&FormaElement.hasStoreIdentity(origin,this.store)
      &&(presentationClosed?(!nativeClosing||navigationPresentationClosing({closingPresentation:nativeClosing},origin))
        :navigationPresentationCurrent(presentation)));
    if(!presentationCurrent()||opener&&(!opener.isConnected||opener.ownerDocument!==this.ownerDocument
      ||!this.contains(opener)||opener.closest("forma-shell")!==this))return false;
    const context:NavigationPresentationContext|undefined=presentation?{
      get presentation(){return presentationClosed?undefined:presentation;},
      get closingPresentation(){return nativeClosing??undefined;},
    }:undefined;
    const owner=this.#captureNavigationOpening();if(!owner)return false;
    const localRoute=typeof run==="function"?null:run.localRoute;
    let local:LocalNavigation|null=null;
    if(typeof run!=="function"){
      const original=owner.origins.find(value=>value.element===origin);
      const capture=(origin as CommandDepartureOwner).captureLocalNavigation;
      if(!original||typeof localRoute!=="string"||typeof capture!=="function")return false;
      local=capture.call(origin,localRoute);
      if(!local||local.element!==origin||typeof local.prepare!=="function"||!original.current()||!local.current())return false;
      const retained=local;
      // Only this registered owner's own exact local transition changes its
      // predicate. All sibling captures and the original owner identity stay.
      owner.origins=owner.origins.map(value=>value===original?{
        element:origin,current:context=>original.current(context)&&retained.current(context),
        blocked:context=>retained.blocked(context),reason:()=>retained.reason(),
      }:value);
    }
    let expectedOriginRoute=owner.route;
    const originRoute=()=>{
      const path=this.store.route.get();
      // Only the actual original close target chain may consume its one fixed root.
      // Any other observed route retires the existing capture and cannot revive it.
      if(nativeCloseEvent&&expectedOriginRoute===owner.route&&nativeAfterCloseRoute===path)expectedOriginRoute=path;
      return expectedOriginRoute;
    };
    const captured=this.#captureNavigation(owner,true,context,presentationCurrent,originRoute,
      image?work=>this.#recordNativeImageCleanup(image,"navigation-dispose",work):undefined,image?.scopeCurrent),navigation=captured.navigation,focus=navigation.focus;
    if(image)image.cleanup=()=>{
      // Even a failure during the setup below still reaches this owner. Cancel
      // and navigation release do not mask one another or the original result.
      this.#recordNativeImageCleanup(image,"cancel-native-close",()=>{cancelNativeClose?.();});
      nativeClosing=null;
      captured.dispose(work=>this.#recordNativeImageCleanup(image,"navigation-dispose",work));
    };
    const current=()=>captured.sourceCurrent()&&focus.current();
    const active=this.ownerDocument.activeElement,popover=active?.closest<HTMLElement>("[popover]:popover-open");
    const popoverId=popover?.getAttribute("id");
    const invokers=popoverId?[...this.querySelectorAll<HTMLElement>("[popovertarget]")]
      .filter(element=>element.getAttribute("popovertarget")===popoverId):[];
    const invoker=invokers.length===1?invokers[0]:null;
    let destinationFocus:((element:Element)=>boolean)|null=null;
    const ownedDestinationFocus=(element:Element)=>Boolean(destinationFocus
      &&this.store.captureWorkspaceNavigationFocus(this.store.route.get(),focus)?.routeCurrent()
      &&captured.destinationSourceCurrent()&&destinationFocus(element));
    // Only this same-lease Store-issued route may own its exact block anchor.
    // routeCurrent is deliberately focus-free, avoiding focus.current recursion.
    const linkedBlockFocus=(element:Element)=>{
      const route=this.store.route.get(),arrival=this.store.captureWorkspaceNavigationFocus(route,focus);
      const documentId=documentIdFromRoute(route),blockId=documentContextBlockFromRoute(route);
      const current=()=>Boolean(arrival?.routeCurrent())&&captured.sourceCurrent()
        &&(nativeClosed?captured.destinationSourceCurrent():this.store.sourceOwnershipActive(owner.source));
      return Boolean(documentId&&blockId&&current()
        &&outputNavigationOwnedRouteFocus(this.ownerDocument,this.store,{documentId,blockId},current)(element));
    };
    navigation.bind(focus,element=>Boolean(this.store.captureWorkspaceNavigationFocus(this.store.route.get(),focus))
      &&element===this.querySelector("#main-content")
      ||linkedBlockFocus(element)||ownedDestinationFocus(element)
      ||element===invoker&&Boolean(invoker?.isConnected&&popover?.isConnected&&!popover.matches(":popover-open"))
        &&captured.refusalCurrent()&&this.#commandOriginsCurrent(owner,context)
      ||element===opener&&Boolean(presentationClosed&&opener?.isConnected
        &&!opener.closest("[hidden],[inert]")&&!opener.matches(":disabled")
        &&(presentation?.element.tagName!=="DIALOG"||!(presentation.element as HTMLDialogElement).open))
        &&(captured.refusalCurrent()&&this.#commandOriginsCurrent(owner,context)
          ||nativeClosed&&nativeDestination===this.store.route.get()
            &&Boolean(this.store.captureWorkspaceNavigationFocus(this.store.route.get(),focus)?.routeCurrent())
            &&captured.destinationSourceCurrent()));
    const options={current,focus,onOriginHandoff:()=>{
      if(!image)return navigation.handoff();
      if(image.accepted)return navigation.current()&&focus.current();
      if(!image.current()||!navigation.handoff())return false;
      // This latch precedes retirement: Store's accepted navigation must not
      // consult the origin lifetime that the handoff intentionally retires.
      image.accepted=true;
      try{
        this.#nativeImageHost.retainStartupFocus(image.startup,()=>focus.dispose());
        navigation.retain();
      }finally{
        let outcome:PromiseSettledResult<void>;
        try{outcome=image.retire();}catch(reason){outcome=Object.freeze({status:"rejected",reason});}
        image.cleanups.push(Object.freeze({phase:"origin-retire",outcome}));
      }
      return true;
    },onDestinationSource:(source:CapturedSourceOwnership)=>navigation.adoptSource(source)};
    const reportUnavailable=()=>{if(image)return;const reason=captured.reportUnavailable();if(reason)preferences.onRefusal?.(reason);};
    const retainArtifactOpening=(opened:boolean,sameRoute=false)=>{
      const route=this.store.route.get(),linked=libraryFocusFromRoute(route);
      if(!opened||linked?.kind!=="artifact"||route===owner.route&&!sameRoute)return opened;
      const source=this.store.captureSourceOwnership(),arrival=this.store.captureWorkspaceNavigationFocus(route,focus);
      const artifact=this.store.projection.get().libraryArtifacts.find(value=>value.id===linked.id);
      if(!current()||!source||!artifact||!arrival?.current())return false;
      const target={id:artifact.id,documentId:artifact.documentId,sequence:artifact.sequence,
        sourceEventId:artifact.sourceEventId,contentRef:artifact.contentRef};
      const routeCurrent=()=>captured.sourceCurrent()&&this.store.sourceOwnershipActive(source)
        &&arrival.routeCurrent()&&this.store.route.get()===route
        &&this.store.projection.get().libraryArtifacts.some(value=>value.id===target.id
          &&value.documentId===target.documentId&&value.sequence===target.sequence
          &&value.sourceEventId===target.sourceEventId&&value.contentRef===target.contentRef);
      navigation.bind(focus,element=>{
        if(!routeCurrent())return false;
        if(element===this.querySelector("#main-content"))return true;
        const library=this.querySelector<FormaLibrary>("forma-library"),dialog=element.closest<HTMLDialogElement>("dialog");
        const viewer=library?.querySelector("forma-document-artifacts");
        return Boolean(library?.isConnected&&FormaElement.hasStoreIdentity(library,this.store)
          &&viewer?.isConnected&&viewer.documentId===target.documentId&&dialog?.open
          &&dialog===viewer.querySelector(".document-artifact-view")&&dialog.closest("forma-library")===library);
      });
      // Reuse the existing route-owned lease until Library's exact async
      // opening retires. Do not dispose it at the route-only return.
      if(this.#commandRouteFocus?.focus!==focus)this.#commandRouteFocus?.focus.dispose();
      this.#commandRouteFocus={route,focus,current:()=>routeCurrent()&&arrival.current()};
      navigation.retain();
      this.#joinRetainedArtifactOpening(route,focus);
      return true;
    };
    const runLocal=async()=>{
      const retained=local,store=this.store;
      if(!retained||localRoute===null||retained.prepare()!==true||!current())return false;
      const opened=await this.store.transitionWorkspace(localRoute,options);
      if(!retainArtifactOpening(opened,true))return false;
      if(!retained.afterCommit)return true;
      const route=store.route.get(),arrival=store.captureWorkspaceNavigationFocus(route,focus);
      let arrivalRetired=false;
      const routeCurrent=()=>{
        if(this.store!==store||!origin.isConnected||origin.closest("forma-shell")!==this||!this.contains(origin)
          ||!FormaElement.hasStoreIdentity(origin,store)||!captured.destinationSourceCurrent()
          ||!arrival?.routeCurrent()||store.route.get()!==route)arrivalRetired=true;
        return !arrivalRetired;
      };
      const arrivalCurrent=()=>routeCurrent()&&focus.current();
      if(!arrivalCurrent())return false;
      await retained.afterCommit({current:arrivalCurrent,focus});
      // The final owner focus.run may intentionally consume this same lease.
      // Only its committed route/source remain to validate after completion.
      return routeCurrent();
    };
    try{
      if(!current()){
        if(!image&&captured.refusalCurrent()&&captured.blocked())reportUnavailable();
        return false;
      }
      const result=typeof run==="function"?await run({...options,
        bindDestinationFocus:allowed=>{
          if(destinationFocus||!current()||presentation&&!presentationClosed)return false;
          destinationFocus=allowed;return true;
        },
        openAssignedReview:task=>presentation&&!presentationClosed?Promise.resolve(false):this.#openAssignedReview(task,owner,navigation),
        closePresentation:close=>{
          if(!presentation||presentationClosed||!current())return false;
          // Remove only this exception before cleanup. New raw work or another
          // presentation still blocks through the unchanged captured owners.
          presentationClosed=true;close();return current();
        },
        closeNativePresentation:async(close,options)=>{
          const element=presentation?.element,parent=options.parent;
          if(!presentation||presentationClosed||!current()||element?.tagName!=="DIALOG"
            ||!parent.isConnected||!parent.contains(origin)||parent.closest("forma-shell")!==this
            ||!FormaElement.hasStoreIdentity(parent,this.store))return false;
          const after=options.afterCloseRoute;
          if(after!==undefined&&(!parent.matches("forma-library")||origin.closest("forma-library")!==parent
            ||parent.querySelector("forma-document-artifacts")!==origin
            ||libraryFocusFromRoute(owner.route)?.kind!=="artifact"||after!==libraryRootRoute(owner.route)))return false;
          let closeReturned=false;const closeStore=this.store;
          nativeClosing={presentation,parent,
            get originalRoute(){return after!==undefined&&expectedOriginRoute===after&&closeStore.route.get()===after?owner.route:undefined;},
            closedCurrent:()=>parent.closest("forma-shell")===this
              &&FormaElement.hasStoreIdentity(parent,this.store)&&(closeReturned?options.closedCurrent():presentation.current())};
          nativeAfterCloseRoute=after;presentationClosed=true;
          const cancelRetired=()=>{if(!current())cancelNativeClose?.();};
          const stopClosing=this.store.subscribe(cancelRetired);
          for(const type of ["pointerdown","keydown","focusin"])this.ownerDocument.addEventListener(type,cancelRetired,true);
          try{
            const closed=await joinNativeDialogClose(element as HTMLDialogElement,{
              current,close:()=>close(current),closing:value=>{nativeCloseEvent=value;},returned:()=>{closeReturned=true;},
              cancellation:value=>{cancelNativeClose=value;},
            });
            if(!closed||(element as HTMLDialogElement).open||!options.closedCurrent()||!current())return false;
            nativeClosed=true;return true;
          }finally{
            stopClosing();for(const type of ["pointerdown","keydown","focusin"])this.ownerDocument.removeEventListener(type,cancelRetired,true);
            nativeCloseEvent=false;nativeAfterCloseRoute=undefined;if(!nativeClosed)nativeClosing=null;
          }
        },
        route:(path,preferences)=>{
          if(nativeClosed)nativeDestination=path;
          const opened=this.#route(path,{...options,...preferences},false);
          return typeof opened==="boolean"?retainArtifactOpening(opened):opened.then(retainArtifactOpening);
        }}):await runLocal();
      if(image)image.navigation=Object.freeze({status:"fulfilled",value:result!==false});
      if(!image&&result===false&&focus.current())reportUnavailable();
      return result!==false;
    }catch(reason){if(image)image.navigation=Object.freeze({status:"rejected",reason});else if(focus.current())reportUnavailable();return false;}
    finally{if(!image){(cancelNativeClose as (()=>void)|null)?.();nativeClosing=null;captured.dispose();}}
  }
  async #runCommand(key:string|null,owner:CommandOpening){
    if(this.#experienceMode()||!key||this.#commandComposing||this.#commandOpening!==owner||!this.#commandContextCurrent(owner)||this.store.route.get()!==owner.route)return;
    const choice=this.#filteredCommandChoices(owner).find(value=>value.key===key);if(!choice)return;
    if(choice.row&&!commandDiscoveryTargetAvailable(choice.row,this.#commandInputFacts(owner)))return;
    const replaces=this.#commandReplacesOrigin(choice,owner);
    // Native close is synchronous on this false-restore path. Capture the one
    // gesture lease before yielding; a later gesture cannot acquire it again.
    const closing=this.#closeCommands(false,false);
    const captured=this.#captureNavigation(owner,replaces);
    const {navigation,originScope,blocked,reportUnavailable}=captured,focus=navigation.focus;
    try{
      await closing;
      if(this.#experienceMode()||!navigation.current()||!focus.current()){
        if(captured.refusalCurrent()&&blocked()){
          reportUnavailable();
          await this.#restoreCommandOpener(owner,focus,()=>captured.refusalCurrent()&&this.#commandOriginsCurrent(owner));
        }
        return;
      }
      if(choice.row){
        const opened=await this.#openCommandTarget(choice.row,owner,navigation);
        if(!opened)reportUnavailable();
      }else{
        const current=this.#commandChoices(owner).find(value=>value.key===key);if(!current)return;
        if(current.route===owner.route){
          await this.#restoreCommandOpener(owner,focus,()=>navigation.current()&&originScope());
        }else if(current.id==="add-context")await this.#openContextComposer(()=>this.#commandContextCurrent(owner),navigation);
        else if(current.route!==undefined){
          navigation.bind(focus,element=>Boolean(this.store.captureWorkspaceNavigationFocus(this.store.route.get(),focus))
            &&element===this.querySelector("#main-content"));
          await this.#route(current.route,{current:()=>navigation.current()&&this.#commandContextCurrent(owner),focus,onOriginHandoff:()=>navigation.handoff()});
        }else await current.run?.();
      }
    }catch{reportUnavailable();}
    finally{captured.dispose();}
  }
  async #openAssignedReview(task:AssignedReviewTask,owner:CommandOpening,navigation:CommandNavigation):Promise<boolean>{
    if(!navigation.current()||!this.#commandContextCurrent(owner)||!this.store.sourceOwnershipActive(owner.source))return false;
    const identity=commandReviewIdentity(task);
    // Settings can show another assigned project's envelope. Command discovery
    // keeps its existing scoped selection before entering this shared receiver.
    if(this.store.reviewInbox.get().filter(value=>commandReviewMatches(identity,value)).length!==1)return false;
    // Store owns the context handshake. Bind its exact committed destination once,
    // then join Library's existing opening instead of treating a route as arrival.
    const signature=JSON.stringify(identity);
    let arrival:{route:string;source:CapturedSourceOwnership;authorityKey:string}|null=null;
    const destinationCurrent=()=>{
      const route=this.store.route.get(),session=this.store.session.get(),context=session?.projectContext;
      const linked=libraryFocusFromRoute(route),options=artifactFocusOptionsFromRoute(route);
      if(!this.#commandIntentCurrent(owner)||JSON.stringify(commandReviewIdentity(task))!==signature
        ||!this.store.captureWorkspaceNavigationFocus(route,focus)||!session||session.impersonation
        ||context?.organizationId!==task.organizationId||context.projectAccessId!==task.projectAccessId
        ||context.projectId!==task.projectId||!context.permissions.includes("project.review.approve")
        ||linked?.kind!=="artifact"||linked.id!==task.artifactId||!options||options==="invalid"
        ||options.expectedRevision!==task.revision||options.expectedContentSha256!==task.contentSha256||options.intent!=="review"
        ||this.store.reviewInbox.get().filter(value=>commandReviewMatches(identity,value)).length!==1)return false;
      if(!arrival){
        const source=this.store.captureSourceOwnership(),authorization=this.store.captureAuthorizationScope();
        if(!source||!authorization||!this.store.sourceOwnershipActive(source))return false;
        arrival={route,source,authorityKey:authorization.key};
      }
      return route===arrival.route&&this.store.sourceOwnershipActive(arrival.source)
        &&this.store.captureAuthorizationScope()?.key===arrival.authorityKey;
    };
    const nativeFocus=navigation.focus;
    const ownedRouteFocus=(element:Element)=>{
      if(!destinationCurrent())return false;
      if(element===this.querySelector("#main-content"))return true;
      const dialog=element.closest<HTMLDialogElement>("dialog"),library=dialog?.closest<FormaLibrary>("forma-library");
      const viewer=dialog?.closest("forma-document-artifacts");
      return Boolean(dialog?.matches(".document-artifact-view")&&library?.isConnected&&FormaElement.hasStoreIdentity(library,this.store)
        &&viewer?.documentId===task.documentId);
    };
    // One native lease: the wrapper carries the same command/task owner into
    // the existing route opening; it does not acquire another focus lifetime.
    const focus:OutputNavigationFocusLease={
      current:()=>navigation.current()&&this.#commandIntentCurrent(owner)
        &&(!arrival&&!this.store.captureWorkspaceNavigationFocus(this.store.route.get(),focus)||destinationCurrent())
        &&nativeFocus.current(),
      run:(element,action)=>focus.current()&&nativeFocus.run(element,()=>focus.current()&&action()),
      dispose:()=>nativeFocus.dispose(),
    };
    navigation.bind(focus,ownedRouteFocus);
    try{
      if(!await this.store.openAssignedReview(task,{current:()=>focus.current(),focus,onOriginHandoff:()=>navigation.handoff(),onDestinationSource:source=>navigation.adoptSource(source)})||!destinationCurrent()||!focus.current())return false;
      // Module readiness is asynchronous; animation frames only wait for the
      // connected renderer after the existing route import has completed.
      await loadRouteComponent(this.store.route.get());
      if(!destinationCurrent()||!focus.current())return false;
      for(let attempt=0;attempt<24&&destinationCurrent()&&focus.current();attempt++){
        await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
        if(!destinationCurrent()||!focus.current())return false;
        const libraries=[...this.ownerDocument.querySelectorAll<FormaLibrary>("forma-library")]
          .filter(value=>value.isConnected&&FormaElement.hasStoreIdentity(value,this.store));
        if(libraries.length>1)return false;
        if(libraries.length===1)return await libraries[0].awaitArtifactRouteOpening(identity,
          {current:()=>destinationCurrent()&&focus.current()})&&destinationCurrent()&&focus.current();
      }
      return false;
    }finally{focus.dispose();}
  }
  async #openCommandTarget(row:CommandDiscoveryRow,owner:CommandOpening,navigation:CommandNavigation):Promise<boolean>{
    const target=row.target,sourceCurrent=()=>this.#commandContextCurrent(owner)&&this.store.sourceOwnershipActive(owner.source);
    if(!sourceCurrent()||!commandDiscoveryTargetAvailable(row,this.#commandInputFacts(owner)))return false;
    if(target.kind==="review"){
      const session=this.store.session.get(),projection=this.store.projection.get();
      const activity=scopedFormaActivity(session,projection,this.store.projectNotifications.get(),this.store.reviewInbox.get(),this.store.documentJobs.get());
      const task=activity.reviews.find(value=>commandReviewMatches(target.identity,value));
      return task?this.#openAssignedReview(task,owner,navigation):false;
    }
    const projection=this.store.projection.get();
    const documentId=target.kind==="prepare"?target.target.documentId:target.kind==="project"?projection.documentId:target.documentId;
    const documentTitle=projection.documents.find(value=>value.id===documentId)?.title??"";
    const documentRoute=withDocumentInRoute("/",documentId,documentTitle);
    const destination=target.kind==="project"?"/studio/project":target.kind==="document"||target.kind==="prepare"?documentRoute
      :target.kind==="decision"?target.scope==="document"?documentContextBlockRoute(documentId,documentTitle,target.blockId):libraryFocusRoute("block",target.blockId,row.label,owner.route)
      :target.kind==="image"?libraryFocusRoute("output",target.outputId,row.label,documentRoute)
      :artifactFocusRoute(target.artifactId,row.label,{expectedRevision:target.revision,intent:"inspect"},documentRoute);
    let handedOff=false,focusTransferred=false;
    const targetCurrent=()=>sourceCurrent()&&(handedOff&&target.kind==="prepare"
      ?creativePreparationTargetAvailable(target.target,nextActionFacts(this.store,target.target.documentId,null),"editing")
      :commandDiscoveryTargetAvailable(row,this.#commandInputFacts(owner)));
    const ownedDestination=()=>Boolean(this.store.captureWorkspaceNavigationFocus(this.store.route.get(),focus));
    const blockFocus=target.kind==="decision"&&target.scope==="document"
      ?outputNavigationOwnedRouteFocus(this.ownerDocument,this.store,{documentId,blockId:target.blockId},targetCurrent):()=>false;
    const focus=navigation.focus;
    navigation.bind(focus,element=>{
      if(!targetCurrent()||!ownedDestination())return false;
      const workspace=this.querySelector<FormaWorkspace>("forma-workspace");
      if(element===this.querySelector("#main-content"))return true;
      if(blockFocus(element))return true;
      if(target.kind==="image"||target.kind==="artifact"||target.kind==="decision"&&target.scope!=="document"){
        const linked=libraryFocusFromRoute(this.store.route.get()),kind=target.kind==="image"?"output":target.kind==="artifact"?"artifact":"block";
        const id=target.kind==="image"?target.outputId:target.kind==="artifact"?target.artifactId:target.blockId;
        const library=this.querySelector<FormaLibrary>("forma-library"),dialog=element.closest("dialog");
        return Boolean(linked?.kind===kind&&linked.id===id&&library&&FormaElement.hasStoreIdentity(library,this.store)&&dialog?.open&&library.contains(dialog)
          &&dialog.matches(kind==="artifact"?".document-artifact-view":".library-focus-dialog"));
      }
      if(target.kind!=="prepare"||!workspace||!FormaElement.hasStoreIdentity(workspace,this.store)||this.store.projection.get().documentId!==documentId)return false;
      if(target.target.medium&&workspace.isConnected&&element.isConnected
        &&documentIdFromRoute(this.store.route.get())===documentId
        &&element===workspace.querySelector<HTMLElement>('[data-workbench-pane="result"]')
        &&element.getAttribute("aria-pressed")==="true")return true;
      const dialog=element.closest("dialog");
      return Boolean(dialog?.open&&workspace.contains(dialog)&&dialog.matches(".next-format-dialog,.generation-details-dialog,.document-artifact-create"));
    });
    const current=()=>navigation.current()&&targetCurrent()&&focus.current()&&(this.store.route.get()===owner.route||ownedDestination());
    // The project path can call transitionWorkspace and then openProject.
    // Consume this one callback at whichever Store boundary is first.
    let onOriginHandoff:(()=>boolean)|undefined=()=>{
      if(!navigation.handoff())return false;
      onOriginHandoff=undefined;return true;
    };
    try{
      if(target.kind==="project"){
        if(applicationIdFromRoute(this.store.route.get())!==applicationIdFromRoute(destination)
          &&!await this.store.transitionWorkspace(destination,{current,focus,documentId,onOriginHandoff}))return false;
        const result=await this.store.openProject(target.projectId,destination,{current,focus,onOriginHandoff});
        return Boolean(result&&current()&&this.store.projection.get().projectId===target.projectId);
      }
      if(applicationIdFromRoute(this.store.route.get())!==applicationIdFromRoute(destination)){
        if(!await this.store.transitionWorkspace(destination,{current,focus,documentId,onOriginHandoff}))return false;
      }else if(target.kind==="decision"&&target.scope!=="document")this.store.setRoute(destination,{current,focus,onOriginHandoff});
      else if(!await this.store.openDocument(documentId,destination,"command-menu",{current,focus,onOriginHandoff}))return false;
      const arrived=this.store.route.get(),arrivalNavigation=this.store.captureWorkspaceNavigationFocus(arrived,focus);
      const arrivedCurrent=()=>targetCurrent()&&Boolean(arrivalNavigation?.current())&&this.store.route.get()===arrived;
      if(!arrivedCurrent())return false;
      if(target.kind!=="prepare"){
        // The existing Workspace or Library owns its asynchronous exact
        // opening. Keep the same lease until that route's owner retires it.
        if(target.kind==="artifact"||target.kind==="decision"&&target.scope==="document"){
          this.#commandRouteFocus?.focus.dispose();this.#commandRouteFocus={route:arrived,focus,current:arrivedCurrent};focusTransferred=true;navigation.retain();
          if(target.kind==="artifact")this.#joinRetainedArtifactOpening(arrived,focus);
        }
        return true;
      }
      await loadRouteComponent(arrived);if(!arrivedCurrent())return false;
      await this.updateComplete;if(!arrivedCurrent())return false;
      const workspace=this.querySelector<FormaWorkspace>("forma-workspace");
      if(!workspace||!FormaElement.hasStoreIdentity(workspace,this.store))return false;
      await workspace.updateComplete;if(!arrivedCurrent()||workspace!==this.querySelector("forma-workspace"))return false;
      const required=(stage:CreativePreparationStage)=>sourceCurrent()&&this.store.route.get()===arrived
        &&workspace.isConnected&&workspace===this.querySelector("forma-workspace")
        &&creativePreparationTargetAvailable(target.target,nextActionFacts(this.store,documentId,null),stage)
        &&(handedOff||focus.current());
      const opened=await workspace.openOutputPreparation(target.target,{current:required,focus});
      if(opened)handedOff=true;
      return opened;
    }finally{if(!focusTransferred)focus.dispose();}
  }
  async #openContextComposer(callerCurrent:()=>boolean=()=>true,navigationOwner?:CommandNavigation){
    if(this.#experienceMode())return;
    const request=++this.#contextOpening,epoch=this.#commandEpoch,projection=this.store.projection.get();
    if(!projection.documentId){this.store.toast("Open a document before adding a creative decision.");return;}
    const source=this.store.captureSourceOwnership(),authorization=this.store.captureAuthorizationScope();
    if(!source||!authorization||!this.store.sourceOwnershipActive(source))return;
    const originRoute=this.store.route.get();
    let arrivedRoute=originRoute,navigation:{current:()=>boolean}|null=null,admitted=false;
    const scopeCurrent=()=>!this.#experienceMode()&&this.isConnected&&request===this.#contextOpening&&epoch===this.#commandEpoch&&callerCurrent()
      &&this.store.sourceOwnershipActive(source)&&this.store.authorizationScopeActive(authorization)
      &&this.store.projection.get().projectId===projection.projectId&&this.store.projection.get().documentId===projection.documentId;
    const workspaceNow=()=>{
      const matches=[...this.querySelectorAll<FormaWorkspace>("forma-workspace")]
        .filter(value=>value.isConnected&&FormaElement.hasStoreIdentity(value,this.store));
      return matches.length===1?matches[0]:null;
    };
    const ownsRoute=()=>this.store.route.get()===arrivedRoute
      &&(!navigation||Boolean(this.store.captureWorkspaceNavigationFocus(arrivedRoute,focus)));
    const ownedRouteFocus=(element:Element)=>{
      if(!scopeCurrent()||!ownsRoute())return false;
      if(navigation&&element===this.querySelector("#main-content"))return true;
      const workspace=workspaceNow(),dialog=element.closest("dialog");
      return Boolean(workspace&&dialog?.matches(".block-composer-dialog")&&workspace.contains(dialog));
    };
    const focus=navigationOwner?.focus??captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus});
    navigationOwner?.bind(focus,ownedRouteFocus);
    const openingCurrent=()=>scopeCurrent()&&(!navigationOwner||navigationOwner.current())&&ownsRoute()&&(!navigation||navigation.current())&&focus.current();
    try{
      if(!openingCurrent())return;
      if(documentViewFromRoute(originRoute)!=="document"){
        this.store.setRoute(withDocumentInRoute("/",projection.documentId,projection.documentTitle),{current:openingCurrent,focus,
          ...(navigationOwner?{onOriginHandoff:()=>navigationOwner.handoff()}:{})});
        arrivedRoute=this.store.route.get();
        navigation=this.store.captureWorkspaceNavigationFocus(arrivedRoute,focus);
        if(!navigation||documentViewFromRoute(arrivedRoute)!=="document"||documentIdFromRoute(arrivedRoute)!==projection.documentId)return;
        await loadRouteComponent(arrivedRoute);if(!openingCurrent())return;
        await this.updateComplete;if(!openingCurrent())return;
        await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));if(!openingCurrent())return;
      }
      const workspace=workspaceNow();
      if(!workspace){if(openingCurrent())this.store.toast("The document is still opening. Try again in a moment.");return;}
      await workspace.updateComplete;if(!openingCurrent()||workspaceNow()!==workspace)return;
      // This context-only entry preserves an already-present Ask draft while
      // the existing native-opening owner still protects actual promotion.
      admitted=await workspace.openContextComposer({
        current:()=>scopeCurrent()&&ownsRoute()&&workspaceNow()===workspace&&(admitted||(!navigationOwner||navigationOwner.current())&&focus.current()),focus,
      });
      if(!admitted&&openingCurrent())this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));
    }finally{focus.dispose();}
  }
  #commandInput(event: Event) {
    if (this.#commandComposing || (event instanceof InputEvent && event.isComposing)) return;
    const value = (event.target as HTMLInputElement).value;
    if (value === this.store.ui.search) return;
    this.#commandActiveKey=null;this.#commandChooseFirst=true;this.#commandSelectionChanged=false;
    this.store.patchUi({ search: value });
  }

  #commandChoices(owner:CommandOpening):CommandChoice[] {
    if(this.#experienceMode())return [];
    const copy=commandDiscoveryCopy(this.i18n.locale),discovery=projectCommandDiscovery(this.#commandInputFacts(owner));
    const generic=discovery.find(row=>row.target.kind==="prepare"&&row.preparationChoice==="generic");
    const path=this.store.route.get();const applicationId=applicationIdFromRoute(path);const application=applicationDefinition(applicationId);
    const session=this.store.session.get();
    const simplifiedEditor = documentViewFromRoute(path) === "editor";
    const creative = this.i18n.t("shell.creative", "Creative");
    const document = this.i18n.t("command.document", "Document");
    const projection = this.store.projection.get();
    const permissions=session?.projectContext?.permissions??session?.capabilities??[];
    const canPrepare=permissions.includes("project.author")&&permissions.includes("project.output.request")&&this.store.sourceOwnershipActive(owner.source);
    const creativeNavigationCommands = application.navigation.filter((item) => ["projects", "work", "explore", "activity", "deliver"].includes(item.id)).map((item) => ({
      id: `open-${item.id}`,
      label: this.i18n.t("command.openNavigation", "Open {name}", { name: this.i18n.t(`shell.navigation.${item.id}`, item.label) }),
      hint: creative,
      route: item.id === "work" ? creativeCreationHref(projection, (documentId, documentTitle) => withDocumentInRoute(item.href, documentId, documentTitle)) : withProjectTaskDocumentInRoute(item.href, projection.documentId, this.store.route.get()),
    }));
    const creativeCommands = [
      ...creativeNavigationCommands,
      { id: "generate", label: generic?.label??copy.chooseDocument, hint: generic?.hint??document, route: "/projects" },
      { id: "add-context", label: simplifiedEditor ? this.i18n.t("command.addGoal", "Add a goal or creative decision") : this.i18n.t("command.addDecision", "Add a creative decision"), hint: document, run: () => this.#openContextComposer() },
      { id: "open-library", label: this.i18n.t("command.openLibrary", "Open reusable library"), hint: creative, route: withProjectTaskDocumentInRoute("/library", projection.documentId, this.store.route.get()) },
      { id: "open-settings", label: this.i18n.t("command.openSettings", "Review personal privacy and usage"), hint: creative, route: "/settings" },
      { id: "run-scout", label: this.i18n.t("command.runScout", "Run a bounded scout report"), hint: creative, route: "/scout" },
      { id: "review-memory", label: this.i18n.t("command.reviewMemory", "Review taste and time memory"), hint: creative, route: "/memory" },
      { id: "open-sessions", label: this.i18n.t("command.openSessions", "Resume a previous creative session"), hint: creative, route: "/sessions" },
      { id: "undo", label: this.i18n.t("command.undo", "Undo last authored change"), hint: "⌘Z", run: () => this.store.undo() },
      {id:"share",label:this.i18n.t("command.share","Share or download this document"),hint:document,run:()=>this.#openShare()},
    ].filter(command=>(command.id!=="generate"||canPrepare)&&(!["add-context","undo"].includes(command.id)||permissions.includes("project.author"))
      &&(!session?.projectContext||((command.id!=="share"||this.store.canManageProjectShares())&&!['run-scout','review-memory','open-sessions'].includes(command.id))));
    const applicationCommands=[
      ...application.navigation.filter((item)=>!(session?.projectContext&&applicationId==="canvas"&&item.id==="proposals")&&navigationItemAccessible(item,{role:session?.user.role,principalRole:session?.impersonation?.actor.role,capabilities:session?.capabilities,canvasAccess:session?.canvas.access})).map((item)=>({id:item.id,label:this.i18n.t("command.openNavigation","Open {name}",{name:this.i18n.t("shell.navigation."+item.id,item.label)}),hint:this.i18n.t("shell."+applicationId,application.label),route:withProjectTaskDocumentInRoute(item.href, projection.documentId, this.store.route.get())})),
      {id:"return-creative",label:this.i18n.t("command.returnCreative","Return to Creator Workspace"),hint:this.i18n.t("shell.application","Application"),route:"/projects"},
    ];
    const staticChoices=(applicationId==="creative"?creativeCommands:applicationCommands).map(command=>({
      ...command,key:command.id==="generate"&&generic?generic.key:"static:"+command.id,terms:command.id==="generate"?[copy.generateAlias]:[],
      ...(command.id==="generate"&&generic?{row:generic}:{})}));
    return[...staticChoices,...discovery.filter(row=>row!==generic).map(row=>({id:"discovery:"+row.key,key:row.key,label:row.label,hint:row.hint,terms:row.terms,row}))];
  }
  #commands() {
    const owner=this.#commandOpening;
    if(this.#experienceMode()||!owner||!this.#commandContextCurrent(owner)||owner.route!==this.store.route.get())return nothing;
    const commands=this.#filteredCommandChoices(owner),copy=commandDiscoveryCopy(this.i18n.locale);
    if(this.#commandChooseFirst){this.#commandActiveKey=commands[0]?.key??null;this.#commandChooseFirst=false;}
    else if(this.#commandActiveKey&&!commands.some(command=>command.key===this.#commandActiveKey)){this.#commandActiveKey=null;this.#commandSelectionChanged=true;}
    const activeIndex=commands.findIndex(command=>command.key===this.#commandActiveKey);
    const applicationId=applicationIdFromRoute(this.store.route.get()),simplifiedEditor=documentViewFromRoute(this.store.route.get())==="editor";
    return html`<dialog class="command-dialog" open closedby="any" aria-labelledby="command-title"
      @cancel=${(event:Event)=>{event.preventDefault();void this.#closeCommands();}}
      @close=${()=>{if(this.#commandOpening===owner)void this.#closeCommands();}}
      @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)void this.#closeCommands();}}>
      <form class="command-card" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(!this.#commandComposing)void this.#runCommand(this.#commandActiveKey,owner);}}>
        <label id="command-title" class="sr-only" for="command-search">${copy.search}</label>
        <div class="command-search"><span>${icon("search")}</span><input id="command-search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" aria-describedby="command-scope"
          aria-activedescendant=${activeIndex>=0?"command-option-"+activeIndex:nothing} autofocus .placeholder=${copy.placeholder}
          .value=${this.#commandComposing?noChange:this.store.ui.search} @input=${this.#commandInput}
          @compositionstart=${()=>{this.#commandComposing=true;}} @compositionend=${(event:CompositionEvent)=>{this.#commandComposing=false;this.#commandInput(event);}}
          @keydown=${(event:KeyboardEvent)=>{if(event.isComposing||event.key==="Process"||this.#commandComposing)return;
            if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();this.#moveCommandSelection(owner,event.key==="ArrowDown"?1:-1);}}}>
          <button type="submit" class="sr-only" tabindex="-1" ?disabled=${activeIndex<0}>${this.i18n.t("command.run","Run command")}</button><kbd>esc</kbd></div>
        <p id="command-scope">${copy.scope}</p>
        <p class="sr-only" role="status">${this.#commandSelectionChanged?copy.changed:commands.length?"":copy.empty}</p>
        <div class="command-results">
        <div id="command-results" role="listbox">${repeat(commands,command=>command.key,(command,index)=>html`<button type="button" tabindex="-1"
          id=${"command-option-"+index} class="command-row" role="option" aria-selected=${command.key===this.#commandActiveKey}
          @mouseenter=${()=>{if(this.#commandOpening===owner&&this.#commandContextCurrent(owner)){this.#commandActiveKey=command.key;this.#commandSelectionChanged=false;this.requestUpdate();}}}
          @click=${()=>void this.#runCommand(command.key,owner)}><span dir="auto">${command.label}</span><small dir="auto">${command.hint}</small></button>`)}</div>
        ${commands.length?nothing:html`<p>${copy.empty}</p>`}
        </div>
        <footer><span>${this.i18n.t("command.navigate","↑↓ navigate")}</span><span>${this.i18n.t("command.run","↵ run")}</span><span>${applicationId==="creative"?(simplifiedEditor ? this.i18n.t("command.autoSave","Changes save automatically") : this.i18n.t("command.appendOrNavigate","Commands append or navigate")):applicationId==="canvas"?this.i18n.t("command.canvasHistory","Canvas changes append durable operations"):this.i18n.t("command.readOnlyNavigation","Navigation does not mutate creative state")}</span></footer>
      </form>
    </dialog>`;
  }

  override render() {
    const path = this.store.route.get();const applicationId=applicationIdFromRoute(path);const application=applicationDefinition(applicationId);const isCreative=applicationId==="creative";const isCanvas=applicationId==="canvas";const isMaking=isCreative||isCanvas;
    const pathname=path.split(/[?#]/)[0]||"/";
    const experienceMode=this.#experienceMode();
    if(isSelectedOutputSharePagePath(pathname))return html`<a class="skip-link" href="#main-content">${this.i18n.t("shell.skip")}</a><div class="shared-locale-switcher">${this.#localePicker()}</div><forma-selected-output-shared-view .token=${selectedOutputSharePageToken(path.split(/[?#]/u, 1)[0] ?? "")}></forma-selected-output-shared-view><span class="sr-only" role="status" aria-live="polite">${this.#localeAnnouncement}</span>`;
    if(pathname==="/share"||pathname.startsWith("/share/"))return html`<a class="skip-link" href="#main-content">${this.i18n.t("shell.skip")}</a><div class="shared-locale-switcher">${this.#localePicker()}</div><forma-shared-view .token=${decodeURIComponent(pathname.slice("/share/".length))}></forma-shared-view><span class="sr-only" role="status" aria-live="polite">${this.#localeAnnouncement}</span>`;
    const session=this.store.session.get();const impersonation=session?.impersonation;const shared=Boolean(session?.projectContext);const canAuthor=!shared||Boolean(session?.projectContext?.permissions.includes("project.author"));
    const documentRouteState=this.store.documentRouteState(path);
    const sourceReady=documentRouteState==="ready"&&!(this.store.loading.get()&&!this.store.events.get().length)&&this.store.routeDataReady();
    // Keep only this existing personal intake owner through a same-route Source
    // interruption. Its own render withdraws private content while unavailable.
    // A changed authorization or actual route destroys this keyed subtree.
    const personalProjects=Boolean(session&&!shared&&(isCreative&&(pathname.startsWith("/projects")||pathname==="/creative")
      ||isCanvas&&(pathname==="/canvas/projects"||pathname.startsWith("/canvas/projects/"))));
    const projectsOwnerKey=(this.store.captureAuthorizationScope()?.key??"")+"\u0000"+path.split("#")[0];
    const sourceLoading=html`<section class="application-loading" role="status"><span aria-hidden="true"></span><div><b>${this.i18n.t("shell.loading","",{application:this.i18n.t("shell."+applicationId,application.label)})}</b><p>${this.i18n.t("shell.loadingDetail")}</p></div></section>`;
    const sourceUnavailable=html`<section class="application-loading" role="status"><div><b>${this.i18n.t("shell.documentUnavailable")}</b><p>${this.i18n.t("shell.documentUnavailableDetail")}</p><button type="button" class="button secondary" @click=${()=>this.store.load()}>${this.i18n.t("action.retry")}</button></div></section>`;
    const sourcePlaceholder=documentRouteState==="unavailable"?sourceUnavailable:sourceLoading;
    const canAdminister=!impersonation&&session?.user.role==="admin";
    const access={role:session?.user.role,principalRole:impersonation?session?.user.role:undefined,canvasAccess:session?.canvas.access,capabilities:session?.capabilities};
    const availableApplications=APPLICATIONS.filter((candidate)=>applicationAccessible(candidate.id,access));
    const simplifiedEditor = documentViewFromRoute(path) === "editor";
    const projection=this.store.projection.get();
    const sourceError=this.store.error.get();
    // Only these two known app/contract messages are localized; arbitrary errors remain untouched.
    const errorMessage=sourceError==="The current source is unavailable. Its saved operation references are retained."?this.i18n.t("shell.sourceUnavailable","The current source is unavailable. Its saved operation references are retained."):sourceError==="project_access_revoked"?this.i18n.t("shell.sourceAccessRevoked","This session cannot read the project. Saved operation references are retained. Restore access, then retry to check the source."):sourceError;
    const navigationHref=(id:string,href:string)=>id==="create"||id==="work"?creativeCreationHref(projection,(documentId,documentTitle)=>withDocumentInRoute(href,documentId,documentTitle)):withProjectTaskDocumentInRoute(href,projection.documentId, this.store.route.get());
    const authorizedTasks=application.navigation.filter((item)=>(!isCreative||["projects","work","explore","activity","deliver"].includes(item.id))&&navigationItemAccessible(item,access)&&!(shared&&isCanvas&&item.id==="proposals"));
    const activity= isMaking ? scopedFormaActivity(session,projection,this.store.projectNotifications.get(),this.store.reviewInbox.get(),this.store.documentJobs.get()) : undefined;
    const attention=activity?formaActivityAttention(activity):0;
    const focusedMembership=session?.projectContext?session.projects?.find((project)=>project.organizationId===session.projectContext?.organizationId&&project.projectAccessId===session.projectContext.projectAccessId&&project.projectId===session.projectContext.projectId):undefined;
    const focusedOrganization=focusedMembership?session?.organizations?.find((organization)=>organization.organizationId===focusedMembership.organizationId):undefined;
    const taskIcons:Record<string,string>={projects:"folder",work:"document",explore:"search",activity:"spark",deliver:"download"};
    const destinations=[...authorizedTasks.map((item)=>({label:this.i18n.t("shell.navigation."+item.id,item.label),value:item.id,href:navigationHref(item.id,item.href),description:this.i18n.t("shell.description."+item.id,item.description),...(isCreative?{icon:taskIcons[item.id]}:{}),...(item.id==="activity"&&attention?{badge:attention,badgeLabel:this.i18n.t("activity.navigationBadge","Activity, {count} items need attention",{count:String(attention)})}:{})})),...(isCanvas?[{label:this.i18n.t("shell.navigation.activity","Activity"),value:"activity",href:withProjectTaskDocumentInRoute("/activity",projection.documentId, this.store.route.get()),description:this.i18n.t("shell.description.activity","Review assigned work and project updates"),icon:"spark",...(attention?{badge:attention,badgeLabel:this.i18n.t("activity.navigationBadge","Activity, {count} items need attention",{count:String(attention)})}:{})}]:[])];
    const activeTask=authorizedTasks.find((item)=>navigationItemActive(applicationId,item.id,path))?.id||"";
    const audienceNavigation=isCreative||isCanvas?html`<forma-ui-audience-navigation class=${`application-task-navigation area-navigation--${applicationId}`} data-primary-navigation=${isCreative ? "true" : "false"} .label=${this.i18n.t("shell."+applicationId,application.label)} .value=${activeTask} .destinations=${destinations} @forma-navigate=${(event:CustomEvent<{value:string;href:string}>)=>{event.preventDefault();this.#route(event.detail.href);}}></forma-ui-audience-navigation>`:nothing;
    const workspaceDestinations=availableApplications.map((candidate)=>({label:this.i18n.t("shell."+candidate.id,candidate.label),value:candidate.id,href:authorizedApplicationHome(candidate.id,access),description:this.i18n.t("shell.description."+candidate.id,candidate.description)}));
    return html`<div class=${`app-shell application-${applicationId} ${applicationId==="operations"?"admin-shell":""}`} data-experience-mode=${String(experienceMode)} data-nav-posture=${this.#layoutPosture} data-short-height=${String(this.#shortHeight)} data-layout-intent=${isCreative&&!experienceMode&&(documentViewFromRoute(path)==="document"||pathname==="/creative/create"||pathname.startsWith("/creative/create/"))?"workbench":"browse"} @forma-context-create=${()=>{if(!experienceMode&&isCreative&&canAuthor)void this.#openContextComposer();}}>
      <a class="skip-link" href="#main-content">${this.i18n.t("shell.skip")}</a>
      ${experienceMode?html`<header class="topbar experience-topbar"><span class="experience-brand"><span class="brand-mark" aria-hidden="true">F</span><span>Forma</span></span><div class="top-actions">${this.#localePicker()}</div></header>`:html`<header class="topbar">
        <button class="brand" @click=${() => this.#route(isCanvas?"/canvas/projects":"/projects")} aria-label=${this.i18n.t("shell.openProjects","Open all Forma projects")}><span class="brand-mark">F</span><span>Forma</span></button>
        <forma-ui-workspace-switcher .label=${this.i18n.t("navigation.availableWorkspaces","Available workspaces")} .value=${applicationId} .destinations=${workspaceDestinations} @forma-navigate=${(event:CustomEvent<{value:string;href:string}>)=>{event.preventDefault();this.#route(event.detail.href);}}></forma-ui-workspace-switcher>
        <div class="application-context"><b>${this.i18n.t("shell."+applicationId,application.label)}</b><span>${this.i18n.t("shell.description."+applicationId,application.description)}</span></div>
        <div class="top-actions">
          ${documentFocusFromRoute(path)&&isCreative&&session?html`<span class="document-focus-actor" dir="auto">${session.user.displayName}${session.projectContext?html`<small>${focusedOrganization&&focusedMembership?html`${focusedOrganization.name} · ${this.i18n.t(`workspace.admin.role.${focusedMembership.role}`,focusedMembership.role)}`:this.i18n.t("projects.workspaceKind","Creative workspace")}</small>`:nothing}</span><button type="button" class="button ghost compact document-focus-activity" aria-label=${attention?this.i18n.t("activity.navigationBadge","Activity, {count} items need attention",{count:String(attention)}):this.i18n.t("shell.navigation.activity","Activity")} @click=${()=>this.#route(withProjectTaskDocumentInRoute("/activity",projection.documentId, this.store.route.get()))}>${icon("spark")}${attention?html`<span>${this.i18n.number(attention)}</span>`:nothing}</button>`:nothing}
          ${this.#localePicker()}
          <button type="button" class="command-trigger forma-global-search" aria-label=${this.i18n.t("shell.command")} aria-haspopup="dialog" aria-expanded=${String(this.store.ui.commandOpen)} aria-keyshortcuts="Meta+K Control+K" @click=${()=>this.#openCommands()}><span aria-hidden="true">${icon("search")}</span><span class="command-label">${this.i18n.t("shell.command")}</span><kbd>⌘ K</kbd></button>
          ${isCreative&&this.store.canManageProjectShares()&&isDocumentViewRoute(path)&&projection.documentId?html`<button class="button secondary compact" @click=${()=>this.#openShare()}>${icon("share")} ${this.i18n.t("shell.share","Share")}</button>`:nothing}
          <button type="button" class=${`avatar ${impersonation?"impersonating":""}`} aria-label=${impersonation?this.i18n.t("shell.impersonationAccount","Open fictional account controls for {name}",{name:impersonation.fictionalUser.displayName}):this.i18n.t("shell.account")} popovertarget="account-popover" aria-controls="account-popover" aria-expanded=${this.store.ui.accountOpen}>${session?.user.displayName?this.i18n.firstGrapheme(session.user.displayName).toLocaleUpperCase(this.i18n.locale):icon("user")}</button>
        </div>
        <div id="account-popover" class="account-popover" popover="auto" @beforetoggle=${this.#accountBeforeToggle} @toggle=${this.#accountToggle}>
          ${impersonation ? html`<span class="eyebrow">${this.i18n.t("account.fictional", "Fictional account · impersonating")}</span><b dir="auto">${impersonation.fictionalUser.displayName}</b><p><bdi dir="ltr">${impersonation.fictionalUser.email}</bdi> · ${this.i18n.plural("account.mockEvents", this.store.head.get(), "{count} mock event", "{count} mock events")}</p><div class="account-impersonation-note"><b>${this.i18n.t("account.signedInAs", "Signed in as {name}", { name: "\u2068" + impersonation.actor.displayName + "\u2069" })}</b><p>${this.i18n.t("account.isolation", "Every change requires confirmation and remains isolated in this saved mock.")}</p></div><button class="button primary" @click=${()=>this.store.stopImpersonating()}>${this.i18n.t("account.return", "Return to my account")}</button>` : html`<span class="eyebrow">${this.i18n.t("account.role." + (session?.user.role || "authenticated"), session?.user.role || this.i18n.t("account.role.authenticated", "authenticated"))}</span><b dir="auto">${session?.user.displayName || this.i18n.t("account.signedIn", "Signed-in creative")}</b><p><bdi dir="ltr">${session?.user.email || this.i18n.t("account.identityLoading", "Identity loading")}</bdi>${simplifiedEditor ? nothing : html` · ${this.i18n.plural("account.events", this.store.head.get(), "{count} event", "{count} events")}`}</p>`}
          ${canAdminister&&!simplifiedEditor?html`<nav class="account-nav" aria-label=${this.i18n.t("account.tools", "Platform tools")}>${availableApplications.filter((candidate)=>!["creative","canvas"].includes(candidate.id)).map((candidate)=>{const destination=authorizedApplicationHome(candidate.id,access);return html`<a href=${destination} @click=${(event:MouseEvent)=>{if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();this.#route(destination);}}><span>${this.i18n.t("shell."+candidate.id,candidate.label)}</span><span class="ui-directional-icon" aria-hidden="true">${icon("arrow")}</span></a>`;})}</nav>`:nothing}
          <div class="account-policy"><span>${this.i18n.t("account.terms", "Terms")}</span><b>${session?.policy.accepted ? this.i18n.t("account.accepted", "accepted") : this.i18n.t("account.required", "required")}</b><span>${this.i18n.t("account.provider", "Provider")}</span><b>${session?.provider.configured ? this.i18n.t("settings.available", "Available") : this.i18n.t("settings.unavailable", "Unavailable")}</b><span>${this.i18n.t("account.retention", "Content retention")}</span><b>${this.i18n.plural("account.days", session?.policy.retentionDays ?? 30, "{count} day", "{count} days")}</b><span>${this.i18n.t("account.attention", "Attention signals")}</span><b>${impersonation ? this.i18n.t("account.mockOff", "off for mock") : this.store.ui.attentionCapture ? this.store.ui.attentionPaused ? this.i18n.t("account.paused", "paused") : this.i18n.t("account.on", "on") : this.i18n.t("account.off", "off")}</b></div>
          ${impersonation ? nothing : html`<form class="account-preferences" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.instrumentation} @change=${(e: Event) => this.store.patchUi({ instrumentation: (e.target as HTMLInputElement).checked })}><span>${this.i18n.t("account.recordViews", "Record explicit view actions")}</span></label><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.attentionCapture} @change=${(e:Event)=>this.store.setAttentionCapture((e.target as HTMLInputElement).checked)}><span>${this.i18n.t("account.useAttention", "Use attention signals to improve Forma")}</span></label></form>${this.store.ui.attentionCapture?html`<button type="button" class="button ghost compact attention-pause" @click=${()=>this.store.setAttentionPaused(!this.store.ui.attentionPaused)}>${this.store.ui.attentionPaused ? icon("play") : icon("pause")} ${this.store.ui.attentionPaused ? this.i18n.t("account.resume", "Resume on this device") : this.i18n.t("account.pause", "Pause on this device")}</button>`:nothing}<small>${this.i18n.t("account.disclosure", "Opt-in capture runs only while this page is visible. It stores coarse surface, active/idle time, visible item IDs, and the action that ended a period—never pointer paths, keys, typed text, microphone, or ambient device data. Device episodes expire after {days} days.", { days: this.i18n.number(14) })}</small>`}
          ${shared?html`<button type="button" class="button secondary compact" @click=${()=>void this.#leaveProjectContext()}>${this.i18n.t("workspace.admin.leaveSharedProject","Return to my projects")}</button>`:nothing}
          ${isCreative&&this.store.canManageProjectShares()&&isDocumentViewRoute(path)&&projection.documentId?html`<button type="button" class="button secondary compact account-share-action" @click=${()=>this.#openShare(true)}>${icon("share")} ${this.i18n.t("shell.share","Share")}</button>`:nothing}
          <button type="button" class="button ghost" @click=${() => this.#route("/settings")}>${isCanvas?this.i18n.t("account.privacyCreatorWorkspace","Review privacy in Creator Workspace"):this.i18n.t("account.privacy","Review privacy controls")}</button>
        </div>
      </header>`}
      ${!experienceMode&&documentFocusFromRoute(path) ? html`<div class="focus-locale-switcher">${this.#localePicker()}</div>` : nothing}
      ${impersonation?html`<aside class="impersonation-banner" role="status"><span class="impersonation-banner-mark">${icon("user")}</span><div><b>${this.i18n.t("account.bannerTitle", "Fictional account · {name}", { name: "\u2068" + impersonation.fictionalUser.displayName + "\u2069" })}</b><span>${this.i18n.t("account.bannerDetail", "You are signed in as {name}. Every change to this mock account asks for confirmation.", { name: "\u2068" + impersonation.actor.displayName + "\u2069" })}</span></div><button class="button secondary compact" @click=${()=>this.store.stopImpersonating()}>${this.i18n.t("account.return", "Return to my account")}</button></aside>`:nothing}
      ${shared?html`<aside class="impersonation-banner workspace-shared-banner" role="status"><span class="impersonation-banner-mark">${icon("user")}</span><div><b>${this.i18n.t("workspace.admin.sharedProjectMode","You are working inside a shared project.")}</b>${canAuthor?nothing:html`<span>${this.i18n.t("workspace.admin.readOnlyProject","You have view-only access to this shared project.")}</span>`}</div><button type="button" class="button secondary compact" @click=${()=>void this.#leaveProjectContext()}>${this.i18n.t("workspace.admin.leaveSharedProject","Return to my projects")}</button></aside>`:nothing}
      ${experienceMode?nothing:audienceNavigation}
      ${this.store.error.get() ? html`<div class="error-banner" role="alert"><b>${simplifiedEditor ? this.i18n.t("shell.error") : this.i18n.t("shell.streamUnavailable","Durable stream unavailable.")}</b> ${errorMessage} <button @click=${() => this.store.load()}>${this.i18n.t("action.retry")}</button></div>` : nothing}
      ${this.#nativeImageHost.renderStatus()}
      ${this.store.ui.toast&&this.store.ui.toastPresentation==="inline"?html`<div class="queued-notice" role="status" aria-live="polite">${icon("check")} ${this.i18n.system(this.store.ui.toast)}</div>`:nothing}
      <main id="main-content" tabindex="-1" aria-busy=${sourceReady||documentRouteState==="unavailable"?"false":"true"}>${personalProjects?html`${sourceReady?nothing:sourcePlaceholder}<div class="projects-source-owner" ?hidden=${!sourceReady} ?inert=${!sourceReady} style=${sourceReady?"display:contents":nothing}>${keyed(projectsOwnerKey,this.#page())}</div>`:sourceReady?this.#page():sourcePlaceholder}</main>
      ${!experienceMode&&session?.assistant?.enabled&&session.policy.accepted?html`<forma-creative-assistant></forma-creative-assistant>`:nothing}
      ${this.store.ui.toast&&this.store.ui.toastPresentation!=="inline" ? html`<div class="toast" role="status" aria-live="polite" popover="manual">${icon("check")} ${this.i18n.system(this.store.ui.toast)}</div>` : nothing}
      ${!experienceMode&&this.store.ui.commandOpen ? this.#commands() : nothing}
      ${!experienceMode&&this.store.ui.shareOpen&&this.store.canManageProjectShares()?this.#share():nothing}
      ${this.#planningConsent()}
      ${this.store.ui.impersonationConfirmOpen ? this.#impersonationWarning() : nothing}
      ${session&&!session.policy.accepted&&isMaking?this.#terms():nothing}
      <forma-attention-observer></forma-attention-observer>
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.#localeAnnouncement||this.#routeAnnouncement}</span>
      <span class="sr-only" aria-live="polite">${this.store.busy.get() ? this.i18n.t("shell.busy","",{operation:this.store.busy.get()}) : this.store.documentJobs.get().some((job)=>job.status==="running") ? this.i18n.t("shell.running") : this.store.documentJobs.get().some((job)=>job.status==="queued") ? this.i18n.t("shell.queued") : this.i18n.t("action.ready")}</span>
    </div>`;
  }
}
if (!customElements.get("forma-shell")) customElements.define("forma-shell", FormaShell);
