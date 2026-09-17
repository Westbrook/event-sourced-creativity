import { parseSelectedOutputShareSelection, validateSelectedOutputSharePublicOutput,
  SELECTED_OUTPUT_SHARE_PURPOSE, SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES, SELECTED_OUTPUT_SHARE_TITLE_MAX_BYTES,
  SELECTED_OUTPUT_SHARE_MAX_LIFETIME_MS, type SelectedOutputShareCandidate, type SelectedOutputShareKind,
  type SelectedOutputShareReview, type SelectedOutputShareSelection } from "./model/selected-output-share.ts";

export type SelectedOutputShareLease = Readonly<{
  selection: SelectedOutputShareSelection; signal: AbortSignal; isCurrent: () => boolean;
}>;
export type SelectedOutputShareClientOptions = Readonly<{ origin: string; fetcher?: typeof fetch }>;
export type SelectedOutputShareMetadata = Readonly<{ shareId: string; title: string; output: SelectedOutputShareKind;
  revision: number; expiresAt: string; issuedAt: string }>;
export type SelectedOutputSharePrepared = Readonly<{ candidateId: string; candidate: SelectedOutputShareCandidate; replayed: boolean }>;
export type SelectedOutputShareCommitted = Readonly<{ share: Readonly<{ shareId: string; expiresAt: string; active: true; token?: string }>; replayed: boolean }>;
export type SelectedOutputSharePage = Readonly<{ shares: readonly SelectedOutputShareMetadata[]; nextCursor: string | null }>;

const encoder = new TextEncoder(), base = "/api/selected-output-shares";
const fail = (): never => { throw new Error("selected_output_share_unavailable"); };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function title(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= SELECTED_OUTPUT_SHARE_TITLE_MAX_BYTES && encoder.encode(value).length <= SELECTED_OUTPUT_SHARE_TITLE_MAX_BYTES
    && ![...value].some(character => { const code = character.charCodeAt(0); return code <= 31 || code >= 127 && code <= 159; });
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const names = Reflect.ownKeys(value), captured: Record<string, unknown> = Object.create(null);
  if (names.length < required.length || names.length > required.length + optional.length
    || names.some(name => typeof name !== "string" || !required.includes(name) && !optional.includes(name))) return fail();
  for (const key of [...required, ...optional.filter(key => names.includes(key))]) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, "value") || !field.enumerable) return fail();
    captured[key] = field.value;
  }
  return captured;
}
function cursor(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,320}$/u.test(value)) return false;
  try {
    const decoded: unknown = JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)));
    return Array.isArray(decoded) && decoded.length === 2 && timestamp(decoded[0]) && identifier(decoded[1])
      && btoa(JSON.stringify(decoded)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "") === value;
  } catch { return false; }
}

/** A request lease and data decoder only. Capability discovery never supplies
 * publishing authority; the server must freshly authorize every operation. */
export function createSelectedOutputShareClient(lease: SelectedOutputShareLease, options: SelectedOutputShareClientOptions) {
  const selection = parseSelectedOutputShareSelection(lease.selection) ?? fail(), signal = lease.signal, isCurrent = lease.isCurrent;
  const origin = options.origin, parsedOrigin = new URL(origin), fetcher = options.fetcher ?? fetch;
  if (!["http:", "https:"].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) return fail();
  const selectedJson = JSON.stringify(selection), prepared = new Map<string, string>();
  let creationAvailable = false, availabilityEpoch = 0;
  function check(creation?: number) {
    if (signal.aborted || !isCurrent() || creation !== undefined && (!creationAvailable || creation !== availabilityEpoch)) return fail();
  }
  async function read(path: string, method: "GET" | "POST" | "DELETE", body: unknown, limit: number, creation?: number): Promise<unknown> {
    check(creation);
    const url = new URL(path, origin).href;
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized !== undefined && encoder.encode(serialized).length > 8192) return fail();
    const response = await fetcher(url, { method, signal, credentials: "same-origin", cache: "no-store",
      redirect: "error", referrerPolicy: "no-referrer", headers: { Accept: "application/json",
        ...(serialized === undefined ? {} : { "Content-Type": "application/json" }) }, ...(serialized === undefined ? {} : { body: serialized }) });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, completed = false;
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      check(creation);
      const length = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
      const identityEncoding = encoding === null || encoding.trim().toLowerCase() === "identity";
      if (response.status !== 200 || response.redirected || response.url !== url
        || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
        || length !== null && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)) || identityEncoding && Number(length) > limit)
        || !response.body) return fail();
      reader = response.body.getReader();
      for (;;) {
        check(creation); const chunk = await reader.read(); check(creation);
        if (chunk.done) { completed = true; break; }
        if (!(chunk.value instanceof Uint8Array) || !chunk.value.byteLength) return fail();
        size += chunk.value.byteLength;
        if (size > limit) return fail();
        chunks.push(chunk.value);
      }
      if (length !== null && identityEncoding && Number(length) !== size) return fail();
    } finally {
      if (!completed) void (reader ? reader.cancel() : response.body?.cancel())?.catch(() => {});
      reader?.releaseLock();
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    check(creation);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  }
  async function candidate(value: unknown, creation: number): Promise<SelectedOutputShareCandidate> {
    check(creation);
    const raw = fields(value, ["schemaVersion", "kind", "purpose", "selection", "sourceExpiresAt", "publicOutput", "candidateSha256"]);
    const selected = parseSelectedOutputShareSelection(raw.selection), publicOutput = validateSelectedOutputSharePublicOutput(raw.publicOutput);
    if (raw.schemaVersion !== 1 || raw.kind !== "selected-output-share-candidate" || raw.purpose !== SELECTED_OUTPUT_SHARE_PURPOSE
      || !selected || JSON.stringify(selected) !== selectedJson || !timestamp(raw.sourceExpiresAt)
      || !publicOutput || publicOutput.output !== selection.output || publicOutput.expiresAt > raw.sourceExpiresAt
      || !digest(raw.candidateSha256)) return fail();
    const captured = { schemaVersion: 1 as const, kind: "selected-output-share-candidate" as const,
      purpose: SELECTED_OUTPUT_SHARE_PURPOSE as typeof SELECTED_OUTPUT_SHARE_PURPOSE, selection: selected, sourceExpiresAt: raw.sourceExpiresAt, publicOutput };
    if (encoder.encode(JSON.stringify({ ...captured, candidateSha256: raw.candidateSha256 })).length > SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES) return fail();
    check(creation);
    const hash = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(captured))); check(creation);
    if (Date.parse(publicOutput.expiresAt) <= Date.now() || Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("") !== raw.candidateSha256) return fail();
    return Object.freeze({ ...captured, candidateSha256: raw.candidateSha256 });
  }
  return Object.freeze({
    async availability(): Promise<boolean> {
      check(); const epoch = ++availabilityEpoch; creationAvailable = false;
      try {
        const result = fields(await read(`${base}/availability`, "GET", undefined, 1024), ["creationAvailable"]); check();
        if (epoch !== availabilityEpoch || typeof result.creationAvailable !== "boolean") return fail();
        creationAvailable = result.creationAvailable; return creationAvailable;
      } catch (error) { if (epoch === availabilityEpoch) creationAvailable = false; throw error; }
    },
    async prepare(review: SelectedOutputShareReview, intentKey: string): Promise<SelectedOutputSharePrepared> {
      const epoch = availabilityEpoch; check(epoch);
      const choices = fields(review, ["title", "expiresAt"]), now = Date.now();
      if (!identifier(intentKey) || !title(choices.title) || !timestamp(choices.expiresAt)
        || Date.parse(choices.expiresAt) <= now || Date.parse(choices.expiresAt) - now > SELECTED_OUTPUT_SHARE_MAX_LIFETIME_MS) return fail();
      const result = fields(await read(`${base}/prepare`, "POST", { intentKey, selection,
        review: { title: choices.title, expiresAt: choices.expiresAt } }, SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES + 4096, epoch), ["candidateId", "candidate", "replayed"]); check(epoch);
      if (!identifier(result.candidateId) || typeof result.replayed !== "boolean") return fail();
      const parsed = await candidate(result.candidate, epoch); check(epoch);
      if (Date.parse(parsed.publicOutput.expiresAt) <= Date.now() || parsed.publicOutput.title !== choices.title || parsed.publicOutput.expiresAt !== choices.expiresAt) return fail();
      const previous = prepared.get(result.candidateId);
      if (previous !== undefined && previous !== parsed.candidateSha256) return fail();
      prepared.set(result.candidateId, parsed.candidateSha256);
      return Object.freeze({ candidateId: result.candidateId, candidate: parsed, replayed: result.replayed });
    },
    async commit(candidateId: string, value: SelectedOutputShareCandidate): Promise<SelectedOutputShareCommitted> {
      const epoch = availabilityEpoch; check(epoch);
      if (!identifier(candidateId) || !prepared.has(candidateId)) return fail();
      const parsed = await candidate(value, epoch); check(epoch);
      if (Date.parse(parsed.publicOutput.expiresAt) <= Date.now() || prepared.get(candidateId) !== parsed.candidateSha256) return fail();
      const result = fields(await read(`${base}/commit`, "POST", { candidateId, approval: {
        purpose: SELECTED_OUTPUT_SHARE_PURPOSE, candidateSha256: parsed.candidateSha256, allowPublicRead: true,
      } }, 4096, epoch), ["share", "replayed"]); check(epoch);
      if (typeof result.replayed !== "boolean") return fail();
      const share = fields(result.share, ["shareId", "expiresAt", "active"], result.replayed ? [] : ["token"]);
      if (share.shareId !== candidateId || share.expiresAt !== parsed.publicOutput.expiresAt || share.active !== true
        || !result.replayed && (typeof share.token !== "string" || !/^[A-Za-z0-9_-]{32}$/u.test(share.token))
        || Date.parse(parsed.publicOutput.expiresAt) <= Date.now()) return fail();
      return Object.freeze({ share: Object.freeze({ shareId: candidateId, expiresAt: parsed.publicOutput.expiresAt,
        active: true as const, ...(result.replayed ? {} : { token: share.token as string }) }), replayed: result.replayed });
    },
    async list(after?: string): Promise<SelectedOutputSharePage> {
      check(); if (after !== undefined && !cursor(after)) return fail();
      const params = new URLSearchParams({ documentId: selection.documentId, artifactId: selection.artifactId });
      if (after !== undefined) params.set("cursor", after);
      const result = fields(await read(`${base}?${params}`, "GET", undefined, 128 * 1024), ["shares", "nextCursor"]); check();
      if (!Array.isArray(result.shares) || result.shares.length > 50
        || result.nextCursor !== null && (!cursor(result.nextCursor) || result.shares.length !== 50 || result.nextCursor === after)) return fail();
      const seen = new Set<string>();
      const shares = result.shares.map(value => {
        const item = fields(value, ["shareId", "title", "output", "revision", "expiresAt", "issuedAt"]);
        if (!identifier(item.shareId) || seen.has(item.shareId) || !title(item.title)
          || typeof item.output !== "string" || !["short_story", "scene", "slides"].includes(item.output)
          || typeof item.revision !== "number" || !Number.isSafeInteger(item.revision) || item.revision < 0
          || !timestamp(item.expiresAt) || !timestamp(item.issuedAt) || item.issuedAt >= item.expiresAt) return fail();
        seen.add(item.shareId);
        return Object.freeze({ shareId: item.shareId, title: item.title, output: item.output as SelectedOutputShareKind,
          revision: item.revision, expiresAt: item.expiresAt, issuedAt: item.issuedAt });
      });
      return Object.freeze({ shares: Object.freeze(shares), nextCursor: result.nextCursor as string | null });
    },
    async revoke(shareId: string): Promise<void> {
      check(); if (!identifier(shareId)) return fail();
      const result = fields(await read(`${base}/${encodeURIComponent(shareId)}`, "DELETE", undefined, 1024), ["ok"]); check();
      if (result.ok !== true) return fail();
    },
  });
}
export type SelectedOutputShareClient = ReturnType<typeof createSelectedOutputShareClient>;
