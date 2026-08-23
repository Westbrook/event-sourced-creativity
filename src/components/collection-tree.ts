import { html, nothing, type TemplateResult } from "lit";
import { FormaElement, icon } from "./forma-element";
import "./icons-authoring";
import "./icons-navigation";
import { ensureModalDialog } from "./modal-dialog";

type CollectionDialog = { mode: "create" | "rename"; parentId: string | null; collectionId: string | null; current: string };

export class CollectionTree extends FormaElement {
  static properties={destination:{type:String},itemKind:{type:String,attribute:"item-kind"},itemId:{type:String,attribute:"item-id"},itemLabel:{type:String,attribute:"item-label"}};
  destination="/studio/project";
  itemKind:"document"|"block"="document";
  itemId="";
  itemLabel="";
  #dialog: CollectionDialog | null = null;
  #handle = "";
  #openMenuId = "";

  protected override updated() {
    ensureModalDialog(this.querySelector<HTMLDialogElement>(".collection-dialog"));
  }

  #openCreate(parentId: string | null = null) {
    this.#dialog={mode:"create",parentId,collectionId:null,current:""};this.#handle="";this.requestUpdate();
    void this.updateComplete.then(()=>this.querySelector<HTMLInputElement>(".collection-dialog input")?.focus());
  }
  #openRename(id: string, current: string) {
    this.#dialog={mode:"rename",parentId:null,collectionId:id,current};this.#handle=current;this.requestUpdate();
    void this.updateComplete.then(()=>this.querySelector<HTMLInputElement>(".collection-dialog input")?.select());
  }
  #dismiss() { this.querySelector<HTMLDialogElement>(".collection-dialog")?.close();this.#dialog=null;this.requestUpdate(); }
  #menuId(id: string) { return `collection-menu-${id.replace(/[^a-zA-Z0-9_-]/g,"-")}`; }
  #closeMenu(id: string) {
    const menu=this.querySelector<HTMLElement>(`#${this.#menuId(id)}`);
    if(menu?.matches(":popover-open"))menu.hidePopover();
    if(this.#openMenuId===id){this.#openMenuId="";this.requestUpdate();}
  }
  #toggleMenu(event: MouseEvent,id: string) {
    const trigger=event.currentTarget as HTMLButtonElement;const menu=this.querySelector<HTMLElement>(`#${this.#menuId(id)}`);if(!menu)return;
    if(menu.matches(":popover-open")){this.#closeMenu(id);return;}
    const rect=trigger.getBoundingClientRect();const width=Math.min(208,window.innerWidth-16);const left=Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8));
    menu.style.setProperty("--collection-menu-top",`${rect.bottom+4}px`);menu.style.setProperty("--collection-menu-left",`${left}px`);menu.showPopover();this.#openMenuId=id;this.requestUpdate();
  }
  #menuToggle(event: Event,id: string) {
    const state=(event as Event&{newState?:string}).newState;
    if(state==="open")this.#openMenuId=id;else if(this.#openMenuId===id)this.#openMenuId="";
    this.requestUpdate();
  }
  #fromMenu(id: string,action:()=>void) { this.#closeMenu(id);action(); }
  async #save(event: SubmitEvent) {
    event.preventDefault();const dialog=this.#dialog;const handle=this.#handle.trim();if(!dialog||!handle)return;
    const input=dialog.mode==="create"
      ? {type:"CollectionCreated",payload:{collection_id:crypto.randomUUID(),handle,parent_collection_id:dialog.parentId,position:`z${this.store.head.get()}`,source_claim_ref:null}}
      : {type:"CollectionRenamed",payload:{collection_id:dialog.collectionId,old_handle:dialog.current,new_handle:handle}};
    const appended=await this.store.append(input);if(appended.length){this.#dismiss();this.store.toast(dialog.mode==="create"?"Collection created.":"Collection renamed.");}
  }
  async #moveItem(collectionId: string) {
    const p=this.store.projection.get();const id=this.itemKind==="block"?this.itemId:p.documentId;if(!id){this.store.toast("Save the block before filing it.");return;}
    const membership=p.membership[id];const noun=this.itemKind==="block"?"block":"document";if(membership?.collectionId===collectionId){this.store.toast(`This ${noun} is already filed here.`);return;}
    const itemRef=this.itemKind==="block"?{block_id:id}:{document_id:id};
    const appended=await this.store.append({type:membership?"CollectionItemMoved":"CollectionItemAdded",payload:membership?{item_ref:itemRef,from_collection_id:membership.collectionId,to_collection_id:collectionId,position:"a0"}:{collection_id:collectionId,item_ref:itemRef,position:"a0"}});
    if(appended.length)this.store.toast(membership?`${this.itemKind==="block"?"Block":"Current document"} moved to this collection.`:`${this.itemKind==="block"?"Block":"Current document"} filed in this collection.`);
  }
  #openCollection(id: string) { this.store.patchUi({focusCollectionId:id});this.store.setRoute(this.destination);window.scrollTo({top:0}); }
  #clearCollection(){this.store.patchUi({focusCollectionId:""});this.store.setRoute(this.destination);window.scrollTo({top:0});}

  override render() {
    const p=this.store.projection.get();const roots=p.collections.filter((collection)=>!collection.parentId);const children=(id:string)=>p.collections.filter((collection)=>collection.parentId===id);const activeCollection=p.collections.find((collection)=>collection.id===this.store.ui.focusCollectionId);const subjectId=this.itemKind==="block"?this.itemId:p.documentId;const currentMembership=subjectId?p.membership[subjectId]:undefined;const subjectName=this.itemKind==="block"?(this.itemLabel||"this block"):"the open document";const fileLabel=this.itemKind==="block"?"File this block":"File open document";const context=this.store.session.get()?.projectContext;const canAuthor=!context||context.permissions.includes("project.author");
    const node=(collection:typeof p.collections[number]):TemplateResult=>html`<li class=${this.store.ui.focusCollectionId===collection.id?"brief-focus":""} data-collection-id=${collection.id}>
      <div class="tree-row"><span aria-hidden="true">${icon("folder")}</span><button type="button" class="tree-name" title=${`Filter project contents to ${collection.handle}`} aria-current=${this.store.ui.focusCollectionId===collection.id?"true":nothing} @click=${()=>this.#openCollection(collection.id)}>${collection.handle}</button><span class="tree-count">${Object.values(p.membership).filter((membership)=>membership.collectionId===collection.id).length}</span>${canAuthor?html`<button type="button" class="tree-more" aria-label=${`Open actions for ${collection.handle}`} title="Collection actions" aria-controls=${this.#menuId(collection.id)} aria-expanded=${this.#openMenuId===collection.id} @click=${(event:MouseEvent)=>this.#toggleMenu(event,collection.id)}>${icon("dots")}</button>`:nothing}</div>
      ${canAuthor?html`<div id=${this.#menuId(collection.id)} class="tree-menu" popover="auto" role="group" aria-label=${`${collection.handle} actions`} @toggle=${(event:Event)=>this.#menuToggle(event,collection.id)}>
        <button type="button" @click=${()=>this.#fromMenu(collection.id,()=>this.#openRename(collection.id,collection.handle))}>${icon("edit")} Rename</button>
        <button type="button" @click=${()=>this.#fromMenu(collection.id,()=>this.#openCreate(collection.id))}>${icon("plus")} New nested collection</button>
        <hr>
        <button type="button" ?disabled=${!subjectId||currentMembership?.collectionId===collection.id} title=${!subjectId?`Save ${subjectName} before filing`:currentMembership?.collectionId===collection.id?`${this.itemKind==="block"?"Block":"Document"} is already filed here`:`Place ${subjectName} in this collection`} @click=${()=>this.#fromMenu(collection.id,()=>{void this.#moveItem(collection.id);})}>${icon("folder")} ${fileLabel}</button>
      </div>`:nothing}
      ${children(collection.id).length?html`<ul>${children(collection.id).map((child)=>node(child))}</ul>`:nothing}
    </li>`;
    const parent=this.#dialog?.parentId?p.collections.find((collection)=>collection.id===this.#dialog?.parentId):null;
    return html`<div class="tree-heading"><div><span>Collections</span><small>Open one to filter project contents</small></div>${canAuthor?html`<button class="icon-button" aria-label="Create top-level collection" title="Create top-level collection" @click=${()=>this.#openCreate()}>${icon("plus")}</button>`:nothing}</div>${activeCollection?html`<div class="collection-rail-filter" role="status"><span>Filtering by <b>${activeCollection.handle}</b></span><button type="button" @click=${this.#clearCollection}>Clear</button></div>`:nothing}<ul class="collection-tree" aria-label="Collections">${roots.length?roots.map((collection)=>node(collection)):html`<li class="tree-empty">No collections yet</li>`}</ul>
      ${this.#dialog?html`<dialog class="modal collection-dialog" closedby="any" aria-labelledby="collection-dialog-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#dismiss();}} @cancel=${(event:Event)=>{event.preventDefault();this.#dismiss();}} @close=${()=>{if(this.#dialog){this.#dialog=null;this.requestUpdate();}}}><form class="modal-card collection-form" @submit=${this.#save}><button type="button" class="icon-button modal-close" aria-label="Close collection dialog" @click=${this.#dismiss}>${icon("close")}</button><span class="eyebrow">Authored organization</span><h2 id="collection-dialog-title">${this.#dialog.mode==="rename"?"Rename collection":parent?`New collection inside ${parent.handle}`:"New top-level collection"}</h2><p>Collections are deliberate filing decisions shared by documents and reusable blocks. Nothing is added or moved automatically.</p><label>Collection name<input maxlength="80" required placeholder="e.g. client explorations" .value=${this.#handle} @input=${(event:InputEvent)=>{this.#handle=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><footer><button type="button" class="button ghost" @click=${this.#dismiss}>Cancel</button><button class="button primary" ?disabled=${!this.#handle.trim()}>${this.#dialog.mode==="rename"?"Save name":"Create collection"}</button></footer></form></dialog>`:nothing}`;
  }
}
customElements.define("forma-collection-tree",CollectionTree);
