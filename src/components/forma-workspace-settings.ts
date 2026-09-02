import { outcomeSchedulerEvidence } from "./outcome-telemetry-summary";
import { html, nothing, noChange } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { localizeTemplateResult } from "./design-system/localized-template";
import { live } from "lit/directives/live.js";
import { routePathname } from "../model/routes.ts";
import { qualifyDisplayCollisions } from "../model/output-naming.ts";
import type { CapturedAuthorizationScope } from "../state/store.ts";
import { FormaElement } from "./forma-element.ts";
import { navigateInApp, type CommandDeparture } from "./command-departure";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "./output-navigation-focus.ts";
import { requestDialogConfirmation } from "./modal-dialog.ts";
import "./design-system/feedback.ts";
import "./design-system/forms.ts";
import "./design-system/navigation.ts";
import "./design-system/layout.ts";

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

// Positive consumed member evidence is shared by whole and exact-resource reads.
function workspaceMemberShape(value:unknown):value is Member{
  if(value===null||typeof value!=="object"||Array.isArray(value))return false;
  const row=value as Record<string,unknown>;
  return["membership_id","user_id","display_name","role","status"].every(key=>typeof row[key]==="string")
    &&Boolean(row.membership_id)&&Boolean(row.user_id)
    &&(!Object.hasOwn(row,"email")||typeof row.email==="string")
    &&["canvas_access","review_access"].every(key=>!Object.hasOwn(row,key)||typeof row[key]==="boolean"||row[key]===0||row[key]===1);
}
function workspaceMemberResponse(value:unknown):value is {members:Member[]}{
  if(value===null||typeof value!=="object"||Array.isArray(value)||Object.hasOwn(value,"error"))return false;
  const members=(value as {members?:unknown}).members;
  return Array.isArray(members)&&members.every(workspaceMemberShape);
}

const sections=["overview","members","projects","usage","activity"] as const;
type WorkspaceSection=typeof sections[number];
type WorkspaceMessage=string|(()=>string);
type WorkspaceFailure=WorkspaceMessage|{message:string};
type WorkspaceResponseOwner={current:()=>boolean;authorized:()=>boolean};
type WorkspaceMutation={owner:WorkspaceResponseOwner;acknowledged:boolean};
type WorkspaceConfirmation={controller:AbortController;current:()=>boolean;sent:boolean};

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
  #freshProvisioningToken:{value:string;owner:WorkspaceResponseOwner}|null=null;
  #projectMembers=new Map<string,Member[]>();
  #projectMemberReads=new Map<string,{revision:number;certified:number;invalidatedThrough:number;error:{key:"workspace.admin.unavailable"}|{message:string}|null}>();
  #busy=false;
  #loading=false;
  #readUnavailable=false;
  #viewRevision=0;
  #authorizationRevision=0;
  #observedRoute="";
  #cacheOwner:WorkspaceResponseOwner|null=null;
  #mutation:WorkspaceMutation|null=null;
  #confirmation:WorkspaceConfirmation|null=null;
  #permissionFocus:OutputNavigationFocusLease|null=null;
  #error:WorkspaceFailure="";
  #notice:WorkspaceMessage|{message:WorkspaceMessage;newerFieldsKept:true;policy?:{key:string;owner:string}}="";
  #loadedRoute="";
  #loadedOrganization="";
  #loadRevision=0;
  #loadDeniedThrough=0;
  #completedLoadResources=new Map<string,number>();
  #freshInvitation:{url:string;email:string;expiresAt:string;organizationId:string;authorization:CapturedAuthorizationScope}|null=null;
  #clearPrivate(){
    this.#readUnavailable=false;
    this.#overview=null;this.#detail=null;this.#pilot=null;this.#retention=null;this.#packages=[];
    this.#assurance=null;this.#security=null;this.#holds=[];this.#snapshots=[];this.#credentials=[];
    this.#automation.clear();this.#deletionInventory=null;this.#deletionJob=null;this.#projectMembers.clear();this.#projectMemberReads.clear();
    this.#freshInvitation=null;this.#freshProvisioningToken=null;this.#cacheOwner=null;this.#completedLoadResources.clear();
  }

  #retireFocus(){this.#permissionFocus?.dispose();this.#permissionFocus=null;}
  #retireConfirmation(){const pending=this.#confirmation;this.#confirmation=null;pending?.controller.abort();}
  #checkConfirmation(){const pending=this.#confirmation;if(pending&&!pending.current())this.#retireConfirmation();}

  #authorizationChanged=()=>{
    this.#retireConfirmation();
    this.#authorizationRevision+=1;this.#loadRevision+=1;this.#loadedRoute="";this.#loading=false;
    this.#clearPrivate();this.#retireFocus();this.#error="";this.#notice="";
    // A known write acknowledgement is not undone by its own permission/session refresh.
    if(!this.#mutation?.acknowledged){this.#mutation=null;this.#busy=false;}
    // Store emits this event before installing the new session; updated() starts the new read.
    this.requestUpdate();
  };

  #routeChanged=()=>{
    const route=this.store.route.get(),previous=this.#observedRoute;if(route===previous)return;
    this.#retireConfirmation();this.#retireFocus();this.#observedRoute=route;
    // Fragment gestures retire popup/focus ownership, not the exact resource.
    if(route.split("#")[0]===previous.split("#")[0])return;
    this.#viewRevision+=1;this.#loadRevision+=1;this.#loadedRoute="";
    this.#clearPrivate();this.#mutation=null;this.#busy=false;this.#loading=false;
    this.#error="";this.#notice="";this.requestUpdate();
  };

  override connectedCallback(){
    super.connectedCallback();this.#viewRevision+=1;this.#observedRoute=this.store.route.get();
    window.addEventListener("forma-authorization-changed",this.#authorizationChanged);
    window.addEventListener("forma-route-changed",this.#routeChanged);void this.#load();
  }
  override disconnectedCallback(){
    window.removeEventListener("forma-authorization-changed",this.#authorizationChanged);
    window.removeEventListener("forma-route-changed",this.#routeChanged);
    this.#retireConfirmation();
    this.#viewRevision+=1;this.#loadRevision+=1;this.#loadedRoute="";this.#loading=false;
    this.#clearPrivate();this.#retireFocus();this.#mutation=null;this.#busy=false;this.#error="";this.#notice="";
    super.disconnectedCallback();
  }

  protected override updated(){
    this.#routeChanged();this.#checkConfirmation();
    if(this.store.route.get().split("#")[0]!==this.#loadedRoute)void this.#load();
  }

  #captureOwner():WorkspaceResponseOwner{
    const viewRevision=this.#viewRevision,authorizationRevision=this.#authorizationRevision,route=this.store.route.get().split("#")[0];
    const session=this.store.session.get(),principal=session?.impersonation?.actor.userId??session?.user.userId;
    const userId=session?.user.userId,impersonating=Boolean(session?.impersonation),audience=session?.audience;
    const authorization=this.store.captureAuthorizationScope();
    const current=()=>{
      const active=this.store.session.get();
      return this.isConnected&&this.#viewRevision===viewRevision&&this.store.route.get().split("#")[0]===route
        &&Boolean(principal)&&principal===(active?.impersonation?.actor.userId??active?.user.userId)
        &&userId===active?.user.userId&&impersonating===Boolean(active?.impersonation)&&audience===active?.audience;
    };
    return{current,authorized:()=>current()&&this.#authorizationRevision===authorizationRevision
      &&this.store.authorizationScopeActive(authorization)};
  }

  #route(){
    const parts=routePathname(this.store.route.get()).split("/").filter(Boolean);
    const organizationId=parts[2]&&parts[2]!=="invitations"?decodeURIComponent(parts[2]):"";
    const section=sections.includes(parts[3] as WorkspaceSection)?parts[3] as WorkspaceSection:"overview";
    return{organizationId,section,invitations:parts[2]==="invitations"};
  }

  async #request<T>(url:string,init:RequestInit={},selectedResponse?:Response,observeResponse?:(response:Response)=>void){
    const owner=this.#captureOwner(),mutation=this.#mutation;
    const assertCurrent=()=>{if(!owner.authorized())throw new Error("workspace_response_retired");};
    assertCurrent();
    const response=selectedResponse??await fetch(url,{credentials:"same-origin",...init});
    assertCurrent();
    observeResponse?.(response);
    const body=await response.json() as T&{error?:string;retryable?:boolean;status?:string};
    assertCurrent();
    if(!response.ok){const key=String(body.error??""),workspaceMessage=()=>this.i18n.t(`workspace.admin.error.${key}`,this.i18n.t("workspace.admin.unavailable","This workspace is unavailable."));throw Object.assign(new Error(workspaceMessage()),{retryable:body.retryable===true||body.status==="partial",status:response.status,code:key,workspaceMessage});}
    if(mutation&&this.#mutation===mutation&&mutation.owner.authorized()
      &&(selectedResponse||!["GET","HEAD"].includes((init.method??"GET").toUpperCase())))mutation.acknowledged=true;
    return body;
  }

  #failureMessage(error:unknown,fallback:"workspace_unavailable"|"workspace_mutation_failed"):WorkspaceFailure{
    if(!(error instanceof Error))return fallback;
    const message=(error as Error&{workspaceMessage?:()=>string}).workspaceMessage;
    return typeof message==="function"?message:{message:error.message};
  }

  #errorText(){
    const error=this.#error;
    if(typeof error==="function")return error();
    if(typeof error==="object")return error.message;
    return error==="workspace_unavailable"?this.i18n.system("This workspace could not be opened.")
      :error==="workspace_mutation_failed"?this.i18n.system("Workspace changes could not be saved."):this.i18n.system(error);
  }

  async #load(){
    const route=this.store.route.get().split("#")[0],owner=this.#captureOwner();
    const {organizationId:nextOrganization,section}=this.#route();
    // Only a completed collection under this same owner can retain a native
    // draft through temporary read loss. Partial first-load data is not proof.
    let retainUnavailable=Boolean(this.#cacheOwner?.authorized()
      &&this.#detail?.organization.organizationId===nextOrganization
      &&this.#completedLoadResources.has("/api/workspaces")
      &&this.#completedLoadResources.has("/api/workspaces/"+encodeURIComponent(nextOrganization)));
    const recovering=this.#readUnavailable;
    const temporary=(error:unknown)=>{
      const status=error instanceof Error?(error as Error&{status?:number}).status:undefined;
      return status===undefined||status>=500&&status<600;
    };
    this.#loadedRoute=route;
    const revision=++this.#loadRevision,current=()=>revision===this.#loadRevision&&owner.authorized();
    if(!owner.authorized()){this.#clearPrivate();this.#loading=false;this.requestUpdate();return;}
    this.#loading=true;this.requestUpdate();
    if(nextOrganization!==this.#loadedOrganization){
      this.#loadedOrganization=nextOrganization;this.#clearPrivate();this.#notice="";this.#error="";this.requestUpdate();
    }
    const resources=new Set<string>();
    let deniedRevision=0,recoveryOrganization:Organization|undefined;
    const unavailable=()=>this.i18n.t("workspace.admin.unavailable","This workspace is unavailable.");
    const observe=(url:string,readRevision:number,response:Response)=>{
      if(!owner.authorized()||readRevision<=this.#loadDeniedThrough)throw new Error("workspace_response_retired");
      if([401,403,404].includes(response.status)){
        // Only a completed newer collection containing this exact resource is
        // proof. A newer pending load, sibling response or member read is not.
        if((this.#completedLoadResources.get(url)??0)<=readRevision){
          recoveryOrganization=this.#overview?.organizations.find(candidate=>candidate.organizationId===nextOrganization&&candidate.role==="owner");
          this.#loadDeniedThrough=this.#loadRevision;deniedRevision=++this.#loadRevision;
          this.#clearPrivate();this.#retireConfirmation();this.#retireFocus();
          this.#loading=false;this.#error=unavailable;this.requestUpdate();
        }
        throw Object.assign(new Error("workspace_response_retired"),{workspaceMessage:unavailable});
      }
      if(readRevision!==this.#loadRevision)throw new Error("workspace_response_retired");
    };
    const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
    const text=(value:unknown)=>typeof value==="string";
    const finite=(value:unknown)=>typeof value==="number"&&Number.isFinite(value);
    const nullable=(value:unknown,shape:(value:unknown)=>boolean)=>value===null||shape(value);
    const rows=(value:unknown,shape:(value:unknown)=>boolean)=>Array.isArray(value)&&value.every(shape);
    const fields=(value:unknown,strings:readonly string[],numbers:readonly string[]=[]):value is Record<string,unknown>=>
      object(value)&&strings.every(key=>text(value[key]))&&numbers.every(key=>finite(value[key]));
    const optional=(value:Record<string,unknown>,key:string,shape:(value:unknown)=>boolean)=>!Object.hasOwn(value,key)||shape(value[key]);
    const strings=(value:unknown)=>rows(value,text),nullableText=(value:unknown)=>nullable(value,text),nullableNumber=(value:unknown)=>nullable(value,finite);
    const organizationShape=(value:unknown)=>fields(value,["organizationId","name","role"])&&Boolean(value.organizationId)&&optional(value,"permissions",strings);
    const exactOrganization=(value:unknown)=>organizationShape(value)&&object(value)&&value.organizationId===nextOrganization;
    const memberShape=workspaceMemberShape;
    const projectShape=(value:unknown)=>fields(value,["project_access_id","project_id","project_name","owner_user_id","status"])&&Boolean(value.project_access_id)&&Boolean(value.project_id)&&Boolean(value.owner_user_id);
    const invitationShape=(value:unknown)=>fields(value,["invitation_id","email_normalized","role","status","expires_at"])&&Boolean(value.invitation_id);
    const counterShape=(value:unknown)=>fields(value,[],["used_microusd","reserved_microusd","hard_limit_microusd"]);
    const participantShape=(value:unknown)=>fields(value,["participant_id","email_normalized","role","status","created_at"])&&Boolean(value.participant_id)
      &&nullableText(value.user_id)&&nullableText(value.revoked_at)&&["used_microusd","reserved_microusd","hard_limit_microusd"].every(key=>optional(value,key,nullableNumber));
    const draftShape=(value:unknown)=>fields(value,["handle","type","text","intent"])&&typeof value.locked==="boolean"&&typeof value.active==="boolean"
      &&nullableText(value.exactText)&&strings(value.exactPlacements)&&rows(value.protectedPhrases,item=>fields(item,["text"])&&nullableText(item.placement))
      &&rows(value.relations,item=>fields(item,["kind","targetHandle"]))&&nullableText(value.sourceName)&&nullableText(value.rightsExpiresAt);
    const packageShape=(value:unknown)=>fields(value,["id","name","description"],["blockCount","bindingCount"])&&Boolean(value.id)
      &&nullableNumber(value.version)&&nullableText(value.versionId)&&nullableText(value.publishedAt)
      &&["versionStatus","createdByUserId","pendingDraftVersionId"].every(key=>optional(value,key,nullableText))
      &&optional(value,"pendingDraftVersion",nullableNumber)&&optional(value,"canApprove",item=>typeof item==="boolean")&&optional(value,"draftPreview",item=>rows(item,draftShape));
    const deletionShape=(value:unknown)=>object(value)&&fields(value.inventory,[],["projectCount","mediaCount","packageCount","revisionCount","privateEventBodyCount"])
      &&nullable(value.job,item=>fields(item,["job_id","status"])&&Boolean(item.job_id));
    const outcomesShape=(value:unknown)=>fields(value,[],["activatedCreators","approvedDeliverables","releasedApprovedDeliverables","pendingReviews","adoptedContextPackages"])
      &&nullableNumber(value.averageReviewMinutes)&&nullableNumber(value.settledCostPerApprovedDeliverableMicrousd);
    const read=async<T>(url:string,certifies:(value:T)=>boolean)=>{
      const value=await this.#request<T>(url,{},undefined,response=>observe(url,revision,response));
      if(!current())throw new Error("workspace_response_retired");
      // Existing optional presentation defaults are not positive response proof.
      // Withhold the certificate; an unavailable view additionally needs a
      // complete positive collection before its native forms can be reenabled.
      const envelope:unknown=value;
      const certified=object(envelope)&&!Object.hasOwn(envelope,"error")&&(!Object.hasOwn(envelope,"organization")||exactOrganization(envelope.organization))
        &&(!Object.hasOwn(envelope,"organizationId")||envelope.organizationId===nextOrganization)&&certifies(value);
      if(certified)resources.add(url);
      else if(recovering)throw Object.assign(new Error("workspace_response_invalid"),{workspaceMessage:unavailable});
      return value;
    };
    try{
      const overview=await read<WorkspaceOverview>("/api/workspaces",value=>rows(value.organizations,organizationShape)
        &&rows(value.projects,item=>fields(item,["organizationId","projectAccessId","projectId","projectName","role"])&&Boolean(item.organizationId)&&Boolean(item.projectAccessId)&&Boolean(item.projectId))
        &&rows(value.invitations,item=>fields(item,["invitation_id","membership_id","organization_id","name","role"])&&Boolean(item.invitation_id)&&Boolean(item.membership_id)&&Boolean(item.organization_id)&&nullableText(item.expires_at)));
      if(!current())return;
      this.#cacheOwner=owner;this.#overview=overview;
      const organizationId=nextOrganization;
      if(organizationId){
        const endpoint=`/api/workspaces/${encodeURIComponent(organizationId)}`;
        const base=await read<WorkspaceDetail>(endpoint,value=>exactOrganization(value.organization)&&strings(value.permissions)&&rows(value.members,memberShape)&&rows(value.projects,projectShape)&&rows(value.invitations,invitationShape));
        if(!current())return;
        if(this.#detail&&(this.#detail.organization.role!==base.organization.role
          ||[...(this.#detail.permissions??[])].sort().join("\0")!==[...(base.permissions??[])].sort().join("\0"))){
          retainUnavailable=false;
          this.#clearPrivate();this.#cacheOwner=owner;this.#overview=overview;this.requestUpdate();
        }
        if(section!=="overview"){
          const view=section==="activity"?"audit":section;
          const detail=await read<WorkspaceDetail>(`${endpoint}/${view}`,value=>exactOrganization(value.organization)&&(
            view==="members"?rows(value.members,memberShape)&&rows(value.invitations,invitationShape)
              :view==="projects"?rows(value.projects,projectShape):view==="audit"?rows(value.audit,item=>fields(item,["action","occurred_at"])&&nullableText(item.actor_display_name))
                :text(value.period)&&nullable(value.policy,item=>fields(item,[],["token_limit","microusd_limit"]))
                  &&nullable(value.cost,item=>fields(item,[],["used_microusd","reserved_microusd"]))&&nullable(value.tokens,item=>fields(item,[],["used_tokens","reserved_tokens"]))
                  &&rows(value.reservations,item=>fields(item,["status"],["count","used_microusd","reserved_microusd"]))&&outcomesShape(value.outcomes)));
          if(!current())return;
          this.#detail={...base,...detail,permissions:base.permissions};
        }else this.#detail=base;
        const permissions=new Set(base.permissions??[]);
        if(permissions.has("workspace.usage.read")||permissions.has("workspace.policy.manage")){
          const [pilot,retention]=await Promise.all([
            read<PilotDetail&{organization:Organization}>(`${endpoint}/pilot`,value=>exactOrganization(value.organization)
              &&nullable(value.cohort,item=>fields(item,["cohort_id","status","starts_at","ends_at","source_classification"],["max_participants","participant_cap_microusd","organization_cap_microusd"])&&Boolean(item.cohort_id))
              &&rows(value.participants,participantShape)&&nullable(value.organizationBudget,counterShape)&&nullable(value.participantBudget,counterShape)
              &&nullable(value.maintenance,item=>fields(item,["status","started_at"])&&nullableText(item.finished_at)&&nullableText(item.error_code))),
            permissions.has("workspace.policy.manage")?read<RetentionDetail&{organization:Organization}>(`${endpoint}/retention`,value=>exactOrganization(value.organization)&&nullable(value.policy,item=>fields(item,["updated_at"],["transient_days","evidence_days","revision_days","legal_hold","version"]))&&value.appliesTo==="new-scoped-content-only"):Promise.resolve(null),
          ]);
          if(!current())return;
          this.#pilot=pilot;this.#retention=retention;
        }else{this.#pilot=null;this.#retention=null;}
        const organizationOwner=base.organization.role==="owner",manages=permissions.has("workspace.policy.manage");
        const [packages,assurance,security,holds,recovery,credentials,deletion]=await Promise.all([
          read<{packages:OrganizationPackage[]}>(`${endpoint}/context-packages`,value=>rows(value.packages,packageShape)),
          permissions.has("workspace.audit.read")?read<AssuranceDetail&{organizationId:string}>(`${endpoint}/assurance`,value=>value.organizationId===organizationId
            &&fields(value.retention,[],["pendingCount","heldCount"])&&nullableText(value.retention.oldestExpiredAt)
            &&fields(value.scheduler,["state"])&&typeof value.scheduler.hostingScheduleVerified==="boolean"&&nullableText(value.scheduler.lastScheduledAt)
            &&fields(value.packages,["sourceFileCustody"],["activeCount"])&&fields(value.reviews,[],["pendingCount"])
            &&rows(value.controls,item=>fields(item,["id","status","summary"])&&Boolean(item.id))&&typeof value.enterpriseReady==="boolean"&&strings(value.enterpriseBlockers)):Promise.resolve(null),
          organizationOwner?read<SecurityPosture>(`${endpoint}/security`,value=>object(value.policy)&&typeof value.policy.authenticationSource==="string"&&strings(value.policy.allowedEmailDomains)&&typeof value.policy.encryptionMode==="string"&&Number.isFinite(value.policy.maxSessionMinutes)&&Number.isFinite(value.policy.version)&&typeof value.observedSignInSource==="string"&&typeof value.domainOwnershipVerified==="boolean"&&typeof value.mfaAttestationAvailable==="boolean"&&object(value.encryption)&&typeof value.encryption.recoverySnapshots==="string"&&typeof value.encryption.primaryDatabaseAndObjectStorage==="string"&&typeof value.encryption.externalCustomerManagedKeys==="boolean"):Promise.resolve(null),
          manages?read<{holds:LegalHold[]}>(`${endpoint}/holds`,value=>rows(value.holds,item=>fields(item,["hold_id","scope_kind","resource_id","reason","status","created_at"])&&Boolean(item.hold_id)&&Boolean(item.resource_id)&&["organization","project","content","artifact"].includes(item.scope_kind as string))):Promise.resolve(null),
          organizationOwner?read<{snapshots:RecoverySnapshot[]}>(`${endpoint}/recovery`,value=>rows(value.snapshots,item=>fields(item,["snapshot_id","key_id","manifest_json","status","created_at"])&&Boolean(item.snapshot_id)&&Boolean(item.key_id))):Promise.resolve(null),
          organizationOwner?read<{credentials:ProvisioningCredential[]}>(`${endpoint}/security/provisioning-credentials`,value=>rows(value.credentials,item=>fields(item,["id","status","createdAt"])&&Boolean(item.id)&&nullableText(item.revokedAt))):Promise.resolve(null),
          organizationOwner?read<{inventory:DeletionInventory;job:{job_id:string;status:string}|null}>(`${endpoint}/deletion`,deletionShape):Promise.resolve(null),
        ]);
        if(!current())return;
        this.#packages=packages.packages;this.#assurance=assurance;this.#security=security;
        this.#holds=holds?.holds??[];this.#snapshots=recovery?.snapshots??[];this.#credentials=credentials?.credentials??[];this.#deletionInventory=deletion?.inventory??null;this.#deletionJob=deletion?.job??null;
        const eligible=overview.projects.filter((project)=>project.organizationId===organizationId&&(
          manages||project.role==="owner"));
        const policies=await Promise.all(eligible.map(async(project)=>{
          try{return[project.projectAccessId,(await read<{policy:AutomationPolicy}>(`${endpoint}/projects/${encodeURIComponent(project.projectAccessId)}/automation`,value=>object(value.policy)&&typeof value.policy.enabled==="boolean"&&typeof value.policy.notifyContextChanges==="boolean"&&typeof value.policy.notifyOutputReady==="boolean"&&[value.policy.reviewDueHours,value.policy.reminderHours,value.policy.version].every(Number.isFinite))).policy] as const;}
          catch(error){if(temporary(error))throw error;return null;}
        }));
        if(!current())return;
        this.#automation=new Map(policies.filter((policy):policy is readonly[string,AutomationPolicy]=>Boolean(policy)));
      }else this.#detail=null;
      this.#completedLoadResources=new Map([...resources].map(url=>[url,revision]));
      this.#readUnavailable=false;this.#error="";
    }catch(error){
      const recoveryRevision=deniedRevision||revision;
      const recoveryCurrent=()=>recoveryRevision===this.#loadRevision&&owner.authorized();
      if(!recoveryCurrent())return;
      const organization=recoveryOrganization??this.#overview?.organizations.find((candidate)=>candidate.organizationId===nextOrganization&&candidate.role==="owner");
      const retain=Boolean(!deniedRevision&&retainUnavailable&&temporary(error)
        &&this.#cacheOwner?.authorized()&&this.#detail?.organization.organizationId===nextOrganization);
      if(retain){
        this.#readUnavailable=true;this.#retireConfirmation();this.#retireFocus();
        this.#error=this.#failureMessage(error,"workspace_unavailable");
      }else this.#clearPrivate();
      this.requestUpdate();
      if(organization){
        try{
          // Preserve the separately authorized deletion-recovery exception.
          // This new read cannot certify or restore the ordinary private view.
          const url=`/api/workspaces/${encodeURIComponent(nextOrganization)}/deletion`;
          const deletion=await this.#request<{inventory:DeletionInventory;job:{job_id:string;status:string}|null}>(`/api/workspaces/${encodeURIComponent(nextOrganization)}/deletion`,{},undefined,response=>observe(url,recoveryRevision,response));
          if(!recoveryCurrent())return;
          if(!deletionShape(deletion)||Object.hasOwn(deletion,"error")||(Object.hasOwn(deletion,"organizationId")&&(deletion as {organizationId?:string}).organizationId!==nextOrganization)
            ||(Object.hasOwn(deletion,"organization")&&!exactOrganization((deletion as {organization?:unknown}).organization)))throw new Error("workspace_response_invalid");
          if(deletion.job&&["pending","partial","processing"].includes(deletion.job.status)){
            if(retain)this.#clearPrivate();
            this.#cacheOwner=owner;this.#detail={organization,permissions:[]};this.#deletionInventory=deletion.inventory;this.#deletionJob=deletion.job;this.#error="";this.requestUpdate();return;
          }
        }catch{/* Preserve the original authorization-safe workspace failure. */}
      }
      if(!recoveryCurrent())return;
      if(!retain)this.#clearPrivate();
      this.#error=this.#failureMessage(error,"workspace_unavailable");
    }finally{if((revision===this.#loadRevision||deniedRevision===this.#loadRevision)&&owner.authorized()){this.#loading=false;this.requestUpdate();}}
  }

  async #mutate(description:WorkspaceMessage,action:(current:()=>boolean)=>Promise<void|false>,current?:()=>boolean,reserved?:WorkspaceMutation){
    const owner=reserved?.owner??this.#captureOwner();
    if(reserved&&this.#mutation!==reserved||this.#busy||this.#readUnavailable||this.#confirmation&&!this.#confirmation.sent||!owner.authorized()||current&&!current())return false;
    const mutation:WorkspaceMutation=reserved??{owner,acknowledged:false};
    const owned=()=>this.#mutation===mutation&&owner.current()&&(mutation.acknowledged||!current||current());
    this.#mutation=mutation;this.#busy=true;this.#error="";this.#notice="";this.requestUpdate();
    try{
      try{if(await action(owner.authorized)===false&&(reserved||!mutation.acknowledged))return false;}
      catch(error){
        if(!owned())return false;
        if(!mutation.acknowledged){
          if(!owner.authorized())return false;
          const message=this.#failureMessage(error,"workspace_mutation_failed");
          if(error instanceof Error&&(error as Error&{retryable?:boolean}).retryable)await this.#load();
          if(owned()&&owner.authorized())this.#error=message;
          return false;
        }
        // A failed follow-up read cannot turn a positively acknowledged write into a failed write.
        if(reserved)return false;
      }
      // Context navigation owns its destination reads and completion separately.
      // Its real positive ACK must not become an Open notice after UI refusal.
      if(reserved)return mutation.acknowledged&&(!current||current());
      if(!owned()||!mutation.acknowledged)return false;
      this.#notice=description;
      try{
        await this.store.refreshSession();
        if(!owned())return false;
        this.#notice=description;
        await this.#load();
      }catch{
        if(owned())this.#error=()=>this.i18n.t("workspace.admin.unavailable","This workspace is unavailable.");
      }
      return owned();
    }finally{if(this.#mutation===mutation){
      if(!mutation.acknowledged&&current&&!current()&&this.#notice===description)this.#notice="";
      this.#mutation=null;this.#busy=false;this.requestUpdate();
    }}
  }


  #policyStamp(){return JSON.stringify([this.#viewRevision,this.#authorizationRevision,this.#loadDeniedThrough]);}

  #departureForms(){
    return [...this.querySelectorAll<HTMLFormElement>("form.workspace-settings-form,form[data-workspace-review]")]
      .filter(form=>form.isConnected&&this.contains(form));
  }

  #rawFormChanged(form:HTMLFormElement){
    // These ordinary forms use native defaults. Controlled policies keep
    // their existing keyed dirty/snapshot owner instead of a second raw cache.
    return [...form.elements].some(element=>{
      if(element.tagName==="SELECT"){
        const field=element as HTMLSelectElement,options=[...field.options];
        const explicit=options.filter(option=>option.defaultSelected);
        const selected=field.multiple?explicit:[explicit.at(-1)
          ??options.find(option=>!option.disabled&&!option.closest("optgroup[disabled]"))].filter(Boolean);
        return options.some(option=>option.selected!==selected.includes(option));
      }
      if(element.tagName!=="INPUT"&&element.tagName!=="TEXTAREA")return false;
      const field=element as HTMLInputElement|HTMLTextAreaElement;
      if(field.readOnly||!field.name)return false;
      if(element.tagName==="INPUT"){
        const input=element as HTMLInputElement;
        if(["button","submit","reset","hidden"].includes(input.type))return false;
        if(["checkbox","radio"].includes(input.type))return input.checked!==input.defaultChecked;
      }
      return field.value!==field.defaultValue;
    });
  }

  #departureBlocked(ownMutation:WorkspaceMutation|null=null){
    if((this.#busy&&this.#mutation?.owner.current()&&this.#mutation!==ownMutation)||this.#confirmation?.current())return true;
    return this.#departureForms().some(form=>form.hasAttribute("data-workspace-policy")
      ?this.#currentPolicyForm(form)&&form.getAttribute("data-workspace-policy-dirty")==="true"
      :this.#rawFormChanged(form));
  }

  captureCommandDeparture():CommandDeparture{
    const owner=this.#captureOwner(),stamp=this.#policyStamp();
    // Only the capture made before this exact reserved mutation starts may
    // subtract its own busy term. Every later capture still sees pending work.
    const ownMutation=this.#busy?null:this.#mutation;
    return{element:this,current:()=>owner.authorized()&&this.#policyStamp()===stamp,
      blocked:()=>this.#departureBlocked(ownMutation),reason:()=>"next.lifecycle.currentWorkOpen"};
  }

  #policyForm(key:string){
    if(!this.#cacheOwner?.authorized())return null;
    const owner=this.#policyStamp();
    const forms=[...this.querySelectorAll<HTMLFormElement>("form[data-workspace-policy]")].filter(form=>
      form.isConnected&&this.contains(form)&&form.getAttribute("data-workspace-policy")===key
      &&form.getAttribute("data-workspace-policy-owner")===owner);
    return forms.length===1?forms[0]:null;
  }

  #currentPolicyForm(form:HTMLFormElement|null){
    return Boolean(form&&form.isConnected&&this.contains(form)
      &&this.#policyForm(form.getAttribute("data-workspace-policy")??"")===form);
  }

  #policyFormFrom(control:EventTarget|null){
    let node=control as HTMLElement|null;
    while(node&&node!==this&&node.tagName!=="FORM")node=node.parentElement;
    return node?.tagName==="FORM"?node as HTMLFormElement:null;
  }

  #policyEdited(event:Event){
    const form=this.#policyFormFrom(event.currentTarget);
    if(!form||!this.#currentPolicyForm(form))return;
    form.setAttribute("data-workspace-policy-dirty","true");this.requestUpdate();
  }

  #policyDraft(key:string,snapshot:unknown){
    const form=this.#policyForm(key),owner=this.#policyStamp(),saved=JSON.stringify(snapshot??null);
    const dirty=form?.getAttribute("data-workspace-policy-dirty")==="true";
    return{key,owner,saved,dirty,changed:dirty&&form?.getAttribute("data-workspace-policy-snapshot")!==saved,
      value:(value:string|boolean)=>dirty||this.#readUnavailable?noChange:live(value)};
  }

  #discardPolicy(event:Event){
    const form=this.#policyFormFrom(event.currentTarget);
    if(this.#busy||this.#readUnavailable||this.#confirmation||!form||!this.#currentPolicyForm(form)
      ||form.getAttribute("data-workspace-policy-dirty")!=="true")return;
    // Raw edits live only in this still-current native form. The next render
    // deliberately uses live(current defaults), even if Lit last committed the
    // same defaults before the edit. A detached/denied form is never rebound.
    const notice=this.#notice;
    if(typeof notice==="object"&&notice.policy?.key===form.getAttribute("data-workspace-policy")
      &&notice.policy.owner===form.getAttribute("data-workspace-policy-owner"))this.#notice=notice.message;
    form.removeAttribute("data-workspace-policy-dirty");this.requestUpdate();
  }

  #policyActions(draft:{dirty:boolean;changed:boolean},label:string){
    return html`${draft.dirty?html`<small role="status">${this.i18n.t(draft.changed?"workspace.admin.policyDraftChanged":"workspace.admin.policyDraftKept")}</small>`:nothing}<forma-ui-cluster alignment="stretch" gap="small"><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${label}</button><button type="button" class="button ghost compact" ?disabled=${this.#busy||!draft.dirty} @click=${this.#discardPolicy}>${this.i18n.t("workspace.admin.discardPolicy")}</button></forma-ui-cluster>`;
  }

  async #mutateForm(description:WorkspaceMessage,form:HTMLFormElement,data:FormData,action:(current:()=>boolean)=>Promise<void|false>,policy=false){
    const owner=this.#captureOwner();
    if(!owner.authorized()||!form.isConnected||!this.contains(form))return false;
    // Keep exact ordered raw fields, not the normalized command sent to the server.
    const original=[...data.entries()];
    if(policy){
      if(this.#busy||this.#confirmation||!this.#currentPolicyForm(form))return false;
      form.setAttribute("data-workspace-policy-dirty","true");
    }
    const acknowledged=await this.#mutate(description,action);
    // The existing refresh may legitimately retire or replace this form.
    if(!acknowledged||!owner.authorized()||!form.isConnected||!this.contains(form)||policy&&!this.#currentPolicyForm(form))return false;
    const current=[...new FormData(form).entries()];
    const unchanged=original.length===current.length&&original.every(([name,value],index)=>
      current[index][0]===name&&current[index][1]===value);
    if(unchanged){
      if(policy){form.removeAttribute("data-workspace-policy-dirty");this.requestUpdate();}
      else form.reset();
    }else{this.#notice={message:description,newerFieldsKept:true,...(policy?{policy:{key:form.getAttribute("data-workspace-policy")??"",owner:this.#policyStamp()}}:{})};this.requestUpdate();}
    // Only unchanged completion may trigger the organization's automatic handoff.
    return unchanged;
  }

  #noticeText(){
    const notice=this.#notice,message=typeof notice==="object"?notice.message:notice;
    const text=typeof message==="function"?message():this.i18n.system(message);
    return typeof notice==="object"?text+" "+
      this.i18n.t("workspace.admin.newerFormKept","Your newer form values were kept without being submitted."):text;
  }

  #holdNames(){
    const scopeNames:Record<string,string>={organization:this.i18n.system("Entire organization"),project:this.i18n.system("Project access ID"),
      content:this.i18n.system("Exact evidence content ID"),artifact:this.i18n.system("Exact finished output ID")};
    const organization=this.#detail?.organization,organizationId=this.#route().organizationId;
    return qualifyDisplayCollisions(this.#holds.filter(hold=>hold.status==="active").map(hold=>{
      const resource=hold.scope_kind==="organization"&&organization?.organizationId===organizationId&&hold.resource_id===organizationId
        ?organization.name:"["+encodeURIComponent(hold.resource_id)+"]";
      return{key:hold.hold_id,label:(scopeNames[hold.scope_kind]??hold.scope_kind)+" · \u2068"+resource+"\u2069 · \u2068"+hold.reason+"\u2069"};
    }),number=>this.i18n.number(number),id=>"\u2068["+encodeURIComponent(id)+"]\u2069");
  }

  #snapshotNames(){
    return qualifyDisplayCollisions(this.#snapshots.map(snapshot=>({key:snapshot.snapshot_id,
      label:this.i18n.date(new Date(snapshot.created_at),{dateStyle:"medium",timeStyle:"short"})})),
      number=>this.i18n.t("workspace.admin.snapshotQualifier","Snapshot {number}",{number:this.i18n.number(number)}),
      id=>this.i18n.t("workspace.admin.snapshotIdentity","Snapshot ID {id}",{id:`\u2068[${encodeURIComponent(id)}]\u2069`}));
  }

  #credentialNames(){
    return qualifyDisplayCollisions(this.#credentials.filter(credential=>credential.status==="active").map(credential=>({key:credential.id,
      label:this.i18n.date(new Date(credential.createdAt),{dateStyle:"medium",timeStyle:"short"})})),
      number=>this.i18n.t("workspace.admin.credentialQualifier","Token {number}",{number:this.i18n.number(number)}),
      id=>this.i18n.t("workspace.admin.credentialIdentity","Token ID {id}",{id:`\u2068[${encodeURIComponent(id)}]\u2069`}));
  }

  #memberNames(members:readonly Member[]){
    const qualifier=(number:number)=>this.i18n.t("workspace.admin.memberQualifier","Member {number}",{number:this.i18n.number(number)});
    const identity=(id:string)=>this.i18n.t("workspace.admin.memberIdentity","Member ID {id}",{id:`\u2068[${encodeURIComponent(id)}]\u2069`});
    const names=qualifyDisplayCollisions(members.map(member=>({key:member.membership_id,label:member.display_name})),qualifier,identity);
    return qualifyDisplayCollisions(members.map(member=>({key:member.membership_id,
      label:`\u2068${member.display_name}\u2069`+(names.get(member.membership_id)!.qualifier&&member.email?` · \u2068${member.email}\u2069`:"")})),qualifier,identity);
  }

  #transferMemberNames(){
    return this.#memberNames((this.#detail?.members??[]).filter(member=>member.status==="active"&&member.role==="administrator"));
  }

  #selectedTarget(label:string){
    return this.i18n.t("workspace.admin.selectedTarget","Selected target: {name}",{name:`\u2068${label}\u2069`});
  }

  #workspacePermission(organizationId:string,permission:string){
    return this.#detail?.organization.organizationId===organizationId&&Boolean(this.#detail.permissions?.includes(permission));
  }
  #workspaceOwner(organizationId:string){
    return this.#detail?.organization.organizationId===organizationId&&this.#detail.organization.role==="owner";
  }

  async #confirmWorkspace(event:Event,label:string,message:string,eligible:()=>boolean,action:()=>Promise<unknown>){
    if(this.#busy||this.#readUnavailable||this.#confirmation)return;
    const owner=this.#captureOwner(),organization=this.#detail?.organization,source=event.currentTarget as HTMLElement|null;
    if(!owner.authorized()||!organization||!source?.isConnected||!this.contains(source)||!eligible())return;
    const controller=new AbortController();
    const invoker=source.tagName==="FORM"
      ?((event as SubmitEvent).submitter as HTMLElement|null)??source.querySelector<HTMLElement>('button[type="submit"]')
      :source;
    const pending:WorkspaceConfirmation={controller,sent:false,current:()=>this.#confirmation===pending
      &&!controller.signal.aborted&&!this.#readUnavailable&&owner.authorized()&&source.isConnected&&this.contains(source)
      &&this.#detail?.organization.organizationId===organization.organizationId
      &&this.#detail.organization.name===organization.name&&eligible()};
    this.#confirmation=pending;
    try{
      const accepted=await requestDialogConfirmation({
        title:label+" · \u2068"+organization.name+"\u2069",message,confirmLabel:label,cancelLabel:this.i18n.t("action.cancel"),
        locale:this.i18n.locale,direction:this.i18n.direction,owner:this,invoker,
        signal:controller.signal,current:pending.current,
      });
      if(!accepted||!pending.current())return;
      // There is no await between the last reviewed-intent check and the existing mutation.
      pending.sent=true;
      await action();
      // The former permission/row may legitimately disappear after its acknowledged write.
    }finally{if(this.#confirmation===pending){this.#confirmation=null;this.requestUpdate();}}
  }

  #navigate(path:string,event?:MouseEvent){
    if(event&&(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;
    event?.preventDefault();
    if(path===this.store.route.get()||path===this.store.route.get().split("#")[0])return;
    void navigateInApp(this,navigation=>navigation.route(path));
  }

  async #submitOrganization(event:SubmitEvent){
    event.preventDefault();
    const form=event.currentTarget as HTMLFormElement,owner=this.#captureOwner();
    const data=new FormData(form),name=String(data.get("name")??"").trim();
    let organizationId="";
    const unchanged=await this.#mutateForm(()=>this.i18n.t("workspace.admin.created","Workspace created."),form,data,async(current)=>{
      const organization=await this.#request<{organizationId:string}>("/api/workspaces",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
      if(!current())return false;
      organizationId=organization.organizationId;
    });
    if(unchanged&&owner.current()&&organizationId)this.store.setRoute(`/settings/workspaces/${encodeURIComponent(organizationId)}/overview`);
  }

  #accept(invitation:Invitation){
    void this.#mutate(()=>this.i18n.t("workspace.admin.accepted","Workspace invitation accepted."),async()=>{
      const invitationId=invitation.invitation_id||invitation.membership_id;
      const query=new URL(location.href).searchParams;
      const token=query.get("invitation")===invitationId?query.get("token"):null;
      await this.#request(`/api/workspaces/${encodeURIComponent(invitation.organization_id)}/invitations/${encodeURIComponent(invitationId)}/accept`,{method:"POST",...(token?{headers:{"content-type":"application/json"},body:JSON.stringify({token})}:{})});
    });
  }

  #submitInvite(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route(),authorization=this.store.captureAuthorizationScope(),revision=this.#loadRevision;if(!authorization)return;
    void this.#mutateForm(()=>this.i18n.t("workspace.admin.invited","A private, expiring invitation was created."),form,data,async(current)=>{
      const email=String(data.get("email")??"").trim();
      const result=await this.#request<{invitationUrl:string;expiresAt:string}>(`/api/workspaces/${encodeURIComponent(organizationId)}/members`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,role:String(data.get("role")??"member")})});
      if(!current()||!this.store.authorizationScopeActive(authorization)||this.#route().organizationId!==organizationId||this.#loadRevision!==revision||this.#detail?.organization.organizationId!==organizationId||!this.#detail.permissions?.includes("workspace.member.manage"))return;
      this.#freshInvitation={url:result.invitationUrl,email,expiresAt:result.expiresAt,organizationId,authorization};
    });
  }

  #revokeInvitation(event:Event,invitation:PendingInvitation){
    const {organizationId}=this.#route(),eligible=()=>this.#workspacePermission(organizationId,"workspace.member.manage")
      &&Boolean(this.#detail?.invitations?.includes(invitation))&&invitation.status==="pending"
      &&(this.#workspaceOwner(organizationId)||invitation.role!=="administrator");
    return this.#confirmWorkspace(event,this.i18n.t("workspace.admin.revokeInvitation","Revoke invitation"),
      this.i18n.t("workspace.admin.confirmInvitationRevoke","Revoke the invitation for {email}?",{email:invitation.email_normalized}),
      eligible,()=>this.#mutate(()=>this.i18n.t("workspace.admin.invitationRevoked","The pending invitation was revoked."),async(current)=>{
        await this.#request("/api/workspaces/"+encodeURIComponent(organizationId)+"/invitations/"+encodeURIComponent(invitation.invitation_id),{method:"DELETE"});
        if(current()&&this.#freshInvitation?.email.toLowerCase()===invitation.email_normalized)this.#freshInvitation=null;
      }));
  }

  #revokeMember(event:Event,member:Member){
    const {organizationId}=this.#route(),eligible=()=>this.#workspacePermission(organizationId,"workspace.member.manage")
      &&Boolean(this.#detail?.members?.includes(member))&&member.status==="active"&&member.role!=="owner"
      &&(this.#workspaceOwner(organizationId)||member.role!=="administrator");
    return this.#confirmWorkspace(event,this.i18n.t("workspace.admin.revoke","Revoke"),
      this.i18n.t("workspace.admin.confirmRevoke","Remove {name} from this workspace and revoke all project access?",{name:member.display_name}),
      eligible,()=>this.#mutate(()=>this.i18n.t("workspace.admin.revoked","Workspace access was revoked."),async()=>{
        await this.#request("/api/workspaces/"+encodeURIComponent(organizationId)+"/members/"+encodeURIComponent(member.membership_id),{method:"DELETE"});
      }));
  }

  #updateMemberRole(member:Member,role:string){
    if(role===member.role)return;
    const {organizationId}=this.#route();
    void this.#mutate(()=>this.i18n.t("workspace.admin.roleUpdated","The organization role was updated."),async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.membership_id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({role})});
    });
  }

  #registerProject(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),projectId=String(data.get("projectId")??""),{organizationId}=this.#route();
    void this.#mutateForm(()=>this.i18n.t("workspace.admin.projectRegistered","The project was safely indexed for collaboration."),form,data,async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectId})});
    });
  }

  #grantProject(event:SubmitEvent,project:Project){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route();
    void this.#mutateForm(()=>this.i18n.t("workspace.admin.projectGranted","Project access was granted."),form,data,async(current)=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(project.project_access_id)}/members`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({userId:String(data.get("userId")??""),role:String(data.get("role")??"viewer")})});
      if(!current())return false;
      await this.#loadProjectMembers(project.project_access_id);
    });
  }

  async #loadProjectMembers(projectAccessId:string){
    const {organizationId}=this.#route(),revision=this.#loadRevision,owner=this.#captureOwner();
    const reads=this.#projectMemberReads.get(projectAccessId)??{revision:0,certified:0,invalidatedThrough:0,error:null};
    this.#projectMemberReads.set(projectAccessId,reads);
    const request=++reads.revision;
    const owned=()=>owner.authorized()&&this.#projectMemberReads.get(projectAccessId)===reads;
    const current=()=>revision===this.#loadRevision&&owned();
    const latest=()=>current()&&request===reads.revision&&request>reads.invalidatedThrough;
    try{
      const result=await this.#request<unknown>(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/members`,{},undefined,(response)=>{
        if(!owned()||request<=reads.invalidatedThrough)throw new Error("workspace_response_retired");
        if([401,403,404].includes(response.status)){
          // A pending newer read is not proof. Only a completed newer read can
          // supersede this denial; every already-issued read otherwise retires.
          if(request>reads.certified){
            reads.invalidatedThrough=reads.revision;
            this.#projectMembers.delete(projectAccessId);
            reads.error={key:"workspace.admin.unavailable"};
            this.requestUpdate();
          }
          throw new Error("workspace_response_retired");
        }
        if(!latest())throw new Error("workspace_response_retired");
      });
      if(!latest())return;
      if(!workspaceMemberResponse(result)){
        this.#projectMembers.delete(projectAccessId);
        reads.error={key:"workspace.admin.unavailable"};this.requestUpdate();return;
      }
      reads.certified=request;reads.error=null;
      this.#cacheOwner=owner;this.#projectMembers.set(projectAccessId,result.members);this.requestUpdate();
    }catch(error){
      if(!latest())return;
      this.#projectMembers.delete(projectAccessId);
      reads.error=error instanceof Error?{message:error.message}:{key:"workspace.admin.unavailable"};this.requestUpdate();
    }
  }

  #projectMemberNames(projectAccessId:string){
    const members=(this.#projectMembers.get(projectAccessId)??[]).filter(member=>member.status==="active"),detail=this.#detail;
    const qualifier=(number:number)=>this.i18n.t("workspace.admin.memberQualifier","Member {number}",{number:this.i18n.number(number)});
    const identity=(id:string)=>this.i18n.t("workspace.admin.memberIdentity","Member ID {id}",{id:"\u2068["+encodeURIComponent(id)+"]\u2069"});
    const names=qualifyDisplayCollisions(members.map(member=>({key:member.membership_id,label:member.display_name})),qualifier,identity);
    const organizationMembers=detail&&this.#cacheOwner?.authorized()&&detail.organization.organizationId===this.#route().organizationId?detail.members??[]:[];
    return qualifyDisplayCollisions(members.map(member=>{
      const email=organizationMembers.find(candidate=>candidate.user_id===member.user_id&&candidate.status==="active")?.email;
      return{key:member.membership_id,label:member.display_name+(names.get(member.membership_id)?.qualifier&&email?.trim()?" · \u2068"+email+"\u2069":"")};
    }),qualifier,identity);
  }

  #revokeProject(event:Event,projectAccessId:string,member:Member){
    const {organizationId}=this.#route(),name=this.#projectMemberNames(projectAccessId).get(member.membership_id)?.label??member.display_name;
    const eligible=()=>this.#workspacePermission(organizationId,"workspace.project.manage")
      &&Boolean(this.#projectMembers.get(projectAccessId)?.includes(member))&&member.status==="active"&&member.role!=="owner"
      &&this.#projectMemberNames(projectAccessId).get(member.membership_id)?.label===name;
    return this.#confirmWorkspace(event,this.i18n.t("workspace.admin.revoke","Revoke"),
      this.i18n.t("workspace.admin.confirmProjectRevoke","Remove {name} from this project?",{name}),
      eligible,()=>this.#mutate(()=>this.i18n.t("workspace.admin.projectRevoked","Project access was revoked."),async(current)=>{
        await this.#request("/api/workspaces/"+encodeURIComponent(organizationId)+"/projects/"+encodeURIComponent(projectAccessId)+"/members/"+encodeURIComponent(member.membership_id),{method:"DELETE"});
        if(current())await this.#loadProjectMembers(projectAccessId);
      }));
  }

  #updateProjectRole(projectAccessId:string,member:Member,role:string){
    if(role===member.role)return;
    const {organizationId}=this.#route();
    void this.#mutate(()=>this.i18n.t("workspace.admin.projectRoleUpdated","The project role was updated."),async(current)=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/members/${encodeURIComponent(member.membership_id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({role})});
      if(!current())return false;
      await this.#loadProjectMembers(projectAccessId);
    });
  }

  #updateProjectCanvas(projectAccessId:string,member:Member,enabled:boolean,control?:HTMLElement){
    return this.#updateProjectPermission(projectAccessId,member,enabled,"canvasAccess",
      ()=>this.i18n.t("workspace.admin.canvasAccessUpdated","Project Canvas access was updated."),control);
  }

  #updateProjectReviewer(projectAccessId:string,member:Member,enabled:boolean,control?:HTMLElement){
    return this.#updateProjectPermission(projectAccessId,member,enabled,"reviewAccess",
      ()=>this.i18n.t("workspace.admin.reviewAccessUpdated","Independent approval access was updated."),control);
  }

  async #updateProjectPermission(projectAccessId:string,member:Member,enabled:boolean,key:"canvasAccess"|"reviewAccess",description:WorkspaceMessage,control?:HTMLElement){
    if(this.#busy)return;
    const {organizationId}=this.#route(),owner=this.#captureOwner(),document=this.ownerDocument;
    const eligible=()=>owner.authorized()&&this.#detail?.organization.organizationId===organizationId
      &&Boolean(this.#detail.permissions?.includes("workspace.project.manage"))
      &&Boolean(this.#projectMembers.get(projectAccessId)?.some((candidate)=>candidate.membership_id===member.membership_id
        &&candidate.status==="active"&&candidate.role!=="owner"));
    if(!eligible())return;
    this.#retireFocus();
    const focus=control?.contains(document.activeElement)?captureOutputNavigationFocus(document):null;
    this.#permissionFocus=focus;
    try{
      await this.#mutate(description,async(current)=>{
        if(!eligible())return false;
        try{
          await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/members/${encodeURIComponent(member.membership_id)}`,{
            method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({[key]:enabled}),
          });
        }catch(error){if(current())await this.#loadProjectMembers(projectAccessId);throw error;}
        if(current())await this.#loadProjectMembers(projectAccessId);
      });
      if(!focus||this.#permissionFocus!==focus||!eligible()||!focus.current())return;
      await this.updateComplete;
      if(this.#permissionFocus!==focus||!eligible()||!focus.current()||!control?.isConnected
        ||!this.contains(control)||control.getAttribute("data-project-access-id")!==projectAccessId
        ||control.getAttribute("data-membership-id")!==member.membership_id||control.getAttribute("data-permission")!==key
        ||document.querySelector("dialog[open]"))return;
      const target=control.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if(target&&!target.disabled)focus.run(target,()=>{target.focus({preventScroll:true});return document.activeElement===target;});
    }finally{focus?.dispose();if(this.#permissionFocus===focus)this.#permissionFocus=null;}
  }

  #openProject(project:SharedProject){
    if(this.#busy||this.#mutation||this.#confirmation||this.#readUnavailable||!this.#overview?.projects.includes(project))return;
    const target={organizationId:project.organizationId,projectAccessId:project.projectAccessId,projectId:project.projectId};
    const projectCurrent=()=>Boolean(this.#overview?.projects.some(item=>item.organizationId===target.organizationId
      &&item.projectAccessId===target.projectAccessId&&item.projectId===target.projectId));
    const mutation:WorkspaceMutation={owner:this.#captureOwner(),acknowledged:false};
    if(!mutation.owner.authorized())return;
    this.#mutation=mutation;
    void navigateInApp(this,navigation=>this.#mutate(()=>this.i18n.t("workspace.admin.projectOpened","Shared project opened."),async()=>{
      const selection=this.store.beginProjectContextSelection({current:navigation.current});
      try{
        if(!projectCurrent())return false;
        const response=await selection.request(target);if(!response||!selection.sourceCurrent())return false;
        await this.#request("",{},response);
        if(!selection.sourceCurrent()||!projectCurrent()||!navigation.onOriginHandoff())return false;
        if(!await selection.refreshSession(navigation.onDestinationSource)||!selection.current()||!navigation.current())return false;
        this.store.setRoute("/projects",{current:()=>selection.current()&&navigation.current(),focus:navigation.focus});
        if(this.store.route.get()!=="/projects"||!navigation.current())return false;
        await this.store.load();
        if(!navigation.current()||this.store.route.get()!=="/projects"||!this.store.routeDataReady("/projects")
          ||this.store.projection.get().projectId!==target.projectId)return false;
      }finally{await selection.finish();}
    },navigation.current,mutation)).finally(()=>{
      if(this.#mutation===mutation&&!this.#busy){this.#mutation=null;this.requestUpdate();}
    });
  }

  #savePolicy(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route();
    void this.#mutateForm(()=>this.i18n.t("workspace.admin.policySaved","Workspace budget policy was updated."),form,data,async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/policy`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({tokenLimit:Number(data.get("tokenLimit")),microusdLimit:Math.round(Number(data.get("usdLimit"))*1_000_000)})});
    },true);
  }

  #configurePilot(event:SubmitEvent){
    event.preventDefault();const data=new FormData(event.currentTarget as HTMLFormElement),{organizationId}=this.#route();
    void this.#mutate("The controlled pilot is active for named participants only.",async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/pilot`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({maxParticipants:Number(data.get("participants")),participantCapMicrousd:Math.round(Number(data.get("participantUsd"))*1_000_000),organizationCapMicrousd:Math.round(Number(data.get("organizationUsd"))*1_000_000),evidenceDays:Number(data.get("evidenceDays"))})});
    });
  }

  #enrollPilot(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route();
    void this.#mutateForm("The named participant was enrolled in this pilot.",form,data,async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/pilot/participants`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:String(data.get("email")??""),role:String(data.get("role")??"member")})});
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
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route();
    void this.#mutateForm("Future project content will follow the updated retention periods.",form,data,async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/retention`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({transientDays:Number(data.get("transientDays")),evidenceDays:Number(data.get("evidenceDays")),revisionDays:Number(data.get("revisionDays")),legalHold:data.get("legalHold")==="on"})});
    },true);
  }

  #pilotControls(){
    const detail=this.#detail,pilot=this.#pilot,permissions=new Set(detail?.permissions??[]),manages=permissions.has("workspace.policy.manage"),managesMembers=permissions.has("workspace.member.manage");
    if(!detail||!pilot||!permissions.has("workspace.usage.read")&&!manages)return nothing;
    const format=(value:number)=>new Intl.NumberFormat(this.i18n.locale,{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value/1_000_000);
    if(!pilot.cohort||pilot.cohort.status==="closed")return manages&&detail.organization.role==="owner"?html`<section class="workspace-settings-card workspace-pilot-card"><h2>Controlled pilot${pilot.cohort?.status==="closed"?" " + this.i18n.system("· Closed"):""}</h2><p>${pilot.cohort?.status==="closed"?this.i18n.system("The previous pilot is closed. Paid work remains blocked until the organization owner explicitly starts a new controlled cohort."):this.i18n.system("Opt this organization into named-participant access, a fixed whole-pilot spending envelope, and prospective project-specific retention. Existing organizations remain unrestricted until you enable their pilot.")}</p><form class="workspace-settings-form" @submit=${this.#configurePilot}><label>Maximum participants<input type="number" name="participants" min="2" max="100" value="10" required ?disabled=${this.#busy}></label><label>Per-person limit for entire pilot (USD)<input type="number" name="participantUsd" min="0.01" max="15" step="0.01" value="15" required ?disabled=${this.#busy}></label><label>Organization limit for entire pilot (USD)<input type="number" name="organizationUsd" min="0.01" max="150" step="0.01" value="150" required ?disabled=${this.#busy}></label><label>Evidence retention (days)<input type="number" name="evidenceDays" min="1" max="3650" value="365" required ?disabled=${this.#busy}></label><forma-ui-cluster alignment="stretch" gap="small"><button type="submit" class="button primary compact" ?disabled=${this.#busy}>${pilot.cohort?.status==="closed"?this.i18n.system("Start replacement pilot"):this.i18n.system("Enable controlled pilot")}</button><button type="reset" class="button ghost compact" aria-label=${this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action:this.i18n.t("workspace.admin.discardPolicy"),name:"\u2068"+this.i18n.system("Controlled pilot")+"\u2069"})} ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.discardPolicy")}</button></forma-ui-cluster></form><small>Each cohort starts immediately and lasts 30 days. Reserve at least one seat for an independent reviewer. Use only non-sensitive source material your team is licensed to provide.</small></section>`:pilot.cohort?.status==="closed"?html`<section class="workspace-settings-card"><h2>Controlled pilot · Closed</h2><p>Paid work stays blocked until the organization owner explicitly starts a replacement cohort.</p></section>`:nothing;
    const cohort=pilot.cohort,organization=pilot.organizationBudget,participant=pilot.participantBudget,active=pilot.participants.filter((candidate)=>candidate.status==="active");
    const policy=this.#retention?.policy,retentionDraft=this.#policyDraft("pilot-retention",policy);
    const now=Date.now(),state=Date.parse(cohort.ends_at)<=now?"Expired":Date.parse(cohort.starts_at)>now?"Upcoming":cohort.status==="paused"?"Paused":"Active";
    return html`<section class="workspace-settings-card workspace-pilot-card"><header><h2>Controlled pilot · ${this.i18n.system(state)}</h2>${manages&&state!=="Expired"?html`<button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${()=>this.#setPilotStatus(cohort.status==="paused"?"active":"paused")}>${cohort.status==="paused"?this.i18n.system("Resume paid work"):this.i18n.system("Pause paid work")}</button>`:nothing}${manages&&detail.organization.role==="owner"?html`<button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>this.#setPilotStatus("closed")}>Close pilot</button>`:nothing}</header><p>${new Intl.DateTimeFormat(this.i18n.locale,{dateStyle:"medium"}).format(new Date(cohort.starts_at))} – ${new Intl.DateTimeFormat(this.i18n.locale,{dateStyle:"medium"}).format(new Date(cohort.ends_at))} · ${active.length} of ${cohort.max_participants} named participants</p><dl class="workspace-settings-facts"><dt>Whole-pilot organization limit</dt><dd>${format(Number(organization?.hard_limit_microusd??cohort.organization_cap_microusd))}</dd><dt>Whole-pilot organization committed</dt><dd>${format(Number(organization?.used_microusd??0)+Number(organization?.reserved_microusd??0))}</dd><dt>Your whole-pilot limit</dt><dd>${format(Number(participant?.hard_limit_microusd??cohort.participant_cap_microusd))}</dd><dt>Your whole-pilot committed</dt><dd>${format(Number(participant?.used_microusd??0)+Number(participant?.reserved_microusd??0))}</dd></dl><progress max=${Math.max(1,Number(organization?.hard_limit_microusd??cohort.organization_cap_microusd))} value=${Math.min(Number(organization?.hard_limit_microusd??cohort.organization_cap_microusd),Number(organization?.used_microusd??0)+Number(organization?.reserved_microusd??0))} aria-label="Whole-pilot organization spending"></progress><small>Unexpected provider charges remain visible and automatically pause additional paid work when the pilot limit is exceeded.</small>${managesMembers?html`<form class="workspace-settings-form" @submit=${this.#enrollPilot}><label>Named participant email<input name="email" type="email" required autocomplete="email"></label><label>Pilot role<select name="role"><option value="member">Author</option><option value="reviewer">Reviewer · no paid generation</option></select></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy||active.length>=cohort.max_participants}>Enroll participant</button></form><small>Invite each reviewer to the organization, add them to the relevant project as a Viewer, then enable their independent approval permission under Projects.</small>`:nothing}${active.length?html`<ul class="workspace-settings-list">${active.map((person)=>html`<li><div><b dir="auto">${person.email_normalized}</b><span>${person.role}${manages&&person.hard_limit_microusd!==null&&person.hard_limit_microusd!==undefined?" " + this.i18n.system("· {formatted} of {formatted2}", { formatted: format(Number(person.used_microusd??0)+Number(person.reserved_microusd??0)), formatted2: format(Number(person.hard_limit_microusd)) }):""}</span></div>${managesMembers&&person.role!=="owner"?html`<button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>this.#revokePilot(person)}>Revoke</button>`:nothing}</li>`)}</ul>`:nothing}${policy&&manages?html`<form class="workspace-settings-form" data-workspace-policy=${retentionDraft.key} data-workspace-policy-owner=${retentionDraft.owner} data-workspace-policy-snapshot=${retentionDraft.dirty?noChange:retentionDraft.saved} data-workspace-policy-dirty=${live(retentionDraft.dirty?"true":"false")} @submit=${this.#saveRetention}><label>Transient project content (days)<input type="number" name="transientDays" min="1" max="3650" .value=${retentionDraft.value(String(policy.transient_days))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label><label>Generation evidence (days)<input type="number" name="evidenceDays" min="1" max="3650" .value=${retentionDraft.value(String(policy.evidence_days))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label><label>Recoverable output history (days)<input type="number" name="revisionDays" min="1" max="3650" .value=${retentionDraft.value(String(policy.revision_days))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label><label><input type="checkbox" name="legalHold" .checked=${retentionDraft.value(Boolean(policy.legal_hold))} @change=${this.#policyEdited}> Preserve governed evidence and output history under legal hold</label>${this.#policyActions(retentionDraft,this.i18n.system("Save future retention policy"))}</form><small>Policy version ${policy.version}. Retention changes apply only to newly written content; a legal hold protects existing governed evidence. Uploaded original files and media are not removed by this policy.</small>`:nothing}<p>${pilot.maintenance?this.i18n.system("Last installation-wide scheduled cleanup: {status} on {formatted}.", { status: pilot.maintenance.status, formatted: new Intl.DateTimeFormat(this.i18n.locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(pilot.maintenance.started_at)) }):this.i18n.system("No scheduled cleanup has run yet. A hosting schedule is not configured by this local implementation.")}</p></section>`;
  }

  #saveSecurity(event:SubmitEvent){
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),{organizationId}=this.#route();
    const domains=String(data.get("allowedDomains")??"").split(/[\s,]+/).map((domain)=>domain.trim().toLowerCase()).filter(Boolean);
    void this.#mutateForm("Organization identity policy was updated and existing shared sessions were closed.",form,data,async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/security`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({authenticationSource:String(data.get("authenticationSource")??"any"),allowedEmailDomains:domains,maxSessionMinutes:Number(data.get("maxSessionMinutes")),expectedVersion:this.#security?.policy.version??0})});
    },true);
  }

  #reviewQueue(){
    const {organizationId}=this.#route();
    const tasks=this.store.reviewInbox.get().filter((task)=>!organizationId||task.organizationId===organizationId);
    if(!tasks.length)return nothing;
    return html`<section class="workspace-settings-card" aria-labelledby="workspace-assigned-review-heading"><h2 id="workspace-assigned-review-heading">Needs my review</h2><p>Only outputs assigned to your current independent reviewer permission appear here.</p><ul class="workspace-settings-list">${tasks.map((task)=>html`<li><div><b dir="auto">${task.artifactTitle||this.i18n.system("Finished output")} · revision ${task.revision}</b><span dir="auto">${[task.projectName,task.documentTitle].filter(Boolean).join(" · ")||task.organizationName}</span><span>Requested by ${task.requestedByName}${task.dueAt?" " + this.i18n.system("· due {value}", { value: this.i18n.date(new Date(task.dueAt),{dateStyle:"medium",timeStyle:"short"}) }):""}</span></div><button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${()=>void navigateInApp(this,navigation=>navigation.openAssignedReview(task))}>Open exact output</button></li>`)}</ul></section>`;
  }

  #contextPackages(){
    const context=this.store.session.get()?.projectContext,{organizationId}=this.#route();
    const source=context?.organizationId===organizationId&&context.permissions.includes("project.library.manage")&&this.store.projection.get().documentId;
    const manages=this.#detail?.permissions?.includes("workspace.policy.manage")||this.#detail?.permissions?.includes("workspace.project.manage");
    return html`<section class="workspace-settings-card" aria-labelledby="workspace-context-package-heading"><h2 id="workspace-context-package-heading">${this.i18n.system("Organization context")}</h2><p>${this.i18n.system("Approved decisions belong to this organization. Every document chooses an exact immutable version.")}</p>${this.#packages.length?html`<ul class="workspace-settings-list">${repeat(this.#packages,(item)=>JSON.stringify([item.id,item.pendingDraftVersionId??null]),(item)=>localizeTemplateResult(html`<li><div><b dir="auto">${item.name}</b><span>${item.version===null?this.i18n.t("workspace.context.awaiting"):this.i18n.system("Version {version}",{version:this.i18n.number(item.version)})}${item.pendingDraftVersionId?` · ${this.i18n.t("workspace.context.awaiting")}`:""} · ${this.i18n.system("{blockCount} reusable creative decisions",{blockCount:this.i18n.number(item.blockCount)})} · ${this.i18n.t("workspace.context.documents","",{count:this.i18n.number(item.bindingCount)})}</span>${item.pendingDraftVersionId&&item.draftPreview?.length?html`<details><summary>${this.i18n.t("workspace.context.review")}</summary><ul>${item.draftPreview.map((decision)=>html`<li><b dir="auto">${decision.handle}</b><small>${this.i18n.t(`workspace.context.intent.${decision.intent}`)} · ${this.i18n.t(decision.active?"workspace.context.active":"workspace.context.inactive")}${decision.locked?` · ${this.i18n.system("Locked")}`:""}</small>${decision.text?html`<pre dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${decision.text}</pre>`:nothing}${decision.exactText?html`<small>${this.i18n.t("workspace.context.exact")}</small><pre dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${decision.exactText}</pre>`:nothing}${decision.exactPlacements.length?html`<small>${this.i18n.t("workspace.context.placements")}: ${decision.exactPlacements.map((placement)=>this.i18n.t(`workspace.context.placement.${placement}`,placement)).join(", ")}</small>`:nothing}${decision.protectedPhrases.map((phrase)=>html`<small>${this.i18n.t("workspace.context.exact")}${phrase.placement?` · ${this.i18n.t(`workspace.context.placement.${phrase.placement}`,phrase.placement)}`:""}</small><pre dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${phrase.text}</pre>`)}${decision.relations.map((relation)=>html`<small>${this.i18n.t("workspace.context.relationship")}: ${this.i18n.t(`workspace.context.relation.${relation.kind}`,relation.kind)} → ${relation.targetHandle}</small>`)}${decision.sourceName?html`<small dir="auto">${decision.sourceName}${decision.rightsExpiresAt?` · ${decision.rightsExpiresAt}`:""}</small>`:nothing}</li>`)}</ul>${item.canApprove?html`<form data-workspace-review @submit=${async(event:SubmitEvent)=>{event.preventDefault();const owner=this.#captureOwner(),form=event.currentTarget as HTMLFormElement;if(!owner.authorized()||!form.isConnected||!this.contains(form))return;if(await this.store.approveOrganizationContextPackage(item.id,item.pendingDraftVersionId!,organizationId)&&owner.authorized()&&form.isConnected&&this.contains(form))await this.#load();}}><label><input type="checkbox" name="reviewed" required> ${this.i18n.system("I reviewed these decisions, sources, and changes to finished outputs.")}</label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.context.approve")}</button></form>`:nothing}</details>`:nothing}</div>${source&&item.versionId?html`<button type="button" class="button secondary compact" @click=${()=>void this.store.adoptOrganizationContextPackage(item.id,item.versionId!)}>${this.i18n.t("workspace.context.use")}</button>`:nothing}</li>`,this.i18n))}</ul>`:html`<p>${this.i18n.system("No approved organization context has been published.")}</p>`}${source&&manages?html`<button type="button" class="button secondary compact" @click=${()=>this.#navigate("/library")}>${this.i18n.system("Choose exact decisions and licensed sources in the Library")}</button>`:nothing}<small>${this.i18n.system("Explicitly approved original files, verified citations, and rights are copied into independent organizational custody and into each authorized destination.")}</small></section>`;
  }

  #securityControls(){
    const security=this.#security;if(!security)return nothing;
    const draft=this.#policyDraft("security",security.policy);
    return html`<section class="workspace-settings-card"><h2>Identity & storage controls</h2><p>Current sign-in source: <b>${security.observedSignInSource}</b>. Email domains are allowlisted, not independently verified.</p><form class="workspace-settings-form" data-workspace-policy=${draft.key} data-workspace-policy-owner=${draft.owner} data-workspace-policy-snapshot=${draft.dirty?noChange:draft.saved} data-workspace-policy-dirty=${live(draft.dirty?"true":"false")} @submit=${this.#saveSecurity}><label>Allowed email domains<input name="allowedDomains" .value=${draft.value(security.policy.allowedEmailDomains.join(", "))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} placeholder="example.com, example.org"></label><label>Observed sign-in source<select name="authenticationSource" .value=${draft.value(security.policy.authenticationSource)} @change=${this.#policyEdited}><option value="any">Any available platform identity</option><option value="openai-workspace">OpenAI workspace identity</option><option value="cloudflare-access">Cloudflare Access email</option><option value="local-development">Local development identity</option></select></label><label>Maximum project session (minutes, 480 maximum)<input type="number" min="5" max="480" name="maxSessionMinutes" .value=${draft.value(String(security.policy.maxSessionMinutes))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label>${this.#policyActions(draft,this.i18n.system("Save identity policy"))}</form><dl class="workspace-settings-facts"><dt>Encrypted recovery snapshots</dt><dd>${security.encryption.recoverySnapshots}</dd><dt>Primary storage application encryption</dt><dd>${security.encryption.primaryDatabaseAndObjectStorage}</dd><dt>Verified SSO, MFA, and customer-managed keys</dt><dd>Not available</dd></dl></section>`;
  }

  #assuranceControls(){
    const report=this.#assurance,{organizationId}=this.#route();if(!report)return nothing;
    return html`<section class="workspace-settings-card"><h2>Trust & operational readiness</h2><dl class="workspace-settings-facts"><dt>Enterprise purchase readiness</dt><dd>${report.enterpriseReady?this.i18n.system("Ready"):this.i18n.system("External verification still required")}</dd>${outcomeSchedulerEvidence(report.scheduler,this.i18n)}<dt>Expired tenant records awaiting cleanup</dt><dd>${report.retention.pendingCount}</dd><dt>Records protected by legal hold</dt><dd>${report.retention.heldCount}</dd><dt>Independent reviews awaiting action</dt><dd>${report.reviews.pendingCount}</dd><dt>Versioned organization context</dt><dd>${report.packages.activeCount}</dd></dl><details><summary>${report.enterpriseBlockers.length} controls still require external evidence or further implementation</summary><ul class="workspace-settings-list">${report.controls.map((control)=>html`<li><div><b>${control.id.replaceAll("-"," ")} · ${control.status}</b><span>${control.summary}</span></div></li>`)}</ul></details><a class="button secondary compact" href=${`/api/workspaces/${encodeURIComponent(organizationId)}/assurance/export`} download>Download sanitized assurance evidence</a></section>`;
  }

  #releaseHold(event:Event,hold:LegalHold){
    const {organizationId}=this.#route(),holdId=hold.hold_id,target=this.#holdNames().get(holdId)?.label;
    if(!target)return;
    return this.#confirmWorkspace(event,this.i18n.system("Release hold"),
      this.i18n.system("Release this legal hold? Eligible expired evidence can then be removed.")+"\n"+this.#selectedTarget(target),
      ()=>this.#workspacePermission(organizationId,"workspace.policy.manage")&&this.#holds.includes(hold)&&hold.status==="active"
        &&hold.hold_id===holdId&&this.#holdNames().get(holdId)?.label===target,
      ()=>this.#mutate("The selected legal hold was explicitly released.",async()=>{
        await this.#request("/api/workspaces/"+encodeURIComponent(organizationId)+"/holds/"+encodeURIComponent(holdId),{method:"DELETE"});
      }));
  }

  #confirmRecovery(event:Event,kind:"create"|"rotate"|"restore"|"cleanup",snapshot?:RecoverySnapshot){
    const {organizationId}=this.#route(),endpoint="/api/workspaces/"+encodeURIComponent(organizationId);
    const configured=()=>Boolean(this.#security&&this.#security.encryption.recoverySnapshots!=="not-configured");
    const eligible=()=>this.#workspaceOwner(organizationId)&&(kind==="cleanup"||configured())
      &&(kind==="create"||kind==="rotate"||Boolean(snapshot&&this.#snapshots.includes(snapshot)
        &&snapshot.status===(kind==="restore"?"available":"cleanup-pending")));
    const label=kind==="create"?this.i18n.system("Create encrypted snapshot"):kind==="rotate"?this.i18n.system("Rotate recovery key")
      :kind==="restore"?this.i18n.system("Restore")+" · "+this.i18n.system("Keep isolated"):this.i18n.system("Try again");
    let message=kind==="create"?this.i18n.system("Create an encrypted snapshot of every project you are authorized to read?")
      :kind==="rotate"?this.i18n.system("Rotate this organization's recovery key? Existing snapshots remain decryptable.")
      :kind==="restore"?this.i18n.system("Restore")+" · "+this.i18n.system("Keep isolated")
      :this.i18n.system("Remove")+" · "+this.i18n.system("Try again");
    if(snapshot){
      const target=this.#snapshotNames().get(snapshot.snapshot_id)?.label;
      if(!target)return;
      message+="\n"+this.#selectedTarget(target);
    }
    const description=kind==="create"?"An encrypted, tenant-scoped recovery snapshot was created."
      :kind==="rotate"?"The tenant recovery encryption key was safely rotated."
      :kind==="restore"?"The encrypted recovery snapshot was staged in isolation and completely rolled back without changing production data."
      :"The incomplete encrypted recovery object was removed and its deletion was independently verified.";
    const body=kind==="create"?{action:"create",confirmation:"CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"}
      :kind==="restore"?{action:"restore",snapshotId:snapshot?.snapshot_id,organizationId,confirmation:"RESTORE_ORGANIZATION_SNAPSHOT_TO_ISOLATED_ROLLBACK_STAGE"}
      :{action:"cleanup",snapshotId:snapshot?.snapshot_id,organizationId,confirmation:"RETRY_ORGANIZATION_RECOVERY_OBJECT_CLEANUP"};
    return this.#confirmWorkspace(event,label,message,eligible,()=>this.#mutate(description,async()=>{
      await this.#request(kind==="rotate"?endpoint+"/security/keys/rotate":endpoint+"/recovery",
        kind==="rotate"?{method:"POST"}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    }));
  }

  #revokeCredential(event:Event,credential:ProvisioningCredential){
    const {organizationId}=this.#route();
    const target=this.#credentialNames().get(credential.id)?.label;
    if(!target)return;
    return this.#confirmWorkspace(event,this.i18n.system("Revoke token"),
      this.i18n.system("Immediately revoke this organization provisioning token?")+"\n"+this.#selectedTarget(this.i18n.system("Active scoped token")+" · "+target),
      ()=>this.#workspaceOwner(organizationId)&&this.#credentials.includes(credential)&&credential.status==="active",
      ()=>this.#mutate("The exact provisioning credential was revoked immediately.",async(current)=>{
        await this.#request("/api/workspaces/"+encodeURIComponent(organizationId)+"/security/provisioning-credentials/"+encodeURIComponent(credential.id),{method:"DELETE"});
        if(current())this.#freshProvisioningToken=null;
      }));
  }

  #confirmOwnershipTransfer(event:SubmitEvent){
    event.preventDefault();
    const form=event.currentTarget as HTMLFormElement,{organizationId}=this.#route();
    const target=String(new FormData(form).get("targetUserId")??"");
    const member=this.#detail?.members?.find(candidate=>candidate.user_id===target&&candidate.status==="active"&&candidate.role==="administrator");
    const targetName=member&&this.#transferMemberNames().get(member.membership_id)?.label;
    if(!targetName)return;
    return this.#confirmWorkspace(event,this.i18n.system("Transfer administrative ownership"),
      this.i18n.system("Transfer administrative ownership to this eligible administrator? Your current project session will close.")+"\n"+this.#selectedTarget(targetName),
      ()=>this.#workspaceOwner(organizationId)&&Boolean(member&&this.#detail?.members?.includes(member)
        &&member.status==="active"&&member.role==="administrator")&&String(new FormData(form).get("targetUserId")??"")===target,
      ()=>this.#mutate("Organization administrative ownership was transferred.",async()=>{
        await this.#request("/api/workspaces/"+encodeURIComponent(organizationId)+"/ownership",{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({targetUserId:target,confirmation:"TRANSFER_ORGANIZATION_OWNERSHIP"})});
      }));
  }

  #confirmPrivacyMigration(event:Event){
    const {organizationId}=this.#route();
    return this.#confirmWorkspace(event,this.i18n.system("Migrate historical event privacy"),
      this.i18n.system("Privately migrate only this organization's historical authored events before irreversible deletion? Other organizations and personal projects remain unchanged."),
      ()=>this.#workspaceOwner(organizationId),()=>this.#mutate("Historical authored events for this organization were moved behind their erasable privacy boundary.",async()=>{
        await this.#request("/api/workspaces/"+encodeURIComponent(organizationId)+"/recovery",{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({action:"migrate-privacy",organizationId,confirmation:"MIGRATE_ORGANIZATION_HISTORICAL_EVENT_CONTENT"})});
      }));
  }

  #confirmDeletion(event:Event,retry=false){
    event.preventDefault();
    if(this.#busy||this.#confirmation)return;
    const {organizationId}=this.#route(),detail=this.#detail,job=this.#deletionJob,form=event.currentTarget as HTMLFormElement;
    if(!this.#workspaceOwner(organizationId)||!detail)return;
    const entered=retry?"":String(new FormData(form).get("organizationName")??"");
    if(!retry&&entered!==detail.organization.name){
      this.#error="Enter the exact organization name to confirm this irreversible deletion.";this.requestUpdate();return;
    }
    const eligible=()=>this.#workspaceOwner(organizationId)&&this.#detail===detail
      &&(retry?this.#deletionJob===job&&Boolean(job&&["pending","partial","processing"].includes(job.status))
        :String(new FormData(form).get("organizationName")??"")===entered&&entered===this.#detail.organization.name
          &&!this.#holds.some(hold=>hold.status==="active")&&!this.#snapshots.some(snapshot=>["cleanup-pending","staging"].includes(snapshot.status)));
    return this.#confirmWorkspace(event,retry?this.i18n.system("Try again"):this.i18n.system("Permanently delete organization data"),
      this.i18n.system("Permanently erase scoped organization projects, sources, context packages, output revisions, memberships, and recovery snapshots? Active legal holds prevent deletion."),
      eligible,()=>this.#deleteOrganization(organizationId));
  }

  #retentionControls(){
    if(!this.#detail?.permissions?.includes("workspace.policy.manage"))return nothing;
    const policy=this.#retention?.policy,names=this.#holdNames(),draft=this.#policyDraft("retention",policy);
    return html`<section class="workspace-settings-card"><h2>Retention & scoped legal holds</h2>
      <p>Set prospective project retention separately from controlled-pilot enrollment. Scoped holds prevent cleanup and organization deletion.</p>
      <form class="workspace-settings-form" data-workspace-policy=${draft.key} data-workspace-policy-owner=${draft.owner} data-workspace-policy-snapshot=${draft.dirty?noChange:draft.saved} data-workspace-policy-dirty=${live(draft.dirty?"true":"false")} @submit=${this.#saveRetention}>
        <label>Transient project content (days)<input type="number" name="transientDays" min="1" max="3650" .value=${draft.value(String(policy?.transient_days??30))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label>
        <label>Generation evidence (days)<input type="number" name="evidenceDays" min="1" max="3650" .value=${draft.value(String(policy?.evidence_days??365))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label>
        <label>Recoverable output history (days)<input type="number" name="revisionDays" min="1" max="3650" .value=${draft.value(String(policy?.revision_days??365))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label>
        <label><input type="checkbox" name="legalHold" .checked=${draft.value(Boolean(policy?.legal_hold))} @change=${this.#policyEdited}> Preserve all governed evidence and output history</label>
        ${this.#policyActions(draft,this.i18n.system("Save retention policy"))}
      </form>
      <form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>{
        event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form),organizationId=this.#route().organizationId;
        void this.#mutateForm("The exact organization evidence is protected by an active legal hold.",form,data,async()=>{
          await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/holds`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scope:String(data.get("scope")??"organization"),resourceId:String(data.get("resourceId")??""),reason:String(data.get("reason")??"")})});
        });
      }}>
        <label>Hold scope<select name="scope"><option value="organization">Entire organization</option><option value="project">Project access ID</option><option value="content">Exact evidence content ID</option><option value="artifact">Exact finished output ID</option></select></label>
        <label>Project, evidence, or output identifier<input name="resourceId" placeholder="Not required for the entire organization"></label>
        <label>Reason for preserving this evidence<input name="reason" maxlength="300" required></label>
        <button type="submit" class="button secondary compact" ?disabled=${this.#busy}>Place scoped legal hold</button>
      </form>
      ${this.#holds.filter((hold)=>hold.status==="active").length?html`<ul class="workspace-settings-list">${this.#holds.filter((hold)=>hold.status==="active").map((hold)=>html`<li><div><b><bdi>${names.get(hold.hold_id)!.label}</bdi></b></div><button type="button" class="button ghost compact" aria-label=${this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action:this.i18n.system("Release hold"),name:"\u2068"+names.get(hold.hold_id)!.label+"\u2069"})} ?disabled=${this.#busy} @click=${(event:Event)=>void this.#releaseHold(event,hold)}>Release hold</button></li>`)}</ul>`:html`<small>No scoped legal holds are active.</small>`}
    </section>`;
  }

  #automationControls(){
    if(!this.#automation.size)return nothing;
    const organizationId=this.#route().organizationId;
    return html`<section class="workspace-settings-card"><h2>Review scheduling & in-app automation</h2><p>Notifications stay inside Forma. Automation never approves work, contacts an external provider, or spends money.</p>
      ${repeat([...this.#automation.entries()],([projectAccessId])=>projectAccessId,([projectAccessId,policy])=>{
        const name=this.#detail?.projects?.find((project)=>project.project_access_id===projectAccessId)?.project_name
          ??this.#overview?.projects.find((project)=>project.projectAccessId===projectAccessId)?.projectName??"Shared project";
        const draft=this.#policyDraft("automation:"+projectAccessId,policy);
        return html`<form class="workspace-settings-form" data-workspace-policy=${draft.key} data-workspace-policy-owner=${draft.owner} data-workspace-policy-snapshot=${draft.dirty?noChange:draft.saved} data-workspace-policy-dirty=${live(draft.dirty?"true":"false")} @submit=${(event:SubmitEvent)=>{
          event.preventDefault();const form=event.currentTarget as HTMLFormElement,data=new FormData(form);
          void this.#mutateForm("Project-specific review scheduling and notifications were updated.",form,data,async()=>{
            await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/automation`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({enabled:data.get("enabled")==="on",notifyContextChanges:data.get("notifyContextChanges")==="on",notifyOutputReady:data.get("notifyOutputReady")==="on",reviewDueHours:Number(data.get("reviewDueHours")),reminderHours:Number(data.get("reminderHours")),expectedVersion:policy.version})});
          },true);
        }}><h3 dir="auto">${name}</h3>
          <label><input type="checkbox" name="enabled" .checked=${draft.value(policy.enabled)} @change=${this.#policyEdited}> Enable safe in-app automation</label>
          <label><input type="checkbox" name="notifyContextChanges" .checked=${draft.value(policy.notifyContextChanges)} @change=${this.#policyEdited}> Notify project editors about context changes</label>
          <label><input type="checkbox" name="notifyOutputReady" .checked=${draft.value(policy.notifyOutputReady)} @change=${this.#policyEdited}> Notify project editors when outputs are ready</label>
          <label>Review becomes due after (hours)<input type="number" name="reviewDueHours" min="1" max="720" .value=${draft.value(String(policy.reviewDueHours))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label>
          <label>Remind assigned reviewer before due time (hours)<input type="number" name="reminderHours" min="1" max="720" .value=${draft.value(String(policy.reminderHours))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label>
          ${this.#policyActions(draft,this.i18n.system("Save project automation"))}
          <a class="button ghost compact" href=${`/api/workspaces/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectAccessId)}/automation/runs`} target="_blank" rel="noopener">Inspect bounded delivery history</a>
        </form>`;
      })}
    </section>`;
  }

  #recoveryControls(){
    if(this.#detail?.organization.role!=="owner"||!this.#security)return nothing;
    const organizationId=this.#route().organizationId,configured=this.#security.encryption.recoverySnapshots!=="not-configured",names=this.#snapshotNames();
    return html`<section class="workspace-settings-card"><h2>Encrypted recovery evidence</h2><p>${this.i18n.system("Encrypted recovery snapshots")} · ${this.i18n.system("Verify integrity")} · ${this.i18n.system("Keep isolated")}</p>
      <div class="family-actions"><button type="button" class="button secondary compact" ?disabled=${this.#busy||!configured} @click=${(event:Event)=>void this.#confirmRecovery(event,"create")}>Create encrypted snapshot</button>
      <button type="button" class="button ghost compact" ?disabled=${this.#busy||!configured} @click=${(event:Event)=>void this.#confirmRecovery(event,"rotate")}>Rotate recovery key</button></div>
      ${!configured?html`<small>An external 32-byte development root is required before encrypted snapshots are available.</small>`:nothing}
      ${this.#snapshots.length?html`<ul class="workspace-settings-list">${this.#snapshots.map((snapshot)=>html`<li><div><b><bdi>${names.get(snapshot.snapshot_id)!.label}</bdi></b><span>${snapshot.status} · encrypted recovery evidence</span></div><button type="button" class="button secondary compact" aria-label=${this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action:this.i18n.system("Verify integrity"),name:`\u2068${names.get(snapshot.snapshot_id)!.label}\u2069`})} ?disabled=${this.#busy||!configured||snapshot.status!=="available"} @click=${()=>void this.#mutate("The encrypted snapshot and its scoped evidence passed an integrity drill.",async()=>{await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/recovery`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"drill",snapshotId:snapshot.snapshot_id,confirmation:"VERIFY_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"})});})}>Verify integrity</button><button type="button" class="button ghost compact" aria-label=${this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action:this.i18n.system("Restore")+" · "+this.i18n.system("Keep isolated"),name:`\u2068${names.get(snapshot.snapshot_id)!.label}\u2069`})} ?disabled=${this.#busy||!configured||snapshot.status!=="available"} @click=${(event:Event)=>void this.#confirmRecovery(event,"restore",snapshot)}>${this.i18n.system("Restore")} · ${this.i18n.system("Keep isolated")}</button>${snapshot.status==="cleanup-pending"?html`<button type="button" class="button secondary compact" aria-label=${this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action:this.i18n.system("Try again"),name:`\u2068${names.get(snapshot.snapshot_id)!.label}\u2069`})} ?disabled=${this.#busy} @click=${(event:Event)=>void this.#confirmRecovery(event,"cleanup",snapshot)}>${this.i18n.system("Try again")}</button>`:nothing}</li>`)}</ul>`:html`<small>No encrypted recovery snapshots have been created.</small>`}
    </section>`;
  }

  async #issueProvisioningToken(organizationId:string){
    const owner=this.#captureOwner();
    const eligible=()=>owner.authorized()&&this.#route().organizationId===organizationId
      &&this.#detail?.organization.organizationId===organizationId&&this.#detail.organization.role==="owner";
    if(!eligible())return;
    await this.#mutate("A scoped provisioning token was created and is displayed only during this authorized session.",async(current)=>{
      if(!eligible())return false;
      const issued=await this.#request<{token:string}>(`/api/workspaces/${encodeURIComponent(organizationId)}/security/provisioning-credentials`,{method:"POST"});
      if(!current()||!eligible())return false;
      this.#freshProvisioningToken={value:issued.token,owner};
    },eligible);
  }

  #provisioningControls(){
    if(this.#detail?.organization.role!=="owner")return nothing;
    const organizationId=this.#route().organizationId;
    const names=this.#credentialNames();
    const token=this.#freshProvisioningToken?.owner.authorized()?this.#freshProvisioningToken.value:null;
    return html`<section class="workspace-settings-card"><h2>Scoped identity provisioning</h2><p>Provisioning credentials authorize this exact organization's local API only. They do not imply verified SSO, SCIM federation, or multifactor authentication.</p>
      <button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${()=>void this.#issueProvisioningToken(organizationId)}>Create one-time provisioning token</button>
      ${token?html`<label>Copy this token now; it will not be shown again<input readonly .value=${token} @focus=${(event:FocusEvent)=>(event.currentTarget as HTMLInputElement).select()}></label><button type="button" class="button ghost compact" @click=${()=>{this.#freshProvisioningToken=null;this.requestUpdate();}}>Hide token</button>`:nothing}
      ${this.#credentials.filter((credential)=>credential.status==="active").length?html`<ul class="workspace-settings-list">${this.#credentials.filter((credential)=>credential.status==="active").map((credential)=>html`<li><div><b>Active scoped token</b><span>Created <bdi>${names.get(credential.id)!.label}</bdi></span></div><button type="button" class="button ghost compact" aria-label=${this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action:this.i18n.system("Revoke token"),name:`\u2068${this.i18n.system("Active scoped token")} · ${names.get(credential.id)!.label}\u2069`})} ?disabled=${this.#busy} @click=${(event:Event)=>void this.#revokeCredential(event,credential)}>Revoke token</button></li>`)}</ul>`:nothing}
    </section>`;
  }

  async #deleteOrganization(organizationId:string){
    const owner=this.#captureOwner();
    if(!owner.authorized()||this.#detail?.organization.organizationId!==organizationId||this.#detail.organization.role!=="owner")return;
    const acknowledged=await this.#mutate("The organization was deleted; immutable operational receipts and external backup/device exceptions remain disclosed.",async()=>{
      await this.#request(`/api/workspaces/${encodeURIComponent(organizationId)}/deletion`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId,confirmation:"DELETE_ORGANIZATION_AND_SCOPED_DATA"})});
    });
    if(acknowledged&&owner.current())this.store.setRoute("/settings/workspaces");
  }

  #deletionRecoveryControls(){
    if(this.#detail?.organization.role!=="owner"||!this.#deletionJob||!["pending","partial","processing"].includes(this.#deletionJob.status))return nothing;
    return html`<section class="workspace-settings-card"><h2>${this.i18n.system("Organization ownership & offboarding")}</h2><p>${this.i18n.system("Permanently delete organization data")} · ${this.i18n.system("Try again")}</p><button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${(event:Event)=>void this.#confirmDeletion(event,true)}>${this.i18n.system("Try again")}</button></section>`;
  }

  #ownershipAndDeletionControls(){
    const detail=this.#detail,inventory=this.#deletionInventory;if(detail?.organization.role!=="owner"||!inventory)return nothing;
    const eligible=(detail.members??[]).filter((member)=>member.status==="active"&&member.role==="administrator");
    const names=this.#transferMemberNames();
    return html`<section class="workspace-settings-card"><h2>Organization ownership & offboarding</h2><p>Administrative ownership transfers only after the outgoing owner no longer controls an active project. Project custody transfer remains unavailable.</p>
      ${eligible.length?html`<form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>void this.#confirmOwnershipTransfer(event)}><label>Eligible administrator<select name="targetUserId" required><option value="">${this.i18n.t("field.choose","Choose an option")}</option>${repeat(eligible,(member)=>member.membership_id,(member)=>html`<option value=${member.user_id}>${names.get(member.membership_id)!.label}</option>`)}</select></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>Transfer administrative ownership</button></form>`:html`<small>Add an eligible organization administrator before transferring ownership.</small>`}
      <details><summary>Permanently delete this organization and its scoped customer data</summary><p>${inventory.projectCount} project${inventory.projectCount===1?"":"s"}, ${inventory.mediaCount} unique original object${inventory.mediaCount===1?"":"s"}, ${inventory.packageCount} context package${inventory.packageCount===1?"":"s"}, and ${inventory.revisionCount} output revision${inventory.revisionCount===1?"":"s"} are inventoried. Immutable operational/audit metadata remains. External backups and other devices are not purged.</p>
        <button type="button" class="button secondary compact" ?disabled=${this.#busy} @click=${(event:Event)=>void this.#confirmPrivacyMigration(event)}>${this.i18n.system("Migrate historical event privacy")}</button>
        <form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>void this.#confirmDeletion(event)}><label>Type the exact organization name<input name="organizationName" autocomplete="off" required></label><button type="submit" class="button ghost compact" ?disabled=${this.#busy||this.#holds.some((hold)=>hold.status==="active")||this.#snapshots.some((snapshot)=>snapshot.status==="cleanup-pending"||snapshot.status==="staging")}>Permanently delete organization data</button></form>
      </details>
    </section>`;
  }

  #sectionDestinations(organizationId:string){
    const permissions=new Set(this.#detail?.permissions??[]);
    const allowed=(item:WorkspaceSection)=>item==="overview"||item==="members"&&permissions.has("workspace.member.read")||item==="projects"&&permissions.has("workspace.project.read")||item==="usage"&&permissions.has("workspace.usage.read")||item==="activity"&&permissions.has("workspace.audit.read");
    return sections.filter(allowed).map((item)=>({label:this.i18n.t(`workspace.admin.section.${item}`,item),value:item,href:`/settings/workspaces/${encodeURIComponent(organizationId)}/${item}`}));
  }

  #refreshSettings(event:Event,owner:WorkspaceResponseOwner){
    const control=event.currentTarget as HTMLElement|null;
    if(this.#loading||this.#busy||this.#confirmation||this.#readUnavailable
      ||!control?.isConnected||!this.contains(control)||!owner.authorized()
      ||!this.#cacheOwner?.authorized()||!this.#detail)return;
    // This deliberate read uses the existing collection owner. Native
    // drafts and focus remain with their current controls; no command runs.
    void this.#load();
  }

  #refreshSettingsControl(){
    const owner=this.#captureOwner();
    return html`<forma-ui-cluster gap="small"><button type="button" class="button secondary compact" data-workspace-settings-refresh aria-describedby="workspace-settings-refresh-help"
      ?disabled=${this.#loading||this.#busy||Boolean(this.#confirmation)}
      @click=${(event:Event)=>this.#refreshSettings(event,owner)}>${this.i18n.system(this.#loading?"Refreshing…":"Refresh")}</button><span id="workspace-settings-refresh-help">${this.i18n.t("workspace.admin.refreshHelp","Refresh reads current settings; it does not save your edits.")}</span></forma-ui-cluster>`;
  }

  #sectionLinks(organizationId:string,section:WorkspaceSection){
    const destinations=this.#sectionDestinations(organizationId);
    return html`<forma-ui-audience-navigation class="workspace-settings-navigation" .label=${this.i18n.t("workspace.admin.navigation","Organization settings")} .value=${section} .destinations=${destinations} @forma-navigate=${(event:CustomEvent<{href:string}>)=>{event.preventDefault();this.#navigate(event.detail.href);}}></forma-ui-audience-navigation>`;
  }

  #organizationOverview(organizationId:string){
    const detail=this.#detail,owner=this.#cacheOwner;
    if(!detail||detail.organization.organizationId!==organizationId||!owner?.authorized())return nothing;
    const destinations=this.#sectionDestinations(organizationId).filter((item)=>item.value!=="overview");
    const reachable=new Set(destinations.map((item)=>item.value));
    const permissions=new Set(detail.permissions??[]),manages=permissions.has("workspace.policy.manage");
    const pilotVisible=Boolean(this.#pilot)&&(permissions.has("workspace.usage.read")||manages)
      &&(Boolean(this.#pilot?.cohort)||(manages&&detail.organization.role==="owner"));
    const descriptions:Partial<Record<WorkspaceSection,string>>={
      members:[this.i18n.t("workspace.admin.memberCaption","Organization members and invitations"),detail.organization.role==="owner"?this.i18n.system("Identity & storage controls"):"",pilotVisible?this.i18n.system("Controlled pilot"):""].filter(Boolean).join(" · "),
      projects:[this.i18n.system("Organization context"),this.#automation.size?this.i18n.system("Review scheduling & in-app automation"):""].filter(Boolean).join(" · "),
      usage:[this.i18n.t("workspace.admin.settled","Settled spending"),this.i18n.t("workspace.admin.reserved","Active reservations"),manages?this.i18n.system("Retention & scoped legal holds"):"",pilotVisible?this.i18n.system("Controlled pilot"):""].filter(Boolean).join(" · "),
      activity:[this.i18n.system("Trust & operational readiness"),detail.organization.role==="owner"?this.i18n.system("Encrypted recovery evidence"):""].filter(Boolean).join(" · "),
    };
    // Independently granted tasks can lack a readable section. Keep only those
    // existing helpers here; do not broaden section reads or silently drop actions.
    const preserved=[
      !reachable.has("projects")?this.#contextPackages():nothing,
      !reachable.has("projects")?this.#automationControls():nothing,
      !reachable.has("activity")?this.#assuranceControls():nothing,
      !reachable.has("usage")?this.#retentionControls():nothing,
      !reachable.has("members")?this.#securityControls():nothing,
      !reachable.has("activity")?this.#recoveryControls():nothing,
      !reachable.has("members")?this.#provisioningControls():nothing,
      !reachable.has("members")?this.#ownershipAndDeletionControls():nothing,
      !reachable.has("members")&&!reachable.has("usage")?this.#pilotControls():nothing,
    ].filter((content)=>content!==nothing);
    return html`<div class="workspace-settings-grid">
      ${this.#reviewQueue()}
      <section class="workspace-settings-card" data-workspace-overview aria-labelledby="workspace-overview-heading">
        <h2 id="workspace-overview-heading">${this.i18n.t("workspace.admin.section.overview","Overview")}</h2>
        <dl class="workspace-settings-facts"><dt>${this.i18n.t("workspace.admin.role","Role")}</dt><dd>${this.i18n.t(`workspace.admin.role.${detail.organization.role}`,detail.organization.role)}</dd></dl>
        <ul class="workspace-settings-list">${destinations.map((item)=>html`<li data-workspace-overview-section=${item.value}><div><b>${item.label}</b><span>${descriptions[item.value]}</span></div>
          <a class="button secondary compact" href=${item.href} aria-label=${[this.i18n.t("workspace.admin.open","Open workspace settings"),"\u2068"+detail.organization.name+"\u2069",item.label].join(" · ")} @click=${(event:MouseEvent)=>{
            if(!owner.authorized()||this.#detail?.organization.organizationId!==organizationId||!this.#sectionDestinations(organizationId).some((current)=>current.value===item.value)){event.preventDefault();return;}
            this.#navigate(item.href,event);
          }}>${item.label}</a></li>`)}</ul>
      </section>
      ${preserved.length?html`<section data-workspace-overview-preserved aria-label=${this.i18n.t("navigation.actions","Actions")}><forma-ui-stack gap="large">${preserved}</forma-ui-stack></section>`:nothing}
    </div>`;
  }

  #invitations(){
    const invitations=this.#overview?.invitations??[];
    return html`<section class="workspace-settings-card" aria-labelledby="workspace-invitations-heading"><h2 id="workspace-invitations-heading">${this.i18n.t("workspace.admin.invitations","Your invitations")}</h2>${invitations.length?html`<ul class="workspace-settings-list">${invitations.map((invitation)=>html`<li><div><b dir="auto">${invitation.name}</b><span>${this.i18n.t(`workspace.admin.role.${invitation.role}`,invitation.role)}</span></div><button type="button" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.acceptNamed","Accept the invitation to {name}",{name:invitation.name})} ?disabled=${this.#busy} @click=${()=>this.#accept(invitation)}>${this.i18n.t("workspace.admin.accept","Accept")}</button></li>`)}</ul>`:html`<p>${this.i18n.t("workspace.admin.noInvitations","You have no pending workspace invitations.")}</p>`}</section>`;
  }

  #landing(){
    const overview=this.#overview,session=this.store.session.get();
    const owner=Boolean(session?.user.role==="creator"||session?.user.role==="admin");
    // This global raw form belongs to the account, not its selected project or permission epoch.
    const accountKey=JSON.stringify([session?.user.userId,session?.impersonation?.actor.userId??session?.user.userId,
      session?.impersonation?.impersonationId??null,session?.audience??"creative"]);
    return html`<div class="workspace-settings-grid">${this.#reviewQueue()}${this.#invitations()}<section class="workspace-settings-card" aria-labelledby="workspace-organizations-heading"><h2 id="workspace-organizations-heading">${this.i18n.t("workspace.admin.organizations","Your organizations")}</h2>${overview?.organizations.length?html`<ul class="workspace-settings-list">${overview.organizations.map((organization)=>{const manages=Boolean(organization.permissions?.length),href=`/settings/workspaces/${encodeURIComponent(organization.organizationId)}/overview`;return html`<li><div><b dir="auto">${organization.name}</b><span>${this.i18n.t(`workspace.admin.role.${organization.role}`,organization.role)}</span></div>${manages?html`<a class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.manageNamed","Manage {name}",{name:organization.name})} href=${href} @click=${(event:MouseEvent)=>this.#navigate(href,event)}>${this.i18n.t("workspace.admin.manage","Manage")}</a>`:nothing}</li>`;})}</ul>`:html`<p>${this.i18n.t("workspace.admin.noOrganizations","You do not belong to any organizations yet.")}</p>`}${owner?repeat([accountKey],key=>key,()=>html`<form class="workspace-settings-form" @submit=${this.#submitOrganization}><label>${this.i18n.t("workspace.admin.organizationName","New organization name")}<input name="name" required maxlength="100" autocomplete="organization"></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.create","Create workspace")}</button></form>`):nothing}</section><section class="workspace-settings-card" aria-labelledby="workspace-projects-heading"><h2 id="workspace-projects-heading">${this.i18n.t("workspace.admin.sharedProjects","Projects shared with you")}</h2>${overview?.projects.length?html`<ul class="workspace-settings-list">${overview.projects.map((project)=>html`<li><div><b dir="auto">${project.projectName||this.i18n.t("workspace.admin.unnamedProject","Unnamed project")}</b><span>${this.i18n.t(`workspace.admin.role.${project.role}`,project.role)}</span></div><button type="button" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.openNamed","Open {name}",{name:project.projectName||this.i18n.t("workspace.admin.unnamedProject","Unnamed project")})} ?disabled=${this.#busy} @click=${()=>this.#openProject(project)}>${this.i18n.t("action.open","Open")}</button></li>`)}</ul>`:html`<p>${this.i18n.t("workspace.admin.noSharedProjects","No projects have been shared with you.")}</p>`}</section></div>`;
  }

  #members(){
    const detail=this.#detail,members=detail?.members??[],canManage=detail?.permissions?.includes("workspace.member.manage")??false,isOwner=detail?.organization.role==="owner";
    const invitations=(detail?.invitations??[]).filter((invitation)=>invitation.status==="pending");
    const candidate=this.#freshInvitation,fresh=canManage&&candidate&&candidate.organizationId===detail?.organization.organizationId&&candidate.organizationId===this.#route().organizationId&&this.store.authorizationScopeActive(candidate.authorization)?candidate:null;
    return html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.members","Members")}</h2>
      ${canManage?html`<form class="workspace-settings-form" @submit=${this.#submitInvite}><label>${this.i18n.t("workspace.admin.email","Email address")}<input name="email" type="email" required autocomplete="email"></label><label>${this.i18n.t("workspace.admin.role","Role")}<select name="role"><option value="member">${this.i18n.t("workspace.admin.role.member","Member")}</option>${detail?.organization.role==="owner"?html`<option value="administrator">${this.i18n.t("workspace.admin.role.administrator","Administrator")}</option>`:nothing}</select></label><button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.invite","Create invitation")}</button></form>`:nothing}
      ${fresh?html`<div class="workspace-settings-invitation-link"><label>${this.i18n.t("workspace.admin.invitationLink","Private invitation link")}<input readonly dir="ltr" .value=${fresh.url}></label><forma-ui-copy-button .label=${this.i18n.t("workspace.admin.copyInvitation","Copy invitation link")} .value=${fresh.url}></forma-ui-copy-button><p>${this.i18n.t("workspace.admin.expiresAt","Expires")}: ${this.i18n.date(new Date(fresh.expiresAt),{dateStyle:"medium",timeStyle:"short"})}</p></div>`:nothing}
      <div class="workspace-settings-table"><table><caption>${this.i18n.t("workspace.admin.memberCaption","Organization members and invitations")}</caption><thead><tr><th scope="col">${this.i18n.t("workspace.admin.member","Member")}</th><th scope="col">${this.i18n.t("workspace.admin.role","Role")}</th><th scope="col">${this.i18n.t("workspace.admin.status","Status")}</th><th scope="col">${this.i18n.t("navigation.actions","Actions")}</th></tr></thead><tbody>${members.map((member)=>html`<tr><th scope="row"><span dir="auto">${member.display_name}</span>${member.email?html`<small><bdi dir="ltr">${member.email}</bdi></small>`:nothing}</th><td>${member.status==="active"&&isOwner&&member.role!=="owner"?html`<select aria-label=${this.i18n.t("workspace.admin.roleNamed","Role for {name}",{name:`\u2068${member.display_name}\u2069`})} .value=${member.role} ?disabled=${this.#busy} @change=${(event:Event)=>this.#updateMemberRole(member,(event.currentTarget as HTMLSelectElement).value)}><option value="member" ?selected=${member.role==="member"}>${this.i18n.t("workspace.admin.role.member","Member")}</option><option value="administrator" ?selected=${member.role==="administrator"}>${this.i18n.t("workspace.admin.role.administrator","Administrator")}</option></select>`:this.i18n.t(`workspace.admin.role.${member.role}`,member.role)}</td><td>${this.i18n.t(`workspace.admin.status.${member.status}`,member.status)}</td><td>${member.status==="active"&&canManage&&member.role!=="owner"&&(isOwner||member.role!=="administrator")?html`<button type="button" class="button ghost compact" aria-label=${this.i18n.t("workspace.admin.revokeNamed","Revoke access for {name}",{name:`\u2068${member.display_name}\u2069`})} ?disabled=${this.#busy} @click=${(event:Event)=>void this.#revokeMember(event,member)}>${this.i18n.t("workspace.admin.revoke","Revoke")}</button>`:nothing}</td></tr>`)}</tbody></table></div>
      <h3>${this.i18n.t("workspace.admin.pendingInvitations","Pending invitations")}</h3>
      ${invitations.length?html`<div class="workspace-settings-table"><table><caption>${this.i18n.t("workspace.admin.invitationCaption","Private, expiring invitations")}</caption><thead><tr><th scope="col">${this.i18n.t("workspace.admin.email","Email address")}</th><th scope="col">${this.i18n.t("workspace.admin.role","Role")}</th><th scope="col">${this.i18n.t("workspace.admin.expiresAt","Expires")}</th><th scope="col">${this.i18n.t("navigation.actions","Actions")}</th></tr></thead><tbody>${invitations.map((invitation)=>html`<tr><th scope="row"><bdi dir="ltr">${invitation.email_normalized}</bdi></th><td>${this.i18n.t(`workspace.admin.role.${invitation.role}`,invitation.role)}</td><td>${this.i18n.date(new Date(invitation.expires_at),{dateStyle:"medium",timeStyle:"short"})}</td><td>${canManage&&(isOwner||invitation.role!=="administrator")?html`<button type="button" class="button ghost compact" aria-label=${this.i18n.t("workspace.admin.revokeInvitationNamed","Revoke invitation for {email}",{email:`\u2068${invitation.email_normalized}\u2069`})} ?disabled=${this.#busy} @click=${(event:Event)=>void this.#revokeInvitation(event,invitation)}>${this.i18n.t("workspace.admin.revokeInvitation","Revoke invitation")}</button>`:nothing}</td></tr>`)}</tbody></table></div>`:html`<p>${this.i18n.t("workspace.admin.noPendingInvitations","No invitations are awaiting acceptance.")}</p>`}
    </section>`;
  }

  #projects(){
    const detail=this.#detail,projects=detail?.projects??[],members=detail?.members??[],canManage=detail?.permissions?.includes("workspace.project.manage")??false;
    const personal=this.store.projection.get().projects;
    const grantMembers=members.filter(member=>member.status==="active"&&member.role!=="owner"),grantNames=this.#memberNames(grantMembers);
    return html`<section class="workspace-settings-card">
      <h2>${this.i18n.t("workspace.admin.section.projects","Projects")}</h2>
      ${canManage?html`<form class="workspace-settings-form" @submit=${this.#registerProject}>
        <label>${this.i18n.t("workspace.admin.ownedProject","Your project")}<select name="projectId" required><option value="">${this.i18n.t("field.choose","Choose an option")}</option>${personal.map((project)=>html`<option value=${project.id}>${project.name}</option>`)}</select></label>
        <button type="submit" class="button secondary compact" ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.shareProject","Share project")}</button>
      </form>`:nothing}
      ${projects.length?html`<ul class="workspace-settings-project-list">${projects.map((project)=>{
        const projectMembers=this.#projectMembers.get(project.project_access_id);
        const memberReadError=this.#projectMemberReads.get(project.project_access_id)?.error;
        const projectName=project.project_name||this.i18n.t("workspace.admin.unnamedProject","Unnamed project");
        const memberNames=this.#projectMemberNames(project.project_access_id);
        const canViewAccess=canManage||Boolean(this.#overview?.projects.some((item)=>item.organizationId===detail?.organization.organizationId&&item.projectAccessId===project.project_access_id));
        return html`<li>
          <header><b dir="auto">${projectName}</b>${canViewAccess?html`<button type="button" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.viewAccessNamed","View access to {name}",{name:projectName})} @click=${()=>void this.#loadProjectMembers(project.project_access_id)}>${this.i18n.t("workspace.admin.viewAccess","View access")}</button>`:nothing}</header>
          ${memberReadError?html`<p role="alert" class="workspace-settings-error">${"key" in memberReadError?this.i18n.t(memberReadError.key,"This workspace is unavailable."):memberReadError.message}</p>`:nothing}
          ${canManage?html`<form class="workspace-settings-form" @submit=${(event:SubmitEvent)=>this.#grantProject(event,project)}>
            <label>${this.i18n.t("workspace.admin.member","Member")}<select name="userId" required><option value="">${this.i18n.t("field.choose","Choose an option")}</option>${repeat(grantMembers,(member)=>member.membership_id,(member)=>html`<option value=${member.user_id}>${grantNames.get(member.membership_id)!.label}</option>`)}</select></label>
            <label>${this.i18n.t("workspace.admin.role","Role")}<select name="role"><option value="viewer">${this.i18n.t("workspace.admin.role.viewer","Viewer")}</option><option value="editor">${this.i18n.t("workspace.admin.role.editor","Editor")}</option></select></label>
            <button type="submit" class="button secondary compact" aria-label=${this.i18n.t("workspace.admin.grantNamed","Grant access to {name}",{name:projectName})} ?disabled=${this.#busy}>${this.i18n.t("workspace.admin.grant","Grant access")}</button>
          </form><p class="workspace-project-role-notice">${this.i18n.t("workspace.admin.editorBudgetNotice","Editors can create outputs using their personal and organization budgets; viewers cannot.")}</p>`:nothing}
          ${projectMembers?html`<ul class="workspace-settings-list">${projectMembers.filter((member)=>member.status==="active").map((member)=>{const memberName=memberNames.get(member.membership_id)?.label??member.display_name;return html`<li><div>
            <b dir="auto">${memberName}</b>
            ${canManage&&member.role!=="owner"?html`
              <select aria-label=${this.i18n.t("workspace.admin.projectRoleNamed","Project role for {name}",{name:memberName})} .value=${member.role} ?disabled=${this.#busy} @change=${(event:Event)=>this.#updateProjectRole(project.project_access_id,member,(event.currentTarget as HTMLSelectElement).value)}><option value="viewer" ?selected=${member.role==="viewer"}>${this.i18n.t("workspace.admin.role.viewer","Viewer")}</option><option value="editor" ?selected=${member.role==="editor"}>${this.i18n.t("workspace.admin.role.editor","Editor")}</option></select>
              <forma-ui-switch class="workspace-project-canvas-permission" data-project-access-id=${project.project_access_id} data-membership-id=${member.membership_id} data-permission="canvasAccess" .label=${this.i18n.t("workspace.admin.canvasAccessNamed","Allow Canvas access for {name}",{name:`\u2068${memberName}\u2069`})} .help=${this.i18n.t("workspace.admin.canvasAccessHelp","Their project role determines whether they can edit the board.")} .checked=${Boolean(member.canvas_access)} .disabled=${this.#busy} @forma-change=${(event:CustomEvent<{checked:boolean}>)=>{const control=event.currentTarget as HTMLElement&{checked:boolean};const enabled=event.detail.checked;control.checked=Boolean(member.canvas_access);void this.#updateProjectCanvas(project.project_access_id,member,enabled,control);}}></forma-ui-switch>
              <forma-ui-switch class="workspace-project-review-permission" data-project-access-id=${project.project_access_id} data-membership-id=${member.membership_id} data-permission="reviewAccess" .label=${this.i18n.t("workspace.admin.reviewAccessNamed","Allow independent approval by {name}",{name:`\u2068${memberName}\u2069`})} .help=${this.i18n.t("workspace.admin.reviewAccessHelp","They can approve current work by someone else; viewers never receive editing access.")} .checked=${Boolean(member.review_access)} .disabled=${this.#busy} @forma-change=${(event:CustomEvent<{checked:boolean}>)=>{const control=event.currentTarget as HTMLElement&{checked:boolean};const enabled=event.detail.checked;control.checked=Boolean(member.review_access);void this.#updateProjectReviewer(project.project_access_id,member,enabled,control);}}></forma-ui-switch>
            `:html`<span>${this.i18n.t(`workspace.admin.role.${member.role}`,member.role)}</span>`}
          </div>${canManage&&member.role!=="owner"?html`<button type="button" class="button ghost compact" aria-label=${this.i18n.t("workspace.admin.revokeNamed","Revoke access for {name}",{name:memberName})} ?disabled=${this.#busy} @click=${(event:Event)=>void this.#revokeProject(event,project.project_access_id,member)}>${this.i18n.t("workspace.admin.revoke","Revoke")}</button>`:nothing}</li>`;})}</ul>`:nothing}
        </li>`;
      })}</ul>`:html`<p>${this.i18n.t("workspace.admin.noRegisteredProjects","No projects have been registered in this organization.")}</p>`}
    </section>`;
  }

  #usage(){
    const detail=this.#detail,policy=detail?.policy,cost=detail?.cost,tokens=detail?.tokens;
    const used=Number(cost?.used_microusd??0),reserved=Number(cost?.reserved_microusd??0),limit=Number(policy?.microusd_limit??0);
    const format=(value:number)=>new Intl.NumberFormat(this.i18n.locale,{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value/1_000_000);
    const tokenUsed=Number(tokens?.used_tokens??0),tokenReserved=Number(tokens?.reserved_tokens??0),tokenLimit=Number(policy?.token_limit??0);
    const outcomes=detail?.outcomes,draft=this.#policyDraft("budget",policy);
    return html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.usage","Usage")}</h2><p>${this.i18n.t("workspace.admin.period","Accounting period")}: ${detail?.period??""}</p><dl class="workspace-settings-facts"><dt>${this.i18n.t("workspace.admin.totalLimit","Monthly organization limit")}</dt><dd>${format(limit)}</dd><dt>${this.i18n.t("workspace.admin.settled","Settled spending")}</dt><dd>${format(used)}</dd><dt>${this.i18n.t("workspace.admin.reserved","Active reservations")}</dt><dd>${format(reserved)}</dd><dt>${this.i18n.t("workspace.admin.remaining","Available organization budget")}</dt><dd>${format(Math.max(0,limit-used-reserved))}</dd><dt>${this.i18n.t("workspace.admin.tokens","Organization tokens")}</dt><dd>${this.i18n.number(tokenUsed+tokenReserved)} / ${this.i18n.number(tokenLimit)}</dd></dl>${outcomes?html`<h3>${this.i18n.t("workspace.outcomes.heading")}</h3><dl class="workspace-settings-facts"><dt>${this.i18n.t("workspace.outcomes.activated")}</dt><dd>${this.i18n.number(outcomes.activatedCreators)}</dd><dt>${this.i18n.t("workspace.outcomes.approved")}</dt><dd>${this.i18n.number(outcomes.approvedDeliverables)}</dd><dt>${this.i18n.t("workspace.outcomes.released")}</dt><dd>${this.i18n.number(outcomes.releasedApprovedDeliverables)}</dd><dt>${this.i18n.t("workspace.outcomes.pending")}</dt><dd>${this.i18n.number(outcomes.pendingReviews)}</dd><dt>${this.i18n.t("workspace.outcomes.reused")}</dt><dd>${this.i18n.number(outcomes.adoptedContextPackages)}</dd><dt>${this.i18n.t("workspace.outcomes.cost")}</dt><dd>${outcomes.settledCostPerApprovedDeliverableMicrousd===null?"—":format(outcomes.settledCostPerApprovedDeliverableMicrousd)}</dd><dt>${this.i18n.t("workspace.outcomes.review")}</dt><dd>${outcomes.averageReviewMinutes===null?"—":`${this.i18n.number(outcomes.averageReviewMinutes)} min`}</dd></dl>`:nothing}<progress max=${Math.max(1,limit)} value=${Math.min(limit,used+reserved)} aria-label=${this.i18n.t("workspace.admin.totalLimit","Monthly organization limit")}></progress><progress max=${Math.max(1,tokenLimit)} value=${Math.min(tokenLimit,tokenUsed+tokenReserved)} aria-label=${this.i18n.t("workspace.admin.tokenUsage","Monthly token usage")}></progress>${policy&&detail?.permissions?.includes("workspace.budget.manage")?html`<form class="workspace-settings-form" data-workspace-policy=${draft.key} data-workspace-policy-owner=${draft.owner} data-workspace-policy-snapshot=${draft.dirty?noChange:draft.saved} data-workspace-policy-dirty=${live(draft.dirty?"true":"false")} @submit=${this.#savePolicy}><label>${this.i18n.t("workspace.admin.usdLimit","Monthly limit (USD)")}<input type="number" name="usdLimit" min="0.01" step="0.01" .value=${draft.value(String(Number(policy.microusd_limit)/1_000_000))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label><label>${this.i18n.t("workspace.admin.tokenLimit","Monthly token limit")}<input type="number" name="tokenLimit" min="1" step="1" .value=${draft.value(String(policy.token_limit))} @input=${this.#policyEdited} @compositionstart=${this.#policyEdited} required></label>${this.#policyActions(draft,this.i18n.t("workspace.admin.savePolicy","Save limits"))}</form>`:nothing}</section>`;
  }

  #activity(){
    const audit=this.#detail?.audit??[];
    return html`<section class="workspace-settings-card"><h2>${this.i18n.t("workspace.admin.section.activity","Activity")}</h2>${audit.length?html`<ol class="workspace-settings-audit">${audit.map((event)=>html`<li><b>${this.i18n.t(`workspace.admin.audit.${String(event.action)}`,String(event.action).replace(/([a-z])([A-Z])/g,"$1 $2"))}</b>${event.actor_display_name?html`<span dir="auto">${this.i18n.t("workspace.admin.activityBy","By {name}",{name:String(event.actor_display_name)})}</span>`:nothing}<span>${this.i18n.date(new Date(String(event.occurred_at)),{dateStyle:"medium",timeStyle:"short"})}</span></li>`)}</ol>`:html`<p>${this.i18n.t("workspace.admin.noActivity","No organization activity has been recorded.")}</p>`}</section>`;
  }

  override render(){
    this.#routeChanged();
    if(this.#cacheOwner&&!this.#cacheOwner.authorized())this.#authorizationChanged();
    const {organizationId,section,invitations}=this.#route();
    const name=this.#detail?.organization.name??this.i18n.t("workspace.admin.heading","Workspaces & collaboration");
    if(organizationId&&this.#deletionJob&&["pending","partial","processing"].includes(this.#deletionJob.status)){
      return html`<section class="workspace-settings-page page-pad" aria-labelledby="workspace-settings-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("workspace.admin.eyebrow","Creator settings")}</span><h1 id="workspace-settings-heading" dir="auto">${name}</h1></div></header>${this.#error?html`<p role="alert" class="workspace-settings-error">${this.#errorText()}</p>`:nothing}<p class="workspace-settings-notice" role="status" aria-live="polite">${this.#noticeText()}</p>${this.#deletionRecoveryControls()}</section>`;
    }
    return html`<section class="workspace-settings-page page-pad" aria-labelledby="workspace-settings-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("workspace.admin.eyebrow","Creator settings")}</span><h1 id="workspace-settings-heading" dir="auto">${name}</h1><p>${this.i18n.t("workspace.admin.description","Manage the organizations, invitations, shared projects, and spending you are authorized to see.")}</p></div>${organizationId&&this.#overview?.organizations.length?html`<label class="workspace-settings-organization-select">${this.i18n.t("workspace.admin.organization","Organization")}<select .value=${organizationId} @change=${(event:Event)=>{const control=event.currentTarget as HTMLSelectElement,target=control.value;control.value=organizationId;this.#navigate(`/settings/workspaces/${encodeURIComponent(target)}/overview`);}}>${this.#overview.organizations.filter((organization)=>Boolean(organization.permissions?.length)).map((organization)=>html`<option value=${organization.organizationId}>${organization.name}</option>`)}</select></label>`:nothing}</header>${this.store.session.get()?.projectContext?html`<aside class="workspace-settings-shared-notice"><span>${this.i18n.t("workspace.admin.sharedProjectMode","You are working inside a shared project.")}</span><button type="button" class="button secondary compact" @click=${()=>void navigateInApp(this,navigation=>this.store.leaveProjectContext(navigation))}>${this.i18n.t("workspace.admin.leaveSharedProject","Return to my projects")}</button></aside>`:nothing}${this.#error?html`<p role="alert" class="workspace-settings-error">${this.#errorText()}</p>`:nothing}<p class="workspace-settings-notice" role="status" aria-live="polite">${this.#noticeText()}</p>${this.#readUnavailable?html`<button type="button" class="button secondary compact" ?disabled=${this.#loading} @click=${()=>void this.#load()}>${this.i18n.t("action.retry","Try again")}</button>`:nothing}${organizationId&&this.#detail?html`<div class="workspace-settings-content" ?hidden=${this.#readUnavailable} ?inert=${this.#readUnavailable}>${this.#sectionLinks(organizationId,section)}${this.#refreshSettingsControl()}${section==="members"?html`${this.#members()}${this.#pilotControls()}${this.#securityControls()}${this.#provisioningControls()}${this.#ownershipAndDeletionControls()}`:section==="projects"?html`${this.#reviewQueue()}${this.#contextPackages()}${this.#automationControls()}${this.#projects()}`:section==="usage"?html`${this.#usage()}${this.#retentionControls()}${this.#pilotControls()}`:section==="activity"?html`${this.#assuranceControls()}${this.#recoveryControls()}${this.#activity()}`:this.#organizationOverview(organizationId)}</div>`:organizationId?this.#loading?html`<p role="status">${this.i18n.t("status.loading","Loading")}</p>`:html`<button type="button" class="button secondary compact" @click=${()=>void this.#load()}>${this.i18n.t("action.retry","Try again")}</button>`:invitations?this.#invitations():this.#landing()}</section>`;
  }
}

if(!customElements.get("forma-workspace-settings"))customElements.define("forma-workspace-settings",FormaWorkspaceSettings);

declare global{interface HTMLElementTagNameMap{"forma-workspace-settings":FormaWorkspaceSettings;}}
