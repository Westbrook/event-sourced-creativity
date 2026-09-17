import type { FormaSupportedLocale } from "./design-system/language-options.ts";
import type { SelectedOutputShareAnyPublicOutput } from "../model/selected-output-share.ts";

/** Display copy only. These labels never authorize publication, select an
 * audience, change an output kind or supply a private title. Consumers update
 * labels in place when locale changes and preserve authored input values. */
export type SelectedOutputShareCopy = Readonly<{
  shareOutput: string;
  manageLinks: string;
  sharedOutput: string;
  loading: string;
  expired: string;
  attribution: string;
  title: string;
  expires: string;
  review: string;
  publishLink: string;
  linkPublished: string;
  copyLink: string;
  copied: string;
  revokeLink: string;
  revoked: string;
  close: string;
  unavailable: string;
  tryAgain: string;
  expiresAt: string;
  noLinks: string;
  moreLinks: string;
  accessScope: string;
  reviewHint: string;
  recordDisclosure: string;
  loadFile: string;
  loadingFile: string;
  downloadFile: string;
  viewModel: string;
  closePreview: string;
  fileUnavailable: string;
  fileExpired: string;
  reviewFile: string;
  format: string;
  fileSize: string;
  duration: string;
  dimensions: string;
  bytes: string;
  seconds: string;
  watermarkDeclared: string;
  watermarkUndeclared: string;
  encoderDeclared: string;
  outputKinds: Readonly<Record<SelectedOutputShareAnyPublicOutput["output"], string>>;
}>;
type Locale = FormaSupportedLocale["locale"];
const freeze = (copy: SelectedOutputShareCopy): SelectedOutputShareCopy => Object.freeze({
  ...copy, outputKinds: Object.freeze({ ...copy.outputKinds }),
});

export const SELECTED_OUTPUT_SHARE_MESSAGES: Readonly<Record<Locale, SelectedOutputShareCopy>> = Object.freeze({
  en: freeze({
    shareOutput: "Share output",
    manageLinks: "Manage links",
    sharedOutput: "Shared output",
    loading: "Loading",
    expired: "Expired",
    attribution: "Forma",
    title: "Title",
    expires: "Expires",
    review: "Review",
    publishLink: "Publish link",
    linkPublished: "Link published",
    copyLink: "Copy link",
    copied: "Copied",
    revokeLink: "Revoke link",
    revoked: "Revoked",
    close: "Close",
    unavailable: "Unavailable",
    tryAgain: "Try again",
    expiresAt: "Expires {date}",
    noLinks: "No links yet",
    moreLinks: "More links",
    accessScope: "People who can access this site can open this link.",
    reviewHint: "Review this output before sharing.",
    recordDisclosure: "Link records are kept to prevent reuse.",
    loadFile: "Load file", loadingFile: "Loading file", downloadFile: "Download file",
    viewModel: "View 3D", closePreview: "Close preview", fileUnavailable: "File unavailable", fileExpired: "File expired",
    reviewFile: "Load and review the file before publishing.",
    format: "Format", fileSize: "File size", duration: "Duration", dimensions: "Dimensions", bytes: "bytes", seconds: "seconds",
    watermarkDeclared: "SynthID declared by the source.", watermarkUndeclared: "The source does not declare a watermark.",
    encoderDeclared: "The file declares x264 163 r3060.",
    outputKinds: { short_story: "Short story", scene: "Scene", slides: "Slides", audio: "Audio", video: "Video", model3d: "3D" },
  }),
  fr: freeze({
    shareOutput: "Partager le résultat",
    manageLinks: "Gérer les liens",
    sharedOutput: "Résultat partagé",
    loading: "Chargement",
    expired: "Expiré",
    attribution: "Forma",
    title: "Titre",
    expires: "Expiration",
    review: "Vérifier",
    publishLink: "Publier le lien",
    linkPublished: "Lien publié",
    copyLink: "Copier le lien",
    copied: "Copié",
    revokeLink: "Révoquer le lien",
    revoked: "Révoqué",
    close: "Fermer",
    unavailable: "Indisponible",
    tryAgain: "Réessayer",
    expiresAt: "Expire le {date}",
    noLinks: "Pas encore de lien",
    moreLinks: "Autres liens",
    accessScope: "Les personnes ayant accès à ce site peuvent ouvrir ce lien.",
    reviewHint: "Vérifiez ce résultat avant de le partager.",
    recordDisclosure: "Les enregistrements des liens sont conservés pour empêcher leur réutilisation.",
    loadFile: "Charger le fichier", loadingFile: "Chargement du fichier", downloadFile: "Télécharger le fichier",
    viewModel: "Voir en 3D", closePreview: "Fermer l’aperçu", fileUnavailable: "Fichier indisponible", fileExpired: "Fichier expiré",
    reviewFile: "Chargez et vérifiez le fichier avant de publier.",
    format: "Format", fileSize: "Taille du fichier", duration: "Durée", dimensions: "Dimensions", bytes: "octets", seconds: "secondes",
    watermarkDeclared: "SynthID déclaré par la source.", watermarkUndeclared: "La source ne déclare aucun filigrane.",
    encoderDeclared: "Le fichier déclare x264 163 r3060.",
    outputKinds: { short_story: "Nouvelle", scene: "Scène", slides: "Diapositives", audio: "Audio", video: "Vidéo", model3d: "3D" },
  }),
  ja: freeze({
    shareOutput: "出力を共有",
    manageLinks: "リンクを管理",
    sharedOutput: "共有された出力",
    loading: "読み込み中",
    expired: "有効期限切れ",
    attribution: "Forma",
    title: "タイトル",
    expires: "有効期限",
    review: "確認",
    publishLink: "リンクを発行",
    linkPublished: "リンクを発行しました",
    copyLink: "リンクをコピー",
    copied: "コピーしました",
    revokeLink: "リンクを無効にする",
    revoked: "無効にしました",
    close: "閉じる",
    unavailable: "利用できません",
    tryAgain: "再試行",
    expiresAt: "{date}まで有効",
    noLinks: "リンクはまだありません",
    moreLinks: "他のリンク",
    accessScope: "このサイトにアクセスできる人は、このリンクを開けます。",
    reviewHint: "共有する前に出力を確認してください。",
    recordDisclosure: "再利用を防ぐため、リンクの記録を保持します。",
    loadFile: "ファイルを読み込む", loadingFile: "ファイルを読み込み中", downloadFile: "ファイルをダウンロード",
    viewModel: "3Dを表示", closePreview: "プレビューを閉じる", fileUnavailable: "ファイルを利用できません", fileExpired: "ファイルの有効期限切れ",
    reviewFile: "公開する前にファイルを読み込んで確認してください。",
    format: "形式", fileSize: "ファイルサイズ", duration: "長さ", dimensions: "寸法", bytes: "バイト", seconds: "秒",
    watermarkDeclared: "ソースはSynthIDを申告しています。", watermarkUndeclared: "ソースは透かしを申告していません。",
    encoderDeclared: "ファイルはx264 163 r3060を申告しています。",
    outputKinds: { short_story: "短編小説", scene: "シーン", slides: "スライド", audio: "音声", video: "動画", model3d: "3D" },
  }),
  ar: freeze({
    shareOutput: "مشاركة النتيجة",
    manageLinks: "إدارة الروابط",
    sharedOutput: "النتيجة المشتركة",
    loading: "جارٍ التحميل",
    expired: "انتهت الصلاحية",
    attribution: "Forma",
    title: "العنوان",
    expires: "انتهاء الصلاحية",
    review: "مراجعة",
    publishLink: "نشر الرابط",
    linkPublished: "تم نشر الرابط",
    copyLink: "نسخ الرابط",
    copied: "تم النسخ",
    revokeLink: "إبطال الرابط",
    revoked: "تم الإبطال",
    close: "إغلاق",
    unavailable: "غير متاح",
    tryAgain: "إعادة المحاولة",
    expiresAt: "تنتهي الصلاحية في {date}",
    noLinks: "لا توجد روابط بعد",
    moreLinks: "روابط أخرى",
    accessScope: "يمكن لمن لديهم صلاحية الوصول إلى هذا الموقع فتح هذا الرابط.",
    reviewHint: "راجع هذه النتيجة قبل مشاركتها.",
    recordDisclosure: "يُحتفظ بسجلات الروابط لمنع إعادة استخدامها.",
    loadFile: "تحميل الملف", loadingFile: "جارٍ تحميل الملف", downloadFile: "تنزيل الملف",
    viewModel: "عرض ثلاثي الأبعاد", closePreview: "إغلاق المعاينة", fileUnavailable: "الملف غير متاح", fileExpired: "انتهت صلاحية الملف",
    reviewFile: "حمّل الملف وراجعه قبل النشر.",
    format: "التنسيق", fileSize: "حجم الملف", duration: "المدة", dimensions: "الأبعاد", bytes: "بايت", seconds: "ثوانٍ",
    watermarkDeclared: "يُصرّح المصدر بوجود SynthID.", watermarkUndeclared: "لا يُصرّح المصدر بعلامة مائية.",
    encoderDeclared: "يُصرّح الملف باستخدام x264 163 r3060.",
    outputKinds: { short_story: "قصة قصيرة", scene: "مشهد", slides: "شرائح", audio: "صوت", video: "فيديو", model3d: "ثلاثي الأبعاد" },
  }),
});

/** Accept the saved shell locale or its regional form. No preference is read
 * or written here, and changing locale never changes the selected output. */
export function selectedOutputShareCopy(locale: string): SelectedOutputShareCopy {
  const language = locale.trim().toLowerCase().split(/[-_]/u)[0]!;
  return Object.hasOwn(SELECTED_OUTPUT_SHARE_MESSAGES, language)
    ? SELECTED_OUTPUT_SHARE_MESSAGES[language as Locale] : SELECTED_OUTPUT_SHARE_MESSAGES.en;
}

/** The caller formats the date using its current locale/time zone. Insert it
 * literally once; never parse it, alter expiry or interpret it as HTML. */
export function selectedOutputShareExpiryLabel(locale: string, formattedDate: string): string {
  return selectedOutputShareCopy(locale).expiresAt.replace("{date}", () => formattedDate);
}
