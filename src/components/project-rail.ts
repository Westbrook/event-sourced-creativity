import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { navigateInApp } from "./command-departure";
import { observeNativePopoverPosition, positionNativePopover } from "./native-popover";
import { documentViewFromRoute, isDocumentViewRoute, libraryBaseRoute, libraryBlockEditorRoute, routePathname, withDocumentInRoute, withProjectTaskDocumentInRoute } from "../model/routes";
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
  #overlayMedia?: MediaQueryList;
  #postureObserver?: MutationObserver;
  #nativePanel = false;
  #nativeOpen = false;
  #renderScope = "";
  #presentation = 0;
  #stopPosition?: () => void;
  #navigationChanged = () => { this.#closeNative(); this.requestUpdate(); };
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
    window.addEventListener("forma-route-changed", this.#navigationChanged);
    window.addEventListener("forma-authorization-changed", this.#navigationChanged);
    if (typeof matchMedia === "function") {
      this.#overlayMedia = matchMedia("(max-width: 47.99rem)");
      this.#overlayMedia.addEventListener("change", this.#navigationChanged);
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
    if(shell&&typeof MutationObserver==="function"){
      this.#postureObserver=new MutationObserver(this.#navigationChanged);
      this.#postureObserver.observe(shell,{attributes:true,attributeFilter:["data-nav-posture","class"]});
    }
  }

  override disconnectedCallback() {
    this.#closeNative();
    this.#renderScope = "";
    window.removeEventListener("forma-route-changed", this.#navigationChanged);
    window.removeEventListener("forma-authorization-changed", this.#navigationChanged);
    this.#overlayMedia?.removeEventListener("change", this.#navigationChanged);
    this.#postureObserver?.disconnect();
    window.removeEventListener("online", this.#connectionChanged);
    window.removeEventListener("offline", this.#connectionChanged);
    this.#compactMedia?.removeEventListener("change", this.#compactChanged);
    this.#inlineObserver?.disconnect();
    super.disconnectedCallback();
  }

  // This is the actual overlaid Creator rail, not the wider inline compact rail.
  #usesNativePanel() {
    const shell=this.closest<HTMLElement>(".app-shell");
    return Boolean(shell?.classList.contains("application-creative")&&(shell.getAttribute("data-nav-posture")==="compact"||this.#overlayMedia?.matches));
  }

  #navigationScope() {
    const authority=this.store.captureAuthorizationScope(),projection=this.store.projection.get();
    if(!authority)return "";
    const shell=this.closest<HTMLElement>(".app-shell");
    return JSON.stringify([authority.key,this.store.route.get(),projection.projectId,projection.documentId,this.getAttribute("surface"),this.getAttribute("destination"),this.hasAttribute("quiet"),this.#usesNativePanel(),shell?.getAttribute("data-nav-posture"),this.#overlayMedia?.matches]);
  }

  /** Close the rail popover when its navigation scope or panel mode changes. */
  override willUpdate() {
    const scope=this.#navigationScope(),nativePanel=this.#usesNativePanel();
    if(scope!==this.#renderScope||nativePanel!==this.#nativePanel)this.#closeNative();
    this.#renderScope=scope;this.#nativePanel=nativePanel;
  }

  #current(scope: string) { return Boolean(scope&&this.isConnected&&scope===this.#navigationScope()&&scope===this.#renderScope); }

  #closeNative() {
    const changed=this.#nativeOpen;
    this.#nativeOpen=false;this.#presentation+=1;
    this.#stopPosition?.();this.#stopPosition=undefined;
    const panel=this.querySelector<HTMLElement>(".rail-content[popover]");
    if(panel?.matches(":popover-open"))panel.hidePopover();
    if(changed)this.requestUpdate();
  }

  #beforeToggle(event: ToggleEvent, scope: string) {
    const panel=event.currentTarget as HTMLElement;
    if(event.newState==="open"){
      if(!this.#current(scope)||!this.#usesNativePanel()){event.preventDefault();return;}
      this.#nativeOpen=true;this.#presentation+=1;
      const trigger=this.querySelector<HTMLElement>(".rail-collapse-toggle");
      if(trigger)positionNativePopover(trigger,panel);
      this.requestUpdate();
    }else if(this.#nativeOpen){
      // Keep the focused subtree mounted until native dismissal restores focus.
      // The current closed toggle retires it; scope withdrawal still closes immediately.
      this.#presentation+=1;this.#stopPosition?.();this.#stopPosition=undefined;
    }
  }

  #nativeToggled(event: Event, scope: string) {
    const panel=event.currentTarget as HTMLElement;
    if(panel!==this.querySelector(".rail-content[popover]"))return;
    // Toggle events can be coalesced: native current state, not queued newState, owns aria-expanded.
    if(!panel.matches(":popover-open")){this.#closeNative();return;}
    if(!this.#current(scope)||!this.#usesNativePanel()){this.#closeNative();return;}
    const trigger=this.querySelector<HTMLElement>(".rail-collapse-toggle"),presentation=this.#presentation;
    this.#stopPosition?.();this.#stopPosition=trigger?observeNativePopoverPosition(trigger,panel):undefined;
    void this.updateComplete.then(()=>{
      if(!this.#current(scope)||presentation!==this.#presentation||!this.#nativeOpen||!this.#usesNativePanel())return;
      const currentPanel=this.querySelector<HTMLElement>(".rail-content[popover]"),currentTrigger=this.querySelector(".rail-collapse-toggle");
      if(!currentPanel?.matches(":popover-open")||document.activeElement!==currentTrigger)return;
      (currentPanel.querySelector<HTMLElement>('a[aria-current="page"]')??currentPanel.querySelector<HTMLElement>("a[href]"))?.focus({preventScroll:true});
    });
  }

  #key(event: KeyboardEvent, collapsed: boolean, scope: string) {
    if(event.key==="Escape"&&!collapsed&&!event.defaultPrevented&&!event.isComposing){
      if(this.#nativePanel){event.stopPropagation();return;} // Native Escape owns dismissal and invoker focus.
      if((event.target as Element|null)?.closest("dialog[open], [popover]:popover-open"))return;
      if(!this.#current(scope))return;
      event.preventDefault();this.#setCollapsed(true);
      const presentation=++this.#presentation;
      queueMicrotask(()=>{
        if(this.#current(scope)&&presentation===this.#presentation&&!this.#usesNativePanel()&&(this.#compact?this.#compactChoice??true:Boolean(this.store.ui.projectRailCollapsed)))this.querySelector<HTMLButtonElement>(".rail-collapse-toggle")?.focus({preventScroll:true});
      });
    }
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
    if(path===this.store.route.get()){this.#closeNative();return;}
    void navigateInApp(this,async navigation=>{
      this.#closeNative();
      const opened=await navigation.route(path);
      if(opened&&navigation.current())window.scrollTo({top:0});
      return opened;
    });
  }

  #openLibrary(event: MouseEvent, view: LibraryView) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    const path=libraryBaseRoute(this.store.route.get());
    void navigateInApp(this,async navigation=>{
      this.#closeNative();
      this.store.patchUi({ libraryView: view, focusCollectionId: "" });
      const opened=await navigation.route(path);
      if(opened&&navigation.current())window.scrollTo({top:0});
      return opened;
    });
  }

  #openDocument(event: MouseEvent, documentId: string, destination: string) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    void navigateInApp(this,async navigation=>{
      this.#closeNative();
      const opened=await this.store.openDocument(documentId,destination,"project-rail",navigation);
      if(opened&&navigation.current())window.scrollTo({top:0});
      return opened;
    });
  }

  #openBlockEditor(event:MouseEvent) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    const path=libraryBlockEditorRoute("",this.store.route.get());
    void navigateInApp(this,async navigation=>{
      this.#closeNative();this.store.patchUi({libraryView:"blocks",focusCollectionId:""});
      const opened=await navigation.route(path);
      if(opened&&navigation.current())window.scrollTo({top:0});
      return opened;
    });
  }

  #editProject() {
    this.#closeNative();
    this.dispatchEvent(new CustomEvent("edit-project", { bubbles: true, composed: true }));
  }

  override render() {
    const projection = this.store.projection.get();
    const route = this.store.route.get();
    const surface = (this.getAttribute("surface") === "library" ? "library" : "studio") as RailSurface;
    const scope=this.#renderScope;
    const collapsed = this.#nativePanel ? !this.#nativeOpen : this.#compact ? this.#compactChoice ?? true : Boolean(this.store.ui.projectRailCollapsed);
    const guard={capture:true,handleEvent:(event:Event)=>{if(!this.#current(scope)){event.preventDefault();event.stopImmediatePropagation();if(scope===this.#renderScope)this.#closeNative();}}};
    const quiet = this.hasAttribute("quiet");
    const pathname = routePathname(route);
    const canvasWorkspace=pathname==="/canvas/library"||pathname.startsWith("/canvas/library/");
    const projectsRoute=canvasWorkspace?"/canvas/projects":"/projects";
    const overviewRoute=canvasWorkspace?"/canvas":"/studio/project";
    const libraryRoute=withProjectTaskDocumentInRoute(libraryBaseRoute(route),projection.documentId, this.store.route.get());
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

    return html`<aside class=${`project-rail ${collapsed ? "collapsed" : "expanded"} ${quiet ? "quiet" : ""}`} aria-label=${surface==="library"?this.i18n.t("projects.railNavigation","Library project navigation"):this.i18n.t("projects.railDestinations","Project destinations")} @click=${guard} @submit=${guard} @keydown=${(event:KeyboardEvent)=>this.#key(event,collapsed,scope)}>
      <header class="rail-toolbar">
        <span class="rail-toolbar-context"><a class="rail-project-switch" href=${projectIdentityRoute} aria-label=${`${projectIdentityLabel}: ${projection.projectName}`} title=${projectIdentityLabel} @click=${(event:MouseEvent)=>this.#go(event,projectIdentityRoute)}><span class="project-monogram rail-toolbar-monogram" aria-hidden="true">${initial}</span><span class="rail-toolbar-title" dir="auto">${projection.projectName}</span></a></span>
        <button type="button" class="rail-collapse-toggle" aria-controls=${this.#contentId} aria-label=${this.i18n.t(collapsed?"projects.railExpand":"projects.railCollapse",collapsed?"Expand project navigation":"Collapse project navigation")} title=${this.i18n.t(collapsed?"projects.railExpand":"projects.railCollapse",collapsed?"Expand project navigation":"Collapse project navigation")} aria-expanded=${!collapsed} popovertarget=${this.#nativePanel?this.#contentId:nothing} @click=${(event:MouseEvent)=>{if(!this.#current(scope)){event.preventDefault();return;}if(!this.#nativePanel)this.#setCollapsed(!collapsed);}}>
          <span aria-hidden="true">${icon((collapsed?this.i18n.direction!=="rtl":this.i18n.direction==="rtl")?"next":"previous")}</span><b>${this.i18n.t(collapsed?"projects.railExpand":"projects.railCollapse",collapsed?"Expand project navigation":"Collapse project navigation")}</b>
        </button>
      </header>

      ${collapsed&&!this.#nativePanel ? html`<nav id=${this.#contentId} class="rail-dock" aria-label=${this.i18n.t("projects.railShortcuts","Project shortcuts")}>
        <a href=${overviewRoute} class=${projectActive?"active":""} aria-current=${projectActive?"page":nothing} aria-label=${`${projectIdentityLabel}: ${projection.projectName}`} title=${`${projectIdentityLabel}: ${projection.projectName}`} @click=${(event:MouseEvent)=>this.#go(event,overviewRoute)}><span>${initial}</span><small>${canvasWorkspace?this.i18n.t("shell.navigation.canvases","Canvases"):this.i18n.t("projects.railOverview","Project overview")}</small></a>
        ${documents.slice(0,3).map((document)=>{const active=documentActive&&document.id===projection.documentId;const href=withDocumentInRoute(documentDestination,document.id,document.title);return html`<a href=${href} class=${active?"active":""} aria-current=${active?"page":nothing} title=${documentLabel(document.title)} aria-label=${canvasWorkspace?documentLabel(document.title):nothing} @click=${(event:MouseEvent)=>this.#openDocument(event,document.id,documentDestination)}>${icon("document")}<small dir="auto">${document.title}</small></a>`;})}
        ${surface==="studio"&&libraryLinks.length?html`<a href=${libraryRoute} title=${this.i18n.t("projects.openLibrary","Open project library")} @click=${(event:MouseEvent)=>this.#openLibrary(event,"all")}>${icon("grid")}<small>${this.i18n.t("projects.railSectionLibrary","Library")}</small></a>`:nothing}
      </nav>` : html`<div id=${this.#contentId} class=${this.#nativePanel?"rail-content ui-popover-panel":"rail-content"} popover=${this.#nativePanel?"auto":nothing} @beforetoggle=${(event:ToggleEvent)=>this.#beforeToggle(event,scope)} @toggle=${(event:Event)=>this.#nativeToggled(event,scope)}>
        ${collapsed?nothing:html`
        <section class="rail-project-card" aria-label=${this.i18n.t("projects.railCurrent","Current project")}>
          <div class="rail-project-heading"><a class="rail-project-overview" href=${overviewRoute} aria-current=${projectActive?"page":nothing} @click=${(event:MouseEvent)=>this.#go(event,overviewRoute)}><span aria-hidden="true">${icon("folder")}</span><span>${canvasWorkspace?this.i18n.t("projects.backToBoards","Back to project boards"):this.i18n.t("projects.railOverview","Project overview")}</span></a>${projection.projectState!=="active"?html`<span class=${`project-status ${projection.projectState}`}>${this.i18n.t(`projects.state.${projection.projectState}`,projection.projectState)}</span>`:nothing}${!context&&surface==="studio"&&documentViewFromRoute(route)==="document"&&!quiet?html`<button class="icon-button rail-project-edit" aria-label=${this.i18n.system("Edit project")} title=${this.i18n.system("Edit project")} @click=${this.#editProject}>${icon("edit")}</button>`:nothing}</div>
          <p class="rail-project-summary"><span>${this.i18n.plural("projects.document",documentCount,"{count} document","{count} documents")}</span>${resultCount?html`<span aria-hidden="true">·</span><span>${this.i18n.t("shared.results","Creative results")}: ${this.i18n.number(resultCount)}</span>`:nothing}</p>
          ${canAuthor&&surface==="studio"&&!quiet&&!projectActive?html`<a class="button secondary rail-primary-action" href=${libraryBlockEditorRoute("",route)} @click=${this.#openBlockEditor}><i aria-hidden="true">${icon("plus")}</i><span>${this.i18n.t("projects.newReusableBlock","New reusable block")}</span></a>`:nothing}
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
          ${libraryLinks.map((link)=>html`<a href=${libraryRoute} @click=${(event:MouseEvent)=>this.#openLibrary(event,link.view)}><span><i aria-hidden="true">${icon(link.iconName)}</i><span>${link.label}</span></span><small>${this.i18n.number(link.count)}</small></a>`)}
        </nav>`:nothing}

        ${!quiet&&(offline||synchronizing)?html`<footer class="rail-stream" role="status"><div><b>${offline?this.i18n.system("Offline"):this.i18n.system("Synchronizing changes")}</b><small>${offline?this.i18n.system("Reconnect to receive project updates"):this.i18n.system("Checking the latest project state")}</small></div></footer>`:nothing}
        `}
      </div>`}
    </aside>`;
  }
}

if (!customElements.get("forma-project-rail")) customElements.define("forma-project-rail", ProjectRail);
