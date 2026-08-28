/** A scoped transport cache. It never infers delivery, rebases author edits, or starts a provider. */
export type OutputClientScope = { key: string; projectId: string | null };

export type OutputPlanResource<T> = {
  state: "loading" | "ready" | "refreshing" | "unavailable";
  snapshot: T | null;
  error: string | null;
  accessLost?: boolean;
  errorCode?: string;
  errorValues?: Record<string, unknown>;
};

export type OutputCommandResult<T> =
  | { status: "saved"; body: T }
  | { status: "conflict" | "invalid" | "forbidden" | "unavailable"; body: unknown; error: string };

export type OutputRequirementsClientOptions<T> = {
  captureScope(): OutputClientScope | null;
  scopeActive(scope: OutputClientScope): boolean;
  fetch(input: RequestInfo | URL, init?: RequestInit, action?: string): Promise<Response>;
  isSnapshot(value: unknown, documentId: string, scope: OutputClientScope): value is T;
  notify(): void;
};

const message = (body: unknown, fallback: string) => {
  if (body && typeof body === "object") {
    const fields = body as Record<string, unknown>;
    if (typeof fields.message === "string") return fields.message;
    if (typeof fields.error === "string") return fields.error;
  }
  return fallback;
};

/** Prefer the server's UTF-8 name while refusing paths, controls, and directional spoofing. */
export function outputDownloadFilename(disposition: string | null): string {
  const safe = (value: string | undefined) => value && value.length <= 180 && value.trim() === value && !/[\/\\\p{Cc}\p{Cf}]/u.test(value) && !/^\.{1,2}$/.test(value) ? value : null;
  const extended = disposition?.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i)?.[1]?.trim();
  if (extended) {
    try { const name = safe(decodeURIComponent(extended)); if (name) return name; }
    catch { /* A malformed extended name may use the independently safe fallback. */ }
  }
  const fallback = disposition?.match(/(?:^|;)\s*filename\s*=\s*"([^"\r\n]*)"/i)?.[1];
  return safe(fallback) ?? "forma-delivery.bin";
}

export class OutputRequirementsClient<T> {
  #options: OutputRequirementsClientOptions<T>;
  #scope = "";
  #resources = new Map<string, OutputPlanResource<T>>();
  #versions = new Map<string, number>();
  #pending = new Map<string, Promise<OutputPlanResource<T>>>();
  #epoch = 0;

  constructor(options: OutputRequirementsClientOptions<T>) { this.#options = options; }

  clear() {
    this.#epoch += 1;
    this.#resources.clear();
    this.#versions.clear();
    this.#pending.clear();
    this.#scope = "";
  }

  #capture() {
    const scope = this.#options.captureScope();
    const key = scope ? `${scope.key}\u0000${scope.projectId ?? "personal"}` : "";
    if (key !== this.#scope) { this.clear(); this.#scope = key; }
    return scope;
  }

  #active(scope: OutputClientScope, epoch: number) {
    return epoch === this.#epoch && this.#options.scopeActive(scope);
  }

  resource(documentId: string): OutputPlanResource<T> {
    const scope = this.#capture();
    if (!scope) return { state: "unavailable", snapshot: null, error: "Sign in to view Output requirements." };
    return this.#resources.get(documentId) ?? { state: "loading", snapshot: null, error: null };
  }

  #publish(documentId: string, value: OutputPlanResource<T>) {
    this.#resources.set(documentId, value);
    this.#options.notify();
  }

  invalidate(documentId?: string) {
    this.#capture();
    for (const [id, resource] of this.#resources) {
      if (documentId && documentId !== id) continue;
      this.#versions.set(id, (this.#versions.get(id) ?? 0) + 1);
      this.#resources.set(id, { ...resource, state: resource.snapshot ? "refreshing" : "loading", error: null });
      this.#pending.delete(id);
    }
    this.#options.notify();
  }

  async ensure(documentId: string, options: { force?: boolean } = {}): Promise<OutputPlanResource<T>> {
    const scope = this.#capture();
    if (!scope || !documentId) return this.resource(documentId);
    const existing = this.#resources.get(documentId);
    if (!options.force && existing?.state === "ready") return existing;
    if (!options.force && this.#pending.has(documentId)) return this.#pending.get(documentId)!;
    const epoch = this.#epoch;
    const version = (this.#versions.get(documentId) ?? 0) + 1;
    this.#versions.set(documentId, version);
    const active = () => this.#active(scope, epoch) && this.#versions.get(documentId) === version;
    this.#publish(documentId, { state: existing?.snapshot ? "refreshing" : "loading", snapshot: existing?.snapshot ?? null, error: null });
    const pending = (async () => {
      try {
        const response = await this.#options.fetch(`/api/output-requirements?documentId=${encodeURIComponent(documentId)}`);
        if (!active()) return this.resource(documentId);
        const body: unknown = await response.json();
        if (!active()) return this.resource(documentId);
        if (!response.ok || !this.#options.isSnapshot(body, documentId, scope)) {
          const privateScopeLost = response.status === 401 || response.status === 403 || response.status === 404;
          const fields = body && typeof body === "object" ? body as Record<string, unknown> : {};
          const result: OutputPlanResource<T> = { state: "unavailable", snapshot: privateScopeLost ? null : existing?.snapshot ?? null, accessLost: privateScopeLost, errorCode: typeof fields.error === "string" ? fields.error : "output_client_load_failed", errorValues: fields, error: message(body, "Output requirements could not be loaded. The delivery scope is unknown.") };
          this.#publish(documentId, result);
          return result;
        }
        const result: OutputPlanResource<T> = { state: "ready", snapshot: body, error: null };
        this.#publish(documentId, result);
        return result;
      } catch (error) {
        if (!active()) return this.resource(documentId);
        const result: OutputPlanResource<T> = { state: "unavailable", snapshot: existing?.snapshot ?? null, errorCode: "output_client_load_failed", error: error instanceof Error ? error.message : "Output requirements could not be loaded. The delivery scope is unknown." };
        this.#publish(documentId, result);
        return result;
      } finally {
        if (active()) this.#pending.delete(documentId);
      }
    })();
    this.#pending.set(documentId, pending);
    return pending;
  }

  async command<R = unknown>(documentId: string, command: Record<string, unknown> & { expectedRevision: string; clientMutationId: string }, action: string): Promise<OutputCommandResult<R>> {
    return this.#write<R>(documentId, "/api/output-requirements", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...command, documentId }),
    }, action);
  }

  /** Used for inspected owned-file adoption; the caller supplies explicit rights and revision headers. */
  async upload<R = unknown>(documentId: string, bytes: Blob, headers: HeadersInit): Promise<OutputCommandResult<R>> {
    return this.#write<R>(documentId, `/api/output-requirements/assets?documentId=${encodeURIComponent(documentId)}`, {
      method: "POST", headers, body: bytes,
    }, "upload an owned deliverable for inspection");
  }

  async #write<R>(documentId: string, path: string, init: RequestInit, action: string): Promise<OutputCommandResult<R>> {
    const scope = this.#capture();
    if (!scope) return { status: "forbidden", body: null, error: "Sign in before changing Output requirements." };
    const epoch = this.#epoch;
    const version = (this.#versions.get(documentId) ?? 0) + 1;
    this.#versions.set(documentId, version);
    this.#pending.delete(documentId);
    const active = () => this.#active(scope, epoch);
    const scopeChanged = (): OutputCommandResult<R> => ({ status: "forbidden", body: null, error: "The active workspace changed. The previous result was discarded." });
    try {
      const response = await this.#options.fetch(path, init, action);
      if (!active()) return scopeChanged();
      const body: unknown = await response.json();
      if (!active()) return scopeChanged();
      if (!response.ok) {
        const status = response.status === 409 ? "conflict" : [401, 403, 404].includes(response.status) ? "forbidden" : response.status >= 500 ? "unavailable" : "invalid";
        if (status === "forbidden") this.#publish(documentId, { state: "unavailable", snapshot: null, accessLost: true, error: message(body, "This Output scope is no longer available.") });
        return { status, body, error: message(body, "The change was not confirmed. Keep this draft and check the current requirements before retrying.") };
      }
      const candidate = body && typeof body === "object" && "snapshot" in body ? (body as { snapshot: unknown }).snapshot : body;
      if (this.#versions.get(documentId) === version && this.#options.isSnapshot(candidate, documentId, scope)) {
        this.#publish(documentId, { state: "ready", snapshot: candidate, error: null });
      } else if (this.#versions.get(documentId) === version) {
        this.invalidate(documentId);
      }
      return { status: "saved", body: body as R };
    } catch (error) {
      if (!active()) return scopeChanged();
      return { status: "unavailable", body: null, error: error instanceof Error ? error.message : "The response was lost. Reuse the same operation ID to recover its receipt." };
    }
  }

  async download(documentId: string, path: string, init: RequestInit = {}): Promise<OutputCommandResult<{ blob: Blob; filename: string }>> {
    const scope = this.#capture();
    if (!scope) return { status: "forbidden", body: null, error: "Sign in before downloading deliverables." };
    const epoch = this.#epoch;
    let validPath = false;
    try {
      const url = new URL(path, "https://forma-output.invalid");
      const match = url.pathname.match(/^\/api\/output-requirements\/(?:assets|deliveries)\/([^/]+)$/);
      validPath = path.startsWith("/api/output-requirements/") && !/[\r\n\\]/.test(path)
        && url.origin === "https://forma-output.invalid" && !url.hash
        && !!match && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(decodeURIComponent(match[1]))
        && url.searchParams.getAll("documentId").length === 1 && url.searchParams.get("documentId") === documentId
        && [...url.searchParams.keys()].every((key) => key === "documentId" || key === "part")
        && url.searchParams.getAll("part").length <= 1
        && (!url.searchParams.has("part") || /^[1-9]\d{0,3}$/.test(url.searchParams.get("part")!));
    } catch { /* Malformed paths are not an authorized Output download. */ }
    if (!validPath) return { status: "invalid", body: null, error: "The download must belong to this Document's Output requirements." };
    try {
      const response = await this.#options.fetch(path, init, "download checked deliverables");
      if (!this.#active(scope, epoch)) return { status: "forbidden", body: null, error: "The workspace changed before the download completed." };
      if (!response.ok) {
        const body: unknown = await response.json();
        if (!this.#active(scope, epoch)) return { status: "forbidden", body: null, error: "The workspace changed before the download completed." };
        return { status: response.status === 409 ? "conflict" : [401, 403, 404].includes(response.status) ? "forbidden" : "unavailable", body, error: message(body, "The current files could not be downloaded.") };
      }
      const blob = await response.blob();
      if (!this.#active(scope, epoch)) return { status: "forbidden", body: null, error: "The workspace changed before the download completed." };
      const filename = outputDownloadFilename(response.headers.get("content-disposition"));
      return { status: "saved", body: { blob, filename } };
    } catch (error) {
      return { status: "unavailable", body: null, error: error instanceof Error ? error.message : "The download did not complete." };
    }
  }
}
