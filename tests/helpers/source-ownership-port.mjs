import assert from "node:assert/strict";

// A native/test Store port only. Full Store source-denial tests exercise the real
// implementation separately; this keeps older partial-host fixtures faithful to
// the branded owner / generation contract rather than bypassing its callbacks.
export function installSourceOwnershipPort(store) {
  assert.equal(typeof store.captureAuthorizationScope, "function");
  const owners = new WeakSet(); let generation = 0, retired = false;
  const captureSourceOwnership = () => {
    const authorization = store.captureAuthorizationScope();
    if (!authorization) return null;
    const source = Object.freeze({ authorization: Object.freeze({ ...authorization }), generation });
    owners.add(source); return source;
  };
  const sourceOwnershipScopeActive = source => {
    const current = store.captureAuthorizationScope();
    return Boolean(source && owners.has(source) && current && source.authorization.key === current.key
      && Boolean(source.authorization.shared) === Boolean(current.shared)
      && (typeof store.authorizationScopeActive !== "function" || store.authorizationScopeActive(source.authorization)));
  };
  const sourceOwnershipActive = source => sourceOwnershipScopeActive(source) && source.generation === generation && !retired;
  Object.assign(store, { captureSourceOwnership, sourceOwnershipActive, sourceOwnershipScopeActive });
  return { retire() { const source = captureSourceOwnership(); retired = true; generation++; return { source, generation }; },
    restore() { retired = false; }, captureSourceOwnership, sourceOwnershipActive, sourceOwnershipScopeActive };
}
