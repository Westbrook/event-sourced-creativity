/** Internal presentation metadata; never changes application-owned open/hidden state. */
export const toastQueuedAttribute = 'data-en-toast-queued';
export const toastStackAttribute = 'data-en-toast-stack';
export const toastCountAttribute = 'data-en-toast-count';
export function normalizeToastMax(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
}
/** Admission priority is independent of DOM order and live-region urgency. */
export function toastWindow(items, max, interrupt, focused) {
    const limit = normalizeToastMax(max);
    if (!limit || items.length <= limit)
        return new Set(items);
    const engaged = focused ? items.filter(focused) : [];
    const candidates = [...engaged, ...items.filter(interrupt), ...items];
    return new Set([...new Set(candidates)].slice(0, limit));
}
const owners = new WeakMap();
export function presentToast(toast, owner, queued, stack) {
    owners.set(toast, owner);
    toast.toggleAttribute(toastQueuedAttribute, queued);
    if (stack)
        toast.setAttribute(toastStackAttribute, String(Math.min(stack, 2)));
    else
        toast.removeAttribute(toastStackAttribute);
}
export function releaseToast(toast, owner) {
    if (owners.get(toast) !== owner)
        return;
    owners.delete(toast);
    toast.removeAttribute(toastQueuedAttribute);
    toast.removeAttribute(toastStackAttribute);
}
