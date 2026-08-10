import { html } from "lit";
import { FormaElement, icon } from "./forma-element";
import "./collection-tree";

type RailSurface = "studio" | "library";
type LibraryView = "all" | "documents" | "blocks" | "outputs" | "families";

export class ProjectRail extends FormaElement {
  #openLibrary(view: LibraryView) {
    this.store.patchUi({ libraryView: view, focusCollectionId: "" });
    this.store.setRoute("/library");
  }

  #editProject() {
    this.dispatchEvent(new CustomEvent("edit-project", { bubbles: true, composed: true }));
  }

  override render() {
    const projection = this.store.projection.get();
    const surface = (this.getAttribute("surface") === "library" ? "library" : "studio") as RailSurface;
    const currentView = String(this.store.ui.libraryView);
    const links: Array<{ view: LibraryView; label: string; count?: number }> = [
      { view: "all", label: "Library overview" },
      { view: "documents", label: "All documents", count: projection.documents.length },
      { view: "blocks", label: "Reusable blocks", count: projection.libraryBlocks.length },
      { view: "outputs", label: "Recent outputs", count: projection.libraryOutputs.length },
      { view: "families", label: "Aesthetic families", count: projection.families.filter((family) => !family.superseded).length },
    ];

    return html`<aside class="project-rail" aria-label=${surface === "studio" ? "Studio project navigation" : "Library project navigation"}>
      <header class="rail-project">
        <span class="eyebrow">Current project</span>
        <div class="project-title"><b>${projection.projectName}</b><span class=${`project-status ${projection.projectState}`}>${projection.projectState}</span></div>
        <div class="rail-project-actions">
          ${surface === "studio"
            ? html`<button @click=${this.#editProject}>${icon("edit")} Edit project</button>`
            : html`<button @click=${() => this.store.setRoute("/")}>Open Studio ${icon("arrow")}</button>`}
          <button @click=${() => this.#openLibrary("documents")}>${projection.documents.length} document${projection.documents.length === 1 ? "" : "s"} ${icon("arrow")}</button>
        </div>
      </header>

      <forma-collection-tree></forma-collection-tree>

      <nav class="rail-links" aria-label="Project library">
        <span class="rail-label">Browse</span>
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
