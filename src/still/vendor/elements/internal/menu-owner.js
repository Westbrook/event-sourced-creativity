const owners = new WeakMap();
export function ownMenuItem(item, owner) {
    owners.set(item, owner);
    return () => { if (owners.get(item) === owner)
        owners.delete(item); };
}
export function menuItemOwner(item) { return owners.get(item); }
const checks = new WeakMap();
export function registerMenuCheckState(element, state) { checks.set(element, state); }
export function menuCheckState(element) { return checks.get(element); }
