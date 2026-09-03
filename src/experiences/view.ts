import { html, svg, nothing, type PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { FormaPresentationalElement } from "../components/presentational-element";
import { FormaUiField } from "../components/design-primitives";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "../components/output-navigation-focus";
import type { CompiledRelease, Decision, ExperienceValue, Interaction } from "./contracts.ts";
import type { DecisionValue, Issue } from "./contracts.ts";
export interface ExperienceSurface {
  readonly mode?: "intake";
  readonly release: CompiledRelease;
  readonly presentation: CompiledRelease;
  readonly documentRoute?: string;
  readonly canRetry?: boolean;
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

/** Property-only presentation. The controller owns decisions and all consequential intents. */
export class FormaExperienceSurface extends FormaPresentationalElement {
  static properties = { runtime: { attribute: false } };
  runtime?: ExperienceSurface;
  #unsubscribe?: () => void;
  #focused?: HTMLElement;
  #selection?: [number | null, number | null];
  #composing = false;
  #compositionPresentation?: CompiledRelease;
  #phase = "";
  #validationId = `experience-validation-${crypto.randomUUID()}`;
  #validationFocus?: OutputNavigationFocusLease;
  override connectedCallback() {
    super.connectedCallback();
    this.#unsubscribe?.();
    this.#unsubscribe = this.runtime?.subscribe(() => this.requestUpdate());
    this.addEventListener("compositionstart", this.#compositionStart);
    this.addEventListener("compositionend", this.#compositionEnd);
  }
  override disconnectedCallback() { this.#retireValidationFocus(); this.#unsubscribe?.(); this.removeEventListener("compositionstart", this.#compositionStart); this.removeEventListener("compositionend", this.#compositionEnd); super.disconnectedCallback(); }
  #compositionStart = () => { this.#retireValidationFocus(); this.#composing = true; this.#compositionPresentation = this.runtime?.presentation; };
  #compositionEnd = () => { this.#composing = false; this.#compositionPresentation = undefined; this.requestUpdate(); };
  protected override willUpdate(changed: PropertyValues) {
    if (changed.has("runtime")) { this.#retireValidationFocus(); this.#unsubscribe?.(); this.#unsubscribe = this.runtime?.subscribe(() => this.requestUpdate()); this.#composing = false; this.#compositionPresentation = undefined; }
    const active = document.activeElement;
    this.#focused = active instanceof HTMLElement && this.contains(active) ? active : undefined;
    this.#selection = active instanceof HTMLInputElement && ["text", "search", "url", "tel", "password"].includes(active.type) ? [active.selectionStart, active.selectionEnd] : undefined;
  }
  protected override updated() {
    const active = document.activeElement;
    if (this.#focused?.isConnected && (active === document.body || active === this)) {
      this.#focused.focus({ preventScroll: true });
      if (this.#selection && this.#focused instanceof HTMLInputElement) this.#focused.setSelectionRange(...this.#selection);
    }
    const phase = this.runtime?.state.phase ?? "";
    if (phase === "complete" && this.#phase !== phase && (active === document.body || active === this || (active && this.contains(active)))) this.querySelector<HTMLElement>(".experience-result h2")?.focus({ preventScroll: true });
    this.#phase = phase;
  }
  #retireValidationFocus() { this.#validationFocus?.dispose(); this.#validationFocus = undefined; }
  async #review() {
    this.#retireValidationFocus();
    const runtime = this.runtime;
    if (!runtime || this.#composing || runtime.state.phase !== "setup") return;
    const draft = runtime.state.draft, presentation = runtime.presentation, lease = captureOutputNavigationFocus(this.ownerDocument);
    this.#validationFocus = lease;
    try {
      await runtime.prepare();
      const issues = runtime.state.issues;
      const current = () => this.isConnected && this.runtime === runtime && runtime.presentation === presentation && runtime.state.draft === draft && runtime.state.issues === issues && runtime.state.phase === "setup" && issues.length > 0 && !this.#composing && this.#validationFocus === lease && lease.current();
      if (!current()) return;
      await this.updateComplete;
      if (!current()) return;
      // DOM order includes approved presentation order and stable evidence moves.
      const invalid = this.querySelector<HTMLElement>("[data-experience-invalid]");
      let target = invalid;
      if (invalid instanceof FormaUiField) { await invalid.updateComplete; if (!current()) return; target = invalid.querySelector<HTMLInputElement>("input"); }
      if (current() && target?.isConnected && !target.matches(":disabled")) lease.run(target, () => { target.focus(); return this.ownerDocument.activeElement === target; });
    } finally { lease.dispose(); if (this.#validationFocus === lease) this.#validationFocus = undefined; }
  }
  #change(id: string, value: ExperienceValue) { this.#retireValidationFocus(); this.runtime?.change(id, value); }
  #value(id: string): ExperienceValue { return this.runtime!.state.draft.values[id]?.value ?? ""; }
  #text(id: string) { const value = this.#value(id); return typeof value === "string" ? value : ""; }
  #error(path: string) { const issue = this.runtime!.state.issues.find(issue => issue.path === path); return issue ? issueLabel[issue.code] ?? "Invalid value" : ""; }
  #issueDescription(issue: Issue) {
    const [id, member] = issue.path.split("."), decision = this.runtime!.release.definition.decisions.find(decision => decision.id === id);
    const message = issueLabel[issue.code] ?? "Check decisions";
    if (!decision) return message;
    const interaction = this.runtime!.release.interactions[id];
    const field = interaction.fields?.find(field => field.id === member)?.label;
    const evidence = interaction.kind === "order" && member ? `Evidence ${(this.#value(id) as Array<{ id: string }>).findIndex(item => item.id === member) + 1}` : "";
    return `${this.runtime!.release.copy[decision.labelKey]}${field || evidence ? ` · ${field || evidence}` : ""} · ${message}`;
  }
  #field(id: string, label: string, value: string, interaction: Interaction, change: (value: string) => void) {
    const error = this.#error(id);
    return html`<forma-ui-field .label=${label} .value=${value} .name=${id} .maxLength=${interaction.maxLength} .required=${interaction.kind === "source" ? interaction.required : true} .error=${error} ?data-experience-invalid=${Boolean(error)} .disabled=${this.runtime!.mode === "intake" && this.runtime!.state.phase !== "setup"} autocomplete="off" @forma-input=${(event: CustomEvent<{ value: string }>) => change(event.detail.value)}></forma-ui-field>`;
  }
  #choices(decision: Decision, interaction: Interaction) {
    return html`<div class="experience-choices" role="group" aria-label=${this.runtime!.release.copy[decision.labelKey]}>${interaction.options?.map(option => html`<forma-ui-button .label=${option.label} .pressed=${this.#text(decision.id) === option.value} .variant=${this.#text(decision.id) === option.value ? "primary" : "secondary"} @forma-press=${() => this.#change(decision.id, option.value)}></forma-ui-button>`)}</div>`;
  }
  #move(id: string, itemId: string, direction: -1 | 1) {
    const items = structuredClone(this.#value(id)) as Array<{ id: string; text: string }>;
    const index = items.findIndex(item => item.id === itemId), next = index + direction;
    if (index < 0 || next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]];
    this.#change(id, items);
  }
  #decision(decision: Decision) {
    const interaction = this.runtime!.release.interactions[decision.id];
    const label = this.runtime!.release.copy[decision.labelKey];
    const value = this.#value(decision.id);
    const error = this.#error(decision.id), errorId = `${this.#validationId}-${decision.id}`;
    if (interaction.kind === "source") return this.#field(decision.id, label, value as string, interaction, next => this.#change(decision.id, next));
    return html`<fieldset class="experience-decision" ?disabled=${this.runtime!.mode === "intake" && this.runtime!.state.phase !== "setup"} ?data-experience-invalid=${Boolean(error)} tabindex=${error ? "-1" : nothing} aria-describedby=${error ? errorId : nothing}><legend>${label}</legend>
      ${interaction.options ? this.#choices(decision, interaction) : interaction.kind === "relationship" ? html`<div class="experience-relationship-fields">${repeat(interaction.fields!, field => field.id, field => this.#field(`${decision.id}.${field.id}`, field.label, strings(value)[field.id], interaction, next => this.#change(decision.id, { ...strings(value), [field.id]: next })))}</div>`
      : interaction.kind === "order" ? html`<ol class="experience-evidence">${repeat(value as Array<{ id: string; text: string }>, item => item.id, (item, index) => html`<li>${this.#field(`${decision.id}.${item.id}.text`, `Evidence ${index + 1}`, item.text, interaction, next => this.#change(decision.id, (value as Array<{ id: string; text: string }>).map(source => source.id === item.id ? { ...source, text: next } : source)))}<div class="experience-choices"><forma-ui-button label="Move up" .disabled=${index === 0} @forma-press=${() => this.#move(decision.id, item.id, -1)}></forma-ui-button><forma-ui-button label="Move down" .disabled=${index === 2} @forma-press=${() => this.#move(decision.id, item.id, 1)}></forma-ui-button></div></li>`)}</ol>`
      : html`<div class="experience-profile-fields">${interaction.fields?.map(field => {
        const path = `${decision.id}.${field.id}`, fieldError = this.#error(path), fieldErrorId = `${errorId}-${field.id}`;
        return html`<fieldset><legend>${field.label} <output>${numbers(value)[field.id]}</output></legend><input type="range" name=${path} aria-label=${field.label} min=${interaction.minimum!} max=${interaction.maximum!} step="1" .value=${String(numbers(value)[field.id])} aria-invalid=${fieldError ? "true" : "false"} aria-describedby=${fieldError ? fieldErrorId : nothing} aria-errormessage=${fieldError ? fieldErrorId : nothing} ?data-experience-invalid=${Boolean(fieldError)} @input=${(event: Event) => this.#change(decision.id, { ...numbers(value), [field.id]: Number((event.target as HTMLInputElement).value) })}><div class="experience-step-actions"><forma-ui-button .label=${`Decrease ${field.label.toLowerCase()}`} .disabled=${numbers(value)[field.id] <= interaction.minimum!} @forma-press=${() => this.#change(decision.id, { ...numbers(value), [field.id]: numbers(value)[field.id] - 1 })}></forma-ui-button><forma-ui-button .label=${`Increase ${field.label.toLowerCase()}`} .disabled=${numbers(value)[field.id] >= interaction.maximum!} @forma-press=${() => this.#change(decision.id, { ...numbers(value), [field.id]: numbers(value)[field.id] + 1 })}></forma-ui-button></div>${fieldError ? html`<small id=${fieldErrorId} class="experience-error">${fieldError}</small>` : nothing}</fieldset>`;
      })}</div>`}
      ${error ? html`<small id=${errorId} class="experience-error">${error}</small>` : nothing}
    </fieldset>`;
  }
  #stage() {
    const kind = this.runtime!.release.output.output;
    if (kind === "image" || kind === "video") {
      const anchor = this.#text(kind === "image" ? "composition" : "anchor");
      return html`<div class="experience-spatial" data-anchor=${anchor} data-lighting=${this.#text("lighting")}><div class="experience-crosshair" aria-hidden="true"></div><div class="experience-subject">${this.#text("subject") || "Subject"}</div><div class="experience-spatial-caption">${kind === "image" ? "Composition" : `${this.#text("camera").replaceAll("-", " ")} · ${this.#text("motion")}`}</div></div>`;
    }
    if (kind === "short_story") {
      const values = strings(this.#value("causality"));
      return html`<div class="experience-character">${this.#text("character") || "Character"}</div><ol class="experience-chain">${["goal", "obstacle", "decision"].map((key, index) => html`<li><span class="experience-index">0${index + 1}</span><h3>${key[0].toUpperCase() + key.slice(1)}</h3><p>${values[key] || "—"}</p></li>`)}</ol><span class="experience-stage-note">${this.#text("ending")}</span>`;
    }
    if (kind === "scene") {
      const values = strings(this.#value("conflict")), knowledge = this.#text("knowledge");
      return html`<div class="experience-conflict">${["a", "b"].map((key, index) => html`<article><span class="experience-index">${key.toUpperCase()}</span><h3>${values[key] || `Participant ${key.toUpperCase()}`}</h3><p>${values[index === 0 ? "goalA" : "goalB"] || "Goal"}</p><span>${knowledge === key || knowledge === "both" ? "Secret known" : "Secret unknown"}</span></article>`)}</div><article class="experience-secret"><h3>Secret</h3><p>${values.secret || "—"}</p></article>`;
    }
    if (kind === "slides") {
      const items = this.#value("evidence") as Array<{ id: string; text: string }>;
      return html`<ol class="experience-strip experience-slide-strip"><li><span>01 · Claim</span><p>${this.#text("claim") || "—"}</p></li>${repeat(items, item => item.id, (item, index) => html`<li><span>0${index + 2} · Evidence</span><p>${item.text || "—"}</p></li>`)}<li><span>05 · Conclusion</span><p>${this.#text("claim") || "—"}</p></li></ol>`;
    }
    if (kind === "storyboard") {
      const reveal = Number(this.#text("revealFrame"));
      return html`<ol class="experience-strip">${[1, 2, 3, 4].map(index => html`<li class=${index === reveal ? "is-reveal" : ""}><span>0${index} · ${index === reveal ? "Reveal" : index === 1 ? "Setup" : index < reveal ? "Event" : "Result"}</span><p>${index === reveal ? this.#text("reveal") || "—" : index === 1 ? this.#text("subject") || "—" : this.#text("event") || "—"}</p></li>`)}</ol>`;
    }
    if (kind === "audio") {
      const values = numbers(this.#value("energy"));
      const points = `24,${170 - values.opening * 26} 160,${170 - values.peak * 26} 296,${170 - values.ending * 26}`;
      return html`<div class="experience-character">${this.#text("moment") || "Moment"}</div><svg class="experience-energy" viewBox="0 0 320 200" role="img" aria-label=${`Energy: opening ${values.opening}, peak ${values.peak}, ending ${values.ending}`}><path d="M24 20V170H296" class="experience-axis"></path><polyline points=${points}></polyline>${[values.opening, values.peak, values.ending].map((value, index) => svg`<circle cx=${24 + index * 136} cy=${170 - value * 26} r="7"></circle>`)}</svg><div class="experience-anchor-labels"><span>Opening</span><span>Peak</span><span>Ending</span></div>`;
    }
    const values = numbers(this.#value("proportions"));
    return html`<div class="experience-character">${this.#text("object") || "Object"}</div><div class="experience-proportion-stage"><div class="experience-bounds" style=${`--object-width:${values.width};--object-height:${values.height}`} data-surface=${this.#text("surface")}><span>${this.#text("surface")}</span></div></div><div class="experience-anchor-labels"><span>W ${values.width}</span><span>H ${values.height}</span><span>D ${values.depth}</span></div>`;
  }
  #summary() {
    const runtime = this.runtime!;
    return html`<dl class="experience-summary">${runtime.release.definition.decisions.map(decision => html`<div><dt>${runtime.release.copy[decision.labelKey]}</dt><dd>${this.#describe(this.#value(decision.id), runtime.release.interactions[decision.id])}</dd></div>`)}</dl>`;
  }
  #describe(value: ExperienceValue, interaction: Interaction) { return typeof value === "string" ? interaction.options?.find(option => option.value === value)?.label ?? value : Array.isArray(value) ? value.map(item => item.text).join(" → ") : interaction.fields!.map(field => `${field.label}: ${value[field.id]}`).join(" · "); }
  override render() {
    const runtime = this.runtime;
    if (!runtime) return html`<p role="status">Experience unavailable</p>`;
    const { phase, issues } = runtime.state;
    const intake = runtime.mode === "intake";
    const presentation = this.#composing && this.#compositionPresentation ? this.#compositionPresentation : runtime.presentation;
    const setup = ["setup", "preparing", "blocked"].includes(phase);
    return html`<main class="experience" data-layout=${presentation.definition.layout}>
      <header class="experience-heading"><div><span class="experience-brand">Forma</span><h1>${runtime.release.output.label}</h1><p>${runtime.release.output.result}</p></div><span class="experience-mode">${intake ? "Document setup · No generation" : "Fixture · No generation"}</span></header>
      ${phase === "complete" ? html`<section class="experience-result"><h2 tabindex="-1">${intake ? "Document saved" : "Fixture complete"}</h2><p>Generated output unavailable</p>${this.#summary()}<div class="experience-result-actions">${intake && runtime.documentRoute ? html`<a class="button primary" href=${runtime.documentRoute}>Edit in Forma</a>` : html`<forma-ui-button label="Edit in Forma" disabled></forma-ui-button><span>Fixture · No Document</span>`}</div></section>`
      : html`<div class="experience-workspace"><section class="experience-stage" aria-label="Direction preview"><div class="experience-stage-heading"><span>Direction preview</span><span>Illustrative</span></div>${this.#stage()}</section><section class="experience-controls" aria-label=${setup ? "Decisions" : "Review"}>
        ${setup ? html`<div class="experience-decision-list">${repeat(presentation.definition.decisions, decision => decision.id, decision => this.#decision(decision))}</div>` : html`<h2>${phase === "review" ? "Review" : phase === "uncertain" ? "Result status" : intake ? "Saving Document" : "Running fixture"}</h2>${this.#summary()}`}
      </section></div>`}
      <footer class="experience-footer"><span role="status" aria-live="polite">${issues.length ? this.#issueDescription(issues[0]) : phase === "complete" ? intake ? "Document saved" : "Fixture complete" : phase === "review" ? intake ? "Saved draft" : "Ready · Fixture" : phase === "submitting" ? intake ? "Saving Document" : "Running fixture" : phase === "preparing" ? "Checking decisions" : "Draft"}</span><div class="experience-actions">
        ${setup ? html`<forma-ui-button label="Review" variant="primary" .disabled=${phase === "blocked" || phase === "preparing"} @forma-press=${() => void this.#review()}></forma-ui-button>` : phase === "review" ? html`<forma-ui-button label="Back" @forma-press=${() => runtime.back()}></forma-ui-button><forma-ui-button .label=${intake ? "Save to Forma" : "Run fixture"} variant="primary" @forma-press=${() => void runtime.submit()}></forma-ui-button>` : phase === "uncertain" ? html`<forma-ui-button label="Check result" @forma-press=${() => void runtime.recover()}></forma-ui-button>${intake && runtime.canRetry !== false ? html`<forma-ui-button label="Retry original" @forma-press=${() => void runtime.submit()}></forma-ui-button>` : nothing}` : nothing}
      </div></footer>
    </main>`;
  }
}
if (!customElements.get("forma-experience")) customElements.define("forma-experience", FormaExperienceSurface);
