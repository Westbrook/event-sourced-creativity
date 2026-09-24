/** @internal A private split view owns actions from its contained splitter. */
export type SplitterOwner = (proposed: number, reason: 'keyboard' | 'pointer') => void;
/** @internal No property or event is added to the public splitter host. */
export declare function setSplitterOwner(splitter: Element, owner?: SplitterOwner): void;
/** @internal Resolve ownership before a standalone splitter stages a transaction. */
export declare function getSplitterOwner(splitter: Element): SplitterOwner | undefined;
