import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { documentViewFromRoute, isDocumentViewRoute, libraryBlockEditorFromRoute, libraryBlockEditorRoute, routePathname, withDocumentInRoute } from "../model/routes";
import { generationHistoryItems } from "../model/events";
import type { FormaIconName } from "./icons";
import "./icons-history";
import "./icons-navigation";
import "./collection-tree";

type RailSurface = "studio" | "library";
type LibraryView = "all" | "blocks" | "outputs" | "families";

export class ProjectRail extends FormaElement {
  #go(event: MouseEvent, path: string) {
    event.preventDefault();
    this.store.setRoute(path);
    window.scrollTo({ top: 0 });
  }

  #openLibrary(event: MouseEvent, view: LibraryView) {
    event.preventDefault();
    this.store.patchUi({ libraryView: view, focusCollectionId: "" });
    this.store.setRoute("/library");
    window.scrollTo({ top: 0 });
  }

  #openBlockEditor(event:MouseEvent) {
    event.preventDefault();this.store.patchUi({libraryView:"blocks",focusCollectionId:""});this.store.setRoute(libraryBlockEditorRoute());window.scrollTo({top:0});
  }

  #editProject() {
    this.dispatchEvent(new CustomEvent("edit-project", { bubbles: true, composed: true }));
  }

  override render() {
    const projection = this.store.projection.get();
    const route = this.store.route.get();
    const surface = (this.getAttribute("surface") === "library" ? "library" : "studio") as RailSurface;
    const currentView = String(this.store.ui.libraryView);
    const collapsed = Boolean(this.store.ui.projectRailCollapsed);
    const quiet = this.hasAttribute("quiet");
    const pathname = routePathname(route);
    const documentRoute = withDocumentInRoute("/", projection.documentId, projection.documentTitle);
    const projectActive = pathname.startsWith("/studio/project");
    const documentActive = isDocumentViewRoute(route);
    const blockEditorActive = Boolean(libraryBlockEditorFromRoute(route));
   const libraryLinks: Array<{ view: LibraryView; label: string; count?: number; iconName: FormaIconName }> = [
     { view: "all", label: "Library overview", iconName: "home" },
      { view: "blocks", label: quiet ? "Reusable ideas" : "Reusable blocks", count: projection.libraryBlocks.length, iconName: "grid" },
      { view: "outputs", label: quiet ? "Recent results" : "Recent outputs", count: generationHistoryItems(projection.libraryOutputs).length + projection.libraryArtifacts.length, iconName: "image" },
      { view: "families", label: quiet ? "Visual families" : "Aesthetic families", count: projection.families.filter((family) => !family.superseded).length, iconName: "families" },
   ];

    return html`<aside class=${`project-rail ${collapsed ? "collapsed" : "expanded"} ${quiet ? "quiet" : ""}`} aria-label=${quiet ? "Creative editor navigation" : surface === "studio" ? "Studio project navigation" : "Library project navigation"}>
      <header class="rail-toolbar">
        <span class="rail-toolbar-context"><i class="rail-live-dot"></i><span>${surface === "library" ? "Project library" : "Project workspace"}</span></span>
        <button class="rail-collapse-toggle" aria-controls="project-rail-content" aria-label=${collapsed ? "Expand project navigation" : "Collapse project navigation"} title=${collapsed ? "Expand project navigation" : "Give the workspace more room"} aria-expanded=${!collapsed} @click=${()=>this.store.patchUi({projectRailCollapsed:!collapsed})}>
          <span aria-hidden="true">${icon(collapsed ? "next" : "previous")}</span><b>${collapsed ? "Expand" : "Collapse"}</b>
        </button>
      </header>

      ${collapsed ? html`<nav class="rail-dock" aria-label="Project shortcuts">
        <a href="/projects" title="All projects" @click=${(event:MouseEvent)=>this.#go(event,"/projects")}><span>${projection.projectName.slice(0,1).toUpperCase() || "P"}</span><small>Projects</small></a>
        <a href="/studio/project" class=${projectActive?"active":""} aria-current=${projectActive?"page":nothing} title="Project overview" @click=${(event:MouseEvent)=>this.#go(event,"/studio/project")}>${icon("folder")}<small>Overview</small></a>
        <a href=${documentRoute} class=${documentActive?"active":""} aria-current=${documentActive?"page":nothing} title=${`Open ${projection.documentTitle}`} @click=${(event:MouseEvent)=>this.#go(event,documentRoute)}>${icon("document")}<small>Document</small></a>
        <a href="/library" class=${surface==="library"?"active":""} aria-current=${surface==="library"?"page":nothing} title="Project library" @click=${(event:MouseEvent)=>this.#openLibrary(event,"all")}>${icon("grid")}<small>Library</small></a>
        ${!quiet&&this.store.session.get()?.user.role==="admin"?html`<a href="/operations/events" title="Durable stream" @click=${(event:MouseEvent)=>this.#go(event,"/operations/events")}>${icon("replay")}<small>Events</small></a>`:nothing}
      </nav>` : html`<div id="project-rail-content" class="rail-content">
        <section class="rail-project-card" aria-labelledby="rail-project-name">
          <div class="rail-project-heading"><span class="project-monogram">${projection.projectName.slice(0,1).toUpperCase() || "P"}</span><div><span class="eyebrow">Current project</span><h2 id="rail-project-name">${projection.projectName}</h2></div>${quiet?nothing:html`<span class=${`project-status ${projection.projectState}`}>${projection.projectState}</span>`}</div>
          ${quiet?nothing:html`<div class="rail-project-meta"><span><b>${projection.documents.length}</b> document${projection.documents.length===1?"":"s"}</span><span><b>${projection.collections.length}</b> collection${projection.collections.length===1?"":"s"}</span></div>`}
          <div class="rail-project-actions"><a href="/projects" @click=${(event:MouseEvent)=>this.#go(event,"/projects")}>All projects</a>${surface==="studio"&&documentViewFromRoute(route)==="document"?html`<button @click=${this.#editProject}>${icon("edit")} Edit project</button>`:nothing}</div>
        </section>

        <nav class="rail-links rail-destinations" aria-label="Project destinations">
          <span class="rail-label">Project</span>
          <a href="/studio/project" class=${projectActive?"active":""} aria-current=${projectActive?"page":nothing} @click=${(event:MouseEvent)=>this.#go(event,"/studio/project")}><span><i>${icon("folder")}</i> Project overview</span><small>${projection.documents.length}</small></a>
          <a href=${documentRoute} class=${documentActive?"active":""} aria-current=${documentActive?"page":nothing} @click=${(event:MouseEvent)=>this.#go(event,documentRoute)}><span><i>${icon("document")}</i> Current document</span><small>${icon("arrow")}</small></a>
        </nav>

        <section class="rail-collections" aria-label="Authored collections">
          <forma-collection-tree destination=${surface==="library"?"/library":"/studio/project"}></forma-collection-tree>
        </section>

        <nav class="rail-links rail-library-links" aria-label="Project library">
          <span class="rail-label">Library</span>
          ${libraryLinks.map((link) => {const active=surface === "library" && !blockEditorActive && currentView === link.view;return html`<a href="/library" class=${active ? "active" : ""} aria-current=${active ? "page" : nothing} @click=${(event:MouseEvent)=>this.#openLibrary(event,link.view)}><span><i>${icon(link.iconName)}</i> ${link.label}</span>${link.count === undefined ? html`<small>${icon("arrow")}</small>` : html`<small>${link.count}</small>`}</a>`;})}
          <a href=${libraryBlockEditorRoute()} class=${surface==="library"&&blockEditorActive?"active":""} aria-current=${surface==="library"&&blockEditorActive?"page":nothing} @click=${this.#openBlockEditor}><span><i>${icon("edit")}</i> Block editor</span><small>${projection.libraryBlocks.filter((block)=>block.scope==="library").length}</small></a>
        </nav>

        ${quiet?nothing:html`<div class="rail-note"><span>${icon("info")}</span><p><b>No auto-filing.</b> Collections are deliberate. Search and aesthetic families remain derived views.</p></div>`}

        ${quiet?nothing:html`<footer class="rail-stream"><span class="rail-live-dot"></span><div><b>${this.store.loading.get()?"Synchronizing changes":"Your work is saved"}</b><small>${this.store.loading.get()?"Checking the latest project state":"Changes remain recoverable"}</small></div>${this.store.session.get()?.user.role==="admin"?html`<a href="/operations/events" @click=${(event:MouseEvent)=>this.#go(event,"/operations/events")}>Review</a>`:nothing}</footer>`}
      </div>`}
    </aside>`;
  }
}

customElements.define("forma-project-rail", ProjectRail);
