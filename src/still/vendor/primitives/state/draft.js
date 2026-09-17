import { Signal } from 'signal-polyfill';
export function createDraftModel(initial = '') {
    const state = new Signal.State(Object.freeze({ value: initial, draft: initial, isComposing: false, dirty: false, revision: 0, deferredAuthorWrite: false }));
    const update = (patch) => {
        const previous = state.get();
        const next = { ...previous, ...patch };
        if (next.value === previous.value && next.draft === previous.draft && next.isComposing === previous.isComposing && next.deferredAuthorWrite === previous.deferredAuthorWrite)
            return false;
        state.set(Object.freeze({ ...next, dirty: next.value !== next.draft, revision: previous.revision + 1 }));
        return true;
    };
    const setValue = (value) => state.get().isComposing
        ? update({ value, deferredAuthorWrite: true })
        : update({ value, draft: value, deferredAuthorWrite: false });
    return {
        value: new Signal.Computed(() => state.get().value),
        draft: new Signal.Computed(() => state.get().draft),
        isComposing: new Signal.Computed(() => state.get().isComposing),
        hasDeferredValue: new Signal.Computed(() => state.get().deferredAuthorWrite),
        view: new Signal.Computed(() => {
            const { deferredAuthorWrite: _, ...snapshot } = state.get();
            return Object.freeze(snapshot);
        }),
        setValue,
        stageValue: (value) => update({ value }),
        setDraft: (draft) => update({ draft }),
        startComposition: () => update({ isComposing: true }),
        endComposition: (finalDraft) => {
            const current = state.get();
            return update({
                draft: current.deferredAuthorWrite ? current.value : finalDraft ?? current.draft,
                isComposing: false,
                deferredAuthorWrite: false,
            });
        },
        acceptDraft: () => state.get().isComposing ? false : setValue(state.get().draft),
        reset: () => setValue(initial),
    };
}
