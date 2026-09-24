/** A null scoped registry is intentionally uninitialized, never the document registry. */
export function elementRegistry(element) {
    const scoped = element;
    const root = element.getRootNode();
    return 'customElementRegistry' in scoped ? scoped.customElementRegistry
        : 'customElementRegistry' in root ? root.customElementRegistry
            : element.ownerDocument.defaultView?.customElements;
}
const connectedDocuments = new WeakMap();
/** The document where connection-owned listeners were installed, including during adoption callbacks. */
export const connectionDocument = (element) => connectedDocuments.get(element) ?? element.ownerDocument;
export const recordConnectionDocument = (element) => { connectedDocuments.set(element, element.ownerDocument); };
export const releaseConnectionDocument = (element) => { connectedDocuments.delete(element); };
