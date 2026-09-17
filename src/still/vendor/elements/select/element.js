import { html, nothing } from 'lit';
import { html as staticHtml, unsafeStatic } from 'lit/static-html.js';
import { repeat } from 'lit/directives/repeat.js';
import { SelectionChildrenController, SELECTION_CHILDREN_ATTRIBUTE } from '../../primitives/interactions/selection-children.js';
import { dispatchDraftInput } from '../../primitives/interactions/events.js';
import { selectEnhancementStyles } from '../../styles/controls.js';
import { FormFieldElement } from '../forms-private/form-field.js';
/**
 * A labeled native single select. Direct en-select-option descriptors take precedence over items.
 * The parent renders private native options; descriptor nodes are metadata, not native options.
 * Cancel en-change to reject a provisional selection; author value writes remain authoritative.
 * @tagname en-select
 * @slot - Direct en-select-option descriptors; their content supplies plain option labels.
 * @csspart focus-frame - Noninteractive field frame supporting the supplemental focus accent.
 * @slot label - Visible field label; falls back to label.
 * @slot description - Supporting text; falls back to the description attribute/property.
 * @csspart field - Field layout.
 * @csspart label - Visible label.
 * @csspart control - Native select.
 * @csspart option - Native option; picker styling depends on browser support.
 * @csspart description - Supporting text.
 * @csspart error - Validation feedback.
 * @cssprop --en-input-focus-width - Width of the immediate input-family focus contour.
 * @cssprop --en-input-focus-color - Color of the immediate input-family focus contour.
 * @cssprop --en-input-focus-offset - Offset of the immediate input-family focus contour.
 * @cssprop --en-input-focus-halo-width - Width of the supplemental input-family focus halo.
 * @cssprop --en-input-focus-halo-color - Color of the supplemental input-family focus halo.
 * @cssprop --en-input-focus-accent-width - Thickness of the optional bottom focus accent on the field frame.
 * @cssprop --en-input-focus-accent-color - Color of the optional bottom focus accent on the field frame.
 * @cssprop --en-duration-focus-enter - Entry duration for supplemental focus decoration; the focus contour appears immediately.
 * @cssprop --en-duration-focus-exit - Exit duration for supplemental focus decoration.
 * @cssprop --en-ease-focus-enter - Entry easing for supplemental focus decoration.
 * @cssprop --en-ease-focus-exit - Exit easing for supplemental focus decoration.
 * @cssprop --en-control-background - Control background.
 * @cssprop --en-input-background - Field fill when no control background override is set.
 * @cssprop --en-input-color - Field text when no control color override is set.
 * @cssprop --en-control-radius - Control corner radius.
 * @cssprop --en-field-gap - Gap between label, control and supporting text.
 * @cssprop --en-input-inline-padding - Text-editor inline padding; shared control-inline-padding takes precedence.
 * @cssprop --en-control-min-size - Minimum control block size.
 * @cssprop --en-select-appearance - Enhanced picker appearance where supported; auto retains the platform picker.
 * @cssprop --en-option-list-background - Option-list surface fill; falls back to the shared overlay hook.
 * @cssprop --en-option-list-color - Option-list surface text; falls back to the shared overlay hook.
 * @cssprop --en-option-list-border-color - Option-list boundary, independent of field and dialog boundaries.
 * @cssprop --en-option-list-radius - Option-list surface corners, independent of the trigger and dialog.
 * @cssprop --en-option-list-padding - Option-list surface inset, independent of dialog padding.
 * @csspart selected-button - Native customizable-select button; browser-owned interaction.
 * @csspart selected-content - Selected label, truncated independently of the caret.
 * @cssprop --en-option-list-gap - Spacing between options.
 * @cssprop --en-option-list-shadow - Option-list elevation; system colors retain a visible boundary.
 * @cssprop --en-option-list-max-block-size - Option-list height ceiling; available viewport space remains an upper bound.
 * @cssprop --en-option-radius - Option corners; otherwise derived from the effective list surface inset and radius.
 * @cssprop --en-option-inline-padding - Option inline inset, independent of the trigger when set.
 * @cssprop --en-option-block-padding - Option block inset; content and interaction targets may increase row height.
 * @cssprop --en-option-font-weight - Ordinary option weight.
 * @cssprop --en-option-selected-font-weight - Selected option weight, independent of its checkmark and fill.
 * @cssprop --en-option-rest-background - Rest option fill; refines the broad option override.
 * @cssprop --en-option-rest-color - Rest option text; refines the broad option override.
 * @cssprop --en-option-hover-background - Hover option fill; refines the broad option override.
 * @cssprop --en-option-hover-color - Hover option text; refines the broad option override.
 * @cssprop --en-option-pressed-background - Pressed option fill; refines the broad option override.
 * @cssprop --en-option-pressed-color - Pressed option text; refines the broad option override.
 * @cssprop --en-option-selected-background - Selected option fill; refines the broad option override.
 * @cssprop --en-option-selected-color - Selected option text; refines the broad option override.
 * @cssprop --en-option-disabled-background - Disabled option fill; refines the broad option override.
 * @cssprop --en-option-disabled-color - Disabled option text; refines the broad option override.
 * @cssprop --en-option-background - Broad option fill fallback in the enhanced native picker.
 * @cssprop --en-option-color - Broad option text fallback in the enhanced native picker.
 * @cssprop --en-overlay-background - Shared overlay fill fallback for the option list.
 * @cssprop --en-overlay-color - Shared overlay text fallback for the option list.
 * @cssprop --en-overlay-border-color - Shared overlay boundary fallback for the option list.
 * @cssprop --en-overlay-radius - Shared overlay corner fallback for the option list.
 * @cssprop --en-overlay-padding - Shared overlay inset fallback for the option list.
 * @cssprop --en-overlay-max-block-size - Shared overlay height ceiling fallback for the option list.
 * @fires en-input - Current native selected draft.
 * @fires en-change - Cancelable selection change; provisional value and form data are available during dispatch.
 */
export class EnSelect extends FormFieldElement {
    static styles = [...FormFieldElement.styles, selectEnhancementStyles];
    static properties = { ...FormFieldElement.properties, items: { attribute: false } };
    childOptions = new SelectionChildrenController(this, 'select');
    hydrationChoice = this.captureHydrationChoice();
    hydrationRevision = 0;
    constructor() { super(); this.items = []; }
    connectedCallback() {
        // Initial attributes are the server baseline. A subsequent setter, including
        // Lit's replay of an own pre-upgrade property, is authoritative.
        this.hydrationRevision = this.valueRevision;
        super.connectedCallback();
    }
    captureHydrationChoice() {
        const control = this.shadowRoot?.querySelector('#control');
        if (!control || !this.hasAttribute(SELECTION_CHILDREN_ATTRIBUTE))
            return undefined;
        return { value: control.value, baseline: [...control.options].find(option => option.defaultSelected)?.value
                ?? [...control.options].find(option => !option.disabled)?.value ?? '' };
    }
    get effectiveItems() {
        return this.childOptions.view.active ? this.childOptions.view.items : this.items;
    }
    currentItems() {
        const children = this.childOptions.current();
        return children.active ? children.items : this.items;
    }
    get visibleError() { return this.childOptions?.view.error || super.visibleError; }
    get submissionValue() {
        if (this.value === '' && this.placeholder)
            return '';
        return this.currentItems().some(item => item.value === this.value && !item.disabled && !item.hidden) ? this.value : null;
    }
    canCommitValue(value) {
        return !this.isDisabled && ((value === '' && !!this.placeholder) || this.currentItems().some(item => item.value === value && !item.disabled && !item.hidden));
    }
    validateAcceptedValue() {
        const validation = super.validateAcceptedValue();
        const error = this.childOptions?.current().error;
        if (error)
            return { ...validation, flags: { ...validation.flags, customError: true }, message: error };
        if (this.required && this.submissionValue === null) {
            // Ask the native control for the localized missing-selection message even
            // when its currently checked disabled option is natively considered valid.
            const missing = this.controlNode?.cloneNode(true);
            if (missing) {
                missing.selectedIndex = -1;
                missing.setCustomValidity('');
            }
            return { ...validation, flags: { ...validation.flags, valueMissing: true },
                message: this.error || missing?.validationMessage || 'Please select an option.' };
        }
        return validation;
    }
    willUpdate(changed) {
        super.willUpdate(changed); // Record reset state before adopting early native input.
        const choice = this.hydrationChoice;
        if (!choice)
            return;
        this.hydrationChoice = undefined;
        if (this.valueRevision === this.hydrationRevision && this.value === this.childOptions.initialValue && choice.value !== choice.baseline) {
            this.requestValue(choice.value, 'hydrate');
        }
    }
    reconcile() {
        const control = this.controlNode;
        if (this.hydrationChoice && !this.hasUpdated)
            return;
        // Preserve native exploration between input and change; some pickers yield
        // a rendering microtask between those events. onChange reconciles a canceled
        // transaction back to its accepted value before the change handler returns.
        const draft = this.model.draft.get();
        if (control && control.value !== draft)
            control.value = draft;
    }
    onInput(event) {
        const value = event.target.value;
        this.model.setDraft(value);
        dispatchDraftInput(this, { value, isComposing: false, inputType: 'insertReplacementText' });
    }
    onChange(event) {
        const value = event.target.value;
        this.model.setDraft(value);
        this.requestValue(value, 'change');
        this.model.setValue(this.value);
        this.reconcile();
        this.syncForm();
    }
    renderControl() {
        const items = this.effectiveItems;
        // selectedcontent clones option descendants, including SSR part markers.
        // Static escaped text keeps those markers outside the cloned option contents.
        const optionText = (value) => unsafeStatic(value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'));
        // Keep the first hydration branch identical to the server snapshot, even
        // when an authoritative pending setter will replace its selected value.
        const defaultValue = !this.hasUpdated && this.childOptions.initialValue !== undefined
            ? this.childOptions.initialValue : this.defaultControlValue;
        const blankDefault = !this.placeholder && items.length > 0 && !items.some(item => item.value === defaultValue);
        return html `<select id="control" class="en-select" part="control" name=${this.name}
      ?disabled=${this.isDisabled} ?required=${this.required}
      aria-describedby=${this.describedBy} aria-invalid=${this.controlAriaInvalid}
      @input=${this.onInput} @change=${this.onChange}>
      <button type="button" part="selected-button"><selectedcontent part="selected-content"></selectedcontent></button>
      ${this.placeholder ? staticHtml `<option part="option" value="" ?selected=${defaultValue === ''}>${optionText(this.placeholder)}</option>`
            : blankDefault ? html `<option value="" selected disabled hidden></option>` : nothing}
      ${repeat(items, item => item.key ?? item.value, item => staticHtml `<option part="option" value=${item.value} ?selected=${item.value === defaultValue}
        ?disabled=${item.disabled} ?hidden=${item.hidden}>${optionText(item.label || '')}</option>`)}
    </select>`;
    }
}
