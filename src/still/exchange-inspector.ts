import { LitElement, css, html, nothing } from 'lit';
import type { DecisionDiagnostics } from './diagnostics.ts';
import './json-tree.ts';

export class StillExchangeInspector extends LitElement {
  static properties={trace:{attribute:false},expanded:{state:true},passId:{state:true}};
  declare trace:DecisionDiagnostics;
  private expanded=false;
  private passId='';
  render(){
    const t=this.trace,pass=t.passes?.find(p=>p.id===this.passId)??t.passes?.[0],e=pass?.exchange??(!pass?t.exchange:undefined),questions=pass?.questions??t.questions;
    return html`<details @toggle=${(event:Event)=>{this.expanded=(event.target as HTMLDetailsElement).open;}}>
      <summary>Request & response${e?'':' · no captured request'}</summary>
      ${this.expanded&&t.passes?.length?html`<label>Pass<select .value=${pass?.id??''} @change=${(event:Event)=>{this.passId=(event.target as HTMLSelectElement).value;}}>${t.passes.map(p=>html`<option value=${p.id}>${p.label} · ${p.status}${p.reason?` · ${p.reason}`:''}</option>`)}</select></label>`:nothing}
      ${!this.expanded?nothing:e?html`
        <p class="meta"><code>${e.requestId}</code><br>${e.requestedAt} · ${e.request.model}${e.responseStatus!==undefined?` · HTTP ${e.responseStatus}`:''}</p>
        ${e.responseStatus===undefined?html`<p>Request attempted; delivery unconfirmed.</p>`:nothing}
        <p>Exact serialized state for this decision. Expand a branch to inspect it.</p>
        <div class="pair">
          <section aria-label="Jev request state"><h4>Request state</h4><still-json-tree label="state" .value=${e.request.state}></still-json-tree></section>
          <section aria-label="Jev inspected response"><h4>Inspected response</h4><p class="meta">Rubric fields; unrecognized fields omitted.</p><still-json-tree label="response" .value=${{
            model:pass?(pass.model??null):(t.model??null),source:pass?pass.status:t.source,reason:pass?(pass.reason??null):(t.reason??null),
            answers:Object.fromEntries(questions.filter(q=>q.asked).map(({id,question,asked,...answer})=>[id,answer])),
          }}></still-json-tree></section>
        </div>
        <still-json-tree label="questions" .value=${e.request.questions}></still-json-tree>
      `:html`<p>${pass?.status==='skipped'?`Pass skipped: ${pass.reason}.`:questions.some(q=>q.asked)?'This response has no captured request state. Enable developer mode before the next decision.':'Jev was not called for this decision.'}</p>`}
    </details>`;
  }
  static styles=css`
    :host{display:block}details{border-top:1px solid #d9d7ce;padding:10px 0}summary{cursor:pointer;font-weight:550}
    summary:focus-visible{outline:2px solid #596345;outline-offset:3px}p{margin:9px 0}h4{font-size:13px;margin:0 0 9px}
    label{display:block;margin:12px 0;font-size:12px}select{display:block;width:100%;padding:8px;margin-top:4px;font:inherit;color:inherit;background:#fff;border:1px solid #c9c6bb;border-radius:4px}
    .meta{font-size:11px;color:#706e65}code{font:11px/1.5 ui-monospace,monospace}
    .pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;margin:18px 0}section{min-width:0}
    @media(max-width:520px){.pair{grid-template-columns:minmax(0,1fr)}}
  `;
}
if(!customElements.get('still-exchange-inspector'))customElements.define('still-exchange-inspector',StillExchangeInspector);
