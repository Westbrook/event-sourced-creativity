const copy = {
  heading: ["Compose an owned film", "Monter un film à partir de vos fichiers", "تركيب فيلم من ملفاتك", "所有するクリップから映画を編集"],
  open: ["Choose and order clips", "Choisir et ordonner les clips", "اختيار المقاطع وترتيبها", "クリップを選んで並べる"],
  hint: ["Join compatible MP4 clips in the order you choose. Their total must match the agreed duration. Clips are kept whole; sound tracks and incompatible formats are not supported.", "Assemblez des clips MP4 compatibles dans l’ordre choisi. Leur durée totale doit correspondre à la durée convenue. Les clips restent entiers ; les pistes audio et les formats incompatibles ne sont pas pris en charge.", "اجمع مقاطع MP4 المتوافقة بالترتيب الذي تختاره. يجب أن يطابق مجموعها المدة المتفق عليها. تُحفظ المقاطع كاملة؛ المسارات الصوتية والصيغ غير المتوافقة غير مدعومة.", "互換性のあるMP4クリップを選んだ順に結合します。合計時間は合意した長さと一致する必要があります。クリップは全体を使用します。音声トラックや互換性のない形式には対応していません。"],
  duration: ["Agreed duration: {seconds} seconds", "Durée convenue : {seconds} secondes", "المدة المتفق عليها: {seconds} ثانية", "合意した長さ：{seconds}秒"],
  choice: ["Owned clip", "Clip détenu", "مقطع مملوك", "所有するクリップ"],
  choose: ["Choose an inspected MP4", "Choisir un MP4 inspecté", "اختر ملف MP4 تم فحصه", "検査済みのMP4を選択"],
  add: ["Add clip", "Ajouter le clip", "إضافة المقطع", "クリップを追加"],
  order: ["Clip order", "Ordre des clips", "ترتيب المقاطع", "クリップの順序"],
  earlier: ["Move earlier", "Déplacer avant", "نقل إلى السابق", "前に移動"],
  later: ["Move later", "Déplacer après", "نقل إلى التالي", "後に移動"],
  remove: ["Remove clip", "Retirer le clip", "إزالة المقطع", "クリップを削除"],
  empty: ["Add at least two clips. Upload owned clips in the owned-file section first if none are listed.", "Ajoutez au moins deux clips. Si la liste est vide, importez d’abord vos clips dans la section des fichiers détenus.", "أضف مقطعين على الأقل. إذا كانت القائمة فارغة، ارفع مقاطعك أولًا في قسم الملفات المملوكة.", "2つ以上のクリップを追加してください。一覧が空の場合は、所有ファイルの欄からクリップをアップロードしてください。"],
  rights: ["I have rights to combine these clips for this target.", "Je dispose des droits nécessaires pour assembler ces clips pour ce livrable.", "لدي حقوق جمع هذه المقاطع لهذا المخرج.", "この成果物のために、選択したクリップを結合する権利があります。"],
  compose: ["Compose file", "Monter le fichier", "تركيب الملف", "ファイルを編集"],
  preparing: ["Composing file…", "Montage du fichier…", "جارٍ تركيب الملف…", "ファイルを編集中…"],
  cancel: ["Discard clip choices", "Abandonner les choix de clips", "إلغاء اختيارات المقاطع", "クリップの選択を破棄"],
  next: ["The composed file will be staged in the owned-file section. Upload, target checks and review are separate steps.", "Le fichier monté sera préparé dans la section des fichiers détenus. L’importation, la vérification du livrable et l’examen sont des étapes distinctes.", "سيُجهّز الملف المركّب في قسم الملفات المملوكة. الرفع وفحص المخرج والمراجعة خطوات منفصلة.", "編集したファイルは所有ファイルの欄に準備されます。アップロード、成果物の検査、レビューはそれぞれ別の手順です。"],
  prepared: ["Composed file ready in the owned-file section. Confirm your rights and upload it, then match it to this target and review the exact file.", "Le fichier monté est prêt dans la section des fichiers détenus. Confirmez vos droits et importez-le, puis associez-le à ce livrable et examinez le fichier exact.", "الملف المركّب جاهز في قسم الملفات المملوكة. أكد حقوقك وارفعه، ثم طابقه مع هذا المخرج وراجع الملف نفسه.", "編集したファイルを所有ファイルの欄に準備しました。権利を確認してアップロードした後、この成果物に対応付けて実際のファイルをレビューしてください。"],
  blocked: ["Finish the current draft or upload before composing another file.", "Terminez le brouillon ou l’importation en cours avant de monter un autre fichier.", "أكمل المسودة أو الرفع الحالي قبل تركيب ملف آخر.", "別のファイルを編集する前に、現在の下書きまたはアップロードを処理してください。"],
  selection: ["Choose between two and 32 different clip entries.", "Choisissez entre deux et 32 clips distincts.", "اختر بين مقطعين و32 مقطعًا مختلفًا.", "異なるクリップを2〜32個選択してください。"],
  bytes: ["These clips exceed the supported total size, or their current bytes could not be verified.", "La taille totale de ces clips dépasse la limite prise en charge, ou leurs données actuelles n’ont pas pu être vérifiées.", "يتجاوز الحجم الإجمالي لهذه المقاطع الحد المدعوم، أو تعذر التحقق من بياناتها الحالية.", "クリップの合計サイズが上限を超えているか、現在のデータを検証できませんでした。"],
  unsupported: ["These clips cannot be joined without conversion. Use compatible silent MP4 clips with the same dimensions and timing format.", "Ces clips nécessitent une conversion avant assemblage. Utilisez des MP4 compatibles sans son, avec les mêmes dimensions et le même format temporel.", "لا يمكن جمع هذه المقاطع دون تحويل. استخدم مقاطع MP4 صامتة ومتوافقة بالأبعاد وتنسيق التوقيت نفسيهما.", "これらのクリップは変換せずに結合できません。寸法とタイミング形式が同じ、互換性のある音声なしのMP4を使用してください。"],
  durationMismatch: ["The complete clips do not match the agreed duration. Choose a different sequence; no clips were trimmed or repeated.", "Les clips entiers ne correspondent pas à la durée convenue. Choisissez une autre séquence ; aucun clip n’a été raccourci ni répété.", "لا تطابق المقاطع الكاملة المدة المتفق عليها. اختر ترتيبًا آخر؛ لم تُقصّر المقاطع ولم تُكرر.", "クリップ全体の合計が合意した長さと一致しません。別の組み合わせを選択してください。トリミングや繰り返しは行っていません。"],
  unavailable: ["Current source, access or clip information changed. Refresh Outputs before composing again.", "Les sources, les droits d’accès ou les informations des clips ont changé. Actualisez les livrables avant de recommencer.", "تغيرت المصادر أو صلاحية الوصول أو معلومات المقاطع. حدّث المخرجات قبل التركيب مجددًا.", "出典、権限、またはクリップの情報が変更されました。成果物を更新してから再度編集してください。"],
} as const;

export type FilmCompositionMessage = keyof typeof copy;
export function filmCompositionMessage(locale: string, key: FilmCompositionMessage, values: Record<string, string | number> = {}): string {
  const family = locale.toLowerCase().split(/[-_]/)[0];
  const message = copy[key][family === "fr" ? 1 : family === "ar" ? 2 : family === "ja" ? 3 : 0];
  return message.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
