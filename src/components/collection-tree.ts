import { html, type TemplateResult } from "lit";
import { FormaElement, icon } from "./forma-element";

export class CollectionTree extends FormaElement {
  #create(parentId: string | null = null) {
    const handle = window.prompt("Collection handle")?.trim(); if (!handle) return;
    void this.store.append({ type: "CollectionCreated", payload: { collection_id: crypto.randomUUID(), handle, parent_collection_id: parentId, position: `z${this.store.head.get()}`, source_claim_ref: null } });
  }
  #rename(id: string, current: string) {
    const next = window.prompt("Rename collection", current)?.trim(); if (!next || next === current) return;
    void this.store.append({ type: "CollectionRenamed", payload: { collection_id: id, old_handle: current, new_handle: next } });
  }
  #moveDocument(collectionId: string) {
    const p = this.store.projection.get(); const membership = p.membership[p.documentId];
    void this.store.append({ type: membership ? "CollectionItemMoved" : "CollectionItemAdded", payload: membership ? { item_ref: { document_id: p.documentId }, from_collection_id: membership.collectionId, to_collection_id: collectionId, position: "a0" } : { collection_id: collectionId, item_ref: { document_id: p.documentId }, position: "a0" } });
  }
  override render() {
    const p = this.store.projection.get(); const roots = p.collections.filter((c) => !c.parentId); const children = (id: string) => p.collections.filter((c) => c.parentId === id);
    const node = (c: typeof p.collections[number], level: number): TemplateResult => html`<li role="treeitem" aria-level=${level} aria-expanded=${children(c.id).length ? "true" : undefined} aria-current=${this.store.ui.focusCollectionId===c.id?"true":undefined} class=${this.store.ui.focusCollectionId===c.id?"brief-focus":""} data-collection-id=${c.id} tabindex="0">
      <div class="tree-row"><span>${icon("folder")}</span><button class="tree-name" @click=${() => {this.store.patchUi({focusCollectionId:c.id});this.store.setRoute("/library");}}>${c.handle}</button><span class="tree-count">${Object.values(p.membership).filter((m) => m.collectionId === c.id).length}</span><button class="tree-more" aria-label="Rename ${c.handle}" @click=${() => this.#rename(c.id, c.handle)}>•••</button></div>
      ${children(c.id).length ? html`<ul role="group">${children(c.id).map((child) => node(child, level + 1))}</ul>` : ""}
      <div class="tree-actions"><button @click=${() => this.#moveDocument(c.id)}>File current</button><button @click=${() => this.#create(c.id)}>+ nested</button></div>
    </li>`;
    return html`<div class="tree-heading"><span>Collections</span><button class="icon-button" aria-label="Create collection" @click=${() => this.#create()}>${icon("plus")}</button></div><ul class="collection-tree" role="tree" aria-label="Collections">${roots.map((c) => node(c, 1))}</ul>`;
  }
}
customElements.define("forma-collection-tree", CollectionTree);
