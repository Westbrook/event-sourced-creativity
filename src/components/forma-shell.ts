import { html, nothing } from "lit";
import { FormaElement, icon, downloadJson } from "./forma-element";
import { loadRouteComponent } from "../route-loader";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, withDocumentInRoute } from "../model/routes";
import { APPLICATIONS, applicationDefinition, applicationIdFromRoute, navigationItemActive } from "../platform/applications";
import "./forma-attention-observer";

export class FormaShell extends FormaElement {
  #commandIndex = 0;
  #shareHours = 24; #freshShareUrl = ""; #termsOwnership = false; #termsProvider = false;
  #dialogObserver?: MutationObserver;
  #lastObservedDocumentView = "";
  #lastObservedApplicationView = "";
  #keydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.store.patchUi({ commandOpen: !this.store.ui.commandOpen }); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && ["creative","canvas"].includes(applicationIdFromRoute(this.store.route.get()))) { event.preventDefault(); if (event.shiftKey) void this.store.redo(); else void this.store.undo(); }
    if (event.key === "Escape") {
      if(this.store.ui.impersonationConfirmOpen)this.store.resolveImpersonatedInteraction(false);
      else this.store.patchUi({ commandOpen: false, accountOpen: false, shareOpen: false, compareOpen: false });
    }
  };
  #routeChanged = (event: Event) => {
    const path = (event as CustomEvent<{ path?: string }>).detail?.path ?? `${location.pathname}${location.search}${location.hash}`;
    void loadRouteComponent(path);
    if (!this.store.loading.get()) void this.store.syncDocumentFromRoute(path);
    this.#observeApplicationView(path);this.#observeDocumentView(path);
  };
  #pop = () => { this.store.setRoute(`${location.pathname}${location.search}${location.hash}`); };

  override connectedCallback() {
    super.connectedCallback(); window.addEventListener("keydown", this.#keydown); window.addEventListener("popstate", this.#pop); window.addEventListener("forma-route-changed", this.#routeChanged);
    this.#dialogObserver = new MutationObserver((records) => {
      const dialogChanged = records.some((record) => record.type === "attributes" || [...record.addedNodes].some((node) => node instanceof Element && (node.matches("dialog") || node.querySelector("dialog"))));
      if (dialogChanged) queueMicrotask(() => this.#raiseToast());
    });
    this.#dialogObserver.observe(this, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    void loadRouteComponent(location.pathname);
    if (!this.store.events.get().length) void this.store.load();
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

  protected override updated() { this.#raiseToast();this.#observeApplicationView(this.store.route.get());this.#observeDocumentView(this.store.route.get()); }

  #observeApplicationView(path:string){
    if(this.store.loading.get()||!this.store.events.get().length)return;
    const pathname=path.split(/[?#]/)[0]||"/";const application=applicationIdFromRoute(pathname);const projection=this.store.projection.get();const documentId=documentIdFromRoute(pathname)??"";
    const routeFamily=documentId?"document":pathname.startsWith("/operations/events")?"operations-events":pathname.startsWith("/operations/analytics")?"operations-analytics":pathname.startsWith("/operations")?"operations-system":pathname.startsWith("/laboratory/replay")?"laboratory-replay":pathname.startsWith("/laboratory")?"laboratory-home":pathname.startsWith("/canvas/")?"canvas-workspace":pathname==="/canvas"?"canvas-home":pathname.startsWith("/library")?"library":pathname.startsWith("/sessions")?"sessions":pathname.startsWith("/scout")?"scout":pathname.startsWith("/memory")?"memory":pathname.startsWith("/projects")?"projects":"creative-workspace";
    const visitKey=`${routeFamily}:${documentId}:${documentViewFromRoute(pathname)??""}:${documentFocusFromRoute(pathname)?"focus":"standard"}`;if(visitKey===this.#lastObservedApplicationView)return;this.#lastObservedApplicationView=visitKey;
    void this.store.hot({type:"ApplicationViewVisited",payload:{application,surface:routeFamily,route_family:routeFamily,project_id:documentId?projection.projectId:undefined,document_id:documentId||undefined,document_view:documentId?documentViewFromRoute(pathname):undefined,focused:documentId?documentFocusFromRoute(pathname):undefined}});
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

  #route(path: string) { this.store.patchUi({ commandOpen: false, accountOpen: false }); this.store.setRoute(path); const hash=path.includes("#")?path.slice(path.indexOf("#")+1):"";if(hash)window.setTimeout(()=>{const target=document.getElementById(hash);target?.scrollIntoView({behavior:"smooth",block:"center"});target?.focus({preventScroll:true});},0);else window.scrollTo({ top: 0 }); }
  #page() {
    const application=applicationIdFromRoute(this.store.route.get());
    if(application==="canvas")return html`<forma-canvas-application></forma-canvas-application>`;
    if(application==="operations")return html`<forma-operations-application></forma-operations-application>`;
    if(application==="laboratory")return html`<forma-laboratory-application></forma-laboratory-application>`;
    return html`<forma-creative-application></forma-creative-application>`;
  }
  #share() {
    const p = this.store.projection.get();
    const simplifiedEditor = documentViewFromRoute(this.store.route.get()) === "editor";
    const downloads = simplifiedEditor
      ? [
          ["Creative plan", "The ideas, priorities, and guardrails shaping this document."],
          ["Preview + plan", "The latest visual together with the thinking that shaped it."],
          ["Complete document", "A restorable copy containing everything in this document."],
        ]
      : [
          ["Recipe", "Blocks, weights, constraints, and compiler snapshot."],
          ["Output + receipts", "Selected output with source context and rights clearance."],
          ["Full graph", "Event stream, projections, provenance edges, and media manifest."],
        ];
    return html`<dialog class="modal" open closedby="any" aria-labelledby="share-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({shareOpen:false});}}>
      <div class="modal-card">
        <button class="icon-button modal-close" aria-label="Close share dialog" @click=${() => this.store.patchUi({ shareOpen: false })}>${icon("close")}</button>
        <span class="eyebrow">Private handoff</span><h2 id="share-title">Export or share this work</h2>
        <p>${simplifiedEditor ? "Create a private, view-only link or download a copy of this work. You can close shared links whenever you need to." : "Create an expiring, revocable, read-only projection or download a lossless archive. New links are private by default."}</p>
        <div class="share-link-builder"><label>Link lifetime<select .value=${String(this.#shareHours)} @change=${(e:Event)=>{this.#shareHours=Number((e.target as HTMLSelectElement).value);}}><option value="1">1 hour</option><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></label><button class="button primary" @click=${async()=>{const share=await this.store.createShare(this.#shareHours);if(share?.token){this.#freshShareUrl=`${location.origin}/share/${share.token}`;await navigator.clipboard.writeText(this.#freshShareUrl);this.requestUpdate();}}}>${icon("share")} Create & copy link</button></div>
        ${this.#freshShareUrl ? html`<div class="fresh-share"><b>Copied</b><input readonly .value=${this.#freshShareUrl}><small>${simplifiedEditor ? "This private link is shown once and expires automatically." : "The secret token is shown once. The durable event stores only the share ID and expiry."}</small></div>` : nothing}
        ${this.store.shares.get().length ? html`<div class="share-list"><h3>Recent links</h3>${this.store.shares.get().slice(0,4).map((share)=>html`<div><span><b>${share.active?"Active":"Closed"}</b><small>Expires ${new Date(share.expiresAt).toLocaleString()}</small></span>${share.active?html`<button @click=${()=>this.store.revokeShare(share.shareId)}>Revoke</button>`:nothing}</div>`)}</div>` : nothing}
        <div class="choice-grid">
          ${downloads.map(([name, desc], i) => html`<button class="choice-card" @click=${() => { downloadJson(`forma-${name.toLowerCase().replaceAll(" ", "-")}.json`, i === 0 ? { blocks: p.blocks, compile: p.latestCompile } : i === 1 ? { output: p.outputs[0], compile: p.latestCompile, clearance: "owned" } : { events: this.store.events.get(), projection: { ...p, presentedBriefItems: [...p.presentedBriefItems] } }); this.store.append({ type: "ObjectExported", payload: { object_id: p.outputs[0]?.id ?? p.documentId, destination_class: "download", format: "application/json" } }); this.store.patchUi({ shareOpen: false }); } }><b>${name}</b><span>${desc}</span><small>${icon("download")} Download JSON</small></button>`) }
        </div>
        <div class="gate-note"><span>${icon("lock")}</span><div><b>${simplifiedEditor ? "View only" : "Read-only by construction"}</b><p>${simplifiedEditor ? "People with the link can look, but they cannot change your document. Links expire after at most seven days and can be closed immediately." : "Links carry no append authority, expire after at most seven days, and can be revoked immediately. Sites access controls still apply."}</p></div></div>
      </div>
    </dialog>`;
  }
  #terms() {
    return html`<dialog class="modal consent-modal" open closedby="none" aria-labelledby="consent-title"><div class="modal-card"><span class="eyebrow">Pilot governance · ${this.store.session.get()?.policy.version}</span><h2 id="consent-title">Set the rules before creating</h2><p>Forma keeps prompts and provider outputs private for ${this.store.session.get()?.policy.retentionDays ?? 30} days. Optional attention signals remain off until you enable them separately in privacy settings.</p><label class="consent-check"><input type="checkbox" .checked=${this.#termsOwnership} @change=${(e:Event)=>{this.#termsOwnership=(e.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>I control the work I submit</b><small>I own it or have permission to use it; external assets require a separate assertion at upload.</small></span></label><label class="consent-check"><input type="checkbox" .checked=${this.#termsProvider} @change=${(e:Event)=>{this.#termsProvider=(e.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>I approve private provider processing</b><small>Generation context may be sent to the configured OpenAI Responses API with server-side credentials.</small></span></label><button class="button primary consent-action" ?disabled=${!this.#termsOwnership||!this.#termsProvider||!!this.store.busy.get()} @click=${()=>this.store.acceptTerms()}>${this.store.busy.get()==="consent"?"Recording…":"Accept pilot terms"}</button></div></dialog>`;
  }
  #impersonationWarning(){
    const session=this.store.session.get();const impersonation=session?.impersonation;if(!impersonation)return nothing;const action=this.store.ui.impersonationAction||"change this fictional account";
    return html`<dialog class="modal impersonation-confirm-dialog" open closedby="any" aria-labelledby="impersonation-confirm-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.resolveImpersonatedInteraction(false);}} @cancel=${(event:Event)=>{event.preventDefault();this.store.resolveImpersonatedInteraction(false);}} @close=${()=>{if(this.store.ui.impersonationConfirmOpen)this.store.resolveImpersonatedInteraction(false);}}><div class="modal-card impersonation-confirm-card"><button class="icon-button modal-close" aria-label="Cancel this interaction" @click=${()=>this.store.resolveImpersonatedInteraction(false)}>${icon("close")}</button><span class="eyebrow">Fictional account safeguard</span><h2 id="impersonation-confirm-title">You’re acting as ${impersonation.fictionalUser.displayName}</h2><p>You are about to <b>${action}</b>. This will change the saved mock account and become part of its durable history; it will not change ${impersonation.actor.displayName}’s regular account.</p><div class="impersonation-confirm-note"><span>${icon("lock")}</span><div><b>Confirm this interaction only</b><p>Canceling, pressing Escape, closing the dialog, or clicking its backdrop prevents the interaction entirely.</p></div></div><footer><button class="button ghost" @click=${()=>this.store.resolveImpersonatedInteraction(false)}>Cancel — do nothing</button><button class="button primary" @click=${()=>this.store.resolveImpersonatedInteraction(true)}>I understand, continue</button></footer></div></dialog>`;
  }
  #commands() {
    const q = this.store.ui.search.toLowerCase();
    const path=this.store.route.get();const applicationId=applicationIdFromRoute(path);const application=applicationDefinition(applicationId);
    const simplifiedEditor = documentViewFromRoute(path) === "editor";
    const creativeCommands = [
      { label: "Generate from current context", hint: "Create", run: () => this.store.generate() },
      { label: simplifiedEditor ? "Add a goal" : "Add a direction block", hint: "Document", run: () => this.store.append({ type: "BlockCreated", payload: { block_id: crypto.randomUUID(), type: "direction", handle: `direction/study-${this.store.head.get()}`, position: `z${this.store.head.get()}`, properties: { text: simplifiedEditor ? "Describe what this work should achieve" : "A new creative direction", weight: .65, authority: "authored" } } }) },
      { label: "Open reusable library", hint: "Creative", run: () => this.#route("/library") },
      { label: "Run a bounded scout report", hint: "Creative", run: () => this.#route("/scout") },
      { label: "Review taste and time memory", hint: "Creative", run: () => this.#route("/memory") },
      { label: "Review the durable stream", hint: "Operations", run: () => this.#route("/operations/events") },
      { label: "Open replay laboratory", hint: "Laboratory", run: () => this.#route("/laboratory/replay") },
      { label: "Undo last authored change", hint: "⌘Z", run: () => this.store.undo() },
      { label: simplifiedEditor ? "Share or download" : "Export full graph", hint: simplifiedEditor ? "Document" : "JSON", run: () => this.store.patchUi({ shareOpen: true }) },
    ];
    const applicationCommands=[
      ...application.navigation.map((item)=>({label:`Open ${item.label}`,hint:application.label,run:()=>this.#route(item.href)})),
      {label:"Return to Creative",hint:"Application",run:()=>this.#route("/projects")},
    ];
    const commands=(applicationId==="creative"?creativeCommands:applicationCommands).filter((c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q));
    const run = async (index: number) => { const command = commands[index]; if (!command) return; this.store.patchUi({ commandOpen: false, search: "" }); this.#commandIndex = 0; await command.run(); };
    return html`<dialog class="command-dialog" open closedby="any" aria-labelledby="command-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({commandOpen:false});}}>
      <div class="command-card">
        <label id="command-title" class="sr-only" for="command-search">Search commands</label>
        <div class="command-search"><span>${icon("search")}</span><input id="command-search" autofocus placeholder="Type a command…" .value=${this.store.ui.search} @input=${(e: InputEvent) => { this.#commandIndex = 0; this.store.patchUi({ search: (e.target as HTMLInputElement).value }); }} @keydown=${(e: KeyboardEvent) => { if (e.key === "ArrowDown") { e.preventDefault(); this.#commandIndex = Math.min(commands.length - 1, this.#commandIndex + 1); this.requestUpdate(); } else if (e.key === "ArrowUp") { e.preventDefault(); this.#commandIndex = Math.max(0, this.#commandIndex - 1); this.requestUpdate(); } else if (e.key === "Enter") { e.preventDefault(); void run(this.#commandIndex); } }}><kbd>esc</kbd></div>
        <div class="command-results" role="listbox">${commands.map((c, i) => html`<button class="command-row" role="option" aria-selected=${i === this.#commandIndex} @mouseenter=${() => { this.#commandIndex = i; this.requestUpdate(); }} @click=${() => run(i)}><span>${c.label}</span><small>${c.hint}</small></button>`)}</div>
        <footer><span>↑↓ navigate</span><span>↵ run</span><span>${applicationId==="creative"?(simplifiedEditor ? "Changes save automatically" : "Commands append or navigate"):applicationId==="canvas"?"Canvas changes append durable operations":"Navigation does not mutate creative state"}</span></footer>
      </div>
    </dialog>`;
  }

  override render() {
    const path = this.store.route.get();const applicationId=applicationIdFromRoute(path);const application=applicationDefinition(applicationId);const isCreative=applicationId==="creative";const isCanvas=applicationId==="canvas";const isMaking=isCreative||isCanvas;
    if(path.startsWith("/share/"))return html`<forma-shared-view .token=${decodeURIComponent(path.slice("/share/".length))}></forma-shared-view>`;
    const session=this.store.session.get();const impersonation=session?.impersonation;
    const simplifiedEditor = documentViewFromRoute(path) === "editor";
    const projection=this.store.projection.get();
    const navigationHref=(id:string,href:string)=>id==="create"?withDocumentInRoute(href,projection.documentId,projection.documentTitle):href;
    const creativeNavigation=isCreative?html`<nav class="global-nav area-navigation area-navigation--administrative area-navigation--creative" aria-label="Creative">
      <span>Creative</span>
      <div>${application.navigation.map((item)=>{const href=navigationHref(item.id,item.href);const active=navigationItemActive(applicationId,item.id,path);return html`<a href=${href} title=${item.description} class=${active?"active":""} aria-current=${active?"page":nothing} @click=${(event:MouseEvent)=>{event.preventDefault();this.#route(href);}}>${item.label}</a>`;})}</div>
    </nav>`:nothing;
    const canvasNavigation=isCanvas?html`<nav class="global-nav area-navigation area-navigation--administrative area-navigation--canvas" aria-label="Canvas"><span>Canvas</span><div>${application.navigation.map((item)=>{const active=navigationItemActive(applicationId,item.id,path);return html`<a href=${item.href} title=${item.description} class=${active?"active":""} aria-current=${active?"page":nothing} @click=${(event:MouseEvent)=>{event.preventDefault();this.#route(item.href);}}>${item.label}</a>`;})}</div></nav>`:nothing;
    return html`<div class=${`app-shell application-${applicationId} ${applicationId==="operations"?"admin-shell":""}`}>
      <header class="topbar">
        <button class="brand" @click=${() => this.#route("/projects")} aria-label="Open all Forma projects"><span class="brand-mark">F</span><span>Forma</span></button>
        <nav class="application-switcher" aria-label="Application">${APPLICATIONS.map((candidate)=>html`<a href=${candidate.home} title=${candidate.description} class=${candidate.id===applicationId?"active":""} aria-current=${candidate.id===applicationId?"page":nothing} @click=${(event:MouseEvent)=>{event.preventDefault();this.#route(candidate.home);}}>${candidate.label}</a>`)}</nav>
        <div class="application-context"><b>${application.label}</b><span>${application.description}</span></div>
        <div class="top-actions">
          <button class="command-trigger" @click=${() => this.store.patchUi({ commandOpen: true })}><span>${icon("search")}</span><span class="command-label">Search or command</span><kbd>⌘ K</kbd></button>
          ${isMaking ? html`<button class="button secondary compact" @click=${() => {void this.store.loadShares();this.store.patchUi({ shareOpen: true });}}>${icon("share")} Share</button>` : nothing}
          <button class=${`avatar ${impersonation?"impersonating":""}`} aria-label=${impersonation?`Open fictional account controls for ${impersonation.fictionalUser.displayName}`:"Open account and privacy settings"} aria-expanded=${this.store.ui.accountOpen} @click=${() => this.store.patchUi({ accountOpen: !this.store.ui.accountOpen })}>${session?.user.displayName?.slice(0,1).toUpperCase()??"·"}</button>
        </div>
        ${this.store.ui.accountOpen ? html`<div class="account-popover">${impersonation?html`<span class="eyebrow">Fictional account · impersonating</span><b>${impersonation.fictionalUser.displayName}</b><p>${impersonation.fictionalUser.email} · ${this.store.head.get()} mock events</p><div class="account-impersonation-note"><b>Signed in as ${impersonation.actor.displayName}</b><p>Every change requires confirmation and remains isolated in this saved mock.</p></div><button class="button primary" @click=${()=>this.store.stopImpersonating()}>Return to my account</button>`:html`<span class="eyebrow">${session?.user.role??"authenticated"}</span><b>${session?.user.displayName??"Signed-in creative"}</b><p>${session?.user.email??"Identity loading"}${simplifiedEditor ? nothing : ` · ${this.store.head.get()} events`}</p>`}<nav class="account-nav" aria-label="Platform tools"><a href="/operations" @click=${(event:MouseEvent)=>{event.preventDefault();this.#route("/operations");}}><span>Operations</span>${icon("arrow")}</a>${(impersonation?.actor.role??session?.user.role)==="admin"&&!simplifiedEditor?html`<a href="/operations/events" @click=${(event:MouseEvent)=>{event.preventDefault();this.#route("/operations/events");}}><span>Durable stream</span>${icon("arrow")}</a><a href="/laboratory/replay" @click=${(event:MouseEvent)=>{event.preventDefault();this.#route("/laboratory/replay");}}><span>Laboratory</span>${icon("arrow")}</a>`:nothing}</nav><div class="account-policy"><span>Terms</span><b>${session?.policy.accepted?"accepted":"required"}</b><span>Provider</span><b>${session?.provider.configured?session.provider.model:"key required"}</b><span>Content retention</span><b>${session?.policy.retentionDays??30} days</b><span>Attention signals</span><b>${impersonation?"off for mock":this.store.ui.attentionCapture?(this.store.ui.attentionPaused?"paused":"on"):"off"}</b></div>${impersonation?nothing:html`<label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.instrumentation} @change=${(e: Event) => this.store.patchUi({ instrumentation: (e.target as HTMLInputElement).checked })}><span>Record explicit view actions</span></label><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.attentionCapture} @change=${(e:Event)=>this.store.setAttentionCapture((e.target as HTMLInputElement).checked)}><span>Use attention signals to improve Forma</span></label>${this.store.ui.attentionCapture?html`<button class="button ghost compact attention-pause" @click=${()=>this.store.setAttentionPaused(!this.store.ui.attentionPaused)}>${this.store.ui.attentionPaused?icon("play"):icon("pause")} ${this.store.ui.attentionPaused?"Resume on this device":"Pause on this device"}</button>`:nothing}<small>Opt-in capture runs only while this page is visible. It stores coarse surface, active/idle time, visible item IDs, and the action that ended a period—never pointer paths, keys, typed text, microphone, or ambient device data. Device episodes expire after 14 days.</small>`}<button class="button ghost" @click=${() => this.#route("/operations#governance")}>Review privacy controls</button></div>` : nothing}
      </header>
      ${impersonation?html`<aside class="impersonation-banner" role="status"><span class="impersonation-banner-mark">${icon("user")}</span><div><b>Fictional account · ${impersonation.fictionalUser.displayName}</b><span>You are signed in as ${impersonation.actor.displayName}. Every change to this mock account asks for confirmation.</span></div><button class="button secondary compact" @click=${()=>this.store.stopImpersonating()}>Return to my account</button></aside>`:nothing}
      ${creativeNavigation}${canvasNavigation}
      ${this.store.error.get() ? html`<div class="error-banner" role="alert"><b>${simplifiedEditor ? "Your work could not be loaded." : "Durable stream unavailable."}</b> ${this.store.error.get()} <button @click=${() => this.store.load()}>Retry</button></div>` : nothing}
      <main id="main-content">${this.#page()}</main>
      ${this.store.ui.toast ? html`<div class="toast" role="status" aria-live="polite" popover="manual">${icon("check")} ${this.store.ui.toast}</div>` : nothing}
      ${this.store.ui.commandOpen ? this.#commands() : nothing}
      ${this.store.ui.shareOpen ? this.#share() : nothing}
      ${this.store.ui.impersonationConfirmOpen ? this.#impersonationWarning() : nothing}
      ${session&&!session.policy.accepted&&isMaking?this.#terms():nothing}
      <forma-attention-observer></forma-attention-observer>
      <span class="sr-only" aria-live="polite">${this.store.busy.get() ? `Working: ${this.store.busy.get()}` : this.store.documentJobs.get().some((job)=>job.status==="running") ? "A document operation is running on the server" : this.store.documentJobs.get().some((job)=>job.status==="queued") ? "A document operation is queued" : "Ready"}</span>
    </div>`;
  }
}
customElements.define("forma-shell", FormaShell);
