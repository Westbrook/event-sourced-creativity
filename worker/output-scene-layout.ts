import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { parseSceneScreenplay, sceneScreenplayText, type SceneDisplaySource } from "../src/model/scene-screenplay.ts";
import { SCENE_PAGINATION_POLICY as P, paginateSceneLines, type MeasuredSceneGroup } from "../src/model/scene-pagination.ts";
import { wrapSceneText } from "../src/model/scene-text-wrap.ts";
import { SCENE_FONT_METRICS, SCENE_FONT_METRICS_SHA256 } from "./scene-font-metrics.ts";

// This function accepts original content, not caller-supplied lines, page counts
// or metric tables. Worker callers must supply independently retained source and
// exact pinned ASSETS bytes. A result alone never establishes that custody.
// Browser parity qualification is a separate release check, not client authority.
const sha = async (value: string | ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  typeof value === "string" ? new TextEncoder().encode(value) : value)), byte => byte.toString(16).padStart(2, "0")).join("");
const M = freeze(SCENE_FONT_METRICS);
const table: Readonly<Record<string, readonly [number, number, number, number, number]>> = M.glyphs;
const scale = P.fontSizePt * 4 / 3 / M.unitsPerEm;
const metric = (text: string) => {
  let advance = 0, left = 0, right = 0, ascent = 0, descent = 0;
  for (const character of text) {
    const [width, xMin, yMin, xMax, yMax] = table[String(character.codePointAt(0))]!;
    left = Math.min(left, advance + xMin); right = Math.max(right, advance + xMax);
    ascent = Math.max(ascent, yMax); descent = Math.max(descent, -yMin); advance += width;
  }
  return { width: advance * scale, left: -left * scale, right: right * scale, ascent: ascent * scale, descent: descent * scale };
};

/** Deterministic fixed-font layout candidate. Until trusted custody and actual
 * browser parity are joined, this is not a fulfilled output requirement. No
 * source text is trimmed, normalized, substituted, truncated or regenerated. */
export async function measureOutputSceneLayout(rawScript: unknown, rawSource: unknown, fontBytes: ArrayBuffer) {
  const script = parseSceneScreenplay(rawScript), body = sceneScreenplayText(script, rawSource);
  if (!script || body === null) return freeze({ status: "unqualified" as const, reason: "invalid-scene" as const });
  const source = rawSource as SceneDisplaySource;
  // Capture every source label and byte before hashing yields.
  const capturedSource = freeze({ characters: [{ id: "A" as const, name: source.characters[0].name }, { id: "B" as const, name: source.characters[1].name }], location: source.location });
  const heading = `${script.heading.setting} ${capturedSource.location} · ${script.heading.time}`;
  const cues = { A: `A · ${capturedSource.characters[0].name}`, B: `B · ${capturedSource.characters[1].name}` };
  const rejected = [...new Set([...body].filter(c => c !== "\n" && !Object.hasOwn(table, String(c.codePointAt(0)))))];
  if (rejected.length) return freeze({ status: "unqualified" as const, reason: "unsupported-profile" as const, body, rejected });
  if (M.forbiddenSequences.some(sequence => body.includes(sequence)))
    return freeze({ status: "unqualified" as const, reason: "shaping-required" as const, body });
  if (!(fontBytes instanceof ArrayBuffer) || fontBytes.byteLength !== M.fontBytes)
    return freeze({ status: "unqualified" as const, reason: "font-unavailable" as const, body });
  const copiedFont = fontBytes.slice(0);
  const [fontHash, metricHash, scriptHash, bodyHash, sourceHash, policyHash] = await Promise.all([
    sha(copiedFont), sha(canonicalJson(M)), sha(canonicalJson(script)), sha(body), sha(canonicalJson(capturedSource)), sha(canonicalJson(P)),
  ]);
  if (fontHash !== M.fontSha256 || metricHash !== SCENE_FONT_METRICS_SHA256)
    return freeze({ status: "unqualified" as const, reason: "font-unavailable" as const, body });
  const wrap = (text: string, widthPt: number) => {
    const width = widthPt * 4 / 3, lines = wrapSceneText(text, width, line => metric(line).width);
    if (lines?.some(line => { const ink = metric(line); return ink.left > 0.5 || ink.right > width + 0.5; })) return null;
    return lines;
  };
  const groups: MeasuredSceneGroup[] = [], headingLines = wrap(heading, P.headingActionWidthPt);
  if (!headingLines) return freeze({ status: "unqualified" as const, reason: "line-overflow" as const, body });
  groups.push({ role: "heading", sourceIndex: -1, lines: headingLines });
  for (let index = 0; index < script.blocks.length; index++) {
    const block = script.blocks[index], lines = wrap(block.text, block.kind === "action" ? P.headingActionWidthPt : P.cueDialogueWidthPt);
    if (!lines) return freeze({ status: "unqualified" as const, reason: "line-overflow" as const, body });
    if (block.kind === "action") groups.push({ role: "action", sourceIndex: index, lines });
    else {
      const cueLines = wrap(cues[block.speaker], P.cueDialogueWidthPt), parentheticalLines = block.parenthetical === null ? [] : wrap(`(${block.parenthetical})`, P.parentheticalWidthPt);
      if (!cueLines || !parentheticalLines) return freeze({ status: "unqualified" as const, reason: "line-overflow" as const, body });
      groups.push({ role: "dialogue", sourceIndex: index, speaker: block.speaker, cueLines, parentheticalLines, lines });
    }
  }
  let ascent = 0, descent = 0;
  for (const group of groups) for (const lines of group.role === "dialogue" ? [group.cueLines, group.parentheticalLines, group.lines] : [group.lines]) for (const line of lines) {
    const ink = metric(line); ascent = Math.max(ascent, ink.ascent); descent = Math.max(descent, ink.descent);
  }
  // Include the derived continuation marker in the same fixed-cell envelope.
  const continuationInk = metric(P.continuationMarker); ascent = Math.max(ascent, continuationInk.ascent); descent = Math.max(descent, continuationInk.descent);
  if (ascent + descent + 0.5 > P.lineHeightPt * 4 / 3)
    return freeze({ status: "unqualified" as const, reason: "ink-overflow" as const, body });
  const pagination = paginateSceneLines(groups);
  if (pagination.status === "unqualified") return freeze({ status: "unqualified" as const, reason: pagination.reason, body });
  return freeze({ status: "layout-candidate" as const, qualification: "measurement-only" as const, profile: M.profile,
    body, screenplaySha256: scriptHash, bodySha256: bodyHash, displaySourceSha256: sourceHash,
    fontSha256: fontHash, metricsSha256: metricHash, policySha256: policyHash,
    pagesSha256: await sha(canonicalJson(pagination.pages)), pagination,
    pageRangeSatisfied: pagination.status === "packed" && pagination.pageCount >= 1 && pagination.pageCount <= 2,
    requirementFulfilled: false as const });
}
