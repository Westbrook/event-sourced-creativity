import { LitElement } from 'lit';
import { registryCreationScope } from '../element-scope.js';
import { elementRegistry, recordConnectionDocument, releaseConnectionDocument } from './element-registry.js';
import { StaticStylesController } from '../../primitives/interactions/static-styles.js';
function normalizeSize(value) {
    return value === 'inherit' || value === 'small' || value === 'large' ? value : 'medium';
}
/**
 * Shared reactive base for En Rêve custom elements.
 *
 * Concrete size modes establish an absolute size scope through foundation styles.
 * Inherited size is resolved by CSS, so the getter reports the requested mode,
 * not a measured or computed size. This class performs no element registration.
 */
export class EnElement extends LitElement {
    // undefined means automatic; null is an intentionally uninitialized registry.
    #renderRegistry;
    #attachedRoot;
    /** Override only to request an explicit render registry. Register its dependencies first. */
    getRenderRegistry() {
        return this.constructor.shadowRootOptions.customElementRegistry;
    }
    attachShadow(options) {
        if (this.#renderRegistry !== undefined && 'customElementRegistry' in options && options.customElementRegistry !== this.#renderRegistry) {
            throw new Error('Conflicting explicit shadow registry options.');
        }
        return this.#attachedRoot = super.attachShadow(this.#renderRegistry === undefined ? options : { ...options, customElementRegistry: this.#renderRegistry });
    }
    createRenderRoot() {
        const requested = this.getRenderRegistry();
        const existing = this.shadowRoot;
        const actual = existing && 'customElementRegistry' in existing ? existing.customElementRegistry : undefined;
        if (existing && requested !== undefined && requested !== (actual === undefined ? this.ownerDocument?.defaultView?.customElements : actual)) {
            throw new Error('The explicitly requested render registry conflicts with the existing shadow root.');
        }
        const registry = existing && actual !== undefined ? actual : requested !== undefined ? requested : elementRegistry(this);
        if (registry !== undefined && this.ownerDocument?.defaultView) {
            this.renderOptions.creationScope = registryCreationScope(this.ownerDocument, registry);
            // Do not create the root before super: Lit hydration detects existing DSD here.
            this.#renderRegistry = registry;
        }
        try {
            return super.createRenderRoot();
        }
        catch (error) {
            // Lit's cached CSSResults contain sheets constructed in its source document.
            // A source-realm class can create new descendants after adoption, but those
            // sheets cannot be shared with the destination. Retain CSS text as a local
            // fallback only for this known style-adoption failure; never retry registry
            // or component failures through another construction path.
            const root = this.shadowRoot ?? this.#attachedRoot;
            const view = this.ownerDocument.defaultView;
            const styles = this.constructor.elementStyles;
            if (error.name !== 'NotAllowedError' || !root || !view ||
                view.HTMLElement.prototype.isPrototypeOf(this) || !styles.every(style => 'cssText' in style))
                throw error;
            const fallback = this.ownerDocument.createElement('style');
            fallback.textContent = styles.map(style => 'cssText' in style ? style.cssText : '').join('');
            const nonce = globalThis.litNonce;
            if (nonce)
                fallback.nonce = nonce;
            root.append(fallback);
            this.renderOptions.renderBefore ??= root.firstChild;
            return root;
        }
    }
    update(changed) {
        // Explicit initialization can happen after createRenderRoot (for example DSD).
        // Subsequent imports must use the now-associated root, not the dormant bridge.
        if (this.#renderRegistry === null && this.renderRoot?.customElementRegistry) {
            this.#renderRegistry = this.renderRoot.customElementRegistry;
            this.renderOptions.creationScope = registryCreationScope(this.ownerDocument, this.#renderRegistry);
        }
        super.update(changed);
    }
    connectedCallback() {
        recordConnectionDocument(this);
        super.connectedCallback();
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        releaseConnectionDocument(this);
    }
    adoptedCallback() {
        // A move preserves scoped association, but future imports belong to the
        // destination document. Never keep importing nodes through the old document.
        const root = this.renderRoot;
        if (root && this.ownerDocument.defaultView) {
            const registry = 'customElementRegistry' in root ? root.customElementRegistry : elementRegistry(this);
            if (registry !== undefined) {
                this.#renderRegistry = registry;
                this.renderOptions.creationScope = registryCreationScope(this.ownerDocument, registry);
            }
        }
    }
    staticStyles = new StaticStylesController(this);
    static properties = {
        size: {
            reflect: true,
            useDefault: true,
            noAccessor: true,
            converter: {
                fromAttribute: normalizeSize,
                toAttribute: normalizeSize,
            },
        },
    };
    // The accessor default is recorded by Lit's first update without reflection.
    #size = 'medium';
    /**
     * Requested size scope: inherit, small, medium, or large.
     * Defaults to medium without adding an attribute. Explicit property writes
     * reflect; removing the attribute or supplying an invalid value restores
     * medium. Inheritance is an explicit opt-in. Its effective size is resolved
     * by CSS and is deliberately not returned by this property.
     * @default "medium"
     */
    get size() {
        return this.#size;
    }
    set size(value) {
        const previous = this.#size;
        const next = normalizeSize(value);
        this.#size = next;
        // Also reflect an explicit same-value write after an absent/invalid attribute.
        // Attribute-originated updates remain protected by Lit's reflection guard.
        const options = this.getAttribute('size') !== next
            ? Object.assign(Object.create(this.constructor.getPropertyOptions('size')), { hasChanged: () => true })
            : undefined;
        this.requestUpdate('size', previous, options);
    }
}
