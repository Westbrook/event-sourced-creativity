import type { OutputTermsRow } from "./output-terms.ts";

// Only closed system-authored descriptions are translated. Never translate an
// authored prompt, reference hash/MIME, original ID or provider/model identifier,
// even when that literal happens to match a catalog message.
const labels = new Set(["Output", "Generation calls", "Subject", "Source files", "Settings", "Result review", "After uncertain response"]);
const values = new Set([
  "1 static GLB assembly",
  "1 Rodin request · No planner or automatic retry",
  "One requested object; structural checks do not prove semantic object count",
  "1 owned image or saved PNG view; no mesh transfer",
  "None",
  "Gen-2.5-High · GLB · Auto mesh · No HD pack",
  "Static rooted assembly, not semantic-object or visual-quality acceptance",
  "No additional paid request"
]);
export function model3dTermIsInterfaceCopy(row: OutputTermsRow): boolean {
  return labels.has(row.label) && values.has(row.value);
}
