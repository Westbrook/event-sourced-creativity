import { promptFactIsActive } from "../src/model/prompt-policy.ts";
import { requiredContextAdaptationFacts } from "../src/model/context-adaptation.ts";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};

export type VideoSourceInterpretation = {
  sourceBlockId: string;
  sourceField: string;
  disposition: "separate-output-catalog";
  destination: "visual-catalog";
  originalText: string;
  providerText: string;
};

const counts: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const catalogFormats = [
  ["Image", /\b(?:image|illustration|photograph)\b/iu],
  ["Narrative", /\b(?:narrative|short story)\b/iu],
  ["Screenplay scene", /\b(?:screenplay|dialogue scene)\b/iu],
  ["Slides", /\b(?:slides?|presentation)\b/iu],
  ["Storyboard", /\bstoryboard\b/iu],
  ["Video", /\b(?:video|film|cinematic scene reel)\b/iu],
  ["Audio", /\b(?:audio|soundtrack)\b/iu],
] as const;

const descriptorWords: Record<string, Set<string>> = {
  Image: new Set(["image", "illustration", "photograph", "polished"]),
  Narrative: new Set(["editorial", "narrative", "short", "story"]),
  "Screenplay scene": new Set(["screenplay", "scene", "playable", "dialogue"]),
  Slides: new Set(["slide", "slides", "presentation", "executive", "deck"]),
  Storyboard: new Set(["storyboard", "frame", "frames"]),
  Video: new Set(["video", "film", "cinematic", "scene", "scenes", "shot", "shots", "reel", "role", "guided", "landscape", "portrait", "motion", "study"]),
  Audio: new Set(["audio", "soundtrack", "recording", "instrumental", "full", "length"]),
};
const commonDescriptorWords = new Set(["a", "an", "the", "this", "original", "approximately", "about", "second", "seconds", ...Object.keys(counts)]);

function catalogStartsSentence(value: string, index: number) {
  const prefix = value.slice(0, index);
  return !prefix.trim() || /[.!?]\s*$/u.test(prefix)
    || /(?:^|\n)(?:#{1,6}[ \t]+[^\n]+|(?:slide|section|chapter)[ \t]+\d+[ \t]*[—:-][^\n]+)\n[ \t]*$/iu.test(prefix);
}

function catalogDescriptor(value: string) {
  if (!/^[A-Za-z0-9\s:.,-]+$/u.test(value)) return null;
  const matches = catalogFormats.filter(([, pattern]) => pattern.test(value));
  if (matches.length !== 1) return null;
  const label = matches[0]![0];
  const words = value.toLowerCase().replace(/\b\d+(?:[.:]\d+)*(?:p)?\b/gu, "").split(/[^a-z]+/u).filter(Boolean);
  return words.every((word) => commonDescriptorWords.has(word) || descriptorWords[label]!.has(word)) ? label : null;
}

/** Recognize an explicit numbered multi-output catalog, not arbitrary audio prose. */
function outputCatalog(value: string) {
  const header = /\b(?:produce|create|deliver)\s+(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\b[^:\n]{0,180}\b(?:outcomes|outputs|deliverables)\b[^:\n]{0,120}:\s*(?=\(1\))/iu.exec(value);
  if (!header || header.index === undefined) return null;
  if (!catalogStartsSentence(value, header.index)) return null;
  if (!/^[A-Za-z0-9\s,:-]+$/u.test(header[0])) return null;
  const count = counts[header[1]!.toLowerCase()] ?? Number(header[1]);
  if (count < 3 || count > 12) return null;
  const headerWords = new Set(["produce", "create", "deliver", "coordinated", "clearly", "distinct", "separate", "intended", "outcomes", "outputs", "deliverables", "from", "this", "one", "shared", "source", "the", "a", ...Object.keys(counts)]);
  if (header[0].toLowerCase().replace(/\d+/gu, "").split(/[^a-z]+/u).filter(Boolean).some((word) => !headerWords.has(word))) return null;
  const tail = value.slice(header.index + header[0].length);
  const markers = [...tail.matchAll(/\((\d{1,2})\)\s*/gu)].slice(0, count);
  if (markers.length !== count || markers.some((marker, index) => Number(marker[1]) !== index + 1)) return null;
  const last = markers.at(-1)!;
  const lastStart = last.index! + last[0].length;
  const terminator = /[.!?][’”"']?(?=\s|$)/u.exec(tail.slice(lastStart));
  if (!terminator || terminator.index > 500) return null;
  const end = lastStart + terminator.index + terminator[0].length;
  const labels: string[] = [];
  for (const [index, marker] of markers.entries()) {
    const entry = tail.slice(marker.index! + marker[0].length, markers[index + 1]?.index ?? end).trim();
    if (index < count - 1 && !entry.endsWith(";")) return null;
    // Consume the entire entry: a closed descriptor and an optional balanced
    // title. Any suffix, imperative, or unparsed qualifier fails closed.
    const closed = entry.replace(/[;.]\s*$/u, "").trim();
    const titled = /^([^‘’“”"']+)\s+(?:‘([^‘’]+)’|“([^“”]+)”|"([^"\n]+)"|'([^'\n]+)')$/u.exec(closed);
    if (!titled) return null;
    const label = catalogDescriptor(titled[1]!.trim());
    if (!label) return null;
    const title = titled[2] ?? titled[3] ?? titled[4] ?? titled[5]!;
    labels.push(`${label} — “${title}”`);
  }
  const formats = labels.map((label) => label.split(" — ")[0]);
  if (!formats.includes("Video") || new Set(formats).size !== formats.length) return null;
  const originalText = value.slice(header.index, header.index + header[0].length + end);
  const providerText = `Visual catalog of ${count} distinct intended output forms: ${labels.map((label) => `Visible card: ${label}`).join("; ")}. These are separate deliverables, not additional sound instructions for this video.`;
  return { originalText, providerText };
}

/** A clearly labeled proposed package is reference information, not sound playback. */
function proposedOutputCatalog(value: string) {
  const match = /\b(?:the\s+)?(?:proposed|planned|intended)\s+(?:shared-source\s+)?(?:package|output set|deliverables)\s+includes\s+([^.!?;\n]{30,900})[.!?]/iu.exec(value);
  if (!match) return null;
  if (!catalogStartsSentence(value, match.index)) return null;
  const labels = match[1]!.split(/,\s*/u).map((entry) => catalogDescriptor(entry.replace(/^and\s+/iu, "").trim()));
  if (labels.length < 3 || labels.some((label) => !label) || new Set(labels).size !== labels.length || !labels.includes("Video") || !labels.includes("Audio")) return null;
  return { originalText: match[0], providerText: `Visual catalog of distinct proposed output forms, represented as labeled cards: ${labels.join("; ")}. These are separate intended deliverables.` };
}

/** Preserve authoritative input; record every narrowly scoped provider interpretation. */
export function videoOutputScopedContext(snapshot: RecordValue) {
  const interpretations: VideoSourceInterpretation[] = [];
  const required = new Set(requiredContextAdaptationFacts(snapshot).map((decision) => decision.fact));
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts.map((value) => {
    const fact = record(value), properties = record(fact.properties);
    if (!["format", "direction"].includes(String(fact.type)) || !promptFactIsActive(fact) || required.has(fact) || !String(fact.block_id ?? "").trim()
      || [fact.intent, fact.effect, properties.intent].some((intent) => /^(?:avoid|prohibit|must_not_include)$/u.test(String(intent ?? "")))) return value;
    const updated = { ...properties };
    for (const field of ["text", "instruction", "description", "value"]) {
      if (typeof properties[field] !== "string") continue;
      const catalog = outputCatalog(properties[field]) ?? proposedOutputCatalog(properties[field]);
      if (!catalog) continue;
      updated[field] = properties[field].replace(catalog.originalText, catalog.providerText);
      interpretations.push({ sourceBlockId: String(fact.block_id ?? ""), sourceField: field, disposition: "separate-output-catalog", destination: "visual-catalog", ...catalog });
    }
    return { ...fact, properties: updated };
  }) : snapshot.facts;
  return { snapshot: { ...snapshot, ...(Array.isArray(facts) ? { facts } : {}) }, interpretations };
}

/** Only exact source-proven catalog passages may be reinterpreted in scene copy. */
export function applyVideoSourceInterpretations(value: string, interpretations: VideoSourceInterpretation[]) {
  return interpretations.reduce((text, item) => text.replaceAll(item.originalText, item.providerText), value);
}

/** Project duplicated planner copy without changing the authoritative plan. */
export function projectVideoSourceCopy<T>(value: T, interpretations: VideoSourceInterpretation[]): T {
  if (!interpretations.length) return value;
  if (typeof value === "string") return applyVideoSourceInterpretations(value, interpretations) as T;
  if (Array.isArray(value)) return value.map((item) => projectVideoSourceCopy(item, interpretations)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, projectVideoSourceCopy(item, interpretations)])) as T;
  return value;
}
