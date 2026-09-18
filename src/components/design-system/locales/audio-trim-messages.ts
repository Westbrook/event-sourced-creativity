import type { AudioTrimEditCode } from "../../../model/document-artifacts.ts";

export type AudioTrimCopy = Readonly<{
  action: string; title: string; help: string; originalNotes: string;
  loading: string; start: string; end: string; duration: string; sourceDuration: string; interval: string;
  waveform: string; preview: string; previewLabel: string; previewUnavailable: string;
  save: string; saving: string; check: string; checking: string; cancel: string; done: string; finish: string;
  personalOnly: string; nativeHint: string;
  conversionHelp: string; conversionAction: string; conversionReady: string; conversionSave: string;
  conversionDetailsLabel: string; conversionDetails: string; conversionFailure: string;
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
  personalOnly: "Trim owned PCM WAV audio, or explicitly prepare a local WAV copy of supported MP3 audio. Files are limited to 25 MiB.",
  nativeHint: "Edit in Forma opens audio trimming. MP3 requires explicit local WAV preparation.",
  conversionHelp: "Prepare a local WAV copy, adjust the trim, then save a new revision. The original MP3 is kept.",
  conversionAction: "Prepare WAV trim", conversionReady: "WAV ready", conversionSave: "Save WAV trim",
  conversionDetailsLabel: "Local conversion details",
  conversionDetails: "Your browser performs the conversion. Forma verifies the submitted PCM and trim, but does not certify that this browser’s decode is identical to the original.",
  conversionFailure: "This browser could not prepare the audio. The original has not changed.",
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
  personalOnly: "Rognez vos fichiers WAV PCM, ou préparez explicitement une copie WAV locale d’un fichier MP3 pris en charge. Taille maximale : 25 Mio.",
  nativeHint: "Modifier dans Forma ouvre le rognage audio. Un MP3 nécessite une préparation WAV locale explicite.",
  conversionHelp: "Préparez une copie WAV locale, ajustez le rognage, puis enregistrez une nouvelle révision. Le MP3 original est conservé.",
  conversionAction: "Préparer le rognage WAV", conversionReady: "WAV prêt", conversionSave: "Enregistrer le rognage WAV",
  conversionDetailsLabel: "Détails de la conversion locale",
  conversionDetails: "Votre navigateur effectue la conversion. Forma vérifie le PCM envoyé et le rognage, mais ne certifie pas que le décodage de ce navigateur est identique à l’original.",
  conversionFailure: "Ce navigateur n’a pas pu préparer l’audio. L’original n’a pas été modifié.",
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
  personalOnly: "اقتطع صوت WAV PCM الذي تملكه، أو جهّز صراحةً نسخة WAV محلية من صوت MP3 مدعوم. الحد الأقصى للملفات 25 ميبيبايت.",
  nativeHint: "يفتح «تعديل في Forma» اقتطاع الصوت. يتطلب MP3 تجهيز WAV محليًا بشكل صريح.",
  conversionHelp: "جهّز نسخة WAV محلية، واضبط الاقتطاع، ثم احفظ مراجعة جديدة. يبقى MP3 الأصلي محفوظًا.",
  conversionAction: "تجهيز اقتطاع WAV", conversionReady: "WAV جاهز", conversionSave: "حفظ اقتطاع WAV",
  conversionDetailsLabel: "تفاصيل التحويل المحلي",
  conversionDetails: "ينفّذ متصفحك التحويل. يتحقق Forma من بيانات PCM المرسلة والاقتطاع، لكنه لا يشهد بأن فك الترميز في هذا المتصفح مطابق للأصل.",
  conversionFailure: "تعذّر على هذا المتصفح تجهيز الصوت. لم يتغير الأصل.",
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
  personalOnly: "所有するPCM WAV音声をトリミングするか、対応するMP3音声からローカルWAVコピーを明示的に準備できます。ファイルは25 MiB以下に限ります。",
  nativeHint: "「Formaで編集」で音声トリミングを開きます。MP3はローカルWAVの明示的な準備が必要です。",
  conversionHelp: "ローカルWAVコピーを準備し、範囲を調整して新しいリビジョンを保存します。元のMP3は保持されます。",
  conversionAction: "WAVトリミングを準備", conversionReady: "WAV準備完了", conversionSave: "WAVトリミングを保存",
  conversionDetailsLabel: "ローカル変換の詳細",
  conversionDetails: "変換はブラウザが行います。Formaは送信されたPCMとトリミングを検証しますが、このブラウザによるデコードが元の音声と同一であるとは保証しません。",
  conversionFailure: "このブラウザでは音声を準備できませんでした。元の音声は変更されていません。",
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
