/** A null scoped registry is intentionally uninitialized, never the document registry. */
export function elementRegistry(element) {
    const scoped = element;
    const root = element.getRootNode();
    return 'customElementRegistry' in scoped ? scoped.customElementRegistry
        : 'customElementRegistry' in root ? root.customElementRegistry
            : element.ownerDocument.defaultView?.customElements;
}
