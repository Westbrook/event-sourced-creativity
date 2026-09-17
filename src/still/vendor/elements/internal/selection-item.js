import { LitElement } from 'lit';
import { StaticStylesController } from '../../primitives/interactions/static-styles.js';
/** Descriptor metadata is reflected so browser and SSR read the same authored contract. */
export class SelectionItemElement extends LitElement {
    staticStyles = new StaticStylesController(this);
    static properties = {
        value: { noAccessor: true, reflect: true, useDefault: true },
        disabled: { type: Boolean, noAccessor: true, reflect: true, useDefault: true },
        label: { type: String, noAccessor: true, reflect: true, useDefault: true },
    };
    #value = '';
    /** Explicit parent-owned choice identifier; changing it never selects the item. */
    get value() { return this.#value; }
    set value(value) {
        const previous = this.#value;
        this.#value = String(value ?? '');
        if (this.getAttribute('value') !== this.#value)
            this.setAttribute('value', this.#value);
        const options = this.getAttribute('value') !== this.#value
            ? Object.assign(Object.create(this.constructor.getPropertyOptions('value')), { hasChanged: () => true })
            : undefined;
        this.requestUpdate('value', previous, options);
    }
    /** Exclude this choice from user selection. The parent retains value authority. */
    #disabled = false;
    get disabled() { return this.#disabled; }
    set disabled(value) {
        const previous = this.#disabled;
        this.#disabled = Boolean(value);
        if (this.hasAttribute('disabled') !== this.#disabled)
            this.toggleAttribute('disabled', this.#disabled);
        this.requestUpdate('disabled', previous);
    }
    /** Plain label fallback when no label content is supplied. */
    #label = '';
    get label() { return this.#label; }
    set label(value) {
        const previous = this.#label;
        this.#label = String(value ?? '');
        if (this.getAttribute('label') !== this.#label)
            this.setAttribute('label', this.#label);
        this.requestUpdate('label', previous);
    }
}
