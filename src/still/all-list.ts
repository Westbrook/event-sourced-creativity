import { LitElement, html, type PropertyValues } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { VirtualCollection } from './vendor/primitives/state/virtual-collection.js';
import { VirtualCollectionController } from './vendor/primitives/interactions/virtual-collection.js';
import { virtualListRows } from './vendor/primitives/templates/virtual-collection.js';
export type ListRow={id:string};
/** En Reve owns windowing, measurement, stable anchors and keyboard focus retention. */
export class StillAllList<T extends ListRow=ListRow> extends LitElement {
 static properties={items:{attribute:false},renderItem:{attribute:false},label:{type:String}};
 items:T[]=[];label='All items';renderItem:(row:T,index:number)=>unknown=row=>row.id;
 private rows=new VirtualCollection<T>({items:[] as T[],key:(row:T)=>row.id,estimateSize:150,initialCount:12,overscan:3});
 private viewport=new VirtualCollectionController(this,this.rows,{viewport:()=>this.querySelector<HTMLElement>('.all-list-viewport'),content:()=>this.querySelector('ul'),enabled:()=>this.items.length>30,onFocusedItemRemoved:(_key:string,viewport:HTMLElement)=>viewport.focus({preventScroll:true})});
 createRenderRoot(){return this;}
 protected willUpdate(changes:PropertyValues){if(changes.has('items'))this.rows.setItems(this.items);}
 render(){return html`<div class="all-list-viewport" tabindex="0" role="region" aria-label=${this.label}><ul class="all-list-rows">${this.items.length>30?virtualListRows(this.rows,{renderItem:(row:T,index:number)=>this.renderItem(row,index)}):repeat(this.items,row=>row.id,(row,i)=>html`<li aria-posinset=${i+1} aria-setsize=${this.items.length}>${this.renderItem(row,i)}</li>`)}</ul></div>`;}
}
customElements.define('still-all-list',StillAllList);
