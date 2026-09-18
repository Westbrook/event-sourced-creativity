/** Structural Scene content only. A successful parse proves neither semantic
 * fidelity nor printed page count, and never admits generation or export. */
export type SceneScreenplay = Readonly<{
  schemaVersion: 1;
  format: "forma-screenplay@1";
  heading: Readonly<{ setting: "INT." | "EXT." | "INT./EXT."; location: "location"; time: string }>;
  blocks: readonly (
    | Readonly<{ kind: "action"; text: string }>
    | Readonly<{ kind: "dialogue"; speaker: "A" | "B"; parenthetical: string | null; text: string }>
  )[];
}>;
export type SceneDisplaySource = Readonly<{
  characters: readonly [Readonly<{ id: "A"; name: string }>, Readonly<{ id: "B"; name: string }>];
  location: string;
}>;
const MAX_BLOCKS = 128;
const MAX_TEXT_BYTES = 65_536;

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length
    && keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key]);
}
function array(value: unknown, min: number, max: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === value.length + 1
    && Array.from({ length: value.length }, (_, index) => descriptors[String(index)]).every(item => item?.enumerable && "value" in item);
}
function text(value: unknown, max: number): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return false;
  // LF is literal content, not a new block. Unicode text, combining marks and
  // script/emoji joiners survive unchanged. Refuse directional override/isolate
  // controls, invalid surrogate code units and CR; never strip or normalize.
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\uD800-\uDFFF]/u.test(value);
}

/** Closed, bounded schema; no headings inside the block stream, speaker-name
 * matching, unknown participants, or provider-selected location references.
 * Literal prose can still mention another person/place: that requires review. */
export function parseSceneScreenplay(value: unknown): SceneScreenplay | null {
  if (!record(value, ["schemaVersion", "format", "heading", "blocks"]) || value.schemaVersion !== 1 || value.format !== "forma-screenplay@1"
    || !record(value.heading, ["setting", "location", "time"]) || typeof value.heading.setting !== "string" || !["INT.", "EXT.", "INT./EXT."].includes(value.heading.setting)
    || value.heading.location !== "location" || !text(value.heading.time, 80) || value.heading.time.includes("\n")
    || !array(value.blocks, 3, MAX_BLOCKS)) return null;
  // Read only validated primitive values. Never coerce a provider object.
  const heading = Object.freeze({ setting: value.heading.setting as SceneScreenplay["heading"]["setting"], location: "location" as const, time: value.heading.time });
  const blocks: SceneScreenplay["blocks"][number][] = [];
  const speakers = new Set<string>(); let action = false, bytes = new TextEncoder().encode(heading.time).length;
  for (const block of value.blocks) {
    if (record(block, ["kind", "text"]) && block.kind === "action" && text(block.text, 8192)) {
      action = true; bytes += new TextEncoder().encode(block.text).length;
      blocks.push(Object.freeze({ kind: "action", text: block.text }));
    } else if (record(block, ["kind", "speaker", "parenthetical", "text"]) && block.kind === "dialogue"
      && (block.speaker === "A" || block.speaker === "B") && text(block.text, 8192)
      && (block.parenthetical === null || text(block.parenthetical, 600))) {
      speakers.add(block.speaker); bytes += new TextEncoder().encode(block.text).length + new TextEncoder().encode(block.parenthetical ?? "").length;
      blocks.push(Object.freeze({ kind: "dialogue", speaker: block.speaker, parenthetical: block.parenthetical, text: block.text }));
    } else return null;
    if (bytes > MAX_TEXT_BYTES) return null;
  }
  if (!action || speakers.size !== 2 || blocks[0]?.kind !== "action") return null;
  return Object.freeze({ schemaVersion: 1, format: "forma-screenplay@1", heading, blocks: Object.freeze(blocks) });
}

/** A lossless literal-text projection for the existing document content field,
 * not HTML or Markdown rendering. Consumers must render as literal text.
 * A/B cues remain distinct even when authored names are equal. The caller must
 * bind these display values to its exact captured intake/current source. */
export function sceneScreenplayText(value: unknown, source: unknown): string | null {
  const script = parseSceneScreenplay(value);
  if (!script || !record(source, ["characters", "location"]) || !text(source.location, 600) || !array(source.characters, 2, 2)) return null;
  const [a, b] = source.characters;
  if (!record(a, ["id", "name"]) || a.id !== "A" || !text(a.name, 80) || !record(b, ["id", "name"]) || b.id !== "B" || !text(b.name, 80)) return null;
  const cue = { A: `A · ${a.name}`, B: `B · ${b.name}` };
  const body = script.blocks.map(block => block.kind === "action" ? block.text
    : [cue[block.speaker], ...(block.parenthetical === null ? [] : [`(${block.parenthetical})`]), block.text].join("\n"));
  return [`${script.heading.setting} ${source.location} · ${script.heading.time}`, ...body].join("\n\n");
}
