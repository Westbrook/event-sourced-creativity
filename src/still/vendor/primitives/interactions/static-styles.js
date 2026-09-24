import { supportsAdoptingStyleSheets } from 'lit';
/** Internal renderer/controller protocol; survives semantics-preserving CSS minification. */
export const STATIC_STYLES_ATTRIBUTE = 'data-en-static-styles';
export const STATIC_STYLES_VERSION = 'v1';
const staticResults = new WeakMap();
const fallbackText = new WeakMap();
function resultsFor(host) {
    const ctor = host.constructor;
    if (staticResults.has(ctor))
        return staticResults.get(ctor);
    const styles = ctor.elementStyles;
    // The installed Lit SSR renderer serializes CSSResult.cssText. Native sheets
    // and import/namespace rules need their own SSR semantics; keep their fallback.
    const compatible = styles.length > 0 && styles.every(style => 'cssText' in style
        && typeof style.cssText === 'string' && !/@(?:import|namespace)\b/i.test(style.cssText));
    const result = compatible ? styles : null;
    staticResults.set(ctor, result);
    return result;
}
/** Restore native Lit static-sheet sharing only after the existing root hydrates. */
export class StaticStylesController {
    #host;
    #attempted = false;
    #candidate;
    #root;
    #document;
    #styles;
    #ownedSheets = [];
    #nonce = '';
    constructor(host) {
        this.#host = host;
        host.addController(this);
    }
    hostConnected() {
        if (this.#document && this.#document !== this.#host.ownerDocument) {
            this.#restoreAfterDocumentMove();
            return;
        }
        if (this.#attempted)
            return;
        const root = this.#host.shadowRoot;
        const first = root?.firstElementChild;
        if (root && first?.localName === 'style'
            && first.getAttribute(STATIC_STYLES_ATTRIBUTE) === STATIC_STYLES_VERSION) {
            this.#root = root;
            this.#candidate = first;
        }
    }
    hostUpdated() {
        if (this.#attempted)
            return;
        this.#attempted = true;
        // Fresh client roots lose adopted sheets on a cross-document move too.
        // Remember the source styles without allocating another sheet or DOM node.
        const root = this.#host.renderRoot;
        if (!this.#candidate && root && 'adoptedStyleSheets' in root && root.adoptedStyleSheets.length) {
            const styles = resultsFor(this.#host);
            if (styles) {
                this.#root = root;
                this.#document = this.#host.ownerDocument;
                this.#styles = styles;
                this.#ownedSheets = styles.map(style => style.styleSheet).filter((sheet) => !!sheet);
            }
        }
        // Controller callbacks precede firstUpdated/updated. Let those callbacks
        // finish before deciding whether another sheet requires the SSR ordering.
        void this.#host.updateComplete.then(() => this.#adopt(), () => { this.#candidate = undefined; });
    }
    #adopt() {
        const root = this.#root;
        const style = this.#candidate;
        this.#candidate = undefined;
        if (!supportsAdoptingStyleSheets || !root || root !== this.#host.shadowRoot
            || !style || style.parentNode !== root
            || style.getAttribute(STATIC_STYLES_ATTRIBUTE) !== STATIC_STYLES_VERSION
            || !('adoptedStyleSheets' in root))
            return;
        // Adopted sheets follow all DOM sheets. Keep the existing ordering when a
        // template/consumer supplied another sheet, or changed this style's mode.
        if ([...root.querySelectorAll('style, link[rel~="stylesheet" i]')].some(node => node !== style)
            || style.getAttributeNames().some(name => name !== STATIC_STYLES_ATTRIBUTE && name !== 'nonce')
            || !style.sheet || style.sheet.disabled)
            return;
        const styles = resultsFor(this.#host);
        if (!styles)
            return;
        const previous = [...root.adoptedStyleSheets];
        try {
            // CSSResult's public getter supplies Lit's own shared sheet instances;
            // no per-instance parsing or second sheet cache is introduced here.
            const sheets = styles.map(result => result.styleSheet);
            if (sheets.some(sheet => sheet === undefined))
                return;
            const additions = sheets.filter(sheet => !previous.includes(sheet));
            root.adoptedStyleSheets = [...additions, ...previous];
            this.#ownedSheets = additions;
        }
        catch {
            // In particular, sheets constructed in another document cannot be adopted.
            // Restore a partially changed list if necessary, retaining the SSR node.
            try {
                root.adoptedStyleSheets = previous;
            }
            catch { /* The SSR fallback stays. */ }
            return;
        }
        this.#document = this.#host.ownerDocument;
        this.#styles = styles;
        this.#nonce = style.nonce;
        style.remove();
    }
    #restoreAfterDocumentMove() {
        const root = this.#root;
        const styles = this.#styles;
        if (!root || root !== this.#host.renderRoot || !styles)
            return;
        // Cross-document adoption can clear the browser's sheet list. Recreate only
        // our static fallback before the next paint, preserving content and focus.
        let text = fallbackText.get(styles);
        if (text === undefined) {
            text = styles.map(style => style.cssText).join('');
            fallbackText.set(styles, text);
        }
        const fallback = this.#host.ownerDocument.createElement('style');
        fallback.setAttribute(STATIC_STYLES_ATTRIBUTE, STATIC_STYLES_VERSION);
        if (this.#nonce)
            fallback.nonce = this.#nonce;
        fallback.textContent = text;
        root.insertBefore(fallback, root.firstChild);
        try {
            root.adoptedStyleSheets = root.adoptedStyleSheets.filter(sheet => !this.#ownedSheets.includes(sheet));
        }
        catch { /* The DOM fallback is already present. */ }
        this.#document = undefined;
        this.#styles = undefined;
        this.#ownedSheets = [];
    }
}
