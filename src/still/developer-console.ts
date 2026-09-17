import { LitElement, css, html, nothing } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import './exchange-inspector.ts';
import './json-tree.ts';
import type { DecisionDiagnostics, ReceivedDecision } from './diagnostics.ts';
import { ConsoleWindowHost, type ConsoleContext, type ConsoleControl } from './console-window.ts';
export type { ConsoleContext } from './console-window.ts';
const numeric=(n:number|undefined)=>n===undefined?'—':Number(n.toFixed(3)).toString();
const percent=(n:number)=>`${(n*100).toFixed(1)}%`;

export class StillDeveloperConsole extends LitElement {
  static properties = { context:{attribute:false}, applied:{attribute:false}, received:{attribute:false}, pending:{type:Boolean}, controls:{attribute:false}, scope:{attribute:false}, detached:{type:Boolean,reflect:true}, windowOpen:{state:true}, windowConnected:{state:true}, windowError:{state:true}, showReceived:{state:true}, filter:{state:true} };
  declare context:ConsoleContext;
  declare applied:DecisionDiagnostics|undefined;
  declare received:ReceivedDecision|undefined;
  pending=false;
  controls:ConsoleControl[]=[];
  scope='';
  detached=false;
  private windowOpen=false;
  private windowConnected=false;
  private windowError='';
  private windowHost?:ConsoleWindowHost;
  private showReceived=false;
  private filter='';
  private observer=new MutationObserver(()=>this.readControls());
  private root:Element|null=null;
  connectedCallback() {
    super.connectedCallback();this.root=this.detached?null:this.closest('still-app');
    if(this.root){this.observer.observe(this.root,{subtree:true,childList:true,attributes:true,characterData:true});this.root.addEventListener('change',this.readControls);}
    void this.updateComplete.then(()=>this.readControls());
  }
  disconnectedCallback(){super.disconnectedCallback();this.windowHost?.dispose();this.observer.disconnect();this.root?.removeEventListener('change',this.readControls);}
  protected updated(){this.windowHost?.publish();}
  show(){(this.renderRoot.querySelector('h2') as HTMLElement|null)?.focus({preventScroll:true});}
  private detach=()=>{
    this.readControls();
    this.windowHost??=new ConsoleWindowHost(window,()=>({scope:this.scope,context:this.context,applied:this.applied,received:this.received,pending:this.pending,controls:this.controls}),(open,connected)=>{this.windowOpen=open;this.windowConnected=connected;},()=>{void this.updateComplete.then(()=>this.show());});
    this.windowError=this.windowHost.open()?'':'Allow pop-ups for Still, then try again.';
  };
  private reattach=()=>{this.windowHost?.dispose();void this.updateComplete.then(()=>this.show());};
  private readControls=()=>{
    if(!this.root)return;
    const controls=[...this.root.querySelectorAll<HTMLElement>('main en-button, main select, main en-textarea, main input, main button, main a, main [role="button"], main [role="checkbox"], main audio[controls], main video[controls], .action-dock en-button, .command-palette input, .command-palette button')]
      .filter(e=>e.getClientRects().length>0 && (!this.context?.paletteOpen || !!e.closest('.command-palette'))).map((e,index)=>{
        const label=e.getAttribute('label')||e.getAttribute('aria-label')||(['AUDIO','VIDEO'].includes(e.tagName)?`${e.tagName==='AUDIO'?'Audio':'Video'} player (native control group)`:e.tagName==='SELECT'?[...(e.closest('label')?.childNodes??[])].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' '):e.innerText)||e.tagName.toLowerCase();
        return {label:label.replace(/\s+/g,' ').trim(),id:e.dataset.actionId||`ui:${e.tagName.toLowerCase()}:${index}`,region:e.closest('.action-dock')?'dock':e.closest('.format-options')?'formats':'content / workflow',variant:e.getAttribute('variant')||'native',size:e.getAttribute('size')||'default',emphasis:e.dataset.emphasisReason||'',disabled:!!(e as HTMLButtonElement).disabled||e.getAttribute('aria-disabled')==='true',options:e.tagName==='SELECT'?[...(e as HTMLSelectElement).options].map(o=>o.text):[]};
      });
    if(JSON.stringify(controls)!==JSON.stringify(this.controls))this.controls=controls;
  };
  private distribution(row:DecisionDiagnostics['questions'][number]|undefined){
    if(!row)return html`<p>Not asked in this composition.</p>`;
    const a=row, q=row.question;
    return html`<p>${q.instructions}</p><p>${a.asked?'Sent to Jev':'Not sent to Jev'} · ${a.status}${a.score!==undefined?` · score ${numeric(a.score)}`:''}${a.confidence!==undefined?` · confidence ${percent(a.confidence)}`:''}${a.noul!==undefined?` · probability ${percent(a.noul)}`:''}${a.choice?` · choice ${a.choice}`:''}</p>
      ${q.type==='noul'?nothing:html`<div class="distribution">${(q.type==='score'?q.criteria.map((label,i)=>[String(i),label]):Object.entries(q.criteria)).map(([key,label])=>html`<div><span>${key} · ${label}</span><meter min="0" max="1" value=${a.probabilities?.[key]??0} aria-label=${`${label}: ${a.probabilities?percent(a.probabilities[key]):'unavailable'}`}></meter><b>${a.probabilities?percent(a.probabilities[key]):'—'}</b></div>`)}</div>`}
      ${a.warnings.map(w=>html`<p class="muted">${w}.</p>`)}`;
  }
  private eventList(label:string,events:unknown) {
    const list=Array.isArray(events)?events as Record<string,unknown>[]:[];
    return html`<details><summary>${label} · ${list.length}</summary>${list.length?list.slice().reverse().map(e=>html`<still-json-tree .label=${`#${e.sequence} ${e.type} · ${e.at}`} .value=${e}></still-json-tree>`):html`<p class="muted">No events in this sample.</p>`}</details>`;
  }
  private coverage(trace:DecisionDiagnostics|undefined,current:DecisionDiagnostics) {
    const state=trace?.exchange?.request.state as {history?:{recentCreative?:unknown;recent?:unknown;focused?:unknown;milestones?:unknown;eventCounts?:unknown;coverage?:unknown};current?:{recentActions?:unknown}}|undefined;
    return html`<details><summary>Context coverage</summary>
      <p class="muted">${state ? 'Captured Jev request · event samples are bounded.' : 'Local workspace snapshot · not evidence of a Jev call.'}</p>
      <still-json-tree label="Position" .value=${{current:current.position,decision:trace?.position}}></still-json-tree>
      <still-json-tree label="Session actions" .value=${state?.current?.recentActions??current.position.recentActions}></still-json-tree>
      ${state?.history ? html`${this.eventList('Recent creative events · sent to Jev',state.history.recentCreative)}${this.eventList('Recent log events · sent to Jev',state.history.recent)}<still-json-tree label="Full history summary · sent to Jev" .value=${state.history}></still-json-tree>` : html`${this.eventList('Recent creative events · local',current.context.localEvents)}<p class="muted">Local history uses the compact workspace profile. The server reads the full authorized log for Jev.</p>`}
      <still-json-tree label="Coverage counts" .value=${trace?.context??current.context}></still-json-tree>
    </details>`;
  }
  render(){
    if(!this.context)return nothing;
    const c=this.context,viewingReceived=this.showReceived&&!!this.received,trace=viewingReceived?this.received?.trace:this.applied;
    const rows=trace?.actions??c.current.actions;
    const matched=trace?.head===c.head&&trace.position.view===(c.mode==='generate'&&!c.selectedFormat?'choose-format':c.view)&&(['projectId','documentId','blockId','outputId','itemIndex','hasIntent'] as const).every(key=>trace.position[key]===c.current.position[key]);
    const questions=trace?.questions??[];
    const content=html`<div class="console">
          <header class="panel-heading"><h2 tabindex="-1">Decisions${this.detached?' · Live':''}</h2><div class="window-tools">${this.detached?html`<en-button variant="secondary" size="small" @click=${()=>this.dispatchEvent(new CustomEvent('developer-return'))}>Return to panel</en-button>`:html`<en-button variant="secondary" size="small" @click=${this.detach}>${this.windowOpen?'Focus window':'Open in window'}</en-button>${this.windowOpen?html`<en-button variant="ghost" size="small" @click=${this.reattach}>Close window</en-button>`:nothing}<en-button variant="ghost" size="small" aria-label="Close developer panel" @click=${()=>this.dispatchEvent(new CustomEvent('developer-disable',{bubbles:true,composed:true}))}>Close</en-button>`}</div></header>
          ${this.windowError?html`<p role="alert">${this.windowError}</p>`:nothing}
          <div class="status"><strong>${this.pending?'Jev pending':this.received?.disposition??'Local controls'}</strong><span>${c.view}${c.mode?` / ${c.mode}`:''} · head ${c.head}</span></div>
          <details open><summary>On page · ${this.controls.length} controls</summary>
            <p class="muted">${c.paletteOpen?'The command palette lists eligible actions.':c.more?'Up to three next-ranked actions, Back, and Palette.':c.mode?'The open workflow supplies its own controls.':c.view==='projects'||c.view==='documents'||c.view==='results'?'Browse content and pagination share the control budget.':'Up to four suggestions, plus More. Slides reserve two places for paging.'} Emphasis requires useful, confident scores, a valid distribution and a clear margin. Ties and missing evidence have equal weight. The palette is always available with ⌘K.</p>
            <ul class="controls">${this.controls.map(x=>html`<li><b>${x.label}</b><code>${x.id}</code><span>${x.region} · ${x.variant} · ${x.size}${x.disabled?' · disabled':''}</span>${x.emphasis?html`<span>${x.emphasis}</span>`:nothing}${x.options.length?html`<details><summary>Picker options</summary>${x.options.join(' · ')}</details>`:nothing}</li>`)}</ul>
            ${c.selectedFormat?html`<p>Selected format: <code>${c.selectedFormat}</code>. Selection does not start generation.</p>`:nothing}
          </details>
          <div class="trace-choice"><label>Decision<select .value=${viewingReceived?'received':'applied'} @change=${(e:Event)=>{this.showReceived=(e.target as HTMLSelectElement).value==='received';}}><option value="applied">Applied to controls</option><option value="received" ?disabled=${!this.received}>Latest response</option></select></label></div>
          ${trace?html`<p><strong>${trace.model?.includes('simulated')?'Simulated Jev':trace.source==='jev'?'Jev':'Fallback'}</strong> · ${trace.channel} · ${trace.policy} · head ${trace.head}${trace.model?` · ${trace.model}`:''}${trace.reason?` · ${trace.reason}`:''}</p>
            <p>Recommended: ${trace.recommended.join(', ')||'none'}</p>
            ${!matched?html`<p class="warning">This decision describes an earlier view or event head. Current eligibility is shown separately below.</p>`:nothing}`:html`<p>No diagnostic payload. ${this.received?.reason??'Local eligibility remains available.'}</p>`}
          ${viewingReceived&&this.received?.disposition!=='Applied'?html`<p class="warning">This response did not replace the controls. See Applied to controls for the decision in use.</p>`:nothing}
          ${this.received?html`<p class="muted">Latest response · ${this.received.at} · ${this.received.source}${this.received.reason?` / ${this.received.reason}`:''} · ${this.received.disposition}</p>`:nothing}
          ${trace?.passes?.length?html`<details><summary>Compositions · ${trace.passes.filter(p=>p.status!=='skipped').length} passes</summary>${trace.passes.map(p=>html`<p><strong>${p.label}</strong> · ${p.status} · ${p.elapsedMs} ms${p.reason?` · ${p.reason}`:''}<br>${p.compositionIds.join(' · ')}${p.parentId?` · follows ${p.parentId}`:''}</p>`)}<p class="muted">Distinct judgments share the first request. A second pass uses fuller destination evidence. Agreement is not counted as independent evidence.</p>${trace.menuAdjustments.map(a=>html`<p>${a.actionId}${a.replacedId?` replaces ${a.replacedId}`:''}: ${a.reason}. ${a.evidence.map(e=>`${e.passId}/${e.questionId}`).join(', ')}</p>`)}<pre>${JSON.stringify(trace.metrics,null,2)}</pre></details>`:nothing}
          ${trace?keyed(trace,html`<still-exchange-inspector .trace=${trace}></still-exchange-inspector>`):nothing}
          <p class="muted">Score distributions describe rubric ratings. Confidence describes concentration. Neither is the probability of a click. Rank includes policy adjustments.</p>
          <label>Find action or question<input type="search" .value=${this.filter} @input=${(e:Event)=>{this.filter=(e.target as HTMLInputElement).value.toLowerCase();}}/></label>
          <h3>All actions · ${rows.length}</h3>
          <p class="muted">Action · selection · Jev score / final rank value. Expand for probabilities and rules.</p>
          <div class="actions">${rows.filter(row=>`${row.action.id} ${row.action.label}`.toLowerCase().includes(this.filter)).map(row=>{
            const answer=questions.find(q=>q.id===row.questionId),current=c.current.actions.find(x=>x.action.id===row.action.id);
            return html`<details class=${row.selected?'selected':''}><summary><span>${row.action.label}</span><span>${row.selected?`#${row.selected}`:row.eligible?'available':'excluded'}</span><code>${numeric(answer?.score)} / ${numeric(row.value)}</code></summary>
              <p><code>${row.action.id}</code> · ${row.action.group}</p><p>Now: ${current?.eligible?'available':current?.eligibilityReason??'unavailable'}. Decision: ${!row.eligible?row.eligibilityReason:row.reason||`selected #${row.selected}`}.</p>
              ${row.base!==undefined?html`<p>Base ${numeric(row.base)} (${row.basis==='jev'?'Jev':'local policy'})${row.rank?` · rank ${row.rank}`:''}</p>${row.adjustments?.map(a=>html`<p class="adjustment"><b>${a.delta>0?'+':''}${numeric(a.delta)}</b> ${a.label}${a.questions.length?html`<small>${a.questions.join(', ')}</small>`:nothing}</p>`)}<p>Final rank value: ${numeric(row.value)}</p>`:nothing}
              ${trace?.presentation[row.action.id]?html`<p>Emphasis: ${trace.presentation[row.action.id].tier} · ${trace.presentation[row.action.id].variant} · ${trace.presentation[row.action.id].size}. ${trace.presentation[row.action.id].reason}.</p>`:nothing}${this.distribution(answer)}
            </details>`;
          })}</div>
          <details><summary>Creative questions · ${questions.filter(q=>q.asked).length} sent</summary>${questions.filter(q=>`${q.id} ${q.question.instructions}`.toLowerCase().includes(this.filter)).map(q=>html`<details><summary><code>${q.id}</code> · ${q.composition} · ${q.question.type} · ${numeric(q.score??q.noul)}${q.choice?` ${q.choice}`:''}</summary>${this.distribution(q)}</details>`)}</details>
          ${this.coverage(trace,c.current)}
          <p class="muted">Session memory only. No creative events are added by this console.</p>
        </div>`;
    return content;
  }
  static styles=css`
    :host{display:block;min-width:0;padding:0 20px 24px;font:13px/1.5 system-ui,sans-serif;color:#33332e;container-type:inline-size}
    :host([detached]){max-width:1200px;margin:auto;padding:0 24px 24px}
    .panel-heading{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:18px 0 14px;background:#f7f6f2;border-bottom:1px solid #d9d7ce}
    h2{font-size:15px;font-weight:600;margin:0}h2:focus{outline:none}
    .window-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px} .console{overflow-wrap:anywhere}
    .window-tools en-button::part(control){padding-inline:10px}
    h3{font-size:14px;margin:22px 0 8px}p{margin:9px 0}code,pre{font:11px/1.5 ui-monospace,monospace}pre{white-space:pre-wrap}
    .status{display:flex;justify-content:space-between;gap:12px;margin:10px 0 18px}.muted,small{color:#706e65}.warning{background:#f1e7ce;padding:10px;border-radius:6px}
    details{border-top:1px solid #d9d7ce;padding:10px 0}summary{cursor:pointer;font-weight:550}.actions summary{display:grid;grid-template-columns:1fr 90px 90px;gap:8px}.actions summary code{text-align:right}.actions summary span:first-child::before{content:'›';display:inline-block;width:14px}.actions details[open]>summary span:first-child::before{content:'⌄'}.selected{border-left:3px solid #596345;padding-left:9px}
    label{display:block;font-size:12px;color:#706e65}input,select{display:block;box-sizing:border-box;width:100%;font:inherit;background:#fff;border:1px solid #c9c6bb;border-radius:6px;padding:9px;color:#33332e;margin-top:4px}.trace-choice{margin-top:16px}
    .controls{list-style:none;padding:0;display:grid;gap:8px}.controls li{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px}.controls span,.controls details{grid-column:1/-1;color:#706e65}.controls code{text-align:right}
    .distribution>div{display:grid;grid-template-columns:1fr 100px 58px;gap:8px;align-items:center;font-size:12px;margin:5px 0}.distribution b{text-align:right}meter{width:100%;accent-color:#596345}.adjustment small{display:block;margin-left:36px}
    @container(max-width:440px){.status{display:grid;gap:2px}.controls{font-size:12px}.actions summary{grid-template-columns:minmax(0,1fr) 68px 65px}.distribution>div{grid-template-columns:minmax(0,1fr) 60px 52px}}
  `;
}
if(!customElements.get('still-developer-console'))customElements.define('still-developer-console',StillDeveloperConsole);
