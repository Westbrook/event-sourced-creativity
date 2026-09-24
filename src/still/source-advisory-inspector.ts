import {LitElement,html,css,nothing} from 'lit';
import {property,state} from 'lit/decorators.js';

/** Selection comes only from the current server preflight review. Inspection
 * emits no acknowledgement or generation events and keeps no persistent cache. */
export class SourceAdvisoryInspector extends LitElement {
 @property({attribute:false}) selection:{documentId:string;preflightId:string}|null=null;
 @state() private value:Record<string,unknown>|null=null;
 @state() private loading=false;
 private controller:AbortController|null=null;
 private expiry:ReturnType<typeof setTimeout>|undefined;
 static styles=css`:host{display:block;margin:1rem 0;font:inherit;color:inherit}button,summary{font:inherit;cursor:pointer}button{padding:.5rem .75rem;background:transparent;color:inherit;border:1px solid currentColor;border-radius:.35rem}section{border-top:1px solid #aaa5;padding-top:.8rem}p{line-height:1.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace;max-height:24rem;overflow:auto}li{margin:.6rem 0}dl{display:grid;grid-template-columns:auto 1fr;gap:.3rem 1rem}dd{margin:0;overflow-wrap:anywhere}details{margin:.6rem 0}`;
 disconnectedCallback(){super.disconnectedCallback();this.controller?.abort();clearTimeout(this.expiry);this.value=null;}
 private async inspect(){
  if(!this.selection||this.loading)return;
  this.loading=true;this.value=null;this.controller?.abort();clearTimeout(this.expiry);
  const selected=this.selection,controller=this.controller=new AbortController();
  try{
   const query=new URLSearchParams(selected);
   const response=await fetch('/api/source-advisory?'+query,{method:'GET',cache:'no-store',signal:controller.signal});
   const value=await response.json() as Record<string,unknown>;
   if(this.selection!==selected||controller.signal.aborted)return;
   this.value=value;
   if(value.status==='available'){
    const delay=Date.parse(String(value.expiresAt))-Date.now();
    if(!Number.isFinite(delay)||delay<=0)this.value={status:'unavailable'};
    else this.expiry=setTimeout(()=>{this.value={status:'unavailable'};},delay);
   }
  }catch{if(!controller.signal.aborted)this.value={status:'unavailable'};}
  finally{this.loading=false;}
 }
 render(){
  if(!this.selection)return nothing;
  const value=this.value,available=value?.status==='available';
  const identity=(value?.identity??{}) as Record<string,unknown>,raw=(value?.raw??{}) as Record<string,unknown>;
  const inputs=Array.isArray(value?.inputs)?value.inputs as Array<Record<string,unknown>>:[];
  const known=(v:unknown)=>v==null?'Unknown':typeof v==='string'?v:JSON.stringify(v);
  return html`<section aria-label="Source advisory inspection"><button type="button" @click=${this.inspect} ?disabled=${this.loading}>${this.loading?'Inspecting…':'Inspect source advisory'}</button>
   <p>Read-only details for this preflight. Inspection does not acknowledge or send a generation request.</p>
   ${value&&!available?html`<p role="status">Source advisory details are unavailable. Complete current authority and retained original evidence are required; missing or expired evidence cannot be refreshed here.</p>`:nothing}
   ${available?html`<p role="status">${value.adopted?'Reused original preflight.':'Original preflight.'} Access ends ${known(value.expiresAt)}.</p>
    <dl><dt>Requested model</dt><dd>${known(identity.requestedModel)}</dd><dt>Returned model</dt><dd>${known(identity.returnedModel)}</dd><dt>Request ID</dt><dd>${known(identity.requestId)}</dd><dt>Response ID</dt><dd>${known(identity.responseId)}</dd></dl>
    <p>Result validity: ${known(value.validity)}. Scores are provider values, not calibrated probabilities. Position associates each result with an input; it does not identify a causal phrase or an image-provider refusal.</p>
    <details><summary>Input results (${inputs.length})</summary><ol>${inputs.map(input=>html`<li>Input ${known(input.index)} · ${known(input.kind)}${input.blockId?html` · ${known(input.blockId)}`:nothing} · Flagged: ${known(input.flagged)}<br>Categories: ${known(input.categories)}<br>Scores: ${known(input.scores)}<br>${known(input.utf16Length)} UTF-16 units · Truncated: ${known(input.truncated)}</li>`)}</ol></details>
    <details><summary>Exact request body</summary><pre>${known(raw.requestBody)}</pre></details>
    <details><summary>Exact response body</summary><pre>${known(raw.responseBody)}</pre></details>`:nothing}
  </section>`;
 }
}
if(!customElements.get('still-source-advisory-inspector'))customElements.define('still-source-advisory-inspector',SourceAdvisoryInspector);
