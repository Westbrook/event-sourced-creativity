import { canonicalJson } from "./compiler.ts";
import type { ExperiencePlan } from "./intake.ts";
import type { ExperienceIntakeReceipt } from "./native-host.ts";
type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => Boolean(value && typeof value === "object" && !Array.isArray(value));
/** Compare only an already server-validated intake/receipt to current canonical source.
 * This grants no authorization, generation or delivery. Extra/edited source fails closed. */
export type ExperienceSourceMismatch = "identity" | "document" | "original_event" | "block_membership" | "relation" | "block_fields" | "properties" | "provenance" | "unreadable";
type CurrentSource = {
  documentId: string; projectId: string; documents: readonly unknown[]; blocks: readonly unknown[];
  relations: readonly unknown[]; events: readonly unknown[];
};
// Fixed categories only: never include source values, IDs, paths or exception
// messages in diagnostics. Null has exactly the original matcher's meaning.
export function experienceSourceMismatch(plan: ExperiencePlan, receipt: ExperienceIntakeReceipt, current: CurrentSource): ExperienceSourceMismatch | null {
  try {
    if (!["image", "slides", "short_story", "scene", "audio", "storyboard", "video", "model3d"].includes(plan.release.output.output) || current.documentId !== plan.documentId || current.projectId !== plan.projectId
      || receipt.documentId !== plan.documentId || receipt.projectId !== plan.projectId || receipt.draftHash !== plan.draftHash || receipt.draftId !== plan.draftId) return "identity";
    const documents = current.documents.filter(value => row(value) && value.id === plan.documentId);
    if (documents.length !== 1 || !row(documents[0]) || documents[0].removed !== false || documents[0].projectId !== plan.projectId || documents[0].title !== plan.title) return "document";
    const appended = receipt.appended;
    if (appended.length !== plan.events.length || new Set(appended.map(event => event.eventId)).size !== appended.length) return "original_event";
    for (const [index, event] of appended.entries()) {
      const found = current.events.filter(candidate => row(candidate) && candidate.eventId === event.eventId);
      if (found.length !== 1 || !row(found[0]) || found[0].streamId !== plan.streamId || found[0].actor !== "user"
        || found[0].type !== plan.events[index]!.type || found[0].sequence !== event.sequence
        || canonicalJson(found[0].payload) !== canonicalJson(plan.events[index]!.payload)) return "original_event";
    }
    const expected = plan.events.flatMap((event, index) => event.type === "BlockCreated" ? [{ payload: event.payload, eventId: appended[index]!.eventId }] : []);
    const blocks = current.blocks.filter(value => row(value) && value.documentId === plan.documentId);
    if (blocks.length !== expected.length) return "block_membership";
    if (current.relations.some(value => row(value) && value.documentId === plan.documentId)) return "relation";
    for (const { payload, eventId } of expected) {
      const matches = blocks.filter(value => row(value) && value.id === payload.block_id);
      if (matches.length !== 1 || !row(matches[0])) return "block_membership";
      const block = matches[0];
      if (!(block.projectId === plan.projectId && block.scope === "document" && block.canvasId === "" && block.removed === false && block.locked === false
        && block.type === payload.type && block.handle === payload.handle && block.position === payload.position)) return "block_fields";
      if (canonicalJson(block.properties) !== canonicalJson(payload.properties)) return "properties";
      if (canonicalJson(block.sourceEvents) !== canonicalJson([eventId])) return "provenance";
    }
    return null;
  } catch { return "unreadable"; }
}
export function experienceSourceMatches(plan: ExperiencePlan, receipt: ExperienceIntakeReceipt, current: CurrentSource): boolean {
  return experienceSourceMismatch(plan, receipt, current) === null;
}
