/** Stable, server-owned messages only. Authored content is never passed through this registry. */
type Translation = readonly [string, string, string, string];
const groups = {
  model3dReady: { codes: "output_native_model3d_ready", text: [
    "One Rodin request creates a GLB using the exact reviewed prompt, ordered reference images, and disclosed settings. Provider content checks apply; acceptance is not guaranteed. Review the mesh and materials before accepting delivery.",
    "Une requête Rodin crée un GLB avec l’instruction exacte relue, les images de référence ordonnées et les paramètres affichés. Les contrôles de contenu du fournisseur s’appliquent ; l’acceptation n’est pas garantie. Vérifiez le maillage et les matériaux avant d’accepter la livraison.",
    "ينشئ طلب Rodin واحد ملف GLB باستخدام النص الدقيق الذي راجعته والصور المرجعية المرتبة والإعدادات الموضحة. تُطبّق فحوص محتوى المزوّد ولا يُضمن القبول. راجع الشبكة والمواد قبل قبول التسليم.",
    "Rodinへの1回の依頼で、確認済みの正確なプロンプト、順序付き参照画像、表示された設定を使ってGLBを作成します。プロバイダーのコンテンツ審査が適用され、受理は保証されません。納品を承認する前にメッシュとマテリアルを確認してください。",
  ] },
  model3dTransfer: { codes: "output_transfer_model3d_after_authorization", text: [
    "After authorization and Start, Forma sends the exact displayed prompt, settings, and listed reference images in order to fal.ai / Hyper3D Rodin. The first reference guides materials. Original mesh files are not sent. This preflight sends nothing.",
    "Après l’autorisation et le démarrage, Forma envoie l’instruction exacte affichée, les paramètres et les images de référence dans l’ordre à fal.ai / Hyper3D Rodin. La première référence guide les matériaux. Les fichiers de maillage originaux ne sont pas envoyés. Cette vérification préalable n’envoie rien.",
    "بعد الإذن والبدء، ترسل Forma النص المعروض كما هو والإعدادات والصور المرجعية المدرجة بالترتيب إلى fal.ai / Hyper3D Rodin. يوجّه المرجع الأول المواد. لا تُرسل ملفات الشبكة الأصلية. لا يرسل هذا الفحص المسبق شيئًا.",
    "許可して開始すると、Formaは表示された正確なプロンプト、設定、一覧の参照画像を順番にfal.ai / Hyper3D Rodinへ送信します。最初の参照画像がマテリアルを方向付けます。元のメッシュファイルは送信されません。この事前確認では何も送信しません。",
  ] },
  model3dUnconfigured: { codes: "output_native_model3d_unconfigured", text: [
    "Configure the fal provider before creating a 3D model. Owned GLB adoption remains available.", "Configurez le fournisseur fal avant de créer un modèle 3D. L’importation de vos GLB reste disponible.", "اضبط مزوّد fal قبل إنشاء نموذج ثلاثي الأبعاد. يظل استيراد ملفات GLB التي تملكها متاحًا.", "3Dモデルを作成する前にfalプロバイダーを設定してください。所有するGLBの取り込みは引き続き利用できます。",
  ] },
  model3dContract: { codes: "output_native_model3d_contract_unsupported", text: [
    "A 3D model has no image aspect ratio or slide/duration count. Review these output requirements before creating it.", "Un modèle 3D n’a pas de rapport d’image ni de nombre de diapositives ou de durée. Revoyez ces exigences avant de le créer.", "لا يملك النموذج ثلاثي الأبعاد نسبة أبعاد صورة أو عدد شرائح أو مدة. راجع متطلبات المخرجات هذه قبل إنشائه.", "3Dモデルには画像の縦横比、スライド数、時間の条件はありません。作成前に納品要件を確認してください。",
  ] },
  model3dReferences: { codes: "model3d_reference_count model3d_reference_selection_invalid", text: [
    "Rodin accepts at most five ordered reference images. Select fewer active pixel references or choose references in the 3D generation dialog. No reference is silently dropped.", "Rodin accepte au plus cinq images de référence ordonnées. Activez moins de références en pixels ou choisissez-les dans la fenêtre de génération 3D. Aucune référence n’est supprimée silencieusement.", "يقبل Rodin خمس صور مرجعية مرتبة على الأكثر. قلّل المراجع النشطة التي ترسل بكسلاتها أو اختر المراجع في نافذة التوليد ثلاثي الأبعاد. لا يُحذف أي مرجع دون إعلامك.", "Rodinの参照画像は順序付きで最大5枚です。有効なピクセル参照を減らすか、3D生成ダイアログで参照を選択してください。参照を黙って省くことはありません。",
  ] },
  model3dReferenceUnavailable: { codes: "output_native_model3d_reference_unavailable", text: [
    "Review the selected reference images and confirm their saved rights. Save a current PNG view for each 3D model reference before trying again.", "Vérifiez les images de référence sélectionnées et confirmez leurs droits enregistrés. Enregistrez une vue PNG actuelle de chaque modèle 3D utilisé comme référence avant de réessayer.", "راجع الصور المرجعية المحددة وأكّد حقوقها المحفوظة. احفظ عرض PNG حديثًا لكل نموذج ثلاثي الأبعاد مرجعي قبل المحاولة مجددًا.", "選択した参照画像と保存済みの利用権限を確認してください。再試行する前に各3Dモデル参照の最新のPNGビューを保存してください。",
  ] },
  model3dPromptRequired: { codes: "model3d_prompt_required model3d_prompt_invalid", text: [
    "Write the exact 3D subject description in this deliverable’s instructions, or select an image reference. The prompt is sent unchanged.", "Décrivez exactement le sujet 3D dans les instructions du livrable ou sélectionnez une image de référence. L’instruction est envoyée sans modification.", "اكتب الوصف الدقيق للعنصر ثلاثي الأبعاد في تعليمات هذا المخرج أو اختر صورة مرجعية. يُرسل النص دون تغيير.", "この成果物の指示に3D対象の正確な説明を入力するか、参照画像を選択してください。プロンプトは変更せずに送信します。",
  ] },
  model3dPromptLength: { codes: "model3d_prompt_too_long", text: [
    "The exact 3D prompt has {promptCharacters} characters. Shorten the deliverable instructions to {maximumCharacters} characters or fewer. Your text is retained without truncation.", "L’instruction 3D exacte compte {promptCharacters} caractères. Réduisez les instructions du livrable à {maximumCharacters} caractères ou moins. Votre texte est conservé sans troncature.", "يتكون النص الدقيق للنموذج ثلاثي الأبعاد من {promptCharacters} حرفًا. اختصر تعليمات المخرج إلى {maximumCharacters} حرفًا أو أقل. يُحفظ نصك دون اقتطاع.", "正確な3Dプロンプトは{promptCharacters}文字です。成果物の指示を{maximumCharacters}文字以内に短くしてください。元の文章は切り詰めずに保持します。",
  ] },
  model3dInvalid: { codes: "invalid_glb_model", text: [
    "This GLB could not be verified as a self-contained 3D model. Export it again as GLB 2.0 with embedded textures and uncompressed geometry, then inspect the new file.", "Ce GLB n’a pas pu être vérifié comme modèle 3D autonome. Exportez-le à nouveau en GLB 2.0 avec textures intégrées et géométrie non compressée, puis inspectez le nouveau fichier.", "تعذر التحقق من ملف GLB كنموذج ثلاثي الأبعاد مكتفٍ بذاته. أعد تصديره بصيغة GLB 2.0 مع أنسجة مضمنة وهندسة غير مضغوطة ثم افحص الملف الجديد.", "このGLBを自己完結型の3Dモデルとして検証できませんでした。テクスチャを埋め込み、ジオメトリを非圧縮にしてGLB 2.0で書き出し直し、新しいファイルを検査してください。",
  ] },
  model3dReview: { codes: "output_model3d_visual_review_required", text: [
    "GLB structure and embedded assets were checked. Inspect the 3D geometry, materials, scale, and intended use before accepting delivery. Rendering and useful content were not verified.", "La structure GLB et les ressources intégrées ont été vérifiées. Examinez la géométrie 3D, les matériaux, l’échelle et l’usage prévu avant d’accepter la livraison. Le rendu et l’utilité du contenu n’ont pas été vérifiés.", "فُحصت بنية GLB والموارد المضمنة. افحص الشكل ثلاثي الأبعاد والمواد والمقياس والاستخدام المقصود قبل قبول التسليم. لم يُتحقق من العرض أو فائدة المحتوى.", "GLB構造と埋め込みアセットを検査しました。納品を承認する前に3D形状、マテリアル、縮尺、用途を確認してください。レンダリングと内容の有用性は未検証です。",
  ] },
  unknown: { codes: "", text: [
    "Forma could not identify this problem. Keep your draft and check the current plan and recorded operations before trying again.",
    "Forma n’a pas pu identifier ce problème. Conservez votre brouillon et vérifiez le plan actuel et les opérations enregistrées avant de réessayer.",
    "تعذر على Forma تحديد هذه المشكلة. احتفظ بمسودتك وتحقق من الخطة الحالية والعمليات المسجّلة قبل المحاولة مجددًا.",
    "Formaはこの問題を特定できませんでした。下書きを保持し、再試行する前に現在の計画と記録済みの処理を確認してください。",
  ] },
  incomplete: { codes: "", text: [
    "Some operation details are missing. Refresh to inspect the current scope and cost terms before continuing.",
    "Certains détails de l’opération manquent. Actualisez pour vérifier le périmètre et les conditions de coût avant de continuer.",
    "بعض تفاصيل العملية مفقودة. حدّث البيانات لمراجعة النطاق وشروط التكلفة الحالية قبل المتابعة.",
    "処理の詳細が一部不足しています。続ける前に更新して、現在の範囲と費用条件を確認してください。",
  ] },
  signIn: { codes: "authentication_required output_client_sign_in_required", text: [
    "Sign in to access this Document’s Output requirements and files.",
    "Connectez-vous pour accéder aux exigences de livrables et aux fichiers de ce document.",
    "سجّل الدخول للوصول إلى متطلبات المخرجات وملفات هذا المستند.",
    "このドキュメントの納品要件とファイルにアクセスするには、サインインしてください。",
  ] },
  sharedProject: { codes: "project_context_required", text: [
    "Open this Document in its authorized shared project before using Outputs.",
    "Ouvrez ce document dans son projet partagé autorisé avant d’utiliser les livrables.",
    "افتح هذا المستند في مشروعه المشترك المصرّح به قبل استخدام المخرجات.",
    "納品物を扱う前に、アクセス権のある共有プロジェクトからこのドキュメントを開いてください。",
  ] },
  forbidden: { codes: "output_action_not_authorized output_execution_authority_revoked output_execution_scope_revoked", text: [
    "Your current access does not permit this action. Ask an authorized project administrator to check your role.",
    "Votre accès actuel ne permet pas cette action. Demandez à un administrateur autorisé du projet de vérifier votre rôle.",
    "لا تسمح صلاحياتك الحالية بهذا الإجراء. اطلب من مسؤول مشروع مخوّل التحقق من دورك.",
    "現在の権限ではこの操作を実行できません。権限を持つプロジェクト管理者に役割の確認を依頼してください。",
  ] },
  scopeMismatch: { codes: "invalid_output_scope output_execution_scope_mismatch output_job_scope_mismatch output_job_route_mismatch context_scope_conflict", text: [
    "This action does not match the current authorized workspace or Document. Reopen the intended Document before continuing.",
    "Cette action ne correspond pas à l’espace de travail ou au document autorisé actuel. Rouvrez le document voulu avant de continuer.",
    "لا يطابق هذا الإجراء مساحة العمل أو المستند المصرّح به حاليًا. أعد فتح المستند المقصود قبل المتابعة.",
    "この操作は現在の作業領域またはアクセス権のあるドキュメントと一致しません。目的のドキュメントを開き直してください。",
  ] },
  scopeChanged: { codes: "output_client_scope_changed output_client_download_scope_changed", text: [
    "The active workspace changed. The earlier response is not displayed; reopen the intended Document to check its saved state.",
    "L’espace de travail actif a changé. La réponse précédente n’est pas affichée ; rouvrez le document voulu pour vérifier son état enregistré.",
    "تغيّرت مساحة العمل النشطة. لن تُعرض الاستجابة السابقة؛ أعد فتح المستند المقصود للتحقق من حالته المحفوظة.",
    "作業領域が切り替わりました。以前の応答は表示しません。目的のドキュメントを開き直して保存状態を確認してください。",
  ] },
  unavailableDocument: { codes: "document_not_found not_found", text: [
    "This Document or resource is unavailable in the current project. Check the project and your access.",
    "Ce document ou cette ressource n’est pas disponible dans le projet actuel. Vérifiez le projet et votre accès.",
    "هذا المستند أو المورد غير متاح في المشروع الحالي. تحقق من المشروع وصلاحيات الوصول.",
    "このドキュメントまたはリソースは現在のプロジェクトで利用できません。プロジェクトとアクセス権を確認してください。",
  ] },
  missingIdentity: { codes: "acceptance_id_required asset_id_required block_id_required client_mutation_id_required document_id_required expected_revision_required grant_id_required native_job_id_required plan_revision_id_required preflight_id_required result_id_required invalid_identifier missing_plan_identity output_attempt_identity_missing", text: [
    "Forma could not identify the required selection or revision. Refresh the Document before submitting this action again.",
    "Forma n’a pas pu identifier la sélection ou la version requise. Actualisez le document avant de soumettre à nouveau cette action.",
    "تعذر على Forma تحديد الاختيار أو الإصدار المطلوب. حدّث المستند قبل إرسال هذا الإجراء مجددًا.",
    "必要な選択内容または版を特定できませんでした。この操作を再送信する前にドキュメントを更新してください。",
  ] },
  atomicDecisionRefused: { codes: "output_revision_or_authority_changed", text: [
    "This action could not be approved under the current requirements, access, or available execution budget. Keep your draft and recorded work. Refresh the current state; for generation, review the selected work and budget before another explicit attempt.",
    "Cette action n’a pas pu être approuvée au regard des exigences actuelles, de vos droits d’accès ou du budget d’exécution disponible. Conservez votre brouillon et le travail enregistré. Actualisez l’état actuel ; pour la génération, examinez le travail sélectionné et le budget avant une nouvelle tentative explicite.",
    "تعذر اعتماد هذا الإجراء وفق المتطلبات الحالية أو صلاحيات الوصول أو ميزانية التنفيذ المتاحة. احتفظ بمسودتك والأعمال المسجّلة. حدّث الحالة الحالية؛ وللتوليد، راجع العمل المحدد والميزانية قبل طلب محاولة أخرى صراحةً.",
    "現在の要件、アクセス権、または利用可能な実行予算の条件では、この操作を承認できませんでした。下書きと記録済みの作業を保持してください。現在の状態を更新し、生成の場合は、選択した作業と予算を見直してから明示的に次の試行を依頼してください。",
  ] },
  revisionChanged: { codes: "output_revision_conflict output_execution_context_changed output_source_changed_during_read output_private_write_guard_failed", text: [
    "The Document or your access changed. Keep your draft, refresh, and compare the latest requirements before saving again.",
    "Le document ou votre accès a changé. Conservez votre brouillon, actualisez et comparez les dernières exigences avant d’enregistrer à nouveau.",
    "تغيّر المستند أو صلاحياتك. احتفظ بمسودتك وحدّث البيانات وقارن أحدث المتطلبات قبل الحفظ مجددًا.",
    "ドキュメントまたはアクセス権が変更されました。下書きを保持して更新し、最新の要件と比較してから再度保存してください。",
  ] },
  mutationChanged: { codes: "mutation_key_reused_with_different_content provider_call_key_collision", text: [
    "This operation ID already belongs to different content. Recover the original receipt; do not reuse its ID for a changed request.",
    "Cet identifiant d’opération correspond déjà à un contenu différent. Retrouvez le reçu d’origine ; ne réutilisez pas son identifiant pour une demande modifiée.",
    "معرّف العملية هذا مرتبط بمحتوى مختلف. استعد الإيصال الأصلي؛ ولا تستخدم معرّفه لطلب تغيّر محتواه.",
    "この処理IDは別の内容に使われています。元の記録を復旧してください。内容を変更した依頼に同じIDを使わないでください。",
  ] },
  originalReceiptUnavailable: { codes: "original_command_content_unavailable", text: [
    "The original command content is no longer available. Check its retained operation record before authorizing any new work.",
    "Le contenu de la commande d’origine n’est plus disponible. Vérifiez son historique d’opération avant d’autoriser un nouveau travail.",
    "لم يعد محتوى الأمر الأصلي متاحًا. تحقق من سجل عمليته المحفوظ قبل الإذن بأي عمل جديد.",
    "元のコマンド内容は利用できなくなりました。新しい作業を許可する前に、保持されている処理記録を確認してください。",
  ] },
  loadFailed: { codes: "output_client_load_failed", text: [
    "Output requirements could not be loaded. Delivery scope is unknown; refresh before acting.",
    "Les exigences de livrables n’ont pas pu être chargées. Le périmètre de livraison est inconnu ; actualisez avant d’agir.",
    "تعذر تحميل متطلبات المخرجات. نطاق التسليم غير معروف؛ حدّث البيانات قبل اتخاذ إجراء.",
    "納品要件を読み込めませんでした。納品範囲が不明なため、操作前に更新してください。",
  ] },
  requestNotAttempted: { codes: "output_client_write_not_attempted", text: [
    "This request was not sent. Keep any original operation ID until its receipt is confirmed.",
    "Cette demande n’a pas été envoyée. Conservez tout identifiant d’opération d’origine jusqu’à confirmation de son reçu.",
    "لم يُرسل هذا الطلب. احتفظ بأي معرّف للعملية الأصلية حتى تأكيد إيصالها.",
    "このリクエストは送信されていません。元の処理IDがある場合は、その記録を確認できるまで保持してください。",
  ] },
  responseLost: { codes: "output_client_response_lost output_client_write_unconfirmed output_client_transport_failed", text: [
    "The response was not confirmed. Keep this draft and recover the same operation ID before starting another request.",
    "La réponse n’a pas été confirmée. Conservez ce brouillon et récupérez l’opération portant le même identifiant avant de lancer une autre demande.",
    "لم تُؤكد الاستجابة. احتفظ بهذه المسودة واستعد العملية ذات المعرّف نفسه قبل بدء طلب آخر.",
    "応答を確認できませんでした。下書きを保持し、別の依頼を始める前に同じ処理IDの記録を復旧してください。",
  ] },
  downloadFailed: { codes: "output_client_download_failed", text: [
    "The files could not be downloaded. Check current access and delivery status, then request the same package again.",
    "Les fichiers n’ont pas pu être téléchargés. Vérifiez l’accès actuel et l’état de livraison, puis redemandez le même ensemble.",
    "تعذر تنزيل الملفات. تحقق من صلاحيات الوصول وحالة التسليم الحالية، ثم اطلب الحزمة نفسها مجددًا.",
    "ファイルをダウンロードできませんでした。現在のアクセス権と納品状態を確認し、同じパッケージを再度取得してください。",
  ] },
  invalidDownload: { codes: "output_client_invalid_download", text: [
    "This download does not belong to the authorized Output delivery route. Open the package from the current Document.",
    "Ce téléchargement ne correspond pas au parcours de livraison autorisé. Ouvrez l’ensemble depuis le document actuel.",
    "لا ينتمي هذا التنزيل إلى مسار تسليم المخرجات المصرّح به. افتح الحزمة من المستند الحالي.",
    "このダウンロードは許可された納品経路に属していません。現在のドキュメントからパッケージを開いてください。",
  ] },
  invalidRequest: { codes: "invalid_json method_not_allowed unknown_output_action output_requirements_failed", text: [
    "Forma could not complete this Output request. Keep your draft and inspect saved work before retrying the same operation.",
    "Forma n’a pas pu terminer cette demande de livrable. Conservez votre brouillon et vérifiez le travail enregistré avant de réessayer la même opération.",
    "تعذر على Forma إكمال طلب المخرجات هذا. احتفظ بمسودتك وافحص العمل المحفوظ قبل إعادة محاولة العملية نفسها.",
    "この納品物の依頼を完了できませんでした。下書きを保持し、同じ処理を再試行する前に保存済みの作業を確認してください。",
  ] },
  blockUnavailable: { codes: "foreign_or_removed_output_block output_block_not_found output_block_identity_unavailable requirement_block_identity_mismatch", text: [
    "This requirement does not identify an available Output block in the current Document. Refresh and select the intended requirement.",
    "Cette exigence ne correspond pas à un bloc de livrable disponible dans le document actuel. Actualisez et sélectionnez l’exigence voulue.",
    "لا يحدد هذا المتطلب كتلة مخرجات متاحة في المستند الحالي. حدّث البيانات واختر المتطلب المقصود.",
    "この要件は現在のドキュメントで利用できる納品ブロックに対応していません。更新して目的の要件を選択してください。",
  ] },
  blockLocked: { codes: "output_block_locked organization_context_package_decision_immutable", text: [
    "This requirement is locked or governed by an approved context package. Use its authorized revision process before changing it.",
    "Cette exigence est verrouillée ou régie par un ensemble de contexte approuvé. Utilisez son processus de révision autorisé avant de la modifier.",
    "هذا المتطلب مقفل أو خاضع لحزمة سياق معتمدة. استخدم عملية المراجعة المصرّح بها قبل تغييره.",
    "この要件はロックされているか、承認済みのコンテキストパッケージで管理されています。変更には所定の改訂手順を使用してください。",
  ] },
  cannotConvertSource: { codes: "output_requirement_endpoint_cannot_convert_source", text: [
    "A source block cannot be converted through this Output editor. Create a separate Output requirement and keep the source unchanged.",
    "Cet éditeur de livrables ne peut pas convertir un bloc source. Créez une exigence de livrable séparée et conservez la source.",
    "لا يمكن تحويل كتلة مصدر عبر محرر المخرجات هذا. أنشئ متطلب مخرجات منفصلًا واترك المصدر دون تغيير.",
    "この納品エディターではソースブロックを変換できません。ソースを変更せず、別の納品要件を作成してください。",
  ] },
  confirmRequirements: { codes: "confirmed_output_plan_required output_requirements_need_confirmation output_requirements_required", text: [
    "Review and confirm the Output requirements first. Confirmation defines the delivery scope and starts no generation.",
    "Examinez et confirmez d’abord les exigences de livrables. La confirmation définit le périmètre de livraison sans lancer de génération.",
    "راجع متطلبات المخرجات وأكدها أولًا. يحدد التأكيد نطاق التسليم ولا يبدأ أي توليد.",
    "まず納品要件を確認して確定してください。確定は納品範囲を定める操作であり、生成は開始しません。",
  ] },
  reconfirmPlan: { codes: "latest_output_plan_required output_plan_needs_reconfirmation output_execution_contract_changed output_source_changed output_native_route_changed output_route_changed output_provider_terms_changed output_authorization_terms_changed", text: [
    "Sources, requirements, or execution terms changed. Review the current plan and new cost terms before confirming or authorizing more work.",
    "Les sources, les exigences ou les conditions d’exécution ont changé. Vérifiez le plan actuel et les nouveaux coûts avant de confirmer ou d’autoriser davantage de travail.",
    "تغيّرت المصادر أو المتطلبات أو شروط التنفيذ. راجع الخطة الحالية وشروط التكلفة الجديدة قبل تأكيد عمل إضافي أو الإذن به.",
    "ソース、要件、または実行条件が変更されました。現在の計画と新しい費用条件を確認してから、追加の作業を確定または許可してください。",
  ] },
  interpretationReview: { codes: "output_interpretation_review_required interpretation_review_required invalid_interpretation_basis", text: [
    "The wording and saved interpretation need review. Compare both, then explicitly confirm the retained structure or revise it.",
    "Le texte et l’interprétation enregistrée doivent être examinés. Comparez-les, puis confirmez explicitement la structure conservée ou modifiez-la.",
    "تحتاج الصياغة والتفسير المحفوظ إلى مراجعة. قارنهما ثم أكد البنية المحتفظ بها صراحةً أو عدّلها.",
    "文言と保存済みの解釈を確認する必要があります。両方を比較し、保持する構造を明示的に確認するか、修正してください。",
  ] },
  genericSourceProofCapacity: { codes: "output_source_proof_too_large output_source_governance_proof_too_large", text: [
    "Source verification reached its current size or complexity limit. The full assignment, saved plans, previous results, and spending history are retained. Inspect the current Document’s source records and contact a workspace administrator. Refresh only rechecks the state; it does not increase verification capacity.",
    "La vérification des sources a atteint sa limite actuelle de taille ou de complexité. La mission complète, les plans enregistrés, les résultats antérieurs et l’historique des dépenses sont conservés. Examinez les enregistrements sources du document actuel et contactez un administrateur de l’espace de travail. L’actualisation ne fait que revérifier l’état ; elle n’augmente pas la capacité de vérification.",
    "بلغ التحقق من المصادر حده الحالي للحجم أو التعقيد. تُحفظ المهمة كاملة والخطط المحفوظة والنتائج السابقة وسجل الإنفاق. افحص سجلات مصادر المستند الحالي وتواصل مع مسؤول مساحة العمل. التحديث يعيد فحص الحالة فقط؛ ولا يزيد قدرة التحقق.",
    "ソースの検証が、現在のサイズまたは複雑さの上限に達しました。依頼の全範囲、保存済みの計画、以前の結果、費用の履歴は保持されます。現在のドキュメントのソース記録を確認し、ワークスペース管理者に連絡してください。更新は状態を再確認するだけで、検証容量は増えません。"
  ] },
  currentEvidenceRequired: { codes: "output_plan_evidence_mismatch output_private_evidence_changed output_private_evidence_unavailable output_source_private_evidence_unavailable context_source_evidence_unavailable", text: [
    "Current source evidence could not be verified. Restore authorized source evidence and refresh; this cannot be resolved by approving unchecked work.",
    "Les preuves sources actuelles n’ont pas pu être vérifiées. Rétablissez les preuves autorisées et actualisez ; approuver un travail non vérifié ne résout pas ce problème.",
    "تعذر التحقق من أدلة المصادر الحالية. استعد أدلة المصادر المصرّح بها وحدّث البيانات؛ ولا تُحل المشكلة بقبول عمل غير مفحوص.",
    "現在のソースの根拠を検証できませんでした。利用可能な根拠を復旧して更新してください。未検査の作業を承認しても解決しません。",
  ] },
  sourceRightsExpired: { codes: "context_source_rights_expired", text: [
    "The source rights are no longer current. Restore valid permission or revise the sources before generation or delivery.",
    "Les droits sur les sources ne sont plus à jour. Rétablissez une autorisation valide ou modifiez les sources avant la génération ou la livraison.",
    "لم تعد حقوق المصادر سارية. استعد إذنًا صالحًا أو عدّل المصادر قبل التوليد أو التسليم.",
    "ソースの利用権が現在は有効ではありません。生成または納品の前に、有効な許可を得るかソースを変更してください。",
  ] },
  sourceNotAuthorized: { codes: "context_block_not_authorized context_source_not_authorized canvas_context_not_authorized character_context_not_authorized", text: [
    "A source is outside the authorized Document or context. Select permitted sources without broadening access.",
    "Une source se trouve hors du document ou du contexte autorisé. Sélectionnez des sources permises sans élargir l’accès.",
    "أحد المصادر خارج المستند أو السياق المصرّح به. اختر مصادر مسموحًا بها دون توسيع نطاق الوصول.",
    "アクセスが許可されたドキュメントまたはコンテキストの範囲外にあるソースが含まれています。アクセス範囲を広げず、利用できるソースを選択してください。",
  ] },
  sourceVersionChanged: { codes: "context_source_version_mismatch", text: [
    "A source version no longer matches the approved context. Review the current source revision before continuing.",
    "Une version source ne correspond plus au contexte approuvé. Examinez la version actuelle de la source avant de continuer.",
    "لم يعد إصدار أحد المصادر يطابق السياق المعتمد. راجع إصدار المصدر الحالي قبل المتابعة.",
    "ソースの版が承認済みのコンテキストと一致しなくなりました。続ける前に現在のソースの版を確認してください。",
  ] },
  canvasContextRequired: { codes: "canvas_context_required", text: [
    "Choose the approved board and its context together before requesting generation.",
    "Choisissez ensemble le tableau approuvé et son contexte avant de demander une génération.",
    "اختر اللوحة المعتمدة وسياقها معًا قبل طلب التوليد.",
    "生成を依頼する前に、承認済みのボードと対応するコンテキストを選択してください。",
  ] },
  targetUnavailable: { codes: "output_target_not_found output_target_no_longer_executable output_target_not_admissible target_not_selected_in_confirmed_plan unknown_target_selection", text: [
    "This target is not available in the current confirmed plan. Review the plan and select its current target before proceeding.",
    "Cet objectif n’est pas disponible dans le plan confirmé actuel. Examinez le plan et sélectionnez l’objectif actuel avant de continuer.",
    "هذا المخرج المطلوب غير متاح في الخطة المؤكدة الحالية. راجع الخطة واختر مخرجها الحالي قبل المتابعة.",
    "この納品対象は現在の確定済み計画では利用できません。計画を確認し、現在の納品対象を選択してください。",
  ] },
  targetUnresolved: { codes: "output_target_unresolved output_target_requires_resolution", text: [
    "Resolve this target’s missing media, quantity, source coverage, or format decisions before creating or accepting a file.",
    "Précisez le média, la quantité, la couverture des sources ou le format manquant de cet objectif avant de créer ou d’accepter un fichier.",
    "احسم قرارات الوسائط أو الكمية أو تغطية المصادر أو التنسيق الناقصة لهذا المخرج قبل إنشاء ملف أو قبوله.",
    "ファイルの作成または承認の前に、この納品対象のメディア、数量、ソース範囲、形式の未確定項目を解決してください。",
  ] },
  finitePreflightSelection: { codes: "finite_target_selection_required", text: [
    "Choose one or more distinct targets that are selected in the confirmed plan, within the per-check limit shown. Checking a smaller selection does not remove any work from the delivery plan.",
    "Choisissez un ou plusieurs objectifs distincts sélectionnés dans le plan confirmé, dans la limite par vérification affichée. Vérifier une sélection plus restreinte ne retire aucun travail du plan de livraison.",
    "اختر مخرجًا مطلوبًا واحدًا أو أكثر من المخرجات المحددة في الخطة المؤكدة، دون تكرار وضمن الحد المعروض لكل فحص. لا يؤدي فحص مجموعة أصغر إلى إزالة أي عمل من خطة التسليم.",
    "確定済みの計画で選択されている納品対象を、表示された確認ごとの上限内で、重複なく一件以上選択してください。確認する対象を絞っても、納品計画から作業が取り除かれることはありません。",
  ] },
  finiteSelection: { codes: "invalid_output_plan_selection", text: [
    "Choose a finite, nonempty set of distinct targets from the confirmed plan for this run.",
    "Choisissez pour cette exécution un ensemble fini, non vide et sans doublons d’objectifs du plan confirmé.",
    "اختر لهذا التشغيل مجموعة محدودة وغير فارغة من مخرجات مطلوبة متميزة ضمن الخطة المؤكدة.",
    "今回の実行には、確定済み計画から重複のない有限個の納品対象を1件以上選択してください。",
  ] },
  oneAlternative: { codes: "choose_one_target_for_explicit_alternative", text: [
    "Choose one target when requesting a separately authorized alternative.",
    "Choisissez un seul objectif pour demander une alternative autorisée séparément.",
    "اختر مخرجًا مطلوبًا واحدًا عند طلب بديل يحتاج إلى إذن منفصل.",
    "別途許可する代替案を依頼するときは、納品対象を1件選択してください。",
  ] },
  previousNotTerminal: { codes: "previous_output_operation_not_terminal", text: [
    "The previous operation has not ended. Recover or cancel that operation before requesting an alternative.",
    "L’opération précédente n’est pas terminée. Reprenez-la ou annulez-la avant de demander une alternative.",
    "لم تنتهِ العملية السابقة. استعدها أو ألغها قبل طلب بديل.",
    "前の処理は終了していません。代替案を依頼する前に、その処理を復旧またはキャンセルしてください。",
  ] },
  uncertainPreviousCost: { codes: "reconcile_previous_output_cost_before_alternative", text: [
    "The previous operation’s cost is still uncertain. Reconcile its provider receipt before authorizing an alternative; the possible charge remains reserved.",
    "Le coût de l’opération précédente reste incertain. Rapprochez son reçu fournisseur avant d’autoriser une alternative ; le montant possible reste réservé.",
    "لا تزال تكلفة العملية السابقة غير مؤكدة. سوِّ إيصال المزوّد قبل الإذن ببديل؛ ويبقى المبلغ المحتمل محجوزًا.",
    "前の処理の費用が未確定です。代替案を許可する前にプロバイダーの記録を照合してください。発生し得る費用は引き続き確保されています。",
  ] },
  existingOperation: { codes: "output_existing_operation_requires_recovery", text: [
    "This target already has an authorized operation. Recover its recorded result or explicitly authorize an alternative; no second initial operation is created.",
    "Cet objectif a déjà une opération autorisée. Récupérez son résultat enregistré ou autorisez explicitement une alternative ; aucune seconde opération initiale n’est créée.",
    "لهذا المخرج المطلوب عملية مأذون بها بالفعل. استعد نتيجتها المسجّلة أو أذن ببديل صراحةً؛ لن تُنشأ عملية أولية ثانية.",
    "この納品対象には許可済みの処理があります。記録済みの結果を復旧するか、代替案を明示的に許可してください。最初の処理を重複作成することはありません。",
  ] },
  spendingApproval: { codes: "explicit_spending_authorization_required", text: [
    "Review the source transfer and aggregate spending limit, then explicitly authorize the selected work. Confirming requirements alone does not authorize payment.",
    "Vérifiez le transfert des sources et le plafond total de dépenses, puis autorisez explicitement le travail sélectionné. Confirmer les exigences n’autorise pas de paiement.",
    "راجع نقل المصادر وحد الإنفاق الإجمالي ثم أذن بالعمل المحدد صراحةً. تأكيد المتطلبات وحده لا يأذن بالدفع.",
    "ソース送信と合計費用上限を確認し、選択した作業を明示的に許可してください。要件の確定だけでは支払いは許可されません。",
  ] },
  preflightExpired: { codes: "output_preflight_expired", text: [
    "This availability and cost check expired. Run a fresh check before approving its current terms.",
    "Cette vérification de disponibilité et de coût a expiré. Relancez-la avant d’approuver les conditions actuelles.",
    "انتهت صلاحية فحص التوفر والتكلفة هذا. أجرِ فحصًا جديدًا قبل الموافقة على الشروط الحالية.",
    "この利用可否と費用の確認は期限切れです。再確認してから現在の条件を承認してください。",
  ] },
  grantInactive: { codes: "output_execution_grant_inactive output_execution_grant_not_found", text: [
    "This execution authorization is unavailable, expired, or no longer active. Review recorded operations and current terms before authorizing more work.",
    "Cette autorisation d’exécution est indisponible, expirée ou inactive. Vérifiez les opérations enregistrées et les conditions actuelles avant d’autoriser plus de travail.",
    "إذن التنفيذ هذا غير متاح أو منتهي الصلاحية أو غير نشط. راجع العمليات المسجّلة والشروط الحالية قبل الإذن بعمل إضافي.",
    "この実行許可は利用不可、期限切れ、または無効です。追加の作業を許可する前に、記録済みの処理と現在の条件を確認してください。",
  ] },
  costCapInsufficient: { codes: "output_authorization_ceiling_insufficient output_call_cost_allowance_exceeded", text: [
    "This request exceeds the authorized cost allowance. It cannot proceed under this authorization; review a new bounded plan if more work is needed.",
    "Cette demande dépasse le coût autorisé. Elle ne peut pas continuer avec cette autorisation ; examinez un nouveau plan plafonné si davantage de travail est nécessaire.",
    "يتجاوز هذا الطلب مخصص التكلفة المأذون به. لا يمكن تنفيذه بموجب هذا الإذن؛ راجع خطة جديدة محدودة إذا لزم عمل إضافي.",
    "この依頼は許可された費用枠を超えています。現在の許可では続行できません。追加の作業が必要な場合は、上限を定めた新しい計画を確認してください。",
  ] },
  tokenCapExceeded: { codes: "output_token_allowance_exceeded", text: [
    "This request exceeds the authorized token allowance. No further provider call is allowed under this authorization.",
    "Cette demande dépasse le nombre de jetons autorisé. Aucun nouvel appel fournisseur n’est permis avec cette autorisation.",
    "يتجاوز هذا الطلب مخصص الرموز المأذون به. لا يُسمح باستدعاء إضافي للمزوّد بموجب هذا الإذن.",
    "この依頼は許可されたトークン枠を超えています。この許可ではプロバイダーを追加で呼び出せません。",
  ] },
  budgetUnavailable: { codes: "output_cost_budget_unavailable output_token_budget_unavailable", text: [
    "The current account or project budget cannot cover this work. Ask an authorized administrator to check the budget before requesting new authorization.",
    "Le budget actuel du compte ou du projet ne couvre pas ce travail. Demandez à un administrateur autorisé de le vérifier avant de solliciter une nouvelle autorisation.",
    "لا تكفي ميزانية الحساب أو المشروع الحالية لهذا العمل. اطلب من مسؤول مخوّل التحقق من الميزانية قبل طلب إذن جديد.",
    "現在のアカウントまたはプロジェクトの予算では、この作業を賄えません。新しい許可を依頼する前に、管理者に予算の確認を依頼してください。",
  ] },
  admissionEvidenceMissing: { codes: "output_admission_receipt_required output_admitted_reservations_missing output_allocation_mismatch output_job_binding_missing output_provider_call_missing", text: [
    "The recorded authorization, job, or budget reservation could not be verified together. Recover the original operation record; do not start an untracked replacement.",
    "L’autorisation, la tâche ou la réservation budgétaire enregistrées n’ont pas pu être vérifiées ensemble. Récupérez l’opération d’origine ; ne lancez pas de remplacement non suivi.",
    "تعذر التحقق من توافق الإذن أو المهمة أو حجز الميزانية المسجّلة. استعد سجل العملية الأصلي؛ ولا تبدأ بديلًا غير متتبع.",
    "記録済みの許可、ジョブ、予算確保の対応を検証できませんでした。元の処理記録を復旧してください。追跡できない代替処理を始めないでください。",
  ] },
  providerCallForbidden: { codes: "output_provider_call_not_authorized output_provider_stage_not_authorized provider_call_authority_required", text: [
    "This provider call is outside the recorded authorization. It is blocked; inspect the original operation and approved limits.",
    "Cet appel fournisseur sort de l’autorisation enregistrée. Il est bloqué ; examinez l’opération d’origine et les limites approuvées.",
    "هذا الاستدعاء للمزوّد خارج نطاق الإذن المسجّل. تم حظره؛ افحص العملية الأصلية والحدود المعتمدة.",
    "このプロバイダー呼び出しは記録済みの許可の範囲外です。実行を停止しました。元の処理と承認済みの上限を確認してください。",
  ] },
  callAlreadyUsed: { codes: "output_provider_call_already_consumed", text: [
    "This provider call has already been used or may still be in flight. Recover its receipt instead of submitting the call again.",
    "Cet appel fournisseur a déjà été utilisé ou peut être encore en cours. Récupérez son reçu au lieu de le soumettre à nouveau.",
    "استُخدم هذا الاستدعاء للمزوّد بالفعل أو قد يكون قيد التنفيذ. استعد إيصالَه بدلًا من إرساله مجددًا.",
    "このプロバイダー呼び出しは実行済みか、まだ進行中の可能性があります。再送信せず、記録を復旧してください。",
  ] },
  settlementConflict: { codes: "provider_settlement_conflict", text: [
    "The provider cost conflicts with an existing settlement. Keep both records and resolve the discrepancy before further paid work.",
    "Le coût fournisseur contredit un règlement existant. Conservez les deux enregistrements et résolvez l’écart avant tout nouveau travail payant.",
    "تتعارض تكلفة المزوّد مع تسوية موجودة. احتفظ بالسجلين وحلّ الفرق قبل أي عمل مدفوع إضافي.",
    "プロバイダーの費用が既存の精算記録と一致しません。両方の記録を保持し、追加の有料作業の前に差異を解決してください。",
  ] },
  operationNotStarted: { codes: "output_operation_not_started", text: [
    "This recorded operation is not queued or running. Check its current status before attempting recovery or a new authorization.",
    "Cette opération enregistrée n’est ni en attente ni en cours. Vérifiez son état actuel avant une reprise ou une nouvelle autorisation.",
    "هذه العملية المسجّلة ليست في الانتظار أو قيد التنفيذ. تحقق من حالتها الحالية قبل محاولة استعادتها أو طلب إذن جديد.",
    "この記録済みの処理は待機中でも実行中でもありません。復旧または新しい許可を試みる前に、現在の状態を確認してください。",
  ] },
  jobLeaseChanged: { codes: "output_job_lease_changed", text: [
    "The job’s execution claim changed. Refresh its recorded status; another provider call must not be submitted from this stale claim.",
    "La prise en charge de la tâche a changé. Actualisez son état enregistré ; cette ancienne prise en charge ne doit pas soumettre un autre appel fournisseur.",
    "تغيّر حجز تنفيذ المهمة. حدّث حالتها المسجّلة؛ ولا يجوز إرسال استدعاء آخر للمزوّد باستخدام الحجز القديم.",
    "ジョブの実行担当が変更されました。記録済みの状態を更新してください。古い実行権を使って追加のプロバイダー呼び出しを送信できません。",
  ] },
  bridgeInvalid: { codes: "bridge_preflight_incomplete bridge_provider_call_routes_invalid bridge_provider_call_routes_required bridge_target_mismatch", text: [
    "The execution bridge did not provide a complete, consistent provider and cost contract. Generation is blocked until that integration is corrected.",
    "Le connecteur d’exécution n’a pas fourni de contrat fournisseur et de coût complet et cohérent. La génération reste bloquée jusqu’à sa correction.",
    "لم يقدّم جسر التنفيذ شروط مزوّد وتكلفة كاملة ومتسقة. يظل التوليد محظورًا حتى تصحيح هذا التكامل.",
    "実行連携から、整合したプロバイダーと費用の条件を取得できませんでした。連携が修正されるまで生成は停止します。",
  ] },
  executionUnavailable: { codes: "native_execution_unavailable output_native_execution_unavailable unavailable_selected_output_route", text: [
    "Native generation is unavailable for this selection. Use a supported inspected file or revise the requested route explicitly; no fallback job is substituted.",
    "La génération native n’est pas disponible pour cette sélection. Utilisez un fichier pris en charge et inspecté ou révisez explicitement le parcours ; aucune tâche de remplacement n’est substituée.",
    "التوليد داخل Forma غير متاح لهذا التحديد. استخدم ملفًا مدعومًا ومفحوصًا أو عدّل المسار المطلوب صراحةً؛ لن تُستبدل مهمة بديلة تلقائيًا.",
    "この選択ではForma内の生成を利用できません。対応する検査済みファイルを使うか、依頼した経路を明示的に変更してください。別のジョブへ自動で切り替えることはありません。",
  ] },
  invalidRequirements: { codes: "invalid_output_requirement invalid_output_plan invalid_output_plan_options invalid_output_plan_suggestions invalid_requirement invalid_deliverable invalid_deliverables invalid_variant invalid_variants invalid_series invalid_series_member invalid_series_members", text: [
    "The saved requirement structure is invalid. Keep the authored wording and correct the highlighted deliverable fields before confirming.",
    "La structure de l’exigence enregistrée n’est pas valide. Conservez le texte rédigé et corrigez les champs de livrable signalés avant de confirmer.",
    "بنية المتطلب المحفوظ غير صالحة. احتفظ بالصياغة الأصلية وصحح حقول المخرجات المشار إليها قبل التأكيد.",
    "保存済みの要件の構造が無効です。元の文言を保持し、指摘された納品物の項目を修正してから確定してください。",
  ] },
  describeDeliverables: { codes: "empty_request deliverables_unresolved empty_request_text", text: [
    "Describe the deliverables you need. An empty interpretation does not complete the request.",
    "Décrivez les livrables souhaités. Une interprétation vide ne satisfait pas la demande.",
    "صِف المخرجات التي تحتاجها. التفسير الفارغ لا يُكمل الطلب.",
    "必要な納品物を記述してください。解釈が空の状態では依頼を満たしません。",
  ] },
  unrecognizedWording: { codes: "unrecognized_request", text: [
    "The wording was retained, but its deliverables are not clear yet. Choose the media and quantities explicitly instead of guessing a generation route.",
    "Le texte a été conservé, mais les livrables ne sont pas encore clairs. Choisissez explicitement les médias et les quantités sans deviner un parcours de génération.",
    "حُفظت الصياغة، لكن مخرجاتها لم تتضح بعد. اختر الوسائط والكميات صراحةً بدلًا من تخمين مسار للتوليد.",
    "文言は保持しましたが、納品物はまだ明確ではありません。生成経路を推測せず、メディアと数量を明示的に選択してください。",
  ] },
  textRequired: { codes: "invalid_text invalid_string_list", text: [
    "Enter the required text or list entries; empty values do not define the requested work.",
    "Saisissez le texte ou les éléments de liste requis ; les valeurs vides ne définissent pas le travail demandé.",
    "أدخل النص أو عناصر القائمة المطلوبة؛ فالقيم الفارغة لا تحدد العمل المطلوب.",
    "必要なテキストまたはリスト項目を入力してください。空の値では依頼する作業を定義できません。",
  ] },
  duplicateValues: { codes: "duplicate_value", text: [
    "Remove repeated entries from this list while preserving each distinct requirement.",
    "Retirez les entrées répétées de cette liste en conservant chaque exigence distincte.",
    "أزل العناصر المكررة من هذه القائمة مع الحفاظ على كل متطلب متميز.",
    "異なる要件をそれぞれ保持しながら、このリストの重複項目を削除してください。",
  ] },
  identityInvalid: { codes: "invalid_id duplicate_id duplicate_scope_identity duplicate_plan_identity", text: [
    "Requirement identities are invalid or duplicated. Each requirement, deliverable, variant, and series member needs its own stable identity.",
    "Les identifiants des exigences sont invalides ou dupliqués. Chaque exigence, livrable, variante et élément de série doit avoir un identifiant stable distinct.",
    "معرّفات المتطلبات غير صالحة أو مكررة. يحتاج كل متطلب ومخرج ومتغير وعنصر سلسلة إلى معرّف ثابت مستقل.",
    "要件のIDが無効か重複しています。要件、納品物、バリエーション、シリーズ項目には、それぞれ固有の安定したIDが必要です。",
  ] },
  ambiguousIdentity: { codes: "ambiguous_identity", text: [
    "More than one earlier item could match this wording. Review the new identity; earlier fulfillment is not transferred automatically.",
    "Plusieurs éléments antérieurs pourraient correspondre à ce texte. Vérifiez le nouvel identifiant ; la réalisation précédente n’est pas transférée automatiquement.",
    "قد تطابق هذه الصياغة أكثر من عنصر سابق. راجع المعرّف الجديد؛ لن يُنقل الوفاء السابق بالمتطلب تلقائيًا.",
    "この文言に複数の以前の項目が該当する可能性があります。新しいIDを確認してください。以前の達成状態は自動で引き継がれません。",
  ] },
  invalidImport: { codes: "invalid_import conflicting_import_keys not_output_context", text: [
    "Use one unambiguous Output block with text Content and an optional text Subtype. Keep the original text while correcting conflicting fields.",
    "Utilisez un seul bloc Output sans ambiguïté, avec un contenu textuel et un sous-type textuel facultatif. Conservez le texte d’origine en corrigeant les champs contradictoires.",
    "استخدم كتلة Output واحدة واضحة ذات محتوى نصي ونوع فرعي نصي اختياري. احتفظ بالنص الأصلي أثناء تصحيح الحقول المتعارضة.",
    "テキストのContentと任意のテキストSubtypeを持つ、曖昧さのないOutputブロックを1つ使用してください。元のテキストを保持して矛盾する項目を修正してください。",
  ] },
  unsupportedSchema: { codes: "unsupported_schema_version", text: [
    "This requirement uses a newer schema. Keep it unchanged and update Forma before interpreting or editing it.",
    "Cette exigence utilise un schéma plus récent. Conservez-la et mettez Forma à jour avant de l’interpréter ou de la modifier.",
    "يستخدم هذا المتطلب مخططًا أحدث. اتركه دون تغيير وحدّث Forma قبل تفسيره أو تحريره.",
    "この要件は新しいスキーマを使用しています。変更せずに保持し、解釈または編集する前にFormaを更新してください。",
  ] },
  unsupportedFields: { codes: "unsupported_field invalid_schema_version", text: [
    "This field or schema version is not supported here. Preserve the original requirement and use a compatible editor.",
    "Ce champ ou cette version de schéma n’est pas pris en charge ici. Conservez l’exigence d’origine et utilisez un éditeur compatible.",
    "هذا الحقل أو إصدار المخطط غير مدعوم هنا. احتفظ بالمتطلب الأصلي واستخدم محررًا متوافقًا.",
    "この項目またはスキーマの版は対応していません。元の要件を保持し、対応するエディターを使用してください。",
  ] },
  originsRequired: { codes: "invalid_value_origin invalid_value_origins", text: [
    "Keep the distinction between authored requirements, interpretations, suggestions, and confirmed decisions. Their recorded origins must not be discarded.",
    "Préservez la distinction entre exigences rédigées, interprétations, suggestions et décisions confirmées. Leur origine enregistrée ne doit pas être supprimée.",
    "حافظ على التمييز بين المتطلبات الأصلية والتفسيرات والاقتراحات والقرارات المؤكدة. لا يجوز حذف أصولها المسجّلة.",
    "記述された要件、解釈、提案、確定した判断を区別してください。記録された出どころを破棄してはいけません。",
  ] },
  mediaRequired: { codes: "media_kind_unresolved invalid_media_kind", text: [
    "Choose a supported media type for this deliverable before planning production.",
    "Choisissez un type de média pris en charge pour ce livrable avant de planifier la production.",
    "اختر نوع وسائط مدعومًا لهذا المخرج قبل تخطيط الإنتاج.",
    "制作を計画する前に、この納品物に対応するメディア種別を選択してください。",
  ] },
  quantityInvalid: { codes: "invalid_quantity invalid_quantity_kind invalid_quantity_range", text: [
    "Keep an unknown quantity unresolved, or enter a positive exact count or ordered range with its unit. File and slide counts must be whole numbers.",
    "Laissez une quantité inconnue non résolue, ou saisissez un nombre exact positif ou une plage ordonnée avec son unité. Les nombres de fichiers et de diapositives doivent être entiers.",
    "اترك الكمية المجهولة غير محسومة، أو أدخل عددًا دقيقًا موجبًا أو نطاقًا مرتبًا مع وحدته. يجب أن تكون أعداد الملفات والشرائح أعدادًا صحيحة.",
    "不明な数量は未確定のままにするか、単位付きで正の正確な個数または順序の正しい範囲を入力してください。ファイル数とスライド数は整数です。",
  ] },
  finiteQuantity: { codes: "finite_members_required no_finite_target quantity_unresolved", text: [
    "Agree a finite number of files before creating individual targets. A flexible slide count or duration does not define how many files are owed.",
    "Convenez d’un nombre fini de fichiers avant de créer les objectifs individuels. Un nombre flexible de diapositives ou une durée flexible ne définit pas le nombre de fichiers dus.",
    "اتفق على عدد محدود من الملفات قبل إنشاء مخرجات مطلوبة فردية. مرونة عدد الشرائح أو المدة لا تحدد عدد الملفات الواجب تسليمها.",
    "個別の納品対象を作る前に、有限のファイル数を合意してください。スライド数や長さに幅があっても、納品するファイル数が決まるわけではありません。",
  ] },
  quantityUnit: { codes: "invalid_unit media_quantity_unit_mismatch member_quantity_unit_mismatch variant_quantity_unit_mismatch count_policy_unit_mismatch content_quantity_unit_mismatch", text: [
    "Use the unit that matches the deliverable: presentations or files for quantity, slides for deck length, and seconds for audio or video duration.",
    "Utilisez l’unité correspondant au livrable : présentations ou fichiers pour la quantité, diapositives pour la longueur du diaporama et secondes pour la durée audio ou vidéo.",
    "استخدم الوحدة المناسبة للمخرج: عروض تقديمية أو ملفات للكمية، وشرائح لطول العرض، وثوانٍ لمدة الصوت أو الفيديو.",
    "納品物に合う単位を使用してください。数量にはプレゼンテーションやファイル、デッキの長さにはスライド数、音声や動画の長さには秒を使います。",
  ] },
  countPolicyRequired: { codes: "content_count_policy_unresolved invalid_count_policy", text: [
    "Choose an exact content count or explicitly accept bounded flexibility within the authored range.",
    "Choisissez un nombre exact d’éléments ou acceptez explicitement une flexibilité limitée à la plage demandée.",
    "اختر عددًا دقيقًا لعناصر المحتوى أو اقبل صراحةً مرونة محدودة ضمن النطاق الأصلي.",
    "コンテンツの個数を正確に指定するか、記述された範囲内の調整を明示的に許容してください。",
  ] },
  countAimInvalid: { codes: "invalid_count_aim invalid_count_suggestion", text: [
    "The suggested aim must stay within the accepted bounds. Changing the aim does not change the authored requirement.",
    "La valeur visée suggérée doit rester dans les limites acceptées. Changer cette valeur ne modifie pas l’exigence rédigée.",
    "يجب أن يبقى العدد المقترح ضمن الحدود المقبولة. تغييره لا يغيّر المتطلب الأصلي.",
    "推奨目標値は合意した範囲内に収めてください。目標値を変えても、記述された要件は変更されません。",
  ] },
  exactCountProtected: { codes: "count_policy_changes_authored_exact", text: [
    "This requirement specifies an exact count. Changing it requires an explicit requirement revision, not a more permissive validation rule.",
    "Cette exigence fixe un nombre exact. Le modifier exige une révision explicite de l’exigence, pas une règle de validation plus permissive.",
    "يحدد هذا المتطلب عددًا دقيقًا. يتطلب تغييره مراجعة صريحة للمتطلب، لا قاعدة تحقق أكثر تساهلًا.",
    "この要件には正確な個数が指定されています。変更するには要件を明示的に改訂する必要があり、検証条件を緩めて対応してはいけません。",
  ] },
  rangeProtected: { codes: "count_policy_exceeds_authored_range", text: [
    "The accepted count policy cannot exceed the authored range. Revise the requirement explicitly if the intended range changed.",
    "La règle de quantité acceptée ne peut pas dépasser la plage rédigée. Révisez explicitement l’exigence si la plage souhaitée a changé.",
    "لا يجوز أن تتجاوز سياسة العدد المقبولة النطاق الأصلي. راجع المتطلب صراحةً إذا تغيّر النطاق المقصود.",
    "合意する個数の条件は、記述された範囲を超えられません。意図した範囲が変わった場合は、要件を明示的に改訂してください。",
  ] },
  staleCountSelection: { codes: "unknown_count_policy_target unknown_optional_selection", text: [
    "This count decision or optional selection belongs to a different requirement revision. Review the current choices without dropping required work.",
    "Cette décision de quantité ou cette sélection facultative appartient à une autre version de l’exigence. Vérifiez les choix actuels sans supprimer de travail obligatoire.",
    "ينتمي قرار العدد أو التحديد الاختياري هذا إلى إصدار آخر من المتطلب. راجع الخيارات الحالية دون إسقاط العمل المطلوب.",
    "この個数の判断または任意項目の選択は、別の版の要件に対応しています。必須の作業を削除せず、現在の選択肢を確認してください。",
  ] },
  sourceScopeRequired: { codes: "invalid_source_scope source_scope_unresolved", text: [
    "Choose the authorized Document or specific source blocks for this deliverable. Missing scope must not silently include more sources.",
    "Choisissez le document autorisé ou des blocs sources précis pour ce livrable. L’absence de périmètre ne doit pas inclure davantage de sources implicitement.",
    "اختر المستند المصرّح به أو كتل مصادر محددة لهذا المخرج. لا يجوز أن يؤدي غياب النطاق إلى تضمين مصادر إضافية بصمت.",
    "この納品物に使う、アクセス権のあるドキュメントまたは個別のソースブロックを選択してください。範囲が未指定でもソースを勝手に増やしてはいけません。",
  ] },
  coverageRequired: { codes: "coverage_unresolved invalid_coverage required_coverage_unresolved", text: [
    "Decide what this deliverable covers: the Document’s creative context, its outline, or named topics. Unresolved coverage cannot be accepted as complete.",
    "Précisez ce que couvre ce livrable : le contexte créatif du document, son plan ou des sujets nommés. Une couverture non définie ne peut pas être acceptée comme complète.",
    "حدّد ما يغطيه هذا المخرج: السياق الإبداعي للمستند أو مخططه أو موضوعات مسمّاة. لا يمكن قبول تغطية غير محسومة على أنها مكتملة.",
    "この納品物が扱う内容を、ドキュメントの創作コンテキスト、概要、または指定したトピックから定めてください。範囲が未確定のまま完了扱いにはできません。",
  ] },
  ratioRequired: { codes: "aspect_ratio_unresolved unresolved_aspect_ratio unresolved_formats invalid_aspect_ratio", text: [
    "Specify an exact aspect ratio using two positive whole numbers. Keep the original wording while unresolved; no format is inferred as completed.",
    "Indiquez des proportions exactes avec deux entiers positifs. Conservez le texte d’origine tant que ce point n’est pas résolu ; aucun format n’est considéré comme terminé par déduction.",
    "حدد نسبة عرض إلى ارتفاع دقيقة باستخدام عددين صحيحين موجبين. احتفظ بالصياغة الأصلية ما دام الأمر غير محسوم؛ لا يُفترض اكتمال أي تنسيق.",
    "正の整数2つで正確な縦横比を指定してください。未確定の間は元の文言を保持します。形式を推測して完了扱いにはしません。",
  ] },
  requiredness: { codes: "invalid_requiredness", text: [
    "Mark each deliverable, variant, and series member as required or optional. An omitted choice cannot silently remove an obligation.",
    "Indiquez si chaque livrable, variante et élément de série est obligatoire ou facultatif. Un choix omis ne peut pas supprimer implicitement une obligation.",
    "حدد ما إذا كان كل مخرج ومتغير وعنصر سلسلة مطلوبًا أم اختياريًا. لا يجوز أن يزيل اختيار محذوف التزامًا بصمت.",
    "各納品物、バリエーション、シリーズ項目を必須または任意として明示してください。選択の欠落によって義務を勝手に削除してはいけません。",
  ] },
  seriesMembers: { codes: "series_membership_unresolved invalid_series_state empty_resolved_series", text: [
    "Agree the finite members of this series and their coverage. An empty series does not fulfill a requested series.",
    "Convenez des éléments en nombre fini de cette série et de leur couverture. Une série vide ne satisfait pas une série demandée.",
    "اتفق على عناصر محدودة لهذه السلسلة وما تغطيه. السلسلة الفارغة لا تفي بسلسلة مطلوبة.",
    "このシリーズの有限個の項目と、それぞれが扱う内容を合意してください。空のシリーズでは、依頼されたシリーズを満たしません。",
  ] },
  requiredMembers: { codes: "required_group_without_required_member", text: [
    "A required group needs required members. Optional choices alone cannot fulfill an unspecified required group.",
    "Un groupe obligatoire doit avoir des éléments obligatoires. Des choix facultatifs seuls ne satisfont pas un groupe obligatoire non précisé.",
    "تحتاج المجموعة المطلوبة إلى عناصر مطلوبة. الخيارات الاختيارية وحدها لا تفي بمجموعة مطلوبة غير محددة.",
    "必須のグループには必須の項目が必要です。任意の選択肢だけでは、未指定の必須グループを満たせません。",
  ] },
  seriesVariants: { codes: "unsupported_series_variants", text: [
    "Series members and format variants are not expanded automatically together. Define explicit deliverables for the combinations you require.",
    "Les éléments de série et les variantes de format ne sont pas combinés automatiquement. Définissez des livrables explicites pour les combinaisons nécessaires.",
    "لا تُوسّع عناصر السلسلة ومتغيرات التنسيق معًا تلقائيًا. عرّف مخرجات صريحة للتركيبات التي تحتاجها.",
    "シリーズ項目と形式バリエーションの組み合わせは自動で展開されません。必要な組み合わせを明示的な納品物として定義してください。",
  ] },
  targetLimit: { codes: "invalid_target_limit target_limit_exceeded", text: [
    "This plan exceeds the supported finite target limit or supplies an invalid limit. Keep the full obligation visible and revise its bounded execution plan.",
    "Ce plan dépasse la limite finie d’objectifs prise en charge ou indique une limite invalide. Gardez l’obligation entière visible et révisez son plan d’exécution limité.",
    "تتجاوز هذه الخطة الحد المحدود المدعوم للمخرجات المطلوبة أو تتضمن حدًا غير صالح. أبقِ الالتزام كاملًا ظاهرًا وراجع خطة تنفيذه المحدودة.",
    "この計画は対応する納品対象数の上限を超えているか、上限が無効です。義務全体を表示したまま、範囲を定めた実行計画を見直してください。",
  ] },
  oneResult: { codes: "choose_one_output_result", text: [
    "Choose one inspected owned file or one completed native result for this target, not both.",
    "Choisissez pour cet objectif un fichier possédé et inspecté ou un résultat natif terminé, mais pas les deux.",
    "اختر لهذا المخرج المطلوب ملفًا تملكه وقد فُحص أو نتيجة مكتملة داخل Forma، وليس كليهما.",
    "この納品対象には、所有する検査済みファイルまたはForma内で完成した結果のどちらか1つを選択してください。両方は選択できません。",
  ] },
  nativeResultIncomplete: { codes: "native_output_not_current_or_complete", text: [
    "This native result is not complete or no longer matches the current target and sources. Check the recorded job before matching a file.",
    "Ce résultat natif n’est pas terminé ou ne correspond plus à l’objectif et aux sources actuels. Vérifiez la tâche enregistrée avant d’associer un fichier.",
    "هذه النتيجة المنتجة داخل Forma غير مكتملة أو لم تعد تطابق المخرج المطلوب والمصادر الحالية. تحقق من المهمة المسجّلة قبل ربط ملف.",
    "このForma内の生成結果は未完成か、現在の納品対象とソースに一致しません。ファイルを関連付ける前に記録済みのジョブを確認してください。",
  ] },
  nativeLineageMissing: { codes: "native_output_completion_evidence_missing native_output_contributor_evidence_missing native_result_lineage_required", text: [
    "The native result lacks verified completion or source lineage. Recover its recorded evidence before matching or accepting it.",
    "Le résultat natif ne dispose pas de preuve vérifiée d’achèvement ou d’origine des sources. Récupérez ses preuves enregistrées avant de l’associer ou de l’accepter.",
    "تفتقر النتيجة المنتجة داخل Forma إلى دليل موثّق على الاكتمال أو تسلسل المصادر. استعد أدلتها المسجّلة قبل ربطها أو قبولها.",
    "このForma内の生成結果には、完了またはソースの来歴の検証済み証拠がありません。関連付けや承認の前に記録された証拠を復旧してください。",
  ] },
  nativeResultUnavailable: { codes: "native_output_bytes_unavailable native_output_content_unavailable", text: [
    "The exact native file or retained content is unavailable. Recover the stored result; a new generation is a separate paid decision.",
    "Le fichier natif précis ou le contenu conservé n’est pas disponible. Récupérez le résultat enregistré ; une nouvelle génération est une décision payante distincte.",
    "الملف الأصلي بعينه أو المحتوى المحفوظ غير متاح. استعد النتيجة المخزنة؛ فالتوليد الجديد قرار مدفوع منفصل.",
    "Formaで生成した正確なファイルまたは保持された内容を利用できません。保存済みの結果を復旧してください。新しい生成には別途有料作業の判断が必要です。",
  ] },
  nativeResultInvalid: { codes: "native_output_content_invalid", text: [
    "The native content cannot be verified as a valid result. Inspect its private failure evidence; do not promote a rejected draft as delivery.",
    "Le contenu natif ne peut pas être vérifié comme résultat valide. Examinez les preuves privées de l’échec ; ne transformez pas un brouillon rejeté en livrable.",
    "لا يمكن التحقق من المحتوى المنتج داخل Forma بوصفه نتيجة صالحة. افحص أدلة فشله الخاصة؛ ولا تقدّم مسودة مرفوضة كمخرج نهائي.",
    "生成内容を有効な結果として検証できません。非公開の失敗記録を確認してください。却下された下書きを納品物として扱ってはいけません。",
  ] },
  nativeMediumUnsupported: { codes: "native_output_medium_unsupported native_result_adoption_unavailable", text: [
    "This native result cannot be adopted through the current delivery route. Use a supported inspected owned file without claiming the native result was accepted.",
    "Ce résultat natif ne peut pas être adopté par le parcours actuel. Utilisez un fichier possédé, pris en charge et inspecté sans prétendre que le résultat natif a été accepté.",
    "لا يمكن اعتماد هذه النتيجة المنتجة داخل Forma عبر مسار التسليم الحالي. استخدم ملفًا تملكه ومدعومًا ومفحوصًا دون الادعاء بأن النتيجة الأصلية قُبلت.",
    "このForma内の結果は現在の納品経路で採用できません。元の結果を承認済みとせず、対応する所有済みの検査済みファイルを使用してください。",
  ] },
  nativeSourceRecheck: { codes: "native_output_source_needs_recheck native_output_needs_source_revalidation", text: [
    "The native result needs source revalidation against the current requirement. Earlier completion does not establish current acceptance.",
    "Les sources du résultat natif doivent être revalidées selon l’exigence actuelle. Un achèvement antérieur ne prouve pas son acceptation actuelle.",
    "تحتاج النتيجة المنتجة داخل Forma إلى إعادة التحقق من المصادر وفق المتطلب الحالي. الاكتمال السابق لا يثبت القبول الحالي.",
    "このForma内の結果は、現在の要件に対してソースを再検証する必要があります。以前の完了は、現在の承認を意味しません。",
  ] },
  ownedRightsRequired: { codes: "owned_file_rights_attestation_required output_asset_rights_evidence_missing", text: [
    "Confirm and retain evidence that you own or may use this exact file and its contents before adopting it.",
    "Confirmez et conservez la preuve que vous possédez ou pouvez utiliser ce fichier précis et son contenu avant de l’adopter.",
    "أكد واحتفظ بدليل على ملكيتك لهذا الملف بعينه ومحتوياته أو سماح استخدامهما قبل اعتماده.",
    "採用する前に、この正確なファイルと内容を所有しているか利用できることを確認し、その根拠を保持してください。",
  ] },
  assetUnavailable: { codes: "output_asset_unavailable", text: [
    "This file is unavailable in the current authorized scope. Select an available inspected file or upload an owned copy.",
    "Ce fichier n’est pas disponible dans le périmètre autorisé actuel. Sélectionnez un fichier inspecté disponible ou importez une copie possédée.",
    "هذا الملف غير متاح ضمن النطاق المصرّح به حاليًا. اختر ملفًا مفحوصًا متاحًا أو ارفع نسخة تملكها.",
    "このファイルは現在アクセスできる範囲では利用できません。利用可能な検査済みファイルを選ぶか、所有するコピーをアップロードしてください。",
  ] },
  assetChanged: { codes: "output_asset_bytes_changed output_asset_custody_mismatch output_accepted_file_changed output_delivery_hash_mismatch output_delivery_file_mapping_mismatch output_delivery_file_inventory_changed output_delivery_package_changed", text: [
    "The file bytes or their recorded association no longer match. Reinspect the exact file before review or delivery; earlier acceptance cannot be reused blindly.",
    "Les octets du fichier ou leur association enregistrée ne correspondent plus. Réinspectez le fichier précis avant révision ou livraison ; l’acceptation antérieure ne peut pas être réutilisée sans vérification.",
    "لم تعد بايتات الملف أو ارتباطها المسجّل متطابقة. أعد فحص الملف بعينه قبل المراجعة أو التسليم؛ لا يجوز إعادة استخدام القبول السابق دون تحقق.",
    "ファイルのバイト列または記録された対応が一致しなくなりました。レビューや納品の前に正確なファイルを再検査してください。以前の承認を無条件で再利用できません。",
  ] },
  assetInspectionRequired: { codes: "output_asset_not_inspectable output_asset_not_inspected asset_structure_unverified output_delivery_file_inspection_failed", text: [
    "This exact file has not passed the supported byte inspection. Check the reported format problem and use a valid supported file before acceptance.",
    "Ce fichier précis n’a pas réussi l’inspection des octets prise en charge. Vérifiez le problème de format signalé et utilisez un fichier valide pris en charge avant l’acceptation.",
    "لم يجتز هذا الملف بعينه فحص البايتات المدعوم. تحقق من مشكلة التنسيق المبلّغ عنها واستخدم ملفًا صالحًا ومدعومًا قبل القبول.",
    "この正確なファイルは、対応するバイト検査に合格していません。報告された形式の問題を確認し、承認前に有効な対応ファイルを使用してください。",
  ] },
  mediumMismatch: { codes: "target_media_kind_mismatch", text: [
    "The inspected file’s media type does not match this target. Choose the correct file; renaming its extension does not change its format.",
    "Le type de média du fichier inspecté ne correspond pas à cet objectif. Choisissez le bon fichier ; renommer son extension ne modifie pas son format.",
    "نوع وسائط الملف المفحوص لا يطابق هذا المخرج المطلوب. اختر الملف الصحيح؛ فتغيير امتداده لا يغيّر تنسيقه.",
    "検査したファイルのメディア種別が納品対象と一致しません。正しいファイルを選択してください。拡張子の変更だけでは形式は変わりません。",
  ] },
  ratioUnmeasured: { codes: "required_aspect_ratio_unmeasured", text: [
    "The required aspect ratio could not be measured from this file. Use a supported file whose dimensions can be verified.",
    "Les proportions requises n’ont pas pu être mesurées dans ce fichier. Utilisez un fichier pris en charge dont les dimensions peuvent être vérifiées.",
    "تعذر قياس نسبة العرض إلى الارتفاع المطلوبة من هذا الملف. استخدم ملفًا مدعومًا يمكن التحقق من أبعاده.",
    "このファイルから必要な縦横比を測定できませんでした。寸法を検証できる対応ファイルを使用してください。",
  ] },
  ratioMismatch: { codes: "required_aspect_ratio_mismatch", text: [
    "The measured aspect ratio differs from the requirement. Supply a matching file or explicitly revise the requirement; do not silently crop or relax it.",
    "Les proportions mesurées diffèrent de l’exigence. Fournissez un fichier conforme ou révisez explicitement l’exigence ; ne recadrez pas et ne l’assouplissez pas implicitement.",
    "تختلف نسبة العرض إلى الارتفاع المقاسة عن المتطلب. قدّم ملفًا مطابقًا أو راجع المتطلب صراحةً؛ ولا تقصّه أو تخفف شروطه بصمت.",
    "測定した縦横比が要件と異なります。適合するファイルを用意するか、要件を明示的に改訂してください。勝手に切り抜いたり条件を緩めたりしてはいけません。",
  ] },
  contentCountUnmeasured: { codes: "required_content_quantity_unmeasured", text: [
    "The required slide count or duration could not be verified under an accepted count policy. Confirm the policy and inspect a supported file.",
    "Le nombre de diapositives ou la durée requis n’ont pas pu être vérifiés selon une règle acceptée. Confirmez la règle et inspectez un fichier pris en charge.",
    "تعذر التحقق من عدد الشرائح أو المدة المطلوبة وفق سياسة عدد مقبولة. أكد السياسة وافحص ملفًا مدعومًا.",
    "合意した個数の条件に基づいて、必要なスライド数または長さを検証できませんでした。条件を確定し、対応するファイルを検査してください。",
  ] },
  contentCountMismatch: { codes: "required_content_quantity_mismatch", text: [
    "The measured count or duration does not satisfy the accepted exact count or range. Correct the file; a failed result does not relax the requirement.",
    "Le nombre ou la durée mesurés ne respectent pas le nombre exact ou la plage acceptés. Corrigez le fichier ; un échec n’assouplit pas l’exigence.",
    "لا يفي العدد أو المدة المقاسان بالعدد الدقيق أو النطاق المقبول. صحح الملف؛ فالنتيجة الفاشلة لا تخفف المتطلب.",
    "測定した個数または長さが、合意した正確な値または範囲を満たしていません。ファイルを修正してください。失敗した結果に合わせて要件を緩めてはいけません。",
  ] },
  resultNotFound: { codes: "output_result_not_found", text: [
    "This exact result is unavailable in the current Document. Refresh and select an available result before reviewing it.",
    "Ce résultat précis n’est pas disponible dans le document actuel. Actualisez et sélectionnez un résultat disponible avant de l’examiner.",
    "هذه النتيجة بعينها غير متاحة في المستند الحالي. حدّث البيانات واختر نتيجة متاحة قبل مراجعتها.",
    "この正確な結果は現在のドキュメントで利用できません。更新して利用可能な結果を選び直してからレビューしてください。",
  ] },
  resultRecheck: { codes: "output_acceptance_needs_recheck output_result_needs_recheck output_delivery_acceptance_changed prior_output_acceptance_not_eligible", text: [
    "Earlier acceptance does not currently satisfy this target. Recheck the exact file, target contract, source revision, rights, and review before using it here.",
    "L’acceptation antérieure ne satisfait pas actuellement cet objectif. Revérifiez le fichier précis, le contrat de l’objectif, la version source, les droits et la révision avant de l’utiliser ici.",
    "لا يفي القبول السابق بهذا المخرج المطلوب حاليًا. أعد التحقق من الملف بعينه وشروط المخرج وإصدار المصادر والحقوق والمراجعة قبل استخدامه هنا.",
    "以前の承認は、現在この納品対象の要件を満たしていません。正確なファイル、納品条件、ソースの版、権利、レビューを再確認してから使用してください。",
  ] },
  humanReviewRequired: { codes: "output_content_and_rights_review_required", text: [
    "Review this exact file’s content, required source coverage, layout or playback, accessibility, and current usage rights before accepting it.",
    "Examinez le contenu, la couverture des sources requise, la mise en page ou la lecture, l’accessibilité et les droits d’utilisation actuels de ce fichier précis avant de l’accepter.",
    "راجع محتوى هذا الملف بعينه وتغطية المصادر المطلوبة وتخطيطه أو تشغيله وإمكانية الوصول وحقوق الاستخدام الحالية قبل قبوله.",
    "承認する前に、この正確なファイルの内容、必要なソースの範囲、レイアウトまたは再生、アクセシビリティ、現在の利用権を確認してください。",
  ] },
  independentReviewer: { codes: "independent_output_reviewer_required", text: [
    "An authorized reviewer other than this result’s author must accept it. Self-approval does not satisfy the project’s review rule.",
    "Un réviseur autorisé autre que l’auteur de ce résultat doit l’accepter. L’auto-approbation ne satisfait pas la règle de révision du projet.",
    "يجب أن يقبل هذه النتيجة مراجع مخوّل غير مؤلفها. القبول الذاتي لا يفي بقاعدة مراجعة المشروع.",
    "この結果の作者とは別の、権限を持つレビュアーによる承認が必要です。自己承認ではプロジェクトのレビュー条件を満たしません。",
  ] },
  mandatoryChecks: { codes: "output_mandatory_checks_failed", text: [
    "Mandatory file checks have not passed. Correct the reported problems; human approval cannot override these checks.",
    "Les contrôles obligatoires du fichier n’ont pas réussi. Corrigez les problèmes signalés ; l’approbation humaine ne peut pas contourner ces contrôles.",
    "لم يجتز الملف الفحوص الإلزامية. صحح المشكلات المبلّغ عنها؛ ولا يمكن للموافقة البشرية تجاوز هذه الفحوص.",
    "必須のファイル検査に合格していません。報告された問題を修正してください。人による承認で必須の検査を省略することはできません。",
  ] },
  reviewDecision: { codes: "output_review_decision_required", text: [
    "Choose whether to accept this exact result or request changes.",
    "Choisissez d’accepter ce résultat précis ou de demander des modifications.",
    "اختر قبول هذه النتيجة بعينها أو طلب تعديلات.",
    "この正確な結果を承認するか、修正を依頼するかを選択してください。",
  ] },
  reviewNoteTooLong: { codes: "output_review_note_too_long", text: [
    "The review note is too long. Shorten it within the displayed limit without removing the required changes.",
    "La note de révision est trop longue. Raccourcissez-la dans la limite affichée sans supprimer les modifications nécessaires.",
    "ملاحظة المراجعة طويلة جدًا. اختصرها ضمن الحد المعروض دون حذف التعديلات المطلوبة.",
    "レビューのメモが長すぎます。必要な修正内容を残し、表示された上限内に短くしてください。",
  ] },
  distinctFiles: { codes: "physical_output_targets_require_distinct_files duplicate_output_delivery_file_bytes", text: [
    "These physical deliverables require distinct files. Reusing identical bytes must not count as producing multiple owed files.",
    "Ces livrables physiques exigent des fichiers distincts. Réutiliser des octets identiques ne doit pas compter comme la production de plusieurs fichiers dus.",
    "تتطلب هذه المخرجات الفعلية ملفات متميزة. لا يجوز احتساب إعادة استخدام البايتات نفسها على أنها إنتاج عدة ملفات مطلوبة.",
    "これらの実ファイルの納品対象には、異なるファイルが必要です。同一のバイト列の再利用を、複数の必須ファイルの制作として数えてはいけません。",
  ] },
  assignmentIncomplete: { codes: "output_assignment_incomplete", text: [
    "The assignment is not complete. Finish the remaining obligations or explicitly download a partial package with its missing-work manifest.",
    "La mission n’est pas terminée. Réalisez les obligations restantes ou téléchargez explicitement un ensemble partiel avec la liste des travaux manquants.",
    "المهمة غير مكتملة. أنجز الالتزامات المتبقية أو نزّل صراحةً حزمة جزئية مع قائمة العمل الناقص.",
    "依頼は未完了です。残りの義務を完了するか、不足する作業の一覧を含む部分的なパッケージを明示的にダウンロードしてください。",
  ] },
  noAcceptedFiles: { codes: "no_accepted_outputs_to_export", text: [
    "No accepted, current files are available to download. Match and review actual files; a confirmed plan alone is not a deliverable.",
    "Aucun fichier accepté et à jour n’est disponible au téléchargement. Associez et examinez des fichiers réels ; un plan confirmé seul n’est pas un livrable.",
    "لا توجد ملفات مقبولة ومحدّثة متاحة للتنزيل. اربط ملفات فعلية وراجعها؛ فالخطة المؤكدة وحدها ليست مخرجًا للتسليم.",
    "ダウンロードできる承認済みの現行ファイルがありません。実際のファイルを関連付けてレビューしてください。計画の確定だけでは納品物になりません。",
  ] },
  deliveryRecheck: { codes: "output_delivery_needs_recheck output_delivery_scope_changed", text: [
    "This delivery package no longer matches current requirements, sources, or rights. Recheck the exact files before downloading a current package.",
    "Cet ensemble de livraison ne correspond plus aux exigences, sources ou droits actuels. Revérifiez les fichiers précis avant de télécharger un ensemble actuel.",
    "لم تعد حزمة التسليم هذه تطابق المتطلبات أو المصادر أو الحقوق الحالية. أعد فحص الملفات بعينها قبل تنزيل حزمة حالية.",
    "この納品パッケージは現在の要件、ソース、または権利に一致しません。現在のパッケージを取得する前に、正確なファイルを再確認してください。",
  ] },
  deliveryUnavailable: { codes: "output_delivery_not_found output_delivery_part_not_found invalid_output_delivery_part", text: [
    "This recorded delivery package is unavailable. Open the current Document to inspect available packages and their exact files.",
    "Cet ensemble de livraison enregistré n’est pas disponible. Ouvrez le document actuel pour examiner les ensembles disponibles et leurs fichiers précis.",
    "حزمة التسليم المسجّلة هذه غير متاحة. افتح المستند الحالي لفحص الحزم المتاحة وملفاتها بعينها.",
    "この記録済みの納品パッケージを利用できません。現在のドキュメントを開き、利用可能なパッケージとその正確なファイルを確認してください。",
  ] },
  archiveStructure: { codes: "invalid_output_delivery_date invalid_output_delivery_expected_hash invalid_output_delivery_plan invalid_output_delivery_target invalid_output_delivery_target_count invalid_output_delivery_file_count duplicate_output_delivery_target unsafe_or_duplicate_output_file_id output_delivery_archive_size_mismatch duplicate_output_delivery_part_file invalid_output_delivery_package_file invalid_output_delivery_package_file_count output_delivery_package_mapping_mismatch output_delivery_part_file_mismatch invalid_output_delivery_id invalid_output_delivery_part_file_limit", text: [
    "The package inventory or file mapping is invalid. Rebuild it from the current accepted files; do not mark missing or duplicated entries as delivered.",
    "L’inventaire ou la correspondance des fichiers de l’ensemble est invalide. Reconstruisez-le à partir des fichiers acceptés actuels ; ne considérez pas les entrées manquantes ou dupliquées comme livrées.",
    "قائمة محتويات الحزمة أو ربط ملفاتها غير صالح. أعد بناءها من الملفات المقبولة الحالية؛ ولا تعتبر العناصر المفقودة أو المكررة مسلّمة.",
    "パッケージの一覧またはファイルの対応が無効です。現在の承認済みファイルから作成し直してください。欠落や重複のある項目を納品済みにしてはいけません。",
  ] },
  archiveSize: { codes: "output_delivery_archive_too_large output_delivery_manifest_too_large invalid_output_delivery_file_size", text: [
    "These files exceed the supported package or file size limit. Use bounded package parts or supported files while keeping the full assignment visible.",
    "Ces fichiers dépassent la limite prise en charge pour l’ensemble ou un fichier. Utilisez des parties de taille limitée ou des fichiers pris en charge en gardant la mission complète visible.",
    "تتجاوز هذه الملفات حد حجم الحزمة أو الملف المدعوم. استخدم أجزاء حزمة محدودة أو ملفات مدعومة مع إبقاء المهمة الكاملة ظاهرة.",
    "ファイルが対応するパッケージまたは単一ファイルのサイズ上限を超えています。依頼全体を表示したまま、上限内の分割パッケージまたは対応ファイルを使用してください。",
  ] },
  requestSize: { codes: "output_request_too_large", text: [
    "This request exceeds the supported size limit. Keep your draft and reduce the upload or request size before resubmitting.",
    "Cette demande dépasse la taille maximale prise en charge. Conservez votre brouillon et réduisez la taille de l’import ou de la demande avant de la soumettre à nouveau.",
    "يتجاوز هذا الطلب حد الحجم المدعوم. احتفظ بمسودتك وقلل حجم الملف المرفوع أو الطلب قبل إعادة إرساله.",
    "この依頼は対応するサイズ上限を超えています。下書きを保持し、アップロードまたは依頼のサイズを減らしてから再送信してください。",
  ] },
  nativeTargetSelection: { codes: "output_native_target_not_selected", text: [
    "Select this resolved target before requesting native creation.", "Sélectionnez cet objectif résolu avant de demander sa création native.", "حدد هذا المخرج المطلوب بعد حسمه قبل طلب إنشائه داخل Forma.", "Forma内での生成を依頼する前に、この確定済みの納品対象を選択してください。",
  ] },
  nativeDocumentScope: { codes: "output_native_document_scope_required", text: [
    "Native creation currently requires the full authorized Document. A target with narrower source scope can use an inspected owned file.",
    "La création native nécessite actuellement le document autorisé entier. Un objectif au périmètre source plus restreint peut utiliser un fichier possédé et inspecté.",
    "يتطلب الإنشاء داخل Forma حاليًا المستند المصرّح به كاملًا. يمكن لمخرج ذي نطاق مصادر أضيق استخدام ملف تملكه وقد فُحص.",
    "現在、Forma内で生成するにはアクセスが許可されたドキュメント全体が必要です。ソース範囲が狭い納品対象には、所有する検査済みファイルを使用できます。",
  ] },
  nativeMediumAdoption: { codes: "output_native_medium_adoption_only", text: [
    "This medium uses inspected owned-file adoption in this release. Forma does not substitute a different provider job.",
    "Dans cette version, ce média utilise l’adoption de fichiers possédés et inspectés. Forma ne substitue pas une autre tâche fournisseur.",
    "يستخدم هذا النوع من الوسائط في هذا الإصدار اعتماد ملفات تملكها وقد فُحصت. لا تستبدل Forma مهمة مزوّد مختلفة.",
    "この版では、このメディアは所有する検査済みファイルの採用で対応します。別のプロバイダージョブに置き換えることはありません。",
  ] },
  plannerUnconfigured: { codes: "output_native_planner_unconfigured", text: [
    "The planning provider is not configured. Saving requirements and adopting owned files remain available.",
    "Le fournisseur de planification n’est pas configuré. L’enregistrement des exigences et l’adoption de fichiers possédés restent disponibles.",
    "لم يُضبط مزوّد التخطيط. يظل حفظ المتطلبات واعتماد الملفات التي تملكها متاحين.",
    "計画用のプロバイダーが設定されていません。要件の保存と所有ファイルの採用は引き続き利用できます。",
  ] },
  plannerPriceUnknown: { codes: "output_native_planner_price_unknown", text: [
    "The configured planning model has no verified price contract. Native generation remains blocked until its cost can be bounded.",
    "Le modèle de planification configuré n’a pas de contrat tarifaire vérifié. La génération native reste bloquée tant que son coût ne peut pas être plafonné.",
    "لا توجد شروط تسعير موثّقة لنموذج التخطيط المضبوط. يظل التوليد داخل Forma محظورًا حتى يمكن تحديد حد لتكلفته.",
    "設定された計画モデルの料金条件が検証されていません。費用の上限を定められるまで、Forma内の生成は停止します。",
  ] },
  nativeSourceRequired: { codes: "output_native_source_required output_native_slide_source_unresolved", text: [
    "Add or resolve an active, authorized factual source before creating this target. Output instructions alone are not supporting evidence.",
    "Ajoutez ou précisez une source factuelle active et autorisée avant de créer cet objectif. Les consignes de livrable seules ne constituent pas des preuves.",
    "أضف مصدرًا واقعيًا نشطًا ومصرّحًا به أو احسمه قبل إنشاء هذا المخرج المطلوب. تعليمات المخرجات وحدها ليست أدلة داعمة.",
    "この納品対象を作成する前に、有効で利用が許可された事実のソースを追加または確定してください。納品の指示だけでは裏付けになりません。",
  ] },
  nativeSlidePolicy: { codes: "output_native_slide_count_policy_required", text: [
    "Confirm an exact or flexible slide-count policy before requesting a deck. The authored slide range remains unchanged.",
    "Confirmez une règle de nombre exact ou flexible de diapositives avant de demander un diaporama. La plage rédigée reste inchangée.",
    "أكد سياسة عدد شرائح دقيق أو مرن قبل طلب عرض. يبقى نطاق الشرائح الأصلي دون تغيير.",
    "デッキを依頼する前に、正確なスライド数または幅を許容する条件を確定してください。記述されたスライド数の範囲は変わりません。",
  ] },
  nativeSlideCountUnsupported: { codes: "output_native_slide_count_unsupported", text: [
    "The accepted slide-count policy is unsupported by this native route. Use a verified owned deck or explicitly revise the requirement.",
    "La règle de quantité de diapositives acceptée n’est pas prise en charge par ce parcours natif. Utilisez un diaporama possédé et vérifié ou révisez explicitement l’exigence.",
    "لا يدعم هذا المسار داخل Forma سياسة عدد الشرائح المقبولة. استخدم عرضًا تملكه وقد تم التحقق منه أو راجع المتطلب صراحةً.",
    "合意したスライド数の条件に、この生成経路は対応していません。所有する検証済みデッキを使うか、要件を明示的に改訂してください。",
  ] },
  nativeImageRatioRequired: { codes: "output_native_image_ratio_required", text: [
    "Confirm the exact image aspect ratio before requesting generation.", "Confirmez les proportions exactes de l’image avant de demander sa génération.", "أكد نسبة العرض إلى الارتفاع الدقيقة للصورة قبل طلب التوليد.", "生成を依頼する前に、画像の正確な縦横比を確定してください。",
  ] },
  nativeImageRatioUnsupported: { codes: "output_native_image_ratio_unsupported", text: [
    "The provider cannot create this exact aspect ratio within its dimension limits. Adopt an inspected file or explicitly revise the requirement.",
    "Le fournisseur ne peut pas produire ces proportions exactes dans ses limites de dimensions. Adoptez un fichier inspecté ou révisez explicitement l’exigence.",
    "لا يستطيع المزوّد إنشاء نسبة العرض إلى الارتفاع الدقيقة هذه ضمن حدود أبعاده. اعتمد ملفًا مفحوصًا أو راجع المتطلب صراحةً.",
    "プロバイダーは寸法制限内でこの正確な縦横比を生成できません。検査済みファイルを採用するか、要件を明示的に改訂してください。",
  ] },
  referenceInputUnpriced: { codes: "output_native_reference_input_unpriced", text: [
    "This bounded image route cannot yet price reference-pixel input for GPT Image 2. No requested reference is omitted: use an inspected owned image or explicitly change the reference requirement.",
    "Ce parcours d’image plafonné ne peut pas encore tarifer l’entrée de pixels de référence pour GPT Image 2. Aucune référence demandée n’est omise : utilisez une image possédée et inspectée ou modifiez explicitement l’exigence de référence.",
    "لا يستطيع مسار الصور المحدود هذا تسعير إدخال بكسلات المرجع لـ GPT Image 2 حتى الآن. لا يُحذف أي مرجع مطلوب: استخدم صورة تملكها وقد فُحصت أو غيّر متطلب المرجع صراحةً.",
    "この費用枠付き画像生成経路では、GPT Image 2の参照画像ピクセル入力の料金をまだ算定できません。依頼された参照を省くことはありません。所有する検査済み画像を使うか、参照要件を明示的に変更してください。",
  ] },
  nativeAdapterUnsupported: { codes: "output_native_image_adapter_unsupported", text: [
    "This bounded image route currently supports only the configured OpenAI adapter. The selected provider is not replaced silently; adopt an owned image instead.",
    "Ce parcours d’image plafonné ne prend actuellement en charge que l’adaptateur OpenAI configuré. Le fournisseur sélectionné n’est pas remplacé implicitement ; adoptez plutôt une image possédée.",
    "يدعم مسار الصور المحدود هذا حاليًا محوّل OpenAI المضبوط فقط. لا يُستبدل المزوّد المحدد بصمت؛ اعتمد بدلًا من ذلك صورة تملكها.",
    "この費用枠付き画像生成経路は、現在、設定されたOpenAIアダプターのみに対応しています。選択したプロバイダーを無断で切り替えることはありません。代わりに所有する画像を採用してください。",
  ] },
  nativeProviderUnavailable: { codes: "output_native_image_provider_unavailable", text: [
    "The requested image provider is unavailable for this bounded route. No automatic provider fallback is authorized.",
    "Le fournisseur d’images demandé n’est pas disponible pour ce parcours plafonné. Aucun remplacement automatique de fournisseur n’est autorisé.",
    "مزوّد الصور المطلوب غير متاح لهذا المسار المحدود. لم يُؤذن بأي انتقال تلقائي إلى مزوّد بديل.",
    "依頼した画像プロバイダーは、この費用枠付きの経路では利用できません。別のプロバイダーへの自動切り替えは許可されていません。",
  ] },
  nativeImagePriceUnknown: { codes: "output_native_image_price_unknown", text: [
    "The configured image model or size has no verified pricing contract. Forma will not substitute an assumed rate or another provider.",
    "Le modèle ou la taille d’image configuré n’a pas de contrat tarifaire vérifié. Forma ne substituera ni tarif supposé ni autre fournisseur.",
    "لا توجد شروط تسعير موثّقة لنموذج الصور أو الحجم المضبوط. لن تستخدم Forma سعرًا مفترضًا أو مزوّدًا آخر بدلًا منه.",
    "設定された画像モデルまたはサイズの料金条件が検証されていません。推測した料金や別のプロバイダーに置き換えることはありません。",
  ] },
  nativeSlidesReady: { codes: "output_native_slides_ready", text: [
    "One initial request and at most one repair. The accepted count policy remains unchanged.",
    "Une demande initiale et au plus une correction. La règle de quantité acceptée reste inchangée.",
    "طلب أولي واحد وإصلاح واحد على الأكثر. تبقى سياسة العدد المقبولة دون تغيير.",
    "初回の依頼1回と、最大1回の修正です。合意した個数の条件は変更されません。",
  ] },
  nativeImageReady: { codes: "output_native_image_ready", text: [
    "At most two generation calls: one direction call and one image call at the exact size. After authorization and Start, Forma sends the exact final image prompt as text to OpenAI (omni-moderation-latest) for at most one additional automatic safety check before image creation. This check is not counted as a generation call and is currently free under OpenAI’s pricing.",
    "Au plus deux appels de génération : un pour la direction et un pour l’image aux dimensions exactes. Après l’autorisation et le démarrage, Forma envoie le texte exact de l’instruction finale de l’image à OpenAI (omni-moderation-latest) pour au plus un contrôle automatique de sécurité supplémentaire avant la création de l’image. Ce contrôle n’est pas compté comme un appel de génération et est actuellement gratuit selon la tarification d’OpenAI.",
    "استدعاءان للتوليد على الأكثر: استدعاء واحد لتحديد التوجه واستدعاء واحد للصورة بالحجم الدقيق. بعد الإذن والبدء، ترسل Forma النص النهائي لتعليمات الصورة كما هو إلى OpenAI (omni-moderation-latest) لإجراء فحص سلامة آلي إضافي واحد على الأكثر قبل إنشاء الصورة. لا يُحتسب هذا الفحص كاستدعاء توليد، وهو مجاني حاليًا وفق تسعير OpenAI.",
    "生成呼び出しは最大2回で、方向性を決める呼び出し1回と、正確なサイズの画像を作成する呼び出し1回です。許可と開始の操作の後、Formaは最終的な画像プロンプトの全文をそのままOpenAI（omni-moderation-latest）に送り、画像を作成する前に、追加の自動安全確認を最大1回行います。この確認は生成呼び出しには数えられず、現在のOpenAIの料金体系では無料です。",
  ] },
  transferNone: { codes: "output_transfer_none_authorized", text: [
    "No source transmission is authorized by this check.", "Cette vérification n’autorise aucune transmission de sources.", "لا يأذن هذا الفحص بأي نقل للمصادر.", "この確認では、ソースの送信は許可されません。",
  ] },
  transferNoneAdoption: { codes: "output_transfer_none_owned_adoption", text: [
    "This check sends no source or file. You may use an owned file after inspection and review.",
    "Cette vérification n’envoie aucune source ni aucun fichier. Vous pouvez utiliser un fichier possédé après inspection et révision.",
    "لا يرسل هذا الفحص أي مصدر أو ملف. يمكنك استخدام ملف تملكه بعد فحصه ومراجعته.",
    "この確認ではソースやファイルを送信しません。検査とレビューの後、所有するファイルを使用できます。",
  ] },
  transferDocument: { codes: "output_transfer_document_after_authorization", text: [
    "After you authorize and start, the authorized Document source context and selected target instructions go to the disclosed provider. Native image attempts also send the exact final image prompt as text to OpenAI (omni-moderation-latest) for at most one additional automatic safety check before image creation. This check is not counted as a generation call and is currently free under OpenAI’s pricing. If reference pixels are required, native image generation is unavailable. This preflight sends nothing. Account and provider ceilings are separate; the displayed cap bounds application admission, not a guarantee of provider billing.",
    "Après votre autorisation et le démarrage, le contexte source autorisé du document et les instructions de l’objectif sélectionné sont envoyés au fournisseur indiqué. Les tentatives de génération native d’image envoient également le texte exact de l’instruction finale de l’image à OpenAI (omni-moderation-latest) pour au plus un contrôle automatique de sécurité supplémentaire avant la création de l’image. Ce contrôle n’est pas compté comme un appel de génération et est actuellement gratuit selon la tarification d’OpenAI. Si des pixels de référence sont requis, la génération native d’image est indisponible. Cette vérification préalable n’envoie rien. Les plafonds du compte et du fournisseur sont distincts ; le plafond affiché limite l’admission par l’application et ne garantit pas la facturation du fournisseur.",
    "بعد أن تأذن وتبدأ، يُرسل سياق مصادر المستند المصرّح به وتعليمات المخرج المحدد إلى المزوّد الموضّح. وترسل محاولات التوليد المدمج للصور أيضًا النص النهائي لتعليمات الصورة كما هو إلى OpenAI (omni-moderation-latest) لإجراء فحص سلامة آلي إضافي واحد على الأكثر قبل إنشاء الصورة. لا يُحتسب هذا الفحص كاستدعاء توليد، وهو مجاني حاليًا وفق تسعير OpenAI. إذا كانت بكسلات مرجعية مطلوبة، فلا يتوفر التوليد المدمج للصور. لا يرسل هذا الفحص المسبق شيئًا. حدود الحساب والمزوّد منفصلة؛ فالحد المعروض يقيّد قبول التطبيق للطلبات، ولا يضمن فاتورة المزوّد.",
    "許可して開始すると、利用が許可されたドキュメントのソースコンテキストと、選択した納品対象の指示が提示されたプロバイダーに送信されます。ネイティブ画像の試行では、最終的な画像プロンプトの全文をそのままOpenAI（omni-moderation-latest）にも送り、画像を作成する前に追加の自動安全確認を最大1回行います。この確認は生成呼び出しには数えられず、現在のOpenAIの料金体系では無料です。参照画像のピクセルが必要な場合、ネイティブ画像生成は利用できません。この事前確認では何も送信しません。アカウントとプロバイダーの上限は別のものです。表示された上限はアプリ側の実行受付を制限するもので、プロバイダーの請求額を保証するものではありません。",
  ] },
  imageAllowance: { codes: "output_native_image_allowance_verified", text: [
    "The allowance uses UTF-8 prompt bytes plus protocol headroom and twice the documented output-token estimate for this exact high-quality frame. Provider receipts determine actual charges; no further request is allowed after an overrun or uncertain response.",
    "Le plafond utilise les octets UTF-8 de l’instruction, une marge de protocole et le double de l’estimation documentée des jetons de sortie pour cette image précise de haute qualité. Les reçus fournisseur déterminent les frais réels ; aucune autre demande n’est permise après un dépassement ou une réponse incertaine.",
    "يعتمد المخصص على بايتات التعليمات بترميز UTF-8 مع هامش للبروتوكول، وضعف التقدير الموثّق لرموز الإخراج لهذا الإطار الدقيق عالي الجودة. تحدد إيصالات المزوّد الرسوم الفعلية؛ ولا يُسمح بطلب إضافي بعد تجاوز الحد أو استجابة غير مؤكدة.",
    "費用枠は、UTF-8のプロンプトのバイト数に通信処理の余裕を加え、この正確な高画質フレームに対して文書化された出力トークン見積もりの2倍を用いて算定します。実際の料金はプロバイダーの記録で決まります。上限超過または応答が未確定の場合、追加の依頼は許可されません。",
  ] },
  wholeDocumentRecheck: { codes: "output_full_document_recheck", text: [
    "Stored source and target versions are checked conservatively against the full Document.",
    "Les versions sources et objectifs enregistrées sont revérifiées de manière prudente selon le document entier.",
    "تُفحص إصدارات المصادر والمخرجات المسجّلة بحذر بالرجوع إلى المستند كاملًا.",
    "保存されたソースと納品対象の版は、ドキュメント全体に照らして保守的に確認します。",
  ] },
  inspectionRequiresReview: { codes: "output_inspection_requires_human_review", text: [
    "File inspection verifies structure and measured properties. Human content review and current usage rights remain required.",
    "L’inspection des fichiers vérifie la structure et les propriétés mesurées. La révision humaine du contenu et les droits d’utilisation actuels restent nécessaires.",
    "يتحقق فحص الملف من البنية والخصائص المقاسة. وتظل المراجعة البشرية للمحتوى وحقوق الاستخدام السارية مطلوبة.",
    "ファイル検査で確認するのは構造と測定可能な特性です。人による内容のレビューと、現在有効な利用権の確認が引き続き必要です。",
  ] },
  inspectionNotAcceptance: { codes: "output_inspection_not_acceptance", text: [
    "Inspection does not establish acceptance, ownership, provenance, or useful content grounded in the sources.",
    "L’inspection n’établit ni l’acceptation, ni la propriété, ni la provenance, ni l’utilité d’un contenu fondé sur les sources.",
    "لا يثبت الفحص القبول أو الملكية أو الأصل أو فائدة المحتوى واستناده إلى المصادر.",
    "検査だけでは、承認、所有権、来歴、ソースに基づく有用な内容は証明されません。",
  ] },
  pngReview: { codes: "output_png_visual_review_required", text: [
    "PNG structure was inspected; reconstructed pixels and visual content still require review.",
    "La structure PNG a été inspectée ; les pixels reconstruits et le contenu visuel doivent encore être examinés.",
    "فُحصت بنية PNG؛ ولا تزال البكسلات المعاد بناؤها والمحتويات المرئية بحاجة إلى مراجعة.",
    "PNGの構造を検査しました。ピクセルを復元した表示と視覚的な内容のレビューは、引き続き必要です。",
  ] },
  jpegReview: { codes: "output_jpeg_decode_review_required", text: [
    "JPEG entropy was not decoded into pixels. Decode and review the image’s visual content before acceptance.",
    "Les données entropiques JPEG n’ont pas été décodées en pixels. Décodez et examinez le contenu visuel de l’image avant l’acceptation.",
    "لم تُفك بيانات ترميز JPEG إلى بكسلات. فك الصورة وراجع محتواها المرئي قبل القبول.",
    "JPEGのエントロピー符号はピクセルに復号していません。承認前に画像を表示し、視覚的な内容をレビューしてください。",
  ] },
  wavReview: { codes: "output_wav_listening_review_required", text: [
    "Audio samples were not listened to or assessed for intelligibility, silence, content, or loudness.",
    "Les échantillons audio n’ont pas été écoutés ni évalués pour leur intelligibilité, le silence, le contenu ou le niveau sonore.",
    "لم يُستمع إلى عينات الصوت ولم تُقيّم من حيث الوضوح أو الصمت أو المحتوى أو مستوى الصوت.",
    "音声サンプルの試聴や、明瞭さ、無音、内容、音量の評価は行っていません。",
  ] },
  mp3Review: { codes: "output_mp3_listening_review_required", text: [
    "MPEG audio was not decoded or listened to. Frame duration includes encoder delay and padding; audible duration and content require review.",
    "L’audio MPEG n’a pas été décodé ni écouté. La durée des trames inclut le retard d’encodage et le remplissage ; la durée audible et le contenu doivent être examinés.",
    "لم يُفك صوت MPEG ولم يُستمع إليه. تشمل مدة الإطارات تأخير المشفّر والحشو؛ وتحتاج المدة المسموعة والمحتوى إلى مراجعة.",
    "MPEG音声の復号や試聴は行っていません。フレームの長さにはエンコーダーの遅延とパディングを含むため、実際に聞こえる長さと内容のレビューが必要です。",
  ] },
  videoReview: { codes: "output_mp4_playback_review_required", text: [
    "Container structure, sample clocks, and AVC sequence headers were checked. Full decoding, playback, audio/video synchronization, and content still require review.",
    "La structure du conteneur, les horloges d’échantillons et les en-têtes de séquence AVC ont été vérifiés. Le décodage complet, la lecture, la synchronisation audio/vidéo et le contenu doivent encore être examinés.",
    "فُحصت بنية الحاوية وتوقيت العينات ورؤوس تسلسل AVC. ولا يزال فك الترميز الكامل والتشغيل وتزامن الصوت والصورة والمحتوى بحاجة إلى مراجعة.",
    "コンテナー構造、サンプルの時間情報、AVCのシーケンスヘッダーを検査しました。完全な復号、再生、音声と映像の同期、内容のレビューは引き続き必要です。",
  ] },
  presentationReview: { codes: "output_pptx_content_review_required", text: [
    "Slide count includes hidden slides, which are also counted separately. Review rendering, useful content, citations, accessibility, and linked-page safety; external hyperlinks were not fetched.",
    "Le nombre de diapositives inclut les diapositives masquées, également comptées séparément. Vérifiez le rendu, l’utilité du contenu, les citations, l’accessibilité et la sécurité des pages liées ; les liens externes n’ont pas été consultés.",
    "يشمل عدد الشرائح الشرائح المخفية، التي تُحصى منفصلة أيضًا. راجع العرض وفائدة المحتوى والاستشهادات وإمكانية الوصول وسلامة الصفحات المرتبطة؛ لم تُجلب الروابط الخارجية.",
    "スライド数には非表示のスライドも含まれ、非表示分は別途数えています。表示、有用な内容、引用、アクセシビリティ、リンク先の安全性を確認してください。外部リンクは取得していません。",
  ] },
  assetEmpty: { codes: "empty_output_asset", text: [
    "The file is empty. Select the finished file before uploading it.", "Le fichier est vide. Sélectionnez le fichier terminé avant de l’importer.", "الملف فارغ. اختر الملف النهائي قبل رفعه.", "ファイルが空です。完成したファイルを選択してからアップロードしてください。",
  ] },
  assetSize: { codes: "output_asset_too_large", text: [
    "The file exceeds the supported upload size. Use a smaller file that still satisfies the authored requirements.",
    "Le fichier dépasse la taille d’import prise en charge. Utilisez un fichier plus petit qui satisfait toujours les exigences rédigées.",
    "يتجاوز الملف حجم الرفع المدعوم. استخدم ملفًا أصغر يظل مستوفيًا للمتطلبات الأصلية.",
    "ファイルが対応するアップロードサイズを超えています。記述された要件を満たす、より小さいファイルを使用してください。",
  ] },
  assetName: { codes: "unsafe_output_asset_name invalid_output_asset_name", text: [
    "Use a plain filename without paths, control characters, or reserved device names, within the supported filename length.",
    "Utilisez un nom de fichier simple, sans chemin, caractère de contrôle ni nom de périphérique réservé, dans la longueur prise en charge.",
    "استخدم اسم ملف بسيطًا دون مسارات أو محارف تحكم أو أسماء أجهزة محجوزة، ضمن طول الاسم المدعوم.",
    "対応する長さの範囲で、パス、制御文字、予約されたデバイス名を含まない通常のファイル名を使用してください。",
  ] },
  assetFormat: { codes: "output_asset_format_unsupported", text: [
    "This file format is not supported for adoption. Use a supported PNG, JPEG, WAV, MP3, MP4, or macro-free PPTX file; extension names alone are not proof.",
    "Ce format de fichier ne peut pas être adopté. Utilisez un fichier PNG, JPEG, WAV, MP3, MP4 ou PPTX sans macros pris en charge ; l’extension seule ne constitue pas une preuve.",
    "تنسيق الملف هذا غير مدعوم للاعتماد. استخدم ملف PNG أو JPEG أو WAV أو MP3 أو MP4 أو PPTX دون وحدات ماكرو مدعومًا؛ فالامتداد وحده ليس دليلًا.",
    "このファイル形式は採用に対応していません。対応するPNG、JPEG、WAV、MP3、MP4、またはマクロなしのPPTXを使用してください。拡張子だけでは形式を証明できません。",
  ] },
  decompressionUnavailable: { codes: "decompression_unavailable decompression_format_unavailable", text: [
    "This environment cannot inspect the file’s compression format. Use a supported export or ask an administrator to restore the inspection capability.",
    "Cet environnement ne peut pas inspecter le format de compression du fichier. Utilisez un export pris en charge ou demandez à un administrateur de rétablir l’inspection.",
    "لا تستطيع هذه البيئة فحص تنسيق ضغط الملف. استخدم تصديرًا مدعومًا أو اطلب من مسؤول استعادة إمكانية الفحص.",
    "この環境ではファイルの圧縮形式を検査できません。対応する形式で書き出すか、管理者に検査機能の復旧を依頼してください。",
  ] },
  decompressionInvalid: { codes: "invalid_compressed_stream", text: [
    "The compressed data could not be validated. Export a fresh file from the original editor before uploading again.",
    "Les données compressées n’ont pas pu être validées. Exportez un nouveau fichier depuis l’éditeur d’origine avant de le réimporter.",
    "تعذر التحقق من البيانات المضغوطة. صدّر ملفًا جديدًا من المحرر الأصلي قبل رفعه مجددًا.",
    "圧縮データを検証できませんでした。再アップロードする前に、元のエディターから新しく書き出してください。",
  ] },
  inspectionLimits: { codes: "excessive_office_xml_namespaces excessive_office_xml_structure excessive_office_xml_total excessive_zip_expansion_ratio excessive_zip_extra_data expanded_asset_too_large office_xml_too_large too_many_mp3_frames too_many_office_xml_attributes too_many_png_chunks too_many_wav_chunks", text: [
    "The expanded file structure exceeds this inspector’s safety limits. Use a smaller, simpler supported export; the inspection limits cannot be bypassed.",
    "La structure décompressée du fichier dépasse les limites de sécurité de l’inspecteur. Utilisez un export pris en charge plus petit et plus simple ; ces limites ne peuvent pas être contournées.",
    "تتجاوز بنية الملف بعد فكّه حدود أمان الفاحص. استخدم تصديرًا مدعومًا أصغر وأبسط؛ لا يجوز تجاوز حدود الفحص.",
    "展開後のファイル構造が検査の安全上限を超えています。より小さく単純な対応形式で書き出してください。検査上限を回避することはできません。",
  ] },
  assetDimensions: { codes: "invalid_or_excessive_dimensions", text: [
    "The image or video dimensions are invalid or too large for inspection. Use smaller valid dimensions that still match the target ratio.",
    "Les dimensions de l’image ou de la vidéo sont invalides ou trop grandes pour l’inspection. Utilisez des dimensions valides plus petites qui conservent les proportions requises.",
    "أبعاد الصورة أو الفيديو غير صالحة أو كبيرة جدًا للفحص. استخدم أبعادًا صحيحة أصغر تظل مطابقة للنسبة المطلوبة.",
    "画像または動画の寸法が無効か、検査するには大きすぎます。納品対象の縦横比を保った、より小さい有効な寸法を使用してください。",
  ] },
  assetDuration: { codes: "invalid_or_excessive_duration", text: [
    "The measured duration is invalid or exceeds the supported inspection limit. Use a valid supported file without changing the agreed duration silently.",
    "La durée mesurée est invalide ou dépasse la limite d’inspection prise en charge. Utilisez un fichier valide sans modifier implicitement la durée convenue.",
    "المدة المقاسة غير صالحة أو تتجاوز حد الفحص المدعوم. استخدم ملفًا صالحًا ومدعومًا دون تغيير المدة المتفق عليها بصمت.",
    "測定した長さが無効か、対応する検査上限を超えています。合意した長さを勝手に変えず、有効な対応ファイルを使用してください。",
  ] },
  assetSlideCount: { codes: "invalid_or_excessive_presentation_slide_count", text: [
    "The total slide count is invalid or exceeds the supported inspection limit. Check hidden slides as well as visible slides in the source deck.",
    "Le nombre total de diapositives est invalide ou dépasse la limite d’inspection. Vérifiez les diapositives masquées et visibles dans le diaporama source.",
    "إجمالي عدد الشرائح غير صالح أو يتجاوز حد الفحص المدعوم. تحقق من الشرائح المخفية والظاهرة في العرض الأصلي.",
    "総スライド数が無効か、対応する検査上限を超えています。元のデッキで、表示されるスライドだけでなく非表示のスライドも確認してください。",
  ] },
  pngUnsupported: { codes: "animated_png_unsupported interlaced_png_unsupported unknown_critical_png_chunk", text: [
    "This PNG uses unsupported animation, interlacing, or required chunks. Export a supported static PNG and review its appearance.",
    "Ce PNG utilise une animation, un entrelacement ou des blocs requis non pris en charge. Exportez un PNG statique compatible et vérifiez son apparence.",
    "تستخدم صورة PNG هذه حركة أو تشابكًا أو كتلًا إلزامية غير مدعومة. صدّر PNG ثابتًا مدعومًا وراجع مظهره.",
    "このPNGは未対応のアニメーション、インターレース、または必須チャンクを使用しています。対応する静止PNGを書き出し、見た目を確認してください。",
  ] },
  pngInvalid: { codes: "invalid_png_chunk invalid_png_data_order invalid_png_encoding invalid_png_end invalid_png_filter invalid_png_header invalid_png_interlace invalid_png_palette invalid_png_signature missing_png_end missing_png_header png_crc_mismatch png_scanline_size_mismatch", text: [
    "PNG headers, chunk boundaries, checksums, or scanline data could not be verified. Export a fresh supported PNG from the original image.",
    "Les en-têtes, limites de blocs, sommes de contrôle ou lignes de pixels PNG n’ont pas pu être vérifiés. Exportez un nouveau PNG compatible depuis l’image d’origine.",
    "تعذر التحقق من رؤوس PNG أو حدود الكتل أو المجاميع الاختبارية أو بيانات الصفوف. صدّر PNG جديدًا مدعومًا من الصورة الأصلية.",
    "PNGのヘッダー、チャンク境界、チェックサム、または走査線データを検証できませんでした。元の画像から対応するPNGを新しく書き出してください。",
  ] },
  jpegUnsupported: { codes: "jpeg_component_layout_unsupported jpeg_encoding_unsupported jpeg_marker_unsupported", text: [
    "This JPEG encoding or component layout is unsupported. Export a standard supported JPEG or PNG and review the resulting image.",
    "Cet encodage ou agencement de composantes JPEG n’est pas pris en charge. Exportez un JPEG standard compatible ou un PNG et vérifiez l’image obtenue.",
    "ترميز JPEG أو ترتيب مكوناته هذا غير مدعوم. صدّر JPEG قياسيًا مدعومًا أو PNG وراجع الصورة الناتجة.",
    "このJPEGの符号化または成分配置には対応していません。標準的な対応JPEGまたはPNGを書き出し、結果の画像を確認してください。",
  ] },
  jpegInvalid: { codes: "conflicting_jpeg_orientation empty_jpeg_scan invalid_jpeg_component invalid_jpeg_end invalid_jpeg_exif invalid_jpeg_frame invalid_jpeg_huffman invalid_jpeg_marker invalid_jpeg_orientation invalid_jpeg_quantization invalid_jpeg_restart_interval invalid_jpeg_sampling invalid_jpeg_scan invalid_jpeg_scan_component missing_jpeg_end missing_jpeg_frame missing_jpeg_huffman_table truncated_jpeg truncated_jpeg_entropy truncated_jpeg_segment unexpected_jpeg_marker", text: [
    "JPEG markers, tables, scan boundaries, or orientation metadata could not be verified. Export a fresh supported image before adoption.",
    "Les marqueurs, tables, limites de balayage ou métadonnées d’orientation JPEG n’ont pas pu être vérifiés. Exportez une nouvelle image compatible avant l’adoption.",
    "تعذر التحقق من علامات JPEG أو جداوله أو حدود مسحه أو بيانات اتجاهه. صدّر صورة جديدة مدعومة قبل اعتمادها.",
    "JPEGのマーカー、テーブル、スキャン境界、または向きのメタデータを検証できませんでした。採用する前に対応する画像を新しく書き出してください。",
  ] },
  wavUnsupported: { codes: "wav_encoding_unsupported", text: [
    "This WAV encoding is unsupported. Export a supported PCM or IEEE-float WAV and listen to the result before review.",
    "Cet encodage WAV n’est pas pris en charge. Exportez un WAV PCM ou à virgule flottante IEEE compatible et écoutez le résultat avant révision.",
    "ترميز WAV هذا غير مدعوم. صدّر WAV مدعومًا بترميز PCM أو IEEE-float واستمع إلى النتيجة قبل المراجعة.",
    "このWAVの符号化には対応していません。対応するPCMまたはIEEE浮動小数点のWAVを書き出し、レビュー前に結果を試聴してください。",
  ] },
  wavInvalid: { codes: "incomplete_wav inconsistent_wav_format invalid_wav_container invalid_wav_data invalid_wav_format truncated_wav_chunk", text: [
    "WAV boundaries, format information, or sample byte counts are incomplete or inconsistent. Export a fresh supported recording.",
    "Les limites, les informations de format ou le nombre d’octets d’échantillons WAV sont incomplets ou incohérents. Exportez un nouvel enregistrement compatible.",
    "حدود WAV أو معلومات تنسيقه أو عدد بايتات عيناته ناقصة أو غير متسقة. صدّر تسجيلًا جديدًا مدعومًا.",
    "WAVの境界、形式情報、またはサンプルのバイト数が不完全か不整合です。対応する録音を新しく書き出してください。",
  ] },
  mp3Invalid: { codes: "incomplete_mp3_stream inconsistent_mp3_stream invalid_mp3_frame_header invalid_mp3_id3 invalid_mp3_id3_flags invalid_mp3_id3_footer invalid_mp3_id3_size truncated_mp3_frame", text: [
    "MP3 headers, frame boundaries, or sample timing could not be verified. Export a fresh supported MP3 and check audible duration and content.",
    "Les en-têtes, limites de trames ou temps d’échantillonnage MP3 n’ont pas pu être vérifiés. Exportez un nouveau MP3 compatible et vérifiez la durée audible et le contenu.",
    "تعذر التحقق من رؤوس MP3 أو حدود إطاراته أو توقيت عيناته. صدّر MP3 جديدًا مدعومًا وتحقق من المدة المسموعة والمحتوى.",
    "MP3のヘッダー、フレーム境界、またはサンプルの時間情報を検証できませんでした。対応するMP3を新しく書き出し、実際に聞こえる長さと内容を確認してください。",
  ] },
  videoCodecUnsupported: { codes: "h264_bit_depth_unsupported h264_profile_unsupported interlaced_h264_unsupported mp4_video_codec_unsupported", text: [
    "This video codec, H.264 profile, bit depth, or interlacing is unsupported. Export a supported progressive AVC/H.264 MP4 and review playback.",
    "Ce codec vidéo, profil H.264, profondeur de bits ou entrelacement n’est pas pris en charge. Exportez un MP4 AVC/H.264 progressif compatible et vérifiez la lecture.",
    "ترميز الفيديو أو ملف H.264 أو عمق البت أو التشابك هذا غير مدعوم. صدّر MP4 متدرجًا مدعومًا بترميز AVC/H.264 وراجع تشغيله.",
    "この動画コーデック、H.264プロファイル、ビット深度、またはインターレースには対応していません。対応するプログレッシブAVC/H.264のMP4を書き出し、再生を確認してください。",
  ] },
  videoAudioUnsupported: { codes: "mp4_audio_codec_unsupported", text: [
    "This MP4 audio encoding is unsupported. Export the video with a supported MP4 audio track and check synchronization.",
    "Cet encodage audio MP4 n’est pas pris en charge. Exportez la vidéo avec une piste audio MP4 compatible et vérifiez la synchronisation.",
    "ترميز الصوت داخل MP4 هذا غير مدعوم. صدّر الفيديو بمسار صوت MP4 مدعوم وتحقق من التزامن.",
    "このMP4の音声符号化には対応していません。対応するMP4音声トラック付きで動画を書き出し、同期を確認してください。",
  ] },
  videoSelfContained: { codes: "encrypted_mp4_unsupported external_mp4_reference_unsupported fragmented_mp4_unsupported", text: [
    "Adoption requires an unencrypted, self-contained, nonfragmented MP4. External media is not fetched and encrypted content is not bypassed.",
    "L’adoption nécessite un MP4 non chiffré, autonome et non fragmenté. Les médias externes ne sont pas récupérés et le chiffrement n’est pas contourné.",
    "يتطلب الاعتماد MP4 غير مشفّر ومكتفيًا بذاته وغير مجزأ. لا تُجلب وسائط خارجية ولا يُتجاوز التشفير.",
    "採用には、暗号化されていない自己完結型の非フラグメントMP4が必要です。外部メディアの取得や暗号化の回避は行いません。",
  ] },
  videoTracks: { codes: "disabled_mp4_track_unsupported mp4_track_layout_unsupported mp4_track_type_unsupported multiple_mp4_sample_descriptions_unsupported", text: [
    "This MP4 track layout is unsupported. Export one enabled video track with at most one supported audio track.",
    "Cet agencement de pistes MP4 n’est pas pris en charge. Exportez une piste vidéo active avec au plus une piste audio compatible.",
    "ترتيب مسارات MP4 هذا غير مدعوم. صدّر مسار فيديو مفعّلًا واحدًا ومعه مسار صوت مدعوم واحد على الأكثر.",
    "このMP4のトラック構成には対応していません。有効な映像トラック1本と、必要に応じて対応する音声トラック最大1本で書き出してください。",
  ] },
  videoGeometry: { codes: "mp4_clean_aperture_unsupported nonsquare_video_pixels_unsupported mp4_transform_unsupported", text: [
    "This MP4 uses unsupported pixel proportions, cropping metadata, or transforms. Bake the intended appearance into a supported square-pixel export and verify the target ratio.",
    "Ce MP4 utilise des proportions de pixels, métadonnées de recadrage ou transformations non prises en charge. Intégrez l’apparence voulue dans un export compatible à pixels carrés et vérifiez les proportions demandées.",
    "يستخدم MP4 هذا نسب بكسلات أو بيانات قص أو تحويلات غير مدعومة. ادمج المظهر المقصود في تصدير مدعوم ببكسلات مربعة وتحقق من النسبة المطلوبة.",
    "このMP4は未対応のピクセル比、切り抜きメタデータ、または変換を使用しています。意図した見た目を正方形ピクセルの対応形式に反映して書き出し、納品対象の縦横比を確認してください。",
  ] },
  videoEdits: { codes: "mp4_multisegment_edit_unsupported mp4_trimmed_timeline_unsupported", text: [
    "This MP4 uses unsupported timeline edits. Render the final timeline into a supported file and review its actual duration.",
    "Ce MP4 utilise des modifications temporelles non prises en charge. Rendez le montage final dans un fichier compatible et vérifiez sa durée réelle.",
    "يستخدم MP4 هذا تعديلات زمنية غير مدعومة. صدّر الخط الزمني النهائي إلى ملف مدعوم وراجع مدته الفعلية.",
    "このMP4は未対応のタイムライン編集を使用しています。最終タイムラインを対応ファイルとしてレンダリングし、実際の長さを確認してください。",
  ] },
  videoBrand: { codes: "mp4_brand_unsupported", text: [
    "This MP4 container variant is unsupported. Export a standard supported MP4 from the source editor.",
    "Cette variante de conteneur MP4 n’est pas prise en charge. Exportez un MP4 standard compatible depuis l’éditeur source.",
    "نوع حاوية MP4 هذا غير مدعوم. صدّر MP4 قياسيًا مدعومًا من المحرر الأصلي.",
    "このMP4コンテナーの種別には対応していません。元のエディターから標準的な対応MP4を書き出してください。",
  ] },
  videoInvalid: { codes: "empty_mp4_picture invalid_avc_configuration invalid_avc_configuration_end invalid_avc_extension invalid_avc_nal_length_size invalid_avc_pps invalid_h264_chroma invalid_h264_dimensions invalid_h264_emulation_prevention invalid_h264_exp_golomb invalid_h264_frame_number invalid_h264_picture_order invalid_h264_reference_count invalid_h264_sample_aspect invalid_h264_sps invalid_h264_sps_id invalid_mp4_audio_description invalid_mp4_box_boundary invalid_mp4_box_size invalid_mp4_box_type invalid_mp4_box_version invalid_mp4_chunk_mapping invalid_mp4_chunk_offset_tables invalid_mp4_chunk_offsets invalid_mp4_clock invalid_mp4_composition_timing invalid_mp4_edit_list invalid_mp4_file_type invalid_mp4_nal_boundary invalid_mp4_nal_type invalid_mp4_pixel_aspect invalid_mp4_sample_description invalid_mp4_sample_entry invalid_mp4_sample_range invalid_mp4_sample_sizes invalid_mp4_sample_timing invalid_mp4_video_track_count invalid_mp4_view missing_avc_pps missing_avc_sps missing_mp4_media_data missing_mp4_picture_sample mp4_chunk_sample_count_mismatch mp4_coded_dimensions_mismatch mp4_movie_duration_mismatch mp4_sample_duration_mismatch mp4_samples_outside_media_data mp4_track_dimensions_mismatch mp4_track_duration_mismatch overlapping_mp4_samples truncated_avc_pps truncated_avc_sps truncated_h264_sps truncated_mp4_chunk_offsets truncated_mp4_clock truncated_mp4_handler truncated_mp4_large_box truncated_mp4_sample_sizes truncated_mp4_sample_table truncated_mp4_track_header", text: [
    "MP4 structure, sample timing, media boundaries, or AVC headers could not be verified. Re-export a complete supported video and review playback and synchronization.",
    "La structure MP4, le temps des échantillons, les limites des médias ou les en-têtes AVC n’ont pas pu être vérifiés. Réexportez une vidéo complète compatible et vérifiez la lecture et la synchronisation.",
    "تعذر التحقق من بنية MP4 أو توقيت العينات أو حدود الوسائط أو رؤوس AVC. أعد تصدير فيديو كامل مدعوم وراجع التشغيل والتزامن.",
    "MP4の構造、サンプルの時間情報、メディア境界、またはAVCヘッダーを検証できませんでした。完全な対応動画を書き出し直し、再生と同期を確認してください。",
  ] },
  officeActive: { codes: "active_office_content_forbidden not_a_macro_free_presentation", text: [
    "This presentation contains macros or other active content, or is not a macro-free deck. Export a macro-free PPTX without active components.",
    "Cette présentation contient des macros ou d’autres contenus actifs, ou n’est pas sans macros. Exportez un PPTX sans macros ni composants actifs.",
    "يحتوي هذا العرض على وحدات ماكرو أو محتوى نشط آخر، أو ليس عرضًا خاليًا من الماكرو. صدّر PPTX دون ماكرو أو مكونات نشطة.",
    "このプレゼンテーションにはマクロなどの実行可能な内容が含まれるか、マクロなしのデッキではありません。マクロや実行可能な部品を含まないPPTXを書き出してください。",
  ] },
  officeExternalMedia: { codes: "external_office_media_unsupported", text: [
    "External presentation media cannot be adopted. Embed supported media in the deck; permitted web hyperlinks remain separate and still need safety review.",
    "Les médias externes d’une présentation ne peuvent pas être adoptés. Intégrez les médias compatibles au diaporama ; les liens web permis restent distincts et nécessitent une vérification de sécurité.",
    "لا يمكن اعتماد وسائط العرض الخارجية. ضمّن الوسائط المدعومة داخل العرض؛ وتبقى روابط الويب المسموح بها منفصلة وتحتاج إلى مراجعة سلامة.",
    "プレゼンテーションの外部メディアは採用できません。対応するメディアをデッキに埋め込んでください。許可されるウェブリンクは別扱いで、安全性の確認が必要です。",
  ] },
  officeFormat: { codes: "office_embedded_format_unsupported office_relationship_type_unsupported not_an_ooxml_package", text: [
    "This presentation package or an embedded part is unsupported. Export a standard macro-free PPTX with supported embedded content.",
    "Cet ensemble de présentation ou une partie intégrée n’est pas pris en charge. Exportez un PPTX standard sans macros avec un contenu intégré compatible.",
    "حزمة العرض هذه أو أحد أجزائها المضمّنة غير مدعوم. صدّر PPTX قياسيًا دون ماكرو وبمحتوى مضمّن مدعوم.",
    "このプレゼンテーションパッケージまたは埋め込み部分には対応していません。対応する内容を埋め込んだ標準的なマクロなしPPTXを書き出してください。",
  ] },
  officeUnsafe: { codes: "aliased_office_relationship_target aliased_zip_file_directory office_relationship_escapes_package office_xml_entities_forbidden unsafe_office_external_link unsafe_office_relationship_target unsafe_or_aliased_zip_path unsupported_office_xml_entity unsupported_office_xml_instruction", text: [
    "This package contains unsafe or ambiguous paths, links, or XML features. Re-export a clean macro-free deck; Forma will not follow or normalize unsafe references.",
    "Cet ensemble contient des chemins, liens ou fonctions XML dangereux ou ambigus. Réexportez un diaporama propre sans macros ; Forma ne suivra ni ne normalisera les références dangereuses.",
    "تحتوي هذه الحزمة على مسارات أو روابط أو ميزات XML غير آمنة أو ملتبسة. أعد تصدير عرض سليم دون ماكرو؛ لن تتبع Forma المراجع غير الآمنة أو تعيد تفسيرها.",
    "このパッケージには安全でない、または曖昧なパス、リンク、XML機能が含まれています。問題のないマクロなしデッキを書き出し直してください。安全でない参照の追跡や正規化は行いません。",
  ] },
  officeInvalid: { codes: "duplicate_office_content_type duplicate_office_xml_attribute incomplete_office_xml invalid_office_action invalid_office_content_type invalid_office_content_type_element invalid_office_content_type_part invalid_office_content_types invalid_office_relationship invalid_office_relationship_element invalid_office_relationship_encoding invalid_office_relationship_root invalid_office_relationship_target invalid_office_xml_attribute invalid_office_xml_cdata invalid_office_xml_character invalid_office_xml_comment invalid_office_xml_entity invalid_office_xml_namespace invalid_office_xml_tag invalid_presentation_root invalid_presentation_root_relationship invalid_presentation_slide_content_type invalid_presentation_slide_id invalid_presentation_slide_list invalid_presentation_slide_list_entry invalid_presentation_slide_relationship invalid_presentation_slide_relationship_id invalid_presentation_slide_root invalid_presentation_slide_size invalid_presentation_slide_visibility mismatched_office_xml_tag missing_office_content_type missing_office_relationship_part missing_office_xml_attribute missing_presentation_main_part missing_presentation_slide_tree multiple_office_xml_roots orphan_office_relationship_part text_outside_office_xml_root unknown_office_xml_namespace unterminated_office_xml_tag", text: [
    "Presentation XML, slide order, content types, or part relationships could not be verified. Export a fresh macro-free PPTX and check every slide.",
    "Le XML, l’ordre des diapositives, les types de contenu ou les relations des parties n’ont pas pu être vérifiés. Exportez un nouveau PPTX sans macros et vérifiez chaque diapositive.",
    "تعذر التحقق من XML العرض أو ترتيب الشرائح أو أنواع المحتوى أو علاقات الأجزاء. صدّر PPTX جديدًا دون ماكرو وتحقق من كل شريحة.",
    "プレゼンテーションのXML、スライド順序、コンテンツ種別、またはパーツ間の関係を検証できませんでした。マクロなしPPTXを新しく書き出し、すべてのスライドを確認してください。",
  ] },
  zipUnsupported: { codes: "zip_encoding_unsupported zip_extension_unsupported multidisk_zip_unsupported zip_special_file_unsupported", text: [
    "The presentation archive uses unsupported ZIP features. Re-export an ordinary self-contained macro-free PPTX without special archive entries.",
    "L’archive de présentation utilise des fonctions ZIP non prises en charge. Réexportez un PPTX ordinaire, autonome et sans macros, sans entrées d’archive spéciales.",
    "يستخدم أرشيف العرض ميزات ZIP غير مدعومة. أعد تصدير PPTX عاديًا مكتفيًا بذاته دون ماكرو أو عناصر أرشيف خاصة.",
    "プレゼンテーションのアーカイブは未対応のZIP機能を使用しています。特殊なアーカイブ項目を含まない、通常の自己完結型のマクロなしPPTXを書き出し直してください。",
  ] },
  zipInvalid: { codes: "hidden_zip_payload invalid_zip_directory invalid_zip_directory_entry invalid_zip_directory_payload invalid_zip_directory_size invalid_zip_entry_lengths invalid_zip_entry_size invalid_zip_extra_data invalid_zip_local_reference missing_zip_directory overlapping_or_hidden_zip_entry truncated_zip_descriptor truncated_zip_entry zip_descriptor_mismatch zip_entry_size_or_crc_mismatch zip_local_metadata_mismatch zip_local_name_mismatch zip_local_size_or_crc_mismatch", text: [
    "The presentation archive’s entries, sizes, checksums, or directory records are inconsistent. Export a fresh file; hidden or overlapping payloads are not accepted.",
    "Les entrées, tailles, sommes de contrôle ou répertoires de l’archive de présentation sont incohérents. Exportez un nouveau fichier ; les contenus masqués ou superposés ne sont pas acceptés.",
    "عناصر أرشيف العرض أو أحجامه أو مجاميعه الاختبارية أو سجلاته غير متسقة. صدّر ملفًا جديدًا؛ ولا تُقبل الحمولات المخفية أو المتداخلة.",
    "プレゼンテーションのアーカイブ項目、サイズ、チェックサム、またはディレクトリ記録に不整合があります。新しく書き出してください。隠されたデータや重複するデータ領域は受け付けません。",
  ] },
  assetStructure: { codes: "truncated_asset excessive_container_integer asset_inspection_failed", text: [
    "The file is incomplete or its structural data could not be safely inspected. Export a fresh supported file from the original content.",
    "Le fichier est incomplet ou sa structure n’a pas pu être inspectée en sécurité. Exportez un nouveau fichier compatible depuis le contenu d’origine.",
    "الملف غير مكتمل أو تعذر فحص بيانات بنيته بأمان. صدّر ملفًا جديدًا مدعومًا من المحتوى الأصلي.",
    "ファイルが不完全か、構造データを安全に検査できませんでした。元の内容から対応するファイルを新しく書き出してください。",
  ] },
  contextPackageUnsupported: { codes: "output_context_package_unsupported", text: [
    "Output requirements are not supported in organization context packages yet. Author or copy them in a Document.",
    "Les exigences de livrables ne sont pas encore prises en charge dans les ensembles de contexte de l’organisation. Rédigez-les ou copiez-les dans un document.",
    "متطلبات المخرجات غير مدعومة بعد في حزم سياق المؤسسة. اكتبها أو انسخها داخل مستند.",
    "組織のコンテキストパッケージは、まだ納品要件に対応していません。ドキュメント内で作成またはコピーしてください。",
  ] },
  sourceProjectionStale: { codes: "output_source_projection_stale", text: [
    "The licensed origin needs a refresh by someone authorized to open that source project. Refreshing this Document does not refresh the origin.",
    "L’origine sous licence doit être actualisée par une personne autorisée à ouvrir ce projet source. Actualiser ce document n’actualise pas l’origine.",
    "يحتاج المصدر الأصلي المرخّص إلى تحديث من شخص مخوّل بفتح مشروعه. تحديث هذا المستند لا يحدّث المصدر الأصلي.",
    "ライセンス元のソースプロジェクトを開く権限のある人による更新が必要です。このドキュメントを更新しても、ライセンス元は更新されません。",
  ] },
  targetSourceProjectionStale: { codes: "output_target_source_projection_stale", text: [
    "This Document’s project source index is out of date. Refresh the current project sources before checking Outputs again.",
    "L’index des sources du projet de ce document n’est plus à jour. Actualisez les sources du projet actuel avant de revérifier les livrables.",
    "فهرس مصادر مشروع هذا المستند غير محدّث. حدّث مصادر المشروع الحالي قبل التحقق من المخرجات مجددًا.",
    "このドキュメントのプロジェクトのソース索引が古くなっています。現在のプロジェクトのソースを更新してから、納品物を再確認してください。",
  ] },
  targetSourceRefresh: { codes: "output_target_source_refresh", text: [
    "Refresh project sources · free",
    "Actualiser les sources du projet · gratuit",
    "تحديث مصادر المشروع · مجانًا",
    "プロジェクトのソースを更新 · 無料",
  ] },
  targetSourceRefreshNeedsProject: { codes: "output_target_source_refresh_needs_project", text: [
    "In Workspace settings, open this Document’s existing shared project, then return to this Document. No project will be selected automatically.",
    "Dans les paramètres des espaces de travail, ouvrez le projet partagé existant de ce document, puis revenez à ce document. Aucun projet ne sera sélectionné automatiquement.",
    "في إعدادات مساحات العمل، افتح المشروع المشترك الموجود لهذا المستند، ثم عُد إلى هذا المستند. لن يُختار أي مشروع تلقائيًا.",
    "ワークスペース設定で、このドキュメントの既存の共有プロジェクトを開いてから、このドキュメントに戻ってください。プロジェクトが自動で選択されることはありません。",
  ] },
  targetSourceOpenProjects: { codes: "output_target_source_open_projects", text: [
    "Choose shared project",
    "Choisir le projet partagé",
    "اختيار المشروع المشترك",
    "共有プロジェクトを選択",
  ] },
  targetSourceRefreshFailed: { codes: "output_target_source_refresh_failed", text: [
    "The current project source refresh could not finish. Your Output work is unchanged. Check your current project access and try again.",
    "L’actualisation des sources du projet actuel n’a pas abouti. Votre travail sur les livrables est inchangé. Vérifiez votre accès actuel au projet, puis réessayez.",
    "تعذر إكمال تحديث مصادر المشروع الحالي. لم يتغير عملك على المخرجات. تحقق من صلاحية وصولك الحالية إلى المشروع وحاول مجددًا.",
    "現在のプロジェクトのソース更新を完了できませんでした。納品物の作業内容は変わっていません。現在のプロジェクトへのアクセス権を確認して、再試行してください。",
  ] },
  targetSourceRefreshDone: { codes: "output_target_source_refresh_done", text: [
    "The current project source index was refreshed and Output checks reloaded. No work was generated or authorized.",
    "L’index des sources du projet actuel a été actualisé et les vérifications des livrables rechargées. Aucun travail n’a été généré ni autorisé.",
    "حُدّث فهرس مصادر المشروع الحالي وأُعيد تحميل فحوص المخرجات. لم يُولّد أي عمل ولم يُمنح أي تفويض.",
    "現在のプロジェクトのソース索引を更新し、納品物のチェックを再読み込みしました。作業の生成や許可は行っていません。",
  ] },
  targetSourceDocumentContext: { codes: "output_target_source_document_context", text: [
    "Document {number}: {name}",
    "Document {number} : {name}",
    "المستند {number}: {name}",
    "ドキュメント {number}：{name}",
  ] },
  sourceGovernanceUnavailable: { codes: "output_source_governance_unavailable output_source_governance_cycle", text: [
    "The source authorization chain is unavailable or circular. Restore a valid, verifiable source chain before generation, review, or delivery.",
    "La chaîne d’autorisation des sources est indisponible ou circulaire. Rétablissez une chaîne valide et vérifiable avant génération, révision ou livraison.",
    "سلسلة أذونات المصادر غير متاحة أو دائرية. استعد سلسلة مصادر صالحة وقابلة للتحقق قبل التوليد أو المراجعة أو التسليم.",
    "ソースの許可関係を取得できないか、循環しています。生成、レビュー、納品の前に、有効で検証できるソースの関係を復旧してください。",
  ] },
  sourceRightsRequired: { codes: "context_source_rights_required", text: [
    "Record valid permission to use the selected source before proceeding. Source availability alone does not establish usage rights.",
    "Enregistrez une autorisation valide d’utiliser la source sélectionnée avant de continuer. Sa disponibilité seule n’établit pas les droits d’utilisation.",
    "سجّل إذنًا صالحًا لاستخدام المصدر المحدد قبل المتابعة. توفر المصدر وحده لا يثبت حقوق الاستخدام.",
    "続ける前に、選択したソースを利用する有効な許可を記録してください。ソースを取得できるだけでは利用権の証明にはなりません。",
  ] },
  contradictoryDecisions: { codes: "context_decisions_contradict", text: [
    "Required source decisions contradict each other. Resolve the conflicting directions explicitly before generating or accepting work.",
    "Des décisions sources obligatoires se contredisent. Résolvez explicitement les consignes contradictoires avant de générer ou d’accepter le travail.",
    "تتعارض قرارات المصادر المطلوبة. احسم التوجيهات المتعارضة صراحةً قبل توليد العمل أو قبوله.",
    "必須のソースに関する判断が矛盾しています。生成または承認の前に、矛盾する指示を明示的に解決してください。",
  ] },
  presentationOutputAmbiguous: { codes: "ambiguous_presentation_output", text: [
    "Select one presentation specification and separate sibling outputs with their own headings before generating.",
    "Sélectionnez une spécification de présentation et séparez les autres livrables avec leurs propres titres avant la génération.",
    "اختر مواصفة عرض تقديمي واحدة وافصل المخرجات الأخرى بعناوين خاصة بها قبل التوليد.",
    "生成前にプレゼンテーションの指定を1つ選び、他の納品物にはそれぞれ別の見出しを付けてください。",
  ] },
  presentationModeAmbiguous: { codes: "ambiguous_presentation_source_mode", text: [
    "This output mixes a short outline with manuscript prose. Mark a full slide manuscript explicitly, or separate brief coverage directions from supporting research.",
    "Ce livrable mélange un plan court et un texte de manuscrit. Identifiez explicitement un manuscrit complet de diapositives ou séparez les consignes de couverture brèves des recherches justificatives.",
    "يمزج هذا المخرج بين مخطط قصير ونص مخطوط. حدّد مخطوط الشرائح الكامل صراحةً أو افصل توجيهات التغطية المختصرة عن البحث الداعم.",
    "この納品物には短い概要と原稿の文章が混在しています。スライド原稿全体であることを明示するか、短い範囲指定と裏付けとなる調査を分けてください。",
  ] },
  presentationSlideNumbers: { codes: "ambiguous_presentation_slide_number", text: [
    "A slide position is specified more than once. Give this presentation unique numbered positions before generating.",
    "Une position de diapositive est indiquée plusieurs fois. Attribuez des numéros uniques aux diapositives de cette présentation avant de générer.",
    "حُدد موضع شريحة أكثر من مرة. امنح هذا العرض مواضع مرقمة فريدة قبل التوليد.",
    "同じスライド位置が複数回指定されています。生成前に、このプレゼンテーションのスライド番号を重複なく設定してください。",
  ] },
  presentationEvidenceUnresolved: { codes: "unresolved_outline_evidence", text: [
    "A planned slide lacks an explicit supporting source assignment. Resolve its evidence before generating; outline instructions are not citations.",
    "Une diapositive prévue n’a pas de source justificative explicitement attribuée. Précisez ses preuves avant de générer ; les consignes du plan ne sont pas des citations.",
    "تفتقر شريحة مخططة إلى إسناد صريح لمصدر داعم. احسم أدلتها قبل التوليد؛ فتعليمات المخطط ليست استشهادات.",
    "予定されたスライドに、裏付けとなるソースが明示的に割り当てられていません。生成前に根拠を確定してください。概要の指示は引用ではありません。",
  ] },
  presentationMandatorySource: { codes: "unassigned_required_presentation_source", text: [
    "A mandatory research passage has no assigned slide coverage. Assign it explicitly; required evidence cannot be dropped or placed on an arbitrary slide.",
    "Un passage de recherche obligatoire n’est attribué à aucune diapositive. Attribuez-le explicitement ; les preuves requises ne peuvent pas être supprimées ni placées sur une diapositive arbitraire.",
    "لم تُسند تغطية مقطع بحث إلزامي إلى شريحة. أسنده صراحةً؛ لا يجوز إسقاط الأدلة المطلوبة أو وضعها على شريحة عشوائية.",
    "必須の調査箇所を扱うスライドが割り当てられていません。明示的に割り当ててください。必須の根拠を削除したり、任意のスライドに置いたりしてはいけません。",
  ] },
  presentationCountConflict: { codes: "outline_slide_count_conflict", text: [
    "The research-backed outline must cover every requested slide. Match its numbered positions or author the added coverage requirements before generating.",
    "Le plan fondé sur la recherche doit couvrir chaque diapositive demandée. Faites correspondre ses positions numérotées ou rédigez les exigences de couverture ajoutées avant de générer.",
    "يجب أن يغطي المخطط المدعوم بالبحث كل شريحة مطلوبة. طابق مواضعه المرقمة أو اكتب متطلبات التغطية الإضافية قبل التوليد.",
    "調査に基づく概要では、依頼されたすべてのスライドを扱う必要があります。生成前にスライド番号を一致させるか、追加部分の範囲要件を記述してください。",
  ] },
  amendmentReasonType: { codes: "invalid_output_scope_amendment_reason", text: [
    "Enter the amendment reason as text. No scope change was confirmed.",
    "Saisissez la raison de la modification sous forme de texte. Aucun changement de périmètre n’a été confirmé.",
    "أدخل سبب التعديل كنص. لم يُؤكَّد أي تغيير في النطاق.",
    "範囲を変更する理由はテキストで入力してください。範囲の変更は確定されていません。",
  ] },
  amendmentReasonTooLong: { codes: "output_scope_amendment_reason_too_long", text: [
    "Shorten the amendment reason to the limit shown. Your text is retained for correction; no scope change was confirmed.",
    "Raccourcissez la raison de la modification pour respecter la limite affichée. Votre texte est conservé pour correction ; aucun changement de périmètre n’a été confirmé.",
    "اختصر سبب التعديل ليلتزم بالحد المعروض. يُحتفظ بنصك لتصحيحه؛ ولم يُؤكَّد أي تغيير في النطاق.",
    "範囲を変更する理由を、表示された上限以内に短くしてください。修正できるよう入力内容は保持され、範囲の変更は確定されていません。",
  ] },
  amendmentReasonControls: { codes: "output_scope_amendment_reason_control_characters", text: [
    "Remove unsupported control or formatting characters from the amendment reason. Tabs and line breaks are allowed. Your text is retained for correction; no scope change was confirmed.",
    "Retirez de la raison de la modification les caractères de contrôle ou de mise en forme non pris en charge. Les tabulations et les sauts de ligne sont autorisés. Votre texte est conservé pour correction ; aucun changement de périmètre n’a été confirmé.",
    "أزل أحرف التحكم أو التنسيق غير المدعومة من سبب التعديل. يُسمح بعلامات الجدولة وفواصل الأسطر. يُحتفظ بنصك لتصحيحه؛ ولم يُؤكَّد أي تغيير في النطاق.",
    "範囲を変更する理由から、未対応の制御文字や書式制御文字を取り除いてください。タブと改行は使用できます。修正できるよう入力内容は保持され、範囲の変更は確定されていません。",
  ] },
  amendmentHistoryReasonUnverified: { codes: "output_scope_history_reason_unverified", text: [
    "The saved amendment history cannot be verified for export because a recorded reason does not meet the supported text rules. History and files remain unchanged. Creating or reconfirming a plan does not repair recorded history. Ask a workspace administrator to investigate.",
    "L’historique enregistré des modifications ne peut pas être vérifié pour l’export, car une raison enregistrée ne respecte pas les règles de texte prises en charge. L’historique et les fichiers restent inchangés. Créer ou reconfirmer un plan ne répare pas l’historique enregistré. Demandez à un administrateur de l’espace de travail d’enquêter.",
    "يتعذر التحقق من سجل التعديلات المحفوظ للتصدير لأن سببًا مسجلًا لا يستوفي قواعد النص المدعومة. يبقى السجل والملفات دون تغيير. لا يؤدي إنشاء خطة أو إعادة تأكيدها إلى إصلاح السجل المسجّل. اطلب من مسؤول مساحة العمل التحقيق.",
    "記録された理由が対応するテキストの規則を満たしていないため、保存済みの改訂履歴をエクスポート用に検証できません。履歴とファイルは変更されません。計画を新規作成したり再度確定したりしても、記録済みの履歴は修復されません。ワークスペース管理者に調査を依頼してください。",
  ] },
  amendmentReasonRequired: { codes: "output_scope_amendment_reason_required", text: [
    "Explain why agreed work is being withdrawn or changed, within the note limit. Earlier obligations, approvals, and costs remain recorded.",
    "Expliquez pourquoi le travail convenu est retiré ou modifié, dans la limite de la note. Les obligations, approbations et coûts antérieurs restent enregistrés.",
    "اشرح سبب سحب العمل المتفق عليه أو تغييره ضمن حد الملاحظة. تبقى الالتزامات والموافقات والتكاليف السابقة مسجّلة.",
    "メモの上限内で、合意した作業を取り下げる、または変更する理由を説明してください。以前の義務、承認、費用は記録に残ります。",
  ] },
  amendmentActiveOperation: { codes: "output_active_commitment_requires_cancellation", text: [
    "This obligation has active or unresolved provider work. Stop or reconcile the recorded operation before withdrawing the obligation; its charges are retained.",
    "Cette obligation a un travail fournisseur actif ou non résolu. Arrêtez ou rapprochez l’opération enregistrée avant de retirer l’obligation ; ses frais sont conservés.",
    "لهذا الالتزام عمل مزوّد نشط أو غير محسوم. أوقف العملية المسجّلة أو سوِّها قبل سحب الالتزام؛ وتبقى رسومها محفوظة.",
    "この義務には実行中または未確定のプロバイダー作業があります。義務を取り下げる前に、記録済みの処理を停止または照合してください。費用は保持されます。",
  ] },
  commitmentEvidenceUnavailable: { codes: "output_commitment_evidence_unavailable", text: [
    "The earlier commitment record could not be verified. Restore its history before changing scope; unknown work must not silently disappear.",
    "L’engagement antérieur n’a pas pu être vérifié. Rétablissez son historique avant de modifier le périmètre ; un travail inconnu ne doit pas disparaître implicitement.",
    "تعذر التحقق من سجل الالتزام السابق. استعد سجله قبل تغيير النطاق؛ ولا يجوز أن يختفي العمل غير المعروف بصمت.",
    "以前の約束の記録を検証できませんでした。範囲を変更する前に履歴を復旧してください。不明な作業を勝手に消してはいけません。",
  ] },
  retryNeedsAuthorization: { codes: "output_retry_requires_new_authorization", text: [
    "A new paid attempt needs a separate, explicit alternative authorization. Recover the existing operation or review a new alternative’s sources and cost before starting it.",
    "Une nouvelle tentative payante exige une autorisation d’alternative distincte et explicite. Reprenez l’opération existante ou vérifiez les sources et le coût d’une nouvelle alternative avant de la lancer.",
    "تحتاج المحاولة المدفوعة الجديدة إلى إذن بديل منفصل وصريح. استعد العملية الحالية أو راجع مصادر البديل الجديد وتكلفته قبل بدئه.",
    "新しい有料試行には、代替案としての個別の明示的な許可が必要です。既存の処理を復旧するか、新しい代替案のソースと費用を確認してから開始してください。",
  ] },
  scopeHistoryInvalid: { codes: "invalid_output_delivery_scope_history_flag invalid_output_delivery_scope_amendments invalid_output_delivery_scope_amendment output_delivery_scope_history_conflict invalid_output_delivery_scope_amendment_date invalid_output_delivery_scope_amendment_reason invalid_output_delivery_scope_amendment_actor_role output_delivery_empty_scope_amendment", text: ["The recorded scope changes are incomplete or inconsistent. Restore verifiable amendment history before exporting; withdrawn work must not be reported as completed.", "Les changements de périmètre enregistrés sont incomplets ou incohérents. Rétablissez un historique vérifiable des modifications avant l’export ; le travail retiré ne doit pas être déclaré terminé.", "تغييرات النطاق المسجّلة ناقصة أو غير متسقة. استعد سجل تعديلات قابلًا للتحقق قبل التصدير؛ ولا يجوز الإبلاغ عن العمل المسحوب على أنه مكتمل.", "記録された範囲の変更が不完全か不整合です。書き出す前に検証できる改訂履歴を復旧してください。取り下げた作業を完了として報告してはいけません。"] },
  scopeHistoryTooLarge: { codes: "output_delivery_scope_history_too_large", text: ["This package cannot carry the recorded scope history within its safety limit. Preserve the full history and use a supported export route; earlier commitments cannot be omitted.", "Cet ensemble ne peut pas contenir l’historique de périmètre enregistré dans sa limite de sécurité. Conservez l’historique complet et utilisez un parcours d’export pris en charge ; les engagements antérieurs ne peuvent pas être omis.", "لا تستطيع هذه الحزمة تضمين سجل النطاق المسجّل ضمن حد أمانها. احتفظ بالسجل كاملًا واستخدم مسار تصدير مدعومًا؛ لا يجوز حذف الالتزامات السابقة.", "このパッケージでは、安全上限内に記録済みの範囲履歴を収められません。履歴全体を保持し、対応する書き出し経路を使用してください。以前の約束を省略することはできません。"] },
  planInventoryLimit: { codes: "plan_inventory_limit_exceeded", text: ["The complete assignment exceeds the current planning inventory limit. All requested work is preserved; review its organization before confirming.", "La mission complète dépasse la limite actuelle de l’inventaire de planification. Tout le travail demandé est conservé ; examinez son organisation avant de confirmer.", "تتجاوز المهمة الكاملة الحد الحالي لقائمة التخطيط. يُحفظ كل العمل المطلوب؛ راجع تنظيمه قبل التأكيد.", "依頼全体が、現在計画で扱える一覧の上限を超えています。依頼された作業はすべて保持されています。確定する前に構成を見直してください。"] },
  labelTooLong: { codes: "label_too_long", text: ["A saved name exceeds the supported label limit. Shorten the marked name; the original wording and requirement decisions remain preserved separately.", "Un nom enregistré dépasse la limite des libellés prise en charge. Raccourcissez le nom signalé ; le texte d’origine et les décisions des exigences restent conservés séparément.", "يتجاوز اسم محفوظ حد التسمية المدعوم. اختصر الاسم المحدد؛ وتبقى الصياغة الأصلية وقرارات المتطلبات محفوظة بشكل منفصل.", "保存済みの名前が、対応するラベルの上限を超えています。指摘された名前を短くしてください。元の文言と要件の判断内容は別に保持されます。"] },
  labelCharacters: { codes: "label_control_characters", text: ["Use a plain text name without control or formatting characters. Keep the original wording in its separate request field.", "Utilisez un nom en texte simple, sans caractères de contrôle ou de formatage. Conservez le texte d’origine dans son champ de demande séparé.", "استخدم اسمًا نصيًا بسيطًا دون محارف تحكم أو تنسيق. احتفظ بالصياغة الأصلية في حقل الطلب المنفصل الخاص بها.", "制御文字や書式制御文字を含まない通常のテキストの名前を使用してください。元の文言は別の依頼欄に保持してください。"] },
  labelRequired: { codes: "label_required invalid_label_type", text: ["Give this requirement, deliverable, variant, or series member a nonempty text name.", "Donnez à cette exigence, ce livrable, cette variante ou cet élément de série un nom textuel non vide.", "أعطِ هذا المتطلب أو المخرج أو المتغير أو عنصر السلسلة اسمًا نصيًا غير فارغ.", "この要件、納品物、バリエーション、またはシリーズ項目に、空でないテキストの名前を付けてください。"] },
  legacyCustodyRecheck: { codes: "output_legacy_custody_recheck_required", text: ["The stored records of some older files could not be fully checked. Recheck those exact files before accepting or delivering them; earlier records are preserved.", "Les informations de stockage de certains fichiers anciens n’ont pas pu être entièrement vérifiées. Revérifiez ces fichiers précis avant de les accepter ou de les livrer ; les enregistrements antérieurs sont conservés.", "تعذر التحقق الكامل من سجلات التخزين لبعض الملفات القديمة. أعد فحص تلك الملفات بعينها قبل قبولها أو تسليمها؛ وتُحفظ السجلات السابقة.", "一部の以前のファイルの保存記録を十分に確認できませんでした。承認または納品する前に、その正確なファイルを再確認してください。以前の記録は保持されています。"] },
  readModelUnavailable: { codes: "output_read_model_unavailable", text: [
    "Output records could not be loaded. Refresh outputs to retry. The full assignment remains in scope; file availability and delivery status are unconfirmed.",
    "Les données des sorties n’ont pas pu être chargées. Actualisez les sorties pour réessayer. Le périmètre complet de la mission est conservé ; la disponibilité des fichiers et l’état de livraison ne sont pas confirmés.",
    "تعذر تحميل سجلات المخرجات. حدّث المخرجات لإعادة المحاولة. تبقى المهمة بكاملها ضمن النطاق؛ ولم يُؤكَّد توفر الملفات أو حالة التسليم.",
    "出力の記録を読み込めませんでした。出力を更新して再試行してください。依頼の全範囲は維持されます。ファイルの利用可否と納品状況は未確認です。"
  ] },
  readModelRowsIncomplete: { codes: "output_read_model_rows_incomplete", text: [
    "The Output records exceed the current read limit. Refresh outputs to retry; the full assignment remains in scope, and availability and delivery status remain unconfirmed.",
    "Les données des sorties dépassent la limite de lecture actuelle. Actualisez les sorties pour réessayer ; le périmètre complet de la mission est conservé, et la disponibilité ainsi que l’état de livraison restent non confirmés.",
    "تتجاوز سجلات المخرجات حد القراءة الحالي. حدّث المخرجات لإعادة المحاولة؛ وتبقى المهمة بكاملها ضمن النطاق، ويظل التوفر وحالة التسليم غير مؤكَّدين.",
    "出力の記録が現在の読み取り上限を超えています。出力を更新して再試行してください。依頼の全範囲は維持され、利用可否と納品状況は未確認のままです。"
  ] },
  readModelPrivateEvidenceIncomplete: { codes: "output_read_model_private_evidence_incomplete", text: [
    "Private verification records could not be fully read within the current limits. Refresh outputs to retry. The full assignment remains in scope; availability and delivery status are unconfirmed.",
    "Les données privées de vérification n’ont pas pu être lues intégralement dans les limites actuelles. Actualisez les sorties pour réessayer. Le périmètre complet de la mission est conservé ; la disponibilité et l’état de livraison ne sont pas confirmés.",
    "تعذرت قراءة سجلات التحقق الخاصة بالكامل ضمن الحدود الحالية. حدّث المخرجات لإعادة المحاولة. تبقى المهمة بكاملها ضمن النطاق؛ ولم يُؤكَّد التوفر أو حالة التسليم.",
    "現在の上限内では、非公開の検証記録をすべて読み取れませんでした。出力を更新して再試行してください。依頼の全範囲は維持されます。利用可否と納品状況は未確認です。"
  ] },
  custodyInventoryIncomplete: { codes: "output_custody_inventory_incomplete", text: [
    "The stored-file inventory could not be fully checked. Refresh outputs to retry; file availability remains unconfirmed. All requirements remain in scope.",
    "L’inventaire des fichiers stockés n’a pas pu être vérifié intégralement. Actualisez les sorties pour réessayer ; la disponibilité des fichiers reste non confirmée. Toutes les exigences restent dans le périmètre.",
    "تعذر التحقق الكامل من قائمة الملفات المخزّنة. حدّث المخرجات لإعادة المحاولة؛ ويظل توفر الملفات غير مؤكَّد. تبقى جميع المتطلبات ضمن النطاق.",
    "保存ファイルの一覧をすべて確認できませんでした。出力を更新して再試行してください。ファイルの利用可否は未確認のままです。すべての要件が引き続き対象です。"
  ] },
  custodyInventoryUnavailable: { codes: "output_custody_inventory_unavailable", text: [
    "The stored-file inventory is unavailable. Refresh outputs to retry; this does not prove that files are missing. All requirements remain in scope.",
    "L’inventaire des fichiers stockés est indisponible. Actualisez les sorties pour réessayer ; cela ne prouve pas que des fichiers sont manquants. Toutes les exigences restent dans le périmètre.",
    "قائمة الملفات المخزّنة غير متاحة. حدّث المخرجات لإعادة المحاولة؛ فهذا لا يثبت فقدان ملفات. تبقى جميع المتطلبات ضمن النطاق.",
    "保存ファイルの一覧を取得できません。出力を更新して再試行してください。この状態は、ファイルの欠落を示すものではありません。すべての要件が引き続き対象です。"
  ] },
  custodyInventoryChanged: { codes: "output_custody_inventory_changed", text: [
    "Stored-file metadata changed during verification. Refresh outputs to recheck current availability. All requirements remain in scope; this read does not confirm delivery.",
    "Les métadonnées des fichiers stockés ont changé pendant la vérification. Actualisez les sorties pour revérifier leur disponibilité actuelle. Toutes les exigences restent dans le périmètre ; cette lecture ne confirme pas la livraison.",
    "تغيّرت البيانات الوصفية للملفات المخزّنة أثناء التحقق. حدّث المخرجات لإعادة فحص توفرها الحالي. تبقى جميع المتطلبات ضمن النطاق؛ ولا تؤكد هذه القراءة التسليم.",
    "検証中に保存ファイルのメタデータが変更されました。出力を更新して、現在の利用可否を再確認してください。すべての要件が引き続き対象です。今回の読み取りでは納品を確認できません。"
  ] },
  packageNeedsRepreparation: { codes: "output_delivery_package_needs_repreparation", text: [
    "This package uses an older part size that exceeds the current download limit. Prepare a new package with supported part sizes; the full assignment and delivery history must remain included.",
    "Ce paquet utilise une ancienne taille de partie qui dépasse la limite de téléchargement actuelle. Préparez un nouveau paquet avec des tailles de parties prises en charge ; la mission complète et l’historique de livraison doivent rester inclus.",
    "تستخدم هذه الحزمة حجم جزء قديمًا يتجاوز حد التنزيل الحالي. جهّز حزمة جديدة بأحجام أجزاء مدعومة؛ ويجب أن تظل المهمة كاملة وسجل التسليم مضمَّنين.",
    "このパッケージは以前の分割サイズを使用しており、現在のダウンロード上限を超えています。対応する分割サイズで新しいパッケージを準備してください。依頼の全範囲と納品履歴を含めたままにする必要があります。"
  ] },
  sourceEvidenceCapacity: { codes: "context_source_evidence_capacity_exceeded", text: [
    "The reported route’s source verification limit is exceeded. Upload, file matching, review, generation, export, and download each require their applicable route’s source checks. Capacity blocks only actions whose own route limit is exceeded; compare the numeric limits shown for each route. The complete source and all Output requirements are retained. Reconfirming does not raise limits, and no sources are dropped.",
    "La limite de vérification des sources de la voie signalée est dépassée. L’envoi, l’association de fichiers, la révision, la génération, l’exportation et le téléchargement nécessitent chacun les contrôles des sources de leur voie respective. Seules les actions qui dépassent la limite de leur propre voie sont bloquées pour des raisons de capacité ; comparez les limites chiffrées affichées pour chaque voie. L’intégralité des sources et toutes les exigences de sortie sont conservées. Reconfirmer ne relève pas les limites, et aucune source n’est retirée.",
    "تم تجاوز حد التحقق من المصادر للمسار المُبلّغ عنه. يتطلب رفع الملفات ومطابقتها ومراجعتها والتوليد والتصدير والتنزيل فحوص المصادر الخاصة بالمسار الذي ينطبق على كل إجراء. يقتصر الحظر بسبب السعة على الإجراءات التي يُتجاوز حد مسارها الخاص؛ قارن الحدود الرقمية المعروضة لكل مسار. تُحفظ المصادر كاملة وجميع متطلبات المخرجات. إعادة التأكيد لا ترفع الحدود، ولا يُستبعَد أي مصدر.",
    "対象の処理経路で、ソース検証の上限を超えています。アップロード、ファイルの関連付け、レビュー、生成、エクスポート、ダウンロードには、それぞれに適用される経路のソースチェックが必要です。容量が理由で実行できないのは、その操作に適用される経路の上限を超える場合だけです。経路ごとに表示された数値の上限を比較してください。ソース全体とすべての出力要件は保持されます。再確定しても上限は上がらず、ソースが除外されることもありません。"
  ] },
  nativeExecutionWindow: { codes: "output_native_execution_window", text: [
    "Whole attempt limit: {maximumExecutionSeconds} seconds, shared by initial work and any repair, or planning and image rendering. A timeout stops application work but does not prove provider cancellation or a refund. Reservations for unknown outcomes or costs remain held; no automatic retry starts.",
    "Durée maximale de toute la tentative : {maximumExecutionSeconds} secondes, partagée entre le travail initial et toute correction, ou entre la planification et le rendu de l’image. L’expiration arrête le travail de l’application sans prouver l’annulation chez le fournisseur ni un remboursement. Les réserves liées à des résultats ou coûts inconnus restent bloquées ; aucune nouvelle tentative automatique ne commence.",
    "الحد الزمني للمحاولة كاملة: {maximumExecutionSeconds} ثانية، ويشمل العمل الأولي وأي إصلاح، أو التخطيط وإنشاء الصورة. انتهاء المهلة يوقف عمل التطبيق، لكنه لا يثبت إلغاء الطلب لدى المزوّد أو استرداد المال. تبقى الحجوزات الخاصة بنتائج أو تكاليف مجهولة قائمة؛ ولا تبدأ إعادة محاولة تلقائية.",
    "試行全体の上限は{maximumExecutionSeconds}秒です。この時間を、初回の処理と修正、または計画と画像の描画で共有します。タイムアウトはアプリケーションの処理を止めますが、プロバイダー側のキャンセルや返金を証明しません。結果や費用が不明な予約枠は確保されたままで、自動再試行は始まりません。"
  ] },
  nativeExecutionWindowUnknown: { codes: "output_native_execution_window_unknown", text: [
    "The time limit for the complete attempt is unavailable.",
    "La limite de durée de la tentative complète est indisponible.",
    "الحد الزمني للمحاولة كاملة غير متاح.",
    "試行全体の時間上限を取得できません。"
  ] },
  executionTimeLimit: { codes: "output_execution_time_limit", text: [
    "This native attempt reached its execution time limit, including planning and repairs. A request already sent may still incur charges. No replacement is submitted automatically.",
    "Cette tentative de génération native a atteint sa limite de durée, planification et corrections comprises. Une demande déjà envoyée peut encore entraîner des frais. Aucune tentative de remplacement n’est soumise automatiquement.",
    "بلغت محاولة التوليد المدمج هذه حد وقت التنفيذ، بما يشمل التخطيط والإصلاحات. قد تترتب تكاليف على طلب أُرسل بالفعل. لا تُقدَّم محاولة بديلة تلقائيًا.",
    "このネイティブ生成の試行は、計画や修正を含む実行時間の上限に達しました。送信済みのリクエストには、引き続き料金が発生する可能性があります。代わりの試行が自動で送信されることはありません。"
  ] },
  receiptScopeChanged: { codes: "output_receipt_scope_changed", text: [
    "The operation receipt is no longer available in this scope. No result from the previous scope was shown.",
    "Le reçu de l’opération n’est plus disponible dans ce périmètre. Aucun résultat du périmètre précédent n’a été affiché.",
    "لم يعد إيصال العملية متاحًا في هذا النطاق. لم تُعرض أي نتيجة من النطاق السابق.",
    "この範囲では処理記録を利用できなくなりました。以前の範囲の結果は表示していません。"
  ] },
  receiptCheckFailed: { codes: "output_receipt_check_failed", text: [
    "The receipt check could not be confirmed. No new provider request was submitted. Refresh the saved state or give the technical receipt to an authorized operator.",
    "La vérification du reçu n’a pas pu être confirmée. Aucune nouvelle demande n’a été envoyée à un fournisseur. Actualisez l’état enregistré ou remettez le reçu technique à un opérateur autorisé.",
    "تعذر تأكيد فحص الإيصال. لم يُرسل أي طلب جديد إلى المزوّد. حدّث الحالة المحفوظة أو سلّم الإيصال التقني إلى مشغّل مخوّل.",
    "処理記録の確認結果を確定できませんでした。プロバイダーへの新しいリクエストは送信していません。保存済みの状態を更新するか、権限を持つ運用担当者に技術記録を渡してください。"
  ] },
  receiptResponseMismatch: { codes: "output_receipt_response_mismatch", text: [
    "The saved receipt response does not match the requested attempt. Do not use it to decide charges or replacements. Refresh saved state or ask an authorized operator to investigate.",
    "Le reçu enregistré renvoyé ne correspond pas à la tentative demandée. Ne l’utilisez pas pour décider de frais ou d’un remplacement. Actualisez l’état enregistré ou demandez à un opérateur autorisé d’enquêter.",
    "لا يطابق رد الإيصال المحفوظ المحاولة المطلوبة. لا تستخدمه لاتخاذ قرار بشأن التكاليف أو البدائل. حدّث الحالة المحفوظة أو اطلب من مشغّل مخوّل التحقيق.",
    "返された保存済みの処理記録は、指定した試行と一致しません。費用や代わりの試行について判断する根拠にしないでください。保存済みの状態を更新するか、権限を持つ運用担当者に調査を依頼してください。"
  ] },
  receiptNativeOperationRequired: { codes: "output_native_operation_required", text: [
    "This receipt check is available only for a saved job bound to an Output attempt. It does not authorize new generation.",
    "Cette vérification de reçu est réservée aux tâches enregistrées liées à une tentative de livrable. Elle n’autorise aucune nouvelle génération.",
    "يتاح فحص الإيصال هذا فقط لمهمة محفوظة مرتبطة بمحاولة مخرج. ولا يأذن بأي توليد جديد.",
    "この処理記録の確認は、出力の試行に結び付いた保存済みジョブだけで利用できます。新しい生成を許可するものではありません。"
  ] },
  receiptOperationStillRunning: { codes: "output_operation_still_running", text: [
    "This attempt is still active. Check its saved receipt after it stops; no replacement is authorized by this control.",
    "Cette tentative est toujours active. Vérifiez son reçu enregistré après son arrêt ; cette commande n’autorise aucun remplacement.",
    "لا تزال هذه المحاولة نشطة. افحص إيصالها المحفوظ بعد توقفها؛ فهذا الإجراء لا يأذن بأي بديل.",
    "この試行はまだ進行中です。終了後に保存済みの処理記録を確認してください。この操作で代わりの試行が許可されることはありません。"
  ] },
  providerUsageUnverified: { codes: "output_provider_usage_invalid output_provider_usage_mismatch", text: [
    "Provider usage could not be verified for accounting. Unresolved reservations remain held. Check the saved receipt or ask an authorized operator to investigate; do not retry generation to repair accounting.",
    "La consommation auprès du fournisseur n’a pas pu être vérifiée pour la comptabilité. Les réserves non résolues restent bloquées. Vérifiez le reçu enregistré ou demandez à un opérateur autorisé d’enquêter ; ne relancez pas la génération pour corriger la comptabilité.",
    "تعذر التحقق من استهلاك المزوّد لأغراض المحاسبة. تبقى الحجوزات غير المحسومة قائمة. افحص الإيصال المحفوظ أو اطلب من مشغّل مخوّل التحقيق؛ ولا تعِد التوليد لإصلاح الحسابات.",
    "会計処理に必要なプロバイダーの使用量を検証できませんでした。未確定の予約枠は確保されたままです。保存済みの処理記録を確認するか、権限を持つ運用担当者に調査を依頼してください。会計情報を修復するために生成を再試行しないでください。"
  ] },
  receiptJobUnavailable: { codes: "job_not_found", text: [
    "This saved attempt is unavailable in the current workspace. Check the selected Document and your access before checking its receipt.",
    "Cette tentative enregistrée est indisponible dans l’espace de travail actuel. Vérifiez le document sélectionné et vos droits d’accès avant de vérifier son reçu.",
    "هذه المحاولة المحفوظة غير متاحة في مساحة العمل الحالية. تحقق من المستند المحدد وصلاحيات الوصول قبل فحص إيصالها.",
    "現在のワークスペースでは、この保存済みの試行を利用できません。処理記録を確認する前に、選択したドキュメントとアクセス権を確認してください。"
  ] },
  artifactNoChanges: { codes: "", text: [
    "No changes to this finished output.",
    "Aucune modification de ce résultat final.",
    "لا توجد تغييرات على هذا المخرج النهائي.",
    "この完成済みの出力に変更はありません。",
  ] },
  sourceGovernanceCapacity: { codes: "output_source_governance_capacity_exceeded", text: [
    "This route cannot fully verify the governed sources within the pilot’s verification capacity. Inspect this Document’s governed sources and contact a workspace administrator.",
    "Cette voie de traitement ne peut pas vérifier intégralement les sources soumises à gouvernance dans les limites de vérification du pilote. Examinez les sources soumises à gouvernance de ce document et contactez un administrateur de l’espace de travail.",
    "لا يستطيع هذا المسار التحقق بالكامل من المصادر الخاضعة للحوكمة ضمن قدرة التحقق في المرحلة التجريبية. افحص مصادر هذا المستند الخاضعة للحوكمة وتواصل مع مسؤول مساحة العمل.",
    "この処理経路では、試験運用の検証容量内で、管理対象のソースをすべて検証できません。このドキュメントの管理対象ソースを確認し、ワークスペース管理者に連絡してください。"
  ] },
} as const satisfies Record<string, { codes: string; text: Translation }>;

export type OutputDeliveryRuntimeMessageName = keyof typeof groups;
export type OutputDeliveryRuntimeMessageId = `output.delivery.message.${OutputDeliveryRuntimeMessageName}`;
function catalog(index: 0 | 1 | 2 | 3): Readonly<Record<OutputDeliveryRuntimeMessageId, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(groups).map(([name, group]) => [`output.delivery.message.${name}`, group.text[index]]))) as Readonly<Record<OutputDeliveryRuntimeMessageId, string>>;
}
export const FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES = Object.freeze({ en: catalog(0), fr: catalog(1), ar: catalog(2), ja: catalog(3) });
const byCode = new Map<string, OutputDeliveryRuntimeMessageId>();
for (const [name, group] of Object.entries(groups)) for (const code of group.codes.trim().split(/\s+/u).filter(Boolean)) {
  if (byCode.has(code)) throw new Error(`Duplicate Output message code: ${code}`);
  byCode.set(code, `output.delivery.message.${name}` as OutputDeliveryRuntimeMessageId);
}
export const OUTPUT_DELIVERY_RUNTIME_CODES: readonly string[] = Object.freeze([...byCode.keys()].sort());
export type OutputDeliveryMessageDescriptor = { id: OutputDeliveryRuntimeMessageId; values: Record<string, string | number>; known: boolean };
export function outputDeliveryMessageDescriptor(code: unknown, values: unknown = {}): OutputDeliveryMessageDescriptor {
  const id = typeof code === "string" ? byCode.get(code) : undefined;
  if (!id) return { id: "output.delivery.message.unknown", values: {}, known: false };
  const expected = [...FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en[id].matchAll(/\{(\w+)\}/gu)].map((match) => match[1]!);
  const record = values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, unknown> : {};
  const safe: Record<string, string | number> = {};
  for (const key of expected) {
    const value = Object.hasOwn(record, key) ? record[key] : undefined;
    if (key === "maximumExecutionSeconds" && !(typeof value === "number" && Number.isFinite(value) && value > 0)) return { id: "output.delivery.message.incomplete", values: {}, known: false };
    if (!(typeof value === "string" && value.length <= 4000 || typeof value === "number" && Number.isFinite(value))) return { id: "output.delivery.message.incomplete", values: {}, known: false };
    safe[key] = value;
  }
  return { id, values: safe, known: true };
}
