import type { CapturedSourceOwnership } from "./store";
import { readOutputReviewPreview, type OutputPreviewFile } from "../model/output-review-preview";

/** A scoped transport cache. It never infers delivery, rebases author edits, or starts a provider. */
export type OutputClientScope = { key: string; projectId: string | null };

export type OutputPlanResource<T> = {
  state: "loading" | "ready" | "refreshing" | "unavailable";
  snapshot: T | null;
  error: string | null;
  accessLost?: boolean;
  /** Cached private details were denied or retired; only an owned valid snapshot can restore them. */
  privateUnavailable?: boolean;
  /** Transport-only retirement fence, retained across a later authorized refresh. */
  privateRevision?: number;
  errorCode?: string;
  errorValues?: Record<string, unknown>;
};

export type OutputCommandResult<T> =
  | { status: "saved"; body: T }
  | { status: "conflict" | "invalid" | "forbidden" | "unavailable"; body: unknown; error: string };

/** A content-free acknowledgment of the same canonical command, not permission to repeat it. */
export type OutputCommittedReceipt = { committed: true; clientMutationId: string; action: string; eventId: string };
export type OutputTransportWrite = Readonly<{
  clientMutationId: string; action: string; expectedRevision: string; digest: string;
  status: "pending" | "unknown" | "acknowledged"; sourceRetired?: true; receipt?: OutputCommittedReceipt;
}>;
type OwnedOutputWrite = { -readonly [K in keyof OutputTransportWrite]: OutputTransportWrite[K] };
export type OutputMutationResult<T> =
  | { status: "not-attempted"; body: null; error: string; receipt?: never; privateUnavailable?: true }
  | (OutputCommandResult<T> & { receipt?: OutputCommittedReceipt; privateUnavailable?: true })
  | { status: "saved"; body: null; receipt: OutputCommittedReceipt; privateUnavailable: true };

export type OutputRequirementsClientOptions<T> = {
  captureScope(): OutputClientScope | null;
  scopeActive(scope: OutputClientScope): boolean;
  /** Optional only for standalone transports; the real Store supplies all three source-owner callbacks. */
  captureSourceOwnership?(): CapturedSourceOwnership | null;
  sourceOwnershipActive?(source: CapturedSourceOwnership | null): boolean;
  sourceOwnershipScopeActive?(source: CapturedSourceOwnership | null): boolean;
  fetch(input: RequestInfo | URL, init?: RequestInit, action?: string): Promise<Response>;
  isSnapshot(value: unknown, documentId: string, scope: OutputClientScope): value is T;
  notify(): void;
};

const accessDenied = (status: number) => status === 401 || status === 403 || status === 404;
// 410 is retained evidence/bytes unavailable, not an assertion that project permission was revoked.
const privateResponseUnavailable = (status: number) => accessDenied(status) || status === 410;
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
/** The server may acknowledge an exact committed command without disclosing its retired snapshot. */
const committedPrivateReceipt = (body: unknown, status: number, identity: { clientMutationId: string; action: string }): OutputCommittedReceipt | undefined => {
  const code = status === 401 || status === 403 ? "output_execution_authority_revoked"
    : status === 410 ? "output_private_evidence_unavailable" : null;
  if (!code || !body || typeof body !== "object" || Array.isArray(body)
    || typeof identity.clientMutationId !== "string" || !identityPattern.test(identity.clientMutationId)
    || typeof identity.action !== "string" || !identityPattern.test(identity.action)) return undefined;
  const fields = body as Record<string, unknown>;
  const command = fields.command && typeof fields.command === "object" && !Array.isArray(fields.command) ? fields.command as Record<string, unknown> : null;
  const receipt = fields.receipt && typeof fields.receipt === "object" && !Array.isArray(fields.receipt) ? fields.receipt as Record<string, unknown> : null;
  const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  if (!command || !receipt || !exactKeys(fields, ["ok", "replayed", "command", "appended", "snapshot", "privateUnavailable", "receipt", "errorCode", "error"])
    || !exactKeys(command, ["action", "eventId"]) || !exactKeys(receipt, ["committed", "clientMutationId", "action", "eventId"])
    || fields.ok !== true || typeof fields.replayed !== "boolean" || fields.snapshot !== null || fields.privateUnavailable !== true
    || !Array.isArray(fields.appended) || fields.appended.length !== 0 || fields.errorCode !== code || fields.error !== code
    || command.action !== identity.action || typeof command.eventId !== "string" || !identityPattern.test(command.eventId)
    || receipt.committed !== true || receipt.clientMutationId !== identity.clientMutationId || receipt.action !== identity.action
    || receipt.eventId !== command.eventId) return undefined;
  return { committed: true, clientMutationId: identity.clientMutationId, action: identity.action, eventId: command.eventId };
};
const errorBody = (body: unknown) => {
  const fields = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return typeof fields.error === "string" && /^[a-z][a-z0-9_]{0,159}$/.test(fields.error) ? { error: fields.error } : {};
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
  const safe = (value: string | undefined) => value && value.length <= 180 && value.trim() === value && !/[/\\\p{Cc}\p{Cf}]/u.test(value) && !/^\.{1,2}$/.test(value) ? value : null;
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
  #versions = new Map<string, { current: number; certified: number; inspection?: { jobId: string; version: number }; write?: OwnedOutputWrite }>();
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

  #source() { return this.#options.captureSourceOwnership?.() ?? null; }
  #sourceActive(source: CapturedSourceOwnership | null) { return !this.#options.captureSourceOwnership || this.#options.sourceOwnershipActive?.(source) === true; }
  #sourceScopeActive(source: CapturedSourceOwnership | null) { return !this.#options.captureSourceOwnership || this.#options.sourceOwnershipScopeActive?.(source) === true; }

  /** Withdraw the existing private views without retiring their real owner or original write acknowledgments. */
  withdrawSource(scope: OutputClientScope, status: 401 | 403 | 404): boolean {
    const current = this.#options.captureScope(), key = `${scope.key}\u0000${scope.projectId ?? "personal"}`;
    if (!accessDenied(status) || !current || current.key !== scope.key || current.projectId !== scope.projectId
      || !this.#options.scopeActive(scope) || this.#scope && this.#scope !== key) return false;
    for (const documentId of new Set([...this.#resources.keys(), ...this.#versions.keys(), ...this.#pending.keys()])) {
      this.#withdraw(documentId, this.#versions.get(documentId)?.current ?? 0, status);
    }
    return true;
  }

  /** One content-free unresolved transport owner per Document; never evicted by a source read or component unmount. */
  retainedWrite(documentId: string): OutputTransportWrite | null {
    const scope = this.#capture(), write = this.#versions.get(documentId)?.write;
    return scope && this.#options.scopeActive(scope) && this.#sourceScopeActive(this.#source()) && write
      ? Object.freeze({ ...write, ...(write.receipt ? { receipt: Object.freeze({ ...write.receipt }) } : {}) }) : null;
  }

  resource(documentId: string): OutputPlanResource<T> {
    const scope = this.#capture();
    if (!scope) return { state: "unavailable", snapshot: null, error: "Sign in to view Output requirements." };
    const retained = this.#resources.get(documentId);
    if (!this.#sourceActive(this.#source())) return { ...retained, state: "unavailable", snapshot: null, privateUnavailable: true,
      errorCode: "output_client_load_failed", error: "Current private Output details are unavailable. Refresh the original source before reading them." };
    return retained ?? { state: "loading", snapshot: null, error: null };
  }

  #publish(documentId: string, value: OutputPlanResource<T>) {
    this.#resources.set(documentId, value);
    this.#options.notify();
  }

  #nextVersion(documentId: string) {
    const previous = this.#versions.get(documentId), version = (previous?.current ?? 0) + 1;
    this.#versions.set(documentId, { ...previous, current: version, certified: previous?.certified ?? 0 });
    return version;
  }

  /** A completed, validated Output snapshot is the only whole-resource private proof. */
  #certifySnapshot(documentId: string, version: number, observedPrivateRevision: number) {
    const clock = this.#versions.get(documentId);
    if (!clock || clock.current !== version || (this.#resources.get(documentId)?.privateRevision ?? 0) !== observedPrivateRevision) return false;
    this.#versions.set(documentId, { ...clock, certified: version });
    return true;
  }
  /** A pending replacement is not a private proof. Retire bytes without superseding its request. */
  #withdraw(documentId: string, version: number, status: number, inspectionJobId?: string) {
    const clock = this.#versions.get(documentId);
    if ((clock?.certified ?? 0) > version
      || inspectionJobId && clock?.inspection?.jobId === inspectionJobId && clock.inspection.version > version) return { version, withdrawn: false };
    if (clock?.write) clock.write.sourceRetired = true;
    if ((clock?.current ?? 0) === version) {
      version = this.#nextVersion(documentId);
      this.#pending.delete(documentId);
    }
    const retained = this.#resources.get(documentId);
    this.#publish(documentId, { state: "unavailable", snapshot: null, accessLost: accessDenied(status) || retained?.accessLost === true,
      privateUnavailable: true, privateRevision: (retained?.privateRevision ?? 0) + 1, errorCode: "output_client_load_failed",
      error: "Current private Output details are unavailable. Refresh the original scope to recover its saved work." });
    return { version, withdrawn: true };
  }

  /** Extend the existing per-Document transport fence to a response-only Store read. */
  beginExternalRead(documentId: string, inspectionJobId?: string) {
    const scope = this.#capture();
    if (!scope || !documentId || !this.#options.scopeActive(scope)) return null;
    const epoch = this.#epoch, source = this.#source();
    let version = this.#nextVersion(documentId);
    this.#pending.delete(documentId);
    const scopeCurrent = () => this.#active(scope, epoch) && this.#sourceScopeActive(source);
    const current = () => scopeCurrent() && this.#sourceActive(source) && this.#versions.get(documentId)?.current === version;
    return {
      current, scopeCurrent,
      withdraw: (status: number) => {
        if (!scopeCurrent() || !privateResponseUnavailable(status)) return false;
        const result = this.#withdraw(documentId, version, status, inspectionJobId);
        version = result.version;
        return result.withdrawn;
      },
      /** Observe headers now; delayed bytes cannot erase a later private withdrawal. */
      observeHeaders: () => {
        const requestVersion = version, privateRevision = this.#resources.get(documentId)?.privateRevision ?? 0;
        const observedCurrent = () => scopeCurrent() && this.#sourceActive(source) && (this.#resources.get(documentId)?.privateRevision ?? 0) === privateRevision;
        return {
          current: observedCurrent,
          certifyInspection: () => {
            const clock = this.#versions.get(documentId);
            if (!inspectionJobId || !clock || clock.current !== requestVersion || !observedCurrent()) return false;
            // This exact job proof never certifies Output requirements, source, or plan bodies.
            this.#versions.set(documentId, { ...clock, inspection: { jobId: inspectionJobId, version: requestVersion } });
            return true;
          },
        };
      },
      refresh: async (): Promise<OutputPlanResource<T> | null> => {
        if (!current()) return null;
        // ensure(force) starts exactly the next version. Capture it before a
        // synchronous notification can start another read; never adopt that read.
        const nextVersion = version + 1;
        const pending = this.ensure(documentId, { force: true });
        version = nextVersion;
        const result = await pending;
        return current() ? result : null;
      },
    };
  }
  /** Store hydration may lose private evidence after a command was already committed. */
  withholdCommandBody<R>(documentId: string, result: OutputMutationResult<R>, identity: { clientMutationId: string; action: string }): OutputMutationResult<R> {
    if (result.status === "not-attempted") return result;
    const scope = this.#capture(), resource = this.#resources.get(documentId);
    const retained = result.receipt;
    let receipt: OutputCommittedReceipt | undefined = retained?.committed === true && retained.clientMutationId === identity.clientMutationId && retained.action === identity.action
      && typeof retained.eventId === "string" && identityPattern.test(retained.eventId) && identityPattern.test(identity.clientMutationId)
      ? { committed: true, clientMutationId: identity.clientMutationId, action: identity.action, eventId: retained.eventId } : undefined;
    if (result.status === "saved" && result.body && scope && this.#options.scopeActive(scope)) {
      const body = result.body as Record<string, unknown>;
      const command = body.command && typeof body.command === "object" ? body.command as Record<string, unknown> : {};
      if (body.ok === true && typeof body.replayed === "boolean" && command.action === identity.action && typeof command.eventId === "string"
        && identityPattern.test(command.eventId) && identityPattern.test(identity.clientMutationId)
        && this.#options.isSnapshot(body.snapshot, documentId, scope)) {
        receipt = { committed: true, clientMutationId: identity.clientMutationId, action: identity.action, eventId: command.eventId };
      }
    }
    if (resource?.accessLost || result.status === "forbidden") return { status: "forbidden", body: null, privateUnavailable: true,
      ...(receipt ? { receipt } : {}), error: "Access to these Output requirements changed. Any saved receipt remains retained; its private details are unavailable." };
    if (receipt) return { status: "saved", body: null, receipt, privateUnavailable: true };
    if (result.status !== "saved") return { ...result, body: errorBody(result.body), privateUnavailable: true,
      error: "Current private Output details are unavailable. Keep the original operation ID to recover its receipt." };
    return { status: "unavailable", body: null, privateUnavailable: true,
      error: "Private details are unavailable. Keep the original operation ID to recover its receipt." };
  }

  invalidate(documentId?: string) {
    this.#capture();
    for (const [id, resource] of this.#resources) {
      if (documentId && documentId !== id) continue;
      this.#nextVersion(id);
      this.#resources.set(id, { ...resource, state: resource.snapshot ? "refreshing" : "loading", error: null });
      this.#pending.delete(id);
    }
    this.#options.notify();
  }

  async ensure(documentId: string, options: { force?: boolean } = {}): Promise<OutputPlanResource<T>> {
    const scope = this.#capture();
    const source = this.#source();
    if (!scope || !documentId || !this.#sourceActive(source)) return this.resource(documentId);
    const existing = this.#resources.get(documentId);
    if (!options.force && existing?.state === "ready") return existing;
    if (!options.force && this.#pending.has(documentId)) return this.#pending.get(documentId)!;
    const epoch = this.#epoch;
    let version = this.#nextVersion(documentId);
    const active = () => this.#active(scope, epoch) && this.#sourceActive(source) && this.#versions.get(documentId)?.current === version;
    this.#publish(documentId, { ...existing, state: existing?.snapshot ? "refreshing" : "loading", snapshot: existing?.snapshot ?? null, error: null });
    const pending = (async () => {
      try {
        const response = await this.#options.fetch(`/api/output-requirements?documentId=${encodeURIComponent(documentId)}`);
        if (!this.#active(scope, epoch)) return this.resource(documentId);
        const withheld = privateResponseUnavailable(response.status);
        if (withheld) version = this.#withdraw(documentId, version, response.status).version;
        if (!active()) return this.resource(documentId);
        const observedPrivateRevision = this.#resources.get(documentId)?.privateRevision ?? 0;
        const parsed: unknown = await response.json();
        if (!active()) return this.resource(documentId);
        const body = withheld ? errorBody(parsed) : parsed;
        if (!response.ok || !this.#options.isSnapshot(body, documentId, scope)) {
          const retained = this.#resources.get(documentId);
          const fields = retained?.privateUnavailable || response.ok ? errorBody(body) : body && typeof body === "object" ? body as Record<string, unknown> : {};
          const result: OutputPlanResource<T> = { ...retained, state: "unavailable", snapshot: retained?.snapshot ?? null, errorCode: typeof fields.error === "string" ? fields.error : "output_client_load_failed", errorValues: fields, error: message(fields, "Output requirements could not be loaded. The delivery scope is unknown.") };
          this.#publish(documentId, result);
          return active() ? result : this.resource(documentId);
        }
        if (!this.#certifySnapshot(documentId, version, observedPrivateRevision)) return this.resource(documentId);
        const privateRevision = this.#resources.get(documentId)?.privateRevision;
        const result: OutputPlanResource<T> = { state: "ready", snapshot: body, error: null, ...(privateRevision ? { privateRevision } : {}) };
        this.#publish(documentId, result);
        return active() ? result : this.resource(documentId);
      } catch (error) {
        if (!active()) return this.resource(documentId);
        const retained = this.#resources.get(documentId);
        const result: OutputPlanResource<T> = { ...retained, state: "unavailable", snapshot: retained?.snapshot ?? null, errorCode: retained?.privateUnavailable ? retained.errorCode : "output_client_load_failed", error: retained?.privateUnavailable ? "Current private Output details are unavailable. Refresh the original scope to recover its saved work." : error instanceof Error ? error.message : "Output requirements could not be loaded. The delivery scope is unknown." };
        this.#publish(documentId, result);
        return active() ? result : this.resource(documentId);
      } finally {
        if (active()) this.#pending.delete(documentId);
      }
    })();
    if (active()) this.#pending.set(documentId, pending);
    return pending;
  }

  async command<R = unknown>(documentId: string, command: Record<string, unknown> & { expectedRevision: string; clientMutationId: string }, action: string, options: { current?: () => boolean } = {}): Promise<OutputMutationResult<R>> {
    return this.#write<R>(documentId, "/api/output-requirements", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...command, documentId }),
    }, action, { clientMutationId: command.clientMutationId, action: String(command.action ?? ""), expectedRevision: command.expectedRevision }, options);
  }

  /** Used for inspected owned-file adoption; the caller supplies explicit rights and revision headers. */
  async upload<R = unknown>(documentId: string, bytes: Blob, headers: HeadersInit, options: { current?: () => boolean } = {}): Promise<OutputMutationResult<R>> {
    return this.#write<R>(documentId, `/api/output-requirements/assets?documentId=${encodeURIComponent(documentId)}`, {
      method: "POST", headers: new Headers(headers), body: bytes,
    }, "upload an owned deliverable for inspection", { clientMutationId: new Headers(headers).get("x-output-client-mutation-id") ?? "", action: "adopt", expectedRevision: new Headers(headers).get("x-output-expected-revision") ?? "" }, options);
  }

  async #write<R>(documentId: string, path: string, init: RequestInit, action: string, identity: { clientMutationId: string; action: string; expectedRevision: string }, options: { current?: () => boolean }): Promise<OutputMutationResult<R>> {
    const scope = this.#capture();
    if (!scope) return { status: "forbidden", body: null, error: "Sign in before changing Output requirements." };
    const source = this.#source(), epoch = this.#epoch;
    const notAttempted = (): OutputMutationResult<R> => ({ status: "not-attempted", body: null,
      error: "This request was not sent. Keep the original operation ID until its receipt is confirmed." });
    if (!this.#sourceActive(source)) return notAttempted();
    const active = () => this.#active(scope, epoch) && this.#sourceScopeActive(source);
    const sourceCurrent = () => active() && this.#sourceActive(source);
    // The caller owns only this preparation window. Never retain its callback
    // in #versions or consult it after dispatch to discard an original receipt.
    const dispatchCurrent = () => { try { return sourceCurrent() && (!options.current || options.current() === true); } catch { return false; } };
    const scopeChanged = (): OutputMutationResult<R> => ({ status: "forbidden", body: null, error: "The active workspace changed. The previous result was discarded." });
    // Capture the actual owner before either digest await. Only hashes and protocol
    // identifiers enter #versions; no command, filename, source, or Blob is retained.
    let digest: string;
    if (!dispatchCurrent()) return notAttempted();
    try {
      const bytes = typeof init.body === "string" ? new TextEncoder().encode(init.body)
        : init.body instanceof Blob ? await init.body.arrayBuffer() : new Uint8Array();
      if (!dispatchCurrent()) return notAttempted();
      const bodyHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
      if (!dispatchCurrent()) return notAttempted();
      digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
        documentId, path, method: init.method, headers: [...new Headers(init.headers)].sort(([left], [right]) => left.localeCompare(right)),
        bodyHash, scope: { key: scope.key, projectId: scope.projectId }, generation: source?.generation ?? null,
      })))), byte => byte.toString(16).padStart(2, "0")).join("");
    } catch { return notAttempted(); }
    if (!dispatchCurrent()) return notAttempted();
    if (!identityPattern.test(identity.clientMutationId) || !["save", "remove", "confirm", "preflight", "authorize", "run", "bind", "review", "export", "adopt"].includes(identity.action)
      || identity.expectedRevision.length > 160 || identity.expectedRevision !== "" && !identityPattern.test(identity.expectedRevision)) return notAttempted();
    const previous = this.#versions.get(documentId)?.write;
    if (previous && previous.status !== "acknowledged"
      && (previous.status === "pending" || previous.sourceRetired || previous.clientMutationId !== identity.clientMutationId || previous.digest !== digest)) return notAttempted();
    if (previous?.clientMutationId === identity.clientMutationId && previous.digest !== digest) return notAttempted();
    let version = this.#nextVersion(documentId);
    const write: OwnedOutputWrite = { ...identity, digest, status: "pending" };
    const clock = this.#versions.get(documentId)!; clock.write = write;
    this.#pending.delete(documentId);
    this.#options.notify();
    const owns = () => this.#versions.get(documentId)?.current === version;
    const finish = (result: OutputMutationResult<R>, notCommitted = false): OutputMutationResult<R> => {
      const current = this.#versions.get(documentId);
      if (active() && current?.write === write) {
        const receipt = this.withholdCommandBody(documentId, result, identity).receipt;
        if (receipt) { write.status = "acknowledged"; write.receipt = receipt; }
        else if (notCommitted) delete current.write;
        else write.status = "unknown";
        this.#options.notify();
        if (result.status === "saved" && !receipt) return { status: "unavailable", body: null,
          error: "The original command receipt could not be verified. Keep its original operation ID." };
      }
      return result;
    };
    let unavailableStatus: number | null = null;
    try {
      // A synchronous notification can retire the source. It cannot turn this
      // not-yet-dispatched owner into an attempted/unknown operation.
      if (!dispatchCurrent()) {
        if (this.#versions.get(documentId)?.write === write) {
          if (previous) { if (write.sourceRetired) previous.sourceRetired = true; this.#versions.get(documentId)!.write = previous; }
          else delete this.#versions.get(documentId)!.write;
        }
        return notAttempted();
      }
      const response = await this.#options.fetch(path, init, action);
      if (!active()) return scopeChanged();
      if (privateResponseUnavailable(response.status)) {
        unavailableStatus = response.status;
        version = this.#withdraw(documentId, version, response.status).version;
      }
      if (!active()) return scopeChanged();
      const observedPrivateRevision = this.#resources.get(documentId)?.privateRevision ?? 0;
      const parsed: unknown = await response.json();
      if (!active()) return scopeChanged();
      const receipt = !response.ok && unavailableStatus !== null ? committedPrivateReceipt(parsed, response.status, identity) : undefined;
      if (receipt) return finish(accessDenied(response.status)
        ? { status: "forbidden", body: null, receipt, privateUnavailable: true, error: "Access changed after this exact command was committed. Its acknowledgment is retained; private details are unavailable." }
        : { status: "saved", body: null, receipt, privateUnavailable: true });
      const body = !response.ok && (unavailableStatus !== null || !owns() || !this.#sourceActive(source) || this.#resources.get(documentId)?.privateUnavailable) ? errorBody(parsed) : parsed;
      if (!response.ok) {
        const status = response.status === 409 ? "conflict" : accessDenied(response.status) ? "forbidden" : response.status >= 500 ? "unavailable" : "invalid";
        // These exact existing server codes prove a failed CAS/atomic admission,
        // or rejected requirement validation before commit. A bare status, a
        // missing receipt, private unavailability, or a malformed body does not.
        const fields = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
        const values = fields?.errorValues;
        const errorKeys = fields?.errorCode === fields?.error && values !== null && typeof values === "object" && !Array.isArray(values) && Object.keys(values).length === 0
          ? ["error", "errorCode", "errorValues"] : ["error"];
        const exactError = fields !== null && typeof fields.error === "string"
          && Object.keys(fields).length === errorKeys.length && errorKeys.every(key => Object.hasOwn(fields, key));
        const invalidRequirement = fields !== null && fields.error === "invalid_output_requirement" && Array.isArray(fields.issues)
          && Object.keys(fields).length === errorKeys.length + 1 && [...errorKeys, "issues"].every(key => Object.hasOwn(fields, key));
        const notCommitted = exactError && response.status === 409
          && ["output_revision_conflict", "output_revision_or_authority_changed"].includes(fields.error as string)
          || invalidRequirement && response.status === 400;
        // The exact export-only history refusal is emitted before any command
        // commit. A committed/replayed operation instead returns its withheld
        // acknowledgment; neither that receipt nor an ambiguous error is released.
        const historyNotCommitted = exactError && errorKeys.length === 3 && response.status === 409
          && identity.action === "export" && fields.error === "output_scope_history_reason_unverified"
          && fields.errorCode === "output_scope_history_reason_unverified";
        return finish({ status, body, error: message(body, "The change was not confirmed. Keep this draft and check the current requirements before retrying.") }, notCommitted || historyNotCommitted);
      }
      const result: OutputMutationResult<R> = { status: "saved", body: body as R };
      // A newer read owns the view; retain a known canonical acknowledgment without returning old private details.
      if (!owns() || !this.#sourceActive(source) || (this.#resources.get(documentId)?.privateRevision ?? 0) !== observedPrivateRevision) return finish(this.withholdCommandBody(documentId, result, identity));
      const candidate = body && typeof body === "object" && "snapshot" in body ? (body as { snapshot: unknown }).snapshot : body;
      if (this.#options.isSnapshot(candidate, documentId, scope)) {
        if (!this.#certifySnapshot(documentId, version, observedPrivateRevision)) return finish(this.withholdCommandBody(documentId, result, identity));
        const privateRevision = this.#resources.get(documentId)?.privateRevision;
        this.#publish(documentId, { state: "ready", snapshot: candidate, error: null, ...(privateRevision ? { privateRevision } : {}) });
      } else {
        this.invalidate(documentId);
      }
      if (!active()) return scopeChanged();
      return finish(!owns() || !this.#sourceActive(source) || this.#resources.get(documentId)?.privateUnavailable ? this.withholdCommandBody(documentId, result, identity) : result);
    } catch (error) {
      if (!active()) return scopeChanged();
      return finish({ status: unavailableStatus !== null && accessDenied(unavailableStatus) ? "forbidden" : "unavailable", body: null,
        error: unavailableStatus !== null || this.#resources.get(documentId)?.privateUnavailable ? "Private details are unavailable. Keep the original operation ID to recover its receipt." : error instanceof Error ? error.message : "The response was lost. Reuse the same operation ID to recover its receipt." });
    }
  }

  async download(documentId: string, path: string, init: RequestInit = {}, preview?: OutputPreviewFile): Promise<OutputCommandResult<{ blob: Blob; filename: string }>> {
    const scope = this.#capture();
    if (!scope) return { status: "forbidden", body: null, error: "Sign in before downloading deliverables." };
    const epoch = this.#epoch, source = this.#source();
    let version = this.#versions.get(documentId)?.current ?? 0;
    let privateRevision = this.#resources.get(documentId)?.privateRevision ?? 0;
    // Ordinary source-readiness refreshes remain the controller's exact-release check.
    // A private withdrawal retires bytes even if a later valid read restores this scope.
    const active = () => this.#active(scope, epoch) && this.#sourceActive(source) && (this.#resources.get(documentId)?.privateRevision ?? 0) === privateRevision;
    const changed = (): OutputCommandResult<{ blob: Blob; filename: string }> => ({ status: this.#active(scope, epoch) && !this.#resources.get(documentId)?.accessLost ? "unavailable" : "forbidden", body: null, error: "The current Output read changed before the download completed. Refresh before downloading again." });
    if (!active()) return changed();
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
    let unavailableStatus: number | null = null;
    try {
      const response = await this.#options.fetch(path, preview ? { ...init, redirect: "error" } : init, "download checked deliverables");
      if (!this.#active(scope, epoch)) return changed();
      if (!response.ok) {
        const withheld = privateResponseUnavailable(response.status);
        if (withheld) {
          unavailableStatus = response.status;
          const retirement = this.#withdraw(documentId, version, response.status);
          version = retirement.version;
          if (retirement.withdrawn) privateRevision = this.#resources.get(documentId)?.privateRevision ?? 0;
        }
        if (!active()) return changed();
        const parsed: unknown = await response.json();
        if (!active()) return changed();
        const body = withheld || this.#resources.get(documentId)?.privateUnavailable ? errorBody(parsed) : parsed;
        return { status: response.status === 409 ? "conflict" : accessDenied(response.status) ? "forbidden" : "unavailable", body, error: message(body, "The current files could not be downloaded.") };
      }
      const blob = preview ? await readOutputReviewPreview(response, preview, init.signal ?? undefined) : await response.blob();
      if (!active() || this.#resources.get(documentId)?.privateUnavailable) return changed();
      const filename = outputDownloadFilename(response.headers.get("content-disposition"));
      return { status: "saved", body: { blob, filename } };
    } catch (error) {
      if (!active()) return changed();
      return { status: unavailableStatus !== null && accessDenied(unavailableStatus) || this.#resources.get(documentId)?.accessLost ? "forbidden" : "unavailable", body: null, error: unavailableStatus !== null || this.#resources.get(documentId)?.privateUnavailable ? "Current private Output details are unavailable. Refresh before downloading again." : error instanceof Error ? error.message : "The download did not complete." };
    }
  }
}
