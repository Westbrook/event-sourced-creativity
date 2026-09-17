import { html, nothing, render } from "lit";
import { SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES, validateSelectedOutputSharePublicOutput,
  type SelectedOutputSharePublicOutput } from "../model/selected-output-share.ts";
import { FormaPresentationalElement } from "./presentational-element";
import { renderSelectedOutputShareContent } from "./selected-output-share-content.ts";
import { selectedOutputShareCopy } from "./selected-output-share-messages.ts";

const validToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{32}$/u.test(value);
type ReadOwner = { epoch: number; token: string; abort: AbortController; current: () => boolean };

/** Read exactly this public projection. This transport cannot consult private
 * native APIs, read source media, admit generation or establish claim authority.
 */
async function readSelectedOutput(token: string, origin: string, owner: ReadOwner): Promise<SelectedOutputSharePublicOutput> {
  const path = `/api/selected-output-shared/${token}`, expected = new URL(path, origin);
  const current = () => {
    if (owner.abort.signal.aborted || !owner.current()) throw new Error("selected_output_withdrawn");
  };
  if (!validToken(token) || expected.origin !== origin || !/^https?:$/u.test(expected.protocol)) throw new Error("selected_output_unavailable");
  current();
  // Resolve against the actual origin, not a document-controlled <base> URL.
  const response = await fetch(expected.href, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    referrerPolicy: "no-referrer", headers: { accept: "application/json" }, signal: owner.abort.signal });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    current();
    if (response.status !== 200 || response.redirected || response.url !== expected.href
      || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "") || !response.body) {
      throw new Error("selected_output_unavailable");
    }
    const declared = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
    const identity = encoding === null || encoding.trim().toLowerCase() === "identity";
    if (declared !== null && (!/^(0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared))
      || identity && Number(declared) > SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES)) throw new Error("selected_output_unavailable");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      current();
      const chunk = await reader.read();
      current();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array) || !chunk.value.byteLength) throw new Error("selected_output_unavailable");
      length += chunk.value.byteLength;
      if (length > SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES) throw new Error("selected_output_unavailable");
      chunks.push(chunk.value);
    }
    complete = true;
    // Fetch exposes decoded bytes; compressed Content-Length is a different
    // representation. The measured decoded-byte limit always applies.
    if (identity && declared !== null && Number(declared) !== length) throw new Error("selected_output_unavailable");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const candidate: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    current();
    const output = validateSelectedOutputSharePublicOutput(candidate);
    if (!output || Date.parse(output.expiresAt) <= Date.now()) throw new Error("selected_output_unavailable");
    current();
    return output;
  } finally {
    if (!complete) {
      try {
        const cancellation = reader ? reader.cancel() : response.body?.cancel();
        if (cancellation) void cancellation.catch(() => undefined);
      } catch { /* Cancellation cannot make unavailable data visible. */ }
    }
    reader?.releaseLock();
  }
}

/** @summary Selected shared output */
export class FormaSelectedOutputSharedView extends FormaPresentationalElement {
  static properties = { token: { type: String, noAccessor: true } };
  #token = "";
  #connected = false;
  #epoch = 0;
  #owner: ReadOwner | null = null;
  #output: SelectedOutputSharePublicOutput | null = null;
  #phase: "loading" | "ready" | "expired" | "unavailable" = "unavailable";
  #mount: HTMLElement | undefined;
  #expiryTimer: number | undefined;
  #expiryDeadline: number | undefined;

  get token(): string { return this.#token; }
  set token(value: string) {
    const next = typeof value === "string" ? value : "";
    if (next === this.#token) return;
    const previous = this.#token;
    this.#token = next;
    this.#retire();
    this.requestUpdate("token", previous);
    if (this.#connected && this.isConnected) void this.#load();
  }

  override connectedCallback() {
    if (this.#connected) return;
    this.#connected = true;
    super.connectedCallback();
    this.ownerDocument.addEventListener("visibilitychange", this.#visibility);
    void this.#load();
  }

  override disconnectedCallback() {
    this.#connected = false;
    this.ownerDocument.removeEventListener("visibilitychange", this.#visibility);
    this.#retire();
    super.disconnectedCallback();
  }

  #retire(phase: "expired" | "unavailable" = "unavailable") {
    ++this.#epoch;
    this.#owner?.abort.abort();
    this.#owner = null;
    this.#output = null;
    this.#phase = phase;
    if (this.#expiryTimer !== undefined) window.clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
    this.#expiryDeadline = undefined;
    // The public title and body live in this separate root. Retire them now,
    // before the next normal Lit update or any stale request can complete.
    if (this.#mount) render(nothing, this.#mount);
    this.requestUpdate();
  }

  #visibility = () => { if (this.ownerDocument.visibilityState === "visible") this.#checkExpiry(); };

  #checkExpiry() {
    if (this.#output && this.#remainingLifetime(this.#output) <= 0) this.#retire("expired");
  }

  #remainingLifetime(output: SelectedOutputSharePublicOutput) {
    return Math.min(Date.parse(output.expiresAt) - Date.now(), (this.#expiryDeadline ?? 0) - performance.now());
  }

  #scheduleExpiry(owner: ReadOwner, output: SelectedOutputSharePublicOutput) {
    if (!owner.current() || this.#output !== output) return;
    const remaining = this.#remainingLifetime(output);
    if (remaining <= 0) { this.#retire("expired"); return; }
    const expiryTimer = window.setTimeout(() => {
      if (!owner.current() || this.#output !== output || this.#expiryTimer !== expiryTimer) return;
      this.#expiryTimer = undefined;
      // Clock changes and early timers cannot extend the received expiry.
      this.#scheduleExpiry(owner, output);
    }, Math.min(remaining, 2_147_483_647));
    this.#expiryTimer = expiryTimer;
  }

  async #load() {
    if (!this.#connected || !this.isConnected) return;
    this.#retire();
    const token = this.#token, document = this.ownerDocument, origin = document.location.origin;
    if (!validToken(token)) return;
    const owner: ReadOwner = { epoch: this.#epoch, token, abort: new AbortController(), current: () => false };
    owner.current = () => this.#connected && this.isConnected && this.#owner === owner && this.#epoch === owner.epoch
      && this.#token === owner.token && this.ownerDocument === document && document.location.origin === origin;
    this.#owner = owner;
    this.#phase = "loading";
    this.requestUpdate();
    try {
      const output = await readSelectedOutput(token, origin, owner);
      if (!owner.current()) return;
      this.#output = output;
      // Capture the accepted lifetime once. A clock rollback, locale change or
      // early timer cannot move this elapsed-time deadline into the future.
      this.#expiryDeadline = performance.now() + Math.max(0, Date.parse(output.expiresAt) - Date.now());
      this.#phase = "ready";
      this.#scheduleExpiry(owner, output);
      this.requestUpdate();
    } catch {
      if (owner.current()) this.#retire();
    }
  }

  protected override updated() {
    this.#mount = this.querySelector<HTMLElement>("[data-selected-output-share-mount]") ?? undefined;
    this.#checkExpiry();
    if (!this.#mount) return;
    const output = this.#output;
    render(this.isConnected && this.#owner?.current() && output
      ? renderSelectedOutputShareContent(output, this.i18n) : nothing, this.#mount);
  }

  override render() {
    this.#checkExpiry();
    const locale = this.i18n, copy = selectedOutputShareCopy(locale.locale);
    const status = this.#phase === "loading" ? copy.loading : this.#phase === "expired" ? copy.expired
      : this.#phase === "unavailable" ? copy.unavailable : "";
    return html`<main id="main-content" class="selected-output-shared-view retained-story-page" tabindex="-1"
      lang=${locale.locale} dir=${locale.direction} aria-label=${copy.sharedOutput} aria-busy=${String(this.#phase === "loading")}
      style="max-inline-size:72rem;margin-inline:auto;padding:clamp(1rem,4vi,3rem)">
      <p class="selected-output-share-status" role="status" aria-live="polite">${status}</p>
      <div data-selected-output-share-mount></div>
    </main>`;
  }
}

if (!customElements.get("forma-selected-output-shared-view")) customElements.define("forma-selected-output-shared-view", FormaSelectedOutputSharedView);

declare global { interface HTMLElementTagNameMap { "forma-selected-output-shared-view": FormaSelectedOutputSharedView } }
