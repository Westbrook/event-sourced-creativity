import { parseSceneScreenplay, sceneScreenplayText, type SceneDisplaySource } from "../model/scene-screenplay.ts";
import { SCENE_PAGINATION_POLICY as P, type MeasuredSceneGroup } from "../model/scene-pagination.ts";

export const SCENE_FONT_SHA256 = "55b4c98f123daebb3ed27947ba47b2af00554fc6284d639a540bcef5e6258ad2";
export const SCENE_FONT_URL = "/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf";
/** Generated from the unmodified, pinned DM Mono Regular cmap. Membership is
 * necessary, not sufficient: every wrapped line also receives an ink check. */
const FONT_RANGES: readonly (readonly [number, number])[] = [[13,13],[32,126],[160,263],[266,283],[286,291],[296,305],[310,311],[313,328],[332,347],[350,357],[360,382],[399,399],[402,402],[508,509],[536,539],[601,601],[710,711],[728,733],[768,772],[774,776],[778,780],[786,786],[806,808],[960,960],[7808,7813],[7868,7869],[7922,7923],[7928,7929],[8211,8212],[8216,8218],[8220,8222],[8224,8226],[8230,8230],[8240,8240],[8249,8250],[8260,8260],[8308,8308],[8364,8364],[8381,8381],[8467,8467],[8482,8482],[8486,8486],[8494,8494],[8706,8706],[8710,8710],[8719,8719],[8721,8722],[8725,8725],[8730,8730],[8734,8734],[8747,8747],[8776,8776],[8800,8800],[8804,8805],[9674,9674]];

export function uncoveredSceneGlyphs(text: string): readonly string[] {
  return [...new Set([...text].filter(character => character !== "\n" && !FONT_RANGES.some(([start, end]) => {
    const code = character.codePointAt(0)!; return code >= start && code <= end;
  })))];
}

export { wrapSceneText } from "../model/scene-text-wrap.ts";
import { wrapSceneText } from "../model/scene-text-wrap.ts";

type FontEntry = { face: FontFace; family: string; descriptors: string };
const fontDescriptors = (face: FontFace) => JSON.stringify([
  "family", "style", "weight", "stretch", "unicodeRange", "featureSettings", "variationSettings",
  "ascentOverride", "descentOverride", "lineGapOverride", "display",
].map(key => (face as unknown as Record<string, unknown>)[key]));
const fonts = new WeakMap<Document, Promise<FontEntry>>();
async function pinnedFont(bytes: ArrayBuffer, owner: Document): Promise<FontEntry> {
  if (bytes.byteLength !== 49_744) throw new Error("font-bytes");
  const copied = bytes.slice(0);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", copied))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== SCENE_FONT_SHA256) throw new Error("font-bytes");
  const cached = fonts.get(owner);
  if (cached) {
    const entry = await cached;
    if (entry.face.status === "loaded" && fontDescriptors(entry.face) === entry.descriptors) return entry;
    fonts.delete(owner);
  }
  const promise = (async () => {
    // Unique family avoids accidentally measuring an unrelated registered face.
    const family = "FormaScene-" + crypto.randomUUID();
    const face = new FontFace(family, copied, { style: "normal", weight: "400" });
    await face.load(); owner.fonts.add(face); return { face, family, descriptors: fontDescriptors(face) };
  })();
  fonts.set(owner, promise);
  try { return await promise; } catch (error) { fonts.delete(owner); throw error; }
}

/** Browser-only measurement dependency. It does not authorize, generate, save,
 * export, establish current-source custody, or assert 1–2 pages. A caller must
 * recheck its source/authority after this await and apply qualified pagination.
 * Unsupported content remains untouched and may still use a readable fallback
 * viewer; that fallback cannot carry this fixed-font page-count claim. */
export async function measureSceneScreenplay(value: unknown, source: unknown, fontBytes: ArrayBuffer, owner: Document = document) {
  const script = parseSceneScreenplay(value), body = sceneScreenplayText(script, source);
  if (!script || body === null) return { status: "unqualified" as const, reason: "invalid-scene" as const };
  const names = source as SceneDisplaySource;
  // Snapshot all caller-owned labels before the first asynchronous boundary.
  const heading = `${script.heading.setting} ${names.location} · ${script.heading.time}`;
  const cues = { A: `A · ${names.characters[0].name}`, B: `B · ${names.characters[1].name}` };
  const uncovered = uncoveredSceneGlyphs(body);
  if (uncovered.length) return { status: "unqualified" as const, reason: "uncovered-glyphs" as const, uncovered, body };
  let loaded: FontEntry;
  try { loaded = await pinnedFont(fontBytes, owner); }
  catch { return { status: "unqualified" as const, reason: "font-unavailable" as const, body }; }
  // The document may have cleared its FontFaceSet between measurements.
  // Never silently measure fallback typography from a stale cache entry.
  if (!owner.fonts.has(loaded.face)) owner.fonts.add(loaded.face);
  if (loaded.face.status !== "loaded" || fontDescriptors(loaded.face) !== loaded.descriptors)
    return { status: "unqualified" as const, reason: "font-unavailable" as const, body };
  const context = owner.createElement("canvas").getContext("2d");
  if (!context) return { status: "unqualified" as const, reason: "measurement-unavailable" as const, body };
  context.font = `400 ${P.fontSizePt * 4 / 3}px "${loaded.family}"`; context.fontKerning = "none"; context.textBaseline = "alphabetic";
  context.direction = "ltr"; context.textAlign = "left";
  const wrap = (text: string, points: number) => {
    const width = points * 4 / 3;
    const lines = wrapSceneText(text, width, line => context.measureText(line).width);
    // Advance width alone misses overhanging accents and other ink. A tiny
    // numerical tolerance is not layout padding or permission to clip text.
    if (lines?.some(line => {
      const ink = context.measureText(line);
      return !Number.isFinite(ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight)
        || ink.actualBoundingBoxLeft > 0.5 || ink.actualBoundingBoxRight > width + 0.5;
    })) return null;
    return lines;
  };
  const groups: MeasuredSceneGroup[] = [];
  const headingLines = wrap(heading, P.headingActionWidthPt);
  if (!headingLines) return { status: "unqualified" as const, reason: "line-overflow" as const, body };
  groups.push(Object.freeze({ sourceIndex: -1, role: "heading", lines: headingLines }));
  for (let index = 0; index < script.blocks.length; index++) {
    const block = script.blocks[index];
    const lines = wrap(block.text, block.kind === "action" ? P.headingActionWidthPt : P.cueDialogueWidthPt);
    if (!lines) return { status: "unqualified" as const, reason: "line-overflow" as const, body };
    if (block.kind === "action") groups.push(Object.freeze({ sourceIndex: index, role: "action", lines }));
    else {
      const cueLines = wrap(cues[block.speaker], P.cueDialogueWidthPt), parentheticalLines = block.parenthetical === null ? [] : wrap(`(${block.parenthetical})`, P.parentheticalWidthPt);
      if (!cueLines || !parentheticalLines) return { status: "unqualified" as const, reason: "line-overflow" as const, body };
      groups.push(Object.freeze({ sourceIndex: index, role: "dialogue", speaker: block.speaker, cueLines, parentheticalLines: Object.freeze(parentheticalLines), lines }));
    }
  }
  let ascent = 0, descent = 0;
  for (const group of groups) for (const lines of group.role === "dialogue" ? [group.cueLines, group.parentheticalLines, group.lines] : [group.lines]) for (const line of lines) {
    const metric = context.measureText(line);
    ascent = Math.max(ascent, metric.actualBoundingBoxAscent);
    descent = Math.max(descent, metric.actualBoundingBoxDescent);
  }
  // Compare global extrema, not each individual line: adjacent lines may use
  // different accents/descenders. Reserve half a CSS pixel of clear leading.
  if (!Number.isFinite(ascent + descent) || ascent + descent + 0.5 > P.lineHeightPt * 4 / 3)
    return { status: "unqualified" as const, reason: "ink-overflow" as const, body };
  return Object.freeze({ status: "measured" as const, fontSha256: SCENE_FONT_SHA256, fontFamily: loaded.family,
    fontSizePt: P.fontSizePt, lineHeightPt: P.lineHeightPt, groups: Object.freeze(groups), body,
    ink: Object.freeze({ ascentPx: ascent, descentPx: descent }), pageCount: null });
}
