import { setNativeSurfaceOpen } from '../internal/native-surface.js';
import { EnElement } from '../internal/en-element.js';
import { dispatchChange } from '../../primitives/interactions/events.js';
import { foundationStyles, typographyStyles } from '../../styles/foundations.js';
import { controlStyles } from '../../styles/controls.js';
import { overlayResponsiveQuery, overlayStyles } from '../../styles/overlays.js';
import { dialogTemplate } from './template.js';
import { ModalTriggerController } from './trigger-controller.js';
import { composedContains, focusedElement, restoreFocus } from './focus.js';
/**
 * A modal dialog using native focus containment and background inertness.
 * Supply a meaningful `label`. Content remains in the host's theme tree.
 * Application property writes are authoritative and emit no change event.
 * Native form submission and essential instructions belong in the slotted content.
 *
 * @cssprop --en-duration-enter - Optional native surface entry paint duration (0–500ms).
 * @cssprop --en-duration-exit - Optional native surface exit paint duration (0–500ms); never delays state or focus.
 * @cssprop --en-ease-enter - Native surface entry easing.
 * @cssprop --en-ease-exit - Native surface exit easing.
 * @cssprop --en-motion-surface-offset - Optional modal travel, constrained to 0–8px.
 * @cssprop --en-motion-surface-scale - Optional modal scale, constrained to .95–1.
 * @tag en-dialog
 * @tagname en-dialog
 * @cssprop --en-overlay-focus-width - Immediate primary focus contour width.
 * @cssprop --en-overlay-focus-color - Immediate primary focus contour color.
 * @cssprop --en-overlay-focus-offset - Signed primary focus contour offset.
 * @cssprop --en-overlay-focus-halo-width - Supplemental outer focus halo width.
 * @cssprop --en-overlay-focus-halo-color - Supplemental focus halo color; alpha is supported.
 * @cssprop --en-duration-focus-enter - Supplemental halo and field-accent entry duration.
 * @cssprop --en-duration-focus-exit - Supplemental halo and field-accent exit duration.
 * @cssprop --en-ease-focus-enter - Supplemental focus entry timing function.
 * @cssprop --en-ease-focus-exit - Supplemental focus exit timing function.
 * @slot - Dialog body. Flow content and controls are supported.
 * @slot label - Noninteractive title phrasing; falls back to the label attribute.
 * @slot footer - Optional actions, in reading order after the body.
 * @csspart surface - The native dialog surface.
 * @csspart header - Visible heading and dismiss action.
 * @csspart heading - Visible dialog heading.
 * @csspart close - Native control of the internal icon-only en-button, forwarded through exportparts.
 * @csspart body - Content container.
 * @csspart footer - Footer container.
 * @fires {import('../dialog/types.js').OverlayChangeEvent} en-change - Cancelable tentative open state: {previous, proposed, reason}.
 * @cssprop --en-overlay-max-inline-size - Maximum surface inline size.
 * @cssprop --en-overlay-max-block-size - Maximum surface block size.
 * @cssprop --en-overlay-padding - Surface content spacing.
 * @cssprop --en-overlay-radius - Surface corner radius.
 * @cssprop --en-overlay-background - Surface background.
 * @cssprop --en-overlay-color - Surface foreground.
 * @cssprop --en-overlay-border-color - Surface border.
 */
export class EnDialog extends EnElement {
    static properties = {
        for: { type: String, reflect: true },
        open: { type: Boolean, reflect: true, noAccessor: true },
        label: { type: String, useDefault: true },
        closeLabel: { type: String, attribute: 'close-label', useDefault: true },
        closedBy: { type: String, attribute: 'closedby', reflect: true, noAccessor: true },
        dismissible: { type: Boolean },
        backdropDismiss: { type: Boolean, attribute: 'backdrop-dismiss', noAccessor: true },
        presentation: { type: String, reflect: true },
        responsiveQuery: { type: String, attribute: 'responsive-query' },
    };
    static styles = [foundationStyles, typographyStyles, controlStyles, overlayStyles];
    #open = false;
    #revision = 0;
    #openRevision = 0;
    #changeDepth = 0;
    #nativeOpen = false;
    #opener = null;
    #nativeOpener = null;
    #requestedOpener = null;
    #trigger = new ModalTriggerController(this, {
        id: () => this.for,
        open: () => this.#changeDepth ? this.#nativeOpen : this.open,
        activate: (trigger, valid) => {
            const proposed = this.triggerToggles ? !this.open : true;
            const outcome = this.requestOpen(proposed, 'trigger', valid);
            if (outcome === 'committed' && proposed && this.open && valid()) {
                this.#requestedOpener = { element: trigger, revision: this.#openRevision };
            }
        },
    });
    #backdropPointer = null;
    #nativeReason = 'close-request';
    #closedBy = 'closerequest';
    #responsiveMedia = null;
    #responsiveQuery = '';
    #compactPresentation = false;
    /** Open state, including a tentative value during en-change. Author writes are silent. */
    get open() { return this.#open; }
    set open(value) {
        const previous = this.#open;
        this.#requestedOpener = null;
        this.#open = Boolean(value);
        this.#revision++;
        this.#openRevision++;
        // An explicit author write can reopen a surface after an external native close.
        if (this.#open && !this.dialog?.open)
            this.#nativeOpen = false;
        this.requestUpdate('open', previous);
    }
    /**
     * Native dismissal policy. `any` includes outside clicks; `none` retains explicit close actions.
     * @default "closerequest"
     */
    get closedBy() { return this.#closedBy; }
    set closedBy(value) {
        const previous = this.#closedBy;
        this.#closedBy = value === 'any' || value === 'none' ? value : 'closerequest';
        this.requestUpdate('closedBy', previous);
        this.requestUpdate('backdropDismiss', previous === 'any');
    }
    /**
     * Legacy alias for closedBy='any'; setting false selects 'closerequest'.
     * @default false
     */
    get backdropDismiss() { return this.closedBy === 'any'; }
    set backdropDismiss(value) { this.closedBy = value ? 'any' : 'closerequest'; }
    constructor() {
        super();
        this.for = '';
        this.label = '';
        this.closeLabel = 'Close';
        this.dismissible = true;
        this.presentation = 'dialog';
        this.responsiveQuery = overlayResponsiveQuery;
    }
    /** Propose opening; en-change exposes tentative open state before native modality changes. */
    show(reason = 'programmatic') { return this.requestOpen(true, reason); }
    /** Propose closing; cancel en-change to keep the dialog open. */
    hide(reason = 'programmatic') { return this.requestOpen(false, reason); }
    requestOpen(proposed, reason, canCommit) {
        if (proposed === this.open)
            return 'unchanged';
        const previous = this.open;
        const previousNativeOpen = this.#nativeOpen;
        this.#changeDepth++;
        try {
            return dispatchChange(this, {
                previous, proposed, reason, canCommit,
                getRevision: () => this.#revision,
                stage: value => {
                    this.#open = value;
                    if (value && !this.dialog?.open)
                        this.#nativeOpen = false;
                },
                rollback: value => {
                    this.#open = value;
                    this.#nativeOpen = previousNativeOpen;
                    this.requestUpdate('open', proposed);
                },
                commit: () => { this.#requestedOpener = null; this.#openRevision++; this.requestUpdate('open', previous); },
            });
        }
        finally {
            this.#changeDepth--;
            // A listener can synchronously flush Lit or assign authoritative state.
            // Reconcile only after the outermost tentative transition has settled.
            if (!this.#changeDepth)
                this.requestUpdate('open', previous);
        }
    }
    /** The palette retains its existing programmatic trigger-toggle behavior. */
    get triggerToggles() { return false; }
    /** Ownership clock for action defaults: equal author writes and accepted transitions count. */
    get openRevision() { return this.#openRevision; }
    get surfaceClass() { return this.#compactPresentation ? 'en-drawer' : 'en-dialog'; }
    get placement() { return this.#compactPresentation ? 'bottom' : ''; }
    get dialog() { return this.renderRoot?.querySelector('dialog') ?? null; }
    get effectiveClosedBy() { return this.dismissible ? this.closedBy : 'none'; }
    /** Isolated capability seam for testing engines without the native policy. */
    get supportsNativeClosedBy() {
        const prototype = this.ownerDocument?.defaultView?.HTMLDialogElement?.prototype;
        return prototype !== undefined && 'closedBy' in prototype;
    }
    connectedCallback() {
        super.connectedCallback();
        // Hydrate the server's wide presentation first. A client-only media value
        // staged before hydration would be cached without updating the server DOM.
        // updated() observes the initial query after those template parts exist.
        if (this.hasUpdated)
            this.observePresentation();
        // Reconnection does not replay a user request, but must restore accepted state.
        this.updateComplete.then(() => { if (this.isConnected)
            this.syncDialog(); });
    }
    disconnectedCallback() {
        this.#nativeOpen = false;
        this.dialog?.close();
        this.#opener = null;
        this.#nativeOpener = null;
        this.#requestedOpener = null;
        this.#backdropPointer = null;
        this.stopObservingPresentation();
        super.disconnectedCallback();
    }
    updated(_changes) {
        this.observePresentation();
        this.syncDialog();
    }
    observePresentation() {
        const view = this.ownerDocument?.defaultView;
        if (!this.isConnected || !view?.matchMedia)
            return;
        if (this.presentation !== 'responsive') {
            this.stopObservingPresentation();
            this.setCompactPresentation(false);
            return;
        }
        const query = this.responsiveQuery.trim() || overlayResponsiveQuery;
        if (this.#responsiveMedia && this.#responsiveQuery === query)
            return;
        this.stopObservingPresentation();
        this.#responsiveQuery = query;
        this.#responsiveMedia = view.matchMedia(query);
        this.#responsiveMedia.addEventListener('change', this.#presentationChanged);
        this.setCompactPresentation(this.#responsiveMedia.matches);
    }
    stopObservingPresentation() {
        this.#responsiveMedia?.removeEventListener('change', this.#presentationChanged);
        this.#responsiveMedia = null;
        this.#responsiveQuery = '';
    }
    setCompactPresentation(compact) {
        const previous = this.#compactPresentation;
        if (previous === compact)
            return;
        this.#compactPresentation = compact;
        this.requestUpdate('compactPresentation', previous);
    }
    #presentationChanged = (event) => { this.setCompactPresentation(event.matches); };
    syncDialog() {
        const dialog = this.dialog;
        if (!dialog || !this.isConnected || this.#changeDepth)
            return;
        // The native close event is queued. Reconcile before a pending Lit update
        // could reopen a surface whose native close already completed.
        if (this.#nativeOpen && !dialog.open) {
            this.reconcileNativeClose();
            return;
        }
        if (this.open && !dialog.open) {
            const active = focusedElement(this.ownerDocument);
            this.#nativeOpener = active && 'focus' in active ? active : null;
            const requested = this.#requestedOpener;
            this.#requestedOpener = null;
            this.#opener = requested?.revision === this.#openRevision && requested.element.isConnected
                ? requested.element : this.#nativeOpener;
            setNativeSurfaceOpen(dialog, true);
            dialog.showModal();
            this.#nativeOpen = true;
        }
        else if (!this.open && dialog.open) {
            const active = focusedElement(this.ownerDocument);
            const shouldRestore = active === this || composedContains(dialog, active);
            this.#nativeOpen = false;
            dialog.close();
            setNativeSurfaceOpen(dialog, false);
            if (shouldRestore)
                restoreFocus(this.#opener);
            this.#opener = null;
            this.#nativeOpener = null;
        }
    }
    #cancel = (event) => {
        // Native cancel is cancelable; prevent its default before proposing our state.
        event.preventDefault();
        const reason = this.#nativeReason;
        this.#nativeReason = 'close-request';
        if (this.effectiveClosedBy === 'none')
            return;
        if (reason === 'backdrop' && this.effectiveClosedBy !== 'any')
            return;
        this.hide(reason);
    };
    #close = () => {
        if (!this.isConnected || !this.#nativeOpen || this.dialog?.open)
            return;
        this.reconcileNativeClose();
    };
    reconcileNativeClose() {
        // Native close has already removed modality and restored native focus. It is
        // a terminal notification, not a cancelable proposal that can be rolled back.
        // Use hide() to intercept closing, or cancel a method="dialog" form's submit.
        this.#nativeOpen = false;
        if (this.dialog)
            setNativeSurfaceOpen(this.dialog, false);
        this.open = false;
        const active = focusedElement(this.ownerDocument);
        if (active === this.#nativeOpener || active === this.ownerDocument.body || active === this.dialog) {
            restoreFocus(this.#opener);
        }
        this.#opener = null;
        this.#nativeOpener = null;
    }
    #isBackdrop(event) {
        const dialog = this.dialog;
        if (!dialog || event.target !== dialog)
            return false;
        const bounds = dialog.getBoundingClientRect();
        return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    }
    #pointerDown = (event) => {
        const outside = this.#isBackdrop(event);
        this.#backdropPointer = outside && event.isPrimary && event.button === 0 ? event.pointerId : null;
        this.#nativeReason = outside ? 'backdrop' : 'close-request';
    };
    #pointerUp = (event) => {
        const dismiss = this.#backdropPointer === event.pointerId && this.#isBackdrop(event);
        this.#backdropPointer = null;
        this.#nativeReason = dismiss ? 'backdrop' : 'close-request';
        if (dismiss && this.effectiveClosedBy === 'any' && !this.supportsNativeClosedBy)
            this.hide('backdrop');
        queueMicrotask(() => { this.#nativeReason = 'close-request'; });
    };
    #pointerCancel = () => { this.#backdropPointer = null; this.#nativeReason = 'close-request'; };
    #keyDown = (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented)
            this.#nativeReason = 'escape';
    };
    /** Native lifecycle bindings for specialized modal content without a nested dialog. */
    get dialogView() {
        return {
            surfaceClass: this.surfaceClass, placement: this.#compactPresentation ? 'bottom' : this.placement, label: this.label,
            closeLabel: this.closeLabel, dismissible: this.dismissible,
            closedBy: this.supportsNativeClosedBy ? this.effectiveClosedBy : 'closerequest',
            cancel: this.#cancel, close: this.#close, dismiss: () => this.hide('close-button'),
            pointerDown: this.#pointerDown, pointerUp: this.#pointerUp, pointerCancel: this.#pointerCancel,
            keyDown: this.#keyDown,
        };
    }
    render() { return dialogTemplate(this.dialogView); }
}
