import { referencePixelMode, sendsReferencePixels } from "../src/model/block-types.ts";
import { foldEvents } from "../src/model/events.ts";
import { documentGenerationRevision } from "../src/model/document-jobs.ts";
import { authoritativeCreativeContext, ContextIntegrityError } from "./context-authority.ts";
import { documentImageFormat, providerRenderFormat, validateProviderImageSize } from "../src/model/image-format.ts";
import { GENERATION_PREFLIGHT_VERSION, generationReadinessCostMicrousd, generationReadinessReservation, generationReadinessSeconds, type GenerationReadiness, type GenerationReadinessKind, type GenerationReadinessProbe, type PromptTechniqueSafetyComparison, type PromptTechniqueSafetyResult, type ProviderHealthSnapshot } from "../src/model/generation-readiness.ts";
import { buildBoundedPromptRepresentation, normalizePromptTechnique, PROMPT_TECHNIQUES, type PromptReferenceDescriptor, type PromptTechnique } from "../src/model/prompt-structures.ts";
import { standingConstraints } from "../src/model/taste.ts";
import { readGeneratedImageReference } from "./media-api.ts";
import { moderateGenerationSnapshot, moderatePromptTechniqueSet } from "./openai-moderation.ts";
import type { ImageReference } from "./openai-adapter.ts";
import { hasCapability, readAccountBudgets, readBudgets, requireConsent, requireUser, type PilotUser } from "./pilot-policy.ts";
import { ownerDocumentBudgetScopes, readProjectRequestContext, readProjectSourceEvents } from "./project-access.ts";
import { classifyProviderFailure, type ProviderFailureDetail } from "./provider-errors.ts";
import { appendAuditEvent, ensureSchema, readWorkspaceEvents, uuidV7, type EventRow, type WorkerEnv } from "./runtime.ts";
import { validateFalImageSize } from "./fal-image-adapter.ts";
import { buildManagedProductionPlan, productionTeamFor, providerFacingProductionContinuity, providerFacingProductionTargets, type ProductionMode } from "../src/model/managed-production.ts";
import { ProductionWorkflowContextError, resolveProductionWorkflowContext } from "./production-workflow.ts";
import { governedPackageSourceRightsCurrent } from "./context-package-rights.ts";
import type { ProductionWorkflowSource } from "../src/model/production-workflow.ts";

export type GenerationPreflightInput = { kind: GenerationReadinessKind; documentId: string; documentRevision?: string; requestKey?: string; sourcePreviewId?: string | null; promptTechnique?: PromptTechnique; productionMode?:ProductionMode; snapshot?: Record<string, unknown>; sourceBlockVersions?:Array<Record<string,unknown>>;canvasId?:string;contextSetId?:string;contextRootBlockId?:string;characterOutputKind?:"headshot"|"character_sheet"; force?: boolean; sourceSurface?: string;workflowId?:string;workflowStageId?:string;workflowSources?:ProductionWorkflowSource[] };
export type PromptTechniqueComparisonInput = { documentId: string; documentRevision?: string; sourcePreviewId?: string | null; failedTechnique?: PromptTechnique; failedPrompt?: string; kind?: "preview" | "generate"; productionMode?:ProductionMode; snapshot?: Record<string, unknown>; sourceSurface?: string };
type ProviderHealthRow = { status:string;scope:string;message:string;observed_at:string;expires_at:string;retry_after_ms:number|null;request_id:string|null };
type PreflightRow = { result_json:string;expires_at:string;context_head?:number };

const CONTEXT_MUTATION_TYPES=["ProjectCreated","ProjectRenamed","ProjectStateChanged","DocumentCreated","DocumentForked","DocumentRenamed","DocumentRemoved","DocumentRestored","BlockCreated","BlockRenamed","BlockPropertyEdited","BlockWeightSet","BlockLocked","BlockUnlocked","BlockRemoved","BlockRestored","BlockRelationAdded","BlockRelationRemoved","ReferenceIngested","RightsAsserted","ChipEdited","ObjectPinned","ObjectUnpinned","CanvasCreated","CanvasRenamed","CanvasRemoved","CanvasRestored","CanvasItemPlaced","CanvasReferenceCreated","CanvasItemRemoved","CanvasItemRestored","CanvasTextApplied","CanvasRegisterSet","ContextSetFormalized"] as const;
const CONTEXT_MUTATION_SQL=`type IN (${CONTEXT_MUTATION_TYPES.map((type)=>`'${type}'`).join(",")})`;

const usesFalImages=(env:WorkerEnv)=>["fal","fal-ideogram","ideogram"].includes((env.FORMA_IMAGE_PROVIDER??"openai").trim().toLowerCase());
const providerScopeKey = (env: WorkerEnv) => usesFalImages(env)?`fal:${env.FAL_IMAGE_MODEL??"ideogram/v4"}`:`openai:${env.OPENAI_PROJECT ?? "default"}:${env.OPENAI_IMAGE_MODEL ?? "gpt-image-2"}`;
const nowIso = () => new Date().toISOString();

function productionPreflightSnapshot(snapshot:Record<string,unknown>,mode:ProductionMode){
  if(mode!=="managed")return snapshot;
  const plan=buildManagedProductionPlan("image",snapshot);
  return{...snapshot,production_brief:{team:productionTeamFor("image").specialists.map((member)=>({role:member.label,responsibility:member.responsibility})),continuity_bible:providerFacingProductionContinuity({claims:plan.claims.filter((claim)=>!claim.contextGroupIds.length)}),required_source_coverage:plan.claims.filter((claim)=>!claim.negative&&!claim.contextGroupIds.length).map((claim)=>claim.text),scoped_targets:providerFacingProductionTargets(plan,snapshot)}};
}

function emptyProvider(message="No recent provider block has been observed."):ProviderHealthSnapshot { const now=Date.now();return{status:"unknown",scope:"unknown",message,observedAt:new Date(now).toISOString(),expiresAt:new Date(now+5*60_000).toISOString(),retryAfterMs:null,requestId:null}; }

export async function readProviderHealth(env:WorkerEnv):Promise<ProviderHealthSnapshot>{
  await ensureSchema(env);const row=await env.DB.prepare("SELECT status,scope,message,observed_at,expires_at,retry_after_ms,request_id FROM provider_health WHERE scope_key=?").bind(providerScopeKey(env)).first<ProviderHealthRow>();
  if(!row||Date.parse(row.expires_at)<=Date.now())return emptyProvider();
  return{status:row.status as ProviderHealthSnapshot["status"],scope:row.scope as ProviderHealthSnapshot["scope"],message:row.message,observedAt:row.observed_at,expiresAt:row.expires_at,retryAfterMs:row.retry_after_ms===null?null:Number(row.retry_after_ms),requestId:row.request_id};
}

function healthFromFailure(detail:ProviderFailureDetail):ProviderHealthSnapshot|null{
  const status:ProviderHealthSnapshot["status"]|null=detail.action==="add_credits"?"credits_blocked":detail.scope==="project"&&detail.category==="quota"?"project_limit":detail.scope==="organization"&&detail.category==="quota"?"organization_limit":detail.category==="authentication"?"authentication_failed":detail.category==="access"?"model_access":detail.category==="rate_limit"?"rate_limited":detail.category==="network"||detail.category==="server"?"degraded":null;
  if(!status)return null;const now=Date.now();const ttl=status==="rate_limited"?Math.max(30_000,detail.retryAfterMs??60_000):status==="degraded"?2*60_000:15*60_000;
  return{status,scope:(detail.scope==="account"||detail.scope==="project"||detail.scope==="organization"||detail.scope==="model"||detail.scope==="provider"?detail.scope:"unknown"),message:detail.message,observedAt:new Date(now).toISOString(),expiresAt:new Date(now+ttl).toISOString(),retryAfterMs:detail.retryAfterMs,requestId:detail.requestId};
}

async function writeProviderHealth(env:WorkerEnv,value:ProviderHealthSnapshot){await ensureSchema(env);await env.DB.prepare("INSERT INTO provider_health (scope_key,status,scope,message,observed_at,expires_at,retry_after_ms,request_id) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(scope_key) DO UPDATE SET status=excluded.status,scope=excluded.scope,message=excluded.message,observed_at=excluded.observed_at,expires_at=excluded.expires_at,retry_after_ms=excluded.retry_after_ms,request_id=excluded.request_id").bind(providerScopeKey(env),value.status,value.scope,value.message,value.observedAt,value.expiresAt,value.retryAfterMs,value.requestId).run();}

export async function observeProviderFailure(env:WorkerEnv,detail:ProviderFailureDetail){const health=healthFromFailure(detail);if(health)await writeProviderHealth(env,health);return health;}
export async function observeProviderSuccess(env:WorkerEnv,requestId:string|null=null){const now=Date.now();const health:ProviderHealthSnapshot={status:"healthy",scope:"provider",message:"A billable image request completed successfully.",observedAt:new Date(now).toISOString(),expiresAt:new Date(now+15*60_000).toISOString(),retryAfterMs:null,requestId};await writeProviderHealth(env,health);return health;}

const statusBlocksProvider=(health:ProviderHealthSnapshot)=>["credits_blocked","project_limit","organization_limit","authentication_failed","model_access"].includes(health.status)||health.status==="rate_limited"&&Date.parse(health.expiresAt)>Date.now();

const techniqueReferenceDescriptors = (references: ImageReference[]): PromptReferenceDescriptor[] => references.map((reference) => ({
  blockId: reference.blockId,
  referenceId: reference.referenceId,
  label: reference.label,
  mode: reference.mode,
  mimeType: reference.mimeType,
  source: reference.source,
}));

async function promptTechniqueReferences(env: WorkerEnv, ownerId: string, projection: ReturnType<typeof foldEvents>, events: EventRow[], sourcePreviewId?: string | null) {
  const references: ImageReference[] = [];
  for (const block of projection.blocks) {
    if (block.type !== "reference" || Number(block.properties.weight ?? .5) <= 0 || !sendsReferencePixels(block.properties.pixel_reference_mode)) continue;
    const referenceId = String(block.properties.reference_id ?? "");
    const rightsConfirmed = events.some((event) => event.type === "RightsAsserted" && String(event.payload.reference_id ?? "") === referenceId)
      || events.some((event) => event.type === "ReferenceIngested" && String(event.payload.reference_id ?? "") === referenceId && Boolean(event.payload.rights_class));
    if (!referenceId || !rightsConfirmed) throw new Error(`reference_pixel_rights_required:${block.id}`);
    const image = await readGeneratedImageReference(env, ownerId, block.properties.media_url);
    if (!image) throw new Error(`reference_pixel_input_unavailable:${block.id}`);
    references.push({ ...image, blockId: block.id, referenceId, label: String(block.properties.label ?? block.handle), mode: referencePixelMode(block.properties.pixel_reference_mode), source: "uploaded-reference" });
  }
  if (sourcePreviewId) {
    const output = projection.outputs.find((candidate) => candidate.id === sourcePreviewId);
    if (!output?.mediaUrl) throw new Error(`reference_pixel_input_unavailable:${sourcePreviewId}`);
    const image = await readGeneratedImageReference(env, ownerId, output.mediaUrl);
    if (!image) throw new Error(`reference_pixel_input_unavailable:${sourcePreviewId}`);
    references.unshift({ ...image, referenceId: sourcePreviewId, label: "Selected ideation preview", source: "ideation-preview" });
  }
  return references;
}

export async function comparePromptTechniqueSafety(env: WorkerEnv, user: PilotUser, input: PromptTechniqueComparisonInput): Promise<PromptTechniqueSafetyComparison> {
  if (!env.OPENAI_API_KEY) throw new Error("provider_not_configured");
  const events = await readWorkspaceEvents(env, user.streamId);
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, input.documentId);
  if (!projection.documentId || projection.documentId !== input.documentId) throw new Error("document_not_found");
  const baseSnapshot = authoritativeCreativeContext(events,{documentId:input.documentId,snapshot:input.snapshot}).snapshot;
  const references = await promptTechniqueReferences(env, user.userId, projection, events, input.sourcePreviewId);
  const snapshot = productionPreflightSnapshot({
    ...baseSnapshot,
    document: { id: projection.documentId, title: projection.documentTitle },
    standing_constraints: standingConstraints(events).map((item) => ({ preference_id: item.preferenceId, axis: item.axis, value: item.value, polarity: item.polarity, authority: "authored", source_event_refs: item.evidenceRefs, source_claim_ref: item.sourceClaimRef ?? null })),
    reference_inputs: techniqueReferenceDescriptors(references),
  },input.productionMode==="managed"?"managed":"manual");
  const documentRevision = documentGenerationRevision({ snapshot:baseSnapshot, sourceBlockVersions: projection.blocks.map((block) => ({ block_id: block.id, version: block.sourceEvents.length })), documentId: projection.documentId });
  const failedTechnique = normalizePromptTechnique(input.failedTechnique);
  const quality = input.kind === "preview" ? "low" : "high";
  const imageFormat = documentImageFormat(snapshot);
  const render = providerRenderFormat(imageFormat.format, input.kind === "preview" ? "preview" : "full");
  const direction = {
    title: projection.documentTitle,
    rationale: "Translate the current document's active creative decisions into one coherent image without adding unsupported subjects or events.",
    scene: `Create a representative image for “${projection.documentTitle}” from the current document context.`,
    palette: [],
    next_moves: [],
  };
  const prepared = PROMPT_TECHNIQUES.map((technique) => {
    const built = buildBoundedPromptRepresentation(technique, snapshot, direction, techniqueReferenceDescriptors(references), { size: render.size, quality, partialImages: input.kind === "preview" ? 1 : 0 });
    const exactFailedPrompt = technique === failedTechnique ? input.failedPrompt?.trim().slice(0, built.limit) : "";
    return { technique, ...built, prompt: exactFailedPrompt || built.prompt, finalLength: exactFailedPrompt ? exactFailedPrompt.length : built.finalLength, compacted: exactFailedPrompt ? false : built.compacted, fits: exactFailedPrompt ? true : built.fits };
  });
  const comparable = prepared.filter((entry) => entry.fits).map((entry) => ({ technique: entry.technique, prompt: entry.prompt }));
  const [moderation, snapshotModeration] = await Promise.all([
    moderatePromptTechniqueSet(env, comparable, references),
    moderateGenerationSnapshot(env, snapshot).catch(() => null),
  ]);
  const sharedReference = moderation.references;
  const results: PromptTechniqueSafetyResult[] = prepared.map((entry) => {
    const result = moderation.promptResults.find((candidate) => candidate.technique === entry.technique);
    if (!entry.fits || !result) return { technique: entry.technique, status: "unknown", summary: `This representation remains ${entry.finalLength.toLocaleString()} characters after safe compaction and cannot be evaluated within the ${entry.limit.toLocaleString()} character provider limit.`, prompt: entry.prompt, promptLength: entry.finalLength, compacted: entry.compacted, categories: [], blockIds: [], referenceIds: [], coverage: references.length ? "text-and-images" : "text", latencyMs: 0, requestId: null };
    const flagged = result.flagged || sharedReference.flagged;
    const categories = [...new Set([...result.categories, ...sharedReference.categories])].sort();
    const referenceOnly = sharedReference.flagged && !result.flagged;
    const summary = !flagged
      ? `This ${entry.technique} prompt passed the advisory text${references.length ? " and reference-image" : ""} review. Final provider checks still apply.`
      : referenceOnly
        ? `The prompt text passed, but ${sharedReference.referenceIds.length || references.length} selected reference image${(sharedReference.referenceIds.length || references.length) === 1 ? " needs" : "s need"} review. Changing prompt structure alone is unlikely to resolve it.`
        : `This ${entry.technique} representation raised an advisory moderation concern${categories.length ? `: ${categories.join(", ")}` : ""}.`;
    return {
      technique: entry.technique,
      status: flagged ? "review" : "pass",
      summary,
      prompt: entry.prompt,
      promptLength: entry.finalLength,
      compacted: entry.compacted,
      categories,
      blockIds: result.flagged ? snapshotModeration?.blockIds ?? [] : [],
      referenceIds: sharedReference.flagged ? sharedReference.referenceIds : [],
      coverage: references.length ? "text-and-images" : "text",
      latencyMs: result.latencyMs + Math.round(sharedReference.latencyMs / Math.max(1, PROMPT_TECHNIQUES.length)),
      requestId: result.flagged ? result.requestId : sharedReference.flagged ? sharedReference.requestId : result.requestId,
    };
  });
  const passing = results.filter((result) => result.status === "pass");
  const recommendedTechnique = passing.find((result) => result.technique !== failedTechnique)?.technique ?? passing[0]?.technique ?? null;
  const summary = sharedReference.flagged
    ? "One or more selected reference images raised the concern, so a prompt-structure change alone is unlikely to help."
    : recommendedTechnique && recommendedTechnique !== failedTechnique
      ? `${recommendedTechnique} passed this advisory comparison while the submitted ${failedTechnique} path did not.`
      : passing.length
        ? `${passing.length} of four prompt structures passed this advisory comparison.`
        : "No prompt structure passed the advisory comparison. Review the named context before paying for another image request.";
  const comparisonId = uuidV7();
  const checkedAt = nowIso();
  const version = "prompt-technique-safety-v1";
  await appendAuditEvent(env, user.streamId, "worker:policy", "GenerationPreflightRequested", { preflight_id: comparisonId, document_id: projection.documentId, document_revision: documentRevision, request_key: `prompt-technique-comparison:${documentRevision}`, kind: "prompt_technique_comparison", prompt_technique: failedTechnique, source_surface: input.sourceSurface ?? "generation-failure", preflight_version: version });
  await appendAuditEvent(env, user.streamId, "worker:policy", "GenerationPreflightCompleted", { preflight_id: comparisonId, document_id: projection.documentId, document_revision: documentRevision, request_key: `prompt-technique-comparison:${documentRevision}`, kind: "prompt_technique_comparison", prompt_technique: failedTechnique, status: results.some((result) => result.status === "pass") ? "review" : "blocked", probe_results: results.map((result) => ({ id: `prompt-technique:${result.technique}`, status: result.status === "pass" ? "pass" : result.status === "review" ? "warning" : "unknown", severity: result.status === "pass" ? "info" : "warning", block_ids: result.blockIds, reference_ids: result.referenceIds, categories: result.categories })), estimated_tokens: 0, estimated_cost_microusd: 0, estimated_seconds: Math.max(...results.map((result) => result.latencyMs), 0) / 1000, provider_status: "moderation-only", image_generation_calls: 0, reference_probe_count: references.length, recommended_prompt_technique: recommendedTechnique, preflight_version: version });
  return { comparisonId, documentId: projection.documentId, documentRevision, failedTechnique, recommendedTechnique, summary, results, referenceCount: references.length, imageGenerationCalls: 0, checkedAt, version };
}

export async function preflightGeneration(env:WorkerEnv,user:PilotUser,input:GenerationPreflightInput,options:{appendEvents?:boolean;allowCache?:boolean;sourceEvents?:EventRow[]}={}):Promise<GenerationReadiness>{
  await ensureSchema(env);const checkedAt=nowIso();const technique=normalizePromptTechnique(input.promptTechnique);const productionMode:ProductionMode=input.productionMode==="managed"?"managed":"manual";
  const hasWorkflow=input.workflowId!==undefined||input.workflowStageId!==undefined||input.workflowSources!==undefined;
  const execution=user.projectExecution,cachePrefix=execution?`${GENERATION_PREFLIGHT_VERSION}:project:${execution.projectAccessId}:${execution.actorUserId}:`:`${GENERATION_PREFLIGHT_VERSION}:`;
  if(execution){
    const governedEvents=options.sourceEvents??await readProjectSourceEvents(env,execution);
    const governedProjection=foldEvents(governedEvents,Number.POSITIVE_INFINITY,input.documentId,execution.projectId);
    if(!await governedPackageSourceRightsCurrent(env,execution.organizationId,governedProjection.blocks))
      throw new ContextIntegrityError("context_source_rights_expired","The original rights for an adopted organizational source are no longer valid.");
  }
  let prefetched:PreflightRow|null|undefined;
  const claimedRevisionMatches=!hasWorkflow&&(!input.snapshot||documentGenerationRevision({snapshot:input.snapshot,sourceBlockVersions:input.sourceBlockVersions??[],documentId:input.documentId})===input.documentRevision);
  if(options.allowCache!==false&&!input.force&&claimedRevisionMatches&&input.requestKey&&input.documentRevision&&input.documentId){
    prefetched=await env.DB.prepare(`SELECT result_json,expires_at,(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=? AND ${CONTEXT_MUTATION_SQL}) AS context_head FROM generation_preflights WHERE owner_id=? AND request_key=?`).bind(user.streamId,user.userId,`${cachePrefix}${input.requestKey}`).first<PreflightRow>();
    if(prefetched&&Date.parse(prefetched.expires_at)>Date.now())try{
      const cached=JSON.parse(prefetched.result_json) as GenerationReadiness;
      const suppliedCanvas=input.snapshot?.canvas&&typeof input.snapshot.canvas==="object"?input.snapshot.canvas as Record<string,unknown>:{};
      const canvasId=String(input.canvasId??suppliedCanvas.canvas_id??""),contextSetId=String(input.contextSetId??suppliedCanvas.context_set_id??"");
      if(cached.sourceContextHead===Number(prefetched.context_head??-1)&&String(cached.canvasId??"")===canvasId&&String(cached.contextSetId??"")===contextSetId&&cached.documentId===input.documentId&&cached.documentRevision===input.documentRevision&&cached.requestKey===input.requestKey&&cached.kind===input.kind&&cached.promptTechnique===technique&&(cached.productionMode??"manual")===productionMode)return{...cached,cached:true};
      prefetched=null;
    }catch{prefetched=null;/* Recompute malformed cache rows. */}
  }
  const events=options.sourceEvents??await readWorkspaceEvents(env,user.streamId);const trusted=authoritativeCreativeContext(events,{documentId:input.documentId,projectId:execution?.projectId,canvasId:input.canvasId,contextSetId:input.contextSetId,contextRootBlockId:input.contextRootBlockId,characterOutputKind:input.characterOutputKind,snapshot:input.snapshot,sourceBlockVersions:input.sourceBlockVersions});const projection=trusted.projection;const baseSnapshot=trusted.snapshot;const documentRevision=trusted.documentRevision;
  let effectiveSnapshot:Record<string,unknown>=baseSnapshot;
  if(hasWorkflow){
    if(input.kind!=="generate")throw new ProductionWorkflowContextError("workflow_stage_unavailable","Production source checkpoints can only inform an explicitly requested final-quality image.",409);
    let workflowScope=execution;
    if(!workflowScope&&!user.fictional&&(user.billingUserId??user.userId)===user.userId){const scopes=await ownerDocumentBudgetScopes(env,user.userId,projection.documentId,projection.projectId);if(scopes.length>1)throw new ProductionWorkflowContextError("ambiguous_project_budget_scope","The production stage has more than one governed owner.",409);if(scopes[0])workflowScope={organizationId:scopes[0].organizationId,projectAccessId:scopes[0].projectAccessId,projectId:projection.projectId,ownerUserId:user.userId,actorUserId:user.userId};}
    const resolved=await resolveProductionWorkflowContext({env,events,documentId:projection.documentId,projectId:projection.projectId,ownerId:workflowScope?.ownerUserId??user.userId,scope:workflowScope,snapshot:baseSnapshot,workflowId:input.workflowId,workflowStageId:input.workflowStageId,workflowSources:input.workflowSources,requestedFormat:"image"});
    effectiveSnapshot=resolved.snapshot;
  }
  const snapshot=productionPreflightSnapshot(effectiveSnapshot,productionMode);const requestKey=String(input.requestKey||`${input.kind}:${documentRevision}:${input.sourcePreviewId||"document"}:${technique}${productionMode==="managed"?":managed":""}`);const cacheKey=`${cachePrefix}${requestKey}`;
  if(options.allowCache!==false&&!input.force){
    const cached=prefetched===undefined?await env.DB.prepare("SELECT result_json,expires_at FROM generation_preflights WHERE owner_id=? AND request_key=?").bind(user.userId,cacheKey).first<PreflightRow>():prefetched;
    if(cached&&Date.parse(cached.expires_at)>Date.now())try{
      const value=JSON.parse(cached.result_json) as GenerationReadiness;
      const trustedCanvas=baseSnapshot.canvas&&typeof baseSnapshot.canvas==="object"?baseSnapshot.canvas as Record<string,unknown>:{};
      const trustedContextHead=events.reduce((head,event)=>CONTEXT_MUTATION_TYPES.includes(event.type as typeof CONTEXT_MUTATION_TYPES[number])?Math.max(head,event.sequence):head,0);
      if(value.documentId===projection.documentId&&value.documentRevision===documentRevision&&value.requestKey===requestKey&&value.kind===input.kind&&value.promptTechnique===technique
        &&(value.productionMode??"manual")===productionMode&&String(value.canvasId??"")===String(input.canvasId??trustedCanvas.canvas_id??"")
        &&String(value.contextSetId??"")===String(input.contextSetId??trustedCanvas.context_set_id??"")&&value.sourceContextHead===trustedContextHead)return{...value,cached:true};
    }catch{/* Recompute malformed or cross-document cache rows. */}
  }
  let previous:GenerationReadiness|null=null;const previousRow=await env.DB.prepare("SELECT result_json,expires_at FROM generation_preflights WHERE owner_id=? AND document_id=? AND request_key LIKE ? ORDER BY created_at DESC LIMIT 1").bind(user.userId,projection.documentId,`${cachePrefix}%`).first<PreflightRow>();if(previousRow)try{previous=JSON.parse(previousRow.result_json) as GenerationReadiness;}catch{/* A malformed historical cache must not block a new check. */}
  const preflightId=uuidV7();const expiresAt=new Date(Date.now()+10*60_000).toISOString();const probes:GenerationReadinessProbe[]=[];const add=(probe:GenerationReadinessProbe)=>probes.push(probe);if(options.appendEvents!==false){if(previous&&previous.documentRevision!==documentRevision)await appendAuditEvent(env,user.streamId,"worker:policy","GenerationPreflightInvalidated",{preflight_id:previous.preflightId,document_id:projection.documentId,previous_document_revision:previous.documentRevision,document_revision:documentRevision,reason:"document-or-request-changed",source_surface:input.sourceSurface??"generation-controls",preflight_version:GENERATION_PREFLIGHT_VERSION});await appendAuditEvent(env,user.streamId,"worker:policy","GenerationPreflightRequested",{preflight_id:preflightId,document_id:projection.documentId,document_revision:documentRevision,request_key:requestKey,kind:input.kind,prompt_technique:technique,source_surface:input.sourceSurface??"generation-controls",preflight_version:GENERATION_PREFLIGHT_VERSION});}
  const estimatedTokens=generationReadinessReservation(input.kind);const budgets=execution?(await readAccountBudgets(env,user.userId,execution.organizationId)).budgets:await readBudgets(env,user.billingUserId??user.userId);const remaining=Math.max(0,Math.min(budgets.user.limit-budgets.user.used-budgets.user.reserved,budgets.workspace.limit-budgets.workspace.used-budgets.workspace.reserved));
  const canReadWorkspaceBudget=!execution||hasCapability(user,"workspace.usage.read",{organizationId:execution.organizationId});
  add(remaining>=estimatedTokens?{id:"application-budget",label:"Application budget",status:"pass",severity:"info",summary:canReadWorkspaceBudget?`${remaining.toLocaleString()} tokens remain; this request reserves ${estimatedTokens.toLocaleString()}.`:"This request is within your personal and organization generation limits.",action:"none"}:{id:"application-budget",label:"Application budget",status:"fail",severity:"blocking",summary:canReadWorkspaceBudget?`Only ${remaining.toLocaleString()} tokens remain; this request needs ${estimatedTokens.toLocaleString()}.`:"This request exceeds a personal or organization generation limit.",action:"review_budget"});
  let provider=await readProviderHealth(env);if(!env.OPENAI_API_KEY){provider={...emptyProvider("The OpenAI planner and safety preflight are not configured."),status:"authentication_failed",scope:"account"};}else if(usesFalImages(env)&&!env.FAL_KEY){provider={...emptyProvider("Fal is selected for images but no Fal credential is configured."),status:"authentication_failed",scope:"account"};}
  const providerLabel=usesFalImages(env)?"Fal + safety availability":"OpenAI availability";add(statusBlocksProvider(provider)?{id:"provider-health",label:providerLabel,status:"fail",severity:"blocking",summary:provider.message,action:provider.status==="rate_limited"?"wait":"refresh_provider"}:{id:"provider-health",label:providerLabel,status:"pass",severity:"info",summary:provider.status==="healthy"?provider.message:"No recent account, project, or model block has been observed.",action:"none"});
  const selected=documentImageFormat(snapshot);const render=providerRenderFormat(selected.format,input.kind.startsWith("preview")?"preview":"full");const falSize=usesFalImages(env)?validateFalImageSize(render.size):null;const openaiSize=falSize?null:validateProviderImageSize(render.size);const sizeValid=falSize?.valid??openaiSize?.valid??false;const sizeIssues=falSize?[falSize.reason]:openaiSize?.issues??["The image size is not supported."];
  add(sizeValid?{id:"image-format",label:"Image format",status:"pass",severity:"info",summary:`${render.size} is accepted by the configured image adapter.`,action:"none"}:{id:"image-format",label:"Image format",status:"fail",severity:"blocking",summary:sizeIssues.join(" "),action:"review_blocks",blockIds:selected.blockId?[selected.blockId]:[]});
  const payloadLength=JSON.stringify(snapshot).length;add(payloadLength>650_000?{id:"context-size",label:"Compiled context",status:"fail",severity:"blocking",summary:`The document context is ${payloadLength.toLocaleString()} characters and exceeds the durable job limit.`,action:"review_blocks"}:payloadLength>240_000?{id:"context-size",label:"Compiled context",status:"warning",severity:"warning",summary:"The document is unusually large. Safe compaction will run before the image request, but review very long block instructions.",action:"review_blocks"}:{id:"context-size",label:"Compiled context",status:"pass",severity:"info",summary:`${payloadLength.toLocaleString()} characters can be safely compiled.`,action:"none"});
  const facts=Array.isArray(snapshot.facts)?snapshot.facts as Array<Record<string,unknown>>:[];const missingReferences=facts.filter((fact)=>fact.type==="reference"&&sendsReferencePixels((fact.properties??{}) as Record<string,unknown>)&&!String(((fact.properties??{}) as Record<string,unknown>).media_url??"")).map((fact)=>String(fact.block_id??"")).filter(Boolean);
  if(input.sourcePreviewId&&!projection.outputs.some((output)=>output.id===input.sourcePreviewId))missingReferences.push(String(input.sourcePreviewId));
  add(missingReferences.length?{id:"reference-availability",label:"Reference pixels",status:"fail",severity:"blocking",summary:`${missingReferences.length} requested image reference${missingReferences.length===1?" is":"s are"} unavailable.`,action:"review_references",blockIds:missingReferences}:{id:"reference-availability",label:"Reference pixels",status:"pass",severity:"info",summary:"Requested reference inputs are available or context-only.",action:"none"});
  const previousSafety=previous?.documentRevision===documentRevision&&(previous.productionMode??"manual")===productionMode&&(!hasWorkflow||previous.requestKey===requestKey)&&Date.parse(previous.expiresAt)>Date.now()?previous.probes.find((probe)=>probe.id==="context-safety"):null;
  if(previousSafety)add({...previousSafety,summary:`${previousSafety.summary} Reused for the same document revision; the exact prompt and selected pixels will still be checked before image work.`});
  else if(env.OPENAI_API_KEY&&!statusBlocksProvider(provider)&&remaining>=estimatedTokens)try{
    const moderation=await moderateGenerationSnapshot(env,snapshot);
    add(moderation.flagged?{id:"context-safety",label:"Context safety review",status:"warning",severity:"warning",summary:`Likely moderation concern${moderation.categories.length?`: ${moderation.categories.join(", ")}`:""}. Review the named context before sending it to the image workflow.`,action:"review_blocks",blockIds:moderation.blockIds,categories:moderation.categories}:{id:"context-safety",label:"Context safety review",status:"pass",severity:"info",summary:`Text context passed an advisory ${moderation.model} review in ${moderation.latencyMs}ms. Exact prompt and selected reference pixels will be checked again before image generation.`,action:"none"});
  }catch(error){const detail=classifyProviderFailure(error);const observed=await observeProviderFailure(env,detail);if(observed){provider=observed;add({id:"context-safety",label:"Context safety review",status:statusBlocksProvider(observed)?"fail":"unknown",severity:statusBlocksProvider(observed)?"blocking":"warning",summary:observed.message,action:statusBlocksProvider(observed)?"refresh_provider":"none"});}else add({id:"context-safety",label:"Context safety review",status:"unknown",severity:"warning",summary:"The advisory safety probe was unavailable. Generation can continue only after acknowledging that the request was not pre-screened.",action:"review_prompt"});}
  const blocked=probes.some((probe)=>probe.status==="fail"&&probe.severity==="blocking");const review=!blocked&&probes.some((probe)=>probe.status==="warning"||probe.status==="unknown");const status=blocked?"blocked":review?"review":"ready";const summary=blocked?probes.find((probe)=>probe.status==="fail"&&probe.severity==="blocking")?.summary??"Generation is blocked.":review?"Review the highlighted context before generation.":"Ready for generation.";
  const canvas=baseSnapshot.canvas&&typeof baseSnapshot.canvas==="object"?baseSnapshot.canvas as Record<string,unknown>:{};
  const sourceContextHead=events.filter((event)=>CONTEXT_MUTATION_TYPES.includes(event.type as typeof CONTEXT_MUTATION_TYPES[number])).reduce((head,event)=>Math.max(head,event.sequence),0);
  const result:GenerationReadiness={preflightId,requestKey,documentId:projection.documentId,documentRevision,sourceContextHead,...(canvas.canvas_id?{canvasId:String(canvas.canvas_id),contextSetId:String(canvas.context_set_id??"")}:{}),kind:input.kind,productionMode,promptTechnique:technique,status,summary,probes,provider,estimatedTokens,estimatedCostMicrousd:generationReadinessCostMicrousd(input.kind),estimatedSeconds:generationReadinessSeconds(input.kind),requiresAcknowledgement:review,checkedAt,expiresAt,cached:false,version:GENERATION_PREFLIGHT_VERSION};
  await env.DB.prepare("INSERT INTO generation_preflights (preflight_id,owner_id,stream_id,document_id,request_key,status,result_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,request_key) DO UPDATE SET preflight_id=excluded.preflight_id,status=excluded.status,result_json=excluded.result_json,created_at=excluded.created_at,expires_at=excluded.expires_at").bind(preflightId,user.userId,user.streamId,projection.documentId,cacheKey,status,JSON.stringify(result),checkedAt,expiresAt).run();
  if(options.appendEvents!==false){await appendAuditEvent(env,user.streamId,"worker:policy","GenerationPreflightCompleted",{preflight_id:preflightId,document_id:projection.documentId,document_revision:documentRevision,request_key:requestKey,kind:input.kind,prompt_technique:technique,status,probe_results:probes.map((probe)=>({id:probe.id,status:probe.status,severity:probe.severity,block_ids:probe.blockIds??[],reference_ids:probe.referenceIds??[],categories:probe.categories??[]})),estimated_tokens:estimatedTokens,estimated_cost_microusd:result.estimatedCostMicrousd,estimated_seconds:result.estimatedSeconds,provider_status:provider.status,expires_at:expiresAt,preflight_version:GENERATION_PREFLIGHT_VERSION});if(previous&&previous.documentRevision!==documentRevision&&previous.status!=="ready"&&status!=="blocked")await appendAuditEvent(env,user.streamId,"worker:policy","GenerationRemediationApplied",{preflight_id:preflightId,previous_preflight_id:previous.preflightId,document_id:projection.documentId,previous_document_revision:previous.documentRevision,document_revision:documentRevision,previous_status:previous.status,status,changed_probes:previous.probes.filter((probe)=>probe.status!=="pass").map((probe)=>probe.id),source_surface:input.sourceSurface??"generation-controls",result:"readiness-improved-after-document-change",preflight_version:GENERATION_PREFLIGHT_VERSION});}
  return result;
}

export async function handleGenerationReadiness(request:Request,env:WorkerEnv,path=""){
  await ensureSchema(env);
  const scoped=/(?:^|;\s*)forma_project_context=/.test(request.headers.get("cookie")??"");
  const auth=await requireUser(request,env,scoped?"viewer":request.method==="GET"?"viewer":"creator",scoped?{account:"principal"}:{});
  if(auth.response||!auth.user)return auth.response!;
  const principal=auth.user,selected=scoped?await readProjectRequestContext(request,env,principal):{context:null,response:null};
  if(selected.response)return selected.response;
  const project=selected.context;
  if(project&&(path||!hasCapability(principal,"project.output.request",{organizationId:project.organizationId,projectAccessId:project.projectAccessId})))return Response.json({error:"project_operation_unavailable"},{status:403});
  const user:PilotUser=project?{...principal,streamId:`creative:${project.ownerUserId}`,projectExecution:{organizationId:project.organizationId,projectAccessId:project.projectAccessId,projectId:project.projectId,ownerUserId:project.ownerUserId,actorUserId:principal.userId}}:principal;
  if(path==="provider/refresh"&&request.method==="POST"){const consent=requireConsent(user);if(consent)return consent;const cleared=emptyProvider("Provider status was cleared for a fresh readiness check. Credit availability will be confirmed by the next billable image request.");await writeProviderHealth(env,cleared);await appendAuditEvent(env,user.streamId,"worker:policy","ProviderHealthObserved",{status:cleared.status,scope:cleared.scope,source:"manual-refresh",observed_at:cleared.observedAt,expires_at:cleared.expiresAt});return Response.json({provider:cleared});}
  if(path==="prompt-techniques"&&request.method==="POST"){
    const consent=requireConsent(user);if(consent)return consent;
    const input=await request.json() as PromptTechniqueComparisonInput;
    if(!input.documentId||input.failedPrompt&&input.failedPrompt.length>32_000)return Response.json({error:"prompt_technique_comparison_input_required"},{status:400});
    try{return Response.json({comparison:await comparePromptTechniqueSafety(env,user,input)});}catch(error){const detail=classifyProviderFailure(error);return Response.json({error:detail.code,message:detail.message},{status:detail.httpStatus??500});}
  }
  if(path||request.method!=="POST")return new Response("Method not allowed",{status:405});const consent=requireConsent(user);if(consent)return consent;const input=await request.json() as GenerationPreflightInput;if(!["preview","generate","preview_fan","generate_fan"].includes(input.kind)||!input.documentId)return Response.json({error:"generation_preflight_input_required"},{status:400});
  try{
    const sourceEvents=project?await readProjectSourceEvents(env,project):undefined;
    if(project){const projection=foldEvents(sourceEvents??[],Number.POSITIVE_INFINITY,input.documentId,project.projectId);if(!projection.documents.some((document)=>document.id===input.documentId&&document.projectId===project.projectId))return Response.json({error:"document_not_found"},{status:404});}
    return Response.json({readiness:await preflightGeneration(env,user,input,{appendEvents:true,allowCache:true,...(sourceEvents?{sourceEvents}:{})})},{headers:{"cache-control":"private, no-store"}});
  }catch(error){if(error instanceof ContextIntegrityError)return Response.json({error:error.code,message:error.message},{status:error.code==="document_not_found"?404:409});if(error instanceof ProductionWorkflowContextError)return Response.json({error:error.code,message:error.message},{status:error.status});const detail=classifyProviderFailure(error);return Response.json({error:detail.code,message:detail.message},{status:detail.httpStatus??500});}
}
