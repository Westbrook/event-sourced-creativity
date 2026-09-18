import "./styles.css";
import "./design-system.css";
import "./responsive-foundation.css";
import "./route-load-recovery.css";
import { installRouteLoadRecovery } from "./route-load-recovery";
import "./components/design-system/locale-bootstrap";
import { applicationIdFromRoute } from "./platform/applications";

const share = location.pathname === "/share" || location.pathname.startsWith("/share/");
const application = applicationIdFromRoute(location.pathname);
const internal = application === "operations" || application === "product" || application === "knowledge" || application === "engineering";
const showLoadRecovery = installRouteLoadRecovery(window, document);
if (share) {
  const root = document.querySelector("forma-shell");
  if (root) root.replaceWith(document.createElement("forma-public-share"));
  void import("./apps/public-share/entry").catch(showLoadRecovery);
} else if (internal) {
  const root = document.querySelector("forma-shell");
  if (root) root.replaceWith(document.createElement("forma-platform-shell"));
  void import("./components/forma-platform-shell").catch(showLoadRecovery);
} else {
  void import("./components/forma-shell").catch(showLoadRecovery);
}

declare global {
  interface HTMLElementTagNameMap {
    "forma-shell": import("./components/forma-shell").FormaShell;
  }
}
