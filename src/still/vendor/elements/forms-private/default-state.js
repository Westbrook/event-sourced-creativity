/** Private native-style dirty flag. Defaults remain in markup; live writes never reflect. */
export class DefaultState {
    host;
    attribute;
    read;
    serialize;
    write;
    dirty = false;
    applying = false;
    reflecting = false;
    constructor(host, attribute, read, serialize, write) {
        this.host = host;
        this.attribute = attribute;
        this.read = read;
        this.serialize = serialize;
        this.write = write;
    }
    get value() { return this.read(this.host.getAttribute(this.attribute)); }
    set value(value) {
        const attribute = this.serialize(value);
        this.reflecting = true;
        try {
            if (attribute === null)
                this.host.removeAttribute(this.attribute);
            else
                this.host.setAttribute(this.attribute, attribute);
        }
        finally {
            this.reflecting = false;
        }
        // Lit SSR's attribute-to-property adapter does not run browser callbacks.
        this.attributeChanged();
    }
    markDirty() { if (!this.applying)
        this.dirty = true; }
    attributeChanged() {
        if (this.reflecting)
            return;
        if (!this.dirty)
            this.apply();
        this.host.requestUpdate();
    }
    reset() {
        this.dirty = false;
        this.apply();
    }
    /** Constraint normalization and initialization must not turn pristine state into an edit. */
    apply(value = this.value) {
        const applying = this.applying;
        this.applying = true;
        try {
            this.write(value);
        }
        finally {
            this.applying = applying;
        }
    }
}
