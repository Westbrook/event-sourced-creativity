import type { DecisionValue } from "./contracts.ts";

type Values = Readonly<Record<string, DecisionValue>>;
/** Stable A/B labels keep equal names distinct. No inferred secret or participant. */
export function sceneCharacterLabel(values: Values, participant: "A" | "B") {
  const name = values[`character${participant}`]?.value;
  return `${participant}${typeof name === "string" && name.trim() ? ` · ${name.trim()}` : ""}`;
}
export function sceneKnowledgeLabel(values: Values, value: unknown) {
  if (value === "both") return `Both · ${sceneCharacterLabel(values, "A")} / ${sceneCharacterLabel(values, "B")}`;
  if (value === "a" || value === "b") return sceneCharacterLabel(values, value === "a" ? "A" : "B");
  throw new Error("experience_scene_knowledge_invalid");
}
/** Existing typed blocks carry explicit participant scope in readable context.
 * Structured choices remain in experience_value; no new relation schema is minted. */
export function sceneDecisionText(values: Values, id: string, text: string) {
  if (id === "characterA" || id === "characterB") return `Character ${id.endsWith("A") ? "A" : "B"}: ${text}`;
  if (id === "goalA" || id === "goalB") return `Character ${sceneCharacterLabel(values, id.endsWith("A") ? "A" : "B")}\nGoal: ${text}`;
  if (id === "knowledge") return `Secret knowledge: ${sceneKnowledgeLabel(values, values.knowledge.value)}`;
  if (id === "secret") return `Secret: ${text}`;
  return text;
}
