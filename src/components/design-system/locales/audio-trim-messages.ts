import type { AudioTrimEditCode } from "../../../model/document-artifacts.ts";

export type AudioTrimCopy = Readonly<{
  action: string; title: string; help: string; originalNotes: string;
  loading: string; start: string; end: string; duration: string; sourceDuration: string; interval: string;
  waveform: string; preview: string; previewLabel: string; previewUnavailable: string;
  save: string; saving: string; check: string; checking: string; cancel: string; done: string; finish: string;
  personalOnly: string; nativeHint: string;
  status: Readonly<Record<AudioTrimEditCode, string>>;
}>;

const en: AudioTrimCopy = {
  action: "Trim audio", title: "Trim this audio output",
  help: "Choose the start and end of the part to keep. Saving creates a new revision and keeps the original audio in output history.",
  originalNotes: "Lyrics, transcripts and production notes remain from the original audio; they are not rewritten by trimming.",
  loading: "Loading verified audio…", start: "Start time (seconds)", end: "End time (seconds)",
  duration: "Selected duration: {seconds}s", sourceDuration: "Source duration: {seconds}s", interval: "Selected interval: {start}s–{end}s",
  waveform: "Audio waveform and selected interval", preview: "Load trim preview", previewLabel: "Play the selected trim",
  previewUnavailable: "The preview could not be loaded. Your selection is preserved.",
  save: "Save trim", saving: "Saving trim…", check: "Check this Save", checking: "Checking this Save…", cancel: "Cancel", done: "Done",
  finish: "Save or cancel the trim before closing this output.",
  personalOnly: "Trimming is available for supported personal PCM WAV outputs up to 25 MiB.",
  nativeHint: "This view is for playback. In Library, you can trim and save supported PCM WAV outputs in personal documents you own.",
  status: {
    saved: "Trim saved as a new revision. Request a fresh review before approval.",
    unchanged: "The whole audio is selected. No new revision was created.",
    source_changed: "This output changed. Reopen its current revision before choosing and saving a new trim.",
    invalid_range: "Choose a start time before the end time, within this audio.",
    unsupported: "This file cannot be trimmed here. Use a PCM WAV file with 16-bit mono or stereo audio, up to 25 MiB.",
    unavailable: "The verified audio is unavailable. Cancel this trim and reopen the output to try again.",
    access_denied: "You no longer have permission to save this trim.",
    unconfirmed: "The Save result is unconfirmed. It has not been repeated. Use “Check this Save” to check the original operation without saving again.",
    retired: "This editing session is no longer current. Reopen the output to continue.",
  },
};

const fr: AudioTrimCopy = {
  action: "Rogner l’audio", title: "Rogner ce résultat audio",
  help: "Choisissez le début et la fin de la partie à conserver. L’enregistrement crée une nouvelle révision et conserve l’audio original dans l’historique du résultat.",
  originalNotes: "Les paroles, transcriptions et notes de production restent celles de l’audio original ; le rognage ne les réécrit pas.",
  loading: "Chargement de l’audio vérifié…", start: "Début (secondes)", end: "Fin (secondes)",
  duration: "Durée sélectionnée : {seconds} s", sourceDuration: "Durée de la source : {seconds} s", interval: "Intervalle sélectionné : {start} s–{end} s",
  waveform: "Forme d’onde audio et intervalle sélectionné", preview: "Charger l’aperçu du rognage", previewLabel: "Lire la partie sélectionnée",
  previewUnavailable: "L’aperçu n’a pas pu être chargé. Votre sélection est conservée.",
  save: "Enregistrer le rognage", saving: "Enregistrement du rognage…", check: "Vérifier cet enregistrement", checking: "Vérification de cet enregistrement…", cancel: "Annuler", done: "Terminé",
  finish: "Enregistrez ou annulez le rognage avant de fermer ce résultat.",
  personalOnly: "Le rognage est disponible pour les résultats personnels au format WAV PCM pris en charge, jusqu’à 25 Mio.",
  nativeHint: "Cette vue sert à la lecture. Dans la Bibliothèque, vous pouvez rogner et enregistrer les résultats WAV PCM pris en charge dans les documents personnels dont vous êtes propriétaire.",
  status: {
    saved: "Le rognage est enregistré dans une nouvelle révision. Demandez une nouvelle revue avant l’approbation.",
    unchanged: "L’audio entier est sélectionné. Aucune nouvelle révision n’a été créée.",
    source_changed: "Ce résultat a changé. Rouvrez sa révision actuelle avant de choisir et d’enregistrer un nouveau rognage.",
    invalid_range: "Choisissez un début antérieur à la fin, dans les limites de cet audio.",
    unsupported: "Ce fichier ne peut pas être rogné ici. Utilisez un fichier WAV PCM mono ou stéréo de 16 bits, jusqu’à 25 Mio.",
    unavailable: "L’audio vérifié est indisponible. Annulez ce rognage et rouvrez le résultat pour réessayer.",
    access_denied: "Vous n’avez plus l’autorisation d’enregistrer ce rognage.",
    unconfirmed: "Le résultat de l’enregistrement n’est pas confirmé. L’opération n’a pas été répétée. Utilisez « Vérifier cet enregistrement » pour vérifier l’opération initiale sans enregistrer à nouveau.",
    retired: "Cette session de modification n’est plus actuelle. Rouvrez le résultat pour continuer.",
  },
};

const ar: AudioTrimCopy = {
  action: "اقتطاع الصوت", title: "اقتطاع هذا الناتج الصوتي",
  help: "اختر بداية الجزء الذي تريد الاحتفاظ به ونهايته. ينشئ الحفظ مراجعة جديدة ويحتفظ بالصوت الأصلي في سجل الناتج.",
  originalNotes: "تبقى الكلمات والنصوص المفرغة وملاحظات الإنتاج كما كانت في الصوت الأصلي؛ ولا يعيد الاقتطاع كتابتها.",
  loading: "جارٍ تحميل الصوت المتحقق منه…", start: "وقت البداية بالثواني", end: "وقت النهاية بالثواني",
  duration: "مدة الجزء المحدد: {seconds} ث", sourceDuration: "مدة المصدر: {seconds} ث", interval: "الفترة المحددة: {start} ث–{end} ث",
  waveform: "الموجة الصوتية والفترة المحددة", preview: "تحميل معاينة الاقتطاع", previewLabel: "تشغيل الجزء المحدد",
  previewUnavailable: "تعذّر تحميل المعاينة. تم الاحتفاظ بتحديدك.",
  save: "حفظ الاقتطاع", saving: "جارٍ حفظ الاقتطاع…", check: "التحقق من عملية الحفظ هذه", checking: "جارٍ التحقق من عملية الحفظ هذه…", cancel: "إلغاء", done: "تم",
  finish: "احفظ الاقتطاع أو ألغِه قبل إغلاق هذا الناتج.",
  personalOnly: "يتوفر الاقتطاع للنواتج الشخصية المدعومة بصيغة WAV PCM حتى 25 ميبيبايت.",
  nativeHint: "هذا العرض مخصص للتشغيل. في المكتبة، يمكنك اقتطاع نواتج WAV PCM المدعومة وحفظها في المستندات الشخصية التي تملكها.",
  status: {
    saved: "حُفظ الاقتطاع كمراجعة جديدة. اطلب مراجعة أخرى قبل الموافقة.",
    unchanged: "تم تحديد الصوت بالكامل. لم تُنشأ مراجعة جديدة.",
    source_changed: "تغيّر هذا الناتج. أعد فتح مراجعته الحالية قبل اختيار اقتطاع جديد وحفظه.",
    invalid_range: "اختر وقت بداية يسبق وقت النهاية، ضمن حدود هذا الصوت.",
    unsupported: "لا يمكن اقتطاع هذا الملف هنا. استخدم ملف WAV PCM بصوت أحادي أو ثنائي القناة وبدقة 16 بت، حتى 25 ميبيبايت.",
    unavailable: "الصوت المتحقق منه غير متاح. ألغِ هذا الاقتطاع وأعد فتح الناتج للمحاولة مرة أخرى.",
    access_denied: "لم يعد لديك إذن لحفظ هذا الاقتطاع.",
    unconfirmed: "لم تتأكد نتيجة الحفظ. لم تتكرر العملية. استخدم «التحقق من عملية الحفظ هذه» للتحقق من العملية الأصلية دون الحفظ مرة أخرى.",
    retired: "لم تعد جلسة التعديل هذه سارية. أعد فتح الناتج للمتابعة.",
  },
};

const ja: AudioTrimCopy = {
  action: "音声をトリミング", title: "この音声出力をトリミング",
  help: "残す部分の開始位置と終了位置を選びます。保存すると新しいリビジョンが作成され、元の音声は出力履歴に保持されます。",
  originalNotes: "歌詞、文字起こし、制作メモは元の音声の内容のままです。トリミングによる書き換えは行われません。",
  loading: "検証済みの音声を読み込み中…", start: "開始時刻（秒）", end: "終了時刻（秒）",
  duration: "選択部分の長さ：{seconds}秒", sourceDuration: "元の音声の長さ：{seconds}秒", interval: "選択範囲：{start}秒〜{end}秒",
  waveform: "音声波形と選択範囲", preview: "トリミングのプレビューを読み込む", previewLabel: "選択部分を再生",
  previewUnavailable: "プレビューを読み込めませんでした。選択範囲は保持されています。",
  save: "トリミングを保存", saving: "トリミングを保存中…", check: "この保存結果を確認", checking: "この保存結果を確認中…", cancel: "キャンセル", done: "完了",
  finish: "この出力を閉じる前に、トリミングを保存するかキャンセルしてください。",
  personalOnly: "トリミングは、25 MiB以下の対応する個人用PCM WAV出力で利用できます。",
  nativeHint: "この画面は再生用です。ライブラリでは、自分が所有する個人用ドキュメントの対応するPCM WAV出力をトリミングして保存できます。",
  status: {
    saved: "トリミングを新しいリビジョンとして保存しました。承認の前に再レビューを依頼してください。",
    unchanged: "音声全体が選択されています。新しいリビジョンは作成されませんでした。",
    source_changed: "この出力は変更されました。新しいトリミング範囲を選んで保存する前に、現在のリビジョンを開き直してください。",
    invalid_range: "音声の範囲内で、終了時刻より前の開始時刻を選んでください。",
    unsupported: "このファイルはここではトリミングできません。25 MiB以下の16ビット、モノラルまたはステレオのPCM WAVファイルを使用してください。",
    unavailable: "検証済みの音声を利用できません。トリミングをキャンセルし、出力を開き直して再試行してください。",
    access_denied: "このトリミングを保存する権限がなくなりました。",
    unconfirmed: "保存結果は未確認です。操作は繰り返していません。「この保存結果を確認」で、再保存せずに元の操作の結果を確認できます。",
    retired: "この編集セッションは無効になりました。続行するには出力を開き直してください。",
  },
};

export const AUDIO_TRIM_MESSAGES: Readonly<Record<"en" | "fr" | "ar" | "ja", AudioTrimCopy>> = { en, fr, ar, ja };
export function audioTrimCopy(locale: string): AudioTrimCopy {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return language === "fr" ? fr : language === "ar" ? ar : language === "ja" ? ja : en;
}
