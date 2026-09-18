import { isOutputContextType, parseOutputRequirement } from "./output-requirements.ts";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const influenceProperties = new Set(["weight", "influence", "intent", "effect"]);

/** New prose/imports become drafts only. Unknown versions stay opaque, inspectable and non-executable. */
export function normalizeOutputRequirementCreation(payload: Record<string, unknown>): Record<string, unknown> {
  if (!isOutputContextType(payload.type)) return payload;
  const properties = record(payload.properties) ? { ...payload.properties } : {};
  for (const key of influenceProperties) delete properties[key];
  if (!Object.hasOwn(properties, "output_spec")) {
    const parsed = parseOutputRequirement({
      id: String(payload.block_id ?? ""), type: "output", content: typeof properties.text === "string" ? properties.text : "",
      subtype: typeof properties.subtype === "string" ? properties.subtype : "Custom deliverables",
    });
    if (parsed.spec) properties.output_spec = parsed.spec;
  }
  // Do not normalize an unsupported schema into schema 1 or fabricate confirmation/approval.
  return { ...payload, type: "output", properties };
}
