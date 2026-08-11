import { html } from "lit";
import { FormaElement, icon } from "./forma-element";

type StudioMode = "document" | "project" | "board" | "guided";

const modes: Array<{ id: StudioMode; label: string; path: string }> = [
  { id: "document", label: "Document", path: "/" },
  { id: "project", label: "Project contents", path: "/studio/project" },
  { id: "board", label: "Context board", path: "/studio/board" },
  { id: "guided", label: "Guided brief", path: "/studio/guided" },
];

export class StudioModeNav extends FormaElement {
  override render() {
    const active=(this.getAttribute("active")??"document") as StudioMode;
    return html`<nav class="studio-mode-nav" aria-label="Studio views">
      <span>Studio view</span>
      <div>${modes.map((mode)=>html`<a href=${mode.path} class=${active===mode.id?"active":""} aria-current=${active===mode.id?"page":"false"} @click=${(event:MouseEvent)=>{event.preventDefault();this.store.setRoute(mode.path);window.scrollTo({top:0});}}>${mode.label}</a>`)}</div>
    </nav>`;
  }
}

export class StudioNavigator extends FormaElement {
  #destination(){return this.getAttribute("destination")||"/";}
  async #chooseCollection(id:string){this.store.patchUi({focusCollectionId:id});if(!id)return;const p=this.store.projection.get();const ids=new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===id).map(([documentId])=>documentId));if(ids.has(p.documentId))return;const first=p.documents.find((document)=>ids.has(document.id));if(first)await this.store.openDocument(first.id,this.#destination());}
  override render(){
    const p=this.store.projection.get();const focused=this.store.ui.focusCollectionId;const collection=focused?p.collections.find((item)=>item.id===focused):undefined;
    const documentIds=collection?new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===collection.id).map(([id])=>id)):null;
    const documents=documentIds?p.documents.filter((document)=>documentIds.has(document.id)):p.documents;
    return html`<div class="studio-navigator" aria-label="Project, collection, and document navigation">
      <button class="navigator-project" @click=${()=>this.store.setRoute("/projects")}>${icon("folder")}<span><small>Project</small><b>${p.projectName}</b></span>${icon("arrow")}</button>
      <label><span>Collection</span><select .value=${focused} @change=${(event:Event)=>{void this.#chooseCollection((event.target as HTMLSelectElement).value);}}><option value="">All collections</option>${p.collections.map((item)=>html`<option value=${item.id}>${item.handle}</option>`)}</select></label>
      <label><span>Document</span><select .value=${documents.some((document)=>document.id===p.documentId)?p.documentId:""} @change=${(event:Event)=>{const id=(event.target as HTMLSelectElement).value;if(id)void this.store.openDocument(id,this.#destination());}}><option value="" disabled>${documents.length?"Choose a document":"No documents filed here"}</option>${documents.map((document)=>html`<option value=${document.id}>${document.title}</option>`)}</select></label>
      ${focused?html`<button class="navigator-clear" @click=${()=>this.store.patchUi({focusCollectionId:""})}>Clear collection filter</button>`:html`<span class="navigator-count">${p.documents.length} document${p.documents.length===1?"":"s"}</span>`}
    </div>`;
  }
}

customElements.define("forma-studio-mode-nav",StudioModeNav);
customElements.define("forma-studio-navigator",StudioNavigator);
