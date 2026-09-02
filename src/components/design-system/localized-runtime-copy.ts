import { documentJobStopStatusParts, planningStopBudget, type DocumentJob, type DocumentJobError, type DocumentJobProgress, type GenerationFailureGuidance } from "../../model/document-jobs.ts";
import type { SourceDocumentExtraction } from "../../model/source-documents";
import type { FormaLocaleController } from "./localization";

type RuntimeLocalization = Pick<FormaLocaleController, "locale" | "messages" | "number" | "system" | "t">;

const englishLocale = (locale: RuntimeLocalization) => /^en(?:-|$)/iu.test(locale.locale);

/** Translate exact system-authored pieces without changing their retained receipt or financial meaning. */
const localizedStopStatus=(message:string,locale:RuntimeLocalization,result?:unknown)=>documentJobStopStatusParts(message,planningStopBudget(result))?.map(part=>locale.system(part)).join(" ")??null;

/** Raw progress remains unchanged for durable receipts and English-dependent parsing. */
export function localizedDocumentJobProgress(job: Pick<DocumentJob, "stage" | "status" | "progressMessage" | "result">, locale: RuntimeLocalization) {
  const message = job.progressMessage.trim();
  const stopped=localizedStopStatus(message,locale,job.result);if(stopped)return stopped;
  if (englishLocale(locale)) return message || locale.t(`job.progress.${job.stage || job.status}`);
  if (message) {
    const exact = locale.system(message);
    if (exact !== message) return exact;
    const units = message.match(/\b(?:frame|scene)\s+(\d+)\s+(?:of|\/)\s+(\d+)/iu);
    if (units) {
      const kind = /\bscene\b/iu.test(message) || job.result?.artifactKind === "video" ? "renderingScene" : "renderingFrame";
      return locale.t(`job.progress.detail.${kind}`, "", { count: locale.number(Number(units[1])), total: locale.number(Number(units[2])) });
    }
  }
  const stage = String(job.stage || job.status || "processing");
  const key = `job.progress.${stage}`;
  return locale.messages[key] ? locale.t(key) : locale.t("job.progress.processing");
}

/** Translate provider progress metadata without changing customer-authored or technical values. */
export function localizedDocumentJobProgressDetail(detail: DocumentJobProgress["detail"], job: Pick<DocumentJob, "stage" | "status" | "progressMessage" | "result" | "kind">, locale: RuntimeLocalization) {
  const stopped=detail?localizedStopStatus(detail,locale,job.result):null;if(stopped)return stopped;
  if (!detail || englishLocale(locale)) return detail;
  const exact = locale.system(detail);
  if (exact !== detail) return exact;
  const percent = detail.match(/^(\d+)%\s+reported by the provider$/iu);
  if (percent) return locale.t("job.progress.detail.providerPercent", "", { percent: locale.number(Number(percent[1])) });
  const units = detail.match(/^(\d+)\s+of\s+(\d+)\s+(frames|scenes|prompt approaches)\s+(?:stored|finished)$/iu);
  if (units) {
    const kind = units[3] === "scenes" ? "scenes" : units[3] === "prompt approaches" ? "fan" : "frames";
    return locale.t(`job.progress.detail.${kind}`, "", { count: locale.number(Number(units[1])), total: locale.number(Number(units[2])) });
  }
  return localizedDocumentJobProgress(job, locale);
}

/** Provider-specific technical errors remain in the technical receipt, never inside translated product guidance. */
export function localizedGenerationFailureGuidance(guidance: GenerationFailureGuidance, detail: DocumentJobError | null, fallback: string, locale: RuntimeLocalization): GenerationFailureGuidance {
  const stopped=localizedStopStatus(guidance.summary,locale);
  if(stopped)return{...guidance,title:locale.system(guidance.title),summary:stopped,actionLabel:guidance.actionLabel?locale.system(guidance.actionLabel):null};
  if (englishLocale(locale)) return guidance;
  let summary = guidance.summary;
  const retry = summary.match(/^(?:The server already retried\. )?Wait about (\d+) seconds before trying again\.$/iu);
  if (retry) summary = locale.t("job.progress.detail.retrySeconds", "", { seconds: locale.number(Number(retry[1])) });
  else {
    const translated = locale.system(summary);
    summary = translated !== summary || englishLocale(locale)
      ? translated
      : summary === detail?.message || summary === fallback
        ? locale.system("The provider could not complete this request. Review the saved inputs and technical receipt before trying again.")
        : translated;
  }
  return {
    ...guidance,
    title: locale.system(guidance.title),
    summary,
    actionLabel: guidance.actionLabel ? locale.system(guidance.actionLabel) : null,
  };
}

/** Source excerpts, filenames, anchors, and evidence hashes are authored evidence and are never translated. */
export function localizedSourceExtractionMessage(extraction: Pick<SourceDocumentExtraction, "sourceKind" | "status" | "message" | "segments" | "truncated">, locale: RuntimeLocalization) {
  if (englishLocale(locale)) return extraction.message;
  if (extraction.status === "ready") {
    const unit = extraction.sourceKind === "presentation" ? "slides" : extraction.sourceKind === "spreadsheet" ? "cells" : extraction.sourceKind === "pdf" ? "pages" : "sections";
    const count = locale.number(extraction.segments.length);
    const complete = locale.t(`source.extraction.ready.${unit}`, "", { count });
    return extraction.truncated ? `${complete} ${locale.t("source.extraction.truncated", "", { count: locale.number(120_000) })}` : complete;
  }
  const exact = locale.system(extraction.message);
  if (exact !== extraction.message) return exact;
  const key = /12\s*MB|upload limit/iu.test(extraction.message) ? "tooLarge"
    : /OCR|scanned pages/iu.test(extraction.message) ? "pdfScanned"
      : extraction.sourceKind === "pdf" && /encrypted|damaged/iu.test(extraction.message) ? "pdfEncrypted"
        : extraction.sourceKind;
  return locale.t(`source.extraction.unavailable.${key}`, "", { limit: locale.number(12) });
}
