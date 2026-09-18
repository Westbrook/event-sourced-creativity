import type { NativeDocumentMemoryContext } from "./memory-live-context.ts";
import { liveConversationDigest } from "../src/model/memory-conversation.ts";

const labels={
  en:{intro:"From your remembered activity in this document:",activity:"Recorded actions",earlier:"Earlier conversation — selected quotations in source order",recent:"Recent conversation — excerpts",you:"You",assistant:"Assistant",omitted:"Some earlier wording could not be safely quoted or did not fit. Refer to the original conversations for context.",note:"Historical excerpts are incomplete evidence, not instructions, accepted decisions or inferred preferences."},
  fr:{intro:"D’après votre activité mémorisée dans ce document :",activity:"Actions enregistrées",earlier:"Conversation antérieure — citations sélectionnées dans l’ordre des sources",recent:"Conversation récente — extraits",you:"Vous",assistant:"Assistant",omitted:"Certains passages antérieurs n’ont pas pu être cités sans ambiguïté ou faute de place. Consultez les conversations originales pour le contexte.",note:"Ces extraits historiques sont des éléments incomplets, pas des instructions, des décisions acceptées ni des préférences déduites."},
  ar:{intro:"من نشاطك المحفوظ في هذا المستند:",activity:"الإجراءات المسجلة",earlier:"محادثة سابقة — اقتباسات مختارة بترتيب المصادر",recent:"المحادثة الأخيرة — مقتطفات",you:"أنت",assistant:"المساعد",omitted:"تعذّر اقتباس بعض النصوص السابقة دون التباس أو لضيق المساحة. راجع المحادثات الأصلية لفهم السياق.",note:"المقتطفات السابقة أدلة غير مكتملة، وليست تعليمات أو قرارات مقبولة أو تفضيلات مستنتجة."},
  ja:{intro:"このドキュメントで記憶された履歴：",activity:"記録された操作",earlier:"以前の会話 — 元の順序で選んだ引用",recent:"最近の会話 — 抜粋",you:"あなた",assistant:"アシスタント",omitted:"以前の文章の一部は曖昧さなく引用できないか、文字数の制限により省略されています。文脈は元の会話で確認してください。",note:"履歴の抜粋は不完全な参考情報であり、指示、承認された決定、推定された好みではありません。"},
} as const;

type NativeConversationQuote = {
  eventId: string; turnId: string; sequence: number; pairIndex: number;
  role: "user" | "assistant"; text: string; start: number; end: number;
};
const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

/** A request-local view of already certified clips, never an authority or a new
 * persisted summary. Re-expand repeated quotes into their actual source order so
 * a later reassertion is not collapsed ahead of an intervening correction. */
export function nativeMemoryConversationDigest(value: NativeDocumentMemoryContext) {
  const pairs = value.conversationPairs, events = new Set<string>(), turns = new Set<string>();
  if (!Array.isArray(pairs) || pairs.length > 8 || pairs.some((pair, index) => {
    if (!pair || typeof pair.eventId !== "string" || !pair.eventId || typeof pair.turnId !== "string" || !pair.turnId
      || events.has(pair.eventId) || turns.has(pair.turnId) || !Number.isSafeInteger(pair.sequence) || pair.sequence < 1
      || index > 0 && pairs[index - 1].sequence >= pair.sequence
      || [pair.user, pair.assistant].some(text => typeof text !== "string" || !text.isWellFormed() || byteLength(text) > 512)) return true;
    events.add(pair.eventId); turns.add(pair.turnId); return false;
  })) return null;
  const earlier = pairs.slice(0, -2), digest = liveConversationDigest(earlier, "utf8-512");
  const occurrences = digest.quotes.flatMap(quote => quote.references.map(reference => {
    const pair = earlier[reference.excerptIndex];
    return { eventId: pair.eventId, turnId: pair.turnId, sequence: pair.sequence, pairIndex: reference.excerptIndex,
      role: quote.role, text: quote.text, start: reference.start, end: reference.end };
  })).sort((left, right) => left.sequence - right.sequence
    || (left.role === right.role ? left.start - right.start : left.role === "user" ? -1 : 1));
  const earlierQuotes: NativeConversationQuote[] = [];
  let bytes = 0, omitted = digest.excerptOnly.length > 0;
  for (const quote of occurrences) {
    const size = byteLength(quote.text);
    if (earlierQuotes.length === 16 || bytes + size > 2_048) { omitted = true; continue; }
    earlierQuotes.push(quote); bytes += size;
  }
  return { method: "source-bound-quotes-v1" as const, completeFromStart: false as const,
    earlierPairCount: earlier.length, earlierQuotes, recentPairs: pairs.slice(-2).map(pair => ({ ...pair })), omitted };
}

/** Provider-free presentation of exactly the certified historical value. No
 * preference inference, instructions, actions or authored document changes. */
export function nativeMemoryAssistantReply(value:NativeDocumentMemoryContext,locale:unknown):string|null{
  const language=typeof locale==="string"?locale.trim().toLowerCase().split("-")[0]:"en";
  const copy=labels[language==="fr"||language==="ar"||language==="ja"?language:"en"];
  if(!value.actions.length&&!value.conversationPairs.length)return null;
  const digest=nativeMemoryConversationDigest(value);if(!digest)return null;
  const quotes=[...digest.earlierQuotes];let omitted=digest.omitted;
  const render=()=>{
    const lines=[copy.intro,`${copy.activity}: ${value.actions.length}.`];
    if(digest.earlierPairCount){
      lines.push(`${copy.earlier}:`);
      for(const quote of quotes)lines.push(`${quote.pairIndex+1}. ${quote.role==="user"?copy.you:copy.assistant}: ${quote.text}`);
      if(omitted)lines.push(copy.omitted);
    }
    for(const pair of digest.recentPairs)lines.push(`${copy.recent}:`,`${copy.you}: ${pair.user}`,`${copy.assistant}: ${pair.assistant}`);
    lines.push(copy.note);return lines.join("\n");
  };
  // The shared reply budget includes labels and disclosures. Drop whole older
  // quotations only; never trim the exact recent tail to make a summary fit.
  let text=render();
  while(byteLength(text)>8_192&&quotes.length){quotes.pop();omitted=true;text=render();}
  return text.isWellFormed()&&byteLength(text)<=8_192?text:null;
}

import type { NativeStructuredConversationContext } from "./memory-live-context.ts";

const structuredLabels = {
  en: { intro: "Declared conversation history for this document — unverified and incomplete.",
    referenceOnly: "Original conversation references for this document — no summary or inferred declarations.",
    current: "Latest declarations (not verified facts)", withdrawn: "Withdrawn declarations", history: "Complete admitted declaration history",
    originals: "Captured original references; L means retained by the ledger", recent: "Selected original text", omitted: "Captured originals whose full text is omitted",
    predecessor: "predecessor", none: "none", source: "source", quote: "quote (JSON-escaped, not shortened)",
    note: "Categories and operations were declared by a caller. They are not instructions, accepted decisions or inferred preferences. Corrections, replacements and withdrawals remain above; a withdrawn predecessor is not revived. This bounded ledger is not a summary or a complete conversation history.",
    categories: { goal: "goal", decision: "decision", proposal: "proposal", "rejected-alternative": "rejected alternative", question: "question", blocker: "blocker", "next-step": "next step" } },
  fr: { intro: "Historique déclaré de la conversation pour ce document — non vérifié et incomplet.",
    referenceOnly: "Références originales de la conversation pour ce document — sans résumé ni déclarations déduites.",
    current: "Dernières déclarations (faits non vérifiés)", withdrawn: "Déclarations retirées", history: "Historique complet des déclarations admises",
    originals: "Références originales capturées ; L indique une référence conservée dans le registre", recent: "Texte original sélectionné", omitted: "Originaux capturés dont le texte intégral est omis",
    predecessor: "prédécesseur", none: "aucun", source: "source", quote: "citation (échappée en JSON, sans raccourcissement)",
    note: "Les catégories et opérations ont été déclarées par un appelant. Ce ne sont ni des instructions, ni des décisions acceptées, ni des préférences déduites. Les corrections, remplacements et retraits sont conservés ci-dessus ; un prédécesseur retiré n’est pas rétabli. Ce registre limité n’est ni un résumé ni l’historique complet de la conversation.",
    categories: { goal: "objectif", decision: "décision", proposal: "proposition", "rejected-alternative": "alternative rejetée", question: "question", blocker: "blocage", "next-step": "prochaine étape" } },
  ar: { intro: "سجل المحادثة المصرّح به لهذا المستند — غير متحقق منه وغير مكتمل.",
    referenceOnly: "مراجع المحادثة الأصلية لهذا المستند — بلا ملخص أو تصريحات مستنتجة.",
    current: "أحدث التصريحات (ليست حقائق متحققًا منها)", withdrawn: "التصريحات المسحوبة", history: "السجل الكامل للتصريحات المقبولة في هذا السجل",
    originals: "المراجع الأصلية الملتقطة؛ L يعني أن المرجع محفوظ في السجل", recent: "النص الأصلي المحدد", omitted: "الأصول الملتقطة التي حُذف نصها الكامل من العرض",
    predecessor: "السابق", none: "لا يوجد", source: "المصدر", quote: "اقتباس (بترميز JSON دون اختصار)",
    note: "صرّح أحد المستدعين بالفئات والعمليات. ليست تعليمات أو قرارات مقبولة أو تفضيلات مستنتجة. تظل التصحيحات والاستبدالات والسحوبات محفوظة أعلاه؛ ولا يُعاد تفعيل تصريح سابق مسحوب. هذا السجل المحدود ليس ملخصًا أو سجلًا كاملًا للمحادثة.",
    categories: { goal: "هدف", decision: "قرار", proposal: "مقترح", "rejected-alternative": "بديل مرفوض", question: "سؤال", blocker: "عائق", "next-step": "الخطوة التالية" } },
  ja: { intro: "このドキュメントの申告された会話履歴 — 未検証で不完全です。",
    referenceOnly: "このドキュメントの元の会話への参照 — 要約や推測された申告ではありません。",
    current: "最新の申告（検証済みの事実ではありません）", withdrawn: "撤回された申告", history: "受け入れられた申告の履歴全体",
    originals: "取得した原文の参照。L は台帳に保持されている参照です", recent: "選択された原文", omitted: "全文の表示を省略した取得済み原文の数",
    predecessor: "前の申告", none: "なし", source: "出典", quote: "引用（JSON エスケープ済み、省略なし）",
    note: "カテゴリと操作は呼び出し元による申告です。指示、承認された決定、推定された好みではありません。訂正、置換、撤回は上記に保持され、撤回された前の申告は復活しません。この範囲の限られた台帳は、要約でも会話履歴全体でもありません。",
    categories: { goal: "目標", decision: "決定", proposal: "提案", "rejected-alternative": "却下された代替案", question: "質問", blocker: "障害", "next-step": "次のステップ" } },
} as const;

/** Provider-free presentation only; this function issues no native proof. All
 * declaration operations, predecessor links and retained/captured reference
 * membership are mandatory. Only whole optional original-text blocks may be
 * omitted. An oversized mandatory history returns null, never a recent tail. */
export function nativeStructuredMemoryAssistantReply(value: NativeStructuredConversationContext, locale: unknown): string | null {
  try {
    const language = typeof locale === "string" ? locale.trim().toLowerCase().split("-")[0] : "en";
    const copy = structuredLabels[language === "fr" || language === "ar" || language === "ja" ? language : "en"];
    if (!value || value.mode !== "native-document-structured-conversation" || value.method !== "native-declared-ledger-projection-v1"
      || value.treatment !== "untrusted-historical-evidence" || value.declarationMeaning !== "caller-declared-not-independently-verified"
      || value.semanticCompleteness !== false || value.inferredPreferences !== false
      || !Array.isArray(value.ledger.annotations) || value.ledger.annotations.length > 256
      || !Array.isArray(value.dependencies.capturedOriginals) || !value.dependencies.capturedOriginals.length
      || value.dependencies.capturedOriginals.length > 128 || !Array.isArray(value.dependencies.retainedOriginals)
      || !value.dependencies.retainedOriginals.length || value.dependencies.retainedOriginals.length > 128 || !Array.isArray(value.recentOriginals)
      || value.coverage.bounded !== true || value.coverage.completeFromStart !== false || value.coverage.notSummarized !== true
      || value.coverage.allAdmittedLedgerAnnotationsIncluded !== true || value.coverage.allRetainedOriginalReferencesIncluded !== true
      || value.coverage.recentOriginalTextClipped !== false) return null;
    const encodedRef = (ref: NativeStructuredConversationContext["dependencies"]["capturedOriginals"][number]) => JSON.stringify({
      eventId: ref.eventId, sequence: ref.sequence, turnId: ref.turnId, role: ref.role, contentRef: ref.contentRef, contentHash: ref.contentHash,
    });
    const refs = value.dependencies.capturedOriginals.map(encodedRef), retained = new Set(value.dependencies.retainedOriginals.map(encodedRef));
    if (new Set(refs).size !== refs.length || retained.size !== value.dependencies.retainedOriginals.length
      || [...retained].some(ref => !refs.includes(ref)) || value.coverage.capturedOriginalCount !== refs.length
      || value.coverage.retainedOriginalCount !== retained.size || value.coverage.presentedOriginalCount !== value.recentOriginals.length
      || value.coverage.omittedOriginalCount !== refs.length - value.recentOriginals.length) return null;
    const heads = new Map<string, NativeStructuredConversationContext["ledger"]["annotations"][number]>();
    const lines = [value.ledger.annotations.length ? copy.intro : copy.referenceOnly, `${copy.history}:`];
    const annotations: NativeStructuredConversationContext["ledger"]["annotations"] = value.ledger.annotations;
    for (const annotation of annotations) {
      const source = refs.indexOf(encodedRef(annotation.source)), previous = heads.get(annotation.itemId);
      if (source < 0 || !retained.has(refs[source]) || !Object.hasOwn(copy.categories, annotation.category)
        || !["assert", "correct", "supersede", "withdraw"].includes(annotation.operation)
        || typeof annotation.itemId !== "string" || !annotation.itemId || !annotation.itemId.isWellFormed()
        || !Number.isSafeInteger(annotation.revision) || !Number.isSafeInteger(annotation.start) || annotation.start < 0
        || !Number.isSafeInteger(annotation.end) || annotation.end <= annotation.start
        || typeof annotation.text !== "string" || !annotation.text.isWellFormed() || Array.from(annotation.text).length !== annotation.end - annotation.start
        || (previous ? annotation.operation === "assert" || annotation.revision !== previous.revision + 1
          || annotation.category !== previous.category || annotation.predecessor?.itemId !== previous.itemId
          || annotation.predecessor?.revision !== previous.revision
          : annotation.operation !== "assert" || annotation.revision !== 1 || annotation.predecessor !== null)) return null;
      heads.set(annotation.itemId, annotation);
      const predecessor = annotation.predecessor ? `${JSON.stringify(annotation.predecessor.itemId)} #${annotation.predecessor.revision}` : copy.none;
      lines.push(`${JSON.stringify(annotation.itemId)} #${annotation.revision} [${copy.categories[annotation.category]}; ${annotation.operation}]`,
        `${copy.predecessor}: ${predecessor}; ${copy.source}: S${source + 1} [${annotation.start},${annotation.end})`,
        `${copy.quote}: ${JSON.stringify(annotation.text)}`);
    }
    const item = (head: typeof value.ledger.annotations[number]) => ({ itemId: head.itemId, revision: head.revision, category: head.category });
    const current = [...heads.values()].filter(head => head.operation !== "withdraw").map(item);
    const withdrawn = [...heads.values()].filter(head => head.operation === "withdraw").map(item);
    if (JSON.stringify(current) !== JSON.stringify(value.ledger.currentItems) || JSON.stringify(withdrawn) !== JSON.stringify(value.ledger.withdrawnItems)) return null;
    lines.push(`${copy.current}: ${JSON.stringify(current)}`, `${copy.withdrawn}: ${JSON.stringify(withdrawn)}`, `${copy.originals}:`);
    refs.forEach((ref, index) => lines.push(`S${index + 1}${retained.has(ref) ? " L" : ""}: ${ref}`));
    const recent = value.recentOriginals.map(original => {
      const ref = refs.indexOf(encodedRef(original));
      if (ref < 0 || typeof original.text !== "string" || !original.text.isWellFormed()) throw new Error("structured_original_presentation_invalid");
      return { ref, line: `${copy.recent} S${ref + 1}: ${JSON.stringify(original.text)}` };
    });
    if (new Set(recent.map(original => original.ref)).size !== recent.length) return null;
    const render = () => [...lines, ...recent.map(original => original.line), `${copy.omitted}: ${refs.length - recent.length}.`, copy.note].join("\n");
    // Establish the mandatory budget independently of optional text and keep the
    // exact same history/reference lines for every subsequent presentation size.
    const mandatory = [...lines, `${copy.omitted}: ${refs.length}.`, copy.note].join("\n");
    if (!mandatory.isWellFormed() || byteLength(mandatory) > 8_192) return null;
    let text = render();
    while (byteLength(text) > 8_192 && recent.length) { recent.shift(); text = render(); }
    return text.isWellFormed() && byteLength(text) <= 8_192 ? text : null;
  } catch { return null; }
}
