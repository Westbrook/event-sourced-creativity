import { documentContextBlockFromRoute, documentIdFromRoute } from "../model/routes";
import type { FormaStore } from "../state/store";

/** A single opening gesture's DOM-focus ownership, never source or action authority. */
export type OutputNavigationFocusLease = {
  current(): boolean;
  run(target: HTMLElement, action: () => boolean): boolean;
  dispose(): void;
};

export function captureOutputNavigationFocus(
  ownerDocument: Document,
  options: { ownedRouteFocus?: (element: Element) => boolean } = {},
): OutputNavigationFocusLease {
  let owner: Document | null = ownerDocument;
  let initial: Element | null = ownerDocument.activeElement;
  let ownedRouteFocus = options.ownedRouteFocus;
  let synchronousTarget: Element | null = null;
  let closed = false;
  const dispose = () => {
    if (closed) return;
    closed = true;
    owner?.removeEventListener("pointerdown", interrupt, true);
    owner?.removeEventListener("keydown", interrupt, true);
    owner?.removeEventListener("focusin", focusChanged, true);
    owner = null;
    initial = null;
    synchronousTarget = null;
    ownedRouteFocus = undefined;
  };
  const allowed = (element: Element | null, unchanged = false) => !element || !element.isConnected
    || element === owner?.body || element === owner?.documentElement
    || unchanged && element === initial || element === synchronousTarget || Boolean(ownedRouteFocus?.(element));
  const current = () => {
    if (closed) return false;
    try { if (allowed(owner!.activeElement, true)) return true; } catch { /* A withdrawn owner cannot restore focus. */ }
    dispose();
    return false;
  };
  function interrupt() { dispose(); }
  function focusChanged(event: Event) {
    if (closed) return;
    try { if (allowed(event.target as Element | null)) return; } catch { /* Same fail-closed ownership rule. */ }
    dispose();
  }
  ownerDocument.addEventListener("pointerdown", interrupt, true);
  ownerDocument.addEventListener("keydown", interrupt, true);
  ownerDocument.addEventListener("focusin", focusChanged, true);
  return {
    current,
    run(target, action) {
      if (!current() || !target.isConnected) return false;
      const previous = synchronousTarget;
      synchronousTarget = target;
      try { return current() && action() && current(); }
      finally { synchronousTarget = closed ? null : previous; }
    },
    dispose,
  };
}

/** Only the actual linked native block anchor may focus as part of this route. */
type NativeBlockFocusOwner = HTMLElement & {
  readonly store: FormaStore;
  readonly block: { id: string; documentId: string };
  readonly surface: string;
};

export function outputNavigationOwnedRouteFocus(
  ownerDocument: Document,
  store: FormaStore,
  reference: { documentId: string; blockId: string | null },
  current: () => boolean,
): (element: Element) => boolean {
  return (element) => {
    if (!current() || !reference.blockId || !element.isConnected
      || documentIdFromRoute(store.route.get()) !== reference.documentId
      || documentContextBlockFromRoute(store.route.get()) !== reference.blockId
      || element.tagName !== "ARTICLE" || element.getAttribute("data-block-id") !== reference.blockId) return false;
    const owners = [...ownerDocument.querySelectorAll<NativeBlockFocusOwner>("forma-context-block")].filter((candidate) => candidate.isConnected
      && candidate.store === store && candidate.block?.id === reference.blockId
      && candidate.block.documentId === reference.documentId && candidate.surface === "document");
    if (owners.length !== 1) return false;
    const anchors = [...owners[0].querySelectorAll<HTMLElement>("[data-block-id]")].filter((candidate) =>
      candidate.getAttribute("data-block-id") === reference.blockId && candidate.tagName === "ARTICLE"
      && candidate.closest<HTMLElement>("forma-context-block") === owners[0]);
    return anchors.length === 1 && anchors[0] === element;
  };
}
