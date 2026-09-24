import { nothing, type TemplateResult } from 'lit';
export interface DialogView {
    kind?: 'dialog' | 'alertdialog';
    description?: string;
    /** Internal composition hooks; undefined retains the authored slots. */
    body?: TemplateResult;
    footer?: TemplateResult | typeof nothing;
    surfacePart?: string;
    surfaceClass: string;
    placement: string;
    label: string;
    closeLabel: string;
    dismissible: boolean;
    closedBy: string;
    cancel: (event: Event) => void;
    close: () => void;
    dismiss: () => void;
    pointerDown: (event: PointerEvent) => void;
    pointerUp: (event: PointerEvent) => void;
    pointerCancel: () => void;
    keyDown: (event: KeyboardEvent) => void;
}
/** Shared native modal markup. All state transitions are supplied by its adapter. */
export declare function dialogTemplate(view: DialogView): TemplateResult<1>;
