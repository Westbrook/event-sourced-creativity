import './vendor/elements/define/switch.js';
import { decisionTiming, jevRequestState } from './decision-timing.ts';
import './form-elements.js';
import './decision-lab-panel.ts';
import { actionLimit, type ExperimentResult } from './decision-lab.ts';
import { PRIMARY_POLICY } from './presentation.ts';
import './vendor/elements/define/badge.js';
import { LitElement, css, html, nothing } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { repeat } from 'lit/directives/repeat.js';
import './exchange-inspector.ts';
import './json-tree.ts';
import type { DecisionDiagnostics, ReceivedDecision } from './diagnostics.ts';
import { ConsoleWindowHost, type ConsoleContext, type ConsoleControl, type ConsoleSnapshot } from './console-window.ts';
export type { ConsoleContext } from './console-window.ts';
const numeric=(n:number|undefined)=>n===undefined?'—':Number(n.toFixed(3)).toString();
const percent=(n:number)=>`${(n*100).toFixed(1)}%`;

export class StillDeveloperConsole extends LitElement {
  static properties = { context:{attribute:false}, applied:{attribute:false}, received:{attribute:false}, pending:{type:Boolean}, controls:{attribute:false}, scope:{attribute:false}, detached:{type:Boolean,reflect:true}, windowOpen:{state:true}, windowConnected:{state:true}, windowError:{state:true}, showReceived:{state:true}, filter:{state:true}, actionSort:{state:true} };
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
  private actionSort:'rank'|'name'='rank';
  private observer=new MutationObserver(()=>this.readControls());
  private root:Element|null=null;
  connectedCallback() {
    super.connectedCallback();this.root=this.detached?null:this.closest('still-app');
    if(this.root){this.observer.observe(this.root,{subtree:true,childList:true,attributes:true,characterData:true});this.root.addEventListener('change',this.readControls);this.root.addEventListener('en-change',this.readControls);}
    void this.updateComplete.then(()=>this.readControls());
  }
  disconnectedCallback(){super.disconnectedCallback();this.windowHost?.dispose();this.observer.disconnect();this.root?.removeEventListener('change',this.readControls);this.root?.removeEventListener('en-change',this.readControls);}
  protected updated(){this.windowHost?.publish();}
  show(){(this.renderRoot.querySelector('h2') as HTMLElement|null)?.focus({preventScroll:true});}
  private snapshot():ConsoleSnapshot{return {scope:this.scope,context:this.context,applied:this.applied,received:this.received,pending:this.pending,controls:this.controls};}
  private density=(value:number)=>this.dispatchEvent(new CustomEvent('developer-density',{bubbles:true,composed:true,detail:{value:actionLimit(value)}}));
  private detach=()=>{
    this.readControls();
    this.windowHost??=new ConsoleWindowHost(window,()=>({scope:this.scope,context:this.context,applied:this.applied,received:this.received,pending:this.pending,controls:this.controls}),(open,connected)=>{this.windowOpen=open;this.windowConnected=connected;},()=>{void this.updateComplete.then(()=>this.show());},data=>{if(data.type==='flags')this.dispatchEvent(new CustomEvent('developer-flags',{bubbles:true,composed:true,detail:{value:data.value===true}}));if(data.type==='refresh')this.dispatchEvent(new CustomEvent('developer-refresh',{bubbles:true,composed:true}));if(data.type==='density')this.density(Number(data.value??5));if(data.type==='experiment'&&data.scope===this.scope)this.dispatchEvent(new CustomEvent('developer-experiment',{bubbles:true,composed:true,detail:{scope:data.scope,request:data.request,complete:(result?:ExperimentResult,error?:string)=>this.windowHost?.result(data.id!,result,error)}}));});
    this.windowError=this.windowHost.open()?'':'Allow pop-ups for Still, then try again.';
  };
  private reattach=()=>{this.windowHost?.dispose();void this.updateComplete.then(()=>this.show());};
  private readControls=()=>{
    if(!this.root)return;
    const controls=[...this.root.querySelectorAll<HTMLElement>('main en-button, main select, main en-textarea, main en-text-field, main en-select, main en-search-input, main en-checkbox, main en-number-field, main input, main button, main a, main [role="button"], main [role="checkbox"], main audio[controls], main video[controls], .action-dock en-button, .command-palette input, .command-palette button, .generation-notifications en-button')]
      .filter(e=>e.getClientRects().length>0 && (!this.context?.paletteOpen || !!e.closest('.command-palette'))).map((e,index)=>{
        const label=e.getAttribute('label')||e.getAttribute('aria-label')||(['AUDIO','VIDEO'].includes(e.tagName)?`${e.tagName==='AUDIO'?'Audio':'Video'} player (native control group)`:e.tagName==='SELECT'?[...(e.closest('label')?.childNodes??[])].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' '):e.innerText)||e.tagName.toLowerCase();
        return {label:label.replace(/\s+/g,' ').trim(),id:e.dataset.actionId||`ui:${e.tagName.toLowerCase()}:${index}`,region:e.closest('.action-dock')?'dock':e.closest('.format-options')?'formats':e.closest('.command-palette')?'palette':e.closest('.generation-notifications')?'notification':'content / workflow',variant:e.getAttribute('variant')||(e.tagName.startsWith('EN-')?'default':'native'),size:e.getAttribute('size')||(e.tagName.startsWith('EN-')?'medium':'default'),emphasis:e.dataset.emphasisReason||'',disabled:!!(e as HTMLButtonElement).disabled||e.getAttribute('aria-disabled')==='true',options:e.tagName==='EN-SELECT'?[...e.querySelectorAll('en-select-option')].map(o=>o.textContent?.trim()||o.getAttribute('label')||''):e.tagName==='SELECT'?[...(e as HTMLSelectElement).options].map(o=>o.text):[]};
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
    const c=this.context,viewingReceived=(this.showReceived||c.paletteOpen&&this.received?.trace?.channel==='palette')&&!!this.received,trace=viewingReceived?this.received?.trace:this.applied;
    const rows=[...(trace?.actions??c.current.actions)].sort((a,b)=>{
      const byName=()=>a.action.label.localeCompare(b.action.label,undefined,{sensitivity:'base'})||a.action.id.localeCompare(b.action.id);
      return this.actionSort==='name'?byName():(a.rank??Infinity)-(b.rank??Infinity)||byName();
    });
    const matched=trace?.head===c.head&&trace.position.view===(c.mode==='generate'&&!c.selectedFormat?'choose-format':c.view)&&(['projectId','documentId','blockId','outputId','itemIndex','hasIntent'] as const).every(key=>trace.position[key]===c.current.position[key]);
    const questions=trace?.questions??[];
    const jevState=jevRequestState(this.received,this.pending),timing=decisionTiming(this.received,this.pending);
    const content=html`<div class="console">
          <header class="panel-heading"><h2 tabindex="-1">Decisions${this.detached?' · Live':''}</h2><div class="window-tools">${this.detached?html`<en-button variant="secondary" size="small" @click=${()=>this.dispatchEvent(new CustomEvent('developer-return'))}>Return to panel</en-button>`:html`<en-button variant="secondary" size="small" @click=${this.detach}>${this.windowOpen?'Focus window':'Open in window'}</en-button>${this.windowOpen?html`<en-button variant="ghost" size="small" @click=${this.reattach}>Close window</en-button>`:nothing}<en-button variant="ghost" size="small" aria-label="Close developer panel" @click=${()=>this.dispatchEvent(new CustomEvent('developer-disable',{bubbles:true,composed:true}))}>Close</en-button>`}</div><div class="jev-state" role="status" aria-live="polite" aria-atomic="true"><strong>Jev state</strong><div class="jev-state-badges">${['Not Requested','Pending','Received',...(jevState==='Failed'?['Failed']:[])].map(state=>html`<span class="jev-state-item"><en-badge variant=${state===jevState?(state==='Failed'?'danger':'success'):'neutral'} aria-current=${state===jevState?'step':nothing}><span slot="prefix" aria-hidden="true">${state===jevState?'●':'○'}</span>${state}</en-badge>${state===jevState&&timing?html`<span class="jev-timing" title=${timing.description} aria-label=${timing.description}>${timing.label}</span>`:nothing}</span>`)}</div><span class="sr-only">Current: ${jevState}</span></div></header>
          ${timing?html`<div class="latency-breakdown" aria-label="Decision timing">${timing.steps.map(step=>html`<span><strong>${step.label}</strong> ${step.value}</span>`)}${this.received?.delivery?.stage==='initial'?html`<en-badge variant="neutral">${this.received.delivery.enrichment==='interrupted'?'Enrichment interrupted':'Enriching…'}</en-badge>`:nothing}</div>`:nothing}
          ${this.windowError?html`<p role="alert">${this.windowError}</p>`:nothing}
          <div class="cache-status">
            <en-badge variant="neutral">${this.pending?'Checking':this.received?.cache?.status==='hit'?'Cached':this.received?.cache?.status==='shared'?'Shared request':this.received?.cache?.status==='bypass'?'Refreshed':this.received?.source==='jev'?'Fresh decision':this.received?'No usable decision':'No decision'}</en-badge>
            ${!this.pending&&this.received?.cache?html`<span>${this.received.cache.layer} · ${Math.round((this.received.cache.ageMs+Math.max(0,Date.now()-(this.received.receivedAt??Date.now())))/1000)} s old · original ${(this.received.cache.originalLatencyMs/1000).toFixed(2)} s${this.received.cache.stored?'':' · not stored'}</span>`:nothing}
            <en-button variant="ghost" size="small" ?disabled=${this.pending||!c.canRefreshDecision} @click=${()=>this.dispatchEvent(new CustomEvent('developer-refresh',{bubbles:true,composed:true}))}>Refresh decision</en-button>
          </div>
          <div class="status"><strong>${this.pending?'Jev pending':this.received?.disposition??'Local controls'}</strong><span>${c.view}${c.mode?` / ${c.mode}`:''} · head ${c.head}</span></div>
          ${this.received?.preparation?html`<details><summary>Data preparation · ${this.received.preparation.totalMs} ms</summary><still-json-tree label="Preparation" .value=${this.received.preparation}></still-json-tree></details>`:nothing}
          <details><summary>Flags</summary><en-switch label="Onboarding" .checked=${c.onboarding===true} @en-change=${(e:CustomEvent<{proposed:boolean}>)=>this.dispatchEvent(new CustomEvent('developer-flags',{bubbles:true,composed:true,detail:{value:e.detail.proposed}}))}>Onboarding</en-switch><p class="muted">Explain actions on hover or keyboard focus. This browser only.</p>${c.onboarding?html`<p class="muted">${c.onboardingText?.source==='pending'?'Generating wording…':c.onboardingText?.source==='model'?'Generated wording':'Local wording'}${c.onboardingText?.elapsedMs!==undefined?` · ${(c.onboardingText.elapsedMs/1000).toFixed(2)} s`:''}</p><still-json-tree label="Onboarding request" .value=${c.onboardingText??null}></still-json-tree>`:nothing}</details>
          <p class="muted">History: ${c.historyComplete===false?'Loading wider context':'Ready'}</p>
          <en-select label="On the page limit" .value=${String(c.actionLimit??5)} @en-change=${(e: CustomEvent<{proposed:string;value:string}>)=>this.density(Number(e.detail.proposed))}>${Array.from({length:7},(_,i)=>i+1).map(n=>html`<en-select-option value=${n}>${n}${n===5?' · default':''}</en-select-option>`)}</en-select><p class="muted">Suggested actions only. Project listings, document context, results and their content controls do not count. At 1–2, remaining actions move into Menu. Density changes locally; the next Jev request includes this limit.</p>
          <details><summary>Local attention <en-badge variant="neutral">Not sent to Jev</en-badge></summary>
            <p class="muted">This tab only · last 20 pages · resets on reload or workspace change. No requests or action updates.</p>
            ${c.attention?.current?html`<p>${Math.round(c.attention.current.foregroundMs/1000)} s foreground · ${Math.round(c.attention.current.idleForegroundMs/1000)} s without input · ${c.attention.current.visits} visits${c.attention.foreground?'':' · paused'}</p>`:nothing}
            <p class="muted">Foreground requires a visible, focused window. Idle means 30 s without input, not disengagement. Exposure requires 25% visibility. Hover may be a parked cursor; keyboard focus excludes automatic focus. IDs only; no text or pointer paths.</p>
            <still-json-tree label="Attention summary · milliseconds" .value=${c.attention??null}></still-json-tree>
          </details>
          <still-decision-lab .snapshot=${this.snapshot()}></still-decision-lab>
          <h3>Live detail</h3><details open><summary>On page · ${this.controls.filter(x=>x.region==='dock'||x.region==='formats').length} action controls · ${this.controls.filter(x=>x.region!=='dock'&&x.region!=='formats').length} content / workflow controls</summary>
            <p class="muted">${c.paletteOpen?'The command palette lists eligible actions.':c.more?'Next-ranked actions, Back, and Palette.':c.mode?'The open workflow supplies its own controls.':c.view==='projects'||c.view==='documents'||c.view==='results'?'Content listings are outside the action budget.':'Suggested actions plus More. Toolbar paging counts toward the action limit.'} First-page Jev primary: score ≥ ${PRIMARY_POLICY.score}/3, confidence ≥ ${PRIMARY_POLICY.confidence*100}%, useful probability ≥ ${PRIMARY_POLICY.usefulProbability*100}%, and lead ≥ ${PRIMARY_POLICY.gap} over the other visible suggestions. At most one primary. Projects may default to New project when Jev has no clear leader. More alternatives are always secondary; escape controls are ghost. Other ties and missing evidence remain equal. The palette is always available with ⌘K.</p>
            <ul class="controls">${this.controls.map(x=>html`<li><b>${x.label}</b><code>${x.id}</code><span>${x.region} · ${x.variant} · ${x.size}${x.disabled?' · disabled':''}</span>${x.emphasis?html`<span>${x.emphasis}</span>`:nothing}${x.options.length?html`<details><summary>Picker options</summary>${x.options.join(' · ')}</details>`:nothing}</li>`)}</ul>
            ${c.selectedFormat?html`<p>Selected format: <code>${c.selectedFormat}</code>. Format actions submit directly; required reviews may pause submission.</p>`:nothing}
          </details>
          ${c.paletteOpen&&c.paletteFeedback?html`<details><summary>Palette entry & order</summary><p>${c.paletteFeedback.entry} · ${c.paletteFeedback.surface}. Passed-over actions are weak evidence, not rejection. Local ordering is immediate; a single Jev refresh may replace it within 1.8 seconds, before interaction.</p><pre>${JSON.stringify({feedback:c.paletteFeedback,ordering:c.paletteOrder},null,2)}</pre></details>`:nothing}
          <div class="trace-choice"><en-select label="Decision" .value=${viewingReceived?'received':'applied'} @en-change=${(e: CustomEvent<{proposed:string;value:string}>)=>{this.showReceived=e.detail.proposed==='received';}}><en-select-option value="applied">Applied to controls</en-select-option><en-select-option value="received" ?disabled=${!this.received}>Latest response</en-select-option></en-select></div>
          ${trace?html`<p><strong>${trace.model?.includes('simulated')?'Simulated Jev':trace.source==='jev'?'Jev':'Fallback'}</strong> · ${trace.channel} · ${trace.policy} · head ${trace.head}${trace.model?` · ${trace.model}`:''}${trace.reason?` · ${trace.reason}`:''}</p>
            <p>Recommended: ${trace.recommended.join(', ')||'none'}</p>
            ${!matched?html`<p class="warning">This decision describes an earlier view or event head. Current eligibility is shown separately below.</p>`:nothing}`:html`<p>No diagnostic payload. ${this.received?.reason??'Local eligibility remains available.'}</p>`}
          ${viewingReceived&&!['Applied','Palette order applied'].includes(this.received?.disposition??'')?html`<p class="warning">This response did not replace the controls. See Applied to controls for the decision in use.</p>`:nothing}
          ${this.received?html`<p class="muted">Latest response · ${this.received.at} · ${this.received.source}${this.received.reason?` / ${this.received.reason}`:''} · ${this.received.disposition}</p>`:nothing}
          ${trace?.passes?.length?html`<details><summary>Compositions · ${trace.passes.filter(p=>p.status!=='skipped').length} passes</summary>${trace.passes.map(p=>html`<p><strong>${p.label}</strong> · ${p.status} · ${p.elapsedMs} ms${p.reason?` · ${p.reason}`:''}<br>${p.compositionIds.join(' · ')}${p.parentId?` · follows ${p.parentId}`:''}</p>`)}<p class="muted">Distinct judgments share the first request. A second pass uses fuller destination evidence. Agreement is not counted as independent evidence.</p>${trace.menuAdjustments.map(a=>html`<p>${a.actionId}${a.replacedId?` replaces ${a.replacedId}`:''}: ${a.reason}. ${a.evidence.map(e=>`${e.passId}/${e.questionId}`).join(', ')}</p>`)}<pre>${JSON.stringify(trace.metrics,null,2)}</pre></details>`:nothing}
          ${trace?keyed(trace,html`<still-exchange-inspector .trace=${trace}></still-exchange-inspector>`):nothing}
          <p class="muted">Score distributions describe rubric ratings. Confidence describes concentration. Neither is the probability of a click. Rank includes policy adjustments.</p>
          <en-search-input label="Find action or question" .value=${this.filter} @en-input=${(e: CustomEvent<{proposed:string;value:string}>)=>{this.filter=e.detail.value.toLowerCase();}}></en-search-input>
          <div class="actions-heading"><h3>All actions · ${rows.length}</h3><en-button variant="ghost" size="small" aria-label=${this.actionSort==='rank'?'Sort by name':'Sort by rank'} @click=${()=>{this.actionSort=this.actionSort==='rank'?'name':'rank';}}>${this.actionSort==='rank'?'Sort by name':'Sort by rank'}</en-button></div>
          <p class="muted">Action · selection · Jev score / final rank value. Expand for probabilities and rules.</p>
          <div class="actions">${repeat(rows.filter(row=>`${row.action.id} ${row.action.label}`.toLowerCase().includes(this.filter)),row=>row.action.id,row=>{
            const answer=questions.find(q=>q.id===row.questionId),current=c.current.actions.find(x=>x.action.id===row.action.id);
            return html`<details class=${row.selected?'selected':''}><summary><span>${row.action.label}</span><span>${row.selected?`#${row.selected}`:row.eligible?'available':'excluded'}</span><code>${numeric(answer?.score)} / ${numeric(row.value)}</code></summary>
              <p><code>${row.action.id}</code> · ${row.action.group}</p><p>Now: ${current?.eligible?'available':current?.eligibilityReason??'unavailable'}. Decision: ${!row.eligible?row.eligibilityReason:row.reason||`selected #${row.selected}`}.</p>
              ${row.base!==undefined?html`<p>Base ${numeric(row.base)} (${row.basis==='jev'?'Jev':'local policy'})${row.rank?` · rank ${row.rank}`:''}</p>${row.adjustments?.map(a=>html`<p class="adjustment"><b>${a.delta>0?'+':''}${numeric(a.delta)}</b> ${a.label}${a.questions.length?html`<small>${a.questions.join(', ')}</small>`:nothing}</p>`)}<p>Final rank value: ${numeric(row.value)}</p>`:nothing}
              ${trace?.presentation[row.action.id]?html`<p>Initial menu emphasis: ${trace.presentation[row.action.id].tier} · ${trace.presentation[row.action.id].variant} · ${trace.presentation[row.action.id].size}. ${trace.presentation[row.action.id].reason}.</p>`:nothing}${this.distribution(answer)}
            </details>`;
          })}</div>
          <details><summary>Creative questions · ${questions.filter(q=>q.asked).length} sent</summary>${questions.filter(q=>`${q.id} ${q.question.instructions}`.toLowerCase().includes(this.filter)).map(q=>html`<details><summary><code>${q.id}</code> · ${q.composition} · ${q.question.type} · ${numeric(q.score??q.noul)}${q.choice?` ${q.choice}`:''}</summary>${this.distribution(q)}</details>`)}</details>
          ${this.coverage(trace,c.current)}
          <p class="muted">Session memory only. No creative events are added by this console.</p>
        </div>`;
    return content;
  }
  static styles=css`
    .latency-breakdown{display:flex;flex-wrap:wrap;gap:8px 16px;margin:12px 0;font-size:12px;color:var(--en-color-text-muted,#777)}
    .latency-breakdown strong{font-weight:500;color:var(--en-color-text,#333)}
    :host{display:block;min-width:0;padding:0 20px 24px;font:13px/1.5 system-ui,sans-serif;color:#33332e;container-type:inline-size}
    :host([detached]){max-width:1200px;margin:auto;padding:0 24px 24px}
    .panel-heading{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:18px 0 14px;background:#f7f6f2;border-bottom:1px solid #d9d7ce}
    .jev-state{flex-basis:100%;display:grid;gap:8px;padding-top:8px}.jev-state>strong{font-size:13px}.jev-state-badges{display:flex;flex-wrap:wrap;gap:6px}.jev-state-item{display:inline-flex;align-items:center;gap:6px}.jev-timing{font-variant-numeric:tabular-nums;white-space:nowrap;color:#66645c;font-size:12px}.jev-state en-badge{--en-badge-radius:9999px}.jev-state en-badge[variant="success"]{--en-badge-background:#e6f3e9}.jev-state en-badge[variant="success"]::part(base){border-color:var(--en-color-success-text);font-weight:650}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    h2{font-size:15px;font-weight:600;margin:0}h2:focus{outline:none}
    .window-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px} .console{overflow-wrap:anywhere}
    .window-tools en-button::part(control){padding-inline:10px}
    h3{font-size:14px;margin:22px 0 8px}p{margin:9px 0}code,pre{font:11px/1.5 ui-monospace,monospace}pre{white-space:pre-wrap}
    .actions-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 8px}.actions-heading h3{margin:0}.actions-heading en-button{margin-left:auto;flex-shrink:0}
    .cache-status{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}.cache-status span{color:#706e65;font-size:12px}
    .status{display:flex;justify-content:space-between;gap:12px;margin:10px 0 18px}.muted,small{color:#706e65}.warning{background:#f1e7ce;padding:10px;border-radius:6px}
    details{border-top:1px solid #d9d7ce;padding:10px 0}summary{cursor:pointer;font-weight:550}.actions summary{display:grid;grid-template-columns:1fr 90px 90px;gap:8px}.actions summary code{text-align:right}.actions summary span:first-child::before{content:'›';display:inline-block;width:14px}.actions details[open]>summary span:first-child::before{content:'⌄'}.selected{border-left:3px solid #596345;padding-left:9px}
    en-select,en-search-input{display:block;width:100%;margin-top:12px}.trace-choice{margin-top:16px}
    .controls{list-style:none;padding:0;display:grid;gap:8px}.controls li{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px}.controls span,.controls details{grid-column:1/-1;color:#706e65}.controls code{text-align:right}
    .distribution>div{display:grid;grid-template-columns:1fr 100px 58px;gap:8px;align-items:center;font-size:12px;margin:5px 0}.distribution b{text-align:right}meter{width:100%;accent-color:#596345}.adjustment small{display:block;margin-left:36px}
    @container(max-width:440px){.status{display:grid;gap:2px}.controls{font-size:12px}.actions summary{grid-template-columns:minmax(0,1fr) 68px 65px}.distribution>div{grid-template-columns:minmax(0,1fr) 60px 52px}}
  `;
}
if(!customElements.get('still-developer-console'))customElements.define('still-developer-console',StillDeveloperConsole);
