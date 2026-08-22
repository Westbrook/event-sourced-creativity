import { html, noChange, nothing } from "lit";
import { FormaElement, icon, downloadJson } from "./forma-element";
import { loadRouteComponent } from "../route-loader";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, withDocumentInRoute } from "../model/routes";
import { APPLICATIONS, applicationDefinition, applicationIdFromRoute, creativeCreationHref, navigationItemActive } from "../platform/applications";
import { canvasFocusFromRoute } from "../canvas/routes";
import { ensureModalDialog } from "./modal-dialog";
import { completeRoutePopulation } from "../performance";
import { FORMA_SUPPORTED_LOCALES, formaLocaleFamily, setFormaLocale } from "./design-system/localization";
import "./forma-attention-observer";

export class FormaShell extends FormaElement {
  #commandIndex = 0;
  #commandComposing = false;
  #shareHours = 24; #freshShareUrl = ""; #termsOwnership = false; #termsProvider = false;
  #dialogObserver?: MutationObserver;
  #lastObservedDocumentView = "";
  #lastObservedApplicationView = "";
  #revealedApplication = "";
  #localeAnnouncement = "";
  #localeRequest = 0;
  #keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.key === "Process" || this.#commandComposing && this.store.ui.commandOpen) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.#commandComposing = false; this.store.patchUi({ commandOpen: !this.store.ui.commandOpen }); }
    const target = event.composedPath()[0];
    const editingField = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !editingField && ["creative","canvas"].includes(applicationIdFromRoute(this.store.route.get()))) { event.preventDefault(); if (event.shiftKey) void this.store.redo(); else void this.store.undo(); }
    if (event.key === "Escape") {
      if(this.store.ui.impersonationConfirmOpen)this.store.resolveImpersonatedInteraction(false);
      else { this.#commandComposing = false; this.store.patchUi({ commandOpen: false, accountOpen: false, shareOpen: false, compareOpen: false }); }
    }
  };
  #routeChanged = (event: Event) => {
    const path = (event as CustomEvent<{ path?: string }>).detail?.path ?? `${location.pathname}${location.search}${location.hash}`;
    void loadRouteComponent(path);
    if (!this.store.loading.get()) void this.store.syncDocumentFromRoute(path);
    this.#observeApplicationView(path);this.#observeDocumentView(path);
  };
  #pop = () => { this.store.setRoute(`${location.pathname}${location.search}${location.hash}`); };
  #changeLocale = async (event: Event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const requested = select.value;
    const revision = ++this.#localeRequest;
    const result = await setFormaLocale(requested);
    if (revision !== this.#localeRequest) return;
    const resolved = formaLocaleFamily(result.locale);
    if (resolved !== requested) {
      select.value = resolved;
      this.#localeAnnouncement = this.i18n.t("language.failed", "The selected language could not be loaded. Please try again.");
    } else {
      const choice = FORMA_SUPPORTED_LOCALES.find((item) => item.locale === resolved);
      this.#localeAnnouncement = this.i18n.t("language.changed", "", { language: choice?.label || resolved });
    }
    this.requestUpdate();
  };

  #localePicker() {
    return html`<form class="locale-picker-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label class="locale-switcher"><span>${this.i18n.t("language.label")}</span><select .value=${formaLocaleFamily(this.i18n.locale)} @change=${this.#changeLocale}>${FORMA_SUPPORTED_LOCALES.map((locale) => html`<option value=${locale.locale} lang=${locale.locale} dir=${locale.direction} ?selected=${locale.locale === formaLocaleFamily(this.i18n.locale)}>${locale.label}</option>`)}</select></label></form>`;
  }

  override connectedCallback() {
    super.connectedCallback(); window.addEventListener("keydown", this.#keydown); window.addEventListener("popstate", this.#pop); window.addEventListener("forma-route-changed", this.#routeChanged);
    this.#dialogObserver = new MutationObserver((records) => {
      const dialogChanged = records.some((record) => record.type === "attributes" || [...record.addedNodes].some((node) => node instanceof Element && (node.matches("dialog") || node.querySelector("dialog"))));
      if (dialogChanged) queueMicrotask(() => this.#raiseToast());
    });
    this.#dialogObserver.observe(this, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    void loadRouteComponent(location.pathname);
    if (!location.pathname.startsWith("/share/")&&!this.store.events.get().length) void this.store.load();
  }
  override disconnectedCallback() { this.#dialogObserver?.disconnect(); window.removeEventListener("keydown", this.#keydown); window.removeEventListener("popstate", this.#pop); window.removeEventListener("forma-route-changed", this.#routeChanged); super.disconnectedCallback(); }

  #raiseToast() {
    const toast = this.querySelector<HTMLElement>(".toast[popover]");
    if (!toast || typeof toast.showPopover !== "function") return;
    try {
      if (toast.matches(":popover-open")) toast.hidePopover();
      toast.showPopover();
    } catch { /* The toast remains a fixed fallback when popovers are unavailable. */ }
  }

  protected override updated() { for(const dialog of this.querySelectorAll<HTMLDialogElement>(".command-dialog,.consent-modal,.impersonation-confirm-dialog,dialog[data-shell-modal]"))ensureModalDialog(dialog);this.#raiseToast();if(!this.store.loading.get()&&this.store.events.get().length&&this.store.routeDataReady())completeRoutePopulation(this.store.route.get());this.#observeApplicationView(this.store.route.get());this.#observeDocumentView(this.store.route.get());this.#revealApplication(); }

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
    if(this.store.loading.get()||!this.store.events.get().length)return;
    const pathname=path.split(/[?#]/)[0]||"/";const application=applicationIdFromRoute(pathname);const projection=this.store.projection.get();const documentId=documentIdFromRoute(pathname)??"";
    const routeFamily=documentId?"document":pathname.startsWith("/operations/events")?"operations-events":pathname.startsWith("/operations/analytics")?"operations-analytics":pathname.startsWith("/operations")?"operations-system":pathname.startsWith("/laboratory/replay")?"laboratory-replay":pathname.startsWith("/laboratory")?"laboratory-home":pathname.startsWith("/canvas/")?"canvas-workspace":pathname==="/canvas"?"canvas-home":pathname.startsWith("/library")?"library":pathname.startsWith("/sessions")?"sessions":pathname.startsWith("/scout")?"scout":pathname.startsWith("/memory")?"memory":pathname.startsWith("/projects")?"projects":"creative-workspace";
    const focused=documentId?documentFocusFromRoute(pathname):application==="canvas"?canvasFocusFromRoute(pathname):undefined;const visitKey=`${routeFamily}:${documentId}:${documentViewFromRoute(pathname)??""}:${focused===true?"focus":"standard"}`;if(visitKey===this.#lastObservedApplicationView)return;this.#lastObservedApplicationView=visitKey;
    void this.store.hot({type:"ApplicationViewVisited",payload:{application,surface:routeFamily,route_family:routeFamily,project_id:documentId||application==="canvas"?projection.projectId:undefined,document_id:documentId||undefined,document_view:documentId?documentViewFromRoute(pathname):undefined,focused}});
  }

  #observeDocumentView(path: string) {
    const view = documentViewFromRoute(path);
    if (!view) { this.#lastObservedDocumentView = ""; return; }
    if (this.store.loading.get() || !this.store.events.get().length) return;
    const projection = this.store.projection.get();
    const documentId = documentIdFromRoute(path) ?? projection.documentId;
    if (!documentId) return;
    const focused = documentFocusFromRoute(path);
    const visitKey = `${documentId}:${view}:${focused ? "focus" : "standard"}`;
    if (visitKey === this.#lastObservedDocumentView) return;
    this.#lastObservedDocumentView = visitKey;
    void this.store.hot({ type: "DocumentViewVisited", payload: { document_id: documentId, project_id: projection.projectId, view, focused, route_family: "document", source_surface: "document-view-navigation" } });
  }

  #route(path: string) { this.#commandComposing = false; this.store.patchUi({ commandOpen: false, accountOpen: false }); this.store.setRoute(path); const hash=path.includes("#")?path.slice(path.indexOf("#")+1):"";if(hash)window.setTimeout(()=>{const target=document.getElementById(hash);target?.scrollIntoView({behavior:"smooth",block:"center"});target?.focus({preventScroll:true});},0);else window.scrollTo({ top: 0 }); }
  #page() {
    const application=applicationIdFromRoute(this.store.route.get());
    if(application==="canvas")return html`<forma-canvas-application></forma-canvas-application>`;
    if(application==="operations")return html`<forma-operations-application></forma-operations-application>`;
    if(application==="laboratory")return html`<forma-laboratory-application></forma-laboratory-application>`;
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
    return html`<dialog class="modal" data-shell-modal open closedby="any" aria-labelledby="share-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({shareOpen:false});}}>
      <div class="modal-card">
        <button class="icon-button modal-close" aria-label=${this.i18n.t("share.close", "Close share dialog")} @click=${() => this.store.patchUi({ shareOpen: false })}>${icon("close")}</button>
        <span class="eyebrow">${this.i18n.t("share.eyebrow", "Private handoff")}</span><h2 id="share-title">${this.i18n.t("share.heading", "Export or share this work")}</h2>
        <p>${this.i18n.t("share.description", "Create a private, view-only link or download a complete copy of this work. Links expire automatically and can be closed at any time.")}</p>
        <form class="share-link-builder" @submit=${async(event:SubmitEvent)=>{event.preventDefault();const share=await this.store.createShare(this.#shareHours);if(share?.token){this.#freshShareUrl=`${location.origin}/share/${share.token}`;await navigator.clipboard.writeText(this.#freshShareUrl);this.requestUpdate();}}}><label>${this.i18n.t("share.lifetime", "Link lifetime")}<select .value=${String(this.#shareHours)} @change=${(e:Event)=>{this.#shareHours=Number((e.target as HTMLSelectElement).value);}}><option value="1">${this.i18n.plural("share.hour", 1, "{count} hour", "{count} hours")}</option><option value="24">${this.i18n.plural("share.hour", 24, "{count} hour", "{count} hours")}</option><option value="72">${this.i18n.plural("share.day", 3, "{count} day", "{count} days")}</option><option value="168">${this.i18n.plural("share.day", 7, "{count} day", "{count} days")}</option></select></label><button type="submit" class="button primary">${icon("share")} ${this.i18n.t("share.create", "Create & copy link")}</button></form>
        ${this.#freshShareUrl ? html`<div class="fresh-share"><b>${this.i18n.t("share.copied", "Copied")}</b><input readonly dir="ltr" aria-label=${this.i18n.t("share.link", "Private sharing link")} .value=${this.#freshShareUrl}><small>${this.i18n.t("share.once", "This private link is shown once and expires automatically.")}</small></div>` : nothing}
        ${this.store.shares.get().some((share)=>share.resourceId===p.documentId) ? html`<div class="share-list"><h3>${this.i18n.t("share.links", "Links to this document")}</h3>${this.store.shares.get().filter((share)=>share.resourceId===p.documentId).slice(0,4).map((share)=>html`<div><span><b>${share.active ? this.i18n.t("share.active", "Active") : this.i18n.t("share.closed", "Closed")}</b><small>${this.i18n.t("share.expires", "Expires {date}", { date: this.i18n.date(new Date(share.expiresAt), { dateStyle: "medium", timeStyle: "short" }) })}</small></span>${share.active?html`<button @click=${()=>this.store.revokeShare(share.shareId)}>${this.i18n.t("share.revoke", "Revoke")}</button>`:nothing}</div>`)}</div>` : nothing}
        <div class="choice-grid">
          ${downloads.map((item, i) => html`<button class="choice-card" @click=${() => { const scopedEventIds=new Set([...p.blocks.flatMap((block)=>block.sourceEvents),...p.outputs.map((output)=>output.sourceEventId),...p.artifacts.map((artifact)=>artifact.sourceEventId)]);const scopedEvents=this.store.events.get().filter((event)=>event.payload.document_id===p.documentId||event.payload.project_id===p.projectId&&event.type==="ProjectCreated"||scopedEventIds.has(event.eventId));downloadJson(`forma-${item.id}.json`, i === 0 ? { documentId:p.documentId,title:p.documentTitle,blocks:p.blocks,blockRelations:p.blockRelations,compile:p.latestCompile } : i === 1 ? {documentId:p.documentId,title:p.documentTitle,result:latestResult??null,blocks:p.blocks,blockRelations:p.blockRelations,compile:p.latestCompile,clearance:"owned"} : {documentId:p.documentId,projectId:p.projectId,events:scopedEvents,projection:{projectId:p.projectId,projectName:p.projectName,documentId:p.documentId,documentTitle:p.documentTitle,blocks:p.blocks,blockRelations:p.blockRelations,outputs:p.outputs,artifacts:p.artifacts}}); this.store.append({type:"ObjectExported",payload:{object_id:latestResult?.id??p.documentId,destination_class:"download",format:"application/json"}});this.store.patchUi({shareOpen:false});}}><b>${item.name}</b><span>${item.description}</span><small>${icon("download")} ${this.i18n.t("share.download", "Download JSON")}</small></button>`) }
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
    const session=this.store.session.get();const canAdminister=(session?.impersonation?.actor.role??session?.user.role)==="admin";
    const simplifiedEditor = documentViewFromRoute(path) === "editor";
    const creative = this.i18n.t("shell.creative", "Creative");
    const document = this.i18n.t("command.document", "Document");
    const creativeCommands = [
      { id: "generate", label: this.i18n.t("command.generate", "Generate from current context"), hint: this.i18n.t("shell.navigation.create", "Create"), run: () => this.#generateFromCommand() },
      { id: "add-context", label: simplifiedEditor ? this.i18n.t("command.addGoal", "Add a goal or creative decision") : this.i18n.t("command.addDecision", "Add a creative decision"), hint: document, run: () => this.#openContextComposer() },
      { id: "open-library", label: this.i18n.t("command.openLibrary", "Open reusable library"), hint: creative, run: () => this.#route("/library") },
      { id: "run-scout", label: this.i18n.t("command.runScout", "Run a bounded scout report"), hint: creative, run: () => this.#route("/scout") },
      { id: "review-memory", label: this.i18n.t("command.reviewMemory", "Review taste and time memory"), hint: creative, run: () => this.#route("/memory") },
      ...(canAdminister?[
        { id: "review-stream", label: this.i18n.t("command.reviewStream", "Review the durable stream"), hint: this.i18n.t("shell.operations", "Operations"), run: () => this.#route("/operations/events") },
        { id: "open-replay", label: this.i18n.t("command.openReplay", "Open replay laboratory"), hint: this.i18n.t("shell.laboratory", "Laboratory"), run: () => this.#route("/laboratory/replay") },
      ]:[]),
      { id: "undo", label: this.i18n.t("command.undo", "Undo last authored change"), hint: "⌘Z", run: () => this.store.undo() },
      { id: "share", label: this.i18n.t("command.share", "Share or download this document"), hint: document, run: () => this.store.patchUi({ shareOpen: true }) },
    ];
    const applicationCommands=[
      ...application.navigation.filter((item)=>applicationId!=="operations"||item.id==="system"||canAdminister).map((item)=>({id:item.id,label:this.i18n.t("command.openNavigation","Open {name}",{name:this.i18n.t("shell.navigation."+item.id,item.label)}),hint:this.i18n.t("shell."+applicationId,application.label),run:()=>this.#route(item.href)})),
      {id:"return-creative",label:this.i18n.t("command.returnCreative","Return to Creative"),hint:this.i18n.t("shell.application","Application"),run:()=>this.#route("/projects")},
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
    if(path.startsWith("/share/"))return html`<div class="shared-locale-switcher">${this.#localePicker()}</div><forma-shared-view .token=${decodeURIComponent(path.slice("/share/".length))}></forma-shared-view><span class="sr-only" role="status" aria-live="polite">${this.#localeAnnouncement}</span>`;
    const session=this.store.session.get();const impersonation=session?.impersonation;
    const simplifiedEditor = documentViewFromRoute(path) === "editor";
    const projection=this.store.projection.get();
    const navigationHref=(id:string,href:string)=>id==="create"?creativeCreationHref(projection,(documentId,documentTitle)=>withDocumentInRoute(href,documentId,documentTitle)):href;
    const creativeNavigation=isCreative?html`<nav class="global-nav area-navigation area-navigation--administrative area-navigation--creative" aria-label=${this.i18n.t("shell.creative")}>
      <span>${this.i18n.t("shell.creative")}</span>
      <div>${application.navigation.map((item)=>{const href=navigationHref(item.id,item.href);const active=navigationItemActive(applicationId,item.id,path);return html`<a href=${href} title=${this.i18n.t("shell.description."+item.id,item.description)} class=${active?"active":""} aria-current=${active?"page":nothing} @click=${(event:MouseEvent)=>{event.preventDefault();this.#route(href);}}>${this.i18n.t("shell.navigation."+item.id,item.label)}</a>`;})}</div>
    </nav>`:nothing;
    const canvasNavigation=isCanvas?html`<nav class="global-nav area-navigation area-navigation--administrative area-navigation--canvas" aria-label=${this.i18n.t("shell.canvas")}><span>${this.i18n.t("shell.canvas")}</span><div>${application.navigation.map((item)=>{const active=navigationItemActive(applicationId,item.id,path);return html`<a href=${item.href} title=${this.i18n.t("shell.description."+item.id,item.description)} class=${active?"active":""} aria-current=${active?"page":nothing} @click=${(event:MouseEvent)=>{event.preventDefault();this.#route(item.href);}}>${this.i18n.t("shell.navigation."+item.id,item.label)}</a>`;})}</div></nav>`:nothing;
    return html`<div class=${`app-shell application-${applicationId} ${applicationId==="operations"?"admin-shell":""}`}>
      <header class="topbar">
        <button class="brand" @click=${() => this.#route("/projects")} aria-label=${this.i18n.t("shell.openProjects","Open all Forma projects")}><span class="brand-mark">F</span><span>Forma</span></button>
        <nav class="application-switcher" aria-label=${this.i18n.t("shell.application")}>${APPLICATIONS.filter((candidate)=>candidate.id!=="laboratory"||(impersonation?.actor.role??session?.user.role)==="admin").map((candidate)=>html`<a href=${candidate.home} title=${this.i18n.t("shell.description."+candidate.id,candidate.description)} class=${candidate.id===applicationId?"active":""} aria-current=${candidate.id===applicationId?"page":nothing} @click=${(event:MouseEvent)=>{event.preventDefault();this.#route(candidate.home);}}>${this.i18n.t("shell."+candidate.id,candidate.label)}</a>`)}</nav>
        <div class="application-context"><b>${this.i18n.t("shell."+applicationId,application.label)}</b><span>${this.i18n.t("shell.description."+applicationId,application.description)}</span></div>
        <div class="top-actions">
          ${this.#localePicker()}
          <button class="command-trigger" aria-label=${this.i18n.t("shell.command")} aria-keyshortcuts="Meta+K Control+K" @click=${() => this.store.patchUi({ commandOpen: true })}><span aria-hidden="true">${icon("search")}</span><span class="command-label">${this.i18n.t("shell.command")}</span><kbd>⌘ K</kbd></button>
          ${isCreative&&isDocumentViewRoute(path)&&projection.documentId ? html`<button class="button secondary compact" @click=${() => {void this.store.loadShares();this.store.patchUi({ shareOpen: true });}}>${icon("share")} ${this.i18n.t("shell.share", "Share")}</button>` : nothing}
          <button class=${`avatar ${impersonation?"impersonating":""}`} aria-label=${impersonation?this.i18n.t("shell.impersonationAccount","Open fictional account controls for {name}",{name:impersonation.fictionalUser.displayName}):this.i18n.t("shell.account")} aria-expanded=${this.store.ui.accountOpen} @click=${() => this.store.patchUi({ accountOpen: !this.store.ui.accountOpen })}>${session?.user.displayName?this.i18n.firstGrapheme(session.user.displayName).toLocaleUpperCase(this.i18n.locale):"·"}</button>
        </div>
        ${this.store.ui.accountOpen ? html`<div class="account-popover">
          ${impersonation ? html`<span class="eyebrow">${this.i18n.t("account.fictional", "Fictional account · impersonating")}</span><b dir="auto">${impersonation.fictionalUser.displayName}</b><p><bdi dir="ltr">${impersonation.fictionalUser.email}</bdi> · ${this.i18n.plural("account.mockEvents", this.store.head.get(), "{count} mock event", "{count} mock events")}</p><div class="account-impersonation-note"><b>${this.i18n.t("account.signedInAs", "Signed in as {name}", { name: "\u2068" + impersonation.actor.displayName + "\u2069" })}</b><p>${this.i18n.t("account.isolation", "Every change requires confirmation and remains isolated in this saved mock.")}</p></div><button class="button primary" @click=${()=>this.store.stopImpersonating()}>${this.i18n.t("account.return", "Return to my account")}</button>` : html`<span class="eyebrow">${this.i18n.t("account.role." + (session?.user.role || "authenticated"), session?.user.role || this.i18n.t("account.role.authenticated", "authenticated"))}</span><b dir="auto">${session?.user.displayName || this.i18n.t("account.signedIn", "Signed-in creative")}</b><p><bdi dir="ltr">${session?.user.email || this.i18n.t("account.identityLoading", "Identity loading")}</bdi>${simplifiedEditor ? nothing : html` · ${this.i18n.plural("account.events", this.store.head.get(), "{count} event", "{count} events")}`}</p>`}
          <nav class="account-nav" aria-label=${this.i18n.t("account.tools", "Platform tools")}><a href="/operations" @click=${(event:MouseEvent)=>{event.preventDefault();this.#route("/operations");}}><span>${this.i18n.t("shell.operations", "Operations")}</span><span class="ui-directional-icon" aria-hidden="true">${icon("arrow")}</span></a>${(impersonation?.actor.role??session?.user.role)==="admin"&&!simplifiedEditor?html`<a href="/operations/events" @click=${(event:MouseEvent)=>{event.preventDefault();this.#route("/operations/events");}}><span>${this.i18n.t("shell.navigation.stream", "Durable stream")}</span><span class="ui-directional-icon" aria-hidden="true">${icon("arrow")}</span></a><a href="/laboratory/replay" @click=${(event:MouseEvent)=>{event.preventDefault();this.#route("/laboratory/replay");}}><span>${this.i18n.t("shell.laboratory", "Laboratory")}</span><span class="ui-directional-icon" aria-hidden="true">${icon("arrow")}</span></a>`:nothing}</nav>
          <div class="account-policy"><span>${this.i18n.t("account.terms", "Terms")}</span><b>${session?.policy.accepted ? this.i18n.t("account.accepted", "accepted") : this.i18n.t("account.required", "required")}</b><span>${this.i18n.t("account.provider", "Provider")}</span><b dir=${session?.provider.configured ? "ltr" : nothing}>${session?.provider.configured ? session.provider.model : this.i18n.t("account.keyRequired", "key required")}</b><span>${this.i18n.t("account.retention", "Content retention")}</span><b>${this.i18n.plural("account.days", session?.policy.retentionDays ?? 30, "{count} day", "{count} days")}</b><span>${this.i18n.t("account.attention", "Attention signals")}</span><b>${impersonation ? this.i18n.t("account.mockOff", "off for mock") : this.store.ui.attentionCapture ? this.store.ui.attentionPaused ? this.i18n.t("account.paused", "paused") : this.i18n.t("account.on", "on") : this.i18n.t("account.off", "off")}</b></div>
          ${impersonation ? nothing : html`<form class="account-preferences" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.instrumentation} @change=${(e: Event) => this.store.patchUi({ instrumentation: (e.target as HTMLInputElement).checked })}><span>${this.i18n.t("account.recordViews", "Record explicit view actions")}</span></label><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.attentionCapture} @change=${(e:Event)=>this.store.setAttentionCapture((e.target as HTMLInputElement).checked)}><span>${this.i18n.t("account.useAttention", "Use attention signals to improve Forma")}</span></label></form>${this.store.ui.attentionCapture?html`<button type="button" class="button ghost compact attention-pause" @click=${()=>this.store.setAttentionPaused(!this.store.ui.attentionPaused)}>${this.store.ui.attentionPaused ? icon("play") : icon("pause")} ${this.store.ui.attentionPaused ? this.i18n.t("account.resume", "Resume on this device") : this.i18n.t("account.pause", "Pause on this device")}</button>`:nothing}<small>${this.i18n.t("account.disclosure", "Opt-in capture runs only while this page is visible. It stores coarse surface, active/idle time, visible item IDs, and the action that ended a period—never pointer paths, keys, typed text, microphone, or ambient device data. Device episodes expire after {days} days.", { days: this.i18n.number(14) })}</small>`}
          <button class="button ghost" @click=${() => this.#route("/operations#governance")}>${this.i18n.t("account.privacy", "Review privacy controls")}</button>
        </div>` : nothing}
      </header>
      ${documentFocusFromRoute(path) ? html`<div class="focus-locale-switcher">${this.#localePicker()}</div>` : nothing}
      ${impersonation?html`<aside class="impersonation-banner" role="status"><span class="impersonation-banner-mark">${icon("user")}</span><div><b>${this.i18n.t("account.bannerTitle", "Fictional account · {name}", { name: "\u2068" + impersonation.fictionalUser.displayName + "\u2069" })}</b><span>${this.i18n.t("account.bannerDetail", "You are signed in as {name}. Every change to this mock account asks for confirmation.", { name: "\u2068" + impersonation.actor.displayName + "\u2069" })}</span></div><button class="button secondary compact" @click=${()=>this.store.stopImpersonating()}>${this.i18n.t("account.return", "Return to my account")}</button></aside>`:nothing}
      ${creativeNavigation}${canvasNavigation}
      ${this.store.error.get() ? html`<div class="error-banner" role="alert"><b>${simplifiedEditor ? this.i18n.t("shell.error") : this.i18n.t("shell.streamUnavailable","Durable stream unavailable.")}</b> ${this.store.error.get()} <button @click=${() => this.store.load()}>${this.i18n.t("action.retry")}</button></div>` : nothing}
      <a class="skip-link" href="#main-content">${this.i18n.t("shell.skip")}</a>
      <main id="main-content" tabindex="-1" aria-busy=${this.store.loading.get()&&!this.store.events.get().length||!this.store.routeDataReady()?"true":"false"}>${this.store.loading.get()&&!this.store.events.get().length||!this.store.routeDataReady()?html`<section class="application-loading" role="status"><span aria-hidden="true"></span><div><b>${this.i18n.t("shell.loading","",{application:this.i18n.t("shell."+applicationId,application.label)})}</b><p>${this.i18n.t("shell.loadingDetail")}</p></div></section>`:this.#page()}</main>
      ${this.store.ui.toast ? html`<div class="toast" role="status" aria-live="polite" popover="manual">${icon("check")} ${this.store.ui.toast}</div>` : nothing}
      ${this.store.ui.commandOpen ? this.#commands() : nothing}
      ${this.store.ui.shareOpen ? this.#share() : nothing}
      ${this.store.ui.impersonationConfirmOpen ? this.#impersonationWarning() : nothing}
      ${session&&!session.policy.accepted&&isMaking?this.#terms():nothing}
      <forma-attention-observer></forma-attention-observer>
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.#localeAnnouncement}</span>
      <span class="sr-only" aria-live="polite">${this.store.busy.get() ? this.i18n.t("shell.busy","",{operation:this.store.busy.get()}) : this.store.documentJobs.get().some((job)=>job.status==="running") ? this.i18n.t("shell.running") : this.store.documentJobs.get().some((job)=>job.status==="queued") ? this.i18n.t("shell.queued") : this.i18n.t("action.ready")}</span>
    </div>`;
  }
}
customElements.define("forma-shell", FormaShell);
