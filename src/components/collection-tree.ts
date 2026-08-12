import { html, nothing, type TemplateResult } from "lit";
import { FormaElement, icon } from "./forma-element";

type CollectionDialog = { mode: "create" | "rename"; parentId: string | null; collectionId: string | null; current: string };

export class CollectionTree extends FormaElement {
  static properties={destination:{type:String},itemKind:{type:String,attribute:"item-kind"},itemId:{type:String,attribute:"item-id"},itemLabel:{type:String,attribute:"item-label"}};
  destination="/studio/project";
  itemKind:"document"|"block"="document";
  itemId="";
  itemLabel="";
  #dialog: CollectionDialog | null = null;
  #handle = "";

  protected override updated() {
    const dialog=this.querySelector<HTMLDialogElement>(".collection-dialog");if(dialog&&!dialog.open)dialog.showModal();
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
  async #openCollection(id: string) { this.store.patchUi({focusCollectionId:id});const libraryDestination=this.destination==="/library"||this.destination.startsWith("/library/");if(this.destination==="/studio/project"||libraryDestination){this.store.setRoute(this.destination);return;}const p=this.store.projection.get();const ids=new Set(Object.entries(p.membership).filter(([,membership])=>membership.collectionId===id).map(([documentId])=>documentId));const first=p.documents.find((document)=>ids.has(document.id));if(first&&!ids.has(p.documentId)){await this.store.openDocument(first.id,this.destination);return;}this.store.setRoute(this.destination); }

  override render() {
    const p=this.store.projection.get();const roots=p.collections.filter((collection)=>!collection.parentId);const children=(id:string)=>p.collections.filter((collection)=>collection.parentId===id);const subjectId=this.itemKind==="block"?this.itemId:p.documentId;const currentMembership=subjectId?p.membership[subjectId]:undefined;const subjectName=this.itemKind==="block"?(this.itemLabel||"this block"):"the open document";const fileLabel=this.itemKind==="block"?"File this block":"File open document";
    const node=(collection:typeof p.collections[number],level:number):TemplateResult=>html`<li role="treeitem" aria-level=${level} aria-expanded=${children(collection.id).length?"true":undefined} aria-current=${this.store.ui.focusCollectionId===collection.id?"true":undefined} class=${this.store.ui.focusCollectionId===collection.id?"brief-focus":""} data-collection-id=${collection.id} tabindex="0">
      <div class="tree-row"><span>${icon("folder")}</span><button class="tree-name" title=${`Open project items filed in ${collection.handle}`} @click=${()=>{void this.#openCollection(collection.id);}}>${collection.handle}</button><span class="tree-count">${Object.values(p.membership).filter((membership)=>membership.collectionId===collection.id).length}</span><button class="tree-more" aria-label=${`Edit ${collection.handle}`} title="Rename collection" @click=${()=>this.#openRename(collection.id,collection.handle)}>•••</button></div>
      ${children(collection.id).length?html`<ul role="group">${children(collection.id).map((child)=>node(child,level+1))}</ul>`:nothing}
      <div class="tree-actions"><button ?disabled=${!subjectId||currentMembership?.collectionId===collection.id} title=${`Place ${subjectName} in this collection`} @click=${()=>this.#moveItem(collection.id)}>${!subjectId?"Save before filing":currentMembership?.collectionId===collection.id?`${this.itemKind==="block"?"Block":"Document"} filed here`:fileLabel}</button><button title="Create a child collection inside this one" @click=${()=>this.#openCreate(collection.id)}>New nested collection</button></div>
    </li>`;
    const parent=this.#dialog?.parentId?p.collections.find((collection)=>collection.id===this.#dialog?.parentId):null;
    return html`<div class="tree-heading"><span>Collections</span><button class="icon-button" aria-label="Create top-level collection" title="Create top-level collection" @click=${()=>this.#openCreate()}>${icon("plus")}</button></div><ul class="collection-tree" role="tree" aria-label="Collections">${roots.length?roots.map((collection)=>node(collection,1)):html`<li class="tree-empty">No collections yet</li>`}</ul>
      ${this.#dialog?html`<dialog class="modal collection-dialog" closedby="any" aria-labelledby="collection-dialog-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#dismiss();}} @cancel=${(event:Event)=>{event.preventDefault();this.#dismiss();}} @close=${()=>{if(this.#dialog){this.#dialog=null;this.requestUpdate();}}}><form class="modal-card collection-form" @submit=${this.#save}><button type="button" class="icon-button modal-close" aria-label="Close collection dialog" @click=${this.#dismiss}>${icon("close")}</button><span class="eyebrow">Authored organization</span><h2 id="collection-dialog-title">${this.#dialog.mode==="rename"?"Rename collection":parent?`New collection inside ${parent.handle}`:"New top-level collection"}</h2><p>Collections are deliberate filing decisions shared by documents and reusable blocks. Nothing is added or moved automatically.</p><label>Collection name<input maxlength="80" required placeholder="e.g. client explorations" .value=${this.#handle} @input=${(event:InputEvent)=>{this.#handle=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><footer><button type="button" class="button ghost" @click=${this.#dismiss}>Cancel</button><button class="button primary" ?disabled=${!this.#handle.trim()}>${this.#dialog.mode==="rename"?"Save name":"Create collection"}</button></footer></form></dialog>`:nothing}`;
  }
}
customElements.define("forma-collection-tree",CollectionTree);
