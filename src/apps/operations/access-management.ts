import { html, nothing } from "lit";
import type { CommandDeparture } from "../../components/command-departure";
import { qualifyDisplayCollisions } from "../../model/output-naming";
import { FORMA_CAPABILITIES } from "../../platform/capabilities";
import { APPLICATIONS } from "../../platform/applications";
import { platformSession, type PlatformSession } from "../../platform/session-controller";
import { FormaPresentationalElement } from "../../components/presentational-element";

type PlatformUser = { user_id: string; email: string; display_name: string; role: string };
type PlatformGrant = { grant_id: string; user_id: string; display_name: string; email: string; capability: string; scope_type: string; expires_at: string | null };

type AccessOwner = { session: PlatformSession; route: string; userId: string; epoch: string; generation: number };
type AccessMutation = { phase: "pending" | "uncertain"; kind: "grant" | "revoke" };
const validUser = (value: unknown): value is PlatformUser => Boolean(value && typeof value === "object"
  && ["user_id","email","display_name","role"].every(key => typeof (value as Record<string,unknown>)[key] === "string")
  && (value as PlatformUser).user_id);
const validGrant = (value: unknown): value is PlatformGrant => Boolean(value && typeof value === "object"
  && ["grant_id","user_id","display_name","email","capability","scope_type"].every(key => typeof (value as Record<string,unknown>)[key] === "string")
  && (value as PlatformGrant).grant_id && ((value as PlatformGrant).expires_at === null || typeof (value as PlatformGrant).expires_at === "string"));

const AVAILABLE_APPLICATION_CAPABILITIES=new Set<string>(APPLICATIONS.flatMap((application)=>application.requiredCapabilities));
const SPECIALIST_CAPABILITIES = FORMA_CAPABILITIES.filter((capability) => AVAILABLE_APPLICATION_CAPABILITIES.has(capability)&&(capability.startsWith("product.") || capability.startsWith("evaluation.synthetic.") || capability.startsWith("evaluation.qualification.") || capability.startsWith("design.") || capability.startsWith("engineering.")));

/** Operators grant exact specialist permissions without promoting someone to global administrator. */
export class FormaAccessManagement extends FormaPresentationalElement {
  #users: PlatformUser[] = [];
  #grants: PlatformGrant[] = [];
  #issue = "";
  #notice = "";
  #user = "";
  #capability: string = SPECIALIST_CAPABILITIES[0];
  #loading = true;
  #ready = false;
  #generation = 0;
  #readRevision = 0;
  #owner: AccessOwner | null = null;
  #mutation: AccessMutation | null = null;
  #cleanChoice: readonly [string, string] | null = null;
  #unsubscribe?: () => void;
  #boundary = () => { if (!this.#currentOwner(this.#owner)) this.#open(); };

  captureCommandDeparture(): Omit<CommandDeparture, "element"> & { readonly element: HTMLElement } {
    const owner = this.#owner, generation = this.#generation, route = this.#route(), session = platformSession.get();
    let retired = false;
    const current = () => {
      if (retired) return false;
      if (!this.isConnected || this.#owner !== owner || this.#generation !== generation
        || this.#route() !== route || platformSession.get() !== session) retired = true;
      return !retired;
    };
    return { element: this, current, blocked: () => {
      if (!this.#currentOwner(owner) || this.#issue === "access.unavailable") return false;
      if (this.#mutation?.phase === "pending") return true;
      // The existing uncertain original locks these controls. It is not a
      // permanent departure veto or evidence that a replacement grant is safe.
      if (this.#mutation?.phase === "uncertain") return false;
      return Boolean(this.#cleanChoice && (this.#user !== this.#cleanChoice[0]
        || this.#capability !== this.#cleanChoice[1]));
    }, reason: () => "next.lifecycle.currentWorkOpen" };
  }

  #route() {
    const route=globalThis.location;
    return route ? route.pathname + route.search : "";
  }

  #currentOwner(owner: AccessOwner | null): owner is AccessOwner {
    const session=platformSession.get();
    return Boolean(owner && session && this.isConnected && this.#owner===owner && this.#generation===owner.generation
      && session===owner.session && session.user.userId===owner.userId && session.permissionEpoch===owner.epoch
      && session.audience==="operations" && session.capabilities.includes("platform.identity.manage")
      && this.#route()===owner.route);
  }

  #retire() {
    this.#generation++; this.#readRevision++; this.#owner=null;
    this.#users=[]; this.#grants=[]; this.#user=""; this.#capability=SPECIALIST_CAPABILITIES[0]; this.#ready=false; this.#loading=false;
    this.#issue="access.unavailable"; this.#notice=""; this.#mutation=null; this.#cleanChoice=null;
  }

  #open() {
    this.#retire();
    const session=platformSession.get(),route=this.#route();
    if(this.isConnected && session?.audience==="operations" && session.user.userId
      && session.capabilities.includes("platform.identity.manage")
      && globalThis.location?.pathname.replace(/\/+$/u,"")==="/operations/access"){
      this.#owner={session,route,userId:session.user.userId,epoch:session.permissionEpoch,generation:this.#generation};
      this.#issue=""; void this.#load(this.#owner);
    }
    this.requestUpdate();
  }

  override connectedCallback() {
    super.connectedCallback();
    this.#unsubscribe?.();
    this.#unsubscribe=platformSession.subscribe(this.#boundary);
    window.removeEventListener("popstate",this.#boundary);
    window.removeEventListener("forma-route-changed",this.#boundary);
    window.addEventListener("popstate",this.#boundary);
    window.addEventListener("forma-route-changed",this.#boundary);
    this.#open();
  }

  override disconnectedCallback() {
    this.#unsubscribe?.(); this.#unsubscribe=undefined;
    window.removeEventListener("popstate",this.#boundary);
    window.removeEventListener("forma-route-changed",this.#boundary);
    this.#retire();
    super.disconnectedCallback();
  }

  async #load(owner: AccessOwner | null) {
    if(!this.#currentOwner(owner) || this.#loading || this.#mutation?.phase==="pending")return;
    const revision=++this.#readRevision;
    const current=()=>this.#currentOwner(owner)&&revision===this.#readRevision;
    this.#loading=true; this.#ready=false; this.#users=[]; this.#grants=[]; this.#issue="";
    this.requestUpdate();
    try {
      if(!current())return;
      const [users,grants]=await Promise.all([fetch("/api/admin/users"),fetch("/api/platform/access")]);
      if(!current())return;
      if([users.status,grants.status].some(status=>status===401||status===403)){
        this.#issue="access.unavailable"; this.#cleanChoice=null; return;
      }
      if(!users.ok||!grants.ok)throw new Error("Access read failed");
      const [people,access]=await Promise.all([users.json(),grants.json()]) as [{users?:unknown},{grants?:unknown}];
      if(!current())return;
      if(!Array.isArray(people.users)||!people.users.every(validUser)||!Array.isArray(access.grants)||!access.grants.every(validGrant))
        throw new Error("Access read was incomplete");
      // Publish one verified owner-bound pair, never one old half and one new half.
      const clean = !this.#cleanChoice || this.#user === this.#cleanChoice[0] && this.#capability === this.#cleanChoice[1];
      this.#users=people.users; this.#grants=access.grants;
      if(!this.#users.some(user=>user.user_id===this.#user))this.#user=this.#users[0]?.user_id??"";
      // Only initial/unchanged loaded defaults follow an automatic choice.
      // Refresh cannot turn an authored choice B into a saved choice.
      if (clean) this.#cleanChoice = [this.#user, this.#capability];
      this.#ready=true;
    } catch {
      if(current())this.#issue="access.loadFailed";
    } finally {
      if(current()){this.#loading=false; this.requestUpdate();}
    }
  }

  #canChange(owner: AccessOwner | null) {
    return this.#currentOwner(owner)&&this.#ready&&!this.#loading&&!this.#mutation;
  }

  async #change(kind: "grant" | "revoke", owner: AccessOwner, target: { userId: string; capability: string } | string) {
    if(!this.#canChange(owner))return;
    const mutation: AccessMutation={kind,phase:"pending"};
    this.#mutation=mutation; this.#notice=kind==="grant"?"access.grantPending":"access.revokePending"; this.#issue="";
    this.requestUpdate();
    const current=()=>this.#currentOwner(owner)&&this.#mutation===mutation;
    try {
      if(!current())return;
      const response=kind==="grant"
        ? await fetch("/api/platform/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(target)})
        : await fetch(`/api/platform/access/${encodeURIComponent(target as string)}`,{method:"DELETE"});
      if(!current())return;
      if(response.status===401||response.status===403){
        this.#ready=false; this.#users=[]; this.#grants=[]; this.#user=""; this.#cleanChoice=null; this.requestUpdate();
        if(response.status===403){
          const refusal=await response.json().catch(()=>null) as {error?:string}|null;
          if(!current())return;
          const actionRefusals=["self_privilege_escalation_forbidden","self_privilege_revocation_forbidden","capability_delegation_forbidden","administrator_approval_required"];
          if(refusal?.error&&actionRefusals.includes(refusal.error)){
            this.#mutation=null; this.#notice="access.changeRefused"; await this.#load(owner); return;
          }
        }
        this.#mutation=null; this.#notice=""; this.#issue="access.unavailable"; return;
      }
      const body=await response.json() as {ok?:boolean;grantId?:string;error?:string};
      if(!current())return;
      if(response.ok && body.ok===true && (kind==="revoke"||typeof body.grantId==="string"&&Boolean(body.grantId))){
        if (kind === "grant" && typeof target !== "string") this.#cleanChoice = [target.userId, target.capability];
        this.#mutation=null; this.#notice=kind==="grant"?"access.grantAcknowledged":"access.revokeAcknowledged";
        await this.#load(owner); return;
      }
      if([400,404,409,422].includes(response.status)&&typeof body.error==="string"&&body.error){
        this.#mutation=null; this.#notice="access.changeRefused"; await this.#load(owner); return;
      }
      throw new Error("Access change acknowledgement unavailable");
    } catch {
      if(current()){
        // This POST is not idempotent. A current-list GET cannot prove the
        // original request unused or safely repeat it after a lost response.
        mutation.phase="uncertain"; this.#notice="access.changeUnknown";
      }
    } finally {
      if(this.#currentOwner(owner))this.requestUpdate();
    }
  }

  #discardChoice(event: Event, owner: AccessOwner | null) {
    const form = (event.currentTarget as HTMLElement | null)?.closest("form");
    if (!this.#currentOwner(owner) || this.#loading || this.#mutation || this.#issue === "access.unavailable"
      || !this.#cleanChoice || !form?.isConnected || this.querySelector(".access-grant-form") !== form) return;
    const clean = this.#cleanChoice;
    if (this.#ready) {
      const person = this.#users.find(user => user.user_id === clean[0]) ?? this.#users[0];
      if (!person) return;
      this.#user = person.user_id;
      this.#capability = SPECIALIST_CAPABILITIES.some(capability => capability === clean[1]) ? clean[1] : SPECIALIST_CAPABILITIES[0];
    } else {
      // Failed readiness hides the old lists; only the local choice is reset.
      // The prior clean default is not a claim that this person is still eligible.
      [this.#user, this.#capability] = clean;
    }
    this.#cleanChoice = [this.#user, this.#capability];
    this.requestUpdate();
  }

  async #grant(event: SubmitEvent, owner: AccessOwner | null) {
    event.preventDefault();
    if(!owner||!this.#canChange(owner)||!this.#users.some(user=>user.user_id===this.#user)
      ||!SPECIALIST_CAPABILITIES.some(capability=>capability===this.#capability))return;
    await this.#change("grant",owner,{userId:this.#user,capability:this.#capability});
  }

  async #revoke(grantId: string, owner: AccessOwner | null) {
    if(!owner||!this.#canChange(owner)||!this.#grants.some(grant=>grant.grant_id===grantId))return;
    await this.#change("revoke",owner,grantId);
  }
  override render() {
    const owner=this.#owner,owned=this.#currentOwner(owner),ready=owned&&this.#ready;
    const users=ready?this.#users:[],grants=ready?this.#grants:[];
    const pending=owned&&this.#mutation?.phase==="pending",uncertain=owned&&this.#mutation?.phase==="uncertain";
    const locked=!this.#canChange(owner);
    const retainedChoice = owned && !ready && !this.#loading && !this.#mutation && this.captureCommandDeparture().blocked();
    const isolate=(text:string)=>"\u2068"+text+"\u2069";
    const expiry=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value:this.i18n.date(date,{dateStyle:"medium",timeStyle:"short"});};
    const revokeNames=qualifyDisplayCollisions(grants.map((grant)=>({
      key:grant.grant_id,
      label:this.i18n.t("access.revokeNamed","{action} — {name} ({email}) · {capability} · {scope}",{
        action:this.i18n.t("access.revoke","Revoke"),name:isolate(grant.display_name),email:isolate(grant.email),
        capability:isolate(grant.capability),scope:isolate(grant.scope_type),
      })+(grant.expires_at?" · "+this.i18n.t("access.expires","Expires")+" "+isolate(expiry(grant.expires_at)):""),
    })),number=>this.i18n.t("access.grantQualifier","Grant {number}",{number:this.i18n.number(number)}),
    id=>this.i18n.t("access.grantIdentity","Grant ID {id}",{id:isolate("["+encodeURIComponent(id)+"]")}));
    return html`<section class="access-management page-pad" aria-labelledby="access-management-heading" aria-busy=${owned&&(this.#loading||pending)?"true":"false"}><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("shell.operations", "Platform Operations")}</span><h1 id="access-management-heading">${this.i18n.t("access.heading", "Specialist access")}</h1><p>${this.i18n.t("access.description", "Grant the minimum explicit product, evaluation, design, or engineering authority. Revoking a grant takes effect on the next protected request.")}</p></div></header>
      ${!owned?html`<p role="alert">${this.i18n.t("access.unavailable")}</p>`:html`
        ${this.#loading?html`<p role="status">${this.i18n.t("access.loading")}</p>`:nothing}
        ${this.#issue?html`<p role="alert">${this.i18n.t(this.#issue)}</p>`:nothing}
        ${this.#notice?html`<p role="status">${this.i18n.t(this.#notice)}</p>`:nothing}
        ${uncertain?html`<p>${this.i18n.t("access.unknownReadOnly")}</p>`:nothing}
        <button class="button secondary compact" type="button" ?disabled=${this.#loading||pending} @click=${()=>this.#load(owner)}>${this.i18n.t("access.refresh")}</button>
        ${retainedChoice?html`<form class="access-grant-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label>${this.i18n.t("access.person","Person")}<input readonly .value=${this.#user}></label><label>${this.i18n.t("access.capability","Exact capability")}<input readonly .value=${this.#capability}></label><div class="platform-form-actions"><button class="button secondary" type="button" @click=${(event:MouseEvent)=>this.#discardChoice(event,owner)}>${this.i18n.t("workspace.admin.discardPolicy")}</button></div></form>`:nothing}
        ${ready?html`
      <form class="access-grant-form" @submit=${(event: SubmitEvent) => this.#grant(event,owner)}><label>${this.i18n.t("access.person", "Person")}<select .value=${this.#user} ?disabled=${locked||!users.length} @change=${(event: Event) => { if(this.#canChange(owner)){this.#user = (event.target as HTMLSelectElement).value;this.requestUpdate();} }}>${users.map((user) => html`<option value=${user.user_id}>${user.display_name} · ${user.email}</option>`)}</select></label><label>${this.i18n.t("access.capability", "Exact capability")}<select .value=${this.#capability} ?disabled=${locked} @change=${(event: Event) => { if(this.#canChange(owner)){this.#capability = (event.target as HTMLSelectElement).value;this.requestUpdate();} }}>${SPECIALIST_CAPABILITIES.map((capability) => html`<option value=${capability}>${capability}</option>`)}</select></label><div class="platform-form-actions"><button class="button primary" type="submit" ?disabled=${locked||!users.some(user=>user.user_id===this.#user)}>${this.i18n.t("access.grant", "Grant scoped access")}</button><button class="button secondary" type="button" ?disabled=${locked||!this.#cleanChoice||!users.length} @click=${(event:MouseEvent)=>this.#discardChoice(event,owner)}>${this.i18n.t("workspace.admin.discardPolicy")}</button></div></form>${users.length?nothing:html`<p>${this.i18n.t("access.noPeople")}</p>`}
      <section aria-labelledby="access-current-heading"><h2 id="access-current-heading">${this.i18n.t("access.current", "Active specialist grants")}</h2>${grants.length ? html`<ul class="access-grant-list">${grants.map((grant) => html`<li><div><strong><bdi>${grant.display_name}</bdi></strong><span><bdi>${grant.email}</bdi></span><span>${grant.capability}</span><small>${grant.scope_type}${grant.expires_at ? ` · ${this.i18n.t("access.expires", "Expires")} ${expiry(grant.expires_at)}` : ""}${revokeNames.get(grant.grant_id)!.qualifier?html` · ${revokeNames.get(grant.grant_id)!.qualifier}`:nothing}</small></div><button class="button secondary compact" type="button" aria-label=${revokeNames.get(grant.grant_id)!.label} ?disabled=${locked} @click=${() => this.#revoke(grant.grant_id,owner)}>${this.i18n.t("access.revoke", "Revoke")}</button></li>`)}</ul>` : html`<p>${this.i18n.t("access.none", "No specialist capabilities have been delegated.")}</p>`}</section>
        `:nothing}
      `}
    </section>`;
  }
}

if (!customElements.get("forma-access-management")) customElements.define("forma-access-management", FormaAccessManagement);
