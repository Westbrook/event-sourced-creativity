import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { documentFocusFromRoute, isDocumentViewRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";

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

  override render() {
    const active=(this.getAttribute("active")??"document") as StudioMode;
    const projection = this.store.projection.get();
    const routeFocused = documentFocusFromRoute(this.store.route.get());
    if (routeFocused !== this.#focused) {
      this.#focused = routeFocused;
      try { localStorage.setItem(DOCUMENT_FOCUS_KEY, String(routeFocused)); } catch { /* URL state still works without storage. */ }
      this.#reflectFocus();
    }
    return html`<nav class="studio-mode-nav" aria-label="Document views"><span>Document views</span><div>${modes.map((mode)=>{const href=withDocumentFocusInRoute(withDocumentInRoute(mode.path,projection.documentId,projection.documentTitle),this.#focused);return html`<a href=${href} class=${active===mode.id?"active":""} aria-current=${active===mode.id?"page":nothing} @click=${(event:MouseEvent)=>{event.preventDefault();this.store.setRoute(href);window.scrollTo({top:0});}}>${mode.label}</a>`;})}</div><button class="document-focus-toggle" aria-pressed=${this.#focused} title=${this.#focused ? "Restore project navigation and page context" : "Give this document view the full workspace"} @click=${() => this.#setFocused(!this.#focused)}><span aria-hidden="true">${this.#focused ? "↙" : "↗"}</span>${this.#focused ? "Exit focus" : "Focus view"}</button></nav>`;
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
      <label><span>Collection scope</span><select .value=${focused} @change=${(event:Event)=>{void this.#chooseCollection((event.target as HTMLSelectElement).value);}}><option value="">All collections</option>${p.collections.map((item)=>html`<option value=${item.id}>${item.handle}</option>`)}</select></label>
      <label><span>Open document</span><select .value=${documents.some((document)=>document.id===p.documentId)?p.documentId:""} @change=${(event:Event)=>{const id=(event.target as HTMLSelectElement).value;if(id)void this.store.openDocument(id,this.#destination());}}><option value="" disabled>${documents.length?"Choose a document":"No documents filed here"}</option>${documents.map((document)=>html`<option value=${document.id}>${document.title}</option>`)}</select></label>
      ${focused?html`<button class="navigator-clear" @click=${()=>this.store.patchUi({focusCollectionId:""})}>Clear collection scope</button>`:html`<span class="navigator-count">${p.documents.length} document${p.documents.length===1?"":"s"} in project</span>`}
    </div>`;
  }
}

export class DocumentContinuity extends FormaElement {
  override render() {
    const projection = this.store.projection.get();
    const view = (this.getAttribute("view") ?? "board") as Exclude<StudioMode, "document">;
    const active = projection.blocks.filter((block) => Number(block.properties.weight ?? .5) > 0).length;
    const latest = projection.outputs[0];
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
        <div><dt>Results</dt><dd>${projection.outputs.length}</dd></div>
        <div><dt>Latest result</dt><dd>${latest ? latest.pinned ? "Pinned" : latest.saved ? "Saved" : `Version ${latest.variant + 1}` : "Not generated"}</dd></div>
      </dl>
      <a href=${baselineRoute} @click=${(event: MouseEvent) => { event.preventDefault(); this.store.setRoute(baselineRoute); window.scrollTo({ top: 0 }); }}>Open baseline ${icon("arrow")}</a>
    </section>`;
  }
}

customElements.define("forma-studio-mode-nav",StudioModeNav);
customElements.define("forma-studio-navigator",StudioNavigator);
customElements.define("forma-document-continuity", DocumentContinuity);
