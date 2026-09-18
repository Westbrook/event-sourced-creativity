/** Returns the actual focused element through open shadow roots. */
export function focusedElement(document) {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement)
        element = element.shadowRoot.activeElement;
    return element;
}
/** A removed, hidden, disabled, or inert opener must not receive restored focus. */
export function restoreFocus(element) {
    if (!element?.isConnected || element.matches(':disabled, [hidden], [aria-disabled="true"]'))
        return;
    let ancestor = element;
    while (ancestor) {
        if ('inert' in ancestor && (ancestor.inert || ancestor.hidden))
            return;
        ancestor = ancestor.parentNode ?? ('host' in ancestor ? ancestor.host : null);
    }
    if (!element.getClientRects().length)
        return;
    element.focus({ preventScroll: true });
}
/** Includes slotted content and native controls inside nested shadow roots. */
export function composedContains(container, node) {
    while (node) {
        if (node === container)
            return true;
        node = ('assignedSlot' in node && node.assignedSlot)
            || node.parentNode || ('host' in node ? node.host : null);
    }
    return false;
}
