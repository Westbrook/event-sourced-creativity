import { documentArtifactValidationIssues, slideCopyIsNearDuplicate, type DocumentArtifactDraft } from "./document-artifacts.ts";
import type { PresentationSourceContract } from "./presentation-source.ts";
import type { ManagedProductionPlan, ProductionFormat, ProductionMode } from "./managed-production.ts";

export type ProductionEvidenceBasis = "plan-proxy" | "rendered-text" | "rendered-slides" | "provider-image-receipt" | "provider-video-receipt" | "provider-audio-receipt" | "human-feedback";
export type ProductionMetricKey = "contextAdherence" | "contextCoverage" | "continuity" | "nonDuplication" | "transitionQuality" | "formatCraft" | "preferenceAlignment";
export type ProductionMetric = {
  status: "measured" | "failed" | "not_evaluated" | "not_applicable";
  score: number | null;
  evidenceRefs: string[];
  details: string[];
};

export type ProductionEvidence = {
  schemaVersion: 1;
  format: ProductionFormat;
  mode: ProductionMode;
  basis: ProductionEvidenceBasis;
  artifactId: string | null;
  sceneIds: string[];
  mediaInspected: boolean;
  frameDecoded: boolean;
  assemblyComposed: boolean | null;
  metrics: Record<ProductionMetricKey, ProductionMetric>;
  hardFailures: string[];
};

const weights: Record<ProductionMetricKey, number> = {
  contextAdherence: .2,
  contextCoverage: .2,
  continuity: .17,
  nonDuplication: .15,
  transitionQuality: .1,
  formatCraft: .13,
  preferenceAlignment: .05,
};

const unknown = (reason: string): ProductionMetric => ({ status: "not_evaluated", score: null, evidenceRefs: [], details: [reason] });
const notApplicable = (reason: string): ProductionMetric => ({ status: "not_applicable", score: null, evidenceRefs: [], details: [reason] });
const measured = (score: number, evidenceRefs: string[], detail: string): ProductionMetric => ({
  status: score > 0 ? "measured" : "failed",
  score: Math.max(0, Math.min(1, score)),
  evidenceRefs,
  details: [detail],
});
const normalize = (value: unknown) => String(value ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const forbiddenArticles = new Set(["a", "an", "the", "de", "du", "des", "le", "la", "les", "l", "d", "un", "une", "au", "aux"]);
const forbiddenStopWords = new Set(["or", "and", "never", "no", "not", "do", "does", "must", "avoid", "avoids", "avoided", "avoiding", "exclude", "excludes", "excluded", "excluding", "forbid", "forbidden", "prohibit", "prohibited", "introduce", "show", "include", "appear", "may", "together", "both", "ou", "et", "ni", "ne", "n", "pas", "jamais", "sans", "aucun", "aucune", "non", "éviter", "évite", "exclure", "exclut", "interdit", "interdite", "montrer", "introduire", "ensemble", "أو", "او", "لا", "بلا", "بدون", "دون", "من", "ليس", "ليست", "غير", "عدم", "ممنوع", "تجنب", "استبعاد", "تظهر", "يظهر", "معا"]);
const forbiddenJapanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const forbiddenArabic = /^\p{Script=Arabic}+$/u;

function forbiddenWords(value: string) {
  return value.normalize("NFKC").replace(/[\u064b-\u065f\u0670\u0640]/gu, "").replace(/[’‘ʼ＇]/gu, "'").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).filter(Boolean).map((token) => {
    if (!forbiddenArabic.test(token)) return token;
    if (/^و(?:ال|لا|بلا|بدون|دون)/u.test(token)) token = token.slice(1);
    return token.startsWith("ال") && token.length > 3 ? token.slice(2) : token;
  });
}

const forbiddenSearch = (value: string) => forbiddenWords(value).filter((token) => !forbiddenArticles.has(token)).join(" ");
const forbiddenSeparators = /[,;·،؛、，・]|(?:\s+(?:or|and|ou|et|ni|أو|او|و|ولا)\s+)|(?:\s+و(?=ال\p{Script=Arabic}))|または|もしくは|あるいは|や|(?<=[\p{Script=Han}\p{Script=Katakana}ー])と(?=[\p{Script=Han}\p{Script=Katakana}])/giu;
const forbiddenDenial = /(?:^|\s)(?:no|without|never|not|avoid(?:s|ed|ing)?|exclud(?:e|es|ed|ing)|forbid(?:s|den)?|prohibit(?:s|ed|ing)?|sans|aucun(?:e|s)?|pas|jamais|ni|non|ne|éviter|évite|exclure|exclut|interdit(?:e|s)?|لا|بلا|بدون|دون|ليس|ليست|غير|عدم|ممنوع|تجنب|استبعاد)(?=\s|$)/iu;
const forbiddenJapaneseDenial = /(?:描写しない|登場させない|登場しない|表示しない|使用しない|採用しない|配置しない|表現しない|描かない|映さない|写さない|見せない|使わない|用いない|入れない|置かない|含まない|含めない|出さない|いない|ありません|ない|なし|なく|禁止|除外|避ける)(?:\s|$)/u;
const forbiddenJapaneseSuffix = /(?:[=＝]|を|は|が|も|の|に|で)?(?:描写しない|登場させない|登場しない|表示しない|使用しない|採用しない|配置しない|表現しない|描かない|映さない|写さない|見せない|使わない|用いない|入れない|置かない|含まない|含めない|出さない|いない|ありません|ない|なし|なく|禁止|除外|避ける)\s*$/u;
const forbiddenJapaneseSegmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "word" }) : undefined;

function withoutForbiddenJapaneseParticle(value: string) {
  if (!forbiddenJapanese.test(value)) return value;
  if (forbiddenJapaneseSegmenter) {
    const last = [...forbiddenJapaneseSegmenter.segment(value)].at(-1);
    return last && /^(?:も|は|が|を)$/u.test(last.segment) && last.index > 0 ? value.slice(0, last.index) : value;
  }
  return /子ども$/u.test(value) ? value : value.replace(/[もはがを]$/u, "");
}

const forbiddenAffirmation = /(?:^|\s)(?:appear(?:s|ed|ing)?|approach(?:es|ed|ing)?|arriv(?:e|es|ed|ing)|gather(?:s|ed|ing)?|stand(?:s|ing)?|show(?:s|ed|ing)?|feature(?:s|d)?|contain(?:s|ed|ing)?|include(?:s|d)?|introduc(?:e|es|ed|ing)|depict(?:s|ed|ing)?|overlook(?:s|ed|ing)?|fill(?:s|ed|ing)?|domine|longe|apparaît|apparait|apparaissent|approche|arrive|montre|contient|présente|تتجمع|تقترب|تطل|تظهر|يظهر)(?=\s|$)|建っている|走る|見下ろす|集まる|現れる|登場する/iu;
const forbiddenContrast = /\b(?:but|however|yet|except|mais|pourtant|cependant|toutefois|sauf)\b|(?:^|\s)(?:لكن|ولكن|إلا)(?=\s|$)|しかし|ただし|けれど(?:も)?|でも/giu;
const forbiddenTogether = /\b(?:together|both|ensemble)\b|à\s+la\s+fois|مع(?:ً?ا)|一緒|両方|同時/iu;

function containsProhibitedAlternative(claim: string, value: string) {
  const alternatives = [...new Set(claim.split(forbiddenSeparators).map((part) => {
    const unwrapped = withoutForbiddenJapaneseParticle(part.replace(/[。！？.!?]+$/u, "").replace(forbiddenJapaneseSuffix, ""));
    return forbiddenWords(unwrapped).filter((token) => !forbiddenArticles.has(token) && !forbiddenStopWords.has(token) && (token.length > 2 || forbiddenJapanese.test(token))).join(" ");
  }).filter(Boolean))];
  const conjunctive = forbiddenTogether.test(claim);
  for (const sentence of value.replace(/ないが/gu, "ない。しかし").split(/[.!?。！？؟؛;；\n]/u)) {
    for (const scope of sentence.split(forbiddenContrast)) {
      let inheritedDenial = false;
      let matches = new Set<number>();
      const scoped = forbiddenSearch(scope);
      const japaneseListDenied = forbiddenJapanese.test(scope) && forbiddenJapaneseDenial.test(scoped) && !forbiddenAffirmation.test(scoped);
      for (const [index, raw] of scope.split(/[,،，、]/u).entries()) {
        const passage = forbiddenSearch(raw);
        const deniedHere = forbiddenDenial.test(passage);
        if (index && forbiddenAffirmation.test(passage) && !deniedHere) { inheritedDenial = false; matches = new Set<number>(); }
        for (const [alternativeIndex, alternative] of alternatives.entries()) {
          const japanese = forbiddenJapanese.test(alternative);
          const searchable = japanese ? passage : ` ${passage} `;
          const expected = japanese ? alternative : ` ${alternative} `;
          let position = searchable.indexOf(expected);
          while (position >= 0) {
            const denied = inheritedDenial || japaneseListDenied || forbiddenDenial.test(searchable.slice(0, position)) || japanese && forbiddenJapaneseDenial.test(searchable.slice(position + expected.length));
            if (!denied) {
              if (!conjunctive) return true;
              matches.add(alternativeIndex);
              if (matches.size === alternatives.length) return true;
            }
            position = searchable.indexOf(expected, position + expected.length);
          }
        }
        if (deniedHere || japaneseListDenied) inheritedDenial = true;
      }
    }
  }
  return false;
}

export function collectProductionEvidence(
  plan: ManagedProductionPlan,
  input: {
    artifactId?: string;
    draft?: DocumentArtifactDraft;
    sourceContract?: PresentationSourceContract;
    sceneReceipts?: Array<{ sceneId: string; status: string; durationSeconds?: number; providerJobId?: string; mediaUrl?: string; mediaType?: string; videoInputReceipt?: Record<string, unknown> }>;
    audioReceipt?: { providerJobId?: string; mediaUrl?: string; mediaType?: string };
    prompt?: string;
    assemblyComposed?: boolean;
  } = {},
): ProductionEvidence {
  const isVideo = plan.format === "video";
  const isStoryboard = plan.format === "storyboard";
  const isImage = plan.format === "image" || isStoryboard;
  const isSlides = plan.format === "slides";
  const isAudio = plan.format === "audio";
  const validAudioReceipt=Boolean(input.audioReceipt?.providerJobId&&input.audioReceipt.mediaUrl?.startsWith("/api/media/")&&input.audioReceipt.mediaType?.startsWith("audio/"));
  const completed = (input.sceneReceipts ?? []).filter((receipt) => receipt.status === "completed");
  const basis: ProductionEvidenceBasis = isVideo ? completed.length ? "provider-video-receipt" : "plan-proxy"
    : isImage ? completed.length ? "provider-image-receipt" : "plan-proxy"
    : isAudio ? validAudioReceipt?"provider-audio-receipt":"plan-proxy"
    : !input.draft ? "plan-proxy" : isSlides ? "rendered-slides" : "rendered-text";
  const visibleItemValues = (item: NonNullable<typeof input.draft>["items"][number]) => [
    item.title,
    item.body,
    item.notes,
    item.slide?.kicker,
    ...(item.slide?.bullets ?? []),
    item.slide?.visual.label,
    item.slide?.visual.value,
    ...(item.slide?.visual.data ?? []).flatMap((datum) => [datum.label, datum.value]),
  ];
  const itemText = (input.draft?.items ?? []).flatMap(visibleItemValues);
  const outputText = [input.draft?.content_markdown, ...itemText, input.prompt].filter(Boolean).join("\n");
  const normalizedOutput = normalize(outputText);
  const authored = plan.claims.filter((claim) => !claim.negative && !claim.continuity);
  const claimMatches = (claim: typeof authored[number], value: string) => claim.text.split(/[·;]/).some((part) => {
    const expected = normalize(part);
    return expected.length >= 2 && (` ${normalize(value)} `).includes(` ${expected} `);
  });
  const represented = authored.filter((claim) => {
    if (!claim.contextGroupIds.length) return claimMatches(claim, normalizedOutput);
    return (input.draft?.items ?? []).some((item) => (item.context_group_ids ?? []).some((id) => claim.contextGroupIds.includes(id))
      && claimMatches(claim, visibleItemValues(item).filter(Boolean).join(" ")));
  });
  const refs = isAudio&&validAudioReceipt?[`provider-audio:${input.audioReceipt!.providerJobId}`]:input.draft?.items.map((_item, index) => `item:${index + 1}`) ?? completed.map((scene) => `scene:${scene.sceneId}`);
  const hasDraft = Boolean(input.draft);
  const uniqueCompleted = new Set(completed.map((receipt) => receipt.sceneId));
  const expectedSceneIds = new Set(plan.scenes.map((scene) => scene.id));
  const expectedGroupIds = [...new Set(plan.scenes.flatMap((scene) => scene.contextGroupIds))];
  const slideIssues = isSlides && input.draft ? documentArtifactValidationIssues("slides", input.draft, {
    itemCount: plan.scenes.length,
    contextGroupIds: expectedGroupIds,
    ...(input.sourceContract ? { sourceContract: input.sourceContract, requireSourceGrounding: input.sourceContract.sources.some((source) => source.sourceKind === "block"), requireAllProtectedContent: true } : {}),
  }) : [];
  const validVisualReceipts = completed.length > 0 && completed.every((receipt) => expectedSceneIds.has(receipt.sceneId)
    && (!isVideo || Boolean(receipt.providerJobId))
    && Boolean(receipt.mediaUrl)
    && String(receipt.mediaType ?? "").startsWith(isVideo ? "video/" : "image/"));
  const nearDuplicatePairs = (input.draft?.items ?? []).flatMap((left, index, items) => items.slice(index + 1)
    .flatMap((right) => slideCopyIsNearDuplicate(left.body, right.body) ? [`item:${index + 1}`] : []));
  const orderedMovements = !hasDraft || (input.draft?.items ?? []).every((item, index) => {
    const sourceClaims = plan.scenes[index]?.sourceClaimIds ?? [];
    const sceneClaims = authored.filter((claim) => sourceClaims.includes(claim.id));
    return !sceneClaims.length || sceneClaims.some((claim) => claimMatches(claim, visibleItemValues(item).filter(Boolean).join(" ")));
  });
  const completeAuthoredCoverage = authored.length ? represented.length / authored.length : 1;
  const missingRequired = authored.filter((claim) => claim.required && !represented.includes(claim));
  const prohibited = hasDraft && !isImage && !isVideo && !isAudio ? plan.claims.filter((claim) => claim.negative).filter((claim) => {
    const values = claim.contextGroupIds.length
      ? (input.draft?.items ?? []).filter((item) => (item.context_group_ids ?? []).some((id) => claim.contextGroupIds.includes(id)))
        .map((item) => visibleItemValues(item).filter(Boolean).join(". "))
      : [outputText];
    return values.some((value) => containsProhibitedAlternative(claim.text, value));
  }) : [];
  const visualCoverage = plan.scenes.length ? [...uniqueCompleted].filter((id) => expectedSceneIds.has(id)).length / plan.scenes.length : 1;
  const narrativeDuplicates = nearDuplicatePairs.length;
  const metrics: Record<ProductionMetricKey, ProductionMetric> = {
    contextAdherence: isAudio?unknown("Musical adherence cannot be evaluated without listening to or analyzing the completed audio waveform.")
      : isImage || isVideo ? unknown("Rendered visual adherence cannot be evaluated without inspecting generated image or video pixels.")
      : hasDraft ? measured(prohibited.length || missingRequired.length ? 0 : completeAuthoredCoverage, refs, "Matched visible returned content against authored source decisions and hard exclusions.")
        : unknown("No completed artifact was inspected."),
    contextCoverage: isAudio?validAudioReceipt?measured(1,refs,"Verified one completed provider request and its private audio deliverable; authored musical qualities were not evaluated."):unknown("No completed audio provider receipt was inspected.")
      : isImage || isVideo
      ? completed.length ? measured(visualCoverage, completed.map((receipt) => `scene:${receipt.sceneId}`), "Compared distinct completed provider-scene receipts against the full planned work; pixels were not inspected.") : unknown("No completed visual provider receipts were inspected.")
      : hasDraft ? measured(completeAuthoredCoverage, refs, "Matched visible returned copy to every authored source decision.") : unknown("No completed artifact was inspected."),
    continuity: isAudio?unknown("Musical continuity cannot be evaluated without inspecting the completed audio waveform.")
      : isVideo || isImage ? unknown("Visual continuity cannot be evaluated without inspecting generated frames or image pixels.")
      : !hasDraft ? unknown("No completed artifact was inspected.")
        : measured(isSlides ? Number(Boolean(input.draft?.presentation)) : Number(narrativeDuplicates === 0 && orderedMovements), refs, isSlides ? "One presentation system covers the complete returned deck." : "Actual returned narrative movements preserve source order without near-identical prose."),
    nonDuplication: isAudio?unknown("Originality and sonic repetition cannot be evaluated without inspecting the completed audio waveform.")
      : isVideo || isImage ? unknown("Visual duplication cannot be evaluated without inspecting generated frames or image pixels.")
      : hasDraft ? measured(isSlides ? Number(!slideIssues.some((issue) => issue.code === "duplicate_deck_copy")) : Number(narrativeDuplicates === 0), refs, "Compared actual returned visible copy across the complete work against authorized source repetition.") : unknown("No completed artifact was inspected."),
    transitionQuality: isAudio?unknown("Musical transitions cannot be evaluated without inspecting the completed audio waveform.")
      : isVideo ? unknown("Cuts cannot be evaluated without decoded adjacent video frames and an assembled timeline.")
      : isStoryboard ? unknown("Storyboard transitions cannot be evaluated without inspecting adjacent generated frames.")
        : isImage ? notApplicable("A single still image has no temporal cuts.")
          : !hasDraft ? unknown("No completed artifact was inspected.")
            : measured(Number(narrativeDuplicates === 0 && orderedMovements), refs, "Compared adjacent returned narrative units against authored chronology and repeated visible copy."),
    formatCraft: isAudio?validAudioReceipt?measured(1,refs,"Validated the completed provider request, owner-scoped media reference, and audio media type; acoustic quality was not inspected."):unknown("No completed audio provider receipt was inspected.")
      : isVideo || isImage
      ? completed.length ? measured(Number(validVisualReceipts && uniqueCompleted.size === plan.scenes.length && completed.length === plan.scenes.length
        && (!isVideo || completed.every((scene) => Number(scene.durationSeconds ?? 0) >= 4 && Number(scene.durationSeconds ?? 0) <= 15))), refs, "Validated unique completed provider identities, owned media references, media types, and requested scene durations; bytes were not decoded.") : unknown("No completed visual provider receipts were inspected.")
      : hasDraft ? measured(isSlides
        ? Number(slideIssues.length === 0)
        : Number(Boolean(input.draft!.content_markdown.trim())), refs, "Validated the complete returned artifact against its format and authored target requirements.") : unknown("No completed artifact was inspected."),
    preferenceAlignment: unknown("No explicit human review or attributable preference decision was supplied."),
  };
  const hardFailures = [...new Set([
    ...Object.entries(metrics).flatMap(([key, metric]) => metric.status === "failed" ? [key] : []),
    ...(!isImage && !isVideo && !isAudio ? missingRequired.map((claim) => `missing-required-claim:${claim.id}`) : []),
    ...prohibited.map((claim) => `prohibited-content:${claim.id}`),
  ])];
  return {
    schemaVersion: 1,
    format: plan.format,
    mode: plan.mode,
    basis,
    artifactId: input.artifactId ?? null,
    sceneIds: completed.map((receipt) => receipt.sceneId),
    mediaInspected: false,
    frameDecoded: false,
    assemblyComposed: isVideo ? input.assemblyComposed === true : null,
    metrics,
    hardFailures,
  };
}

export function scoreProductionEvidence(evidence: ProductionEvidence) {
  let measuredWeight = 0;
  let applicableWeight = 0;
  let weightedScore = 0;
  for (const [name, metric] of Object.entries(evidence.metrics) as Array<[ProductionMetricKey, ProductionMetric]>) {
    const weight = weights[name];
    if (metric.status !== "not_applicable") applicableWeight += weight;
    if (metric.status === "measured" || metric.status === "failed") {
      measuredWeight += weight;
      weightedScore += weight * (metric.score ?? 0);
    }
  }
  return {
    basis: evidence.basis,
    score: measuredWeight ? weightedScore / measuredWeight : null,
    measuredWeight,
    applicableWeight,
    fullyEvaluated: Math.abs(measuredWeight - applicableWeight) < .000_001,
    claimableRenderedImprovement: false,
  };
}
