import type { ReactiveController, ReactiveControllerHost } from 'lit';
export type FormValue = string | File | FormData | null;
export type NativeFormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export interface FormValidation {
    flags: ValidityStateFlags;
    message?: string;
    anchor?: HTMLElement;
}
export interface FormOptions {
    internals: ElementInternals;
    control?: () => NativeFormControl | null;
    value: () => FormValue;
    state?: () => FormValue;
    disabled?: () => boolean;
    onReset: () => void;
    onRestore?: (state: FormValue, mode: 'restore' | 'autocomplete') => void;
    validate?: () => FormValidation;
}
/** FACE lifecycle adapter. The host attaches internals and forwards browser form callbacks explicitly. */
export declare class FormController implements ReactiveController {
    #private;
    constructor(host: ReactiveControllerHost, options: FormOptions);
    get disabled(): boolean;
    hostUpdated(): void;
    sync(): void;
    formDisabled(disabled: boolean): void;
    formReset(): void;
    formStateRestore(state: FormValue, mode: 'restore' | 'autocomplete'): void;
}
