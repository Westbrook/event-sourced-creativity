import "./styles.css";
import "./design-system.css";
import "./components/forma-shell";

declare global {
  interface HTMLElementTagNameMap {
    "forma-shell": import("./components/forma-shell").FormaShell;
  }
}
