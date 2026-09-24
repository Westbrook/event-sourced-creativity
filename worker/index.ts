import { handleSourceAdvisoryRead, SOURCE_ADVISORY_PATH } from './source-advisory-read.ts';
import { handleCurrentSourceRead, CURRENT_SOURCE_PATH } from './generation-current-source-read.ts';
import {handleOrdinaryImageQueue} from './ordinary-image-queue.ts';
import { handleGenerationEvidenceRead, GENERATION_EVIDENCE_PATH, GENERATION_EVIDENCE_PAGE } from './generation-evidence-read.ts';
import {handleMemorySchemaRepair,MEMORY_SCHEMA_REPAIR_PATH,EVENT_SAVE_REPAIR_PATH} from './memory-schema-repair-api.ts';
import {reconcileMemoryAuthoredImages} from './memory-authored-image.ts';
import { reconcileMemoryImageUsage } from './memory-image-preview.ts';
import { runScopeProfileScheduled,sweepScopeProfiles } from './memory-scope-profile-store.ts';
import { handleMemoryScopeProfile } from './memory-scope-profile.ts';
import { handleMemoryProfileCatalog } from './memory-profile-catalog.ts';
import { handleMemoryResourceAssistant,reconcileResourceAssistantUsage } from './memory-resource-assistant.ts';
import { handleMemoryResourceContext } from './memory-resource-context.ts';
import { handleMemoryResourceOpening } from './memory-resource-openings.ts';
import { sweepSemanticAssistantMemory } from './memory-assistant-consumer.ts';
import { handleMemoryAssistantContext, sweepAssistantMemoryContexts } from './memory-assistant-context-api.ts';
import { handleMemoryRecallBoundary } from './memory-recall-boundary-api.ts';
import { handleProjectContainment } from './project-containment-api';
import { runNativeDerivationScheduled } from "./memory-derivation-worker.ts";
import { sweepNativeDerivationUserControls } from "./memory-derivation-user-controls.ts";
import { handleStillPanel, sweepStillPanels } from './still-panel-api.ts';
import { handleStillOnboarding } from './still-onboarding.ts';
import { handleStillExperiment } from './still-experiment.ts';
import { handleHoldDispositions } from "./budget-hold-api.ts";
import { handleGenerationAccounting } from "./generation-accounting-api.ts";
import { handleVideoReconciliation } from "./managed-video-reconciliation-api.ts";
import { handleEvents, type WorkerEnv } from "./events-api";
import { handleStillDecision } from "./still-api";
import { isStillNamespace, parseStillRoute } from "../src/still/routes.ts";
import { getMedia, uploadMedia } from "./media-api";
import { handleAdminUsers, handleImpersonation, handleSession, hasCapability, requireCapability, requireConsent, requireUser } from "./pilot-policy";
import { handleShares, handleSharedMedia, handleSharedView } from "./shares-api";
import { applicationDefinition, authorizedApplicationHome, resolveServerRoute, routeRequiredCapabilities, type ApplicationId } from "../src/platform/applications";
import { handleReplayApproval, handleReplayEstimate, handleReplaySessions } from "./replay-sessions-api";
import { handleDocumentJobs, runDocumentJob } from "./document-jobs-api";
import { withExperienceOutputDispatch } from "./experience-output-dispatch.ts";
import { handleExperienceVideoReference } from "./experience-video-reference.ts";
import { handleExperienceIntake } from "./experience-intake-api";
import { createSponsorImageEntryRoute } from "./experience-sponsor-image-entry.ts";
import { handleExperienceOutput } from "./experience-output-api";
import { handleDocumentDuplication } from "./document-duplication-api";
import { handleCanvasArrangements } from "./canvas-arrangements";
import { handleAdaptiveProposalApplication } from "./adaptive-proposal-application-api";
import { handleOutputRequirements } from "./output-requirements-api";
import { outputDocumentExecutionBridge } from "./output-document-execution";
import { observeScheduledRetention, schedulePrivateContentRetention, streamHead, type WorkerExecutionContext } from "./runtime";
import { handleAnalytics } from "./analytics-api";
import { handleGenerationReadiness } from "./generation-readiness";
import { handleCanvasGovernance } from "./canvas-governance-api";
import { handleImageAdapters, handleQualificationPreview } from "./image-adapters-api";
import { streamNavigationSession } from "./session-bootstrap";
import { handlePortfolio } from "./portfolio-api";
import { readCanvasGovernance } from "./canvas-governance-policy";
import { handleCapabilityGrants } from "./access-api";
import { handleWorkspaces } from "./workspaces-api";
import { hasProjectContextCookie, readProjectRequestContext } from "./project-access";
import { handlePerformanceSample } from "./performance-api";
import { handleArtifactEdit } from "./artifact-api";
import { handleGeneratedImageEdit } from "./generated-image-api";
import { handleAssistant, handleAssistantBillingReconciliation, handleAssistantProposal, handleAssistantTask, handleAssistantSpecialist, handleAssistantFieldSuggestion } from "./assistant-api";
import { handlePlatformAssistant } from "./platform-assistant-api";
import { handleMemoryResourceSettings,handleMemoryResourceEnrollments } from "./memory-resource-settings.ts";
import { handleMemoryResourceHistory,runResourceMemoryScheduled,sweepResourceMemory } from './memory-resource-history.ts';
import { handleMemoryResourceScope } from "./memory-resource-authority.ts";
import { handleLiveMemory } from "./memory-live-api.ts";
import { handleMemoryDerivationSettings, handleMemoryDerivationResult, handleMemoryDerivationUserControls, handleMemoryDerivationResults } from "./memory-derivation-api.ts";
import { maintainNativeDerivationRecovery } from "./memory-derivation-recovery.ts";
import { sweepNativeDerivationJobs } from "./memory-derivation-jobs.ts";
import { sweepNativeDerivationResults } from "./memory-derivation-results.ts";
import { sweepExpiredDerivationGrants } from "./memory-derivation-store.ts";
import { runLiveMemoryScheduled } from "./memory-live-jobs.ts";
import { sweepExpiredMemoryCheckpoints } from "./memory-live-checkpoints.ts";
import { handleNativeMemoryBenchmark, purgeExpiredNativeMemoryBenchmark } from "./memory-benchmark/native.ts";
import { handleMemoryDocumentProfile } from "./memory-document-profile-api.ts";
import { sweepExpiredDocumentProfileSuppressions } from "./memory-document-profile-store.ts";
import { handleEventPrivacy } from "./privacy-api";
import { handleProjectNotifications } from "./project-notifications-api";
import { processReviewReminders } from "./review-automation-api";
import { handleProvisioning } from "./provisioning-api";
import { negotiateMarketingLocale, renderMarketingDocument } from "./marketing-localization";
import { parseMarketingRoute } from "../src/marketing/profiles";
import { handleContextIntelligence } from "./context-intelligence-api";
import { handleContextApplication } from "./context-application-api";
import { handleWorkspaceLocalProposal } from "./workspace-local-proposal-api";
import { handleOutputSchemaPreflight, OUTPUT_SCHEMA_PREFLIGHT_PATH } from "./output-schema-preflight";
import { handleRetainedStoryRead, handleNativeRetainedOutputRead } from "./retained-story-api";
import { handleSelectedOutputShareApi, isSelectedOutputShareApiPath } from "./selected-output-share-api.ts";

// A handled sponsor entry response already belongs to one bounded operation.
// Do not attach an unrelated background private-content sweep to that request.
import { createSponsorImageEntryModeRoute, SPONSOR_IMAGE_ENTRY_MODE_PATH } from "./experience-sponsor-image-entry-mode.ts";

const sponsoredImageResponses = new WeakSet<Response>();

async function authorizeApplication(request: Request, env: WorkerEnv, application: ApplicationId, path: string) {
    if(application==="creative"){
      const workspace=path.match(/^\/settings\/workspaces(?:\/([^/]+)(?:\/([^/]+))?)?$/);
      if(!workspace)return null;
      if(!workspace[1]||workspace[1]==="invitations"){
        const principal=await requireUser(request,env,"viewer",{account:"principal"});
        return principal.response??null;
      }
      const organizationId=decodeURIComponent(workspace[1]);
      const capabilities=workspace[2]==="members"?["workspace.member.read","workspace.member.manage"] as const:
        workspace[2]==="projects"?["workspace.project.read","workspace.project.manage"] as const:
        workspace[2]==="usage"?["workspace.usage.read","workspace.budget.manage"] as const:
        workspace[2]==="activity"?["workspace.audit.read","workspace.policy.manage"] as const:
        ["workspace.member.read","workspace.project.read","workspace.usage.read","workspace.audit.read"] as const;
      const authorized=await requireCapability(request,env,capabilities,{organizationId});
      return authorized.response??null;
    }
    if(application==="canvas"){
      const authorization=await requireUser(request,env);
      if(authorization.response||!authorization.user)return authorization.response??Response.json({error:"authentication_required"},{status:401});
      const selected=await readProjectRequestContext(request,env,authorization.user);
      if(selected.response)return selected.response;
      const governance=await readCanvasGovernance(env,authorization.user.role);
      if(selected.context&&!hasCapability(authorization.user,"project.canvas.use",{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId}))
        return Response.json({error:"project_canvas_access_required"},{status:403,headers:{"cache-control":"private, no-store"}});
      return governance.access?null:Response.json({error:"canvas_access_required"},{status:403});
    }
    const authorization=await requireCapability(request,env,routeRequiredCapabilities(path));
    if(authorization.response||!authorization.user)return authorization.response??Response.json({error:"authentication_required"},{status:401});
    const normalized=new URL(path,"https://forma.local").pathname.replace(/\/+$/,"")||"/";
    if((normalized==="/product/evaluation/actual"||normalized==="/admin/events/replay")&&authorization.user.role!=="admin")return Response.json({error:"administrator_required"},{status:403});
    const pathname=normalized;
    if(pathname===applicationDefinition(application).home){
      const destination=authorizedApplicationHome(application,{role:authorization.user.role,capabilities:authorization.user.access.capabilities});
      if(destination!==pathname)return new Response(null,{status:302,headers:{location:new URL(destination,request.url).toString(),"cache-control":"private, no-store",vary:"Cookie, oai-authenticated-user-id, oai-authenticated-user-email, cf-access-authenticated-user-email"}});
    }
    return null;
}

async function routeRequest(request: Request, env: WorkerEnv, context: WorkerExecutionContext): Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/internal/ordinary-images/"))return handleOrdinaryImageQueue(request,env);
    if(url.pathname===SOURCE_ADVISORY_PATH)return handleSourceAdvisoryRead(request,env);
    if(url.pathname===CURRENT_SOURCE_PATH)return handleCurrentSourceRead(request,env);
    if(url.pathname===GENERATION_EVIDENCE_PATH||url.pathname===GENERATION_EVIDENCE_PAGE)return handleGenerationEvidenceRead(request,env);
    if(url.pathname===MEMORY_SCHEMA_REPAIR_PATH||url.pathname===EVENT_SAVE_REPAIR_PATH)return handleMemorySchemaRepair(request,env);
    if(url.pathname===OUTPUT_SCHEMA_PREFLIGHT_PATH)return handleOutputSchemaPreflight(request,env);
    if(url.pathname.startsWith("/api/")&&!['GET','HEAD','OPTIONS'].includes(request.method)){
      const origin=request.headers.get("origin");
      if(origin&&origin!==url.origin)return Response.json({error:"same_origin_required"},{status:403,headers:{"cache-control":"private, no-store"}});
    }
    if(isSelectedOutputShareApiPath(url.pathname))return handleSelectedOutputShareApi(request,env);
    if(url.pathname===SPONSOR_IMAGE_ENTRY_MODE_PATH){
      const mode=await createSponsorImageEntryModeRoute(env.FORMA_SPONSOR_IMAGE_ENTRY)(request,env);
      if(mode){sponsoredImageResponses.add(mode);return mode;}
    }
    if(url.pathname==="/api/experiences/sponsor/image"||url.pathname.startsWith("/api/experiences/sponsor/image/")){
      const sponsored=await createSponsorImageEntryRoute(env.FORMA_SPONSOR_IMAGE_ENTRY)(request,env);
      if(sponsored){sponsoredImageResponses.add(sponsored);return sponsored;}
    }
    if(url.pathname==="/api/retained-story"||url.pathname.startsWith("/api/retained-story/"))return handleRetainedStoryRead(request,env);
    if(url.pathname==="/api/retained-output"||url.pathname.startsWith("/api/retained-output/"))return handleNativeRetainedOutputRead(request,env);
    if(/^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output(?:\/(?:prepare|authorize|run|recover-result))?$/u.test(url.pathname))return handleExperienceOutput(request,env,context,withExperienceOutputDispatch(outputDocumentExecutionBridge,runDocumentJob));
    if(url.pathname==="/api/experiences/video/reference/inspect")return handleExperienceVideoReference(request,env);
    if(url.pathname==="/api/experiences"||url.pathname.startsWith("/api/experiences/"))return handleExperienceIntake(request,env);
    const marketingRoute=parseMarketingRoute(url.pathname);
    if(marketingRoute){
      if(request.method!=="GET"&&request.method!=="HEAD")return new Response(null,{status:405,headers:{allow:"GET, HEAD"}});
      // Cloudflare's asset binding resolves extensionless HTML directly. Asking
      // for `/marketing.html` instead would redirect away from the public route.
      const asset=await env.ASSETS.fetch(new Request(new URL("/marketing",request.url),request));
      const headers=new Headers(asset.headers);
      const locale=marketingRoute.locale??negotiateMarketingLocale(request.headers.get("accept-language"));
      headers.set("cache-control","public, max-age=0, must-revalidate");
      headers.set("x-forma-route-family","marketing");
      headers.set("content-language",locale);
      if(!marketingRoute.locale)headers.append("vary","Accept-Language");
      if(!asset.ok)return new Response(request.method==="HEAD"?null:asset.body,{status:asset.status,statusText:asset.statusText,headers});
      headers.delete("content-length");
      headers.delete("etag");
      if(request.method==="HEAD")return new Response(null,{status:asset.status,statusText:asset.statusText,headers});
      return new Response(renderMarketingDocument(await asset.text(),locale,marketingRoute.profile),{status:asset.status,statusText:asset.statusText,headers});
    }
    if(url.pathname.startsWith("/welcome/"))return new Response(null,{status:404,headers:{"cache-control":"public, max-age=0, must-revalidate"}});
    // Raw presence remains conservative for response caching, never for account selection.
    const projectCookieHeaderPresent=/(?:^|;\s*)forma_project_context=/.test(request.headers.get("cookie")??"");
    const scopedCookie=hasProjectContextCookie(request);
    const accountOnly=url.pathname.startsWith("/api/generation-readiness/")||url.pathname==="/api/analytics"||url.pathname.startsWith("/api/portfolio/")||url.pathname.startsWith("/api/replay-sessions")||url.pathname.startsWith("/api/replay-approval");
    if(scopedCookie&&accountOnly){
      const principal=await requireUser(request,env,"viewer",{account:"principal"});
      if(principal.response||!principal.user)return principal.response??Response.json({error:"authentication_required"},{status:401});
      const selected=await readProjectRequestContext(request,env,principal.user);
      if(selected.response)return selected.response;
      if(selected.context)return Response.json({error:"project_operation_unavailable"},{status:403,headers:{"cache-control":"private, no-store"}});
    }
    if(url.pathname==="/api/portfolio/product/adapter-preview")return handleQualificationPreview(request,env);
    const portfolioMatch=url.pathname.match(/^\/api\/portfolio\/(product|engineering|operations)\/(insights|delivery|evaluation|health|events|sync|jobs|overview|providers)$/);
    if(portfolioMatch)return handlePortfolio(request,env,portfolioMatch[1],portfolioMatch[2]);
    if(url.pathname==="/api/platform/access")return handleCapabilityGrants(request,env);
    if(url.pathname.startsWith("/api/platform/access/")&&request.method==="DELETE")return handleCapabilityGrants(request,env,decodeURIComponent(url.pathname.slice("/api/platform/access/".length)));
    if(url.pathname.startsWith("/api/provisioning/"))return handleProvisioning(request,env,url.pathname.slice("/api/provisioning/".length).split("/").filter(Boolean).map((part)=>decodeURIComponent(part)));
    if(url.pathname==="/api/workspaces"||url.pathname.startsWith("/api/workspaces/")){
      const response=await handleWorkspaces(request,env,url.pathname.slice("/api/workspaces".length).split("/").filter(Boolean).map((part)=>decodeURIComponent(part)));
      const headers=new Headers(response.headers);headers.set("cache-control","private, no-store");headers.append("vary","Cookie, oai-authenticated-user-id, oai-authenticated-user-email, cf-access-authenticated-user-email");
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    if(url.pathname==="/api/still/panel"||url.pathname.startsWith("/api/still/panel/"))return handleStillPanel(request,env);
    if(url.pathname==="/api/still/onboarding")return handleStillOnboarding(request,env,context);
    if(url.pathname==="/api/still/experiment")return handleStillExperiment(request,env,context);
    if(url.pathname==="/api/still/decision")return handleStillDecision(request,env,context);
    if(url.pathname==="/api/session")return handleSession(request,env,context);
    if(url.pathname==="/api/platform/assistant")return handlePlatformAssistant(request,env);
    if(url.pathname==="/api/assistant/field-suggestion")return handleAssistantFieldSuggestion(request,env);
    if(url.pathname==="/api/assistant/specialist")return handleAssistantSpecialist(request,env,context);
    if(url.pathname==="/api/assistant")return handleAssistant(request,env,context);
    if(url.pathname==="/api/internal/memory-benchmark"||url.pathname==="/api/internal/memory-benchmark/approval"||url.pathname==="/api/internal/memory-benchmark/reconcile"||url.pathname==="/api/internal/memory-benchmark/release-undispatched")return handleNativeMemoryBenchmark(request,env);
    if(url.pathname==="/api/memory/scope-profile")return handleMemoryScopeProfile(request,env);
    if(url.pathname==="/api/memory/profile-catalog")return handleMemoryProfileCatalog(request,env);
    if(url.pathname==="/api/memory/resource-assistant")return handleMemoryResourceAssistant(request,env);
    if(url.pathname==="/api/memory/resource-assistant-context")return handleMemoryResourceContext(request,env);
    if(url.pathname==="/api/memory/resource-enrollments")return handleMemoryResourceEnrollments(request,env);
    if(url.pathname==="/api/memory/resource-opening")return handleMemoryResourceOpening(request,env);
    if(url.pathname==="/api/memory/resource-history")return handleMemoryResourceHistory(request,env);
    if(url.pathname==="/api/memory/resource-settings")return handleMemoryResourceSettings(request,env);
    if(url.pathname==="/api/memory/resource-scope")return handleMemoryResourceScope(request,env);
    if(url.pathname==="/api/memory/settings")return handleLiveMemory(request,env,"settings");
    if(url.pathname==="/api/memory/recall")return handleLiveMemory(request,env,"recall");
    if(url.pathname==="/api/memory/export")return handleLiveMemory(request,env,"export");
    if(url.pathname==="/api/memory/processing")return handleLiveMemory(request,env,"processing");
    if(url.pathname==="/api/memory/assistant-context")return handleMemoryAssistantContext(request,env);
    if(url.pathname==="/api/memory/recall-boundary"||url.pathname==="/api/memory/recall-scopes")return handleMemoryRecallBoundary(request,env);
    if(url.pathname==="/api/projects/containment")return handleProjectContainment(request,env);
    if(url.pathname==="/api/memory/derivation/settings")return handleMemoryDerivationSettings(request,env);
    if(url.pathname==="/api/memory/derivation/results")return handleMemoryDerivationResults(request,env);
    if(url.pathname==="/api/memory/derivation/result")return handleMemoryDerivationResult(request,env);
    if(url.pathname==="/api/memory/derivation/controls")return handleMemoryDerivationUserControls(request,env);
    if(url.pathname==="/api/memory/document-profile/settings")return handleMemoryDocumentProfile(request,env,"settings");
    if(url.pathname==="/api/memory/document-profile/inspect")return handleMemoryDocumentProfile(request,env,"inspect");
    if(url.pathname==="/api/memory/document-profile/suppress")return handleMemoryDocumentProfile(request,env,"suppress");
    if(url.pathname==="/api/context/decompose")return handleContextIntelligence(request,env,"decompose");
    if(url.pathname==="/api/context/research")return handleContextIntelligence(request,env,"research");
    if(url.pathname==="/api/context/apply")return handleContextApplication(request,env);
    if(url.pathname==="/api/workspace/quick-edit")return handleWorkspaceLocalProposal(request,env);
    const assistantProposal=url.pathname.match(/^\/api\/assistant\/proposals\/([^/]+)\/(accept|reject)$/);
    if(assistantProposal)return handleAssistantProposal(request,env,assistantProposal[1]!,assistantProposal[2]!);
    const assistantTask=url.pathname.match(/^\/api\/assistant\/tasks\/([^/]+)\/(cancel|reconcile)$/);
    if(assistantTask)return handleAssistantTask(request,env,assistantTask[1]!,assistantTask[2]!);
    const assistantBilling=url.pathname.match(/^\/api\/platform\/assistant\/billing\/([^/]+)\/reconcile$/);
    if(assistantBilling)return handleAssistantBillingReconciliation(request,env,assistantBilling[1]!);
    if(url.pathname==="/api/project-notifications")return handleProjectNotifications(request,env);
    if(url.pathname==="/api/privacy/events")return handleEventPrivacy(request,env);
    if(url.pathname==="/api/privacy/attention"&&request.method==="POST"){
      const authorization=await requireUser(request,env,"viewer",{account:"principal"});
      if(authorization.response||!authorization.user)return authorization.response??Response.json({error:"authentication_required"},{status:401});
      const consent=requireConsent(authorization.user);if(consent)return consent;
      if(scopedCookie){const selected=await readProjectRequestContext(request,env,authorization.user);if(selected.response)return selected.response;}
      const principal={...authorization.user,streamId:`creative:${authorization.user.userId}`,projectExecution:undefined};
      const before=await streamHead(env,principal.streamId);
      const personal=new Request(new URL("/api/events",request.url),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"append",clientId:"web:personal-privacy",event:{type:"AttentionSignalsForgotten",payload:{scope:"all-attention-episodes",before_sequence:before,reason:"user-requested",device_ledger_cleared:true}}})});
      const response=await handleEvents(personal,env,false,principal);const headers=new Headers(response.headers);headers.set("cache-control","private, no-store");return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    if(url.pathname==="/api/performance")return handlePerformanceSample(request,env);
    if(url.pathname==="/api/impersonation")return handleImpersonation(request,env);
    if(url.pathname==="/api/admin/budget-hold-dispositions")return handleHoldDispositions(request,env);
    if(url.pathname==="/api/admin/generation-accounting")return handleGenerationAccounting(request,env);
    if(url.pathname==="/api/admin/managed-video-reconciliation")return handleVideoReconciliation(request,env);
    if(url.pathname==="/api/admin/users")return handleAdminUsers(request,env);
    if(url.pathname==="/api/analytics")return handleAnalytics(request,env,context);
    if(url.pathname==="/api/generation-readiness")return handleGenerationReadiness(request,env);
    if(url.pathname==="/api/canvas-governance")return handleCanvasGovernance(request,env);
    if(url.pathname==="/api/image-adapters")return handleImageAdapters(request,env);
    if(url.pathname.startsWith("/api/generation-readiness/"))return handleGenerationReadiness(request,env,url.pathname.slice("/api/generation-readiness/".length));
    if(url.pathname==="/api/replay-sessions/approval")return handleReplayApproval(request,env);
    if(url.pathname==="/api/replay-sessions/estimate")return handleReplayEstimate(request,env);
    if(url.pathname==="/api/replay-sessions")return handleReplaySessions(request,env);
    if(url.pathname.startsWith("/api/replay-sessions/"))return handleReplaySessions(request,env,decodeURIComponent(url.pathname.slice("/api/replay-sessions/".length)));
    if(url.pathname==="/api/document-jobs")return handleDocumentJobs(request,env,"",context);
    if(url.pathname==="/api/output-requirements"||url.pathname.startsWith("/api/output-requirements/"))return handleOutputRequirements(request,env,url.pathname,context,outputDocumentExecutionBridge);
    if(url.pathname.startsWith("/api/document-jobs/"))return handleDocumentJobs(request,env,url.pathname.slice("/api/document-jobs/".length),context);
    if(url.pathname==="/api/documents/duplicate")return handleDocumentDuplication(request,env);
    if(url.pathname==="/api/canvas/arrangements")return handleCanvasArrangements(request,env);
    if(url.pathname==="/api/context/adaptive/apply")return handleAdaptiveProposalApplication(request,env);
    if(url.pathname.startsWith("/api/generated-images/")){
      const encoded=url.pathname.slice("/api/generated-images/".length);let outputId:string;
      try{outputId=decodeURIComponent(encoded);}catch{return Response.json({error:"invalid_output_id"},{status:400});}
      if(!outputId||encoded.includes("/")||encodeURIComponent(outputId)!==encoded)return Response.json({error:"not_found"},{status:404});
      return handleGeneratedImageEdit(request,env,outputId);
    }
    if(url.pathname.startsWith("/api/artifacts/")){
      const segments=url.pathname.slice("/api/artifacts/".length).split("/").map((segment)=>decodeURIComponent(segment));
      return handleArtifactEdit(request,env,segments[0]??"",segments.slice(1));
    }
    if(url.pathname==="/api/events"||url.pathname==="/api/events/hot"){
      const response=await handleEvents(request,env,url.pathname.endsWith("/hot"));
      if(!projectCookieHeaderPresent)return response;
      const headers=new Headers(response.headers);headers.set("cache-control","private, no-store");headers.append("vary","Cookie, oai-authenticated-user-id, oai-authenticated-user-email");
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    if(url.pathname==="/api/shares")return handleShares(request,env);
    if(url.pathname.startsWith("/api/shares/")&&request.method==="DELETE")return handleShares(request,env,decodeURIComponent(url.pathname.slice("/api/shares/".length)));
    if(url.pathname.startsWith("/api/shared/")&&request.method==="GET"){const rest=url.pathname.slice("/api/shared/".length);const marker=rest.indexOf("/media/");if(marker>=0)return handleSharedMedia(request,env,decodeURIComponent(rest.slice(0,marker)),decodeURIComponent(rest.slice(marker+"/media/".length)));return handleSharedView(request,env,decodeURIComponent(rest));}
    if(url.pathname==="/api/media"&&request.method==="POST")return uploadMedia(request,env);
    if(url.pathname.startsWith("/api/media/")&&(request.method==="GET"||request.method==="POST"&&url.searchParams.get("video-cover")==="webp"))return getMedia(request,decodeURIComponent(url.pathname.slice("/api/media/".length)),env);
    if(url.pathname.startsWith("/api/"))return Response.json({error:"not_found"},{status:404});
    if(url.pathname==="/custom-elements.json"){
      const authorization=await requireCapability(request,env,"design.catalog.read");
      if(authorization.response||!authorization.user)return authorization.response??Response.json({error:"authentication_required"},{status:401});
      const asset=await env.ASSETS.fetch(request);
      const headers=new Headers(asset.headers);
      headers.set("cache-control","private, no-store");
      headers.append("vary","Cookie, oai-authenticated-user-id, oai-authenticated-user-email, cf-access-authenticated-user-email");
      return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
    }
    if (isStillNamespace(url.pathname)) {
      if (!parseStillRoute(url)) return new Response("Page not found", {status:404,headers:{"cache-control":"private, no-store"}});
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null,{status:405,headers:{allow:"GET, HEAD"}});
      const asset = await env.ASSETS.fetch(new Request(new URL("/still", request.url), request));
      const headers = new Headers(asset.headers);
      headers.set("cache-control", "private, no-store");
      headers.set("x-forma-application", "still");
      return new Response(request.method === "HEAD" ? null : asset.body, { status: asset.status, headers });
    }
    if(request.method==="GET"||request.method==="HEAD"){
      const route=resolveServerRoute(url.pathname);
      if(route){
        const denied=await authorizeApplication(request,env,route.application,url.pathname);
        if(denied)return denied;
        const entryUrl=new URL(route.entryPath,url);
        const trustedIdentity=Boolean(request.headers.get("oai-authenticated-user-id")&&request.headers.get("oai-authenticated-user-email")||url.hostname==="localhost"||url.hostname==="127.0.0.1");
        const personalize=request.method==="GET"&&!url.pathname.startsWith("/share")&&trustedIdentity;
        const authenticatedStarted=performance.now();
        const authenticated=personalize?handleSession(request,env,context).catch(()=>null):null;
        const asset=await env.ASSETS.fetch(personalize?new Request(entryUrl,{headers:{"accept-encoding":"identity"}}):new Request(entryUrl,request));
        const encoding=(asset.headers.get("content-encoding")??"identity").trim().toLowerCase();
        const response=personalize&&asset.ok&&asset.body&&/text\/html/i.test(asset.headers.get("content-type")??"")&&encoding==="identity"?streamNavigationSession(asset,authenticated!,authenticatedStarted):asset;
        const headers=new Headers(response.headers);
        if(applicationDefinition(route.application).sensitivity!=="personal"||url.pathname.startsWith("/share")||url.pathname.startsWith("/settings/workspaces")){headers.set("cache-control","private, no-store");headers.append("vary","Cookie, oai-authenticated-user-id, oai-authenticated-user-email, cf-access-authenticated-user-email");}
        headers.set("x-forma-route-family",route.canonicalFamily);
        headers.set("x-forma-application",route.application);
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
      }
    }
    // Vite's development runtime has extensionless module endpoints. They are
    // assets, not navigations, and must reach the asset binding or the HTML
    // shell will never hydrate after a deep-link refresh.
    if(url.pathname.startsWith("/protected-assets/")){
      const assetParts=url.pathname.split("/");
      const namespace=assetParts[2]??"";
      const task=assetParts.length>4?assetParts[3]:"";
      const application=["operations","product","knowledge","engineering"].includes(namespace)?namespace as ApplicationId:null;
      if(application){
        const taskPath=application==="product"&&["insights","delivery","evaluation"].includes(task)?`/product/${task}`
          :application==="product"&&task==="adapters"?"/product/evaluation/adapters"
          :application==="product"&&task==="actual"?"/product/evaluation/actual"
          :application==="product"&&task==="replay"?"/product/evaluation/replay"
          :application==="knowledge"&&task==="components"?"/knowledge/design-system"
          :application==="operations"&&task==="release"?"/operations/canvas"
          :application==="operations"&&task==="overview"?"/system"
          :application==="operations"&&["access","providers"].includes(task)?`/operations/${task}`:"";
        const authorization=await requireCapability(request,env,taskPath?routeRequiredCapabilities(taskPath):applicationDefinition(application).requiredCapabilities);
        if(authorization.response||!authorization.user)return authorization.response??Response.json({error:"authentication_required"},{status:401});
        if(application==="product"&&task==="actual"&&authorization.user.role!=="admin")return Response.json({error:"administrator_required"},{status:403});
      }else if(namespace==="internal"){
        const capabilities=["operations","product","knowledge","engineering"].flatMap((id)=>applicationDefinition(id as ApplicationId).requiredCapabilities);
        const authorization=await requireCapability(request,env,capabilities);
        if(authorization.response||!authorization.user)return authorization.response??Response.json({error:"authentication_required"},{status:401});
      }else{
        const authorization=await requireCapability(request,env,["platform.identity.manage","platform.policy.manage"]);
        if(authorization.response||!authorization.user)return authorization.response??Response.json({error:"authentication_required"},{status:401});
      }
      const asset=await env.ASSETS.fetch(request);
      const headers=new Headers(asset.headers);
      headers.set("cache-control","private, no-store");
      headers.append("vary","Cookie, oai-authenticated-user-id, oai-authenticated-user-email, cf-access-authenticated-user-email");
      return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
    }
    const directHtmlPath=/\.html?$/i.test(url.pathname)?url.pathname.replace(/(?:\/index)?\.html?$/i,"")||"/":"";
    const directHtmlRoute=directHtmlPath?resolveServerRoute(directHtmlPath):null;
    if(directHtmlRoute){
      const denied=await authorizeApplication(request,env,directHtmlRoute.application,directHtmlPath);
      if(denied)return denied;
    }
    if(url.pathname.startsWith("/.vite/")||url.pathname.endsWith(".map"))return new Response("Not found",{status:404});
    const developmentAssetRequest=/^\/(?:@vite\/|@id\/|@fs\/|__vite_ping$|__open-in-editor)/.test(url.pathname);
    const assetRequest=developmentAssetRequest||/^\/(?:assets\/|og\.png$|favicon\.|robots\.txt$)|\.[a-z0-9]{2,8}$/i.test(url.pathname);
    if(assetRequest){
      const asset=await env.ASSETS.fetch(request);
      if(directHtmlRoute&&(applicationDefinition(directHtmlRoute.application).sensitivity!=="personal"||directHtmlPath==="/share"||directHtmlPath.startsWith("/share/"))){
        const headers=new Headers(asset.headers);
        headers.set("cache-control","private, no-store");
        headers.append("vary","Cookie, oai-authenticated-user-id, oai-authenticated-user-email, cf-access-authenticated-user-email");
        return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
      }
      return asset;
    }
    if(request.method!=="GET"&&request.method!=="HEAD")return new Response("Method not allowed",{status:405});
    return new Response("Page not found",{status:404,headers:{"content-type":"text/plain; charset=utf-8"}});
}

export default {
  async fetch(request: Request, env: WorkerEnv, context: WorkerExecutionContext): Promise<Response> {
    const started=performance.now();
    const response=await routeRequest(request,env,context);
    const pathname=new URL(request.url).pathname;
    const retainedStoryRead=pathname==="/api/retained-story"||pathname.startsWith("/api/retained-story/")
      ||pathname==="/api/retained-output"||pathname.startsWith("/api/retained-output/");
    const memoryBenchmarkRequest=pathname==="/api/internal/memory-benchmark"||pathname==="/api/internal/memory-benchmark/approval"||pathname==="/api/internal/memory-benchmark/reconcile"||pathname==="/api/internal/memory-benchmark/release-undispatched";
    if(pathname.startsWith("/api/")&&pathname!==SOURCE_ADVISORY_PATH&&pathname!==GENERATION_EVIDENCE_PATH&&pathname!==CURRENT_SOURCE_PATH&&!memoryBenchmarkRequest&&pathname!==OUTPUT_SCHEMA_PREFLIGHT_PATH&&pathname!==MEMORY_SCHEMA_REPAIR_PATH&&pathname!==EVENT_SAVE_REPAIR_PATH&&pathname!=="/api/admin/budget-hold-dispositions"&&pathname!=="/api/admin/generation-accounting"&&pathname!=="/api/admin/managed-video-reconciliation"&&!retainedStoryRead&&!isSelectedOutputShareApiPath(pathname)&&!pathname.startsWith("/api/still/panel")&&!sponsoredImageResponses.has(response))schedulePrivateContentRetention(env,context);
    const headers=new Headers(response.headers);
    headers.append("server-timing",`app;dur=${Math.max(0,performance.now()-started).toFixed(1)}`);
    if(new URL(request.url).pathname.startsWith("/api/")&&!headers.has("cache-control"))headers.set("cache-control","private, no-store");
    headers.set("x-content-type-options","nosniff");
    headers.set("referrer-policy",(pathname===MEMORY_SCHEMA_REPAIR_PATH||pathname===EVENT_SAVE_REPAIR_PATH)?"same-origin":"no-referrer");
    headers.set("permissions-policy","camera=(), microphone=(), geolocation=()");
    if(!headers.has("content-security-policy"))headers.set("content-security-policy","frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    if(new URL(request.url).protocol==="https:")headers.set("strict-transport-security","max-age=31536000; includeSubDomains");
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  },
  async scheduled(_controller: unknown, env: WorkerEnv): Promise<void> {
    try {
      // Run each independent maintenance step even if an earlier one fails.
      // These steps never enroll, infer, dispatch or retry a provider request.
      let cleanupFailed = false, cleanupError: unknown;
      const cleanupSteps = [
        () => sweepStillPanels(env),
        () => sweepResourceMemory(env),
        () => sweepScopeProfiles(env),
        () => reconcileResourceAssistantUsage(env),
        () => reconcileMemoryImageUsage(env),
        () => reconcileMemoryAuthoredImages(env),
        () => observeScheduledRetention(env,1_000),
        () => sweepExpiredMemoryCheckpoints(env,128),
        () => sweepExpiredDocumentProfileSuppressions(env,128),
        () => sweepExpiredDerivationGrants(env,128),
        () => sweepNativeDerivationJobs(env),
        () => sweepNativeDerivationResults(env),
        () => sweepAssistantMemoryContexts(env),
        () => sweepSemanticAssistantMemory(env),
        () => sweepNativeDerivationUserControls(env),
        async () => {
          const recovery=await maintainNativeDerivationRecovery(env);
          if(recovery.failed)throw Error("memory-derivation-recovery-partial");
        },
      ];
      for (const step of cleanupSteps) {
        try { await step(); } catch (error) { if (!cleanupFailed) cleanupError = error; cleanupFailed = true; }
      }
      // Do not hide a failed privacy/accounting pass or start learning after it.
      if(cleanupFailed)throw cleanupError;
      // Native worker event only: the runner separately requires literal scheduling
      // admission, actor rollout and each existing background-purpose enrollment.
      await runLiveMemoryScheduled(env);
      await runNativeDerivationScheduled(env);
      await runScopeProfileScheduled(env);
      await runResourceMemoryScheduled(env);
    } finally {
      try {
        // Synthetic payload expiry is independent of spending/enrollment flags.
        // Missing optional schema is a no-op; a partial schema fails visibly.
        await purgeExpiredNativeMemoryBenchmark(env);
      } finally {
        // A Memory-cleanup failure must not prevent the existing reminder pass.
        await processReviewReminders(env,100);
      }
    }
  },
};
