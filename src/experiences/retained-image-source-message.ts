/** The retained result is not a freshly confirmed plan for the changed document. */
export function retainedImageSourceMessage(locale: string): string {
  switch (locale.toLowerCase().split(/[-_]/u)[0]) {
    case "fr": return "Résultat conservé · Le contexte a changé";
    case "ar": return "الناتج المحفوظ · تغيّر السياق";
    case "ja": return "保持された結果 · コンテキストが変更されています";
    default: return "Retained result · Context has changed";
  }
}
