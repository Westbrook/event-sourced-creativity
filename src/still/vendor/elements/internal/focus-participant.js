const participants = new WeakMap();
const nativeOwners = new WeakMap();
/** Register once from a supported control's constructor. Its ordinary tab stop is zero. */
export function registerFocusParticipant(host, writeTabStop) {
    participants.set(host, { write: writeTabStop });
}
/** Transfer private tab-stop ownership without exposing or querying a shadow tree. */
export function claimFocusParticipant(host) {
    const participant = participants.get(host);
    if (participant) {
        const owner = {};
        participant.owner = owner;
        return {
            set(value) { if (participant.owner === owner)
                participant.write(value); },
            release() {
                if (participant.owner !== owner)
                    return;
                participant.owner = undefined;
                participant.write(0);
            },
        };
    }
    const prior = nativeOwners.get(host);
    const current = host.getAttribute('tabindex');
    const ownership = {
        owner: {},
        original: prior?.last === current ? prior.original : current,
    };
    nativeOwners.set(host, ownership);
    let active = true;
    return {
        set(value) {
            if (!active || nativeOwners.get(host) !== ownership)
                return;
            if (ownership.last !== undefined && host.getAttribute('tabindex') !== ownership.last) {
                // An explicit author mutation releases this lease; unrelated updates
                // must not silently take the tab stop back.
                active = false;
                nativeOwners.delete(host);
                return;
            }
            ownership.last = String(value);
            if (host.getAttribute('tabindex') !== ownership.last)
                host.setAttribute('tabindex', ownership.last);
        },
        release() {
            if (!active || nativeOwners.get(host) !== ownership)
                return;
            active = false;
            nativeOwners.delete(host);
            // A different author value takes precedence over this controller's cleanup.
            if (ownership.last === undefined || host.getAttribute('tabindex') !== ownership.last)
                return;
            if (ownership.original === null)
                host.removeAttribute('tabindex');
            else
                host.setAttribute('tabindex', ownership.original);
        },
    };
}
