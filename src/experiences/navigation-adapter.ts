import type { ExperienceDisplayPort } from "./display-locale.ts";
import { experienceHostRoute } from "./host-route.ts";
import type { ExperienceNativeHostAdapter } from "./native-host.ts";

/** Navigation only. The private canonical host independently re-reads receipt,
 * current source and custody before exposing a separate explicit Create action. */
export function experienceNavigationAdapter(currentRoute: string, display?: ExperienceDisplayPort): ExperienceNativeHostAdapter {
  return Object.freeze({
    async mount(target, context, signal) {
      const output = context.plan.release.output.output;
      if (output !== "image" && output !== "slides" && output !== "short_story" && output !== "scene" && output !== "storyboard" && output !== "audio" && output !== "model3d" && output !== "video") throw new Error("experience_output_unsupported");
      const current = new URL(currentRoute, "https://forma.local"), document = new URL(context.receipt.documentRoute, "https://forma.local");
      const returns = current.searchParams.getAll("progress-report");
      if (returns.length > 1) throw new TypeError("experience_route_invalid");
      if (returns.length) document.searchParams.set("progress-report", returns[0]);
      const route = experienceHostRoute(document.pathname + document.search, output, context.plan.draftId);
      const link = target.ownerDocument.createElement("a"); link.className = "experience-button primary";
      if (display) display.bindText(link, "Continue"); else link.textContent = "Continue";
      link.href = route;
      const dispose = () => { target.replaceChildren(); signal.removeEventListener("abort", dispose); };
      if (!signal.aborted) { target.replaceChildren(link); signal.addEventListener("abort", dispose, { once: true }); }
      return Object.freeze({ dispose });
    },
  });
}
