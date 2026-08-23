import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { documentViewFromRoute, isDocumentViewRoute, libraryBaseRoute, libraryBlockEditorFromRoute, libraryBlockEditorRoute, routePathname, withDocumentInRoute } from "../model/routes";
import { generationHistoryItems } from "../model/events";
import type { FormaIconName } from "./icons";
import "./icons-history";
import "./icons-navigation";
import "./collection-tree";

type RailSurface = "studio" | "library";
type LibraryView = "all" | "blocks" | "outputs" | "families";

export class ProjectRail extends FormaElement {
  #go(event: MouseEvent, path: string) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    this.store.setRoute(path);
    window.scrollTo({ top: 0 });
  }

  #openLibrary(event: MouseEvent, view: LibraryView) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    this.store.patchUi({ libraryView: view, focusCollectionId: "" });
    this.store.setRoute(libraryBaseRoute(this.store.route.get()));
    window.scrollTo({ top: 0 });
  }

  #openBlockEditor(event:MouseEvent) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();this.store.patchUi({libraryView:"blocks",focusCollectionId:""});this.store.setRoute(libraryBlockEditorRoute("",this.store.route.get()));window.scrollTo({top:0});
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
    const canvasWorkspace=pathname==="/canvas/library"||pathname.startsWith("/canvas/library/");
    const projectsRoute=canvasWorkspace?"/canvas/projects":"/projects";
    const overviewRoute=canvasWorkspace?"/canvas":"/studio/project";
    const libraryRoute=libraryBaseRoute(route);
    const context=this.store.session.get()?.projectContext;
    const canAuthor=!context||context.permissions.includes("project.author");
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

    return html`<aside class=${`project-rail ${collapsed ? "collapsed" : "expanded"} ${quiet ? "quiet" : ""}`} aria-label=${quiet?this.i18n.t("projects.railNavigation","Library project navigation"):surface==="studio"?this.i18n.t("projects.railDestinations","Project destinations"):this.i18n.t("projects.railNavigation","Library project navigation")}>
      <header class="rail-toolbar">
        <span class="rail-toolbar-context"><i class="rail-live-dot"></i><span>${surface==="library"?this.i18n.t("projects.libraryHeading","Project library"):this.i18n.t("projects.workspaceKind","Creative workspace")}</span></span>
        <button class="rail-collapse-toggle" aria-controls="project-rail-content" aria-label=${this.i18n.t(collapsed?"projects.railExpand":"projects.railCollapse",collapsed?"Expand project navigation":"Collapse project navigation")} title=${this.i18n.t(collapsed?"projects.railExpand":"projects.railCollapse",collapsed?"Expand project navigation":"Collapse project navigation")} aria-expanded=${!collapsed} @click=${()=>this.store.patchUi({projectRailCollapsed:!collapsed})}>
          <span aria-hidden="true">${icon((collapsed?this.i18n.direction!=="rtl":this.i18n.direction==="rtl")?"next":"previous")}</span><b>${this.i18n.t(collapsed?"projects.railExpand":"projects.railCollapse",collapsed?"Expand project navigation":"Collapse project navigation")}</b>
        </button>
      </header>

      ${collapsed ? html`<nav class="rail-dock" aria-label=${this.i18n.t("projects.railShortcuts","Project shortcuts")}>
        <a href=${projectsRoute} title=${this.i18n.t("projects.all","All projects")} @click=${(event:MouseEvent)=>this.#go(event,projectsRoute)}><span>${projection.projectName.slice(0,1).toUpperCase() || "P"}</span><small>${this.i18n.t("shell.navigation.projects","Projects")}</small></a>
        <a href=${overviewRoute} class=${projectActive?"active":""} aria-current=${projectActive?"page":nothing} title=${canvasWorkspace?this.i18n.t("projects.backToBoards","Back to project boards"):"Project overview"} @click=${(event:MouseEvent)=>this.#go(event,overviewRoute)}>${icon("folder")}<small>${canvasWorkspace?this.i18n.t("shell.navigation.canvases","Canvases"):"Overview"}</small></a>
        <a href=${documentRoute} class=${documentActive?"active":""} aria-current=${documentActive?"page":nothing} title=${canvasWorkspace?this.i18n.t("projects.openCreatorDocument","Open document in Creator Workspace"):`Open ${projection.documentTitle}`} @click=${(event:MouseEvent)=>this.#go(event,documentRoute)}>${icon("document")}<small>${canvasWorkspace?this.i18n.t("projects.creatorWorkspace","Creator Workspace"):"Document"}</small></a>
        <a href=${libraryRoute} class=${surface==="library"?"active":""} aria-current=${surface==="library"?"page":nothing} title=${this.i18n.t("projects.libraryHeading","Project library")} @click=${(event:MouseEvent)=>this.#openLibrary(event,"all")}>${icon("grid")}<small>${this.i18n.t("projects.railSectionLibrary","Library")}</small></a>
      </nav>` : html`<div id="project-rail-content" class="rail-content">
        <section class="rail-project-card" aria-labelledby="rail-project-name">
          <div class="rail-project-heading"><span class="project-monogram">${projection.projectName.slice(0,1).toUpperCase() || "P"}</span><div><span class="eyebrow">${this.i18n.t("projects.railCurrent","Current project")}</span><h2 id="rail-project-name" dir="auto">${projection.projectName}</h2></div>${quiet?nothing:html`<span class=${`project-status ${projection.projectState}`}>${this.i18n.t(`projects.state.${projection.projectState}`,projection.projectState)}</span>`}</div>
          ${quiet?nothing:html`<div class="rail-project-meta"><span><b>${projection.documents.length}</b> document${projection.documents.length===1?"":"s"}</span><span><b>${projection.collections.length}</b> collection${projection.collections.length===1?"":"s"}</span></div>`}
          <div class="rail-project-actions"><a href=${projectsRoute} @click=${(event:MouseEvent)=>this.#go(event,projectsRoute)}>${this.i18n.t("projects.all","All projects")}</a>${!context&&surface==="studio"&&documentViewFromRoute(route)==="document"?html`<button @click=${this.#editProject}>${icon("edit")} Edit project</button>`:nothing}</div>
        </section>

        <nav class="rail-links rail-destinations" aria-label=${this.i18n.t("projects.railDestinations","Project destinations")}>
          <span class="rail-label">${this.i18n.t("projects.railSectionProject","Project")}</span>
          <a href=${overviewRoute} class=${projectActive?"active":""} aria-current=${projectActive?"page":nothing} @click=${(event:MouseEvent)=>this.#go(event,overviewRoute)}><span><i>${icon("folder")}</i> ${canvasWorkspace?this.i18n.t("projects.backToBoards","Back to project boards"):"Project overview"}</span><small>${projection.documents.length}</small></a>
          <a href=${documentRoute} class=${documentActive?"active":""} aria-current=${documentActive?"page":nothing} @click=${(event:MouseEvent)=>this.#go(event,documentRoute)}><span><i>${icon("document")}</i> ${canvasWorkspace?this.i18n.t("projects.openCreatorDocument","Open document in Creator Workspace"):"Current document"}</span><small>${icon("arrow")}</small></a>
        </nav>

        <section class="rail-collections" aria-label=${this.i18n.t("projects.railCollections","Authored collections")}>
          <forma-collection-tree destination=${surface==="library"?libraryRoute:overviewRoute}></forma-collection-tree>
        </section>

        <nav class="rail-links rail-library-links" aria-label=${this.i18n.t("projects.railLibrary","Project library")}>
          <span class="rail-label">${this.i18n.t("projects.railSectionLibrary","Library")}</span>
          ${libraryLinks.map((link) => {const active=surface === "library" && !blockEditorActive && currentView === link.view;return html`<a href=${libraryRoute} class=${active ? "active" : ""} aria-current=${active ? "page" : nothing} @click=${(event:MouseEvent)=>this.#openLibrary(event,link.view)}><span><i>${icon(link.iconName)}</i> ${link.label}</span>${link.count === undefined ? html`<small>${icon("arrow")}</small>` : html`<small>${link.count}</small>`}</a>`;})}
          ${canAuthor?html`<a href=${libraryBlockEditorRoute("",route)} class=${surface==="library"&&blockEditorActive?"active":""} aria-current=${surface==="library"&&blockEditorActive?"page":nothing} @click=${this.#openBlockEditor}><span><i>${icon("edit")}</i> Block editor</span><small>${projection.libraryBlocks.filter((block)=>block.scope==="library").length}</small></a>`:nothing}
        </nav>

        ${quiet?nothing:html`<div class="rail-note"><span>${icon("info")}</span><p><b>No auto-filing.</b> Collections are deliberate. Search and aesthetic families remain derived views.</p></div>`}

        ${quiet?nothing:html`<footer class="rail-stream"><span class="rail-live-dot"></span><div><b>${this.store.loading.get()?"Synchronizing changes":"Your work is saved"}</b><small>${this.store.loading.get()?"Checking the latest project state":"Changes remain recoverable"}</small></div></footer>`}
      </div>`}
    </aside>`;
  }
}

customElements.define("forma-project-rail", ProjectRail);
