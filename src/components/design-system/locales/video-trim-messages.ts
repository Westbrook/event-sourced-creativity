import type { VideoTrimEditCode } from "../../../model/document-artifacts.ts";

export type VideoTrimCopy = Readonly<{
  action: string;
  title: string;
  help: string;
  originalNotes: string;
  loading: string;
  start: string;
  end: string;
  duration: string;
  exactTime: string;
  sourceDuration: string;
  interval: string;
  dimensions: string;
  save: string;
  saving: string;
  check: string;
  checking: string;
  cancel: string;
  done: string;
  finish: string;
  personalOnly: string;
  status: Readonly<Record<VideoTrimEditCode, string>>;
}>;

const en: VideoTrimCopy = {
  "action": "Trim ending",
  "title": "Trim the ending",
  "help": "Keep the beginning of a supported silent AVC MP4. Choose an encoded sample boundary for its ending. Video with audio, multiple tracks or unsupported encoding cannot be trimmed here. This editor does not play or preview video.",
  "originalNotes": "Save creates a new revision with shorter video bytes and keeps the original. Review the new revision before using it.",
  "loading": "Reading and verifying the owned video…",
  "start": "Start: 0 seconds (fixed)",
  "end": "Ending sample (exclusive)",
  "duration": "Selected duration: approximately {seconds} s",
  "exactTime": "Exact duration: {fraction} seconds",
  "sourceDuration": "Original duration: approximately {seconds} s",
  "interval": "Keep samples 0 through {end}, excluding {end}, from {count} samples.",
  "dimensions": "Video dimensions: {width} × {height}",
  "save": "Save trim",
  "saving": "Saving trim…",
  "check": "Check this Save",
  "checking": "Checking this Save…",
  "cancel": "Cancel trim",
  "done": "Done",
  "finish": "Finish",
  "personalOnly": "Trim ending is available for supported silent MP4 outputs in personal documents you own.",
  "status": {
    "saved": "The shorter video was saved as a new revision. The original is retained. Review this revision before using it.",
    "unchanged": "The whole video is selected. Saving keeps the current revision and original bytes.",
    "source_changed": "The source changed. Cancel this trim and reopen the output to select its current revision.",
    "invalid_range": "Choose a whole-number ending sample from 1 through the original sample count. The start stays at 0.",
    "unsupported": "This video is outside the supported silent AVC MP4 subset. Cancel this trim to return to the output.",
    "unavailable": "The verified video is unavailable. Cancel this trim and reopen the output to try again.",
    "access_denied": "You no longer have permission to save this trim.",
    "unconfirmed": "The Save result is unconfirmed. The operation has not been repeated. Use “Check this Save” to check the original operation without saving again.",
    "retired": "This editing session is no longer current. Reopen the output to continue."
  }
};

const fr: VideoTrimCopy = {
  "action": "Rogner la fin",
  "title": "Rogner la fin",
  "help": "Conservez le début d’un MP4 AVC sans audio compatible. Choisissez une limite d’échantillon encodé pour sa fin. Les vidéos avec audio, plusieurs pistes ou un encodage non pris en charge ne peuvent pas être rognées ici. Cet éditeur ne lit pas la vidéo et ne fournit pas d’aperçu.",
  "originalNotes": "L’enregistrement crée une nouvelle révision avec un fichier vidéo plus court et conserve l’original. Vérifiez la nouvelle révision avant de l’utiliser.",
  "loading": "Lecture et vérification de la vidéo détenue…",
  "start": "Début : 0 seconde (fixe)",
  "end": "Échantillon de fin (exclu)",
  "duration": "Durée sélectionnée : environ {seconds} s",
  "exactTime": "Durée exacte : {fraction} secondes",
  "sourceDuration": "Durée d’origine : environ {seconds} s",
  "interval": "Conserver les échantillons de 0 à {end}, en excluant {end}, sur {count} échantillons.",
  "dimensions": "Dimensions de la vidéo : {width} × {height}",
  "save": "Enregistrer le rognage",
  "saving": "Enregistrement du rognage…",
  "check": "Vérifier cet enregistrement",
  "checking": "Vérification de cet enregistrement…",
  "cancel": "Annuler le rognage",
  "done": "Terminé",
  "finish": "Terminer",
  "personalOnly": "Le rognage de la fin est disponible pour les sorties MP4 sans audio compatibles dans les documents personnels dont vous êtes propriétaire.",
  "status": {
    "saved": "La vidéo raccourcie a été enregistrée dans une nouvelle révision. L’original est conservé. Vérifiez cette révision avant de l’utiliser.",
    "unchanged": "La vidéo entière est sélectionnée. L’enregistrement conserve la révision actuelle et les octets d’origine.",
    "source_changed": "La source a changé. Annulez ce rognage et rouvrez la sortie pour sélectionner sa révision actuelle.",
    "invalid_range": "Choisissez un échantillon de fin entier entre 1 et le nombre d’échantillons d’origine. Le début reste à 0.",
    "unsupported": "Cette vidéo ne fait pas partie du sous-ensemble MP4 AVC sans audio pris en charge. Annulez ce rognage pour revenir à la sortie.",
    "unavailable": "La vidéo vérifiée est indisponible. Annulez ce rognage et rouvrez la sortie pour réessayer.",
    "access_denied": "Vous n’avez plus l’autorisation d’enregistrer ce rognage.",
    "unconfirmed": "Le résultat de l’enregistrement n’est pas confirmé. L’opération n’a pas été répétée. Utilisez « Vérifier cet enregistrement » pour vérifier l’opération initiale sans enregistrer à nouveau.",
    "retired": "Cette session de modification n’est plus actuelle. Rouvrez la sortie pour continuer."
  }
};

const ar: VideoTrimCopy = {
  "action": "اقتطاع النهاية",
  "title": "اقتطاع نهاية الفيديو",
  "help": "احتفظ ببداية ملف MP4 بترميز AVC مدعوم ومن دون صوت. اختر حد عينة مرمّزة لنهايته. لا يمكن هنا اقتطاع الفيديو الذي يتضمن صوتًا أو مسارات متعددة أو ترميزًا غير مدعوم. لا يشغّل هذا المحرر الفيديو ولا يعرض معاينة له.",
  "originalNotes": "ينشئ الحفظ مراجعة جديدة ببيانات فيديو أقصر ويحتفظ بالأصل. راجع المراجعة الجديدة قبل استخدامها.",
  "loading": "جارٍ قراءة الفيديو المملوك والتحقق منه…",
  "start": "البداية: 0 ثانية (ثابتة)",
  "end": "عينة النهاية (غير مشمولة)",
  "duration": "المدة المختارة: نحو {seconds} ث",
  "exactTime": "المدة الدقيقة: {fraction} ثانية",
  "sourceDuration": "المدة الأصلية: نحو {seconds} ث",
  "interval": "الاحتفاظ بالعينات من 0 إلى {end}، مع استبعاد {end}، من أصل {count} عينة.",
  "dimensions": "أبعاد الفيديو: {width} × {height}",
  "save": "حفظ الاقتطاع",
  "saving": "جارٍ حفظ الاقتطاع…",
  "check": "التحقق من هذا الحفظ",
  "checking": "جارٍ التحقق من هذا الحفظ…",
  "cancel": "إلغاء الاقتطاع",
  "done": "تم",
  "finish": "إنهاء",
  "personalOnly": "يتوفر اقتطاع النهاية لمخرجات MP4 المدعومة ومن دون صوت في المستندات الشخصية التي تملكها.",
  "status": {
    "saved": "حُفظ الفيديو الأقصر كمراجعة جديدة. تم الاحتفاظ بالأصل. راجع هذه المراجعة قبل استخدامها.",
    "unchanged": "تم تحديد الفيديو كاملًا. يحتفظ الحفظ بالمراجعة الحالية والبيانات الأصلية.",
    "source_changed": "تغيّر المصدر. ألغِ هذا الاقتطاع وأعد فتح الناتج لاختيار مراجعته الحالية.",
    "invalid_range": "اختر رقمًا صحيحًا لعينة النهاية من 1 إلى عدد العينات الأصلية. تبقى البداية عند 0.",
    "unsupported": "هذا الفيديو خارج المجموعة المدعومة من ملفات MP4 بترميز AVC ومن دون صوت. ألغِ هذا الاقتطاع للعودة إلى الناتج.",
    "unavailable": "الفيديو المتحقق منه غير متاح. ألغِ هذا الاقتطاع وأعد فتح الناتج للمحاولة مرة أخرى.",
    "access_denied": "لم تعد لديك صلاحية حفظ هذا الاقتطاع.",
    "unconfirmed": "نتيجة الحفظ غير مؤكدة. لم تتكرر العملية. استخدم «التحقق من هذا الحفظ» للتحقق من العملية الأصلية من دون الحفظ مجددًا.",
    "retired": "لم تعد جلسة التحرير هذه سارية. أعد فتح الناتج للمتابعة."
  }
};

const ja: VideoTrimCopy = {
  "action": "末尾をトリミング",
  "title": "動画の末尾をトリミング",
  "help": "対応する音声なしのAVC MP4の先頭部分を残します。符号化サンプルの境界で終了位置を選んでください。音声付き、複数トラック、非対応の符号化形式の動画はここではトリミングできません。このエディターでは動画の再生やプレビューは行いません。",
  "originalNotes": "保存すると短い動画データを持つ新しいリビジョンが作成され、元の動画も保持されます。使用する前に新しいリビジョンをレビューしてください。",
  "loading": "所有する動画を読み込み、検証しています…",
  "start": "開始位置：0秒（固定）",
  "end": "終了サンプル（含まない）",
  "duration": "選択した長さ：約{seconds}秒",
  "exactTime": "正確な長さ：{fraction}秒",
  "sourceDuration": "元の長さ：約{seconds}秒",
  "interval": "全{count}サンプルのうち、0から{end}の直前までを残します。{end}は含みません。",
  "dimensions": "動画の寸法：{width} × {height}",
  "save": "トリミングを保存",
  "saving": "トリミングを保存しています…",
  "check": "この保存結果を確認",
  "checking": "この保存結果を確認しています…",
  "cancel": "トリミングをキャンセル",
  "done": "完了",
  "finish": "終了",
  "personalOnly": "所有する個人ドキュメント内の、対応する音声なしのMP4出力で末尾をトリミングできます。",
  "status": {
    "saved": "短くした動画を新しいリビジョンとして保存しました。元の動画も保持されています。使用する前にこのリビジョンをレビューしてください。",
    "unchanged": "動画全体が選択されています。保存しても現在のリビジョンと元のデータが保持されます。",
    "source_changed": "ソースが変更されました。トリミングをキャンセルし、出力を開き直して現在のリビジョンを選択してください。",
    "invalid_range": "終了サンプルには1から元のサンプル数までの整数を選んでください。開始位置は0のままです。",
    "unsupported": "この動画は対応する音声なしのAVC MP4の範囲外です。トリミングをキャンセルして出力に戻ってください。",
    "unavailable": "検証済みの動画を利用できません。トリミングをキャンセルし、出力を開き直して再試行してください。",
    "access_denied": "このトリミングを保存する権限がなくなりました。",
    "unconfirmed": "保存結果は未確認です。操作は繰り返していません。「この保存結果を確認」で、再保存せずに元の操作の結果を確認できます。",
    "retired": "この編集セッションは無効になりました。続行するには出力を開き直してください。"
  }
};

export const VIDEO_TRIM_MESSAGES: Readonly<Record<"en" | "fr" | "ar" | "ja", VideoTrimCopy>> = { en, fr, ar, ja };
export function videoTrimCopy(locale: string): VideoTrimCopy {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return language === "fr" ? fr : language === "ar" ? ar : language === "ja" ? ja : en;
}
