import { html, nothing } from "lit";
import { FormaElement, icon, downloadJson } from "./forma-element";
import { loadRouteComponent } from "../route-loader";
import "./forma-attention-observer";

const routes = [
  { href: "/projects", label: "Projects", description: "Choose a creative workspace" },
  { href: "/", label: "Studio", description: "Work in the current document" },
  { href: "/library", label: "Library", description: "Reuse project context and outputs" },
  { href: "/sessions", label: "Re-entry", description: "Resume witnessed work" },
  { href: "/scout", label: "Scout", description: "Investigate creative trajectories" },
  { href: "/memory", label: "Taste & time", description: "Manage preferences and resurfacing" },
] as const;

export class FormaShell extends FormaElement {
  #commandIndex = 0;
  #shareHours = 24; #freshShareUrl = ""; #termsOwnership = false; #termsProvider = false;
  #keydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.store.patchUi({ commandOpen: !this.store.ui.commandOpen }); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) void this.store.redo(); else void this.store.undo(); }
    if (event.key === "Escape") this.store.patchUi({ commandOpen: false, accountOpen: false, shareOpen: false, compareOpen: false });
  };
  #routeChanged = (event: Event) => {
    const path = (event as CustomEvent<{ path?: string }>).detail?.path ?? `${location.pathname}${location.search}${location.hash}`;
    void loadRouteComponent(path);
  };
  #pop = () => { this.store.setRoute(`${location.pathname}${location.search}${location.hash}`); };

  override connectedCallback() {
    super.connectedCallback(); window.addEventListener("keydown", this.#keydown); window.addEventListener("popstate", this.#pop); window.addEventListener("forma-route-changed", this.#routeChanged);
    void loadRouteComponent(location.pathname);
    if (!this.store.events.get().length) void this.store.load();
  }
  override disconnectedCallback() { window.removeEventListener("keydown", this.#keydown); window.removeEventListener("popstate", this.#pop); window.removeEventListener("forma-route-changed", this.#routeChanged); super.disconnectedCallback(); }

  #route(path: string) { this.store.patchUi({ commandOpen: false, accountOpen: false }); this.store.setRoute(path); const hash=path.includes("#")?path.slice(path.indexOf("#")+1):"";if(hash)window.setTimeout(()=>{const target=document.getElementById(hash);target?.scrollIntoView({behavior:"smooth",block:"center"});target?.focus({preventScroll:true});},0);else window.scrollTo({ top: 0 }); }
  #page() {
    const path = this.store.route.get();
    if (path.startsWith("/projects")) return html`<forma-projects></forma-projects>`;
    if (path.startsWith("/studio/project")) return html`<forma-project-contents></forma-project-contents>`;
    if (path.startsWith("/studio/board")) return html`<forma-context-board></forma-context-board>`;
    if (path.startsWith("/studio/guided")) return html`<forma-guided-brief></forma-guided-brief>`;
    if (path.startsWith("/studio/layers")) return html`<forma-reality-layers></forma-reality-layers>`;
    if (path.startsWith("/studio/adaptive")) return html`<forma-adaptive-path></forma-adaptive-path>`;
    if (path.startsWith("/admin/events")) return html`<forma-admin-events></forma-admin-events>`;
    if (path.startsWith("/library")) return html`<forma-library></forma-library>`;
    if (path.startsWith("/sessions")) return html`<forma-sessions></forma-sessions>`;
    if (path.startsWith("/scout")) return html`<forma-scout></forma-scout>`;
    if (path.startsWith("/memory")) return html`<forma-memory></forma-memory>`;
    if (path.startsWith("/system")) return html`<forma-system></forma-system>`;
    return html`<forma-workspace></forma-workspace>`;
  }
  #share() {
    const p = this.store.projection.get();
    return html`<dialog class="modal" open closedby="any" aria-labelledby="share-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({shareOpen:false});}}>
      <div class="modal-card">
        <button class="icon-button modal-close" aria-label="Close share dialog" @click=${() => this.store.patchUi({ shareOpen: false })}>${icon("close")}</button>
        <span class="eyebrow">Private handoff</span><h2 id="share-title">Export or share this work</h2>
        <p>Create an expiring, revocable, read-only projection or download a lossless archive. New links are private by default.</p>
        <div class="share-link-builder"><label>Link lifetime<select .value=${String(this.#shareHours)} @change=${(e:Event)=>{this.#shareHours=Number((e.target as HTMLSelectElement).value);}}><option value="1">1 hour</option><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></label><button class="button primary" @click=${async()=>{const share=await this.store.createShare(this.#shareHours);if(share?.token){this.#freshShareUrl=`${location.origin}/share/${share.token}`;await navigator.clipboard.writeText(this.#freshShareUrl);this.requestUpdate();}}}>${icon("share")} Create & copy link</button></div>
        ${this.#freshShareUrl ? html`<div class="fresh-share"><b>Copied</b><input readonly .value=${this.#freshShareUrl}><small>The secret token is shown once. The durable event stores only the share ID and expiry.</small></div>` : nothing}
        ${this.store.shares.get().length ? html`<div class="share-list"><h3>Recent links</h3>${this.store.shares.get().slice(0,4).map((share)=>html`<div><span><b>${share.active?"Active":"Closed"}</b><small>Expires ${new Date(share.expiresAt).toLocaleString()}</small></span>${share.active?html`<button @click=${()=>this.store.revokeShare(share.shareId)}>Revoke</button>`:nothing}</div>`)}</div>` : nothing}
        <div class="choice-grid">
          ${[["Recipe", "Blocks, weights, constraints, and compiler snapshot."], ["Output + receipts", "Selected output with source context and rights clearance."], ["Full graph", "Event stream, projections, provenance edges, and media manifest."]].map(([name, desc], i) => html`<button class="choice-card" @click=${() => { downloadJson(`forma-${name.toLowerCase().replaceAll(" ", "-")}.json`, i === 0 ? { blocks: p.blocks, compile: p.latestCompile } : i === 1 ? { output: p.outputs[0], compile: p.latestCompile, clearance: "owned" } : { events: this.store.events.get(), projection: { ...p, presentedBriefItems: [...p.presentedBriefItems] } }); this.store.append({ type: "ObjectExported", payload: { object_id: p.outputs[0]?.id ?? p.documentId, destination_class: "download", format: "application/json" } }); this.store.patchUi({ shareOpen: false }); } }><b>${name}</b><span>${desc}</span><small>${icon("download")} Download JSON</small></button>`) }
        </div>
        <div class="gate-note"><span>${icon("lock")}</span><div><b>Read-only by construction</b><p>Links carry no append authority, expire after at most seven days, and can be revoked immediately. Sites access controls still apply.</p></div></div>
      </div>
    </dialog>`;
  }
  #terms() {
    return html`<dialog class="modal consent-modal" open closedby="none" aria-labelledby="consent-title"><div class="modal-card"><span class="eyebrow">Pilot governance · ${this.store.session.get()?.policy.version}</span><h2 id="consent-title">Set the rules before creating</h2><p>Forma keeps prompts and provider outputs private for ${this.store.session.get()?.policy.retentionDays ?? 30} days. Optional attention signals remain off until you enable them separately in privacy settings.</p><label class="consent-check"><input type="checkbox" .checked=${this.#termsOwnership} @change=${(e:Event)=>{this.#termsOwnership=(e.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>I control the work I submit</b><small>I own it or have permission to use it; external assets require a separate assertion at upload.</small></span></label><label class="consent-check"><input type="checkbox" .checked=${this.#termsProvider} @change=${(e:Event)=>{this.#termsProvider=(e.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>I approve private provider processing</b><small>Generation context may be sent to the configured OpenAI Responses API with server-side credentials.</small></span></label><button class="button primary consent-action" ?disabled=${!this.#termsOwnership||!this.#termsProvider||!!this.store.busy.get()} @click=${()=>this.store.acceptTerms()}>${this.store.busy.get()==="consent"?"Recording…":"Accept pilot terms"}</button></div></dialog>`;
  }
  #commands() {
    const q = this.store.ui.search.toLowerCase();
    const commands = [
      { label: "Generate from current context", hint: "Studio", run: () => this.store.generate() },
      { label: "Add a direction block", hint: "Document", run: () => this.store.append({ type: "BlockCreated", payload: { block_id: crypto.randomUUID(), type: "direction", handle: `direction/study-${this.store.head.get()}`, position: `z${this.store.head.get()}`, properties: { text: "A new creative direction", weight: .65, authority: "authored" } } }) },
      { label: "Review the durable stream", hint: "Admin", run: () => this.#route("/admin/events") },
      { label: "Open reusable library", hint: "Library", run: () => this.#route("/library") },
      { label: "Run a bounded scout report", hint: "Scout", run: () => this.#route("/scout") },
      { label: "Review taste and time memory", hint: "Memory", run: () => this.#route("/memory") },
      { label: "Inspect plan coverage", hint: "System", run: () => this.#route("/system") },
      { label: "Undo last authored change", hint: "⌘Z", run: () => this.store.undo() },
      { label: "Export full graph", hint: "JSON", run: () => this.store.patchUi({ shareOpen: true }) },
    ].filter((c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q));
    const run = async (index: number) => { const command = commands[index]; if (!command) return; this.store.patchUi({ commandOpen: false, search: "" }); this.#commandIndex = 0; await command.run(); };
    return html`<dialog class="command-dialog" open closedby="any" aria-labelledby="command-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({commandOpen:false});}}>
      <div class="command-card">
        <label id="command-title" class="sr-only" for="command-search">Search commands</label>
        <div class="command-search"><span>${icon("search")}</span><input id="command-search" autofocus placeholder="Type a command…" .value=${this.store.ui.search} @input=${(e: InputEvent) => { this.#commandIndex = 0; this.store.patchUi({ search: (e.target as HTMLInputElement).value }); }} @keydown=${(e: KeyboardEvent) => { if (e.key === "ArrowDown") { e.preventDefault(); this.#commandIndex = Math.min(commands.length - 1, this.#commandIndex + 1); this.requestUpdate(); } else if (e.key === "ArrowUp") { e.preventDefault(); this.#commandIndex = Math.max(0, this.#commandIndex - 1); this.requestUpdate(); } else if (e.key === "Enter") { e.preventDefault(); void run(this.#commandIndex); } }}><kbd>esc</kbd></div>
        <div class="command-results" role="listbox">${commands.map((c, i) => html`<button class="command-row" role="option" aria-selected=${i === this.#commandIndex} @mouseenter=${() => { this.#commandIndex = i; this.requestUpdate(); }} @click=${() => run(i)}><span>${c.label}</span><small>${c.hint}</small></button>`)}</div>
        <footer><span>↑↓ navigate</span><span>↵ run</span><span>Every operation appends or navigates</span></footer>
      </div>
    </dialog>`;
  }

  override render() {
    const path = this.store.route.get(); const isAdmin = path.startsWith("/admin");
    if(path.startsWith("/share/"))return html`<forma-shared-view .token=${decodeURIComponent(path.slice("/share/".length))}></forma-shared-view>`;
    const session=this.store.session.get();
    const routeActive=(href:string)=>href==="/projects"?(path.startsWith("/projects")||path.startsWith("/studio/project")):href==="/"?(path==="/"||(path.startsWith("/studio/")&&!path.startsWith("/studio/project"))):(path===href||path.startsWith(`${href}/`));
    return html`<div class="app-shell ${isAdmin ? "admin-shell" : ""}">
      <header class="topbar">
        <button class="brand" @click=${() => this.#route("/projects")} aria-label="Open all Forma projects"><span class="brand-mark">F</span><span>Forma</span></button>
        <nav class="global-nav" aria-label="Creative workspace">${routes.map(({href,label,description}) => html`<a href=${href} title=${description} class=${routeActive(href)?"active":""} aria-current=${routeActive(href)?"page":nothing} @click=${(e: MouseEvent) => { e.preventDefault(); this.#route(href); }}>${label}</a>`)}</nav>
        <div class="top-actions">
          <button class="command-trigger" @click=${() => this.store.patchUi({ commandOpen: true })}><span>${icon("search")}</span><span class="command-label">Search or command</span><kbd>⌘ K</kbd></button>
          ${!isAdmin ? html`<button class="button secondary compact" @click=${() => {void this.store.loadShares();this.store.patchUi({ shareOpen: true });}}>${icon("share")} Share</button>` : nothing}
          <button class="avatar" aria-label="Open account and privacy settings" aria-expanded=${this.store.ui.accountOpen} @click=${() => this.store.patchUi({ accountOpen: !this.store.ui.accountOpen })}>${session?.user.displayName?.slice(0,1).toUpperCase()??"·"}</button>
        </div>
        ${this.store.ui.accountOpen ? html`<div class="account-popover"><span class="eyebrow">${session?.user.role??"authenticated"}</span><b>${session?.user.displayName??"Signed-in creative"}</b><p>${session?.user.email??"Identity loading"} · ${this.store.head.get()} events</p><nav class="account-nav" aria-label="Administration"><a href="/system" @click=${(event:MouseEvent)=>{event.preventDefault();this.#route("/system");}}><span>System & governance</span>${icon("arrow")}</a>${session?.user.role==="admin"?html`<a href="/admin/events" @click=${(event:MouseEvent)=>{event.preventDefault();this.#route("/admin/events");}}><span>Event operations</span>${icon("arrow")}</a>`:nothing}</nav><div class="account-policy"><span>Terms</span><b>${session?.policy.accepted?"accepted":"required"}</b><span>Provider</span><b>${session?.provider.configured?session.provider.model:"key required"}</b><span>Content retention</span><b>${session?.policy.retentionDays??30} days</b><span>Attention signals</span><b>${this.store.ui.attentionCapture?(this.store.ui.attentionPaused?"paused":"on"):"off"}</b></div><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.instrumentation} @change=${(e: Event) => this.store.patchUi({ instrumentation: (e.target as HTMLInputElement).checked })}><span>Record explicit view actions</span></label><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.attentionCapture} @change=${(e:Event)=>this.store.setAttentionCapture((e.target as HTMLInputElement).checked)}><span>Use attention signals to improve Forma</span></label>${this.store.ui.attentionCapture?html`<button class="button ghost compact attention-pause" @click=${()=>this.store.setAttentionPaused(!this.store.ui.attentionPaused)}>${this.store.ui.attentionPaused?icon("play"):icon("pause")} ${this.store.ui.attentionPaused?"Resume on this device":"Pause on this device"}</button>`:nothing}<small>Opt-in capture runs only while this page is visible. It stores coarse surface, active/idle time, visible item IDs, and the action that ended a period—never pointer paths, keys, typed text, microphone, or ambient device data. Device episodes expire after 14 days.</small><button class="button ghost" @click=${() => this.#route("/system#governance")}>Review privacy controls</button></div>` : nothing}
      </header>
      ${this.store.error.get() ? html`<div class="error-banner" role="alert"><b>Durable stream unavailable.</b> ${this.store.error.get()} <button @click=${() => this.store.load()}>Retry</button></div>` : nothing}
      <main id="main-content">${this.#page()}</main>
      ${this.store.ui.toast ? html`<div class="toast" role="status">${icon("check")} ${this.store.ui.toast}</div>` : nothing}
      ${this.store.ui.commandOpen ? this.#commands() : nothing}
      ${this.store.ui.shareOpen ? this.#share() : nothing}
      ${session&&!session.policy.accepted?this.#terms():nothing}
      <forma-attention-observer></forma-attention-observer>
      <span class="sr-only" aria-live="polite">${this.store.busy.get() ? `Working: ${this.store.busy.get()}` : "Ready"}</span>
    </div>`;
  }
}
customElements.define("forma-shell", FormaShell);
