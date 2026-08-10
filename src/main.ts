import "./styles.css";
import "./components/forma-shell";

declare global {
  interface HTMLElementTagNameMap {
    "forma-shell": import("./components/forma-shell").FormaShell;
  }
}
