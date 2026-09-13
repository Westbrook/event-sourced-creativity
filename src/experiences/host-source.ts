import { canonicalJson } from "./compiler.ts";
import type { ExperiencePlan } from "./intake.ts";
import type { ExperienceIntakeReceipt } from "./native-host.ts";
type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => Boolean(value && typeof value === "object" && !Array.isArray(value));
/** Compare only an already server-validated intake/receipt to current canonical source.
 * This grants no authorization, generation or delivery. Extra/edited source fails closed. */
export function experienceSourceMatches(plan: ExperiencePlan, receipt: ExperienceIntakeReceipt, current: {
  documentId: string; projectId: string; documents: readonly unknown[]; blocks: readonly unknown[];
  relations: readonly unknown[]; events: readonly unknown[];
}): boolean {
  try {
    if (!["image", "slides", "short_story", "scene", "audio", "storyboard", "video"].includes(plan.release.output.output) || current.documentId !== plan.documentId || current.projectId !== plan.projectId
      || receipt.documentId !== plan.documentId || receipt.projectId !== plan.projectId || receipt.draftHash !== plan.draftHash || receipt.draftId !== plan.draftId) return false;
    const documents = current.documents.filter(value => row(value) && value.id === plan.documentId);
    if (documents.length !== 1 || !row(documents[0]) || documents[0].removed !== false || documents[0].projectId !== plan.projectId || documents[0].title !== plan.title) return false;
    const appended = receipt.appended;
    if (appended.length !== plan.events.length || new Set(appended.map(event => event.eventId)).size !== appended.length) return false;
    for (const [index, event] of appended.entries()) {
      const found = current.events.filter(candidate => row(candidate) && candidate.eventId === event.eventId);
      if (found.length !== 1 || !row(found[0]) || found[0].streamId !== plan.streamId || found[0].actor !== "user"
        || found[0].type !== plan.events[index]!.type || found[0].sequence !== event.sequence
        || canonicalJson(found[0].payload) !== canonicalJson(plan.events[index]!.payload)) return false;
    }
    const expected = plan.events.flatMap((event, index) => event.type === "BlockCreated" ? [{ payload: event.payload, eventId: appended[index]!.eventId }] : []);
    const blocks = current.blocks.filter(value => row(value) && value.documentId === plan.documentId);
    if (blocks.length !== expected.length || current.relations.some(value => row(value) && value.documentId === plan.documentId)) return false;
    return expected.every(({ payload, eventId }) => {
      const matches = blocks.filter(value => row(value) && value.id === payload.block_id);
      if (matches.length !== 1 || !row(matches[0])) return false;
      const block = matches[0];
      return block.projectId === plan.projectId && block.scope === "document" && block.canvasId === "" && block.removed === false && block.locked === false
        && block.type === payload.type && block.handle === payload.handle && block.position === payload.position
        && canonicalJson(block.properties) === canonicalJson(payload.properties)
        && canonicalJson(block.sourceEvents) === canonicalJson([eventId]);
    });
  } catch { return false; }
}
