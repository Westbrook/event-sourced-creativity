import { html, noChange, nothing } from "lit";
import { FormaElement, icon, downloadJson, copyTextToClipboard } from "./forma-element";
import { loadRouteComponent } from "../route-loader";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, withDocumentInRoute } from "../model/routes";
import { APPLICATIONS, applicationAccessible, applicationDefinition, applicationIdFromRoute, authorizedApplicationHome, creativeCreationHref, navigationItemAccessible, navigationItemActive } from "../platform/applications";
import { formaActivityAttention, scopedFormaActivity } from "../model/activity";
import { canvasFocusFromRoute } from "../canvas/routes";
import { ensureModalDialog } from "./modal-dialog";
import { beginRoutePopulation, completeRoutePopulation, recordPopulationSource } from "../performance";
import { FORMA_SUPPORTED_LOCALES, formaLocaleFamily, setFormaLocale } from "./design-system/localization";
import "./design-system/navigation";
import "./design-system/language-picker";
import "./icons-navigation";
import "./forma-attention-observer";

export class FormaShell extends FormaElement {
  #commandIndex = 0;
  #commandComposing = false;
  #shareHours=24;#freshShareUrl="";#freshShareScope="";#freshShareCopied:boolean|null=null;#termsOwnership=false;#termsProvider=false;
  #dialogObserver?: MutationObserver;
  #lastObservedDocumentView = "";
  #lastObservedApplicationView = "";
  #revealedApplication = "";
  #localeAnnouncement = "";
  #accessibleRoute = "";
  #routeAnnouncement = "";
  #focusNextRoute = false;
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
  #clearShareSecret=()=>{this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;if(this.store.ui.shareOpen)this.store.patchUi({shareOpen:false});};
  #openShare(closeAccount=false){if(!this.store.canManageProjectShares())return;this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;void this.store.loadShares();this.store.patchUi({...closeAccount?{accountOpen:false}:{},shareOpen:true});}
  #closeShare(){this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;this.store.patchUi({shareOpen:false});}
  #accountToggle = (event: ToggleEvent) => {
    const open = event.newState === "open";
    if (this.store.ui.accountOpen !== open) this.store.patchUi({ accountOpen: open });
    if (open) (event.currentTarget as HTMLElement).querySelector<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])")?.focus();
  };
  #keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.key === "Process" || this.#commandComposing && this.store.ui.commandOpen) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.#commandComposing = false; this.store.patchUi({ commandOpen: !this.store.ui.commandOpen }); }
    const target = event.composedPath()[0];
    const editingField = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const projectContext=this.store.session.get()?.projectContext;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !editingField && (!projectContext||projectContext.permissions.includes("project.author")) && ["creative","canvas"].includes(applicationIdFromRoute(this.store.route.get()))) { event.preventDefault(); if (event.shiftKey) void this.store.redo(); else void this.store.undo(); }
    if (event.key === "Escape") {
      if(this.store.ui.impersonationConfirmOpen)this.store.resolveImpersonatedInteraction(false);
      else { const returnAccountFocus=this.store.ui.accountOpen;this.#commandComposing=false;this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;this.store.patchUi({commandOpen:false,accountOpen:false,shareOpen:false,compareOpen:false});if(returnAccountFocus)queueMicrotask(()=>this.querySelector<HTMLButtonElement>(".avatar")?.focus()); }
    }
  };
  #routeChanged = (event: Event) => {
    this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;
    const path = (event as CustomEvent<{ path?: string }>).detail?.path ?? `${location.pathname}${location.search}${location.hash}`;
    this.#focusNextRoute=true;
    void loadRouteComponent(path);
    if (!this.store.loading.get()) void this.store.syncDocumentFromRoute(path);
  };
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
    super.connectedCallback();window.addEventListener("keydown",this.#keydown);window.addEventListener("popstate",this.#pop);window.addEventListener("forma-route-changed",this.#routeChanged);window.addEventListener("forma-performance",this.#populated);window.addEventListener("forma-authorization-changed",this.#clearShareSecret);
    window.visualViewport?.addEventListener("resize", this.#syncLayout);
    window.visualViewport?.addEventListener("scroll", this.#syncLayout);
    if (typeof ResizeObserver !== "undefined") { this.#layoutObserver = new ResizeObserver(this.#syncLayout); this.#layoutObserver.observe(this); }
    this.#syncLayout();
    this.#dialogObserver = new MutationObserver((records) => {
      const dialogChanged = records.some((record) => record.type === "attributes" || [...record.addedNodes].some((node) => node instanceof Element && (node.matches("dialog") || node.querySelector("dialog"))));
      if (dialogChanged) queueMicrotask(() => this.#raiseToast());
    });
    this.#dialogObserver.observe(this, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    void loadRouteComponent(location.pathname);
    const shared=location.pathname==="/share"||location.pathname.startsWith("/share/");
    if(shared){beginRoutePopulation(location.pathname);recordPopulationSource("miss",0);}
    else if(!this.store.events.get().length)void this.store.load();
  }
  override disconnectedCallback(){this.#dialogObserver?.disconnect();this.#layoutObserver?.disconnect();cancelAnimationFrame(this.#layoutFrame);window.visualViewport?.removeEventListener("resize",this.#syncLayout);window.visualViewport?.removeEventListener("scroll",this.#syncLayout);window.removeEventListener("keydown",this.#keydown);window.removeEventListener("popstate",this.#pop);window.removeEventListener("forma-route-changed",this.#routeChanged);window.removeEventListener("forma-performance",this.#populated);window.removeEventListener("forma-authorization-changed",this.#clearShareSecret);this.#freshShareUrl="";this.#freshShareScope="";this.#freshShareCopied=null;super.disconnectedCallback();}

  #raiseToast() {
    const toast = this.querySelector<HTMLElement>(".toast[popover]");
    if (!toast || typeof toast.showPopover !== "function") return;
    try {
      if (toast.matches(":popover-open")) toast.hidePopover();
      toast.showPopover();
    } catch { /* The toast remains a fixed fallback when popovers are unavailable. */ }
  }

  protected override updated() {
    const accountPopover=this.querySelector<HTMLElement>("#account-popover");
    if(!this.store.ui.accountOpen&&accountPopover?.matches(":popover-open"))accountPopover.hidePopover();
    for(const dialog of this.querySelectorAll<HTMLDialogElement>(".command-dialog,.consent-modal,.impersonation-confirm-dialog,dialog[data-shell-modal]"))ensureModalDialog(dialog);
    this.#raiseToast();
    if(!this.store.loading.get()&&this.store.events.get().length&&this.store.routeDataReady()){
      const path=this.store.route.get(),pathname=path.split(/[?#]/)[0]??"",parts=pathname.split("/").filter(Boolean);
      const organization=parts[0]==="settings"&&parts[1]==="workspaces"&&parts[2]!=="invitations"?this.store.session.get()?.organizations?.find((item)=>item.organizationId===parts[2]):undefined;
      const key=`${path}:${this.i18n.locale}:${organization?.name??""}`;
      if(this.#accessibleRoute!==key){
        this.#accessibleRoute=key;
        const id=applicationIdFromRoute(path),application=applicationDefinition(id),task=application.navigation.find((item)=>navigationItemActive(id,item.id,path));
        const workspaceSection=parts[0]==="settings"&&parts[1]==="workspaces"?(parts[2]==="invitations"?this.i18n.t("workspace.admin.invitations","Your invitations"):parts[2]?this.i18n.t(`workspace.admin.section.${parts[3]??"overview"}`,parts[3]??"Overview"):this.i18n.t("workspace.admin.heading","Workspaces & collaboration")):"";
        const page=workspaceSection?organization?`${workspaceSection} — \u2068${organization.name}\u2069`:workspaceSection:documentIdFromRoute(path)&&this.store.projection.get().documentTitle?this.store.projection.get().documentTitle:task?this.i18n.t(`shell.navigation.${task.id}`,task.label):this.i18n.t(`shell.${id}`,application.label);
        const workspace=this.i18n.t(`shell.${id}`,application.label);
        document.title=page===workspace?`${workspace} — Forma`:`${page} — ${workspace} — Forma`;
        this.#routeAnnouncement=document.title.replace(/\s— Forma$/,"");
        if(this.#focusNextRoute&&!path.includes("#")){this.#focusNextRoute=false;void this.updateComplete.then(()=>this.querySelector<HTMLElement>("#main-content")?.focus({preventScroll:true}));}
      }
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

  #route(path: string) { this.#commandComposing = false; this.store.patchUi({ commandOpen: false, accountOpen: false }); this.store.setRoute(path); const hash=path.includes("#")?path.slice(path.indexOf("#")+1):"";if(hash)window.setTimeout(()=>{const target=document.getElementById(hash);const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;target?.scrollIntoView({behavior:reduced?"auto":"smooth",block:"center"});target?.focus({preventScroll:true});},0);else window.scrollTo({ top: 0 }); }
  #page() {
    const path=this.store.route.get(),application=applicationIdFromRoute(path);
    if(application==="creative"&&this.store.session.get()?.projectContext&&/^\/(?:sessions|scout|memory)(?:\/|[?#]|$)/.test(path))return html`<section class="page-pad"><header class="page-header page-header--hero"><div class="page-header-copy"><h1>${this.i18n.t("workspace.personalOnly.heading","This is part of your personal creative account")}</h1><p>${this.i18n.t("workspace.personalOnly.description","Sessions, personal suggestions, and creative memory stay private and are not shared with a project.")}</p></div><div class="page-header-actions"><button type="button" class="button secondary" @click=${()=>void this.store.leaveProjectContext()}>${this.i18n.t("workspace.admin.leaveSharedProject","Return to my projects")}</button></div></header></section>`;
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
  async #generateFromCommand(){const readiness=await this.store.ensureGenerationReadiness("generate",{sourceSurface:"command-menu"});if(readiness?.status==="ready"||readiness?.status==="review"&&this.store.generationRiskAcknowledged(readiness.requestKey))return this.store.generate({sourceSurface:"command-menu"});this.store.toast(readiness?.status==="review"?"Review and acknowledge the generation warning in the document controls first.":readiness?.summary??"Generation readiness could not be confirmed.");}
  async #openContextComposer(){
    const projection=this.store.projection.get();if(!projection.documentId){this.store.toast("Open a document before adding a creative decision.");return;}
    if(documentViewFromRoute(this.store.route.get())!=="document"){
      const route=withDocumentInRoute("/",projection.documentId,projection.documentTitle);this.#route(route);await loadRouteComponent(route);await this.updateComplete;
      await new Promise<void>((resolve)=>window.requestAnimationFrame(()=>resolve()));
    }
    const workspace=this.querySelector<HTMLElement&{openContextComposer:()=>void}>("forma-workspace");
    if(workspace)workspace.openContextComposer();else this.store.toast("The document is still opening. Try again in a moment.");
  }
  #commandInput(event: Event) {
    if (this.#commandComposing || (event instanceof InputEvent && event.isComposing)) return;
    const value = (event.target as HTMLInputElement).value;
    if (value === this.store.ui.search) return;
    this.#commandIndex = 0;
    this.store.patchUi({ search: value });
  }

  #commands() {
    const normalize = (value: string) => value.toLocaleLowerCase(this.i18n.locale).normalize("NFD").replace(/(\p{Script=Latin})\p{Mark}+/gu, "$1").normalize("NFC");
    const query = normalize(this.store.ui.search);
    const path=this.store.route.get();const applicationId=applicationIdFromRoute(path);const application=applicationDefinition(applicationId);
    const session=this.store.session.get();
    const simplifiedEditor = documentViewFromRoute(path) === "editor";
    const creative = this.i18n.t("shell.creative", "Creative");
    const document = this.i18n.t("command.document", "Document");
    const projection = this.store.projection.get();
    const creativeNavigationCommands = application.navigation.filter((item) => ["projects", "work", "explore", "activity", "deliver"].includes(item.id)).map((item) => ({
      id: `open-${item.id}`,
      label: this.i18n.t("command.openNavigation", "Open {name}", { name: this.i18n.t(`shell.navigation.${item.id}`, item.label) }),
      hint: creative,
      run: () => this.#route(item.id === "work" ? creativeCreationHref(projection, (documentId, documentTitle) => withDocumentInRoute(item.href, documentId, documentTitle)) : item.href),
    }));
    const creativeCommands = [
      ...creativeNavigationCommands,
      { id: "generate", label: this.i18n.t("command.generate", "Generate from current context"), hint: this.i18n.t("shell.navigation.create", "Create"), run: () => this.#generateFromCommand() },
      { id: "add-context", label: simplifiedEditor ? this.i18n.t("command.addGoal", "Add a goal or creative decision") : this.i18n.t("command.addDecision", "Add a creative decision"), hint: document, run: () => this.#openContextComposer() },
      { id: "open-library", label: this.i18n.t("command.openLibrary", "Open reusable library"), hint: creative, run: () => this.#route("/library") },
      { id: "open-settings", label: this.i18n.t("command.openSettings", "Review personal privacy and usage"), hint: creative, run: () => this.#route("/settings") },
      { id: "run-scout", label: this.i18n.t("command.runScout", "Run a bounded scout report"), hint: creative, run: () => this.#route("/scout") },
      { id: "review-memory", label: this.i18n.t("command.reviewMemory", "Review taste and time memory"), hint: creative, run: () => this.#route("/memory") },
      { id: "open-sessions", label: this.i18n.t("command.openSessions", "Resume a previous creative session"), hint: creative, run: () => this.#route("/sessions") },
      { id: "undo", label: this.i18n.t("command.undo", "Undo last authored change"), hint: "⌘Z", run: () => this.store.undo() },
      {id:"share",label:this.i18n.t("command.share","Share or download this document"),hint:document,run:()=>this.#openShare()},
    ].filter((command)=>!session?.projectContext||((command.id!=="share"||this.store.canManageProjectShares())&&!['run-scout','review-memory','open-sessions'].includes(command.id)&&(command.id!=="generate"||session.projectContext.permissions.includes("project.output.request"))&&(!["add-context","undo"].includes(command.id)||session.projectContext.permissions.includes("project.author"))));
    const applicationCommands=[
      ...application.navigation.filter((item)=>!(session?.projectContext&&applicationId==="canvas"&&item.id==="proposals")&&navigationItemAccessible(item,{role:session?.user.role,principalRole:session?.impersonation?.actor.role,capabilities:session?.capabilities,canvasAccess:session?.canvas.access})).map((item)=>({id:item.id,label:this.i18n.t("command.openNavigation","Open {name}",{name:this.i18n.t("shell.navigation."+item.id,item.label)}),hint:this.i18n.t("shell."+applicationId,application.label),run:()=>this.#route(item.href)})),
      {id:"return-creative",label:this.i18n.t("command.returnCreative","Return to Creator Workspace"),hint:this.i18n.t("shell.application","Application"),run:()=>this.#route("/projects")},
    ];
    const commands=(applicationId==="creative"?creativeCommands:applicationCommands).filter((command) => normalize(command.label).includes(query) || normalize(command.hint).includes(query));
    const run = async (index: number) => { const command = commands[index]; if (!command) return; this.store.patchUi({ commandOpen: false, search: "" }); this.#commandIndex = 0; this.#commandComposing = false; await command.run(); };
    return html`<dialog class="command-dialog" open closedby="any" aria-labelledby="command-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget){this.#commandComposing=false;this.store.patchUi({commandOpen:false});}}}>
      <form class="command-card" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(!this.#commandComposing)void run(this.#commandIndex);}}>
        <label id="command-title" class="sr-only" for="command-search">${this.i18n.t("command.search","Search commands")}</label>
        <div class="command-search"><span>${icon("search")}</span><input id="command-search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" aria-activedescendant=${commands[this.#commandIndex] ? `command-option-${commands[this.#commandIndex]!.id}` : nothing} autofocus .placeholder=${this.i18n.t("command.placeholder","Type a command…")} .value=${this.#commandComposing ? noChange : this.store.ui.search} @input=${this.#commandInput} @compositionstart=${()=>{this.#commandComposing=true;}} @compositionend=${(event:CompositionEvent)=>{this.#commandComposing=false;this.#commandInput(event);}} @keydown=${(event: KeyboardEvent) => { if (event.isComposing || this.#commandComposing) return; if (event.key === "ArrowDown") { event.preventDefault(); this.#commandIndex = Math.min(commands.length - 1, this.#commandIndex + 1); this.requestUpdate(); } else if (event.key === "ArrowUp") { event.preventDefault(); this.#commandIndex = Math.max(0, this.#commandIndex - 1); this.requestUpdate(); } }}><button type="submit" class="sr-only" tabindex="-1" ?disabled=${!commands.length}>${this.i18n.t("command.run","Run command")}</button><kbd>esc</kbd></div>
        <div id="command-results" class="command-results" role="listbox">${commands.map((command, index) => html`<button type="button" id=${`command-option-${command.id}`} class="command-row" role="option" aria-selected=${index === this.#commandIndex} @mouseenter=${() => { this.#commandIndex = index; this.requestUpdate(); }} @click=${() => run(index)}><span>${command.label}</span><small>${command.hint}</small></button>`)}</div>
        <footer><span>${this.i18n.t("command.navigate","↑↓ navigate")}</span><span>${this.i18n.t("command.run","↵ run")}</span><span>${applicationId==="creative"?(simplifiedEditor ? this.i18n.t("command.autoSave","Changes save automatically") : this.i18n.t("command.appendOrNavigate","Commands append or navigate")):applicationId==="canvas"?this.i18n.t("command.canvasHistory","Canvas changes append durable operations"):this.i18n.t("command.readOnlyNavigation","Navigation does not mutate creative state")}</span></footer>
      </form>
    </dialog>`;
  }

  override render() {
    const path = this.store.route.get();const applicationId=applicationIdFromRoute(path);const application=applicationDefinition(applicationId);const isCreative=applicationId==="creative";const isCanvas=applicationId==="canvas";const isMaking=isCreative||isCanvas;
    const pathname=path.split(/[?#]/)[0]||"/";
    if(pathname==="/share"||pathname.startsWith("/share/"))return html`<a class="skip-link" href="#main-content">${this.i18n.t("shell.skip")}</a><div class="shared-locale-switcher">${this.#localePicker()}</div><forma-shared-view .token=${decodeURIComponent(pathname.slice("/share/".length))}></forma-shared-view><span class="sr-only" role="status" aria-live="polite">${this.#localeAnnouncement}</span>`;
    const session=this.store.session.get();const impersonation=session?.impersonation;const shared=Boolean(session?.projectContext);const canAuthor=!shared||Boolean(session?.projectContext?.permissions.includes("project.author"));
    const canAdminister=!impersonation&&session?.user.role==="admin";
    const access={role:session?.user.role,principalRole:impersonation?session?.user.role:undefined,canvasAccess:session?.canvas.access,capabilities:session?.capabilities};
    const availableApplications=APPLICATIONS.filter((candidate)=>applicationAccessible(candidate.id,access));
    const simplifiedEditor = documentViewFromRoute(path) === "editor";
    const projection=this.store.projection.get();
    const navigationHref=(id:string,href:string)=>id==="create"||id==="work"?creativeCreationHref(projection,(documentId,documentTitle)=>withDocumentInRoute(href,documentId,documentTitle)):href;
    const authorizedTasks=application.navigation.filter((item)=>(!isCreative||["projects","work","explore","activity","deliver"].includes(item.id))&&navigationItemAccessible(item,access)&&!(shared&&isCanvas&&item.id==="proposals"));
    const activity= isMaking ? scopedFormaActivity(session,projection,this.store.projectNotifications.get(),this.store.reviewInbox.get(),this.store.documentJobs.get()) : undefined;
    const attention=activity?formaActivityAttention(activity):0;
    const focusedMembership=session?.projectContext?session.projects?.find((project)=>project.organizationId===session.projectContext?.organizationId&&project.projectAccessId===session.projectContext.projectAccessId&&project.projectId===session.projectContext.projectId):undefined;
    const focusedOrganization=focusedMembership?session?.organizations?.find((organization)=>organization.organizationId===focusedMembership.organizationId):undefined;
    const taskIcons:Record<string,string>={projects:"folder",work:"document",explore:"search",activity:"spark",deliver:"download"};
    const destinations=[...authorizedTasks.map((item)=>({label:this.i18n.t("shell.navigation."+item.id,item.label),value:item.id,href:navigationHref(item.id,item.href),description:this.i18n.t("shell.description."+item.id,item.description),...(isCreative?{icon:taskIcons[item.id]}:{}),...(item.id==="activity"&&attention?{badge:attention,badgeLabel:this.i18n.t("activity.navigationBadge","Activity, {count} items need attention",{count:String(attention)})}:{})})),...(isCanvas?[{label:this.i18n.t("shell.navigation.activity","Activity"),value:"activity",href:"/activity",description:this.i18n.t("shell.description.activity","Review assigned work and project updates"),icon:"spark",...(attention?{badge:attention,badgeLabel:this.i18n.t("activity.navigationBadge","Activity, {count} items need attention",{count:String(attention)})}:{})}]:[])];
    const activeTask=authorizedTasks.find((item)=>navigationItemActive(applicationId,item.id,path))?.id||"";
    const audienceNavigation=isCreative||isCanvas?html`<forma-ui-audience-navigation class=${`application-task-navigation area-navigation--${applicationId}`} data-primary-navigation=${isCreative ? "true" : "false"} .label=${this.i18n.t("shell."+applicationId,application.label)} .value=${activeTask} .destinations=${destinations} @forma-navigate=${(event:CustomEvent<{value:string;href:string}>)=>{event.preventDefault();this.#route(event.detail.href);}}></forma-ui-audience-navigation>`:nothing;
    const workspaceDestinations=availableApplications.map((candidate)=>({label:this.i18n.t("shell."+candidate.id,candidate.label),value:candidate.id,href:authorizedApplicationHome(candidate.id,access),description:this.i18n.t("shell.description."+candidate.id,candidate.description)}));
    return html`<div class=${`app-shell application-${applicationId} ${applicationId==="operations"?"admin-shell":""}`} data-nav-posture=${this.#layoutPosture} data-short-height=${String(this.#shortHeight)} data-layout-intent=${isCreative&&(documentViewFromRoute(path)==="document"||pathname==="/creative/create"||pathname.startsWith("/creative/create/"))?"workbench":"browse"}>
      <a class="skip-link" href="#main-content">${this.i18n.t("shell.skip")}</a>
      <header class="topbar">
        <button class="brand" @click=${() => this.#route(isCanvas?"/canvas/projects":"/projects")} aria-label=${this.i18n.t("shell.openProjects","Open all Forma projects")}><span class="brand-mark">F</span><span>Forma</span></button>
        <forma-ui-workspace-switcher .label=${this.i18n.t("navigation.availableWorkspaces","Available workspaces")} .value=${applicationId} .destinations=${workspaceDestinations} @forma-navigate=${(event:CustomEvent<{value:string;href:string}>)=>{event.preventDefault();this.#route(event.detail.href);}}></forma-ui-workspace-switcher>
        <div class="application-context"><b>${this.i18n.t("shell."+applicationId,application.label)}</b><span>${this.i18n.t("shell.description."+applicationId,application.description)}</span></div>
        <div class="top-actions">
          ${documentFocusFromRoute(path)&&isCreative&&session?html`<span class="document-focus-actor" dir="auto">${session.user.displayName}${session.projectContext?html`<small>${focusedOrganization&&focusedMembership?html`${focusedOrganization.name} · ${this.i18n.t(`workspace.admin.role.${focusedMembership.role}`,focusedMembership.role)}`:this.i18n.t("projects.workspaceKind","Creative workspace")}</small>`:nothing}</span><button type="button" class="button ghost compact document-focus-activity" aria-label=${attention?this.i18n.t("activity.navigationBadge","Activity, {count} items need attention",{count:String(attention)}):this.i18n.t("shell.navigation.activity","Activity")} @click=${()=>this.#route("/activity")}>${icon("spark")}${attention?html`<span>${this.i18n.number(attention)}</span>`:nothing}</button>`:nothing}
          ${this.#localePicker()}
          <button type="button" class="command-trigger forma-global-search" aria-label=${this.i18n.t("shell.command")} aria-haspopup="dialog" aria-expanded=${String(this.store.ui.commandOpen)} aria-keyshortcuts="Meta+K Control+K" @click=${() => this.store.patchUi({ commandOpen: true })}><span aria-hidden="true">${icon("search")}</span><span class="command-label">${this.i18n.t("shell.command")}</span><kbd>⌘ K</kbd></button>
          ${isCreative&&this.store.canManageProjectShares()&&isDocumentViewRoute(path)&&projection.documentId?html`<button class="button secondary compact" @click=${()=>this.#openShare()}>${icon("share")} ${this.i18n.t("shell.share","Share")}</button>`:nothing}
          <button type="button" class=${`avatar ${impersonation?"impersonating":""}`} aria-label=${impersonation?this.i18n.t("shell.impersonationAccount","Open fictional account controls for {name}",{name:impersonation.fictionalUser.displayName}):this.i18n.t("shell.account")} popovertarget="account-popover" aria-controls="account-popover" aria-expanded=${this.store.ui.accountOpen}>${session?.user.displayName?this.i18n.firstGrapheme(session.user.displayName).toLocaleUpperCase(this.i18n.locale):icon("user")}</button>
        </div>
        <div id="account-popover" class="account-popover" popover="auto" @toggle=${this.#accountToggle}>
          ${impersonation ? html`<span class="eyebrow">${this.i18n.t("account.fictional", "Fictional account · impersonating")}</span><b dir="auto">${impersonation.fictionalUser.displayName}</b><p><bdi dir="ltr">${impersonation.fictionalUser.email}</bdi> · ${this.i18n.plural("account.mockEvents", this.store.head.get(), "{count} mock event", "{count} mock events")}</p><div class="account-impersonation-note"><b>${this.i18n.t("account.signedInAs", "Signed in as {name}", { name: "\u2068" + impersonation.actor.displayName + "\u2069" })}</b><p>${this.i18n.t("account.isolation", "Every change requires confirmation and remains isolated in this saved mock.")}</p></div><button class="button primary" @click=${()=>this.store.stopImpersonating()}>${this.i18n.t("account.return", "Return to my account")}</button>` : html`<span class="eyebrow">${this.i18n.t("account.role." + (session?.user.role || "authenticated"), session?.user.role || this.i18n.t("account.role.authenticated", "authenticated"))}</span><b dir="auto">${session?.user.displayName || this.i18n.t("account.signedIn", "Signed-in creative")}</b><p><bdi dir="ltr">${session?.user.email || this.i18n.t("account.identityLoading", "Identity loading")}</bdi>${simplifiedEditor ? nothing : html` · ${this.i18n.plural("account.events", this.store.head.get(), "{count} event", "{count} events")}`}</p>`}
          ${canAdminister&&!simplifiedEditor?html`<nav class="account-nav" aria-label=${this.i18n.t("account.tools", "Platform tools")}>${availableApplications.filter((candidate)=>!["creative","canvas"].includes(candidate.id)).map((candidate)=>{const destination=authorizedApplicationHome(candidate.id,access);return html`<a href=${destination} @click=${(event:MouseEvent)=>{event.preventDefault();this.#route(destination);}}><span>${this.i18n.t("shell."+candidate.id,candidate.label)}</span><span class="ui-directional-icon" aria-hidden="true">${icon("arrow")}</span></a>`;})}</nav>`:nothing}
          <div class="account-policy"><span>${this.i18n.t("account.terms", "Terms")}</span><b>${session?.policy.accepted ? this.i18n.t("account.accepted", "accepted") : this.i18n.t("account.required", "required")}</b><span>${this.i18n.t("account.provider", "Provider")}</span><b>${session?.provider.configured ? this.i18n.t("settings.available", "Available") : this.i18n.t("settings.unavailable", "Unavailable")}</b><span>${this.i18n.t("account.retention", "Content retention")}</span><b>${this.i18n.plural("account.days", session?.policy.retentionDays ?? 30, "{count} day", "{count} days")}</b><span>${this.i18n.t("account.attention", "Attention signals")}</span><b>${impersonation ? this.i18n.t("account.mockOff", "off for mock") : this.store.ui.attentionCapture ? this.store.ui.attentionPaused ? this.i18n.t("account.paused", "paused") : this.i18n.t("account.on", "on") : this.i18n.t("account.off", "off")}</b></div>
          ${impersonation ? nothing : html`<form class="account-preferences" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.instrumentation} @change=${(e: Event) => this.store.patchUi({ instrumentation: (e.target as HTMLInputElement).checked })}><span>${this.i18n.t("account.recordViews", "Record explicit view actions")}</span></label><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.attentionCapture} @change=${(e:Event)=>this.store.setAttentionCapture((e.target as HTMLInputElement).checked)}><span>${this.i18n.t("account.useAttention", "Use attention signals to improve Forma")}</span></label></form>${this.store.ui.attentionCapture?html`<button type="button" class="button ghost compact attention-pause" @click=${()=>this.store.setAttentionPaused(!this.store.ui.attentionPaused)}>${this.store.ui.attentionPaused ? icon("play") : icon("pause")} ${this.store.ui.attentionPaused ? this.i18n.t("account.resume", "Resume on this device") : this.i18n.t("account.pause", "Pause on this device")}</button>`:nothing}<small>${this.i18n.t("account.disclosure", "Opt-in capture runs only while this page is visible. It stores coarse surface, active/idle time, visible item IDs, and the action that ended a period—never pointer paths, keys, typed text, microphone, or ambient device data. Device episodes expire after {days} days.", { days: this.i18n.number(14) })}</small>`}
          ${shared?html`<button type="button" class="button secondary compact" @click=${()=>void this.store.leaveProjectContext()}>${this.i18n.t("workspace.admin.leaveSharedProject","Return to my projects")}</button>`:nothing}
          ${isCreative&&this.store.canManageProjectShares()&&isDocumentViewRoute(path)&&projection.documentId?html`<button type="button" class="button secondary compact account-share-action" @click=${()=>this.#openShare(true)}>${icon("share")} ${this.i18n.t("shell.share","Share")}</button>`:nothing}
          <button type="button" class="button ghost" @click=${() => this.#route("/settings")}>${isCanvas?this.i18n.t("account.privacyCreatorWorkspace","Review privacy in Creator Workspace"):this.i18n.t("account.privacy","Review privacy controls")}</button>
        </div>
      </header>
      ${documentFocusFromRoute(path) ? html`<div class="focus-locale-switcher">${this.#localePicker()}</div>` : nothing}
      ${impersonation?html`<aside class="impersonation-banner" role="status"><span class="impersonation-banner-mark">${icon("user")}</span><div><b>${this.i18n.t("account.bannerTitle", "Fictional account · {name}", { name: "\u2068" + impersonation.fictionalUser.displayName + "\u2069" })}</b><span>${this.i18n.t("account.bannerDetail", "You are signed in as {name}. Every change to this mock account asks for confirmation.", { name: "\u2068" + impersonation.actor.displayName + "\u2069" })}</span></div><button class="button secondary compact" @click=${()=>this.store.stopImpersonating()}>${this.i18n.t("account.return", "Return to my account")}</button></aside>`:nothing}
      ${shared?html`<aside class="impersonation-banner workspace-shared-banner" role="status"><span class="impersonation-banner-mark">${icon("user")}</span><div><b>${this.i18n.t("workspace.admin.sharedProjectMode","You are working inside a shared project.")}</b>${canAuthor?nothing:html`<span>${this.i18n.t("workspace.admin.readOnlyProject","You have view-only access to this shared project.")}</span>`}</div><button type="button" class="button secondary compact" @click=${()=>void this.store.leaveProjectContext()}>${this.i18n.t("workspace.admin.leaveSharedProject","Return to my projects")}</button></aside>`:nothing}
      ${audienceNavigation}
      ${this.store.error.get() ? html`<div class="error-banner" role="alert"><b>${simplifiedEditor ? this.i18n.t("shell.error") : this.i18n.t("shell.streamUnavailable","Durable stream unavailable.")}</b> ${this.store.error.get()} <button @click=${() => this.store.load()}>${this.i18n.t("action.retry")}</button></div>` : nothing}
      <main id="main-content" tabindex="-1" aria-busy=${this.store.loading.get()&&!this.store.events.get().length||!this.store.routeDataReady()?"true":"false"}>${this.store.loading.get()&&!this.store.events.get().length||!this.store.routeDataReady()?html`<section class="application-loading" role="status"><span aria-hidden="true"></span><div><b>${this.i18n.t("shell.loading","",{application:this.i18n.t("shell."+applicationId,application.label)})}</b><p>${this.i18n.t("shell.loadingDetail")}</p></div></section>`:this.#page()}</main>
      ${this.store.ui.toast ? html`<div class="toast" role="status" aria-live="polite" popover="manual">${icon("check")} ${this.i18n.system(this.store.ui.toast)}</div>` : nothing}
      ${this.store.ui.commandOpen ? this.#commands() : nothing}
      ${this.store.ui.shareOpen&&this.store.canManageProjectShares()?this.#share():nothing}
      ${this.store.ui.impersonationConfirmOpen ? this.#impersonationWarning() : nothing}
      ${session&&!session.policy.accepted&&isMaking?this.#terms():nothing}
      <forma-attention-observer></forma-attention-observer>
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.#localeAnnouncement||this.#routeAnnouncement}</span>
      <span class="sr-only" aria-live="polite">${this.store.busy.get() ? this.i18n.t("shell.busy","",{operation:this.store.busy.get()}) : this.store.documentJobs.get().some((job)=>job.status==="running") ? this.i18n.t("shell.running") : this.store.documentJobs.get().some((job)=>job.status==="queued") ? this.i18n.t("shell.queued") : this.i18n.t("action.ready")}</span>
    </div>`;
  }
}
customElements.define("forma-shell", FormaShell);
