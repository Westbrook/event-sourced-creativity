/** Internal presentation metadata; never changes application-owned open/hidden state. */
export declare const toastQueuedAttribute = "data-en-toast-queued";
export declare const toastStackAttribute = "data-en-toast-stack";
export declare const toastCountAttribute = "data-en-toast-count";
export declare function normalizeToastMax(value: unknown): number;
/** Admission priority is independent of DOM order and live-region urgency. */
export declare function toastWindow<T>(items: readonly T[], max: number, interrupt: (item: T) => boolean, focused?: (item: T) => boolean): Set<T>;
export declare function presentToast(toast: Element, owner: object, queued: boolean, stack: number): void;
export declare function releaseToast(toast: Element, owner: object): void;
