import { html, nothing } from "lit";
import type { CommandDeparture } from "../../components/command-departure";
import { ensureModalDialog, requestDialogConfirmation } from "../../components/modal-dialog.ts";
import { captureOutputNavigationFocus } from "../../components/output-navigation-focus.ts";
import { FormaPresentationalElement } from "../../components/presentational-element";
import { consumeRoutePrefetch } from "../../state/session-bootstrap";
import { platformSession } from "../../platform/session-controller.ts";

type ReplayPersona={personaId:string;displayName:string;status:string;route:string;eventCount:number};
type ReplaySession={sessionId:string;status:string;title:string;summary:string;eventCount:number;imageCount:number;createdAt:string;error:string|null;persona:ReplayPersona|null;usage:Record<string,unknown>};
type ReplayEstimate={authorizationMicrousd:number;estimatedMicrousd:number;operations:number;profile?:{targetEventCount:number;imageCount:number;milestoneCount:number}};
type ReplayConfiguration={enabled:boolean;configured:boolean;approvalPhrase:string;confirmationVersion:string;cost?:{estimate:ReplayEstimate;fitsReplayStructure:boolean;fitsWorkspace:boolean;requiresUserOverride:boolean}};
type ArchiveConfirmation = { controller: AbortController; current: () => boolean; sent: boolean };
const dollars=(microusd:number)=>new Intl.NumberFormat(document.documentElement.lang||"en",{style:"currency",currency:"USD"}).format(microusd/1_000_000);
const PERSONA_CONFIRMATION_PHRASE="I understand, continue";

/** Owner-isolated administrator tooling for previously approved fixtures and explicitly approved paid rehearsals. */
export class FormaActualReplay extends FormaPresentationalElement {
  #sessions:ReplaySession[]=[];
  #configuration?:ReplayConfiguration;
  #issue="";
  #accessUnavailable=false;
  #busy: { current: () => boolean } | null = null;
  get #currentApprovalPending() { return this.#busy?.current() ?? false; }
  #seed="";
  #cleanSeed="";
  #eventCount=1000;
  #providerCoverage="automatic";
  #studyTypes:string[]=[];
  #experienceProfile="";
  #trustedApproval=false;
  #pendingPersona?:ReplayPersona;
  #personaOpening = 0;
  #trustedPersonaApproval=false;
  #personaSubmitting=false;
  #events:Array<{sequence:number;type:string}>=[];
  #loadRevision = 0;
  #deniedReadRevision = 0;
  #certifiedListRevision = 0;
  #certifiedTimeline = { sessionId: "", revision: 0 };
  #privateEpoch = 0;
  #loadedScope = "";
  #resourceRoute = "";
  #archiveConfirmation: ArchiveConfirmation | null = null;
  #unsubscribeConfirmation?: () => void;
  #retireConfirmation = () => { this.#archiveConfirmation?.controller.abort(); };
  #retireCallbacks = () => {
    this.#retireConfirmation(); this.#privateEpoch += 1;
    this.#deniedReadRevision = ++this.#loadRevision;
    this.#dismissPersona();
  };
  #resourceChanged = () => {
    const route = location.pathname + location.search;
    if (route === this.#resourceRoute) return;
    this.#resourceRoute = route;
    this.#retireCallbacks();
  };
  #sessionChanged = () => {
    const changed = this.#loadedScope && this.#loadedScope !== this.#scope();
    this.#retireCallbacks();
    if (changed) { this.#clearPrivateReadState(); this.#issue = ""; this.#accessUnavailable = false; this.requestUpdate(); }
  };

  captureCommandDeparture(): Omit<CommandDeparture, "element"> & { readonly element: HTMLElement } {
    const epoch = this.#privateEpoch, scope = this.#scope(), session = platformSession.get();
    let retired = false;
    const current = () => {
      if (retired) return false;
      if (!this.isConnected || epoch !== this.#privateEpoch || scope !== this.#scope()
        || session !== platformSession.get()) retired = true;
      return !retired;
    };
    return { element: this, current,
      blocked: () => Boolean(this.#currentApprovalPending || scope && this.#loadedScope === scope && !this.#accessUnavailable
        && (this.#seed !== this.#cleanSeed
          || [...this.querySelectorAll<HTMLInputElement>('input[name="phrase"],input[name="acknowledged"],input[name="override"]')]
            .some(field => field.isConnected && (field.getAttribute("type") === "checkbox" ? field.checked : field.value !== "")))),
      reason: () => "next.lifecycle.currentWorkOpen" };
  }

  #clearPrivateReadState() {
    this.#loadedScope = ""; this.#sessions = []; this.#events = []; this.#configuration = undefined;
    this.#seed = ""; this.#cleanSeed = ""; this.#eventCount = 1000; this.#providerCoverage = "automatic";
    this.#studyTypes = []; this.#experienceProfile = ""; this.#trustedApproval = false;
    this.#dismissPersona();
  }

  #knownReadDenial(response: Response, revision: number, scope: string, certifiedRevision = 0) {
    if (response.status !== 401 && response.status !== 403) return false;
    if (this.isConnected && scope && scope === this.#scope()
      && revision > this.#deniedReadRevision && revision >= certifiedRevision) {
      // Only a completed newer proof for this same resource can fence an old
      // refusal. An accepted refusal retires every read already issued.
      this.#deniedReadRevision = this.#loadRevision; this.#privateEpoch += 1;
      this.#retireConfirmation(); this.#clearPrivateReadState();
      this.#issue = ""; this.#accessUnavailable = true; this.requestUpdate();
    }
    return true;
  }

  #readOwner(resource: "list" | "timeline" | "estimate", sessionId = "") {
    const revision = ++this.#loadRevision, scope = this.#scope();
    const current = () => this.isConnected && Boolean(scope) && scope === this.#scope()
      && revision > this.#deniedReadRevision && revision === this.#loadRevision;
    const certified = () => resource === "list" ? this.#certifiedListRevision
      : resource === "timeline" && this.#certifiedTimeline.sessionId === sessionId ? this.#certifiedTimeline.revision : 0;
    return { revision, scope, current,
      denied: (response: Response) => this.#knownReadDenial(response, revision, scope, certified()),
      certify: () => {
        if (!current()) return false;
        if (resource === "list") this.#certifiedListRevision = revision;
        else if (resource === "timeline") this.#certifiedTimeline = { sessionId, revision };
        return resource !== "estimate";
      } };
  }

  #privateOwner() {
    const scope = this.#scope(), epoch = this.#privateEpoch, revision = this.#loadRevision;
    const current = () => this.isConnected && Boolean(scope) && scope === this.#scope() && epoch === this.#privateEpoch;
    return { scope, current, denied: (response: Response) => {
      if (!current()) return true;
      return this.#knownReadDenial(response, revision, scope);
    } };
  }

  #input() {
    return { seed: this.#seed, eventCount: this.#eventCount, providerCoverage: this.#providerCoverage,
      studyTypes: [...this.#studyTypes], ...(this.#experienceProfile ? { experienceProfile: this.#experienceProfile } : {}) };
  }

  override connectedCallback(){
    this.#resourceRoute = location.pathname + location.search;
    super.connectedCallback();
    this.#unsubscribeConfirmation = platformSession.subscribe(this.#sessionChanged);
    window.addEventListener("popstate", this.#resourceChanged);
    window.addEventListener("hashchange", this.#resourceChanged);
    window.addEventListener("pagehide", this.#retireCallbacks);
    void this.#load();
  }
  override disconnectedCallback(){
    this.#retireCallbacks(); this.#clearPrivateReadState();
    this.#accessUnavailable = false;
    this.#unsubscribeConfirmation?.(); this.#unsubscribeConfirmation = undefined;
    window.removeEventListener("popstate", this.#resourceChanged);
    window.removeEventListener("hashchange", this.#resourceChanged);
    window.removeEventListener("pagehide", this.#retireCallbacks);
    super.disconnectedCallback();
  }
  #scope(){
    const session = platformSession.get();
    return session ? JSON.stringify([session.user.userId, session.user.role, session.audience,
      // Same-resource fragments move focus; they do not replace private work.
      // Each opening still owns its existing interruption-aware focus lease.
      session.permissionEpoch, [...session.capabilities].sort(), location.pathname, location.search]) : "";
  }

  async #load(confirmation?: ArchiveConfirmation | null){
    if (this.#archiveConfirmation !== confirmation) this.#retireConfirmation();
    const read = this.#readOwner("list"), current = () => read.current() && (!confirmation || confirmation.current());
    try {
      const prefetched = consumeRoutePrefetch("/api/replay-sessions");
      const response = (prefetched ? await prefetched : null) ?? await fetch("/api/replay-sessions", { credentials: "same-origin" });
      if (read.denied(response) || !current()) return;
      const body = await response.json() as { sessions?: ReplaySession[]; liveGeneration?: ReplayConfiguration; error?: string };
      if (!current()) return;
      if (!response.ok || !Array.isArray(body.sessions) || body.sessions.some(row => !row
        || typeof row.sessionId !== "string" || !row.sessionId || typeof row.status !== "string"
        || typeof row.title !== "string" || typeof row.summary !== "string")) throw new Error(body.error ?? "replay_unavailable");
      if (!read.certify()) return;
      this.#sessions = body.sessions; this.#configuration = body.liveGeneration;
      this.#loadedScope = read.scope; this.#issue = ""; this.#accessUnavailable = false;
      if (this.#pendingPersona && !this.#sessions.some(row => row.persona === this.#pendingPersona)) this.#dismissPersona();
    } catch (error) { if (current()) this.#issue = error instanceof Error ? error.message : "replay_unavailable"; }
    finally { if (current()) this.requestUpdate(); }
  }

  async #estimate(){
    const configuration = this.#configuration, input = this.#input(), signature = JSON.stringify(input);
    if (!configuration || this.#loadedScope !== this.#scope()) return;
    const read = this.#readOwner("estimate"), owner = this.#privateOwner();
    const current = () => read.current() && owner.current() && this.#configuration === configuration && JSON.stringify(this.#input()) === signature;
    try {
      const response = await fetch("/api/replay-sessions/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      if (read.denied(response) || !current()) return;
      const body = await response.json() as { cost?: ReplayConfiguration["cost"]; error?: string };
      if (!current()) return;
      if (!response.ok || !body.cost) throw new Error(body.error ?? "estimate_unavailable");
      this.#configuration = { ...configuration, cost: body.cost }; this.#issue = "";
    } catch (error) { if (current()) this.#issue = error instanceof Error ? error.message : "estimate_unavailable"; }
    finally { if (owner.current()) this.requestUpdate(); }
  }

  async #inspect(session:ReplaySession){
    if (this.#loadedScope !== this.#scope() || !this.#sessions.includes(session)) return;
    const sessionId = session.sessionId, read = this.#readOwner("timeline", sessionId);
    try {
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(sessionId)}?cursor=0&limit=40`);
      if (read.denied(response) || !read.current()) return;
      const body = await response.json() as { events?: Array<{ sequence: number; type: string }>; error?: string };
      if (!read.current()) return;
      if (!response.ok || !Array.isArray(body.events) || body.events.some(row => !row
        || !Number.isInteger(row.sequence) || row.sequence < 1 || typeof row.type !== "string")) throw new Error(body.error ?? "replay_unavailable");
      const events = body.events.map(({ sequence, type }) => ({ sequence, type }));
      if (!read.certify()) return;
      this.#events = events; this.#issue = "";
    } catch (error) { if (read.current()) this.#issue = error instanceof Error ? error.message : "replay_unavailable"; }
    finally { if (read.current()) this.requestUpdate(); }
  }

  async #preparePersona(session:ReplaySession){
    const owner = this.#privateOwner(), source = JSON.stringify(session);
    const current = () => owner.current() && this.#loadedScope === owner.scope
      && this.#sessions.includes(session) && session.status === "complete" && JSON.stringify(session) === source;
    if (!current()) return;
    try {
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(session.sessionId)}/persona`, { method: "POST" });
      if (owner.denied(response) || !current()) return;
      if (!response.ok) {
        const body = await response.json() as { message?: string; error?: string };
        if (current()) { this.#issue = body.message ?? body.error ?? "persona_unavailable"; this.requestUpdate(); }
        return;
      }
      if (current()) await this.#load();
    } catch (error) { if (current()) { this.#issue = error instanceof Error ? error.message : "persona_unavailable"; this.requestUpdate(); } }
  }

  async #requestPersona(event:MouseEvent,persona:ReplayPersona){
    if(!event.isTrusted){this.#issue=this.i18n.t("replay.actual.trusted","A direct human action is required.");this.requestUpdate();return;}
    const owner = this.#privateOwner(), source = JSON.stringify(persona);
    const current = () => owner.current() && this.#loadedScope === owner.scope && persona.status === "ready"
      && this.#sessions.some(row => row.status === "complete" && row.persona === persona) && JSON.stringify(persona) === source;
    if (this.#personaSubmitting || !current()) return;
    const focus = captureOutputNavigationFocus(document), opening = ++this.#personaOpening;
    const ownsPresentation = () => this.#pendingPersona === persona && this.#personaOpening === opening;
    this.#pendingPersona=persona;this.#trustedPersonaApproval=false;this.requestUpdate();
    try {
      await this.updateComplete;
      if (!ownsPresentation()) return;
      if (!current() || !focus.current()) { this.#dismissPersona(persona, opening); return; }
      const dialog=this.querySelector<HTMLDialogElement>(".actual-persona-confirmation"),input=dialog?.querySelector<HTMLInputElement>("input[name=confirmation]");
      if (!dialog || !input || [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].some(other => other !== dialog)) { this.#dismissPersona(persona, opening); return; }
      if (!focus.run(input, () => { if (!current() || !ownsPresentation() || !ensureModalDialog(dialog)) return false; input.focus(); return document.activeElement === input; })) this.#dismissPersona(persona, opening);
    } finally { focus.dispose(); }
  }

  #dismissPersona(expected?:ReplayPersona, opening?:number){
    if (expected && this.#pendingPersona !== expected || opening !== undefined && this.#personaOpening !== opening) return;
    const dialog=this.querySelector<HTMLDialogElement>(".actual-persona-confirmation");
    this.#pendingPersona=undefined;this.#trustedPersonaApproval=false;this.#personaOpening += 1;
    // Closing presentation cannot cancel a dispatched impersonation request.
    // Its single pending slot is released only by that request's finally.
    dialog?.close();this.requestUpdate();
  }

  async #confirmPersona(event:SubmitEvent, expected:ReplayPersona|undefined, expectedOpening:number){
    event.preventDefault();
    if (!expected || this.#pendingPersona !== expected || this.#personaOpening !== expectedOpening) return;
    const trusted=this.#trustedPersonaApproval;this.#trustedPersonaApproval=false;const persona=this.#pendingPersona;
    if(!persona||this.#personaSubmitting||!event.isTrusted||!trusted||navigator.userActivation&&!navigator.userActivation.isActive){this.#issue=this.i18n.t("replay.actual.trusted","A direct human action is required.");this.requestUpdate();return;}
    const owner = this.#privateOwner(), opening = this.#personaOpening;
    const current = () => owner.current() && this.#pendingPersona === persona && this.#personaOpening === opening;
    if (!current() || this.#loadedScope !== owner.scope) return;
    const values=new FormData(event.currentTarget as HTMLFormElement);const confirmation=String(values.get("confirmation")??"");
    if(confirmation!==PERSONA_CONFIRMATION_PHRASE||values.get("personaAcknowledged")!=="yes")return;
    this.#personaSubmitting=true;this.requestUpdate();
    try{
      const response=await fetch("/api/impersonation",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({personaId:persona.personaId,confirmation})});
      if (owner.denied(response) || !current()) return;
      const body=await response.json() as {route?:string;error?:string};
      if (!current()) return;
      if(!response.ok||!body.route)throw new Error(body.error??"persona_unavailable");
      this.#dismissPersona(persona, opening);location.assign(body.route);
    }catch(error){if (current()) { this.#issue=error instanceof Error?error.message:"persona_unavailable";this.requestUpdate(); }}
    finally { this.#personaSubmitting=false;this.requestUpdate(); }
  }

  async #retry(session:ReplaySession){
    const owner = this.#privateOwner(), source = JSON.stringify(session), input = JSON.stringify(this.#input());
    const current = () => owner.current() && this.#loadedScope === owner.scope && this.#sessions.includes(session)
      && session.status === "failed" && JSON.stringify(session) === source;
    if (!current()) return;
    try{
      const response=await fetch(`/api/replay-sessions/${encodeURIComponent(session.sessionId)}/retry`,{method:"POST"});
      if (owner.denied(response) || !current()) return;
      const body=await response.json() as {retry?:{seed:string;eventCount:number;providerCoverage:string;studyTypes:string[];experienceProfile:string;releasedMicrousd:number;budgetSettled:boolean};error?:string};
      if (!current() || JSON.stringify(this.#input()) !== input) return;
      if(!response.ok||!body.retry||!body.retry.budgetSettled)throw new Error(body.error??"retry_budget_not_settled");
      this.#seed=body.retry.seed;this.#cleanSeed=body.retry.seed;this.#eventCount=body.retry.eventCount;this.#providerCoverage=body.retry.providerCoverage;this.#studyTypes=body.retry.studyTypes;this.#experienceProfile=body.retry.experienceProfile;
      const restored = JSON.stringify(this.#input());
      await this.#estimate();
      if (!current() || JSON.stringify(this.#input()) !== restored) return;
      this.#issue=this.i18n.t("replay.actual.retryPrepared","Previous reservation settled; the original settings are restored. A new provider run still requires explicit approval.")+` ${dollars(body.retry.releasedMicrousd)}`;
    }catch(error){if(current()){this.#issue=error instanceof Error?error.message:"retry_failed";}}
    finally { if (owner.current()) this.requestUpdate(); }
  }

  async #archive(event:MouseEvent,session:ReplaySession){
    if (!event.isTrusted || this.#archiveConfirmation || platformSession.get()?.user.role !== "admin") return;
    const owner = this.#privateOwner(), scope = this.#scope(), revision = this.#loadRevision, controller = new AbortController();
    const sessionId = session.sessionId, source = JSON.stringify(session), invoker = event.currentTarget as HTMLElement | null;
    const pending = { controller, sent: false, current: (): boolean => this.#archiveConfirmation === pending
      && !controller.signal.aborted && this.isConnected && Boolean(scope) && scope === this.#scope()
      && this.#loadedScope === scope };
    const eligible = () => pending.current() && revision === this.#loadRevision && session.status === "failed"
      && this.#sessions.find((candidate) => candidate.sessionId === sessionId) === session && JSON.stringify(session) === source;
    this.#archiveConfirmation = pending;
    try {
      if (!eligible()) return;
      const accepted = await requestDialogConfirmation({
        title: this.i18n.t("replay.actual.archive", "Archive failed session"),
        message: this.i18n.t("replay.actual.confirmArchive", "Archive this failed session and permanently remove its unfinished generated media?") + "\n" + session.title,
        confirmLabel: this.i18n.t("replay.actual.archive", "Archive failed session"),
        cancelLabel: this.i18n.t("action.cancel"), locale: this.i18n.locale, direction: this.i18n.direction,
        owner: this, invoker, signal: controller.signal, current: eligible, requireTrustedConfirmation: true,
      });
      if (!accepted || !eligible()) return;
      pending.sent = true; this.requestUpdate();
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (owner.denied(response) || !pending.current()) return;
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        if (pending.current()) { this.#issue = body.error ?? "archive_failed"; this.requestUpdate(); }
        return;
      }
      await this.#load(pending);
    } catch (error) {
      if (pending.current()) { this.#issue = error instanceof Error ? error.message : "archive_failed"; this.requestUpdate(); }
    } finally {
      if (this.#archiveConfirmation === pending) { this.#archiveConfirmation = null; this.requestUpdate(); }
    }
  }

  #discardPreparation(event: Event, current: () => boolean) {
    const form = (event.currentTarget as HTMLElement | null)?.closest("form");
    if (!current() || this.#currentApprovalPending || this.#accessUnavailable
      || this.#loadedScope !== this.#scope() || !form?.isConnected
      || this.querySelector(".actual-replay-approval") !== form) return;
    for (const field of form.querySelectorAll<HTMLInputElement>('input[name="phrase"],input[name="acknowledged"],input[name="override"]')) {
      // Restore these native inputs to their own rendered HTML defaults.
      if (field.getAttribute("type") === "checkbox") field.checked = field.getAttribute("checked") !== null;
      else field.value = field.getAttribute("value") ?? "";
    }
    this.#seed = this.#cleanSeed;
    this.#trustedApproval = false;
    this.requestUpdate();
  }

  async #approve(event:SubmitEvent){
    event.preventDefault();const trusted=this.#trustedApproval;this.#trustedApproval=false;
    if(!event.isTrusted||!trusted||navigator.userActivation&&!navigator.userActivation.isActive){this.#issue=this.i18n.t("replay.actual.trusted","A direct human action is required.");this.requestUpdate();return;}
    const configuration=this.#configuration,cost=configuration?.cost;if(this.#currentApprovalPending||!configuration||!cost)return;
    const owner = this.#privateOwner(), input = this.#input(), signature = JSON.stringify(input);
    const canDispatch = () => owner.current() && this.#loadedScope === owner.scope
      && this.#configuration === configuration && JSON.stringify(this.#input()) === signature;
    if (!canDispatch()) return;
    const values=new FormData(event.currentTarget as HTMLFormElement);const phrase=String(values.get("phrase")??"");const acknowledged=values.get("acknowledged")==="yes";const override=values.get("override")==="yes";
    if(phrase!==configuration.approvalPhrase||!acknowledged||!cost.fitsReplayStructure||!cost.fitsWorkspace||cost.requiresUserOverride&&!override)return;
    const pending = { current: (): boolean => this.#busy === pending && owner.current() };
    this.#busy=pending;this.#issue=this.i18n.t("replay.actual.preparing","Recording your one-use, bounded approval…");this.requestUpdate();
    try{
      const approvalResponse=await fetch("/api/replay-sessions/approval",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phrase,costAcknowledged:true,directUserApproval:true,confirmationVersion:configuration.confirmationVersion,...input,initiator:"direct-user",approvedMaximumMicrousd:cost.estimate.authorizationMicrousd,allowUserBudgetOverride:override})});
      if (owner.denied(approvalResponse) || !canDispatch()) return;
      const approval=await approvalResponse.json() as {approvalId?:string;error?:string};
      if (!canDispatch()) return;
      if(!approvalResponse.ok||!approval.approvalId)throw new Error(approval.error??"approval_failed");
      this.#issue=this.i18n.t("replay.actual.generating","Generating the explicitly approved replay. This can take several minutes.");this.requestUpdate();
      const response=await fetch("/api/replay-sessions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approvalId:approval.approvalId,directUserApproval:true,confirmationVersion:configuration.confirmationVersion,initiator:"direct-user"})});
      if (owner.denied(response) || !owner.current()) return;
      const result=await response.json() as {error?:string;session?:ReplaySession};
      if (!owner.current()) return;
      if(!response.ok||!result.session)throw new Error(result.error??"generation_failed");
      // The original positive completion only acknowledges its submitted seed;
      // newer controlled text remains different, never cleared or promoted.
      this.#cleanSeed = input.seed;
      await this.#load();
      if (owner.current()) this.#issue=this.i18n.t("replay.actual.complete","The approved replay is saved and can be reused without another provider call.");
    }catch(error){
      if (owner.current()) { this.#issue=error instanceof Error?error.message:"generation_failed";await this.#load(); }
    }finally{if(this.#busy===pending){this.#busy=null;if(owner.current())this.requestUpdate();}}
  }

  override render(){
    const configuration=this.#configuration,cost=configuration?.cost,pendingPersona=this.#pendingPersona,personaOpening=this.#personaOpening;
    const departure = this.captureCommandDeparture();
    const retainedSeed = !(configuration?.enabled && configuration.configured && cost)
      && Boolean(this.#loadedScope) && this.#loadedScope === this.#scope() && !this.#accessUnavailable
      && (this.#seed !== this.#cleanSeed || this.#currentApprovalPending);
    const issue=this.#accessUnavailable?this.i18n.t("shell.accessUnavailable","Workspace unavailable"):this.#issue;
    return html`<section class="actual-replay page-pad" aria-labelledby="actual-replay-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("shell.product","Product & Quality")}</span><h1 id="actual-replay-heading">${this.i18n.t("replay.actual.heading","Approved replay sessions and personas")}</h1><p>${this.i18n.t("replay.actual.description","Administrator-only, owner-isolated historical provider fixtures. New paid work requires explicit direct human approval, an exact one-use quote, and enforced spending limits.")}</p></div><button class="button secondary" type="button" @click=${()=>this.#load()}>${this.i18n.t("role.refresh","Refresh evidence")}</button></header>
      ${issue?html`<p role="status" aria-live="polite">${issue}</p>`:nothing}
      <section aria-labelledby="actual-saved-heading"><h2 id="actual-saved-heading">${this.i18n.t("replay.actual.saved","Saved approved sessions")}</h2>${this.#sessions.length?html`<ol class="actual-replay-sessions">${this.#sessions.map((session)=>html`<li><article><header><h3 dir="auto">${session.title}</h3><span>${this.i18n.t(`replay.status.${session.status}`,session.status)}</span></header><p dir="auto">${session.summary}</p><p>${this.i18n.number(session.eventCount)} ${this.i18n.t("replay.actual.events","events")} · ${this.i18n.number(session.imageCount)} ${this.i18n.t("replay.actual.images","images")}${typeof session.usage.actualCostMicrousd==="number"?html` · ${dollars(session.usage.actualCostMicrousd)}`:nothing}</p>${session.error?html`<p role="note" dir="auto">${session.error}</p>`:nothing}<div class="actual-replay-actions"><button class="button secondary compact" type="button" @click=${()=>this.#inspect(session)}>${this.i18n.t("replay.actual.inspect","Inspect saved timeline")}</button>${session.status==="complete"&&session.persona?.status==="ready"?html`<button class="button secondary compact" type="button" ?disabled=${this.#personaSubmitting} @click=${(event:MouseEvent)=>this.#requestPersona(event,session.persona!)}>${this.i18n.t("replay.actual.openPersona","Enter fictional persona")} · ${session.persona.displayName}</button>`:session.status==="complete"?html`<button class="button secondary compact" type="button" @click=${()=>this.#preparePersona(session)}>${this.i18n.t("replay.actual.preparePersona","Prepare reusable persona")}</button>`:nothing}${session.status==="failed"?html`<button class="button secondary compact" type="button" @click=${()=>this.#retry(session)}>${this.i18n.t("replay.actual.retry","Prepare safe retry")}</button><button class="button ghost compact" type="button" ?disabled=${this.#archiveConfirmation?.sent ?? false} @click=${(event:MouseEvent)=>this.#archive(event,session)}>${this.i18n.t("replay.actual.archive","Archive failed session")}</button>`:nothing}</div></article></li>`)}</ol>`:html`<p>${this.i18n.t("replay.actual.empty","No approved replay sessions are available.")}</p>`}</section>
      ${this.#events.length?html`<section aria-labelledby="actual-timeline-heading"><h2 id="actual-timeline-heading">${this.i18n.t("replay.actual.timeline","Saved owner-isolated timeline")}</h2><ol>${this.#events.map((event)=>html`<li>${this.i18n.number(event.sequence)} · <code>${event.type}</code></li>`)}</ol></section>`:nothing}
      ${retainedSeed?html`<section><form class="actual-replay-approval" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label>${this.i18n.t("replay.actual.seed","Optional fictional creative direction")}<textarea readonly .value=${this.#seed}></textarea></label>${this.#currentApprovalPending?html`<p role="status">${this.i18n.t("replay.actual.working","Working…")}</p>`:nothing}<div class="platform-form-actions"><button class="button secondary" type="button" ?disabled=${this.#currentApprovalPending} @click=${(event:MouseEvent)=>this.#discardPreparation(event,departure.current)}>${this.i18n.t("workspace.admin.discardPolicy")}</button></div></form></section>`:nothing}
      ${configuration?.enabled&&configuration.configured&&cost?html`<section aria-labelledby="actual-new-heading"><h2 id="actual-new-heading">${this.i18n.t("replay.actual.new","Create an explicitly approved paid fixture")}</h2><form class="actual-replay-approval" @submit=${(event:SubmitEvent)=>this.#approve(event)}><label>${this.i18n.t("replay.actual.seed","Optional fictional creative direction")}<textarea maxlength="1200" .value=${this.#seed} @input=${(event:InputEvent)=>{this.#seed=(event.target as HTMLTextAreaElement).value;}}></textarea></label><p>${this.i18n.t("replay.actual.maximum","Maximum reserved provider cost")}: <strong>${dollars(cost.estimate.authorizationMicrousd)}</strong> · ${this.i18n.number(cost.estimate.operations)} ${this.i18n.t("replay.actual.providerOperations","maximum provider operations")}</p><label>${this.i18n.t("replay.actual.phrase","Type the explicit approval phrase")}<input name="phrase" required autocomplete="off" placeholder=${configuration.approvalPhrase}></label><label><input type="checkbox" name="acknowledged" value="yes" required> ${this.i18n.t("replay.actual.acknowledge","I authorize this exact one-use maximum and understand that real provider calls will occur.")}</label>${cost.requiresUserOverride?html`<label><input type="checkbox" name="override" value="yes" required> ${this.i18n.t("replay.actual.override","I approve the displayed one-run personal-budget exception.")}</label>`:nothing}<div class="platform-form-actions"><button class="button secondary" type="button" @click=${()=>this.#estimate()}>${this.i18n.t("replay.actual.refreshEstimate","Refresh exact estimate")}</button><button class="button primary" type="submit" ?disabled=${this.#currentApprovalPending||!cost.fitsWorkspace||!cost.fitsReplayStructure} @click=${(event:MouseEvent)=>{this.#trustedApproval=event.isTrusted;}}>${this.#currentApprovalPending?this.i18n.t("replay.actual.working","Working…"):this.i18n.t("replay.actual.authorize","Approve and generate paid replay")}</button><button class="button secondary" type="button" ?disabled=${this.#currentApprovalPending} @click=${(event:MouseEvent)=>this.#discardPreparation(event,departure.current)}>${this.i18n.t("workspace.admin.discardPolicy")}</button></div></form></section>`:nothing}
      ${this.#pendingPersona?html`<dialog class="modal actual-persona-confirmation" open aria-labelledby="actual-persona-confirmation-heading" @close=${()=>{if(this.#pendingPersona===pendingPersona&&this.#personaOpening===personaOpening){this.#pendingPersona=undefined;this.#trustedPersonaApproval=false;this.#personaOpening+=1;this.requestUpdate();}}}><form class="modal-card" @submit=${(event:SubmitEvent)=>this.#confirmPersona(event,pendingPersona,personaOpening)}><h2 id="actual-persona-confirmation-heading">${this.i18n.t("replay.actual.personaTitle","Confirm fictional persona entry")}</h2><p>${this.i18n.t("replay.actual.personaWarning","You are about to enter an isolated fictional account. Changes made while impersonating this persona are written to that fictional account, and your principal administrative access will be suspended until you leave.")}</p><p><strong dir="auto">${this.#pendingPersona.displayName}</strong></p><label>${this.i18n.t("replay.actual.personaPhrase","Type the confirmation phrase exactly")}<input name="confirmation" required autocomplete="off" placeholder=${PERSONA_CONFIRMATION_PHRASE}></label><label><input type="checkbox" name="personaAcknowledged" value="yes" required> ${this.i18n.t("replay.actual.personaAcknowledge","I understand that this fictional persona has a separate account and that actions may modify its saved state.")}</label><footer><button class="button ghost" type="button" @click=${()=>this.#dismissPersona(pendingPersona,personaOpening)}>${this.i18n.t("replay.actual.cancel","Cancel")}</button><button class="button primary" type="submit" ?disabled=${this.#personaSubmitting} @click=${(event:MouseEvent)=>{if(this.#pendingPersona===pendingPersona&&this.#personaOpening===personaOpening)this.#trustedPersonaApproval=event.isTrusted;}}>${this.i18n.t("replay.actual.personaConfirm","Confirm and enter fictional persona")}</button></footer></form></dialog>`:nothing}
    </section>`;
  }
}

if(!customElements.get("forma-actual-replay"))customElements.define("forma-actual-replay",FormaActualReplay);
