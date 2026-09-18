import { canonicalJson } from "./compiler.ts";
import { parseSceneScreenplay, sceneScreenplayText, type SceneDisplaySource, type SceneScreenplay } from "../model/scene-screenplay.ts";

/** Supplied by the original native result/source association, not a provider
 * field or a URL. This module verifies bytes; it cannot establish that trust. */
export type ExperienceSceneReadSelection = Readonly<{
  documentId: string; artifactId: string; revision: 0; contentSha256: string;
  screenplaySha256: string; bodySha256: string; displaySource: SceneDisplaySource;
  expiresAt: string;
}>;
export type ExperienceSceneContent = Readonly<{
  qualification: "content-only"; title: string; body: string; screenplay: SceneScreenplay;
  selection: ExperienceSceneReadSelection;
}>;

const encoder = new TextEncoder();
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");

/** Copy fixed enumerable data fields without reading getters or iterators. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function displaySource(value: unknown): SceneDisplaySource | null {
  const source = fields(value, ["characters", "location"]);
  if (!source || typeof source.location !== "string" || !Array.isArray(source.characters)
    || Object.getPrototypeOf(source.characters) !== Array.prototype) return null;
  const entries = Object.getOwnPropertyDescriptors(source.characters);
  if (Reflect.ownKeys(entries).length !== 3 || Object.getOwnPropertyDescriptor(source.characters, "length")?.value !== 2
    || !entries["0"]?.enumerable || !Object.hasOwn(entries["0"], "value")
    || !entries["1"]?.enumerable || !Object.hasOwn(entries["1"], "value")) return null;
  const a = fields(entries["0"].value, ["id", "name"]), b = fields(entries["1"].value, ["id", "name"]);
  if (!a || a.id !== "A" || typeof a.name !== "string" || !b || b.id !== "B" || typeof b.name !== "string") return null;
  return Object.freeze({ characters: Object.freeze([Object.freeze({ id: "A", name: a.name }), Object.freeze({ id: "B", name: b.name })]) as SceneDisplaySource["characters"], location: source.location });
}

/** Exact retained original Scene content, never generic Markdown adoption.
 * The caller must bound/authenticate the private read and establish the original
 * job/call/source/receipt association before supplying expected. It must recheck
 * its live lease, source, access and expiry after await and clear on withdrawal.
 * No page count, semantic quality, provider provenance or fulfillment is proved.
 */
export async function readExperienceSceneContent(raw: unknown, expected: unknown, now = Date.now()): Promise<ExperienceSceneContent | null> {
  try {
    if (typeof raw !== "string" || raw.length > 1_000_000 || encoder.encode(raw).length > 1_000_000 || !Number.isFinite(now)) return null;
    const selected = fields(expected, ["documentId", "artifactId", "revision", "contentSha256", "screenplaySha256", "bodySha256", "displaySource", "expiresAt"]);
    if (!selected || !id(selected.documentId) || !id(selected.artifactId) || selected.revision !== 0
      || !hash(selected.contentSha256) || !hash(selected.screenplaySha256) || !hash(selected.bodySha256)
      || typeof selected.expiresAt !== "string" || !Number.isFinite(Date.parse(selected.expiresAt))
      || Date.parse(selected.expiresAt) <= now || new Date(selected.expiresAt).toISOString() !== selected.expiresAt) return null;
    const source = displaySource(selected.displaySource);
    if (!source) return null;
    const artifact = fields(JSON.parse(raw), ["title", "summary", "content_markdown", "presentation", "items", "scene_screenplay"]);
    if (!artifact || typeof artifact.title !== "string" || !artifact.title.trim() || artifact.title.length > 240
      || typeof artifact.summary !== "string" || !artifact.summary.trim() || artifact.summary.length > 2000
      || typeof artifact.content_markdown !== "string" || artifact.presentation !== null
      || !Array.isArray(artifact.items) || artifact.items.length !== 1) return null;
    // Match the adapter's label contract; do not normalize its literal Unicode.
    if ([artifact.title, artifact.summary].some(value => /[\p{Cc}\u202a-\u202e\u2066-\u2069\uD800-\uDFFF]/u.test(value))) return null;
    const screenplay = parseSceneScreenplay(artifact.scene_screenplay);
    if (!screenplay) return null;
    const body = sceneScreenplayText(screenplay, source);
    const item = fields(artifact.items[0], ["title", "body", "notes", "image_prompt", "context_group_ids", "slide"]);
    if (body === null || artifact.content_markdown !== body || !item || item.title !== artifact.title || item.body !== body
      || item.notes !== "" || item.image_prompt !== "" || item.slide !== null || !Array.isArray(item.context_group_ids) || item.context_group_ids.length !== 0) return null;
    // Capture every caller field before hashing can yield. The returned selection
    // is immutable and cannot follow a newer revision/source while reading.
    const selection: ExperienceSceneReadSelection = Object.freeze({ documentId: selected.documentId, artifactId: selected.artifactId,
      revision: 0, contentSha256: selected.contentSha256, screenplaySha256: selected.screenplaySha256,
      bodySha256: selected.bodySha256, displaySource: source, expiresAt: selected.expiresAt });
    const title = artifact.title;
    const [contentHash, screenplayHash, bodyHash] = await Promise.all([sha(raw), sha(canonicalJson(screenplay)), sha(body)]);
    if (contentHash !== selection.contentSha256 || screenplayHash !== selection.screenplaySha256 || bodyHash !== selection.bodySha256) return null;
    return Object.freeze({ qualification: "content-only", title, body, screenplay, selection });
  } catch { return null; }
}
