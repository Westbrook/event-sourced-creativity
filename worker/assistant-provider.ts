import { BLOCK_TYPES } from "../src/model/block-types.ts";
import type { AssistantModel } from "../src/model/assistant-model-policy.ts";
import type { AssistantContextAction } from "../src/model/assistant-proposals.ts";
import { ASSISTANT_CONTEXT_LIMITS, type AssistantContext } from "../src/model/conversation-context.ts";
import { creativePromptGuardrails, providerFacingCreativeContext } from "../src/model/prompt-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

type ProviderAction = {
  kind: AssistantContextAction["kind"];
  block_type: string;
  target_block_id: string | null;
  from_block_id: string | null;
  to_block_id: string | null;
  relation_kind: string;
  intent: "include" | "avoid" | "prohibit";
  text: string;
};

export type AssistantProviderResult = {
  responseId: string;
  model: string;
  reply: string;
  actions: ProviderAction[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};

/** A definitive HTTP rejection did not produce a billable completion and can release its reservation. */
export class AssistantProviderRejectedError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`assistant_provider_http_${status}`);
    this.name = "AssistantProviderRejectedError";
    this.status = status;
  }
}

const assistantResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "actions"],
  properties: {
    reply: { type: "string", maxLength: 2400 },
    actions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "block_type", "target_block_id", "from_block_id", "to_block_id", "relation_kind", "intent", "text"],
        properties: {
          kind: { type: "string", enum: ["context.create", "context.edit", "context.remove", "context.relation.add", "context.relation.remove"] },
          block_type: { type: "string", enum: BLOCK_TYPES.map((item) => item.type) },
          target_block_id: { type: ["string", "null"] },
          from_block_id: { type: ["string", "null"] },
          to_block_id: { type: ["string", "null"] },
          relation_kind: { type: "string" },
          intent: { type: "string", enum: ["include", "avoid", "prohibit"] },
          text: { type: "string", maxLength: 600 },
        },
      },
    },
  },
};

/** Explicitly select safe, current, event-derived views; never stream arbitrary histories or media. */
function providerDecisionAliases(context:AssistantContext){
  const eligible=context.decisionAtoms.filter((item)=>item.providerEligible&&(!item.immutable||item.providerVisibility==="governed")
    &&item.type!=="reference"&&item.providerVisibility!=="restricted");
  return new Map(eligible.map((item,index)=>[item.id,`decision_${index+1}`]));
}

export function providerFacingAssistantViews(context: AssistantContext, message: string) {
  const aliases=providerDecisionAliases(context);
  const blocks=context.decisionAtoms.filter((item)=>aliases.has(item.id))
    .map((item)=>({id:aliases.get(item.id)!,type:item.type,text:item.text,intent:item.intent,locked:item.locked||item.immutable||Boolean(item.protected),read_only:item.immutable||Boolean(item.protected)}));
  return providerFacingCreativeContext({
    page: context.surface.page,
    page_family: context.surface.canonicalFamily,
    page_playbook: context.playbook,
    document_title: context.documentTitle,
    selected_items: context.selectedItems.map((item) => ({ kind: item.kind, title: item.title })),
    recent_actions: context.recentActions.map((action) => ({ type: action.type })),
    recent_conversation: context.recentTurns.slice(-ASSISTANT_CONTEXT_LIMITS.turns).map((turn) => ({ role: turn.role, text: turn.text })),
    blocks,
    relationships: context.relationships.filter((relation) => aliases.has(relation.from) && aliases.has(relation.to))
      .map((relation) => ({ from: aliases.get(relation.from)!, to: aliases.get(relation.to)!, kind: relation.kind })),
    context_coverage:{included_decisions:blocks.length,total_decisions:context.totals?.decisions??context.decisionAtoms.length,truncated:Boolean(context.truncated)},
    unfinished_work: context.unfinishedIntents.map((intent) => ({ kind: intent.kind, status: intent.status, next_action: intent.nextAction })),
    available_formats: context.availableOutputKinds,
    available_results: context.availableOutputs.map((output) => ({ kind: output.kind, title: output.title, status: output.status })),
    message: message.slice(0, ASSISTANT_CONTEXT_LIMITS.turnChars),
  }) as Record<string, unknown>;
}

async function actorSafetyIdentifier(actorUserId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actorUserId));
  return `forma_${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

/** One paid POST, never automatically retried after an ambiguous provider submission. */
export async function requestAssistantProvider(env: WorkerEnv, actorUserId: string, input: {
  model: AssistantModel;
  context: AssistantContext;
  message: string;
  locale: string;
  maximumInputTokens: number;
  maximumOutputTokens: number;
}): Promise<AssistantProviderResult> {
  if (!env.OPENAI_API_KEY) throw new Error("assistant_provider_unavailable");
  const payload = {
    model: input.model,
    instructions: `You are Forma, a concise, page-aware creative collaborator. Respond in the user's selected language (${input.locale}). Prioritize the current page and exact selection, then their recent authorized activity and most recent messages. Treat audio as a currently available output format. Never claim it is a future capability. Propose the smallest independently reviewable actions; never combine several creative decisions in one context block. You cannot execute actions, change reference or audio transfer consent, launch generation, spend money, share, export, publish, or bypass approvals. Never create a reference because actual licensed uploads require their dedicated flow. Preserve locked decisions, verified sources, protected constraints, governed organization context, and other users' privacy. Explain relevant current results and next steps without exposing system internals. ${creativePromptGuardrails()}`,
    input: JSON.stringify(providerFacingAssistantViews(input.context, input.message)),
    text: { verbosity: "low", format: { type: "json_schema", name: "forma_page_assistant", strict: true, schema: assistantResponseSchema } },
    reasoning: { effort: "low" },
    max_output_tokens: input.maximumOutputTokens,
    store: false,
    safety_identifier: await actorSafetyIdentifier(actorUserId),
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
      ...(env.OPENAI_PROJECT ? { "OpenAI-Project": env.OPENAI_PROJECT } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new AssistantProviderRejectedError(response.status);
  const body = await response.json() as {
    id?: unknown;
    model?: unknown;
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
    usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown };
  };
  const inputTokens = Number(body.usage?.input_tokens);
  const outputTokens = Number(body.usage?.output_tokens);
  const totalTokens = Number(body.usage?.total_tokens);
  if (typeof body.id !== "string" || !body.id.trim() || body.id.length > 160 || typeof body.model !== "string" || !body.model.trim()
    || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || !Number.isSafeInteger(totalTokens)
    || inputTokens <= 0 || inputTokens>input.maximumInputTokens||outputTokens <= 0 || outputTokens > input.maximumOutputTokens || totalTokens !== inputTokens + outputTokens) {
    throw new Error("assistant_provider_usage_unverified");
  }
  const text = typeof body.output_text === "string" ? body.output_text
    : String(body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text ?? "");
  if (!text) throw new Error("assistant_provider_empty_response");
  let decoded: { reply?: unknown; actions?: unknown };
  try { decoded = JSON.parse(text) as { reply?: unknown; actions?: unknown }; } catch { throw new Error("assistant_provider_invalid_response"); }
  if (typeof decoded.reply !== "string" || !decoded.reply.trim() || decoded.reply.length > 2400 || !Array.isArray(decoded.actions) || decoded.actions.length > 12) {
    throw new Error("assistant_provider_invalid_response");
  }
  const aliases=new Map([...providerDecisionAliases(input.context)].map(([actual,alias])=>[alias,actual]));
  const actions=decoded.actions.map((candidate)=>{
    if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))return candidate;
    const action={...(candidate as Record<string,unknown>)};
    for(const key of ["target_block_id","from_block_id","to_block_id"] as const){
      if(typeof action[key]==="string")action[key]=aliases.get(action[key] as string)??null;
    }
    return action;
  });
  return {
    responseId: body.id,
    model: body.model,
    reply: decoded.reply,
    actions: actions as ProviderAction[],
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
    },
  };
}
