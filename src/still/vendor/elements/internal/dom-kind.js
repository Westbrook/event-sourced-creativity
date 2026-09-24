/** DOM kind checks must survive same-origin adoption and mixed-realm event paths. */
export function isDOMNode(value) {
    return !!value && typeof value === 'object' && typeof value.nodeType === 'number' && typeof value.getRootNode === 'function';
}
export function isDOMElement(value) { return isDOMNode(value) && value.nodeType === 1; }
export function isHTMLElement(value) { return isDOMElement(value) && value.namespaceURI === 'http://www.w3.org/1999/xhtml'; }
export function isHTMLButton(value) { return isHTMLElement(value) && value.localName === 'button'; }
export function isDOMShadowRoot(value) { return isDOMNode(value) && value.nodeType === 11 && isDOMElement(value.host); }
