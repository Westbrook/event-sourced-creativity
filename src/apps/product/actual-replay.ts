import { html, nothing } from "lit";
import { ensureModalDialog } from "../../components/modal-dialog";
import { FormaPresentationalElement } from "../../components/presentational-element";
import { consumeRoutePrefetch } from "../../state/session-bootstrap";

type ReplayPersona={personaId:string;displayName:string;status:string;route:string;eventCount:number};
type ReplaySession={sessionId:string;status:string;title:string;summary:string;eventCount:number;imageCount:number;createdAt:string;error:string|null;persona:ReplayPersona|null;usage:Record<string,unknown>};
type ReplayEstimate={authorizationMicrousd:number;estimatedMicrousd:number;operations:number;profile?:{targetEventCount:number;imageCount:number;milestoneCount:number}};
type ReplayConfiguration={enabled:boolean;configured:boolean;approvalPhrase:string;confirmationVersion:string;cost?:{estimate:ReplayEstimate;fitsReplayStructure:boolean;fitsWorkspace:boolean;requiresUserOverride:boolean}};
const dollars=(microusd:number)=>new Intl.NumberFormat(undefined,{style:"currency",currency:"USD"}).format(microusd/1_000_000);
const PERSONA_CONFIRMATION_PHRASE="I understand, continue";

/** Owner-isolated administrator tooling for previously approved fixtures and explicitly approved paid rehearsals. */
export class FormaActualReplay extends FormaPresentationalElement {
  #sessions:ReplaySession[]=[];
  #configuration?:ReplayConfiguration;
  #issue="";
  #busy=false;
  #seed="";
  #eventCount=1000;
  #providerCoverage="automatic";
  #studyTypes:string[]=[];
  #experienceProfile="";
  #trustedApproval=false;
  #pendingPersona?:ReplayPersona;
  #trustedPersonaApproval=false;
  #personaSubmitting=false;
  #events:Array<{sequence:number;type:string}>=[];

  override connectedCallback(){super.connectedCallback();void this.#load();}

  async #load(){
    try{const prefetched=consumeRoutePrefetch("/api/replay-sessions");const response=(prefetched?await prefetched:null)??await fetch("/api/replay-sessions",{credentials:"same-origin"});const body=await response.json() as {sessions?:ReplaySession[];liveGeneration?:ReplayConfiguration;error?:string};if(!response.ok)throw new Error(body.error??"replay_unavailable");this.#sessions=body.sessions??[];this.#configuration=body.liveGeneration;this.#issue="";}catch(error){this.#issue=error instanceof Error?error.message:"replay_unavailable";}this.requestUpdate();
  }

  async #estimate(){
    try{const response=await fetch("/api/replay-sessions/estimate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({seed:this.#seed,eventCount:this.#eventCount,providerCoverage:this.#providerCoverage,studyTypes:this.#studyTypes,...(this.#experienceProfile?{experienceProfile:this.#experienceProfile}:{})})});const body=await response.json() as {cost?:ReplayConfiguration["cost"];error?:string};if(!response.ok||!body.cost)throw new Error(body.error??"estimate_unavailable");if(this.#configuration)this.#configuration={...this.#configuration,cost:body.cost};this.#issue="";}catch(error){this.#issue=error instanceof Error?error.message:"estimate_unavailable";}this.requestUpdate();
  }

  async #inspect(session:ReplaySession){
    try{const response=await fetch(`/api/replay-sessions/${encodeURIComponent(session.sessionId)}?cursor=0&limit=40`);const body=await response.json() as {events?:Array<{sequence:number;type:string}>;error?:string};if(!response.ok)throw new Error(body.error??"replay_unavailable");this.#events=(body.events??[]).map(({sequence,type})=>({sequence,type}));this.#issue="";}catch(error){this.#issue=error instanceof Error?error.message:"replay_unavailable";}this.requestUpdate();
  }

  async #preparePersona(session:ReplaySession){
    const response=await fetch(`/api/replay-sessions/${encodeURIComponent(session.sessionId)}/persona`,{method:"POST"});if(!response.ok){const body=await response.json() as {message?:string;error?:string};this.#issue=body.message??body.error??"persona_unavailable";this.requestUpdate();return;}await this.#load();
  }

  async #requestPersona(event:MouseEvent,persona:ReplayPersona){
    if(!event.isTrusted){this.#issue=this.i18n.t("replay.actual.trusted","A direct human action is required.");this.requestUpdate();return;}
    this.#pendingPersona=persona;this.#trustedPersonaApproval=false;this.requestUpdate();await this.updateComplete;
    const dialog=this.querySelector<HTMLDialogElement>(".actual-persona-confirmation");ensureModalDialog(dialog);dialog?.querySelector<HTMLInputElement>("input[name=confirmation]")?.focus();
  }

  #dismissPersona(){
    this.querySelector<HTMLDialogElement>(".actual-persona-confirmation")?.close();this.#pendingPersona=undefined;this.#trustedPersonaApproval=false;this.#personaSubmitting=false;this.requestUpdate();
  }

  async #confirmPersona(event:SubmitEvent){
    event.preventDefault();const trusted=this.#trustedPersonaApproval;this.#trustedPersonaApproval=false;const persona=this.#pendingPersona;
    if(!persona||this.#personaSubmitting||!event.isTrusted||!trusted||navigator.userActivation&&!navigator.userActivation.isActive){this.#issue=this.i18n.t("replay.actual.trusted","A direct human action is required.");this.requestUpdate();return;}
    const values=new FormData(event.currentTarget as HTMLFormElement);const confirmation=String(values.get("confirmation")??"");
    if(confirmation!==PERSONA_CONFIRMATION_PHRASE||values.get("personaAcknowledged")!=="yes")return;
    this.#personaSubmitting=true;this.requestUpdate();
    try{
      const response=await fetch("/api/impersonation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({personaId:persona.personaId,confirmation})});
      const body=await response.json() as {route?:string;error?:string};if(!response.ok||!body.route)throw new Error(body.error??"persona_unavailable");this.#dismissPersona();location.assign(body.route);
    }catch(error){this.#personaSubmitting=false;this.#issue=error instanceof Error?error.message:"persona_unavailable";this.requestUpdate();}
  }

  async #retry(session:ReplaySession){
    try{
      const response=await fetch(`/api/replay-sessions/${encodeURIComponent(session.sessionId)}/retry`,{method:"POST"});
      const body=await response.json() as {retry?:{seed:string;eventCount:number;providerCoverage:string;studyTypes:string[];experienceProfile:string;releasedMicrousd:number;budgetSettled:boolean};error?:string};
      if(!response.ok||!body.retry||!body.retry.budgetSettled)throw new Error(body.error??"retry_budget_not_settled");
      this.#seed=body.retry.seed;this.#eventCount=body.retry.eventCount;this.#providerCoverage=body.retry.providerCoverage;this.#studyTypes=body.retry.studyTypes;this.#experienceProfile=body.retry.experienceProfile;
      await this.#estimate();this.#issue=this.i18n.t("replay.actual.retryPrepared","Previous reservation settled; the original settings are restored. A new provider run still requires explicit approval.")+` ${dollars(body.retry.releasedMicrousd)}`;
    }catch(error){this.#issue=error instanceof Error?error.message:"retry_failed";}this.requestUpdate();
  }

  async #archive(event:MouseEvent,session:ReplaySession){
    if(!event.isTrusted||!window.confirm(this.i18n.t("replay.actual.confirmArchive","Archive this failed session and permanently remove its unfinished generated media?")))return;
    const response=await fetch(`/api/replay-sessions/${encodeURIComponent(session.sessionId)}`,{method:"DELETE"});if(!response.ok){const body=await response.json() as {error?:string};this.#issue=body.error??"archive_failed";this.requestUpdate();return;}await this.#load();
  }

  async #approve(event:SubmitEvent){
    event.preventDefault();const trusted=this.#trustedApproval;this.#trustedApproval=false;
    if(!event.isTrusted||!trusted||navigator.userActivation&&!navigator.userActivation.isActive){this.#issue=this.i18n.t("replay.actual.trusted","A direct human action is required.");this.requestUpdate();return;}
    const configuration=this.#configuration,cost=configuration?.cost;if(this.#busy||!configuration||!cost)return;
    const values=new FormData(event.currentTarget as HTMLFormElement);const phrase=String(values.get("phrase")??"");const acknowledged=values.get("acknowledged")==="yes";const override=values.get("override")==="yes";
    if(phrase!==configuration.approvalPhrase||!acknowledged||!cost.fitsReplayStructure||!cost.fitsWorkspace||cost.requiresUserOverride&&!override)return;
    this.#busy=true;this.#issue=this.i18n.t("replay.actual.preparing","Recording your one-use, bounded approval…");this.requestUpdate();
    try{
      const approvalResponse=await fetch("/api/replay-sessions/approval",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phrase,costAcknowledged:true,directUserApproval:true,confirmationVersion:configuration.confirmationVersion,seed:this.#seed,eventCount:this.#eventCount,providerCoverage:this.#providerCoverage,studyTypes:this.#studyTypes,...(this.#experienceProfile?{experienceProfile:this.#experienceProfile}:{}),initiator:"direct-user",approvedMaximumMicrousd:cost.estimate.authorizationMicrousd,allowUserBudgetOverride:override})});
      const approval=await approvalResponse.json() as {approvalId?:string;error?:string};if(!approvalResponse.ok||!approval.approvalId)throw new Error(approval.error??"approval_failed");
      this.#issue=this.i18n.t("replay.actual.generating","Generating the explicitly approved replay. This can take several minutes.");this.requestUpdate();
      const response=await fetch("/api/replay-sessions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approvalId:approval.approvalId,directUserApproval:true,confirmationVersion:configuration.confirmationVersion,initiator:"direct-user"})});
      const result=await response.json() as {error?:string;session?:ReplaySession};if(!response.ok||!result.session)throw new Error(result.error??"generation_failed");await this.#load();this.#issue=this.i18n.t("replay.actual.complete","The approved replay is saved and can be reused without another provider call.");
    }catch(error){this.#issue=error instanceof Error?error.message:"generation_failed";await this.#load();}finally{this.#busy=false;this.requestUpdate();}
  }

  override render(){
    const configuration=this.#configuration,cost=configuration?.cost;
    return html`<section class="actual-replay page-pad" aria-labelledby="actual-replay-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("shell.product","Product & Quality")}</span><h1 id="actual-replay-heading">${this.i18n.t("replay.actual.heading","Approved replay sessions and personas")}</h1><p>${this.i18n.t("replay.actual.description","Administrator-only, owner-isolated historical provider fixtures. New paid work requires explicit direct human approval, an exact one-use quote, and enforced spending limits.")}</p></div><button class="button secondary" type="button" @click=${()=>this.#load()}>${this.i18n.t("role.refresh","Refresh evidence")}</button></header>
      ${this.#issue?html`<p role="status" aria-live="polite">${this.#issue}</p>`:nothing}
      <section aria-labelledby="actual-saved-heading"><h2 id="actual-saved-heading">${this.i18n.t("replay.actual.saved","Saved approved sessions")}</h2>${this.#sessions.length?html`<ol class="actual-replay-sessions">${this.#sessions.map((session)=>html`<li><article><header><h3 dir="auto">${session.title}</h3><span>${this.i18n.t(`replay.status.${session.status}`,session.status)}</span></header><p dir="auto">${session.summary}</p><p>${this.i18n.number(session.eventCount)} ${this.i18n.t("replay.actual.events","events")} · ${this.i18n.number(session.imageCount)} ${this.i18n.t("replay.actual.images","images")}${typeof session.usage.actualCostMicrousd==="number"?html` · ${dollars(session.usage.actualCostMicrousd)}`:nothing}</p>${session.error?html`<p role="note" dir="auto">${session.error}</p>`:nothing}<div class="actual-replay-actions"><button class="button secondary compact" type="button" @click=${()=>this.#inspect(session)}>${this.i18n.t("replay.actual.inspect","Inspect saved timeline")}</button>${session.status==="complete"&&session.persona?.status==="ready"?html`<button class="button secondary compact" type="button" @click=${(event:MouseEvent)=>this.#requestPersona(event,session.persona!)}>${this.i18n.t("replay.actual.openPersona","Enter fictional persona")} · ${session.persona.displayName}</button>`:session.status==="complete"?html`<button class="button secondary compact" type="button" @click=${()=>this.#preparePersona(session)}>${this.i18n.t("replay.actual.preparePersona","Prepare reusable persona")}</button>`:nothing}${session.status==="failed"?html`<button class="button secondary compact" type="button" @click=${()=>this.#retry(session)}>${this.i18n.t("replay.actual.retry","Prepare safe retry")}</button><button class="button ghost compact" type="button" @click=${(event:MouseEvent)=>this.#archive(event,session)}>${this.i18n.t("replay.actual.archive","Archive failed session")}</button>`:nothing}</div></article></li>`)}</ol>`:html`<p>${this.i18n.t("replay.actual.empty","No approved replay sessions are available.")}</p>`}</section>
      ${this.#events.length?html`<section aria-labelledby="actual-timeline-heading"><h2 id="actual-timeline-heading">${this.i18n.t("replay.actual.timeline","Saved owner-isolated timeline")}</h2><ol>${this.#events.map((event)=>html`<li>${this.i18n.number(event.sequence)} · <code>${event.type}</code></li>`)}</ol></section>`:nothing}
      ${configuration?.enabled&&configuration.configured&&cost?html`<section aria-labelledby="actual-new-heading"><h2 id="actual-new-heading">${this.i18n.t("replay.actual.new","Create an explicitly approved paid fixture")}</h2><form @submit=${(event:SubmitEvent)=>this.#approve(event)}><label>${this.i18n.t("replay.actual.seed","Optional fictional creative direction")}<textarea maxlength="1200" .value=${this.#seed} @input=${(event:InputEvent)=>{this.#seed=(event.target as HTMLTextAreaElement).value;}}></textarea></label><button class="button secondary" type="button" @click=${()=>this.#estimate()}>${this.i18n.t("replay.actual.refreshEstimate","Refresh exact estimate")}</button><p>${this.i18n.t("replay.actual.maximum","Maximum reserved provider cost")}: <strong>${dollars(cost.estimate.authorizationMicrousd)}</strong> · ${this.i18n.number(cost.estimate.operations)} ${this.i18n.t("replay.actual.providerOperations","maximum provider operations")}</p><label>${this.i18n.t("replay.actual.phrase","Type the explicit approval phrase")}<input name="phrase" required autocomplete="off" placeholder=${configuration.approvalPhrase}></label><label><input type="checkbox" name="acknowledged" value="yes" required> ${this.i18n.t("replay.actual.acknowledge","I authorize this exact one-use maximum and understand that real provider calls will occur.")}</label>${cost.requiresUserOverride?html`<label><input type="checkbox" name="override" value="yes" required> ${this.i18n.t("replay.actual.override","I approve the displayed one-run personal-budget exception.")}</label>`:nothing}<button class="button primary" type="submit" ?disabled=${this.#busy||!cost.fitsWorkspace||!cost.fitsReplayStructure} @click=${(event:MouseEvent)=>{this.#trustedApproval=event.isTrusted;}}>${this.#busy?this.i18n.t("replay.actual.working","Working…"):this.i18n.t("replay.actual.authorize","Approve and generate paid replay")}</button></form></section>`:nothing}
      ${this.#pendingPersona?html`<dialog class="modal actual-persona-confirmation" open aria-labelledby="actual-persona-confirmation-heading" @close=${()=>{this.#pendingPersona=undefined;this.#trustedPersonaApproval=false;this.requestUpdate();}}><form class="modal-card" @submit=${(event:SubmitEvent)=>this.#confirmPersona(event)}><h2 id="actual-persona-confirmation-heading">${this.i18n.t("replay.actual.personaTitle","Confirm fictional persona entry")}</h2><p>${this.i18n.t("replay.actual.personaWarning","You are about to enter an isolated fictional account. Changes made while impersonating this persona are written to that fictional account, and your principal administrative access will be suspended until you leave.")}</p><p><strong dir="auto">${this.#pendingPersona.displayName}</strong></p><label>${this.i18n.t("replay.actual.personaPhrase","Type the confirmation phrase exactly")}<input name="confirmation" required autocomplete="off" placeholder=${PERSONA_CONFIRMATION_PHRASE}></label><label><input type="checkbox" name="personaAcknowledged" value="yes" required> ${this.i18n.t("replay.actual.personaAcknowledge","I understand that this fictional persona has a separate account and that actions may modify its saved state.")}</label><footer><button class="button ghost" type="button" @click=${()=>this.#dismissPersona()}>${this.i18n.t("replay.actual.cancel","Cancel")}</button><button class="button primary" type="submit" ?disabled=${this.#personaSubmitting} @click=${(event:MouseEvent)=>{this.#trustedPersonaApproval=event.isTrusted;}}>${this.i18n.t("replay.actual.personaConfirm","Confirm and enter fictional persona")}</button></footer></form></dialog>`:nothing}
    </section>`;
  }
}

if(!customElements.get("forma-actual-replay"))customElements.define("forma-actual-replay",FormaActualReplay);
