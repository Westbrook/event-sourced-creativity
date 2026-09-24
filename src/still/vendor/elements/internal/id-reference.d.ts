/** ID references resolve within one tree, including an enclosing closed shadow root. */
export type ReferenceRoot = Document | ShadowRoot;
export declare function referenceRoot(node: Node): ReferenceRoot | null;
type Subscriber = (element: Element | null) => void;
/** Observe one literal ID. Empty IDs and detached fragments remain unresolved. */
export declare function observeIdReference(root: ReferenceRoot | null, id: string, subscriber: Subscriber): () => void;
export {};
