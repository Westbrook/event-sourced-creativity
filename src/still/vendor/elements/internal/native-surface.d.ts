/** Private native surfaces alone own this inert state; authored children stay untouched. */
export declare function setNativeSurfaceOpen(surface: HTMLElement, open: boolean): void;
/**
 * Native close/focus steps run synchronously after beforetoggle. Apply inert only
 * after those steps, then consult actual state so a same-turn reopen wins. There
 * is no transition listener, timeout, delayed modality or animation completion.
 */
export declare function nativeSurfaceBeforeToggle(event: ToggleEvent): void;
