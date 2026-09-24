import { Signal } from 'signal-polyfill';
export interface DraftSnapshot {
    /** Application-accepted value. */
    readonly value: string;
    /** Native editing value, which may differ from the accepted value. */
    readonly draft: string;
    readonly isComposing: boolean;
    readonly dirty: boolean;
    readonly revision: number;
}
export interface DraftModel {
    readonly value: Signal.Computed<string>;
    readonly draft: Signal.Computed<string>;
    readonly isComposing: Signal.Computed<boolean>;
    /** An authoritative write is waiting for native composition to finish. */
    readonly hasDeferredValue: Signal.Computed<boolean>;
    readonly view: Signal.Computed<DraftSnapshot>;
    /** Even a same-value write explicitly reconciles a rejected draft; during IME reconciliation is deferred. */
    setValue(value: string): boolean;
    /** Expose tentative accepted state without reconciling the native draft or deferred IME write. */
    stageValue(value: string): boolean;
    setDraft(draft: string): boolean;
    startComposition(): boolean;
    endComposition(finalDraft?: string): boolean;
    /** No accepted-state change is allowed through this method while composition is active. */
    acceptDraft(): boolean;
    /** Reset is authoritative and therefore preserves active composition until its end. */
    reset(): boolean;
}
export declare function createDraftModel(initial?: string): DraftModel;
