import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { DraftModel } from '../state/draft.js';
import type { DraftInputDetail } from './events.js';
export type EditableControl = HTMLInputElement | HTMLTextAreaElement;
export type EditCommitReason = 'input' | 'compositionend' | 'change' | 'hydrate';
export interface EditingOptions {
    model: DraftModel;
    control: () => EditableControl | null;
    onInput?: (detail: DraftInputDetail) => void;
    onCommit?: (value: string, reason: EditCommitReason) => void;
    /** Defaults to detecting a live value changed from the native default. */
    adoptInitialValue?: (control: EditableControl) => boolean;
}
/** Native editing bridge. Templates must not independently bind the editable value. */
export declare class EditingController implements ReactiveController {
    #private;
    constructor(host: ReactiveControllerHost & EventTarget, options: EditingOptions);
    hostConnected(): void;
    hostUpdated(): void;
    hostDisconnected(): void;
    /** Reconcile an explicit accepted-value write without touching active native composition. */
    sync(): void;
}
