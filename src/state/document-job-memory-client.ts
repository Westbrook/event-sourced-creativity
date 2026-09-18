import { createMemoryElapsed, memoryTimestamp, MEMORY_RECALL_MAX_AGE_MS, type MemoryClockSample } from "../model/memory-lifetime.ts";

export const DOCUMENT_JOB_MEMORY_VERSION = "native-document-job-memory-v1" as const;
export type DocumentJobMemoryRequest = Readonly<{ documentId: string; requestId: string; message: string; locale: string }>;
export type DocumentJobMemoryView = Readonly<{ text: string; locale: "en" | "fr" | "ar" | "ja"; validUntil: string; jobId: string; turnId: string }>;
export type DocumentJobMemoryLease = Readonly<{ read(): DocumentJobMemoryView | null; remainingMs(): number; retire(): void }>;
export type DocumentJobMemoryResult = Readonly<{ jobId: string; status: "current" | "pending"; lease: DocumentJobMemoryLease | null }>;

export class DocumentJobMemoryError extends Error {
  readonly uncertain: boolean;
  constructor(uncertain: boolean) { super(uncertain ? "document_memory_unconfirmed" : "document_memory_unavailable"); this.uncertain = uncertain; }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240 && value.isWellFormed();
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clock = (): MemoryClockSample => ({ monotonic: performance.now(), wall: Date.now() });
const requestIdentity = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);

async function readBody(response: Response, signal?: AbortSignal): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null, complete = false;
  const cancel = () => { try { void (reader ?? response.body)?.cancel().catch(() => undefined); } catch { /* Best effort. */ } };
  let rejectAbort: () => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new Error("memory_read_aborted")); });
  void interrupted.catch(() => undefined);
  const abort = () => { cancel(); rejectAbort(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted || !response.body || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""))
      throw new Error("memory_response_invalid");
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let length = 0, chunks = 0, text = "";
    for (;;) {
      const chunk = await Promise.race([reader.read(), interrupted]);
      if (signal?.aborted) throw new Error("memory_read_aborted");
      if (chunk.done) { complete = true; break; }
      if (!(chunk.value instanceof Uint8Array) || ++chunks > 65_536 || (length += chunk.value.byteLength) > 262_144)
        throw new Error("memory_response_too_large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!complete) cancel();
    try { reader?.releaseLock(); } catch { /* A canceled pending read may finish later. */ }
  }
}

// No construction/mount request, automatic retry, paid fallback, persistent text,
// or timer. The composing host owns the current scope and the display lifetime.
export function createDocumentJobMemoryClient(request: Fetch = (url, init) => fetch(url, init), clockSample = clock) {
  const sample = (): MemoryClockSample => {
    try { const value = clockSample(); return { monotonic: value.monotonic, wall: value.wall }; }
    catch { return { monotonic: NaN, wall: NaN }; }
  };
  const call = async (url: string, init: RequestInit, documentId: string, expectedJobId?: string): Promise<DocumentJobMemoryResult> => {
    const elapsed = createMemoryElapsed(sample());
    let attempted = false;
    try {
      if (init.signal?.aborted) throw new DocumentJobMemoryError(false);
      attempted = true;
      const response = await request(url, { ...init, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
        headers: { accept: "application/json", ...(init.method === "POST" ? { "content-type": "application/json" } : {}) } });
      const body = await readBody(response, init.signal ?? undefined);
      if (init.signal?.aborted) throw new DocumentJobMemoryError(init.method === "POST");
      if (!response.ok) throw new DocumentJobMemoryError(init.method === "POST" && response.status >= 500);
      if (init.method === "POST" && response.status === 202 && object(body) && body.noAutomaticRetry === true
        && body.error === "memory_job_submission_unconfirmed" && body.jobId === expectedJobId && requestIdentity(body.jobId)
        && body.job === undefined && body.memory === undefined)
        return Object.freeze({ jobId: body.jobId, status: "pending", lease: null });
      if (!object(body) || body.noAutomaticRetry !== true || !object(body.job)) throw new DocumentJobMemoryError(init.method === "POST");
      const job = body.job;
      if (!identity(job.jobId) || job.documentId !== documentId || job.kind !== "chat" || job.sourceSurface !== "chat"
        || job.memoryMode !== "recall" || expectedJobId !== undefined && job.jobId !== expectedJobId)
        throw new DocumentJobMemoryError(init.method === "POST");
      if (body.memory === undefined || body.memory === null) {
        if (response.status !== 202 || body.pending !== true || body.error !== undefined) throw new DocumentJobMemoryError(init.method === "POST");
        return Object.freeze({ jobId: job.jobId, status: "pending", lease: null });
      }
      const memory = body.memory;
      if (response.status !== 200 || body.error !== undefined || body.pending === true || !object(memory)
        || memory.version !== DOCUMENT_JOB_MEMORY_VERSION || memory.jobId !== job.jobId || !identity(memory.turnId)
        || typeof memory.text !== "string" || !memory.text.trim() || !memory.text.isWellFormed()
        || new TextEncoder().encode(memory.text).byteLength > 8_192 || !["en", "fr", "ar", "ja"].includes(String(memory.locale)))
        throw new DocumentJobMemoryError(init.method === "POST");
      const checked = memoryTimestamp(memory.checkedAt), until = memoryTimestamp(memory.validUntil);
      if (checked === null || until === null || until <= checked || until - checked > MEMORY_RECALL_MAX_AGE_MS)
        throw new DocumentJobMemoryError(init.method === "POST");
      const lifetime = until - checked;
      const view = Object.freeze({ text: memory.text, locale: memory.locale as DocumentJobMemoryView["locale"],
        validUntil: memory.validUntil as string, jobId: job.jobId, turnId: memory.turnId });
      const remainingMs = () => {
        const current = sample(), age = elapsed.elapsed(current);
        if (!Number.isFinite(age)) return 0;
        return Math.max(0, Math.min(lifetime - age, until - current.wall));
      };
      const lease: DocumentJobMemoryLease = Object.freeze({ remainingMs, read: () => remainingMs() > 0 ? view : null, retire: elapsed.retire });
      if (!lease.read()) { lease.retire(); throw new DocumentJobMemoryError(false); }
      return Object.freeze({ jobId: job.jobId, status: "current", lease });
    } catch (error) {
      elapsed.retire();
      throw error instanceof DocumentJobMemoryError ? error : new DocumentJobMemoryError(attempted && init.method === "POST");
    }
  };
  return Object.freeze({
    start(input: DocumentJobMemoryRequest, signal?: AbortSignal) {
      // Snapshot the explicit request before its first await. Reusing this request
      // ID is a recovery operation; this client never manufactures a replacement.
      const saved = { documentId: input.documentId, requestId: input.requestId, message: input.message, locale: input.locale };
      if (!identity(saved.documentId) || !requestIdentity(saved.requestId) || typeof saved.message !== "string" || !saved.message.trim()
        || saved.message.length > 4_000 || !saved.message.isWellFormed() || !["en", "fr", "ar", "ja"].includes(saved.locale))
        return Promise.reject(new DocumentJobMemoryError(false));
      return call("/api/document-jobs", { method: "POST", signal, body: JSON.stringify({ kind: "chat", sourceSurface: "chat",
        documentId: saved.documentId, payload: { memoryMode: "recall", requestId: saved.requestId, message: saved.message, locale: saved.locale } }) }, saved.documentId, saved.requestId);
    },
    read(documentId: string, jobId: string, signal?: AbortSignal) {
      if (!identity(documentId) || !identity(jobId)) return Promise.reject(new DocumentJobMemoryError(false));
      return call(`/api/document-jobs/${encodeURIComponent(jobId)}?memoryMode=recall`, { method: "GET", signal }, documentId, jobId);
    },
  });
}
