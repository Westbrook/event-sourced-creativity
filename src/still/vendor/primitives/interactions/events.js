// Only live dispatch stacks need an epoch. Weak keys also avoid retaining hosts.
const transactions = new WeakMap();
function customEvent(target, name, detail, cancelable) {
    // Use the target document's realm when dispatching into another document or an iframe.
    const view = target.ownerDocument?.defaultView;
    const Constructor = view?.CustomEvent ?? globalThis.CustomEvent;
    return new Constructor(name, { detail, bubbles: true, composed: true, cancelable });
}
/**
 * Dispatch one tentative, cancelable semantic change. Native editing is a separate transaction.
 * Author writes and accepted nested transactions win over an older default or rollback.
 */
export function dispatchChange(target, change, options = {}) {
    if (Object.is(change.previous, change.proposed))
        return 'unchanged';
    const detail = Object.freeze({ previous: change.previous, proposed: change.proposed, reason: change.reason });
    const event = customEvent(target, options.eventName ?? 'en-change', detail, true);
    const frame = {
        authorRevision: change.getRevision(),
        acceptedEpoch: transactions.get(target)?.acceptedEpoch ?? 0,
    };
    let context = transactions.get(target);
    if (!context) {
        context = { acceptedEpoch: 0, frames: [] };
        transactions.set(target, context);
    }
    const state = context;
    state.frames.push(frame);
    let settled = false;
    const stillOwnsStage = () => state.frames[state.frames.length - 1] === frame &&
        change.getRevision() === frame.authorRevision &&
        state.acceptedEpoch === frame.acceptedEpoch;
    const rollback = () => {
        // Mark first: a throwing rollback must not be invoked a second time by catch.
        settled = true;
        change.rollback(change.previous);
    };
    try {
        change.stage(change.proposed);
        if (!stillOwnsStage()) {
            settled = true;
            return 'superseded';
        }
        const allowed = target.dispatchEvent(event);
        if (!stillOwnsStage()) {
            settled = true;
            return 'superseded';
        }
        if (!allowed) {
            rollback();
            return 'canceled';
        }
        const valid = change.canCommit?.(change.proposed) ?? true;
        if (!valid)
            event.preventDefault();
        if (!stillOwnsStage()) {
            settled = true;
            return 'superseded';
        }
        if (!valid) {
            rollback();
            return 'canceled';
        }
        // Acceptance is the boundary before deferred effects. It supersedes any outer
        // transaction even when there is no commit callback, or a deferred effect throws.
        state.acceptedEpoch += 1;
        const acceptedEpoch = state.acceptedEpoch;
        settled = true;
        change.commit?.(change.proposed);
        if (change.getRevision() !== frame.authorRevision || state.acceptedEpoch !== acceptedEpoch)
            return 'superseded';
        return 'committed';
    }
    catch (error) {
        if (!settled && stillOwnsStage()) {
            try {
                rollback();
            }
            catch (rollbackError) {
                throw new AggregateError([error, rollbackError], 'Change transaction and its rollback both failed.');
            }
        }
        throw error;
    }
    finally {
        state.frames.pop();
        if (state.frames.length === 0)
            transactions.delete(target);
    }
}
/** Returns false only when a cancelable action was canceled; does not imply application completion. */
export function dispatchAction(target, detail, { cancelable = false } = {}) {
    return target.dispatchEvent(customEvent(target, 'en-action', Object.freeze({ ...detail }), cancelable));
}
export function dispatchDraftInput(target, detail) {
    target.dispatchEvent(customEvent(target, 'en-input', Object.freeze({ ...detail }), false));
}
