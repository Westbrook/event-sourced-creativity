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
type Member={membership_id:string;user_id:string;display_name:string;email?:string;role:string;status:string;canvas_access?:number|boolean;review_access?:number|boolean};
type Project={project_access_id:string;project_id:string;project_name:string;owner_user_id:string;status:string};
type PendingInvitation={invitation_id:string;email_normalized:string;role:string;status:string;expires_at:string};
type WorkspaceOverview={organizations:Organization[];projects:SharedProject[];invitations:Invitation[]};
type WorkspaceOutcomes={activatedCreators:number;approvedDeliverables:number;releasedApprovedDeliverables:number;pendingReviews:number;adoptedContextPackages:number;averageReviewMinutes:number|null;settledCostPerApprovedDeliverableMicrousd:number|null};
type WorkspaceDetail={organization:Organization;members?:Member[];projects?:Project[];permissions?:string[];invitations?:PendingInvitation[];audit?:Array<Record<string,unknown>>;policy?:Record<string,unknown>|null;cost?:Record<string,unknown>|null;tokens?:Record<string,unknown>|null;period?:string;reservations?:Array<Record<string,unknown>>;outcomes?:WorkspaceOutcomes};
type PilotParticipant={participant_id:string;email_normalized:string;user_id:string|null;role:string;status:string;created_at:string;revoked_at:string|null;used_microusd?:number|null;reserved_microusd?:number|null;hard_limit_microusd?:number|null};
type PilotCounter={used_microusd:number;reserved_microusd:number;hard_limit_microusd:number};
type PilotDetail={cohort:{cohort_id:string;status:string;starts_at:string;ends_at:string;max_participants:number;participant_cap_microusd:number;organization_cap_microusd:number;source_classification:string}|null;participants:PilotParticipant[];organizationBudget:PilotCounter|null;participantBudget:PilotCounter|null;maintenance:{status:string;started_at:string;finished_at:string|null;error_code:string|null}|null};
type RetentionDetail={policy:{transient_days:number;evidence_days:number;revision_days:number;legal_hold:number;version:number;updated_at:string}|null;appliesTo:string};
type OrganizationPackage={id:string;name:string;description:string;version:number|null;versionId:string|null;versionStatus?:string|null;createdByUserId?:string|null;pendingDraftVersionId?:string|null;pendingDraftVersion?:number|null;canApprove?:boolean;draftPreview?:Array<{handle:string;type:string;text:string;locked:boolean;intent:string;active:boolean;exactText:string|null;exactPlacements:string[];protectedPhrases:Array<{text:string;placement:string|null}>;relations:Array<{kind:string;targetHandle:string}>;sourceName:string|null;rightsExpiresAt:string|null}>;blockCount:number;bindingCount:number;publishedAt:string|null};
type SecurityPosture={policy:{authenticationSource:string;allowedEmailDomains:string[];encryptionMode:string;maxSessionMinutes:number;version:number};observedSignInSource:string;domainOwnershipVerified:boolean;mfaAttestationAvailable:boolean;encryption:{recoverySnapshots:string;primaryDatabaseAndObjectStorage:string;externalCustomerManagedKeys:boolean}};
type AssuranceDetail={retention:{pendingCount:number;heldCount:number;oldestExpiredAt:string|null};scheduler:{state:string;hostingScheduleVerified:boolean;lastScheduledAt:string|null};packages:{activeCount:number;sourceFileCustody:string};reviews:{pendingCount:number};controls:Array<{id:string;status:string;summary:string}>;enterpriseReady:boolean;enterpriseBlockers:string[]};
type LegalHold={hold_id:string;scope_kind:string;resource_id:string;reason:string;status:string;created_at:string};
type RecoverySnapshot={snapshot_id:string;created_at:string;status:string;key_id:string;manifest_json:string};
type ProvisioningCredential={id:string;status:string;createdAt:string;revokedAt:string|null};
type AutomationPolicy={enabled:boolean;notifyContextChanges:boolean;notifyOutputReady:boolean;reviewDueHours:number;reminderHours:number;version:number};
type DeletionInventory={projectCount:number;mediaCount:number;packageCount:number;revisionCount:number;privateEventBodyCount:number};

const sections=["overview","members","projects","usage","activity"] as const;
type WorkspaceSection=typeof sections[number];

/** Scoped customer organization management remains a Creator Settings task, never a seventh application. */
export class FormaWorkspaceSettings extends FormaElement{
  #overview:WorkspaceOverview|null=null;
  #detail:WorkspaceDetail|null=null;
  #pilot:PilotDetail|null=null;
  #retention:RetentionDetail|null=null;
  #packages:OrganizationPackage[]=[];
  #assurance:AssuranceDetail|null=null;
  #security:SecurityPosture|null=null;
  #holds:LegalHold[]=[];
  #snapshots:RecoverySnapshot[]=[];
  #credentials:ProvisioningCredential[]=[];
  #automation=new Map<string,AutomationPolicy>();
  #deletionInventory:DeletionInventory|null=null;
  #deletionJob:{job_id:string;status:string}|null=null;
  #freshProvisioningToken:string|null=null;
  #projectMembers=new Map<string,Member[]>();
  #busy=false;
  #error="";
  #notice="";
  #loadedRoute="";
  #loadedOrganization="";
  #loadRevision=0;
  #freshInvitation:{url:string;email:string;expiresAt:string;organizationId:string;authorization:CapturedAuthorizationScope}|null=null;
  #clearInvitation=()=>{this.#freshInvitation=null;this.#freshProvisioningToken=null;this.requestUpdate();};

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

  async #request<T>(url:string,init:RequestInit={},selectedResponse?:Response){
    const response=selectedResponse??await fetch(url,{credentials:"same-origin",...init});
    const body=await response.json() as T&{error?:string;retryable?:boolean;status?:string};
    if(!response.ok){const key=String(body.error??"");throw Object.assign(new Error(this.i18n.t(`workspace.admin.error.${key}`,this.i18n.t("workspace.admin.unavailable","This workspace is unavailable."))),{retryable:body.retryable===true||body.status==="partial",status:response.status,code:key});}
    return body;
  }

  async #load(){
    const route=routePathname(this.store.route.get());
    this.#loadedRoute=route;
    const revision=++this.#loadRevision;
    const nextOrganization=this.#route().organizationId;
    if(nextOrganization!==this.#loadedOrganization){
      this.#loadedOrganization=nextOrganization;this.#detail=null;this.#pilot=null;this.#retention=null;this.#packages=[];this.#assurance=null;this.#security=null;this.#holds=[];this.#snapshots=[];this.#credentials=[];this.#automation.clear();this.#deletionInventory=null;this.#deletionJob=null;this.#freshProvisioningToken=null;this.#projectMembers.clear();this.#freshInvitation=null;this.#notice="";this.#error="";this.requestUpdate();
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
        const permissions=new Set(base.permissions??[]);
        if(permissions.has("workspace.usage.read")||permissions.has("workspace.policy.manage")){
          const [pilot,retention]=await Promise.all([this.#request<PilotDetail>(`${endpoint}/pilot`),permissions.has("workspace.policy.manage")?this.#request<RetentionDetail>(`${endpoint}/retention`):Promise.resolve(null)]);
          if(revision!==this.#loadRevision)return;
          this.#pilot=pilot;this.#retention=retention;
        }else{this.#pilot=null;this.#retention=null;}
        const owner=base.organization.role==="owner",manages=permissions.has("workspace.policy.manage");
        const [packages,assurance,security,holds,recovery,credentials,deletion]=await Promise.all([
          this.#request<{packages:OrganizationPackage[]}>(`${endpoint}/context-packages`),
          permissions.has("workspace.audit.read")?this.#request<AssuranceDetail>(`${endpoint}/assurance`):Promise.resolve(null),
          owner?this.#request<SecurityPosture>(`${endpoint}/security`):Promise.resolve(null),
          manages?this.#request<{holds:LegalHold[]}>(`${endpoint}/holds`):Promise.resolve(null),
          owner?this.#request<{snapshots:RecoverySnapshot[]}>(`${endpoint}/recovery`):Promise.resolve(null),
          owner?this.#request<{credentials:ProvisioningCredential[]}>(`${endpoint}/security/provisioning-credentials`):Promise.resolve(null),
          owner?this.#request<{inventory:DeletionInventory;job:{job_id:string;status:string}|null}>(`${endpoint}/deletion`):Promise.resolve(null),
        ]);
        if(revision!==this.#loadRevision)return;
        this.#packages=packages.packages;this.#assurance=assurance;this.#security=security;
        this.#holds=holds?.holds??[];this.#snapshots=recovery?.snapshots??[];this.#credentials=credentials?.credentials??[];this.#deletionInventory=deletion?.inventory??null;this.#deletionJob=deletion?.job??null;
        const eligible=overview.projects.filter((project)=>project.organizationId===organizationId&&(
          manages||project.role==="owner"));
        const policies=await Promise.all(eligible.map(async(project)=>{
          try{return[project.projectAccessId,(await this.#request<{policy:AutomationPolicy}>(`${endpoint}/projects/${encodeURIComponent(project.projectAccessId)}/automation`)).policy] as const;}
          catch{return null;}
        }));
        if(revision!==this.#loadRevision)return;
        this.#automation=new Map(policies.filter((policy):policy is readonly[string,AutomationPolicy]=>Boolean(policy)));
      }else this.#detail=null;
      this.#error="";
    }catch(error){
      if(revision!==this.#loadRevision)return;
      const organization=this.#overview?.organizations.find((candidate)=>candidate.organizationId===nextOrganization&&candidate.role==="owner");
      if(organization){
        try{
          const deletion=await this.#request<{inventory:DeletionInventory;job:{job_id:string;status:string}|null}>(`/api/workspaces/${encodeURIComponent(nextOrganization)}/deletion`);
          if(revision!==this.#loadRevision)return;
          if(deletion.job&&["pending","partial","processing"].includes(deletion.job.status)){
            this.#detail={organization,permissions:[]};this.#deletionInventory=deletion.inventory;this.#deletionJob=deletion.job;this.#error="";this.requestUpdate();return;
          }
        }catch{/* Preserve the original authorization-safe workspace failure. */}
      }
      this.#error=error instanceof Error?error.message:"workspace_unavailable";this.#detail=null;
    }
    this.requestUpdate();
  }

  async #mutate(description:string,action:()=>Promise<void|false>,current?:()=>boolean){
    if(this.#busy||current&&!current())return;
    this.#busy=true;this.#error="";this.requestUpdate();
    try{const completed=await action();if(completed===false||current&&!current())return;this.#notice=description;await this.store.refreshSession();if(current&&!current())return;await this.#load();}
    catch(error){
      if(current&&!current())return;
      const message=error instanceof Error?error.message:"workspace_mutation_failed";
      if(error instanceof Error&&(error as Error&{retryable?:boolean}).retryable)await this.#load();
      this.#error=message;
    }
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

  async #updateProjectReviewer(projectAccessId:string,member:Member,enabled:boolean,control?:HTMLElement){
    const {organizationId}=this.#route();
    const restoreFocus=Boolean(control?.contains(document.activeElement));
    await this.#mutate(this.i18n.t("workspace.admin.reviewAccessUpdated","Independent approval access was updated."),async()=>{
      try{
        await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/members/${encodeURIComponent(member.membership_id)}`,{
          method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({reviewAccess:enabled}),
        });
      }catch(error){await this.#loadProjectMembers(projectAccessId).catch(()=>{});throw error;}
      await this.#loadProjectMembers(projectAccessId);
    });
    if(restoreFocus){await this.updateComplete;control?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({preventScroll:true});}
  }

  #openProject(project:{organizationId:string;projectAccessId:string}){
    if(this.#busy)return;
    const selection=this.store.beginProjectContextSelection();
    void this.#mutate(this.i18n.t("workspace.admin.projectOpened","Shared project opened."),async()=>{
      const response=await selection.request(project);if(!response||!selection.sourceCurrent())return false;
      await this.#request("",{},response);if(!selection.sourceCurrent())return false;
      await this.store.refreshSession();if(!selection.current())return false;
      this.store.setRoute("/projects");await this.store.load();
    },selection.current);
  }

  #savePolicy(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route();
    void this.#mutate(this.i18n.t("workspace.admin.policySaved","Workspace budget policy was updated."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/policy`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({tokenLimit:Number(data.get("tokenLimit")),microusdLimit:Math.round(Number(data.get("usdLimit"))*1_000_000)})});
    });
  }

  #configurePilot(event:SubmitEvent){
    event.preventDefault();const data=new FormData(event.currentTarget as HTMLFormElement),{organizationId}=this.#route();
    void this.#mutate("The controlled pilot is active for named participants only.",async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/pilot`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({maxParticipants:Number(data.get("participants")),participantCapMicrousd:Math.round(Number(data.get("participantUsd"))*1_000_000),organizationCapMicrousd:Math.round(Number(data.get("organizationUsd"))*1_000_000),evidenceDays:Number(data.get("evidenceDays"))})});
    });
  }

  #enrollPilot(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route();
    void this.#mutate("The named participant was enrolled in this pilot.",async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/pilot/participants`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:String(data.get("email")??""),role:String(data.get("role")??"member")})});form.reset();
    });
  }

  #revokePilot(participant:PilotParticipant){
    const {organizationId}=this.#route();void this.#mutate("The participant's controlled-pilot access was revoked.",async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/pilot/participants/${encodeURIComponent(participant.participant_id)}`,{method:"DELETE"});
    });
  }

  #setPilotStatus(status:"active"|"paused"|"closed"){
    const {organizationId}=this.#route();void this.#mutate(status==="active"?"Paid pilot work resumed.":status==="closed"?"This pilot is closed. Start a replacement cohort when the team is ready.":"Paid pilot work paused; existing work remains readable.",async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/pilot`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status})});
    });
  }

  #saveRetention(event:SubmitEvent){
    event.preventDefault();const data=new FormData(event.currentTarget as HTMLFormElement),{organizationId}=this.#route();
    void this.#mutate("Future project content will follow the updated retention periods.",async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/retention`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({transientDays:Number(data.get("transientDays")),evidenceDays:Number(data.get("evidenceDays")),revisionDays:Number(data.get("revisionDays")),legalHold:data.get("legalHold")==="on"})});
    });
  }

  #pilotControls(){
    const detail=this.#detail,pilot=this.#pilot,permissions=new Set(detail?.permissions??[]),manages=permissions.has("workspace.policy.manage"),managesMembers=permissions.has("workspace.member.manage");
    if(!detail||!pilot||!permissions.has("workspace.usage.read")&&!manages)return nothing;
    const format=(value:number)=>new Intl.NumberFormat(this.i18n.locale,{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value/1_000_000);
    if(!pilot.cohort||pilot.cohort.status==="closed")return manages&&detail.organization.role==="owner"?html`<section class="workspace-settings-card workspace-pilot-card"><h2>Controlled pilot${pilot.cohort?.status==="closed"?" " + this.i18n.system("· Closed"):""}</h2><p>${pilot.cohort?.status==="closed"?this.i18n.system("The previous pilot is closed. Paid work remains blocked until the organization owner explicitly starts a new controlled cohort."):this.i18n.system("Opt this organization into named-participant access, a fixed whole-pilot spending envelope, and prospective project-specific retention. Existing organizations remain unrestricted until you enable their pilot.")}</p><form class="workspace-settings-form" @submit=${this.#configurePilot}><label>Maximum participants<input type="number" name="participants" min="2" max="100" value="10" required></label><label>Per-person limit for entire pilot (USD)<input type="number" name="participantUsd" min="0.01" max="15" step="0.01" value="15" required></label><label>Organization limit for entire pilot (USD)<input type="number" name="organizationUsd" min="0.01" max="150" step="0.01" value="150" required></label><label>Evidence retention (days)<input type="number" name="evidenceDays" min="1" max="3650" value="365" required></label><button type="submit" class="button primary compact" ?disabled=${this.#busy}>${pilot.cohort?.status==="closed"?this.i18n.system("Start replacement pilot"):this.i18n.system("Enable controlled pilot")}</button></form><small>Each cohort starts immediately and lasts 30 days. Reserve at least one seat for an independent reviewer. Use only non-sensitive source material your team is licensed to provide.</small></section>`:pilot.cohort?.status==="closed"?html`<section class="workspace-settings-card"><h2>Controlled pilot · Closed</h2><p>Paid work stays blocked until the organization owner explicitly starts a replacement cohort.</p></section>`:nothing;
    const cohort=pilot.cohort,organization=pilot.organizationBudget,participant=pilot.participantBudget,active=pilot.participants.filter((candidate)=>candidate.status==="active");
    const policy=this.#retention?.policy;
    const now=Date.now(),state=Date.parse(cohort.ends_at)<=now?"Expired":Date.parse(cohort.starts_at)>now?"Upcoming":cohort.status==="paused"?"Paused":"Active";
    return html`<section class="workspace-settings-card workspace-pilot-card"><header><h2>Controlled pilot · ${this.i18n.system(state)}</h2>${manages&&state!=="Expired"?html`<button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${()=>this.#setPilotStatus(cohort.status==="paused"?"active":"paused")}>${cohort.status==="paused"?this.i18n.system("Resume paid work"):this.i18n.system("Pause paid work")}</button>`:nothing}${manages&&detail.organization.role==="owner"?html`<button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>this.#setPilotStatus("closed")}>Close pilot</button>`:nothing}</header><p>${new Intl.DateTimeFormat(this.i18n.locale,{dateStyle:"medium"}).format(new Date(cohort.starts_at))} – ${new Intl.DateTimeFormat(this.i18n.locale,{dateStyle:"medium"}).format(new Date(cohort.ends_at))} · ${active.length} of ${cohort.max_participants} named participants</p><dl class="workspace-settings-facts"><dt>Whole-pilot organization limit</dt><dd>${format(Number(organization?.hard_limit_microusd??cohort.organization_cap_microusd))}</dd><dt>Whole-pilot organization committed</dt><dd>${format(Number(organization?.used_microusd??0)+Number(organization?.reserved_microusd??0))}</dd><dt>Your whole-pilot limit</dt><dd>${format(Number(participant?.hard_limit_microusd??cohort.participant_cap_microusd))}</dd><dt>Your whole-pilot committed</dt><dd>${format(Number(participant?.used_microusd??0)+Number(participant?.reserved_microusd??0))}</dd></dl><progress max=${Math.max(1,Number(organization?.hard_limit_microusd??cohort.organization_cap_microusd))} value=${Math.min(Number(organization?.hard_limit_microusd??cohort.organization_cap_microusd),Number(organization?.used_microusd??0)+Number(organization?.reserved_microusd??0))} aria-label="Whole-pilot organization spending"></progress><small>Unexpected provider charges remain visible and automatically pause additional paid work when the pilot limit is exceeded.</small>${managesMembers?html`<form class="workspace-settings-form" @submit=${this.#enrollPilot}><label>Named participant email<input name="email" type="email" required autocomplete="email"></label><label>Pilot role<select name="role"><option value="member">Author</option><option value="reviewer">Reviewer · no paid generation</option></select></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy||active.length>=cohort.max_participants}>Enroll participant</button></form><small>Invite each reviewer to the organization, add them to the relevant project as a Viewer, then enable their independent approval permission under Projects.</small>`:nothing}${active.length?html`<ul class="workspace-settings-list">${active.map((person)=>html`<li><div><b dir="auto">${person.email_normalized}</b><span>${person.role}${manages&&person.hard_limit_microusd!==null&&person.hard_limit_microusd!==undefined?" " + this.i18n.system("· {formatted} of {formatted2}", { formatted: format(Number(person.used_microusd??0)+Number(person.reserved_microusd??0)), formatted2: format(Number(person.hard_limit_microusd)) }):""}</span></div>${managesMembers&&person.role!=="owner"?html`<button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>this.#revokePilot(person)}>Revoke</button>`:nothing}</li>`)}</ul>`:nothing}${policy&&manages?html`<form class="workspace-settings-form" @submit=${this.#saveRetention}><label>Transient project content (days)<input type="number" name="transientDays" min="1" max="3650" .value=${String(policy.transient_days)} required></label><label>Generation evidence (days)<input type="number" name="evidenceDays" min="1" max="3650" .value=${String(policy.evidence_days)} required></label><label>Recoverable output history (days)<input type="number" name="revisionDays" min="1" max="3650" .value=${String(policy.revision_days)} required></label><label><input type="checkbox" name="legalHold" .checked=${Boolean(policy.legal_hold)}> Preserve governed evidence and output history under legal hold</label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>Save future retention policy</button></form><small>Policy version ${policy.version}. Retention changes apply only to newly written content; a legal hold protects existing governed evidence. Uploaded original files and media are not removed by this policy.</small>`:nothing}<p>${pilot.maintenance?this.i18n.system("Last installation-wide scheduled cleanup: {status} on {formatted}.", { status: pilot.maintenance.status, formatted: new Intl.DateTimeFormat(this.i18n.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(pilot.maintenance.started_at)) }):this.i18n.system("No scheduled cleanup has run yet. A hosting schedule is not configured by this local implementation.")}</p></section>`;
  }

  #saveSecurity(event:SubmitEvent){
    event.preventDefault();const data=new FormData(event.currentTarget as HTMLFormElement),{organizationId}=this.#route();
    const domains=String(data.get("allowedDomains")??"").split(/[\s,]+/).map((domain)=>domain.trim().toLowerCase()).filter(Boolean);
    void this.#mutate("Organization identity policy was updated and existing shared sessions were closed.",async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/security`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({authenticationSource:String(data.get("authenticationSource")??"any"),allowedEmailDomains:domains,maxSessionMinutes:Number(data.get("maxSessionMinutes")),expectedVersion:this.#security?.policy.version??0})});
    });
  }

  #reviewQueue(){
    const {organizationId}=this.#route();
    const tasks=this.store.reviewInbox.get().filter((task)=>!organizationId||task.organizationId===organizationId);
    if(!tasks.length)return nothing;
    return html`<section class="workspace-settings-card" aria-labelledby="workspace-assigned-review-heading"><h2 id="workspace-assigned-review-heading">Needs my review</h2><p>Only outputs assigned to your current independent reviewer permission appear here.</p><ul class="workspace-settings-list">${tasks.map((task)=>html`<li><div><b dir="auto">${task.artifactTitle||this.i18n.system("Finished output")} · revision ${task.revision}</b><span dir="auto">${[task.projectName,task.documentTitle].filter(Boolean).join(" · ")||task.organizationName}</span><span>Requested by ${task.requestedByName}${task.dueAt?" " + this.i18n.system("· due {value}", { value: this.i18n.date(new Date(task.dueAt),{dateStyle:"medium",timeStyle:"short"}) }):""}</span></div><button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${()=>void this.store.openAssignedReview(task)}>Open exact output</button></li>`)}</ul></section>`;
  }

  #contextPackages(){
    const context=this.store.session.get()?.projectContext,{organizationId}=this.#route();
    const source=context?.organizationId===organizationId&&context.permissions.includes("project.library.manage")&&this.store.projection.get().documentId;
    const manages=this.#detail?.permissions?.includes("workspace.policy.manage")||this.#detail?.permissions?.includes("workspace.project.manage");
    return html`<section class="workspace-settings-card" aria-labelledby="workspace-context-package-heading"><h2 id="workspace-context-package-heading">${this.i18n.system("Organization context")}</h2><p>${this.i18n.system("Approved decisions belong to this organization. Every document chooses an exact immutable version.")}</p>${this.#packages.length?html`<ul class="workspace-settings-list">${this.#packages.map((item)=>html`<li><div><b dir="auto">${item.name}</b><span>${item.version===null?this.i18n.t("workspace.context.awaiting"):this.i18n.system("Version {version}",{version:this.i18n.number(item.version)})}${item.pendingDraftVersionId?` · ${this.i18n.t("workspace.context.awaiting")}`:""} · ${this.i18n.system("{blockCount} reusable creative decisions",{blockCount:this.i18n.number(item.blockCount)})} · ${this.i18n.t("workspace.context.documents","",{count:this.i18n.number(item.bindingCount)})}</span>${item.pendingDraftVersionId&&item.draftPreview?.length?html`<details><summary>${this.i18n.t("workspace.context.review")}</summary><ul>${item.draftPreview.map((decision)=>html`<li><b dir="auto">${decision.handle}</b><small>${this.i18n.t(`workspace.context.intent.${decision.intent}`)} · ${this.i18n.t(decision.active?"workspace.context.active":"workspace.context.inactive")}${decision.locked?` · ${this.i18n.system("Locked")}`:""}</small>${decision.text?html`<pre dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${decision.text}</pre>`:nothing}${decision.exactText?html`<small>${this.i18n.t("workspace.context.exact")}</small><pre dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${decision.exactText}</pre>`:nothing}${decision.exactPlacements.length?html`<small>${this.i18n.t("workspace.context.placements")}: ${decision.exactPlacements.map((placement)=>this.i18n.t(`workspace.context.placement.${placement}`,placement)).join(", ")}</small>`:nothing}${decision.protectedPhrases.map((phrase)=>html`<small>${this.i18n.t("workspace.context.exact")}${phrase.placement?` · ${this.i18n.t(`workspace.context.placement.${phrase.placement}`,phrase.placement)}`:""}</small><pre dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${phrase.text}</pre>`)}${decision.relations.map((relation)=>html`<small>${this.i18n.t("workspace.context.relationship")}: ${this.i18n.t(`workspace.context.relation.${relation.kind}`,relation.kind)} → ${relation.targetHandle}</small>`)}${decision.sourceName?html`<small dir="auto">${decision.sourceName}${decision.rightsExpiresAt?` · ${decision.rightsExpiresAt}`:""}</small>`:nothing}</li>`)}</ul>${item.canApprove?html`<form @submit=${async(event:SubmitEvent)=>{event.preventDefault();if(await this.store.approveOrganizationContextPackage(item.id,item.pendingDraftVersionId!,organizationId))await this.#load();}}><label><input type="checkbox" required> ${this.i18n.system("I reviewed these decisions, sources, and changes to finished outputs.")}</label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.context.approve")}</button></form>`:nothing}</details>`:nothing}</div>${source&&item.versionId?html`<button type="button" class="button secondary compact" @click=${()=>void this.store.adoptOrganizationContextPackage(item.id,item.versionId!)}>${this.i18n.t("workspace.context.use")}</button>`:nothing}</li>`)}</ul>`:html`<p>${this.i18n.system("No approved organization context has been published.")}</p>`}${source&&manages?html`<button type="button" class="button secondary compact" @click=${()=>this.store.setRoute("/library")}>${this.i18n.system("Choose exact decisions and licensed sources in the Library")}</button>`:nothing}<small>${this.i18n.system("Explicitly approved original files, verified citations, and rights are copied into independent organizational custody and into each authorized destination.")}</small></section>`;
  }

  #securityControls(){
    const security=this.#security;if(!security)return nothing;
    return html`<section class="workspace-settings-card"><h2>Identity & storage controls</h2><p>Current sign-in source: <b>${security.observedSignInSource}</b>. Email domains are allowlisted, not independently verified.</p><form class="workspace-settings-form" @submit=${this.#saveSecurity}><label>Allowed email domains<input name="allowedDomains" .value=${security.policy.allowedEmailDomains.join(", ")} placeholder="example.com, example.org"></label><label>Observed sign-in source<select name="authenticationSource" .value=${security.policy.authenticationSource}><option value="any">Any available platform identity</option><option value="openai-workspace">OpenAI workspace identity</option><option value="cloudflare-access">Cloudflare Access email</option><option value="local-development">Local development identity</option></select></label><label>Maximum project session (minutes, 480 maximum)<input type="number" min="5" max="480" name="maxSessionMinutes" .value=${String(security.policy.maxSessionMinutes)} required></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>Save identity policy</button></form><dl class="workspace-settings-facts"><dt>Encrypted recovery snapshots</dt><dd>${security.encryption.recoverySnapshots}</dd><dt>Primary storage application encryption</dt><dd>${security.encryption.primaryDatabaseAndObjectStorage}</dd><dt>Verified SSO, MFA, and customer-managed keys</dt><dd>Not available</dd></dl></section>`;
  }

  #assuranceControls(){
    const report=this.#assurance,{organizationId}=this.#route();if(!report)return nothing;
    return html`<section class="workspace-settings-card"><h2>Trust & operational readiness</h2><dl class="workspace-settings-facts"><dt>Enterprise purchase readiness</dt><dd>${report.enterpriseReady?this.i18n.system("Ready"):this.i18n.system("External verification still required")}</dd><dt>Scheduled retention</dt><dd>${report.scheduler.state}${report.scheduler.hostingScheduleVerified?"":" " + this.i18n.system("· hosting schedule unverified")}</dd><dt>Expired tenant records awaiting cleanup</dt><dd>${report.retention.pendingCount}</dd><dt>Records protected by legal hold</dt><dd>${report.retention.heldCount}</dd><dt>Independent reviews awaiting action</dt><dd>${report.reviews.pendingCount}</dd><dt>Versioned organization context</dt><dd>${report.packages.activeCount}</dd></dl><details><summary>${report.enterpriseBlockers.length} controls still require external evidence or further implementation</summary><ul class="workspace-settings-list">${report.controls.map((control)=>html`<li><div><b>${control.id.replaceAll("-"," ")} · ${control.status}</b><span>${control.summary}</span></div></li>`)}</ul></details><a class="button secondary compact" href=${`/api/workspaces/${encodeURIComponent(organizationId)}/assurance/export`} download>Download sanitized assurance evidence</a></section>`;
  }

  #retentionControls(){
    if(!this.#detail?.permissions?.includes("workspace.policy.manage"))return nothing;
    const policy=this.#retention?.policy;
    return html`<section class="workspace-settings-card"><h2>Retention & scoped legal holds</h2>
      <p>Set prospective project retention separately from controlled-pilot enrollment. Scoped holds prevent cleanup and organization deletion.</p>
      <form class="workspace-settings-form" @submit=${this.#saveRetention}>
        <label>Transient project content (days)<input type="number" name="transientDays" min="1" max="3650" .value=${String(policy?.transient_days??30)} required></label>
        <label>Generation evidence (days)<input type="number" name="evidenceDays" min="1" max="3650" .value=${String(policy?.evidence_days??365)} required></label>
        <label>Recoverable output history (days)<input type="number" name="revisionDays" min="1" max="3650" .value=${String(policy?.revision_days??365)} required></label>
        <label><input type="checkbox" name="legalHold" .checked=${Boolean(policy?.legal_hold)}> Preserve all governed evidence and output history</label>
        <button type="submit" class="button secondary compact" ?disabled=${this.#busy}>Save retention policy</button>
      </form>
      <form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>{
        event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),organizationId=this.#route().organizationId;
        void this.#mutate("The exact organization evidence is protected by an active legal hold.",async()=>{
          await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/holds`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scope:String(data.get("scope")??"organization"),resourceId:String(data.get("resourceId")??""),reason:String(data.get("reason")??"")})});form.reset();
        });
      }}>
        <label>Hold scope<select name="scope"><option value="organization">Entire organization</option><option value="project">Project access ID</option><option value="content">Exact evidence content ID</option><option value="artifact">Exact finished output ID</option></select></label>
        <label>Project, evidence, or output identifier<input name="resourceId" placeholder="Not required for the entire organization"></label>
        <label>Reason for preserving this evidence<input name="reason" maxlength="300" required></label>
        <button type="submit" class="button secondary compact" ?disabled=${this.#busy}>Place scoped legal hold</button>
      </form>
      ${this.#holds.filter((hold)=>hold.status==="active").length?html`<ul class="workspace-settings-list">${this.#holds.filter((hold)=>hold.status==="active").map((hold)=>html`<li><div><b>${hold.scope_kind} hold</b><span dir="auto">${hold.reason}</span></div><button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>{if(!window.confirm(this.i18n.system("Release this legal hold? Eligible expired evidence can then be removed.")))return;const organizationId=this.#route().organizationId;void this.#mutate("The selected legal hold was explicitly released.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/holds/${encodeURIComponent(hold.hold_id)}`,{method:"DELETE"});});}}>Release hold</button></li>`)}</ul>`:html`<small>No scoped legal holds are active.</small>`}
    </section>`;
  }

  #automationControls(){
    if(!this.#automation.size)return nothing;
    const organizationId=this.#route().organizationId;
    return html`<section class="workspace-settings-card"><h2>Review scheduling & in-app automation</h2><p>Notifications stay inside Forma. Automation never approves work, contacts an external provider, or spends money.</p>
      ${[...this.#automation.entries()].map(([projectAccessId,policy])=>{
        const name=this.#detail?.projects?.find((project)=>project.project_access_id===projectAccessId)?.project_name
          ??this.#overview?.projects.find((project)=>project.projectAccessId===projectAccessId)?.projectName??"Shared project";
        return html`<form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>{
          event.preventDefault();const data=new FormData(event.currentTarget as HTMLFormElement);
          void this.#mutate("Project-specific review scheduling and notifications were updated.",async()=>{
            await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/automation`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({enabled:data.get("enabled")==="on",notifyContextChanges:data.get("notifyContextChanges")==="on",notifyOutputReady:data.get("notifyOutputReady")==="on",reviewDueHours:Number(data.get("reviewDueHours")),reminderHours:Number(data.get("reminderHours")),expectedVersion:policy.version})});
          });
        }}><h3 dir="auto">${name}</h3>
          <label><input type="checkbox" name="enabled" .checked=${policy.enabled}> Enable safe in-app automation</label>
          <label><input type="checkbox" name="notifyContextChanges" .checked=${policy.notifyContextChanges}> Notify project editors about context changes</label>
          <label><input type="checkbox" name="notifyOutputReady" .checked=${policy.notifyOutputReady}> Notify project editors when outputs are ready</label>
          <label>Review becomes due after (hours)<input type="number" name="reviewDueHours" min="1" max="720" .value=${String(policy.reviewDueHours)} required></label>
          <label>Remind assigned reviewer before due time (hours)<input type="number" name="reminderHours" min="1" max="720" .value=${String(policy.reminderHours)} required></label>
          <button type="submit" class="button secondary compact" ?disabled=${this.#busy}>Save project automation</button>
          <a class="button ghost compact" href=${`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/automation/runs`} target="_blank" rel="noopener">Inspect bounded delivery history</a>
        </form>`;
      })}
    </section>`;
  }

  #recoveryControls(){
    if(this.#detail?.organization.role!=="owner"||!this.#security)return nothing;
    const organizationId=this.#route().organizationId,configured=this.#security.encryption.recoverySnapshots!=="not-configured";
    return html`<section class="workspace-settings-card"><h2>Encrypted recovery evidence</h2><p>${this.i18n.system("Encrypted recovery snapshots")} · ${this.i18n.system("Verify integrity")} · ${this.i18n.system("Keep isolated")}</p>
      <div class="family-actions"><button type="button" class="button secondary compact" ?disabled=${this.#busy||!configured} @click=${()=>{if(!window.confirm(this.i18n.system("Create an encrypted snapshot of every project you are authorized to read?")))return;void this.#mutate("An encrypted, tenant-scoped recovery snapshot was created.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/recovery`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"create",confirmation:"CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"})});});}}>Create encrypted snapshot</button>
      <button type="button" class="button ghost compact" ?disabled=${this.#busy||!configured} @click=${()=>{if(!window.confirm(this.i18n.system("Rotate this organization's recovery key? Existing snapshots remain decryptable.")))return;void this.#mutate("The tenant recovery encryption key was safely rotated.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/security/keys/rotate`,{method:"POST"});});}}>Rotate recovery key</button></div>
      ${!configured?html`<small>An external 32-byte development root is required before encrypted snapshots are available.</small>`:nothing}
      ${this.#snapshots.length?html`<ul class="workspace-settings-list">${this.#snapshots.map((snapshot)=>html`<li><div><b>${this.i18n.date(new Date(snapshot.created_at),{dateStyle:"medium",timeStyle:"short"})}</b><span>${snapshot.status} · encrypted recovery evidence</span></div><button type="button" class="button secondary compact" ?disabled=${this.#busy||!configured||snapshot.status!=="available"} @click=${()=>void this.#mutate("The encrypted snapshot and its scoped evidence passed an integrity drill.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/recovery`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"drill",snapshotId:snapshot.snapshot_id,confirmation:"VERIFY_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"})});})}>Verify integrity</button><button type="button" class="button ghost compact" ?disabled=${this.#busy||!configured||snapshot.status!=="available"} @click=${()=>{if(!window.confirm(`${this.i18n.system("Restore")} · ${this.i18n.system("Keep isolated")}`))return;void this.#mutate("The encrypted recovery snapshot was staged in isolation and completely rolled back without changing production data.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/recovery`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"restore",snapshotId:snapshot.snapshot_id,organizationId,confirmation:"RESTORE_ORGANIZATION_SNAPSHOT_TO_ISOLATED_ROLLBACK_STAGE"})});});}}>${this.i18n.system("Restore")} · ${this.i18n.system("Keep isolated")}</button>${snapshot.status==="cleanup-pending"?html`<button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${()=>{if(!window.confirm(`${this.i18n.system("Remove")} · ${this.i18n.system("Try again")}`))return;void this.#mutate("The incomplete encrypted recovery object was removed and its deletion was independently verified.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/recovery`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"cleanup",snapshotId:snapshot.snapshot_id,organizationId,confirmation:"RETRY_ORGANIZATION_RECOVERY_OBJECT_CLEANUP"})});});}}>${this.i18n.system("Try again")}</button>`:nothing}</li>`)}</ul>`:html`<small>No encrypted recovery snapshots have been created.</small>`}
    </section>`;
  }

  #provisioningControls(){
    if(this.#detail?.organization.role!=="owner")return nothing;
    const organizationId=this.#route().organizationId;
    return html`<section class="workspace-settings-card"><h2>Scoped identity provisioning</h2><p>Provisioning credentials authorize this exact organization's local API only. They do not imply verified SSO, SCIM federation, or multifactor authentication.</p>
      <button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${()=>void this.#mutate("A scoped provisioning token was created and is displayed only during this authorized session.",async()=>{const issued=await this.#request<{token:string}>(`/api/workspaces/${encodeURIComponent(organizationId)}/security/provisioning-credentials`,{method:"POST"});this.#freshProvisioningToken=issued.token;})}>Create one-time provisioning token</button>
      ${this.#freshProvisioningToken?html`<label>Copy this token now; it will not be shown again<input readonly .value=${this.#freshProvisioningToken} @focus=${(event:FocusEvent)=>(event.currentTarget as HTMLInputElement).select()}></label><button type="button" class="button ghost compact" @click=${()=>{this.#freshProvisioningToken=null;this.requestUpdate();}}>Hide token</button>`:nothing}
      ${this.#credentials.filter((credential)=>credential.status==="active").length?html`<ul class="workspace-settings-list">${this.#credentials.filter((credential)=>credential.status==="active").map((credential)=>html`<li><div><b>Active scoped token</b><span>Created ${this.i18n.date(new Date(credential.createdAt),{dateStyle:"medium",timeStyle:"short"})}</span></div><button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>{if(!window.confirm(this.i18n.system("Immediately revoke this organization provisioning token?")))return;void this.#mutate("The exact provisioning credential was revoked immediately.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/security/provisioning-credentials/${encodeURIComponent(credential.id)}`,{method:"DELETE"});this.#freshProvisioningToken=null;});}}>Revoke token</button></li>`)}</ul>`:nothing}
    </section>`;
  }

  #deletionRecoveryControls(){
    const organizationId=this.#route().organizationId;
    if(this.#detail?.organization.role!=="owner"||!this.#deletionJob||!["pending","partial","processing"].includes(this.#deletionJob.status))return nothing;
    return html`<section class="workspace-settings-card"><h2>${this.i18n.system("Organization ownership & offboarding")}</h2><p>${this.i18n.system("Permanently delete organization data")} · ${this.i18n.system("Try again")}</p><button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${()=>{if(!window.confirm(this.i18n.system("Permanently erase scoped organization projects, sources, context packages, output revisions, memberships, and recovery snapshots? Active legal holds prevent deletion.")))return;void this.#mutate("The organization was deleted; immutable operational receipts and external backup/device exceptions remain disclosed.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/deletion`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId,confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA"})});this.store.setRoute("/settings/workspaces");});}}>${this.i18n.system("Try again")}</button></section>`;
  }

  #ownershipAndDeletionControls(){
    const detail=this.#detail,inventory=this.#deletionInventory;if(detail?.organization.role!=="owner"||!inventory)return nothing;
    const organizationId=this.#route().organizationId,eligible=(detail.members??[]).filter((member)=>member.status==="active"&&member.role==="administrator");
    return html`<section class="workspace-settings-card"><h2>Organization ownership & offboarding</h2><p>Administrative ownership transfers only after the outgoing owner no longer controls an active project. Project custody transfer remains unavailable.</p>
      ${eligible.length?html`<form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>{event.preventDefault();const target=String(new FormData(event.currentTarget as HTMLFormElement).get("targetUserId")??"");if(!window.confirm(this.i18n.system("Transfer administrative ownership to this eligible administrator? Your current project session will close.")))return;void this.#mutate("Organization administrative ownership was transferred.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/ownership`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({targetUserId:target,confirmation:"TRANSFER_ORGANIZATION_OWNERSHIP"})});});}}><label>Eligible administrator<select name="targetUserId" required>${eligible.map((member)=>html`<option value=${member.user_id}>${member.display_name}</option>`)}</select></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>Transfer administrative ownership</button></form>`:html`<small>Add an eligible organization administrator before transferring ownership.</small>`}
      <details><summary>Permanently delete this organization and its scoped customer data</summary><p>${inventory.projectCount} project${inventory.projectCount===1?"":"s"}, ${inventory.mediaCount} unique original object${inventory.mediaCount===1?"":"s"}, ${inventory.packageCount} context package${inventory.packageCount===1?"":"s"}, and ${inventory.revisionCount} output revision${inventory.revisionCount===1?"":"s"} are inventoried. Immutable operational/audit metadata remains. External backups and other devices are not purged.</p>
        <button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${()=>{if(!window.confirm(this.i18n.system("Privately migrate only this organization's historical authored events before irreversible deletion? Other organizations and personal projects remain unchanged.")))return;void this.#mutate("Historical authored events for this organization were moved behind their erasable privacy boundary.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/recovery`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"migrate-privacy",organizationId,confirmation:"MIGRATE_ORGANIZATION_HISTORICAL_EVENT_CONTENT"})});});}}>${this.i18n.system("Migrate historical event privacy")}</button>
        <form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>{event.preventDefault();const entered=String(new FormData(event.currentTarget as HTMLFormElement).get("organizationName")??"");if(entered!==detail.organization.name){this.#error="Enter the exact organization name to confirm this irreversible deletion.";this.requestUpdate();return;}if(!window.confirm(this.i18n.system("Permanently erase scoped organization projects, sources, context packages, output revisions, memberships, and recovery snapshots? Active legal holds prevent deletion.")))return;void this.#mutate("The organization was deleted; immutable operational receipts and external backup/device exceptions remain disclosed.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/deletion`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId,confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA"})});this.store.setRoute("/settings/workspaces");});}}><label>Type the exact organization name<input name="organizationName" autocomplete="off" required></label><button type="submit" class="button ghost compact" ?disabled=${this.#busy||this.#holds.some((hold)=>hold.status==="active")||this.#snapshots.some((snapshot)=>snapshot.status==="cleanup-pending"||snapshot.status==="staging")}>Permanently delete organization data</button></form>
      </details>
    </section>`;
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
    return html`<div class="workspace-settings-grid">${this.#reviewQueue()}${this.#invitations()}<section class="workspace-settings-card" aria-labelledby="workspace-organizations-heading"><h2 id="workspace-organizations-heading">${this.i18n.t("workspace.admin.organizations","Your organizations")}</h2>${overview?.organizations.length?html`<ul class="workspace-settings-list">${overview.organizations.map((organization)=>{const manages=Boolean(organization.permissions?.length),href=`/settings/workspaces/${encodeURIComponent(organization.organizationId)}/overview`;return html`<li><div><b dir="auto">${organization.name}</b><span>${this.i18n.t(`workspace.admin.role.${organization.role}`,organization.role)}</span></div>${manages?html`<a class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.manageNamed","Manage {name}",{name:organization.name})} href=${href} @click=${(event:MouseEvent)=>this.#navigate(href,event)}>${this.i18n.t("workspace.admin.manage","Manage")}</a>`:nothing}</li>`;})}</ul>`:html`<p>${this.i18n.t("workspace.admin.noOrganizations","You do not belong to any organizations yet.")}</p>`}${owner?html`<form class="workspace-settings-form" @submit=${this.#submitOrganization}><label>${this.i18n.t("workspace.admin.organizationName","New organization name")}<input name="name" required maxlength="100" autocomplete="organization"></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.create","Create workspace")}</button></form>`:nothing}</section><section class="workspace-settings-card" aria-labelledby="workspace-projects-heading"><h2 id="workspace-projects-heading">${this.i18n.t("workspace.admin.sharedProjects","Projects shared with you")}</h2>${overview?.projects.length?html`<ul class="workspace-settings-list">${overview.projects.map((project)=>html`<li><div><b dir="auto">${project.projectName||this.i18n.t("workspace.admin.unnamedProject","Unnamed project")}</b><span>${this.i18n.t(`workspace.admin.role.${project.role}`,project.role)}</span></div><button type="button" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.openNamed","Open {name}",{name:project.projectName||this.i18n.t("workspace.admin.unnamedProject","Unnamed project")})} ?disabled=${this.#busy} @click=${()=>this.#openProject(project)}>${this.i18n.t("action.open","Open")}</button></li>`)}</ul>`:html`<p>${this.i18n.t("workspace.admin.noSharedProjects","No projects have been shared with you.")}</p>`}</section></div>`;
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
    return html`<section class="workspace-settings-card">
      <h2>${this.i18n.t("workspace.admin.section.projects","Projects")}</h2>
      ${canManage?html`<form class="workspace-settings-form" @submit=${this.#registerProject}>
        <label>${this.i18n.t("workspace.admin.ownedProject","Your project")}<select name="projectId" required><option value="">${this.i18n.t("field.choose","Choose an option")}</option>${personal.map((project)=>html`<option value=${project.id}>${project.name}</option>`)}</select></label>
        <button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.shareProject","Share project")}</button>
      </form>`:nothing}
      ${projects.length?html`<ul class="workspace-settings-project-list">${projects.map((project)=>{
        const projectMembers=this.#projectMembers.get(project.project_access_id);
        const projectName=project.project_name||this.i18n.t("workspace.admin.unnamedProject","Unnamed project");
        const canViewAccess=canManage||Boolean(this.#overview?.projects.some((item)=>item.organizationId===detail?.organization.organizationId&&item.projectAccessId===project.project_access_id));
        return html`<li>
          <header><b dir="auto">${projectName}</b>${canViewAccess?html`<button type="button" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.viewAccessNamed","View access to {name}",{name:projectName})} @click=${()=>void this.#loadProjectMembers(project.project_access_id)}>${this.i18n.t("workspace.admin.viewAccess","View access")}</button>`:nothing}</header>
          ${canManage?html`<form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>this.#grantProject(event,project)}>
            <label>${this.i18n.t("workspace.admin.member","Member")}<select name="userId" required><option value="">${this.i18n.t("field.choose","Choose an option")}</option>${members.filter((member)=>member.status==="active"&&member.role!=="owner").map((member)=>html`<option value=${member.user_id}>${member.display_name}</option>`)}</select></label>
            <label>${this.i18n.t("workspace.admin.role","Role")}<select name="role"><option value="viewer">${this.i18n.t("workspace.admin.role.viewer","Viewer")}</option><option value="editor">${this.i18n.t("workspace.admin.role.editor","Editor")}</option></select></label>
            <button type="submit" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.grantNamed","Grant access to {name}",{name:projectName})} ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.grant","Grant access")}</button>
          </form><p class="workspace-project-role-notice">${this.i18n.t("workspace.admin.editorBudgetNotice","Editors can create outputs using their personal and organization budgets; viewers cannot.")}</p>`:nothing}
          ${projectMembers?html`<ul class="workspace-settings-list">${projectMembers.filter((member)=>member.status==="active").map((member)=>html`<li><div>
            <b dir="auto">${member.display_name}</b>
            ${canManage&&member.role!=="owner"?html`
              <select aria-label=${this.i18n.t("workspace.admin.projectRoleNamed","Project role for {name}",{name:member.display_name})} .value=${member.role} ?disabled=${this.#busy} @change=${(event:Event)=>this.#updateProjectRole(project.project_access_id,member,(event.currentTarget as HTMLSelectElement).value)}><option value="viewer" ?selected=${member.role==="viewer"}>${this.i18n.t("workspace.admin.role.viewer","Viewer")}</option><option value="editor" ?selected=${member.role==="editor"}>${this.i18n.t("workspace.admin.role.editor","Editor")}</option></select>
              <forma-ui-switch class="workspace-project-canvas-permission" .label=${this.i18n.t("workspace.admin.canvasAccessNamed","Allow Canvas access for {name}",{name:`\u2068${member.display_name}\u2069`})} .help=${this.i18n.t("workspace.admin.canvasAccessHelp","Their project role determines whether they can edit the board.")} .checked=${Boolean(member.canvas_access)} .disabled=${this.#busy} @forma-change=${(event:CustomEvent<{checked:boolean}>)=>{const control=event.currentTarget as HTMLElement&{checked:boolean};const enabled=event.detail.checked;control.checked=Boolean(member.canvas_access);void this.#updateProjectCanvas(project.project_access_id,member,enabled,control);}}></forma-ui-switch>
              <forma-ui-switch class="workspace-project-review-permission" .label=${this.i18n.t("workspace.admin.reviewAccessNamed","Allow independent approval by {name}",{name:`\u2068${member.display_name}\u2069`})} .help=${this.i18n.t("workspace.admin.reviewAccessHelp","They can approve current work by someone else; viewers never receive editing access.")} .checked=${Boolean(member.review_access)} .disabled=${this.#busy} @forma-change=${(event:CustomEvent<{checked:boolean}>)=>{const control=event.currentTarget as HTMLElement&{checked:boolean};const enabled=event.detail.checked;control.checked=Boolean(member.review_access);void this.#updateProjectReviewer(project.project_access_id,member,enabled,control);}}></forma-ui-switch>
            `:html`<span>${this.i18n.t(`workspace.admin.role.${member.role}`,member.role)}</span>`}
          </div>${canManage&&member.role!=="owner"?html`<button type="button" class="button ghost compact" aria-label=${this.i18n.t("workspace.admin.revokeNamed","Revoke access for {name}",{name:member.display_name})} ?disabled=${this.#busy} @click=${()=>this.#revokeProject(project.project_access_id,member)}>${this.i18n.t("workspace.admin.revoke","Revoke")}</button>`:nothing}</li>`)}</ul>`:nothing}
        </li>`;
      })}</ul>`:html`<p>${this.i18n.t("workspace.admin.noRegisteredProjects","No projects have been registered in this organization.")}</p>`}
    </section>`;
  }

  #usage(){
    const detail=this.#detail,policy=detail?.policy,cost=detail?.cost,tokens=detail?.tokens;
    const used=Number(cost?.used_microusd??0),reserved=Number(cost?.reserved_microusd??0),limit=Number(policy?.microusd_limit??0);
    const format=(value:number)=>new Intl.NumberFormat(this.i18n.locale,{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value/1_000_000);
    const tokenUsed=Number(tokens?.used_tokens??0),tokenReserved=Number(tokens?.reserved_tokens??0),tokenLimit=Number(policy?.token_limit??0);
    const outcomes=detail?.outcomes;
    return html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.usage","Usage")}</h2><p>${this.i18n.t("workspace.admin.period","Accounting period")}: ${detail?.period??""}</p><dl class="workspace-settings-facts"><dt>${this.i18n.t("workspace.admin.totalLimit","Monthly organization limit")}</dt><dd>${format(limit)}</dd><dt>${this.i18n.t("workspace.admin.settled","Settled spending")}</dt><dd>${format(used)}</dd><dt>${this.i18n.t("workspace.admin.reserved","Active reservations")}</dt><dd>${format(reserved)}</dd><dt>${this.i18n.t("workspace.admin.remaining","Available organization budget")}</dt><dd>${format(Math.max(0,limit-used-reserved))}</dd><dt>${this.i18n.t("workspace.admin.tokens","Organization tokens")}</dt><dd>${this.i18n.number(tokenUsed+tokenReserved)} / ${this.i18n.number(tokenLimit)}</dd></dl>${outcomes?html`<h3>${this.i18n.t("workspace.outcomes.heading")}</h3><dl class="workspace-settings-facts"><dt>${this.i18n.t("workspace.outcomes.activated")}</dt><dd>${this.i18n.number(outcomes.activatedCreators)}</dd><dt>${this.i18n.t("workspace.outcomes.approved")}</dt><dd>${this.i18n.number(outcomes.approvedDeliverables)}</dd><dt>${this.i18n.t("workspace.outcomes.released")}</dt><dd>${this.i18n.number(outcomes.releasedApprovedDeliverables)}</dd><dt>${this.i18n.t("workspace.outcomes.pending")}</dt><dd>${this.i18n.number(outcomes.pendingReviews)}</dd><dt>${this.i18n.t("workspace.outcomes.reused")}</dt><dd>${this.i18n.number(outcomes.adoptedContextPackages)}</dd><dt>${this.i18n.t("workspace.outcomes.cost")}</dt><dd>${outcomes.settledCostPerApprovedDeliverableMicrousd===null?"—":format(outcomes.settledCostPerApprovedDeliverableMicrousd)}</dd><dt>${this.i18n.t("workspace.outcomes.review")}</dt><dd>${outcomes.averageReviewMinutes===null?"—":`${this.i18n.number(outcomes.averageReviewMinutes)} min`}</dd></dl>`:nothing}<progress max=${Math.max(1,limit)} value=${Math.min(limit,used+reserved)} aria-label=${this.i18n.t("workspace.admin.totalLimit","Monthly organization limit")}></progress><progress max=${Math.max(1,tokenLimit)} value=${Math.min(tokenLimit,tokenUsed+tokenReserved)} aria-label=${this.i18n.t("workspace.admin.tokenUsage","Monthly token usage")}></progress>${policy&&detail?.permissions?.includes("workspace.budget.manage")?html`<form class="workspace-settings-form" @submit=${this.#savePolicy}><label>${this.i18n.t("workspace.admin.usdLimit","Monthly limit (USD)")}<input type="number" name="usdLimit" min="0.01" step="0.01" .value=${String(Number(policy.microusd_limit)/1_000_000)} required></label><label>${this.i18n.t("workspace.admin.tokenLimit","Monthly token limit")}<input type="number" name="tokenLimit" min="1" step="1" .value=${String(policy.token_limit)} required></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.savePolicy","Save limits")}</button></form>`:nothing}</section>`;
  }

  #activity(){
    const audit=this.#detail?.audit??[];
    return html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.activity","Activity")}</h2>${audit.length?html`<ol class="workspace-settings-audit">${audit.map((event)=>html`<li><b>${this.i18n.t(`workspace.admin.audit.${String(event.action)}`,String(event.action).replace(/([a-z])([A-Z])/g,"$1 $2"))}</b>${event.actor_display_name?html`<span dir="auto">${this.i18n.t("workspace.admin.activityBy","By {name}",{name:String(event.actor_display_name)})}</span>`:nothing}<span>${this.i18n.date(new Date(String(event.occurred_at)),{dateStyle:"medium",timeStyle:"short"})}</span></li>`)}</ol>`:html`<p>${this.i18n.t("workspace.admin.noActivity","No organization activity has been recorded.")}</p>`}</section>`;
  }

  override render(){
    const {organizationId,section,invitations}=this.#route();
    const name=this.#detail?.organization.name??this.i18n.t("workspace.admin.heading","Workspaces & collaboration");
    const permissions=new Set(this.#detail?.permissions??[]);
    if(organizationId&&this.#deletionJob&&["pending","partial","processing"].includes(this.#deletionJob.status)){
      return html`<section class="workspace-settings-page page-pad" aria-labelledby="workspace-settings-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("workspace.admin.eyebrow","Creator settings")}</span><h1 id="workspace-settings-heading" dir="auto">${name}</h1></div></header>${this.#error?html`<p role="alert" class="workspace-settings-error">${this.i18n.system(this.#error)}</p>`:nothing}<p class="sr-only" role="status" aria-live="polite">${this.i18n.system(this.#notice)}</p>${this.#deletionRecoveryControls()}</section>`;
    }
    return html`<section class="workspace-settings-page page-pad" aria-labelledby="workspace-settings-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("workspace.admin.eyebrow","Creator settings")}</span><h1 id="workspace-settings-heading" dir="auto">${name}</h1><p>${this.i18n.t("workspace.admin.description","Manage the organizations, invitations, shared projects, and spending you are authorized to see.")}</p></div>${organizationId&&this.#overview?.organizations.length?html`<label class="workspace-settings-organization-select">${this.i18n.t("workspace.admin.organization","Organization")}<select .value=${organizationId} @change=${(event:Event)=>this.store.setRoute(`/settings/workspaces/${encodeURIComponent((event.currentTarget as HTMLSelectElement).value)}/overview`)}>${this.#overview.organizations.filter((organization)=>Boolean(organization.permissions?.length)).map((organization)=>html`<option value=${organization.organizationId}>${organization.name}</option>`)}</select></label>`:nothing}</header>${this.store.session.get()?.projectContext?html`<aside class="workspace-settings-shared-notice"><span>${this.i18n.t("workspace.admin.sharedProjectMode","You are working inside a shared project.")}</span><button type="button" class="button secondary compact" @click=${()=>void this.store.leaveProjectContext()}>${this.i18n.t("workspace.admin.leaveSharedProject","Return to my projects")}</button></aside>`:nothing}${this.#error?html`<p role="alert" class="workspace-settings-error">${(this.#error === "workspace_unavailable" ? this.i18n.system("This workspace could not be opened.") : this.#error === "workspace_mutation_failed" ? this.i18n.system("Workspace changes could not be saved.") : this.i18n.system(this.#error))}</p>`:nothing}<p class="sr-only" role="status" aria-live="polite">${this.i18n.system(this.#notice)}</p>${organizationId&&this.#detail?html`${this.#sectionLinks(organizationId,section)}${section==="members"?html`${this.#members()}${this.#pilotControls()}${this.#securityControls()}${this.#provisioningControls()}${this.#ownershipAndDeletionControls()}`:section==="projects"?html`${this.#reviewQueue()}${this.#contextPackages()}${this.#automationControls()}${this.#projects()}`:section==="usage"?html`${this.#usage()}${this.#retentionControls()}${this.#pilotControls()}`:section==="activity"?html`${this.#assuranceControls()}${this.#recoveryControls()}${this.#activity()}`:html`<div class="workspace-settings-grid">${this.#reviewQueue()}${this.#contextPackages()}${this.#automationControls()}${this.#assuranceControls()}${this.#retentionControls()}${this.#securityControls()}${this.#recoveryControls()}${this.#provisioningControls()}${this.#ownershipAndDeletionControls()}${this.#pilotControls()}${permissions.has("workspace.member.read")?this.#members():nothing}${permissions.has("workspace.project.read")?this.#projects():nothing}${!permissions.has("workspace.member.read")&&!permissions.has("workspace.project.read")?html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.overview","Overview")}</h2><p>${this.i18n.t("workspace.admin.description","Manage the organizations, invitations, shared projects, and spending you are authorized to see.")}</p></section>`:nothing}</div>`}`:organizationId?html`<p role="status">${this.i18n.t("status.loading","Loading")}</p>`:invitations?this.#invitations():this.#landing()}</section>`;
  }
}

if(!customElements.get("forma-workspace-settings"))customElements.define("forma-workspace-settings",FormaWorkspaceSettings);

declare global{interface HTMLElementTagNameMap{"forma-workspace-settings":FormaWorkspaceSettings;}}
