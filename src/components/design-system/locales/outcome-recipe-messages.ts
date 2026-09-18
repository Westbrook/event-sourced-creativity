import type { FormaSupportedLocale } from "../language-options.ts";
import type { OutcomeRecipeId, OutcomeRecipeStep } from "../../../model/outcome-recipes.ts";
import type { OutcomeArrangementIssue } from "../../../canvas/outcome-arrangements.ts";

export type OutcomeRecipeLocale = FormaSupportedLocale["locale"];
export type OutcomeRecipeCopy = {
  readonly title: string;
  readonly description: string;
  readonly steps: Readonly<Record<OutcomeRecipeStep, string>>;
};
export type OutcomeDeskCopy = {
  readonly heading: string; readonly hint: string; readonly back: string;
  readonly choose: string; readonly unavailable: string; readonly noAction: string;
  readonly recipes: string; readonly noRecipe: string; readonly recipeHint: string;
  readonly guide: string; readonly otherWays: string; readonly next: string;
  readonly dismiss: string; readonly restore: string;
  readonly arrangement: string; readonly arrangementHint: string; readonly apply: string;
  readonly cancel: string; readonly close: string; readonly retrieve: string; readonly submittedHint: string; readonly source: string; readonly from: string; readonly to: string;
  readonly recipesById: Readonly<Record<OutcomeRecipeId, OutcomeRecipeCopy>>;
  readonly issues: Readonly<Record<OutcomeArrangementIssue, string>>;
};

/** Complete local catalogs; no English system-message fallback in another locale. */
export const OUTCOME_RECIPE_MESSAGES: Readonly<Record<OutcomeRecipeLocale, OutcomeDeskCopy>> = {
  en: {
    heading: "Outcome Desk", hint: "The same document and saved work, with the next action for the object you select.",
    back: "Back to Canvas", choose: "Select the document or a saved result to see its next action.",
    unavailable: "That exact object is no longer available here. Select a current object; nothing else was substituted.",
    noAction: "No current next action is available for this object. You can still inspect its authorized details.",
    recipes: "Workflow recipes", noRecipe: "No recipe", recipeHint: "Choosing a recipe is free and changes guidance only. Sources and decisions remain human-authored.",
    guide: "Recipe guide", otherWays: "Other ways", next: "Next for this object",
    dismiss: "Dismiss this suggestion", restore: "Show suggestions again",
    arrangement: "Review this named arrangement",
    arrangementHint: "Only the positions of these existing cards change. This is free, keeps their identities and sources, and uses one undo operation. Visual order does not set narrative order or context.",
    apply: "Use this arrangement · free", cancel: "Cancel arrangement", close: "Close review", retrieve: "Check this same request", submittedHint: "This request was submitted. Check its existing status to learn the result. Closing this review does not cancel it or create a replacement.", source: "Existing card", from: "Current position", to: "Proposed position",
    recipesById: {
      "executive-deck": {
        title: "Executive deck", description: "A presentation map for existing evidence, decisions and deck results.",
        steps: {
          inspect: "Inspect the selected document, its claims, evidence and any saved deck.",
          author: "Confirm the audience, purpose, exclusions and intended decision in the existing editor. Do not invent missing facts.",
          prepare: "Choose Slides and an existing style preset in output settings. Review the exact request before any generation.",
          review: "Check the saved deck's layout and source coverage, then use the review controls available for that exact revision. Shared-project approval requires an eligible independent reviewer; approval of your own work is not independent review.",
          deliver: "Open the exact approved revision in the existing delivery or export flow.",
        },
      },
      campaign: {
        title: "Campaign", description: "A view of existing brand decisions and independently created campaign outputs.",
        steps: {
          inspect: "Inspect the existing brand, audience, message, constraints and saved outputs.",
          author: "Confirm source edits and any reused input in the existing editor. Cards from another document are not automatically shared inputs.",
          prepare: "Choose one output at a time: image, slides, narrative or scene. Optional siblings do not become prerequisites.",
          review: "Review the actual saved revision for the selected medium, its rights and its current sources.",
          deliver: "Use the existing authorized delivery action for that approved output. Each sibling keeps its own state.",
        },
      },
      "film-continuity": {
        title: "Film and continuity", description: "Inspect existing scenes, frames, continuity decisions and separate audio.",
        steps: {
          inspect: "Inspect existing scene text, character decisions, storyboard frames and audio references.",
          author: "Confirm continuity inputs, scene order and exclusions in the existing editor. A visual row does not set narrative order.",
          prepare: "Choose scene, storyboard, video or audio settings. Each new generation requires its own exact approval.",
          review: "Inspect the playable retained units and incomplete work. Check source freshness and the requested audio contract.",
          deliver: "Deliver existing authorized outputs. Managed video is an ordered scene reel, not an assembled final film.",
        },
      },
    },
    issues: {
      expired: "This preview expired. Nothing was applied. Review a fresh preview before confirming.",
      unavailable: "Current access does not allow this arrangement.",
      selection: "Select at least two distinct, available cards on this exact board.",
      locked: "A selected card is being edited elsewhere. No cards were moved.",
      geometry: "A selected or proposed position is invalid. No cards were moved.",
      name: "Give the arrangement a name of 1–80 characters without control characters.",
      identity: "This preview's request identity is invalid. Create a fresh preview.",
      changed: "The board, selection, source or access changed. Review a fresh preview before applying anything.",
      confirmation: "Confirm this exact preview before applying its positions.",
      "already-recorded": "This request already has an arrangement record. Inspect that receipt; do not submit a replacement.",
      "atomic-unavailable": "Applying a whole arrangement is not available safely here yet. The preview is free and nothing has changed.",
      "atomic-limit": "This selection exceeds the supported single-operation limit. Nothing was applied or split into partial changes.",
    },
  },
  fr: {
    heading: "Bureau des résultats", hint: "Le même document et les mêmes travaux enregistrés, avec l'action suivante pour l'objet choisi.",
    back: "Retour au Canvas", choose: "Sélectionnez le document ou un résultat enregistré pour voir son action suivante.",
    unavailable: "Cet objet précis n'est plus disponible ici. Choisissez un objet actuel ; aucun autre ne l'a remplacé.",
    noAction: "Aucune action suivante n'est actuellement disponible pour cet objet. Ses détails autorisés restent consultables.",
    recipes: "Parcours de travail", noRecipe: "Aucun parcours", recipeHint: "Choisir un parcours est gratuit et change seulement les conseils. Les sources et décisions restent rédigées par vous.",
    guide: "Guide du parcours", otherWays: "Autres possibilités", next: "Suite pour cet objet",
    dismiss: "Masquer cette suggestion", restore: "Afficher à nouveau les suggestions",
    arrangement: "Vérifier cette disposition nommée",
    arrangementHint: "Seules les positions de ces cartes existantes changent. Cette action gratuite conserve leurs identités et sources et s'annule en une opération. L'ordre visuel ne définit ni l'ordre narratif ni le contexte.",
    apply: "Utiliser cette disposition · gratuit", cancel: "Annuler la disposition", close: "Fermer la vérification", retrieve: "Vérifier cette même demande", submittedHint: "Cette demande a été envoyée. Consultez son état existant pour connaître le résultat. Fermer cette vérification ne l’annule pas et ne crée aucun remplacement.", source: "Carte existante", from: "Position actuelle", to: "Position proposée",
    recipesById: {
      "executive-deck": {
        title: "Présentation de direction", description: "Une carte des preuves, décisions et présentations existantes.",
        steps: {
          inspect: "Examinez le document choisi, ses affirmations, ses preuves et les présentations déjà enregistrées.",
          author: "Confirmez le public, l'objectif, les exclusions et la décision attendue dans l'éditeur existant. N'inventez pas de faits manquants.",
          prepare: "Choisissez Diapositives et un style existant dans les paramètres de sortie. Vérifiez la demande exacte avant toute génération.",
          review: "Vérifiez la mise en page et la couverture des sources du diaporama enregistré, puis utilisez les commandes de relecture disponibles pour cette révision précise. Dans un projet partagé, l’approbation exige une personne habilitée et indépendante ; approuver votre propre travail n’est pas une relecture indépendante.",
          deliver: "Ouvrez la révision exacte approuvée dans le parcours existant de livraison ou d'export.",
        },
      },
      campaign: {
        title: "Campagne", description: "Une vue des décisions de marque existantes et des résultats créés séparément.",
        steps: {
          inspect: "Examinez la marque, le public, le message, les contraintes et les résultats déjà enregistrés.",
          author: "Confirmez les modifications de sources et les éléments réutilisés dans l'éditeur existant. Les cartes d'un autre document ne deviennent pas automatiquement des entrées partagées.",
          prepare: "Choisissez un résultat à la fois : image, diapositives, récit ou scène. Les résultats facultatifs ne deviennent pas des prérequis.",
          review: "Relisez la révision effectivement enregistrée pour le format choisi, ses droits et ses sources actuelles.",
          deliver: "Utilisez l'action de livraison autorisée existante pour ce résultat approuvé. Chaque autre résultat conserve son propre état.",
        },
      },
      "film-continuity": {
        title: "Film et continuité", description: "Examinez les scènes, images, décisions de continuité et éléments audio distincts existants.",
        steps: {
          inspect: "Examinez les scènes écrites, les décisions sur les personnages, les images du storyboard et les références audio existantes.",
          author: "Confirmez les entrées de continuité, l'ordre des scènes et les exclusions dans l'éditeur existant. Une rangée visuelle ne définit pas l'ordre narratif.",
          prepare: "Choisissez les paramètres de scène, storyboard, vidéo ou audio. Chaque nouvelle génération nécessite son approbation exacte.",
          review: "Examinez les éléments conservés qui sont lisibles et le travail incomplet. Vérifiez l'actualité des sources et les exigences audio demandées.",
          deliver: "Livrez les résultats existants autorisés. La vidéo gérée est une suite ordonnée de scènes, pas un film final monté.",
        },
      },
    },
    issues: {
      expired: "Cet aperçu a expiré. Rien n’a été appliqué. Vérifiez un nouvel aperçu avant de confirmer.",
      unavailable: "L'accès actuel n'autorise pas cette disposition.",
      selection: "Sélectionnez au moins deux cartes distinctes et disponibles sur ce tableau précis.",
      locked: "Une carte choisie est en cours de modification ailleurs. Aucune carte n'a été déplacée.",
      geometry: "Une position choisie ou proposée est invalide. Aucune carte n'a été déplacée.",
      name: "Nommez la disposition avec 1 à 80 caractères, sans caractères de contrôle.",
      identity: "L'identité de la demande est invalide. Créez un nouvel aperçu.",
      changed: "Le tableau, la sélection, la source ou l'accès a changé. Vérifiez un nouvel aperçu avant toute application.",
      confirmation: "Confirmez cet aperçu précis avant d'appliquer ses positions.",
      "already-recorded": "Cette demande possède déjà un enregistrement de disposition. Examinez ce reçu sans soumettre de remplacement.",
      "atomic-unavailable": "L'application sûre d'une disposition entière n'est pas encore disponible ici. L'aperçu est gratuit et rien n'a changé.",
      "atomic-limit": "La sélection dépasse la limite d'une seule opération prise en charge. Rien n'a été appliqué ni divisé en modifications partielles.",
    },
  },
  ar: {
    heading: "مكتب النتائج", hint: "المستند نفسه والعمل المحفوظ نفسه، مع الخطوة التالية للعنصر الذي تختاره.",
    back: "العودة إلى اللوحة", choose: "اختر المستند أو نتيجة محفوظة لعرض خطوتها التالية.",
    unavailable: "لم يعد هذا العنصر المحدد متاحًا هنا. اختر عنصرًا حاليًا؛ لم يُستبدل بأي عنصر آخر.",
    noAction: "لا تتوفر حاليًا خطوة تالية لهذا العنصر. ما زال بإمكانك فحص التفاصيل المسموح لك بها.",
    recipes: "مسارات العمل", noRecipe: "دون مسار", recipeHint: "اختيار المسار مجاني ويغيّر الإرشادات فقط. تظل المصادر والقرارات من تأليفك.",
    guide: "دليل المسار", otherWays: "طرق أخرى", next: "الخطوة التالية لهذا العنصر",
    dismiss: "إخفاء هذا الاقتراح", restore: "إظهار الاقتراحات مجددًا",
    arrangement: "مراجعة هذا الترتيب المسمّى",
    arrangementHint: "تتغير مواضع هذه البطاقات الموجودة فقط. الإجراء مجاني ويحافظ على هوياتها ومصادرها ويمكن التراجع عنه بعملية واحدة. لا يحدد الترتيب المرئي ترتيب السرد أو السياق.",
    apply: "استخدام هذا الترتيب · مجانًا", cancel: "إلغاء الترتيب", close: "إغلاق المراجعة", retrieve: "التحقق من الطلب نفسه", submittedHint: "أُرسل هذا الطلب. تحقق من حالته الحالية لمعرفة النتيجة. إغلاق هذه المراجعة لا يلغيه ولا ينشئ طلبًا بديلًا.", source: "البطاقة الموجودة", from: "الموضع الحالي", to: "الموضع المقترح",
    recipesById: {
      "executive-deck": {
        title: "عرض تنفيذي", description: "خريطة للعروض تربط بصريًا الأدلة والقرارات والعروض الموجودة.",
        steps: {
          inspect: "افحص المستند المحدد وادعاءاته وأدلته وأي عرض محفوظ.",
          author: "أكد الجمهور والغرض والاستثناءات والقرار المقصود في المحرر الحالي. لا تختلق الحقائق الناقصة.",
          prepare: "اختر الشرائح ونمطًا موجودًا في إعدادات المخرج. راجع الطلب المحدد قبل أي توليد.",
          review: "راجع تخطيط العرض المحفوظ وتغطيته للمصادر، ثم استخدم أدوات المراجعة المتاحة لهذه النسخة بعينها. يتطلب الاعتماد في مشروع مشترك مراجعًا مستقلًا مؤهلًا؛ واعتماد عملك بنفسك ليس مراجعة مستقلة.",
          deliver: "افتح النسخة المعتمدة بعينها في مسار التسليم أو التصدير الحالي.",
        },
      },
      campaign: {
        title: "حملة", description: "عرض لقرارات العلامة التجارية الموجودة ومخرجات الحملة المنشأة بشكل مستقل.",
        steps: {
          inspect: "افحص العلامة التجارية والجمهور والرسالة والقيود والمخرجات المحفوظة الحالية.",
          author: "أكد تعديلات المصادر وأي مدخل معاد استخدامه في المحرر الحالي. لا تتحول بطاقات مستند آخر تلقائيًا إلى مدخلات مشتركة.",
          prepare: "اختر مخرجًا واحدًا كل مرة: صورة أو شرائح أو سردًا أو مشهدًا. لا تصبح المخرجات الاختيارية متطلبات مسبقة.",
          review: "راجع النسخة المحفوظة الفعلية للوسيط المحدد وحقوقها ومصادرها الحالية.",
          deliver: "استخدم إجراء التسليم الحالي المصرح به لهذا المخرج المعتمد. يحتفظ كل مخرج آخر بحالته الخاصة.",
        },
      },
      "film-continuity": {
        title: "الفيلم والاستمرارية", description: "افحص المشاهد والإطارات وقرارات الاستمرارية والصوت المنفصل الموجودة.",
        steps: {
          inspect: "افحص نصوص المشاهد وقرارات الشخصيات وإطارات لوحة القصة والمراجع الصوتية الموجودة.",
          author: "أكد مدخلات الاستمرارية وترتيب المشاهد والاستثناءات في المحرر الحالي. لا يحدد الصف المرئي ترتيب السرد.",
          prepare: "اختر إعدادات المشهد أو لوحة القصة أو الفيديو أو الصوت. يتطلب كل توليد جديد موافقته المحددة.",
          review: "افحص الوحدات المحفوظة القابلة للتشغيل والعمل غير المكتمل. تحقق من حداثة المصادر ومتطلبات الصوت المطلوبة.",
          deliver: "سلّم المخرجات الموجودة المصرح بها. الفيديو المُدار سلسلة مشاهد مرتبة، وليس فيلمًا نهائيًا مركبًا.",
        },
      },
    },
    issues: {
      expired: "انتهت صلاحية هذه المعاينة. لم يُطبق شيء. راجع معاينة جديدة قبل التأكيد.",
      unavailable: "لا تسمح صلاحيات الوصول الحالية بهذا الترتيب.",
      selection: "اختر بطاقتين مختلفتين متاحتين على الأقل في هذه اللوحة بعينها.",
      locked: "يجري تعديل إحدى البطاقات المختارة في مكان آخر. لم تُنقل أي بطاقة.",
      geometry: "أحد المواضع المختارة أو المقترحة غير صالح. لم تُنقل أي بطاقة.",
      name: "امنح الترتيب اسمًا من ١ إلى ٨٠ حرفًا دون محارف تحكم.",
      identity: "هوية طلب المعاينة غير صالحة. أنشئ معاينة جديدة.",
      changed: "تغيرت اللوحة أو التحديد أو المصدر أو الصلاحيات. راجع معاينة جديدة قبل تطبيق أي شيء.",
      confirmation: "أكد هذه المعاينة بعينها قبل تطبيق مواضعها.",
      "already-recorded": "لهذا الطلب سجل ترتيب بالفعل. افحص الإيصال ولا ترسل طلبًا بديلًا.",
      "atomic-unavailable": "لا يتوفر هنا بعد تطبيق آمن للترتيب بالكامل. المعاينة مجانية ولم يتغير شيء.",
      "atomic-limit": "يتجاوز التحديد الحد المدعوم لعملية واحدة. لم يُطبق شيء ولم يُقسم إلى تغييرات جزئية.",
    },
  },
  ja: {
    heading: "成果デスク", hint: "同じドキュメントと保存済みの成果を使い、選択した対象の次の操作を表示します。",
    back: "Canvasに戻る", choose: "ドキュメントまたは保存済みの結果を選ぶと、次の操作を表示します。",
    unavailable: "この対象は現在ここで利用できません。別の対象に置き換えていません。現在の対象を選んでください。",
    noAction: "この対象に現在利用できる次の操作はありません。権限のある詳細は引き続き確認できます。",
    recipes: "作業のレシピ", noRecipe: "レシピなし", recipeHint: "レシピの選択は無料で、案内だけが変わります。ソースと意思決定は引き続き人が作成します。",
    guide: "レシピの手順", otherWays: "その他の方法", next: "この対象の次の操作",
    dismiss: "この提案を非表示", restore: "提案を再表示",
    arrangement: "名前付き配置を確認",
    arrangementHint: "既存のカードの位置だけを変えます。無料で、識別子とソースを保持し、1回の操作で元に戻せます。見た目の順序から物語の順序やコンテキストを設定することはありません。",
    apply: "この配置を使用 · 無料", cancel: "配置をキャンセル", close: "確認を閉じる", retrieve: "同じリクエストの状態を確認", submittedHint: "このリクエストは送信済みです。既存の状態を確認して結果を確認してください。この画面を閉じても取り消しや代替リクエストの作成は行いません。", source: "既存のカード", from: "現在の位置", to: "提案された位置",
    recipesById: {
      "executive-deck": {
        title: "経営層向けプレゼンテーション", description: "既存の根拠、意思決定、デッキの成果を見渡すプレゼンテーションマップ。",
        steps: {
          inspect: "選択したドキュメントの主張、根拠、保存済みのデッキを確認します。",
          author: "既存のエディターで対象者、目的、除外事項、求める意思決定を確認します。不足している事実を作り出さないでください。",
          prepare: "出力設定でスライドと既存のスタイルを選びます。生成前に正確なリクエストを確認します。",
          review: "保存済みデッキのレイアウトとソースの網羅性を確認し、その版に対して利用できるレビュー操作を使ってください。共有プロジェクトでの承認には、要件を満たす独立したレビュアーが必要です。自分の作業を自分で承認することは、独立したレビューにはなりません。",
          deliver: "承認された正確な版を、既存の納品またはエクスポート手順で開きます。",
        },
      },
      campaign: {
        title: "キャンペーン", description: "既存のブランドに関する決定と、個別に作成されたキャンペーン成果を表示します。",
        steps: {
          inspect: "既存のブランド、対象者、メッセージ、制約、保存済みの成果を確認します。",
          author: "既存のエディターでソースの編集と再利用する入力を確認します。別のドキュメントのカードが自動的に共有入力になることはありません。",
          prepare: "画像、スライド、物語、シーンから一度に1つの出力を選びます。任意の別出力が必須条件になることはありません。",
          review: "選択した形式の実際に保存された版、その権利、現在のソースをレビューします。",
          deliver: "承認された出力に対して、既存の許可された納品操作を使います。別の出力はそれぞれ独自の状態を保ちます。",
        },
      },
      "film-continuity": {
        title: "映画と連続性", description: "既存のシーン、フレーム、連続性の決定、個別の音声を確認します。",
        steps: {
          inspect: "既存のシーン本文、キャラクターの決定、絵コンテのフレーム、音声の参照を確認します。",
          author: "既存のエディターで連続性の入力、シーン順、除外事項を確認します。見た目の横並びは物語の順序を設定しません。",
          prepare: "シーン、絵コンテ、動画、音声の設定を選びます。新しい生成には、そのリクエストごとの明示的な承認が必要です。",
          review: "再生可能な保存済みの部分と未完了の作業を確認します。ソースの鮮度と要求された音声条件を確認します。",
          deliver: "許可された既存の成果を納品します。管理された動画は順序付きのシーンリールであり、編集済みの完成映画ではありません。",
        },
      },
    },
    issues: {
      expired: "このプレビューは期限切れです。何も適用していません。確認する前に新しいプレビューを確認してください。",
      unavailable: "現在のアクセス権ではこの配置を適用できません。",
      selection: "このボードにある利用可能なカードを、重複なく2つ以上選んでください。",
      locked: "選択したカードは別の場所で編集中です。カードは移動していません。",
      geometry: "選択中または提案された位置が無効です。カードは移動していません。",
      name: "制御文字を含まない1〜80文字の配置名を付けてください。",
      identity: "プレビューのリクエストIDが無効です。新しいプレビューを作成してください。",
      changed: "ボード、選択、ソース、または権限が変わりました。適用前に新しいプレビューを確認してください。",
      confirmation: "位置を適用する前に、この正確なプレビューを確認してください。",
      "already-recorded": "このリクエストの配置記録はすでに存在します。記録を確認し、代わりのリクエストを送信しないでください。",
      "atomic-unavailable": "配置全体を安全に適用する機能はここではまだ利用できません。プレビューは無料で、何も変更していません。",
      "atomic-limit": "選択が一括操作で対応できる上限を超えています。部分的な適用や分割は行っていません。",
    },
  },
};

export function outcomeDeskCopy(locale: string): OutcomeDeskCopy {
  return OUTCOME_RECIPE_MESSAGES[locale as OutcomeRecipeLocale] ?? OUTCOME_RECIPE_MESSAGES.en;
}
