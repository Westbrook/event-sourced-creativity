import { Signal } from 'signal-polyfill';
/** An explicit value and revision; neither the initial value nor later values are cloned. */
export function createValueModel(initial, options = {}) {
    const normalize = options.normalize ?? ((value) => value);
    const equals = options.equals ?? Object.is;
    const defaultValue = normalize(initial);
    const state = new Signal.State(Object.freeze({ value: defaultValue, revision: 0 }));
    const set = (value) => {
        const next = normalize(value);
        const previous = state.get();
        if (equals(previous.value, next))
            return false;
        state.set(Object.freeze({ value: next, revision: previous.revision + 1 }));
        return true;
    };
    return {
        value: new Signal.Computed(() => state.get().value),
        view: new Signal.Computed(() => state.get()),
        set,
        reset: () => set(defaultValue),
    };
}
