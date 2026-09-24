import type { ReactiveElement } from 'lit';
/** Private native-style dirty flag. Defaults remain in markup; live writes never reflect. */
export declare class DefaultState<T> {
    private readonly host;
    private readonly attribute;
    private readonly read;
    private readonly serialize;
    private readonly write;
    private dirty;
    private applying;
    private reflecting;
    constructor(host: ReactiveElement, attribute: string, read: (attribute: string | null) => T, serialize: (value: T) => string | null, write: (value: T) => void);
    get value(): T;
    set value(value: T);
    get isDirty(): boolean;
    markDirty(): void;
    attributeChanged(): void;
    reset(): void;
    /** Constraint normalization and initialization must not turn pristine state into an edit. */
    apply(value?: T): void;
}
