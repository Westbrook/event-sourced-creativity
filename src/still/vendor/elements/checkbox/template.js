import { descriptionTemplate } from '../../primitives/templates/description.js';
import { html, nothing } from 'lit';
/** Native semantics and the label stay in one tree. The slot supplies label content. */
export function choiceTemplate(view, onChange) {
    return html `<div part="field" class="en-field">
    <label class="en-choice" part="label">
      <input part="control" class=${`en-${view.kind}`} type=${view.kind === 'radio' ? 'radio' : 'checkbox'}
        role=${view.kind === 'switch' ? 'switch' : nothing}
        ?checked=${view.checked} aria-checked=${view.kind === 'checkbox' && view.indeterminate ? 'mixed' : nothing}
        .value=${view.value} ?disabled=${view.disabled} ?required=${view.required}
        tabindex=${view.tabIndex} aria-labelledby="label-text" aria-describedby="description"
        @change=${onChange}>
      <span class="en-label" id="label-text" part="label-text"><slot name="label"><slot>${view.label}</slot></slot></span>
    </label>
    ${descriptionTemplate(view.description)}
  </div>`;
}
