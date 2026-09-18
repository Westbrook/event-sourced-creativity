import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { FilmCompositionDraftSnapshot } from "../model/film-composition-draft";
import { filmCompositionMessage, type FilmCompositionMessage } from "./design-system/locales/film-composition-messages";
import "./output-film-composer.css";

export type OutputFilmComposerView = {
  targetId: string;
  targetLabel: string;
  durationLabel: string;
  locale: string;
  draft: FilmCompositionDraftSnapshot;
  controlName: (label: string) => string;
  add: (id: string) => void;
  move: (id: string, offset: -1 | 1) => void;
  remove: (id: string) => void;
  rights: (checked: boolean) => void;
  compose: () => void;
  cancel: () => void;
};

/** A native-control view. The host owns source authority, reads and file staging. */
export function renderOutputFilmComposer(view: OutputFilmComposerView) {
  const t = (key: FilmCompositionMessage) => filmCompositionMessage(view.locale, key);
  const { draft } = view;
  const preparing = draft.status === "preparing";
  const available = draft.choices.filter(choice => !draft.selectedIds.includes(choice.id));
  const reason = draft.reason === "duration" ? "durationMismatch" : draft.reason === "superseded" ? "unavailable" : draft.reason;
  return html`<section class="output-film-composer" data-film-target=${view.targetId} aria-label=${view.controlName(t("heading"))} aria-busy=${preparing ? "true" : "false"}>
    <h5 tabindex="-1" data-film-heading>${t("heading")} · <span dir="auto">${view.targetLabel}</span></h5>
    <p>${t("hint")}</p><p>${view.durationLabel}</p>
    <form @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const id = String(new FormData(form).get("clipId") ?? "");
      if (id) { view.add(id); form.reset(); }
    }}>
      <label>${t("choice")}<select name="clipId" data-film-choice required aria-label=${view.controlName(t("choice"))} ?disabled=${!available.length || draft.selectedIds.length >= 32}>
        <option value="">${t("choose")}</option>${available.map(choice => html`<option value=${choice.id}>${choice.name}</option>`)}
      </select></label>
      <button type="submit" class="button secondary compact" aria-label=${view.controlName(t("add"))} ?disabled=${!available.length || draft.selectedIds.length >= 32}>${t("add")}</button>
    </form>
    ${draft.selectedIds.length ? html`<ol aria-label=${view.controlName(t("order"))}>
      ${repeat(draft.selectedIds, id => id, (id, index) => {
        const choice = draft.choices.find(entry => entry.id === id)!;
        const label = (key: FilmCompositionMessage) => view.controlName(`${t(key)} · ${choice.name}`);
        return html`<li data-film-clip=${id}><span dir="auto">${choice.name}</span><div class="output-film-row-actions">
          <button type="button" class="button secondary compact" data-film-move="earlier" aria-label=${label("earlier")} aria-disabled=${index === 0 ? "true" : "false"} @click=${() => { if (index > 0) view.move(id, -1); }}>${t("earlier")}</button>
          <button type="button" class="button secondary compact" data-film-move="later" aria-label=${label("later")} aria-disabled=${index === draft.selectedIds.length - 1 ? "true" : "false"} @click=${() => { if (index < draft.selectedIds.length - 1) view.move(id, 1); }}>${t("later")}</button>
          <button type="button" class="button secondary compact" aria-label=${label("remove")} @click=${() => view.remove(id)}>${t("remove")}</button>
        </div></li>`;
      })}
    </ol>` : html`<p>${t("empty")}</p>`}
    <label class="output-film-rights"><input type="checkbox" data-film-rights aria-label=${view.controlName(t("rights"))} .checked=${draft.rightsConfirmed} @change=${(event: Event) => view.rights((event.currentTarget as HTMLInputElement).checked)}><span>${t("rights")}</span></label>
    <p>${t("next")}</p>
    ${reason ? html`<p role="alert">${t(reason)}</p>` : nothing}
    <div class="output-film-actions"><button type="button" class="button primary" aria-label=${view.controlName(t("compose"))} aria-disabled=${preparing ? "true" : "false"} ?disabled=${!draft.rightsConfirmed || draft.selectedIds.length < 2} @click=${view.compose}>${t(preparing ? "preparing" : "compose")}</button>
      <button type="button" class="button secondary" aria-label=${view.controlName(t("cancel"))} @click=${view.cancel}>${t("cancel")}</button></div>
  </section>`;
}
