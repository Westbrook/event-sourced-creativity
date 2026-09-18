import { digest, freeze } from "../src/experiences/compiler.ts";
import { validateIntakeRequest } from "../src/experiences/intake.ts";
import type { DecisionValue } from "../src/experiences/contracts.ts";

type TextDecision = Readonly<{ value: string; provenance: DecisionValue["provenance"] }>;
type Participant = Readonly<{ id: "A" | "B"; name: TextDecision; goal: TextDecision }>;
export type ExperienceSceneIntent = Readonly<{
  schemaVersion: 1;
  qualification: "intent-only";
  source: Readonly<{ intentId: string; releaseHash: string; requestDigest: string }>;
  output: Readonly<{
    artifactKind: "scene";
    productionMode: "manual";
    medium: "visual";
    sceneCount: 1;
    characterCount: 2;
    locationCount: 1;
    format: "screenplay";
    content: readonly ["action", "dialogue"];
    pageRange: Readonly<{ min: 1; max: 2 }>;
    /** No screenplay print-layout policy is qualified yet. This is not a word
     * count, a provider orchestration page count, or a completed-output claim. */
    paginationPolicy: null;
  }>;
  characters: readonly [Participant, Participant];
  location: TextDecision;
  secret: TextDecision;
  knowledge: Readonly<{ value: "a" | "b" | "both"; provenance: DecisionValue["provenance"] }>;
  tension: Readonly<{ value: "restrained" | "explosive"; provenance: DecisionValue["provenance"] }>;
}>;

/** Capture the registered Scene intake, not arbitrary document prose. Every
 * value and its provenance survives unchanged; equal names never merge A/B.
 * The digest binds only this intake request. It is not the current document's
 * source digest, an original job identity, generation permission or acceptance.
 * No caller is enabled until the governed Scene execution bridge is qualified. */
export async function captureExperienceSceneIntent(value: unknown): Promise<ExperienceSceneIntent | null> {
  const valid = await validateIntakeRequest(value);
  if (!valid || valid.request.experienceId !== "scene" || valid.release.output.output !== "scene") return null;
  const { request } = valid, values = request.values;
  const text = (id: string): TextDecision | null => {
    const decision = values[id];
    return decision && typeof decision.value === "string" ? { value: decision.value, provenance: decision.provenance } : null;
  };
  const nameA = text("characterA"), goalA = text("goalA"), nameB = text("characterB"), goalB = text("goalB");
  const location = text("location"), secret = text("secret"), knowledge = text("knowledge"), tension = text("tension");
  if (!nameA || !goalA || !nameB || !goalB || !location || !secret || !knowledge || !tension
    || knowledge.value !== "a" && knowledge.value !== "b" && knowledge.value !== "both"
    || tension.value !== "restrained" && tension.value !== "explosive") return null;
  return freeze({
    schemaVersion: 1, qualification: "intent-only",
    source: { intentId: request.intentId, releaseHash: request.releaseHash, requestDigest: await digest(request) },
    output: { artifactKind: "scene", productionMode: "manual", medium: "visual", sceneCount: 1, characterCount: 2,
      locationCount: 1, format: "screenplay", content: ["action", "dialogue"], pageRange: { min: 1, max: 2 }, paginationPolicy: null },
    characters: [{ id: "A", name: nameA, goal: goalA }, { id: "B", name: nameB, goal: goalB }], location, secret,
    knowledge: { value: knowledge.value, provenance: knowledge.provenance },
    tension: { value: tension.value, provenance: tension.provenance },
  });
}
