import { EnElement } from '../internal/en-element.js';
import type { PropertyValues } from 'lit';
import type { ChangeOutcome } from '../../primitives/interactions/events.js';
export type SplitPane = 'primary' | 'secondary';
export type SplitCollapsed = 'none' | SplitPane;
/**
 * Two resizable panes. Horizontal places panes beside one another; vertical stacks them.
 * Set an explicit block size for vertical resizing. Requires en-splitter in the same registry.
 * @tagname en-split-view
 * @slot primary - Primary pane content.
 * @slot secondary - Secondary pane content.
 * @csspart base - Layout grid.
 * @csspart primary - Primary pane wrapper.
 * @csspart secondary - Secondary pane wrapper.
 * @csspart separator - Resize handle host.
 * @csspart controls - Pane visibility actions, outside the resizable grid.
 * @csspart primary-action - Primary collapse/restore button host.
 * @csspart secondary-action - Secondary collapse/restore button host.
 * @csspart primary-toggle - Primary native button surface.
 * @csspart secondary-toggle - Secondary native button surface.
 * @fires {import('../events.js').SplitCollapseEvent} en-collapse - Cancelable visibility transaction: previous/proposed are none, primary or secondary; reason is keyboard, button or programmatic.
 * @fires {CustomEvent<import('../../primitives/interactions/events.js').ChangeDetail<number>>} en-change - Cancelable tentative primary-pane percentage. This group owns the contained splitter's change.
 */
export declare class EnSplitView extends EnElement {
    static properties: {
        value: {
            type: NumberConstructor;
            reflect: boolean;
            noAccessor: boolean;
        };
        min: {
            type: NumberConstructor;
        };
        max: {
            type: NumberConstructor;
        };
        step: {
            type: NumberConstructor;
        };
        orientation: {
            type: StringConstructor;
            reflect: boolean;
        };
        label: {
            type: StringConstructor;
        };
        disabled: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        collapsible: {
            type: StringConstructor;
            reflect: boolean;
        };
        collapsed: {
            type: StringConstructor;
            reflect: boolean;
            noAccessor: boolean;
        };
        primaryLabel: {
            attribute: string;
        };
        secondaryLabel: {
            attribute: string;
        };
        collapseLabel: {
            attribute: string;
        };
        restoreLabel: {
            attribute: string;
        };
        controlsLabel: {
            attribute: string;
        };
    };
    static styles: import("lit").CSSResult[];
    min: number;
    max: number;
    step: number;
    orientation: 'horizontal' | 'vertical';
    label: string;
    disabled: boolean;
    /** Panes offered for user collapse; none by default. Restore remains reachable for an author-collapsed pane. */
    collapsible: 'none' | SplitPane | 'both';
    /** Localized pane names used in action labels. */
    primaryLabel: string;
    secondaryLabel: string;
    /** Localized templates; {pane} is replaced by the pane name. */
    collapseLabel: string;
    restoreLabel: string;
    /** Accessible name of the visibility action group. */
    controlsLabel: string;
    private collapsedState;
    private presentedCollapsed;
    private focusRecovery?;
    private restoreFocus?;
    private readonly model;
    private authorRevision;
    private presentedValue;
    private handle?;
    constructor();
    /** Authoritative visibility; size is retained independently in value. */
    get collapsed(): SplitCollapsed;
    set collapsed(value: SplitCollapsed);
    private allowed;
    /** Request hiding an eligible pane without altering its expanded size. */
    collapse(pane: SplitPane): ChangeOutcome;
    /** Request restoring the current pane to the retained, bounded value. */
    restore(): ChangeOutcome;
    /** Request collapsing or restoring an eligible pane. */
    toggle(pane: SplitPane): ChangeOutcome;
    private changeCollapsed;
    private readonly action;
    private readonly handleKey;
    get value(): number;
    set value(value: number);
    private get bounds();
    connectedCallback(): void;
    disconnectedCallback(): void;
    private readonly setHandle;
    private readonly onHandleChange;
    protected willUpdate(changed: PropertyValues): void;
    protected updated(): void;
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-split-view': EnSplitView;
    }
}
