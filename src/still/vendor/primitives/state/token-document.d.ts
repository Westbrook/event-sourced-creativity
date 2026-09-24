import { type ChatEditorData } from '../interactions/chat-editor.js';
export type Run = {
    kind: 'text';
    text: string;
} | {
    kind: 'token';
    id: string;
    type: string;
    text: string;
    label: string;
    data: ChatEditorData;
};
export interface DocumentValue {
    version: 1;
    runs: readonly Run[];
}
export interface Selection {
    anchor: number;
    focus: number;
}
export declare class EditorDocument extends EventTarget {
    private state;
    private authorRevision;
    private revisionValue;
    private past;
    private future;
    constructor(runs?: readonly Run[]);
    get document(): DocumentValue;
    get value(): string;
    get selection(): Selection;
    get revision(): number;
    get canUndo(): boolean;
    get canRedo(): boolean;
    snapshot(): import("../interactions/chat-editor.js").ChatEditorSnapshot;
    /** Authoritative reset invalidates async targets and history, even for equal content. */
    reset(runs: readonly Run[]): void;
    private boundaries;
    private snap;
    select(selection: Selection): void;
    private slice;
    replace(insert: readonly Run[], expectedRevision?: number): "stale" | import("../interactions/events.js").ChangeOutcome;
    delete(direction: 'backward' | 'forward'): import("../interactions/events.js").ChangeOutcome;
    undo(): import("../interactions/events.js").ChangeOutcome;
    redo(): import("../interactions/events.js").ChangeOutcome;
    /** Record browser editing without rewriting its active DOM. */
    apply(runs: readonly Run[], selection: Selection): import("../interactions/events.js").ChangeOutcome;
    private change;
}
