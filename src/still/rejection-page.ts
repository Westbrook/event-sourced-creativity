import { generationOutcome } from './generation-outcome.ts';
import {LitElement, html, nothing} from 'lit';
import type {StillClient} from './client.ts';
import {rejectionEvidence, failureSummary, compareRejectionEvidence, evidenceAnchor, evidenceSourceLink, type RejectionEvidence} from './rejection-evidence.ts';
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
  static properties={client:{attribute:false},scope:{type:String},inspection:{state:true},error:{state:true},loading:{state:true},copyStatus:{state:true},evidence:{state:true},comparison:{state:true},compareError:{state:true},comparing:{state:true}};
  declare client:StillClient;
  scope='';
  private inspection?:GenerationInputInspection;
  private job?:DocumentJob;
  private unavailable:string[]=[];
  private error='';
  private loading=true;
  private ticket=0;
  private copyStatus='';
  private evidence?:RejectionEvidence;
  private comparison?:{job:DocumentJob;evidence:RejectionEvidence};
  private compareError='';
  private comparing=false;
  private comparisonTicket=0;
  private expiryTimer?:ReturnType<typeof setTimeout>;
  private comparisonId='';
  private authorizationCheck?:()=>void;
  override createRenderRoot(){return this;}
  override updated(changed:Map<string,unknown>){if(changed.has('scope')||changed.has('client'))void this.load();}
  override disconnectedCallback(){++this.ticket;this.clearPrivate();this.replaceChildren();super.disconnectedCallback();}
  override willUpdate(changed:Map<string,unknown>){if(changed.has('scope')||changed.has('client'))this.clearPrivate();}
  private clearPrivate(){
    clearTimeout(this.expiryTimer);++this.comparisonTicket;
    this.inspection=undefined;this.job=undefined;this.evidence=undefined;this.comparison=undefined;
    this.compareError='';this.comparing=false;this.comparisonId='';this.copyStatus='';
  }
  private expireAtDeadline(){
    clearTimeout(this.expiryTimer);
    const deadlines=[...(this.evidence?.sources??[]),...(this.comparison?.evidence.sources??[])]
      .filter(s=>s.status==='retained'&&s.expiresAt).map(s=>Date.parse(s.expiresAt!)).filter(n=>n>Date.now());
    if(deadlines.length)this.expiryTimer=setTimeout(()=>void this.load(),Math.min(Math.min(...deadlines)-Date.now()+1,2_147_483_647));
  }
  private async compare(){
    const job=this.job,id=this.comparisonId.trim(),ticket=++this.comparisonTicket,loadTicket=this.ticket,client=this.client;
    this.comparison=undefined;this.compareError='';
    if(!job||!id||id===job.jobId){this.compareError='Enter a different original attempt ID from this document.';return;}
    this.comparing=true;
    const guard=client.fence();
    const current=()=>this.isConnected&&client===this.client&&ticket===this.comparisonTicket&&loadTicket===this.ticket
      &&client.position.view==='rejection'&&client.position.outputId===job.jobId&&client.position.documentId===job.documentId;
    try{
      const read=await client.inspectGeneration(id,job.documentId,job.jobId);
      if(!current())return;
      const inspection=documentGenerationInputInspection({...read.job,members:read.job.members??[]},[],read.content);
      this.comparison={job:read.job,evidence:rejectionEvidence(read,inspection)};this.expireAtDeadline();
    }catch{if(current()){try{guard();this.compareError='This attempt is unavailable to your current session, expired, or belongs to another document.';}catch{this.clearPrivate();this.error='Your authorization changed. Reload details to check access again.';}}}
    finally{if(current())this.comparing=false;}
  }
  private async load(){
    const ticket=++this.ticket,scope=this.scope,client=this.client;
    const guard=client.fence();this.authorizationCheck=guard;
    const jobId=client.position.outputId,documentId=client.position.documentId;
    const current=()=>{guard();return this.isConnected&&client===this.client&&ticket===this.ticket&&scope===this.scope&&client.position.view==='rejection'&&client.position.outputId===jobId&&client.position.documentId===documentId;};
    this.clearPrivate();this.unavailable=[];this.error='';this.loading=true;
    try{
      const result=await client.inspectGeneration(jobId,documentId);
      if(!current())return;
      if(!['failed','partial'].includes(result.job.status))throw new Error('This attempt has no recorded failure. View its output page for the current status.');
      this.job=result.job;this.unavailable=result.unavailable;
      this.inspection=documentGenerationInputInspection({...result.job,members:result.job.members??[]},[],result.content);
      this.evidence=rejectionEvidence(result,this.inspection);this.expireAtDeadline();
      const comparisonId=new URL(location.href).searchParams.get('compareAttempt');
      if(comparisonId){this.comparisonId=comparisonId;void this.compare();}
    }catch(error){
      if(ticket===this.ticket&&this.isConnected){this.inspection=undefined;this.job=undefined;this.error=error instanceof Error?error.message:'Inspection unavailable.';}
    }finally{if(ticket===this.ticket){this.loading=false;}}
  }
  private async copyEvidence(label:string,text:string){
    const ticket=this.ticket,scope=this.scope;
    try{
      this.authorizationCheck?.();
      if([...(this.evidence?.sources??[]),...(this.comparison?.evidence.sources??[])].some(source=>source.status==='retained'&&source.expiresAt&&Date.parse(source.expiresAt)<=Date.now())){void this.load();return;}
      if(!this.isConnected||!this.inspection||this.client.position.view!=='rejection'||this.client.position.outputId!==this.job?.jobId)return;
      await navigator.clipboard.writeText(text);
      if(this.isConnected&&ticket===this.ticket&&scope===this.scope)this.copyStatus=`${label} copied to clipboard.`;
    }catch{
      if(this.isConnected&&ticket===this.ticket&&scope===this.scope)this.copyStatus='Clipboard access was unavailable. Select the evidence text and copy it manually.';
    }
  }
  private copyControl(label:string,text:string,caption='Copy to clipboard'){
    return html`<en-button class="rejection-copy" variant="secondary" size="small" aria-label=${`Copy ${label} to clipboard`} @click=${()=>this.copyEvidence(label,text)}>${this.copyStatus===`${label} copied to clipboard.`?'Copied':caption}</en-button>`;
  }
  private details(title:string,value:unknown,note?:string){
    if(value===null||value===undefined||Array.isArray(value)&&!value.length)return nothing;
    return html`<details><summary>${title}</summary><div class="rejection-evidence-tools">${this.copyControl(title,pretty(value))}</div>${note?html`<p>${note}</p>`:nothing}<pre>${pretty(value)}</pre></details>`;
  }
  private sourceDetails(job:DocumentJob,evidence:RejectionEvidence){
    return html`${evidence.sources.map(source=>html`<details id=${evidenceAnchor(job.jobId,source.id)}><summary>${source.label}: ${source.status.replaceAll('_',' ')}</summary>
      <p>Attempt ${job.jobId} · source ${source.id}. Retention ends: ${source.expiresAt??'Not recorded for this source'}.</p>
      <a href=${evidenceSourceLink(location.href,this.job!.jobId,job.jobId,source.id)}>Link to this immutable source</a>
      ${source.status==='retained'?html`<pre>${typeof source.value==='string'?source.value:pretty(source.value)}</pre>`:html`<p>Private bytes are not available here. Surviving accounting metadata does not restore them.</p>`}
    </details>`)}`;
  }
  override render(){
    const job=this.job,inspection=this.inspection,evidence=this.evidence;
    if(this.loading)return html`<section class="rejection-page"><h1>Generation details</h1><p role="status">Loading this attempt’s saved details…</p></section>`;
    if(!job||!inspection||!evidence)return html`<section class="rejection-page"><h1>Inspect generation failure</h1><p role="status">${this.error}</p><en-button variant="secondary" @click=${()=>this.load()}>Reload details</en-button></section>`;
    const receipt=inspection.receipt,generation=record(receipt.generation_receipt),failure=documentJobFailure(job),checkpoint=record(receipt.artifact_checkpoint),privateInput=record(receipt.private_input);
    const preflight=failure?.code==='safety_preflight_flagged';
    const facts:[string,unknown][]=[
      ['Attempt',job.jobId],['Document',job.documentId],['Status',job.status],['Failure code',failure?.code],['Category',failure?.category],
      ['Pipeline origin',evidence.pipelineStage],['Corrective scope',evidence.correctiveScope],['Provider moderation stage',evidence.moderationStage],['Failure kind',evidence.failureKind],['Legacy failure-stage field (verbatim)',generation.failure_stage],['Legacy receipt provider',generation.provider],['Legacy receipt model',generation.model],
      ['Failure request ID (this failure only)',failure?.requestId],['Planner response ID',checkpoint.planner_response_id],['HTTP status',failure?.httpStatus],
      ['Request status',generation.provider_request_status],['Source transmission',generation.source_transmission_status],
      ['Recorded provider calls',generation.actual_provider_call_count],['Reserved allowance',money(generation.reservation_microusd)],
      ['Recorded settled usage',money(generation.settled_cost_microusd)],['Reservation status',generation.reservation_status],
      ['Requested',time(job.requestedAt)],['Started',time(job.startedAt)],['Finished',time(job.completedAt)],
      ['Queue time',duration(job.requestedAt,job.startedAt)],['Execution time',duration(job.startedAt,job.completedAt)],
      ['Source revision',job.documentRevision],['Attempt count',job.attemptCount],['Input retention ends',generation.private_input_expires_at],
    ];
    const outcome=generationOutcome(job);
    const message=failure?.message||job.error||'No rejection message was retained.';
    const requestDetails=Object.fromEntries(facts.map(([label,value])=>[label,value??'Not recorded']));
    const bundle=pretty({attempt:job.jobId,document:job.documentId,rejection:message,prompt:inspection.prompt??null,requestDetails,receipt,evidence,unavailable:this.unavailable});
    return html`<article class="rejection-page">
      <style>
        .rejection-page form { display:flex; flex-wrap:wrap; align-items:center; gap:.75rem; }
        .rejection-page form label { flex-basis:100%; }
        .rejection-page form input { min-width:0; width:min(100%,28rem); box-sizing:border-box; }
        .rejection-page form input,.rejection-page form button { padding:.75rem; font:inherit; color:var(--en-color-text); background:var(--en-color-surface); border:1px solid var(--en-color-line); border-radius:var(--en-radius-control); }
        .rejection-page :focus-visible { outline:2px solid currentColor; outline-offset:4px; }
        .rejection-page details[id] { scroll-margin-top:2rem; }
      </style>
      <span class="eyebrow">${this.client.projection.documentTitle} · ${inspection.subtitle}</span>
      <h1>${outcome.title}</h1><p>${outcome.summary}</p>${outcome.facts.map(fact=>html`<p>${fact}</p>`)}<p>${outcome.next}</p>${!evidence.sources.some(source=>source.status==='retained')?html`<p>Original prompt and source evidence are unavailable to this viewer. They may have expired or were never retained. The recorded status and usage above remain separate facts.</p>`:nothing}<div class="rejection-export">${this.copyControl('Support summary',outcome.supportSummary,'Copy support summary')}<span>Attempt identifiers and recorded status only; no prompt or source content.</span></div>
      <p role="status" aria-live="polite">${this.copyStatus}</p>
      <details><summary>Technical details and retained evidence</summary><p class="rejection-lead">${preflight?'Still stopped this request for a safety review before the next submission.':'This attempt did not finish successfully. Read its recorded outcome before deciding whether to make a new request.'}</p>
      <p>${failureSummary(evidence)}</p>
      <dl aria-label="Failure classification"><div><dt>Pipeline origin</dt><dd>${evidence.pipelineStage}</dd></div><div><dt>Corrective scope</dt><dd>${evidence.correctiveScope}</dd></div><div><dt>Provider moderation stage</dt><dd>${evidence.moderationStage}</dd></div></dl>
      <div class="rejection-export">${this.copyControl('Complete evidence',bundle,'Copy all evidence')}<span>Includes the retained prompt, request details, and technical records below.</span></div>
      <section aria-labelledby="rejection-reason"><div class="rejection-section-heading"><h2 id="rejection-reason">What was reported</h2>${this.copyControl('Rejection message',message)}</div>
        <blockquote><span class="rejection-quote-label">Recorded message</span>${message}</blockquote>
        ${failure?.category==='safety'?html`<p>${preflight?'This is Still’s preflight assessment, not a confirmation that the output provider rejected the request. Only the existing exact-prompt-and-reference acknowledgement, when offered on the output page, applies. It does not waive a provider refusal.':'The recorded message is the provider or application’s explanation. A generic safety rejection does not identify which word, idea, or reference caused it. Still cannot infer an undisclosed reason from the document title or subject.'}</p>
        ${failure?.riskCategories?.length?html`<p>Recorded risk categories: ${failure.riskCategories.join(', ')}. These are assessment signals, not proof that every listed item caused the rejection.</p>`:html`<p>No specific risk category was recorded.</p>`}`:nothing}
      </section>
      ${failure?.category==='safety'||failure?.action==='edit_request'?html`<section aria-labelledby="rejection-next"><h2 id="rejection-next">Deciding what to do next</h2>
        <p>Review the original prompt, source ideas, and references below. Compare them with what you intended to ask for. If they contain an unintended instruction, ambiguity, or incorrect detail, revise the document before generating again. Add idea and Add direction update the document used by a new request; they do not change this attempt’s retained evidence.</p>
        <p><strong>New paid attempt</strong> starts a separate paid request in the original output format using the current document. Unchanged inputs may be rejected again, and planning or other provider work can still incur costs without producing an output. It does not resume this attempt or bypass provider safeguards.</p>
        <p>View attempt status returns to this attempt’s status; a rejected attempt may have no output. Choose output lets you consider a different format. Original-request recovery, when offered on the output page, is a separate action using the existing bounded status/result checks for the original provider purchase. Viewing or comparing evidence performs no recovery, reconciliation or generation. A provider refusal cannot be acknowledged away.</p>
      </section>
      `:nothing}<section aria-labelledby="rejection-outcomes"><h2 id="rejection-outcomes">Stage outcomes and operation identity</h2>
        <p>Request scope describes where a correction may apply; it does not identify where the failure originated. Each observation below keeps its own provider request and response IDs. Draft, preview and final labels do not establish a model.</p>
        <p>A local moderation pass describes that check only. Local policy opinions and attached text scores are not provider approval of an image or other media. Missing historical models, settings and categories remain unknown.</p>
        ${this.details('Recorded overall outcome',evidence.outcome)}
        ${evidence.stages.length?evidence.stages.map(stage=>html`<details><summary>${stage.outcome.pipelineStage} · ${stage.phase} · ${stage.operation.provider} / ${stage.operation.effectiveModel??'Unknown model'}</summary>
          <dl>${Object.entries({'Evidence ID':stage.evidenceId,'Captured':stage.capturedAt,'Endpoint':stage.operation.endpoint,'Requested alias':stage.operation.requestedAlias,'Selected model':stage.operation.effectiveModel,'Returned model':stage.operation.returnedModel,'Requested quality':stage.operation.requestedQuality,'Routing policy':stage.operation.routingPolicyVersion,'Override':stage.operation.overrideProvenance,'Provider request ID':stage.operation.requestId,'Provider response ID':stage.operation.responseId,'Dispatch':stage.outcome.dispatchState,'Content':stage.outcome.contentOutcome,'Accounting':stage.outcome.accountingState,'Provider moderation stage':stage.outcome.providerModerationStage}).map(([key,value])=>html`<div><dt>${key}</dt><dd>${value??'Unknown / not recorded'}</dd></div>`)}</dl>
          <p>Request envelope: ${stage.requestBody===undefined?'Not recorded':'Retained'}. Response envelope: ${stage.responseBody===undefined?'Not recorded':'Retained'}.</p><h3>Recorded request settings</h3><p>Submission is described by this operation’s dispatch state; prepared settings alone do not prove submission.</p><pre>${pretty(stage.operation.settings)}</pre>
          ${stage.safety?html`<h3>Safety assessment (this operation only)</h3><pre>${pretty(stage.safety)}</pre>`:nothing}
          <a href=${`#${evidenceAnchor(job.jobId,`${stage.evidenceId}:${stage.phase}`)}`}>Retained immutable observation</a>
        </details>`):html`<p>No authorized per-operation envelopes are available. The legacy receipt below is not evidence of a complete pipeline.</p>`}
      </section>
      <section aria-labelledby="rejection-availability"><h2 id="rejection-availability">Evidence availability</h2>
        <p>Each source has its own custody and retention. A retained prompt does not imply that a response envelope or source snapshot is available. “Unavailable” does not establish whether a source expired or was never captured.</p>
        ${this.sourceDetails(job,evidence)}
      </section>
      <section aria-labelledby="rejection-comparison"><h2 id="rejection-comparison">Compare retained attempts</h2>
        <p>Read-only comparison with another original attempt from this document. Both reads require the existing owner authorization and retention checks. Reference comparison covers retained descriptors and hashes; unavailable source bytes cannot be reconstructed. “Same” compares only recorded values; missing fields remain unknown. Nothing is submitted to a provider.</p>
        <form @submit=${(event:SubmitEvent)=>{event.preventDefault();void this.compare();}}>
          <label for="comparison-attempt">Other original attempt ID</label>
          <input id="comparison-attempt" name="attempt" autocomplete="off" .value=${this.comparisonId} @input=${(event:Event)=>{this.comparisonId=(event.target as HTMLInputElement).value;++this.comparisonTicket;this.comparison=undefined;this.comparing=false;}}>
          <button type="submit" ?disabled=${this.comparing}>${this.comparing?'Reading retained evidence…':'Compare evidence'}</button>
        </form><p role="status">${this.compareError}</p>
        ${this.comparison?html`<p>Original ${job.jobId} → comparison ${this.comparison.job.jobId}. Changes to model, quality or route appear together below; this is not an isolated model experiment or a causal explanation.</p>
          ${compareRejectionEvidence(evidence,this.comparison.evidence).map(row=>html`<details><summary>${row.field}: ${row.status}</summary><h3>Original attempt</h3><pre>${pretty(row.before)}</pre><h3>Comparison attempt</h3><pre>${pretty(row.after)}</pre>${row.status==='unknown'?html`<p>Missing evidence prevents an exact comparison. Null is unknown, not an empty prompt or default configuration.</p>`:nothing}</details>`)}
          <h3>Comparison immutable sources</h3>${this.sourceDetails(this.comparison.job,this.comparison.evidence)}`:nothing}
      </section>
      <section aria-labelledby="rejection-inputs"><h2 id="rejection-inputs">Original inputs</h2>
        <p>${String(receipt.retention_note??'')}</p>
        <p>These are retained inputs for this attempt, not a reconstruction from today’s document. Missing inputs may have expired, may not have been captured, or may be private to the person who submitted the request.</p>
        ${this.unavailable.map(message=>html`<p>${message}</p>`)}
        ${inspection.prompt?html`<div class="rejection-section-heading"><h3>Retained prompt</h3>${this.copyControl('Retained prompt',inspection.prompt)}</div><p>Submission status is recorded below. Retaining a prepared prompt alone does not prove it reached the provider.</p><pre>${inspection.prompt}</pre>`:html`<p>No exact prompt is available to this viewer.</p>`}
        ${this.details('Frozen document context and references',receipt.frozen_inputs,'Expand to inspect the original idea descriptions, relationships, versions, and reference evidence that were retained.')}
        ${this.details('Planner instructions and input',checkpoint.planner_input??privateInput.planner)}
        ${this.details('Prepared output plan',checkpoint.plan)}
        ${this.details('Retained request receipt',Object.keys(privateInput).length?privateInput:null,'Includes authorized retained request settings and original source evidence. It may contain private document content.')}
      </section>
      <section aria-labelledby="rejection-record"><div class="rejection-section-heading"><h2 id="rejection-record">Request, timing, and usage</h2>${this.copyControl('Request details',pretty(requestDetails))}</div>
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
    </details></article>`;
  }
}
customElements.define('still-rejection-page',StillRejectionPage);
