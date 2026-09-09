import { html, nothing, render } from "lit";
import { FormaElement } from "./forma-element";
import { artifactFocusRoute, routePathname } from "../model/routes";
import { documentArtifactRevision } from "../model/document-artifacts";
import { parseRetainedStoryRoute, type RetainedStoryDto, type RetainedStorySelection } from "../model/retained-short-story.ts";
import { parseNativeRetainedOutputRoute, type NativeRetainedOutputDto } from "../model/native-retained-output.ts";
import { readRetainedShortStory, readNativeRetainedOutput } from "../model/retained-short-story-client.ts";
import "./forma-retained-short-story.css";

type RetainedOutputKind = "short_story" | "scene" | "slides";
type RetainedOutput = RetainedStoryDto | NativeRetainedOutputDto;
type SlidesRenderer = typeof import("./native-retained-slides.ts").renderNativeRetainedSlides;
type ReadOwner = {
  epoch: number;
  route: string;
  output: RetainedOutputKind;
  selection: RetainedStorySelection;
  abort: AbortController;
  current: () => boolean;
};

/* Native personal read host. Only the selector can disclose a retained result.
 * The separate literal mount is cleared synchronously when its owner retires.
 * No Experience release/source identity is invented for a native artifact.
 */
/** @summary Output */
export class FormaRetainedShortStory extends FormaElement {
  #epoch = 0;
  #route = "";
  #attempted = false;
  #withdrawn = false;
  #owner: ReadOwner | null = null;
  #output: RetainedOutputKind = "short_story";
  #result: RetainedOutput | null = null;
  #slidesRenderer: SlidesRenderer | null = null;
  #phase: "waiting" | "loading" | "ready" | "unavailable" = "waiting";
  #unsubscribe?: () => void;
  #mount?: HTMLElement;
  #expiryTimer: ReturnType<typeof setTimeout> | undefined;

  override connectedCallback() {
    super.connectedCallback();
    this.#unsubscribe = this.store.subscribe(this.#sync);
    window.addEventListener("forma-authorization-changed", this.#withdraw);
    window.addEventListener("forma-event-source-retired", this.#withdraw);
    window.addEventListener("pagehide", this.#withdraw);
    document.addEventListener("visibilitychange", this.#visibility);
    this.#sync();
  }
  override disconnectedCallback() {
    this.#unsubscribe?.(); this.#unsubscribe = undefined;
    window.removeEventListener("forma-authorization-changed", this.#withdraw);
    window.removeEventListener("forma-event-source-retired", this.#withdraw);
    window.removeEventListener("pagehide", this.#withdraw);
    document.removeEventListener("visibilitychange", this.#visibility);
    this.#withdraw();
    super.disconnectedCallback();
  }
  #clear() {
    ++this.#epoch;
    this.#owner?.abort.abort();
    this.#owner = null;
    this.#result = null;
    this.#slidesRenderer = null;
    if (this.#expiryTimer !== undefined) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
    if (this.#mount) render(nothing, this.#mount);
    this.#phase = "unavailable";
    this.requestUpdate();
  }
  #withdraw = () => {
    // Authorization events precede session publication: do not wait for the old key to change.
    this.#withdrawn = true;
    this.#clear();
  };
  #visibility = () => { if (document.visibilityState !== "visible") this.#withdraw(); };

  #sync = () => {
    if (!this.isConnected) return;
    const route = this.store.route.get();
    if (route !== this.#route) {
      this.#clear();
      this.#route = route;
      const pathname = routePathname(route);
      this.#output = pathname === "/make/scene" ? "scene" : pathname === "/make/slides" ? "slides" : "short_story";
      this.#withdrawn = false;
      this.#attempted = false;
    }
    if (this.#withdrawn) return;
    if (this.#owner) {
      if (!this.#owner.current() || this.#result && !(Date.parse(this.#result.expiresAt) > Date.now())) this.#withdraw();
      return;
    }
    if (this.#attempted) return;
    if (this.store.loading.get()) { this.#phase = "waiting"; this.requestUpdate(); return; }
    const target = parseNativeRetainedOutputRoute(route);
    const selection = this.#output === "short_story" ? parseRetainedStoryRoute(route) : target?.selection;
    const output = this.#output, session = this.store.session.get();
    const authorization = this.store.captureAuthorizationScope(), source = this.store.captureSourceOwnership();
    const projection = this.store.projection.get();
    const artifact = selection ? projection.libraryArtifacts.find(value => value.id === selection.artifactId) : undefined;
    const personal = () => {
      const active = this.store.session.get();
      return Boolean(active && active.user.userId !== "anonymous" && !active.projectContext && !active.impersonation
        && (active.user.role === "creator" || active.user.role === "admin"));
    };
    // The root-owned exact task route supplies the named Document projection, without opening/writing a Document.
    if (!selection || !session || !personal() || !authorization || authorization.shared
      || !this.store.authorizationScopeActive(authorization) || !this.store.sourceOwnershipActive(source)
      || projection.documentId !== selection.documentId || !projection.projectId
      || !artifact || artifact.kind !== output || artifact.documentId !== selection.documentId
      || documentArtifactRevision(this.store.events.get(), artifact.id) !== selection.revision) {
      this.#phase = "unavailable"; this.requestUpdate(); return;
    }
    const projectId = projection.projectId, actorId = session.user.userId;
    const owner: ReadOwner = { epoch: ++this.#epoch, route, output, selection, abort: new AbortController(), current: () => false };
    owner.current = () => {
      const now = this.store.projection.get();
      const selected = now.libraryArtifacts.find(value => value.id === selection.artifactId);
      return this.isConnected && this.#owner === owner && this.#epoch === owner.epoch && !owner.abort.signal.aborted
        && !this.#withdrawn && this.store.route.get() === route && personal()
        && this.store.session.get()?.user.userId === actorId && this.store.authorizationScopeActive(authorization)
        && this.store.sourceOwnershipActive(source) && !this.store.loading.get()
        && now.projectId === projectId && now.documentId === selection.documentId
        && selected?.kind === output && selected.documentId === selection.documentId
        && selected.sourceEventId === artifact.sourceEventId && selected.contentRef === artifact.contentRef
        && selected.sequence === artifact.sequence
        && documentArtifactRevision(this.store.events.get(), artifact.id) === selection.revision;
    };
    this.#owner = owner;
    this.#attempted = true;
    this.#phase = "loading";
    this.requestUpdate();
    void this.#load(owner);
  };

  async #load(owner: ReadOwner) {
    try {
      const controls = {
        origin: this.ownerDocument.location.origin, signal: owner.abort.signal, current: owner.current,
        request: (path: string, init: RequestInit) => this.store.guardedFetch(path, init,
          owner.output === "short_story" ? "Read story" : "Read output", { current: owner.current }),
      };
      const result = owner.output === "short_story"
        ? await readRetainedShortStory(owner.selection, controls)
        : await readNativeRetainedOutput({ output: owner.output, selection: owner.selection }, controls);
      let slidesRenderer: SlidesRenderer | null = null;
      if (owner.current() && result.kind === "native-retained-output" && result.output === "slides") {
        // The story/Scene path does not load the slide leaf or its presentation dependencies.
        slidesRenderer = (await import("./native-retained-slides.ts")).renderNativeRetainedSlides;
      }
      if (!owner.current() || !(Date.parse(result.expiresAt) > Date.now())) {
        if (this.#owner === owner) this.#withdraw();
        return;
      }
      this.#result = result;
      this.#slidesRenderer = slidesRenderer;
      this.#phase = "ready";
      this.#armExpiry(owner, result);
      this.requestUpdate();
    } catch {
      if (this.#owner === owner) this.#withdraw();
    }
  }
  #armExpiry(owner: ReadOwner, result: RetainedOutput) {
    const deadline = Date.parse(result.expiresAt);
    const check = () => {
      if (this.#owner !== owner || this.#result !== result) return;
      if (!owner.current() || Date.now() >= deadline) { this.#withdraw(); return; }
      this.#expiryTimer = setTimeout(check, Math.min(2_147_483_647, Math.max(1, deadline - Date.now())));
    };
    check();
  }
  #retry = () => {
    this.#clear();
    this.#withdrawn = false;
    this.#attempted = false;
    this.#sync();
  };
  #ready() { return Boolean(this.#owner?.current() && this.#result && Date.parse(this.#result.expiresAt) > Date.now()); }
  #handoff(event: MouseEvent) {
    if (!this.#ready()) { event.preventDefault(); this.#withdraw(); return; }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const owner = this.#owner!, result = this.#result!;
    // This opens the exact output in full Forma. Native controls separately confirm editing and authorize any save.
    this.store.setRoute(this.#href(result.selection), { documentId: result.selection.documentId,
      current: () => owner.current() && this.#result === result && Date.parse(result.expiresAt) > Date.now() });
  }
  #href(selection: RetainedStorySelection) {
    return artifactFocusRoute(selection.artifactId, "", { expectedRevision: selection.revision,
      expectedContentSha256: selection.contentSha256, intent: "inspect" }, `/library?document=${encodeURIComponent(selection.documentId)}`);
  }
  #label() {
    return this.#output === "scene" ? this.i18n.t("artifact.scene.label", "Scene")
      : this.#output === "slides" ? this.i18n.t("artifact.slides.label", "Slides")
      : this.i18n.t("artifact.short_story.label", "Short story");
  }
  protected override updated() {
    this.#mount = this.querySelector<HTMLElement>("[data-retained-story-mount]") ?? undefined;
    if (!this.#mount) return;
    const result = this.#result;
    if (!this.#ready() || !result) { render(nothing, this.#mount); return; }
    if (result.kind === "native-retained-output" && result.output === "slides") {
      render(this.#slidesRenderer ? this.#slidesRenderer(result, this.i18n) : nothing, this.#mount);
      return;
    }
    const content = result.kind === "native-retained-short-story" ? result.contentMarkdown : result.content.content_markdown;
    render(html`<article class="retained-story-reader" aria-label=${this.#label()}>
      ${result.title.trim() ? html`<h2 class="retained-story-title" dir="auto" translate="no">${result.title}</h2>` : nothing}
      <pre class="retained-story-content" dir="auto" translate="no">${content}</pre>
    </article>`, this.#mount);
  }
  override render() {
    const ready = this.#ready(), pending = this.#phase === "waiting" || this.#phase === "loading";
    const role = this.store.session.get()?.user.role;
    const canEdit = role === "creator" || role === "admin";
    return html`<section class="retained-story-page" aria-label=${this.#label()}>
      <header class="retained-story-toolbar"><h1>${this.#label()}</h1>
        ${ready && this.#result ? html`<a class="button secondary" href=${this.#href(this.#result.selection)} @click=${this.#handoff} @auxclick=${this.#handoff}>${canEdit ? this.i18n.t("retainedStory.editInForma", "Edit in Forma") : this.i18n.t("retainedStory.openInForma", "Open in Forma")}</a>` : nothing}
      </header>
      <p class="retained-story-status" role="status" aria-live="polite">${ready ? "" : pending ? this.i18n.t("status.loading", "Loading") : this.#output === "short_story" ? this.i18n.t("retainedStory.unavailable", "Story unavailable") : this.i18n.system("Unavailable")}</p>
      ${!ready && !pending ? html`<button type="button" class="button secondary retained-story-retry" @click=${this.#retry}>${this.i18n.t("retainedStory.reload", "Reload")}</button>` : nothing}
      <div data-retained-story-mount></div>
    </section>`;
  }
}
if (!customElements.get("forma-retained-short-story")) customElements.define("forma-retained-short-story", FormaRetainedShortStory);
