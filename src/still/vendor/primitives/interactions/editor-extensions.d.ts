/** Editor-independent trigger matching and registration. No document offsets escape this layer. */
export interface EditorTriggerDefinition {
    id: string;
    trigger: string;
    match?(textBeforeCaret: string): {
        from: number;
        query: string;
    } | undefined;
}
export declare class EditorExtensionRegistry<T extends EditorTriggerDefinition> {
    private changed;
    private entries;
    constructor(changed?: (previous: T | undefined) => void);
    register(extension: T): () => void;
    get(id: string): T | undefined;
    has(id: string): boolean;
    match(before: string): {
        extension: T;
        from: number;
        query: string;
    } | undefined;
}
/** One cancellable provider operation per editor. Late results and rejections are ignored. */
export declare class EditorQueryTask {
    private controller?;
    start<T>(query: string, provide: (context: {
        query: string;
        signal: AbortSignal;
    }) => T | Promise<T>, accept: (value: T) => void, reject: () => void, controller?: AbortController): AbortController;
    cancel(): void;
}
/** Opaque revision-bound editor selection. The backend retains its actual selection data. */
export interface EditorBookmark {
    readonly revision: number;
}
export declare class EditorBookmarks<T> {
    private selections;
    capture(revision: number, selection: T): EditorBookmark;
    resolve(bookmark: EditorBookmark, revision: number): T | undefined;
}
/** Picker matcher for known multiword command aliases. Literal paths, URLs and escaped sigils stay text. */
export declare function createEditorCommandMatcher(aliases: readonly string[], trigger?: string): (before: string) => {
    from: number;
    query: string;
} | undefined;
