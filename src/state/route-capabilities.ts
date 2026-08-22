import type { EventProfile } from "../model/event-profiles";

export type RouteCapabilities = {
  profile: EventProfile;
  privateContent: boolean;
  jobHistory: boolean;
};

/** Keep startup work proportional to the information the active surface actually renders. */
export function routeCapabilities(path: string): RouteCapabilities {
  const pathname = path.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/";

  if (pathname === "/projects" || pathname.startsWith("/projects/") || pathname === "/creative") {
    return { profile: "projects", privateContent: false, jobHistory: false };
  }
  if (pathname === "/memory" || pathname.startsWith("/memory/")) {
    return { profile: "memory", privateContent: true, jobHistory: false };
  }
  if (pathname === "/scout" || pathname.startsWith("/scout/")) {
    return { profile: "scout", privateContent: false, jobHistory: false };
  }
  if (pathname === "/sessions" || pathname.startsWith("/sessions/")) {
    return { profile: "sessions", privateContent: false, jobHistory: false };
  }
  if (pathname === "/settings") {
    return { profile: "sessions", privateContent: false, jobHistory: false };
  }
  if (["/operations/events", "/operations/events/stream", "/admin/events", "/admin/events/stream"].includes(pathname)) {
    return { profile: "projects", privateContent: false, jobHistory: false };
  }
  if (["/operations", "/system", "/operations/events/sync", "/admin/events/sync"].includes(pathname)) {
    return { profile: "sessions", privateContent: false, jobHistory: false };
  }
  if ([
    "/operations/analytics", "/operations/canvas", "/operations/events/permissions",
    "/admin/events/permissions", "/laboratory", "/laboratory/replay",
    "/admin/events/replay", "/laboratory/image-adapters",
  ].includes(pathname)) {
    return { profile: "projects", privateContent: false, jobHistory: false };
  }
  if (["/laboratory/focal-points", "/system/focal-points", "/laboratory/design-system"].includes(pathname)) {
    return { profile: "workspace", privateContent: false, jobHistory: false };
  }
  if (pathname === "/share" || pathname.startsWith("/share/")) {
    return { profile: "projects", privateContent: false, jobHistory: false };
  }
  const canvas = pathname === "/canvas" || pathname.startsWith("/canvas/");
  const library = pathname === "/library" || pathname.startsWith("/library/");
  const projectContents = pathname === "/studio/project" || pathname.startsWith("/studio/project/");
  return { profile: "workspace", privateContent: !projectContents, jobHistory: canvas || library || !projectContents };
}
