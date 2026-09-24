import type { ReactiveController, ReactiveControllerHost } from 'lit';
/** Internal renderer/controller protocol; survives semantics-preserving CSS minification. */
export declare const STATIC_STYLES_ATTRIBUTE = "data-en-static-styles";
export declare const STATIC_STYLES_VERSION = "v1";
type Host = HTMLElement & ReactiveControllerHost & {
    readonly renderRoot?: HTMLElement | DocumentFragment;
};
/** Restore native Lit static-sheet sharing only after the existing root hydrates. */
export declare class StaticStylesController implements ReactiveController {
    #private;
    constructor(host: Host);
    hostConnected(): void;
    hostUpdated(): void;
}
export {};
