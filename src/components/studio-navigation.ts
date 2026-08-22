import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { documentFocusFromRoute, isDocumentViewRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import { generationHistoryItemIsDraft, generationHistoryItems, generationHistoryMix, outputQualityLabel } from "../model/events";
import "./reference-image";

type StudioMode = "document" | "board" | "guided" | "layers" | "adaptive" | "editor" | "chat";

const modes: Array<{ id: StudioMode; label: string; path: string }> = [
  { id: "document", label: "Document", path: "/" },
  { id: "board", label: "Context board", path: "/studio/board" },
  { id: "guided", label: "Guided brief", path: "/studio/guided" },
  { id: "layers", label: "Reality layers", path: "/studio/layers" },
  { id: "adaptive", label: "Adaptive path", path: "/studio/adaptive" },
  { id: "editor", label: "Creative editor", path: "/studio/editor" },
  { id: "chat", label: "Chat", path: "/studio/chat" },
];

const lensCopy: Record<Exclude<StudioMode, "document">, string> = {
  board: "Every decision is placed by the job it performs.",
  guided: "The interview focuses the next questions without dropping supporting decisions.",
  layers: "Every decision stays in the stack, including choices with no current influence.",
  adaptive: "The next-step path changes, while the complete document remains in scope.",
  editor: "The creative plan stays complete while the machinery stays out of sight.",
  chat: "The conversation changes the complete creative plan without exposing its machinery.",
};

const DOCUMENT_FOCUS_KEY = "forma:document-focus";
const readDocumentFocus = () => {
  try { return localStorage.getItem(DOCUMENT_FOCUS_KEY) === "true"; }
  catch { return false; }
};

export class StudioModeNav extends FormaElement {
  #focused = false;
  #contextPickerOpen = false;
  #revealedMode: StudioMode | null = null;
  #focusKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.#focused && !document.querySelector("dialog[open]")) this.#setFocused(false);
  };

  override connectedCallback() {
    super.connectedCallback();
    const route = this.store.route.get();
    const routeFocused = documentFocusFromRoute(route);
    this.#focused = routeFocused || readDocumentFocus();
    if (this.#focused && !routeFocused && isDocumentViewRoute(route)) this.store.setRoute(withDocumentFocusInRoute(route, true), { replace: true, documentFocus: true });
    this.#reflectFocus();
    window.addEventListener("keydown", this.#focusKeydown);
  }

  override disconnectedCallback() {
    window.removeEventListener("keydown", this.#focusKeydown);
    document.documentElement.removeAttribute("data-document-focus");
    super.disconnectedCallback();
  }

  protected override updated() {
    const dialog = this.querySelector<HTMLDialogElement>(".context-set-picker-dialog");
    ensureModalDialog(dialog);

    const active = (this.getAttribute("active") ?? "document") as StudioMode;
    if (active !== this.#revealedMode) {
      this.#revealedMode = active;
      this.#revealActiveMode();
    }
  }

  #revealActiveMode() {
    const scroller = this.querySelector<HTMLElement>(".studio-mode-links");
    const activeLink = scroller?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!scroller || !activeLink) return;

    const scrollerBounds = scroller.getBoundingClientRect();
    const activeBounds = activeLink.getBoundingClientRect();
    const breathingRoom = 8;
    if (activeBounds.left < scrollerBounds.left + breathingRoom) {
      scroller.scrollLeft += activeBounds.left - scrollerBounds.left - breathingRoom;
    } else if (activeBounds.right > scrollerBounds.right - breathingRoom) {
      scroller.scrollLeft += activeBounds.right - scrollerBounds.right + breathingRoom;
    }
  }

  #reflectFocus() {
    document.documentElement.toggleAttribute("data-document-focus", this.#focused);
  }

  #setFocused(focused: boolean) {
    this.#focused = focused;
    try { localStorage.setItem(DOCUMENT_FOCUS_KEY, String(focused)); } catch { /* Device preference remains session-only. */ }
    this.#reflectFocus();
    this.store.setRoute(withDocumentFocusInRoute(this.store.route.get(), focused), { documentFocus: focused });
    this.requestUpdate();
  }

  #closeContextPicker(){this.querySelector<HTMLDialogElement>(".context-set-picker-dialog")?.close();this.#contextPickerOpen=false;this.requestUpdate();}
  #connectedIds(rootId:string){const projection=this.store.projection.get();const ids=new Set([rootId]);let changed=true;while(changed&&ids.size<24){changed=false;for(const relation of projection.libraryBlockRelations)if(ids.has(relation.fromBlockId)&&!ids.has(relation.toBlockId)){ids.add(relation.toBlockId);changed=true;}}return ids;}
  async #addContextSet(rootId:string){const result=await this.store.copyLibraryBlockSet(rootId,undefined,"document-view-context-picker");if(result)this.#closeContextPicker();}

  override render() {
    const active=(this.getAttribute("active")??"document") as StudioMode;
    const projection = this.store.projection.get();
    const routeFocused = documentFocusFromRoute(this.store.route.get());
    if (routeFocused !== this.#focused) {
      this.#focused = routeFocused;
      try { localStorage.setItem(DOCUMENT_FOCUS_KEY, String(routeFocused)); } catch { /* URL state still works without storage. */ }
      this.#reflectFocus();
    }
    const standalone=projection.libraryBlocks.filter((block)=>block.scope==="library");const targeted=new Set(projection.libraryBlockRelations.map((relation)=>relation.toBlockId));const roots=standalone.filter((block)=>block.type!=="reference"||!targeted.has(block.id));
    return html`<nav class="studio-mode-nav" aria-label="Document views"><span>Document views</span><div class="studio-mode-links">${modes.map((mode)=>{const href=withDocumentFocusInRoute(withDocumentInRoute(mode.path,projection.documentId,projection.documentTitle),this.#focused);return html`<a href=${href} class=${active===mode.id?"active":""} aria-current=${active===mode.id?"page":nothing} @click=${(event:MouseEvent)=>{event.preventDefault();this.store.setRoute(href);window.scrollTo({top:0});}}>${mode.label}</a>`;})}</div><button class="context-set-trigger" aria-label="Add reusable context" title="Add reusable context" @click=${()=>{this.#contextPickerOpen=true;this.requestUpdate();}}>${icon("plus")}<span class="studio-mode-action-label">Add context</span></button><button class="document-focus-toggle" aria-label=${this.#focused ? "Exit focused document view" : "Enter focused document view"} aria-pressed=${this.#focused} title=${this.#focused ? "Restore project navigation and page context" : "Give this document view the full workspace"} @click=${() => this.#setFocused(!this.#focused)}><span aria-hidden="true">${this.#focused ? "↙" : "↗"}</span><span class="studio-mode-action-label">${this.#focused ? "Exit focus" : "Focus view"}</span></button>${this.#contextPickerOpen?html`<dialog class="modal context-set-picker-dialog" closedby="any" aria-labelledby="context-set-picker-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeContextPicker();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeContextPicker();}}><section class="context-set-picker-panel"><button class="icon-button modal-close" aria-label="Close reusable context picker" @click=${this.#closeContextPicker}>${icon("close")}</button><header><span class="eyebrow">${projection.projectName} / Reusable context</span><h2 id="context-set-picker-title">Add a complete idea</h2><p>Choose once to add the root decision and every related reference image. The blocks stay independently editable after they enter this document.</p></header>${roots.length?html`<div class="context-set-picker-list">${roots.map((block)=>{const connected=this.#connectedIds(block.id);const connectedBlocks=projection.libraryBlocks.filter((item)=>connected.has(item.id));const references=connectedBlocks.filter((item)=>item.type==="reference");return html`<article><div class="context-set-preview">${references.slice(0,3).map((reference)=>html`<forma-reference-image .src=${String(reference.properties.media_url??"")} .alt=${String(reference.properties.label??reference.handle)} .compact=${true} .targetId=${reference.id} .referenceId=${String(reference.properties.reference_id??"")} .focalPoint=${reference.properties.focal_point}></forma-reference-image>`)}${!references.length?html`<span>${block.type.slice(0,2).toUpperCase()}</span>`:nothing}</div><div><span>${block.type} · ${connectedBlocks.length===1?"single block":`${connectedBlocks.length} connected blocks`}</span><h3>${block.handle}</h3><p>${String(block.properties.text??block.properties.label??"Reusable creative context")}</p>${references.length?html`<small>${references.map((reference)=>String(reference.properties.label??reference.handle)).join(" · ")}</small>`:html`<small>No related reference image</small>`}</div><button class="button primary" @click=${()=>this.#addContextSet(block.id)}>${connectedBlocks.length===1?"Add block":"Add context set"}</button></article>`;})}</div>`:html`<div class="context-set-picker-empty"><b>No reusable context yet</b><p>Create blocks and connect their reference images in the Library Block editor.</p><a href="/library/blocks/editor/new" @click=${(event:MouseEvent)=>{event.preventDefault();this.#closeContextPicker();this.store.setRoute("/library/blocks/editor/new");}}>Open Block editor ${icon("arrow")}</a></div>`}</section></dialog>`:nothing}</nav>`;
  }
}

export class StudioNavigator extends FormaElement {
  #destination(){return this.getAttribute("destination")||"/";}
  #go(event:MouseEvent,path:string){event.preventDefault();this.store.setRoute(path);window.scrollTo({top:0});}
  async #chooseCollection(id:string){this.store.patchUi({focusCollectionId:id});if(!id)return;const p=this.store.projection.get();const ids=new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===id).map(([documentId])=>documentId));if(ids.has(p.documentId))return;const first=p.documents.find((document)=>ids.has(document.id));if(first)await this.store.openDocument(first.id,this.#destination());}
  override render(){
    const p=this.store.projection.get();const focused=this.store.ui.focusCollectionId;const collection=focused?p.collections.find((item)=>item.id===focused):undefined;
    const documentIds=collection?new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===collection.id).map(([id])=>id)):null;
    const documents=documentIds?p.documents.filter((document)=>documentIds.has(document.id)):p.documents;
    return html`<div class="studio-navigator" aria-label="Current project and document">
      <nav class="studio-breadcrumbs" aria-label="Current location"><a href="/projects" @click=${(event:MouseEvent)=>this.#go(event,"/projects")}>Projects</a><span aria-hidden="true">/</span><a href="/studio/project" @click=${(event:MouseEvent)=>this.#go(event,"/studio/project")}>${p.projectName}</a><span aria-hidden="true">/</span><strong>${p.documentTitle}</strong></nav>
      <form class="studio-navigation-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label><span>Collection scope</span><select .value=${focused} @change=${(event:Event)=>{void this.#chooseCollection((event.target as HTMLSelectElement).value);}}><option value="">All collections</option>${p.collections.map((item)=>html`<option value=${item.id}>${item.handle}</option>`)}</select></label></form>
      <form class="studio-navigation-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label><span>Open document</span><select .value=${documents.some((document)=>document.id===p.documentId)?p.documentId:""} @change=${(event:Event)=>{const id=(event.target as HTMLSelectElement).value;if(id)void this.store.openDocument(id,this.#destination());}}><option value="" disabled>${documents.length?"Choose a document":"No documents filed here"}</option>${documents.map((document)=>html`<option value=${document.id}>${document.title}</option>`)}</select></label></form>
      ${focused?html`<button type="button" class="navigator-clear" @click=${()=>this.store.patchUi({focusCollectionId:""})}>Clear collection scope</button>`:html`<span class="navigator-count">${p.documents.length} document${p.documents.length===1?"":"s"} in project</span>`}
    </div>`;
  }
}

export class DocumentContinuity extends FormaElement {
  override render() {
    const projection = this.store.projection.get();
    const view = (this.getAttribute("view") ?? "board") as Exclude<StudioMode, "document">;
    const active = projection.blocks.filter((block) => Number(block.properties.weight ?? .5) > 0).length;
    const history=generationHistoryItems(projection.outputs);const latest=history[0];
    const generationCount=history.length;const mix=generationHistoryMix(projection.outputs);
    const baselineRoute = withDocumentInRoute("/", projection.documentId, projection.documentTitle);
    return html`<section class="document-continuity" aria-label="Current document represented in this view">
      <div class="document-continuity-title">
        <span class="eyebrow">One document · ${view} lens</span>
        <strong>${projection.documentTitle}</strong>
        <small>${lensCopy[view]} Every saved decision and result is still represented here.</small>
      </div>
      <dl>
        <div><dt>Decisions</dt><dd>${projection.blocks.length}</dd></div>
        <div><dt>Guiding now</dt><dd>${active}</dd></div>
        <div><dt>Generations</dt><dd>${generationCount}</dd></div>
        <div><dt>Draft / full</dt><dd>${mix.drafts} / ${mix.full}</dd></div>
        <div><dt>Latest</dt><dd>${latest ? latest.kind==="fan"?`${generationHistoryItemIsDraft(latest)?"Draft":"Full"} fan`:outputQualityLabel(latest.output) : "Not generated"}</dd></div>
      </dl>
      <a href=${baselineRoute} @click=${(event: MouseEvent) => { event.preventDefault(); this.store.setRoute(baselineRoute); window.scrollTo({ top: 0 }); }}>Open baseline ${icon("arrow")}</a>
    </section>`;
  }
}

customElements.define("forma-studio-mode-nav",StudioModeNav);
customElements.define("forma-studio-navigator",StudioNavigator);
customElements.define("forma-document-continuity", DocumentContinuity);
