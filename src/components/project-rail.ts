import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { documentViewFromRoute, isDocumentViewRoute, libraryBaseRoute, libraryBlockEditorRoute, routePathname, withDocumentInRoute } from "../model/routes";
import { generationHistoryItems } from "../model/events";
import { projectRailDocumentCount, projectRailDocumentDestination, projectRailDocuments } from "../model/project-rail";
import type { FormaIconName } from "./icons";
import "./icons-history";
import "./icons-navigation";
import "./collection-tree";

type RailSurface = "studio" | "library";
type LibraryView = "all" | "blocks" | "outputs" | "families";
let projectRailInstances = 0;

export class ProjectRail extends FormaElement {
  #contentId = `project-rail-content-${++projectRailInstances}`;
  #compact = false;
  #hasSeenExpanded = false;
  #compactChoice: boolean | null = null;
  #compactMedia?: MediaQueryList;
  #inlineObserver?: ResizeObserver;
  #connectionChanged = () => this.requestUpdate();
  #compactChanged = () => {
    const shell=this.closest<HTMLElement>(".app-shell");
    const rootSize=Number.parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
    const availableWidth=shell?.getBoundingClientRect().width||window.innerWidth;
    const compact=availableWidth<=75*rootSize||window.innerHeight<=37.5*rootSize;
    const firstExpansion=this.#compact&&!compact&&!this.#hasSeenExpanded;
    this.#compact=compact;
    if(!compact)this.#hasSeenExpanded=true;
    if(firstExpansion)this.store.patchUi({projectRailCollapsed:false});
    this.requestUpdate();
  };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("online", this.#connectionChanged);
    window.addEventListener("offline", this.#connectionChanged);
    if (typeof matchMedia === "function") {
      this.#compactMedia = matchMedia("(max-width: 75rem), (max-height: 37.5rem)");
      this.#compact = this.#compactMedia.matches;
      this.#hasSeenExpanded = !this.#compact;
      this.#compactMedia.addEventListener("change", this.#compactChanged);
      this.#compactChanged();
    }
    const shell=this.closest<HTMLElement>(".app-shell");
    if(shell&&typeof ResizeObserver==="function"){
      this.#inlineObserver=new ResizeObserver(this.#compactChanged);
      this.#inlineObserver.observe(shell);
    }
  }

  override disconnectedCallback() {
    window.removeEventListener("online", this.#connectionChanged);
    window.removeEventListener("offline", this.#connectionChanged);
    this.#compactMedia?.removeEventListener("change", this.#compactChanged);
    this.#inlineObserver?.disconnect();
    super.disconnectedCallback();
  }

  #setCollapsed(collapsed: boolean) {
    if (this.#compact) {
      this.#compactChoice = collapsed;
      this.requestUpdate();
    } else this.store.patchUi({ projectRailCollapsed: collapsed });
  }

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

  #openDocument(event: MouseEvent, documentId: string, destination: string) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    void this.store.openDocument(documentId, destination, "project-rail");
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
    const collapsed = this.#compact ? this.#compactChoice ?? true : Boolean(this.store.ui.projectRailCollapsed);
    const quiet = this.hasAttribute("quiet");
    const pathname = routePathname(route);
    const canvasWorkspace=pathname==="/canvas/library"||pathname.startsWith("/canvas/library/");
    const projectsRoute=canvasWorkspace?"/canvas/projects":"/projects";
    const overviewRoute=canvasWorkspace?"/canvas":"/studio/project";
    const libraryRoute=libraryBaseRoute(route);
    const context=this.store.session.get()?.projectContext;
    const canAuthor=!context||context.permissions.includes("project.author");
    const documentDestination=projectRailDocumentDestination(route, this.getAttribute("destination"));
    const documents=projectRailDocuments(projection);
    const documentCount=projectRailDocumentCount(projection);
    const initial=this.i18n.firstGrapheme(projection.projectName).toLocaleUpperCase(this.i18n.locale)||"P";
    const resultCount=generationHistoryItems(projection.libraryOutputs).length+projection.libraryArtifacts.length;
    const projectActive = pathname.startsWith("/studio/project");
    const documentActive = isDocumentViewRoute(route);
    const offline=!navigator.onLine;
    const synchronizing=Boolean(this.store.loading.get()||this.store.busy.get());
    const libraryLinks = ([
      { view: "blocks", label: this.i18n.t("projects.reusableBlocks", "Reusable blocks"), count: projection.libraryBlocks.length, iconName: "grid" },
      { view: "outputs", label: this.i18n.t("shared.results", "Creative results"), count: resultCount, iconName: "image" },
    ] satisfies Array<{ view: LibraryView; label: string; count: number; iconName: FormaIconName }>).filter((link)=>link.count>0);
    const documentLabel=(title:string)=>canvasWorkspace?`${this.i18n.t("projects.openCreatorDocument","Open document in Creator Workspace")}: ${title}`:this.i18n.system("Open {documentTitle}",{documentTitle:title});
    const projectIdentityRoute=projection.projectId?overviewRoute:projectsRoute;
    const projectIdentityLabel=projection.projectId?(canvasWorkspace?this.i18n.t("projects.backToBoards","Back to project boards"):this.i18n.t("projects.railOverview","Project overview")):this.i18n.t("projects.all","All projects");

    return html`<aside class=${`project-rail ${collapsed ? "collapsed" : "expanded"} ${quiet ? "quiet" : ""}`} aria-label=${surface==="library"?this.i18n.t("projects.railNavigation","Library project navigation"):this.i18n.t("projects.railDestinations","Project destinations")} @keydown=${(event:KeyboardEvent)=>{if(event.key==="Escape"&&!collapsed&&!event.defaultPrevented){if((event.target as Element|null)?.closest("dialog[open], [popover]:popover-open"))return;event.preventDefault();this.#setCollapsed(true);queueMicrotask(()=>this.querySelector<HTMLButtonElement>(".rail-collapse-toggle")?.focus({preventScroll:true}));}}}>
      <header class="rail-toolbar">
        <span class="rail-toolbar-context"><a class="rail-project-switch" href=${projectIdentityRoute} aria-label=${`${projectIdentityLabel}: ${projection.projectName}`} title=${projectIdentityLabel} @click=${(event:MouseEvent)=>this.#go(event,projectIdentityRoute)}><span class="project-monogram rail-toolbar-monogram" aria-hidden="true">${initial}</span><span class="rail-toolbar-title" dir="auto">${projection.projectName}</span></a></span>
        <button class="rail-collapse-toggle" aria-controls=${this.#contentId} aria-label=${this.i18n.t(collapsed?"projects.railExpand":"projects.railCollapse",collapsed?"Expand project navigation":"Collapse project navigation")} title=${this.i18n.t(collapsed?"projects.railExpand":"projects.railCollapse",collapsed?"Expand project navigation":"Collapse project navigation")} aria-expanded=${!collapsed} @click=${()=>this.#setCollapsed(!collapsed)}>
          <span aria-hidden="true">${icon((collapsed?this.i18n.direction!=="rtl":this.i18n.direction==="rtl")?"next":"previous")}</span><b>${this.i18n.t(collapsed?"projects.railExpand":"projects.railCollapse",collapsed?"Expand project navigation":"Collapse project navigation")}</b>
        </button>
      </header>

      ${collapsed ? html`<nav id=${this.#contentId} class="rail-dock" aria-label=${this.i18n.t("projects.railShortcuts","Project shortcuts")}>
        <a href=${overviewRoute} class=${projectActive?"active":""} aria-current=${projectActive?"page":nothing} aria-label=${`${projectIdentityLabel}: ${projection.projectName}`} title=${`${projectIdentityLabel}: ${projection.projectName}`} @click=${(event:MouseEvent)=>this.#go(event,overviewRoute)}><span>${initial}</span><small>${canvasWorkspace?this.i18n.t("shell.navigation.canvases","Canvases"):this.i18n.t("projects.railOverview","Project overview")}</small></a>
        ${documents.slice(0,3).map((document)=>{const active=documentActive&&document.id===projection.documentId;const href=withDocumentInRoute(documentDestination,document.id,document.title);return html`<a href=${href} class=${active?"active":""} aria-current=${active?"page":nothing} title=${documentLabel(document.title)} aria-label=${canvasWorkspace?documentLabel(document.title):nothing} @click=${(event:MouseEvent)=>this.#openDocument(event,document.id,documentDestination)}>${icon("document")}<small dir="auto">${document.title}</small></a>`;})}
        ${surface==="studio"&&libraryLinks.length?html`<a href=${libraryRoute} title=${this.i18n.t("projects.openLibrary","Open project library")} @click=${(event:MouseEvent)=>this.#openLibrary(event,"all")}>${icon("grid")}<small>${this.i18n.t("projects.railSectionLibrary","Library")}</small></a>`:nothing}
      </nav>` : html`<div id=${this.#contentId} class="rail-content">
        <section class="rail-project-card" aria-label=${this.i18n.t("projects.railCurrent","Current project")}>
          <div class="rail-project-heading"><a class="rail-project-overview" href=${overviewRoute} aria-current=${projectActive?"page":nothing} @click=${(event:MouseEvent)=>this.#go(event,overviewRoute)}><span aria-hidden="true">${icon("folder")}</span><span>${canvasWorkspace?this.i18n.t("projects.backToBoards","Back to project boards"):this.i18n.t("projects.railOverview","Project overview")}</span></a>${projection.projectState!=="active"?html`<span class=${`project-status ${projection.projectState}`}>${this.i18n.t(`projects.state.${projection.projectState}`,projection.projectState)}</span>`:nothing}${!context&&surface==="studio"&&documentViewFromRoute(route)==="document"&&!quiet?html`<button class="icon-button rail-project-edit" aria-label=${this.i18n.system("Edit project")} title=${this.i18n.system("Edit project")} @click=${this.#editProject}>${icon("edit")}</button>`:nothing}</div>
          <p class="rail-project-summary"><span>${this.i18n.plural("projects.document",documentCount,"{count} document","{count} documents")}</span>${resultCount?html`<span aria-hidden="true">·</span><span>${this.i18n.t("shared.results","Creative results")}: ${this.i18n.number(resultCount)}</span>`:nothing}</p>
          ${canAuthor&&surface==="studio"&&!quiet&&!projectActive?html`<a class="button secondary rail-primary-action" href=${libraryBlockEditorRoute("",route)} @click=${this.#openBlockEditor}>${icon("plus")}<span>${this.i18n.t("projects.newReusableBlock","New reusable block")}</span></a>`:nothing}
        </section>

        ${documents.length?html`<nav class="rail-links rail-destinations rail-document-links" aria-label=${this.i18n.t("workbench.documents","Documents")}>
          <div class="rail-section-heading"><span class="rail-label">${this.i18n.t("workbench.documents","Documents")}</span>${documentCount>documents.length?html`<a class="rail-section-more" href=${overviewRoute} aria-label=${`${this.i18n.t("projects.railOverview","Project overview")} (${this.i18n.number(documentCount)})`} @click=${(event:MouseEvent)=>this.#go(event,overviewRoute)}>+${this.i18n.number(documentCount-documents.length)}</a>`:nothing}</div>
          ${canvasWorkspace?html`<span class="rail-document-handoff">${this.i18n.t("projects.creatorWorkspace","Creator Workspace")}</span>`:nothing}
          ${documents.map((document)=>{const active=documentActive&&document.id===projection.documentId;const href=withDocumentInRoute(documentDestination,document.id,document.title);return html`<a href=${href} class=${active?"active":""} aria-current=${active?"page":nothing} title=${documentLabel(document.title)} aria-label=${canvasWorkspace?documentLabel(document.title):nothing} @click=${(event:MouseEvent)=>this.#openDocument(event,document.id,documentDestination)}><span><i aria-hidden="true">${icon("document")}</i><span dir="auto">${document.title}</span></span>${document.id===projection.documentId?html`<small>${this.i18n.t("pattern.current","Current")}</small>`:nothing}</a>`;})}
        </nav>`:nothing}

        ${projection.collections.length||canAuthor?html`<section class=${`rail-collections ${projection.collections.length?"":"rail-collections--empty"}`} aria-label=${this.i18n.t("projects.railCollections","Authored collections")}>
          <forma-collection-tree destination=${surface==="library"?libraryRoute:overviewRoute}></forma-collection-tree>
        </section>`:nothing}

        ${surface!=="library"&&libraryLinks.length?html`<nav class="rail-links rail-library-links" aria-label=${this.i18n.t("projects.railLibrary","Project library")}>
          <span class="rail-label">${this.i18n.t("projects.railSectionLibrary","Library")}</span>
          ${libraryLinks.map((link)=>html`<a href=${libraryRoute} @click=${(event:MouseEvent)=>this.#openLibrary(event,link.view)}><span><i aria-hidden="true">${icon(link.iconName)}</i> ${link.label}</span><small>${this.i18n.number(link.count)}</small></a>`)}
        </nav>`:nothing}

        ${!quiet&&(offline||synchronizing)?html`<footer class="rail-stream" role="status"><div><b>${offline?this.i18n.system("Offline"):this.i18n.system("Synchronizing changes")}</b><small>${offline?this.i18n.system("Reconnect to receive project updates"):this.i18n.system("Checking the latest project state")}</small></div></footer>`:nothing}
      </div>`}
    </aside>`;
  }
}

if (!customElements.get("forma-project-rail")) customElements.define("forma-project-rail", ProjectRail);
