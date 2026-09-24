import type { ReactiveElement } from 'lit';
import type { FormValidation } from '../../primitives/interactions/form-controller.js';
/** Application errors invalidate; translated constraint messages only describe existing failures. */
export declare function applicationValidation(validation: FormValidation, error: string): FormValidation;
/** Shared presentation state for choice controls without a native editing draft. */
export declare class ValidationFeedback {
    private readonly host;
    private readonly sync;
    private readonly constraintMessage;
    private message;
    private shown;
    constructor(host: ReactiveElement, sync: () => void, constraintMessage: () => string);
    get error(): string;
    set error(value: string);
    get visible(): string;
    reset(): void;
}
