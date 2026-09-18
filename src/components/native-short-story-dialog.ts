import { html, nothing } from "lit";
import type { FormaLocaleController } from "./design-system/localization";
import { FORMA_SUPPORTED_LOCALES } from "./design-system/language-options.ts";
import { documentRenderGuidance, DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH } from "../model/document-render-guidance.ts";
import type { NativeStoryControllerState } from "./native-short-story-controller.ts";

/** Presentation only. The persistent controller and server remain the action authorities. */
export function nativeStoryDialogPresentation(state: Pick<NativeStoryControllerState, "status" | "reason" | "handle">) {
  const create = state.status === "ready" || state.status === "not-dispatched" && state.reason === "user-canceled";
  const check = state.handle !== null && (state.status === "submitted" || state.status === "unavailable");
  const status = state.status === "not-dispatched"
    ? state.reason === "user-canceled" ? "canceled" : state.reason === "budget-blocked" ? "budget" : "unavailable"
    : state.status === "ready" || state.status === "retired" ? "" : state.status;
  return { create, check, open: state.status === "available", status };
}

export type NativeStoryDialogInput = {
  openingId: number;
  documentTitle: string;
  locale: string;
  audience: string;
  tone: string;
  composing: boolean;
  state: NativeStoryControllerState;
  i18n: FormaLocaleController;
  close(): void;
  change(field: "audience" | "tone", value: string): void;
  composition(active: boolean): void;
  create(): void;
  check(): void;
  open(event: MouseEvent): void;
};

/** One stable form/status tree for an opening; the host keys and retires the whole dialog. */
export function renderNativeStoryDialog(input: NativeStoryDialogInput) {
  const { i18n, state } = input, presentation = nativeStoryDialogPresentation(state);
  const language = FORMA_SUPPORTED_LOCALES.find(value => value.locale === input.locale);
  const guidance = documentRenderGuidance(input);
  const prefix = `native-story-${input.openingId}`;
  const copy = (key: string) => i18n.t(`story.launcher.${key}`);
  const field = (name: "audience" | "tone") => {
    const invalid = guidance.issues.some(issue => issue.field === name);
    return html`<label for=${`${prefix}-${name}`}>
      <span>${copy(name)} <small>${copy("optional")}</small></span>
      <input id=${`${prefix}-${name}`} name=${name} type="text" dir="auto" autocomplete="off"
        .value=${input[name]} ?readonly=${!presentation.create}
        aria-invalid=${String(invalid)} aria-describedby=${`${prefix}-${name}-count${invalid ? ` ${prefix}-${name}-error` : ""}`}
        @input=${(event: InputEvent) => input.change(name, (event.currentTarget as HTMLInputElement).value)}>
      <small id=${`${prefix}-${name}-count`} class="native-story-count">${i18n.number(guidance[name].length)} / ${i18n.number(DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH)}</small>
      ${invalid ? html`<small id=${`${prefix}-${name}-error`} class="native-story-error">${copy("maximum")}: ${i18n.number(DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH)}</small>` : nothing}
    </label>`;
  };
  return html`<dialog class="document-artifact-create native-short-story-create" closedby="any"
    data-native-story-opening=${String(input.openingId)} aria-labelledby=${`${prefix}-title`}
    @cancel=${(event: Event) => { event.preventDefault(); input.close(); }}
    @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) input.close(); }}
    @close=${(event: Event) => { if (!(event.currentTarget as HTMLDialogElement).open) input.close(); }}>
    <form class="document-artifact-dialog native-short-story-dialog" autocomplete="off"
      @compositionstart=${() => input.composition(true)} @compositionend=${() => input.composition(false)}
      @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) event.preventDefault(); }}
      @submit=${(event: SubmitEvent) => { event.preventDefault(); if (!input.composing && presentation.create && !guidance.issues.length) input.create(); }}>
      <header><h2 id=${`${prefix}-title`}>${copy("title")}</h2>
        <button type="button" class="button ghost" data-native-story-close @click=${input.close}>${copy("close")}</button>
      </header>
      <dl class="native-story-context">
        <div><dt>${copy("document")}</dt><dd dir="auto">${input.documentTitle}</dd></div>
        <div><dt>${copy("language")}</dt><dd><bdi lang=${input.locale} dir=${language?.direction ?? "auto"}>${language?.label ?? input.locale}</bdi></dd></div>
      </dl>
      <section class="native-story-fields" aria-label=${copy("settings")}>${field("audience")}${field("tone")}</section>
      <p id=${`${prefix}-status`} class="native-story-status" role="status" aria-live="polite" aria-atomic="true">${presentation.status ? copy(presentation.status) : ""}</p>
      <footer>
        <button type="submit" class="button primary" aria-disabled=${String(!presentation.create || input.composing || Boolean(guidance.issues.length))}>${copy("create")}</button>
        ${state.handle ? html`<button type="button" class="button secondary" aria-disabled=${String(!presentation.check)} @click=${() => { if (presentation.check) input.check(); }}>${copy("check")}</button>` : nothing}
        ${presentation.open ? html`<button type="button" class="button primary" @click=${input.open}>${copy("open")}</button>` : nothing}
      </footer>
    </form>
  </dialog>`;
}
