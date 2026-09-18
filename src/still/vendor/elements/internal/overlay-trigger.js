import { referenceRoot } from './id-reference.js';
/** Read live identity and availability before and after application callbacks. */
export function eligibleOverlayTrigger(host, id, trigger) {
    return !!(host.isConnected && trigger?.isConnected && referenceRoot(host)?.getElementById(id) === trigger
        && !trigger.disabled && !trigger.loading && !trigger.matches(':disabled,[aria-disabled="true"]'));
}
/** Associated buttons own this click's default, including a submit button in a form. */
export function admitOverlayClick(event, eligible) {
    if (event?.defaultPrevented || !eligible)
        return false;
    event?.preventDefault();
    return true;
}
