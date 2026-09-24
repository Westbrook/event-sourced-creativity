import { type PropertyValues } from 'lit';
import type { FormValidation } from '../../primitives/interactions/form-controller.js';
import { FormFieldElement } from '../forms-private/form-field.js';
export interface SelectItem {
    readonly value: string;
    readonly label: string;
    readonly disabled?: boolean;
}
/**
 * A labeled native single select. Direct en-select-option descriptors take precedence over items.
 * The parent renders private native options; descriptor nodes are metadata, not native options.
 * Cancel en-change to reject a provisional selection; author value writes remain authoritative.
 * @cssprop --en-select-pressed-scale - select held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-select-pressed-offset - select held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-select-press-duration - select held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-select-release-duration - select held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-select-pressed-shadow - select held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-select-pressed-background - select held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-select-pressed-color - select held-state refinement; geometry is bounded and reduced motion wins.
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
 * @cssprop --en-input-border-color - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-border-width - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-hover-border-color - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-invalid-border-color - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-invalid-border-width - Optional theme presentation; see the customization registry for state, fallback and reachability.
 * @cssprop --en-input-radius - Optional theme presentation; see the customization registry for state, fallback and reachability.
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
 * @cssprop --en-input-background - Field fill falling back to the shared control background.
 * @cssprop --en-input-color - Field text falling back to the shared control color.
 * @cssprop --en-control-radius - Control corner radius.
 * @cssprop --en-field-gap - Gap between label, control and supporting text.
 * @cssprop --en-input-inline-padding - Text-editor inline padding; takes precedence over shared control-inline-padding.
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
 * @fires {import('../events.js').DraftInputEvent} en-input - Current native selected draft.
 * @fires {import('../events.js').FieldChangeEvent} en-change - Cancelable selection change; provisional value and form data are available during dispatch.
 */
export declare class EnSelect extends FormFieldElement {
    static styles: import("lit").CSSResult[];
    static properties: {
        label: {
            type: StringConstructor;
        };
        description: {
            type: StringConstructor;
        };
        validationText: {
            attribute: string;
        };
        error: {
            type: StringConstructor;
            noAccessor: boolean;
        };
        value: {
            type: StringConstructor;
            noAccessor: boolean;
            attribute: boolean;
        };
        defaultValue: {
            attribute: string;
            noAccessor: boolean;
        };
        name: {
            type: StringConstructor;
            reflect: boolean;
        };
        disabled: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        required: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        placeholder: {
            type: StringConstructor;
        };
        items: {
            attribute: boolean;
        };
    };
    /** Native option descriptions; labels are rendered as text, never HTML. Values should be unique. */
    items: readonly SelectItem[];
    private readonly childOptions;
    private hydrationChoice;
    private hydrationRevision;
    constructor();
    connectedCallback(): void;
    private captureHydrationChoice;
    private get effectiveItems();
    private currentItems;
    protected get visibleError(): string;
    protected get submissionValue(): string | null;
    protected canCommitValue(value: string): boolean;
    protected validateAcceptedValue(): FormValidation;
    protected willUpdate(changed: PropertyValues): void;
    protected reconcile(): void;
    private onInput;
    private onChange;
    protected renderControl(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-select': EnSelect;
    }
}
