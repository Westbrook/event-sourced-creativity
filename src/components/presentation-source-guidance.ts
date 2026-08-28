import type { PresentationSourceCoverageIssue } from "../model/presentation-source.ts";
import type { FormaLocaleController } from "./design-system/localization.ts";

type SourceIssue = Pick<PresentationSourceCoverageIssue, "code" | "parameters">;
type SourceLocale = Pick<FormaLocaleController, "t" | "number" | "system">;

const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Translate Forma's typed repair guidance, never provider wording or authored source text. */
export function formatPresentationSourceIssue(issue: SourceIssue, i18n: SourceLocale): string {
  const parameters = issue.parameters;
  const slide = positiveInteger(parameters?.slideNumber)
    ? i18n.t("presentation.source.slide", "Slide {number}", { number: i18n.number(parameters.slideNumber) })
    : i18n.t("presentation.source.slideUnspecified", "A slide");
  const values = { slide, group: i18n.system("Combined Context") };
  switch (issue.code) {
    case "ambiguous_presentation_output":
      return i18n.t("presentation.source.output", "Select one presentation output specification and give sibling outputs separate headings before generating.");
    case "ambiguous_presentation_source_mode":
      return i18n.t("presentation.source.mode", "This output mixes a short outline with manuscript prose. Use a Presentation manuscript heading for fully authored slides, or keep brief coverage directions separate from supporting research.");
    case "ambiguous_presentation_slide_number":
      return i18n.t("presentation.source.duplicateNumber", "{slide} is specified more than once. Give every slide in the selected presentation a unique number before generating.", values);
    case "unresolved_outline_evidence":
      return i18n.t("presentation.source.unresolvedEvidence", "{slide} has coverage instructions but no resolved supporting research. Assign its research and outline to a {group} group, or give the outline more specific coverage terms before generating.", values);
    case "unassigned_required_presentation_source":
      return i18n.t("presentation.source.requiredEvidence", "A mandatory research passage has no assigned presentation coverage. Assign it explicitly before generating; required evidence cannot be dropped or placed on an arbitrary slide.");
    case "outline_slide_count_conflict":
      return positiveInteger(parameters?.requestedSlideCount) && positiveInteger(parameters?.authoredSlideCount)
        ? i18n.t("presentation.source.countConflict", "This research-backed outline has {authored} numbered slides, but {requested} are requested. Match the slide count or author explicit coverage for every requested slide before generating.", {
          authored: i18n.number(parameters.authoredSlideCount), requested: i18n.number(parameters.requestedSlideCount),
        })
        : i18n.t("presentation.source.countConflictUnspecified", "A research-backed outline needs explicit coverage for every requested slide. Match its numbered positions or author the added requirements before generating.");
    case "ambiguous_presentation_requirement":
      return i18n.t("presentation.source.requirement", "{slide} has an ambiguous instruction. Clarify whether it is information the audience must see or a supported production constraint before generating.", values);
    default:
      return i18n.t("presentation.source.unavailable", "The presentation sources cannot be assigned to the requested slides. Review the outline and source assignments before generating.");
  }
}

export function formatPresentationSourceIssues(issues: readonly SourceIssue[], i18n: SourceLocale): string {
  return issues.map(issue => formatPresentationSourceIssue(issue, i18n)).join(" ");
}
