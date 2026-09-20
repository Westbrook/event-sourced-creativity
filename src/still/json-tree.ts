import { LitElement, css, html, nothing } from 'lit';

/** Only expanded branches create descendants. Values remain plain, escaped text. */
export class StillJsonTree extends LitElement {
  static properties={value:{attribute:false},label:{type:String},expanded:{state:true}};
  declare value:unknown;
  label='Object';
  private expanded=false;
  render(){
    const value=this.value,compound=value!==null&&typeof value==='object';
    if(!compound)return html`<div class="leaf"><b>${this.label}</b><code>${JSON.stringify(value)??'undefined'}</code></div>`;
    const entries=Object.entries(value as Record<string,unknown>),array=Array.isArray(value);
    return html`<details .open=${this.expanded} @toggle=${(event:Event)=>{this.expanded=(event.target as HTMLDetailsElement).open;}}>
      <summary><b>${this.label}</b> <span>${array?`Array(${entries.length})`:`{${entries.length}}`}</span></summary>
      ${this.expanded?html`<div class="children">${entries.length?entries.map(([key,item])=>html`<still-json-tree .label=${array?`[${key}]`:key} .value=${item}></still-json-tree>`):html`<code>${array?'[]':'{}'}</code>`}</div>`:nothing}
    </details>`;
  }
  static styles=css`
    :host{display:block;min-width:0;font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}
    summary{cursor:pointer;padding:4px 0}summary:focus-visible{outline:2px solid var(--en-color-focus);outline-offset:2px}
    b{font-weight:550}span{color:var(--en-color-text-muted)}code{font:inherit;white-space:pre-wrap}
    .children{border-left:1px solid var(--en-color-line);margin-left:5px;padding-left:12px}
    .leaf{padding:4px 0;display:flex;flex-wrap:wrap;column-gap:10px}.leaf code{color:var(--en-color-action-text);max-width:100%}
  `;
}
if(!customElements.get('still-json-tree'))customElements.define('still-json-tree',StillJsonTree);
