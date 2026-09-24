/** A composite owns tab stops, never another element's private control node. */
export interface TabStopLease {
    set(value: 0 | -1): void;
    release(): void;
}
/** Register once from a supported control's constructor. Its ordinary tab stop is zero. */
export declare function registerFocusParticipant(host: HTMLElement, writeTabStop: (value: number) => void): void;
/** Transfer private tab-stop ownership without exposing or querying a shadow tree. */
export declare function claimFocusParticipant(host: HTMLElement): TabStopLease;
