export interface ChangeDetail<T, Reason extends string = string> {
    readonly previous: T;
    readonly proposed: T;
    readonly reason: Reason;
}
export type ChangeOutcome = 'committed' | 'unchanged' | 'canceled' | 'superseded';
export interface ChangeTransaction<T, Reason extends string = string> extends ChangeDetail<T, Reason> {
    /** Changes on every authoritative author write, including an equal-value write. */
    getRevision: () => number;
    /** Expose provisional model and form state; defer draft, focus and group effects. */
    stage: (proposed: T) => void;
    /** Restore the captured state without calling an author setter or changing its revision. */
    rollback: (previous: T) => void;
    /** Pure validation of constraints that listeners may have changed. */
    canCommit?: (proposed: T) => boolean;
    /** Apply deferred effects after acceptance. Must not repeat staging through an author setter. */
    commit?: (proposed: T) => void;
}
export type ChangeEvent<T, Reason extends string = string> = CustomEvent<ChangeDetail<T, Reason>>;
/**
 * Dispatch one tentative, cancelable semantic change. Native editing is a separate transaction.
 * Author writes and accepted nested transactions win over an older default or rollback.
 * extraDetail supplies compatibility fields; it cannot override previous/proposed/reason.
 */
export declare function dispatchChange<T, Reason extends string = string>(target: EventTarget, change: ChangeTransaction<T, Reason>, options?: {
    eventName?: string;
    extraDetail?: Readonly<Record<string, unknown>>;
}): ChangeOutcome;
export interface ActionDetail<Action extends string, Data = undefined> {
    readonly action: Action;
    readonly data: Data;
}
/** Returns false only when a cancelable action was canceled; does not imply application completion. */
export declare function dispatchAction<Action extends string, Data = undefined>(target: EventTarget, detail: ActionDetail<Action, Data>, { cancelable }?: {
    cancelable?: boolean;
}): boolean;
export interface DraftInputDetail {
    readonly value: string;
    readonly isComposing: boolean;
    readonly inputType: string;
}
export declare function dispatchDraftInput(target: EventTarget, detail: DraftInputDetail): void;
/** A page proposal, exposed tentatively during synchronous dispatch. */
export type PageChangeEvent = ChangeEvent<number, 'pagination'>;
export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';
export interface LoadStateDetail {
    readonly status: LoadStatus;
    readonly requestId: number;
}
export type LoadStateChangeEvent<Detail extends LoadStateDetail = LoadStateDetail> = CustomEvent<Detail>;
/** Report an already-applied state; this notification cannot veto it. */
export declare function dispatchNotification<T extends object>(target: EventTarget, name: string, detail: T): void;
