/** Returns the actual focused element through open shadow roots. */
export declare function focusedElement(document: Document): Element | null;
/** A removed, hidden, disabled, or inert opener must not receive restored focus. */
export declare function restoreFocus(element: HTMLElement | null): void;
/** Includes slotted content and native controls inside nested shadow roots. */
export declare function composedContains(container: Node, node: Node | null): boolean;
