import { html } from "lit";
import { FormaElement, icon } from "./forma-element";
import "./collection-tree";

type RailSurface = "studio" | "library";
type LibraryView = "all" | "blocks" | "outputs" | "families";

export class ProjectRail extends FormaElement {
  #openLibrary(view: LibraryView) {
    this.store.patchUi({ libraryView: view, focusCollectionId: "" });
    this.store.setRoute("/library");
  }

  #editProject() {
    this.dispatchEvent(new CustomEvent("edit-project", { bubbles: true, composed: true }));
  }
  #openProjectContents(){this.store.patchUi({focusCollectionId:""});this.store.setRoute("/studio/project");}

  override render() {
    const projection = this.store.projection.get();
    const surface = (this.getAttribute("surface") === "library" ? "library" : "studio") as RailSurface;
    const currentView = String(this.store.ui.libraryView);
    const links: Array<{ view: LibraryView; label: string; count?: number }> = [
      { view: "all", label: "Library overview" },
      { view: "blocks", label: "Reusable blocks", count: projection.libraryBlocks.length },
      { view: "outputs", label: "Recent outputs", count: projection.libraryOutputs.length },
      { view: "families", label: "Aesthetic families", count: projection.families.filter((family) => !family.superseded).length },
    ];

    const collapsed=Boolean(this.store.ui.projectRailCollapsed);
    return html`<aside class=${`project-rail ${collapsed?"collapsed":""}`} aria-label=${surface === "studio" ? "Studio project navigation" : "Library project navigation"}>
      <button class="rail-collapse-toggle" aria-label=${collapsed?"Expand project navigation":"Collapse project navigation"} title=${collapsed?"Expand project navigation":"Give the document more room"} aria-expanded=${!collapsed} @click=${()=>this.store.patchUi({projectRailCollapsed:!collapsed})}>${collapsed?"›":"‹"}</button>
      <header class="rail-project">
        <span class="eyebrow">Current project</span>
        <div class="project-title"><b>${projection.projectName}</b><span class=${`project-status ${projection.projectState}`}>${projection.projectState}</span></div>
        <div class="rail-project-actions">
          ${surface === "studio"
            ? this.store.route.get()==="/"?html`<button @click=${this.#editProject}>${icon("edit")} Edit project</button>`:html`<button @click=${()=>this.store.setRoute("/")}>Open document ${icon("arrow")}</button>`
            : html`<button @click=${() => this.store.setRoute("/")}>Open document ${icon("arrow")}</button>`}
          <button @click=${this.#openProjectContents}>${projection.documents.length} document${projection.documents.length === 1 ? "" : "s"} ${icon("arrow")}</button>
        </div>
      </header>

      <forma-collection-tree destination=${this.getAttribute("destination")||(surface==="library"?"/studio/project":"/")}></forma-collection-tree>

      <nav class="rail-links" aria-label="Project library">
        <span class="rail-label">Browse</span>
        <button class=${this.store.route.get().startsWith("/studio/project")?"active":""} aria-current=${this.store.route.get().startsWith("/studio/project")?"page":"false"} @click=${this.#openProjectContents}><span>Project overview</span><small>${projection.documents.length}</small></button>
        ${links.map((link) => html`<button
          class=${surface === "library" && currentView === link.view ? "active" : ""}
          aria-current=${surface === "library" && currentView === link.view ? "page" : "false"}
          @click=${() => this.#openLibrary(link.view)}
        ><span>${link.label}</span>${link.count === undefined ? html`<small>${icon("arrow")}</small>` : html`<small>${link.count}</small>`}</button>`)}
      </nav>

      <div class="rail-note"><span>${icon("info")}</span><p><b>No auto-filing.</b> Collections express authored intent. Search and families remain derived views.</p></div>

      <footer class="rail-stream"><span class="rail-live-dot"></span><div><b>Durable stream</b><small>#${this.store.head.get()} · ${this.store.loading.get() ? "syncing" : "caught up"}</small></div><button @click=${() => this.store.setRoute("/admin/events")}>Review</button></footer>
    </aside>`;
  }
}

customElements.define("forma-project-rail", ProjectRail);
