import { html, nothing, render } from "lit";
import { parseSelectedOutputShareAnySelection, SELECTED_OUTPUT_SHARE_MAX_LIFETIME_MS,
  SELECTED_OUTPUT_SHARE_TITLE_MAX_BYTES, type SelectedOutputShareReview } from "../model/selected-output-share.ts";
import { createSelectedOutputShareClient, type SelectedOutputShareClient, type SelectedOutputShareLease,
  type SelectedOutputShareMetadata, type SelectedOutputSharePrepared } from "../selected-output-share-client.ts";
import { FormaPresentationalElement } from "./presentational-element";
import { renderSelectedOutputShareContent } from "./selected-output-share-content.ts";
import { selectedOutputShareCopy, selectedOutputShareExpiryLabel } from "./selected-output-share-messages.ts";
import type { SelectedOutputShareReadMedia } from "../selected-output-share-media-client.ts";
import { mountSelectedOutputShareMedia } from "./selected-output-share-media-view.ts";
import "./forma-selected-output-share-review.css";

type Owner = { epoch: number; abort: AbortController; current: () => boolean; client: SelectedOutputShareClient;
  readMedia: SelectedOutputShareReadMedia | undefined };
type MediaPreview = { candidate: SelectedOutputSharePrepared; mount: HTMLElement; abort: AbortController;
  view?: ReturnType<typeof mountSelectedOutputShareMedia> };
type Status = "" | "loading" | "unavailable" | "linkPublished" | "copied" | "revoked" | "expired";

function reviewFromInputs(title: string, localExpiry: string): SelectedOutputShareReview | null {
  if (!title.trim() || [...title].some(character => { const code = character.charCodeAt(0); return code <= 31 || code >= 127 && code <= 159; })
    || new TextEncoder().encode(title).byteLength > SELECTED_OUTPUT_SHARE_TITLE_MAX_BYTES
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(localExpiry)) return null;
  const parts = localExpiry.split(/\D/u).map(Number), date = new Date(localExpiry), at = date.getTime();
  if (!Number.isFinite(at) || date.getFullYear() !== parts[0] || date.getMonth() + 1 !== parts[1]
    || date.getDate() !== parts[2] || date.getHours() !== parts[3] || date.getMinutes() !== parts[4]
    || at <= Date.now() || at - Date.now() > SELECTED_OUTPUT_SHARE_MAX_LIFETIME_MS) return null;
  return Object.freeze({ title, expiresAt: date.toISOString() });
}

/* An explicit publisher surface. A source lease identifies one host authority
 * lifetime; it is not permission to publish. The host must abort it immediately
 * when selection or authority changes, including an A -> B -> A transition. */
/** @summary Share output */
export class FormaSelectedOutputShareReview extends FormaPresentationalElement {
  static properties = { source: { attribute: false, noAccessor: true }, enabled: { type: Boolean, noAccessor: true } };
  #source: SelectedOutputShareLease | null = null;
  #enabled = false;
  #connected = false;
  #epoch = 0;
  #owner: Owner | null = null;
  #sourceAbort: (() => void) | undefined;
  #open = false;
  #available = false;
  #title = "";
  #expiry = "";
  #composing = false;
  #busy = false;
  #listBusy = false;
  #listVerified = false;
  #listFailed = false;
  #managementKnown = false;
  #status: Status = "";
  #candidate: SelectedOutputSharePrepared | null = null;
  #url = "";
  #linkExpiry = "";
  #pendingRevokeId: string | null = null;
  #shares: readonly SelectedOutputShareMetadata[] = [];
  #cursor: string | null = null;
  #previewMount: HTMLElement | undefined;
  #linkMount: HTMLElement | undefined;
  #expiryTimer: number | undefined;
  #expiryDeadline: number | null = null;
  #transientEpoch = 0;
  #listEpoch = 0;
  #listRequest = 0;
  #focusTitle = false;
  #focusManagement = false;
  #focusReturn = false;
  #media: MediaPreview | null = null;
  #mediaReady = false;

  get source(): SelectedOutputShareLease | null { return this.#source; }
  set source(value: SelectedOutputShareLease | null) {
    // Lit recommits object properties on parent updates, including locale
    // changes. Preserve the same valid lease; replacements remain monotonic.
    if (value === this.#source) {
      if (this.#owner && !this.#owner.current()) this.#retire();
      return;
    }
    const previous = this.#source;
    this.#retire();
    this.#source = value;
    this.requestUpdate("source", previous);
    if (this.#connected) this.#start();
  }

  /** Additional host clamp. It cannot override the server capability. */
  get enabled(): boolean { return this.#enabled; }
  set enabled(value: boolean) {
    const next = value === true;
    if (next === this.#enabled) return;
    const previous = this.#enabled;
    this.#enabled = next;
    this.#retire();
    this.requestUpdate("enabled", previous);
    if (this.#connected) this.#start();
  }

  override connectedCallback() {
    if (this.#connected) return;
    this.#connected = true;
    super.connectedCallback();
    this.ownerDocument.addEventListener("visibilitychange", this.#visibility);
    this.#start();
  }

  override disconnectedCallback() {
    this.#connected = false;
    this.ownerDocument.removeEventListener("visibilitychange", this.#visibility);
    this.#retire();
    super.disconnectedCallback();
  }

  #clearTransient() {
    ++this.#transientEpoch;
    this.#clearMedia();
    this.#candidate = null;
    this.#url = "";
    this.#linkExpiry = "";
    this.#expiryDeadline = null;
    if (this.#expiryTimer !== undefined) window.clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
    // Retire authored candidate bytes and one-time token before Lit's next turn.
    if (this.#previewMount) render(nothing, this.#previewMount);
    if (this.#linkMount) render(nothing, this.#linkMount);
  }

  #clearMedia() {
    const media = this.#media;
    this.#media = null;
    this.#mediaReady = false;
    media?.abort.abort();
    media?.view?.dispose();
  }

  #retire() {
    ++this.#epoch;
    ++this.#listEpoch;
    ++this.#listRequest;
    this.#sourceAbort?.();
    this.#sourceAbort = undefined;
    this.#owner?.abort.abort();
    this.#owner = null;
    this.#clearTransient();
    this.#available = false;
    this.#open = false;
    this.#title = "";
    this.#expiry = "";
    this.#composing = false;
    this.#busy = this.#listBusy = false;
    this.#listVerified = false;
    this.#listFailed = false;
    this.#managementKnown = false;
    this.#pendingRevokeId = null;
    this.#shares = [];
    this.#cursor = null;
    this.#status = "";
    this.#focusTitle = this.#focusManagement = this.#focusReturn = false;
    this.requestUpdate();
  }

  #start() {
    if (!this.#connected || !this.isConnected || this.#owner) return;
    const source = this.#source, document = this.ownerDocument, origin = document.location.origin;
    const selection = parseSelectedOutputShareAnySelection(source?.selection);
    if (!source || !selection || !(source.signal instanceof AbortSignal) || source.signal.aborted || typeof source.isCurrent !== "function") return;
    const sourceSignal = source.signal, sourceCurrent = source.isCurrent, readMedia = source.readMedia, epoch = this.#epoch;
    if (readMedia !== undefined && typeof readMedia !== "function") return;
    const abort = new AbortController();
    const current = () => {
      if (!this.#connected || !this.isConnected || abort.signal.aborted || sourceSignal.aborted
        || this.#epoch !== epoch || this.#source !== source || this.ownerDocument !== document
        || document.location.origin !== origin || source.signal !== sourceSignal || source.isCurrent !== sourceCurrent || source.readMedia !== readMedia) return false;
      try {
        const now = parseSelectedOutputShareAnySelection(source.selection);
        return now !== null && Object.keys(selection).every(key => now[key as keyof typeof now] === selection[key as keyof typeof selection])
          && sourceCurrent() === true;
      } catch { return false; }
    };
    if (!current()) return;
    const onAbort = () => this.#retire();
    sourceSignal.addEventListener("abort", onAbort, { once: true });
    this.#sourceAbort = () => sourceSignal.removeEventListener("abort", onAbort);
    try {
      const client = createSelectedOutputShareClient({ selection, signal: abort.signal, isCurrent: current }, { origin });
      const owner: Owner = { epoch, abort, current, client, readMedia };
      this.#owner = owner;
      // Bounded owned metadata discovery is read-only. A successful nonempty
      // result can reveal management; it never supplies creation permission.
      void this.#loadLinks(false, true);
      void client.availability().then(available => {
        if (!owner.current() || this.#owner !== owner) return;
        this.#available = available;
        this.requestUpdate();
      }).catch(() => {
        if (!owner.current() || this.#owner !== owner) return;
        this.#available = false;
        this.requestUpdate();
      });
    } catch { this.#retire(); }
  }

  #validOwner(): Owner | null {
    const owner = this.#owner;
    if (owner && owner.current()) return owner;
    if (owner) this.#retire();
    return null;
  }

  #show = () => {
    if (!this.#validOwner()) return;
    const canCreate = this.#enabled && this.#available;
    if (!canCreate && !this.#managementKnown && !this.#pendingRevokeId) return;
    this.#open = true;
    this.#focusTitle = canCreate;
    this.#focusManagement = !canCreate;
    this.requestUpdate();
  };

  #close = () => {
    if (!this.#validOwner()) return;
    const pendingRevokeId = this.#pendingRevokeId;
    const managementKnown = this.#managementKnown;
    this.#retire();
    // Closing is the same host-source lifetime. Preserve known management and
    // the pending ID, while retiring content, one-time tokens and transport.
    this.#pendingRevokeId = pendingRevokeId;
    this.#managementKnown = managementKnown;
    this.#focusReturn = true;
    this.#start();
  };

  #edit = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    if (input.name === "share-title") this.#title = input.value;
    if (input.name === "share-expiry") this.#expiry = input.value;
    this.#clearTransient();
    this.#status = "";
    this.requestUpdate();
  };

  #compositionStart = () => { this.#composing = true; this.#clearTransient(); this.requestUpdate(); };
  #compositionEnd = (event: CompositionEvent) => { this.#composing = false; this.#edit(event); };
  #visibility = () => { if (this.ownerDocument.visibilityState === "visible") this.#checkExpiry(); };

  #checkExpiry() {
    const expiry = this.#candidate?.candidate.publicOutput.expiresAt || this.#linkExpiry;
    if (expiry && (Date.parse(expiry) <= Date.now() || this.#expiryDeadline !== null && this.#expiryDeadline <= performance.now())) {
      this.#clearTransient();
      this.#status = "expired";
      this.requestUpdate();
    }
  }

  #scheduleExpiry(owner: Owner) {
    const expiry = this.#candidate?.candidate.publicOutput.expiresAt || this.#linkExpiry;
    if (!owner.current() || !expiry) return;
    const remaining = Math.min(Date.parse(expiry) - Date.now(), (this.#expiryDeadline ?? -Infinity) - performance.now());
    if (remaining <= 0) { this.#checkExpiry(); return; }
    if (this.#expiryTimer !== undefined) window.clearTimeout(this.#expiryTimer);
    const timer = window.setTimeout(() => {
      if (this.#expiryTimer !== timer || !owner.current()) return;
      this.#expiryTimer = undefined;
      this.#scheduleExpiry(owner);
    }, Math.min(remaining, 2_147_483_647));
    this.#expiryTimer = timer;
  }

  #review = async () => {
    const owner = this.#validOwner(), review = reviewFromInputs(this.#title, this.#expiry);
    if (!owner || !this.#open || !this.#enabled || !this.#available || this.#busy || this.#composing || !review || this.#pendingRevokeId) return;
    this.#clearTransient();
    const transientEpoch = this.#transientEpoch;
    this.#busy = true;
    this.#status = "loading";
    this.requestUpdate();
    try {
      const candidate = await owner.client.prepare(review, crypto.randomUUID());
      if (!owner.current() || this.#owner !== owner || this.#transientEpoch !== transientEpoch || this.#title !== review.title
        || reviewFromInputs(this.#title, this.#expiry)?.expiresAt !== review.expiresAt || !this.#enabled) return;
      this.#candidate = candidate;
      // Capture once. A later wall-clock rollback cannot lengthen this review
      // lifetime or the one-time link issued from the same candidate.
      this.#expiryDeadline = performance.now() + Math.max(0, Date.parse(candidate.candidate.publicOutput.expiresAt) - Date.now());
      this.#status = "";
      this.#scheduleExpiry(owner);
    } catch { if (owner.current() && this.#owner === owner && this.#transientEpoch === transientEpoch) this.#status = "unavailable"; }
    finally { if (owner.current() && this.#owner === owner) { this.#busy = false; this.requestUpdate(); } }
  };

  #publish = async () => {
    this.#checkExpiry();
    const owner = this.#validOwner(), prepared = this.#candidate;
    if (!owner || !this.#open || !this.#enabled || !this.#available || this.#busy || this.#composing || !prepared || this.#pendingRevokeId) return;
    if ("mediaIdentity" in prepared.candidate && !this.#mediaReady) return;
    const review = reviewFromInputs(this.#title, this.#expiry);
    if (!review || review.title !== prepared.candidate.publicOutput.title || review.expiresAt !== prepared.candidate.publicOutput.expiresAt) return;
    // One gesture consumes the candidate locally even if its acknowledgement is
    // lost. Only an explicit revoke can unlock another attempt in this lifetime.
    this.#clearMedia();
    this.#candidate = null;
    const transientEpoch = this.#transientEpoch;
    this.#pendingRevokeId = prepared.candidateId;
    this.#managementKnown = true;
    this.#busy = true;
    this.#status = "loading";
    this.requestUpdate();
    try {
      const result = await owner.client.commit(prepared.candidateId, prepared.candidate);
      if (!owner.current() || this.#owner !== owner || this.#transientEpoch !== transientEpoch) return;
      if (result.share.token) {
        this.#url = new URL(`/share/output/${result.share.token}`, this.ownerDocument.location.origin).href;
        this.#linkExpiry = result.share.expiresAt;
        this.#status = "linkPublished";
        this.#scheduleExpiry(owner);
      } else this.#status = "unavailable";
    } catch { if (owner.current() && this.#owner === owner && this.#transientEpoch === transientEpoch) this.#status = "unavailable"; }
    finally {
      if (owner.current() && this.#owner === owner) {
        this.#busy = false;
        this.requestUpdate();
        void this.#loadLinks(false);
      }
    }
  };

  #loadLinks = async (more: boolean, discovery = false) => {
    const owner = this.#validOwner();
    if (!owner || !discovery && !this.#open || this.#listBusy || more && !this.#cursor) return;
    const listEpoch = this.#listEpoch;
    const request = ++this.#listRequest;
    this.#listBusy = true;
    this.#listVerified = false;
    this.requestUpdate();
    try {
      const page = await owner.client.list(more ? this.#cursor ?? undefined : undefined);
      if (!owner.current() || this.#owner !== owner || this.#listEpoch !== listEpoch || this.#listRequest !== request) return;
      const shares = more ? [...this.#shares, ...page.shares] : page.shares;
      this.#shares = [...new Map(shares.map(share => [share.shareId, share])).values()];
      this.#cursor = page.nextCursor;
      this.#listVerified = true;
      this.#listFailed = false;
      if (this.#shares.length) this.#managementKnown = true;
    } catch { if (owner.current() && this.#owner === owner && this.#listRequest === request && this.#listEpoch === listEpoch) this.#listFailed = true; }
    finally { if (owner.current() && this.#owner === owner && this.#listRequest === request) { this.#listBusy = false; this.requestUpdate(); } }
  };

  #revoke = async (shareId: string) => {
    const owner = this.#validOwner();
    if (!owner || !this.#open || this.#busy) return;
    ++this.#listEpoch;
    this.#busy = true;
    this.#clearTransient();
    this.#status = "loading";
    this.requestUpdate();
    try {
      await owner.client.revoke(shareId);
      if (!owner.current() || this.#owner !== owner) return;
      this.#shares = this.#shares.filter(share => share.shareId !== shareId);
      if (this.#pendingRevokeId === shareId) this.#pendingRevokeId = null;
      // A cursor proves an unrevoked anchor row. Rebuild it after any revoke,
      // and supersede an older read which could otherwise restore that row.
      this.#cursor = null;
      this.#listBusy = false;
      this.#status = "revoked";
      void this.#loadLinks(false);
    } catch { if (owner.current() && this.#owner === owner) this.#status = "unavailable"; }
    finally { if (owner.current() && this.#owner === owner) { this.#busy = false; this.requestUpdate(); } }
  };

  #copy = async () => {
    this.#checkExpiry();
    const owner = this.#validOwner(), url = this.#url;
    if (!owner || !this.#open || !url) return;
    try {
      const clipboard = this.ownerDocument.defaultView?.navigator.clipboard;
      if (!clipboard) throw new Error("clipboard_unavailable");
      await clipboard.writeText(url);
      this.#checkExpiry();
      if (!owner.current() || this.#owner !== owner || this.#url !== url) return;
      this.#status = "copied";
    } catch { if (owner.current() && this.#owner === owner) this.#status = "unavailable"; }
    this.requestUpdate();
  };

  protected override updated() {
    this.#previewMount = this.querySelector<HTMLElement>("[data-selected-output-review-mount]") ?? undefined;
    this.#linkMount = this.querySelector<HTMLElement>("[data-selected-output-link-mount]") ?? undefined;
    this.#checkExpiry();
    const owner = this.#validOwner(), copy = selectedOutputShareCopy(this.i18n.locale);
    if (this.#previewMount) render(owner && this.#open && this.#candidate
      ? renderSelectedOutputShareContent(this.#candidate.candidate.publicOutput, this.i18n) : nothing, this.#previewMount);
    this.#syncMedia(owner);
    if (this.#linkMount) render(owner && this.#open && this.#url ? html`<p><a href=${this.#url} referrerpolicy="no-referrer"
      translate="no" dir="ltr">${this.#url}</a> <button type="button" @click=${this.#copy}>${copy.copyLink}</button></p>` : nothing, this.#linkMount);
    if (this.#focusTitle && owner && this.#open) {
      this.#focusTitle = false;
      this.querySelector<HTMLInputElement>('input[name="share-title"]')?.focus();
    }
    if (this.#focusManagement && owner && this.#open) {
      this.#focusManagement = false;
      (this.querySelector<HTMLButtonElement>("[data-selected-output-revoke]")
        ?? this.querySelector<HTMLButtonElement>("[data-selected-output-share-close]"))?.focus();
    }
    if (this.#focusReturn && owner && !this.#open
      && (this.#enabled && this.#available || this.#managementKnown || this.#pendingRevokeId)) {
      this.#focusReturn = false;
      this.querySelector<HTMLButtonElement>("[data-selected-output-share-open]")?.focus();
    }
  }

  #syncMedia(owner: Owner | null) {
    const candidate = this.#candidate, output = candidate?.candidate.publicOutput;
    const mount = this.#previewMount?.querySelector<HTMLElement>("[data-selected-output-media-mount]");
    if (!owner || !this.#open || !candidate || !output || !(output.output === "audio" || output.output === "video" || output.output === "model3d") || !mount) {
      this.#clearMedia(); return;
    }
    if (this.#media?.candidate === candidate && this.#media.mount === mount) {
      this.#media.view?.refresh(this.i18n); return;
    }
    this.#clearMedia();
    if (!owner.readMedia) return;
    const preview: MediaPreview = { candidate, mount, abort: new AbortController() };
    this.#media = preview;
    const current = () => this.#media === preview && !preview.abort.signal.aborted && owner.current()
      && this.#owner === owner && this.#candidate === candidate && this.#open
      && Date.parse(output.expiresAt) > Date.now() && this.#expiryDeadline !== null && this.#expiryDeadline > performance.now();
    try {
      preview.view = mountSelectedOutputShareMedia(mount, output, { locale: this.i18n,
        readMedia: owner.readMedia, signal: preview.abort.signal, isCurrent: current,
        onReady: ready => {
          if (!current() || this.#mediaReady === ready) return;
          this.#mediaReady = ready; this.requestUpdate();
        } });
    } catch {
      this.#clearMedia();
      this.#status = "unavailable";
      this.requestUpdate();
    }
  }

  override render() {
    this.#checkExpiry();
    const owner = this.#validOwner(), locale = this.i18n, copy = selectedOutputShareCopy(locale.locale);
    const canCreate = owner && this.#enabled && this.#available;
    const reachable = owner && (canCreate || this.#managementKnown || this.#pendingRevokeId);
    const entryLabel = canCreate ? copy.shareOutput : copy.manageLinks;
    const canReview = canCreate && !this.#busy && !this.#composing && !this.#pendingRevokeId && reviewFromInputs(this.#title, this.#expiry);
    const status = this.#listFailed ? copy.unavailable : this.#status ? copy[this.#status] : "";
    return html`<section class="selected-output-share-review" lang=${locale.locale} dir=${locale.direction} aria-label=${entryLabel} ?hidden=${!reachable}>
      <button type="button" data-selected-output-share-open ?disabled=${!owner} ?hidden=${this.#open} @click=${this.#show}>${entryLabel}</button>
      <div ?hidden=${!this.#open}>
        <p>${copy.accessScope}</p>
        <div class="selected-output-share-creation" ?hidden=${!canCreate}>
        <p>${copy.reviewHint}</p>
        <label>${copy.title}<input name="share-title" type="text" required dir="auto" translate="no" autocomplete="off"
          .value=${this.#title} ?disabled=${this.#busy} @input=${this.#edit}
          @compositionstart=${this.#compositionStart} @compositionend=${this.#compositionEnd}></label>
        <label>${copy.expires}<input name="share-expiry" type="datetime-local" required step="60" autocomplete="off"
          .value=${this.#expiry} ?disabled=${this.#busy} @input=${this.#edit}></label>
        <button type="button" ?disabled=${!canReview} @click=${this.#review}>${copy.review}</button>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true">${status}</p>
        <div data-selected-output-review-mount></div>
        ${this.#candidate && "mediaIdentity" in this.#candidate.candidate ? html`<p>${copy.reviewFile}</p>` : nothing}
        <button type="button" ?hidden=${!canCreate || !this.#candidate} ?disabled=${!canCreate || this.#busy || !this.#candidate || "mediaIdentity" in this.#candidate.candidate && !this.#mediaReady}
          @click=${this.#publish}>${copy.publishLink}</button>
        <div data-selected-output-link-mount></div>
        ${this.#pendingRevokeId && !this.#shares.some(share => share.shareId === this.#pendingRevokeId)
          ? html`<button type="button" data-selected-output-revoke ?disabled=${this.#busy} @click=${() => void this.#revoke(this.#pendingRevokeId!)}>${copy.revokeLink}</button>` : nothing}
        <ul aria-busy=${String(this.#listBusy)}>${this.#shares.map(share => html`<li>
          <span translate="no" dir="auto">${share.title}</span> <span>${copy.outputKinds[share.output]}</span>
          <span>${selectedOutputShareExpiryLabel(locale.locale, locale.date(new Date(share.expiresAt), { dateStyle: "medium", timeStyle: "short" }))}</span>
          <button type="button" data-selected-output-revoke ?disabled=${this.#busy} @click=${() => void this.#revoke(share.shareId)}>${copy.revokeLink}</button>
        </li>`)}</ul>
        ${this.#listVerified && !this.#listBusy && !this.#shares.length && !this.#pendingRevokeId ? html`<p>${copy.noLinks}</p>` : nothing}
        ${this.#cursor ? html`<button type="button" ?disabled=${this.#busy || this.#listBusy} @click=${() => void this.#loadLinks(true)}>${copy.moreLinks}</button>` : nothing}
        ${this.#listFailed || this.#status === "unavailable" ? html`<button type="button" ?disabled=${this.#listBusy} @click=${() => void this.#loadLinks(false)}>${copy.tryAgain}</button>` : nothing}
        <p>${copy.recordDisclosure}</p>
        <button type="button" data-selected-output-share-close @click=${this.#close}>${copy.close}</button>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-selected-output-share-review")) customElements.define("forma-selected-output-share-review", FormaSelectedOutputShareReview);
declare global { interface HTMLElementTagNameMap { "forma-selected-output-share-review": FormaSelectedOutputShareReview } }
