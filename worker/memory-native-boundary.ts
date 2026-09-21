import { semanticConsumerSchemaSnapshot,qualifySemanticConsumerBoundary } from './memory-consumer-boundary.ts';
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import { nativeStructuredOriginSchemaRead,qualifyNativeStructuredOriginSchema } from "./memory-native-origin-schema.ts";
import { nativeDocumentJobOriginSchemaRead,qualifyNativeDocumentJobOriginSchema } from "./memory-document-job-origin-schema.ts";

type AnswerAlias = "answer" | "authored" | "private_content" | "content";
type TurnAlias = "turn" | "prior" | "metadata";

function nativeMemorySchemaReads(db: WorkerEnv["DB"], turn?: TurnAlias) {
  return [
    nativeStructuredOriginSchemaRead(db), nativeDocumentJobOriginSchemaRead(db),
    db.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins') AS origins,"+semanticConsumerSchemaSnapshot+" AS consumer_schema"
      + (!turn ? ",EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='assistant_turns') AS turns" : "")),
  ];
}

/** One binding call, with both original triples and independent qualifications.
 * Fixed private-content aliases only; observations never come from a caller.
 * Each outcome preserves the storage boundary's optional-cleanup distinction.
 */
export async function nativePrivateContentMemoryExclusionPair(env: WorkerEnv) {
  const db = env.DB;
  const observations = structuredClone(await db.batch([
    ...nativeMemorySchemaReads(db), ...nativeMemorySchemaReads(db),
  ]));
  if (env.DB !== db) throw new Error("memory_boundary_database_changed");
  if (!Array.isArray(observations) || observations.length !== 6
    || [0, 1, 2, 3, 4, 5].some(index => !Object.hasOwn(observations, index)
      || observations[index]?.success !== true || (observations[index] as { error?: unknown }).error !== undefined)) {
    throw new Error("memory_boundary_schema_unavailable");
  }
  const qualified = await Promise.allSettled([
    qualifyNativeMemoryAnswerExclusion(env, db, "private_content", undefined, observations.slice(0, 3)),
    qualifyNativeMemoryAnswerExclusion(env, db, "private_content", undefined, observations.slice(3, 6)),
  ]);
  if (env.DB !== db) throw new Error("memory_boundary_database_changed");
  return qualified;
}

type CleanupRead = { db: WorkerEnv['DB']; result?: Promise<BudgetReservationGuard> };
const cleanupReads = new WeakMap<WorkerEnv, CleanupRead>();

/** An explicit execution-local environment for OPTIONAL expiry cleanup only.
 * This retains a SQL predicate, not a positive schema/access decision. Every
 * cleanup UPDATE rechecks the exact schema and current negative origin markers.
 * A schema change can only omit cleanup; it cannot authorize hydration or erase
 * newly registered memory. Ordinary callers and paired publication stay fresh.
 */
export function nativePrivateContentCleanupEnvironment(env: WorkerEnv): WorkerEnv {
  // Request identity is local, but live bindings/configuration must not become a
  // stale snapshot during a provider call. Local overrides remain isolated.
  const local: WorkerEnv = Object.create(env);
  cleanupReads.set(local, { db: env.DB });
  return local;
}
export async function nativePrivateContentCleanupExclusion(env: WorkerEnv): Promise<BudgetReservationGuard> {
  const local = cleanupReads.get(env);
  if (!local) return nativeMemoryAnswerExclusion(env, { answerAlias: 'private_content' });
  if (env.DB !== local.db) throw Error('memory_boundary_database_changed');
  local.result ??= nativeMemoryAnswerExclusion(env, { answerAlias: 'private_content' });
  const result = await local.result;
  if (env.DB !== local.db) throw Error('memory_boundary_database_changed');
  return structuredClone(result);
}

/** First governed content preparation may observe retention metadata beside
 * the request-local negative boundary. Only the exclusion SQL is reusable;
 * retention remains a fresh observation whose version is checked by INSERT. */
export async function readNativePrivateContentPreparation(env:WorkerEnv,organizationId:string) {
  const local=cleanupReads.get(env);
  if(!local||local.result)return null;
  const db=env.DB;if(db!==local.db)throw Error('memory_boundary_database_changed');
  const captured=db.batch<Record<string,unknown>>([...nativeMemorySchemaReads(db),
    db.prepare('SELECT transient_days,evidence_days,version FROM organization_retention_policies WHERE organization_id=?').bind(organizationId),
  ]).then(raw=>{
    const rows=structuredClone(raw);
    if(env.DB!==db)throw Error('memory_boundary_database_changed');
    if(!Array.isArray(rows)||rows.length!==4||Array.from(rows).some(row=>!row||row.success!==true||('error' in row&&row.error!==undefined)||!Array.isArray(row.results)))throw Error('memory_boundary_schema_unavailable');
    const policy=rows[3]!.results;
    if(policy.length>1||policy.length===1&&(!policy[0]||Array.isArray(policy[0])||Object.keys(policy[0]).sort().join(',')!=='evidence_days,transient_days,version'
      ||!Object.values(policy[0]).every(value=>typeof value==='number'&&Number.isSafeInteger(value))))throw Error('private_content_retention_unavailable');
    return rows;
  });
  local.result=captured.then(rows=>qualifyNativeMemoryAnswerExclusion(env,db,'private_content',undefined,rows.slice(0,3)));
  const settled=local.result.then(value=>({status:'fulfilled',value}) as const,reason=>({status:'rejected',reason}) as const);
  const [rows,cleanup]=await Promise.all([captured,settled]);
  if(env.DB!==db)throw Error('memory_boundary_database_changed');
  return {policy:(rows[3]!.results[0]??null) as {transient_days:number;evidence_days:number;version:number}|null,cleanup};
}

declare const nativeTurnExclusionsBrand: unique symbol;
export type NativeMemoryTurnExclusions = Readonly<{[nativeTurnExclusionsBrand]:true}>;
const turnExclusions=new WeakMap<NativeMemoryTurnExclusions,{env:WorkerEnv;db:WorkerEnv['DB'];guards:BudgetReservationGuard[]}>();
const requestTurnExclusions=new WeakMap<WorkerEnv,{db:WorkerEnv['DB'];capture?:Promise<NativeMemoryTurnExclusions>}>();
/** Explicit request/execution-local compilation of negative SQL guards only.
 * This never caches an allowed read: each consuming statement still executes
 * the exact catalog and current negative-origin predicates. A schema change
 * fails closed for this operation; a new request captures the new catalog. */
export function nativeMemoryTurnInspectionEnvironment(env:WorkerEnv):WorkerEnv {
 const local=nativePrivateContentCleanupEnvironment(env);
 requestTurnExclusions.set(local,{db:env.DB});return local;
}
/** One request-local native schema observation covers the closed turn aliases.
 * These are exclusions only. Every returned predicate still checks exact schema
 * and current negative markers in its consuming transaction. No schema cache. */
export async function captureNativeMemoryTurnExclusions(env: WorkerEnv, semanticParents:readonly string[]=[]): Promise<NativeMemoryTurnExclusions> {
  if(semanticParents.length){
    if(semanticParents.length>2||semanticParents.some(id=>!/^[-0-9a-f]{36}$/u.test(id))||new Set(semanticParents).size!==semanticParents.length)throw Error("memory_boundary_parent_invalid");
    return captureTurnExclusions(env,semanticParents);
  }
  const local=requestTurnExclusions.get(env);
  if(!local)return captureTurnExclusions(env);
  if(env.DB!==local.db)throw Error('memory_boundary_database_changed');
  local.capture??=captureTurnExclusions(env);
  const handle=await local.capture;
  nativeMemoryTurnExclusionInputs(env,handle);return handle;
}
/** Prepare only negative-origin schema reads for an existing native read batch.
 * Acceptance binds the resulting guards to this exact environment/database;
 * every consuming SQL statement still replays the catalog and origin predicates. */
export function prepareNativeMemoryTurnExclusions(env:WorkerEnv,semanticParents:readonly string[]=[]){
 const db=env.DB,parents=[...semanticParents];
 if(parents.length>2||parents.some(id=>!/^[-0-9a-f]{36}$/u.test(id))||new Set(parents).size!==parents.length)throw Error('memory_boundary_parent_invalid');
 return {statements:nativeMemorySchemaReads(db,'turn'),async accept(observations:D1Result<unknown>[]):Promise<NativeMemoryTurnExclusions>{
  if(env.DB!==db)throw Error('memory_boundary_database_changed');
  const captured=structuredClone(observations);
  const guards=await Promise.all((['authored','answer','content'] as const).map(alias=>
   qualifyNativeMemoryAnswerExclusion(env,db,alias,'turn',captured,parents)));
  if(env.DB!==db)throw Error('memory_boundary_database_changed');
  const handle=Object.freeze({}) as NativeMemoryTurnExclusions;turnExclusions.set(handle,{env,db,guards});return handle;
 }};
}
async function captureTurnExclusions(env:WorkerEnv,semanticParents:readonly string[]=[]):Promise<NativeMemoryTurnExclusions>{
 const prepared=prepareNativeMemoryTurnExclusions(env,semanticParents);
 return prepared.accept(await env.DB.batch(prepared.statements));
}
export function nativeMemoryTurnExclusionInputs(env:WorkerEnv,handle:NativeMemoryTurnExclusions) {
  const captured=turnExclusions.get(handle);
  if(!captured||captured.env!==env||captured.db!==env.DB)throw new Error('memory_boundary_snapshot_invalid');
  const [authored,answer,content]=structuredClone(captured.guards);
  return {authored:authored!,answer:answer!,content:content!};
}

/** Exclusion only, never authorization to read an answer. A permanent public
 * marker prevents a missing manifest or retyped private row from downgrading
 * a derived answer into ordinary chat. Presence (even malformed) is enough to
 * exclude it; the separate origin reader requires the complete valid contract.
 * Missing schema is not cached, so an additive migration is seen on the next call.
 */
export async function nativeMemoryAnswerExclusion(env: WorkerEnv,
  input: { answerAlias: AnswerAlias; turnAlias?: TurnAlias }): Promise<BudgetReservationGuard> {
  if (!["answer", "authored", "private_content", "content"].includes(input.answerAlias)
    || input.turnAlias !== undefined && !["turn", "prior", "metadata"].includes(input.turnAlias)) {
    throw new Error("memory_boundary_alias_invalid");
  }
  const answer = input.answerAlias, turn = input.turnAlias, db = env.DB;
  // Total additive-schema absence is compatible only while it remains absent.
  // A partial or unknown schema cannot certify an ordinary-content fallback.
  // One request-local snapshot, not a cache. All exact schema/absence witnesses
  // remain in the eventual consequential SQL below.
  const observations=structuredClone(await db.batch(nativeMemorySchemaReads(db,turn)));
  return qualifyNativeMemoryAnswerExclusion(env,db,answer,turn,observations);
}

async function qualifyNativeMemoryAnswerExclusion(env: WorkerEnv, db: WorkerEnv["DB"],
  answer: AnswerAlias, turn: TurnAlias | undefined, observations: D1Result<unknown>[], semanticParents:readonly string[]=[]): Promise<BudgetReservationGuard> {
  if (env.DB !== db) throw new Error("memory_boundary_database_changed");
  if(!Array.isArray(observations)||observations.length!==3||[0,1,2].some(i=>!Object.hasOwn(observations,i)||observations[i]?.success!==true||(observations[i] as {error?:unknown}).error!==undefined))throw new Error("memory_boundary_schema_unavailable");
  const structured=await qualifyNativeStructuredOriginSchema(env,db,observations[0]);
  if (env.DB !== db) throw new Error("memory_boundary_database_changed");
  const documentJob=await qualifyNativeDocumentJobOriginSchema(env,db,observations[1]);
  if (env.DB !== db) throw new Error("memory_boundary_database_changed");
  const rows=observations[2].results;
  if(!Array.isArray(rows)||rows.length!==1||!Object.hasOwn(rows,0))throw new Error("memory_boundary_schema_unavailable");
  const flags=rows[0] as Record<string,unknown>;
  if(!flags||typeof flags!=="object"||Array.isArray(flags)||Object.keys(flags).length!==(turn?2:3)
    ||!Object.hasOwn(flags,"origins")||![0,1].includes(flags.origins as number)
    ||!turn&&(!Object.hasOwn(flags,"turns")||![0,1].includes(flags.turns as number)))throw new Error("memory_boundary_schema_unavailable");
  const hasOrigins={present:flags.origins},hasTurns=!turn&&{present:flags.turns};
  const semantic=await qualifySemanticConsumerBoundary(flags.consumer_schema);
  if (env.DB !== db) throw new Error("memory_boundary_database_changed");
  // Freeze omitted auxiliary branches too. If a table arrives between guard
  // construction and use, its newly registered/repointed contents require a
  // fresh exclusion, not reuse of an old absence decision.
  const auxiliarySchema = `EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins')=?`
    + (!turn ? ` AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='assistant_turns')=?` : "");
  // Actor-local turn IDs and resource IDs can repeat in different tenancies.
  // Only the canonical marker's exact scope tuple may exclude a repointed turn;
  // missing scope fields are not equivalent to the explicit personal nulls.
  const scope = (marker: "memory_answer" | "linked_marker", source: TurnAlias | "linked_turn") => `
    AND json_type(${marker}.payload,'$.organization_id') IN ('text','null')
    AND json_type(${marker}.payload,'$.project_access_id') IN ('text','null')
    AND json_extract(${marker}.payload,'$.organization_id') IS ${source}.organization_id
    AND json_extract(${marker}.payload,'$.project_access_id') IS ${source}.project_access_id`;
  const target = `json_extract(memory_answer.payload,'$.content_ref')=${answer}.content_id`;
  const tuple = turn ? ` OR (memory_answer.actor='user:'||${turn}.actor_user_id
    AND json_extract(memory_answer.payload,'$.turn_id')=${turn}.turn_id
    AND json_extract(memory_answer.payload,'$.project_id') IS ${turn}.project_id
    AND json_extract(memory_answer.payload,'$.document_id') IS ${turn}.document_id${scope("memory_answer",turn)})` : "";
  const origins = hasOrigins?.present === 1 ? ` AND NOT EXISTS(SELECT 1 FROM memory_native_answer_origins memory_origin
    WHERE memory_origin.answer_content_id=${answer}.content_id${turn ? ` OR (memory_origin.actor_user_id,memory_origin.scope_key,memory_origin.turn_id)
      =(${turn}.actor_user_id,${turn}.scope_key,${turn}.turn_id)` : ""})` : "";
  // Registration is an independent negative marker. Removing/retyping a public
  // marker or private kind never downgrades any of the three owned bodies, nor
  // a repointed turn with the original actor/scope/turn identity.
  const structuredOrigins = structured.present ? ` AND NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins structured_origin
    WHERE ${answer}.content_id IN(structured_origin.user_content_id,structured_origin.answer_content_id,structured_origin.manifest_content_ref)
      ${turn ? `OR (structured_origin.actor_user_id,structured_origin.scope_key,structured_origin.turn_id)
        =(${turn}.actor_user_id,${turn}.scope_key,${turn}.turn_id)` : ""})` : "";
  // Job-native registrations are not assistant_turns/Creator publications. All
  // registered bodies stay excluded after marker removal, retyping, withdrawal
  // or minimization. Original event IDs also deny a repointed content reference,
  // even when the event's public marker/type/actor has subsequently changed.
  const documentJobOrigins = documentJob.present ? ` AND NOT EXISTS(SELECT 1 FROM memory_document_job_answer_origins job_origin
    WHERE ${answer}.content_id IN(job_origin.user_content_id,job_origin.answer_content_id,job_origin.manifest_content_ref)
      ${turn ? `OR (job_origin.actor_user_id,job_origin.scope_key,job_origin.turn_id)
        =(${turn}.actor_user_id,${turn}.scope_key,${turn}.turn_id)` : ""}
      OR EXISTS(SELECT 1 FROM events job_origin_event
        WHERE job_origin_event.event_id IN(job_origin.user_event_id,job_origin.answer_event_id)
          AND json_extract(job_origin_event.payload,'$.content_ref')=${answer}.content_id))` : "";
  // One parent-list binding covers both negative registries. Repeating it for
  // every content/turn alias can exceed D1's statement parameter ceiling.
  const semanticOrigins=semantic.present?` AND NOT EXISTS(SELECT 1 FROM (
    SELECT semantic_origin.origin_id AS origin_id FROM memory_derivation_consumer_contents semantic_copy
    JOIN memory_derivation_consumers semantic_origin ON semantic_origin.origin_id=semantic_copy.origin_id
    WHERE (semantic_copy.content_id=${answer}.content_id${turn?` OR (semantic_copy.role IN('result','answer') AND
      (semantic_origin.actor_user_id,semantic_origin.scope_key,semantic_origin.turn_id)=(${turn}.actor_user_id,${turn}.scope_key,${turn}.turn_id))`:''})
    ${semantic.assetsPresent?`UNION ALL SELECT CASE WHEN asset.source_kind='consumer' THEN asset.source_id ELSE '' END AS origin_id
      FROM memory_derivation_asset_edges asset WHERE asset.target_kind='content' AND asset.target_id=${answer}.content_id`:''}
    ) marked ${semanticParents.length?'WHERE marked.origin_id NOT IN(SELECT value FROM json_each(?))':''})`:'';
  // Generic hydration has no outer turn alias. Repointing a marked turn's
  // authored or answer ref must not create a new ordinary hydration route.
  const linked = hasTurns && hasTurns.present === 1 ? ` AND NOT EXISTS(SELECT 1 FROM assistant_turns linked_turn
    WHERE (${answer}.content_id=linked_turn.user_content_ref OR ${answer}.content_id=linked_turn.assistant_content_ref)
      AND (EXISTS(SELECT 1 FROM events linked_marker WHERE linked_marker.type='AssistantReasoned'
        AND json_type(linked_marker.payload,'$.memory_origin_version') IS NOT NULL
        AND linked_marker.actor='user:'||linked_turn.actor_user_id
        AND json_extract(linked_marker.payload,'$.turn_id')=linked_turn.turn_id
        AND json_extract(linked_marker.payload,'$.project_id') IS linked_turn.project_id
        AND json_extract(linked_marker.payload,'$.document_id') IS linked_turn.document_id${scope("linked_marker","linked_turn")})
      ${hasOrigins?.present === 1 ? `OR EXISTS(SELECT 1 FROM memory_native_answer_origins linked_origin
        WHERE (linked_origin.actor_user_id,linked_origin.scope_key,linked_origin.turn_id)
          =(linked_turn.actor_user_id,linked_turn.scope_key,linked_turn.turn_id))` : ""}
      ${structured.present ? `OR EXISTS(SELECT 1 FROM memory_structured_answer_origins linked_structured_origin
        WHERE (linked_structured_origin.actor_user_id,linked_structured_origin.scope_key,linked_structured_origin.turn_id)
          =(linked_turn.actor_user_id,linked_turn.scope_key,linked_turn.turn_id))` : ""}
      ${documentJob.present ? `OR EXISTS(SELECT 1 FROM memory_document_job_answer_origins linked_job_origin
        WHERE (linked_job_origin.actor_user_id,linked_job_origin.scope_key,linked_job_origin.turn_id)
          =(linked_turn.actor_user_id,linked_turn.scope_key,linked_turn.turn_id))` : ""}))` : "";
  if (env.DB !== db) throw new Error("memory_boundary_database_changed");
  return { sql: `((${structured.guard.condition}) AND (${documentJob.guard.condition}) AND (${auxiliarySchema}) AND (${semantic.guard.sql}) AND COALESCE(${answer}.kind,'') NOT IN('chat-assistant-memory','memory-structured-origin','memory-document-job-origin')
    AND NOT EXISTS(SELECT 1 FROM events memory_answer WHERE memory_answer.type='AssistantReasoned'
      AND json_type(memory_answer.payload,'$.memory_origin_version') IS NOT NULL AND (${target}${tuple}))${origins}${structuredOrigins}${documentJobOrigins}${semanticOrigins}${linked})`,
    bindings: [...structured.guard.bindings, ...documentJob.guard.bindings, hasOrigins?.present === 1 ? 1 : 0,
      ...(!turn ? [hasTurns && hasTurns.present === 1 ? 1 : 0] : []),...semantic.guard.bindings,...(semantic.present&&semanticParents.length?[JSON.stringify(semanticParents)]:[])] };
}
