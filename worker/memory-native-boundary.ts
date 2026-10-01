import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import { nativeStructuredOriginSchema } from "./memory-native-origin.ts";

type AnswerAlias = "answer" | "authored" | "private_content" | "content";
type TurnAlias = "turn" | "prior" | "metadata";

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
  const structured = await nativeStructuredOriginSchema(env);
  const hasOrigins = await db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins'")
    .first<{ present: number }>();
  const hasTurns = !turn && await db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='assistant_turns'")
    .first<{ present: number }>();
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
          =(linked_turn.actor_user_id,linked_turn.scope_key,linked_turn.turn_id))` : ""}))` : "";
  if (env.DB !== db) throw new Error("memory_boundary_database_changed");
  return { sql: `((${structured.guard.condition}) AND (${auxiliarySchema}) AND COALESCE(${answer}.kind,'') NOT IN('chat-assistant-memory','memory-structured-origin')
    AND NOT EXISTS(SELECT 1 FROM events memory_answer WHERE memory_answer.type='AssistantReasoned'
      AND json_type(memory_answer.payload,'$.memory_origin_version') IS NOT NULL AND (${target}${tuple}))${origins}${structuredOrigins}${linked})`,
    bindings: [...structured.guard.bindings, hasOrigins?.present === 1 ? 1 : 0,
      ...(!turn ? [hasTurns && hasTurns.present === 1 ? 1 : 0] : [])] };
}
