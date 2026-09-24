import { createContext } from '@lit/context';
/** Missing local fields inherit from the nearest provider, then built-in defaults. */
export const editorMessagesContext = createContext('../editor-messages/v1');
export const colorMessagesContext = createContext('../color-messages/v1');
/** Merge only defined fields; empty strings remain intentional overrides. */
export function mergeMessageOverrides(context, local) {
    if (!context)
        return local;
    if (!local)
        return context;
    const merged = { ...context };
    for (const [key, value] of Object.entries(local)) {
        if (value === undefined || value === null)
            continue;
        merged[key] = typeof value === 'object' && !Array.isArray(value)
            ? mergeMessageOverrides(Reflect.get(context, key), value) : value;
    }
    return merged;
}
