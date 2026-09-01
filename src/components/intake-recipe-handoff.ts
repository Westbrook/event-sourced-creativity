import type { OutcomeRecipeInput, OutcomeRecipeInputSource } from "../model/outcome-recipes";
import { documentIdFromRoute } from "../model/routes";
import { loadRouteComponent } from "../route-loader";
import type { FormaStore } from "../state/store";
import { FormaElement } from "./forma-element";
import type { FormaOutputRequirements } from "./forma-output-requirements";
import type { OutputNavigationFocusLease } from "./output-navigation-focus";

/** One local transfer after confirmed exact-Document navigation. No URL payload,
 * Store queue, saved snapshot, persistence, plan, approval or provider action. */
export async function handoffIntakeRecipe(store: FormaStore, ownerDocument: Document, input: OutcomeRecipeInput,
  target: { projectId: string; documentId: string; actorUserId: string; route: string },
  options: { current: () => boolean; focus: OutputNavigationFocusLease }): Promise<"opened" | "retained" | "existing-draft" | "stale" | "forbidden" | "unavailable"> {
  const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope(), head = store.head.get();
  let owned = true;
  const current = () => {
    const projection = store.projection.get();
    return owned && options.current() && store.sourceOwnershipActive(source) && store.authorizationScopeActive(authorization)
      && store.route.get() === target.route && documentIdFromRoute(target.route) === target.documentId
      && store.session.get()?.user.userId === target.actorUserId && projection.documentId === target.documentId
      && projection.projectId === target.projectId
      && projection.documents.some(document => document.id === target.documentId && document.projectId === target.projectId && !document.removed);
  };
  if (!authorization || !current()) { options.focus.dispose(); return "stale"; }
  // Observe ordinary route/source changes, including A→B→A. This one-shot
  // callback is not a retained draft owner or a new global navigation clock.
  const unsubscribe = store.subscribe(() => { if (!current()) owned = false; });
  try {
    await loadRouteComponent(target.route);
    // Reuse the bounded existing exact-Output handoff's render boundary. An
    // unavailable destination is not permission to fabricate its controller.
    for (let attempt = 0; attempt < 24 && current(); attempt++) {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (!current()) return "stale";
      const controllers = [...ownerDocument.querySelectorAll<FormaOutputRequirements>("forma-output-requirements")]
        .filter(controller => controller.isConnected && FormaElement.hasStoreIdentity(controller, store) && controller.surface === "document" && !controller.blockId
          && !controller.inspectionOnly && controller.documentId === target.documentId
          && Boolean(controller.closest("forma-workspace")));
      if (controllers.length > 1) return "unavailable";
      if (controllers.length === 1) {
        const controller = controllers[0]!;
        await controller.updateComplete;
        if (!current() || store.head.get() !== head) return "stale";
        const binding: OutcomeRecipeInputSource = { projectId: target.projectId, documentId: target.documentId,
          actorUserId: target.actorUserId, authorizationScopeKey: authorization.key, head };
        return await controller.receiveIntakeRecipe(input, binding, { current, opener: null, focus: options.focus });
      }
    }
    return current() ? "unavailable" : "stale";
  } catch { return current() ? "unavailable" : "stale"; }
  finally { unsubscribe(); options.focus.dispose(); }
}
