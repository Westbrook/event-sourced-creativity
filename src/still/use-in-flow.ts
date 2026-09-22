import type { WorkflowAction, WorkflowToolbar } from './workflow-toolbar.ts';
import './form-elements.js';
import { LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { editableIdea } from './composition.ts';
import { destinationsFor, useInPlan, type Destination, type UseInPlan } from './use-in.ts';
import type { StillClient } from './client.ts';

export class StillUseInFlow extends LitElement{
  static properties={client:{attribute:false},suggestedTarget:{type:String}};
  declare client:StillClient;
  suggestedTarget='';
  private source='';private destination='';private query='';private phase='source';private busy=false;private error='';
  private destinationCache:{key:string;items:Destination[]}={key:'',items:[]};
  private get destinations(){const key=`${this.client.head}/${this.client.scopeKey}/${this.source}`;if(this.destinationCache.key!==key)this.destinationCache={key,items:destinationsFor(this.client.events,{...this.client.position,blockId:this.source})};return this.destinationCache.items;}
  private focusedPhase='';private plan?:UseInPlan;private head=0;private scope='';private epoch=0;
  get preventsRouteChange(){return this.busy||!!this.plan||!!this.query||this.client.hasUnconfirmedWrite;}
  createRenderRoot(){return this;}
  protected firstUpdated(){this.scope=this.client.scopeKey;this.epoch=this.client.epoch;this.source=this.client.position.blockId;this.phase=editableIdea(this.client.projection.blocks.find(b=>b.id===this.source))?'destination':'source';this.destination=this.suggestedTarget;this.requestUpdate();}
  protected updated(){this.dispatchEvent(new Event('workflow-toolbar-change',{bubbles:true}));if(this.focusedPhase===this.phase)return;this.focusedPhase=this.phase;const heading=this.querySelector<HTMLElement>('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
  private changed(){this.requestUpdate();}
  private close(){this.dispatchEvent(new CustomEvent('context-back',{bubbles:true}));}
  private command(label:string,run:()=>void,primary=false,disabled=false):WorkflowAction{return {id:`workflow:${this.phase}:${label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,label,run:()=>{if(!this.busy&&!disabled)run();},variant:primary?'primary':'ghost',disabled:this.busy||disabled};}
  get toolbar():WorkflowToolbar{
    const plan=this.plan;let actions:WorkflowAction[];
    if(this.phase==='source')actions=[this.command('Next',()=>{this.phase='destination';this.changed();},true,!this.source),this.command('Back',()=>this.close())];
    else if(this.phase==='review'&&plan)actions=[this.command(this.client.hasUnconfirmedWrite?'Check save':plan.mode==='link'?'Link idea':'Copy idea',()=>void this.run(()=>this.apply()),true),this.command('Back',()=>{this.plan=undefined;this.phase='destination';this.changed();},false,this.client.hasUnconfirmedWrite)];
    else actions=[this.command('Review',()=>void this.run(()=>this.review()),true,!this.destinations.some(d=>d.id===this.destination)),this.command('Back',()=>this.close())];
    return {actions,status:this.busy?'Working…':''};
  }
  private async run(work:()=>Promise<void>){if(this.busy)return;this.busy=true;this.error='';this.changed();try{await work();}catch(e){this.error=e instanceof Error?e.message:'Could not save.';}finally{this.busy=false;this.changed();}}
  private checkScope(){if(this.scope!==this.client.scopeKey||this.epoch!==this.client.epoch||!this.client.abilities.author)throw new Error('Workspace changed. Reopen this step.');}
  private async review(){await this.client.refresh();this.checkScope();this.plan=useInPlan(this.client.events,this.client.position,this.source,this.destination);if(this.client.session?.projectContext&&this.plan.events.length>50){this.plan=undefined;throw new Error('Choose a smaller group: this workspace allows 50 changes per save.');}this.head=this.client.head;this.phase='review';}
  private async apply(){
    this.checkScope();const plan=this.plan;if(!plan)throw new Error('Review the destination first.');
    if(!this.client.hasUnconfirmedWrite){await this.client.refresh();this.checkScope();if(plan.events.every(input=>this.client.events.some(e=>e.type===input.type&&Object.entries(input.payload).every(([key,value])=>JSON.stringify(e.payload[key])===JSON.stringify(value))))){this.done(plan);return;}if(this.head!==this.client.head)throw new Error('Content changed. Go back and review again.');useInPlan(this.client.events,this.client.position,this.source,this.destination);}
    await this.client.append(plan.events);this.checkScope();
    this.done(plan);
  }
  private done(plan:UseInPlan){this.dispatchEvent(new CustomEvent('use-in-done',{bubbles:true,detail:{...plan.destination,blockId:plan.destination.blockId||plan.rootId}}));
  }
  render(){
    const source=this.client?.projection.blocks.find(b=>b.id===this.source),plan=this.plan;
    const destinations=this.client?this.destinations:[];
    const matches=destinations.filter(d=>`${d.label} ${d.document} ${d.project} ${d.kind}`.toLowerCase().includes(this.query.toLowerCase()));
    return html`<section class="form-page use-in-flow" aria-busy=${this.busy}><span class="eyebrow">${String(source?.properties.label||source?.handle||'')}</span><h1>Use in…</h1>
      ${this.phase==='source'?html`<en-select class="select-label" label="Idea" .value=${live(this.source)} ?disabled=${this.busy} @en-change=${(e: CustomEvent<{proposed:string;value:string}>)=>{this.source=e.detail.proposed;this.changed();}}><en-select-option value="">Choose an idea</en-select-option>${this.client.projection.blocks.filter(editableIdea).map(b=>html`<en-select-option value=${b.id}>${String(b.properties.label||b.handle)}</en-select-option>`)}</en-select>`:
      this.phase==='review'&&plan?html`<p class="context-preview">${String(source?.properties.text??'')}</p><p><strong>${plan.destination.label}</strong> · ${plan.destination.document} · ${plan.destination.project}</p><p class="cost-note">${plan.mode==='link'?'Use the same idea. Edits are shared wherever it is used.':'Create independent copy.'} ${plan.destination.blockId?'Add to this group.':''}</p>
        ${plan.copies.length>1?html`<details><summary>${plan.copies.length} related ideas</summary>${plan.copies.map(c=>html`<p><strong>${c.label}</strong><br>${c.text}</p>`)}</details>`:nothing}
        `:
      html`<p class="context-preview">${String(source?.properties.text??'')}</p><en-search-input class="select-label" label="Find destination" .value=${live(this.query)} ?disabled=${this.busy} @en-input=${(e: CustomEvent<{proposed:string;value:string}>)=>{this.query=e.detail.value;this.destination='';this.changed();}}></en-search-input>
        <en-select class="select-label" label="Destination" .value=${live(this.destination)} ?disabled=${this.busy} @en-change=${(e: CustomEvent<{proposed:string;value:string}>)=>{this.destination=e.detail.proposed;this.changed();}}><en-select-option value="">Choose a destination</en-select-option>${matches.map(d=>html`<en-select-option value=${d.id}>${d.label} · ${d.kind} · ${d.document}${d.projectId!==this.client.position.projectId?` · ${d.project}`:''}</en-select-option>`)}</en-select>
        ${!destinations.length?html`<p>No destinations in this workspace.</p>`:!matches.length?html`<p>No matches.</p>`:nothing}`}
      ${this.error?html`<p class="context-error" role="alert">${this.error}</p>`:nothing}</section>`;
  }
}
if(!customElements.get('still-use-in-flow'))customElements.define('still-use-in-flow',StillUseInFlow);
