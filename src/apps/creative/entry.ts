import { html } from "lit";
import { FormaElement } from "../../components/forma-element";
import { documentViewFromRoute, routePathname } from "../../model/routes";

export function loadCreativeRoute(path: string): Promise<unknown> {
  const pathname=routePathname(path);
  const documentView = documentViewFromRoute(path);
  if (pathname === "/share" || pathname.startsWith("/share/")) return import("../../components/forma-shared-view");
  if (pathname.startsWith("/projects") || pathname === "/creative") return import("../../components/forma-projects");
  if (pathname.startsWith("/studio/project")) return import("../../components/forma-project-contents");
  if (documentView === "board" || documentView === "guided") return import("../../components/forma-studio-alternatives");
  if (documentView === "layers" || documentView === "adaptive") return import("../../components/forma-studio-editor-alternatives");
  if (documentView === "editor") return import("../../components/forma-creative-editor");
  if (documentView === "chat") return import("../../components/forma-chat-studio");
  if (pathname.startsWith("/library")) return import("../../components/forma-library");
  if (pathname.startsWith("/sessions")) return import("../../components/forma-sessions");
  if (pathname.startsWith("/scout")) return import("../../components/forma-scout");
  if (pathname.startsWith("/memory")) return import("../../components/forma-memory");
  return import("../../components/forma-workspace");
}

export class FormaCreativeApplication extends FormaElement {
  override render() {
    const path = this.store.route.get();const pathname=routePathname(path);const documentView=documentViewFromRoute(path);
    if(pathname.startsWith("/projects")||pathname==="/creative")return html`<forma-projects></forma-projects>`;
    if(pathname.startsWith("/studio/project"))return html`<forma-project-contents></forma-project-contents>`;
    if(documentView==="board")return html`<forma-context-board></forma-context-board>`;
    if(documentView==="guided")return html`<forma-guided-brief></forma-guided-brief>`;
    if(documentView==="layers")return html`<forma-reality-layers></forma-reality-layers>`;
    if(documentView==="adaptive")return html`<forma-adaptive-path></forma-adaptive-path>`;
    if(documentView==="editor")return html`<forma-creative-editor></forma-creative-editor>`;
    if(documentView==="chat")return html`<forma-chat-studio></forma-chat-studio>`;
    if(pathname.startsWith("/library"))return html`<forma-library></forma-library>`;
    if(pathname.startsWith("/sessions"))return html`<forma-sessions></forma-sessions>`;
    if(pathname.startsWith("/scout"))return html`<forma-scout></forma-scout>`;
    if(pathname.startsWith("/memory"))return html`<forma-memory></forma-memory>`;
    return html`<forma-workspace></forma-workspace>`;
  }
}

if(!customElements.get("forma-creative-application"))customElements.define("forma-creative-application",FormaCreativeApplication);
