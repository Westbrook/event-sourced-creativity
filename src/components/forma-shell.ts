import { html, nothing } from "lit";
import { FormaElement, icon, downloadJson } from "./forma-element";
import "./forma-workspace";
import "./forma-library";
import "./forma-sessions";
import "./forma-system";
import "./forma-admin-events";

const routes = [
  ["/", "Studio"], ["/library", "Library"], ["/sessions", "Sessions"], ["/system", "System"], ["/admin/events", "Event admin"],
];

export class FormaShell extends FormaElement {
  #commandIndex = 0;
  #keydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.store.patchUi({ commandOpen: !this.store.ui.commandOpen }); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) void this.store.redo(); else void this.store.undo(); }
    if (event.key === "Escape") this.store.patchUi({ commandOpen: false, accountOpen: false, shareOpen: false, compareOpen: false });
  };
  #pop = () => { this.store.route.set(location.pathname); this.store.notify(); };

  override connectedCallback() {
    super.connectedCallback(); window.addEventListener("keydown", this.#keydown); window.addEventListener("popstate", this.#pop);
    if (!this.store.events.get().length) void this.store.load();
  }
  override disconnectedCallback() { window.removeEventListener("keydown", this.#keydown); window.removeEventListener("popstate", this.#pop); super.disconnectedCallback(); }

  #route(path: string) { this.store.patchUi({ commandOpen: false, accountOpen: false }); this.store.setRoute(path); window.scrollTo({ top: 0 }); }
  #page() {
    const path = this.store.route.get();
    if (path.startsWith("/admin/events")) return html`<forma-admin-events></forma-admin-events>`;
    if (path.startsWith("/library")) return html`<forma-library></forma-library>`;
    if (path.startsWith("/sessions")) return html`<forma-sessions></forma-sessions>`;
    if (path.startsWith("/system")) return html`<forma-system></forma-system>`;
    return html`<forma-workspace></forma-workspace>`;
  }
  #share() {
    const p = this.store.projection.get();
    return html`<dialog class="modal" open aria-labelledby="share-title">
      <div class="modal-card">
        <button class="icon-button modal-close" aria-label="Close share dialog" @click=${() => this.store.patchUi({ shareOpen: false })}>${icon("close")}</button>
        <span class="eyebrow">Lossless handoff</span><h2 id="share-title">Export or share this work</h2>
        <p>Downloads are operational now. Shared links remain disabled until a human selects personal, team, or community scope.</p>
        <div class="choice-grid">
          ${[["Recipe", "Blocks, weights, constraints, and compiler snapshot."], ["Output + receipts", "Selected output with source context and rights clearance."], ["Full graph", "Event stream, projections, provenance edges, and media manifest."]].map(([name, desc], i) => html`<button class="choice-card" @click=${() => { downloadJson(`forma-${name.toLowerCase().replaceAll(" ", "-")}.json`, i === 0 ? { blocks: p.blocks, compile: p.latestCompile } : i === 1 ? { output: p.outputs[0], compile: p.latestCompile, clearance: "owned" } : { events: this.store.events.get(), projection: { ...p, presentedBriefItems: [...p.presentedBriefItems] } }); this.store.append({ type: "ObjectExported", payload: { object_id: p.outputs[0]?.id ?? p.documentId, destination_class: "download", format: "application/json" } }); this.store.patchUi({ shareOpen: false }); } }><b>${name}</b><span>${desc}</span><small>${icon("download")} Download JSON</small></button>`) }
        </div>
        <div class="gate-note"><span>${icon("lock")}</span><div><b>Shared links need a product decision</b><p>Scope changes identity, moderation, and infrastructure. The event schema seam is ready; publishing is intentionally not assumed.</p></div></div>
      </div>
    </dialog>`;
  }
  #commands() {
    const q = this.store.ui.search.toLowerCase();
    const commands = [
      { label: "Generate from current context", hint: "Studio", run: () => this.store.generate() },
      { label: "Add a direction block", hint: "Document", run: () => this.store.append({ type: "BlockCreated", payload: { block_id: crypto.randomUUID(), type: "direction", handle: `direction/study-${this.store.head.get()}`, position: `z${this.store.head.get()}`, properties: { text: "A new creative direction", weight: .65, authority: "authored" } } }) },
      { label: "Review the durable stream", hint: "Admin", run: () => this.#route("/admin/events") },
      { label: "Open reusable library", hint: "Library", run: () => this.#route("/library") },
      { label: "Inspect plan coverage", hint: "System", run: () => this.#route("/system") },
      { label: "Undo last authored change", hint: "⌘Z", run: () => this.store.undo() },
      { label: "Export full graph", hint: "JSON", run: () => this.store.patchUi({ shareOpen: true }) },
    ].filter((c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q));
    const run = async (index: number) => { const command = commands[index]; if (!command) return; this.store.patchUi({ commandOpen: false, search: "" }); this.#commandIndex = 0; await command.run(); };
    return html`<dialog class="command-dialog" open aria-labelledby="command-title">
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
    return html`<div class="app-shell ${isAdmin ? "admin-shell" : ""}">
      <header class="topbar">
        <button class="brand" @click=${() => this.#route("/")} aria-label="Open Forma studio"><span class="brand-mark">F</span><span>Forma</span></button>
        <nav class="global-nav" aria-label="Primary">${routes.map(([href, label]) => html`<a href=${href} class=${path === href || (href !== "/" && path.startsWith(href)) ? "active" : ""} @click=${(e: MouseEvent) => { e.preventDefault(); this.#route(href); }}>${label}</a>`)}</nav>
        <div class="top-actions">
          <button class="command-trigger" @click=${() => this.store.patchUi({ commandOpen: true })}><span>${icon("search")}</span><span class="command-label">Search or command</span><kbd>⌘ K</kbd></button>
          ${!isAdmin ? html`<button class="button secondary compact" @click=${() => this.store.patchUi({ shareOpen: true })}>${icon("share")} Share</button>` : nothing}
          <button class="avatar" aria-label="Open account and privacy settings" aria-expanded=${this.store.ui.accountOpen} @click=${() => this.store.patchUi({ accountOpen: !this.store.ui.accountOpen })}>W</button>
        </div>
        ${this.store.ui.accountOpen ? html`<div class="account-popover"><span class="eyebrow">Local creative</span><b>Westbrook</b><p>Authenticated stream · ${this.store.head.get()} events</p><label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.instrumentation} @change=${(e: Event) => this.store.patchUi({ instrumentation: (e.target as HTMLInputElement).checked })}><span>Action instrumentation</span></label><small>Device-session preference. Dwell-time tracking is not collected; witnessed product data stays in the durable event log.</small><button class="button ghost" @click=${() => this.#route("/system")}>Review governance</button></div>` : nothing}
      </header>
      ${this.store.error.get() ? html`<div class="error-banner" role="alert"><b>Durable stream unavailable.</b> ${this.store.error.get()} <button @click=${() => this.store.load()}>Retry</button></div>` : nothing}
      <main id="main-content">${this.#page()}</main>
      ${this.store.ui.toast ? html`<div class="toast" role="status">${icon("check")} ${this.store.ui.toast}</div>` : nothing}
      ${this.store.ui.commandOpen ? this.#commands() : nothing}
      ${this.store.ui.shareOpen ? this.#share() : nothing}
      <span class="sr-only" aria-live="polite">${this.store.busy.get() ? `Working: ${this.store.busy.get()}` : "Ready"}</span>
    </div>`;
  }
}
customElements.define("forma-shell", FormaShell);
