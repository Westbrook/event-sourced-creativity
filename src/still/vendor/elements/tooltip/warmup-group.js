/** Pointer coordination is allocated only for a live, resolved group element. */
const groups = new WeakMap();
class TooltipWarmupGroup {
    #members = new Map();
    #focused = new Set();
    #active = new Set();
    #warm = false;
    #cooldown;
    get warm() { return this.#warm; }
    join(member, handoff, focused, resume) {
        this.#members.set(member, { handoff, focused, resume });
    }
    hasFocusedPeer(source) {
        return [...this.#members].some(([member, callbacks]) => member !== source && callbacks.focused());
    }
    focus(member, active) {
        if (active === this.#focused.has(member))
            return;
        if (active) {
            this.#focused.add(member);
            const source = this.#members.get(member);
            for (const [peer, callbacks] of [...this.#members]) {
                if (!source?.focused())
                    break;
                if (peer !== member && this.#members.get(peer) === callbacks)
                    callbacks.handoff(true);
            }
        }
        else {
            this.#focused.delete(member);
            // Membership can change from inside a peer's reconciliation or en-change.
            queueMicrotask(() => {
                for (const [peer, callbacks] of [...this.#members]) {
                    if (!this.hasFocusedPeer(peer))
                        callbacks.resume();
                }
            });
        }
    }
    leave(member) {
        this.focus(member, false);
        this.#members.delete(member);
        this.activity(member, false);
        if (!this.#members.size)
            this.cool();
    }
    activity(member, active) {
        if (active && this.#members.has(member))
            this.#active.add(member);
        else
            this.#active.delete(member);
        if (this.#active.size) {
            clearTimeout(this.#cooldown);
            this.#cooldown = undefined;
        }
        else if (this.#warm && this.#cooldown === undefined) {
            this.#cooldown = setTimeout(() => this.cool(), 500);
        }
    }
    markWarm(source, stillPresented) {
        this.#warm = true;
        // An accepted opening may have completed after the pointer left.
        this.activity(this, false);
        // A peer close listener may synchronously cancel, rebind or close the new help.
        for (const [member, callbacks] of [...this.#members]) {
            if (!stillPresented())
                break;
            if (member !== source && this.#members.get(member) === callbacks)
                callbacks.handoff(false);
        }
    }
    cool() {
        this.#warm = false;
        clearTimeout(this.#cooldown);
        this.#cooldown = undefined;
    }
}
export function tooltipWarmupGroup(element) {
    let group = groups.get(element);
    if (!group)
        groups.set(element, group = new TooltipWarmupGroup());
    return group;
}
