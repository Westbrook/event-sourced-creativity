import { html } from "lit";
import { hasExperienceHostSelector } from "../../experiences/host-route.ts";
import { FormaElement } from "../../components/forma-element";
import { documentViewFromRoute, routePathname } from "../../model/routes";
import { isSelectedOutputSharePagePath } from "../../model/selected-output-share-routes.ts";

export function loadCreativeRoute(path: string): Promise<unknown> {
  if (hasExperienceHostSelector(path)) return import("../../components/forma-experience-host");
  const pathname=routePathname(path);
  const documentView = documentViewFromRoute(path);
  if (["/make/short-story", "/make/scene", "/make/slides", "/make/storyboard", "/make/model3d", "/make/audio", "/make/video"].includes(pathname)) return import("../../components/forma-retained-short-story");
  if (isSelectedOutputSharePagePath(pathname)) return import("../../components/forma-selected-output-shared-view");
  if (pathname === "/share" || pathname.startsWith("/share/")) return import("../../components/forma-shared-view");
  if (pathname.startsWith("/projects") || pathname === "/creative") return import("../../components/forma-projects");
  if (pathname.startsWith("/studio/project")) return import("../../components/forma-project-contents");
  if (documentView === "board" || documentView === "guided") return import("../../components/forma-studio-alternatives");
  if (documentView === "layers" || documentView === "adaptive") return import("../../components/forma-studio-editor-alternatives");
  if (documentView === "editor") return import("../../components/forma-creative-editor");
  if (documentView === "chat") return import("../../components/forma-chat-studio");
  if (pathname === "/activity" || pathname.startsWith("/activity/")) return import("../../components/forma-activity");
  if (pathname === "/deliver" || pathname.startsWith("/deliver/")) return import("../../components/forma-deliver");
  if (pathname.startsWith("/library")) return import("../../components/forma-library");
  if (pathname.startsWith("/sessions")) return import("../../components/forma-sessions");
  if (pathname.startsWith("/scout")) return import("../../components/forma-scout");
  if (pathname.startsWith("/memory")) return import("../../components/forma-memory");
  if(pathname==="/settings/workspaces"||pathname.startsWith("/settings/workspaces/"))return import("../../components/forma-workspace-settings");
  if (pathname === "/settings") return import("../../components/forma-account-settings");
  return import("../../components/forma-workspace");
}

export class FormaCreativeApplication extends FormaElement {
  override render() {
    const path = this.store.route.get();const pathname=routePathname(path);const documentView=documentViewFromRoute(path);
    if (hasExperienceHostSelector(path)) return html`<forma-experience-host></forma-experience-host>`;
    if(["/make/short-story", "/make/scene", "/make/slides", "/make/storyboard", "/make/model3d", "/make/audio", "/make/video"].includes(pathname)) return html`<forma-retained-short-story></forma-retained-short-story>`;
    if(pathname.startsWith("/projects")||pathname==="/creative")return html`<forma-projects></forma-projects>`;
    if(pathname.startsWith("/studio/project"))return html`<forma-project-contents></forma-project-contents>`;
    if(documentView==="board")return html`<forma-context-board></forma-context-board>`;
    if(documentView==="guided")return html`<forma-guided-brief></forma-guided-brief>`;
    if(documentView==="layers")return html`<forma-reality-layers></forma-reality-layers>`;
    if(documentView==="adaptive")return html`<forma-adaptive-path></forma-adaptive-path>`;
    if(documentView==="editor")return html`<forma-creative-editor></forma-creative-editor>`;
    if(documentView==="chat")return html`<forma-chat-studio></forma-chat-studio>`;
    if(pathname==="/activity"||pathname.startsWith("/activity/"))return html`<forma-activity></forma-activity>`;
    if(pathname==="/deliver"||pathname.startsWith("/deliver/"))return html`<forma-deliver></forma-deliver>`;
    if(pathname.startsWith("/library"))return html`<forma-library></forma-library>`;
    if(pathname.startsWith("/sessions"))return html`<forma-sessions></forma-sessions>`;
    if(pathname.startsWith("/scout"))return html`<forma-scout></forma-scout>`;
    if(pathname.startsWith("/memory"))return html`<forma-memory></forma-memory>`;
    if(pathname==="/settings/workspaces"||pathname.startsWith("/settings/workspaces/"))return html`<forma-workspace-settings></forma-workspace-settings>`;
    if(pathname==="/settings")return html`<forma-account-settings></forma-account-settings>`;
    return html`<forma-workspace></forma-workspace>`;
  }
}

if(!customElements.get("forma-creative-application"))customElements.define("forma-creative-application",FormaCreativeApplication);
