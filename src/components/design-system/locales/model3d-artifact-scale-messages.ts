export type Model3dScaleStatus =
  | "saved" | "unchanged" | "invalid_scale" | "unsupported" | "unavailable"
  | "access_denied" | "unconfirmed" | "retired" | "source_changed";

export type Model3dScaleCopy = Readonly<{
  action: string;
  title: string;
  help: string;
  factor: string;
  currentDimensions: string;
  proposedDimensions: string;
  units: string;
  autoFit: string;
  loading: string;
  preparing: string;
  checking: string;
  save: string;
  saving: string;
  cancel: string;
  check: string;
  originalNotes: string;
  currentFileNotes: string;
  status: Readonly<Record<Model3dScaleStatus, string>>;
}>;

const en: Model3dScaleCopy = {
  action: "Scale GLB",
  title: "Scale model geometry",
  help: "Apply one positive scale factor to the saved GLB vertices.",
  factor: "Scale factor",
  currentDimensions: "Current dimensions",
  proposedDimensions: "Proposed dimensions",
  units: "Model units",
  autoFit: "The viewer fits each model to the available space, so its on-screen size may look unchanged.",
  loading: "Reading and verifying the current GLB…",
  preparing: "Preparing scaled geometry…",
  checking: "Checking this Save…",
  save: "Save scale",
  saving: "Saving scaled GLB…",
  cancel: "Cancel scaling",
  check: "Check this Save",
  originalNotes: "Original files are preserved. Saving makes the scaled GLB the current file. Request a new review before sharing it.",
  currentFileNotes: "This GLB contains an authored geometry edit. Other original formats have not been scaled.",
  status: {
    saved: "The scaled GLB is now the current file. Original files are preserved. Request a new review before sharing it.",
    unchanged: "The geometry is unchanged. The current file is retained.",
    invalid_scale: "Enter a positive scale factor that keeps the model coordinates within the supported range.",
    unsupported: "This GLB cannot be scaled here. Cancel to return to the current model.",
    unavailable: "The current GLB could not be verified. Cancel and reopen the model before editing.",
    access_denied: "You do not have permission to save this geometry edit.",
    unconfirmed: "The Save result is unconfirmed. It will not be retried automatically. Use “Check this Save” to check the same operation without saving again.",
    retired: "This editing session is no longer current. Reopen the model to continue.",
    source_changed: "The model source changed. Cancel and reopen the current model before editing."
  }
};

const fr: Model3dScaleCopy = {
  action: "Mettre le GLB à l’échelle",
  title: "Mettre la géométrie du modèle à l’échelle",
  help: "Appliquez un facteur d’échelle positif unique aux sommets du GLB enregistré.",
  factor: "Facteur d’échelle",
  currentDimensions: "Dimensions actuelles",
  proposedDimensions: "Dimensions proposées",
  units: "Unités du modèle",
  autoFit: "La visionneuse ajuste chaque modèle à l’espace disponible ; sa taille à l’écran peut donc sembler inchangée.",
  loading: "Lecture et vérification du GLB actuel…",
  preparing: "Préparation de la géométrie mise à l’échelle…",
  checking: "Vérification de cet enregistrement…",
  save: "Enregistrer la mise à l’échelle",
  saving: "Enregistrement du GLB mis à l’échelle…",
  cancel: "Annuler la mise à l’échelle",
  check: "Vérifier cet enregistrement",
  originalNotes: "Les fichiers originaux sont conservés. L’enregistrement fait du GLB mis à l’échelle le fichier actuel. Demandez une nouvelle validation avant de le partager.",
  currentFileNotes: "Ce GLB contient une modification de géométrie effectuée par un auteur. Les autres formats d’origine n’ont pas été mis à l’échelle.",
  status: {
    saved: "Le GLB mis à l’échelle est désormais le fichier actuel. Les fichiers originaux sont conservés. Demandez une nouvelle validation avant de le partager.",
    unchanged: "La géométrie est inchangée. Le fichier actuel est conservé.",
    invalid_scale: "Saisissez un facteur d’échelle positif qui maintient les coordonnées du modèle dans la plage prise en charge.",
    unsupported: "Ce GLB ne peut pas être mis à l’échelle ici. Annulez pour revenir au modèle actuel.",
    unavailable: "Le GLB actuel n’a pas pu être vérifié. Annulez et rouvrez le modèle avant de le modifier.",
    access_denied: "Vous n’avez pas l’autorisation d’enregistrer cette modification de géométrie.",
    unconfirmed: "Le résultat de l’enregistrement n’est pas confirmé. Aucune nouvelle tentative automatique ne sera effectuée. Utilisez « Vérifier cet enregistrement » pour vérifier la même opération sans enregistrer à nouveau.",
    retired: "Cette session de modification n’est plus actuelle. Rouvrez le modèle pour continuer.",
    source_changed: "La source du modèle a changé. Annulez et rouvrez le modèle actuel avant de le modifier."
  }
};

const ar: Model3dScaleCopy = {
  action: "تغيير مقياس GLB",
  title: "تغيير مقياس هندسة النموذج",
  help: "طبّق عامل مقياس موجبًا واحدًا على رؤوس ملف GLB المحفوظ.",
  factor: "عامل المقياس",
  currentDimensions: "الأبعاد الحالية",
  proposedDimensions: "الأبعاد المقترحة",
  units: "وحدات النموذج",
  autoFit: "يُكيّف العارض كل نموذج مع المساحة المتاحة، لذلك قد يبدو حجمه على الشاشة دون تغيير.",
  loading: "جارٍ قراءة ملف GLB الحالي والتحقق منه…",
  preparing: "جارٍ إعداد الهندسة بالمقياس الجديد…",
  checking: "جارٍ التحقق من عملية الحفظ هذه…",
  save: "حفظ المقياس",
  saving: "جارٍ حفظ ملف GLB بالمقياس الجديد…",
  cancel: "إلغاء تغيير المقياس",
  check: "التحقق من عملية الحفظ هذه",
  originalNotes: "تبقى الملفات الأصلية محفوظة. يجعل الحفظ ملف GLB المعدّل بالمقياس هو الملف الحالي. اطلب مراجعة جديدة قبل مشاركته.",
  currentFileNotes: "يتضمن ملف GLB هذا تعديلًا يدويًا للهندسة. لم يتغير مقياس الملفات الأصلية ذات الصيغ الأخرى.",
  status: {
    saved: "أصبح ملف GLB بالمقياس الجديد هو الملف الحالي. تبقى الملفات الأصلية محفوظة. اطلب مراجعة جديدة قبل مشاركته.",
    unchanged: "لم تتغير الهندسة. يُحتفظ بالملف الحالي.",
    invalid_scale: "أدخل عامل مقياس موجبًا يُبقي إحداثيات النموذج ضمن النطاق المدعوم.",
    unsupported: "لا يمكن تغيير مقياس ملف GLB هذا هنا. ألغِ العملية للعودة إلى النموذج الحالي.",
    unavailable: "تعذّر التحقق من ملف GLB الحالي. ألغِ العملية وأعد فتح النموذج قبل تعديله.",
    access_denied: "ليس لديك إذن بحفظ هذا التعديل على الهندسة.",
    unconfirmed: "نتيجة الحفظ غير مؤكدة. لن تُعاد المحاولة تلقائيًا. استخدم «التحقق من عملية الحفظ هذه» للتحقق من العملية نفسها دون الحفظ مرة أخرى.",
    retired: "لم تعد جلسة التحرير هذه سارية. أعد فتح النموذج للمتابعة.",
    source_changed: "تغيّر مصدر النموذج. ألغِ العملية وأعد فتح النموذج الحالي قبل تعديله."
  }
};

const ja: Model3dScaleCopy = {
  action: "GLBを拡大・縮小",
  title: "モデルのジオメトリを拡大・縮小",
  help: "保存済みGLBの頂点座標に、1つの正の倍率を適用します。",
  factor: "倍率",
  currentDimensions: "現在の寸法",
  proposedDimensions: "変更後の寸法",
  units: "モデル単位",
  autoFit: "ビューアーは各モデルを表示領域に合わせるため、画面上の大きさは変わらないように見えることがあります。",
  loading: "現在のGLBを読み込み、検証しています…",
  preparing: "拡大・縮小したジオメトリを準備しています…",
  checking: "この保存結果を確認しています…",
  save: "倍率を保存",
  saving: "拡大・縮小したGLBを保存しています…",
  cancel: "拡大・縮小をキャンセル",
  check: "この保存結果を確認",
  originalNotes: "元のファイルは保持されます。保存すると、拡大・縮小したGLBが現在のファイルになります。共有する前に、新たなレビューを依頼してください。",
  currentFileNotes: "このGLBには手動で行ったジオメトリ編集が含まれています。他の元の形式のファイルは拡大・縮小されていません。",
  status: {
    saved: "拡大・縮小したGLBが現在のファイルになりました。元のファイルは保持されています。共有する前に、新たなレビューを依頼してください。",
    unchanged: "ジオメトリは変わっていません。現在のファイルが保持されます。",
    invalid_scale: "モデルの座標が対応範囲内に収まる正の倍率を入力してください。",
    unsupported: "このGLBはここでは拡大・縮小できません。キャンセルして現在のモデルに戻ってください。",
    unavailable: "現在のGLBを検証できませんでした。キャンセルし、モデルを開き直してから編集してください。",
    access_denied: "このジオメトリ編集を保存する権限がありません。",
    unconfirmed: "保存結果は未確認です。自動で再試行することはありません。「この保存結果を確認」で、再保存せずに同じ操作の結果を確認してください。",
    retired: "この編集セッションは無効になりました。続行するにはモデルを開き直してください。",
    source_changed: "モデルのソースが変わりました。キャンセルし、現在のモデルを開き直してから編集してください。"
  }
};

export const MODEL3D_ARTIFACT_SCALE_MESSAGES: Readonly<Record<"en" | "fr" | "ar" | "ja", Model3dScaleCopy>> = { en, fr, ar, ja };
export function model3dScaleCopy(locale: string): Model3dScaleCopy {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return language === "fr" ? fr : language === "ar" ? ar : language === "ja" ? ja : en;
}
