import { splitViewTemplate } from './template.js';
import { css } from 'lit';
import { EnElement } from '../internal/en-element.js';
import { createValueModel } from '../../primitives/state/value.js';
import { dispatchChange } from '../../primitives/interactions/events.js';
import { setSplitterOwner } from '../splitter/owner.js';
import { SignalController } from '../../primitives/interactions/signal-controller.js';
import { foundationStyles, blockHostStyles } from '../../styles/foundations.js';
import { layoutStyles } from '../../styles/surfaces.js';
import { composedContains, focusedElement } from '../dialog/focus.js';
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
export class EnSplitView extends EnElement {
    static properties = {
        value: { type: Number, reflect: true, noAccessor: true },
        min: { type: Number }, max: { type: Number }, step: { type: Number },
        orientation: { type: String, reflect: true },
        label: { type: String },
        disabled: { type: Boolean, reflect: true },
        collapsible: { type: String, reflect: true },
        collapsed: { type: String, reflect: true, noAccessor: true },
        primaryLabel: { attribute: 'primary-label' }, secondaryLabel: { attribute: 'secondary-label' },
        collapseLabel: { attribute: 'collapse-label' }, restoreLabel: { attribute: 'restore-label' },
        controlsLabel: { attribute: 'controls-label' },
    };
    static styles = [foundationStyles, blockHostStyles, layoutStyles, css `
    :host { display: block; min-inline-size: 0; min-block-size: 0; }
    .en-split-shell { display: flex; flex-direction: column; block-size: 100%; min-block-size: 0; }
    .en-split-view { flex: 1; }
    .en-split-controls { display:flex; flex-wrap:wrap; gap:var(--en-space-actions, .5rem); padding-block-end:var(--en-space-2, .5rem); }
    [hidden] { display: none !important; }
    .en-split-view[data-collapsed]:not([data-collapsed='none']) { grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(0,1fr); }
  `];
    collapsedState = 'none';
    presentedCollapsed = 'none';
    focusRecovery;
    restoreFocus;
    model = createValueModel(50);
    // An equal public assignment can still supersede an in-flight proposal.
    authorRevision = 0;
    presentedValue = 50;
    handle;
    constructor() {
        super();
        this.min = 10;
        this.max = 90;
        this.step = 1;
        this.orientation = 'horizontal';
        this.label = 'Resize panels';
        this.disabled = false;
        this.collapsible = 'none';
        this.primaryLabel = 'Primary pane';
        this.secondaryLabel = 'Secondary pane';
        this.collapseLabel = 'Collapse {pane}';
        this.restoreLabel = 'Restore {pane}';
        this.controlsLabel = 'Pane visibility';
        new SignalController(this, () => this.model.view.get());
    }
    /** Authoritative visibility; size is retained independently in value. */
    get collapsed() { return this.collapsedState; }
    set collapsed(value) {
        this.authorRevision++;
        this.model.set(this.presentedValue);
        const previous = this.presentedCollapsed;
        this.collapsedState = value === 'primary' || value === 'secondary' ? value : 'none';
        this.presentedCollapsed = this.collapsedState;
        this.requestUpdate('collapsed', previous);
    }
    allowed(pane) { return this.collapsible === 'both' || this.collapsible === pane; }
    /** Request hiding an eligible pane without altering its expanded size. */
    collapse(pane) { return this.changeCollapsed(pane, 'programmatic'); }
    /** Request restoring the current pane to the retained, bounded value. */
    restore() { return this.changeCollapsed('none', 'programmatic'); }
    /** Request collapsing or restoring an eligible pane. */
    toggle(pane) { return this.changeCollapsed(this.collapsed === pane ? 'none' : pane, 'programmatic'); }
    changeCollapsed(next, reason) {
        if (this.disabled || (next !== 'none' && !this.allowed(next)))
            return 'canceled';
        return dispatchChange(this, {
            previous: this.collapsed, proposed: next, reason,
            getRevision: () => this.authorRevision,
            stage: value => { this.collapsedState = value; },
            rollback: value => { this.collapsedState = value; },
            canCommit: value => !this.disabled && (value === 'none' || this.allowed(value)),
            commit: () => { const previous = this.presentedCollapsed; this.model.set(this.presentedValue); this.presentedCollapsed = this.collapsedState; this.requestUpdate('collapsed', previous); },
        }, { eventName: 'en-collapse' });
    }
    action = (pane) => { this.changeCollapsed(this.collapsed === pane ? 'none' : pane, 'button'); };
    handleKey = (event) => {
        if (event.target !== this.handle || event.key !== 'Enter' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || this.disabled)
            return;
        const pane = this.allowed('primary') ? 'primary' : this.allowed('secondary') ? 'secondary' : undefined;
        if (pane) {
            event.preventDefault();
            this.changeCollapsed(pane, 'keyboard');
        }
    };
    get value() { return this.model.value.get(); }
    set value(value) {
        this.authorRevision += 1;
        this.collapsedState = this.presentedCollapsed;
        const previous = this.presentedValue;
        const { min, max } = this.bounds;
        const next = Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : 50));
        this.model.set(next);
        this.presentedValue = this.value;
        this.requestUpdate('value', previous);
    }
    get bounds() {
        const min = Math.max(0, Math.min(100, Number.isFinite(this.min) ? this.min : 10));
        const max = Math.max(min, Math.min(100, Number.isFinite(this.max) ? this.max : 90));
        return { min, max };
    }
    connectedCallback() {
        super.connectedCallback();
        if (this.handle)
            setSplitterOwner(this.handle, this.onHandleChange);
    }
    disconnectedCallback() {
        if (this.handle)
            setSplitterOwner(this.handle);
        super.disconnectedCallback();
    }
    setHandle = (element) => {
        if (this.handle)
            setSplitterOwner(this.handle);
        this.handle = element;
        if (this.handle)
            setSplitterOwner(this.handle, this.onHandleChange);
    };
    onHandleChange = (proposed, reason) => {
        if (!this.disabled)
            dispatchChange(this, {
                previous: this.value, proposed, reason,
                getRevision: () => this.authorRevision,
                stage: next => { this.model.set(next); },
                rollback: prior => { this.model.set(prior); },
                canCommit: next => !this.disabled && next >= this.bounds.min && next <= this.bounds.max,
                commit: () => {
                    this.collapsedState = this.presentedCollapsed;
                    const previous = this.presentedValue;
                    this.presentedValue = this.value;
                    this.requestUpdate('value', previous);
                },
            });
        // The owner alone emits. Reconcile its private handle only after settlement,
        // including any authoritative value or bounds written during dispatch.
        if (this.handle) {
            this.handle.min = this.bounds.min;
            this.handle.max = this.bounds.max;
            this.handle.value = this.presentedValue;
        }
    };
    willUpdate(changed) {
        if (changed.has('min') || changed.has('max'))
            this.value = this.value;
        if (changed.has('collapsed') && this.presentedCollapsed !== 'none' && this.ownerDocument) {
            const active = focusedElement(this.ownerDocument);
            const pane = this.renderRoot.querySelector(`[part='${this.presentedCollapsed}']`);
            if ((pane && composedContains(pane, active)) || (this.handle && composedContains(this.handle, active)))
                this.focusRecovery = this.presentedCollapsed;
        }
        const prior = changed.get('collapsed');
        if (this.presentedCollapsed === 'none' && (prior === 'primary' || prior === 'secondary') && !this.allowed(prior) && this.ownerDocument) {
            const action = this.renderRoot.querySelector(`[part='${prior}-action']`);
            if (action && composedContains(action, focusedElement(this.ownerDocument)))
                this.restoreFocus = prior;
        }
    }
    updated() {
        const pane = this.focusRecovery;
        this.focusRecovery = undefined;
        if (pane && this.collapsed === pane) {
            const target = this.disabled ? (pane === 'primary' ? 'secondary' : 'primary') : `${pane}-action`;
            this.renderRoot.querySelector(`[part='${target}']`)?.focus();
        }
        const restored = this.restoreFocus;
        this.restoreFocus = undefined;
        if (restored && this.collapsed === 'none')
            this.renderRoot.querySelector(`[part='${restored}']`)?.focus();
    }
    render() {
        return splitViewTemplate({ value: this.presentedValue, ...this.bounds, step: this.step, label: this.label, disabled: this.disabled, orientation: this.orientation,
            collapsed: this.presentedCollapsed, primaryAction: this.allowed('primary'), secondaryAction: this.allowed('secondary'),
            primaryLabel: this.primaryLabel, secondaryLabel: this.secondaryLabel, collapseLabel: this.collapseLabel, restoreLabel: this.restoreLabel, controlsLabel: this.controlsLabel,
        }, this.setHandle, this.action, this.handleKey);
    }
}
