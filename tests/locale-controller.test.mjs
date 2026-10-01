import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { FormaLocaleController, installFormaLocaleRoot, LOCALE_CONTEXT } from "../src/components/design-system/locale-controller.ts";

class Host extends EventTarget {
  updates = 0;
  addController(controller) { this.controller = controller; }
  requestUpdate() { this.updates++; }
}
const snapshot = (locale = "en", messages = {}) => ({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC", messages, revision: 1 });
test("rootless controls retain explicit fallbacks, late roots and scoped subscriptions", () => {
  const host = new Host(), controller = new FormaLocaleController(host);
  controller.hostConnected();
  assert.equal(controller.t("action.default", "Action"), "Action");
  assert.equal(controller.system("Authored value"), "Authored value");
  let current = snapshot("fr", { "action.default": "Action française" });
  const callbacks = new Set();
  const beforeRoot = host.updates;
  installFormaLocaleRoot({ current: () => current, subscribe: callback => { callbacks.add(callback); return () => callbacks.delete(callback); }, defaults: () => ({ "field.text": "Text" }), defaultMessageId: source => source === "Text" ? "field.text" : undefined });
  assert.ok(host.updates > beforeRoot, "late root installation requests a live host update");
  assert.equal(controller.locale, "fr"); assert.equal(controller.t("action.default"), "Action française");
  assert.equal(controller.t("field.text"), "Text");
  assert.equal(controller.number(1234), new Intl.NumberFormat("fr").format(1234));
  assert.equal(controller.firstGrapheme("👨‍👩‍👦Hello"), "👨‍👩‍👦");
  const scopedHost = new Host(), scoped = new FormaLocaleController(scopedHost);
  let disconnected = 0;
  scopedHost.addEventListener("context-request", event => { assert.equal(event.context, LOCALE_CONTEXT); event.callback(snapshot("ja", { "field.text": "テキスト" }), () => { disconnected++; }); });
  scoped.hostConnected(); assert.equal(scoped.locale, "ja");
  const beforeChange = host.updates;
  current = snapshot("ar"); for (const callback of callbacks) callback(current);
  assert.ok(host.updates > beforeChange, "a live root notification requests an update");
  assert.equal(controller.direction, "rtl"); assert.equal(scoped.locale, "ja");
  controller.hostDisconnected(); const updates = host.updates;
  current = snapshot("en"); for (const callback of callbacks) callback(current);
  assert.equal(host.updates, updates);
  controller.hostConnected(); assert.equal(controller.locale, "en");
  scoped.hostDisconnected(); assert.equal(disconnected, 1);
  const beforeReplacement = host.updates;
  installFormaLocaleRoot({ current: () => snapshot("ja"), subscribe: () => () => {}, defaults: () => ({}), defaultMessageId: () => undefined });
  assert.ok(host.updates > beforeReplacement, "replacing the root updates the reconnected host");
  assert.equal(controller.locale, "ja"); assert.equal(callbacks.size, 0);
  controller.hostDisconnected();
});

// Native event/attribute ports only; this checks the actual shared controller and
// locale façade, not browser geometry, focus, accessibility or rendered pixels.
test("old and new imports share one root through all languages and nested scope lifetimes", async () => {
  class Element extends EventTarget {
    attributes = new Map(); isConnected = true; parentElement = null;
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { const old = this.getAttribute(name); this.attributes.set(name, String(value)); if (this.constructor.observedAttributes?.includes(name)) this.attributeChangedCallback(name, old, String(value)); }
    matches(selector) { return selector === ":dir(rtl)" && this.getAttribute("dir") === "rtl"; }
    dispatchEvent(event) { const result = super.dispatchEvent(event); if (event.bubbles && !event.cancelBubble && this.parentElement) this.parentElement.dispatchEvent(event); return result; }
  }
  const originals = new Map(["HTMLElement", "customElements", "document", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const registry = new Map(), document = new EventTarget(); document.documentElement = new Element();
  Object.assign(globalThis, { HTMLElement: Element, document, localStorage: { setItem() {}, getItem() { return null; } }, customElements: { get: name => registry.get(name), define(name, constructor) { assert.equal(registry.has(name), false); registry.set(name, constructor); } } });
  const root = new URL("../", import.meta.url).href;
  const resolver = registerHooks({ resolve(specifier, context, next) { return next(context.parentURL?.startsWith(root) && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context); } });
  try {
    const facade = await import("../src/components/design-system/localization.ts");
    assert.equal(facade.FormaLocaleController, FormaLocaleController);
    const host = new Host(), controller = new facade.FormaLocaleController(host); controller.hostConnected();
    for (const locale of ["en", "fr", "ar", "ja"]) {
      const beforeLocale = host.updates;
      const active = await facade.setFormaLocale(locale, { persist: false, formatLocale: "en-GB", timeZone: "Europe/London" });
      assert.ok(host.updates > beforeLocale, `${locale} requests a live host update`);
      assert.equal(controller.locale, locale); assert.equal(controller.messages, active.messages);
      assert.equal(controller.direction, locale === "ar" ? "rtl" : "ltr");
      assert.equal(controller.timeZone, "Europe/London"); assert.equal(controller.number(1234.5), new Intl.NumberFormat("en-GB").format(1234.5));
      assert.equal(controller.system("Action"), controller.t("action.default"));
    }
    await Promise.all([facade.setFormaLocale("fr", { persist: false }), facade.setFormaLocale("ar", { persist: false }), facade.setFormaLocale("ja", { persist: false })]);
    assert.equal(controller.locale, "ja"); assert.equal(document.documentElement.lang, "ja");
    const outer = new facade.FormaUiLocale(); outer.setAttribute("lang", "fr"); outer.connectedCallback();
    const inner = new facade.FormaUiLocale(); inner.parentElement = outer; inner.setAttribute("lang", "ar"); inner.timeZone = "Asia/Tokyo"; inner.formatLocale = "ja-JP"; inner.messages = { "test.message": "Scoped" }; inner.connectedCallback();
    const child = new Host(); child.dispatchEvent = event => inner.dispatchEvent(event);
    const scoped = new FormaLocaleController(child); scoped.hostConnected();
    assert.equal(scoped.locale, "ar"); assert.equal(scoped.direction, "rtl"); assert.equal(scoped.timeZone, "Asia/Tokyo"); assert.equal(scoped.t("test.message"), "Scoped");
    await facade.setFormaLocale("en", { persist: false }); assert.equal(scoped.locale, "ar");
    scoped.hostDisconnected(); const updates = child.updates;
    inner.messages = { "test.message": "Changed" }; assert.equal(child.updates, updates);
    child.dispatchEvent = event => outer.dispatchEvent(event); scoped.hostConnected(); assert.equal(scoped.locale, "fr");
    scoped.hostDisconnected(); inner.disconnectedCallback(); outer.disconnectedCallback();
    controller.hostDisconnected(); const stopped = host.updates; await facade.setFormaLocale("fr", { persist: false }); assert.equal(host.updates, stopped);
    controller.hostConnected(); assert.equal(controller.locale, "fr");
    await facade.setFormaLocale("xx-XX", { persist: false }); assert.equal(controller.locale, "en");
    controller.hostDisconnected(); assert.equal(registry.get("forma-ui-locale"), facade.FormaUiLocale); assert.equal(registry.size, 1);
  } finally {
    resolver.deregister();
    for (const [key, original] of originals) { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; }
  }
});


// The table is test data for the owner-scoped 96 setup phrases, not a runtime
// catalog or a claim about browser rendering, fonts, pronunciation or layout.
test("setup catalog additions preserve automatic IDs, placeholders and real locale lookup", async () => {
  // [English source, pinned UTF-16 FNV ID, en, fr, ar, ja]
  const additions = [
    ["Check result", "system.auto.y971k4.12", "Check result", "Vérifier le résultat", "التحقق من النتيجة", "結果を確認"],
    ["Checking decisions", "system.auto.z4tbtq.18", "Checking decisions", "Vérification des choix", "جارٍ التحقق من الاختيارات", "選択内容を確認中"],
    ["Checking result", "system.auto.1hv8k7e.15", "Checking result", "Vérification du résultat", "جارٍ التحقق من النتيجة", "結果を確認中"],
    ["Consent required", "system.auto.wufr6q.16", "Consent required", "Consentement requis", "تلزم الموافقة", "同意必須"],
    ["Creation unavailable", "system.auto.11mn8pq.20", "Creation unavailable", "Création indisponible", "الإنشاء غير متاح", "作成不可"],
    ["Creator access required", "system.auto.19wlq7w.23", "Creator access required", "Accès Créateur requis", "تلزم صلاحية الإنشاء", "作成者権限必須"],
    ["Document saved", "system.auto.1qn8euf.14", "Document saved", "Document enregistré", "تم حفظ المستند", "ドキュメント保存済み"],
    ["Document setup · No generation", "system.auto.jt3aez.30", "Document setup · No generation", "Préparation du document · Aucune génération", "إعداد المستند · بدون توليد", "ドキュメントの準備 · 生成なし"],
    ["Document unconfirmed", "system.auto.1iid0sg.20", "Document unconfirmed", "Document non confirmé", "المستند غير مؤكّد", "ドキュメント作成未確認"],
    ["Draft unavailable", "system.auto.9isiti.17", "Draft unavailable", "Brouillon indisponible", "المسودة غير متاحة", "下書き利用不可"],
    ["Experience unavailable", "system.auto.qzgrrz.22", "Experience unavailable", "Expérience indisponible", "التجربة غير متاحة", "作成ページ利用不可"],
    ["Generated output unavailable", "system.auto.1e0w569.28", "Generated output unavailable", "Résultat généré indisponible", "المخرج المولّد غير متاح", "生成結果利用不可"],
    ["Interface changed", "system.auto.lzfzc4.17", "Interface changed", "Interface modifiée", "تغيّرت الواجهة", "インターフェース変更あり"],
    ["Invalid experience address", "system.auto.1l1zelg.26", "Invalid experience address", "Adresse d’expérience invalide", "عنوان تجربة غير صالح", "無効な作成ページアドレス"],
    ["Loading Document setup", "system.auto.68l3ux.22", "Loading Document setup", "Chargement de la préparation du document", "جارٍ تحميل إعداد المستند", "ドキュメントの準備を読み込み中"],
    ["Personal workspace required", "system.auto.q0sigd.27", "Personal workspace required", "Espace de travail personnel requis", "تلزم مساحة عمل شخصية", "個人用ワークスペース必須"],
    ["Range limit", "system.auto.1rgm8l1.11", "Range limit", "Valeur hors plage", "القيمة خارج النطاق", "範囲外"],
    ["Result mismatch", "system.auto.1y9o5kw.15", "Result mismatch", "Résultat non conforme", "النتيجة غير مطابقة", "結果不一致"],
    ["Result status", "system.auto.108ed2u.13", "Result status", "État du résultat", "حالة النتيجة", "結果の状態"],
    ["Result unavailable", "system.auto.96gsm6.18", "Result unavailable", "Résultat indisponible", "النتيجة غير متاحة", "結果利用不可"],
    ["Retry original", "system.auto.1jl0jds.14", "Retry original", "Réessayer la demande initiale", "إعادة محاولة الطلب الأصلي", "元のリクエストを再試行"],
    ["Save to Forma", "system.auto.11b0cj4.13", "Save to Forma", "Enregistrer dans Forma", "الحفظ في Forma", "Formaに保存"],
    ["Save unconfirmed", "system.auto.1y7hhuc.16", "Save unconfirmed", "Enregistrement non confirmé", "الحفظ غير مؤكّد", "保存結果未確認"],
    ["Saved draft", "system.auto.xz1bxb.11", "Saved draft", "Brouillon enregistré", "تم حفظ المسودة", "下書き保存済み"],
    ["Saving Document", "system.auto.i229s.15", "Saving Document", "Enregistrement du document", "جارٍ حفظ المستند", "ドキュメントを保存中"],
    ["Sign in required", "system.auto.1aohejo.16", "Sign in required", "Connexion requise", "يلزم تسجيل الدخول", "ログイン必須"],
    ["Text limit", "system.auto.13sc0jt.10", "Text limit", "Limite de texte", "حد النص", "文字数制限"],
    ["Invalid value", "system.auto.9f7uyp.13", "Invalid value", "Valeur invalide", "قيمة غير صالحة", "無効な値"],
    ["Check decisions", "system.auto.79cmr4.15", "Check decisions", "Vérifier les choix", "التحقق من الاختيارات", "選択内容を確認"],
    ["Decrease {label}", "system.auto.o0fom9.16", "Decrease {label}", "Diminuer {label}", "تقليل {label}", "{label}を減らす"],
    ["Increase {label}", "system.auto.wi472l.16", "Increase {label}", "Augmenter {label}", "زيادة {label}", "{label}を増やす"],
    ["Direction preview", "system.auto.1uwxhu.17", "Direction preview", "Aperçu de la direction créative", "معاينة التوجه الإبداعي", "表現方針のプレビュー"],
    ["Evidence {number}", "system.auto.1vlexcn.17", "Evidence {number}", "Preuve {number}", "الدليل {number}", "根拠 {number}"],
    ["Energy: opening {opening}, peak {peak}, ending {ending}", "system.auto.n5zl07.55", "Energy: opening {opening}, peak {peak}, ending {ending}", "Énergie : début {opening}, pic {peak}, fin {ending}", "الطاقة: البداية {opening}، الذروة {peak}، النهاية {ending}", "エネルギー：冒頭 {opening}、ピーク {peak}、終わり {ending}"],
    ["Illustrative", "system.auto.obttb7.12", "Illustrative", "À titre indicatif", "توضيحي", "参考イメージ"],
    ["Move down", "system.auto.c2tjmw.9", "Move down", "Déplacer vers le bas", "نقل إلى أسفل", "下へ移動"],
    ["Move up", "system.auto.1rvkqip.7", "Move up", "Déplacer vers le haut", "نقل إلى أعلى", "上へ移動"],
    ["Participant {label}", "system.auto.1sr5i9u.19", "Participant {label}", "Participant {label}", "المشارك {label}", "参加者{label}"],
    ["1 clip · 4 seconds", "system.auto.1vxjpyi.18", "1 clip · 4 seconds", "1 clip · 4 secondes", "مقطع واحد · 4 ثوانٍ", "クリップ1本 · 4秒"],
    ["1 image", "system.auto.e3sf4x.7", "1 image", "1 image", "صورة واحدة", "画像1枚"],
    ["1 instrumental cue", "system.auto.wdixcb.18", "1 instrumental cue", "1 séquence instrumentale", "مقطع موسيقي آلي واحد", "インストゥルメンタル1曲"],
    ["1 object · GLB", "system.auto.gstgtx.14", "1 object · GLB", "1 objet · GLB", "عنصر واحد · GLB", "オブジェクト1点 · GLB"],
    ["1 scene", "system.auto.m5znt8.7", "1 scene", "1 scène", "مشهد واحد", "シーン1件"],
    ["1 short story", "system.auto.6el8rz.13", "1 short story", "1 récit court", "قصة قصيرة واحدة", "短編小説1編"],
    ["4 frames", "system.auto.1wmzq4b.8", "4 frames", "4 vignettes", "4 إطارات", "4コマ"],
    ["5 slides", "system.auto.1oc1ute.8", "5 slides", "5 diapositives", "5 شرائح", "スライド5枚"],
    ["Both", "system.auto.mkyb42.4", "Both", "Les deux", "كلاهما", "両方"],
    ["Claim", "system.auto.rfmv4f.5", "Claim", "Thèse", "الطرح الرئيسي", "主張"],
    ["Daylight", "system.auto.bli893.8", "Daylight", "Lumière du jour", "ضوء النهار", "昼光"],
    ["Depth", "system.auto.1lu11u2.5", "Depth", "Profondeur", "العمق", "奥行き"],
    ["Ending", "system.auto.pakdrq.6", "Ending", "Fin", "النهاية", "終わり"],
    ["Energy", "system.auto.6fa7xx.6", "Energy", "Énergie", "الطاقة", "エネルギー"],
    ["Event", "system.auto.1lrcegv.5", "Event", "Événement", "الحدث", "出来事"],
    ["Evidence order", "system.auto.rbvvxg.14", "Evidence order", "Ordre des preuves", "ترتيب الأدلة", "根拠の順序"],
    ["Fixed", "system.auto.pkncex.5", "Fixed", "Fixe", "ثابتة", "固定"],
    ["Focal anchor", "system.auto.1wud6vv.12", "Focal anchor", "Point focal", "نقطة التركيز", "注目点"],
    ["Gloss", "system.auto.14tbeqh.5", "Gloss", "Brillant", "لامع", "光沢"],
    ["Goal A", "system.auto.1aq686x.6", "Goal A", "Objectif A", "هدف A", "Aの目標"],
    ["Goal B", "system.auto.19w7f40.6", "Goal B", "Objectif B", "هدف B", "Bの目標"],
    ["Low key", "system.auto.bafzm2.7", "Low key", "Éclairage à dominante sombre", "إضاءة قاتمة", "ローキー"],
    ["Lower left", "system.auto.8hyuaj.10", "Lower left", "En bas à gauche", "أسفل اليسار", "左下"],
    ["Lower right", "system.auto.1bwd1yc.11", "Lower right", "En bas à droite", "أسفل اليمين", "右下"],
    ["Matte", "system.auto.hl2uwa.5", "Matte", "Mat", "غير لامع", "マット"],
    ["Metal", "system.auto.1az9fgc.5", "Metal", "Métal", "معدن", "金属"],
    ["Moderate", "system.auto.2xnnkw.8", "Moderate", "Modéré", "معتدلة", "中程度"],
    ["Obstacle", "system.auto.km6rtw.8", "Obstacle", "Obstacle", "العائق", "障害"],
    ["Pan", "system.auto.1e1inbg.3", "Pan", "Panoramique", "تحريك أفقي", "パン"],
    ["Participant A", "system.auto.1cijbgx.13", "Participant A", "Participant A", "المشارك A", "参加者A"],
    ["Participant B", "system.auto.1bokie0.13", "Participant B", "Participant B", "المشارك B", "参加者B"],
    ["Peak", "system.auto.8bmotu.4", "Peak", "Pic", "الذروة", "ピーク"],
    ["Piano", "system.auto.alxfi.5", "Piano", "Piano", "بيانو", "ピアノ"],
    ["Proportions", "system.auto.1jpqouk.11", "Proportions", "Proportions", "النِّسب", "比率"],
    ["Push in", "system.auto.myuwvg.7", "Push in", "Travelling avant", "اقتراب الكاميرا", "ドリーイン"],
    ["Result", "system.auto.ma0s3o.6", "Result", "Résultat", "النتيجة", "結果"],
    ["Reveal", "system.auto.1g28iy8.6", "Reveal", "Révélation", "الكشف", "種明かし"],
    ["Reveal frame", "system.auto.mnenfh.12", "Reveal frame", "Image de la révélation", "إطار الكشف", "種明かしのコマ"],
    ["Reversal", "system.auto.1wht84v.8", "Reversal", "Retournement", "انقلاب الأحداث", "どんでん返し"],
    ["Secret", "system.auto.1bvo9wx.6", "Secret", "Secret", "السر", "秘密"],
    ["Secret known", "system.auto.ynykiy.12", "Secret known", "Secret connu", "السر معروف", "秘密を知っている"],
    ["Secret known by", "system.auto.3n8txz.15", "Secret known by", "Secret connu de", "من يعرف السر", "秘密を知る人物"],
    ["Secret unknown", "system.auto.pyhhib.14", "Secret unknown", "Secret inconnu", "السر غير معروف", "秘密を知らない"],
    ["Setup", "system.auto.2a2wnq.5", "Setup", "Mise en place", "التمهيد", "導入"],
    ["Slow", "system.auto.1tyvniw.4", "Slow", "Lent", "بطيئة", "ゆっくり"],
    ["Soft light", "system.auto.1addag9.10", "Soft light", "Lumière douce", "إضاءة ناعمة", "柔らかい光"],
    ["Still", "system.auto.ug8twx.5", "Still", "Immobile", "ساكنة", "静止"],
    ["Strings", "system.auto.1jftewh.7", "Strings", "Cordes", "آلات وترية", "弦楽器"],
    ["Synth", "system.auto.s9h2pl.5", "Synth", "Synthétiseur", "مُركِّب صوتي", "シンセサイザー"],
    ["Tension", "system.auto.9cicel.7", "Tension", "Tension", "التوتر", "緊張感"],
    ["Upper left", "system.auto.73h3ow.10", "Upper left", "En haut à gauche", "أعلى اليسار", "左上"],
    ["Upper right", "system.auto.v4ur1h.11", "Upper right", "En haut à droite", "أعلى اليمين", "右上"],
    ["Fixture complete", "system.auto.10ors25.16", "Fixture complete", "Scénario de test terminé", "اكتمل سيناريو الاختبار", "テスト用シナリオ完了"],
    ["Fixture · No Document", "system.auto.1nfidt3.21", "Fixture · No Document", "Scénario de test · Aucun document", "سيناريو اختبار · بلا مستند", "テスト用シナリオ · ドキュメントなし"],
    ["Fixture · No generation", "system.auto.9qpw4.23", "Fixture · No generation", "Scénario de test · Aucune génération", "سيناريو اختبار · بدون توليد", "テスト用シナリオ · 生成なし"],
    ["Ready · Fixture", "system.auto.58o9us.15", "Ready · Fixture", "Prêt · Scénario de test", "جاهز · سيناريو اختبار", "準備完了 · テスト用シナリオ"],
    ["Run fixture", "system.auto.165xiqb.11", "Run fixture", "Exécuter le scénario de test", "تشغيل سيناريو الاختبار", "テスト用シナリオを実行"],
    ["Running fixture", "system.auto.12xu98t.15", "Running fixture", "Exécution du scénario de test", "جارٍ تشغيل سيناريو الاختبار", "テスト用シナリオを実行中"],
  ];
  class Element extends EventTarget {
    attributes = new Map();
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
  }
  const originals = new Map(["HTMLElement", "customElements", "document", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const registry = new Map(), document = new EventTarget(); document.documentElement = new Element();
  const root = new URL("../", import.meta.url).href;
  let controller, resolver, facade, priorLocale;
  try {
    Object.assign(globalThis, { HTMLElement: Element, document, localStorage: { setItem() {}, getItem() { return null; } }, customElements: { get: name => registry.get(name), define(name, constructor) { registry.set(name, constructor); } } });
    resolver = registerHooks({ resolve(specifier, context, next) { return next(context.parentURL?.startsWith(root) && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context); } });
    const { formaSystemMessageId } = await import("../src/components/design-system/system-message-id.ts");
    const catalogs = {
      en: (await import("../src/components/design-system/locales/system-en.ts")).default,
      fr: (await import("../src/components/design-system/locales/system-fr.ts")).default,
      ar: (await import("../src/components/design-system/locales/system-ar.ts")).default,
      ja: (await import("../src/components/design-system/locales/system-ja.ts")).default,
    };
    facade = await import("../src/components/design-system/localization.ts");
    priorLocale = facade.currentFormaLocale();
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.equal(additions.length, 96);
    assert.equal(new Set(additions.map(row => row[0])).size, 96);
    assert.equal(new Set(additions.map(row => row[1])).size, 96, "no automatic-ID collision within the complete addition");
    for (const [source, id, ...translations] of additions) {
      assert.equal(formaSystemMessageId(source), id, source);
      assert.equal(formaSystemMessageId(" \t" + source + " \n"), id, "the same source normalization must retain its ID");
      assert.equal(translations[0], source);
      for (const [index, locale] of ["en", "fr", "ar", "ja"].entries()) {
        const translated = translations[index];
        assert.equal(typeof translated, "string"); assert.ok(translated.length > 0);
        assert.equal(Object.hasOwn(catalogs[locale], id), true, locale + ": " + source);
        assert.equal(catalogs[locale][id], translated, locale + ": " + source);
        assert.deepEqual(placeholders(translated), placeholders(source), locale + ": " + source);
      }
    }
    assert.equal(facade.FormaLocaleController, FormaLocaleController);
    const host = new Host(); controller = new facade.FormaLocaleController(host); controller.hostConnected();
    for (const [index, locale] of ["en", "fr", "ar", "ja"].entries()) {
      const beforeLocale = host.updates;
      const active = await facade.setFormaLocale(locale, { persist: false, formatLocale: locale, timeZone: "UTC" });
      assert.equal(active.locale, locale); assert.equal(controller.locale, locale);
      assert.equal(controller.messages, active.messages); assert.ok(host.updates > beforeLocale);
      const values = { label: "A {number} 文", number: controller.number(7), opening: controller.number(25), peak: controller.number(80), ending: controller.number(40) };
      for (const [source, id, ...translations] of additions) {
        // EN intentionally uses the unchanged facade's English source fallback;
        // FR/AR/JA must actually obtain these IDs from the selected locale.
        if (locale !== "en") assert.equal(active.messages[id], translations[index], locale + ": " + source);
        const expected = translations[index].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
        assert.equal(controller.system(source, values), expected, locale + ": " + source);
      }
    }
  } finally {
    try { controller?.hostDisconnected(); }
    finally {
      try {
        if (facade && priorLocale) {
          const restored = await facade.setFormaLocale(priorLocale.locale, { persist: false, formatLocale: priorLocale.formatLocale, timeZone: priorLocale.timeZone });
          assert.equal(restored.locale, priorLocale.locale);
          assert.equal(restored.formatLocale, priorLocale.formatLocale);
          assert.equal(restored.timeZone, priorLocale.timeZone);
        }
      } finally {
        try { resolver?.deregister(); }
        finally { for (const [key, original] of originals) { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; } }
      }
    }
  }
});
