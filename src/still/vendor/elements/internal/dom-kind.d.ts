/** DOM kind checks must survive same-origin adoption and mixed-realm event paths. */
export declare function isDOMNode(value: unknown): value is Node;
export declare function isDOMElement(value: unknown): value is Element;
export declare function isHTMLElement(value: unknown): value is HTMLElement;
export declare function isHTMLButton(value: unknown): value is HTMLButtonElement;
export declare function isDOMShadowRoot(value: unknown): value is ShadowRoot;
