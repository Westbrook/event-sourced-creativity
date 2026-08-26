import { BLOCK_TYPES, blockTypeDefinition, isBlockKind, type BlockIntent, type BlockKind } from "./block-types.ts";
import { isContextCompositionRelation } from "./combined-context.ts";
import type { AssistantContext, AssistantDecisionAtom } from "./conversation-context.ts";
import type { EventInput } from "./events.ts";

export type AssistantContextAction =
  | { kind: "context.create"; blockType: BlockKind; text: string; intent: BlockIntent }
  | { kind: "context.edit"; targetBlockId: string; text: string }
  | { kind: "context.remove"; targetBlockId: string }
  | { kind: "context.relation.add"; fromBlockId: string; toBlockId: string; relationKind: string }
  | { kind: "context.relation.remove"; fromBlockId: string; toBlockId: string; relationKind: string };

export type AssistantActionProposal = {
  id: string;
  turnId: string;
  key: string;
  summary: string;
  kind: AssistantContextAction["kind"];
  status: "pending" | "accepted" | "rejected";
  action: AssistantContextAction;
  documentId: string;
  projectId: string;
  sourceVersions: Array<{ blockId: string; version: number }>;
  requiresApproval: true;
  estimatedMicrousd: 0;
};

const MUTATION_INTENT = /\b(?:add|create|include|set|use|change|update|edit|remove|delete|exclude|avoid|prohibit|ajoute|ajouter|crée|créer|modifier|supprimer|éviter)\b|(?:أضف|أنشئ|غير|عدّل|احذف|تجنب|追加|作成|変更|更新|削除|除外)/iu;
const REMOVE_INTENT = /\b(?:remove|delete|clear|supprimer|retirer)\b|(?:احذف|أزل|削除|取り除)/iu;
const EDIT_INTENT = /\b(?:change|update|edit|replace|modifier|changer)\b|(?:غير|عدّل|変更|更新|置き換)/iu;
const RELATE_INTENT = /\b(?:connect|link|relate|associate|attach|group|lier|associer)\b|(?:اربط|ربط|つなぐ|関連付|接続)/iu;
const UNRELATE_INTENT = /\b(?:disconnect|unlink|detach|ungroup|dissociate|délier|dissocier)\b|(?:افصل|إزالة الربط|切断|関連解除)/iu;
const REFERENCE_INTENT = /\b(?:reference|upload|attachment|référence|téléverser)\b|(?:مرجع|تحميل|参照|アップロード)/iu;

const typePatterns: Array<[BlockKind, RegExp]> = [
  ["exclusion", /\b(?:exclude|avoid|never|without|prohibit|forbid|exclusion|éviter|jamais)\b|(?:تجنب|ممنوع|除外|禁止)/iu],
  ["audio", /\b(?:audio|music|sound|soundtrack|score|voice|musique|son)\b|(?:موسيقى|صوت|音楽|音声|サウンド)/iu],
  ["audience", /\b(?:audience|customer|buyer|viewer|users?|persona|client|public)\b|(?:جمهور|ユーザー|対象者)/iu],
  ["message", /\b(?:message|tagline|headline|narrative|story|copy)\b|(?:رسالة|メッセージ)/iu],
  ["emotion", /\b(?:emotion|mood|feel|tone|energy|humeur)\b|(?:émotion|شعور|感情|雰囲気)/iu],
  ["action", /\b(?:action|interaction|interact|activity|behavior|behaviour|conversation|discuss|carry|ride)\b|(?:تفاعل|動作|行動)/iu],
  ["subject", /\b(?:subject|character|person|object|hero|portrait|sujet|personnage)\b|(?:شخصية|被写体|キャラクター)/iu],
  ["environment", /\b(?:environment|setting|location|world|place|interior|exterior|lieu)\b|(?:décor|بيئة|環境|場所)/iu],
  ["motion", /\b(?:motion|movement|move|animate|still|mouvement)\b|(?:حركة|動き)/iu],
  ["scale", /\b(?:scale|size|distance|monumental|intimate)\b|(?:échelle|حجم|スケール)/iu],
  ["composition", /\b(?:composition|framing|layout|balance|grid|negative space|cadrage)\b|(?:تكوين|構図)/iu],
  ["camera", /\b(?:camera|lens|angle|perspective|depth)\b|(?:caméra|كاميرا|الكاميرا|カメラ)/iu],
  ["lighting", /\b(?:light|lighting|shadow|sunset|sunrise)\b|(?:lumière|éclairage|إضاءة|الإضاءة|照明)/iu],
  ["style", /\b(?:style|aesthetic|art direction|finish|treatment)\b|(?:أسلوب|スタイル)/iu],
  ["material", /\b(?:material|texture|fabric|surface|wood|metal|glass)\b|(?:matière|ملمس|素材)/iu],
  ["palette", /\b(?:palette|colou?r|hue|tonal|couleur)\b|(?:لون|الألوان|色|パレット)/iu],
  ["typography", /\b(?:typography|font|typeface|letter|type|police)\b|(?:خط|書体|タイポグラフィ)/iu],
  ["format", /\b(?:format|aspect|resolution|dimensions|channel|square|portrait|landscape)\b|(?:résolution|أبعاد|形式|解像度)/iu],
  ["brand", /\b(?:brand|identity|logo|guideline|marque)\b|(?:هوية|ブランド)/iu],
  ["accessibility", /\b(?:accessib|contrast|legib|readab|captions?|alt text|accessible)/iu],
  ["accessibility", /(?:إتاحة|إمكانية الوصول|アクセシビリティ)/iu],
  ["sketch", /\b(?:sketch|draw|drawing|gesture|mask|croquis)\b|(?:رسم|スケッチ)/iu],
  ["direction", /./u],
];

export function inferAssistantBlockType(value: string): BlockKind {
  const label = value.match(/^\s*(?:(?:add|create|include|set|use|ajoute|ajouter|crée|créer)\s+)?([a-z_]+)\s*:/iu)?.[1]?.toLocaleLowerCase();
  if (label && isBlockKind(label)) return label;
  return typePatterns.find(([, pattern]) => pattern.test(value))?.[0] ?? "direction";
}

function clauses(value: string) {
  const typeWords = "audience|customer|buyer|message|tagline|headline|emotion|mood|subject|character|environment|setting|action|interaction|motion|movement|scale|composition|camera|lighting|style|material|palette|colou?r|typography|font|audio|music|soundtrack|format|brand|exclusion|accessibility|sketch|direction";
  const nextDecision = new RegExp(`\\s+(?:and|plus|et|و|と)\\s+(?=(?:(?:a|an|the|one|un|une|le|la)\\s+)?(?:[\\p{L}][\\p{L}\\p{M}\\p{N}_-]*\\s+){0,3}(?:${typeWords})\\b)`, "giu");
  return value.split(/\n+|;|(?:\s+[•·]\s+)|(?:[.!?]\s+(?=(?:add|create|include|set|use|change|update|edit|remove|delete|exclude|avoid|ajoute|ajouter|crée|créer|modifier|supprimer)\b))/iu)
    .flatMap((part) => part.split(nextDecision))
    .flatMap((part) => part.split(/,\s*(?=(?:audience|message|emotion|mood|subject|environment|action|motion|scale|composition|camera|lighting|style|material|palette|typography|audio|format|brand|exclude|accessibility|sketch)\s*:)/iu))
    .map((part) => part.replace(/^\s*(?:[-*]|\d+[.)])\s*/u, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function targetFor(value: string, decisions: readonly AssistantDecisionAtom[]) {
  const lower = value.toLocaleLowerCase();
  return decisions.find((decision) => lower.includes(decision.id.toLocaleLowerCase()))
    ?? decisions.find((decision) => lower.includes(decision.type.toLocaleLowerCase()))
    ?? decisions.find((decision) => decision.text.length >= 5 && lower.includes(decision.text.toLocaleLowerCase()));
}

/** Convert one instruction into independently reviewable decisions, never one giant prompt block. */
export function normalizeAssistantActions(message: string, context: AssistantContext): AssistantContextAction[] {
  if (!context.scope.documentId || !context.scope.projectId || !(MUTATION_INTENT.test(message) || RELATE_INTENT.test(message) || UNRELATE_INTENT.test(message))) return [];
  const parts = clauses(message);
  const actions: AssistantContextAction[] = [];
  for (const part of parts) {
    if (REFERENCE_INTENT.test(part)) continue; // Actual uploaded evidence and rights must use the existing uploader.
    if (RELATE_INTENT.test(part) || UNRELATE_INTENT.test(part)) {
      const lower = part.toLocaleLowerCase();
      const targets = context.decisionAtoms.map((decision) => {
        const byId = lower.indexOf(decision.id.toLocaleLowerCase());
        const byText = decision.text.length >= 5 ? lower.indexOf(decision.text.toLocaleLowerCase()) : -1;
        const position = byId < 0 ? byText : byText < 0 ? byId : Math.min(byId, byText);
        return { decision, position };
      }).filter((entry) => entry.position >= 0).sort((left, right) => left.position - right.position).map((entry) => entry.decision);
      const [from, to] = targets;
      if (targets.length === 2 && from && to && !from.locked && !from.immutable && !from.protected && !to.locked && !to.immutable && !to.protected) {
        const existing = context.relationships?.find((relation) => relation.from === from.id && relation.to === to.id);
        if (UNRELATE_INTENT.test(part)) {
          if (existing) actions.push({ kind: "context.relation.remove", fromBlockId: from.id, toBlockId: to.id, relationKind: existing.kind });
        } else if (!existing) {
          actions.push({ kind: "context.relation.add", fromBlockId: from.id, toBlockId: to.id, relationKind: "context_contains" });
        }
      }
      continue;
    }
    const target = targetFor(part, context.decisionAtoms);
    const explicitCreation = /^\s*(?:add|create|include|set|use|ajoute|ajouter|crée|créer)\b|^(?:أضف|أنشئ|追加|作成)/iu.test(part);
    if (!explicitCreation && REMOVE_INTENT.test(part) && target) {
      if (!target.locked && !target.immutable && !target.protected) actions.push({ kind: "context.remove", targetBlockId: target.id });
      continue;
    }
    if (!explicitCreation && EDIT_INTENT.test(part) && target) {
      if (!target.locked && !target.immutable && !target.protected) actions.push({ kind: "context.edit", targetBlockId: target.id, text: part.slice(0, 600) });
      continue;
    }
    const blockType = inferAssistantBlockType(part);
    if (!isBlockKind(blockType) || blockType === "reference") continue;
    const intent: BlockIntent = blockType === "exclusion" && /\b(?:never|prohibit|forbid|jamais)\b|(?:ممنوع|禁止)/iu.test(part) ? "prohibit" : blockType === "exclusion" ? "avoid" : "include";
    actions.push({ kind: "context.create", blockType, text: part.slice(0, 600), intent });
  }
  return actions;
}

/** Rebuild approved events from server-owned action data and the current authorized projection. */
export function assistantActionEvents(action: AssistantContextAction, context: AssistantContext, identifiers: { blockId: string; relationId: string; turnId: string }): EventInput[] {
  const projectId = context.scope.projectId;
  const documentId = context.scope.documentId;
  if (!projectId || !documentId) return [];
  const source = { project_id: projectId, document_id: documentId, source_surface: "assistant", source_chat_turn_id: identifiers.turnId };
  const target = (id: string) => context.decisionAtoms.find((decision) => decision.id === id);
  if (action.kind === "context.create") {
    if (!isBlockKind(action.blockType) || action.blockType === "reference" || !action.text.trim()
      || action.blockType === "exclusion" && !["avoid", "prohibit"].includes(action.intent)) return [];
    const definition = blockTypeDefinition(action.blockType);
    const subtype = definition?.subtypes[0] ?? "General";
    const properties: Record<string, unknown> = {
      text: action.text.trim(), subtype, intent: action.intent, weight: 0.7, authority: "authored", created_from: "assistant", source_chat_turn_id: identifiers.turnId,
      ...(action.blockType === "audio" ? { audio_role: "score", inform_generation: false, include_in_output: false, allow_provider_audio_transfer: false } : {}),
    };
    return [{ type: "BlockCreated", payload: { ...source, block_id: identifiers.blockId, type: action.blockType, handle: `${action.blockType}/${identifiers.blockId.slice(0, 8)}`, position: `z${identifiers.blockId.replace(/-/gu, "").slice(0, 12)}`, properties } }];
  }
  if (action.kind === "context.edit") {
    const block = target(action.targetBlockId);
    if (!block || block.locked || block.immutable || block.protected || !action.text.trim()) return [];
    return [{ type: "BlockPropertyEdited", payload: { ...source, block_id: block.id, property_path: "text", old_value: block.text, new_value: action.text.trim() } }];
  }
  if (action.kind === "context.remove") {
    const block = target(action.targetBlockId);
    if (!block || block.locked || block.immutable || block.protected) return [];
    return [{ type: "BlockRemoved", payload: { ...source, block_id: block.id, reason: "explicitly-approved-assistant-proposal" } }];
  }
  const from = target(action.fromBlockId), to = target(action.toBlockId);
  if (!from || !to || from.id === to.id || from.locked || to.locked || from.immutable || to.immutable || from.protected || to.protected || !isContextCompositionRelation(action.relationKind)) return [];
  if (action.kind === "context.relation.add") {
    if (context.relationships.some((relation) => relation.from === from.id && relation.to === to.id && relation.kind === action.relationKind)) return [];
    const pending = [to.id], visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === from.id) return [];
      if (visited.has(current)) continue;
      visited.add(current);
      for (const relation of context.relationships) if (isContextCompositionRelation(relation.kind) && relation.from === current) pending.push(relation.to);
    }
    return [{ type: "BlockRelationAdded", payload: { ...source, relation_id: identifiers.relationId, from_block_id: from.id, to_block_id: to.id, kind: action.relationKind, properties: {} } }];
  }
  const existing = context.relationships.find((relation) => relation.from === from.id && relation.to === to.id && relation.kind === action.relationKind);
  if (!existing?.id) return [];
  return [{ type: "BlockRelationRemoved", payload: { ...source, relation_id: existing.id, from_block_id: from.id, to_block_id: to.id, kind: action.relationKind } }];
}

export const ASSISTANT_SUPPORTED_BLOCK_TYPES = BLOCK_TYPES.map((definition) => definition.type);
