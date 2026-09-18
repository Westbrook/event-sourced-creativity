/** A native retained revision, not an Experience release or generation receipt. */
export type RetainedStorySelection = Readonly<{
  documentId: string;
  artifactId: string;
  revision: number;
  /** SHA-256 of the complete retained native JSON, not the projected Markdown. */
  contentSha256: string;
}>;

export type RetainedStoryDto = Readonly<{
  schemaVersion: 1;
  kind: "native-retained-short-story";
  selection: RetainedStorySelection;
  title: string;
  contentMarkdown: string;
  /** Actual retained-content expiry; this is not a promise of continuing access. */
  expiresAt: string;
}>;

export const RETAINED_STORY_JSON_MAX_BYTES = 1_000_000;
export const RETAINED_STORY_MARKDOWN_MAX_BYTES = 512_000;
export const RETAINED_STORY_TITLE_MAX_BYTES = 80_000;
export const RETAINED_STORY_ROUTE = "/make/short-story";

const encoder = new TextEncoder();
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const digest = /^[a-f0-9]{64}$/u;
const selectionKeys = ["documentId", "artifactId", "revision", "contentSha256"] as const;

/** Fixed data fields only. Never invoke an accessor, toJSON or custom iterator. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || !names.every(name => typeof name === "string" && keys.includes(name))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function selection(value: unknown): RetainedStorySelection | null {
  const record = fields(value, selectionKeys);
  if (!record || typeof record.documentId !== "string" || !identifier.test(record.documentId)
    || typeof record.artifactId !== "string" || !identifier.test(record.artifactId)
    || typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 0
    || typeof record.contentSha256 !== "string" || !digest.test(record.contentSha256)) return null;
  return Object.freeze({ documentId: record.documentId, artifactId: record.artifactId,
    revision: record.revision, contentSha256: record.contentSha256 });
}

/** A requested identity only. Neither a URL nor successful decoding grants read access. */
export function parseRetainedStoryRoute(route: string): RetainedStorySelection | null {
  try {
    if (typeof route !== "string" || route.length > 2048 || !route.startsWith("/")
      || route.startsWith("//") || /[\0-\u0020\u007f\\]/u.test(route)) return null;
    const url = new URL(route, "https://forma.local");
    if (url.origin !== "https://forma.local" || url.username || url.password
      || url.pathname.replace(/\/+$/, "") !== RETAINED_STORY_ROUTE || url.hash) return null;
    const keys = ["document", "artifact", "revision", "sha256"];
    const names = [...url.searchParams.keys()];
    if (names.length !== keys.length || !keys.every(key => url.searchParams.getAll(key).length === 1)
      || names.some(key => !keys.includes(key))) return null;
    const revision = url.searchParams.get("revision")!;
    if (!/^(0|[1-9]\d*)$/u.test(revision)) return null;
    return selection({ documentId: url.searchParams.get("document"), artifactId: url.searchParams.get("artifact"),
      revision: Number(revision), contentSha256: url.searchParams.get("sha256") });
  } catch { return null; }
}

export function retainedStoryRequestPath(expected: RetainedStorySelection): string {
  const checked = selection(expected);
  if (!checked) throw new TypeError("Invalid retained story selection");
  return `/api/retained-story/${encodeURIComponent(checked.documentId)}/${encodeURIComponent(checked.artifactId)}`
    + `?revision=${checked.revision}&sha256=${checked.contentSha256}`;
}

/** Server-side request decoding. Authentication and current native selection remain separate. */
export function parseRetainedStoryRequestUrl(requestUrl: string): RetainedStorySelection | null {
  try {
    if (typeof requestUrl !== "string" || requestUrl.length > 4096 || /[\0-\u0020\u007f\\]/u.test(requestUrl)) return null;
    const url = new URL(requestUrl);
    const path = url.pathname.match(/^\/api\/retained-story\/([^/]+)\/([^/]+)$/u);
    if (!path || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) return null;
    const names = [...url.searchParams.keys()];
    if (names.length !== 2 || url.searchParams.getAll("revision").length !== 1
      || url.searchParams.getAll("sha256").length !== 1
      || names.some(key => key !== "revision" && key !== "sha256")) return null;
    const revision = url.searchParams.get("revision")!;
    if (!/^(0|[1-9]\d*)$/u.test(revision)) return null;
    return selection({ documentId: decodeURIComponent(path[1]!), artifactId: decodeURIComponent(path[2]!),
      revision: Number(revision), contentSha256: url.searchParams.get("sha256") });
  } catch { return null; }
}

/**
 * The transport must bound response bytes before JSON.parse and authenticate
 * the recipient independently. The host supplies its pre-request selection
 * and owns current source authority, retirement and the native edit handoff.
 * This decoder compares identities; it cannot prove native custody or access.
 */
export function validateRetainedStoryDto(
  candidate: unknown, expected: RetainedStorySelection, now = Date.now(),
): RetainedStoryDto | null {
  try {
    const wanted = selection(expected);
    const value = fields(candidate, ["schemaVersion", "kind", "selection", "title", "contentMarkdown", "expiresAt"]);
    if (!wanted || !value || value.schemaVersion !== 1 || value.kind !== "native-retained-short-story") return null;
    const actual = selection(value.selection);
    if (!actual || selectionKeys.some(key => actual[key] !== wanted[key])) return null;
    if (typeof value.title !== "string" || value.title.length > RETAINED_STORY_TITLE_MAX_BYTES
      || encoder.encode(value.title).length > RETAINED_STORY_TITLE_MAX_BYTES
      || typeof value.contentMarkdown !== "string" || value.contentMarkdown.length > RETAINED_STORY_MARKDOWN_MAX_BYTES
      || encoder.encode(value.contentMarkdown).length > RETAINED_STORY_MARKDOWN_MAX_BYTES
      || typeof value.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.expiresAt)) return null;
    const expiry = Date.parse(value.expiresAt);
    if (!Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now
      || new Date(expiry).toISOString() !== value.expiresAt) return null;
    const result: RetainedStoryDto = Object.freeze({ schemaVersion: 1, kind: "native-retained-short-story",
      selection: actual, title: value.title, contentMarkdown: value.contentMarkdown, expiresAt: value.expiresAt });
    // Only private, descriptor-captured primitives reach serialization.
    return encoder.encode(JSON.stringify(result)).length <= RETAINED_STORY_JSON_MAX_BYTES ? result : null;
  } catch { return null; }
}
