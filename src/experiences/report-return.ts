/** Developer-only navigation. Configuration is build-owned; the query is only a flag. */
export function experienceReportTarget(route: string, configured: unknown): string | null {
  if (typeof configured !== "string" || !configured.trim()) return null;
  try {
    const current = new URL(route, "https://forma.local");
    if (!current.searchParams.has("progress-report")) return null;
    const target = new URL(configured);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return null;
    return target.href;
  } catch { return null; }
}
export function mountExperienceReportReturn(parent: HTMLElement, route: string, configured: unknown) {
  const target = experienceReportTarget(route, configured);
  if (!target) return () => {};
  const container = parent.ownerDocument.createElement("aside");
  container.className = "experience-report-return"; container.setAttribute("aria-label", "Developer tools");
  const link = parent.ownerDocument.createElement("a");
  link.className = "experience-button"; link.textContent = "Progress Report"; link.href = target;
  container.append(link); parent.append(container); parent.classList.add("experience-report-enabled");
  return () => { container.remove(); parent.classList.remove("experience-report-enabled"); };
}
export const configuredExperienceReportUrl = (import.meta as ImportMeta & {
  readonly env?: { readonly VITE_FORMA_PROGRESS_REPORT_URL?: unknown };
}).env?.VITE_FORMA_PROGRESS_REPORT_URL;
