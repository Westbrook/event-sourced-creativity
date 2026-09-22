import type { CreativeEvent } from "./events";

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export type GenerationPromotionSignal = {
  promotionId: string;
  promotionSequence: number;
  documentId: string;
  sourceSurface: string;
  draftEventId: string;
  draftGenerationId: string;
  draftObjectId: string;
  fullGenerationId: string;
  requestedEventId: string | null;
  outcomeEventId: string | null;
  fullObjectIds: string[];
  status: "pending" | "completed" | "failed";
  intentWeight: number;
  successWeight: number | null;
  elapsedToIntentMs: number;
  elapsedToOutcomeMs: number | null;
  interveningEventCount: number;
  documentChangeCount: number;
  conversationTurnCount: number;
  contextChanged: boolean;
  evidenceRefs: string[];
};

const DOCUMENT_CHANGES = /^(BlockDocumentAttached|BlockDocumentDetached|BlockCreated|BlockPropertyEdited|BlockWeightSet|BlockRemoved|BlockRestored|ChipEdited|ExtractionCompleted)$/;

export function generationPromotionSignals(events: CreativeEvent[]): GenerationPromotionSignal[] {
  return events.filter((event) => event.type === "IdeationPromoted").map((promotion) => {
    const promotionId = String(promotion.payload.promotion_id ?? promotion.eventId);
    const fullGenerationId = String(promotion.payload.full_generation_id ?? "");
    const requested = events.find((event) => event.type === "GenerationRequested" && (String(event.payload.promotion_id ?? "") === promotionId || String(event.payload.generation_id ?? "") === fullGenerationId));
    const completed = events.find((event) => event.type === "GenerationCompleted" && event.payload.report_space !== "scout" && (String(event.payload.promotion_id ?? "") === promotionId || String(event.payload.generation_id ?? "") === fullGenerationId));
    const failed = events.find((event) => event.type === "GenerationFailed" && (String(event.payload.promotion_id ?? "") === promotionId || String(event.payload.generation_id ?? "") === fullGenerationId));
    const outcome = completed ?? failed;
    const draftSequence = Number(promotion.payload.draft_sequence ?? 0);
    const intervening = events.filter((event) => event.sequence > draftSequence && event.sequence < promotion.sequence);
    const elapsedToIntentMs = Number(promotion.payload.elapsed_to_intent_ms ?? 0);
    const outcomeAt = outcome ? Date.parse(outcome.occurredAt) : NaN;
    const promotedAt = Date.parse(promotion.occurredAt);
    const status:GenerationPromotionSignal["status"]=completed?"completed":failed?"failed":"pending";
    return {
      promotionId,
      promotionSequence:promotion.sequence,
      documentId: String(promotion.payload.document_id ?? ""),
      sourceSurface: String(promotion.payload.source_surface ?? "studio"),
      draftEventId: String(promotion.payload.draft_event_id ?? promotion.payload.reference_preview_event_id ?? ""),
      draftGenerationId: String(promotion.payload.draft_generation_id ?? ""),
      draftObjectId: String(promotion.payload.draft_object_id ?? ""),
      fullGenerationId,
      requestedEventId: requested?.eventId ?? null,
      outcomeEventId: outcome?.eventId ?? null,
      fullObjectIds: list(completed?.payload.object_ids).map(String),
      status,
      intentWeight: 1,
      successWeight: completed ? 1 : failed ? 0 : null,
      elapsedToIntentMs,
      elapsedToOutcomeMs: outcome && Number.isFinite(outcomeAt) && Number.isFinite(promotedAt) ? Math.max(0, outcomeAt - promotedAt) : null,
      interveningEventCount: Number(promotion.payload.intervening_event_count ?? intervening.length),
      documentChangeCount: Number(promotion.payload.document_change_count ?? intervening.filter((event) => DOCUMENT_CHANGES.test(event.type)).length),
      conversationTurnCount: Number(promotion.payload.conversation_turn_count ?? intervening.filter((event) => event.type === "ChatMessageSent").length),
      contextChanged: Boolean(promotion.payload.context_changed ?? intervening.some((event) => DOCUMENT_CHANGES.test(event.type))),
      evidenceRefs: [promotion.eventId, requested?.eventId, outcome?.eventId].filter((value): value is string => Boolean(value)),
    };
  }).sort((left, right) => right.promotionSequence-left.promotionSequence);
}

export function generationSuccessMetrics(events: CreativeEvent[]) {
  const drafts = events.filter((event) => event.type === "IdeationPreviewCompleted" && event.payload.report_space !== "scout").length;
  const full = events.filter((event) => event.type === "GenerationCompleted" && event.payload.report_space !== "scout").length;
  const promotions = generationPromotionSignals(events);
  const completed = promotions.filter((signal) => signal.status === "completed").length;
  const failed = promotions.filter((signal) => signal.status === "failed").length;
  const elapsed = promotions.map((signal) => signal.elapsedToIntentMs).sort((a, b) => a - b);
  const medianElapsedToIntentMs = elapsed.length ? elapsed[Math.floor(elapsed.length / 2)] : null;
  return {
    drafts, full, promotions: promotions.length, completed, failed,
    promotedDraftRate: drafts ? promotions.length / drafts : 0,
    promotionSuccessRate: completed + failed ? completed / (completed + failed) : 0,
    medianElapsedToIntentMs,
  };
}
