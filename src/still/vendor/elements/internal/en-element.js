import { LitElement } from 'lit';
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
