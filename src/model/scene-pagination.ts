/** Pure packing of already measured literal lines. This does not measure text,
 * prove font coverage, verify source correspondence, or admit any export. */
export type MeasuredSceneGroup =
  | Readonly<{ role: "heading"; sourceIndex: -1; lines: readonly string[] }>
  | Readonly<{ role: "action"; sourceIndex: number; lines: readonly string[] }>
  | Readonly<{ role: "dialogue"; sourceIndex: number; speaker: "A" | "B";
      cueLines: readonly string[]; parentheticalLines: readonly string[]; lines: readonly string[] }>;

export const SCENE_PAGINATION_POLICY = Object.freeze({
  version: 1 as const,
  qualification: "packing-only" as const,
  pageWidthPt: 612,
  pageHeightPt: 792,
  marginTopPt: 72,
  marginBottomPt: 72,
  marginLeftPt: 108,
  marginRightPt: 72,
  usableHeightPt: 648,
  fontFamily: "DM Mono",
  fontSizePt: 12,
  lineHeightPt: 16,
  linesPerPage: 40,
  gapRows: 1,
  maximumQualifiedPages: 2,
  headingActionLeftPt: 108,
  headingActionWidthPt: 432,
  cueDialogueLeftPt: 216,
  cueDialogueWidthPt: 252,
  parentheticalLeftPt: 252,
  parentheticalWidthPt: 180,
  continuationMarker: "(CONT'D)",
  maximumGroups: 129,
  maximumSourceLines: 131_072,
  maximumLineCodeUnits: 16_384,
  maximumSourceCodeUnits: 262_144,
});

export type ScenePageLine = Readonly<{
  role: "heading" | "action" | "cue" | "parenthetical" | "dialogue" | "continuation";
  sourceIndex: number;
  /** Original index within the corresponding measured role; only the separate
   * derived continuation marker has no authored line index. */
  lineIndex: number | null;
  text: string;
  derived: boolean;
  speaker?: "A" | "B";
  row: number;
  leftPt: number;
  widthPt: number;
  /** Line-box top, not a claimed font baseline or a measured ink bound. */
  topPt: number;
}>;
export type ScenePage = Readonly<{
  pageNumber: number;
  usedRows: number;
  lines: readonly ScenePageLine[];
}>;
export type ScenePaginationResult =
  | Readonly<{ status: "packed" | "too-long"; policy: typeof SCENE_PAGINATION_POLICY;
      pages: readonly ScenePage[]; pageCount: number; sourceLineCount: number;
      derivedLineCount: number; gapRows: number; groups: readonly MeasuredSceneGroup[] }>
  | Readonly<{ status: "unqualified"; policy: typeof SCENE_PAGINATION_POLICY;
      reason: "invalid-measurement" | "heading-keep-too-tall" | "dialogue-keep-too-tall";
      sourceIndex: number | null; pages: readonly [] }>;

const P = SCENE_PAGINATION_POLICY;
const unqualified = (reason: Extract<ScenePaginationResult, { status: "unqualified" }>["reason"], sourceIndex: number | null): ScenePaginationResult =>
  Object.freeze({ status: "unqualified", policy: P, reason, sourceIndex, pages: Object.freeze([]) as readonly [] });

/** Capture only dense ordinary arrays through their own data descriptors.
 * Never invoke a caller's iterator or indexed getter while copying values. */
function capturedArray(value: unknown, minimum: number, maximum: number): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < minimum || length > maximum) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length + 1) return null;
  const captured: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    captured.push(descriptor.value);
  }
  return captured;
}

/** The caller owns measurement/source qualification. Strings are neither
 * normalized nor trimmed: empty lines, whitespace and Unicode stay literal.
 * A page count above two retains every page and reports too-long explicitly.
 * An impossible keep or malformed measurement produces no partial document. */
export function paginateSceneLines(input: readonly MeasuredSceneGroup[]): ScenePaginationResult {
  const inputs = capturedArray(input, 2, P.maximumGroups);
  if (!inputs) return unqualified("invalid-measurement", null);
  let sourceLineCount = 0, codeUnits = 0;
  const capturedLines = (value: unknown, allowEmpty: boolean): readonly string[] | null => {
    const values = capturedArray(value, allowEmpty ? 0 : 1, P.maximumSourceLines);
    if (!values) return null;
    const lines: string[] = [];
    for (const line of values) {
      if (typeof line !== "string" || line.length > P.maximumLineCodeUnits || /[\r\n]/u.test(line)) return null;
      sourceLineCount += 1; codeUnits += line.length;
      if (sourceLineCount > P.maximumSourceLines || codeUnits > P.maximumSourceCodeUnits) return null;
      lines.push(line);
    }
    return Object.freeze(lines);
  };
  const groups: MeasuredSceneGroup[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const group = inputs[index];
    if (!group || typeof group !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(group))) {
      return unqualified("invalid-measurement", index - 1);
    }
    const fields = Object.getOwnPropertyDescriptors(group);
    const role: unknown = fields.role?.value, sourceIndex: unknown = fields.sourceIndex?.value;
    const lines = capturedLines(fields.lines?.value, false);
    if (typeof sourceIndex !== "number" || sourceIndex !== index - 1 || !lines) return unqualified("invalid-measurement", index - 1);
    if (index === 0) {
      if (role !== "heading" || sourceIndex !== -1) return unqualified("invalid-measurement", -1);
      groups.push(Object.freeze({ role: "heading", sourceIndex: -1, lines }));
    } else if (role === "action") {
      groups.push(Object.freeze({ role: "action", sourceIndex, lines }));
    } else if (role === "dialogue" && index !== 1) {
      const speaker: unknown = fields.speaker?.value;
      const cueLines = capturedLines(fields.cueLines?.value, false), parentheticalLines = capturedLines(fields.parentheticalLines?.value, true);
      if ((speaker !== "A" && speaker !== "B") || !cueLines || !parentheticalLines) return unqualified("invalid-measurement", index - 1);
      groups.push(Object.freeze({ role: "dialogue", sourceIndex, speaker, cueLines, parentheticalLines, lines }));
    } else return unqualified("invalid-measurement", index - 1);
  }
  const heading = groups[0]!, firstAction = groups[1]!;
  if (heading.lines.length + P.gapRows + Math.min(2, firstAction.lines.length) > P.linesPerPage) {
    return unqualified("heading-keep-too-tall", -1);
  }
  for (const group of groups) {
    if (group.role !== "dialogue") continue;
    const firstKeep = group.cueLines.length + group.parentheticalLines.length + Math.min(2, group.lines.length);
    if (firstKeep > P.linesPerPage) return unqualified("dialogue-keep-too-tall", group.sourceIndex);
  }

  const pages: ScenePage[] = [];
  let lines: ScenePageLine[] = [], row = 0, derivedLineCount = 0, gapRows = 0;
  const finishPage = () => {
    if (!lines.length) return;
    pages.push(Object.freeze({ pageNumber: pages.length + 1, usedRows: row, lines: Object.freeze(lines) }));
    lines = []; row = 0;
  };
  const beginGroup = (keep: number) => {
    if (!row) return;
    if (row + P.gapRows + keep > P.linesPerPage) finishPage();
    else { row += P.gapRows; gapRows += P.gapRows; }
  };
  const append = (group: MeasuredSceneGroup, role: ScenePageLine["role"], text: string, lineIndex: number | null, derived = false) => {
    const parenthetical = role === "parenthetical", fullWidth = role === "heading" || role === "action";
    const leftPt = parenthetical ? P.parentheticalLeftPt : fullWidth ? P.headingActionLeftPt : P.cueDialogueLeftPt;
    const widthPt = parenthetical ? P.parentheticalWidthPt : fullWidth ? P.headingActionWidthPt : P.cueDialogueWidthPt;
    lines.push(Object.freeze({ role, sourceIndex: group.sourceIndex, lineIndex, text, derived,
      ...(group.role === "dialogue" ? { speaker: group.speaker } : {}),
      row, leftPt, widthPt, topPt: P.marginTopPt + row * P.lineHeightPt }));
    row += 1;
    if (derived) derivedLineCount += 1;
  };

  for (const group of groups) {
    if (group.role === "heading" || group.role === "action") {
      beginGroup(group.sourceIndex === 0 ? Math.min(2, group.lines.length) : 1);
      for (let index = 0; index < group.lines.length; index += 1) {
        if (row === P.linesPerPage) finishPage();
        append(group, group.role, group.lines[index]!, index);
      }
      continue;
    }
    let index = 0, continued = false;
    while (index < group.lines.length) {
      const prefix = group.cueLines.length + (continued ? 1 : group.parentheticalLines.length);
      if (continued && prefix + Math.min(2, group.lines.length - index) > P.linesPerPage) {
        return unqualified("dialogue-keep-too-tall", group.sourceIndex);
      }
      if (continued) finishPage();
      else beginGroup(prefix + Math.min(2, group.lines.length));
      for (let cueIndex = 0; cueIndex < group.cueLines.length; cueIndex += 1) {
        append(group, "cue", group.cueLines[cueIndex]!, cueIndex, continued);
      }
      if (continued) append(group, "continuation", P.continuationMarker, null, true);
      else for (let parentheticalIndex = 0; parentheticalIndex < group.parentheticalLines.length; parentheticalIndex += 1) {
        append(group, "parenthetical", group.parentheticalLines[parentheticalIndex]!, parentheticalIndex);
      }
      while (index < group.lines.length && row < P.linesPerPage) {
        append(group, "dialogue", group.lines[index]!, index); index += 1;
      }
      continued = true;
    }
  }
  finishPage();
  return Object.freeze({ status: pages.length > P.maximumQualifiedPages ? "too-long" : "packed",
    policy: P, pages: Object.freeze(pages), pageCount: pages.length, sourceLineCount, derivedLineCount, gapRows,
    groups: Object.freeze(groups) });
}
