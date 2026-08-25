import { combinedContextGroups } from "../src/model/combined-context.ts";
import { documentArtifactValidationIssues, formatPresentationQuantity, normalizeSlideDeckItems, slideCopyIsNearDuplicate, type DocumentArtifactDraft, type DocumentArtifactDraftItem, type DocumentArtifactKind, type DocumentArtifactValidationIssue, type SlideStylePresetId } from "../src/model/document-artifacts.ts";
import { documentImageFormat, imageFormatForPreset, providerRenderFormat } from "../src/model/image-format.ts";
import {
  MANAGED_PRODUCTION_BATCH_SIZE,
  providerFacingProductionContinuity,
  providerFacingProductionTargets,
  productionSceneSnapshot,
  scoreManagedProductionPlan,
  type ManagedProductionPlan,
  type ProductionScene,
} from "../src/model/managed-production.ts";
import { buildPresentationSourceContract, inferPresentationAudienceLocale, validatePresentationSourceCoverage } from "../src/model/presentation-source.ts";
import { VIDEO_ADAPTER_CONTRACT, type VideoAudioMode } from "../src/model/video-adapter.ts";
import { generateCreativeImage } from "./image-adapter.ts";
import { readGeneratedImageReference, storeGeneratedImage, storeGeneratedMedia } from "./media-api.ts";
import {
  generateCreativeVideo,
  generateDocumentArtifact,
  type CreativeVideoPreparedReceipt,
  type ImageReference,
  type ProviderAttemptPreflight,
  type ProviderAttemptReceipt,
  type VideoReference,
} from "./openai-adapter.ts";
import type { ProviderCostBreakdown } from "./replay-cost.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import type { WorkerEnv } from "./runtime.ts";

type ProviderUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
type ProductionCheckpoint = Record<string, unknown>;

export type ProductionSceneReceipt = {
  sceneId: string;
  narrativeOrder: number;
  generationOrder: number;
  status: "preparing" | "submitted" | "completed";
  providerJobId?: string;
  providerModel?: string;
  providerStatusUrl?: string;
  providerResponseUrl?: string;
  providerCancelUrl?: string;
  videoInputReceipt?: Record<string, unknown>;
  mediaUrl?: string;
  mediaType?: string;
  durationSeconds: number;
  costMicrousd?: number;
  referenceIds: string[];
  dependsOn: string[];
  startBoundaryGuidanceId: string | null;
  endBoundaryGuidanceId: string | null;
  startBoundaryMode?: "text-guidance";
  endBoundaryMode?: "text-guidance";
};

export type ProductionFrameReceipt = {
  sceneId: string;
  narrativeOrder: number;
  generationOrder: number;
  status: "completed";
  provider: string;
  providerJobId?: string;
  providerModel: string;
  mediaUrl: string;
  mediaType: string;
  costMicrousd: number;
  costBreakdown?: ProviderCostBreakdown;
  usage: ProviderUsage;
  referenceInputs: Array<Record<string, unknown>>;
  authoredReferenceCount: number;
  inheritedReferenceCount: number;
};

type ManagedProductionCallbacks = {
  signal?: AbortSignal;
  progress?: (stage: string, message: string, checkpoint?: ProductionCheckpoint) => void | Promise<void>;
  checkpoint?: (state: ProductionCheckpoint) => void;
  plannerAttempt?: (state: { model: string; responseId: string; responseIds: string[]; usage: ProviderUsage; latencyMs: number }) => void | Promise<void>;
  plannerPreflight?: (attempt: ProviderAttemptPreflight) => void | Promise<void>;
};

const addUsage = (left: ProviderUsage, right: ProviderUsage): ProviderUsage => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  totalTokens: left.totalTokens + right.totalTokens,
});

const retainedProviderUsage = (value: unknown): ProviderUsage => {
  const usage=value&&typeof value==="object"?value as Record<string,unknown>:{};
  return{inputTokens:Math.max(0,Number(usage.inputTokens??0)),outputTokens:Math.max(0,Number(usage.outputTokens??0)),totalTokens:Math.max(0,Number(usage.totalTokens??0))};
};

const retainedCostBreakdown = (value: unknown, fallbackMicrousd: number): ProviderCostBreakdown => {
  if(value&&typeof value==="object"){
    const cost=value as Record<string,unknown>;
    return{
      textInputMicrousd:Math.max(0,Number(cost.textInputMicrousd??0)),
      textOutputMicrousd:Math.max(0,Number(cost.textOutputMicrousd??0)),
      imageTextInputMicrousd:Math.max(0,Number(cost.imageTextInputMicrousd??0)),
      imageInputMicrousd:Math.max(0,Number(cost.imageInputMicrousd??0)),
      imageOutputMicrousd:Math.max(0,Number(cost.imageOutputMicrousd??0)),
      totalMicrousd:Math.max(0,Number(cost.totalMicrousd??fallbackMicrousd)),
    };
  }
  const total=Math.max(0,Math.floor(fallbackMicrousd));
  return{textInputMicrousd:0,textOutputMicrousd:0,imageTextInputMicrousd:0,imageInputMicrousd:0,imageOutputMicrousd:total,totalMicrousd:total};
};

function combinedSceneSnapshot(snapshot: Record<string, unknown>, scenes: ProductionScene[]) {
  const facts = new Map<string, Record<string, unknown>>();
  const relationships = new Map<string, Record<string, unknown>>();
  for (const scene of scenes) {
    const scoped = productionSceneSnapshot(snapshot, scene);
    for (const value of Array.isArray(scoped.facts) ? scoped.facts : []) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const fact = value as Record<string, unknown>;
      const key = String(fact.block_id ?? facts.size);
      const previous = facts.get(key);
      const previousProperties = previous?.properties && typeof previous.properties === "object" ? previous.properties as Record<string, unknown> : null;
      const currentProperties = fact.properties && typeof fact.properties === "object" ? fact.properties as Record<string, unknown> : null;
      const previousStructure = previousProperties?.artifact_structure && typeof previousProperties.artifact_structure === "object" ? previousProperties.artifact_structure as Record<string, unknown> : null;
      const currentStructure = currentProperties?.artifact_structure && typeof currentProperties.artifact_structure === "object" ? currentProperties.artifact_structure as Record<string, unknown> : null;
      if (previous && previousProperties && currentProperties && Array.isArray(previousStructure?.items) && Array.isArray(currentStructure?.items)) {
        const items = new Map<string, unknown>();
        for (const item of [...previousStructure.items, ...currentStructure.items]) {
          if (!item || typeof item !== "object") continue;
          const value = item as Record<string, unknown>;
          items.set(String(value.source_artifact_item_id ?? value.id ?? items.size), value);
        }
        const scopedText = [...items.values()].map((item) => {
          const value = item as Record<string, unknown>;
          return [value.title, value.body, value.notes].filter(Boolean).join(" · ");
        }).join("\n");
        facts.set(key, { ...fact, properties: { ...currentProperties, text: scopedText, artifact_markdown: scopedText, artifact_structure: { ...currentStructure, items: [...items.values()] } } });
      } else facts.set(key, fact);
    }
    for (const value of Array.isArray(scoped.relationships) ? scoped.relationships : []) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const relationship = value as Record<string, unknown>;
      relationships.set(String(relationship.relation_id ?? relationships.size), relationship);
    }
  }
  const selected = [...facts.values()];
  return { ...snapshot, facts: selected, relationships: [...relationships.values()], context_groups: combinedContextGroups({ facts: selected }) };
}

function attributedSlideQuote(item: DocumentArtifactDraftItem): string {
  const quote = item.slide?.quote;
  if (!quote?.text.trim()) return "";
  const attribution = [...new Set([quote.speaker, quote.role].map((value) => value?.trim()).filter(Boolean))].join(", ");
  return `“${quote.text.trim()}”${attribution ? ` — ${attribution}` : ""}`;
}

const managedSlideLabels=(locale?:string)=>({
  en:{section:"Section",exactValue:"Exact value",displayedValue:"Displayed value",exact:"exact",sources:"Sources",speakerNotes:"Speaker notes"},
  fr:{section:"Section",exactValue:"Valeur exacte",displayedValue:"Valeur affichée",exact:"exact",sources:"Sources",speakerNotes:"Notes de présentation"},
  ar:{section:"القسم",exactValue:"القيمة الدقيقة",displayedValue:"القيمة المعروضة",exact:"دقيق",sources:"المصادر",speakerNotes:"ملاحظات المتحدث"},
  ja:{section:"セクション",exactValue:"正確な値",displayedValue:"表示値",exact:"正確な値",sources:"出典",speakerNotes:"発表者ノート"},
}[locale?.split("-")[0]?.toLowerCase()??"en"]??{section:"Section",exactValue:"Exact value",displayedValue:"Displayed value",exact:"exact",sources:"Sources",speakerNotes:"Speaker notes"});

function managedSlideMarkdown(title: string, items: DocumentArtifactDraftItem[],locale="en"): string {
  const labels=managedSlideLabels(locale);
  const sections = items.map((item, index) => {
    const slide = item.slide;
    const quote = attributedSlideQuote(item);
    const visual = slide?.visual;
    const lines = [
      `## ${index + 1}. ${item.title}`,
      ...(slide?.section ? [`**${labels.section}:** ${slide.section}`] : []),
      ...(item.body.trim() ? [item.body.trim()] : []),
      ...(quote ? [`> ${quote}`] : []),
      ...(slide?.bullets ?? []).map((bullet) => `- ${bullet}`),
    ];
    if (visual?.value.trim() && !quote?.includes(visual.value.trim())) {
      lines.push(visual.label.trim() ? `**${visual.label.trim()}:** ${visual.value.trim()}` : visual.value.trim());
    }
    if (visual?.exactValue?.trim()) lines.push(`**${labels.exactValue}:** ${formatPresentationQuantity(visual.exactValue,visual.unit,{numericOnly:true})}`);
    if (visual?.displayValue?.trim()) lines.push(`**${labels.displayedValue}:** ${formatPresentationQuantity(visual.displayValue,visual.unit,{numericOnly:true})}`);
    for (const datum of visual?.data ?? []) {
      const value = datum.displayValue?.trim() || datum.value.trim();
      const exact = datum.exactValue?.trim();
      lines.push(`- ${datum.label}${value ? `: ${value}` : ""}${exact && exact !== value ? ` (${labels.exact}: ${exact})` : ""}`);
    }
    const citations = (slide?.citations ?? []).flatMap((citation) => {
      const label = citation.label.trim();
      if (!label) return [];
      return [`${label}${citation.excerpt?.trim() ? ` — ${citation.excerpt.trim()}` : ""}`];
    });
    if (citations.length) lines.push(`**${labels.sources}:** ${citations.join("; ")}`);
    if (item.notes.trim()) lines.push(`**${labels.speakerNotes}:** ${item.notes.trim()}`);
    return lines.join("\n");
  });
  return [`# ${title}`, ...sections].join("\n\n");
}

function managedSlideVisibleCopy(item: DocumentArtifactDraftItem): string[] {
  const visual = item.slide?.visual;
  return [
    item.title,
    item.body,
    attributedSlideQuote(item),
    ...(item.slide?.bullets ?? []),
    visual?.label ?? "",
    visual?.value ?? "",
    visual?.exactValue ?? "",
    visual?.displayValue ?? "",
    ...(visual?.data ?? []).flatMap((datum) => [datum.label, datum.value, datum.exactValue ?? "", datum.displayValue ?? ""]),
  ].filter((value): value is string => Boolean(value.trim()));
}

function managedProductionValidationFailure(kind: DocumentArtifactKind, issues: DocumentArtifactValidationIssue[], phase: "review" | "assembly") {
  const sourceFidelityFailure = kind === "slides" && issues.some((issue) =>
    /(?:source|citation|protected|precision|scorecard|numeric|quote|roadmap|outline|context_group|exact_value|display_value|slide_count_mismatch)/u.test(issue.code));
  const diagnostic = issues.map((issue) => `${issue.code} ${issue.path}`).join(", ");
  const stage = phase === "review" ? "its bounded production review" : "final assembly";
  return new ProviderRequestError({
    code: sourceFidelityFailure ? "source_fidelity_validation_failed" : "provider_returned_incomplete_document_artifact",
    category: "provider",
    scope: "request",
    action: sourceFidelityFailure ? "edit_request" : "retry",
    message: sourceFidelityFailure
      ? `The managed presentation did not preserve its required authorized source evidence after ${stage}: ${diagnostic}. Review the source document and presentation requirements before starting a new request.`
      : `The managed ${kind.replaceAll("_", " ")} could not be completed after ${stage}: ${diagnostic}.`,
    retryable: !sourceFidelityFailure,
    retryAfterMs: null,
    requestId: null,
    httpStatus: 502,
  });
}

/** Page provider planning so a long production never inherits the legacy 12-item ceiling. */
export async function generateManagedArtifactDraft(
  env: WorkerEnv,
  ownerId: string,
  kind: DocumentArtifactKind,
  input: {
    documentTitle: string;
    snapshot: Record<string, unknown>;
    production: ManagedProductionPlan;
    audience?: string;
    tone?: string;
    locale?: string;
    presentationStyle?: SlideStylePresetId;
    presentationFidelity?: "faithful" | "creative";
    requestedSlideCount?: number;
    authoredSlideCount?: number;
    videoSize?: "1280x720" | "720x1280";
    videoAudioMode?: VideoAudioMode;
  } & ManagedProductionCallbacks,
) {
  const pages: Array<Awaited<ReturnType<typeof generateDocumentArtifact>>> = [];
  const attempts: Array<Awaited<ReturnType<typeof generateDocumentArtifact>>> = [];
  const responseIdsFor=(attempt:Awaited<ReturnType<typeof generateDocumentArtifact>>)=>{
    const validation=attempt.inputReceipt.validation;
    return Array.isArray(validation.provider_response_ids)?validation.provider_response_ids.map(String).filter(Boolean):[attempt.responseId].filter(Boolean);
  };
  const recordPaidAttempt=async(receipt:ProviderAttemptReceipt)=>{
    const previousUsage=attempts.reduce((total,attempt)=>addUsage(total,attempt.usage),{inputTokens:0,outputTokens:0,totalTokens:0});
    const previousIds=attempts.flatMap(responseIdsFor);
    await input.plannerAttempt?.({model:receipt.model,responseId:attempts[0]?.responseId??receipt.responseId,responseIds:[...new Set([...previousIds,...receipt.responseIds])],usage:addUsage(previousUsage,receipt.usage),latencyMs:attempts.reduce((total,attempt)=>total+attempt.latencyMs,0)+receipt.latencyMs});
  };
  const pageSize = MANAGED_PRODUCTION_BATCH_SIZE;
  const pageCount = Math.ceil(input.production.scenes.length / pageSize);
  const presentationSources = kind === "slides"
    ? buildPresentationSourceContract(input.snapshot, {
      itemCount: input.production.scenes.length,
      requestedSlideCount: input.requestedSlideCount ?? input.production.requestedSlideCount ?? input.production.scenes.length,
      presentationStyle: input.presentationStyle,
      fidelity: input.presentationFidelity,
    })
    : null;
  const presentationAudienceLocale=presentationSources?inferPresentationAudienceLocale(presentationSources.outline.sourceText,input.locale??"en"):input.locale??"en";
  const privateSourceIdentifiers = [...new Set([
    ...input.production.claims.flatMap((claim) => [claim.id, claim.blockId, ...claim.contextGroupIds]),
    ...input.production.scenes.flatMap((scene) => [...scene.sourceBlockIds, ...scene.sourceClaimIds, ...scene.contextGroupIds]),
  ].filter(Boolean))].sort((left, right) => right.length - left.length);
  const redactRepairIssue = (message: string) => privateSourceIdentifiers
    .reduce((redacted, identifier) => redacted.replaceAll(identifier, "its authored source"), message)
    .replace(/\b[a-f\d]{8}-[a-f\d-]{27}\b/gi, "its authored target");
  const pageOptions = (index: number, repairIssues: string[] = []) => {
    const previous = pages.slice(0, Math.floor(index / pageSize));
    const priorItems = previous.flatMap((page) => page.output.items);
    const pageIndex = Math.floor(index / pageSize);
    const lockedPresentation = previous[0]?.output.presentation
      ?? (repairIssues.length && pageIndex === 0 ? pages[0]?.output.presentation : null);
    return {
      pageIndex,
      pageCount,
      globalStartIndex: index,
      totalItems: input.production.scenes.length,
      phase: (pageCount === 1 ? "complete" : pageIndex === 0 ? "opening" : pageIndex === pageCount - 1 ? "final" : "continuation") as "complete" | "opening" | "continuation" | "final",
      priorSummary: previous.at(-1)?.output.summary ?? "",
      priorEnding: previous.at(-1)?.output.content_markdown.slice(-700) ?? priorItems.at(-1)?.body.slice(-700) ?? "",
      priorVisibleCopy: priorItems.flatMap(managedSlideVisibleCopy).slice(-96),
      ...(kind === "slides" && lockedPresentation ? { lockedPresentation } : {}),
      ...(repairIssues.length ? { repairIssues } : {}),
    };
  };
  for (let index = 0; index < input.production.scenes.length; index += pageSize) {
    const scenes = input.production.scenes.slice(index, index + pageSize);
    const pageIndex = Math.floor(index / pageSize);
    await input.progress?.("planning", `${input.production.team.label}: planning ${kind === "slides" ? "slides" : "scenes"} ${index + 1}–${index + scenes.length} of ${input.production.scenes.length} (provider request ${pageIndex + 1} of ${pageCount}).`);
    const result = await generateDocumentArtifact(env, ownerId, kind, {
      documentTitle: input.documentTitle,
      snapshot: combinedSceneSnapshot(input.snapshot, scenes),
      options: {
        itemCount: scenes.length,
        audience: input.audience,
        tone: input.tone,
        locale: input.locale,
        outputLocale:presentationAudienceLocale,
        presentationStyle: input.presentationStyle,
        presentationFidelity: input.presentationFidelity,
        requestedSlideCount: input.requestedSlideCount,
        authoredSlideCount: input.authoredSlideCount,
        videoSize: input.videoSize,
        videoAudioMode: input.videoAudioMode,
        productionMode: "managed",
        productionPlan: input.production,
        productionScenes: scenes,
        productionPage: pageOptions(index),
        signal: input.signal,
        onProviderAttempt:recordPaidAttempt,
        onBeforeProviderAttempt:input.plannerPreflight,
      },
    });
    pages.push(result);
    attempts.push(result);
  }
  const assemble = (normalizeSlides = false): DocumentArtifactDraft => {
    const first = pages[0]!;
    let items = pages.flatMap((page) => page.output.items);
    if (kind === "slides") {
      const authorizedBlocks = new Set((Array.isArray(input.snapshot.facts) ? input.snapshot.facts : []).flatMap((fact) => {
        if (!fact || typeof fact !== "object" || Array.isArray(fact)) return [];
        const blockId = String((fact as Record<string, unknown>).block_id ?? "").trim();
        return blockId ? [blockId] : [];
      }));
      items = items.map((item, index) => {
        const scene = input.production.scenes[index];
        if (!item.slide || !scene) return item;
        const scopedSourceIds = scene.sourceBlockIds.filter((sourceId) => authorizedBlocks.has(sourceId));
        const sourceIds = item.slide.sourceIds?.length ? item.slide.sourceIds : scopedSourceIds;
        const contextGroupIds = item.context_group_ids?.length ? item.context_group_ids : scene.contextGroupIds;
        const visibleCopy = managedSlideVisibleCopy(item).join("\n");
        const protectedQuotes = (presentationSources?.protectedQuotes ?? []).filter((quote) =>
          visibleCopy.includes(quote.text)
          && (!quote.sourceBlockId || sourceIds.includes(quote.sourceBlockId)));
        const quotes = [...(item.slide.quote ? [item.slide.quote] : []), ...protectedQuotes]
          .filter((quote, quoteIndex, candidates) => candidates.findIndex((candidate) =>
            candidate.text === quote.text && candidate.role === quote.role) === quoteIndex);
        let notes = item.notes;
        for (const quote of quotes) {
          const attribution = [...new Set([quote.speaker, quote.role].filter((name): name is string => Boolean(name?.trim())))];
          if (notes.includes(quote.text) && attribution.every((name) => notes.includes(name))) continue;
          const attributed = `“${quote.text}”${attribution.length ? ` — ${attribution.join(", ")}` : ""}`;
          notes = [notes.trim(), attributed].filter(Boolean).join("\n\n");
        }
        const missingCitationLabels = [...new Set((item.slide.citations ?? [])
          .map((citation) => citation.label.trim())
          .filter((label) => label && !notes.includes(label)))];
        if (missingCitationLabels.length) notes = [notes.trim(), `[${managedSlideLabels(presentationAudienceLocale).sources}] ${missingCitationLabels.join("; ")}`].filter(Boolean).join("\n\n");
        return {
          ...item,
          notes,
          context_group_ids: [...new Set(contextGroupIds)],
          slide: {
            ...item.slide,
            ...(sourceIds.length ? { sourceIds: [...new Set(sourceIds)] } : {}),
            ...(scene.section && !item.slide.section ? { section: scene.section } : {}),
            ...(scene.sourceOutlineOrder && !item.slide.sourceOrder ? { sourceOrder: scene.sourceOutlineOrder } : {}),
          },
        };
      });
      if (normalizeSlides) items = normalizeSlideDeckItems(items);
    }
    const content = kind === "slides"
      ? managedSlideMarkdown(first.output.title, items,presentationAudienceLocale)
      : pages.length === 1 ? first.output.content_markdown
        : pages.map((page, index) => {
          const markdown = page.output.content_markdown.trim();
          if (!index) return markdown;
          const firstHeading = first.output.content_markdown.trim().split("\n")[0]?.trim();
          const lines = markdown.split("\n");
          if (firstHeading && lines[0]?.trim() === firstHeading) lines.shift();
          return lines.join("\n").trim();
        }).filter(Boolean).join("\n\n");
    return { title: first.output.title, summary: first.output.summary, presentation: first.output.presentation, content_markdown: content, items };
  };
  const wholeWorkIssues = (output: DocumentArtifactDraft): DocumentArtifactValidationIssue[] => {
    const expectedGroups = combinedContextGroups(input.snapshot).map((group) => group.id);
    const issues = documentArtifactValidationIssues(kind, output, { itemCount: input.production.scenes.length, contextGroupIds: expectedGroups });
    if (kind === "slides") {
      if (presentationSources) issues.push(...validatePresentationSourceCoverage(output.items, presentationSources, {
        requireEverySlideSource: true,
        requireAllProtectedContent: true,
      }));
      for (const [index, item] of output.items.entries()) {
        const assignedSources = input.production.scenes[index]?.sourceBlockIds ?? [];
        const attributedSources = item.slide?.sourceIds ?? [];
        if (assignedSources.length && attributedSources.length && !attributedSources.some((sourceId) => assignedSources.includes(sourceId))) {
          issues.push({ code: "incorrect_slide_source", path: `items.${index}.slide.sourceIds`, message: "This slide is not attributed to its assigned authorized source scene." });
        }
      }
      for (const [index, item] of output.items.entries()) if (index > 0 && item.slide?.layout === "cover") issues.push({ code: "duplicate_opening_slide", path: `items.${index}.slide.layout`, message: "Only the global opening slide can use the cover layout." });
      for (const [index, page] of pages.entries()) if (index > 0 && firstPresentation && JSON.stringify(page.output.presentation) !== JSON.stringify(firstPresentation)) issues.push({ code: "presentation_continuity_drift", path: `items.${index * pageSize}.presentation`, message: "Every provider page must retain the locked first-page presentation system." });
      for (const groupId of expectedGroups) {
        const positions = output.items.flatMap((item, index) => (item.context_group_ids ?? []).includes(groupId) ? [index] : []);
        for (let position = 1; position < positions.length; position += 1) {
          if (positions[position] === positions[position - 1]! + 1) continue;
          issues.push({
            code: "split_context_group",
            path: `items.${positions[position]}.context_group_ids`,
            message: "An authored source chapter was reopened after another chapter interrupted it; preserve its evidence and repair the assignment.",
          });
        }
      }
    } else if (kind === "short_story" || kind === "scene") {
      for (const [index, item] of output.items.entries()) {
        const earlier = output.items.slice(0, index);
        if (earlier.some((previous) => slideCopyIsNearDuplicate(previous.body, item.body))) issues.push({ code: "duplicate_narrative_movement", path: `items.${index}.body`, message: "This narrative movement repeats an earlier completed movement." });
      }
    }
    return issues;
  };
  const firstPresentation = pages[0]?.output.presentation ?? null;
  let output = assemble();
  const expectedGroups = combinedContextGroups(input.snapshot).map((group) => group.id);
  let finalIssues = wholeWorkIssues(output);
  let repairedPages = 0;
  if (finalIssues.length && (kind === "slides" || kind === "short_story" || kind === "scene")) {
    const affected = [...new Set(finalIssues.flatMap((issue) => {
      const index = /^items\.(\d+)/.exec(issue.path)?.[1];
      return index === undefined ? [] : [Math.floor(Number(index) / pageSize)];
    }))];
    for (const pageIndex of affected) {
      const index = pageIndex * pageSize;
      const scenes = input.production.scenes.slice(index, index + pageSize);
      const issues = finalIssues.filter((issue) => {
        const position = /^items\.(\d+)/.exec(issue.path)?.[1];
        return position !== undefined && Math.floor(Number(position) / pageSize) === pageIndex;
      }).map((issue) => redactRepairIssue(issue.message));
      const repaired = await generateDocumentArtifact(env, ownerId, kind, {
        documentTitle: input.documentTitle,
        snapshot: combinedSceneSnapshot(input.snapshot, scenes),
        options: { itemCount: scenes.length, audience: input.audience, tone: input.tone, locale: input.locale, outputLocale:presentationAudienceLocale,presentationStyle: input.presentationStyle, presentationFidelity: input.presentationFidelity, requestedSlideCount: input.requestedSlideCount, authoredSlideCount: input.authoredSlideCount, videoSize: input.videoSize, videoAudioMode: input.videoAudioMode, productionMode: "managed", productionPlan: input.production, productionScenes: scenes, productionPage: pageOptions(index, issues), signal: input.signal, onProviderAttempt:recordPaidAttempt,onBeforeProviderAttempt:input.plannerPreflight },
      });
      pages[pageIndex] = repaired;
      attempts.push(repaired);
      repairedPages += 1;
    }
    output = assemble();
    finalIssues = wholeWorkIssues(output);
  }
  if (finalIssues.length) throw managedProductionValidationFailure(kind, finalIssues, "review");
  if (kind === "slides") output = assemble(true);
  finalIssues = kind === "slides"
    ? wholeWorkIssues(output)
    : documentArtifactValidationIssues(kind, output, { itemCount: input.production.scenes.length, contextGroupIds: expectedGroups });
  if (finalIssues.length) throw managedProductionValidationFailure(kind, finalIssues, "assembly");
  const first = pages[0]!;
  return {
    output,
    model: first.model,
    responseId: first.responseId,
    responseIds: attempts.flatMap(responseIdsFor),
    latencyMs: attempts.reduce((sum, page) => sum + page.latencyMs, 0),
    usage: attempts.reduce((sum, page) => addUsage(sum, page.usage), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    inputReceipt: {
      production_mode: "managed",
      team: input.production.team,
      page_count: pages.length,
      planned_page_count: pageCount,
      planned_item_count: input.production.scenes.length,
      provider_page_size: pageSize,
      planned_provider_request_count: input.production.providerCallCount ?? pageCount,
      maximum_provider_request_count: input.production.maximumProviderCallCount ?? pageCount * 4,
      provider_request_count: attempts.reduce((count, attempt) => count + 1 + (attempt.inputReceipt.validation.repair_attempted ? 1 : 0), 0),
      ...(input.requestedSlideCount ? { requested_slide_count: input.requestedSlideCount } : {}),
      ...(input.authoredSlideCount ? { authored_slide_count: input.authoredSlideCount } : {}),
      ...(input.presentationStyle ? { presentation_style: input.presentationStyle } : {}),
      ...(input.presentationFidelity ? { presentation_fidelity: input.presentationFidelity } : {}),
      whole_work_validation: { issues: finalIssues, repaired_pages: repairedPages, source_coverage_validated: Boolean(presentationSources) },
      pages: pages.map((page, index) => ({ page: index + 1, response_id: page.responseId, item_count: page.output.items.length, ...page.inputReceipt })),
    },
  };
}

const ownedImageReference = (value: NonNullable<Awaited<ReturnType<typeof readGeneratedImageReference>>>, label: string, mode: ImageReference["mode"] = "preserve_subject"): ImageReference => ({
  ...value,
  label,
  source: "locked-study",
  mode,
});

const productionReferenceIdentity = (reference: Pick<VideoReference, "referenceId" | "blockId">) => `${reference.referenceId}\u0000${reference.blockId}`;

function prioritizedSceneReferences(scene: ProductionScene, references: VideoReference[]) {
  const authored = new Set(scene.sourceBlockIds);
  const targets = new Set(scene.contextGroupIds);
  const selected = new Set<string>();
  return scene.referenceIds.flatMap((referenceId) => {
    const candidates = references.filter((reference) => {
      if (reference.referenceId !== referenceId || selected.has(productionReferenceIdentity(reference))) return false;
      const groups = reference.contextGroups ?? [];
      const matching = groups.some((group) => targets.has(group.id));
      if (groups.length && targets.size && !matching) return false;
      if (groups.length && !targets.size && !authored.has(reference.blockId)) return false;
      return authored.has(reference.blockId) || reference.sequence === scene.narrativeOrder || reference.sequence === null || matching;
    }).sort((left, right) => {
      const rank = (reference: VideoReference) => (authored.has(reference.blockId) ? 100 : 0)
        + (reference.sequence === scene.narrativeOrder ? 40 : 0)
        + ((reference.contextGroups ?? []).some((group) => targets.has(group.id)) ? 20 : 0)
        + (reference.sequence === null ? 10 : 0);
      return rank(right) - rank(left);
    });
    const reference = candidates[0];
    if (!reference) return [];
    selected.add(productionReferenceIdentity(reference));
    return [reference];
  });
}

function referencesInAuthoredOrder(references: VideoReference[], prioritized: VideoReference[], limit: number) {
  const eligible = new Set(prioritized.slice(0, limit).map(productionReferenceIdentity));
  const retained = new Set<string>();
  return references.filter((reference) => {
    const identity = productionReferenceIdentity(reference);
    if (!eligible.has(identity) || retained.has(identity)) return false;
    retained.add(identity);
    return true;
  });
}

function generatedVideoReference(
  value: NonNullable<Awaited<ReturnType<typeof readGeneratedImageReference>>>,
  artifactId: string,
  scene: ProductionScene,
  groups: NonNullable<VideoReference["contextGroups"]>,
): VideoReference {
  return {
    ...value,
    blockId: `production-anchor:${artifactId}`,
    referenceId: `production-anchor:${artifactId}`,
    label: "Account-generated production continuity anchor",
    mode: "preserve_subject",
    sequence: null,
    shotDirection: scene.action,
    cameraDirection: scene.cameraDirection,
    framePrompt: scene.imagePrompt,
    sourceArtifactId: artifactId,
    sourceArtifactItemId: null,
    sourceArtifactKind: "production-anchor",
    storyboardTitle: "Shared production continuity",
    contextGroups: groups,
  };
}

const retainedVideoReceipt = (value: Record<string, unknown> | undefined): CreativeVideoPreparedReceipt | undefined => value ? {
  provider: String(value.provider ?? "fal"),
  model: String(value.model ?? VIDEO_ADAPTER_CONTRACT.model),
  submittedPrompt: String(value.submitted_prompt ?? ""),
  parameters: value.parameters && typeof value.parameters === "object" ? value.parameters as Record<string, unknown> : {},
  referenceInputs: Array.isArray(value.reference_inputs) ? value.reference_inputs as Array<Record<string, unknown>> : [],
  usedReferencePixels: value.used_reference_pixels === true,
  ...(value.adaptation ? { adaptation: value.adaptation as CreativeVideoPreparedReceipt["adaptation"] } : {}),
} : undefined;

/** Render real individual clips and retain an honest, chronological reel manifest. */
export async function renderManagedVideoProduction(
  env: WorkerEnv,
  ownerId: string,
  artifactId: string,
  draft: DocumentArtifactDraft,
  production: ManagedProductionPlan,
  input: {
    providerActorId?: string;
    snapshot: Record<string, unknown>;
    references: VideoReference[];
    videoSize: "1280x720" | "720x1280";
    audioMode: VideoAudioMode;
    existingItems?: Array<Record<string, unknown>>;
    existingSceneReceipts?: Record<string, ProductionSceneReceipt>;
    existingAnchor?: Record<string, unknown>;
    prepaidSceneIds?: string[];
    prepaidAnchor?: boolean;
  } & ManagedProductionCallbacks,
) {
  const receipts = { ...(input.existingSceneReceipts ?? {}) };
  const prepaidScenes = new Set(input.prepaidSceneIds ?? []);
  const rendered = new Map<string, Record<string, unknown>>((input.existingItems ?? []).flatMap((item) => item.scene_id ? [[String(item.scene_id), { ...item }]] : []));
  const costs: ProviderCostBreakdown[] = [];
  let imageUsage: ProviderUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let anchor = input.existingAnchor;
  if(anchor&&!input.prepaidAnchor&&!prepaidScenes.size){
    imageUsage=addUsage(imageUsage,retainedProviderUsage(anchor.usage));
    costs.push(retainedCostBreakdown(anchor.costBreakdown,Object.hasOwn(anchor,"costMicrousd")?Number(anchor.costMicrousd??0):500_000));
  }
  let serializedCheckpoint = Promise.resolve();
  const persist = (message: string) => {
    const state = {
      productionPlan: production,
      productionSceneReceipts: { ...receipts },
      productionAnchor: anchor ?? null,
      renderedItems: [...rendered.values()],
      productionQuality: scoreManagedProductionPlan(production),
      recoverableProductionProviderRequest: Object.values(receipts).some((scene) => Boolean(scene.providerJobId) && (scene.status === "submitted" || scene.status === "completed")),
      productionSceneCount: production.scenes.length,
      productionCompletedSceneCount: [...rendered.values()].filter((item) => item.media_url).length,
    };
    input.checkpoint?.(state);
    serializedCheckpoint = serializedCheckpoint.then(() => input.progress?.("rendering-scenes", message, state)).then(() => undefined);
    return serializedCheckpoint;
  };

  if (production.scenes.some((scene) => !scene.referenceIds.length) && !anchor) {
    const anchorScene = production.scenes.find((scene) => scene.id === production.anchorSceneId)!;
    await input.progress?.("anchor-generation", `Creating the shared visual anchor from scene ${anchorScene.narrativeOrder}: ${anchorScene.title}.`);
    const prior = prioritizedSceneReferences(anchorScene, input.references)[0];
    const reference = prior ? [{ ...prior, source: "locked-study" as const, mode: prior.mode }] satisfies ImageReference[] : [];
    const continuity = providerFacingProductionContinuity(production, anchorScene);
    const format = providerRenderFormat(imageFormatForPreset(input.videoSize === "720x1280" ? "9:16" : "16:9"), "preview");
    const image = await generateCreativeImage(env, input.providerActorId??ownerId, productionSceneSnapshot(input.snapshot, anchorScene), {
      title: anchorScene.title,
      rationale: production.anchorRationale,
      scene: `${anchorScene.imagePrompt}. Preserve this target-scoped production identity, wardrobe, location, palette, lighting, and lens: ${JSON.stringify(continuity)}.`,
      palette: continuity.palette,
      next_moves: ["Preserve subject identity", "Carry visual continuity across every scene"],
    }, { quality: "low", size: format.size, outputFormat: "jpeg", outputCompression: 82, references: reference, signal: input.signal });
    const stored = await storeGeneratedImage(env, ownerId, `${artifactId}-continuity-anchor`, image.bytes, image.model, image.mimeType, {
      artifactId,
      artifactRole: "production-continuity-anchor",
      provider: image.provider,
      providerModel: image.model,
      providerRequestId: image.providerRequestId ?? "",
      providerMediaUrl: image.providerMediaUrl ?? "",
      rights: "account-generated",
    });
    anchor = { mediaUrl: stored.url, mediaType: stored.mimeType, sceneId: anchorScene.id, contextGroupIds: anchorScene.contextGroupIds, source: "account-generated", rights: "account-generated", frameGuidance: "reference-image-not-native-frame-lock",usage:image.usage,costMicrousd:image.costBreakdown.totalMicrousd,costBreakdown:image.costBreakdown,provider:image.provider,providerModel:image.model,...(image.providerRequestId?{providerJobId:image.providerRequestId}:{}) };
    imageUsage = addUsage(imageUsage, image.usage);
    costs.push(image.costBreakdown);
    await persist("The reusable production anchor is safely stored with account-generated provenance.");
  }

  let anchorReference: VideoReference | null = null;
  if (anchor?.mediaUrl) {
    const image = await readGeneratedImageReference(env, ownerId, anchor.mediaUrl);
    if (!image) throw new Error("production_anchor_reference_unavailable");
    const anchorScene = production.scenes.find((scene) => scene.id === production.anchorSceneId)!;
    const knownGroups = new Map(input.references.flatMap((reference) => reference.contextGroups ?? []).map((group) => [group.id, group]));
    const contextGroups = anchorScene.contextGroupIds.flatMap((id) => {
      const detailed = knownGroups.get(id);
      if (detailed) return [detailed];
      const group = combinedContextGroups(input.snapshot).find((item) => item.id === id);
      return group ? [{ id: group.id, name: group.name, target: group.target, role: group.role, application: group.application, relativity: group.relativity }] : [];
    });
    anchorReference = generatedVideoReference(image, artifactId, anchorScene, contextGroups);
  }

  const sceneById = new Map(production.scenes.map((scene) => [scene.id, scene]));
  const completedFromState = () => [...rendered.values()].filter((item) => item.media_url).length;
  for (const wave of production.parallelWaves) {
    const pending = wave.filter((sceneId) => !rendered.get(sceneId)?.media_url);
    const settled = await Promise.allSettled(pending.map(async (sceneId) => {
      const scene = sceneById.get(sceneId)!;
      const item = draft.items[scene.narrativeOrder - 1]!;
      const existing = receipts[scene.id];
      const prioritizedApproved = prioritizedSceneReferences(scene, input.references);
      const anchorGroups = anchorReference?.contextGroups ?? [];
      const matchingTarget = Boolean(anchorReference && ((!anchorGroups.length && !scene.contextGroupIds.length) || anchorGroups.length > 0 && anchorGroups.every((group) => scene.contextGroupIds.includes(group.id))));
      const scopedAnchor = anchorReference ? matchingTarget ? anchorReference : {
        ...anchorReference,
        label: "Account-generated shared palette and lighting study",
        mode: "preserve_style" as const,
        shotDirection: "Carry only visual style, palette, and lighting.",
        cameraDirection: "Preserve only the established visual treatment and camera language.",
        framePrompt: "Shared visual treatment without subject identity.",
        contextGroups: [],
      } : null;
      const continuityReference = scopedAnchor && !prioritizedApproved.some((reference) => reference.referenceId === scopedAnchor.referenceId) ? scopedAnchor : null;
      const selectedApproved = referencesInAuthoredOrder(input.references, prioritizedApproved, VIDEO_ADAPTER_CONTRACT.maxReferenceImages - (continuityReference ? 1 : 0));
      const references = [...selectedApproved, ...(continuityReference ? [continuityReference] : [])];
      const checkpoint: ProductionSceneReceipt = existing ?? {
        sceneId: scene.id,
        narrativeOrder: scene.narrativeOrder,
        generationOrder: production.executionOrder.indexOf(scene.id) + 1,
        status: "preparing",
        durationSeconds: scene.durationSeconds,
        referenceIds: references.map((reference) => reference.referenceId),
        dependsOn: scene.dependsOn,
        startBoundaryGuidanceId: scene.startBoundaryId,
        endBoundaryGuidanceId: scene.endBoundaryId,
        startBoundaryMode: "text-guidance",
        endBoundaryMode: "text-guidance",
      };
      receipts[scene.id] = checkpoint;
      await persist(`Rendering scene ${scene.narrativeOrder} of ${production.scenes.length}: ${scene.title}.`);
      const sceneSnapshot = productionSceneSnapshot(input.snapshot, scene);
      const sceneContinuity = providerFacingProductionContinuity(production, scene);
      const sceneGroups = (production.contextGroups ?? combinedContextGroups(input.snapshot)).filter((group) => scene.contextGroupIds.includes(group.id));
      const scopedTargets = providerFacingProductionTargets(production, input.snapshot).filter((target) => sceneGroups.some((group) => group.role === target.role && group.target === target.target));
      const sceneDraft = { title: draft.title, summary: `${draft.summary} Target-scoped visual continuity: ${JSON.stringify(sceneContinuity)}.`, items: [{ ...item, notes: `${item.notes} ${scene.transitionIn}; ${scene.transitionOut}.` }] };
      const video = await generateCreativeVideo(env, item.image_prompt || item.body || scene.action, {
        seconds: scene.durationSeconds,
        size: input.videoSize,
        audioMode: input.audioMode,
        endUserId: input.providerActorId??ownerId,
        snapshot: sceneSnapshot,
        plan: sceneDraft,
        productionContinuity: { prohibitions: providerFacingProductionContinuity({ claims: production.claims.filter((claim) => !claim.contextGroupIds.length) }).prohibitions, scopedTargets },
        references,
        signal: input.signal,
        providerJobId: existing?.providerJobId,
        providerModel: existing?.providerModel,
        providerStatusUrl: existing?.providerStatusUrl,
        providerResponseUrl: existing?.providerResponseUrl,
        providerCancelUrl: existing?.providerCancelUrl,
        retainedReceipt: retainedVideoReceipt(existing?.videoInputReceipt),
        onPrepared: async (prepared) => {
          checkpoint.videoInputReceipt = {
            provider: prepared.provider,
            model: prepared.model,
            submitted_prompt: prepared.submittedPrompt,
            parameters: prepared.parameters,
            reference_inputs: prepared.referenceInputs,
            used_reference_pixels: prepared.usedReferencePixels,
            adaptation: prepared.adaptation,
          };
          checkpoint.providerModel = prepared.model;
          await persist(`Scene ${scene.narrativeOrder}: validated ${references.length} authorized reference${references.length === 1 ? "" : "s"}.`);
        },
        onReceipt: async (provider) => {
          checkpoint.status = "submitted";
          checkpoint.providerJobId = provider.providerJobId;
          checkpoint.providerModel = provider.model;
          checkpoint.providerStatusUrl = provider.providerStatusUrl;
          checkpoint.providerResponseUrl = provider.providerResponseUrl;
          checkpoint.providerCancelUrl = provider.providerCancelUrl;
          await persist(`Scene ${scene.narrativeOrder} accepted by Fal; its paid request can be resumed without resubmission.`);
        },
        onStage: async (_stage, message) => persist(`Scene ${scene.narrativeOrder}: ${message}`),
      });
      const media = await storeGeneratedMedia(env, ownerId, `${artifactId}-${scene.id}`, video.bytes, video.model, video.mimeType, {
        artifactId,
        artifactRole: "production-video-scene",
        sceneId: scene.id,
        narrativeOrder: String(scene.narrativeOrder),
        providerJobId: video.providerJobId,
      });
      Object.assign(checkpoint, {
        status: "completed",
        providerJobId: video.providerJobId,
        providerModel: video.model,
        providerStatusUrl: video.providerStatusUrl,
        providerResponseUrl: video.providerResponseUrl,
        providerCancelUrl: video.providerCancelUrl,
        mediaUrl: media.url,
        mediaType: media.mimeType,
        costMicrousd: video.costMicrousd,
        videoInputReceipt: {
          provider: video.provider,
          model: video.model,
          provider_job_id: video.providerJobId,
          submitted_prompt: video.submittedPrompt,
          parameters: video.providerParameters,
          reference_inputs: video.referenceInputs,
          used_reference_pixels: video.usedReferencePixels,
          adaptation: video.adaptation,
        },
      });
      rendered.set(scene.id, { id: `${artifactId}-${scene.id}`, scene_id: scene.id, sequence: scene.narrativeOrder, title: item.title, media_url: media.url, media_type: media.mimeType, provider: video.provider, provider_job_id: video.providerJobId, duration_seconds: scene.durationSeconds, generation_order: checkpoint.generationOrder });
      await persist(`${completedFromState()} of ${production.scenes.length} production scenes are safely stored.`);
    }));
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  await serializedCheckpoint;

  const orderedItems = production.scenes.map((scene) => rendered.get(scene.id)!).filter(Boolean);
  const orderedReceipts = production.scenes.map((scene) => receipts[scene.id]!).filter(Boolean);
  return {
    items: orderedItems,
    receipts: orderedReceipts,
    anchor,
    imageUsage,
    imageCosts: costs,
    videoCostMicrousd: orderedReceipts.reduce((sum, receipt) => sum + (prepaidScenes.has(receipt.sceneId) ? 0 : Number(receipt.costMicrousd ?? 0)), 0),
    latencyMs: 0,
    quality: scoreManagedProductionPlan(production),
    assembly: {
      kind: "ordered-scene-reel" as const,
      composed: false,
      reason: "No supported video compositor is configured; individual chronological clips remain independently playable.",
      narrative_order: orderedReceipts.map((receipt) => receipt.sceneId),
      generation_order: production.executionOrder,
      native_boundary_frames: false,
      boundary_mode: "text-guidance" as const,
    },
  };
}

/** Produce storyboard frames out of timeline order without losing durable chronology. */
export async function renderManagedStoryboardProduction(
  env: WorkerEnv,
  ownerId: string,
  artifactId: string,
  draft: DocumentArtifactDraft,
  production: ManagedProductionPlan,
  input: { providerActorId?: string; snapshot: Record<string, unknown>; references?: VideoReference[]; existingItems?: Array<Record<string, unknown>>; existingFrameReceipts?: Record<string, ProductionFrameReceipt> } & ManagedProductionCallbacks,
) {
  const rendered = new Map<string, Record<string, unknown>>((input.existingItems ?? []).flatMap((item) => item.scene_id ? [[String(item.scene_id), { ...item }]] : []));
  const receipts: Record<string, ProductionFrameReceipt> = { ...(input.existingFrameReceipts ?? {}) };
  const usage: ProviderUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const costs: ProviderCostBreakdown[] = [];
  for(const receipt of Object.values(receipts)){
    Object.assign(usage,addUsage(usage,retainedProviderUsage(receipt.usage)));
    costs.push(retainedCostBreakdown(receipt.costBreakdown,receipt.costMicrousd));
  }
  const sceneById = new Map(production.scenes.map((scene) => [scene.id, scene]));
  let latestModel = "";
  let latestProvider = "";
  let latestProviderJobId = "";
  let serializedCheckpoint = Promise.resolve();
  const persist = (message: string) => {
    const checkpoint = { productionPlan: production, renderedItems: [...rendered.values()], productionFrameReceipts: structuredClone(receipts) };
    input.checkpoint?.(checkpoint);
    serializedCheckpoint = serializedCheckpoint.then(() => input.progress?.("rendering-frames", message, checkpoint)).then(() => undefined);
    return serializedCheckpoint;
  };

  for (const wave of production.parallelWaves) {
    const settled = await Promise.allSettled(wave.filter((sceneId) => !rendered.has(sceneId)).map(async (sceneId) => {
      const scene = sceneById.get(sceneId)!;
      const item = draft.items[scene.narrativeOrder - 1]!;
      const parent = scene.dependsOn[0] ? rendered.get(scene.dependsOn[0]) : scene.id !== production.anchorSceneId ? rendered.get(production.anchorSceneId) : undefined;
      const inherited = parent?.media_url ? await readGeneratedImageReference(env, ownerId, parent.media_url) : null;
      const parentScene = parent?.scene_id ? sceneById.get(String(parent.scene_id)) : undefined;
      const sameTarget = Boolean(parentScene && ((!parentScene.contextGroupIds.length && !scene.contextGroupIds.length) || parentScene.contextGroupIds.length > 0 && parentScene.contextGroupIds.every((group) => scene.contextGroupIds.includes(group))));
      const prioritizedApproved = prioritizedSceneReferences(scene, input.references ?? []);
      const inheritedReference = inherited ? ownedImageReference(inherited, "Account-generated storyboard continuity study", sameTarget ? "preserve_subject" : "preserve_style") : null;
      const selectedApproved: ImageReference[] = referencesInAuthoredOrder(input.references ?? [], prioritizedApproved, VIDEO_ADAPTER_CONTRACT.maxReferenceImages - (inheritedReference ? 1 : 0)).map((reference) => ({ ...reference, source: "uploaded-reference" as const }));
      const references = [...selectedApproved, ...(inheritedReference ? [inheritedReference] : [])];
      const continuity = providerFacingProductionContinuity(production, scene);
      const frameFormat = providerRenderFormat(documentImageFormat(input.snapshot).format, "preview");
      await persist(`Rendering storyboard frame ${scene.narrativeOrder} of ${production.scenes.length}${references.length ? " from the approved production anchor" : ""}.`);
      const image = await generateCreativeImage(env, input.providerActorId??ownerId, productionSceneSnapshot(input.snapshot, scene), {
        title: item.title,
        rationale: `${item.notes} Preserve this target-scoped production continuity: ${JSON.stringify(continuity)}.`,
        scene: item.image_prompt,
        palette: continuity.palette,
        next_moves: [scene.transitionIn, scene.transitionOut],
      }, { quality: "low", size: frameFormat.size, outputFormat: "jpeg", outputCompression: 78, references, signal: input.signal });
      const media = await storeGeneratedImage(env, ownerId, `${artifactId}-frame-${scene.narrativeOrder}`, image.bytes, image.model, image.mimeType, {
        artifactRole: "storyboard-frame",
        artifactId,
        sceneId: scene.id,
        provider: image.provider,
        providerModel: image.model,
        providerRequestId: image.providerRequestId ?? "",
        providerMediaUrl: image.providerMediaUrl ?? "",
        rights: "account-generated",
      });
      rendered.set(scene.id, { id: `${artifactId}-frame-${scene.narrativeOrder}`, scene_id: scene.id, sequence: scene.narrativeOrder, title: item.title, media_url: media.url, media_type: media.mimeType, width: image.width, height: image.height, provider: image.provider, provider_request_id: image.providerRequestId, generation_order: production.executionOrder.indexOf(scene.id) + 1, authored_reference_count: selectedApproved.length, inherited_reference_count: inheritedReference ? 1 : 0 });
      receipts[scene.id] = {
        sceneId: scene.id,
        narrativeOrder: scene.narrativeOrder,
        generationOrder: production.executionOrder.indexOf(scene.id) + 1,
        status: "completed",
        provider: image.provider,
        ...(image.providerRequestId ? { providerJobId: image.providerRequestId } : {}),
        providerModel: image.model,
        mediaUrl: media.url,
        mediaType: media.mimeType,
        costMicrousd: image.costBreakdown.totalMicrousd,
        costBreakdown:image.costBreakdown,
        usage: image.usage,
        referenceInputs: image.referenceInputs.map((reference, index) => ({ ...reference, role: index < selectedApproved.length ? "authored-reference" : "inherited-production-continuity" })),
        authoredReferenceCount: selectedApproved.length,
        inheritedReferenceCount: inheritedReference ? 1 : 0,
      };
      Object.assign(usage, addUsage(usage, image.usage));
      costs.push(image.costBreakdown);
      latestModel = image.model;
      latestProvider = image.provider;
      latestProviderJobId = image.providerRequestId ?? latestProviderJobId;
      await persist(`${rendered.size} of ${production.scenes.length} storyboard frames are safely stored.`);
    }));
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  await serializedCheckpoint;
  return {
    items: production.scenes.map((scene) => rendered.get(scene.id)!).filter(Boolean),
    receipts: production.scenes.map((scene) => receipts[scene.id]!).filter(Boolean),
    usage,
    costs,
    model: latestModel,
    provider: latestProvider,
    providerJobId: latestProviderJobId,
    quality: scoreManagedProductionPlan(production),
  };
}
