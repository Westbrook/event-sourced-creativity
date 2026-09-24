/** A null scoped registry is intentionally uninitialized, never the document registry. */
export declare function elementRegistry(element: Element): CustomElementRegistry | null | undefined;
/** The document where connection-owned listeners were installed, including during adoption callbacks. */
export declare const connectionDocument: (element: Element) => Document;
export declare const recordConnectionDocument: (element: Element) => void;
export declare const releaseConnectionDocument: (element: Element) => void;
