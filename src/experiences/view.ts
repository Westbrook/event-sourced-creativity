import { html, svg, nothing, render as renderTemplate } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { FormaPresentationalElement } from "../components/presentational-element";
import { FormaUiField } from "../components/design-primitives";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "../components/output-navigation-focus";
import type { CompiledRelease, Decision, ExperienceValue, Interaction } from "./contracts.ts";
import type { DecisionValue, Issue } from "./contracts.ts";
export interface ExperienceSurface {
  readonly mode?: "intake";
  readonly release?: CompiledRelease;
  readonly presentation?: CompiledRelease;
  readonly documentRoute?: string;
  readonly canRetry?: boolean;
  readonly recovery?: boolean;
  readonly state: {phase: string; issues: readonly Issue[]; draft: {values: Readonly<Record<string, DecisionValue>>}};
  subscribe(listener: () => void): () => void;
  change(id: string, value: ExperienceValue): boolean;
  prepare(): Promise<unknown>;
  back(): unknown;
  submit(): Promise<unknown>;
  recover(): Promise<unknown>;
}

const issueLabel: Record<string, string> = { required: "Required", text_limit: "Text limit", range_limit: "Range limit", capability_unavailable: "Creation unavailable", check_result: "Check result", result_unavailable: "Result unavailable", authentication_required: "Sign in required", explicit_consent_required: "Consent required", consent_required: "Consent required", insufficient_role: "Creator access required", personal_author_required: "Personal workspace required", experience_save_unconfirmed: "Save unconfirmed", experience_draft_unavailable: "Draft unavailable", project_intake_unconfirmed: "Document unconfirmed", experience_result_mismatch: "Result mismatch", experience_release_changed: "Interface changed" };
const strings = (value: ExperienceValue) => value as Record<string, string>;
const numbers = (value: ExperienceValue) => value as Record<string, number>;
const stageKinds = new Set(["image", "short_story", "scene", "slides", "storyboard", "video", "audio", "model3d"]);
let validationSequence = 0;

/** Property-only presentation. The controller owns decisions and all consequential intents. */
export class FormaExperienceSurface extends FormaPresentationalElement {
  static properties = { runtime: { attribute: false, noAccessor: true } };
  #runtime?: ExperienceSurface;
  #binding = 0;
  #actionFailed = false;
  #actionEpoch = 0;
  #unsubscribe?: () => void;
  #focused?: HTMLElement;
  #selection?: [number | null, number | null];
  #composing = false;
  #compositionPresentation?: CompiledRelease;
  #validationId = `experience-validation-${++validationSequence}`;
  #validationFocus?: OutputNavigationFocusLease;
  get runtime() { return this.#runtime; }
  set runtime(value: ExperienceSurface | undefined) {
    const previous = this.#runtime;
    if (previous === value) return;
    const binding = ++this.#binding;
    const release = this.#unsubscribe; this.#unsubscribe = undefined;
    this.#runtime = value;
    this.#actionFailed = false;
    release?.();
    if (this.#binding !== binding || this.#runtime !== value) return;
    this.#withdraw();
    if (this.#binding !== binding || this.#runtime !== value) return;
    if (this.isConnected) this.#subscribe();
    this.requestUpdate("runtime", previous);
  }
  #owns(runtime: ExperienceSurface, binding: number) { return this.isConnected && this.#runtime === runtime && this.#binding === binding; }
  #subscribe() {
    const runtime = this.#runtime, binding = this.#binding;
    const previous = this.#unsubscribe; this.#unsubscribe = undefined;
    previous?.();
    if (!runtime || !this.#owns(runtime, binding)) return;
    const release = runtime.subscribe(() => {
      if (!this.#owns(runtime, binding)) return;
      if (runtime.state.phase === "blocked") this.#withdraw();
      if (this.#owns(runtime, binding)) this.requestUpdate();
    });
    if (this.#owns(runtime, binding)) this.#unsubscribe = release;
    else release();
  }
  #withdraw() {
    ++this.#actionEpoch;
    this.#retireValidationFocus();
    this.#focused = undefined; this.#selection = undefined;
    this.#composing = false; this.#compositionPresentation = undefined;
    if (this.hasUpdated && this.renderRoot) renderTemplate(nothing, this.renderRoot, this.renderOptions);
  }
  override connectedCallback() {
    super.connectedCallback();
    this.#subscribe();
    this.addEventListener("compositionstart", this.#compositionStart);
    this.addEventListener("compositionend", this.#compositionEnd);
    this.requestUpdate();
  }
  override disconnectedCallback() {
    const binding = ++this.#binding, release = this.#unsubscribe;
    this.#unsubscribe = undefined;
    release?.();
    if (this.#binding !== binding) return;
    this.#withdraw();
    this.removeEventListener("compositionstart", this.#compositionStart);
    this.removeEventListener("compositionend", this.#compositionEnd);
    super.disconnectedCallback();
  }
  #compositionStart = () => { ++this.#actionEpoch; this.#retireValidationFocus(); this.#composing = true; this.#compositionPresentation = this.runtime?.presentation; };
  #compositionEnd = () => { this.#composing = false; this.#compositionPresentation = undefined; this.requestUpdate(); };
  protected override willUpdate() {
    const ownerDocument = this.ownerDocument;
    if (ownerDocument.visibilityState !== "visible" || !ownerDocument.hasFocus()) {
      this.#focused = undefined; this.#selection = undefined;
      return;
    }
    const active = ownerDocument.activeElement;
    this.#focused = active instanceof HTMLElement && this.contains(active) ? active : undefined;
    this.#selection = active instanceof HTMLInputElement && ["text", "search", "url", "tel", "password"].includes(active.type) ? [active.selectionStart, active.selectionEnd] : undefined;
  }
  protected override updated() {
    const ownerDocument = this.ownerDocument, active = ownerDocument.activeElement;
    if (this.#focused?.isConnected && this.#focused.ownerDocument === ownerDocument && this.contains(this.#focused)
      && (active === ownerDocument.body || active === this) && ownerDocument.visibilityState === "visible" && ownerDocument.hasFocus()) {
      this.#focused.focus({ preventScroll: true });
      if (this.#selection && this.#focused instanceof HTMLInputElement) this.#focused.setSelectionRange(...this.#selection);
    }
    this.#focused = undefined; this.#selection = undefined;
  }
  #retireValidationFocus() { const lease = this.#validationFocus; this.#validationFocus = undefined; lease?.dispose(); }
  #focusLease(): OutputNavigationFocusLease | undefined {
    const ownerDocument = this.ownerDocument, ownerWindow = ownerDocument.defaultView;
    const runtime = this.runtime, binding = this.#binding, actionEpoch = this.#actionEpoch;
    const owned = () => Boolean(runtime && this.#owns(runtime, binding) && this.#actionEpoch === actionEpoch && this.ownerDocument === ownerDocument);
    const visible = () => ownerDocument.visibilityState === "visible" && ownerDocument.hasFocus();
    if (!ownerWindow || !owned() || !visible()) return;
    const active = ownerDocument.activeElement;
    if (!(active === this || active && this.contains(active)) || !owned() || !visible()) return;
    let base: OutputNavigationFocusLease | undefined, closed = false, failure: AggregateError | undefined, failureSize = 0;
    const failures: unknown[] = [];
    const dispose = () => {
      if (!closed) {
        closed = true;
        if (this.#validationFocus === lease) this.#validationFocus = undefined;
        const previous = base; base = undefined;
        for (const cleanup of [
          () => ownerDocument.removeEventListener("visibilitychange", visibilityChanged, true),
          () => ownerWindow.removeEventListener("blur", windowBlurred, true),
          () => previous?.dispose(),
        ]) { try { cleanup(); } catch (error) { failures.push(error); } }
      }
      if (failures.length) {
        if (!failure || failureSize !== failures.length) { failure = new AggregateError(failures, "Experience focus retirement failed"); failureSize = failures.length; }
        throw failure;
      }
    };
    const current = () => {
      if (closed) return false;
      try { if (owned() && visible() && base?.current() && owned() && visible() && !closed) return true; }
      catch (error) { failures.push(error); }
      dispose();
      return false;
    };
    const terminal = (check: () => unknown) => {
      try { check(); } catch (error) {
        if (error !== failure) failures.push(error);
        try { dispose(); } catch { /* The lease retains every original retirement error for its action. */ }
        if (!owned()) return;
        this.#actionFailed = true;
        try { this.requestUpdate(); } catch { /* The captured action owns this terminal UI failure. */ }
      }
    };
    const visibilityChanged = () => terminal(() => { if (!owned() || !visible()) dispose(); });
    const windowBlurred = (event: Event) => { if (event.target === ownerWindow) terminal(dispose); };
    const lease: OutputNavigationFocusLease = {
      current,
      run(target, action) {
        const previous = base;
        if (!previous || !current()) return false;
        try { return previous.run(target, () => current() && action()); }
        catch (error) { if (error !== failure) failures.push(error); dispose(); return false; }
      },
      dispose,
    };
    try {
      ownerDocument.addEventListener("visibilitychange", visibilityChanged, true);
      if (closed) { dispose(); return undefined; }
      ownerWindow.addEventListener("blur", windowBlurred, true);
      if (closed) { dispose(); return undefined; }
      const captured = captureOutputNavigationFocus(ownerDocument);
      if (closed) {
        try { captured.dispose(); } catch (error) { failures.push(error); }
        dispose(); return undefined;
      }
      base = captured;
      return current() ? lease : undefined;
    } catch (error) {
      if (error !== failure) failures.push(error);
      dispose();
      return undefined;
    }
  }
  async #review(runtime: ExperienceSurface, binding: number, ownerDocument: Document, actionEpoch: number) {
    this.#retireValidationFocus();
    if (!this.#owns(runtime, binding) || this.ownerDocument !== ownerDocument || this.#actionEpoch !== actionEpoch || !runtime.presentation || this.#composing || runtime.state.phase !== "setup") return;
    const draft = runtime.state.draft, presentation = runtime.presentation, lease = this.#focusLease();
    if (!this.#owns(runtime, binding) || this.ownerDocument !== ownerDocument || this.#actionEpoch !== actionEpoch) { lease?.dispose(); return; }
    this.#validationFocus = lease;
    let failed = false, failure: unknown;
    reviewAction: {
      try {
        await runtime.prepare();
        const state = runtime.state;
        const current = () => this.#owns(runtime, binding) && this.ownerDocument === ownerDocument && runtime.presentation === presentation && runtime.state === state && runtime.state.draft === draft && !this.#composing && this.#validationFocus === lease && Boolean(lease?.current());
        if (!current()) break reviewAction;
        await this.updateComplete;
        if (!current()) break reviewAction;
        let target: HTMLElement | null = null;
        if (state.phase === "review") target = this.querySelector<HTMLElement>(".experience-review-heading");
        else if (state.phase === "setup" && state.issues.length) {
          const invalid = this.querySelector<HTMLElement>("[data-experience-invalid]");
          target = invalid;
          if (invalid instanceof FormaUiField) { await invalid.updateComplete; if (!current()) break reviewAction; target = invalid.querySelector<HTMLInputElement>("input"); }
        }
        if (current() && target?.isConnected && !target.matches(":disabled")) lease!.run(target, () => { target!.focus(); return ownerDocument.activeElement === target; });
      } catch (error) { failed = true; failure = error; }
      finally {
        if (this.#validationFocus === lease) this.#validationFocus = undefined;
        try { lease?.dispose(); } catch (cleanup) {
          failure = failed && cleanup !== failure
            ? new AggregateError([failure, cleanup], "Experience action and focus retirement failed")
            : cleanup;
          failed = true;
        }
      }
    }
    if (failed) throw failure;
  }
  async #back(runtime: ExperienceSurface, binding: number, ownerDocument: Document, actionEpoch: number) {
    this.#retireValidationFocus();
    if (!this.#owns(runtime, binding) || this.ownerDocument !== ownerDocument || this.#actionEpoch !== actionEpoch || runtime.state.phase !== "review") return;
    const presentation = runtime.presentation, lease = this.#focusLease();
    if (!this.#owns(runtime, binding) || this.ownerDocument !== ownerDocument || this.#actionEpoch !== actionEpoch) { lease?.dispose(); return; }
    this.#validationFocus = lease;
    let failed = false, failure: unknown;
    backAction: {
      try {
        await runtime.back();
        const state = runtime.state;
        const current = () => this.#owns(runtime, binding) && this.ownerDocument === ownerDocument && runtime.presentation === presentation && runtime.state === state && state.phase === "setup" && !this.#composing && this.#validationFocus === lease && Boolean(lease?.current());
        if (!current()) break backAction;
        await this.updateComplete;
        if (!current()) break backAction;
        const target = this.querySelector<HTMLElement>(".experience-controls");
        if (target?.isConnected) lease!.run(target, () => { target.focus(); return ownerDocument.activeElement === target; });
      } catch (error) { failed = true; failure = error; }
      finally {
        if (this.#validationFocus === lease) this.#validationFocus = undefined;
        try { lease?.dispose(); } catch (cleanup) {
          failure = failed && cleanup !== failure
            ? new AggregateError([failure, cleanup], "Experience action and focus retirement failed")
            : cleanup;
          failed = true;
        }
      }
    }
    if (failed) throw failure;
  }
  async #completeAction(action: "submit" | "recover", runtime: ExperienceSurface, binding: number, ownerDocument: Document, actionEpoch: number) {
    this.#retireValidationFocus();
    if (!this.#owns(runtime, binding) || this.ownerDocument !== ownerDocument || this.#actionEpoch !== actionEpoch) return;
    const lease = this.#focusLease();
    if (!this.#owns(runtime, binding) || this.ownerDocument !== ownerDocument || this.#actionEpoch !== actionEpoch) { lease?.dispose(); return; }
    this.#validationFocus = lease;
    let failed = false, failure: unknown;
    completeAction: {
      try {
        await runtime[action]();
        const state = runtime.state;
        const current = () => this.#owns(runtime, binding) && this.ownerDocument === ownerDocument && runtime.state === state && state.phase === "complete" && this.#validationFocus === lease && Boolean(lease?.current());
        if (!current()) break completeAction;
        await this.updateComplete;
        if (!current()) break completeAction;
        const target = this.querySelector<HTMLElement>(".experience-result h2");
        if (target?.isConnected) lease!.run(target, () => { target.focus(); return ownerDocument.activeElement === target; });
      } catch (error) { failed = true; failure = error; }
      finally {
        if (this.#validationFocus === lease) this.#validationFocus = undefined;
        try { lease?.dispose(); } catch (cleanup) {
          failure = failed && cleanup !== failure
            ? new AggregateError([failure, cleanup], "Experience action and focus retirement failed")
            : cleanup;
          failed = true;
        }
      }
    }
    if (failed) throw failure;
  }
  async #action(runtime: ExperienceSurface, binding: number, action: "review" | "back" | "submit" | "recover") {
    if (!this.#owns(runtime, binding)) return;
    const ownerDocument = this.ownerDocument, actionEpoch = ++this.#actionEpoch;
    this.#actionFailed = false;
    try {
      if (action === "review") await this.#review(runtime, binding, ownerDocument, actionEpoch);
      else if (action === "back") await this.#back(runtime, binding, ownerDocument, actionEpoch);
      else await this.#completeAction(action, runtime, binding, ownerDocument, actionEpoch);
    } catch {
      if (!this.#owns(runtime, binding) || this.ownerDocument !== ownerDocument || this.#actionEpoch !== actionEpoch) return;
      this.#actionFailed = true;
      try { this.requestUpdate(); } catch { /* Never turn an owned UI failure into an unhandled rejection. */ }
    }
  }
  #change(id: string, value: ExperienceValue) { ++this.#actionEpoch; this.#retireValidationFocus(); this.runtime?.change(id, value); }
  #value(id: string): ExperienceValue { return this.runtime!.state.draft.values[id]?.value ?? ""; }
  #text(id: string) { const value = this.#value(id); return typeof value === "string" ? value : ""; }
  #error(path: string) { const issue = this.runtime!.state.issues.find(issue => issue.path === path); return issue ? this.i18n.system(issueLabel[issue.code] ?? "Invalid value") : ""; }
  #issueDescription(issue: Issue) {
    const [id, member] = issue.path.split("."), decision = this.runtime!.release!.definition.decisions.find(decision => decision.id === id);
    const message = this.i18n.system(issueLabel[issue.code] ?? "Check decisions");
    if (!decision) return message;
    const interaction = this.runtime!.release!.interactions[id];
    const fieldLabel = interaction.fields?.find(field => field.id === member)?.label;
    const field = fieldLabel ? this.i18n.system(fieldLabel) : "";
    const evidence = interaction.kind === "order" && member ? this.i18n.system("Evidence {number}", { number: this.i18n.number((this.#value(id) as Array<{ id: string }>).findIndex(item => item.id === member) + 1) }) : "";
    return `${this.i18n.system(this.runtime!.release!.copy[decision.labelKey])}${field || evidence ? ` · ${field || evidence}` : ""} · ${message}`;
  }
  #field(id: string, label: string, value: string, interaction: Interaction, change: (value: string) => void) {
    const error = this.#error(id), runtime = this.runtime!, binding = this.#binding;
    return html`<forma-ui-field .label=${label} .value=${value} .name=${id} .maxLength=${interaction.maxLength} .required=${interaction.kind === "source" ? interaction.required : true} .error=${error} ?data-experience-invalid=${Boolean(error)} .disabled=${this.runtime!.mode === "intake" && this.runtime!.state.phase !== "setup"} autocomplete="off" dir="auto" @forma-input=${(event: CustomEvent<{ value: string }>) => { if (this.#owns(runtime, binding)) change(event.detail.value); }}></forma-ui-field>`;
  }
  #choices(decision: Decision, interaction: Interaction) {
    const runtime = this.runtime!, binding = this.#binding;
    return html`<div class="experience-choices" role="group" aria-label=${this.i18n.system(this.runtime!.release!.copy[decision.labelKey])}>${interaction.options?.map(option => html`<forma-ui-button .label=${this.i18n.system(option.label)} .pressed=${this.#text(decision.id) === option.value} .variant=${this.#text(decision.id) === option.value ? "primary" : "secondary"} @forma-press=${() => { if (this.#owns(runtime, binding)) this.#change(decision.id, option.value); }}></forma-ui-button>`)}</div>`;
  }
  #move(id: string, itemId: string, direction: -1 | 1) {
    const items = structuredClone(this.#value(id)) as Array<{ id: string; text: string }>;
    const index = items.findIndex(item => item.id === itemId), next = index + direction;
    if (index < 0 || next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]];
    this.#change(id, items);
  }
  #decision(decision: Decision) {
    const interaction = this.runtime!.release!.interactions[decision.id];
    const label = this.i18n.system(this.runtime!.release!.copy[decision.labelKey]);
    const runtime = this.runtime!, binding = this.#binding;
    const change = (id: string, next: ExperienceValue) => { if (this.#owns(runtime, binding)) this.#change(id, next); };
    const move = (id: string, itemId: string, direction: -1 | 1) => { if (this.#owns(runtime, binding)) this.#move(id, itemId, direction); };
    const value = this.#value(decision.id);
    const error = this.#error(decision.id), errorId = `${this.#validationId}-${decision.id}`;
    if (interaction.kind === "source") return this.#field(decision.id, label, value as string, interaction, next => change(decision.id, next));
    return html`<fieldset class="experience-decision" ?disabled=${this.runtime!.mode === "intake" && this.runtime!.state.phase !== "setup"} ?data-experience-invalid=${Boolean(error)} tabindex=${error ? "-1" : nothing} aria-describedby=${error ? errorId : nothing}><legend>${label}</legend>
      ${interaction.options ? this.#choices(decision, interaction) : interaction.kind === "relationship" ? html`<div class="experience-relationship-fields">${repeat(interaction.fields!, field => field.id, field => this.#field(`${decision.id}.${field.id}`, this.i18n.system(field.label), strings(value)[field.id], interaction, next => change(decision.id, { ...strings(value), [field.id]: next })))}</div>`
      : interaction.kind === "order" ? html`<ol class="experience-evidence">${repeat(value as Array<{ id: string; text: string }>, item => item.id, (item, index) => html`<li>${this.#field(`${decision.id}.${item.id}.text`, this.i18n.system("Evidence {number}", { number: this.i18n.number(index + 1) }), item.text, interaction, next => change(decision.id, (value as Array<{ id: string; text: string }>).map(source => source.id === item.id ? { ...source, text: next } : source)))}<div class="experience-choices"><forma-ui-button .label=${this.i18n.system("Move up")} .disabled=${index === 0} @forma-press=${() => move(decision.id, item.id, -1)}></forma-ui-button><forma-ui-button .label=${this.i18n.system("Move down")} .disabled=${index === 2} @forma-press=${() => move(decision.id, item.id, 1)}></forma-ui-button></div></li>`)}</ol>`
      : html`<div class="experience-profile-fields">${interaction.fields?.map(field => {
        const path = `${decision.id}.${field.id}`, fieldError = this.#error(path), fieldErrorId = `${errorId}-${field.id}`;
        return html`<fieldset><legend>${this.i18n.system(field.label)} <output>${this.i18n.number(numbers(value)[field.id])}</output></legend><input type="range" name=${path} aria-label=${this.i18n.system(field.label)} min=${interaction.minimum!} max=${interaction.maximum!} step="1" .value=${String(numbers(value)[field.id])} aria-invalid=${fieldError ? "true" : "false"} aria-describedby=${fieldError ? fieldErrorId : nothing} aria-errormessage=${fieldError ? fieldErrorId : nothing} ?data-experience-invalid=${Boolean(fieldError)} @input=${(event: Event) => change(decision.id, { ...numbers(value), [field.id]: Number((event.target as HTMLInputElement).value) })}><div class="experience-step-actions"><forma-ui-button .label=${this.i18n.system("Decrease {label}", { label: this.i18n.system(field.label) })} .disabled=${numbers(value)[field.id] <= interaction.minimum!} @forma-press=${() => change(decision.id, { ...numbers(value), [field.id]: numbers(value)[field.id] - 1 })}></forma-ui-button><forma-ui-button .label=${this.i18n.system("Increase {label}", { label: this.i18n.system(field.label) })} .disabled=${numbers(value)[field.id] >= interaction.maximum!} @forma-press=${() => change(decision.id, { ...numbers(value), [field.id]: numbers(value)[field.id] + 1 })}></forma-ui-button></div>${fieldError ? html`<small id=${fieldErrorId} class="experience-error">${fieldError}</small>` : nothing}</fieldset>`;
      })}</div>`}
      ${error ? html`<small id=${errorId} class="experience-error">${error}</small>` : nothing}
    </fieldset>`;
  }
  #option(id: string) {
    const interaction = this.runtime!.release!.interactions[id];
    const option = interaction?.options?.find(option => option.value === this.#text(id));
    return option ? this.i18n.system(option.label) : "";
  }
  #stage() {
    const kind = this.runtime!.release!.output.output;
    if (kind === "image" || kind === "video") {
      const anchor = this.#text(kind === "image" ? "composition" : "anchor");
      return html`<div class="experience-spatial" data-anchor=${anchor} data-lighting=${this.#text("lighting")}><div class="experience-crosshair" aria-hidden="true"></div><div class="experience-subject" dir="auto">${this.#text("subject") || this.i18n.system("Subject")}</div><div class="experience-spatial-caption">${kind === "image" ? this.i18n.system("Composition") : `${this.#option("camera")} · ${this.#option("motion")}`}</div></div>`;
    }
    if (kind === "short_story") {
      const values = strings(this.#value("causality"));
      return html`<div class="experience-character" dir="auto">${this.#text("character") || this.i18n.system("Character")}</div><ol class="experience-chain">${["goal", "obstacle", "decision"].map((key, index) => html`<li><span class="experience-index">0${index + 1}</span><h3>${this.i18n.system(key[0].toUpperCase() + key.slice(1))}</h3><p dir="auto">${values[key] || "—"}</p></li>`)}</ol><span class="experience-stage-note">${this.#option("ending")}</span>`;
    }
    if (kind === "scene") {
      const values = strings(this.#value("conflict")), knowledge = this.#text("knowledge");
      return html`<div class="experience-conflict">${["a", "b"].map((key, index) => html`<article><span class="experience-index">${key.toUpperCase()}</span><h3 dir="auto">${values[key] || this.i18n.system("Participant {label}", { label: key.toUpperCase() })}</h3><p dir="auto">${values[index === 0 ? "goalA" : "goalB"] || this.i18n.system("Goal")}</p><span>${this.i18n.system(knowledge === key || knowledge === "both" ? "Secret known" : "Secret unknown")}</span></article>`)}</div><article class="experience-secret"><h3>${this.i18n.system("Secret")}</h3><p dir="auto">${values.secret || "—"}</p></article>`;
    }
    if (kind === "slides") {
      const items = this.#value("evidence") as Array<{ id: string; text: string }>;
      return html`<ol class="experience-strip experience-slide-strip"><li><span>01 · ${this.i18n.system("Claim")}</span><p dir="auto">${this.#text("claim") || "—"}</p></li>${repeat(items, item => item.id, (item, index) => html`<li><span>0${index + 2} · ${this.i18n.system("Evidence")}</span><p dir="auto">${item.text || "—"}</p></li>`)}<li><span>05 · ${this.i18n.system("Conclusion")}</span><p dir="auto">${this.#text("claim") || "—"}</p></li></ol>`;
    }
    if (kind === "storyboard") {
      const reveal = Number(this.#text("revealFrame"));
      return html`<ol class="experience-strip">${[1, 2, 3, 4].map(index => html`<li class=${index === reveal ? "is-reveal" : ""}><span>0${index} · ${this.i18n.system(index === reveal ? "Reveal" : index === 1 ? "Setup" : index < reveal ? "Event" : "Result")}</span><p dir="auto">${index === reveal ? this.#text("reveal") || "—" : index === 1 ? this.#text("subject") || "—" : this.#text("event") || "—"}</p></li>`)}</ol>`;
    }
    if (kind === "audio") {
      const values = numbers(this.#value("energy"));
      const points = `24,${170 - values.opening * 26} 160,${170 - values.peak * 26} 296,${170 - values.ending * 26}`;
      return html`<div class="experience-character" dir="auto">${this.#text("moment") || this.i18n.system("Moment")}</div><svg class="experience-energy" viewBox="0 0 320 200" role="img" aria-label=${this.i18n.system("Energy: opening {opening}, peak {peak}, ending {ending}", { opening: this.i18n.number(values.opening), peak: this.i18n.number(values.peak), ending: this.i18n.number(values.ending) })}><path d="M24 20V170H296" class="experience-axis"></path><polyline points=${points}></polyline>${[values.opening, values.peak, values.ending].map((value, index) => svg`<circle cx=${24 + index * 136} cy=${170 - value * 26} r="7"></circle>`)}</svg><div class="experience-anchor-labels"><span>${this.i18n.system("Opening")}</span><span>${this.i18n.system("Peak")}</span><span>${this.i18n.system("Ending")}</span></div>`;
    }
    if (kind !== "model3d") return nothing;
    const values = numbers(this.#value("proportions"));
    return html`<div class="experience-character" dir="auto">${this.#text("object") || this.i18n.system("Object")}</div><div class="experience-proportion-stage"><div class="experience-bounds" style=${`--object-width:${values.width};--object-height:${values.height}`} data-surface=${this.#text("surface")}><span>${this.#option("surface")}</span></div></div><div class="experience-anchor-labels"><span>${this.i18n.system("Width")} ${this.i18n.number(values.width)}</span><span>${this.i18n.system("Height")} ${this.i18n.number(values.height)}</span><span>${this.i18n.system("Depth")} ${this.i18n.number(values.depth)}</span></div>`;
  }
  #summary() {
    const runtime = this.runtime!;
    return html`<dl class="experience-summary">${runtime.release!.definition.decisions.map(decision => html`<div><dt>${this.i18n.system(runtime.release!.copy[decision.labelKey])}</dt><dd dir="auto">${this.#describe(this.#value(decision.id), runtime.release!.interactions[decision.id])}</dd></div>`)}</dl>`;
  }
  #describe(value: ExperienceValue, interaction: Interaction) {
    if (typeof value === "string") { const option = interaction.options?.find(option => option.value === value); return option ? this.i18n.system(option.label) : value; }
    if (Array.isArray(value)) return value.map(item => item.text).join(" → ");
    return interaction.fields!.map(field => `${this.i18n.system(field.label)}: ${value[field.id]}`).join(" · ");
  }
  override render() {
    const runtime = this.runtime, binding = this.#binding;
    if (!runtime || this.#actionFailed || runtime.state.phase === "blocked") return html`<p class="experience experience-host-status" role="status">${this.i18n.system("Experience unavailable")}</p>`;
    const owns = () => this.#owns(runtime, binding);
    const { phase, issues } = runtime.state, release = runtime.release;
    const presentation = this.#composing && this.#compositionPresentation ? this.#compositionPresentation : runtime.presentation;
    if (!release || !presentation) return html`<main class="experience experience-host-status"><p role="status">${this.i18n.system(issues.length ? issueLabel[issues[0].code] ?? "Result unavailable" : "Checking result")}</p>${phase === "uncertain" ? html`<forma-ui-button .label=${this.i18n.system("Check result")} @forma-press=${() => { if (owns()) void this.#action(runtime, binding, "recover"); }}></forma-ui-button>` : nothing}</main>`;
    if (!stageKinds.has(release.output.output) || !stageKinds.has(presentation.output.output)) return html`<p class="experience experience-host-status" role="status">${this.i18n.system("Experience unavailable")}</p>`;
    const intake = runtime.mode === "intake";
    const setup = phase === "setup" || phase === "preparing" && !runtime.recovery;
    return html`<main class="experience" data-layout=${presentation.definition.layout}>
      <header class="experience-heading"><div><span class="experience-brand">Forma</span><h1>${this.i18n.system(release.output.label)}</h1><p>${this.i18n.system(release.output.result)}</p></div><span class="experience-mode">${this.i18n.system(intake ? "Document setup · No generation" : "Fixture · No generation")}</span></header>
      ${phase === "complete" ? html`<section class="experience-result"><h2 tabindex="-1">${this.i18n.system(intake ? "Document saved" : "Fixture complete")}</h2><p>${this.i18n.system("Generated output unavailable")}</p>${this.#summary()}<div class="experience-result-actions">${intake && runtime.documentRoute ? html`<a class="button primary" href=${runtime.documentRoute}>${this.i18n.system("Edit in Forma")}</a>` : html`<forma-ui-button .label=${this.i18n.system("Edit in Forma")} disabled></forma-ui-button><span>${this.i18n.system("Fixture · No Document")}</span>`}</div></section>`
      : html`<div class="experience-workspace"><section class="experience-stage" aria-label=${this.i18n.system("Direction preview")}><div class="experience-stage-heading"><span>${this.i18n.system("Direction preview")}</span><span>${this.i18n.system("Illustrative")}</span></div>${this.#stage()}</section><section class="experience-controls" tabindex="-1" aria-label=${this.i18n.system(setup ? "Decisions" : "Review")}>
        ${setup ? html`<div class="experience-decision-list">${repeat(presentation.definition.decisions, decision => decision.id, decision => this.#decision(decision))}</div>` : html`<h2 class="experience-review-heading" tabindex="-1">${this.i18n.system(phase === "review" ? "Review" : phase === "uncertain" ? "Result status" : phase === "preparing" ? "Checking result" : intake ? "Saving Document" : "Running fixture")}</h2>${this.#summary()}`}
      </section></div>`}
      <footer class="experience-footer"><span role="status" aria-live="polite">${issues.length ? this.#issueDescription(issues[0]) : this.i18n.system(phase === "complete" ? intake ? "Document saved" : "Fixture complete" : phase === "review" ? intake ? "Saved draft" : "Ready · Fixture" : phase === "submitting" ? intake ? "Saving Document" : "Running fixture" : phase === "preparing" ? runtime.recovery ? "Checking result" : "Checking decisions" : "Draft")}</span><div class="experience-actions">
        ${setup ? html`<forma-ui-button data-experience-review .label=${this.i18n.system("Review")} variant="primary" .disabled=${phase === "preparing"} @forma-press=${() => { if (owns()) void this.#action(runtime, binding, "review"); }}></forma-ui-button>` : phase === "review" ? html`<forma-ui-button .label=${this.i18n.system("Back")} @forma-press=${() => { if (owns()) void this.#action(runtime, binding, "back"); }}></forma-ui-button><forma-ui-button .label=${this.i18n.system(intake ? "Save to Forma" : "Run fixture")} variant="primary" @forma-press=${() => { if (owns()) void this.#action(runtime, binding, "submit"); }}></forma-ui-button>` : phase === "uncertain" ? html`<forma-ui-button .label=${this.i18n.system("Check result")} @forma-press=${() => { if (owns()) void this.#action(runtime, binding, "recover"); }}></forma-ui-button>${intake && runtime.canRetry !== false ? html`<forma-ui-button .label=${this.i18n.system("Retry original")} @forma-press=${() => { if (owns()) void this.#action(runtime, binding, "submit"); }}></forma-ui-button>` : nothing}` : nothing}
      </div></footer>
    </main>`;
  }
}
if (!customElements.get("forma-experience")) customElements.define("forma-experience", FormaExperienceSurface);
