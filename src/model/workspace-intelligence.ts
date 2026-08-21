import type { CreativeBlock, CreativeEvent, CreativeOutput } from "./events.ts";
import type { DocumentArtifact } from "./document-artifacts.ts";
import { unfinishedIntentTrajectories } from "./intent-trajectories.ts";
import { promptFactIsActive } from "./prompt-policy.ts";

export type CreativeNextActionId = "add-context" | "make-draft" | "compare-images" | "refine-image" | "create-output" | "reuse-output" | "review-failure" | "resume-intent";
export type CreativeNextAction = { id: CreativeNextActionId; label: string; reason: string; priority: number; evidence: number };
export type CreativeWorkspaceFacts = { blocks: readonly CreativeBlock[]; outputs: readonly CreativeOutput[]; artifacts: readonly DocumentArtifact[]; failedOperations?: number; events?: readonly CreativeEvent[]; documentId?: string; projectId?: string };
export type ProposedCreativeChange = { type: string; payload: Record<string, unknown> };

const readableLabel = (value: unknown) => String(value ?? "creative decision")
  .replace(/[_-]+/g, " ")
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .trim()
  .toLocaleLowerCase();

/** Explain an unaccepted mutation using authored meaning instead of event names or IDs. */
export function describeCreativeProposal(changes: readonly ProposedCreativeChange[]): string[] {
  return changes.map(({ type, payload }) => {
    const properties = payload.properties && typeof payload.properties === "object" && !Array.isArray(payload.properties)
      ? payload.properties as Record<string, unknown>
      : {};
    if (type === "BlockCreated") {
      const label = readableLabel(payload.type);
      const value = String(properties.text ?? properties.label ?? "").trim();
      return value ? `Add ${label}: “${value}”` : `Add a ${label}`;
    }
    if (type === "BlockPropertyEdited") {
      const property = readableLabel(payload.property_path);
      const before = String(payload.old_value ?? "").trim();
      const after = String(payload.new_value ?? "").trim();
      return before && after ? `Change ${property} from ${before} to ${after}` : after ? `Set ${property} to ${after}` : `Update ${property}`;
    }
    if (type === "BlockRemoved") return "Remove a creative decision";
    if (type === "BlockReordered") return "Reorder the creative decisions";
    return `Update ${readableLabel(type.replace(/(?:Created|Edited|Removed|Changed|Updated)$/, ""))}`;
  });
}

/** Pure intent/readiness model: recommend user outcomes, never implementation machinery. */
export function creativeNextActions(facts: CreativeWorkspaceFacts): CreativeNextAction[] {
  const activeBlocks = facts.blocks.filter(promptFactIsActive);
  const comparableOutputs = facts.outputs.filter((output) => !output.promptFanId || output.standalone);
  const drafts = facts.outputs.filter((output) => output.purpose === "ideate" || output.quality === "low");
  const finished = facts.outputs.filter((output) => output.purpose !== "ideate" && output.quality !== "low");
  const retained = facts.outputs.filter((output) => output.saved || output.pinned || output.library);
  const actions: CreativeNextAction[] = [];
  const unfinished = facts.events ? unfinishedIntentTrajectories(facts.events, { documentId: facts.documentId, projectId: facts.projectId }).find((trajectory) => trajectory.nextAction && (trajectory.authority === "explicit" || trajectory.authority === "authored" && trajectory.expectedOutputKind !== "context" && trajectory.steps.some((step) => (step.actor === "user" || step.actor.startsWith("user:")) && /^(GenerationRequested|DocumentRenderRequested)$/.test(step.type)))) : undefined;
  if (unfinished?.nextAction) actions.push({ id: "resume-intent", label: unfinished.nextAction.label, reason: unfinished.nextAction.reason, priority: unfinished.nextAction.priority + 10, evidence: unfinished.sourceEventIds.length });
  if ((facts.failedOperations ?? 0) > 0) actions.push({ id: "review-failure", label: "Review unfinished work", reason: "Understand what blocked a previous result before spending more.", priority: 100, evidence: facts.failedOperations ?? 0 });
  if (!activeBlocks.length) actions.push({ id: "add-context", label: "Describe the direction", reason: "A clear decision gives every future result something meaningful to follow.", priority: 90, evidence: 0 });
  if (activeBlocks.length && !facts.outputs.length) actions.push({ id: "make-draft", label: "Try a first draft", reason: `${activeBlocks.length} creative decision${activeBlocks.length === 1 ? " is" : "s are"} ready to explore visually.`, priority: 85, evidence: activeBlocks.length });
  if (comparableOutputs.length >= 2) actions.push({ id: "compare-images", label: "Compare directions", reason: "Looking at alternatives together makes the next refinement easier to choose.", priority: retained.length ? 48 : 76, evidence: comparableOutputs.length });
  if (drafts.length && !finished.length) actions.push({ id: "refine-image", label: "Take the strongest draft further", reason: "A promising exploration can become a finished result without starting over.", priority: 80, evidence: drafts.length });
  if (activeBlocks.length && !facts.artifacts.length) actions.push({ id: "create-output", label: "Explore another format", reason: "The same work can become a story, scene, presentation, storyboard, or video.", priority: 58, evidence: activeBlocks.length });
  if (facts.artifacts.length || retained.length) actions.push({ id: "reuse-output", label: "Build on an existing result", reason: "Any finished output can become precise context for the next piece of work.", priority: 64, evidence: facts.artifacts.length + retained.length });
  return actions.sort((left, right) => right.priority - left.priority).slice(0, 3);
}
