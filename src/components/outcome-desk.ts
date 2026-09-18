import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import {
  outcomeDeskActions, projectOutcomeDesk, withOutcomeDeskPosture, withOutcomeDeskSelection, withOutcomeRecipe,
  type OutcomeDeskAction, type OutcomeDeskActionPorts, type OutcomeDeskInput, type OutcomeDeskRow,
} from "../model/outcome-desk.ts";
import { canvasIdFromRoute } from "../canvas/routes.ts";
import { OUTCOME_RECIPES, outcomeRecipe, type OutcomeRecipeId } from "../model/outcome-recipes.ts";
import type { OutcomeArrangementIssue, OutcomeArrangementPreview } from "../canvas/outcome-arrangements.ts";
import { outcomeDeskCopy, type OutcomeRecipeLocale } from "./design-system/locales/outcome-recipe-messages.ts";
import "./design-system/choice-card.ts";
import "./design-system/feedback.ts";
import "./outcome-desk.css";

export type OutcomeDeskRenderPorts<Target> = {
  readonly available: OutcomeDeskActionPorts<Target>["available"];
  /** Call followOutcomeDeskAction with fresh facts here, not a paid/store mutation. */
  readonly open: (action: OutcomeDeskAction<Target>) => unknown;
  /** Local route update only; keep the same mounted authoring/draft state. */
  readonly navigate: (route: string, focusId: string) => unknown;
  readonly dismiss: (actionKey: string, focusId: string) => unknown;
  readonly restoreSuggestions: (focusId: string) => unknown;
  readonly renderScope?: () => TemplateResult | typeof nothing;
  readonly title: (row: OutcomeDeskRow) => string;
  /** Localized unique object name, including kind/revision where titles repeat. */
  readonly accessibleName: (row: OutcomeDeskRow) => string;
  /** Reuse existing exact-object lifecycle/source/preview renderers. Never infer readiness. */
  readonly renderObject: (row: OutcomeDeskRow) => TemplateResult | typeof nothing;
  /** One disclosure, then an existing authorized executor; no second menu required. */
  readonly renderOtherWays: (row: OutcomeDeskRow) => TemplateResult | typeof nothing;
};
function localNavigation(event: MouseEvent, navigate: () => unknown) {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  navigate();
}
function validInstanceId(value: string) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,80}$/u.test(value)) throw new Error("outcome_desk_instance_id_required");
  return value;
}

/**
 * Store-independent composition of shipped choice cards, disclosure and native
 * navigation. It has no provider, store, media fetch, source editor, or localStorage.
 * Host mounts it only in the optional posture, and preserves the authoring subtree.
 */
export function renderOutcomeDesk<Target>(input: {
  readonly instanceId: string; readonly canvasReturnFocusId: string; readonly locale: OutcomeRecipeLocale; readonly route: string;
  readonly current: OutcomeDeskInput; readonly selectedKey: string; readonly recipeId: OutcomeRecipeId | null;
  readonly candidates: readonly OutcomeDeskAction<Target>[]; readonly dismissedKeys: readonly string[];
}, ports: OutcomeDeskRenderPorts<Target>) {
  const id = validInstanceId(input.instanceId), copy = outcomeDeskCopy(input.locale);
  const current = canvasIdFromRoute(input.route) === input.current.facts.canvasId ? input.current
    : { ...input.current, facts: { ...input.current.facts, canRead: false } };
  const desk = projectOutcomeDesk(current, input.selectedKey);
  // Presentation only: reuse the host's exact localized identity when authored
  // titles collide. Recheck composed labels so one cannot alias another title.
  const labels = new Map(desk.rows.map((row) => [row.key, ports.title(row)]));
  const names = new Map(desk.rows.map((row) => [row.key, ports.accessibleName(row)]));
  const qualified = new Set<string>(), aliased = new Set<string>();
  const collisions = (values: ReadonlyMap<string, string>) => {
    const groups = new Map<string, OutcomeDeskRow[]>();
    for (const row of desk.rows) {
      const key = values.get(row.key)!.replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.values()].filter((rows) => rows.length > 1).flat();
  };
  for (let remaining = desk.rows.length * 2; remaining > 0; remaining--) {
    const aliases = collisions(names).filter((row) => !aliased.has(row.key));
    const next = collisions(labels).filter((row) => !qualified.has(row.key));
    if (!aliases.length && !next.length) break;
    // Opaque legacy IDs can make the full formatted names equal too. Append the
    // existing encoded route identity only then; keep the original name intact.
    for (const row of aliases) {
      const name = ports.accessibleName(row) + " · " + encodeURIComponent(row.key);
      aliased.add(row.key); qualified.add(row.key); names.set(row.key, name); labels.set(row.key, name);
    }
    for (const row of next) if (!qualified.has(row.key)) { qualified.add(row.key); labels.set(row.key, names.get(row.key)!); }
  }
  const visibleTitle = (row: OutcomeDeskRow) => labels.get(row.key)!;
  const actions = outcomeDeskActions(desk.selected, input.candidates, current, ports.available, input.dismissedKeys);
  const visible = [actions.primary, ...actions.alternatives].filter((action): action is OutcomeDeskAction<Target> => action !== null);
  const headingId = id + "-heading", selectedId = id + "-selected", recipe = outcomeRecipe(input.recipeId);
  const direction = input.locale === "ar" ? "rtl" : "ltr";
  const back = withOutcomeDeskPosture(input.route, "canvas");
  const actionCard = (action: OutcomeDeskAction<Target>, primary = false) => html`<forma-ui-choice-card
    data-primary=${String(primary)} .compact=${true} .label=${action.label} .detail=${action.detail}
    .value=${action.key} @forma-action=${() => ports.open(action)}></forma-ui-choice-card>`;
  return html`<section class="outcome-desk" lang=${input.locale} dir=${direction} aria-labelledby=${headingId}>
    <header class="outcome-desk-header">
      <div><h2 id=${headingId} tabindex="-1">${copy.heading}</h2><p>${copy.hint}</p></div>
      <a class="button secondary" href=${back}
        @click=${(event: MouseEvent) => localNavigation(event, () => ports.navigate(back, input.canvasReturnFocusId))}>${copy.back}</a>
    </header>
    <forma-ui-disclosure .label=${copy.recipes}>
      <p>${copy.recipeHint}</p>
      <div class="outcome-recipe-choices">
        ${OUTCOME_RECIPES.map((candidate) => html`<forma-ui-choice-card .compact=${true}
          .label=${copy.recipesById[candidate.id].title} .detail=${copy.recipesById[candidate.id].description}
          .value=${candidate.id} .selected=${recipe?.id === candidate.id}
          @forma-action=${() => ports.navigate(withOutcomeRecipe(input.route, candidate.id), headingId)}></forma-ui-choice-card>`)}
      </div>
      ${recipe ? html`<button type="button" class="button ghost"
        @click=${() => ports.navigate(withOutcomeRecipe(input.route, null), headingId)}>${copy.noRecipe}</button>` : nothing}
    </forma-ui-disclosure>
    ${recipe ? html`<forma-ui-disclosure .label=${copy.guide}>
      <h3>${copy.recipesById[recipe.id].title}</h3>
      <ol>${recipe.steps.map((step) => html`<li>${copy.recipesById[recipe.id].steps[step]}</li>`)}</ol>
    </forma-ui-disclosure>` : nothing}
    ${ports.renderScope?.() ?? nothing}
    <div class="outcome-desk-layout">
      <nav aria-label=${copy.choose}><ul class="outcome-desk-objects">
        ${repeat(desk.rows, (item) => item.key, (item) => {
          const href = withOutcomeDeskSelection(input.route, item.key);
          return html`<li><a href=${href} aria-label=${names.get(item.key)!} aria-current=${desk.selected?.key === item.key ? "true" : nothing}
            @click=${(event: MouseEvent) => localNavigation(event, () => ports.navigate(href, selectedId))}><bdi>${visibleTitle(item)}</bdi></a></li>`;
        })}
      </ul></nav>
      <section class="outcome-desk-selected" aria-labelledby=${selectedId}>
        <h3 id=${selectedId} tabindex="-1">${desk.selected ? html`<bdi>${visibleTitle(desk.selected)}</bdi>` : copy.choose}</h3>
        ${desk.unavailableSelection ? html`<p role="status">${copy.unavailable}</p>` : nothing}
        ${desk.selected ? html`${ports.renderObject(desk.selected)}
          ${visible.length ? html`<div class="outcome-desk-actions" aria-label=${copy.next}>
            ${repeat(visible, (action) => action.key, (action, index) => actionCard(action, index === 0))}
          </div>` : html`<p>${copy.noAction}</p>`}
          ${actions.primary ? html`<button type="button" class="button ghost"
            @click=${() => ports.dismiss(actions.primary!.key, selectedId)}>${copy.dismiss}</button>` : nothing}
          <forma-ui-disclosure .label=${copy.otherWays}>
            ${actions.otherWays.map((action) => actionCard(action))}
            ${ports.renderOtherWays(desk.selected)}
            ${input.dismissedKeys.length ? html`<button type="button" class="button ghost"
              @click=${() => ports.restoreSuggestions(selectedId)}>${copy.restore}</button>` : nothing}
          </forma-ui-disclosure>` : nothing}
      </section>
    </div>
  </section>`;
}

/**
 * Inline review composition, not a custom modal. If hosted in a dialog, use the
 * existing native-modal foundation, label it from this heading, and restore its
 * invoker on cancellation. issue must include missing atomic transport/authority.
 */
export function renderOutcomeArrangementReview(preview: OutcomeArrangementPreview, options: {
  readonly instanceId: string; readonly locale: OutcomeRecipeLocale;
  readonly issue: OutcomeArrangementIssue | null; readonly busy: boolean;
  /** Uncertainty is read-only until authenticated retrieval proves the exact original review is available again. */
  readonly submitted: boolean; readonly retrieve: (operationId: string) => unknown;
  readonly titleForCard: (itemId: string) => string;
  readonly confirm: (preview: OutcomeArrangementPreview, confirmation: { operationId: string; previewId: string; approvalHash: string; confirmed: true }) => unknown;
  readonly cancel: () => unknown;
}) {
  const id = validInstanceId(options.instanceId), copy = outcomeDeskCopy(options.locale);
  const number = new Intl.NumberFormat(options.locale, { maximumFractionDigits: 2 });
  const position = (x: number, y: number) => number.format(x) + ", " + number.format(y);
  return html`<section class="outcome-arrangement-review" lang=${options.locale} dir=${options.locale === "ar" ? "rtl" : "ltr"}
    aria-labelledby=${id + "-title"} aria-describedby=${id + "-hint"}>
    <h3 id=${id + "-title"} tabindex="-1">${copy.arrangement}: <bdi>${preview.name}</bdi></h3>
    <p id=${id + "-hint"}>${copy.arrangementHint}</p>
    <div class="outcome-arrangement-table"><table>
      <caption><bdi>${preview.name}</bdi></caption>
      <thead><tr><th scope="col">${copy.source}</th><th scope="col">${copy.from}</th><th scope="col">${copy.to}</th></tr></thead>
      <tbody>${preview.before.map((before, index) => {
        const after = preview.after[index]!;
        return html`<tr><th scope="row"><bdi>${options.titleForCard(before.itemId)}</bdi></th>
          <td><bdi dir="ltr">${position(before.x, before.y)}</bdi></td><td><bdi dir="ltr">${position(after.x, after.y)}</bdi></td></tr>`;
      })}</tbody>
    </table></div>
    ${options.issue ? html`<p id=${id + "-issue"} role="status">${copy.issues[options.issue]}</p>` : nothing}
    ${options.submitted ? html`<p role="status">${copy.submittedHint}</p>` : nothing}
    <footer class="outcome-arrangement-actions">
      <forma-ui-choice-card data-primary="true" .compact=${true} .label=${copy.apply}
        .disabled=${options.busy || options.submitted || Boolean(options.issue)} .value=${preview.operationId}
        @forma-action=${() => {
          if (!options.busy && !options.submitted && !options.issue) options.confirm(preview, { operationId: preview.operationId, previewId: preview.previewId, approvalHash: preview.approvalHash, confirmed: true });
        }}></forma-ui-choice-card>
      ${options.submitted ? html`<button type="button" class="button secondary" @click=${() => options.retrieve(preview.operationId)}>${copy.retrieve}</button>` : nothing}
      <button type="button" class="button secondary" @click=${options.cancel}>${options.submitted ? copy.close : copy.cancel}</button>
    </footer>
  </section>`;
}

/** Call after the host's render resolves, following explicit navigation/dismissal. */
export function restoreOutcomeDeskFocus(root: ParentNode, focusId: string): boolean {
  const target = [...root.querySelectorAll<HTMLElement>("[id]")].find((item) => item.id === focusId);
  if (!target?.isConnected) return false;
  target.focus({ preventScroll: true });
  return true;
}
