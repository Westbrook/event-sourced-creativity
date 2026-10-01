import { isMaintenanceDecisionId } from "../src/experiences/maintenance-adoption-contract.ts";
import { handleExperienceMaintenanceDeliveryTransition, handleExperienceDeliveryTransition, readExperienceReleaseJson } from "./experience-release-api.ts";
import { isExperienceDecisionId } from "../src/experiences/release-contract.ts";
import { createDeliveryWithReceipt } from "./product-delivery-create.ts";
import { APPLICATIONS } from "../src/platform/applications.ts";
import type { FormaCapability } from "../src/platform/capabilities.ts";
import { canonicalDeliveryStatus, deliveryNeedsCompleteDependencies, deliveryNeedsEvidence, deliveryNeedsReleaseAuthority, deliveryTransitionAllowed, type DeliveryDecisionStatus } from "../src/platform/delivery-lifecycle.ts";
import { IMAGE_ADAPTER_EVALUATION_PLAN, IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE, RETAINED_IMAGE_ADAPTER_EVALUATIONS } from "./image-adapter-evaluation-evidence.ts";
import { CANVAS_GOVERNANCE_REQUIREMENTS, CURRENT_CANVAS_ADAPTER_APPROVAL_SQL, currentCanvasAdapterApproval } from "./canvas-governance-policy.ts";
import { hasCapability, requireCapability, type PilotUser } from "./pilot-policy.ts";
import { appendAuditEvent, PHANTOM_ATTENTION_EVENT_SQL, uuidV7, type WorkerEnv } from "./runtime.ts";

type EvidenceState = "passed" | "pending" | "approval_required" | "blocked";
type Metric = { id: string; label: string; value: string | number | null; detail: string; values?: Record<string, string | number> };
type Evidence = { id: string; label: string; status: EvidenceState; detail: string; values?: Record<string, string | number> };
type DecisionRow = { decision_id: string; title: string; audience: string; status: string; owner_user_id:string; owner_display_name: string; evidence: string; dependency_ids_json: string; created_by_user_id?:string; created_at: string; updated_at: string };
const AUDIENCE_IDS = new Set<string>(APPLICATIONS.map((application) => application.id));
const privateHeaders = { "cache-control": "private, no-store" };
const approvedReleaseRequirementsSql = `SELECT COUNT(DISTINCT requirement_id) AS approved_count
  FROM canvas_governance_requirements
  WHERE requirement_id IN ('trust_safety','counsel','second_image_adapter')
    AND status='approved' AND json_valid(details_json)
    AND (${CURRENT_CANVAS_ADAPTER_APPROVAL_SQL})`;

function report(id: string, scope: string, metrics: Metric[], evidence: Evidence[], options: { synthetic?: boolean; decisions?: unknown[]; qualification?: unknown;owners?:unknown[];approvalAuthority?:boolean } = {}) {
  return Response.json({ report: { id, scope, refreshedAt: new Date().toISOString(), synthetic: options.synthetic ?? false, metrics: metrics.slice(0, 5), evidence, ...(options.decisions ? { decisions: options.decisions } : {}), ...(options.qualification ? { qualification: options.qualification } : {}),...(options.owners?{owners:options.owners}:{}),...(options.approvalAuthority!==undefined?{approvalAuthority:options.approvalAuthority}:{}) } }, { headers: privateHeaders });
}

function requiredFor(area: string, view: string): FormaCapability[] {
  if (area === "operations" && view === "overview") return ["platform.policy.manage", "platform.incident.manage"];
  if (area === "operations" && view === "providers") return ["platform.provider.configure"];
  if (area === "product" && view === "insights") return ["product.analytics.read"];
  if (area === "product" && view === "delivery") return ["product.delivery.read", "product.delivery.manage","product.release.read"];
  if (area === "product" && view === "evaluation") return ["evaluation.synthetic.read", "evaluation.synthetic.run", "evaluation.qualification.read", "evaluation.qualification.run"];
  if (area === "engineering" && view === "events") return ["engineering.events.read"];
  if (area === "engineering" && view === "sync") return ["engineering.sync.read"];
  if (area === "engineering" && (view === "health" || view === "jobs")) return ["engineering.diagnostics.read"];
  return [];
}

function safeDecision(row: DecisionRow,includeOwnerId=false) {
  let dependencies: string[] = [];
  try { const parsed: unknown = JSON.parse(row.dependency_ids_json); if (Array.isArray(parsed)) dependencies = parsed.filter((value): value is string => typeof value === "string").slice(0, 10); } catch { /* Historical corrupt metadata fails closed. */ }
  return { decisionId: row.decision_id, title: row.title, audience: row.audience, status: canonicalDeliveryStatus(row.status)??"planned", owner: row.owner_display_name,...(includeOwnerId?{ownerUserId:row.owner_user_id}:{}), evidence: row.evidence, dependencyIds: dependencies, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function eligibleDeliveryOwner(env:WorkerEnv,userId:string){
  return env.DB.prepare(`SELECT users.user_id,users.display_name FROM users WHERE users.user_id=? AND (users.role='admin' OR EXISTS(
    SELECT 1 FROM capability_grants grant_row WHERE grant_row.user_id=users.user_id AND grant_row.capability='product.delivery.manage'
      AND grant_row.scope_type='platform' AND grant_row.status='active' AND grant_row.revoked_at IS NULL AND (grant_row.expires_at IS NULL OR grant_row.expires_at>?)
  ))`).bind(userId,new Date().toISOString()).first<{user_id:string;display_name:string}>();
}

async function validateDeliveryState(env:WorkerEnv,actor:PilotUser,status:DeliveryDecisionStatus,evidence:string,dependencies:string[]){
  if(deliveryNeedsEvidence(status)&&!evidence)return Response.json({error:"delivery_evidence_required"},{status:409});
  if(deliveryNeedsReleaseAuthority(status)&&!hasCapability(actor,"platform.release.approve"))return Response.json({error:"release_approval_required"},{status:403});
  if(deliveryNeedsCompleteDependencies(status)&&dependencies.length){
    const rows=await env.DB.prepare(`SELECT decision_id,status FROM delivery_decisions WHERE decision_id IN(${dependencies.map(()=>"?").join(",")})`).bind(...dependencies).all<{decision_id:string;status:string}>();
    if(rows.results.length!==dependencies.length||rows.results.some((row)=>!["passed","approved"].includes(canonicalDeliveryStatus(row.status)??"")))return Response.json({error:"delivery_dependencies_incomplete"},{status:409});
  }
  return null;
}

async function mutateDelivery(request: Request, env: WorkerEnv, actor: PilotUser) {
  if (!hasCapability(actor, "product.delivery.manage")) return Response.json({ error: "access_denied" }, { status: 403, headers: privateHeaders });
  let body: Record<string, unknown>;
  try { body = await readExperienceReleaseJson(request) as Record<string, unknown>; } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "experience_release_request_limit" ? error.message : "invalid_delivery_decision" },
      { status: error instanceof Error && error.message === "experience_release_request_limit" ? 413 : 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "invalid_delivery_decision" }, { status: 400 });
  // This namespace is never a legacy milestone, even when its binding is missing or damaged.
  if (request.method === "PATCH" && isMaintenanceDecisionId(typeof body.decisionId === "string" ? body.decisionId.trim() : body.decisionId)) return handleExperienceMaintenanceDeliveryTransition(request, env, actor, body);
  if (request.method === "PATCH" && isExperienceDecisionId(typeof body.decisionId === "string" ? body.decisionId.trim() : body.decisionId)) return handleExperienceDeliveryTransition(request, env, actor, body);
  const refuseCreate = (error: string, status: number) => Response.json({ error,
    ...(request.method === "POST" && Object.hasOwn(body, "requestId") ? { createDisposition: "rejected_before_write" } : {}) }, { status });
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const evidence = typeof body.evidence === "string" ? body.evidence.trim() : "";
  const status=canonicalDeliveryStatus(body.status??"planned");
  if(!title||title.length>160||evidence.length>800||!status)return refuseCreate("invalid_delivery_decision",400);

  if (request.method === "POST") {
    if("owner" in body)return refuseCreate("immutable_delivery_decision_fields",400);
    if(!["planned","running","failed"].includes(status))return refuseCreate("invalid_initial_delivery_status",409);
    const audience = typeof body.audience === "string" ? body.audience : "";
    const dependencies = Array.isArray(body.dependencyIds) ? body.dependencyIds : [];
    if (!AUDIENCE_IDS.has(audience) || dependencies.length > 10 || dependencies.some((dependency) => typeof dependency !== "string" || !dependency.trim()) || new Set(dependencies).size !== dependencies.length) return refuseCreate("invalid_delivery_dependencies",400);
    if (Object.hasOwn(body, "requestId")) {
      const ownerUserId = typeof body.ownerUserId === "string" && body.ownerUserId.trim() ? body.ownerUserId.trim() : actor.userId;
      return createDeliveryWithReceipt(request, env, actor, body.requestId,
        { title, audience, status, ownerUserId, evidence, dependencyIds: dependencies as string[] }, async () => {
          if (dependencies.length) {
            const existing = await env.DB.prepare(`SELECT decision_id FROM delivery_decisions WHERE decision_id IN (${dependencies.map(() => "?").join(",")})`).bind(...dependencies).all<{ decision_id: string }>();
            if (existing.results.length !== dependencies.length) return Response.json({ error: "unknown_delivery_dependency" }, { status: 409 });
          }
          const invalid = await validateDeliveryState(env, actor, status, evidence, dependencies as string[]);
          if (invalid) return invalid;
          return await eligibleDeliveryOwner(env, ownerUserId) ?? Response.json({ error: "eligible_delivery_owner_required" }, { status: 403 });
        });
    }
    if (dependencies.length) {
      const existing = await env.DB.prepare(`SELECT decision_id FROM delivery_decisions WHERE decision_id IN (${dependencies.map(() => "?").join(",")})`).bind(...dependencies).all<{ decision_id: string }>();
      if (existing.results.length !== dependencies.length) return Response.json({ error: "unknown_delivery_dependency" }, { status: 409 });
    }
    const invalid=await validateDeliveryState(env,actor,status,evidence,dependencies as string[]);if(invalid)return invalid;
    const requestedOwner=typeof body.ownerUserId==="string"&&body.ownerUserId.trim()?body.ownerUserId.trim():actor.userId;
    const owner=await eligibleDeliveryOwner(env,requestedOwner);
    if(!owner)return Response.json({error:"eligible_delivery_owner_required"},{status:403});
    const decisionId = uuidV7(); const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO delivery_decisions (decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(decisionId,title,audience,status,owner.user_id,owner.display_name,evidence,JSON.stringify(dependencies),actor.userId,now,now).run();
    await appendAuditEvent(env,"platform:product-delivery","user","ProductDeliveryDecisionCreated",{decision_id:decisionId,actor_user_id:actor.userId,owner_user_id:owner.user_id,audience,status,dependency_count:dependencies.length});
    return Response.json({decision:{decisionId,title,audience,status,owner:owner.display_name,ownerUserId:owner.user_id,evidence,dependencyIds:dependencies,createdAt:now,updatedAt:now}},{status:201,headers:privateHeaders});
  }

  const decisionId = typeof body.decisionId === "string" ? body.decisionId.trim() : "";
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "";
  if (!decisionId || !expectedUpdatedAt || "dependencyIds" in body || "audience" in body || "owner" in body) return Response.json({ error: "immutable_delivery_decision_fields" }, { status: 400 });
  const previousMs = Date.parse(expectedUpdatedAt);
  if (!Number.isFinite(previousMs)) return Response.json({ error: "invalid_delivery_revision" }, { status: 400 });
  const previous=await env.DB.prepare("SELECT decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_by_user_id,created_at,updated_at FROM delivery_decisions WHERE decision_id=?").bind(decisionId).first<DecisionRow>();
  if(!previous||previous.updated_at!==expectedUpdatedAt)return Response.json({error:"delivery_decision_revision_conflict"},{status:409,headers:privateHeaders});
  if(["approved","revoked"].includes(canonicalDeliveryStatus(previous.status)??"")&&!hasCapability(actor,"platform.release.approve"))return Response.json({error:"release_approval_required"},{status:403,headers:privateHeaders});
  if(!deliveryTransitionAllowed(previous.status,status))return Response.json({error:"invalid_delivery_status_transition"},{status:409});
  const dependencies=safeDecision(previous).dependencyIds;
  const invalid=await validateDeliveryState(env,actor,status,evidence,dependencies);if(invalid)return invalid;
  const requestedOwner=typeof body.ownerUserId==="string"&&body.ownerUserId.trim()?body.ownerUserId.trim():previous.owner_user_id;
  if(status==="approved"&&[previous.created_by_user_id,previous.owner_user_id,requestedOwner].includes(actor.userId))return Response.json({error:"independent_release_approver_required"},{status:403,headers:privateHeaders});
  const owner=await eligibleDeliveryOwner(env,requestedOwner);
  if(!owner)return Response.json({error:"eligible_delivery_owner_required"},{status:403});
  const now = new Date(Math.max(Date.now(), previousMs + 1)).toISOString();
  const result = await env.DB.prepare("UPDATE delivery_decisions SET title=?,status=?,evidence=?,owner_user_id=?,owner_display_name=?,updated_at=? WHERE decision_id=? AND updated_at=?")
    .bind(title,status,evidence,owner.user_id,owner.display_name,now,decisionId,expectedUpdatedAt).run();
  if (Number(result.meta.changes ?? 0) !== 1) return Response.json({ error: "delivery_decision_revision_conflict" }, { status: 409, headers: privateHeaders });
  await appendAuditEvent(env,"platform:product-delivery","user","ProductDeliveryDecisionUpdated",{decision_id:decisionId,actor_user_id:actor.userId,previous_status:canonicalDeliveryStatus(previous.status),status,previous_owner_user_id:previous.owner_user_id,owner_user_id:owner.user_id});
  // The audit await can overlap another update. Acknowledge this successful
  // write's revision; a later report remains the source of current state.
  const row:DecisionRow={...previous,title,status,evidence,owner_user_id:owner.user_id,
    owner_display_name:owner.display_name,updated_at:now};
  return Response.json({decision:safeDecision(row,true)},{headers:privateHeaders});
}

export async function handlePortfolio(request: Request, env: WorkerEnv, area: string, view: string): Promise<Response> {
  const required = requiredFor(area, view);
  if (!required.length) return Response.json({ error: "not_found" }, { status: 404 });
  const mutating = area === "product" && view === "delivery" && ["POST", "PATCH"].includes(request.method);
  if (request.method !== "GET" && !mutating) return new Response("Method not allowed", { status: 405 });
  const authorization = await requireCapability(request, env, mutating ? "product.delivery.manage" : required);
  if (authorization.response || !authorization.user) return authorization.response!;
  if (mutating) return mutateDelivery(request, env, authorization.user);

  if (area === "product" && view === "insights") {
    const totals=await env.DB.prepare(`WITH attributed AS MATERIALIZED (
      SELECT event.event_id,event.stream_id,event.type,event.payload,event.occurred_at,event.actor,users.user_id AS owner_user_id,
        CASE WHEN event.actor GLOB 'user:*' THEN substr(event.actor,6)
          ELSE COALESCE((SELECT resource.actor_user_id FROM document_jobs job JOIN project_resource_scopes resource
            ON resource.resource_kind='job' AND resource.resource_id=job.job_id AND resource.actor_user_id=job.owner_id
            AND resource.owner_user_id=users.user_id WHERE job.stream_id=event.stream_id AND job.correlation_id=event.correlation_id LIMIT 1),users.user_id) END AS contributor_id
      FROM events event JOIN users ON users.user_id=substr(event.stream_id,10)
      WHERE event.stream_id GLOB 'creative:*' AND event.type IN('GenerationCompleted','DocumentRenderCompleted','BlockCreated','ContextCompiled','GenerationFailed','DocumentRenderFailed','GenerationUsageRecorded','AttentionEpisodeObserved','ObjectSaved','ObjectPinned','ObjectExported','AddedToLibrary','PromptFanOutputPromoted','DocumentArtifactExported')
        AND event.occurred_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-120 days') AND event.client_id NOT LIKE 'seed:%'
        AND COALESCE(json_extract(event.payload,'$.simulation'),0)=0 AND COALESCE(json_extract(event.payload,'$.synthetic'),0)=0
        AND COALESCE(json_extract(event.payload,'$.origin.synthetic'),0)=0 AND COALESCE(json_extract(event.payload,'$.mock_data_source'),'')!='openai-provider'
        AND event.stream_id NOT IN(SELECT fictional_stream_id FROM replay_personas)
        AND(event.type!='AttentionEpisodeObserved' OR(event.occurred_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')
          AND COALESCE(json_extract(event.payload,'$.expires_at'),'')>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND NOT (${PHANTOM_ATTENTION_EVENT_SQL})
          AND NOT EXISTS(SELECT 1 FROM events forgotten WHERE forgotten.stream_id=event.stream_id AND forgotten.type='AttentionSignalsForgotten' AND forgotten.sequence>=event.sequence)))
    ), eligible AS MATERIALIZED (
      SELECT attributed.* FROM attributed JOIN users contributor ON contributor.user_id=attributed.contributor_id
      WHERE(attributed.actor NOT GLOB 'user:*' OR attributed.contributor_id=attributed.owner_user_id OR EXISTS(
        SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=attributed.event_id AND scope.owner_user_id=attributed.owner_user_id
          AND scope.source_stream_id=attributed.stream_id AND scope.actor_user_id=attributed.contributor_id))
        AND attributed.contributor_id NOT IN(SELECT fictional_user_id FROM replay_personas)
    ), outcomes AS (
      SELECT completion.stream_id,completion.occurred_at,json_extract(completion.payload,'$.document_id') AS document_id,CAST(objects.value AS TEXT) AS outcome_id
        FROM eligible completion JOIN json_each(completion.payload,'$.object_ids') objects WHERE completion.type='GenerationCompleted'
      UNION ALL
      SELECT completion.stream_id,completion.occurred_at,json_extract(completion.payload,'$.document_id') AS document_id,CAST(json_extract(completion.payload,'$.artifact_id') AS TEXT) AS outcome_id
        FROM eligible completion WHERE completion.type='DocumentRenderCompleted' AND json_extract(completion.payload,'$.artifact_id') IS NOT NULL
    ), retention AS (
      SELECT retained.stream_id,retained.contributor_id,CAST(COALESCE(json_extract(retained.payload,'$.object_id'),json_extract(retained.payload,'$.artifact_id'),json_extract(retained.payload,'$.source_output_id')) AS TEXT) AS outcome_id,MIN(retained.occurred_at) AS retained_at
      FROM eligible retained WHERE retained.type IN('ObjectSaved','ObjectPinned','ObjectExported','AddedToLibrary','PromptFanOutputPromoted','DocumentArtifactExported')
        AND(retained.actor='user' OR retained.actor='user:'||retained.contributor_id)
        AND COALESCE(json_extract(retained.payload,'$.object_id'),json_extract(retained.payload,'$.artifact_id'),json_extract(retained.payload,'$.source_output_id')) IS NOT NULL
      GROUP BY retained.stream_id,retained.contributor_id,outcome_id
    ), ranked_outcomes AS (
      SELECT outcomes.stream_id,outcomes.outcome_id,retention.contributor_id,retention.retained_at,
        ROW_NUMBER() OVER(PARTITION BY outcomes.stream_id,outcomes.outcome_id ORDER BY retention.retained_at,retention.contributor_id) AS attribution_rank
      FROM outcomes JOIN retention ON retention.stream_id=outcomes.stream_id AND retention.outcome_id=outcomes.outcome_id AND retention.retained_at>=outcomes.occurred_at
      WHERE NOT EXISTS(SELECT 1 FROM events removed WHERE removed.stream_id=outcomes.stream_id AND removed.type='DocumentRemoved'
        AND json_extract(removed.payload,'$.document_id')=outcomes.document_id AND removed.occurred_at>=outcomes.occurred_at)
        AND NOT EXISTS(SELECT 1 FROM events discarded WHERE discarded.stream_id=outcomes.stream_id AND discarded.type IN('ObjectDiscarded','RemovedFromLibrary')
          AND json_extract(discarded.payload,'$.object_id')=outcomes.outcome_id AND discarded.occurred_at>=retention.retained_at)
    ), retained_outcomes AS (
      SELECT stream_id,outcome_id,contributor_id,retained_at FROM ranked_outcomes WHERE attribution_rank=1
    ), retained_counts AS (
      SELECT contributor_id,SUM(CASE WHEN retained_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') THEN 1 ELSE 0 END) AS retained,MIN(retained_at) AS first_outcome
      FROM retained_outcomes GROUP BY contributor_id
    ), activity AS (
      SELECT contributor_id,
        MAX(CASE WHEN occurred_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') THEN 1 ELSE 0 END) AS active_recent,
        SUM(CASE WHEN type='GenerationUsageRecorded' AND occurred_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') THEN COALESCE(CAST(json_extract(payload,'$.cost_microusd') AS INTEGER),0) ELSE 0 END) AS settled,
        SUM(CASE WHEN(type IN('GenerationFailed','DocumentRenderFailed') OR(type='AttentionEpisodeObserved' AND COALESCE(CAST(json_extract(payload,'$.friction_score') AS REAL),0)>=.45))
          AND occurred_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days') THEN 1 ELSE 0 END) AS friction,
        COUNT(DISTINCT CASE WHEN occurred_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') THEN substr(occurred_at,1,10) END) AS observed_days
      FROM eligible GROUP BY contributor_id
    ), reuse AS (
      SELECT contributor_id,COUNT(*) AS reused_blocks FROM(
        SELECT eligible.contributor_id,json_extract(block.value,'$.block_id') AS block_id,COUNT(*) AS uses
        FROM eligible JOIN json_each(eligible.payload,'$.source_block_versions') block
        WHERE eligible.type='ContextCompiled' AND eligible.occurred_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')
        GROUP BY eligible.contributor_id,json_extract(block.value,'$.block_id') HAVING block_id IS NOT NULL AND COUNT(*)>1
      ) GROUP BY contributor_id
    ) SELECT
      COALESCE(SUM(CASE WHEN active_recent=1 THEN 1 ELSE 0 END),0) AS active_accounts,
      COALESCE(SUM(CASE WHEN active_recent=1 AND COALESCE(retained_counts.retained,0)>0 THEN 1 ELSE 0 END),0) AS activated_accounts,
      COALESCE(SUM(CASE WHEN active_recent=1 THEN COALESCE(retained_counts.retained,0) ELSE 0 END),0) AS retained_outcomes,
      COALESCE(SUM(CASE WHEN active_recent=1 THEN settled ELSE 0 END),0) AS settled_microusd,
      COALESCE(SUM(CASE WHEN active_recent=1 AND COALESCE(reuse.reused_blocks,0)>0 THEN 1 ELSE 0 END),0) AS reuse_accounts,
      COALESCE(SUM(CASE WHEN active_recent=1 AND friction>0 THEN 1 ELSE 0 END),0) AS friction_accounts,
      COALESCE(SUM(CASE WHEN active_recent=1 THEN friction ELSE 0 END),0) AS friction_events,
      COALESCE(SUM(CASE WHEN active_recent=1 AND observed_days>=2 THEN 1 ELSE 0 END),0) AS returning_accounts,
      COALESCE(SUM(CASE WHEN retained_counts.first_outcome<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') THEN 1 ELSE 0 END),0) AS mature_30,
      COALESCE(SUM(CASE WHEN retained_counts.first_outcome<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days') THEN 1 ELSE 0 END),0) AS mature_60,
      COALESCE(SUM(CASE WHEN retained_counts.first_outcome<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days') THEN 1 ELSE 0 END),0) AS mature_90
      FROM activity LEFT JOIN reuse ON reuse.contributor_id=activity.contributor_id LEFT JOIN retained_counts ON retained_counts.contributor_id=activity.contributor_id`).first<Record<string,number>>();
    const creators=Number(totals?.active_accounts??0),activated=Number(totals?.activated_accounts??0),retained=Number(totals?.retained_outcomes??0),reused=Number(totals?.reuse_accounts??0),sufficient=creators>=3;
    const mature=(days:30|60|90)=>{const count=Number(totals?.[`mature_${days}`]??0);return{id:`longitudinal${days}`,label:`${days}-day outcome observation`,status:count>=3?"passed" as const:"pending" as const,detail:count>=3?`At least three real creators have genuinely reached the ${days}-day observation horizon.`:`No ${days}-day outcome is asserted before at least three real creators have reached that horizon.`};};
    const friction=Number(totals?.friction_accounts??0),returning=Number(totals?.returning_accounts??0);
    return report("insights", "Anonymous platform-wide product cohort; fictional accounts excluded", [
      { id: "activeCreators", label: "Active creators", value: sufficient ? creators : null, detail: sufficient ? "Distinct real creator accounts active in the past 30 days" : "Suppressed: fewer than three real creators" },
      { id: "activationRate", label: "Creator activation", value: sufficient&&activated>=3?`${Math.round(activated/creators*100)}%`:null, detail: "Real creators with at least one retained outcome; cohorts below three are suppressed" },
      { id: "retainedOutcomes", label: "Retained creative outcomes", value: sufficient&&activated>=3?retained:null, detail: "Available completed results explicitly saved, pinned, exported, promoted, or kept by their creator" },
      { id: "contextReuseRate", label: "Context reuse", value: sufficient&&reused>=3?`${Math.round(reused/creators*100)}%`:null, detail: "Creators reusing an actual context block in multiple real compilations" },
      { id: "costPerRetainedOutcome", label: "Cost per retained outcome", value: sufficient&&activated>=3&&retained?`$${(Number(totals?.settled_microusd??0)/retained/1_000_000).toFixed(2)}`:null, detail: "Settled provider cost divided only by still-retained creative outcomes" },
    ], [
      { id: "customerPrivacy", label: "Customer identity and content", status: "passed", detail: "Identity, creator material, event payloads, and private media never leave this projection." },
      { id: "minimumCohort", label: "Minimum cohort protection", status: sufficient ? "passed" : "blocked", detail: "Measures remain hidden until at least three real creator accounts are active." },
      { id:"recentFriction",label:"Recent creator friction",status:friction>=3?"passed":"pending",detail:friction>=3?"Recent recoverable failures and unforgotten, short-retention attention signals are measured without identifying creators.":"Friction remains private until at least three real creators contribute eligible signals." },
      { id:"returnRetention",label:"Returning creator behavior",status:returning>=3?"passed":"pending",detail:returning>=3?"At least three real creators returned on multiple genuinely observed days.":"Returning behavior remains pending until at least three real creators return on different days." },
      mature(30),mature(60),mature(90),
    ]);
  }

  if (area === "product" && view === "delivery") {
    const canManage=hasCapability(authorization.user,"product.delivery.manage");
    const readsDecisions=canManage||hasCapability(authorization.user,"product.delivery.read");
    const statements=[
      env.DB.prepare("SELECT decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_at,updated_at FROM delivery_decisions ORDER BY updated_at DESC LIMIT 100"),
      env.DB.prepare(approvedReleaseRequirementsSql),
      env.DB.prepare("SELECT status,COUNT(*) AS count FROM delivery_decisions GROUP BY status"),
    ];
    if(canManage)statements.push(env.DB.prepare(`SELECT users.user_id,users.display_name FROM users WHERE users.role='admin' OR EXISTS(
      SELECT 1 FROM capability_grants grant_row WHERE grant_row.user_id=users.user_id AND grant_row.capability='product.delivery.manage' AND grant_row.scope_type='platform'
      AND grant_row.status='active' AND grant_row.revoked_at IS NULL AND (grant_row.expires_at IS NULL OR grant_row.expires_at>?)) ORDER BY users.display_name LIMIT 50`).bind(new Date().toISOString()));
    const results=await env.DB.batch<Record<string,unknown>>(statements);
    const decisions=readsDecisions?(results[0]?.results??[]).map((row)=>safeDecision(row as DecisionRow,canManage)):[];
    const releaseOpen = Math.max(0, CANVAS_GOVERNANCE_REQUIREMENTS.length - Number(results[1]?.results[0]?.approved_count ?? 0));
    const byStatus=(...statuses:string[])=>Number((results[2]?.results??[]).filter((entry)=>statuses.includes(String(entry.status))).reduce((sum,entry)=>sum+Number(entry.count??0),0));
    return report("delivery", "Durable internal delivery decisions; no creator content", [
      { id: "plannedDecisions", label: "Planned decisions", value: byStatus("planned"), detail: "Persisted milestones awaiting work" },
      { id: "activeDecisions", label: "Active decisions", value: byStatus("active","running"), detail: "Owned milestones currently in progress" },
      { id: "blockedDecisions", label: "Blocked decisions", value: byStatus("blocked","failed","revoked"), detail: "Owned milestones requiring intervention" },
      { id: "completedDecisions", label: "Completed decisions", value: byStatus("completed","passed","approved"), detail: "Milestones explicitly marked complete" },
      { id: "openReleaseGates", label: "Open release decisions", value: releaseOpen, detail: "Release controls requiring separate approval" },
    ], [
      { id: "decisionOwnership", label: "Named ownership and dependencies", status: (results[2]?.results??[]).some((entry)=>Number(entry.count??0)>0) ? "passed" : "pending", detail: "Every real decision records its owner, audience, immutable dependencies, and current evidence." },
      { id: "humanApproval", label: "Human stakeholder sign-off", status: "approval_required", detail: "Product, design, security, and customer approvals remain explicit human decisions." },
      { id: "longitudinalStudy", label: "Post-release observation", status: "pending", detail: "Customer outcome measurement requires real elapsed observation." },
    ],{...(readsDecisions?{decisions}:{}),...(canManage?{owners:(results[3]?.results??[]).map((row)=>({userId:String(row.user_id),displayName:String(row.display_name)})),approvalAuthority:hasCapability(authorization.user,"platform.release.approve")}:{})});
  }

  if (area === "product" && view === "evaluation") {
    const qualified = hasCapability(authorization.user, "evaluation.qualification.read");
    const latest = IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE;
    let approved = false;
    if (qualified) {
      const row = await env.DB.prepare("SELECT status,evidence_ref,details_json FROM canvas_governance_requirements WHERE requirement_id='second_image_adapter'").first<{ status: string; evidence_ref: string | null; details_json: string }>();
      try { const details = JSON.parse(row?.details_json ?? "{}"); approved = row?.status === "approved" && currentCanvasAdapterApproval(row.evidence_ref,details); } catch { approved = false; }
    }
    const qualification = qualified ? {
      corpusVersion: IMAGE_ADAPTER_EVALUATION_PLAN.corpusVersion,
      corpusHash: latest.corpusHash,
      caseCount: IMAGE_ADAPTER_EVALUATION_PLAN.caseCount,
      adapterVersion: latest.adapterVersion,
      passed: latest.passed,
      productionApproved: approved,
      reports: RETAINED_IMAGE_ADAPTER_EVALUATIONS.map((item) => ({ corpusVersion: item.corpusVersion, evaluationRef: item.evaluationRef, adapterVersion: item.adapterVersion, status: item.status, passed: item.passed, caseCount: item.caseCount, evaluatedPairs: item.evaluatedPairs, candidateUsable: item.fal.usable, referenceUsable: item.reference.falUsable, referenceEvaluated: item.reference.evaluated, finding: item.finding })),
    } : undefined;
    return report("evaluation", "Frozen fictional-context qualification; historical provider evidence only", [
      { id: "frozenCases", label: "Frozen corpus cases", value: IMAGE_ADAPTER_EVALUATION_PLAN.caseCount, detail: IMAGE_ADAPTER_EVALUATION_PLAN.corpusVersion },
      { id: "retainedReports", label: "Retained qualification reports", value: qualified ? RETAINED_IMAGE_ADAPTER_EVALUATIONS.length : null, detail: "Immutable historical reports require qualification access" },
      { id: "usableCandidates", label: "Passing candidate results", value: qualified ? `${latest.fal.usable}/${latest.evaluatedPairs}` : null, detail: "Usable outputs from the retained passing qualification" },
      { id: "referenceResults", label: "Passing reference studies", value: qualified ? `${latest.reference.falUsable}/${latest.reference.evaluated}` : null, detail: "Historical reference cases meeting the frozen rubric" },
      { id: "livePaidRuns", label: "New paid runs", value: 0, detail: "This evidence view never starts a provider operation" },
    ], [
      { id: "frozenCorpus", label: "Frozen evaluation corpus", status: "passed", detail: "Historical qualification uses an immutable fictional-context corpus." },
      { id: "qualificationResult", label: "Qualification result", status: qualified && latest.passed ? "passed" : "pending", detail: "Passing qualification evidence does not activate a provider." },
      { id: "productionApproval", label: "Production activation", status: qualified && approved ? "passed" : "approval_required", detail: "Only a matching, separately authorized release approval enables production activation." },
    ], { synthetic: true, qualification });
  }

  if (area === "operations" && view === "providers") {
    const imageReady = Boolean(env.OPENAI_API_KEY), independentReady = Boolean(env.FAL_KEY), latest = IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE;
    return report("providers", "Approved provider configuration; secrets and customer work excluded", [
      { id: "configuredImageProviders", label: "Configured image providers", value: Number(imageReady) + Number(independentReady), detail: "Server-side provider credentials are never returned" },
      { id: "activeImageProvider", label: "Active image provider", value: env.FORMA_IMAGE_PROVIDER ?? "openai", detail: "Configured image-routing policy" },
      { id: "videoProviderReady", label: "Video provider readiness", value: imageReady&&independentReady ? "ready" : "unavailable", detail: "Availability only; provider credentials remain server-owned" },
      { id: "qualifiedCorpusCases", label: "Frozen qualification cases", value: latest.caseCount, detail: IMAGE_ADAPTER_EVALUATION_PLAN.corpusVersion },
    ], [
      { id: "providerSecretIsolation", label: "Provider secret isolation", status: "passed", detail: "Credential values, customer prompts, private media, and account budgets are never returned." },
      { id: "qualificationResult", label: "Qualification result", status: latest.passed ? "passed" : "blocked", detail: "Passing qualification evidence does not activate a provider." },
      { id: "paidExecution", label: "Paid execution", status: "blocked", detail: "Provider inspection never starts a billable operation or authorizes a release." },
    ]);
  }

  const includeEvents = area === "engineering" && (view === "events" || view === "sync");
  const statements = [
    env.DB.prepare("SELECT status,COUNT(*) AS count FROM document_jobs GROUP BY status"),
    env.DB.prepare(approvedReleaseRequirementsSql),
  ];
  if(includeEvents)statements.push(env.DB.prepare("SELECT COUNT(*) AS event_count,SUM(CASE WHEN type LIKE 'Canvas%' THEN 1 ELSE 0 END) AS canvas_events FROM events WHERE occurred_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')"));
  if(area==="operations"&&view==="overview")statements.push(env.DB.prepare("SELECT status,started_at,finished_at,error_code FROM retention_sweep_runs WHERE trigger_kind='scheduled' ORDER BY started_at DESC LIMIT 1"));
  if(area==="engineering"&&view==="health")statements.push(env.DB.prepare(`SELECT route_latency_ms,lcp_ms,inp_ms,cls_microunits FROM route_performance_samples
    WHERE audience IN('creative','canvas','product','operations','engineering')
      AND route_family IN('projects','creative-workspace','document','project-contents','studio','library','sessions','scout','memory','canvas-home','canvas-workspace','canvas-projects','canvas-library','canvas-proposals','product','operations','engineering')
      AND recorded_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') ORDER BY recorded_at DESC LIMIT 250`));
  const results = await env.DB.batch<Record<string, unknown>>(statements);
  const jobs = results[0]?.results ?? [], events = includeEvents ? results[2]?.results[0] ?? {} : {};
  const count = (status: string) => Number(jobs.find((row) => row.status === status)?.count ?? 0);
  const queued = count("queued"), running = count("running"), failed = count("failed"), complete = count("completed");
  const open = Math.max(0, CANVAS_GOVERNANCE_REQUIREMENTS.length - Number(results[1]?.results[0]?.approved_count ?? 0));
  const eventCount = Number(events.event_count ?? 0), canvasEvents = Number(events.canvas_events ?? 0);
  const measurements=area==="engineering"&&view==="health"?results[2]?.results??[]:[];
  const maintenance=area==="operations"&&view==="overview"?results[2]?.results[0]??null:null;
  const percentile=(key:string)=>{const values=measurements.map((row)=>row[key]).filter((value):value is number=>typeof value==="number"&&Number.isFinite(value)).sort((a,b)=>a-b);return values.length>=3?values[Math.max(0,Math.ceil(values.length*.75)-1)]??null:null;};
  const scopeId = area === "operations" ? "overview" : `engineering${view[0].toUpperCase()}${view.slice(1)}`;
  const metrics: Metric[] = view === "events" ? [
    { id: "observedEvents", label: "Recent events", value: eventCount, detail: "Aggregate events in the last 30 days; event payloads are excluded" },
    { id: "canvasEvents", label: "Canvas events", value: canvasEvents, detail: "Aggregate Canvas event count without account or project identity" },
    { id: "failedJobs", label: "Failed jobs", value: failed, detail: "Aggregate terminal job count" },
  ] : view === "sync" ? [
    { id: "canvasEvents", label: "Canvas events", value: canvasEvents, detail: "Account-isolated Canvas synchronization event count" },
    { id: "queuedJobs", label: "Queued jobs", value: queued, detail: "Aggregate durable work awaiting processing" },
    { id: "failedJobs", label: "Failed jobs", value: failed, detail: "Aggregate recoverable synchronization-related work" },
  ] : view==="health"?[
    {id:"routeLatencyP75",label:"Route readiness p75",value:percentile("route_latency_ms"),detail:"75th-percentile populated-route latency in milliseconds; at least three anonymous samples required"},
    {id:"largestPaintP75",label:"Largest paint p75",value:percentile("lcp_ms"),detail:"75th-percentile largest-contentful-paint in milliseconds; unsupported browsers omitted"},
    {id:"interactionP75",label:"Interaction latency p75",value:percentile("inp_ms"),detail:"75th-percentile interaction responsiveness in milliseconds; unsupported browsers omitted"},
    {id:"layoutShiftP75",label:"Layout shift p75",value:percentile("cls_microunits"),detail:"75th-percentile cumulative layout shift in millionths; no user or page identifiers retained"},
    {id:"openReleaseGates",label:"Open release decisions",value:open,detail:"Release-control counts only; approval identities remain private"},
  ]:[
    { id: "queuedJobs", label: "Queued jobs", value: queued, detail: "Aggregate durable work awaiting processing" },
    { id: "runningJobs", label: "Running jobs", value: running, detail: "Aggregate active execution leases" },
    { id: "completedJobs", label: "Completed jobs", value: complete, detail: "Aggregate completed execution count" },
    { id: "failedJobs", label: "Failed jobs", value: failed, detail: "Aggregate terminal job count" },
    { id: "openReleaseGates", label: "Open release decisions", value: open, detail: "Release-control counts only; approval identities remain private" },
  ];
  return report(scopeId, area === "operations" ? "Bounded platform governance; no creator or provider details" : "Redacted service operations; no customer content", metrics, [
    { id: "customerPrivacy", label: "Customer data minimization", status: "passed", detail: "Identity, creator material, event payloads, and private media never leave this projection." },
    { id: "paidExecution", label: "Paid execution authority", status: "blocked", detail: "Reporting never starts provider jobs, changes budgets, or authorizes a release." },
    { id:"fleetLatency",label:"Fleet latency percentiles",status:measurements.length>=3?"passed":"pending",detail:measurements.length>=3?"Measured from coarse anonymous route samples; no account, organization, project, URL, or user agent is stored.":"Latency measurement remains pending until at least three eligible anonymous route samples exist." },
    ...(area==="operations"&&view==="overview"?[
      {id:"scheduledRetention",label:"Scheduled retention execution",status:maintenance?.status==="failed"?"blocked" as const:"pending" as const,detail:maintenance?`Last observed local scheduled cleanup: ${String(maintenance.status)} at ${String(maintenance.started_at)}. Hosted cron delivery remains unconfigured.`:"No scheduled cleanup has been observed; hosted cron delivery remains unconfigured."},
      {id:"enterpriseIdentity",label:"Enterprise identity assurance",status:"pending" as const,detail:"Observed platform identities and organization allowlists are enforced; verified customer SSO, MFA, and external SCIM remain unavailable."},
      {id:"customerManagedKeys",label:"Customer-managed primary-storage keys",status:"pending" as const,detail:"Optional tenant-wrapped AES-GCM protects recovery snapshots only; primary D1/R2 encryption and external KMS ownership are not attested."},
      {id:"backupRecovery",label:"Verified isolated disaster recovery",status:"pending" as const,detail:"Encrypted local snapshots support integrity drills; external replication, isolated tenant restore, and contractual RPO/RTO remain unverified."},
      {id:"independentCompliance",label:"Independent compliance assurance",status:"pending" as const,detail:"Third-party SOC 2, ISO, penetration-testing, privacy-contract, and accessibility evidence has not been independently supplied."},
    ]:[]),
  ]);
}
