import {LitElement, html, nothing} from 'lit';
import type {StillClient} from './client.ts';
import {canInspectRejection} from './generation-decision.ts';
import {documentGenerationInputInspection, type GenerationInputInspection} from '../model/generation-inputs.ts';
import {documentJobFailure, type DocumentJob} from '../model/document-jobs.ts';

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const pretty=(value:unknown)=>JSON.stringify(value,null,2);
const money=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?`$${(value/1_000_000).toFixed(6)} USD`:'Not recorded';
const time=(value:string|null|undefined)=>value?`${new Date(value).toLocaleString()} (${value})`:'Not recorded';
const duration=(start:string|null|undefined,end:string|null|undefined)=>{
  const elapsed=Date.parse(end??'')-Date.parse(start??'');
  return Number.isFinite(elapsed)&&elapsed>=0?`${(elapsed/1000).toFixed(2)} seconds`:'Not recorded';
};

/** Private evidence lives only in this mounted, authorization-scoped view. */
export class StillRejectionPage extends LitElement {
  static properties={client:{attribute:false},scope:{type:String},inspection:{state:true},error:{state:true},loading:{state:true}};
  declare client:StillClient;
  scope='';
  private inspection?:GenerationInputInspection;
  private job?:DocumentJob;
  private unavailable:string[]=[];
  private error='';
  private loading=true;
  private ticket=0;
  override createRenderRoot(){return this;}
  override updated(changed:Map<string,unknown>){if(changed.has('scope')||changed.has('client'))void this.load();}
  override disconnectedCallback(){++this.ticket;this.inspection=undefined;this.job=undefined;super.disconnectedCallback();}
  private async load(){
    const ticket=++this.ticket,scope=this.scope,client=this.client;
    const guard=client.fence(),jobId=client.position.outputId,documentId=client.position.documentId;
    const current=()=>{guard();return this.isConnected&&ticket===this.ticket&&scope===this.scope&&client.position.view==='rejection'&&client.position.outputId===jobId&&client.position.documentId===documentId;};
    this.inspection=undefined;this.job=undefined;this.unavailable=[];this.error='';this.loading=true;
    try{
      const result=await client.inspectGeneration(jobId,documentId);
      if(!current())return;
      if(!canInspectRejection(result.job))throw new Error('This attempt does not have a recorded rejection. View its output page for the current status.');
      this.job=result.job;this.unavailable=result.unavailable;
      this.inspection=documentGenerationInputInspection({...result.job,members:result.job.members??[]},client.events,result.content);
    }catch(error){
      if(ticket===this.ticket&&this.isConnected){this.inspection=undefined;this.job=undefined;this.error=error instanceof Error?error.message:'Inspection unavailable.';}
    }finally{if(ticket===this.ticket){this.loading=false;}}
  }
  private details(title:string,value:unknown,note?:string){
    if(value===null||value===undefined||Array.isArray(value)&&!value.length)return nothing;
    return html`<details><summary>${title}</summary>${note?html`<p>${note}</p>`:nothing}<pre>${pretty(value)}</pre></details>`;
  }
  override render(){
    const job=this.job,inspection=this.inspection;
    if(this.loading)return html`<section class="rejection-page"><h1>Inspect rejection</h1><p role="status">Loading the retained request and rejection details…</p></section>`;
    if(!job||!inspection)return html`<section class="rejection-page"><h1>Inspect rejection</h1><p role="status">${this.error}</p><en-button variant="secondary" @click=${()=>this.load()}>Reload details</en-button></section>`;
    const receipt=inspection.receipt,generation=record(receipt.generation_receipt),failure=documentJobFailure(job),checkpoint=record(receipt.artifact_checkpoint),privateInput=record(receipt.private_input);
    const preflight=failure?.code==='safety_preflight_flagged';
    const facts:[string,unknown][]=[
      ['Attempt',job.jobId],['Document',job.documentId],['Status',job.status],['Failure code',failure?.code],['Category',failure?.category],
      ['Failure stage',generation.failure_stage||job.stage],['Provider',generation.provider],['Model',generation.model],
      ['Provider request ID',failure?.requestId],['Planner response ID',checkpoint.planner_response_id],['HTTP status',failure?.httpStatus],
      ['Request status',generation.provider_request_status],['Source transmission',generation.source_transmission_status],
      ['Recorded provider calls',generation.actual_provider_call_count],['Reserved allowance',money(generation.reservation_microusd)],
      ['Recorded settled usage',money(generation.settled_cost_microusd)],['Reservation status',generation.reservation_status],
      ['Requested',time(job.requestedAt)],['Started',time(job.startedAt)],['Finished',time(job.completedAt)],
      ['Queue time',duration(job.requestedAt,job.startedAt)],['Execution time',duration(job.startedAt,job.completedAt)],
      ['Source revision',job.documentRevision],['Attempt count',job.attemptCount],['Input retention ends',generation.private_input_expires_at],
    ];
    return html`<article class="rejection-page">
      <span class="eyebrow">${this.client.projection.documentTitle} · ${inspection.subtitle}</span>
      <h1>Inspect rejection</h1>
      <p class="rejection-lead">${preflight?'Still stopped this request for a safety review before the next submission.':'This attempt was rejected. The evidence below can help you understand the request and decide what to change.'}</p>
      <section aria-labelledby="rejection-reason"><h2 id="rejection-reason">What was reported</h2>
        <blockquote>${failure?.message||job.error||'No rejection message was retained.'}</blockquote>
        <p>${preflight?'This is Still’s preflight assessment, not a confirmation that the output provider rejected the request. Required acknowledgement remains on the output page.':'The recorded message is the provider or application’s explanation. A generic safety rejection does not identify which word, idea, or reference caused it. Still cannot infer an undisclosed reason from the document title or subject.'}</p>
        ${failure?.riskCategories?.length?html`<p>Recorded risk categories: ${failure.riskCategories.join(', ')}. These are assessment signals, not proof that every listed item caused the rejection.</p>`:html`<p>No specific risk category was recorded.</p>`}
      </section>
      <section aria-labelledby="rejection-next"><h2 id="rejection-next">Deciding what to do next</h2>
        <p>Review the original prompt, source ideas, and references below. Compare them with what you intended to ask for. If they contain an unintended instruction, ambiguity, or incorrect detail, revise the document before generating again. Add idea and Add direction update the document used by a new request; they do not change this attempt’s retained evidence.</p>
        <p><strong>Retry dangerously</strong> starts a separate paid request in the original output format using the current document. Unchanged inputs may be rejected again, and planning or other provider work can still incur costs without producing an output. It does not resume this attempt or bypass provider safeguards.</p>
        <p>View output returns to this attempt’s status; a rejected attempt may have no output. Choose output lets you consider a different format. If the rejection appears mistaken, use the recorded provider request ID and relevant request details when contacting that provider’s support. Only share private prompts or references with people you intend to give access to them.</p>
      </section>
      <section aria-labelledby="rejection-inputs"><h2 id="rejection-inputs">Original inputs</h2>
        <p>${String(receipt.retention_note??'')}</p>
        <p>These are retained inputs for this attempt, not a reconstruction from today’s document. Missing inputs may have expired, may not have been captured, or may be private to the person who submitted the request.</p>
        ${this.unavailable.map(message=>html`<p>${message}</p>`)}
        ${inspection.prompt?html`<h3>Retained prompt</h3><p>Submission status is recorded below. Retaining a prepared prompt alone does not prove it reached the provider.</p><pre>${inspection.prompt}</pre>`:html`<p>No exact prompt is available to this viewer.</p>`}
        ${this.details('Frozen document context and references',receipt.frozen_inputs,'Expand to inspect the original idea descriptions, relationships, versions, and reference evidence that were retained.')}
        ${this.details('Planner instructions and input',checkpoint.planner_input??privateInput.planner)}
        ${this.details('Prepared output plan',checkpoint.plan)}
        ${this.details('Retained request receipt',Object.keys(privateInput).length?privateInput:null,'Includes authorized retained request settings and original source evidence. It may contain private document content.')}
      </section>
      <section aria-labelledby="rejection-record"><h2 id="rejection-record">Request, timing, and usage</h2>
        <dl>${facts.map(([label,value])=>html`<div><dt>${label}</dt><dd>${value===undefined||value===null||value===''?'Not recorded':String(value)}</dd></div>`)}</dl>
        <p>A reservation is not a final charge. Recorded settled usage can include planning as well as output generation; an unsuccessful output does not imply zero usage. Missing usage is unknown, not zero.</p>
      </section>
      <section aria-labelledby="rejection-technical"><h2 id="rejection-technical">Technical evidence</h2>
        <p>These retained records are useful for tracing this exact attempt. They do not expose a provider’s internal moderation reasoning.</p>
        ${this.details('Structured error',receipt.technical_error)}
        ${this.details('Generation receipt',generation)}
        ${this.details('Request events',receipt.request_receipts)}
        ${this.details('Failure events',receipt.failures)}
        ${this.details('Planner response diagnostics',receipt.planner_response_diagnostics)}
        ${this.details('Retained execution checkpoint',receipt.artifact_checkpoint)}
        ${this.details('Individual attempt members',job.members.map(member=>({jobId:member.jobId,status:member.status,promptTechnique:member.promptTechnique,error:member.error})))}
      </section>
    </article>`;
  }
}
customElements.define('still-rejection-page',StillRejectionPage);
