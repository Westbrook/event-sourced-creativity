const copy = {
  title: ["The file you are reviewing", "Le fichier que vous examinez", "الملف الذي تراجعه", "レビュー対象のファイル"],
  open: ["Preview exact file", "Aperçu du fichier exact", "معاينة الملف نفسه", "実際のファイルをプレビュー"],
  close: ["Close preview", "Fermer l’aperçu", "إغلاق المعاينة", "プレビューを閉じる"],
  loading: ["Loading and verifying this exact file…", "Chargement et vérification du fichier exact…", "جارٍ تحميل الملف نفسه والتحقق منه…", "実際のファイルを読み込み、検証しています…"],
  hint: ["Preview this file before completing the review below. Opening it does not accept it.", "Prévisualisez ce fichier avant de remplir l’examen ci-dessous. L’ouvrir ne l’accepte pas.", "عاين هذا الملف قبل إكمال المراجعة أدناه. فتحه لا يعني قبوله.", "下のレビューを完了する前に、このファイルを確認してください。開いても承認されません。"],
  verified: ["Exact-file preview · matched to the fingerprint below", "Aperçu du fichier exact · empreinte vérifiée ci-dessous", "معاينة الملف نفسه · تطابق البصمة أدناه", "実際のファイルのプレビュー · 下の指紋と一致"],
  unavailable: ["Preview unavailable. Download this exact file for review; do not rely on a different version.", "Aperçu indisponible. Téléchargez ce fichier exact pour l’examiner ; ne vous fiez pas à une autre version.", "المعاينة غير متاحة. نزّل هذا الملف نفسه لمراجعته؛ لا تعتمد على إصدار مختلف.", "プレビューを利用できません。この実際のファイルをダウンロードして確認し、別のバージョンに頼らないでください。"],
  unsupported: ["This file type or size needs an external viewer. Download the exact file below and open it before attesting.", "Ce type ou cette taille de fichier nécessite une application externe. Téléchargez le fichier exact ci-dessous et ouvrez-le avant d’attester.", "يحتاج نوع هذا الملف أو حجمه إلى عارض خارجي. نزّل الملف نفسه أدناه وافتحه قبل الإقرار.", "この形式またはサイズには外部ビューアーが必要です。下から実際のファイルをダウンロードし、開いてから確認してください。"],
  mediaName: ["Exact-file preview: {name}", "Aperçu du fichier exact : {name}", "معاينة الملف نفسه: {name}", "実際のファイルのプレビュー：{name}"],
} as const;
export function outputReviewPreviewMessage(locale: string, key: keyof typeof copy, values: Record<string, string> = {}): string {
  const family = locale.toLowerCase().split(/[-_]/)[0];
  return copy[key][family === "fr" ? 1 : family === "ar" ? 2 : family === "ja" ? 3 : 0]
    .replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
