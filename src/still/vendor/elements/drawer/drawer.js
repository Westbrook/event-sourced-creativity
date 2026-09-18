import { EnDialog } from '../dialog/dialog.js';
/**
 * Modal edge panel. Shares the dialog's focus, state, dismissal, and slot contract.
 * Start and end follow inherited direction; left/right/top/bottom are fixed edges.
 * Native focus is immediate while optional paint uses the dialog's travel distance toward the attached edge.
 * Opt into presentation="responsive" to use bottom placement below responsive-query,
 * retaining the authored placement for wider views and the same modal/control state.
 *
 * @cssprop --en-duration-enter - Optional native surface entry paint duration (0–500ms).
 * @cssprop --en-duration-exit - Optional native surface exit paint duration (0–500ms); never delays state or focus.
 * @cssprop --en-ease-enter - Native surface entry easing.
 * @cssprop --en-ease-exit - Native surface exit easing.
 * @cssprop --en-motion-surface-offset - Shared dialog/drawer travel (0–8px); attachment sets direction, and zero disables translation.
 * @tag en-drawer
 * @tagname en-drawer
 * @cssprop --en-overlay-focus-width - Immediate primary focus contour width.
 * @cssprop --en-overlay-focus-color - Immediate primary focus contour color.
 * @cssprop --en-overlay-focus-offset - Signed primary focus contour offset.
 * @cssprop --en-overlay-focus-halo-width - Supplemental outer focus halo width.
 * @cssprop --en-overlay-focus-halo-color - Supplemental focus halo color; alpha is supported.
 * @cssprop --en-duration-focus-enter - Supplemental halo and field-accent entry duration.
 * @cssprop --en-duration-focus-exit - Supplemental halo and field-accent exit duration.
 * @cssprop --en-ease-focus-enter - Supplemental focus entry timing function.
 * @cssprop --en-ease-focus-exit - Supplemental focus exit timing function.
 * @slot - Drawer body; flow content and controls.
 * @slot label - Noninteractive title phrasing; falls back to the label attribute.
 * @slot footer - Optional actions after the body.
 * @csspart surface - Native modal drawer surface.
 * @csspart header - Heading and dismiss action.
 * @csspart heading - Visible drawer heading.
 * @csspart close - Native control of the internal icon-only en-button, forwarded through exportparts.
 * @csspart body - Content container.
 * @csspart footer - Footer container.
 * @fires en-change - Cancelable tentative open state: {previous, proposed, reason}.
 */
export class EnDrawer extends EnDialog {
    static properties = {
        ...EnDialog.properties,
        placement: { type: String, reflect: true, noAccessor: true },
    };
    #placement = 'end';
    /** Viewport edge. Start/end follow direction; left/right do not swap in RTL.
     * With presentation="responsive", the compact view uses bottom without changing this value.
     */
    get placement() { return this.#placement; }
    set placement(value) {
        const previous = this.#placement;
        this.#placement = ['start', 'end', 'left', 'right', 'top', 'bottom'].includes(value) ? value : 'end';
        this.requestUpdate('placement', previous);
    }
    get surfaceClass() { return 'en-drawer'; }
}
