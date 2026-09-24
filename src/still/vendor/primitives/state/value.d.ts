import { Signal } from 'signal-polyfill';
export interface ValueSnapshot<T> {
    readonly value: T;
    readonly revision: number;
}
export interface ValueModel<T> {
    readonly value: Signal.Computed<T>;
    readonly view: Signal.Computed<ValueSnapshot<T>>;
    set(value: T): boolean;
    reset(): boolean;
}
export interface ValueOptions<T> {
    equals?: (previous: T, next: T) => boolean;
    normalize?: (value: T) => T;
}
/** An explicit value and revision; neither the initial value nor later values are cloned. */
export declare function createValueModel<T>(initial: T, options?: ValueOptions<T>): ValueModel<T>;
