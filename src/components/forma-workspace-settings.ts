import { html, nothing } from "lit";
import { routePathname } from "../model/routes.ts";
import type { CapturedAuthorizationScope } from "../state/store.ts";
import { FormaElement } from "./forma-element.ts";
import "./design-system/feedback.ts";
import "./design-system/forms.ts";
import "./design-system/navigation.ts";

type Organization={organizationId:string;name:string;role:string;permissions?:string[]};
type SharedProject={organizationId:string;projectAccessId:string;projectId:string;projectName:string;role:string};
type Invitation={invitation_id:string;membership_id:string;organization_id:string;name:string;role:string;expires_at:string|null};
type Member={membership_id:string;user_id:string;display_name:string;email?:string;role:string;status:string;canvas_access?:number|boolean};
type Project={project_access_id:string;project_id:string;project_name:string;owner_user_id:string;status:string};
type PendingInvitation={invitation_id:string;email_normalized:string;role:string;status:string;expires_at:string};
type WorkspaceOverview={organizations:Organization[];projects:SharedProject[];invitations:Invitation[]};
type WorkspaceDetail={organization:Organization;members?:Member[];projects?:Project[];permissions?:string[];invitations?:PendingInvitation[];audit?:Array<Record<string,unknown>>;policy?:Record<string,unknown>|null;cost?:Record<string,unknown>|null;tokens?:Record<string,unknown>|null;period?:string;reservations?:Array<Record<string,unknown>>};

const sections=["overview","members","projects","usage","activity"] as const;
type WorkspaceSection=typeof sections[number];

/** Scoped customer organization management remains a Creator Settings task, never a seventh application. */
export class FormaWorkspaceSettings extends FormaElement{
  #overview:WorkspaceOverview|null=null;
  #detail:WorkspaceDetail|null=null;
  #projectMembers=new Map<string,Member[]>();
  #busy=false;
  #error="";
  #notice="";
  #loadedRoute="";
  #loadedOrganization="";
  #loadRevision=0;
  #freshInvitation:{url:string;email:string;expiresAt:string;organizationId:string;authorization:CapturedAuthorizationScope}|null=null;
  #clearInvitation=()=>{this.#freshInvitation=null;this.requestUpdate();};

  override connectedCallback(){super.connectedCallback();window.addEventListener("forma-authorization-changed",this.#clearInvitation);void this.#load();}
  override disconnectedCallback(){window.removeEventListener("forma-authorization-changed",this.#clearInvitation);this.#freshInvitation=null;this.#loadRevision+=1;super.disconnectedCallback();}

  protected override updated(){
    const route=routePathname(this.store.route.get());
    if(route!==this.#loadedRoute)void this.#load();
  }

  #route(){
    const parts=routePathname(this.store.route.get()).split("/").filter(Boolean);
    const organizationId=parts[2]&&parts[2]!=="invitations"?decodeURIComponent(parts[2]):"";
    const section=sections.includes(parts[3] as WorkspaceSection)?parts[3] as WorkspaceSection:"overview";
    return{organizationId,section,invitations:parts[2]==="invitations"};
  }

  async #request<T>(url:string,init:RequestInit={}){
    const response=await fetch(url,{credentials:"same-origin",...init});
    const body=await response.json() as T&{error?:string};
    if(!response.ok){const key=String(body.error??"");throw new Error(this.i18n.t(`workspace.admin.error.${key}`,this.i18n.t("workspace.admin.unavailable","This workspace is unavailable.")));}
    return body;
  }

  async #load(){
    const route=routePathname(this.store.route.get());
    this.#loadedRoute=route;
    const revision=++this.#loadRevision;
    const nextOrganization=this.#route().organizationId;
    if(nextOrganization!==this.#loadedOrganization){
      this.#loadedOrganization=nextOrganization;this.#detail=null;this.#projectMembers.clear();this.#freshInvitation=null;this.#notice="";this.#error="";this.requestUpdate();
    }
    try{
      const overview=await this.#request<WorkspaceOverview>("/api/workspaces");
      if(revision!==this.#loadRevision)return;
      this.#overview=overview;
      const {organizationId,section}=this.#route();
      if(organizationId){
        const endpoint=`/api/workspaces/${encodeURIComponent(organizationId)}`;
        const base=await this.#request<WorkspaceDetail>(endpoint);
        if(revision!==this.#loadRevision)return;
        if(section!=="overview"){
          const view=section==="activity"?"audit":section;
          const detail=await this.#request<WorkspaceDetail>(`${endpoint}/${view}`);
          if(revision!==this.#loadRevision)return;
          this.#detail={...base,...detail,permissions:base.permissions};
        }else this.#detail=base;
      }else this.#detail=null;
      this.#error="";
    }catch(error){if(revision!==this.#loadRevision)return;this.#error=error instanceof Error?error.message:"workspace_unavailable";this.#detail=null;}
    this.requestUpdate();
  }

  async #mutate(description:string,action:()=>Promise<void>){
    if(this.#busy)return;
    this.#busy=true;this.#error="";this.requestUpdate();
    try{await action();this.#notice=description;await this.store.refreshSession();await this.#load();}
    catch(error){this.#error=error instanceof Error?error.message:"workspace_mutation_failed";}
    finally{this.#busy=false;this.requestUpdate();}
  }

  #navigate(path:string,event?:MouseEvent){
    if(event&&(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;
    event?.preventDefault();this.store.setRoute(path);
  }

  #submitOrganization(event:SubmitEvent){
    event.preventDefault();
    const form=event.currentTarget as HTMLFormElement;
    const name=String(new FormData(form).get("name")??"").trim();
    void this.#mutate(this.i18n.t("workspace.admin.created","Workspace created."),async()=>{
      const organization=await this.#request<{organizationId:string}>("/api/workspaces",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
      form.reset();this.store.setRoute(`/settings/workspaces/${encodeURIComponent(organization.organizationId)}/overview`);
    });
  }

  #accept(invitation:Invitation){
    void this.#mutate(this.i18n.t("workspace.admin.accepted","Workspace invitation accepted."),async()=>{
      const invitationId=invitation.invitation_id||invitation.membership_id;
      const query=new URL(location.href).searchParams;
      const token=query.get("invitation")===invitationId?query.get("token"):null;
      await this.#request(`/api/workspaces/${encodeURIComponent(invitation.organization_id)}/invitations/${encodeURIComponent(invitationId)}/accept`,{method:"POST",...(token?{headers:{"content-type":"application/json"},body:JSON.stringify({token})}:{})});
    });
  }

  #submitInvite(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route(),authorization=this.store.captureAuthorizationScope(),revision=this.#loadRevision;if(!authorization)return;
    void this.#mutate(this.i18n.t("workspace.admin.invited","A private, expiring invitation was created."),async()=>{
      const email=String(data.get("email")??"").trim();
      const result=await this.#request<{invitationUrl:string;expiresAt:string}>(`/api/workspaces/${encodeURIComponent(organizationId)}/members`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,role:String(data.get("role")??"member")})});
      if(!this.store.authorizationScopeActive(authorization)||this.#route().organizationId!==organizationId||this.#loadRevision!==revision||this.#detail?.organization.organizationId!==organizationId||!this.#detail.permissions?.includes("workspace.member.manage"))return;
      this.#freshInvitation={url:result.invitationUrl,email,expiresAt:result.expiresAt,organizationId,authorization};form.reset();
    });
  }

  #revokeInvitation(invitation:PendingInvitation){
    if(!window.confirm(this.i18n.t("workspace.admin.confirmInvitationRevoke","Revoke the invitation for {email}?",{email:invitation.email_normalized})))return;
    const {organizationId}=this.#route();
    void this.#mutate(this.i18n.t("workspace.admin.invitationRevoked","The pending invitation was revoked."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitation.invitation_id)}`,{method:"DELETE"});
      if(this.#freshInvitation?.email.toLowerCase()===invitation.email_normalized)this.#freshInvitation=null;
    });
  }

  #revokeMember(member:Member){
    if(!window.confirm(this.i18n.t("workspace.admin.confirmRevoke","Remove {name} from this workspace and revoke all project access?",{name:member.display_name})))return;
    const {organizationId}=this.#route();
    void this.#mutate(this.i18n.t("workspace.admin.revoked","Workspace access was revoked."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.membership_id)}`,{method:"DELETE"});
    });
  }

  #updateMemberRole(member:Member,role:string){
    if(role===member.role)return;
    const {organizationId}=this.#route();
    void this.#mutate(this.i18n.t("workspace.admin.roleUpdated","The organization role was updated."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.membership_id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({role})});
    });
  }

  #registerProject(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,projectId=String(new FormData(form).get("projectId")??""),{organizationId}=this.#route();
    void this.#mutate(this.i18n.t("workspace.admin.projectRegistered","The project was safely indexed for collaboration."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectId})});form.reset();
    });
  }

  #grantProject(event:SubmitEvent,project:Project){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route();
    void this.#mutate(this.i18n.t("workspace.admin.projectGranted","Project access was granted."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(project.project_access_id)}/members`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({userId:String(data.get("userId")??""),role:String(data.get("role")??"viewer")})});
      form.reset();await this.#loadProjectMembers(project.project_access_id);
    });
  }

  async #loadProjectMembers(projectAccessId:string){
    const {organizationId}=this.#route(),revision=this.#loadRevision;
    const result=await this.#request<{members:Member[]}>(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/members`);
    if(revision!==this.#loadRevision||organizationId!==this.#route().organizationId)return;
    this.#projectMembers.set(projectAccessId,result.members);this.requestUpdate();
  }

  #revokeProject(projectAccessId:string,member:Member){
    if(!window.confirm(this.i18n.t("workspace.admin.confirmProjectRevoke","Remove {name} from this project?",{name:member.display_name})))return;
    const {organizationId}=this.#route();
    void this.#mutate(this.i18n.t("workspace.admin.projectRevoked","Project access was revoked."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/members/${encodeURIComponent(member.membership_id)}`,{method:"DELETE"});
      await this.#loadProjectMembers(projectAccessId);
    });
  }

  #updateProjectRole(projectAccessId:string,member:Member,role:string){
    if(role===member.role)return;
    const {organizationId}=this.#route();
    void this.#mutate(this.i18n.t("workspace.admin.projectRoleUpdated","The project role was updated."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/members/${encodeURIComponent(member.membership_id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({role})});
      await this.#loadProjectMembers(projectAccessId);
    });
  }

  async #updateProjectCanvas(projectAccessId:string,member:Member,enabled:boolean,control?:HTMLElement){
    const {organizationId}=this.#route();
    const restoreFocus=Boolean(control?.contains(document.activeElement));
    await this.#mutate(this.i18n.t("workspace.admin.canvasAccessUpdated","Project Canvas access was updated."),async()=>{
      try{
        await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/members/${encodeURIComponent(member.membership_id)}`,{
          method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({canvasAccess:enabled}),
        });
      }catch(error){await this.#loadProjectMembers(projectAccessId).catch(()=>{});throw error;}
      await this.#loadProjectMembers(projectAccessId);
    });
    if(restoreFocus){await this.updateComplete;control?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({preventScroll:true});}
  }

  #openProject(project:{organizationId:string;projectAccessId:string}){
    void this.#mutate(this.i18n.t("workspace.admin.projectOpened","Shared project opened."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(project.organizationId)}/projects/${encodeURIComponent(project.projectAccessId)}/context`,{method:"POST"});
      await this.store.refreshSession();this.store.setRoute("/projects");await this.store.load();
    });
  }

  #savePolicy(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route();
    void this.#mutate(this.i18n.t("workspace.admin.policySaved","Workspace budget policy was updated."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/policy`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({tokenLimit:Number(data.get("tokenLimit")),microusdLimit:Math.round(Number(data.get("usdLimit"))*1_000_000)})});
    });
  }

  #sectionLinks(organizationId:string,section:WorkspaceSection){
    const permissions=new Set(this.#detail?.permissions??[]);
    const allowed=(item:WorkspaceSection)=>item==="overview"||item==="members"&&permissions.has("workspace.member.read")||item==="projects"&&permissions.has("workspace.project.read")||item==="usage"&&permissions.has("workspace.usage.read")||item==="activity"&&permissions.has("workspace.audit.read");
    const destinations=sections.filter(allowed).map((item)=>({label:this.i18n.t(`workspace.admin.section.${item}`,item),value:item,href:`/settings/workspaces/${encodeURIComponent(organizationId)}/${item}`}));
    return html`<forma-ui-audience-navigation class="workspace-settings-navigation" .label=${this.i18n.t("workspace.admin.navigation","Organization settings")} .value=${section} .destinations=${destinations} @forma-navigate=${(event:CustomEvent<{href:string}>)=>{event.preventDefault();this.#navigate(event.detail.href);}}></forma-ui-audience-navigation>`;
  }

  #invitations(){
    const invitations=this.#overview?.invitations??[];
    return html`<section class="workspace-settings-card" aria-labelledby="workspace-invitations-heading"><h2 id="workspace-invitations-heading">${this.i18n.t("workspace.admin.invitations","Your invitations")}</h2>${invitations.length?html`<ul class="workspace-settings-list">${invitations.map((invitation)=>html`<li><div><b dir="auto">${invitation.name}</b><span>${this.i18n.t(`workspace.admin.role.${invitation.role}`,invitation.role)}</span></div><button type="button" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.acceptNamed","Accept the invitation to {name}",{name:invitation.name})} ?disabled=${this.#busy} @click=${()=>this.#accept(invitation)}>${this.i18n.t("workspace.admin.accept","Accept")}</button></li>`)}</ul>`:html`<p>${this.i18n.t("workspace.admin.noInvitations","You have no pending workspace invitations.")}</p>`}</section>`;
  }

  #landing(){
    const overview=this.#overview;
    const owner=Boolean(this.store.session.get()?.user.role==="creator"||this.store.session.get()?.user.role==="admin");
    return html`<div class="workspace-settings-grid">${this.#invitations()}<section class="workspace-settings-card" aria-labelledby="workspace-organizations-heading"><h2 id="workspace-organizations-heading">${this.i18n.t("workspace.admin.organizations","Your organizations")}</h2>${overview?.organizations.length?html`<ul class="workspace-settings-list">${overview.organizations.map((organization)=>{const manages=Boolean(organization.permissions?.length),href=`/settings/workspaces/${encodeURIComponent(organization.organizationId)}/overview`;return html`<li><div><b dir="auto">${organization.name}</b><span>${this.i18n.t(`workspace.admin.role.${organization.role}`,organization.role)}</span></div>${manages?html`<a class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.manageNamed","Manage {name}",{name:organization.name})} href=${href} @click=${(event:MouseEvent)=>this.#navigate(href,event)}>${this.i18n.t("workspace.admin.manage","Manage")}</a>`:nothing}</li>`;})}</ul>`:html`<p>${this.i18n.t("workspace.admin.noOrganizations","You do not belong to any organizations yet.")}</p>`}${owner?html`<form class="workspace-settings-form" @submit=${this.#submitOrganization}><label>${this.i18n.t("workspace.admin.organizationName","New organization name")}<input name="name" required maxlength="100" autocomplete="organization"></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.create","Create workspace")}</button></form>`:nothing}</section><section class="workspace-settings-card" aria-labelledby="workspace-projects-heading"><h2 id="workspace-projects-heading">${this.i18n.t("workspace.admin.sharedProjects","Projects shared with you")}</h2>${overview?.projects.length?html`<ul class="workspace-settings-list">${overview.projects.map((project)=>html`<li><div><b dir="auto">${project.projectName||this.i18n.t("workspace.admin.unnamedProject","Unnamed project")}</b><span>${this.i18n.t(`workspace.admin.role.${project.role}`,project.role)}</span></div><button type="button" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.openNamed","Open {name}",{name:project.projectName||this.i18n.t("workspace.admin.unnamedProject","Unnamed project")})} ?disabled=${this.#busy} @click=${()=>this.#openProject(project)}>${this.i18n.t("action.open","Open")}</button></li>`)}</ul>`:html`<p>${this.i18n.t("workspace.admin.noSharedProjects","No projects have been shared with you.")}</p>`}</section></div>`;
  }

  #members(){
    const detail=this.#detail,members=detail?.members??[],canManage=detail?.permissions?.includes("workspace.member.manage")??false,isOwner=detail?.organization.role==="owner";
    const invitations=(detail?.invitations??[]).filter((invitation)=>invitation.status==="pending");
    const candidate=this.#freshInvitation,fresh=canManage&&candidate&&candidate.organizationId===detail?.organization.organizationId&&candidate.organizationId===this.#route().organizationId&&this.store.authorizationScopeActive(candidate.authorization)?candidate:null;
    return html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.members","Members")}</h2>
      ${canManage?html`<form class="workspace-settings-form" @submit=${this.#submitInvite}><label>${this.i18n.t("workspace.admin.email","Email address")}<input name="email" type="email" required autocomplete="email"></label><label>${this.i18n.t("workspace.admin.role","Role")}<select name="role"><option value="member">${this.i18n.t("workspace.admin.role.member","Member")}</option>${detail?.organization.role==="owner"?html`<option value="administrator">${this.i18n.t("workspace.admin.role.administrator","Administrator")}</option>`:nothing}</select></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.invite","Create invitation")}</button></form>`:nothing}
      ${fresh?html`<div class="workspace-settings-invitation-link"><label>${this.i18n.t("workspace.admin.invitationLink","Private invitation link")}<input readonly dir="ltr" .value=${fresh.url}></label><forma-ui-copy-button .label=${this.i18n.t("workspace.admin.copyInvitation","Copy invitation link")} .value=${fresh.url}></forma-ui-copy-button><p>${this.i18n.t("workspace.admin.expiresAt","Expires")}: ${this.i18n.date(new Date(fresh.expiresAt),{dateStyle:"medium",timeStyle:"short"})}</p></div>`:nothing}
      <div class="workspace-settings-table"><table><caption>${this.i18n.t("workspace.admin.memberCaption","Organization members and invitations")}</caption><thead><tr><th scope="col">${this.i18n.t("workspace.admin.member","Member")}</th><th scope="col">${this.i18n.t("workspace.admin.role","Role")}</th><th scope="col">${this.i18n.t("workspace.admin.status","Status")}</th><th scope="col">${this.i18n.t("navigation.actions","Actions")}</th></tr></thead><tbody>${members.map((member)=>html`<tr><th scope="row"><span dir="auto">${member.display_name}</span>${member.email?html`<small><bdi dir="ltr">${member.email}</bdi></small>`:nothing}</th><td>${member.status==="active"&&isOwner&&member.role!=="owner"?html`<select aria-label=${this.i18n.t("workspace.admin.roleNamed","Role for {name}",{name:`\u2068${member.display_name}\u2069`})} .value=${member.role} ?disabled=${this.#busy} @change=${(event:Event)=>this.#updateMemberRole(member,(event.currentTarget as HTMLSelectElement).value)}><option value="member" ?selected=${member.role==="member"}>${this.i18n.t("workspace.admin.role.member","Member")}</option><option value="administrator" ?selected=${member.role==="administrator"}>${this.i18n.t("workspace.admin.role.administrator","Administrator")}</option></select>`:this.i18n.t(`workspace.admin.role.${member.role}`,member.role)}</td><td>${this.i18n.t(`workspace.admin.status.${member.status}`,member.status)}</td><td>${member.status==="active"&&canManage&&member.role!=="owner"&&(isOwner||member.role!=="administrator")?html`<button type="button" class="button ghost compact" aria-label=${this.i18n.t("workspace.admin.revokeNamed","Revoke access for {name}",{name:`\u2068${member.display_name}\u2069`})} ?disabled=${this.#busy} @click=${()=>this.#revokeMember(member)}>${this.i18n.t("workspace.admin.revoke","Revoke")}</button>`:nothing}</td></tr>`)}</tbody></table></div>
      <h3>${this.i18n.t("workspace.admin.pendingInvitations","Pending invitations")}</h3>
      ${invitations.length?html`<div class="workspace-settings-table"><table><caption>${this.i18n.t("workspace.admin.invitationCaption","Private, expiring invitations")}</caption><thead><tr><th scope="col">${this.i18n.t("workspace.admin.email","Email address")}</th><th scope="col">${this.i18n.t("workspace.admin.role","Role")}</th><th scope="col">${this.i18n.t("workspace.admin.expiresAt","Expires")}</th><th scope="col">${this.i18n.t("navigation.actions","Actions")}</th></tr></thead><tbody>${invitations.map((invitation)=>html`<tr><th scope="row"><bdi dir="ltr">${invitation.email_normalized}</bdi></th><td>${this.i18n.t(`workspace.admin.role.${invitation.role}`,invitation.role)}</td><td>${this.i18n.date(new Date(invitation.expires_at),{dateStyle:"medium",timeStyle:"short"})}</td><td>${canManage&&(isOwner||invitation.role!=="administrator")?html`<button type="button" class="button ghost compact" aria-label=${this.i18n.t("workspace.admin.revokeInvitationNamed","Revoke invitation for {email}",{email:`\u2068${invitation.email_normalized}\u2069`})} ?disabled=${this.#busy} @click=${()=>this.#revokeInvitation(invitation)}>${this.i18n.t("workspace.admin.revokeInvitation","Revoke invitation")}</button>`:nothing}</td></tr>`)}</tbody></table></div>`:html`<p>${this.i18n.t("workspace.admin.noPendingInvitations","No invitations are awaiting acceptance.")}</p>`}
    </section>`;
  }

  #projects(){
    const detail=this.#detail,projects=detail?.projects??[],members=detail?.members??[],canManage=detail?.permissions?.includes("workspace.project.manage")??false;
    const personal=this.store.projection.get().projects;
    return html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.projects","Projects")}</h2>${canManage?html`<form class="workspace-settings-form" @submit=${this.#registerProject}><label>${this.i18n.t("workspace.admin.ownedProject","Your project")}<select name="projectId" required><option value="">${this.i18n.t("field.choose","Choose an option")}</option>${personal.map((project)=>html`<option value=${project.id}>${project.name}</option>`)}</select></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.shareProject","Share project")}</button></form>`:nothing}${projects.length?html`<ul class="workspace-settings-project-list">${projects.map((project)=>{const projectMembers=this.#projectMembers.get(project.project_access_id),projectName=project.project_name||this.i18n.t("workspace.admin.unnamedProject","Unnamed project"),canViewAccess=canManage||Boolean(this.#overview?.projects.some((item)=>item.organizationId===detail?.organization.organizationId&&item.projectAccessId===project.project_access_id));return html`<li><header><b dir="auto">${projectName}</b>${canViewAccess?html`<button type="button" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.viewAccessNamed","View access to {name}",{name:projectName})} @click=${()=>void this.#loadProjectMembers(project.project_access_id)}>${this.i18n.t("workspace.admin.viewAccess","View access")}</button>`:nothing}</header>${canManage?html`<form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>this.#grantProject(event,project)}><label>${this.i18n.t("workspace.admin.member","Member")}<select name="userId" required><option value="">${this.i18n.t("field.choose","Choose an option")}</option>${members.filter((member)=>member.status==="active"&&member.role!=="owner").map((member)=>html`<option value=${member.user_id}>${member.display_name}</option>`)}</select></label><label>${this.i18n.t("workspace.admin.role","Role")}<select name="role"><option value="viewer">${this.i18n.t("workspace.admin.role.viewer","Viewer")}</option><option value="editor">${this.i18n.t("workspace.admin.role.editor","Editor")}</option></select></label><button type="submit" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.grantNamed","Grant access to {name}",{name:projectName})} ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.grant","Grant access")}</button></form><p class="workspace-project-role-notice">${this.i18n.t("workspace.admin.editorBudgetNotice","Editors can create outputs using their personal and organization budgets; viewers cannot.")}</p>`:nothing}${projectMembers?html`<ul class="workspace-settings-list">${projectMembers.filter((member)=>member.status==="active").map((member)=>html`<li><div><b dir="auto">${member.display_name}</b>${canManage&&member.role!=="owner"?html`<select aria-label=${this.i18n.t("workspace.admin.projectRoleNamed","Project role for {name}",{name:member.display_name})} .value=${member.role} ?disabled=${this.#busy} @change=${(event:Event)=>this.#updateProjectRole(project.project_access_id,member,(event.currentTarget as HTMLSelectElement).value)}><option value="viewer" ?selected=${member.role==="viewer"}>${this.i18n.t("workspace.admin.role.viewer","Viewer")}</option><option value="editor" ?selected=${member.role==="editor"}>${this.i18n.t("workspace.admin.role.editor","Editor")}</option></select><forma-ui-switch class="workspace-project-canvas-permission" .label=${this.i18n.t("workspace.admin.canvasAccessNamed","Allow Canvas access for {name}",{name:`\u2068${member.display_name}\u2069`})} .help=${this.i18n.t("workspace.admin.canvasAccessHelp","Their project role determines whether they can edit the board.")} .checked=${Boolean(member.canvas_access)} .disabled=${this.#busy} @forma-change=${(event:CustomEvent<{checked:boolean}>)=>{const control=event.currentTarget as HTMLElement&{checked:boolean};const enabled=event.detail.checked;control.checked=Boolean(member.canvas_access);void this.#updateProjectCanvas(project.project_access_id,member,enabled,control);}}></forma-ui-switch>`:html`<span>${this.i18n.t(`workspace.admin.role.${member.role}`,member.role)}</span>`}</div>${canManage&&member.role!=="owner"?html`<button type="button" class="button ghost compact" aria-label=${this.i18n.t("workspace.admin.revokeNamed","Revoke access for {name}",{name:member.display_name})} ?disabled=${this.#busy} @click=${()=>this.#revokeProject(project.project_access_id,member)}>${this.i18n.t("workspace.admin.revoke","Revoke")}</button>`:nothing}</li>`)}</ul>`:nothing}</li>`;})}</ul>`:html`<p>${this.i18n.t("workspace.admin.noRegisteredProjects","No projects have been registered in this organization.")}</p>`}</section>`;
  }

  #usage(){
    const detail=this.#detail,policy=detail?.policy,cost=detail?.cost,tokens=detail?.tokens;
    const used=Number(cost?.used_microusd??0),reserved=Number(cost?.reserved_microusd??0),limit=Number(policy?.microusd_limit??0);
    const format=(value:number)=>new Intl.NumberFormat(this.i18n.locale,{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value/1_000_000);
    const tokenUsed=Number(tokens?.used_tokens??0),tokenReserved=Number(tokens?.reserved_tokens??0),tokenLimit=Number(policy?.token_limit??0);
    return html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.usage","Usage")}</h2><p>${this.i18n.t("workspace.admin.period","Accounting period")}: ${detail?.period??""}</p><dl class="workspace-settings-facts"><dt>${this.i18n.t("workspace.admin.totalLimit","Monthly organization limit")}</dt><dd>${format(limit)}</dd><dt>${this.i18n.t("workspace.admin.settled","Settled spending")}</dt><dd>${format(used)}</dd><dt>${this.i18n.t("workspace.admin.reserved","Active reservations")}</dt><dd>${format(reserved)}</dd><dt>${this.i18n.t("workspace.admin.remaining","Available organization budget")}</dt><dd>${format(Math.max(0,limit-used-reserved))}</dd><dt>${this.i18n.t("workspace.admin.tokens","Organization tokens")}</dt><dd>${this.i18n.number(tokenUsed+tokenReserved)} / ${this.i18n.number(tokenLimit)}</dd></dl><progress max=${Math.max(1,limit)} value=${Math.min(limit,used+reserved)} aria-label=${this.i18n.t("workspace.admin.totalLimit","Monthly organization limit")}></progress><progress max=${Math.max(1,tokenLimit)} value=${Math.min(tokenLimit,tokenUsed+tokenReserved)} aria-label=${this.i18n.t("workspace.admin.tokenUsage","Monthly token usage")}></progress>${policy&&detail?.permissions?.includes("workspace.budget.manage")?html`<form class="workspace-settings-form" @submit=${this.#savePolicy}><label>${this.i18n.t("workspace.admin.usdLimit","Monthly limit (USD)")}<input type="number" name="usdLimit" min="0.01" step="0.01" .value=${String(Number(policy.microusd_limit)/1_000_000)} required></label><label>${this.i18n.t("workspace.admin.tokenLimit","Monthly token limit")}<input type="number" name="tokenLimit" min="1" step="1" .value=${String(policy.token_limit)} required></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.savePolicy","Save limits")}</button></form>`:nothing}</section>`;
  }

  #activity(){
    const audit=this.#detail?.audit??[];
    return html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.activity","Activity")}</h2>${audit.length?html`<ol class="workspace-settings-audit">${audit.map((event)=>html`<li><b>${this.i18n.t(`workspace.admin.audit.${String(event.action)}`,String(event.action).replace(/([a-z])([A-Z])/g,"$1 $2"))}</b>${event.actor_display_name?html`<span dir="auto">${this.i18n.t("workspace.admin.activityBy","By {name}",{name:String(event.actor_display_name)})}</span>`:nothing}<span>${this.i18n.date(new Date(String(event.occurred_at)),{dateStyle:"medium",timeStyle:"short"})}</span></li>`)}</ol>`:html`<p>${this.i18n.t("workspace.admin.noActivity","No organization activity has been recorded.")}</p>`}</section>`;
  }

  override render(){
    const {organizationId,section,invitations}=this.#route();
    const name=this.#detail?.organization.name??this.i18n.t("workspace.admin.heading","Workspaces & collaboration");
    const permissions=new Set(this.#detail?.permissions??[]);
    return html`<section class="workspace-settings-page page-pad" aria-labelledby="workspace-settings-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("workspace.admin.eyebrow","Creator settings")}</span><h1 id="workspace-settings-heading" dir="auto">${name}</h1><p>${this.i18n.t("workspace.admin.description","Manage the organizations, invitations, shared projects, and spending you are authorized to see.")}</p></div>${organizationId&&this.#overview?.organizations.length?html`<label class="workspace-settings-organization-select">${this.i18n.t("workspace.admin.organization","Organization")}<select .value=${organizationId} @change=${(event:Event)=>this.store.setRoute(`/settings/workspaces/${encodeURIComponent((event.currentTarget as HTMLSelectElement).value)}/overview`)}>${this.#overview.organizations.filter((organization)=>Boolean(organization.permissions?.length)).map((organization)=>html`<option value=${organization.organizationId}>${organization.name}</option>`)}</select></label>`:nothing}</header>${this.store.session.get()?.projectContext?html`<aside class="workspace-settings-shared-notice"><span>${this.i18n.t("workspace.admin.sharedProjectMode","You are working inside a shared project.")}</span><button type="button" class="button secondary compact" @click=${()=>void this.store.leaveProjectContext()}>${this.i18n.t("workspace.admin.leaveSharedProject","Return to my projects")}</button></aside>`:nothing}${this.#error?html`<p role="alert" class="workspace-settings-error">${this.#error}</p>`:nothing}<p class="sr-only" role="status" aria-live="polite">${this.#notice}</p>${organizationId&&this.#detail?html`${this.#sectionLinks(organizationId,section)}${section==="members"?this.#members():section==="projects"?this.#projects():section==="usage"?this.#usage():section==="activity"?this.#activity():html`<div class="workspace-settings-grid">${permissions.has("workspace.member.read")?this.#members():nothing}${permissions.has("workspace.project.read")?this.#projects():nothing}${!permissions.has("workspace.member.read")&&!permissions.has("workspace.project.read")?html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.overview","Overview")}</h2><p>${this.i18n.t("workspace.admin.description","Manage the organizations, invitations, shared projects, and spending you are authorized to see.")}</p></section>`:nothing}</div>`}`:organizationId?html`<p role="status">${this.i18n.t("status.loading","Loading")}</p>`:invitations?this.#invitations():this.#landing()}</section>`;
  }
}

if(!customElements.get("forma-workspace-settings"))customElements.define("forma-workspace-settings",FormaWorkspaceSettings);

declare global{interface HTMLElementTagNameMap{"forma-workspace-settings":FormaWorkspaceSettings;}}
