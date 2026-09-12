import { FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES } from "./output-delivery-runtime-messages.ts";
import { FORMA_OUTPUT_DELIVERY_CYCLE_MESSAGES } from "./output-delivery-cycle-messages.ts";

/** Output delivery interface copy. Tuple order is English, French, Arabic, Japanese. */
const entries = {
  "output.delivery.packageEveryPart": ["Download every part below. A single part is not the whole package.", "Téléchargez chaque partie ci-dessous. Une seule partie ne constitue pas le paquet entier.", "نزّل جميع الأجزاء أدناه. الجزء الواحد ليس الحزمة الكاملة.", "以下のすべてのパートをダウンロードしてください。1つのパートだけではパッケージ全体になりません。"],
  "output.delivery.recordedPackage": ["Recorded package", "Paquet enregistré", "الحزمة المسجّلة", "記録済みパッケージ"],
  "output.delivery.downloadRecordedPackage": ["Prepare recorded package", "Préparer le paquet enregistré", "تجهيز الحزمة المسجّلة", "記録済みパッケージを準備"],
  "output.delivery.packageDownloading": ["Preparing the recorded package…", "Préparation du paquet enregistré…", "جارٍ تجهيز الحزمة المسجّلة…", "記録済みパッケージを準備中…"],
  "output.delivery.savePreparedPackage": ["Save prepared package", "Enregistrer le paquet préparé", "حفظ الحزمة المجهّزة", "準備済みパッケージを保存"],
  "output.delivery.preparePackagePart": ["Prepare part {part} of {total}", "Préparer la partie {part} sur {total}", "تجهيز الجزء {part} من {total}", "パート{part}/{total}を準備"],
  "output.delivery.savePreparedPart": ["Save prepared part {part} of {total}", "Enregistrer la partie préparée {part} sur {total}", "حفظ الجزء المجهّز {part} من {total}", "準備済みパート{part}/{total}を保存"],
  "output.delivery.packagePrepared": ["Package prepared. Use the save link below to save the file to your device.", "Paquet préparé. Utilisez le lien ci-dessous pour enregistrer le fichier sur votre appareil.", "تم تجهيز الحزمة. استخدم رابط الحفظ أدناه لحفظ الملف على جهازك.", "パッケージの準備ができました。下の保存リンクから端末にファイルを保存してください。"],
  "output.delivery.packageRecorded": [
    "Package recorded. Download it below; file delivery is not yet confirmed. Keep this page open until the download finishes.",
    "Paquet enregistré. Téléchargez-le ci-dessous ; la réception du fichier n’est pas encore confirmée. Gardez cette page ouverte jusqu’à la fin du téléchargement.",
    "تم تسجيل الحزمة. نزّلها أدناه؛ لم يُؤكَّد استلام الملف بعد. أبقِ هذه الصفحة مفتوحة حتى يكتمل التنزيل.",
    "パッケージを記録しました。下からダウンロードしてください。ファイルの受け取りはまだ確認されていません。完了するまでこのページを開いたままにしてください。",
  ],
  "output.delivery.packageChecksPending": [
    "Package recorded. Refresh checks to download it. No new export is needed; keep this page open.",
    "Paquet enregistré. Actualisez les vérifications pour le télécharger. Aucun nouvel export n’est nécessaire ; gardez cette page ouverte.",
    "تم تسجيل الحزمة. حدّث الفحوص لتنزيلها. لا حاجة إلى تصدير جديد؛ أبقِ هذه الصفحة مفتوحة.",
    "パッケージを記録しました。チェックを更新してダウンロードしてください。再エクスポートは不要です。このページを開いたままにしてください。",
  ],
  "output.delivery.packageDownloadRequested": [
    "Save requested. Check your browser’s downloads. The prepared file remains available below.",
    "Enregistrement demandé. Vérifiez les téléchargements de votre navigateur. Le fichier préparé reste disponible ci-dessous.",
    "تم طلب الحفظ. تحقّق من تنزيلات المتصفح. يظل الملف المجهّز متاحًا أدناه.",
    "保存を要求しました。ブラウザーのダウンロードを確認してください。準備済みファイルは引き続き下から保存できます。",
  ],
  "output.delivery.packageDownloadFailed": [
    "The download did not finish. Download this same recorded package again; no new export is needed.",
    "Le téléchargement n’a pas abouti. Téléchargez à nouveau ce même paquet enregistré ; aucun nouvel export n’est nécessaire.",
    "لم يكتمل التنزيل. نزّل الحزمة المسجّلة نفسها مجددًا؛ لا حاجة إلى تصدير جديد.",
    "ダウンロードが完了しませんでした。同じ記録済みパッケージを再度ダウンロードしてください。再エクスポートは不要です。",
  ],
  "output.delivery.packageReceiptOnly": [
    "Export recorded, but package details are unavailable. No download was started. Refresh checks; do not repeat the export to recover it.",
    "Export enregistré, mais les détails du paquet sont indisponibles. Aucun téléchargement n’a démarré. Actualisez les vérifications ; ne répétez pas l’export pour le récupérer.",
    "تم تسجيل التصدير، لكن تفاصيل الحزمة غير متاحة. لم يبدأ أي تنزيل. حدّث الفحوص؛ لا تكرّر التصدير لاستعادته.",
    "エクスポートを記録しましたが、パッケージの詳細を利用できません。ダウンロードは開始していません。チェックを更新してください。復旧のために再エクスポートしないでください。",
  ],
  "output.delivery.model3dExactPrompt": ["Exact prompt sent to Rodin", "Instruction exacte envoyée à Rodin", "النص الدقيق المرسل إلى Rodin", "Rodinに送信する正確なプロンプト"],
  "output.delivery.model3dSettings": ["3D settings: {format}; {tier}; materials {material}; mesh {mesh}.", "Réglages 3D : {format} ; {tier} ; matériaux {material} ; maillage {mesh}.", "إعدادات النموذج ثلاثي الأبعاد: {format}؛ {tier}؛ المواد {material}؛ الشبكة {mesh}.", "3D設定：{format}、{tier}、マテリアル{material}、メッシュ{mesh}。"],
  "output.delivery.model3dDefaults": ["Automatic texture detail, random seed, no paid add-ons. Review each mesh and its materials; generated models may need cleanup before production use.", "Détail des textures automatique, graine aléatoire, aucun supplément payant. Vérifiez chaque maillage et ses matériaux ; les modèles générés peuvent nécessiter des retouches avant utilisation.", "تفاصيل نسيج تلقائية وبذرة عشوائية دون إضافات مدفوعة. راجع كل شبكة وموادها؛ قد تحتاج النماذج المولدة إلى تنقيح قبل استخدامها في الإنتاج.", "テクスチャの詳細は自動、シードはランダム、有料追加機能はありません。各メッシュとマテリアルを確認してください。生成モデルは本番利用前に修正が必要な場合があります。"],
  "output.delivery.model3dReferences": ["Ordered reference images ({count})", "Images de référence dans l’ordre ({count})", "الصور المرجعية بالترتيب ({count})", "順序付き参照画像（{count}件）"],
  "output.delivery.model3dNoReferences": ["Text-to-3D: no reference images are sent.", "Texte vers 3D : aucune image de référence n’est envoyée.", "من النص إلى نموذج ثلاثي الأبعاد: لا تُرسل صور مرجعية.", "テキストから3D：参照画像は送信されません。"],
  "output.delivery.contextDocumentIdentity": ["Document {identity}", "Document {identity}", "المستند {identity}", "ドキュメント {identity}"],
  "output.delivery.contextRequirement": ["Requirement {number}: {name}","Exigence {number} : {name}","المتطلب {number}: {name}","要件{number}: {name}"],
  "output.delivery.contextRequirementIdentity": ["Requirement: {name} ({identity})","Exigence : {name} ({identity})","المتطلب: {name} ({identity})","要件: {name}（{identity}）"],
  "output.delivery.contextDeliverable": ["Deliverable {number}: {name}","Livrable {number} : {name}","المخرج {number}: {name}","成果物{number}: {name}"],
  "output.delivery.contextFormat": ["Format {number}: {name}","Format {number} : {name}","الصيغة {number}: {name}","形式{number}: {name}"],
  "output.delivery.contextMember": ["Series member {number}: {name}","Élément de série {number} : {name}","عنصر السلسلة {number}: {name}","シリーズ項目{number}: {name}"],
  "output.delivery.contextResult": ["Result {number}: {name}","Résultat {number} : {name}","النتيجة {number}: {name}","結果{number}: {name}"],
  "output.delivery.contextTarget": ["Target {number}: {name}","Cible {number} : {name}","الهدف {number}: {name}","納品対象{number}: {name}"],
  "output.delivery.contextTargetIdentity": ["Target: {name} ({identity})","Cible : {name} ({identity})","الهدف: {name} ({identity})","納品対象: {name}（{identity}）"],
  "output.delivery.contextAuthorization": ["Authorization {number}","Autorisation {number}","الإذن {number}","実行許可{number}"],
  "output.delivery.contextAttempt": ["Attempt {number}","Tentative {number}","المحاولة {number}","試行{number}"],
  "output.delivery.contextFile": ["File {number}: {name}","Fichier {number} : {name}","الملف {number}: {name}","ファイル{number}: {name}"],
  "output.delivery.contextAction": ["Action {number}","Action {number}","الإجراء {number}","操作{number}"],
  "output.delivery.state.deliveryComplete": ["Complete", "Terminé", "مكتمل", "完了"],
  "output.delivery.state.deliveryAmended": ["Complete for the amended scope", "Terminé pour le périmètre modifié", "مكتمل للنطاق المعدّل", "改訂後の範囲で完了"],
  "output.delivery.state.deliveryPartial": ["Partial delivery", "Livraison partielle", "تسليم جزئي", "一部納品"],
  "output.delivery.scopeUnknown": [
    "Delivery scope is unknown. Refresh before acting.",
    "Le périmètre de livraison est inconnu. Actualisez avant toute action.",
    "نطاق التسليم غير معروف. حدّث البيانات قبل اتخاذ أي إجراء.",
    "納品範囲が不明です。操作する前に更新してください。",
  ],
  "output.delivery.noneRequested": [
    "No deliverables requested.", "Aucun livrable demandé.", "لم تُطلب أي مخرجات للتسليم.", "納品物は指定されていません。",
  ],
  "output.delivery.complete": [
    "All {count} required groups have accepted, current files.",
    "Les {count} groupes obligatoires disposent de fichiers acceptés et à jour.",
    "لدى جميع المجموعات المطلوبة وعددها {count} ملفات مقبولة ومحدّثة.",
    "必須の全{count}グループに、承認済みで現行の要件に合ったファイルがあります。",
  ],
  "output.delivery.progress": [
    "{done} of {total} required groups ready · {unresolved} decisions unresolved",
    "{done} groupes obligatoires prêts sur {total} · {unresolved} décisions à prendre",
    "{done} من أصل {total} مجموعات مطلوبة جاهزة · {unresolved} قرارات لم تُحسم",
    "必須の{total}グループ中{done}グループが準備完了 · 未決定の項目：{unresolved}",
  ],
  "output.delivery.cardScope": [
    "This requirement’s entire scope, including work outside the selected run.",
    "Tout le périmètre de cette exigence, y compris le travail hors de l’exécution sélectionnée.",
    "النطاق الكامل لهذا المتطلب، بما فيه العمل غير المشمول في التشغيل المحدد.",
    "選択した実行に含まれない作業も含め、この要件の全範囲を示します。",
  ],
  "output.delivery.notConfirmed": [
    "Review and confirm requirements to establish the delivery scope. This does not generate files.",
    "Examinez et confirmez les exigences pour définir le périmètre de livraison. Aucun fichier n’est généré.",
    "راجع المتطلبات وأكدها لتحديد نطاق التسليم. لا يؤدي ذلك إلى توليد ملفات.",
    "要件を確認して確定し、納品範囲を定めてください。この操作でファイルは生成されません。",
  ],
  "output.delivery.nativeHistoryOmitted": ["A completed attempt is recorded outside the recent generation list. Retrieve its original result before matching it; no new work will start.", "Une tentative terminée est enregistrée hors de la liste des générations récentes. Récupérez son résultat d’origine avant de l’associer ; aucun nouveau travail ne sera lancé.", "توجد محاولة مكتملة مسجّلة خارج قائمة التوليد الحديثة. استرجع نتيجتها الأصلية قبل ربطها؛ لن يبدأ أي عمل جديد.", "最近の生成一覧にない完了済みの試行が記録されています。関連付ける前に元の結果を取得してください。新しい作業は開始しません。"],
  "output.delivery.inspectNativeAttempt": ["Retrieve attempt {attempt} for {target} · no generation", "Récupérer la tentative {attempt} pour {target} · sans génération", "استرجاع المحاولة {attempt} للمخرج {target} · دون توليد", "{target}の試行{attempt}を取得 · 生成なし"],
  "output.delivery.nativeInspecting": ["Checking the original completed result…", "Vérification du résultat terminé d’origine…", "جارٍ التحقق من النتيجة الأصلية المكتملة…", "元の完了済み結果を確認しています…"],
  "output.delivery.nativeInspected": ["The original completed result is available to match. Matching and human review remain separate decisions.", "Le résultat terminé d’origine est disponible pour association. L’association et la validation humaine restent deux décisions distinctes.", "النتيجة الأصلية المكتملة متاحة للربط. يظل الربط والمراجعة البشرية قرارين منفصلين.", "元の完了済み結果を関連付けられます。関連付けと人によるレビューは別々の判断です。"],
  "output.delivery.nativeInspectionUnavailable": ["The original completed result is unavailable. Refresh Outputs and retrieve the same attempt again; no replacement was started.", "Le résultat terminé d’origine est indisponible. Actualisez les livrables et récupérez à nouveau la même tentative ; aucun remplacement n’a été lancé.", "النتيجة الأصلية المكتملة غير متاحة. حدّث المخرجات واسترجع المحاولة نفسها مجددًا؛ لم تبدأ أي محاولة بديلة.", "元の完了済み結果を取得できません。「納品物」を更新して同じ試行を再取得してください。代わりの生成は開始していません。"],
  "output.delivery.nativeInspectionReadOnly": ["Your current shared-project role can read Outputs but cannot retrieve your original generation job. Ask a project owner to restore generation-request permission. The recorded attempt is unchanged.", "Votre rôle actuel dans le projet partagé permet de consulter les livrables, mais pas de récupérer votre tâche de génération d’origine. Demandez à un propriétaire du projet de rétablir l’autorisation de demander des générations. La tentative enregistrée reste inchangée.", "يتيح لك دورك الحالي في المشروع المشترك قراءة المخرجات، لكنه لا يتيح استرجاع مهمة التوليد الأصلية الخاصة بك. اطلب من مالك المشروع استعادة إذن طلب التوليد. تبقى المحاولة المسجّلة دون تغيير.", "共有プロジェクトの現在の役割では「納品物」を閲覧できますが、自分の元の生成ジョブは取得できません。プロジェクトのオーナーに生成リクエスト権限の復元を依頼してください。記録された試行は変更されません。"],
  "output.delivery.file": ["File", "Fichier", "ملف", "ファイル"],
  "output.delivery.saved": [
    "Requirements saved. No generation was started.",
    "Exigences enregistrées. Aucune génération n’a été lancée.",
    "حُفظت المتطلبات. لم يبدأ أي توليد.",
    "要件を保存しました。生成は開始していません。",
  ],
  "output.delivery.confirmed": [
    "Requirements confirmed. No generation was started.",
    "Exigences confirmées. Aucune génération n’a été lancée.",
    "أُكدت المتطلبات. لم يبدأ أي توليد.",
    "要件を確定しました。生成は開始していません。",
  ],
  "output.delivery.preflightReady": [
    "Review the provider, source transfer, and maximum cost. Nothing has been generated.",
    "Vérifiez le fournisseur, le transfert des sources et le coût maximal. Rien n’a été généré.",
    "راجع المزوّد ونقل المصادر والتكلفة القصوى. لم يُولّد أي شيء.",
    "プロバイダー、送信するソース、費用上限を確認してください。まだ何も生成されていません。",
  ],
  "output.delivery.authorized": [
    "The selected work is authorized within the disclosed limits. Start it when ready.",
    "Le travail sélectionné est autorisé dans les limites indiquées. Lancez-le lorsque vous êtes prêt.",
    "أُذن بالعمل المحدد ضمن الحدود الموضّحة. ابدأ عندما تكون مستعدًا.",
    "選択した作業を、提示された上限内で許可しました。準備ができたら開始してください。",
  ],
  "output.delivery.started": [
    "The existing operations were queued. Repeating this action recovers the same operations.",
    "Les opérations existantes ont été mises en attente. Répéter cette action reprend les mêmes opérations.",
    "أُضيفت العمليات الحالية إلى قائمة الانتظار. تكرار هذا الإجراء يستعيد العمليات نفسها.",
    "既存の処理をキューに追加しました。この操作を繰り返すと、同じ処理を復旧します。",
  ],
  "output.delivery.uploaded": [
    "The file was inspected. Match it to a target, then review it; it is not accepted yet.",
    "Le fichier a été inspecté. Associez-le à un objectif, puis examinez-le ; il n’est pas encore accepté.",
    "فُحص الملف. اربطه بمخرج مطلوب ثم راجعه؛ لم يُقبل بعد.",
    "ファイルを検査しました。納品対象に関連付けてからレビューしてください。まだ承認されていません。",
  ],
  "output.delivery.bound": [
    "The exact file is matched to this target. Checks and human review determine whether it can be delivered.",
    "Ce fichier précis est associé à cet objectif. Les contrôles et la révision humaine déterminent s’il peut être livré.",
    "رُبط هذا الملف بعينه بهذا المخرج المطلوب. تحدد الفحوص والمراجعة البشرية إمكانية تسليمه.",
    "このファイルを納品対象に関連付けました。検査と人によるレビューで、納品できるかを判断します。",
  ],
  "output.delivery.accepted": [
    "This exact result was accepted for this target. Other work remains unchanged.",
    "Ce résultat précis a été accepté pour cet objectif. Les autres travaux restent inchangés.",
    "قُبلت هذه النتيجة بعينها لهذا المخرج المطلوب. لم يتغير العمل الآخر.",
    "この結果を、この納品対象に対して承認しました。他の作業は変更されません。",
  ],
  "output.delivery.changesRequested": [
    "Changes requested. This file does not fulfill the target.",
    "Modifications demandées. Ce fichier ne satisfait pas l’objectif.",
    "طُلبت تعديلات. هذا الملف لا يفي بالمخرج المطلوب.",
    "修正を依頼しました。このファイルは納品対象の要件を満たしていません。",
  ],
  "output.delivery.removed": [
    "Requirement removed. Previous results and plan history remain. Review the new scope before delivery.",
    "Exigence retirée. Les résultats précédents et l’historique du plan sont conservés. Vérifiez le nouveau périmètre avant la livraison.",
    "أُزيل المتطلب. تبقى النتائج السابقة وسجل الخطة محفوظة. راجع النطاق الجديد قبل التسليم.",
    "要件を削除しました。以前の結果と計画の履歴は残ります。納品前に新しい範囲を確認してください。",
  ],
  "output.delivery.checksFailed": ["Checks need attention", "Contrôles à examiner", "الفحوص تتطلب الانتباه", "検査結果の確認が必要"],
  "output.delivery.resultAccepted": [
    "Accepted for the recorded target revision", "Accepté pour la version enregistrée de l’objectif", "مقبول لإصدار المخرج المطلوب المسجّل", "記録された納品対象の版に対して承認済み",
  ],
  "output.delivery.resultRejected": ["Changes requested", "Modifications demandées", "تعديلات مطلوبة", "修正依頼あり"],
  "output.delivery.awaitingReview": [
    "Checks passed · awaiting human review", "Contrôles réussis · révision humaine attendue", "اجتاز الفحوص · بانتظار المراجعة البشرية", "検査合格 · 人によるレビュー待ち",
  ],
  "output.delivery.locked": [
    "This Output requirement is locked.", "Cette exigence de livrable est verrouillée.", "متطلب المخرجات هذا مقفل.", "この納品要件はロックされています。",
  ],
  "output.delivery.remove": ["Remove requirement", "Retirer l’exigence", "إزالة المتطلب", "要件を削除"],
  "output.delivery.removeImpact": [
    "Remove this obligation from the next plan? Existing files and earlier approvals remain in history; the new scope must be confirmed.",
    "Retirer cette obligation du prochain plan ? Les fichiers existants et les approbations antérieures restent dans l’historique ; le nouveau périmètre doit être confirmé.",
    "هل تريد إزالة هذا الالتزام من الخطة التالية؟ تبقى الملفات الحالية والموافقات السابقة في السجل؛ ويجب تأكيد النطاق الجديد.",
    "次の計画からこの義務を削除しますか？既存のファイルと以前の承認は履歴に残ります。新しい範囲の確定が必要です。",
  ],
  "output.delivery.cancel": ["Cancel", "Annuler", "إلغاء", "キャンセル"],
  "output.delivery.confirmRemove": ["Remove obligation", "Retirer l’obligation", "إزالة الالتزام", "義務を削除"],
  "output.delivery.reviewPlan": ["Review delivery plan", "Examiner le plan de livraison", "مراجعة خطة التسليم", "納品計画を確認"],
  "output.delivery.confirmationFree": [
    "Confirming defines the work owed. It never authorizes payment or starts generation.",
    "La confirmation définit le travail dû. Elle n’autorise jamais de paiement et ne lance aucune génération.",
    "يحدد التأكيد العمل المطلوب تسليمه. ولا يأذن بأي دفع أو يبدأ أي توليد.",
    "確定すると、納品する作業が定まります。支払いの許可や生成の開始は行いません。",
  ],
  "output.delivery.required": ["Required", "Obligatoire", "مطلوب", "必須"],
  "output.delivery.optional": ["Optional", "Facultatif", "اختياري", "任意"],
  "output.delivery.optionalSelection": [
    "Optional deliverables (off until selected)", "Livrables facultatifs (exclus tant qu’ils ne sont pas sélectionnés)", "مخرجات اختيارية (غير مفعّلة حتى تحديدها)", "任意の納品物（選択するまで無効）",
  ],
  "output.delivery.authoredRange": [
    "Authored range: {min}–{max} {unit}. A suggested aim does not change that range.",
    "Plage demandée : {min}–{max} {unit}. Une valeur visée suggérée ne modifie pas cette plage.",
    "النطاق المحدد في المتطلبات: {min}–{max} {unit}. العدد المقترح لا يغيّر هذا النطاق.",
    "指定された範囲：{min}〜{max} {unit}。推奨目標値を設定しても、この範囲は変わりません。",
  ],
  "output.delivery.delegateRange": [
    "Accept any count within the authored range", "Accepter tout nombre dans la plage demandée", "قبول أي عدد ضمن النطاق المحدد في المتطلبات", "指定された範囲内の個数を許容する",
  ],
  "output.delivery.suggestedAim": [
    "Suggested aim for the attempt", "Valeur visée suggérée pour la tentative", "العدد المقترح لهذه المحاولة", "今回の試行の推奨目標値",
  ],
  "output.delivery.finitePreview": [
    "Preview: {targets} defined file targets; {unresolved} unresolved groups remain visible.",
    "Aperçu : {targets} fichiers cibles définis ; {unresolved} groupes à préciser restent visibles.",
    "المعاينة: {targets} ملفات مطلوبة محددة؛ وتبقى {unresolved} مجموعات غير محسومة ظاهرة.",
    "プレビュー：ファイルの納品対象は{targets}件。未確定の{unresolved}グループも引き続き表示します。",
  ],
  "output.delivery.confirm": [
    "Confirm requirements · no generation", "Confirmer les exigences · sans génération", "تأكيد المتطلبات · دون توليد", "要件を確定 · 生成なし",
  ],
  "output.delivery.targetDimensions": [
    "Execution: {execution} · Checks: {checks} · Review: {review} · Freshness: {freshness}",
    "Exécution : {execution} · Contrôles : {checks} · Révision : {review} · Actualité : {freshness}",
    "التنفيذ: {execution} · الفحوص: {checks} · المراجعة: {review} · حداثة المتطلبات: {freshness}",
    "実行：{execution} · 検査：{checks} · レビュー：{review} · 要件への適合：{freshness}",
  ],
  "output.delivery.ratio": [
    "Aspect ratio: {width}:{height}", "Proportions : {width}:{height}", "نسبة العرض إلى الارتفاع: {width}:{height}", "縦横比：{width}:{height}",
  ],
  "output.delivery.matchFile": [
    "Match an inspected file to this target", "Associer un fichier inspecté à cet objectif", "ربط ملف مفحوص بهذا المخرج المطلوب", "検査済みのファイルをこの納品対象に関連付ける",
  ],
  "output.delivery.chooseFile": ["Choose a file", "Choisir un fichier", "اختيار ملف", "ファイルを選択"],
  "output.delivery.checkFile": [
    "Check file against target", "Vérifier le fichier selon l’objectif", "فحص الملف وفق متطلبات المخرج", "納品対象の要件に照らしてファイルを検査",
  ],
  "output.delivery.downloadReview": [
    "Download exact file for review", "Télécharger ce fichier précis pour révision", "تنزيل هذا الملف بعينه للمراجعة", "レビューするファイルをダウンロード",
  ],
  "output.delivery.independentReview": [
    "An independent authorized reviewer must accept this result.",
    "Un réviseur indépendant autorisé doit accepter ce résultat.",
    "يجب أن يقبل هذه النتيجة مراجع مستقل مخوّل.",
    "権限を持つ別のレビュアーによる承認が必要です。",
  ],
  "output.delivery.reviewCoverage": [
    "I reviewed content, source coverage, layout or playback, and accessibility for this exact file.",
    "J’ai examiné le contenu, la couverture des sources, la mise en page ou la lecture, ainsi que l’accessibilité de ce fichier précis.",
    "راجعت المحتوى وتغطية المصادر والتخطيط أو التشغيل وإمكانية الوصول لهذا الملف بعينه.",
    "このファイルの内容、ソースの網羅性、レイアウトまたは再生、アクセシビリティを確認しました。",
  ],
  "output.delivery.reviewRights": [
    "I confirmed current rights to use this file and its sources.",
    "J’ai confirmé les droits actuels d’utilisation de ce fichier et de ses sources.",
    "أكدت سريان حقوق استخدام هذا الملف ومصادره.",
    "このファイルとそのソースを利用する権利が現在も有効であることを確認しました。",
  ],
  "output.delivery.reviewNote": ["Review note", "Note de révision", "ملاحظة المراجعة", "レビューのメモ"],
  "output.delivery.requestChanges": ["Request changes", "Demander des modifications", "طلب تعديلات", "修正を依頼"],
  "output.delivery.acceptExact": [
    "Accept this exact result", "Accepter ce résultat précis", "قبول هذه النتيجة بعينها", "この結果を承認",
  ],
  "output.delivery.nextRun": [
    "Choose work for the next run", "Choisir le travail de la prochaine exécution", "اختيار العمل للتشغيل التالي", "次回実行する作業を選択",
  ],
  "output.delivery.runDoesNotChangeScope": [
    "This selection controls the next run. It does not remove any required work from the delivery plan.",
    "Cette sélection détermine la prochaine exécution. Elle ne retire aucun travail obligatoire du plan de livraison.",
    "يتحكم هذا التحديد في التشغيل التالي. ولا يزيل أي عمل مطلوب من خطة التسليم.",
    "この選択は次回の実行に適用されます。納品計画から必須の作業が削除されることはありません。",
  ],
  "output.delivery.selectedTargets": [
    "Targets to check for generation", "Objectifs à vérifier pour la génération", "مخرجات مطلوبة للتحقق من إمكانية توليدها", "生成の可否を確認する納品対象",
  ],
  "output.delivery.checkRun": [
    "Check availability and cost · no generation", "Vérifier la disponibilité et le coût · sans génération", "التحقق من التوفر والتكلفة · دون توليد", "利用可否と費用を確認 · 生成なし",
  ],
  "output.delivery.paidDisclosure": [
    "Provider, source transfer, and maximum cost", "Fournisseur, transfert des sources et coût maximal", "المزوّد ونقل المصادر والتكلفة القصوى", "プロバイダー、ソース送信、費用上限",
  ],
  "output.delivery.costCeiling": [
    "Maximum {amount} across at most {calls} generation calls, including bounded repairs. Charges may remain even when validation fails.",
    "Au maximum {amount} pour {calls} appels de génération au plus, corrections limitées comprises. Des frais peuvent subsister même en cas d’échec de validation.",
    "حد أقصى {amount} لما لا يزيد عن {calls} استدعاءات توليد، بما فيها الإصلاحات المحدودة. قد تبقى رسوم حتى عند فشل التحقق.",
    "修正を含め、生成呼び出しは最大{calls}回、費用は最大{amount}です。検証に失敗しても料金が発生する場合があります。",
  ],
  "output.delivery.unavailable": ["Unavailable", "Indisponible", "غير متاح", "利用不可"],
  "output.delivery.authorizeAcknowledgment": [
    "I approve this source transfer and the disclosed aggregate spending limit for these targets.",
    "J’approuve ce transfert des sources et le plafond total de dépenses indiqué pour ces objectifs.",
    "أوافق على نقل المصادر هذا وعلى حد الإنفاق الإجمالي الموضّح لهذه المخرجات المطلوبة.",
    "これらの納品対象について、このソース送信と提示された合計費用上限を承認します。",
  ],
  "output.delivery.authorize": ["Authorize selected work", "Autoriser le travail sélectionné", "الإذن بالعمل المحدد", "選択した作業を許可"],
  "output.delivery.grantStatus": [
    "Authorization: {status} · {count} recorded operations", "Autorisation : {status} · {count} opérations enregistrées", "الإذن: {status} · {count} عمليات مسجّلة", "許可：{status} · 記録済みの処理：{count}件",
  ],
  "output.delivery.startAuthorized": ["Start authorized work", "Lancer le travail autorisé", "بدء العمل المأذون به", "許可済みの作業を開始"],
  "output.delivery.recoverAuthorized": ["Recover recorded operations", "Reprendre les opérations enregistrées", "استعادة العمليات المسجّلة", "記録済みの処理を復旧"],
  "output.delivery.chooseDocument": [
    "Add this Output requirement to a Document to plan its deliverables.",
    "Ajoutez cette exigence à un document pour planifier ses livrables.",
    "أضف متطلب المخرجات هذا إلى مستند لتخطيط مخرجاته المطلوبة.",
    "納品物を計画するには、この納品要件をドキュメントに追加してください。",
  ],
  "output.delivery.title": ["Outputs", "Livrables", "المخرجات", "納品物"],
  "output.delivery.loading": [
    "Loading the complete delivery scope…", "Chargement du périmètre complet de livraison…", "جارٍ تحميل نطاق التسليم الكامل…", "納品範囲全体を読み込み中…",
  ],
  "output.delivery.refresh": ["Refresh outputs", "Actualiser les livrables", "تحديث المخرجات", "納品物を更新"],
  "output.delivery.wholeScope": [
    "Progress covers the entire confirmed plan, including unselected, unresolved, and currently unavailable work.",
    "La progression couvre tout le plan confirmé, y compris le travail non sélectionné, à préciser ou actuellement indisponible.",
    "يشمل التقدم الخطة المؤكدة كاملة، بما فيها العمل غير المحدد وغير المحسوم وغير المتاح حاليًا.",
    "進捗には、未選択、未確定、現在利用できない作業も含め、確定済みの計画全体が反映されます。",
  ],
  "output.delivery.projectScope": [
    "Open the Document to change requirements or review exact files.",
    "Ouvrez le document pour modifier les exigences ou examiner les fichiers précis.",
    "افتح المستند لتغيير المتطلبات أو مراجعة الملفات بعينها.",
    "要件の変更や個々のファイルのレビューは、ドキュメントを開いて行ってください。",
  ],
  "output.delivery.adoptTitle": ["Use a file you own", "Utiliser un fichier qui vous appartient", "استخدام ملف تملكه", "所有するファイルを使う"],
  "output.delivery.adoptDetail": [
    "Upload a finished file. Forma inspects the bytes; matching, content review, current rights, and acceptance are separate steps.",
    "Importez un fichier terminé. Forma inspecte ses octets ; l’association, la révision du contenu, les droits actuels et l’acceptation sont des étapes distinctes.",
    "ارفع ملفًا نهائيًا. تفحص Forma بايتات الملف؛ أما الربط ومراجعة المحتوى والحقوق السارية والقبول فهي خطوات منفصلة.",
    "完成したファイルをアップロードしてください。Formaはファイルのバイト列を検査します。関連付け、内容のレビュー、現在の権利の確認、承認はそれぞれ別の手順です。",
  ],
  "output.delivery.ownedRights": [
    "I own or have permission to use this file and its contents.",
    "Je possède ce fichier et son contenu, ou j’ai l’autorisation de les utiliser.",
    "أملك هذا الملف ومحتوياته أو لدي إذن باستخدامهما.",
    "このファイルと内容を所有しているか、利用の許可を得ています。",
  ],
  "output.delivery.uploadInspect": [
    "Upload and inspect · no generation", "Importer et inspecter · sans génération", "رفع وفحص · دون توليد", "アップロードして検査 · 生成なし",
  ],
  "output.delivery.downloadPackage": [
    "Download checked deliverables", "Télécharger les livrables vérifiés", "تنزيل المخرجات المفحوصة", "検査済みの納品物をダウンロード",
  ],
  "output.delivery.partialExplicit": [
    "Download a partial package with its missing-work manifest. This does not complete the assignment.",
    "Télécharger un ensemble partiel avec la liste des travaux manquants. Cela ne termine pas la mission.",
    "تنزيل حزمة جزئية مع قائمة العمل الناقص. هذا لا يُكمل المهمة.",
    "不足している作業の一覧を含む部分的なパッケージをダウンロードします。これで依頼全体が完了するわけではありません。",
  ],
  "output.delivery.downloadFiles": [
    "Download files and manifest", "Télécharger les fichiers et le manifeste", "تنزيل الملفات وقائمة المحتويات", "ファイルと一覧をダウンロード",
  ],
  "output.delivery.state.not_started": ["Not started", "Non commencé", "لم يبدأ", "未開始"],
  "output.delivery.state.committing": ["Saving result", "Enregistrement du résultat", "جارٍ حفظ النتيجة", "結果を保存中"],
  "output.delivery.state.partial": ["Partially finished", "Partiellement terminé", "انتهى جزئيًا", "一部終了"],
  "output.delivery.state.expired": ["Expired", "Expiré", "منتهي الصلاحية", "期限切れ"],
  "output.delivery.state.queued": ["Queued", "En attente", "في قائمة الانتظار", "待機中"],
  "output.delivery.state.running": ["In progress", "En cours", "قيد التنفيذ", "実行中"],
  "output.delivery.state.succeeded": ["Finished", "Terminé", "انتهى", "処理終了"],
  "output.delivery.state.failed": ["Failed", "Échec", "فشل", "失敗"],
  "output.delivery.state.cancelled": ["Cancelled", "Annulé", "أُلغي", "キャンセル済み"],
  "output.delivery.state.uncertain": ["Outcome uncertain", "Résultat incertain", "النتيجة غير مؤكدة", "結果未確定"],
  "output.delivery.state.not_checked": ["Not checked", "Non vérifié", "لم يُفحص", "未検査"],
  "output.delivery.state.passed": ["Passed", "Réussi", "اجتاز الفحص", "合格"],
  "output.delivery.state.unknown": ["Unknown", "Inconnu", "غير معروف", "不明"],
  "output.delivery.state.not_reviewed": ["Not reviewed", "Non examiné", "لم يُراجع", "未レビュー"],
  "output.delivery.state.pending": ["Awaiting review", "En attente de révision", "بانتظار المراجعة", "レビュー待ち"],
  "output.delivery.state.accepted": ["Accepted", "Accepté", "مقبول", "承認済み"],
  "output.delivery.state.rejected": ["Changes requested", "Modifications demandées", "تعديلات مطلوبة", "修正依頼あり"],
  "output.delivery.state.current": ["Current", "À jour", "محدّث", "現行の要件に適合"],
  "output.delivery.state.stale": ["Needs recheck", "À revérifier", "يحتاج إلى إعادة فحص", "再確認が必要"],
  "output.delivery.state.available": ["Available", "Disponible", "متاح", "利用可能"],
  "output.delivery.state.missing": ["File missing", "Fichier manquant", "الملف مفقود", "ファイルなし"],
  "output.delivery.state.inaccessible": ["Access unavailable", "Accès indisponible", "الوصول غير متاح", "アクセス不可"],
  "output.delivery.state.supported": ["Supported", "Pris en charge", "مدعوم", "対応済み"],
  "output.delivery.state.unsupported": ["Not supported", "Non pris en charge", "غير مدعوم", "未対応"],
  "output.delivery.state.authorized": ["Authorized", "Autorisé", "مأذون به", "許可済み"],
  "output.delivery.state.active": ["Active", "Actif", "نشط", "有効"],
  "output.delivery.state.completed": ["Operations finished", "Opérations terminées", "انتهت العمليات", "処理終了"],
  "output.delivery.state.revoked": ["Revoked", "Révoqué", "مُلغى الإذن", "許可取り消し済み"],
  "output.delivery.state.exceeded": ["Limit exceeded", "Limite dépassée", "تجاوز الحد", "上限超過"],
  "output.delivery.unit.presentation": ["presentations", "présentations", "عروض تقديمية", "プレゼンテーション"],
  "output.delivery.unit.slide": ["slides", "diapositives", "شرائح", "スライド"],
  "output.delivery.unit.episode": ["episodes", "épisodes", "حلقات", "エピソード"],
  "output.delivery.unit.video": ["videos", "vidéos", "فيديوهات", "動画"],
  "output.delivery.unit.image": ["images", "images", "صور", "画像"],
  "output.delivery.unit.second": ["seconds", "secondes", "ثوانٍ", "秒"],
  "output.delivery.unit.document": ["documents", "documents", "مستندات", "ドキュメント"],
  "output.delivery.unit.model": ["3D models", "modèles 3D", "نماذج ثلاثية الأبعاد", "3Dモデル"],
  "output.delivery.unit.member": ["series members", "éléments de série", "عناصر السلسلة", "シリーズの項目"],
  "output.delivery.unit.unknown": ["unspecified units", "unités non précisées", "وحدات غير محددة", "未指定の単位"],
  "output.delivery.issue.asset_structure_unverified": [
    "The file’s structure could not be verified.", "La structure du fichier n’a pas pu être vérifiée.", "تعذر التحقق من بنية الملف.", "ファイルの構造を検証できませんでした。",
  ],
  "output.delivery.issue.target_media_kind_mismatch": [
    "The file’s media type does not match this target.", "Le type de média du fichier ne correspond pas à cet objectif.", "نوع وسائط الملف لا يطابق هذا المخرج المطلوب.", "ファイルのメディア種別が、この納品対象と一致しません。",
  ],
  "output.delivery.issue.required_aspect_ratio_unmeasured": [
    "The required aspect ratio could not be measured.", "Les proportions requises n’ont pas pu être mesurées.", "تعذر قياس نسبة العرض إلى الارتفاع المطلوبة.", "必要な縦横比を測定できませんでした。",
  ],
  "output.delivery.issue.required_aspect_ratio_mismatch": [
    "The measured aspect ratio does not meet the requirement.", "Les proportions mesurées ne satisfont pas l’exigence.", "نسبة العرض إلى الارتفاع المقاسة لا تفي بالمتطلب.", "測定した縦横比が要件を満たしていません。",
  ],
  "output.delivery.issue.required_content_quantity_unmeasured": [
    "The required content count could not be measured.", "Le nombre d’éléments requis n’a pas pu être mesuré.", "تعذر قياس عدد عناصر المحتوى المطلوبة.", "必要なコンテンツの個数を測定できませんでした。",
  ],
  "output.delivery.issue.required_content_quantity_mismatch": [
    "The measured content count does not meet the accepted count policy.", "Le nombre d’éléments mesuré ne satisfait pas la règle de quantité acceptée.", "عدد عناصر المحتوى المقاس لا يفي بسياسة العدد المقبولة.", "測定したコンテンツの個数が、合意した個数の条件を満たしていません。",
  ],
  "output.delivery.issue.required_coverage_unresolved": [
    "Decide the required source coverage before accepting this file.", "Précisez la couverture des sources requise avant d’accepter ce fichier.", "حدّد تغطية المصادر المطلوبة قبل قبول هذا الملف.", "このファイルを承認する前に、必要なソースの範囲を決めてください。",
  ],
  "component.forma-output-requirements.title": ["Output delivery", "Livraison des résultats", "تسليم المخرجات", "納品管理"],
  "component.forma-output-requirements.summary": [
    "Coordinate confirmed delivery scope, bounded authorization, file checks, exact-result review, and downloads within the current Document.",
    "Coordonnez le périmètre de livraison confirmé, les autorisations limitées, les contrôles de fichiers, la révision des résultats précis et les téléchargements du document courant.",
    "نسّق نطاق التسليم المؤكد والأذونات المحدودة وفحوص الملفات ومراجعة النتائج بعينها والتنزيلات ضمن المستند الحالي.",
    "現在のドキュメントで、確定済みの納品範囲、上限付きの実行許可、ファイル検査、個々の結果のレビュー、ダウンロードを管理します。",
  ],
  "component.forma-output-requirements.usage": [
    "Document Outputs, Project progress, and Deliver; authenticated host only",
    "Livrables du document, progression du projet et livraison ; hôte authentifié uniquement",
    "مخرجات المستند وتقدم المشروع والتسليم؛ في واجهة مصادق عليها فقط",
    "ドキュメントの納品物、プロジェクトの進捗、納品画面。認証済みのホスト専用",
  ],
  "component.forma-output-requirement-card.title": ["Output requirement card", "Carte d’exigences de livrable", "بطاقة متطلبات المخرجات", "納品要件カード"],
  "component.forma-output-requirement-card.summary": [
    "Edit requested deliverables with native forms, preserve unresolved decisions and local drafts, and inspect authorized whole-scope status.",
    "Modifiez les livrables demandés dans des formulaires natifs, conservez les décisions non résolues et les brouillons locaux, et consultez l’état autorisé du périmètre entier.",
    "عدّل المخرجات المطلوبة بنماذج أصلية، واحتفظ بالقرارات غير المحسومة والمسودات المحلية، وافحص حالة النطاق الكامل المسموح لك بها.",
    "ネイティブフォームで納品物を編集し、未確定の項目やローカルの下書きを保持しながら、閲覧権限のある全範囲の状態を確認します。",
  ],
  "component.forma-output-requirement-card.usage": [
    "Reusable Output requirement editing and read-only summaries; the host owns saving and authorization",
    "Édition réutilisable d’exigences de livrable et résumés en lecture seule ; l’hôte gère l’enregistrement et l’autorisation",
    "تحرير قابل لإعادة الاستخدام لمتطلبات المخرجات وملخصات للقراءة فقط؛ تتولى الواجهة المضيفة الحفظ والأذونات",
    "再利用可能な納品要件の編集と閲覧専用の要約。保存と権限管理はホストが担当",
  ],
  "output.delivery.demo.label": [
    "Fictional Output delivery example", "Exemple fictif de livraison de résultats", "مثال خيالي لتسليم المخرجات", "架空の納品管理の例",
  ],
  "output.delivery.demo.title": [
    "Executive summary example", "Exemple de synthèse de direction", "مثال لملخص تنفيذي", "エグゼクティブサマリーの例",
  ],
  "output.delivery.demo.requirement": [
    "One presentation, 5–15 slides, outlining the Document.",
    "Une présentation de 5 à 15 diapositives résumant le document.",
    "عرض تقديمي واحد من 5 إلى 15 شريحة يلخص المستند.",
    "ドキュメントの概要を伝える、5〜15スライドのプレゼンテーションを1件。",
  ],
  "output.delivery.demo.safe": [
    "Fictional, read-only example. No project data, provider calls, payment authorization, or downloads.",
    "Exemple fictif en lecture seule. Aucune donnée de projet, aucun appel fournisseur, aucune autorisation de paiement ni aucun téléchargement.",
    "مثال خيالي للقراءة فقط. لا بيانات مشروع أو استدعاءات مزوّد أو أذونات دفع أو تنزيلات.",
    "架空の閲覧専用サンプルです。プロジェクトデータ、プロバイダー呼び出し、支払い許可、ダウンロードは扱いません。",
  ],
  "output.delivery.demo.scope": [
    "One required group · no accepted files", "Un groupe obligatoire · aucun fichier accepté", "مجموعة مطلوبة واحدة · لا ملفات مقبولة", "必須のグループ：1件 · 承認済みファイルなし",
  ],
  "context.output.label": ["Output", "Livrable", "مخرج", "納品物"],
  "context.output.description": [
    "The deliverables this document owes, with their quantities and requirements",
    "Les livrables dus par ce document, avec leurs quantités et leurs exigences",
    "المخرجات المطلوب تسليمها لهذا المستند، مع كمياتها ومتطلباتها",
    "このドキュメントに求められる納品物と、その数量および要件",
  ],
  "context.output.prompt": [
    "Describe the files you need, including quantities, proportions, and coverage…",
    "Décrivez les fichiers souhaités, avec leurs quantités, leurs proportions et les sujets à couvrir…",
    "صِف الملفات التي تحتاجها، بما فيها الكميات والنسب والتغطية…",
    "必要なファイルの数量、縦横比、扱う内容などを記述してください…",
  ],
  "context.output.subtype.socialMediaImage": ["Social media image", "Image pour réseaux sociaux", "صورة لوسائل التواصل الاجتماعي", "ソーシャルメディア用画像"],
  "context.output.subtype.socialMediaVideo": ["Social media video", "Vidéo pour réseaux sociaux", "فيديو لوسائل التواصل الاجتماعي", "ソーシャルメディア用動画"],
  "context.output.subtype.executiveSummary": ["Executive summary", "Synthèse de direction", "ملخص تنفيذي", "エグゼクティブサマリー"],
  "context.output.subtype.customDeliverables": ["Custom deliverables", "Livrables personnalisés", "مخرجات مخصصة", "カスタム納品物"],
} as const satisfies Record<string, readonly [string, string, string, string]>;

type BaseOutputDeliveryMessageId = keyof typeof entries;
export type OutputDeliveryMessageId = BaseOutputDeliveryMessageId | keyof typeof FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en | keyof typeof FORMA_OUTPUT_DELIVERY_CYCLE_MESSAGES.en;
export type OutputDeliveryMessageKey = OutputDeliveryMessageId extends infer Id
  ? Id extends `output.delivery.${infer Key}` ? Key : never : never;

function catalog(index: 0 | 1 | 2 | 3): Readonly<Record<BaseOutputDeliveryMessageId, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(entries).map(([key, values]) => [key, values[index]]))) as Readonly<Record<BaseOutputDeliveryMessageId, string>>;
}

export const FORMA_OUTPUT_DELIVERY_MESSAGES = Object.freeze({
  en: Object.freeze({ ...catalog(0), ...FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en, ...FORMA_OUTPUT_DELIVERY_CYCLE_MESSAGES.en }),
  fr: Object.freeze({ ...catalog(1), ...FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.fr, ...FORMA_OUTPUT_DELIVERY_CYCLE_MESSAGES.fr }),
  ar: Object.freeze({ ...catalog(2), ...FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.ar, ...FORMA_OUTPUT_DELIVERY_CYCLE_MESSAGES.ar }),
  ja: Object.freeze({ ...catalog(3), ...FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.ja, ...FORMA_OUTPUT_DELIVERY_CYCLE_MESSAGES.ja }),
});

/** Do not display a server enum as user-facing prose, including unknown future values. */
const labels = {
  delivery: { complete: "state.deliveryComplete", complete_for_amended_scope: "state.deliveryAmended", partial: "state.deliveryPartial", unknown: "state.unknown" },
  execution: { not_started: "state.not_started", queued: "state.queued", running: "state.running", succeeded: "state.succeeded", failed: "state.failed", cancelled: "state.cancelled", uncertain: "state.uncertain" },
  checks: { not_checked: "state.not_checked", running: "state.running", passed: "state.passed", failed: "state.failed", unknown: "state.unknown", unavailable: "unavailable" },
  review: { not_reviewed: "state.not_reviewed", pending: "state.pending", accepted: "state.accepted", approved: "state.accepted", rejected: "state.rejected", changes_requested: "state.rejected", unknown: "state.unknown" },
  freshness: { current: "state.current", stale: "state.stale", unknown: "state.unknown" },
  availability: { available: "state.available", missing: "state.missing", inaccessible: "state.inaccessible", unknown: "state.unknown" },
  capability: { supported: "state.supported", unsupported: "state.unsupported", unknown: "state.unknown" },
  grant: { authorized: "state.authorized", active: "state.active", completed: "state.completed", revoked: "state.revoked", exceeded: "state.exceeded", expired: "state.expired" },
  job: { queued: "state.queued", running: "state.running", committing: "state.committing", completed: "state.succeeded", partial: "state.partial", failed: "state.failed", canceled: "state.cancelled", cancelled: "state.cancelled" },
  operation: { authorized: "state.authorized", queued: "state.queued", running: "state.running", completed: "state.completed", succeeded: "state.succeeded", failed: "state.failed", cancelled: "state.cancelled", canceled: "state.cancelled", unavailable: "unavailable", uncertain: "state.uncertain" },
  unit: { presentation: "unit.presentation", slide: "unit.slide", episode: "unit.episode", video: "unit.video", image: "unit.image", second: "unit.second", document: "unit.document", model: "unit.model", member: "unit.member" },
} as const satisfies Record<string, Readonly<Record<string, OutputDeliveryMessageKey>>>;

export type OutputDeliveryLabelCategory = keyof typeof labels;
export function outputDeliveryLabelKey(category: OutputDeliveryLabelCategory, value: unknown): OutputDeliveryMessageKey {
  const group: Readonly<Record<string, OutputDeliveryMessageKey>> = labels[category];
  return typeof value === "string" && Object.hasOwn(group, value) ? group[value] : category === "unit" ? "unit.unknown" : "state.unknown";
}

/** Only stable server-owned check codes are translated; unknown or authored prose is not rewritten. */
export function outputDeliveryProblemKey(value: unknown): OutputDeliveryMessageKey | null {
  if (typeof value !== "string") return null;
  const id = `output.delivery.issue.${value}`;
  return Object.hasOwn(entries, id) ? `issue.${value}` as OutputDeliveryMessageKey : null;
}
